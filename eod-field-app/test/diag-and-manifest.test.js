'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diag = require('../js/lib/eod-diag');
const logic = require('../js/lib/photo-pipeline-logic');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('diag counts swallowed failures without changing control flow', () => {
  diag.reset();
  diag.note('reconcile.push', new Error('413 payload too large'));
  diag.note('reconcile.push', new Error('413 payload too large'));
  diag.note('flush.bytes-missing');

  assert.equal(diag.count('reconcile.push'), 2);
  assert.equal(diag.count('flush.bytes-missing'), 1);
  assert.equal(diag.count('never.happened'), 0);
  assert.equal(diag.total(), 3);

  const snap = diag.snapshot();
  assert.equal(snap.counts['reconcile.push'], 2);
  assert.equal(snap.recent[0].code, 'flush.bytes-missing', 'most recent first');
  assert.match(snap.recent[1].detail, /413/);
  assert.match(diag.summaryText(), /reconcile\.push 2/);
});

test('diag never throws, whatever it is handed', () => {
  diag.reset();
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => {
    diag.note(null);
    diag.note(undefined, undefined);
    diag.note('x', circular);
    diag.note({}, []);
  });
  assert.equal(diag.summaryText(0), '');
});

test('diag keeps the recent list bounded', () => {
  diag.reset();
  for (let i = 0; i < 500; i += 1) diag.note('spam', `n${i}`);
  assert.equal(diag.count('spam'), 500, 'counts are exact');
  assert.ok(diag.snapshot().recent.length <= 15, 'but the log is trimmed');
});

test('a photo whose durable write failed is counted as unsaved', () => {
  const counts = logic.countJobs([
    { status: 'compressed', dataUrl: 'data:image/jpeg;base64,xx', idbWriteFailed: true },
    { status: 'compressed', dataUrl: 'data:image/jpeg;base64,xx', _idbWriteFailed: true },
    { status: 'compressed', dataUrl: 'data:image/jpeg;base64,xx' },
    // Offloaded: the write failed but the bytes are gone anyway, nothing at risk.
    { status: 'done', idbWriteFailed: true },
  ]);
  assert.equal(counts.unsaved, 2);
});

test('reconcile builds its manifest without decoding every photo', () => {
  const rec = read('js/lib/set-photo-reconcile.js');

  assert.match(rec, /async function collectDeviceManifest/);
  assert.match(rec, /function hasResolvableBytes/);

  // The manifest must carry a source reference, not bytes.
  const manifest = rec.slice(rec.indexOf('async function collectDeviceManifest'), rec.indexOf('async function collectDevicePhotos'));
  assert.match(manifest, /source: p,/);
  assert.doesNotMatch(manifest, /const photoBase64 = await resolvePhotoBase64/);

  // Decoding happens in the push loop, for wanted bays only.
  assert.match(rec, /if \(!item\.photoBase64\) item\.photoBase64 = await resolvePhotoBase64\(item\.source\);/);
  // And the decoded copy is released rather than held for the whole tick.
  assert.match(rec, /item\.photoBase64 = null;/);
  // tick() must use the lazy manifest, not the eager collector.
  assert.match(rec, /const photos = await collectDeviceManifest\(\);/);
  // Already-delivered jobs should not be re-offered at all. Ship F widened
  // this from a bare 'done' check to the full pipeline-owned set.
  assert.match(rec, /if \(PIPELINE_OWNED\.has\(job\.status\)\) continue;/);
  assert.match(rec, /const PIPELINE_OWNED = new Set\(\[[^\]]*'done'/);
});

test('the swallowed paths that could lose a photo now report themselves', () => {
  const rec = read('js/lib/set-photo-reconcile.js');
  const flush = read('js/lib/device-photo-flush.js');
  const pipeline = read('js/lib/photo-pipeline.js');
  const html = read('index.html');

  assert.match(rec, /EodDiag\?\.note\?\.\('reconcile\.push'/);
  assert.match(rec, /EodDiag\?\.note\?\.\('reconcile\.bytes-missing'/);
  assert.match(rec, /EodDiag\?\.note\?\.\('reconcile\.decode-failed'/);
  assert.match(flush, /EodDiag\?\.note\?\.\('flush\.bytes-missing'/);
  assert.match(pipeline, /EodDiag\?\.note\?\.\('pipeline\.restore'/);
  assert.match(pipeline, /EodDiag\?\.note\?\.\('pipeline\.accepted-poll'/);
  assert.match(pipeline, /EodDiag\?\.note\?\.\('pipeline\.idb-write'/);

  // Must load before anything that reports into it.
  assert.match(html, /js\/lib\/eod-diag\.js/);
  assert.ok(html.indexOf('eod-diag.js') < html.indexOf('photo-pipeline.js'));
});

test('the two attempt ceilings are named for what they actually gate', () => {
  const pipeline = read('js/lib/photo-pipeline.js');
  assert.match(pipeline, /MAX_TRANSIENT_ATTEMPTS = 40/);
  assert.match(pipeline, /job\.attempts < MAX_TRANSIENT_ATTEMPTS/);
  // The bare 40 that read as if MAX_SET_ATTEMPTS were the real cap is gone.
  assert.doesNotMatch(pipeline, /job\.attempts < 40/);
  assert.match(pipeline, /job\.attempts >= MAX_SET_ATTEMPTS/);
});
