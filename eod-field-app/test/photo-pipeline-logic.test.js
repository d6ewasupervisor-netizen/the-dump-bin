'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../js/lib/photo-pipeline-logic');

describe('photo-pipeline-logic', () => {
  it('excludes superseded and replaced jobs from failed counts', () => {
    const counts = logic.countJobs([
      { status: 'failed', error: 'replaced' },
      { status: 'superseded' },
      { status: 'failed', error: 'timeout' },
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
});
