/* Set survey / dual PROD+SI photo closeout ? smart bay capture UX. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const DS_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';
  const API_ORIGIN = 'https://eod-api.the-dump-bin.com';
  const LIVE_ZOOM_MIN = 0.5;
  const LIVE_ZOOM_MAX = 4;
  const LIVE_ZOOM_STEP = 0.25;
  const THUMB_MAX_EDGE = 360;
  // Resolved at call time: a bundle load-order slip must not brick capture.
  const BayLogic = () => global.EodBayCountLogic;

  /* The live camera's toast lives inside openLiveCamera, but enqueueLocal runs
     in render()'s scope and needs to speak to a shooter whose screen is
     covered by the camera. Published here while a camera is open. */
  let activeCameraToast = null;

  /* toDataURL is synchronous and its cost tracks pixel count, so running it on
     a multi-megapixel capture blocks the shutter. Scale to thumbnail size
     first - roughly a hundredth of the pixels for the same picture on screen. */
  function thumbDataUrl(canvas) {
    if (!canvas) return null;
    try {
      const edge = Math.max(canvas.width, canvas.height);
      if (edge <= THUMB_MAX_EDGE) return canvas.toDataURL('image/jpeg', 0.5);
      const scale = THUMB_MAX_EDGE / edge;
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(canvas.width * scale));
      small.height = Math.max(1, Math.round(canvas.height * scale));
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
      return small.toDataURL('image/jpeg', 0.5);
    } catch (_) {
      return null;
    }
  }

  function photoBay(p, fallback = null) {
    const n = Number(p?.bay ?? p?.bayIndex);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function photoId(p) {
    return p?.id ?? p?.photoId ?? p?.imageId ?? p?.actionId ?? p?.sectionId ?? null;
  }

  function selectedFilesInOrder(files) {
    return [...(files || [])];
  }

  function isOwnedPhotoUrl(url) {
    const value = String(url || '').trim();
    if (/^(data:|blob:)/i.test(value) || value.startsWith('/api/')) return true;
    try {
      const parsed = new URL(value);
      return parsed.hostname === 'eod-api.the-dump-bin.com' && parsed.pathname.startsWith('/api/');
    } catch (_) {
      return false;
    }
  }

  function ownedRemotePhoto(p, { rowId, slot, source } = {}) {
    const resolvedSource = String(p?.source || source || (slot === 'before' ? 'prod' : 'si')).toLowerCase();
    const resolvedId = photoId(p);
    const suppliedUrl = String(p?.url || '').trim();
    const suppliedThumb = String(p?.thumbUrl || '').trim();
    let url = isOwnedPhotoUrl(suppliedUrl) ? suppliedUrl : '';
    let thumbUrl = isOwnedPhotoUrl(suppliedThumb) ? suppliedThumb : '';
    if ((!url || !thumbUrl) && rowId && resolvedId != null && /^(prod|si)$/.test(resolvedSource)) {
      const base = `${DS_API}/rows/${encodeURIComponent(rowId)}/photos/${resolvedSource}/${encodeURIComponent(resolvedId)}/image`;
      if (!url) url = base;
      if (!thumbUrl) thumbUrl = `${base}?thumb=1`;
    }
    return {
      slot: p?.slot || slot,
      source: resolvedSource,
      id: resolvedId,
      label: p?.label || `Bay ${photoBay(p, 1)}`,
      url,
      thumbUrl: thumbUrl || url,
      bayIndex: photoBay(p),
    };
  }

  function storedPhoto(p, { rowId, slot, fallbackName } = {}) {
    const dataUrl = p?.dataUrl || p?.photoBase64 || '';
    const remote = ownedRemotePhoto(p, { rowId, slot, source: p?.source });
    const hasLocal = /^(data:|blob:)/i.test(String(dataUrl || ''));
    const offloaded = !!(p?.offloaded || (isOwnedPhotoUrl(p?.url) && !hasLocal));
    const full = (!offloaded && dataUrl) || remote.url || p?.previewUrl || p?.preview || '';
    const suppliedPreview = [p?.thumbUrl, p?.previewUrl, p?.preview]
      .map((value) => String(value || '').trim())
      .find(isOwnedPhotoUrl) || '';
    const preview = suppliedPreview || (offloaded ? '' : dataUrl) || remote.thumbUrl || full;
    return {
      bay: photoBay(p, 1),
      preview,
      photoBase64: offloaded ? null : (/^(data:|blob:)/i.test(String(dataUrl || preview)) ? (dataUrl || preview) : null),
      url: full,
      thumbUrl: remote.thumbUrl || preview,
      source: p?.source || remote.source || 'device',
      id: photoId(p) || p?.board?.photoId || null,
      uploadStatus: p?.uploadStatus || (offloaded ? 'on board' : 'on device'),
      fileName: p?.fileName || fallbackName,
      jobId: p?.jobId || null,
      offloaded,
    };
  }

  function deviceStoreRecord(p, { workDate } = {}) {
    const dataUrl = /^(data:)/i.test(String(p?.photoBase64 || p?.dataUrl || ''))
      ? (p.photoBase64 || p.dataUrl)
      : '';
    const url = isOwnedPhotoUrl(p?.url) ? String(p.url).trim() : '';
    const thumbUrl = isOwnedPhotoUrl(p?.thumbUrl) ? String(p.thumbUrl).trim() : url;
    if (!dataUrl && !url) return null;
    return {
      bay: photoBay(p, 1),
      dataUrl: url ? undefined : (dataUrl || undefined),
      url: url || undefined,
      thumbUrl: thumbUrl || undefined,
      source: p?.source || undefined,
      id: photoId(p) || undefined,
      uploadStatus: p?.uploadStatus || undefined,
      jobId: p?.jobId || null,
      offloaded: !!(p?.offloaded || url),
      workDate: workDate || p?.workDate || undefined,
      capturedAt: Date.now(),
    };
  }

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
      st === 'completed' || st === 'complete' || st === 'ok' || st === 'ok_already_complete'
        ? 'ok'
        : st === 'open' || st === 'in progress' || st === 'incomplete'
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

  async function fetchStatus(dbkey, rowId, opts = {}) {
    if (!opts.fresh && !opts.skipCache) {
      const cached = global.EodStoreProdWarm?.peekStatus?.(dbkey);
      if (cached) return cached;
    }
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
    if (opts.resetId) qs.set('resetId', opts.resetId);
    if (opts.fresh) qs.set('fresh', '1');
    const resp = await global.authFetch(`${API}/status?${qs}`, { skipBusy: true });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Status failed (${resp.status})`);
    try { global.EodStoreProdWarm?.putStatus?.(dbkey, data.status); } catch (_) {}
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
    const resp = await global.authFetch(`${API}/cross-fill`, { method: 'POST', headers, body, skipBusy: true });
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
      skipProd: !!ids?.skipProd,
      skipSi: !!ids?.skipSi,
      markSheet: true,
    });
    const durable = global.EodFieldSetJobs;
    if (durable?.submit) {
      const key = durable.operationKey('complete', durable.hashText(body));
      return durable.submit('complete', {
        headers,
        body,
        idempotencyKey: key,
        timeoutMs: 8 * 60 * 1000,
      });
    }
    const resp = await global.authFetch(`${API}/complete`, { method: 'POST', headers, body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.result) throw new Error(data.error || `Complete failed (${resp.status})`);
    return data.result || data;
  }

  /**
   * Live camera stays open for sequential bay capture.
   * Auto-closes only after every bay is filled; otherwise Exit is manual.
   */
  function openLiveCamera({ getLabel, onCapture, shouldContinue, onLoadFiles, loadLabel, onStop }) {
    const overlay = document.createElement('div');
    overlay.className = 'vf-live-camera';
    overlay.innerHTML = `
      <div class="vf-live-camera-inner">
        <div class="vf-live-camera-hud" data-hud>Bay ?</div>
        <div class="vf-live-camera-toast" data-toast hidden></div>
        <p class="vf-live-camera-fallback" data-fallback hidden>Camera unavailable. Load photos from this device.</p>
        <video playsinline autoplay muted></video>
        <canvas hidden></canvas>
        <div class="vf-live-camera-bar">
          <label class="vf-zoom">Zoom <input type="range" min="${LIVE_ZOOM_MIN}" max="${LIVE_ZOOM_MAX}" step="${LIVE_ZOOM_STEP}" value="1"></label>
          <button type="button" class="btn btn-primary" data-act="shutter">Capture</button>
          <label class="btn btn-secondary set-file-btn">${esc(loadLabel || 'Load photos')}
            <input type="file" accept="image/*" multiple data-act="load" hidden>
          </label>
          <button type="button" class="btn btn-secondary" data-act="close">Exit</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    const canvas = overlay.querySelector('canvas');
    const zoomInput = overlay.querySelector('input[type="range"]');
    const hud = overlay.querySelector('[data-hud]');
    const toast = overlay.querySelector('[data-toast]');
    const shutterBtn = overlay.querySelector('[data-act="shutter"]');
    const loadInput = overlay.querySelector('[data-act="load"]');
    const fallback = overlay.querySelector('[data-fallback]');
    const zoomLabel = overlay.querySelector('.vf-zoom');
    let stream = null;
    let zoom = 1;
    let busy = false;

    // Wake-lock: prevents the screen from sleeping while the camera is open.
    // Released in stop(); re-acquired if the OS drops it (e.g. tab-switch back).
    let wakeLock = null;
    async function acquireWakeLock() {
      if (!navigator.wakeLock) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch (_) { /* wakeLock not granted — not fatal */ }
    }
    function releaseWakeLock() {
      try { wakeLock?.release(); } catch (_) {}
      wakeLock = null;
    }
    // Re-acquire after tab-switch returns (OS may have dropped the lock while hidden).
    const onVisibilityForWakeLock = () => {
      if (document.visibilityState === 'visible' && !wakeLock && stream) acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibilityForWakeLock);

    function refreshHud() {
      if (hud) hud.textContent = (typeof getLabel === 'function' ? getLabel() : null) || 'Capture';
    }

    let toastTimer = null;
    function flashToast(text) {
      if (!toast) return;
      toast.hidden = !text;
      toast.textContent = text || '';
      if (toastTimer) clearTimeout(toastTimer);
      if (!text) return;
      toastTimer = setTimeout(() => {
        toast.hidden = true;
        toast.textContent = '';
      }, 900);
    }
    activeCameraToast = flashToast;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      refreshHud();
      acquireWakeLock(); // best-effort, non-blocking
    }

    function stop() {
      if (toastTimer) clearTimeout(toastTimer);
      if (activeCameraToast === flashToast) activeCameraToast = null;
      document.removeEventListener('visibilitychange', onVisibilityForWakeLock);
      releaseWakeLock();
      try {
        stream?.getTracks?.().forEach((t) => t.stop());
      } catch (_) {}
      overlay.remove();
      if (typeof onStop === 'function') {
        try { onStop(); } catch (_) {}
      }
    }

    zoomInput.oninput = () => {
      zoom = Number(zoomInput.value) || 1;
    };

    function showCameraFallback(message) {
      try { stream?.getTracks?.().forEach((t) => t.stop()); } catch (_) {}
      stream = null;
      if (video) video.hidden = true;
      if (zoomLabel) zoomLabel.hidden = true;
      if (shutterBtn) shutterBtn.disabled = true;
      if (fallback) {
        fallback.hidden = false;
        fallback.textContent = message || 'Camera unavailable. Load photos from this device.';
      }
      if (hud) hud.textContent = 'Camera unavailable';
    }

    overlay.querySelector('[data-act="close"]').onclick = stop;
    if (loadInput) {
      loadInput.onchange = async () => {
        const files = [...(loadInput.files || [])];
        loadInput.value = '';
        if (!files.length) return;
        try {
          if (typeof onLoadFiles === 'function') await onLoadFiles(files);
        } catch (err) {
          flashToast(err?.message || 'Load failed');
          return;
        }
        stop();
      };
    }
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
        const snap = document.createElement('canvas');
        snap.width = zw;
        snap.height = zh;
        snap.getContext('2d').drawImage(canvas, 0, 0);
        let bitmap = null;
        try { bitmap = await createImageBitmap(snap); } catch (_) {}
        try {
          const nextHint = await onCapture({ canvas: snap, bitmap, fileName: `capture_${Date.now()}.jpg` });
          if (nextHint && nextHint.toast) flashToast(nextHint.toast);
        } catch (err) {
          flashToast(err?.message || 'Capture failed');
          refreshHud();
          return;
        }
        refreshHud();
        if (typeof shouldContinue === 'function' && !shouldContinue()) {
          stop();
        }
      } finally {
        busy = false;
        if (document.body.contains(overlay)) shutterBtn.disabled = false;
      }
    };

    start().catch((err) => {
      const denied = /denied|permission|notallowed/i.test(err?.name || '') || /denied|permission/i.test(err?.message || '');
      showCameraFallback(denied
        ? 'Camera permission denied. Load photos from this device.'
        : (err?.message || 'Camera unavailable. Load photos from this device.'));
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
    const autoCapture = qp.get('capture') === '1';

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
        <p class="muted">DBKEY ${esc(dbkey)} | Store ${esc(S.state.storeNumber)}</p>
        <div id="setStatusChips" class="muted">Loading PROD / SI…</div>
        <p class="set-survey-view-hint">Select one of the options below to view:</p>
        <div class="set-media-btns" id="setMediaBtns">
          <button type="button" class="btn btn-primary" data-open-media="planogram" disabled aria-busy="true">Planogram</button>
          <button type="button" class="btn btn-primary" data-open-media="before" disabled aria-busy="true">Before</button>
          <button type="button" class="btn btn-primary" data-open-media="after" disabled aria-busy="true">After</button>
        </div>
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
    let liveCameraOpen = false;
    let listCaptureStarted = false;

    const mediaReady = { planogram: false, before: false, after: false };

    function setMediaReady(kind, ready) {
      mediaReady[kind] = !!ready;
      const btn = document.querySelector(`#setMediaBtns [data-open-media="${kind}"]`);
      if (!btn) return;
      btn.disabled = !mediaReady[kind];
      btn.setAttribute('aria-busy', mediaReady[kind] ? 'false' : 'true');
    }

    function resetMediaReady() {
      setMediaReady('planogram', false);
      setMediaReady('before', false);
      setMediaReady('after', false);
    }

    const week = S.state.fiscalWeek || S.state.sheet?.fiscalWeek || '';
    function fromDeviceStore(list, fallbackName, slot) {
      return (list || []).map((p) => storedPhoto(p, { rowId, slot, fallbackName }));
    }
    if (week && global.EodSetBeforeStore) {
      local.before = fromDeviceStore(
        global.EodSetBeforeStore.getBefores(S.state.storeNumber, week, dbkey),
        'before.jpg',
        'before'
      );
      local.after = fromDeviceStore(
        global.EodSetBeforeStore.getAfters?.(S.state.storeNumber, week, dbkey),
        'after.jpg',
        'after'
      );
    }

    function hydrateFromPipeline() {
      const pipe = global.EodPhotoPipeline;
      if (!pipe) return;
      for (const slot of ['before', 'after']) {
        const byBay = new Map((local[slot] || []).map((p) => [Number(p.bay), p]));
        for (const job of pipe.jobsForSet(dbkey)) {
          if (job.slot !== slot || job.status === 'superseded' || job.error === 'replaced') continue;
          const live = liveCoveredBays(local.status, slot);
          if (job.status === 'done' && live.has(Number(job.bay))) continue;
          const bay = Number(job.bay);
          const prev = byBay.get(bay) || { bay };
          byBay.set(bay, {
            ...prev,
            bay,
            preview: job.previewUrl || job.board?.thumbUrl || job.dataUrl || prev.preview,
            photoBase64: job.offloaded ? null : (job.dataUrl || prev.photoBase64),
            url: job.board?.url || prev.url,
            thumbUrl: job.board?.thumbUrl || prev.thumbUrl,
            source: job.board?.source || prev.source,
            id: job.board?.photoId || prev.id,
            uploadStatus: pipe.statusLabel(job),
            jobId: job.id,
            fileName: prev.fileName || null,
            offloaded: !!job.offloaded,
          });
        }
        local[slot] = [...byBay.values()]
          .filter((p) => p.uploadStatus !== 'replaced')
          .sort((a, b) => Number(a.bay) - Number(b.bay));
      }
    }

    async function flushDevicePhotosToPipeline() {
      persistOpen();
      const Flush = global.EodDevicePhotoFlush;
      if (Flush?.flushSet) {
        return Flush.flushSet({
          dbkey,
          rowId,
          before: local.before,
          after: local.after,
          status: local.status,
          visitId: local.status?.prod?.visitId || S.state.selectedShift?.visitId || null,
          resetId: local.status?.prod?.resetId || null,
          taskId: local.status?.si?.taskId || null,
        });
      }
      const pipe = global.EodPhotoPipeline;
      if (!pipe?.enqueue) return 0;
      const existing = new Set(
        pipe.jobsForSet(dbkey)
          .filter((j) => j.status !== 'superseded' && j.error !== 'replaced')
          .map((j) => `${j.slot}:${Number(j.bay)}`)
      );
      let n = 0;
      for (const slot of ['before', 'after']) {
        const live = liveCoveredBays(local.status, slot);
        for (const p of local[slot] || []) {
          const bay = Number(p.bay);
          if (!bay || live.has(bay) || existing.has(`${slot}:${bay}`)) continue;
          const dataUrl = p.photoBase64 || p.preview;
          if (!dataUrl || !(String(dataUrl).startsWith('data:') || String(dataUrl).startsWith('blob:'))) continue;
          const payload = { dataUrl: String(dataUrl).startsWith('data:') ? dataUrl : null };
          if (!payload.dataUrl && String(dataUrl).startsWith('blob:')) {
            try {
              const resp = await fetch(dataUrl);
              payload.file = await resp.blob();
            } catch (_) { continue; }
          }
          if (!payload.dataUrl && !payload.file) continue;
          pipe.enqueue({
            kind: 'set',
            compressType: 'set',
            slot,
            bay,
            dbkey,
            rowId,
            // null, not a guess: the server auto-closes the set once
            // bay >= expectedBayCount, and resolves the real count itself.
            expectedBayCount: knownBayCount(),
            dataUrl: payload.dataUrl,
            file: payload.file || null,
            fileName: p.fileName || `${slot}.jpg`,
            visitId: local.status?.prod?.visitId,
            resetId: local.status?.prod?.resetId || null,
            taskId: local.status?.si?.taskId || null,
            skipSi: slot === 'before',
          });
          existing.add(`${slot}:${bay}`);
          n += 1;
        }
      }
      return n;
    }

    function liveCoveredBays(status, slot) {
      const remote = status?.remotePhotos || {};
      const fromPhotos = new Set();
      const add = (list) => {
        for (const p of Array.isArray(list) ? list : []) {
          const n = Number(p.bay);
          if (Number.isFinite(n) && n > 0) fromPhotos.add(n);
        }
      };
      if (String(slot) === 'before') add(remote.prodBefore);
      else {
        add(remote.prodAfter);
        add(remote.si);
      }
      if (fromPhotos.size) return fromPhotos;
      return new Set(
        (status?.bays || [])
          .filter((b) => {
            if (String(slot) === 'before') return !!b.hasProdBefore;
            return !!(b.hasSiPhoto || b.hasProdAfter || b.hasPhoto);
          })
          .map((b) => Number(b.bay))
          .filter((n) => Number.isFinite(n) && n > 0)
      );
    }

    function applyLiveProd(status) {
      local.liveProd = true;
      local.status = status;
    }

    hydrateFromPipeline();

    let autoClosePromise = null;

    async function maybeAutoCloseSi() {
      if (autoClosePromise) return autoClosePromise;
      /* Never close a set against a guessed count. Unknown means wait for
         /status; closing on a fallback of 1 completed eight-bay sets after
         a single after-photo. */
      const n = knownBayCount();
      if (!n) return null;
      const afterJobs = (global.EodPhotoPipeline?.jobsForSet?.(dbkey) || []).filter(
        (j) => j.slot === 'after' && j.status !== 'superseded' && j.error !== 'replaced'
      );
      const open = afterJobs.some((j) => !['done', 'failed'].includes(j.status));
      if (open) return null;
      const failed = afterJobs.filter((j) => j.status === 'failed');
      if (failed.length) return null;
      if (takenBays('after').size < n) return null;
      const st = local.status || {};
      const siHave = Number(st.si?.sectionsWithPhoto) || (st.remotePhotos?.si || []).length;
      if (siHave < n) return null;

      autoClosePromise = (async () => {
        try {
          setMsg('SI photos are in — closing the set…');
          const result = await completeSet(dbkey, rowId, {
            visitId: local.status?.prod?.visitId,
            resetId: local.status?.prod?.resetId,
            taskId: local.status?.si?.taskId,
            skipProd: true,
          });
          setMsg(
            `Closed — PROD ${result.prod?.status}, SI ${result.si?.status}, sheet ${result.sheet?.status}. ${result.sheet?.detail || result.si?.detail || ''}`
          );
          if (result.status) paintStatus(result.status);
          else {
            local.status = await fetchStatus(dbkey, rowId);
            paintStatus(local.status);
          }
          try {
            await global.EodSignoffHome?.loadSheet?.();
          } catch (_) {}
          global.EodSignoffHome?.showDoneTab?.();
        } catch (err) {
          autoClosePromise = null;
          setMsg(err.message || String(err), true);
        }
      })();
      return autoClosePromise;
    }

    // Subscribe to server buffer ack: when all bays for THIS set land safely in our DB,
    // show the "safe to continue" message and stop showing the patient message.
    const unsubSetSafe = global.EodSetPhotoReconcile?.onSetSafe?.(dbkey, () => {
      setMsg('Ok you\u2019re safe to continue to the next set.');
    });

    const unsubPipe = global.EodPhotoPipeline?.onChange?.((detail) => {
      if (detail?.job?.dbkey && String(detail.job.dbkey) !== String(dbkey)) return;
      hydrateFromPipeline();
      if (detail.job?.slot === 'before') persistBefores();
      if (detail.job?.slot === 'after') persistAfters();
      const counts = global.EodPhotoPipeline.pendingCounts();
      const open = counts.compress + counts.upload;
      if (open > 0 || detail.type === 'partial') {
        const L = global.EodPhotoPipelineLogic;
        setMsg(L?.queueProgressCopy
          ? L.queueProgressCopy(counts)
          : (L?.QUEUE_COPY || 'Please be patient, there is a lot going on behind the scenes.'));
      } else if (detail.type === 'done') {
        setMsg(`Bay ${detail.job?.bay} done`);
        if (!liveCameraOpen) {
          void refreshRemoteAndPaint().then(() => {
            if (detail.job?.slot === 'after') maybeAutoCloseSi();
          });
        } else if (detail.job?.slot === 'after') {
          maybeAutoCloseSi();
        }
        return;
      } else if (detail.type === 'failed' && detail.job?.status !== 'superseded' && detail.job?.error !== 'replaced') {
        setMsg(detail.job?.error || 'Upload failed', true);
      }
      if (!liveCameraOpen) paintBody();
    });

    function setMsg(text, isErr) {
      const el = document.getElementById('setSurveyMsg');
      if (!el) return;
      el.style.color = isErr ? 'var(--danger)' : '';
      el.textContent = text || '';
    }

    /* Authoritative bay count, or null when it has not resolved yet.

       This used to fall back to 1, which is a lie the rest of the app acted
       on: sequential capture stopped after one shot, loading eight photos
       enqueued one and dropped seven, and the server auto-closes a set when
       bay >= expectedBayCount, so a single after-photo closed the whole set.
       Unknown has to stay unknown. Bay count comes from SI sections; PROD
       footage is linear feet and is resolved server-side, never here. */
    function knownBayCount() {
      return BayLogic().knownBayCount(local.status);
    }

    /* Grid and HUD need some number to draw. Never used for a decision. */
    function displayBayCount() {
      return BayLogic().displayBayCount(local.status, [
        ...(local.before || []),
        ...(local.after || []),
      ]);
    }

    function bayList() {
      const n = displayBayCount();
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

    function uploadInFlight(statusText) {
      const st = String(statusText || '').toLowerCase();
      return /queue|compress|ready|waiting|checking|uploading/.test(st);
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
      for (const n of liveCoveredBays(local.status, slot)) set.add(n);
      if (!local.liveProd) {
        const cached = String(slot) === 'before' ? beforeCached() : afterCached();
        for (const p of cached) {
          const n = Number(p.bayIndex);
          if (Number.isFinite(n) && n > 0) set.add(n);
        }
      } else if (String(slot) === 'after') {
        for (const p of afterCached()) {
          if (p.source === 'prod') continue;
          const n = Number(p.bayIndex);
          if (Number.isFinite(n) && n > 0) set.add(n);
        }
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

    /** Loaded files replace PROD in bay order, 1 … N. */
    function assignBaysForReplace(fileCount) {
      return BayLogic().planReplaceBays({ known: knownBayCount(), fileCount });
    }

    /** First file ? first empty bay (or bay 1); last of a full batch ? last bay. */
    function assignBaysForFiles(slot, fileCount) {
      return BayLogic().planFileBays({
        known: knownBayCount(),
        taken: takenBays(slot),
        fileCount,
      });
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
        const resp = await global.authFetch(`${DS_API}/rows/${encodeURIComponent(rowId)}/photos`, { skipBusy: true });
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
      await Promise.all([...host.querySelectorAll('.set-thumb')].map(async (el) => {
        const p = photos[Number(el.dataset.i)];
        const path = p?.thumbUrl || p?.url || '';
        if (!path) return;
        const abs = /^https?:/i.test(path) ? path : API_ORIGIN + path;
        try {
          const resp = await global.authFetch(abs, { skipBusy: true });
          if (!resp.ok) return;
          const blob = await resp.blob();
          const img = el.querySelector('img');
          if (img) img.src = URL.createObjectURL(blob);
        } catch (_) {}
      }));
    }

    function persistSlot(slot) {
      if (!(week && global.EodSetBeforeStore)) return;
      try {
        const incoming = (local[slot] || [])
          .map((p) => deviceStoreRecord(p, { workDate: S.state.workDate }))
          .filter(Boolean);
        const keepBays = new Set((local[slot] || []).map((p) => Number(p.bay)));
        const prev = (slot === 'before'
          ? global.EodSetBeforeStore.getBefores(S.state.storeNumber, week, dbkey)
          : global.EodSetBeforeStore.getAfters?.(S.state.storeNumber, week, dbkey)) || [];
        const byBay = new Map();
        for (const p of prev) {
          if (keepBays.has(Number(p.bay))) byBay.set(Number(p.bay), p);
        }
        for (const p of incoming) byBay.set(Number(p.bay), p);
        const photos = [...byBay.values()];
        if (slot === 'before') global.EodSetBeforeStore.setBefores(S.state.storeNumber, week, dbkey, photos);
        else global.EodSetBeforeStore.setAfters?.(S.state.storeNumber, week, dbkey, photos);
      } catch (err) {
        /* Losing this write breaks the multi-day carry-forward, and the crew
           would not find out until they returned for the revisit. */
        global.EodDiag?.note?.('set-store.persist', err);
        setMsg('Device storage is full — these photos will not carry to a later visit.', true);
      }
    }

    function persistBefores() {
      persistSlot('before');
    }

    function persistAfters() {
      persistSlot('after');
    }

    function persistOpen() {
      persistBefores();
      persistAfters();
    }
    global.EodDevicePhotoFlush?.setOpenPersister?.(persistOpen);

    function paintStatus(status) {
      if (status) local.status = status;
      const chips = document.getElementById('setStatusChips');
      if (!chips || !local.status) return;
      const Status = global.EodCategoryCardStatus;
      const beforeRemote = Number(local.status.prod?.beforeCount) || 0;
      const after = Number(local.status.prod?.afterCount) || 0;
      const extraBefore = (local.before || []).filter((p) => {
        const st = String(p.uploadStatus || '');
        return st !== 'failed' && st !== 'replaced';
      }).length;
      const before = Math.max(beforeRemote, extraBefore);
      const prodKind = Status?.prodKindFromCounts
        ? Status.prodKindFromCounts(before, after)
        : (before > 0 && after > 0 ? 'complete' : (before || after ? 'in_progress' : 'not_started'));
      const siHave = Number(local.status.si?.sectionsWithPhoto) || 0;
      const siNeed = Number(local.status.si?.sectionCount) || 0;
      const siLabel = siNeed > 0 && siHave >= siNeed
        ? 'complete'
        : (siNeed || siHave || local.status.si ? 'incomplete' : 'unknown');
      if (local.status.prod) local.status.prod.status = prodKind === 'complete' ? 'complete' : prodKind === 'in_progress' ? 'in progress' : 'not started';
      if (local.status.si) local.status.si.status = siLabel;
      if (Status?.liveStatusLineFromCounts) {
        chips.innerHTML = Status.liveStatusLineFromCounts({
          prodKind,
          before,
          after,
          siLabel,
          siHave,
          siNeed,
        }, esc);
        return;
      }
      chips.innerHTML =
        `PROD ${sidePill(local.status.prod)}` +
        ` <span class="muted">before ${before} / after ${after}</span>` +
        ` | SI ${sidePill(local.status.si)}` +
        ` <span class="muted">${siHave}/${siNeed} sections</span>`;
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
                const cls = `set-bay-dot${filled ? ' filled is-viewable' : ''}${si && !filled ? ' si' : ''}`;
                return `<button type="button" class="${cls}" data-view-slot="${slot}" data-view-bay="${esc(b.bay)}" ${filled ? '' : 'disabled'} title="${filled ? 'View bay ' : 'No photo for bay '}${esc(b.bayName || b.bay)}">${esc(b.bay)}</button>`;
              })
              .join('')}
          </div>
        </div>`;
    }

    function deviceAsPhotos(list, slot) {
      return (list || []).map((p) => {
        const mapped = ownedRemotePhoto(p, { rowId, slot, source: p.source });
        return {
          slot,
          source: 'device',
          id: p.id || `device-${slot}-${p.bay}`,
          label: `Bay ${p.bay}`,
          url: p.photoBase64 || mapped.url || p.url || p.preview || '',
          thumbUrl: mapped.thumbUrl || p.thumbUrl || p.preview || '',
          bayIndex: Number(p.bay) || null,
        };
      }).filter((p) => p.url);
    }

    function remoteAsPhotos(slot) {
      const remote = local.status?.remotePhotos || {};
      const list = String(slot) === 'before'
        ? (remote.prodBefore || [])
        : [...(remote.si || []), ...(remote.prodAfter || [])];
      const seen = new Set();
      const out = [];
      for (const p of list) {
        const mapped = ownedRemotePhoto(p, { rowId, slot, source: p?.source });
        const bay = Number(mapped.bayIndex);
        if (!mapped.url || !Number.isFinite(bay) || bay < 1) continue;
        if (seen.has(bay)) continue;
        seen.add(bay);
        out.push(mapped);
      }
      return out;
    }

    function viewerPhotos(slot) {
      const live = remoteAsPhotos(slot);
      const pack = slot === 'before' ? beforeCached() : afterCached();
      const device = deviceAsPhotos(local[slot], slot);
      const localDevice = device.filter((p) => /^(data:|blob:)/i.test(String(p.url || '')));
      const remoteDevice = device.filter((p) => !/^(data:|blob:)/i.test(String(p.url || '')));
      const seen = new Set();
      const out = [];
      for (const p of [...localDevice, ...pack, ...live, ...remoteDevice]) {
        const bay = Number(p.bayIndex);
        const key = Number.isFinite(bay) && bay > 0 ? `bay-${bay}` : `${p.source}|${p.id}`;
        if (seen.has(key) || !p.url) continue;
        seen.add(key);
        out.push(p);
      }
      return out;
    }

    let remoteSyncing = false;
    async function refreshRemoteAndPaint() {
      if (remoteSyncing) return;
      remoteSyncing = true;
      try {
        try {
          const st = await fetchStatus(dbkey, rowId, { fresh: true });
          applyLiveProd(st);
          paintStatus(st);
          const siHave = Number(st?.si?.sectionsWithPhoto) || 0;
          const prodAfter = Number(st?.prod?.afterCount) || 0;
          if (siHave !== prodAfter && (siHave > 0 || prodAfter > 0)) {
            void crossFill(dbkey, rowId).then((r) => {
              if (!r?.status) return;
              applyLiveProd(r.status);
              paintStatus(r.status);
              if (!liveCameraOpen) paintBody();
            }).catch(() => {});
          }
        } catch (_) { /* keep current board */ }
        try { await fetchPack(); } catch (_) {}
        if (!liveCameraOpen) paintBody();
      } finally {
        remoteSyncing = false;
      }
    }

    function openMedia(kind, startBay) {
      const S = global.EodSession;
      if (!mediaReady[kind]) return;
      if (kind === 'planogram') {
        if (typeof global.EodSiPlanogram?.openOverlay !== 'function') {
          setMsg('Planogram viewer failed to load.', true);
          return;
        }
        global.EodSiPlanogram.openOverlay({
          store: S.state.storeNumber,
          date: S.state.workDate,
          dbkey,
          title: catName ? `${catName} · Planogram` : 'Planogram',
        });
        return;
      }
      if (kind !== 'before' && kind !== 'after') return;
      const photos = viewerPhotos(kind);
      const bayNum = Number(startBay);
      if (Number.isFinite(bayNum) && bayNum > 0) {
        const hasBay = photos.some((p) => Number(p.bayIndex) === bayNum);
        if (!hasBay && !photos.length) {
          setMsg(`No ${kind} photo for bay ${bayNum} yet.`);
          return;
        }
      } else if (!photos.length) {
        setMsg(`No ${kind} photos to view yet.`);
        return;
      }
      global.EodSetReview?.openOverlay?.({
        row: { id: rowId, catName, dbkey, pog: dbkey },
        photos,
        photoSource: kind === 'after' ? (local.pack?.photoSource || '') : 'prod',
        slotFilter: kind,
        heading: `${catName || 'Set'} · ${kind === 'before' ? 'Before' : 'After'}`,
        api: API_ORIGIN,
        authFetch: global.authFetch,
        hideComplete: true,
        startBay: Number.isFinite(bayNum) && bayNum > 0 ? bayNum : undefined,
      });
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
              <span>Bay ${esc(p.bay)} | ${esc(p.uploadStatus || 'on device')}</span>
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
      else persistAfters();
      setMsg('Removed device bay ' + bayNum);
      paintBody();
    }

    function paintBody() {
      persistOpen();
      if (liveCameraOpen) return;
      const n = displayBayCount();
      const body = document.getElementById('setSurveyBody');
      if (!body) return;
      const nextAfter = nextEmptyBay('after');
      const nextBefore = nextEmptyBay('before');

      body.innerHTML = `
        <section class="set-photo-block">
          <h2>Before ${preferSlot === 'before' ? '<span class="pill warn">focus</span>' : ''}</h2>
          ${bayProgressHtml('before')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="before">${
              nextBefore ? 'Take bay ' + nextBefore : 'Retake befores'
            }</button>
            <label class="btn btn-secondary set-file-btn">${nextBefore ? 'Load photos' : 'Load to replace'}
              <input type="file" accept="image/*" multiple data-gal="before" data-replace="${nextBefore ? '0' : '1'}" hidden>
            </label>
          </div>
        </section>

        <section class="set-photo-block">
          <h2>After ${preferSlot === 'after' ? '<span class="pill warn">focus</span>' : ''}</h2>
          ${bayProgressHtml('after')}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cap="after">${
              nextAfter ? 'Take bay ' + nextAfter + ' of ' + n : 'Retake afters'
            }</button>
            <label class="btn btn-secondary set-file-btn">${nextAfter ? 'Load photos' : 'Load to replace'}
              <input type="file" accept="image/*" multiple data-gal="after" data-replace="${nextAfter ? '0' : '1'}" hidden>
            </label>
          </div>
        </section>

        <div class="btn-row" style="margin-top:16px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" id="crossFillBtn">Pull from other system</button>
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
    }

    function bindCaptureControls(body) {
      body.querySelectorAll('[data-cap]').forEach((btn) => {
        btn.onclick = () => startSequentialCapture(btn.getAttribute('data-cap'));
      });
      body.querySelectorAll('[data-gal]').forEach((input) => {
        input.onchange = async () => {
          const files = selectedFilesInOrder(input.files);
          const slot = input.getAttribute('data-gal');
          const replace = input.getAttribute('data-replace') === '1' || nextEmptyBay(slot) == null;
          input.value = '';
          if (!files.length) return;
          await enqueueFiles(slot, files, { replace });
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
      body.querySelectorAll('[data-view-bay]').forEach((btn) => {
        btn.onclick = () => {
          if (btn.disabled) return;
          openMedia(btn.getAttribute('data-view-slot'), Number(btn.getAttribute('data-view-bay')));
        };
      });
    }

    function startSequentialCapture(slot, opts) {
      const fromOne = !!(opts && opts.fromOne);
      const returnTo = opts && opts.returnTo;
      const n = () => knownBayCount();
      const replacing = !fromOne && nextEmptyBay(slot) == null;
      const batchId = replacing ? (`r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) : null;
      let wiped = false;
      let sessionBay = 0;
      liveCameraOpen = true;
      openLiveCamera({
        loadLabel: replacing ? 'Load to replace' : 'Load photos',
        getLabel: () => {
          const total = n();
          const label = slot === 'after' ? 'After' : 'Before';
          if (fromOne) {
            const next = sessionBay + 1;
            // Without a resolved count, show the bay being shot and no total
            // rather than inventing one.
            if (!total) return `${label} · Bay ${next}`;
            if (next > total) return `${label} · ${total}/${total}`;
            return `${label} · Bay ${next} of ${total}`;
          }
          const next = nextEmptyBay(slot);
          const have = takenBays(slot).size;
          if (!total) return next == null ? `${label} · ${have}` : `${label} · Bay ${next}`;
          if (next == null) return `${label} · ${have}/${total}`;
          return `${label} · Bay ${next} of ${total} · ${have}/${total}`;
        },
        /* Unknown count keeps the camera open until the lead taps Exit. The
           old fallback of 1 closed it after the first shot. */
        shouldContinue: () => {
          const total = n();
          if (fromOne) return !total || sessionBay < total;
          return !total || nextEmptyBay(slot) != null;
        },
        onCapture: async (shot) => {
          const total = n();
          let bay;
          if (fromOne) {
            sessionBay += 1;
            bay = sessionBay;
          } else {
            bay = nextEmptyBay(slot) || (replacing ? (wiped ? takenBays(slot).size + 1 : 1) : 1);
          }
          const enqueueOpts = replacing
            ? { replace: true, replaceWipe: !wiped, replaceBatchId: batchId, background: true, skipPaint: true }
            : { background: true, skipPaint: true };
          if (replacing) wiped = true;
          await enqueueLocal(slot, shot, bay, enqueueOpts);
          const next = fromOne ? sessionBay + 1 : nextEmptyBay(slot);
          if (next != null && (!total || next <= total)) return { toast: `Moving to bay ${next}` };
          return null;
        },
        onLoadFiles: (files) => enqueueFiles(slot, selectedFilesInOrder(files), { replace: replacing || fromOne }),
        onStop: () => {
          liveCameraOpen = false;
          if (returnTo === 'signoff') {
            try { unsubPipe?.(); } catch (_) {}
            try { unsubSetSafe?.(); } catch (_) {}
            global.EodRouter.go('signoff');
            return;
          }
          paintBody();
        },
      });
    }

    async function enqueueFiles(slot, files, opts) {
      const replacing = !!(opts && opts.replace) || nextEmptyBay(slot) == null;
      const bays = replacing
        ? assignBaysForReplace(files.length)
        : assignBaysForFiles(slot, files.length);
      const used = Math.min(files.length, bays.length);
      const batchId = replacing ? (`r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) : null;
      for (let i = 0; i < used; i += 1) {
        await enqueueLocal(slot, files[i], bays[i], {
          replace: replacing,
          replaceWipe: replacing && i === 0,
          replaceBatchId: batchId,
        });
      }
      setMsg(replacing
        ? `${used} on device — replacing PROD`
        : `${used} on device`);
    }

    async function enqueueLocal(slot, fileOrShot, bayOverride, opts) {
      const gateFn = global.EodSasUser?.requireConnectedFast
        || global.EodSasUser?.requireConnected;
      if (gateFn) {
        const gate = await gateFn.call(global.EodSasUser, { slot });
        if (!gate.ok) {
          // The card message sits under the live camera, so say it where the
          // shooter is actually looking.
          if (liveCameraOpen) activeCameraToast?.(gate.message);
          setMsg(gate.message);
          return;
        }
      }
      try { global.EodStoreProdWarm?.dropStatus?.(dbkey); } catch (_) {}
      const shot = fileOrShot && (fileOrShot.canvas || fileOrShot.bitmap) ? fileOrShot : null;
      const file = shot ? null : fileOrShot;
      const replacingBay = !!(opts && opts.replace);
      const refuse = (text) => {
        if (liveCameraOpen) activeCameraToast?.(text);
        setMsg(text, true);
      };

      const bay = Number(bayOverride) || nextEmptyBay(slot) || 0;
      const cap = knownBayCount();
      /* A full set used to fall through to bay 1 and overwrite it, and a
         direct capture could push past the set's real bay count. */
      const reason = BayLogic().refuseBayReason({ known: cap, bay, replacing: replacingBay });
      if (reason === 'full') {
        refuse(`Every bay already has a ${slot} photo. Use Replace to redo one.`);
        return;
      }
      if (reason === 'over') {
        refuse(`This set has ${cap} bay${cap === 1 ? '' : 's'} — bay ${bay} was not added.`);
        return;
      }
      const pipe = global.EodPhotoPipeline;
      if (!pipe?.enqueue) {
        preparePhoto(file || shot?.bitmap || shot?.canvas, 'set').then((preview) => {
          local[slot] = (local[slot] || []).filter((p) => Number(p.bay) !== bay);
          local[slot].push({
            bay,
            preview,
            photoBase64: preview,
            uploadStatus: 'on device',
            fileName: file?.name || shot?.fileName || 'capture.jpg',
          });
          if (slot === 'before') persistBefores();
          else persistAfters();
          paintBody();
        });
        return;
      }

      // Encoding the full-resolution capture just to draw a thumbnail held the
      // shutter disabled for hundreds of milliseconds. Downscale first: the
      // thumb is a few hundred pixels wide on screen either way.
      const previewUrl = shot?.canvas ? thumbDataUrl(shot.canvas) : null;
      const replacing = !!(opts && opts.replace);
      const payload = {
        kind: 'set',
        compressType: 'set',
        slot,
        bay,
        dbkey,
        rowId,
        // null, not a guess: the server auto-closes the set once
        // bay >= expectedBayCount, and resolves the real count itself.
        expectedBayCount: knownBayCount(),
        file,
        bitmap: shot?.bitmap || null,
        canvas: shot?.canvas || null,
        previewUrl,
        fileName: file?.name || shot?.fileName || null,
        visitId: local.status?.prod?.visitId,
        resetId: local.status?.prod?.resetId,
        taskId: local.status?.si?.taskId,
        skipSi: slot === 'before',
        replace: replacing,
        replaceWipe: !!(opts && opts.replaceWipe),
        replaceBatchId: opts?.replaceBatchId || null,
      };
      // Always await the IDB write before returning, regardless of background/camera mode.
      // This closes the capture-to-persist race: bytes must be on disk before the shutter
      // re-enables for the next shot. A device sleep or page reload after this point is safe.
      const job = pipe.enqueue(payload);
      try { await job.ready; } catch (_) {}

      local[slot] = (local[slot] || []).filter((p) => Number(p.bay) !== bay);
      local[slot].push({
        bay,
        preview: job.previewUrl,
        photoBase64: job.dataUrl || null,
        uploadStatus: pipe.statusLabel(job),
        jobId: job.id,
        fileName: file?.name || shot?.fileName || 'capture.jpg',
      });
      local[slot].sort((a, b) => Number(a.bay) - Number(b.bay));
      if (slot === 'before') persistBefores();
      else persistAfters();
      if (!(opts && opts.skipPaint) && !liveCameraOpen) paintBody();
    }

    function loadPlanogram() {
      const opts = {
        store: S.state.storeNumber,
        date: S.state.workDate,
        dbkey,
      };
      const fetchBoard = global.EodSiPlanogram?.fetchBoard;
      if (typeof fetchBoard !== 'function') {
        setMediaReady('planogram', true);
        return Promise.resolve();
      }
      return fetchBoard(opts)
        .catch(() => null)
        .then(() => {
          setMediaReady('planogram', true);
          if (typeof global.EodSiPlanogram?.prefetch === 'function') {
            void global.EodSiPlanogram.prefetch(opts).catch(() => {});
          }
        });
    }

    function seedFromSheetRow() {
      const rows = S.state.sheet?.rows || [];
      const row = rows.find((r) => String(r.id) === String(rowId) || String(r.dbkey) === String(dbkey));
      if (!row) return;
      const live = row.live || {};
      const beforeCount = Number(live.prodBeforeCount) || 0;
      const afterCount = Number(live.prodAfterCount) || 0;
      const prodKind = global.EodCategoryCardStatus?.prodKindFromCounts
        ? global.EodCategoryCardStatus.prodKindFromCounts(beforeCount, afterCount)
        : (beforeCount > 0 && afterCount > 0 ? 'complete' : (beforeCount || afterCount ? 'in_progress' : 'not_started'));
      const siHave = Number(live.siPhotoCount || live.photoCount) || 0;
      const siNeed = Number(live.sectionCount) || 0;
      const seeded = {
        expectedBayCount: Number(live.sectionCount || live.bayCount || row.bayCount || 0) || null,
        prod: {
          status: prodKind === 'complete' ? 'complete' : prodKind === 'in_progress' ? 'in progress' : 'not started',
          beforeCount,
          afterCount,
        },
        si: {
          status: siNeed > 0 && siHave >= siNeed ? 'complete' : (live.siPresent || siNeed || siHave ? 'incomplete' : 'unknown'),
          sectionCount: siNeed,
          sectionsWithPhoto: siHave,
        },
        bays: [],
      };
      local.status = seeded;
      paintStatus(seeded);
    }

    async function reload(opts = {}) {
      setMediaReady('before', true);
      setMediaReady('after', true);
      try {
        const resetId = local.status?.prod?.resetId || null;
        const st = await fetchStatus(dbkey, rowId, { fresh: !!opts.fresh, resetId });
        applyLiveProd(st);
        paintStatus(st);
        await Promise.allSettled([
          loadPlanogram(),
          fetchPack().then(() => {
            applyLiveProd(local.status || st);
          }),
        ]);
        hydrateFromPipeline();
        persistOpen();
        const flushed = await flushDevicePhotosToPipeline();
        if (flushed) hydrateFromPipeline();
        setMediaReady('before', true);
        setMediaReady('after', true);
        paintBody();
        setMsg('');
        const siHave = Number((local.status || st)?.si?.sectionsWithPhoto) || 0;
        const prodAfter = Number((local.status || st)?.prod?.afterCount) || 0;
        if (siHave !== prodAfter && (siHave > 0 || prodAfter > 0)) {
          void refreshRemoteAndPaint();
        }
      } catch (err) {
        setMsg(err.message || String(err), true);
        setMediaReady('before', true);
        setMediaReady('after', true);
        paintBody();
      }
    }

    document.getElementById('refreshStatus').onclick = () => reload({ fresh: true });
    document.getElementById('setMediaBtns')?.addEventListener('click', (ev) => {
      const btn = ev.target?.closest?.('[data-open-media]');
      if (!btn || btn.disabled) return;
      openMedia(btn.getAttribute('data-open-media'));
    });
    const backBtn = document.getElementById('backSignoff');
    if (backBtn) {
      backBtn.onclick = () => {
        try { unsubPipe?.(); } catch (_) {}
        try { unsubSetSafe?.(); } catch (_) {}
        global.EodRouter.go('signoff');
      };
    }
    seedFromSheetRow();
    setMediaReady('before', true);
    setMediaReady('after', true);
    hydrateFromPipeline();
    persistOpen();
    paintBody();
    if (autoCapture && !listCaptureStarted) {
      listCaptureStarted = true;
      startSequentialCapture(preferSlot, { fromOne: true, returnTo: 'signoff' });
    }
    void flushDevicePhotosToPipeline().then((n) => {
      if (n) {
        hydrateFromPipeline();
        if (!liveCameraOpen) paintBody();
      }
    });
    void reload({ fresh: false });
  }
  global.EodSetSurveyPhotoRefs = {
    photoBay,
    photoId,
    isOwnedPhotoUrl,
    ownedRemotePhoto,
    storedPhoto,
    deviceStoreRecord,
    selectedFilesInOrder,
  };
  global.EodSetSurvey = { render, persistOpen: () => global.EodDevicePhotoFlush?.persistOpen?.() };
  global.EodRouter.register('survey', render);
})(typeof window !== 'undefined' ? window : globalThis);
