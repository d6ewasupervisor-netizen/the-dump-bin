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

  function shouldRetry(job) {
    if (!job || isSuperseded(job)) return false;
    if (job.status !== 'failed') return false;
    return !!(job.dataUrl || job.blob || job.file || job.hasPayload);
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

  return {
    OPEN_COMPRESS,
    OPEN_UPLOAD,
    TERMINAL,
    isSuperseded,
    migrateJobRecord,
    countJobs,
    fullJitterMs,
    stableIdempotencyKey,
    shouldRetry,
    sameBay,
    jobsToSupersede,
    bytesToHex,
  };
});
