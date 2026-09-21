'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logic = require('../js/lib/photo-pipeline-logic');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const NOW = 1_700_000_000_000;

test('a buffered bay with no statusUrl is reported stalled, not in-flight', () => {
  // offloadBufferedBay produces exactly this shape from a reconcile ack.
  const job = { status: 'accepted', statusUrl: null, bufferedId: 'b1', updatedAt: NOW - 60_000 };
  assert.equal(logic.stallKind(job, NOW), 'buffered');

  // The same job with a statusUrl is reachable by pollAcceptedJobs, so it is fine.
  assert.equal(logic.stallKind({ ...job, statusUrl: '/jobs/1' }, NOW), null);
  // And it is not stalled until it has actually sat there a while.
  assert.equal(logic.stallKind({ ...job, updatedAt: NOW - 1_000 }, NOW), null);
});

test('an upload that outlives the request ceiling is reported stalled', () => {
  assert.equal(logic.stallKind({ status: 'uploading', updatedAt: NOW - 5 * 60_000 }, NOW), 'uploading');
  assert.equal(logic.stallKind({ status: 'reconciling', updatedAt: NOW - 5 * 60_000 }, NOW), 'uploading');
  // 180s write ceiling means a 60s-old upload is still perfectly normal.
  assert.equal(logic.stallKind({ status: 'uploading', updatedAt: NOW - 60_000 }, NOW), null);
});

test('done and superseded jobs are never counted as stalled', () => {
  const old = NOW - 60 * 60_000;
  assert.equal(logic.stallKind({ status: 'done', updatedAt: old }, NOW), null);
  assert.equal(logic.stallKind({ status: 'superseded', updatedAt: old }, NOW), null);
  assert.equal(logic.stallKind({ status: 'failed', error: 'replaced', updatedAt: old }, NOW), null);
});

test('countStalled separates buffered from wedged uploads', () => {
  const counts = logic.countStalled([
    { status: 'accepted', statusUrl: null, updatedAt: NOW - 60_000 },
    { status: 'accepted', statusUrl: null, updatedAt: NOW - 60_000 },
    { status: 'uploading', updatedAt: NOW - 5 * 60_000 },
    { status: 'uploading', updatedAt: NOW - 1_000 },
    { status: 'done', updatedAt: NOW - 60 * 60_000 },
  ], NOW);
  assert.deepEqual(counts, { buffered: 2, uploading: 1, total: 3 });
});

test('upload scheduling gives every photo an attempt before anyone gets a second', () => {
  // 30 captures, every upload fails. Under the old ready.find() rule the two
  // earliest jobs traded the single slot forever and #30 never started.
  const jobs = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, attempts: 0 }));
  const started = [];

  for (let slot = 0; slot < 30; slot += 1) {
    const next = logic.pickNextUpload(jobs, new Set());
    assert.ok(next, 'scheduler must always pick a ready job');
    started.push(next.id);
    next.attempts += 1;
  }

  assert.equal(new Set(started).size, 30, 'all 30 photos must get a first attempt');
  assert.deepEqual(started, jobs.map((j) => j.id), 'and in capture order');
  assert.ok(jobs.every((j) => j.attempts === 1));
});

test('a repeatedly failing photo cannot starve the rest', () => {
  const jobs = [
    { id: 'bad', attempts: 7 },
    { id: 'fresh-a', attempts: 0 },
    { id: 'fresh-b', attempts: 0 },
  ];
  assert.equal(logic.pickNextUpload(jobs, new Set()).id, 'fresh-a');
  jobs[1].attempts = 1;
  assert.equal(logic.pickNextUpload(jobs, new Set()).id, 'fresh-b');
});

test('replace batches still take priority and stay bay-ordered', () => {
  const jobs = [
    { id: 'plain', attempts: 0 },
    { id: 'r3', replace: true, replaceBatchId: 'b', bay: 3 },
    { id: 'r1', replace: true, replaceBatchId: 'b', bay: 1 },
  ];
  assert.equal(logic.pickNextUpload(jobs, new Set()).id, 'r1');
  // A batch already uploading must not be double-picked; plain work resumes.
  assert.equal(logic.pickNextUpload(jobs, new Set(['b'])).id, 'plain');
});

test('transient classification covers the phrasings that were failing terminally', () => {
  // defaultCartUpload throws this, and /timeout/ does not match 'timed out'.
  assert.ok(logic.isTransientUploadError('PROD cart upload timed out'));
  assert.ok(logic.isTransientUploadError('Request timeout after 180s'));
  assert.ok(logic.isTransientUploadError('Upload failed (500)'));
  assert.ok(logic.isTransientUploadError('Upload failed (504)'));
  assert.ok(logic.isTransientUploadError('Load failed'), 'Safari offline TypeError');
  // A genuine user cancel must stay terminal.
  assert.ok(!logic.isTransientUploadError('The user aborted a request.'));
});

test('the pipeline can reach and retire a buffered-only job', () => {
  const pipeline = read('js/lib/photo-pipeline.js');

  // reconcileOpenJobs must accept 'accepted' without a statusUrl, and must not
  // hold it to the dataUrl/file requirement since its bytes may be offloaded.
  assert.match(pipeline, /const buffered = job\.status === 'accepted' && !job\.statusUrl;/);
  assert.match(pipeline, /if \(!buffered && !job\.dataUrl && !job\.file\) continue;/);

  // A sweep has to actually run on a timer, not only at start().
  assert.match(pipeline, /STALL_SWEEP_MS/);
  assert.match(pipeline, /function startStallSweep/);
  assert.match(pipeline, /setInterval\(\(\) => \{ void sweepStalled\(\); \}, STALL_SWEEP_MS\)/);
  assert.match(pipeline, /startStallSweep\(\);/);

  // The scheduler must go through the fair picker, with find() only as the
  // no-Logic fallback.
  const pump = pipeline.slice(pipeline.indexOf('async function pump'));
  assert.match(pump, /Logic\.pickNextUpload\s*\n?\s*\?\s*Logic\.pickNextUpload\(ready, uploadingReplace\)/);
});

test('reconcile drains on a time budget and can announce an already-buffered set', () => {
  const rec = read('js/lib/set-photo-reconcile.js');

  assert.match(rec, /PUSH_BUDGET_MS/);
  assert.doesNotMatch(rec, /if \(n >= 8\) break;/, 'the flat 8-bay cap must be gone');
  assert.match(rec, /Date\.now\(\) > deadline\) break;/);

  // Gating notify on n > 0 meant a set buffered on an earlier tick never fired.
  assert.match(rec, /if \(invResp\.ok \|\| n > 0 \|\| closedDbkeys\.size > 0\)/);

  // The after-bay gate must use the cached check, and must not fail silently.
  assert.match(rec, /requireConnectedFast/);
  assert.match(rec, /skippedForAuth/);
  assert.match(rec, /authBlockedCount/);
});

test('authFetch keeps its abort armed through the response body read', () => {
  const api = read('js/api.js');
  const body = api.slice(api.indexOf('async function authFetch'), api.indexOf('function dayConfirmHeaders'));

  // Clearing in a finally would disarm the signal the moment headers land,
  // leaving every await resp.json() unprotected.
  assert.doesNotMatch(body, /finally\s*\{\s*if \(timer\) clearTimeout\(timer\);/);
  // It must still be cleared on the error path.
  assert.match(body, /catch \(err\) \{\s*\n\s*if \(timer\) clearTimeout\(timer\);/);
  // Exactly one fetch call, not the duplicated pair from an earlier edit.
  assert.equal((body.match(/return await fetch\(url, pass\);/g) || []).length, 1);
});
