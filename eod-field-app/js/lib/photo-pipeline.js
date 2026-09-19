/* Background photo pipeline — durable resume; skip bays already on PROD/SI. */
(function (global) {
  'use strict';

  const META_KEY = 'eodPhotoPipeline:v2';
  const LEGACY_IDB_NAME = 'eodPhotoPipeline';
  const IDB_NAME = 'eodFieldPhotoOutbox';
  const IDB_STORE = 'jobs';
  const IDB_VERSION = 1;
  const MAX_COMPRESS = 1;
  const MAX_UPLOAD = 1;
  const MAX_SET_ATTEMPTS = 10;
  const Logic = global.EodPhotoPipelineLogic || {};
  const OK_SIDES = new Set([
    'ok',
    'ok_already_complete',
    'skipped',
    'already_present',
    'not_found', // SI missing task is not a hard fail for cart; for set treat carefully below
  ]);
  const listeners = new Set();

  /** @type {Map<string, object>} */
  const jobs = new Map();
  let compressActive = 0;
  let uploadActive = 0;
  let pumpTimer = null;
  let started = false;
  let idb = null;
  let reconcileBusy = false;
  const statusCache = new Map(); // key -> { at, status }

  function isSuperseded(job) {
    return Logic.isSuperseded
      ? Logic.isSuperseded(job)
      : !!(job && (job.status === 'superseded' || (job.status === 'failed' && job.error === 'replaced')));
  }

  function emit(type, job) {
    const detail = { type, job: job ? publicJob(job) : null, pending: pendingCounts() };
    if (type === 'failed' && job && !isSuperseded(job)) {
      global.EodUsage?.track?.('upload_failure', {
        kind: job.kind || 'photo',
        slot: job.slot || '',
        status: 'failed',
      });
    }
    trackTransition(type, job);
    listeners.forEach((fn) => {
      try { fn(detail); } catch (_) {}
    });
    updateStorageBadge(detail.pending);
    try {
      global.dispatchEvent(new CustomEvent('eod-photo-pipeline', { detail }));
    } catch (_) {}
  }

  // --- "N on device" badge -------------------------------------------------
  // Small, muted, non-blocking indicator of protectedOnDevice (jobs still
  // holding local bytes — safe, just not yet confirmed+offloaded). Reassuring,
  // not alarming: hidden at 0, muted style normally, only shifts to an
  // attention style when there are failed jobs needing a retry tap. No modal,
  // no interruption to capture.
  let storageBadgeEl = null;
  function ensureStorageBadge() {
    if (storageBadgeEl || typeof document === 'undefined') return storageBadgeEl;
    const el = document.createElement('div');
    el.id = 'eod-photo-storage-badge';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;right:10px;bottom:max(10px,env(safe-area-inset-bottom,0px));'
      + 'z-index:39000;display:none;align-items:center;gap:6px;font-size:12px;line-height:1;'
      + 'padding:6px 10px;border-radius:999px;background:rgba(30,41,59,.9);color:#cbd5e1;'
      + 'border:1px solid rgba(148,163,184,.35);pointer-events:none;transition:opacity .2s ease;';
    document.body.appendChild(el);
    storageBadgeEl = el;
    return el;
  }

  function updateStorageBadge(pending) {
    try {
      if (typeof document === 'undefined') return;
      const n = Number(pending?.protectedOnDevice) || 0;
      const failed = Number(pending?.failed) || 0;
      const el = ensureStorageBadge();
      if (!el) return;
      if (n <= 0 && failed <= 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      if (failed > 0) {
        el.style.background = 'rgba(127,29,29,.92)';
        el.style.color = '#fecaca';
        el.style.borderColor = 'rgba(248,113,113,.5)';
        el.textContent = `${failed} photo${failed === 1 ? '' : 's'} need retry`;
      } else {
        el.style.background = 'rgba(30,41,59,.9)';
        el.style.color = '#cbd5e1';
        el.style.borderColor = 'rgba(148,163,184,.35)';
        el.textContent = `${n} on device`;
      }
    } catch (_) { /* best-effort UI only */ }
  }

  function publicJob(job) {
    return {
      id: job.id,
      kind: job.kind,
      slot: job.slot,
      bay: job.bay,
      dbkey: job.dbkey,
      rowId: job.rowId,
      status: job.status,
      previewUrl: job.previewUrl || job.dataUrl || null,
      dataUrl: job.dataUrl || null,
      error: job.error || null,
      prodStatus: job.prodStatus || null,
      siStatus: job.siStatus || null,
      skipProd: !!job.skipProd,
      skipSi: !!job.skipSi,
      bytes: job.bytes || null,
      checksum: job.checksum || null,
      serverJobId: job.serverJobId || null,
      statusUrl: job.statusUrl || null,
      board: job.board || null,
      offloaded: !!job.offloaded,
      storeNumber: job.storeNumber || null,
      workDate: job.workDate || null,
      hasPayload: !!job.hasPayload,
      updatedAt: job.updatedAt,
    };
  }

  function dropLocalPreview(job) {
    if (job?.previewUrl && String(job.previewUrl).startsWith('blob:')) {
      try { URL.revokeObjectURL(job.previewUrl); } catch (_) {}
    }
  }

  /**
   * Single choke point for "is it safe to delete this photo's local bytes yet".
   * A job is only fully confirmed once PROD (and SI, when applicable — SI does
   * not apply to 'before' slot photos) have each independently reported a real
   * success status, OR the caller explicitly marked that side as not needed
   * (skipProd/skipSi). Non-'set' kinds (cart/before/after) upload synchronously
   * via defaultCartUpload, which throws on any failure/timeout — so reaching
   * status 'done' for those already implies server confirmation.
   * This must stay the ONLY gate that allows local bytes to be dropped; do not
   * add another path that deletes dataUrl/blob/file/PhotoDB blobs without
   * routing through here first.
   */
  function isFullyConfirmed(job) {
    if (Logic.isFullyConfirmed) return Logic.isFullyConfirmed(job);
    if (!job) return false;
    if (job.kind === 'set') {
      const prodOk = sideOk(job.prodStatus, 'set') || job.skipProd;
      const siApplicable = String(job.slot || 'after').toLowerCase() !== 'before';
      const siOk = !siApplicable || sideOk(job.siStatus, 'set') || job.skipSi;
      return prodOk && siOk;
    }
    return job.status === 'done';
  }

  function maybeOffloadJob(job) {
    if (!job || job.offloaded) return false;
    // isFullyConfirmed (PROD+SI, per isFullyConfirmed's own rules) is the entire
    // deletion contract. A resolvable board pointer is only needed to swap in a
    // remote preview thumbnail — its absence must never block a confirmed job's
    // bytes from being freed, or a device could be stuck holding bytes forever
    // for jobs that are already safely confirmed server-side.
    if (!isFullyConfirmed(job)) return false;
    const pointer = Logic.boardPointerFromResult
      ? Logic.boardPointerFromResult(job.uploadResult, job)
      : null;
    dropLocalPreview(job);
    if (pointer?.url && Logic.applyBoardOffload) {
      Logic.applyBoardOffload(job, pointer); // also nulls dataUrl/blob/file/bitmap/canvas
    } else {
      // No pointer to swap in — still drop local bytes, just without a preview.
      job.dataUrl = null;
      job.blob = null;
      job.file = null;
      job.bitmap = null;
      job.canvas = null;
      job.hasPayload = false;
    }
    job.offloaded = true;
    idbDelete(job.id).catch(() => {});
    return true;
  }

  function trackTransition(type, job) {
    if (!job || !global.EodUsage?.track) return;
    const code = {
      queued: 'local-saved',
      compressed: 'compressed',
      accepted: 'api-accepted',
      done: job.prodStatus && job.siStatus ? 'verified' : 'done',
      failed: 'terminal-error',
      partial: 'retry-waiting',
      superseded: 'superseded',
    }[type];
    if (!code) return;
    global.EodUsage.track('photo_pipeline', {
      transition: code,
      id: String(job.id || '').slice(0, 80),
      store: job.storeNumber || '',
      dbkey: job.dbkey || '',
      slot: job.slot || '',
      bay: job.bay || '',
      ageMs: Date.now() - (job.updatedAt || Date.now()),
      error: job.error ? String(job.error).slice(0, 80) : '',
    });
  }

  function pendingCounts() {
    if (Logic.countJobs) return Logic.countJobs([...jobs.values()]);
    let compress = 0;
    let upload = 0;
    let failed = 0;
    let done = 0;
    let superseded = 0;
    let protectedOnDevice = 0;
    for (const j of jobs.values()) {
      if (isSuperseded(j)) superseded += 1;
      else if (j.status === 'queued' || j.status === 'compressing') compress += 1;
      else if (j.status === 'compressed' || j.status === 'uploading' || j.status === 'reconciling' || j.status === 'accepted') upload += 1;
      else if (j.status === 'failed' && (j.dataUrl || j.blob || j.file || j.canvas || j.bitmap)) failed += 1;
      else if (j.status === 'done') done += 1;
      if (j.dataUrl || j.blob || j.file || j.hasPayload) protectedOnDevice += 1;
    }
    return { compress, upload, failed, done, superseded, protectedOnDevice, total: jobs.size, open: compress + upload };
  }

  // --- Storage-issue toast (quota exceeded / IDB write failures) ---------
  // Calm, non-blocking, never interrupts capture. Debounced to once per
  // ~8-minute "episode" so a run of failures doesn't spam the lead — but the
  // first failure of a new episode always surfaces, it is never swallowed
  // silently. Photos stay on-device either way (this is a heads-up, not a
  // gate); it exists so a lead knows to free space or tap sync before the
  // device actually runs out.
  const STORAGE_TOAST_DEBOUNCE_MS = 8 * 60 * 1000;
  let lastStorageToastAt = 0;
  let storageToastEl = null;

  function isQuotaError(err) {
    const name = err?.name || '';
    const msg = String(err?.message || err || '');
    return name === 'QuotaExceededError' || /quota/i.test(msg);
  }

  function showStorageToast(message) {
    try {
      if (typeof document === 'undefined') return;
      if (storageToastEl) storageToastEl.remove();
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom,0px));'
        + 'transform:translateX(-50%);z-index:49000;max-width:min(92vw,420px);'
        + 'background:#1f2937;color:#f8fafc;border:1px solid #475569;border-radius:12px;'
        + 'padding:10px 14px;font-size:14px;line-height:1.35;box-shadow:0 6px 20px rgba(0,0,0,.35);'
        + 'pointer-events:none;';
      el.textContent = message;
      document.body.appendChild(el);
      storageToastEl = el;
      setTimeout(() => { try { el.remove(); } catch (_) {} if (storageToastEl === el) storageToastEl = null; }, 6000);
    } catch (_) { /* best-effort UI only */ }
  }

  function notifyStorageIssue(err) {
    const now = Date.now();
    if (now - lastStorageToastAt < STORAGE_TOAST_DEBOUNCE_MS) return;
    lastStorageToastAt = now;
    const quota = isQuotaError(err);
    const message = quota
      ? 'This device is low on storage. Photos are still saved on the device — free up space or tap Sync.'
      : 'Having trouble saving a photo locally. It’s still in memory for this session — try to sync soon.';
    showStorageToast(message);
    try {
      global.dispatchEvent?.(new CustomEvent('eod-photo-storage-warning', { detail: { quota, error: err?.message || String(err) } }));
    } catch (_) {}
  }

  function openIdb() {
    if (idb) return Promise.resolve(idb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        idb = req.result;
        resolve(idb);
      };
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  function idbPut(record) {
    return openIdb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore(IDB_STORE).put(record);
        })
    ).catch((err) => {
      // Never silent: this is the sole IDB write path, so every persist
      // failure (quota exceeded, storage corruption, etc.) surfaces here.
      // The photo itself is NOT lost — it stays in the in-memory `jobs` Map
      // for this session — but the lead needs to know local persistence is
      // degraded so a crash/reload before sync would lose the in-memory copy.
      notifyStorageIssue(err);
      throw err;
    });
  }

  function idbGetAll() {
    return openIdb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function idbDelete(id) {
    return openIdb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore(IDB_STORE).delete(id);
        })
    );
  }

  function metaLean(job) {
    return {
      id: job.id,
      kind: job.kind,
      slot: job.slot,
      bay: job.bay,
      dbkey: job.dbkey,
      rowId: job.rowId,
      expectedBayCount: job.expectedBayCount || null,
      storeNumber: job.storeNumber,
      workDate: job.workDate,
      visitId: job.visitId,
      resetId: job.resetId,
      taskId: job.taskId,
      status:
        job.status === 'compressing'
          ? 'queued'
          : job.status === 'uploading' || job.status === 'reconciling'
            ? 'compressed'
            : job.status,
      error: job.error || null,
      prodStatus: job.prodStatus || null,
      siStatus: job.siStatus || null,
      skipProd: !!job.skipProd,
      skipSi: !!job.skipSi,
      force: !!job.force,
      replace: !!job.replace,
      replaceWipe: !!job.replaceWipe,
      replaceBatchId: job.replaceBatchId || null,
      bytes: job.bytes || null,
      checksum: job.checksum || null,
      serverJobId: job.serverJobId || null,
      statusUrl: job.statusUrl || null,
      idempotencyKey: job.idempotencyKey || null,
      attempts: job.attempts || 0,
      nextRetryAt: job.nextRetryAt || null,
      updatedAt: job.updatedAt || Date.now(),
      fileName: job.fileName || null,
      hasPayload: !!(job.dataUrl || job.file || job.blob),
      board: job.board || null,
      offloaded: !!job.offloaded,
    };
  }

  async function markSuperseded(job) {
    if (!job) return;
    job.status = 'superseded';
    job.error = null;
    job.file = null;
    job.bitmap = null;
    job.canvas = null;
    job.dataUrl = null;
    job.blob = null;
    job.hasPayload = false;
    if (job.previewUrl && String(job.previewUrl).startsWith('blob:')) {
      try { URL.revokeObjectURL(job.previewUrl); } catch (_) {}
    }
    job.previewUrl = null;
    job.updatedAt = Date.now();
    await idbDelete(job.id).catch(() => {});
    emit('superseded', job);
    // Confirmed fix (2026-09-18, field report — one set showing ~211 "trying
    // to upload"): nothing auto-purges superseded jobs from the live `jobs`
    // Map — purgeSettledJobs() does remove them, but it's only ever called
    // from device-storage.js's purgeInBackground(), which nothing in the app
    // actually invokes (verified: no callers). So every duplicate/retry
    // supersede cycle left a permanent, byte-wiped-but-still-counted entry in
    // the Map for the rest of the shift, inflating any total/count derived
    // from Map size. Remove it here immediately instead of waiting on a purge
    // path that never runs.
    jobs.delete(job.id);
  }

  function dataUrlToBlobForPipeline(dataUrl) {
    const s = String(dataUrl || '');
    const m = s.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    try {
      const bin = atob(m[2]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: m[1] || 'image/jpeg' });
    } catch (_) {
      return null;
    }
  }

  function blobToDataUrlForPipeline(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function persist() {
    try {
      const lean = [];
      for (const j of jobs.values()) {
        // Only ever drop a job's IDB record here if it is BOTH terminal-done
        // AND independently re-verified as fully confirmed (isFullyConfirmed
        // recomputes from prodStatus/siStatus/skip flags — it does not just
        // trust the 'done' label). This is a defense-in-depth backstop for
        // maybeOffloadJob's gate, not a replacement for it.
        if (
          j.status === 'done'
          && isFullyConfirmed(j)
          && Date.now() - (j.updatedAt || 0) > 36 * 60 * 60 * 1000
        ) {
          idbDelete(j.id).catch(() => {});
          continue;
        }
        if (isSuperseded(j)) {
          idbDelete(j.id).catch(() => {});
          continue;
        }
        lean.push(metaLean(j));
        persistJobRecord(j).catch(() => {});
      }
      try { localStorage.removeItem(META_KEY); } catch (_) {}
    } catch (_) {
      /* quota */
    }
  }

  async function persistJobRecord(job) {
    if (!job || isSuperseded(job) || job.status === 'done') return;
    let blob = job.blob || null;
    if (!blob && job.file instanceof Blob) blob = job.file;
    if (!blob && job.dataUrl) blob = dataUrlToBlobForPipeline(job.dataUrl);
    if (!blob && job.canvas?.toBlob) {
      blob = await new Promise((resolve) => job.canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
    }
    if (blob && !job.blob) job.blob = blob;
    await idbPut({
      ...metaLean(job),
      blob: blob || undefined,
      dataUrl: blob ? undefined : job.dataUrl || undefined,
      mime: job.mime || (blob && blob.type) || null,
    });
  }

  async function openLegacyIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(LEGACY_IDB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
  }

  async function migrateLegacyPayloads() {
    try {
      const v1 = localStorage.getItem('eodPhotoPipeline:v1');
      if (v1) {
        const parsed = JSON.parse(v1);
        for (const j of parsed.jobs || []) {
          if (!j?.id || jobs.has(j.id)) continue;
          hydrateJob(Logic.migrateJobRecord ? Logic.migrateJobRecord(j) : j);
        }
        localStorage.removeItem('eodPhotoPipeline:v1');
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const j of parsed.jobs || []) {
          if (!j?.id || jobs.has(j.id)) continue;
          hydrateJob(Logic.migrateJobRecord ? Logic.migrateJobRecord(j) : j);
        }
        localStorage.removeItem(META_KEY);
      }
    } catch (_) {}
    try {
      const legacy = await openLegacyIdb();
      const rows = await new Promise((resolve, reject) => {
        const tx = legacy.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      for (const row of rows) {
        const job = jobs.get(row.id);
        if (job && (row.blob || row.dataUrl)) {
          job.blob = row.blob || job.blob;
          job.dataUrl = row.dataUrl || job.dataUrl;
          job.bytes = row.bytes || job.bytes;
        }
      }
      try { legacy.close(); } catch (_) {}
      indexedDB.deleteDatabase(LEGACY_IDB_NAME);
    } catch (_) {}
  }

  async function restore() {
    try {
      await migrateLegacyPayloads();
      const rows = await idbGetAll().catch(() => []);
      for (const row of rows) {
        const migrated = Logic.migrateJobRecord ? Logic.migrateJobRecord(row) : row;
        if (!migrated?.id) continue;
        if (isSuperseded(migrated)) {
          jobs.set(migrated.id, { ...migrated, status: 'superseded', file: null, dataUrl: null, blob: null });
          idbDelete(migrated.id).catch(() => {});
          continue;
        }
        if (!jobs.has(migrated.id)) hydrateJob(migrated);
        const job = jobs.get(migrated.id);
        if (!job) continue;
        if (row.blob) job.blob = row.blob;
        let dataUrl = job.dataUrl || row.dataUrl || null;
        if (!dataUrl && row.blob) {
          try { dataUrl = await blobToDataUrlForPipeline(row.blob); } catch (_) { dataUrl = null; }
        }
        if (dataUrl) {
          job.dataUrl = dataUrl;
          job.previewUrl = job.previewUrl || dataUrl;
          job.bytes = row.bytes || job.bytes;
          job.checksum = row.checksum || job.checksum;
          job.serverJobId = row.serverJobId || job.serverJobId;
          job.statusUrl = row.statusUrl || job.statusUrl;
          job.idempotencyKey = row.idempotencyKey || job.idempotencyKey;
          if (job.status === 'failed' && /Lost after reload/i.test(job.error || '')) {
            job.status = 'compressed';
            job.error = null;
          }
        }
      }

      for (const j of [...jobs.values()]) {
        if (isSuperseded(j)) {
          await markSuperseded(j);
          continue;
        }
        const action = Logic.restoreAction ? Logic.restoreAction(j) : null;
        if (action === 'drop') {
          jobs.delete(j.id);
          idbDelete(j.id).catch(() => {});
          continue;
        }
        if (action === 'poll') {
          j.status = 'accepted';
          j.error = null;
          j.needsAttention = false;
          continue;
        }
        if (action === 'requeue') {
          j.status = 'compressed';
          j.needsAttention = false;
          j.nextRetryAt = Date.now() + (Logic.fullJitterMs ? Logic.fullJitterMs(j.attempts || 1) : 1500);
          continue;
        }
        if (!action && ['queued', 'compressed', 'uploading', 'reconciling', 'accepted'].includes(j.status) && !j.dataUrl && !j.file && !j.blob) {
          if (j.status === 'accepted' && j.statusUrl) continue;
          j.status = 'failed';
          j.error = 'Lost after reload — retake photo';
        }
      }
      persist();
      emit('restored', null);
    } catch (_) {}
  }

  function hydrateJob(j) {
    const status =
      j.status === 'compressing'
        ? 'queued'
        : j.status === 'uploading' || j.status === 'reconciling'
          ? 'compressed'
          : j.status;
    jobs.set(j.id, {
      ...j,
      status,
      file: null,
      dataUrl: j.dataUrl || null,
      previewUrl: j.previewUrl || j.dataUrl || null,
      uploader: null,
    });
  }

  function schedulePump() {
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump().catch(() => {});
    }, 16);
  }

  function yieldToUi() {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: 120 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function sideOk(status, kind) {
    if (Logic.sideOk) return Logic.sideOk(status, kind);
    if (OK_SIDES.has(status)) {
      if (kind === 'set' && status === 'not_found') return false;
      return true;
    }
    return false;
  }

  async function fetchSetStatus(job) {
    const S = global.EodSession;
    const store = job.storeNumber || S?.state?.storeNumber;
    const date = job.workDate || S?.state?.workDate;
    const dbkey = job.dbkey;
    if (!store || !date || !dbkey || !global.authFetch) return null;
    const cacheKey = `${store}|${date}|${dbkey}|${job.rowId || ''}`;
    const hit = statusCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 8000) return hit.status;
    const qs = new URLSearchParams({ store, date, dbkey });
    if (job.rowId) qs.set('rowId', job.rowId);
    const visitId = job.visitId || S?.state?.selectedShift?.visitId;
    if (visitId) qs.set('visitId', visitId);
    try {
      const resp = await global.authFetch(
        `https://eod-api.the-dump-bin.com/api/field-set/status?${qs}`,
        { skipBusy: true }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return null;
      statusCache.set(cacheKey, { at: Date.now(), status: data.status });
      return data.status;
    } catch (_) {
      return null;
    }
  }

  /**
   * Align job skip flags with remote PROD/SI bay presence.
   * Returns true if job is fully covered remotely (mark done, no upload).
   */
  async function reconcileSetJob(job) {
    if (job.kind !== 'set' || !job.dbkey) return false;
    const status = await fetchSetStatus(job);
    if (!status?.bays?.length) return false;
    const bay = Number(job.bay) || 1;
    const slot = String(job.slot || 'after').toLowerCase() === 'before' ? 'before' : 'after';
    const b = status.bays.find((x) => Number(x.bay) === bay) || {};
    const prodHas = slot === 'before' ? !!b.hasProdBefore : !!b.hasProdAfter;
    const siHas = !!(b.hasSiPhoto || b.hasPhoto);
    job.skipProd = job.skipProd || prodHas;
    job.skipSi = job.skipSi || siHas;
    if (prodHas) job.prodStatus = job.prodStatus || 'already_present';
    if (siHas) job.siStatus = job.siStatus || 'already_present';
    if (job.skipProd && job.skipSi) {
      job.status = 'done';
      job.error = null;
      job.updatedAt = Date.now();
      maybeOffloadJob(job);
      persist();
      emit('done', job);
      return true;
    }
    return false;
  }

  let compressWorker = null;
  function getCompressWorker() {
    if (compressWorker) return compressWorker;
    if (typeof Worker === 'undefined') return null;
    try {
      const workerUrl = new URL('js/workers/photo-compress-worker.js', document.baseURI || location.href);
      compressWorker = new Worker(workerUrl);
    } catch (_) {
      try {
        compressWorker = new Worker('js/workers/photo-compress-worker.js');
      } catch (_) {
        compressWorker = null;
      }
    }
    return compressWorker;
  }

  function compressInWorker(blob, compressType) {
    const worker = getCompressWorker();
    if (!worker) return Promise.reject(new Error('no worker'));
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => reject(new Error('compress timeout')), 45000);
      const onMsg = (ev) => {
        if (ev.data?.id !== id) return;
        worker.removeEventListener('message', onMsg);
        clearTimeout(timer);
        if (ev.data.ok) resolve(ev.data);
        else reject(new Error(ev.data.error || 'compress failed'));
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'compress', id, blob, compressType });
    });
  }

  async function inputToBlob(job) {
    if (job.file instanceof Blob) return job.file;
    if (job.blob instanceof Blob) return job.blob;
    if (job.dataUrl) return dataUrlToBlobForPipeline(job.dataUrl);
    if (job.canvas?.toBlob) {
      return new Promise((resolve) => job.canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
    }
    // Bitmap-only capture (no file/canvas/dataUrl yet) — was previously unhandled here,
    // which meant the bitmap got closed and nulled below with nothing ever extracted
    // from it. Draw it into a canvas so the photo isn't lost.
    if (job.bitmap) {
      try {
        const w = job.bitmap.width;
        const h = job.bitmap.height;
        const canvas = (typeof OffscreenCanvas !== 'undefined')
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        ctx.drawImage(job.bitmap, 0, 0);
        if (canvas.convertToBlob) return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  async function runCompress(job) {
    compressActive += 1;
    job.updatedAt = Date.now();
    emit('compressing', job);
    try {
      await yieldToUi();
      const type = job.compressType || job.kind || 'set';
      let blob = await inputToBlob(job);
      let checksum = null;
      let mime = null;
      let bytes = null;
      let dataUrl = job.dataUrl || null;
      if (blob) {
        try {
          const out = await compressInWorker(blob, type);
          blob = out.blob;
          checksum = out.checksum;
          mime = out.mime;
          bytes = out.bytes;
          dataUrl = await blobToDataUrlForPipeline(blob);
        } catch (_) {
          if (global.EodPhotoCompress?.compress) {
            const out = await global.EodPhotoCompress.compress(job.bitmap || job.canvas || blob || job.dataUrl, type);
            dataUrl = out.dataUrl;
            bytes = out.bytes || null;
            mime = out.mime || null;
            blob = dataUrlToBlobForPipeline(dataUrl);
          } else if (!dataUrl && blob) {
            dataUrl = await blobToDataUrlForPipeline(blob);
            bytes = blob.size;
            mime = blob.type;
          }
        }
      } else if (job.file) {
        dataUrl = await readFile(job.file);
        bytes = job.file.size;
      }
      const nextDataUrl = dataUrl;
      const nextBlob = blob || dataUrlToBlobForPipeline(dataUrl);
      if (!nextDataUrl && !nextBlob) {
        // Compression produced nothing usable. Do NOT null out file/bitmap/canvas
        // below — that would destroy the only copy of the photo with no way to
        // retry. Fail the job instead; the original bytes stay intact for retry.
        throw new Error('compress produced no output; original bytes preserved');
      }
      job.dataUrl = nextDataUrl;
      job.blob = nextBlob;
      job.bytes = bytes || job.blob?.size || null;
      job.mime = mime || job.blob?.type || null;
      job.checksum = checksum || job.checksum || null;
      if (job.previewUrl && String(job.previewUrl).startsWith('blob:')) {
        try { URL.revokeObjectURL(job.previewUrl); } catch (_) {}
      }
      job.previewUrl = job.dataUrl;
      job.file = null;
      try { job.bitmap?.close?.(); } catch (_) {}
      job.bitmap = null;
      job.canvas = null;
      job.status = 'compressed';
      job.updatedAt = Date.now();
      await persistJobRecord(job);
      persist();
      emit('compressed', job);
    } catch (err) {
      job.status = 'failed';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
      persist();
      emit('failed', job);
    } finally {
      compressActive -= 1;
      schedulePump();
    }
  }

  async function runUpload(job) {
    uploadActive += 1;
    job.updatedAt = Date.now();
    emit('uploading', job);
    try {
      await yieldToUi();
      if (job.kind === 'set' && !job.force) {
        job.status = 'reconciling';
        emit('reconciling', job);
        const fullyRemote = await reconcileSetJob(job);
        if (fullyRemote) return;
        job.status = 'uploading';
      }

      if (typeof job.uploader === 'function') {
        const result = await job.uploader(job);
        job.prodStatus = result?.prod?.status || result?.prodStatus || null;
        job.siStatus = result?.si?.status || result?.siStatus || null;
        job.uploadResult = result || null;
      } else if (job.kind === 'set') {
        const result = await defaultSetUpload(job);
        if (result?.accepted && !result?.prod) {
          job.status = 'accepted';
          persist();
          emit('accepted', job);
          scheduleAcceptedPoll();
          return;
        }
        job.prodStatus = result?.prod?.status || null;
        job.siStatus = result?.si?.status || null;
        job.uploadResult = result;
      } else if (job.kind === 'cart' || job.kind === 'before' || job.kind === 'after') {
        const result = await defaultCartUpload(job);
        job.prodStatus = result?.queued ? 'queued' : result?.success ? 'ok' : null;
        job.uploadResult = result;
      }

      if (job.kind === 'set') {
        const prodOk = sideOk(job.prodStatus, 'set') || job.skipProd;
        const siOk = sideOk(job.siStatus, 'set') || job.skipSi;
        // Treat SI not_found as ok only when skipSi; otherwise retry later
        const prodFine = prodOk || job.prodStatus === 'unavailable';
        const siFine = siOk || job.siStatus === 'unavailable';

        if (prodOk && siOk) {
          job.status = 'done';
          job.error = null;
          job.skipProd = true;
          job.skipSi = true;
          maybeOffloadJob(job);
        } else if (prodOk && !siOk) {
          job.skipProd = true;
          job.status = 'compressed';
          job.error = job.siStatus === 'error' ? `SI: ${job.uploadResult?.si?.message || 'retry'}` : null;
          persist();
          emit('partial', job);
          return;
        } else if (!prodOk && siOk) {
          job.skipSi = true;
          job.status = 'compressed';
          job.error = job.prodStatus === 'error' ? `PROD: ${job.uploadResult?.prod?.message || 'retry'}` : null;
          persist();
          emit('partial', job);
          return;
        } else if (prodFine || siFine) {
          // One side unavailable (session) — keep retrying
          job.status = 'compressed';
          job.error = 'Waiting for connection';
          persist();
          emit('partial', job);
          return;
        } else {
          throw new Error(
            [job.uploadResult?.prod?.message, job.uploadResult?.si?.message]
              .filter(Boolean)
              .join(' / ') || 'Upload failed both sides'
          );
        }
      } else {
        // A truthy result alone isn't durable confirmation — defaultCartUpload
        // can return a bare `{queued:true}` when the server accepted the
        // request without a jobId to poll to completion. Only `completed`
        // (polled via jobId) or `success` (synchronous ack) count as durable;
        // anything else stays uploading/retrying with bytes intact rather than
        // marking done and purging on an unconfirmed queue-accept.
        const result = job.uploadResult;
        const confirmed = !!(result?.completed || result?.success);
        if (confirmed) {
          job.status = 'done';
          job.error = null;
          maybeOffloadJob(job);
        } else {
          job.status = 'compressed';
          job.error = result?.queued
            ? 'Upload accepted, waiting for confirmation'
            : 'Upload response unrecognized — retrying';
          job.updatedAt = Date.now();
          persist();
          emit('partial', job);
          return;
        }
      }

      job.updatedAt = Date.now();
      persist();
      emit('done', job);
    } catch (err) {
      job.attempts = (job.attempts || 0) + 1;
      const message = err?.message || String(err);
      const transient = Logic.isTransientUploadError
        ? Logic.isTransientUploadError(message)
        : /timeout|network|failed to fetch|503|429|502|waiting for connection|lease|backed up|catching up|session not active|processing this set|still processing|try again shortly|another field-set job|locked/i.test(message);
      const canRetry = !!(job.dataUrl || job.blob || job.statusUrl);
      // Lock / still-processing / try-again-shortly must stay retryable.
      // The set attempt cap used to run first and mark these terminal failed
      // while the server status was still `retry` (often later `completed`).
      if (transient && job.attempts < 40 && canRetry) {
        job.status = (job.statusUrl && !job.dataUrl && !job.blob) ? 'accepted' : 'compressed';
        job.error = message;
        job.needsAttention = false;
        job.nextRetryAt = Date.now() + (Logic.fullJitterMs ? Logic.fullJitterMs(job.attempts) : Math.min(30000, 400 * (2 ** job.attempts)));
        persist();
        emit('partial', job);
        setTimeout(schedulePump, Math.max(0, job.nextRetryAt - Date.now()));
        return;
      }
      if (job.kind === "set" && job.attempts >= MAX_SET_ATTEMPTS) {
        job.status = "failed";
        job.error = job.error || "Too many upload attempts — needs attention";
        job.needsAttention = true;
        job.updatedAt = Date.now();
        persist();
        emit("failed", job);
        return;
      }
      job.status = 'failed';
      job.error = message;
      job.updatedAt = Date.now();
      persist();
      emit('failed', job);
    } finally {
      uploadActive -= 1;
      schedulePump();
    }
  }

  async function defaultSetUpload(job) {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const body = JSON.stringify({
      storeNumber: job.storeNumber || S.state.storeNumber,
      workDate: job.workDate || S.state.workDate,
      dbkey: job.dbkey,
      rowId: job.rowId,
      expectedBayCount: job.expectedBayCount || null,
      slot: job.slot,
      bay: job.bay,
      photoBase64: job.dataUrl,
      visitId: job.visitId || S.state.selectedShift?.visitId || null,
      visitIds: (S.state.shifts || []).map((s) => s.visitId).filter(Boolean),
      resetId: job.resetId || null,
      taskId: job.taskId || null,
      skipProd: !!job.skipProd,
      skipSi: !!job.skipSi,
        replace: !!job.replace,
      replaceWipe: !!job.replaceWipe,
      replaceBatchId: job.replaceBatchId || null,
    });
    job.idempotencyKey = job.idempotencyKey
      || (Logic.stableIdempotencyKey ? Logic.stableIdempotencyKey(job) : `eod-photo:${job.id}`);
    const durable = global.EodFieldSetJobs;
    if (durable?.submitBinary || durable?.submit) {
      const submitter = durable.submitBinary || durable.submit;
      const accepted = await submitter.call(durable, 'photo', {
        headers,
        body,
        blob: job.blob || null,
        checksum: job.checksum || null,
        job,
        idempotencyKey: job.idempotencyKey,
        timeoutMs: 3 * 60 * 1000,
        allowAsync: true,
        waitForResult: false,
        skipBusy: true,
      });
      if (accepted?.jobId || accepted?.statusUrl) {
        job.serverJobId = accepted.jobId || job.serverJobId;
        job.statusUrl = accepted.statusUrl || job.statusUrl;
        persist();
      }
      if (accepted?.accepted && !accepted?.result?.prod) {
        return { accepted: true, jobId: accepted.jobId, statusUrl: accepted.statusUrl };
      }
      return accepted?.result || accepted;
    }
    const resp = await global.authFetch('https://eod-api.the-dump-bin.com/api/field-set/photo', {
      method: 'POST',
      headers: { ...headers, Prefer: 'respond-async', 'Idempotency-Key': job.idempotencyKey },
      body,
      skipBusy: true,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.result) throw new Error(data.error || `Upload failed (${resp.status})`);
    return data.result || data;
  }

  async function defaultCartUpload(job) {
    const S = global.EodSession;
    const storeNumber = job.storeNumber || S.state.storeNumber;
    const date = job.workDate || S.state.workDate;
    const mainIse = global.EodSendSheetsLogic?.pickMainKompassIseVisit?.(
      S.state.shifts,
      S.state.selectedShift
    );
    const visitId = mainIse?.visitId || job.visitId;
    if (!visitId) throw new Error('No Kompass ISE shift found for this store and day');
    const leadName = S.state.leadName || S.state.profileName || '';
    const padded = String(storeNumber).padStart(3, '0');
    const dateCompact = String(date || '').replace(/-/g, '');
    const slot = job.slot || 'before';
    const filename = `fm${padded}_kompass_cart_${slot}_photo_${dateCompact}.jpg`;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const resp = await global.authFetch(`${global.EOD_API_BASE}/sas-upload`, {
      method: 'POST',
      headers,
      skipBusy: true,
      body: JSON.stringify({
        storeNumber,
        date,
        leadName,
        visitId,
        photoBase64: job.dataUrl,
        slot,
        targetReset: 'MAINTENANCE',
        filename,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);
    if (data.jobId) {
      const started = Date.now();
      while (Date.now() - started < 3 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResp = await global.authFetch(
          `${global.EOD_API_BASE}/sas-upload/${encodeURIComponent(data.jobId)}`,
          { skipBusy: true, noBounceOn401: true }
        );
        const statusData = await statusResp.json().catch(() => ({}));
        if (!statusResp.ok || !statusData.success || !statusData.job) {
          throw new Error(statusData.error || `Upload status failed (${statusResp.status})`);
        }
        const status = String(statusData.job.status || '').toLowerCase();
        try { await global.PhotoDB?.setSasJobStatus?.(data.jobId, status || 'pending'); } catch (_) {}
        if (status === 'completed') return { ...data, completed: true, job: statusData.job };
        if (status === 'failed') throw new Error(statusData.job.error || 'PROD cart upload failed');
      }
      throw new Error('PROD cart upload timed out');
    }
    return data;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function pump() {
    while (compressActive < MAX_COMPRESS) {
      const next = [...jobs.values()].find((j) =>
        j.status === 'queued'
        && (Logic.hasCompressInput ? Logic.hasCompressInput(j) : (j.file || j.dataUrl || j.blob || j.canvas || j.bitmap))
      );
      if (!next) break;
      next.status = 'compressing';
      runCompress(next);
    }
    while (uploadActive < MAX_UPLOAD) {
      const ready = [...jobs.values()].filter((j) =>
        j.status === 'compressed'
        && (j.dataUrl || j.blob)
        && (!j.nextRetryAt || j.nextRetryAt <= Date.now())
      );
      const uploadingReplace = new Set(
        [...jobs.values()]
          .filter((j) => j.replace && j.status === 'uploading' && j.replaceBatchId)
          .map((j) => j.replaceBatchId)
      );
      const replacing = ready.filter((j) => j.replace && !uploadingReplace.has(j.replaceBatchId));
      const next = replacing.length
        ? replacing.sort((a, b) => Number(a.bay) - Number(b.bay))[0]
        : ready.find((j) => !j.replace);
      if (!next) break;
      next.status = 'uploading';
      runUpload(next);
    }
  }

  function makeId(parts) {
    return parts.filter(Boolean).join(":") + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function makeSetJobId(dbkey, slot, bay) {
    const key = Logic.normalizeDbkey
      ? Logic.normalizeDbkey(dbkey)
      : String(dbkey || "").replace(/\D/g, "").replace(/^0+/, "");
    return ["set", key, String(slot || ""), String(Number(bay))].join(":");
  }

  function enqueue(opts) {
    const S = global.EodSession;
    const file = opts.file || null;
    const bitmap = opts.bitmap || null;
    const canvas = opts.canvas || null;
    let previewUrl = opts.previewUrl || null;
    if (!previewUrl && file) {
      try { previewUrl = URL.createObjectURL(file); } catch (_) {}
    }
    const normKey = (opts.kind === "set" && opts.dbkey)
      ? (Logic.normalizeDbkey ? Logic.normalizeDbkey(opts.dbkey) : String(opts.dbkey).replace(/\D/g, "").replace(/^0+/, ""))
      : opts.dbkey;
    if (opts.kind === "set" && normKey) opts = { ...opts, dbkey: normKey };
    const id = opts.id
      || (opts.kind === "set" && normKey && opts.slot != null && opts.bay != null
        ? makeSetJobId(normKey, opts.slot, opts.bay)
        : makeId([opts.kind || "photo", opts.dbkey, opts.slot, opts.bay]));
    if (opts.kind === "set" && opts.dbkey && opts.slot && opts.bay != null) {
      const incoming = { id, kind: "set", dbkey: opts.dbkey, slot: opts.slot, bay: opts.bay };
      const doomed = Logic.jobsToSupersede
        ? Logic.jobsToSupersede([...jobs.values()], incoming)
        : [...jobs.values()].filter((j) =>
          j.kind === 'set'
          && j.dbkey === opts.dbkey
          && j.slot === opts.slot
          && Number(j.bay) === Number(opts.bay)
          && j.status !== 'done'
          && j.status !== 'superseded'
          && j.id !== id
        );
      for (const j of doomed) markSuperseded(j);
    }

    const job = {
      id,
      kind: opts.kind || 'set',
      compressType: opts.compressType || opts.kind || 'set',
      slot: opts.slot || 'after',
      bay: opts.bay != null ? Number(opts.bay) : 1,
      dbkey: opts.dbkey || null,
      rowId: opts.rowId || null,
      expectedBayCount: Number(opts.expectedBayCount) || null,
      storeNumber: opts.storeNumber || S?.state?.storeNumber || null,
      workDate: opts.workDate || S?.state?.workDate || null,
      visitId: opts.visitId || S?.state?.selectedShift?.visitId || null,
      resetId: opts.resetId || null,
      taskId: opts.taskId || null,
      file,
      bitmap,
      canvas,
      dataUrl: opts.dataUrl || null,
      previewUrl: previewUrl || opts.dataUrl || null,
      fileName: file?.name || opts.fileName || null,
      status: file || bitmap || canvas || opts.dataUrl ? 'queued' : 'failed',
      error: file || bitmap || canvas || opts.dataUrl ? null : 'No photo data',
      uploader: opts.uploader || null,
      skipUpload: !!opts.skipUpload,
      skipProd: !!opts.skipProd,
      skipSi: !!opts.skipSi,
      force: false,
      replace: !!opts.replace,
      replaceWipe: !!opts.replaceWipe,
      replaceBatchId: opts.replaceBatchId || null,
      updatedAt: Date.now(),
    };
    if (job.skipUpload && job.dataUrl) {
      job.status = 'done';
    }
    job.idempotencyKey = Logic.stableIdempotencyKey ? Logic.stableIdempotencyKey(job) : `eod-photo:${job.id}`;
    jobs.set(id, job);
    // Track IDB write failure on the job record so callers (and restore()) can
    // distinguish "bytes in memory, not yet on disk" from "bytes confirmed in IDB".
    // notifyStorageIssue() toast is already shown by idbPut — no additional UI needed.
    const saved = persistJobRecord(job).catch(() => { job._idbWriteFailed = true; });
    persist();
    emit('queued', job);
    schedulePump();
    const pub = publicJob(job);
    pub.ready = saved;
    return pub;
  }

  async function enqueueCapture(opts) {
    const job = enqueue(opts);
    try { await job.ready; } catch (_) {}
    return job;
  }

  function listJobs(filter) {
    const all = [...jobs.values()].map(publicJob);
    if (!filter) return all;
    return all.filter((j) => {
      if (filter.kind && j.kind !== filter.kind) return false;
      if (filter.dbkey && j.dbkey !== filter.dbkey) return false;
      if (filter.slot && j.slot !== filter.slot) return false;
      if (filter.status && j.status !== filter.status) return false;
      return true;
    });
  }

  function jobsForSet(dbkey) {
    const want = Logic.normalizeDbkey
      ? Logic.normalizeDbkey(dbkey)
      : String(dbkey || "").replace(/\D/g, "").replace(/^0+/, "");
    return [...jobs.values()]
      .map(publicJob)
      .filter((j) => {
        if (j.kind !== "set") return false;
        const got = Logic.normalizeDbkey
          ? Logic.normalizeDbkey(j.dbkey)
          : String(j.dbkey || "").replace(/\D/g, "").replace(/^0+/, "");
        return got === want;
      });
  }

  function statusLabel(job) {
    if (!job) return '';
    switch (job.status) {
      case 'queued': return 'queued';
      case 'compressing': return 'compressing';
      case 'compressed': return job.error === 'Waiting for connection' ? 'waiting' : 'ready';
      case 'reconciling': return 'checking';
      case 'uploading': return 'uploading';
      case 'done':
        return job.prodStatus || job.siStatus
          ? `PROD ${job.prodStatus || '—'} / SI ${job.siStatus || '—'}`
          : 'done';
      case 'superseded': return 'superseded';
      case 'accepted': return 'accepted';
      case 'failed': return isSuperseded(job) ? 'superseded' : 'failed';
      default: return job.status;
    }
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function retryFailed() {
    let n = 0;
    for (const j of jobs.values()) {
      if (Logic.shouldRetry ? Logic.shouldRetry(j) : (j.status === 'failed' && !isSuperseded(j) && (j.dataUrl || j.blob || j.file))) {
        if (retry(j.id)) n += 1;
      }
    }
    return n;
  }

  function retry(id) {
    const job = jobs.get(id);
    if (!job || isSuperseded(job)) return null;
    if (job.dataUrl || job.blob) job.status = 'compressed';
    else if (job.file) job.status = 'queued';
    else return null;
    job.error = null;
    job.updatedAt = Date.now();
    global.EodUsage?.track?.('upload_retry', {
      kind: job.kind || 'photo',
      slot: job.slot || '',
      status: 'retry',
    });
    persist();
    emit('queued', job);
    schedulePump();
    return publicJob(job);
  }

  /** Drop a local job (device only). Does not delete remote PROD/SI photos. */
  function removeJob(id) {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.previewUrl && String(job.previewUrl).startsWith('blob:')) {
      try { URL.revokeObjectURL(job.previewUrl); } catch (_) {}
    }
    jobs.delete(id);
    idbDelete(id).catch(() => {});
    persist();
    emit('removed', job);
    return true;
  }


  function sessionHasProtectedJobs(store, workDate) {
    if (Logic.sessionHasProtectedJobs) {
      return Logic.sessionHasProtectedJobs([...jobs.values()], store, workDate);
    }
    const storeNorm = String(store || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const date = String(workDate || '').slice(0, 10);
    for (const j of jobs.values()) {
      const jStore = String(j.storeNumber || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (jStore !== storeNorm) continue;
      const jd = String(j.workDate || '').slice(0, 10);
      if (date && jd && date !== jd) continue;
      if (isSuperseded(j) || j.status === 'superseded') continue;
      if (!isFullyConfirmed(j) || (j.dataUrl || j.blob || j.file || j.hasPayload)) return true;
    }
    return false;
  }

  function purgeSettledJobs({ maxAgeMs = 36 * 60 * 60 * 1000 } = {}) {
    let n = 0;
    const now = Date.now();
    for (const j of [...jobs.values()]) {
      if (isSuperseded(j) || j.status === 'superseded') {
        if (removeJob(j.id)) n += 1;
        continue;
      }
      if (j.status !== 'done') continue;
      if (!isFullyConfirmed(j)) continue;
      if (maxAgeMs > 0 && now - (j.updatedAt || 0) < maxAgeMs) continue;
      if (removeJob(j.id)) n += 1;
    }
    return n;
  }

  function removeSetBay(dbkey, slot, bay) {
    let n = 0;
    for (const j of [...jobs.values()]) {
      if (
        j.kind === 'set'
        && String(j.dbkey) === String(dbkey)
        && String(j.slot) === String(slot)
        && Number(j.bay) === Number(bay)
      ) {
        if (removeJob(j.id)) n += 1;
      }
    }
    return n;
  }

  /**
   * Called when the server confirms a bay's bytes are safely buffered
   * (reconcile/push ack — i.e. landed in the eod-api field_set_photo_buffer
   * row). This is DB confirmation only, not PROD/SI confirmation, so it must
   * NOT touch local bytes: PhotoDB blobs, dataUrl/blob/file, or the IDB
   * record all stay put. We just record that a durable server-side copy
   * exists (bufferedId/bufferedAt) as a breadcrumb for recovery/debugging.
   * The job is marked 'accepted' as a progress marker only — pump() does not
   * re-drive 'accepted' jobs, so the eod-api reconcile worker owns pushing
   * this bay the rest of the way into PROD/SI; the device keeps its bytes
   * as a fallback until maybeOffloadJob's isFullyConfirmed gate says both
   * sides are truly done (or, for 'before' slot, PROD alone).
   */
  function offloadBufferedBay(dbkey, slot, bay, ackData) {
    let n = 0;
    for (const j of [...jobs.values()]) {
      if (
        j.kind !== 'set'
        || String(j.dbkey) !== String(dbkey)
        || String(j.slot) !== String(slot)
        || Number(j.bay) !== Number(bay)
      ) continue;
      if (j.status === 'done' || j.status === 'superseded') continue;
      j.bufferedId = ackData?.bufferedId || j.bufferedId || null;
      j.bufferedAt = Date.now();
      j.checksum = j.checksum || ackData?.checksum || null;
      if (j.status !== 'done' && j.status !== 'accepted') {
        j.status = 'accepted';
        j.updatedAt = Date.now();
      }
      persist();
      emit('accepted', j);
      n += 1;
    }
    return n;
  }

  function waitForJob(id, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const job = jobs.get(id);
        if (!job) return reject(new Error('Job missing'));
        if (job.status === 'done') return resolve(publicJob(job));
        if (job.status === 'superseded') return resolve(publicJob(job));
        if (job.status === 'failed' && !isSuperseded(job)) {
          return reject(new Error(job.error || 'failed'));
        }
        if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  async function waitForSet(dbkey, { allowFailed = false, timeoutMs = 180000 } = {}) {
    const start = Date.now();
    for (;;) {
      const list = jobsForSet(dbkey).filter((j) => !isSuperseded(j));
      const open = list.filter((j) => !['done', 'failed', 'superseded'].includes(j.status));
      const failed = list.filter((j) => j.status === 'failed' && !isSuperseded(j));
      if (!open.length) {
        if (failed.length && !allowFailed) {
          throw new Error(`${failed.length} photo(s) failed — tap failed thumbs to retry`);
        }
        return list;
      }
      if (Date.now() - start > timeoutMs) throw new Error('Still processing photos');
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  let acceptedPollTimer = null;
  let acceptedPollBusy = false;

  function applyServerResult(job, result) {
    job.prodStatus = result?.prod?.status || job.prodStatus;
    job.siStatus = result?.si?.status || job.siStatus;
    job.uploadResult = result || job.uploadResult;
    const prodOk = sideOk(job.prodStatus, 'set') || job.skipProd;
    const siOk = sideOk(job.siStatus, 'set') || job.skipSi;
    if (prodOk && siOk) {
      job.status = 'done';
      job.error = null;
      job.skipProd = true;
      job.skipSi = true;
      maybeOffloadJob(job);
      persist();
      emit('done', job);
      return 'done';
    }
    if (prodOk && !siOk) job.skipProd = true;
    if (siOk && !prodOk) job.skipSi = true;
    persist();
    emit('partial', job);
    return 'partial';
  }

  function healCompletedJob(job, result) {
    applyServerResult(job, result);
    if (job.status === 'done') return;
    job.status = 'done';
    job.error = null;
    job.needsAttention = false;
    job.updatedAt = Date.now();
    maybeOffloadJob(job);
    persist();
    emit('done', job);
  }

  function scheduleAcceptedPoll() {
    if (acceptedPollTimer) return;
    acceptedPollTimer = setTimeout(() => {
      acceptedPollTimer = null;
      pollAcceptedJobs().catch(() => {});
    }, 4000);
  }

  async function pollAcceptedJobs() {
    if (acceptedPollBusy) return;
    const durable = global.EodFieldSetJobs;
    if (!durable?.peek) {
      scheduleAcceptedPoll();
      return;
    }
    const open = [...jobs.values()].filter((j) =>
      j.statusUrl && !isSuperseded(j) && (j.status === 'accepted' || j.status === 'failed')
    );
    if (!open.length) return;
    acceptedPollBusy = true;
    try {
      for (const job of open) {
        try {
          const remote = await durable.peek(job.statusUrl);
          const plan = Logic.remotePeekPlan
            ? Logic.remotePeekPlan(job, remote?.status)
            : (String(remote?.status || '').toLowerCase() === 'completed' ? 'done' : 'keep');
          if (plan === 'done') {
            healCompletedJob(job, remote.result);
            continue;
          }
          if (plan === 'requeue') {
            job.status = 'compressed';
            job.error = remote.error || 'SI still catching up';
            job.nextRetryAt = Date.now() + 15000;
            persist();
            emit('partial', job);
            continue;
          }
          if (plan === 'drop') {
            jobs.delete(job.id);
            idbDelete(job.id).catch(() => {});
            persist();
            emit('removed', job);
            continue;
          }
          if (plan === 'accept') {
            job.status = 'accepted';
            job.error = null;
            job.needsAttention = false;
            persist();
            emit('accepted', job);
          }
        } catch (_) {}
      }
    } finally {
      acceptedPollBusy = false;
      if ([...jobs.values()].some((j) => j.statusUrl && !isSuperseded(j) && (j.status === 'accepted' || j.status === 'failed'))) {
        scheduleAcceptedPoll();
      }
      schedulePump();
    }
  }

  async function reconcileOpenJobs() {
    if (reconcileBusy) return;
    reconcileBusy = true;
    try {
      statusCache.clear();
      for (const job of jobs.values()) {
        if (job.kind !== 'set') continue;
        if (!['compressed', 'failed', 'queued'].includes(job.status)) continue;
        if (isSuperseded(job)) continue;
        if (!job.dataUrl && !job.file) continue;
        try {
          const done = await reconcileSetJob(job);
          if (!done && job.status === 'failed' && job.dataUrl) {
            job.status = 'compressed';
            job.error = null;
            persist();
          }
        } catch (_) {}
      }
    } finally {
      reconcileBusy = false;
      schedulePump();
    }
  }

  function start() {
    if (started) return;
    started = true;
    restore().then(() => {
      schedulePump();
      reconcileOpenJobs();
      scheduleAcceptedPoll();
      try { void global.EodDevicePhotoFlush?.flushCurrentStore?.(); } catch (_) {}
    });
    window.addEventListener('online', () => {
      reconcileOpenJobs();
      schedulePump();
      scheduleAcceptedPoll();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reconcileOpenJobs();
        schedulePump();
        scheduleAcceptedPoll();
      } else {
        // Screen lock or tab switch — flush any in-memory bytes not yet written to IDB.
        // This is defense-in-depth behind the primary fix (await job.ready in enqueueLocal),
        // covering any other callers that do not await job.ready themselves.
        persist();
      }
    });
    // pagehide fires on iOS when the page is unloaded (beforeunload is unreliable on mobile).
    window.addEventListener('pagehide', () => { persist(); });
    // beforeunload: warn if any job holds bytes in memory that have not reached the server
    // yet (no serverJobId / statusUrl), and kick off a best-effort IDB flush.
    window.addEventListener('beforeunload', (ev) => {
      const unsafe = [...jobs.values()].some(
        (j) => !isSuperseded(j)
          && !['done', 'superseded'].includes(j.status)
          && (j.file || j.dataUrl || j.blob || j.bitmap || j.canvas)
          && !j.serverJobId && !j.statusUrl
      );
      if (unsafe) {
        persist(); // best-effort — may not complete before unload, but increases odds
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
  }

  global.EodPhotoPipeline = {
    start,
    enqueue,
    enqueueCapture,
    listJobs,
    jobsForSet,
    statusLabel,
    pendingCounts,
    onChange,
    retry,
    retryFailed,
    removeJob,
    removeSetBay,
    offloadBufferedBay,
    waitForJob,
    waitForSet,
    schedulePump,
    reconcileOpenJobs,
    fetchSetStatus,
    purgeSettledJobs,
    pollAcceptedJobs,
    sessionHasProtectedJobs,
    isFullyConfirmed,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
