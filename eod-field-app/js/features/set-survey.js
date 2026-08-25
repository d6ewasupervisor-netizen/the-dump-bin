/* Set survey / dual PROD+SI photo closeout ? smart bay capture UX. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const DS_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';
  const API_ORIGIN = 'https://eod-api.the-dump-bin.com';
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

  function storeDayVisitIds() {
    const S = global.EodSession;
    const fromList = (S.state.shifts || []).map((s) => s.visitId).filter(Boolean);
    const selected = S.state.selectedShift?.visitId;
    return [...new Set([...fromList, selected].filter(Boolean).map(String))];
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
    const ids = storeDayVisitIds();
    if (ids.length) qs.set('visitIds', ids.join(','));
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

  async function preparePhoto(fileOrBlob, type) {
    if (global.EodPhotoCompress?.compressFile) {
      const out = await global.EodPhotoCompress.compressFile(fileOrBlob, type || 'set');
      return out.dataUrl;
    }
    if (fileOrBlob instanceof Blob) return fileToDataUrl(fileOrBlob);
    return String(fileOrBlob || '');
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
      visitIds: storeDayVisitIds(),
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
      visitIds: storeDayVisitIds(),
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
      visitIds: storeDayVisitIds(),
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
        <div class="vf-live-camera-hud" data-hud>Bay ?</div>
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
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        if (!blob) return;
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
        try {
          await onCapture(file);
        } catch (err) {
          // Keep camera open on upload errors ? user can retry or Exit.
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
      mount.innerHTML = `<div class="card error"><h2>Missing dbkey</h2><p>Open Capture/View from a Categories sheet row.</p>
        <button type="button" class="btn btn-secondary" id="backSignoff">← Categories</button></div>`;
      document.getElementById('backSignoff').onclick = () => global.EodRouter.go('signoff');
      return;
    }

    mount.innerHTML = `
      <div class="card set-survey">
        <div class="btn-row" style="justify-content:space-between;">
          <button type="button" class="btn btn-secondary" id="backSignoff">← Categories</button>
          <button type="button" class="btn btn-secondary" id="refreshStatus">Refresh</button>
        </div>
        <h1>${esc(catName || 'Set capture')}</h1>
        <p class="muted">DBKEY ${esc(dbkey)} | Store ${esc(S.state.storeNumber)} | PROD date ${esc(S.state.workDate)}</p>
        <div id="setStatusChips" class="muted">Loading PROD / SI…</div>
        <div id="setSurveyBody">Loading…</div>
        <div id="setSurveyMsg" class="muted" style="margin-top:10px;"></div>
      </div>`;

    document.getElementById('backSignoff').onclick = () => global.EodRouter.go('signoff');

    const local = {
      before: [],
      after: [],
      status: null,
      pack: { photos: [] },
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
        jobId: p.jobId || null,
      }));
    }

    function hydrateFromPipeline() {
      const pipe = global.EodPhotoPipeline;
      if (!pipe) return;
      for (const slot of ['before', 'after']) {
        const byBay = new Map((local[slot] || []).map((p) => [Number(p.bay), p]));
        for (const job of pipe.jobsForSet(dbkey)) {
          if (job.slot !== slot || job.error === 'replaced') continue;
          const bay = Number(job.bay);
          const prev = byBay.get(bay) || { bay };
          byBay.set(bay, {
            ...prev,
            bay,
            preview: job.previewUrl || job.dataUrl || prev.preview,
            photoBase64: job.dataUrl || prev.photoBase64,
            uploadStatus: pipe.statusLabel(job),
            jobId: job.id,
            fileName: prev.fileName || null,
          });
        }
        local[slot] = [...byBay.values()]
          .filter((p) => p.uploadStatus !== 'replaced')
          .sort((a, b) => Number(a.bay) - Number(b.bay));
      }
    }

    hydrateFromPipeline();

    let autoClosePromise = null;

    async function maybeAutoCloseSi() {
      if (autoClosePromise) return autoClosePromise;
      const n = expectedBayCount();
      if (n < 1) return null;
      const afterJobs = (global.EodPhotoPipeline?.jobsForSet?.(dbkey) || []).filter(
        (j) => j.slot === 'after' && j.error !== 'replaced'
      );
      const doneBays = new Set(
        afterJobs.filter((j) => j.status === 'done').map((j) => Number(j.bay))
      );
      // Prefer remote+local taken count
      const taken = takenBays('after');
      for (const b of doneBays) taken.add(b);
      if (taken.size < n) return null;
      const open = afterJobs.some((j) => !['done', 'failed'].includes(j.status));
      if (open) return null;
      const failed = afterJobs.filter((j) => j.status === 'failed');
      if (failed.length) return null;

      autoClosePromise = (async () => {
        try {
          setMsg('All after photos loaded ? closing SI set (waiting for CV if needed)?');
          const result = await completeSet(dbkey, rowId, {
            visitId: local.status?.prod?.visitId,
            resetId: local.status?.prod?.resetId,
            taskId: local.status?.si?.taskId,
          });
          setMsg(
            `Closed ? PROD ${result.prod?.status}, SI ${result.si?.status}, sheet ${result.sheet?.status}. ${result.sheet?.detail || result.si?.detail || ''}`
          );
          if (result.status) paintStatus(result.status);
          else {
            local.status = await fetchStatus(dbkey, rowId);
            paintStatus(local.status);
          }
          try {
            await global.EodSignoffHome?.loadSheet?.();
          } catch (_) {}
          paintBody();
        } catch (err) {
          autoClosePromise = null;
          setMsg(err.message || String(err), true);
        }
      })();
      return autoClosePromise;
    }

    const unsubPipe = global.EodPhotoPipeline?.onChange?.((detail) => {
      if (detail?.job?.dbkey && String(detail.job.dbkey) !== String(dbkey)) return;
      hydrateFromPipeline();
      if (detail.job?.slot === 'before') persistBefores();
      const counts = global.EodPhotoPipeline.pendingCounts();
      const open = counts.compress + counts.upload;
      if (open > 0) {
        setMsg(`Background: ${counts.compress} compressing | ${counts.upload} uploading`);
      } else if (detail.type === 'done') {
        setMsg(`Bay ${detail.job?.bay} done`);
        if (detail.job?.slot === 'after') maybeAutoCloseSi();
        fetchPack().then(() => paintBody());
        return;
      } else if (detail.type === 'failed' && detail.job?.error !== 'replaced') {
        setMsg(detail.job?.error || 'Upload failed', true);
      }
      paintBody();
    });

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

    function remoteBayCovered(slot, bayNum) {
      const b = (local.status?.bays || []).find((x) => Number(x.bay) === Number(bayNum));
      if (!b) return false;
      if (String(slot) === 'before') return !!b.hasProdBefore;
      return !!(b.hasSiPhoto || b.hasProdAfter || b.hasPhoto);
    }

    function takenBays(slot) {
      const set = new Set();
      for (const p of local[slot] || []) {
        const st = String(p.uploadStatus || '');
        if (st === 'failed' || st === 'replaced') continue;
        const b = Number(p.bay);
        if (Number.isFinite(b) && b > 0) set.add(b);
      }
      for (const b of bayList()) {
        const n = Number(b.bay);
        if (remoteBayCovered(slot, n)) set.add(n);
      }
      const cached = String(slot) === 'before' ? beforeCached() : afterCached();
      for (const p of cached) {
        const n = Number(p.bayIndex);
        if (Number.isFinite(n) && n > 0) set.add(n);
      }
      return set;
    }

    function nextEmptyBay(slot) {
      const taken = takenBays(slot);
      const status = local.status || {};
      if (String(slot) === 'after' && status.nextMissingSiBay != null && !taken.has(Number(status.nextMissingSiBay))) {
        return Number(status.nextMissingSiBay);
      }
      if (String(slot) === 'after' && status.nextMissingProdAfterBay != null) {
        const n = Number(status.nextMissingProdAfterBay);
        if (!taken.has(n)) return n;
      }
      if (String(slot) === 'before' && status.nextMissingProdBeforeBay != null) {
        const n = Number(status.nextMissingProdBeforeBay);
        if (!taken.has(n)) return n;
      }
      for (const b of bayList()) {
        if (!taken.has(Number(b.bay))) return Number(b.bay);
      }
      return null;
    }

    /** First file ? first empty bay (or bay 1); last of a full batch ? last bay. */
    function assignBaysForFiles(slot, fileCount) {
      const n = expectedBayCount();
      const taken = takenBays(slot);
      const empties = [];
      for (let i = 1; i <= n; i += 1) {
        if (!taken.has(i)) empties.push(i);
      }
      if (!empties.length) {
        return Array.from({ length: fileCount }, (_, i) => Math.min(i + 1, n));
      }
      if (fileCount >= empties.length && taken.size === 0) {
        return Array.from({ length: Math.min(fileCount, n) }, (_, i) => i + 1);
      }
      const assigned = [];
      for (let i = 0; i < fileCount; i += 1) {
        assigned.push(empties[i] != null ? empties[i] : empties[empties.length - 1]);
      }
      return assigned;
    }

    function afterCached() {
      return (local.pack?.photos || []).filter((p) => p.slot !== 'before');
    }

    function beforeCached() {
      return (local.pack?.photos || []).filter((p) => p.slot === 'before');
    }

    function siViewReady() {
      if (afterCached().length && (local.pack?.photoSource === 'si' || local.pack?.prebuilt)) return true;
      const st = local.status?.si || {};
      const have = Number(st.sectionsWithPhoto) || 0;
      const need = Number(st.sectionCount) || 0;
      return have > 0 && need > 0 && have >= need;
    }

    async function fetchPack() {
      if (!rowId) {
        local.pack = { photos: [] };
        return;
      }
      try {
        const resp = await global.authFetch(`${DS_API}/rows/${encodeURIComponent(rowId)}/photos`);
        const data = await resp.json().catch(() => ({}));
        local.pack = data && Array.isArray(data.photos) ? data : { photos: [] };
      } catch (_) {
        local.pack = { photos: [] };
      }
    }

    async function fillCachedThumbs(host, photos) {
      if (!host) return;
      if (!photos.length) {
        host.innerHTML = '';
        return;
      }
      host.innerHTML = photos.map((p, i) =>
        `<div class="set-thumb remote" data-i="${i}">
          <img alt="${esc(p.label || '')}">
          <span>${esc(p.label || '')}</span>
        </div>`
      ).join('');
      for (const el of host.querySelectorAll('.set-thumb')) {
        const p = photos[Number(el.dataset.i)];
        const path = p?.thumbUrl || p?.url || '';
        if (!path) continue;
        const abs = /^https?:/i.test(path) ? path : API_ORIGIN + path;
        try {
          const resp = await global.authFetch(abs);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const img = el.querySelector('img');
          if (img) img.src = URL.createObjectURL(blob);
        } catch (_) {}
      }
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
          jobId: p.jobId || null,
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
      let footageBit = ` | ${bayN} bay photo${bayN === 1 ? '' : 's'} needed`;
      if (width && feet) {
        footageBit = ` | ${bayN} bays | ${esc(width)} ft = ${esc(feet)} ft`;
      } else if (feet) {
        footageBit = ` | ${bayN} bays (${esc(feet)} ft footage)`;
      }
      const siDate = status.si?.siDate || null;
      const siSrc = status.si?.siDateSource || null;
      let siDateBit = '';
      if (siDate) {
        const label = siSrc === 'prod_work_date' ? 'SI on PROD date' : (siSrc === 'week_backwalk' ? 'SI earlier in week' : 'SI date');
        siDateBit = ` <span class="muted">${esc(label)} ${esc(siDate)}</span>`;
      }
      chips.innerHTML =
        `PROD ${sidePill(status.prod)}` +
        (status.prod.beforeCount != null
          ? ` <span class="muted">before ${status.prod.beforeCount} / after ${status.prod.afterCount || 0}</span>`
          : '') +
        ` | SI ${sidePill(status.si)}` +
        (status.si.sectionCount != null
          ? ` <span class="muted">${status.si.sectionsWithPhoto || 0}/${status.si.sectionCount} sections</span>`
          : '') +
        siDateBit +
        footageBit +
        (status.sheetRow?.id ? ` | Sheet row ${esc(status.sheetRow.id)}` : '');
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

    function remoteStackHtml(slot) {
      const cached = slot === 'before' ? beforeCached() : afterCached();
      if (!cached.length) return '<div class="set-thumbs set-thumbs-remote" data-cached-slot="' + slot + '"></div>';
      return `<div class="set-thumbs set-thumbs-remote" data-cached-slot="${slot}"></div>`;
    }

    function thumbHtml(list, slot) {
      if (!list.length) {
        return '<p class="muted">No device photos yet — take or load in bay order (1 → last).</p>';
      }
      const sorted = [...list].sort((a, b) => Number(a.bay) - Number(b.bay));
      return `<div class="set-thumbs set-thumbs-device">${sorted
        .map(
          (p) =>
            `<div class="set-thumb device" data-slot="${slot}" data-bay="${esc(p.bay)}" data-job="${esc(p.jobId || '')}">
              <button type="button" class="set-thumb-x" data-clear-slot="${slot}" data-clear-bay="${esc(p.bay)}" data-clear-job="${esc(p.jobId || '')}" aria-label="Remove device photo">×</button>
              <img src="${p.preview}" alt="${slot} bay ${esc(p.bay)}">
              <span>Bay ${esc(p.bay)} | ${esc(p.uploadStatus || 'queued')}</span>
            </div>`
        )
        .join('')}</div>`;
    }

    function clearDevicePhoto(slot, bay, jobId) {
      const bayNum = Number(bay);
      if (jobId && global.EodPhotoPipeline?.removeJob) {
        global.EodPhotoPipeline.removeJob(jobId);
      } else if (global.EodPhotoPipeline?.removeSetBay) {
        global.EodPhotoPipeline.removeSetBay(dbkey, slot, bayNum);
      }
      local[slot] = (local[slot] || []).filter((p) => Number(p.bay) !== bayNum);
      if (slot === 'before') persistBefores();
      setMsg('Removed device bay ' + bayNum);
      paintBody();
    }

    function paintBody() {
      const n = expectedBayCount();
      const body = document.getElementById('setSurveyBody');
      if (!body) return;
      const nextAfter = nextEmptyBay('after');
      const nextBefore = nextEmptyBay('before');

      if (siViewReady() && afterCached().length && global.EodSetReview?.createReview) {
        body.innerHTML = `
          <section class="set-photo-block">
            <h2>Before</h2>
            ${bayProgressHtml('before')}
            <div class="set-thumbs set-thumbs-remote" data-cached-slot="before"></div>
            <div class="set-device-label muted">On this device</div>
            ${thumbHtml(local.before, 'before')}
            <div class="btn-row">
              <button type="button" class="btn btn-primary" data-cap="before">${
                nextBefore ? 'Take bay ' + nextBefore : 'Retake befores'
              }</button>
              <label class="btn btn-secondary set-file-btn">Load photos
                <input type="file" accept="image/*" multiple data-gal="before" hidden>
              </label>
            </div>
          </section>
          <section class="set-photo-block">
            <h2>After</h2>
            <div id="setReviewMount"></div>
          </section>`;
        bindCaptureControls(body);
        fillCachedThumbs(body.querySelector('[data-cached-slot="before"]'), beforeCached());
        global.EodSetReview.createReview({
          root: document.getElementById('setReviewMount'),
          row: { id: rowId, catName, dbkey, pog: dbkey },
          photos: afterCached(),
          photoSource: local.pack?.photoSource || 'si',
          api: API_ORIGIN,
          authFetch: global.authFetch,
          hideComplete: true,
          hideBack: true,
        });
        return;
      }

      body.innerHTML = `
        <section class="set-photo-block">
          <h2>Before ${preferSlot === 'before' ? '<span class="pill warn">focus</span>' : ''}</h2>
          ${bayProgressHtml('before')}
          ${remoteStackHtml('before')}
          <div class="set-device-label muted">On this device</div>
          ${thumbHtml(local.before, 'before')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="before">${
              nextBefore ? 'Take bay ' + nextBefore : 'Retake befores'
            }</button>
            <label class="btn btn-secondary set-file-btn">Load photos
              <input type="file" accept="image/*" multiple data-gal="before" hidden>
            </label>
          </div>
        </section>

        <section class="set-photo-block">
          <h2>After ${preferSlot === 'after' ? '<span class="pill warn">focus</span>' : ''}</h2>
          ${bayProgressHtml('after')}
          ${remoteStackHtml('after')}
          <div class="set-device-label muted">On this device</div>
          ${thumbHtml(local.after, 'after')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="after">${
              nextAfter ? 'Take bay ' + nextAfter + ' of ' + n : 'Retake afters'
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

      bindCaptureControls(body);
      document.getElementById('crossFillBtn').onclick = async () => {
        try {
          setMsg('Pulling photos across PROD / SI…');
          const r = await crossFill(dbkey, rowId);
          setMsg(
            'Cross-fill (' + (r.direction || '') + '): uploaded ' + (r.uploaded?.length || 0)
            + ', skipped ' + (r.skipped?.length || 0)
            + ', errors ' + (r.errors?.length || 0)
          );
          if (r.status) paintStatus(r.status);
          paintBody();
        } catch (err) {
          setMsg(err.message || String(err), true);
        }
      };
      document.getElementById('finishSetBtn').onclick = () => finishAll();
      fillCachedThumbs(body.querySelector('[data-cached-slot="before"]'), beforeCached());
      fillCachedThumbs(body.querySelector('[data-cached-slot="after"]'), afterCached());
    }

    function bindCaptureControls(body) {
      body.querySelectorAll('[data-cap]').forEach((btn) => {
        btn.onclick = () => startSequentialCapture(btn.getAttribute('data-cap'));
      });
      body.querySelectorAll('[data-gal]').forEach((input) => {
        input.onchange = async () => {
          const files = [...(input.files || [])].reverse();
          input.value = '';
          if (!files.length) return;
          await enqueueFiles(input.getAttribute('data-gal'), files);
        };
      });
      body.querySelectorAll('[data-clear-bay]').forEach((btn) => {
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          clearDevicePhoto(
            btn.getAttribute('data-clear-slot'),
            btn.getAttribute('data-clear-bay'),
            btn.getAttribute('data-clear-job')
          );
        };
      });
    }

    function startSequentialCapture(slot) {
      const n = expectedBayCount();
      openLiveCamera({
        getLabel: () => {
          const next = nextEmptyBay(slot);
          const have = takenBays(slot).size;
          if (next == null) {
            return `${slot === 'after' ? 'After' : 'Before'} ? ${have}/${n} ? Exit`;
          }
          return `${slot === 'after' ? 'After' : 'Before'} ? Bay ${next} of ${n} ? ${have}/${n}`;
        },
        shouldContinue: () => nextEmptyBay(slot) != null,
        onCapture: async (file) => {
          const bay = nextEmptyBay(slot) || 1;
          enqueueLocal(slot, file, bay);
        },
      });
    }

    function enqueueFiles(slot, files) {
      const bays = assignBaysForFiles(slot, files.length);
      for (let i = 0; i < files.length; i += 1) {
        enqueueLocal(slot, files[i], bays[i]);
      }
      setMsg(`${files.length} queued`);
    }

    function enqueueLocal(slot, file, bayOverride) {
      const bay = Number(bayOverride) || nextEmptyBay(slot) || 1;
      const pipe = global.EodPhotoPipeline;
      if (!pipe?.enqueue) {
        preparePhoto(file, 'set').then((preview) => {
          local[slot] = (local[slot] || []).filter((p) => Number(p.bay) !== bay);
          local[slot].push({
            bay,
            preview,
            photoBase64: preview,
            uploadStatus: 'queued',
            fileName: file.name,
          });
          paintBody();
        });
        return;
      }

      const job = pipe.enqueue({
        kind: 'set',
        compressType: 'set',
        slot,
        bay,
        dbkey,
        rowId,
        file,
        visitId: local.status?.prod?.visitId,
        resetId: local.status?.prod?.resetId,
        taskId: local.status?.si?.taskId,
        skipSi: slot === 'before',
      });

      local[slot] = (local[slot] || []).filter((p) => Number(p.bay) !== bay);
      local[slot].push({
        bay,
        preview: job.previewUrl,
        photoBase64: job.dataUrl || null,
        uploadStatus: pipe.statusLabel(job),
        jobId: job.id,
        fileName: file.name,
      });
      local[slot].sort((a, b) => Number(a.bay) - Number(b.bay));
      if (slot === 'before') persistBefores();
      paintBody();
    }

    async function finishAll() {
      try {
        const n = expectedBayCount();
        const afterHave = takenBays('after').size;
        if (afterHave < n) {
          const ok = confirm(`Only ${afterHave} of ${n} after photos on device. Finish anyway?`);
          if (!ok) return;
        }
        setMsg('Waiting for uploads, then closing SI (CV + survey if needed)…');
        if (global.EodPhotoPipeline?.waitForSet) {
          try {
            await global.EodPhotoPipeline.waitForSet(dbkey, { allowFailed: false, timeoutMs: 180000 });
          } catch (err) {
            setMsg(err.message || String(err), true);
            hydrateFromPipeline();
            paintBody();
            return;
          }
        }
        hydrateFromPipeline();
        const result = await completeSet(dbkey, rowId, {
          visitId: local.status?.prod?.visitId,
          resetId: local.status?.prod?.resetId,
          taskId: local.status?.si?.taskId,
        });
        setMsg(
          `Done — PROD ${result.prod?.status}, SI ${result.si?.status}, sheet ${result.sheet?.status}. ${result.sheet?.detail || result.si?.detail || ''}`
        );
        if (result.status) paintStatus(result.status);
        else {
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
        await fetchPack();
        paintBody();
        local.status = await fetchStatus(dbkey, rowId);
        paintStatus(local.status);
        hydrateFromPipeline();
        await fetchPack();
        paintBody();
        setMsg('');
      } catch (err) {
        document.getElementById('setSurveyBody').innerHTML =
          `<div class="notice notice-error">${esc(err.message || String(err))}</div>`;
      }
    }

    document.getElementById('refreshStatus').onclick = reload;
    const backBtn = document.getElementById('backSignoff');
    if (backBtn) {
      backBtn.onclick = () => {
        try { unsubPipe?.(); } catch (_) {}
        global.EodRouter.go('signoff');
      };
    }
    await reload();
  }
  global.EodSetSurvey = { render };
  global.EodRouter.register('survey', render);
})(typeof window !== 'undefined' ? window : globalThis);
