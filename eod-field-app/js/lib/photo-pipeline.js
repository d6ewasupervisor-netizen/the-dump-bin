/* Background photo pipeline — durable resume; skip bays already on PROD/SI. */
(function (global) {
  'use strict';

  const META_KEY = 'eodPhotoPipeline:v2';
  const IDB_NAME = 'eodPhotoPipeline';
  const IDB_STORE = 'jobs';
  const IDB_VERSION = 1;
  const MAX_COMPRESS = 1;
  const MAX_UPLOAD = 2;
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

  function emit(type, job) {
    const detail = { type, job: job ? publicJob(job) : null, pending: pendingCounts() };
    listeners.forEach((fn) => {
      try { fn(detail); } catch (_) {}
    });
    try {
      global.dispatchEvent(new CustomEvent('eod-photo-pipeline', { detail }));
    } catch (_) {}
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
      updatedAt: job.updatedAt,
    };
  }

  function pendingCounts() {
    let compress = 0;
    let upload = 0;
    let failed = 0;
    let done = 0;
    for (const j of jobs.values()) {
      if (j.status === 'queued' || j.status === 'compressing') compress += 1;
      else if (j.status === 'compressed' || j.status === 'uploading' || j.status === 'reconciling') upload += 1;
      else if (j.status === 'failed') failed += 1;
      else if (j.status === 'done') done += 1;
    }
    return { compress, upload, failed, done, total: jobs.size };
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
    );
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
      bytes: job.bytes || null,
      updatedAt: job.updatedAt || Date.now(),
      fileName: job.fileName || null,
      hasPayload: !!(job.dataUrl || job.file),
    };
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
        if (j.status === 'done' && Date.now() - (j.updatedAt || 0) > 36 * 60 * 60 * 1000) {
          idbDelete(j.id).catch(() => {});
          continue;
        }
        lean.push(metaLean(j));
        if (j.dataUrl) {
          const blob = dataUrlToBlobForPipeline(j.dataUrl);
          idbPut({
            id: j.id,
            dataUrl: blob ? undefined : j.dataUrl,
            blob: blob || undefined,
            mime: j.mime || (blob && blob.type) || null,
            bytes: j.bytes || (blob && blob.size) || null,
            updatedAt: j.updatedAt || Date.now(),
          }).catch(() => {});
        }
      }
      localStorage.setItem(META_KEY, JSON.stringify({ v: 2, jobs: lean.slice(-120) }));
    } catch (_) {
      /* quota */
    }
  }

  async function restore() {
    try {
      // Migrate v1 localStorage payloads if present
      try {
        const v1 = localStorage.getItem('eodPhotoPipeline:v1');
        if (v1) {
          const parsed = JSON.parse(v1);
          for (const j of parsed.jobs || []) {
            if (!j?.id || jobs.has(j.id)) continue;
            hydrateJob(j);
            if (j.dataUrl) {
              await idbPut({
                id: j.id,
                dataUrl: j.dataUrl,
                bytes: j.bytes || null,
                updatedAt: j.updatedAt || Date.now(),
              }).catch(() => {});
            }
          }
          localStorage.removeItem('eodPhotoPipeline:v1');
        }
      } catch (_) {}

      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const j of parsed.jobs || []) {
          if (!j?.id || jobs.has(j.id)) continue;
          hydrateJob(j);
        }
      }

      const rows = await idbGetAll().catch(() => []);
      for (const row of rows) {
        const job = jobs.get(row.id);
        let dataUrl = row.dataUrl || null;
        if (!dataUrl && row.blob) {
          try { dataUrl = await blobToDataUrlForPipeline(row.blob); } catch (_) { dataUrl = null; }
        }
        if (job && dataUrl) {
          job.dataUrl = dataUrl;
          job.previewUrl = job.previewUrl || dataUrl;
          job.bytes = row.bytes || job.bytes;
          if (job.status === 'failed' && /Lost after reload/i.test(job.error || '')) {
            job.status = 'compressed';
            job.error = null;
          }
        }
      }

      for (const j of jobs.values()) {
        if (['queued', 'compressed', 'uploading', 'reconciling'].includes(j.status) && !j.dataUrl && !j.file) {
          j.status = 'failed';
          j.error = 'Lost after reload — retake photo';
        }
      }
      persist();
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
        `https://eod-api.the-dump-bin.com/api/field-set/status?${qs}`
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
      persist();
      emit('done', job);
      return true;
    }
    return false;
  }

  async function runCompress(job) {
    compressActive += 1;
    job.updatedAt = Date.now();
    emit('compressing', job);
    try {
      await yieldToUi();
      const input = job.file || job.dataUrl;
      const type = job.compressType || job.kind || 'set';
      let out;
      if (global.EodPhotoCompress?.compress) {
        out = await global.EodPhotoCompress.compress(input, type);
      } else if (job.file) {
        out = { dataUrl: await readFile(job.file), bytes: job.file.size };
      } else {
        out = { dataUrl: job.dataUrl, bytes: 0 };
      }
      job.dataUrl = out.dataUrl;
      job.bytes = out.bytes || null;
      job.mime = out.mime || null;
      if (job.previewUrl && String(job.previewUrl).startsWith('blob:')) {
        try { URL.revokeObjectURL(job.previewUrl); } catch (_) {}
      }
      job.previewUrl = job.dataUrl;
      job.file = null;
      job.status = 'compressed';
      job.updatedAt = Date.now();
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
        job.status = 'done';
        job.error = null;
      }

      job.updatedAt = Date.now();
      persist();
      emit('done', job);
    } catch (err) {
      job.status = 'failed';
      job.error = err?.message || String(err);
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
      slot: job.slot,
      bay: job.bay,
      photoBase64: job.dataUrl,
      visitId: job.visitId || S.state.selectedShift?.visitId || null,
      visitIds: (S.state.shifts || []).map((s) => s.visitId).filter(Boolean),
      resetId: job.resetId || null,
      taskId: job.taskId || null,
      skipProd: !!job.skipProd,
      skipSi: !!job.skipSi,
      force: !!job.force,
    });
    const resp = await global.authFetch('https://eod-api.the-dump-bin.com/api/field-set/photo', {
      method: 'POST',
      headers,
      body,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.result) throw new Error(data.error || `Upload failed (${resp.status})`);
    return data.result || data;
  }

  async function defaultCartUpload(job) {
    const S = global.EodSession;
    const storeNumber = job.storeNumber || S.state.storeNumber;
    const date = job.workDate || S.state.workDate;
    const visitId = job.visitId || S.state.selectedShift?.visitId;
    const leadName = S.state.leadName || S.state.profileName || '';
    const padded = String(storeNumber).padStart(3, '0');
    const dateCompact = String(date || '').replace(/-/g, '');
    const slot = job.slot || 'before';
    const filename = `fm${padded}_kompass_cart_${slot}_photo_${dateCompact}.jpg`;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const resp = await global.authFetch(`${global.EOD_API_BASE}/sas-upload`, {
      method: 'POST',
      headers,
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
      const next = [...jobs.values()].find((j) => j.status === 'queued' && (j.file || j.dataUrl));
      if (!next) break;
      next.status = 'compressing';
      runCompress(next);
    }
    while (uploadActive < MAX_UPLOAD) {
      const next = [...jobs.values()].find((j) => j.status === 'compressed' && j.dataUrl);
      if (!next) break;
      next.status = 'uploading';
      runUpload(next);
    }
  }

  function makeId(parts) {
    return parts.filter(Boolean).join(':') + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function enqueue(opts) {
    const S = global.EodSession;
    const file = opts.file || null;
    let previewUrl = opts.previewUrl || null;
    if (!previewUrl && file) {
      try { previewUrl = URL.createObjectURL(file); } catch (_) {}
    }
    const id = opts.id || makeId([opts.kind || 'photo', opts.dbkey, opts.slot, opts.bay]);
    if (opts.kind === 'set' && opts.dbkey && opts.slot && opts.bay != null) {
      for (const j of jobs.values()) {
        if (
          j.kind === 'set'
          && j.dbkey === opts.dbkey
          && j.slot === opts.slot
          && Number(j.bay) === Number(opts.bay)
          && j.status !== 'done'
          && j.id !== id
        ) {
          j.status = 'failed';
          j.error = 'replaced';
          if (j.previewUrl && String(j.previewUrl).startsWith('blob:')) {
            try { URL.revokeObjectURL(j.previewUrl); } catch (_) {}
          }
        }
      }
    }

    const job = {
      id,
      kind: opts.kind || 'set',
      compressType: opts.compressType || opts.kind || 'set',
      slot: opts.slot || 'after',
      bay: opts.bay != null ? Number(opts.bay) : 1,
      dbkey: opts.dbkey || null,
      rowId: opts.rowId || null,
      storeNumber: opts.storeNumber || S?.state?.storeNumber || null,
      workDate: opts.workDate || S?.state?.workDate || null,
      visitId: opts.visitId || S?.state?.selectedShift?.visitId || null,
      resetId: opts.resetId || null,
      taskId: opts.taskId || null,
      file,
      dataUrl: opts.dataUrl || null,
      previewUrl: previewUrl || opts.dataUrl || null,
      fileName: file?.name || opts.fileName || null,
      status: file || opts.dataUrl ? 'queued' : 'failed',
      error: file || opts.dataUrl ? null : 'No photo data',
      uploader: opts.uploader || null,
      skipUpload: !!opts.skipUpload,
      skipProd: !!opts.skipProd,
      skipSi: !!opts.skipSi,
      force: !!opts.force,
      updatedAt: Date.now(),
    };
    if (job.skipUpload && job.dataUrl) {
      job.status = 'done';
    }
    jobs.set(id, job);
    persist();
    emit('queued', job);
    schedulePump();
    return publicJob(job);
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
    return listJobs({ kind: 'set', dbkey: String(dbkey) });
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
      case 'failed': return job.error === 'replaced' ? 'replaced' : 'failed';
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
      if (j.status === 'failed' && j.error !== 'replaced') {
        if (retry(j.id)) n += 1;
      }
    }
    return n;
  }

  function retry(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.dataUrl) job.status = 'compressed';
    else if (job.file) job.status = 'queued';
    else return null;
    job.error = null;
    job.updatedAt = Date.now();
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

  function purgeSettledJobs({ maxAgeMs = 36 * 60 * 60 * 1000 } = {}) {
    let n = 0;
    const now = Date.now();
    for (const j of [...jobs.values()]) {
      if (j.error === 'replaced') {
        if (removeJob(j.id)) n += 1;
        continue;
      }
      if (j.status !== 'done') continue;
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

  function waitForJob(id, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const job = jobs.get(id);
        if (!job) return reject(new Error('Job missing'));
        if (job.status === 'done') return resolve(publicJob(job));
        if (job.status === 'failed' && job.error !== 'replaced') {
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
      const list = jobsForSet(dbkey).filter((j) => j.error !== 'replaced');
      const open = list.filter((j) => !['done', 'failed'].includes(j.status));
      const failed = list.filter((j) => j.status === 'failed');
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

  async function reconcileOpenJobs() {
    if (reconcileBusy) return;
    reconcileBusy = true;
    try {
      statusCache.clear();
      for (const job of jobs.values()) {
        if (job.kind !== 'set') continue;
        if (!['compressed', 'failed', 'queued'].includes(job.status)) continue;
        if (job.error === 'replaced') continue;
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
    });
    window.addEventListener('online', () => {
      reconcileOpenJobs();
      schedulePump();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reconcileOpenJobs();
        schedulePump();
      }
    });
  }

  global.EodPhotoPipeline = {
    start,
    enqueue,
    listJobs,
    jobsForSet,
    statusLabel,
    pendingCounts,
    onChange,
    retry,
    retryFailed,
    removeJob,
    removeSetBay,
    waitForJob,
    waitForSet,
    schedulePump,
    reconcileOpenJobs,
    fetchSetStatus,
    purgeSettledJobs,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
