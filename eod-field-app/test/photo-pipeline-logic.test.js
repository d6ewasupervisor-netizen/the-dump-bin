'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../js/lib/photo-pipeline-logic');

describe('photo-pipeline-logic', () => {
  it('excludes superseded and replaced jobs from failed counts', () => {
    const counts = logic.countJobs([
      { status: 'failed', error: 'replaced' },
      { status: 'superseded' },
      { status: 'failed', error: 'timeout', dataUrl: 'x' },
      { status: 'compressed' },
      { status: 'done' },
    ]);
    assert.equal(counts.failed, 1);
    assert.equal(counts.superseded, 2);
    assert.equal(counts.upload, 1);
    assert.equal(counts.done, 1);
    assert.equal(counts.open, 1);
  });

  it('migrates replaced records to superseded without payload', () => {
    const migrated = logic.migrateJobRecord({
      id: 'a',
      status: 'failed',
      error: 'replaced',
      dataUrl: 'data:image/jpeg;base64,xx',
    });
    assert.equal(migrated.status, 'superseded');
    assert.equal(migrated.dataUrl, null);
    assert.equal(migrated.hasPayload, false);
  });

  it('treats camera canvas and bitmap shots as compress-ready', () => {
    assert.equal(logic.hasCompressInput({ status: 'queued', canvas: {} }), true);
    assert.equal(logic.hasCompressInput({ status: 'queued', bitmap: {} }), true);
    assert.equal(logic.hasCompressInput({ status: 'queued', blob: {} }), true);
    assert.equal(logic.hasCompressInput({ status: 'queued' }), false);
  });

  it('does not retry superseded or payload-less jobs', () => {
    assert.equal(logic.shouldRetry({ status: 'failed', error: 'replaced' }), false);
    assert.equal(logic.shouldRetry({ status: 'superseded', dataUrl: 'x' }), false);
    assert.equal(logic.shouldRetry({ status: 'failed', error: 'timeout' }), false);
    assert.equal(logic.shouldRetry({ status: 'failed', error: 'timeout', dataUrl: 'x' }), true);
  });

  it('finds same-bay jobs to supersede and keeps done jobs', () => {
    const existing = [
      { id: 'old', kind: 'set', dbkey: '1', slot: 'before', bay: 2, status: 'compressed' },
      { id: 'done', kind: 'set', dbkey: '1', slot: 'before', bay: 2, status: 'done' },
      { id: 'other', kind: 'set', dbkey: '1', slot: 'after', bay: 2, status: 'queued' },
    ];
    const doomed = logic.jobsToSupersede(existing, {
      id: 'new',
      kind: 'set',
      dbkey: '1',
      slot: 'before',
      bay: 2,
    });
    assert.deepEqual(doomed.map((j) => j.id), ['old']);
  });

  it('uses full jitter inside the exponential cap', () => {
    const zero = logic.fullJitterMs(3, () => 0);
    const one = logic.fullJitterMs(3, () => 1);
    assert.equal(zero, 0);
    assert.ok(one > 0);
    assert.ok(one <= 3201);
  });

  it('builds a stable idempotency key for the same capture', () => {
    const a = logic.stableIdempotencyKey({
      id: 'job1',
      storeNumber: '0215',
      workDate: '2026-09-09',
      dbkey: '9459238',
      slot: 'before',
      bay: 3,
    });
    const b = logic.stableIdempotencyKey({
      id: 'job1',
      storeNumber: '215',
      workDate: '2026-09-09',
      dbkey: '9459238',
      slot: 'before',
      bay: 3,
    });
    assert.equal(a, b);
    assert.match(a, /^eod-photo:215:2026-09-09:9459238:before:3:job1$/);
  });

  it('counts accepted jobs as open', () => {
    const counts = logic.countJobs([
      { status: 'accepted' },
      { status: 'done' },
    ]);
    assert.equal(counts.upload, 1);
    assert.equal(counts.open, 1);
  });

  it('keeps the background banner up through the merge window', () => {
    const now = 1_000_000;
    const open = logic.queueBannerShouldShow({ open: 2 }, { now });
    assert.equal(open.show, true);
    assert.equal(open.copy, logic.QUEUE_COPY);
    const merging = logic.queueBannerShouldShow({ open: 0 }, { mergeUntil: now + 10_000, now });
    assert.equal(merging.show, true);
    const settled = logic.queueBannerShouldShow({ open: 0 }, { mergeUntil: now - 1, now });
    assert.equal(settled.show, false);
  });

  it('builds a board pointer and drops local bytes after ingest', () => {
    const pointer = logic.boardPointerFromResult({
      board: {
        rowId: 9175,
        source: 'prod',
        photoId: 'before-bay-2',
        slot: 'before',
        bay: 2,
        url: '/api/digital-signoffs/rows/9175/photos/prod/before-bay-2/image',
        thumbUrl: '/api/digital-signoffs/rows/9175/photos/prod/before-bay-2/image?thumb=1',
      },
    }, { slot: 'before', bay: 2, rowId: 9175 });
    assert.equal(pointer.photoId, 'before-bay-2');
    const job = {
      status: 'done',
      dataUrl: 'data:image/jpeg;base64,xx',
      blob: { size: 12 },
      file: { name: 'x.jpg' },
    };
    logic.applyBoardOffload(job, pointer);
    assert.equal(job.offloaded, true);
    assert.equal(job.dataUrl, null);
    assert.equal(job.blob, null);
    assert.equal(job.previewUrl, pointer.thumbUrl);
    assert.equal(job.hasPayload, false);
  });

  it('sideOk: not_found is ok for cart kinds but not for set', () => {
    assert.equal(logic.sideOk('not_found', 'cart'), true);
    assert.equal(logic.sideOk('not_found', 'set'), false);
    assert.equal(logic.sideOk('ok', 'set'), true);
    assert.equal(logic.sideOk('sas_login_required', 'set'), false);
    assert.equal(logic.sideOk(undefined, 'set'), false);
  });

  it('isFullyConfirmed: set jobs need both PROD and SI confirmed for after slot', () => {
    const base = { kind: 'set', slot: 'after', prodStatus: 'ok', siStatus: 'ok' };
    assert.equal(logic.isFullyConfirmed(base), true);
    assert.equal(logic.isFullyConfirmed({ ...base, siStatus: 'not_found' }), false);
    assert.equal(logic.isFullyConfirmed({ ...base, prodStatus: 'sas_login_required' }), false);
    assert.equal(logic.isFullyConfirmed({ ...base, prodStatus: null }), false);
  });

  it('isFullyConfirmed: skipProd/skipSi bypass an unconfirmed side', () => {
    assert.equal(logic.isFullyConfirmed({
      kind: 'set', slot: 'after', prodStatus: 'ok', siStatus: null, skipSi: true,
    }), true);
    assert.equal(logic.isFullyConfirmed({
      kind: 'set', slot: 'after', prodStatus: null, skipProd: true, siStatus: 'ok',
    }), true);
  });

  it('isFullyConfirmed: before slot only requires PROD (SI not applicable)', () => {
    assert.equal(logic.isFullyConfirmed({
      kind: 'set', slot: 'before', prodStatus: 'ok', siStatus: null,
    }), true);
    assert.equal(logic.isFullyConfirmed({
      kind: 'set', slot: 'before', prodStatus: null, siStatus: 'ok',
    }), false);
  });

  it('isFullyConfirmed: non-set kinds only need status done', () => {
    assert.equal(logic.isFullyConfirmed({ kind: 'cart', status: 'done' }), true);
    assert.equal(logic.isFullyConfirmed({ kind: 'before', status: 'uploading' }), false);
    assert.equal(logic.isFullyConfirmed(null), false);
  });

  it('hasLocalBytes: true whenever any local payload field is present', () => {
    assert.equal(logic.hasLocalBytes({ dataUrl: 'data:x' }), true);
    assert.equal(logic.hasLocalBytes({ blob: {} }), true);
    assert.equal(logic.hasLocalBytes({ file: {} }), true);
    assert.equal(logic.hasLocalBytes({ hasPayload: true }), true);
    assert.equal(logic.hasLocalBytes({}), false);
    assert.equal(logic.hasLocalBytes(null), false);
  });

  it('countJobs: protectedOnDevice counts jobs still holding local bytes', () => {
    const counts = logic.countJobs([
      { status: 'done', dataUrl: 'data:x' }, // done but not yet offloaded
      { status: 'done', offloaded: true }, // offloaded, no local bytes
      { status: 'uploading', blob: {} },
      { status: 'failed', error: 'replaced', dataUrl: 'data:x' }, // superseded jobs are skipped entirely
    ]);
    assert.equal(counts.protectedOnDevice, 2);
  });

  it('counts a 71-photo history without treating replaced jobs as failures', () => {
    const jobs = [];
    for (let i = 0; i < 71; i += 1) {
      jobs.push({ status: 'failed', error: 'replaced' });
    }
    jobs.push({ status: 'failed', error: 'SI timeout', dataUrl: 'x' });
    const counts = logic.countJobs(jobs);
    assert.equal(counts.failed, 1);
    assert.equal(counts.superseded, 71);
  });

  it('treats lock and still-processing errors as transient, not terminal', () => {
    assert.equal(logic.isTransientUploadError('Another field-set job is processing this set'), true);
    assert.equal(logic.isTransientUploadError('Field-set job is still processing. Try again shortly.'), true);
    assert.equal(logic.isTransientUploadError('Set is locked by another worker'), true);
    assert.equal(logic.isTransientUploadError('waiting for connection'), true);
    assert.equal(logic.isTransientUploadError('Upload failed both sides'), false);
    assert.equal(logic.isTransientUploadError('Too many upload attempts — needs attention'), false);
    assert.equal(logic.isTransientUploadError('already_present'), false);
  });

  it('excludes failed jobs with no retryable bytes from the retry badge', () => {
    const counts = logic.countJobs([
      { status: 'failed', error: 'Lost after reload — retake photo' },
      { status: 'failed', error: 'Lost after reload — retake photo', hasPayload: true },
      { status: 'failed', error: 'Another field-set job is processing this set', dataUrl: 'x' },
      { status: 'done' },
    ]);
    assert.equal(counts.failed, 1);
    assert.equal(logic.shouldRetry({ status: 'failed', error: 'Lost after reload — retake photo', hasPayload: true }), false);
  });

  it('restore drops payload-less jobs and keeps statusUrl polls', () => {
    assert.equal(logic.restoreAction({ status: 'compressed' }), 'drop');
    assert.equal(logic.restoreAction({ status: 'queued', error: 'Lost after reload — retake photo' }), 'drop');
    assert.equal(logic.restoreAction({ status: 'failed', error: 'Lost after reload — retake photo' }), 'drop');
    assert.equal(logic.restoreAction({ status: 'accepted', statusUrl: '/api/field-set/jobs/1' }), 'poll');
    assert.equal(logic.restoreAction({
      status: 'failed',
      statusUrl: '/api/field-set/jobs/1',
      error: 'Lost after reload — retake photo',
    }), 'poll');
    assert.equal(logic.restoreAction({
      status: 'failed',
      error: 'Another field-set job is processing this set',
      dataUrl: 'data:image/jpeg;base64,xx',
    }), 'requeue');
    assert.equal(logic.restoreAction({
      status: 'failed',
      error: 'Upload failed both sides',
      dataUrl: 'x',
    }), 'keep');
    assert.equal(logic.restoreAction({ status: 'done', dataUrl: 'x' }), 'keep');
    assert.equal(logic.restoreAction({ status: 'accepted', statusUrl: '/j', dataUrl: 'x' }), 'keep');
  });

  it('heals a client failed job when the statusUrl job is completed', () => {
    assert.equal(logic.remotePeekPlan({ status: 'failed', error: 'Lost after reload — retake photo' }, 'completed'), 'done');
    assert.equal(logic.remotePeekPlan({ status: 'accepted', statusUrl: '/j' }, 'Completed'), 'done');
    assert.equal(logic.remotePeekPlan({ status: 'failed', dataUrl: 'x' }, 'failed'), 'requeue');
    assert.equal(logic.remotePeekPlan({ status: 'failed' }, 'failed'), 'drop');
    assert.equal(logic.remotePeekPlan({ status: 'failed', statusUrl: '/j' }, 'retry'), 'accept');
    assert.equal(logic.remotePeekPlan({ status: 'failed', statusUrl: '/j' }, 'processing'), 'accept');
    assert.equal(logic.remotePeekPlan({ status: 'accepted', statusUrl: '/j' }, 'processing'), 'keep');
    assert.equal(logic.remotePeekPlan({ status: 'superseded' }, 'completed'), 'ignore');
  });
});


