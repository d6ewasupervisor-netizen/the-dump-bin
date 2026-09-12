'use strict';

/**
 * Pure photo-pipeline helpers — Node tests + browser IIFE.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EodPhotoPipelineLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const OPEN_COMPRESS = new Set(['queued', 'compressing']);
  const OPEN_UPLOAD = new Set(['compressed', 'uploading', 'reconciling', 'accepted']);
  const TERMINAL = new Set(['done', 'failed', 'superseded']);

  function isSuperseded(job) {
    if (!job) return false;
    if (job.status === 'superseded') return true;
    return job.status === 'failed' && String(job.error || '') === 'replaced';
  }

  function migrateJobRecord(job) {
    if (!job || typeof job !== 'object') return job;
    if (isSuperseded(job) || (job.status === 'failed' && job.error === 'replaced')) {
      return {
        ...job,
        status: 'superseded',
        error: null,
        dataUrl: null,
        blob: null,
        file: null,
        bitmap: null,
        canvas: null,
        previewUrl: null,
        hasPayload: false,
      };
    }
    return job;
  }

  function countJobs(jobList) {
    let compress = 0;
    let upload = 0;
    let failed = 0;
    let done = 0;
    let superseded = 0;
    const jobs = jobList || [];
    for (const j of jobs) {
      if (isSuperseded(j)) {
        superseded += 1;
        continue;
      }
      if (OPEN_COMPRESS.has(j.status)) compress += 1;
      else if (OPEN_UPLOAD.has(j.status)) upload += 1;
      else if (j.status === 'failed') failed += 1;
      else if (j.status === 'done') done += 1;
    }
    return {
      compress,
      upload,
      failed,
      done,
      superseded,
      total: jobs.length,
      open: compress + upload,
    };
  }

  function fullJitterMs(attempt, random) {
    const roll = typeof random === 'function' ? random() : Math.random();
    const exp = Math.min(30000, 400 * (2 ** Math.max(0, Number(attempt) || 0)));
    return Math.floor(Math.max(0, Math.min(1, roll)) * (exp + 1));
  }

  function stableIdempotencyKey(job) {
    const parts = [
      'eod-photo',
      String(job?.storeNumber || '').replace(/^0+/, ''),
      String(job?.workDate || ''),
      String(job?.dbkey || ''),
      String(job?.slot || 'after'),
      String(job?.bay || 1),
      String(job?.id || ''),
    ];
    return parts.join(':').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 200);
  }

  function hasCompressInput(job) {
    if (!job) return false;
    return !!(job.file || job.dataUrl || job.blob || job.canvas || job.bitmap);
  }

  function shouldRetry(job) {
    if (!job || isSuperseded(job)) return false;
    if (job.status !== 'failed') return false;
    return !!(job.dataUrl || job.blob || job.file || job.hasPayload || job.canvas || job.bitmap);
  }

  function sameBay(a, b) {
    return a
      && b
      && a.kind === 'set'
      && b.kind === 'set'
      && String(a.dbkey) === String(b.dbkey)
      && String(a.slot) === String(b.slot)
      && Number(a.bay) === Number(b.bay);
  }

  function jobsToSupersede(existing, incoming) {
    if (!incoming || incoming.kind !== 'set' || !incoming.dbkey || incoming.slot == null || incoming.bay == null) {
      return [];
    }
    const out = [];
    for (const j of existing || []) {
      if (j.id === incoming.id) continue;
      if (TERMINAL.has(j.status) && j.status !== 'failed') continue;
      if (isSuperseded(j)) continue;
      if (sameBay(j, incoming)) out.push(j);
    }
    return out;
  }

  function bytesToHex(buffer) {
    return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function boardPointerForBay({ rowId, slot, bay, source } = {}) {
    const id = Number(rowId);
    const n = Number(bay) || 1;
    const slotNorm = String(slot || 'after').toLowerCase() === 'before' ? 'before' : 'after';
    const src = String(source || (slotNorm === 'before' ? 'prod' : 'si')).toLowerCase();
    if (!Number.isFinite(id) || id <= 0) return null;
    const photoId = `${slotNorm}-bay-${n}`;
    const url = `/api/digital-signoffs/rows/${id}/photos/${src}/${photoId}/image`;
    return {
      rowId: id,
      source: src,
      photoId,
      slot: slotNorm,
      bay: n,
      url,
      thumbUrl: `${url}?thumb=1`,
    };
  }

  function boardPointerFromResult(result, job) {
    const raw = result?.board;
    if (raw && (raw.url || raw.thumbUrl)) {
      return {
        rowId: Number(raw.rowId) || Number(job?.rowId) || null,
        source: raw.source || null,
        photoId: raw.photoId || null,
        slot: raw.slot || job?.slot || null,
        bay: raw.bay == null ? (Number(job?.bay) || null) : Number(raw.bay),
        url: raw.url || null,
        thumbUrl: raw.thumbUrl || raw.url || null,
      };
    }
    const rowId = result?.sheetRow?.id || job?.rowId;
    return boardPointerForBay({
      rowId,
      slot: job?.slot,
      bay: job?.bay,
      source: job?.slot === 'before' ? 'prod' : 'si',
    });
  }

  function applyBoardOffload(job, pointer) {
    if (!job || !pointer?.url) return job;
    job.board = pointer;
    job.previewUrl = pointer.thumbUrl || pointer.url;
    job.dataUrl = null;
    job.blob = null;
    job.file = null;
    job.bitmap = null;
    job.canvas = null;
    job.hasPayload = false;
    job.offloaded = true;
    return job;
  }

  const QUEUE_COPY = 'Working in the background. Keep going. Give it a minute to catch up.';
  const MERGE_HOLD_MS = 60_000;

  function queueBannerShouldShow(counts, { mergeUntil = 0, now = Date.now() } = {}) {
    const open = Number(counts?.open || 0);
    if (open > 0) return { show: true, copy: QUEUE_COPY, merging: false };
    if (now < Number(mergeUntil || 0)) return { show: true, copy: QUEUE_COPY, merging: true };
    return { show: false, copy: '', merging: false };
  }

  return {
    OPEN_COMPRESS,
    OPEN_UPLOAD,
    TERMINAL,
    QUEUE_COPY,
    MERGE_HOLD_MS,
    isSuperseded,
    migrateJobRecord,
    countJobs,
    fullJitterMs,
    stableIdempotencyKey,
    hasCompressInput,
    shouldRetry,
    sameBay,
    jobsToSupersede,
    bytesToHex,
    boardPointerForBay,
    boardPointerFromResult,
    applyBoardOffload,
    queueBannerShouldShow,
  };
});
