/* Background photo pipeline — capture stays instant; compress + upload continue off-UI. */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'eodPhotoPipeline:v1';
  const MAX_COMPRESS = 1;
  const MAX_UPLOAD = 2;
  const listeners = new Set();

  /** @type {Map<string, object>} */
  const jobs = new Map();
  let compressActive = 0;
  let uploadActive = 0;
  let pumpTimer = null;
  let started = false;

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
      else if (j.status === 'compressed' || j.status === 'uploading') upload += 1;
      else if (j.status === 'failed') failed += 1;
      else if (j.status === 'done') done += 1;
    }
    return { compress, upload, failed, done, total: jobs.size };
  }

  function persist() {
    try {
      const lean = [];
      for (const j of jobs.values()) {
        if (j.status === 'done' && Date.now() - (j.updatedAt || 0) > 6 * 60 * 60 * 1000) continue;
        lean.push({
          id: j.id,
          kind: j.kind,
          slot: j.slot,
          bay: j.bay,
          dbkey: j.dbkey,
          rowId: j.rowId,
          storeNumber: j.storeNumber,
          workDate: j.workDate,
          visitId: j.visitId,
          resetId: j.resetId,
          taskId: j.taskId,
          status: j.status === 'compressing' ? 'queued'
            : j.status === 'uploading' ? 'compressed'
              : j.status,
          dataUrl: j.dataUrl || null,
          previewUrl: null,
          error: j.error || null,
          prodStatus: j.prodStatus || null,
          siStatus: j.siStatus || null,
          bytes: j.bytes || null,
          updatedAt: j.updatedAt || Date.now(),
          fileName: j.fileName || null,
        });
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, jobs: lean.slice(-80) }));
    } catch (_) { /* quota — drop oldest done */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      for (const j of parsed.jobs || []) {
        if (!j?.id || jobs.has(j.id)) continue;
        if (j.status === 'done') continue;
        // Need dataUrl to resume upload; otherwise mark failed for re-capture
        if ((j.status === 'compressed' || j.status === 'uploading' || j.status === 'queued') && !j.dataUrl && !j.file) {
          if (j.status !== 'queued') {
            j.status = 'failed';
            j.error = 'Lost after reload — retake photo';
          } else {
            continue;
          }
        }
        jobs.set(j.id, j);
      }
    } catch (_) {}
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
      job.file = null; // free memory
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
        job.prodStatus = result?.queued ? 'queued' : (result?.success ? 'ok' : null);
        job.uploadResult = result;
      }
      job.status = 'done';
      job.error = null;
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
      resetId: job.resetId || null,
      taskId: job.taskId || null,
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

  /**
   * Instant accept. Returns a job with previewUrl immediately.
   * Compression + upload continue in background.
   */
  function enqueue(opts) {
    const S = global.EodSession;
    const file = opts.file || null;
    let previewUrl = opts.previewUrl || null;
    if (!previewUrl && file) {
      try { previewUrl = URL.createObjectURL(file); } catch (_) {}
    }
    const id = opts.id || makeId([opts.kind || 'photo', opts.dbkey, opts.slot, opts.bay]);
    // Retake: cancel prior open jobs for same set bay
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
      case 'compressed': return 'ready';
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

  function start() {
    if (started) return;
    started = true;
    restore();
    schedulePump();
    window.addEventListener('online', () => schedulePump());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedulePump();
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
    waitForJob,
    waitForSet,
    schedulePump,
  };

  // Auto-start after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
