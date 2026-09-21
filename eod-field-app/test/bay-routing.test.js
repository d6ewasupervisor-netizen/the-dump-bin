'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the live-camera gate message cannot throw a ReferenceError', () => {
  const survey = read('js/features/set-survey.js');

  // flashToast is declared inside openLiveCamera; enqueueLocal lives in
  // render()'s scope and cannot see it. Calling it there threw instead of
  // telling the shooter why the capture was refused.
  const openCamera = survey.indexOf('function openLiveCamera');
  const flashDecl = survey.indexOf('function flashToast');
  const enqueueLocal = survey.indexOf('async function enqueueLocal');
  assert.ok(flashDecl > openCamera, 'flashToast is scoped inside openLiveCamera');
  assert.ok(enqueueLocal > flashDecl, 'enqueueLocal is a separate scope');

  const body = survey.slice(enqueueLocal, survey.indexOf('function loadPlanogram'));
  assert.doesNotMatch(body, /(?<!activeCameraToast\?\.\()\bflashToast\(/,
    'enqueueLocal must not call flashToast directly');
  assert.match(body, /activeCameraToast\?\.\(gate\.message\)/);

  // The publisher must be set when a camera opens and cleared when it stops.
  assert.match(survey, /let activeCameraToast = null;/);
  assert.match(survey, /activeCameraToast = flashToast;/);
  assert.match(survey, /if \(activeCameraToast === flashToast\) activeCameraToast = null;/);
});

test('reconcile only collects pipeline jobs for the open store and day', () => {
  const rec = read('js/lib/set-photo-reconcile.js');
  const jobBranch = rec.slice(rec.indexOf('EodPhotoPipeline?.listJobs'), rec.indexOf('async function collectDevicePhotos'));

  // pushOne stamps the body with the live session store/date, so an unscoped
  // job from another store or an earlier day would attach to today's reset.
  assert.match(jobBranch, /if \(!sameStore\(job\.storeNumber, store\)\) continue;/);
  assert.match(jobBranch, /String\(job\.workDate\) !== String\(S\.state\.workDate\)\) continue;/);
  assert.match(rec, /function sameStore/);
  // An unstamped job must not be assumed to belong here.
  assert.match(rec, /return !!x && !!y && x === y;/);
});

test('the two lanes no longer both own the same bay', () => {
  const rec = read('js/lib/set-photo-reconcile.js');

  assert.match(rec, /const PIPELINE_OWNED = new Set\(\[/);
  for (const status of ['superseded', 'done', 'accepted', 'uploading', 'reconciling']) {
    assert.match(rec, new RegExp(`'${status}'`), `${status} must be pipeline-owned`);
  }
  assert.match(rec, /if \(PIPELINE_OWNED\.has\(job\.status\)\) continue;/);
  // The safety-net statuses must still flow through the reconcile lane.
  const owned = /const PIPELINE_OWNED = new Set\(\[([^\]]+)\]\)/.exec(rec)[1];
  for (const keep of ['compressed', 'failed', 'queued']) {
    assert.ok(!owned.includes(keep), `${keep} must stay available to the reconcile lane`);
  }
});

test('a failed inventory no longer pushes every bay on the device', () => {
  const rec = read('js/lib/set-photo-reconcile.js');

  assert.match(rec, /const endpointMissing = invResp\.status === 404 \|\| invResp\.status === 405;/);
  assert.match(rec, /if \(!invResp\.ok && !endpointMissing\) \{/);
  assert.match(rec, /EodDiag\?\.note\?\.\('reconcile\.inventory'/);
  // Push-all survives only for a server that lacks the endpoint entirely.
  assert.match(rec, /endpointMissing \? photos\.map/);
  // The old unconditional fallback is gone.
  assert.doesNotMatch(rec, /Array\.isArray\(inv\.pull\) \? inv\.pull : photos\.map/);
});

test('listJobs exposes the routing ids the reconcile lane needs', () => {
  const pipeline = read('js/lib/photo-pipeline.js');
  const publicJob = pipeline.slice(pipeline.indexOf('function publicJob'), pipeline.indexOf('function dropLocalPreview'));

  // Without these the reconcile lane read undefined and fell back to a warm
  // cache that capture deliberately drops, so pushes carried a null resetId.
  for (const field of ['visitId', 'resetId', 'taskId', 'fileName', 'expectedBayCount', 'bufferedId']) {
    assert.match(publicJob, new RegExp(`${field}:`), `publicJob must expose ${field}`);
  }
  // Store and date have to be there too or the scoping test above cannot work.
  assert.match(publicJob, /storeNumber:/);
  assert.match(publicJob, /workDate:/);
});

test('bay index is explicit in both upload lanes', () => {
  const pipeline = read('js/lib/photo-pipeline.js');
  const rec = read('js/lib/set-photo-reconcile.js');

  // Upload order is attempt-ordered, not bay-ordered, so the server must never
  // be left to infer position from arrival order.
  assert.match(pipeline, /slot: job\.slot,\s*\n\s*bay: job\.bay,/);
  assert.match(rec, /slot: item\.slot,\s*\n\s*bay: item\.bay,/);
});
