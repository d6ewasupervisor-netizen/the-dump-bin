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
  const OK_SIDES = new Set([
    'ok',
    'ok_already_complete',
    'skipped',
    'already_present',
    'not_found', // not a hard fail for cart uploads; excluded for 'set' below
  ]);

  /** Mirrors the server-side semantics: a 'set' SI/PROD side reporting
   * not_found means the task/reset wasn't there to receive the photo, which
   * is NOT the same as confirmed-delivered, so it must not count as ok. */
  function sideOk(status, kind) {
    if (OK_SIDES.has(status)) {
      if (kind === 'set' && status === 'not_found') return false;
      return true;
    }
    return false;
  }

  /**
   * Whether a job is safe to drop local bytes for. This is the single
   * predicate that gates deletion anywhere in the pipeline — do not delete
   * dataUrl/blob/file/PhotoDB bytes based on any other check.
   * - 'set' jobs need PROD confirmed, and SI confirmed too unless the slot
   *   is 'before' (SI does not apply to befores) or the caller explicitly
   *   marked a side as skipped (skipProd/skipSi).
   * - Non-'set' kinds (cart/before/after) upload synchronously and throw on
   *   any failure, so reaching status 'done' already implies confirmation.
   */
  function isFullyConfirmed(job) {
    if (!job) return false;
    if (job.kind === 'set') {
      const prodOk = sideOk(job.prodStatus, 'set') || job.skipProd;
      const siApplicable = String(job.slot || 'after').toLowerCase() !== 'before';
      const siOk = !siApplicable || sideOk(job.siStatus, 'set') || job.skipSi;
      return !!(prodOk && siOk);
    }
    return job.status === 'done';
  }

  function hasLocalBytes(j) {
    return !!(j && (j.dataUrl || j.blob || j.file || j.hasPayload));
  }

  /**
   * Bytes a Retry tap can actually resubmit. A stale hasPayload flag is not
   * enough — restore can leave that true after the blob is gone.
   */
  function hasRetryableBytes(job) {
    return !!(job && (job.dataUrl || job.blob || job.file || job.canvas || job.bitmap));
  }

  /**
   * Lock / still-processing / try-again-shortly replies are the server asking
   * us to wait, not a terminal upload failure. already_present is success and
   * is handled by sideOk — do not treat it here.
   */
  // 'timed out' is spelled out because defaultCartUpload throws 'PROD cart
  // upload timed out', which /timeout/ does not match - that failure was being
  // classified terminal and the cart photo died after a single attempt.
  // 'load failed' is Safari's offline TypeError; Chrome says 'failed to fetch'.
  const TRANSIENT_UPLOAD_RE = /timeout|timed out|network|failed to fetch|load failed|\b50[0234]\b|\b503\b|\b429\b|\b502\b|waiting for connection|\blease\b|backed up|catching up|session not active|processing this set|still processing|try again shortly|another field-set job|\block(?:ed|ing)?\b/i;

  function isTransientUploadError(message) {
    return TRANSIENT_UPLOAD_RE.test(String(message || ''));
  }

  /**
   * True if any job for this store+date still needs its local bytes kept —
   * either not yet fully confirmed, or confirmed but not yet offloaded.
   * Mirrors the inline fallback previously duplicated in photo-pipeline.js's
   * sessionHasProtectedJobs; keep both in sync (or better, have that one
   * always delegate here — see the Logic.sessionHasProtectedJobs check there).
   */
  function sessionHasProtectedJobs(jobList, store, workDate) {
    const storeNorm = String(store || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const date = String(workDate || '').slice(0, 10);
    for (const j of jobList || []) {
      const jStore = String(j?.storeNumber || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (jStore !== storeNorm) continue;
      const jd = String(j?.workDate || '').slice(0, 10);
      if (date && jd && date !== jd) continue;
      if (isSuperseded(j)) continue;
      if (!isFullyConfirmed(j) || hasLocalBytes(j)) return true;
    }
    return false;
  }

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
    let lost = 0;
    let unsaved = 0;
    let done = 0;
    let superseded = 0;
    let protectedOnDevice = 0; // still holding local bytes — not yet safe to have deleted
    const jobs = jobList || [];
    for (const j of jobs) {
      if (isSuperseded(j)) {
        superseded += 1;
        continue;
      }
      if (OPEN_COMPRESS.has(j.status)) compress += 1;
      else if (OPEN_UPLOAD.has(j.status)) upload += 1;
      else if (j.status === 'failed' && hasRetryableBytes(j)) failed += 1;
      // Failed with nothing left to resubmit. Retry cannot help, but the photo
      // is gone, so this has to surface somewhere rather than count as nothing.
      else if (j.status === 'failed') lost += 1;
      else if (j.status === 'done') done += 1;
      // Note: a 'done' job only ever still has local bytes if isFullyConfirmed
      // (in photo-pipeline.js) hasn't yet run maybeOffloadJob's cleanup — this
      // count is a snapshot, safe to surface either way since it just means
      // "we still hold a copy", never "we lost one".
      if (hasLocalBytes(j)) protectedOnDevice += 1;
      // Bytes live only in RAM: a reload or an OS tab-kill loses this photo.
      if ((j.idbWriteFailed || j._idbWriteFailed) && hasLocalBytes(j)) unsaved += 1;
    }
    return {
      compress,
      upload,
      failed,
      lost,
      unsaved,
      done,
      superseded,
      protectedOnDevice,
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
    return hasRetryableBytes(job);
  }

  const RESTORE_OPEN = new Set([
    'queued',
    'compressing',
    'compressed',
    'uploading',
    'reconciling',
    'accepted',
  ]);

  /**
   * After sleep/reload, once any surviving bytes are reattached:
   * - poll: no bytes, but statusUrl can still heal a server-completed job
   * - drop: no bytes and nothing to poll — Retry cannot help, so it must not
   *   inflate the retry badge
   * - requeue: failed only because of a transient lock/processing error, and
   *   the payload is still here
   * - keep: leave the record alone
   */
  function restoreAction(job) {
    if (!job || job.status === 'done' || job.status === 'superseded' || isSuperseded(job)) return 'keep';
    if (!hasRetryableBytes(job)) {
      if (job.statusUrl && (job.status === 'failed' || job.status === 'accepted' || RESTORE_OPEN.has(job.status))) {
        return 'poll';
      }
      if (job.status === 'failed' || RESTORE_OPEN.has(job.status)) return 'drop';
      return 'keep';
    }
    if (job.status === 'failed' && isTransientUploadError(job.error)) return 'requeue';
    return 'keep';
  }

  /**
   * What to do when a statusUrl peek returns. `done` heals a client `failed`
   * (or `accepted`) job once the server job is completed.
   */
  function remotePeekPlan(job, remoteStatus) {
    if (!job || isSuperseded(job)) return 'ignore';
    const status = String(remoteStatus || '').toLowerCase();
    if (status === 'completed') return 'done';
    if (status === 'failed') return hasRetryableBytes(job) ? 'requeue' : 'drop';
    if (['pending', 'retry', 'processing'].includes(status) && job.status === 'failed') return 'accept';
    return 'keep';
  }

  function normalizeDbkey(raw) {
    return String(raw == null ? '' : raw).replace(/\D/g, '').replace(/^0+/, '');
  }

  function sameBay(a, b) {
    return a
      && b
      && a.kind === 'set'
      && b.kind === 'set'
      && normalizeDbkey(a.dbkey) === normalizeDbkey(b.dbkey)
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

  const QUEUE_COPY = 'Please be patient, there is a lot going on behind the scenes.';
  const MERGE_HOLD_MS = 60_000;

  /* Jobs that stop moving.

     'buffered': offloadBufferedBay marks a bay 'accepted' straight from the
     reconcile ack, with no statusUrl. Nothing else could move that state -
     pump() takes queued/compressed, pollAcceptedJobs requires a statusUrl, and
     reconcileOpenJobs took neither - while countJobs counts accepted as an
     open upload. The app read "syncing" for the rest of the shift on a photo
     the server already had.

     'uploading': a request that outlived even the write ceiling. */
  const ACCEPTED_STALL_MS = 45_000;
  const UPLOAD_STALL_MS = 4 * 60 * 1000;

  function stallKind(job, now = Date.now()) {
    if (!job || isSuperseded(job) || job.status === 'done') return null;
    const age = now - (Number(job.updatedAt) || now);
    if (job.status === 'accepted' && !job.statusUrl && age > ACCEPTED_STALL_MS) return 'buffered';
    if ((job.status === 'uploading' || job.status === 'reconciling') && age > UPLOAD_STALL_MS) return 'uploading';
    return null;
  }

  /* Which compressed job gets the single upload slot next.

     This used to be `ready.find((j) => !j.replace)`, i.e. always the
     earliest-inserted job. Retry backoff caps at 30s while the request ceiling
     is 180s, so a failing job was always ready again before the slot freed:
     the first two captures traded it back and forth and later bays never got a
     first attempt. Fewest attempts first fixes that. Array.sort is stable and
     Map iteration is insertion-ordered, so equal-attempt jobs stay oldest
     first. */
  function pickNextUpload(ready, uploadingReplaceBatchIds) {
    const list = ready || [];
    const busy = uploadingReplaceBatchIds instanceof Set
      ? uploadingReplaceBatchIds
      : new Set(uploadingReplaceBatchIds || []);
    const replacing = list.filter((j) => j.replace && !busy.has(j.replaceBatchId));
    if (replacing.length) {
      return replacing.slice().sort((a, b) => Number(a.bay) - Number(b.bay))[0];
    }
    return list
      .filter((j) => !j.replace)
      .sort((a, b) => (a.attempts || 0) - (b.attempts || 0))[0] || null;
  }

  function countStalled(jobList, now = Date.now()) {
    let buffered = 0;
    let uploading = 0;
    for (const j of jobList || []) {
      const kind = stallKind(j, now);
      if (kind === 'buffered') buffered += 1;
      else if (kind === 'uploading') uploading += 1;
    }
    return { buffered, uploading, total: buffered + uploading };
  }

  /* A number that moves is what tells a human the machine is still alive. The
     flat string read identically whether one photo or forty were open, and
     whether the queue was advancing or completely wedged. */
  function queueProgressCopy(counts) {
    const compress = Number(counts?.compress || 0);
    const upload = Number(counts?.upload || 0);
    if (compress + upload <= 0) return QUEUE_COPY;
    const parts = [];
    if (upload > 0) parts.push(`${upload} uploading`);
    if (compress > 0) parts.push(`${compress} preparing`);
    return `${parts.join(' \u00b7 ')} \u2014 keep going, this finishes in the background.`;
  }

  function queueBannerShouldShow(counts, { mergeUntil = 0, now = Date.now() } = {}) {
    const open = Number(counts?.open || 0);
    if (open > 0) return { show: true, copy: queueProgressCopy(counts), merging: false };
    if (now < Number(mergeUntil || 0)) return { show: true, copy: QUEUE_COPY, merging: true };
    return { show: false, copy: '', merging: false };
  }

  return {
    OPEN_COMPRESS,
    OPEN_UPLOAD,
    TERMINAL,
    QUEUE_COPY,
    MERGE_HOLD_MS,
    ACCEPTED_STALL_MS,
    UPLOAD_STALL_MS,
    queueProgressCopy,
    stallKind,
    countStalled,
    pickNextUpload,
    isSuperseded,
    migrateJobRecord,
    sideOk,
    isFullyConfirmed,
    hasLocalBytes,
    hasRetryableBytes,
    isTransientUploadError,
    sessionHasProtectedJobs,
    countJobs,
    fullJitterMs,
    stableIdempotencyKey,
    hasCompressInput,
    shouldRetry,
    restoreAction,
    remotePeekPlan,
    normalizeDbkey,
    sameBay,
    jobsToSupersede,
    bytesToHex,
    boardPointerForBay,
    boardPointerFromResult,
    applyBoardOffload,
    queueBannerShouldShow,
  };
});
