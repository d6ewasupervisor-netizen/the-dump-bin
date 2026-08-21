/* Set survey / dual PROD+SI photo closeout — smart bay capture UX. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const LIVE_ZOOM_MIN = 0.5;
  const LIVE_ZOOM_MAX = 4;
  const LIVE_ZOOM_STEP = 0.25;

  function esc(s) {
    return global.EodApi.escapeHtml(s);
  }

  function queryParams() {
    const raw = String(location.hash || '').split('?')[1] || '';
    return new URLSearchParams(raw);
  }

  function sidePill(side) {
    const st = String(side?.status || 'unknown');
    const cls =
      st === 'completed' || st === 'ok' || st === 'ok_already_complete'
        ? 'ok'
        : st === 'open'
          ? 'warn'
          : st === 'error' || st === 'not_found' || st === 'unavailable'
            ? 'danger'
            : '';
    return `<span class="pill ${cls}">${esc(st.replace(/_/g, ' '))}</span>`;
  }

  async function fetchStatus(dbkey, rowId) {
    const S = global.EodSession;
    const qs = new URLSearchParams({
      store: S.state.storeNumber,
      date: S.state.workDate,
      dbkey,
    });
    if (rowId) qs.set('rowId', rowId);
    if (S.state.selectedShift?.visitId) qs.set('visitId', S.state.selectedShift.visitId);
    const resp = await global.authFetch(`${API}/status?${qs}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Status failed (${resp.status})`);
    return data.status;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read photo'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhoto({ dbkey, rowId, slot, bay, photoBase64, visitId, resetId, taskId }) {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const body = JSON.stringify({
      storeNumber: S.state.storeNumber,
      workDate: S.state.workDate,
      dbkey,
      rowId,
      slot,
      bay,
      photoBase64,
      visitId: visitId || S.state.selectedShift?.visitId || null,
      resetId: resetId || null,
      taskId: taskId || null,
    });
    const resp = await global.authFetch(`${API}/photo`, { method: 'POST', headers, body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.result) throw new Error(data.error || `Upload failed (${resp.status})`);
    return data.result || data;
  }

  async function crossFill(dbkey, rowId) {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const body = JSON.stringify({
      storeNumber: S.state.storeNumber,
      workDate: S.state.workDate,
      dbkey,
      rowId,
      visitId: S.state.selectedShift?.visitId || null,
      direction: 'auto',
    });
    const resp = await global.authFetch(`${API}/cross-fill`, { method: 'POST', headers, body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Cross-fill failed (${resp.status})`);
    return data.result;
  }

  async function completeSet(dbkey, rowId, ids) {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const body = JSON.stringify({
      storeNumber: S.state.storeNumber,
      workDate: S.state.workDate,
      dbkey,
      rowId,
      visitId: ids?.visitId || S.state.selectedShift?.visitId || null,
      resetId: ids?.resetId || null,
      taskId: ids?.taskId || null,
      markSheet: true,
    });
    const resp = await global.authFetch(`${API}/complete`, { method: 'POST', headers, body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.result) throw new Error(data.error || `Complete failed (${resp.status})`);
    return data.result || data;
  }

  /**
   * Live camera stays open for sequential bay capture.
   * Auto-closes only after every bay is filled; otherwise Exit is manual.
   */
  function openLiveCamera({ getLabel, onCapture, shouldContinue }) {
    const overlay = document.createElement('div');
    overlay.className = 'vf-live-camera';
    overlay.innerHTML = `
      <div class="vf-live-camera-inner">
        <div class="vf-live-camera-hud" data-hud>Bay …</div>
        <video playsinline autoplay muted></video>
        <canvas hidden></canvas>
        <div class="vf-live-camera-bar">
          <label class="vf-zoom">Zoom <input type="range" min="${LIVE_ZOOM_MIN}" max="${LIVE_ZOOM_MAX}" step="${LIVE_ZOOM_STEP}" value="1"></label>
          <button type="button" class="btn btn-primary" data-act="shutter">Capture</button>
          <button type="button" class="btn btn-secondary" data-act="close">Exit</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    const canvas = overlay.querySelector('canvas');
    const zoomInput = overlay.querySelector('input[type="range"]');
    const hud = overlay.querySelector('[data-hud]');
    const shutterBtn = overlay.querySelector('[data-act="shutter"]');
    let stream = null;
    let zoom = 1;
    let busy = false;

    function refreshHud() {
      if (hud) hud.textContent = (typeof getLabel === 'function' ? getLabel() : null) || 'Capture';
    }

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      refreshHud();
    }

    function stop() {
      try {
        stream?.getTracks?.().forEach((t) => t.stop());
      } catch (_) {}
      overlay.remove();
    }

    zoomInput.oninput = () => {
      zoom = Number(zoomInput.value) || 1;
    };

    overlay.querySelector('[data-act="close"]').onclick = stop;
    shutterBtn.onclick = async () => {
      if (busy) return;
      busy = true;
      shutterBtn.disabled = true;
      try {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        const zw = Math.max(1, Math.floor(w / zoom));
        const zh = Math.max(1, Math.floor(h / zoom));
        const sx = Math.floor((w - zw) / 2);
        const sy = Math.floor((h - zh) / 2);
        canvas.width = zw;
        canvas.height = zh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, sx, sy, zw, zh, 0, 0, zw, zh);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
        if (!blob) return;
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
        try {
          await onCapture(file);
        } catch (err) {
          // Keep camera open on upload errors — user can retry or Exit.
          alert(err?.message || String(err) || 'Capture failed');
          refreshHud();
          return;
        }
        refreshHud();
        // Only leave camera when every bay has a photo (or caller says stop).
        if (typeof shouldContinue === 'function' && !shouldContinue()) {
          stop();
        }
      } finally {
        busy = false;
        if (document.body.contains(overlay)) shutterBtn.disabled = false;
      }
    };

    start().catch((err) => {
      alert(err.message || 'Camera unavailable');
      stop();
    });

    return { stop, refreshHud };
  }

  async function render(mount) {
    const S = global.EodSession;
    const qp = queryParams();
    const dbkey = String(qp.get('dbkey') || '').trim();
    const rowId = qp.get('rowId') || null;
    const catName = qp.get('name') || '';
    const preferSlot = String(qp.get('slot') || 'after').toLowerCase() === 'before' ? 'before' : 'after';

    if (!dbkey) {
      mount.innerHTML = `<div class="card error"><h2>Missing dbkey</h2><p>Open Capture from a signoff sheet row.</p>
        <button type="button" class="btn btn-secondary" id="backSignoff">Back to signoff</button></div>`;
      document.getElementById('backSignoff').onclick = () => global.EodRouter.go('signoff');
      return;
    }

    mount.innerHTML = `
      <div class="card set-survey">
        <div class="btn-row" style="justify-content:space-between;">
          <button type="button" class="btn btn-secondary" id="backSignoff">← Signoff</button>
          <button type="button" class="btn btn-secondary" id="refreshStatus">Refresh</button>
        </div>
        <h1>${esc(catName || 'Set capture')}</h1>
        <p class="muted">DBKEY ${esc(dbkey)} · Store ${esc(S.state.storeNumber)} · ${esc(S.state.workDate)}</p>
        <div id="setStatusChips" class="muted">Loading PROD / SI…</div>
        <div id="setSurveyBody">Loading…</div>
        <div id="setSurveyMsg" class="muted" style="margin-top:10px;"></div>
      </div>`;

    document.getElementById('backSignoff').onclick = () => global.EodRouter.go('signoff');

    const local = {
      before: [],
      after: [],
      status: null,
      uploading: false,
    };

    const week = S.state.fiscalWeek || S.state.sheet?.fiscalWeek || '';
    if (week && global.EodSetBeforeStore) {
      local.before = (global.EodSetBeforeStore.getBefores(S.state.storeNumber, week, dbkey) || []).map((p) => ({
        bay: p.bay || 1,
        preview: p.dataUrl || p.preview,
        photoBase64: p.dataUrl || p.photoBase64 || p.preview,
        uploadStatus: p.uploadStatus || 'on device',
        fileName: p.fileName || 'before.jpg',
      }));
    }

    function setMsg(text, isErr) {
      const el = document.getElementById('setSurveyMsg');
      if (!el) return;
      el.style.color = isErr ? 'var(--danger)' : '';
      el.textContent = text || '';
    }

    function expectedBayCount() {
      const status = local.status || {};
      if (Number(status.expectedBayCount) > 0) return Number(status.expectedBayCount);
      if (status.bays?.length) return status.bays.length;
      return 1;
    }

    function bayList() {
      const n = expectedBayCount();
      const fromStatus = local.status?.bays || [];
      const byBay = new Map(fromStatus.map((b) => [Number(b.bay), b]));
      const out = [];
      for (let i = 1; i <= n; i += 1) {
        out.push(byBay.get(i) || { bay: i, bayName: String(i), hasPhoto: false });
      }
      return out;
    }

    function takenBays(slot) {
      const set = new Set();
      for (const p of local[slot] || []) {
        if (p.uploadStatus === 'failed') continue;
        const b = Number(p.bay);
        if (Number.isFinite(b) && b > 0) set.add(b);
      }
      return set;
    }

    function nextEmptyBay(slot) {
      const taken = takenBays(slot);
      for (const b of bayList()) {
        if (!taken.has(Number(b.bay))) return Number(b.bay);
      }
      return null;
    }

    /** First file → first empty bay (or bay 1); last of a full batch → last bay. */
    function assignBaysForFiles(slot, fileCount) {
      const n = expectedBayCount();
      const taken = takenBays(slot);
      const empties = [];
      for (let i = 1; i <= n; i += 1) {
        if (!taken.has(i)) empties.push(i);
      }
      if (!empties.length) {
        // All filled — retake from bay 1 in order
        return Array.from({ length: fileCount }, (_, i) => Math.min(i + 1, n));
      }
      // Multi-load into an empty (or mostly empty) set: stretch across remaining empties in order
      if (fileCount >= empties.length && taken.size === 0) {
        return Array.from({ length: Math.min(fileCount, n) }, (_, i) => i + 1);
      }
      const assigned = [];
      for (let i = 0; i < fileCount; i += 1) {
        assigned.push(empties[i] != null ? empties[i] : empties[empties.length - 1]);
      }
      return assigned;
    }

    function persistBefores() {
      if (!(week && global.EodSetBeforeStore)) return;
      global.EodSetBeforeStore.setBefores(
        S.state.storeNumber,
        week,
        dbkey,
        local.before.map((p) => ({
          bay: p.bay,
          dataUrl: p.photoBase64 || p.preview,
          uploadStatus: p.uploadStatus,
          workDate: S.state.workDate,
          capturedAt: Date.now(),
        }))
      );
    }

    function paintStatus(status) {
      local.status = status;
      const chips = document.getElementById('setStatusChips');
      if (!chips) return;
      const bayN = status.expectedBayCount || status.bays?.length || 1;
      const width = status.bayWidthFt;
      const feet = status.footageFeet || status.footageDisplay;
      let footageBit = ` · ${bayN} bay photo${bayN === 1 ? '' : 's'} needed`;
      if (width && feet) {
        footageBit = ` · ${bayN} bays × ${esc(width)} ft = ${esc(feet)} ft`;
      } else if (feet) {
        footageBit = ` · ${bayN} bays (${esc(feet)} ft footage)`;
      }
      chips.innerHTML =
        `PROD ${sidePill(status.prod)}` +
        (status.prod.beforeCount != null
          ? ` <span class="muted">before ${status.prod.beforeCount} / after ${status.prod.afterCount || 0}</span>`
          : '') +
        ` · SI ${sidePill(status.si)}` +
        (status.si.sectionCount != null
          ? ` <span class="muted">${status.si.sectionsWithPhoto || 0}/${status.si.sectionCount} sections</span>`
          : '') +
        footageBit +
        (status.sheetRow?.id ? ` · Sheet row ${esc(status.sheetRow.id)}` : '');
    }

    function bayProgressHtml(slot) {
      const taken = takenBays(slot);
      const bays = bayList();
      const have = [...taken].filter((b) => b >= 1 && b <= bays.length).length;
      return `
        <div class="set-bay-progress" aria-label="${have} of ${bays.length} bays">
          <div class="set-bay-progress-label">${have} / ${bays.length} bays</div>
          <div class="set-bay-dots">
            ${bays
              .map((b) => {
                const filled = taken.has(Number(b.bay));
                const si = !!b.hasPhoto;
                return `<span class="set-bay-dot ${filled ? 'filled' : ''} ${si && !filled ? 'si' : ''}" title="Bay ${esc(b.bayName || b.bay)}">${esc(b.bay)}</span>`;
              })
              .join('')}
          </div>
        </div>`;
    }

    function thumbHtml(list, slot) {
      if (!list.length) return '<p class="muted">No local photos yet — take or load in bay order (1 → last).</p>';
      const sorted = [...list].sort((a, b) => Number(a.bay) - Number(b.bay));
      return `<div class="set-thumbs">${sorted
        .map(
          (p) =>
            `<button type="button" class="set-thumb" data-slot="${slot}" data-bay="${esc(p.bay)}">
              <img src="${p.preview}" alt="${slot} bay ${esc(p.bay)}">
              <span>Bay ${esc(p.bay)} · ${esc(p.uploadStatus || 'queued')}</span>
            </button>`
        )
        .join('')}</div>`;
    }

    function paintBody() {
      const status = local.status || {};
      const n = expectedBayCount();
      const body = document.getElementById('setSurveyBody');
      if (!body) return;
      const nextAfter = nextEmptyBay('after');
      const nextBefore = nextEmptyBay('before');
      body.innerHTML = `
        <div class="set-survey-questions">
          ${(status.surveyQuestions || [])
            .map((q) => `<div class="muted">• ${esc(q.text)}</div>`)
            .join('')}
        </div>

        <section class="set-photo-block">
          <h2>Before ${preferSlot === 'before' ? '<span class="pill warn">focus</span>' : ''}</h2>
          <p class="muted">${n} bay photo${n === 1 ? '' : 's'} (not feet) — first shot is bay 1, last is bay ${n}. Camera stays open until all bays are done or you Exit.</p>
          ${bayProgressHtml('before')}
          ${thumbHtml(local.before, 'before')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="before">${
              nextBefore ? `Take bay ${nextBefore}…` : 'Retake befores'
            }</button>
            <label class="btn btn-secondary set-file-btn">Load photos
              <input type="file" accept="image/*" multiple data-gal="before" hidden>
            </label>
          </div>
        </section>

        <section class="set-photo-block">
          <h2>After ${preferSlot === 'after' ? '<span class="pill warn">focus</span>' : ''}</h2>
          <p class="muted">${n} after photos needed (bays, not feet). Multi-select assigns bay 1 → ${n} in order. Camera stays open until all are done.</p>
          ${bayProgressHtml('after')}
          ${thumbHtml(local.after, 'after')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="after">${
              nextAfter ? `Take bay ${nextAfter} of ${n}` : 'Retake afters'
            }</button>
            <label class="btn btn-secondary set-file-btn">Load photos
              <input type="file" accept="image/*" multiple data-gal="after" hidden>
            </label>
          </div>
        </section>

        <div class="btn-row" style="margin-top:16px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" id="crossFillBtn">Pull from other system</button>
          <button type="button" class="btn btn-success" id="finishSetBtn">Finish set (upload + complete + mark sheet)</button>
        </div>`;

      body.querySelectorAll('[data-cap]').forEach((btn) => {
        btn.onclick = () => startSequentialCapture(btn.getAttribute('data-cap'));
      });
      body.querySelectorAll('[data-gal]').forEach((input) => {
        input.onchange = async () => {
          const files = [...(input.files || [])];
          input.value = '';
          if (!files.length) return;
          await enqueueFiles(input.getAttribute('data-gal'), files);
        };
      });
      document.getElementById('crossFillBtn').onclick = async () => {
        try {
          setMsg('Pulling photos across PROD ↔ SI…');
          const r = await crossFill(dbkey, rowId);
          setMsg(
            `Cross-fill (${r.direction}): uploaded ${r.uploaded?.length || 0}, skipped ${r.skipped?.length || 0}, errors ${r.errors?.length || 0}`
          );
          if (r.status) paintStatus(r.status);
          paintBody();
        } catch (err) {
          setMsg(err.message || String(err), true);
        }
      };
      document.getElementById('finishSetBtn').onclick = () => finishAll();
    }

    function startSequentialCapture(slot) {
      const n = expectedBayCount();
      openLiveCamera({
        getLabel: () => {
          const next = nextEmptyBay(slot);
          const have = takenBays(slot).size;
          if (next == null) {
            return `${slot === 'after' ? 'After' : 'Before'} · ${have}/${n} bays done · Exit or retake`;
          }
          return `${slot === 'after' ? 'After' : 'Before'} · Bay ${next} of ${n} · ${have}/${n} done · tap Capture`;
        },
        // Stay in camera until every bay has a local photo (failed counts as empty).
        shouldContinue: () => nextEmptyBay(slot) != null,
        onCapture: async (file) => {
          const bay = nextEmptyBay(slot) || 1;
          await enqueueLocal(slot, file, bay, { skipPaint: true });
          paintBody();
        },
      });
    }

    async function enqueueFiles(slot, files) {
      const bays = assignBaysForFiles(slot, files.length);
      setMsg(`Loading ${files.length} ${slot} photo(s) as bay ${bays[0]}${bays.length > 1 ? `…${bays[bays.length - 1]}` : ''}…`);
      for (let i = 0; i < files.length; i += 1) {
        await enqueueLocal(slot, files[i], bays[i], { skipPaint: i < files.length - 1 });
      }
      paintBody();
    }

    async function enqueueLocal(slot, file, bayOverride, opts = {}) {
      const bay = Number(bayOverride) || nextEmptyBay(slot) || 1;
      const preview = await fileToDataUrl(file);
      // Replace existing local entry for this bay if retaking
      local[slot] = (local[slot] || []).filter((p) => Number(p.bay) !== bay);
      const entry = {
        bay,
        preview,
        photoBase64: preview,
        uploadStatus: 'uploading',
        fileName: file.name,
      };
      local[slot].push(entry);
      local[slot].sort((a, b) => Number(a.bay) - Number(b.bay));
      if (!opts.skipPaint) paintBody();
      if (slot === 'before') persistBefores();
      setMsg(`Uploading ${slot} bay ${bay} of ${expectedBayCount()}…`);
      try {
        const r = await uploadPhoto({
          dbkey,
          rowId,
          slot,
          bay,
          photoBase64: preview,
          visitId: local.status?.prod?.visitId,
          resetId: local.status?.prod?.resetId,
          taskId: local.status?.si?.taskId,
        });
        entry.uploadStatus = `PROD ${r.prod?.status} / SI ${r.si?.status}`;
        setMsg(`Uploaded ${slot} bay ${bay}: PROD ${r.prod?.status}, SI ${r.si?.status}`);
        if (slot === 'before') persistBefores();
        try {
          local.status = await fetchStatus(dbkey, rowId);
          paintStatus(local.status);
        } catch (_) {}
      } catch (err) {
        entry.uploadStatus = 'failed';
        setMsg(err.message || String(err), true);
      }
      if (!opts.skipPaint) paintBody();
    }

    async function finishAll() {
      try {
        const n = expectedBayCount();
        const afterHave = takenBays('after').size;
        if (afterHave < n) {
          const ok = confirm(
            `Only ${afterHave} of ${n} after bay photos are on this phone. Finish anyway?`
          );
          if (!ok) return;
        }
        setMsg('Completing set on PROD + SI and marking signoff sheet…');
        for (const slot of ['before', 'after']) {
          for (const entry of local[slot]) {
            if (entry.uploadStatus === 'queued' || entry.uploadStatus === 'failed') {
              entry.uploadStatus = 'uploading';
              paintBody();
              const r = await uploadPhoto({
                dbkey,
                rowId,
                slot,
                bay: entry.bay,
                photoBase64: entry.photoBase64,
                visitId: local.status?.prod?.visitId,
                resetId: local.status?.prod?.resetId,
                taskId: local.status?.si?.taskId,
              });
              entry.uploadStatus = `PROD ${r.prod?.status} / SI ${r.si?.status}`;
            }
          }
        }
        const result = await completeSet(dbkey, rowId, {
          visitId: local.status?.prod?.visitId,
          resetId: local.status?.prod?.resetId,
          taskId: local.status?.si?.taskId,
        });
        setMsg(
          `Done — PROD ${result.prod?.status}, SI ${result.si?.status}, sheet ${result.sheet?.status}. ${result.sheet?.detail || ''}`
        );
        if (result.status) {
          paintStatus(result.status);
        } else {
          local.status = await fetchStatus(dbkey, rowId);
          paintStatus(local.status);
        }
        try {
          await global.EodSignoffHome?.loadSheet?.();
        } catch (_) {}
        paintBody();
      } catch (err) {
        setMsg(err.message || String(err), true);
      }
    }

    async function reload() {
      try {
        local.status = await fetchStatus(dbkey, rowId);
        paintStatus(local.status);
        paintBody();
        setMsg('');
      } catch (err) {
        document.getElementById('setSurveyBody').innerHTML =
          `<div class="notice notice-error">${esc(err.message || String(err))}</div>`;
      }
    }

    document.getElementById('refreshStatus').onclick = reload;
    await reload();
  }

  global.EodSetSurvey = { render };
  global.EodRouter.register('survey', render);
})(typeof window !== 'undefined' ? window : globalThis);
