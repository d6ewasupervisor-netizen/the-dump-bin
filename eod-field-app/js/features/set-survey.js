/* Set survey / dual PROD+SI photo closeout — CP-inspired capture UX. */
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

  function openLiveCamera({ onCapture }) {
    const overlay = document.createElement('div');
    overlay.className = 'vf-live-camera';
    overlay.innerHTML = `
      <div class="vf-live-camera-inner">
        <video playsinline autoplay muted></video>
        <canvas hidden></canvas>
        <div class="vf-live-camera-bar">
          <label class="vf-zoom">Zoom <input type="range" min="${LIVE_ZOOM_MIN}" max="${LIVE_ZOOM_MAX}" step="${LIVE_ZOOM_STEP}" value="1"></label>
          <button type="button" class="btn btn-primary" data-act="shutter">Capture</button>
          <button type="button" class="btn btn-secondary" data-act="close">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    const canvas = overlay.querySelector('canvas');
    const zoomInput = overlay.querySelector('input[type="range"]');
    let stream = null;
    let zoom = 1;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
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
    overlay.querySelector('[data-act="shutter"]').onclick = async () => {
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
      stop();
      onCapture(file);
    };

    start().catch((err) => {
      alert(err.message || 'Camera unavailable');
      stop();
    });
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

    // Multi-day: restore week-scoped before photos from device
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

    function paintStatus(status) {
      local.status = status;
      const chips = document.getElementById('setStatusChips');
      if (!chips) return;
      chips.innerHTML =
        `PROD ${sidePill(status.prod)}` +
        (status.prod.beforeCount != null
          ? ` <span class="muted">before ${status.prod.beforeCount} / after ${status.prod.afterCount || 0}</span>`
          : '') +
        ` · SI ${sidePill(status.si)}` +
        (status.si.sectionCount != null
          ? ` <span class="muted">${status.si.sectionsWithPhoto || 0}/${status.si.sectionCount} sections</span>`
          : '') +
        (status.sheetRow?.id ? ` · Sheet row ${esc(status.sheetRow.id)}` : '');
    }

    function thumbHtml(list, slot) {
      if (!list.length) return '<p class="muted">No local photos yet.</p>';
      return `<div class="set-thumbs">${list
        .map(
          (p, i) =>
            `<button type="button" class="set-thumb" data-slot="${slot}" data-i="${i}">
              <img src="${p.preview}" alt="${slot} ${i + 1}">
              <span>Bay ${esc(p.bay)} · ${esc(p.uploadStatus || 'queued')}</span>
            </button>`
        )
        .join('')}</div>`;
    }

    function paintBody() {
      const status = local.status || {};
      const bays = status.bays?.length
        ? status.bays
        : [{ bay: 1, bayName: '1', hasPhoto: false }];
      const body = document.getElementById('setSurveyBody');
      if (!body) return;
      body.innerHTML = `
        <div class="set-survey-questions">
          ${(status.surveyQuestions || [])
            .map((q) => `<div class="muted">• ${esc(q.text)}</div>`)
            .join('')}
        </div>

        <section class="set-photo-block">
          <h2>Before ${preferSlot === 'before' ? '<span class="pill warn">focus</span>' : ''}</h2>
          <p class="muted">Befores persist for fiscal week ${esc(week || '—')} on this phone and online after upload.</p>
          ${thumbHtml(local.before, 'before')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="before">Take before</button>
            <label class="btn btn-secondary set-file-btn">Gallery
              <input type="file" accept="image/*" capture="environment" data-gal="before" hidden>
            </label>
          </div>
        </section>

        <section class="set-photo-block">
          <h2>After <span class="muted">(${bays.length} bay${bays.length === 1 ? '' : 's'})</span> ${preferSlot === 'after' ? '<span class="pill warn">focus</span>' : ''}</h2>
          ${thumbHtml(local.after, 'after')}
          <div class="field">
            <label for="afterBay">Bay for next after photo</label>
            <select id="afterBay">
              ${bays
                .map(
                  (b) =>
                    `<option value="${esc(b.bay)}">Bay ${esc(b.bayName || b.bay)}${b.hasPhoto ? ' · has SI photo' : ''}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="after">Take after</button>
            <label class="btn btn-secondary set-file-btn">Gallery
              <input type="file" accept="image/*" capture="environment" data-gal="after" hidden>
            </label>
          </div>
        </section>

        <div class="btn-row" style="margin-top:16px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" id="crossFillBtn">Pull from other system</button>
          <button type="button" class="btn btn-success" id="finishSetBtn">Finish set (upload + complete + mark sheet)</button>
        </div>`;

      body.querySelectorAll('[data-cap]').forEach((btn) => {
        btn.onclick = () => {
          const slot = btn.getAttribute('data-cap');
          openLiveCamera({
            onCapture: (file) => enqueueLocal(slot, file),
          });
        };
      });
      body.querySelectorAll('[data-gal]').forEach((input) => {
        input.onchange = async () => {
          const file = input.files?.[0];
          input.value = '';
          if (file) await enqueueLocal(input.getAttribute('data-gal'), file);
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

    async function enqueueLocal(slot, file) {
      const bayEl = document.getElementById('afterBay');
      const bay = slot === 'after' ? Number(bayEl?.value || 1) : 1;
      const preview = await fileToDataUrl(file);
      const entry = {
        bay,
        preview,
        photoBase64: preview,
        uploadStatus: 'uploading',
        fileName: file.name,
      };
      local[slot].push(entry);
      paintBody();
      if (slot === 'before' && week && global.EodSetBeforeStore) {
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
      setMsg(`Uploading ${slot} bay ${bay} to PROD + SI…`);
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
        if (slot === 'before' && week && global.EodSetBeforeStore) {
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
        local.status = await fetchStatus(dbkey, rowId);
        paintStatus(local.status);
      } catch (err) {
        entry.uploadStatus = 'failed';
        setMsg(err.message || String(err), true);
      }
      paintBody();
    }

    async function finishAll() {
      try {
        setMsg('Completing set on PROD + SI and marking signoff sheet…');
        // Upload any still-queued locals first
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
        // Refresh sheet in session so signoff shows Complete
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
