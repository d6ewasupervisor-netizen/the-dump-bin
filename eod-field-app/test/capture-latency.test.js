'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function policies(src) {
  const out = {};
  const rx = /(\w+): \{ maxEdge: (\d+), maxBytes: ([^,]+), startQuality: ([\d.]+), minQuality: ([\d.]+)/g;
  let m;
  while ((m = rx.exec(src))) {
    out[m[1]] = {
      maxEdge: Number(m[2]),
      maxBytes: m[3].trim(),
      startQuality: Number(m[4]),
      minQuality: Number(m[5]),
    };
  }
  return out;
}

test('worker policies match the main-thread compressor for every shared type', () => {
  const worker = policies(read('js/workers/photo-compress-worker.js'));
  const main = policies(read('js/lib/photo-compress.js'));

  assert.ok(Object.keys(main).length >= 6, 'expected the full main-thread policy table');

  for (const [name, want] of Object.entries(main)) {
    const got = worker[name];
    assert.ok(got, `worker is missing the ${name} policy, so ${name} photos would fall back to default and lose resolution`);
    assert.equal(got.maxEdge, want.maxEdge, `${name} maxEdge drifted`);
    assert.equal(got.startQuality, want.startQuality, `${name} startQuality drifted`);
    assert.equal(got.minQuality, want.minQuality, `${name} minQuality drifted`);
  }
});

test('the durable persist encode never caps below the widest policy', () => {
  const pipeline = read('js/lib/photo-pipeline.js');
  const main = policies(read('js/lib/photo-compress.js'));
  const cap = Number(/DURABLE_MAX_EDGE = (\d+)/.exec(pipeline)[1]);
  const widest = Math.max(...Object.values(main).map((p) => p.maxEdge));

  assert.ok(cap >= widest,
    `DURABLE_MAX_EDGE ${cap} would downscale below the widest policy (${widest})`);
});

test('the set shutter downscales before encoding its thumbnail', () => {
  const survey = read('js/features/set-survey.js');

  assert.match(survey, /function thumbDataUrl/);
  assert.match(survey, /THUMB_MAX_EDGE/);
  const edge = Number(/THUMB_MAX_EDGE = (\d+)/.exec(survey)[1]);
  assert.ok(edge > 0 && edge <= 640, 'thumbnail edge should stay small');

  // The capture path must not encode the full-resolution canvas any more.
  assert.doesNotMatch(survey, /shot\.canvas\.toDataURL/);
  assert.match(survey, /thumbDataUrl\(shot\.canvas\)/);
});

test('the shutter gate reads cached auth instead of waiting on the network', () => {
  const survey = read('js/features/set-survey.js');
  const login = read('js/features/sas-user-login.js');
  const rec = read('js/lib/set-photo-reconcile.js');

  // Helpers remain for Connections / chrome, but set capture no longer waits on
  // per-lead PROD (retired 3.5.27 — office SAS session carries uploads).
  assert.match(login, /async function requireConnectedFast/);
  assert.match(login, /requireConnectedFast,/, 'must be exported');
  assert.match(login, /void fetchStatus\(true\)/);
  assert.doesNotMatch(survey, /requireConnectedFast/);
  assert.doesNotMatch(survey, /EodSasUser\?\.requireConnected/);
  assert.match(rec, /Provider sign-in retired: no auth gate/);
  // Live-camera toast still exists for other capture messages.
  assert.match(survey, /if \(liveCameraOpen\) activeCameraToast\?\.\(text\)/);
});

test('cart, signoff and InstaWork compress off the main thread', () => {
  const photos = read('js/features/photos.js');
  const pipeline = read('js/lib/photo-pipeline.js');
  const boot = read('js/boot.js');

  assert.match(pipeline, /async function compressFileInWorker/);
  assert.match(pipeline, /compressFileInWorker,/, 'must be exported');
  assert.match(pipeline, /function warmCompressWorker/);

  // Worker is tried first, with the main-thread compressor still behind it.
  assert.ok(
    photos.indexOf('compressFileInWorker') < photos.indexOf('EodPhotoCompress?.compressFile'),
    'the worker path must come before the main-thread fallback'
  );
  assert.match(photos, /EodPhotoCompress\?\.compressFile/, 'fallback must survive');

  // Warm it at boot so the first photo does not pay for worker startup.
  assert.match(boot, /warmCompressWorker/);
});