it('sessionHasProtectedJobs: blocks while unconfirmed or bytes remain', () => {
  const jobs = [
    {
      kind: 'set',
      storeNumber: '0123',
      workDate: '2026-09-17',
      slot: 'after',
      status: 'done',
      prodStatus: 'ok',
      siStatus: 'ok',
      dataUrl: 'data:x',
      hasPayload: true,
    },
  ];
  assert.equal(logic.sessionHasProtectedJobs(jobs, '123', '2026-09-17'), true);
  jobs[0].dataUrl = null;
  jobs[0].hasPayload = false;
  assert.equal(logic.sessionHasProtectedJobs(jobs, '123', '2026-09-17'), false);
});

it('sessionHasProtectedJobs: ignores other stores/dates and superseded', () => {
  const jobs = [
    {
      kind: 'set',
      storeNumber: '99',
      workDate: '2026-09-17',
      slot: 'after',
      status: 'accepted',
      hasPayload: true,
    },
    {
      kind: 'set',
      storeNumber: '123',
      workDate: '2026-09-16',
      slot: 'after',
      status: 'failed',
      error: 'replaced',
      hasPayload: true,
    },
  ];
  assert.equal(logic.sessionHasProtectedJobs(jobs, '123', '2026-09-17'), false);
  jobs.push({
    kind: 'set',
    storeNumber: '123',
    workDate: '2026-09-17',
    slot: 'after',
    status: 'accepted',
    prodStatus: null,
    siStatus: null,
    hasPayload: true,
  });
  assert.equal(logic.sessionHasProtectedJobs(jobs, '123', '2026-09-17'), true);
});

it('normalizeDbkey strips punctuation and leading zeros', () => {
  assert.equal(logic.normalizeDbkey('0123'), '123');
  assert.equal(logic.normalizeDbkey('1-023'), '1023');
  assert.equal(logic.normalizeDbkey('000'), '');
  assert.equal(logic.normalizeDbkey(null), '');
});

it('jobsToSupersede matches legacy un-normalized dbkey to fresh normalized', () => {
  const legacy = {
    id: 'old',
    kind: 'set',
    dbkey: '0123',
    slot: 'after',
    bay: 2,
    status: 'queued',
    hasPayload: true,
  };
  const fresh = {
    id: 'new',
    kind: 'set',
    dbkey: '123',
    slot: 'after',
    bay: 2,
    status: 'queued',
    hasPayload: true,
  };
  assert.equal(logic.sameBay(legacy, fresh), true);
  const doomed = logic.jobsToSupersede([legacy], fresh);
  assert.equal(doomed.length, 1);
  assert.equal(doomed[0].id, 'old');
});
