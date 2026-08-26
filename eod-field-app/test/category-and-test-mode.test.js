'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beforePillState,
  beforePillHtml,
  siLocationLabel,
} = require('../js/lib/category-card-status');
const {
  hasLoadedShift,
  applyToPayload,
} = require('../js/lib/eod-test-mode-logic');

test('before pill: PROD befores hide the local "no befores" warning', () => {
  const state = beforePillState({ live: { prodStatus: 'open', prodBeforeCount: 4 } }, 0);
  assert.deepEqual(state, { kind: 'ok', count: 4 });
  assert.match(beforePillHtml(state), /4 befores/);
});

test('before pill: local befores count even before live loads', () => {
  const state = beforePillState({}, 2);
  assert.deepEqual(state, { kind: 'ok', count: 2 });
});

test('before pill: warn only when the set is in PROD and neither side has befores', () => {
  assert.equal(beforePillState({ live: { prodStatus: 'open', prodBeforeCount: 0 } }, 0).kind, 'warn');
  assert.equal(beforePillState({ live: { prodStatus: 'done', prodBeforeCount: 0 } }, 0).kind, 'warn');
});

test('before pill: hidden when not in PROD or live has not loaded', () => {
  assert.equal(beforePillState({ live: { prodStatus: 'absent', prodBeforeCount: 0 } }, 0).kind, 'hidden');
  assert.equal(beforePillState({}, 0).kind, 'hidden');
  assert.equal(beforePillHtml({ kind: 'hidden' }), '');
});

test('SI location label uses live.siLocation.label', () => {
  assert.equal(
    siLocationLabel({ live: { siLocation: { label: 'Aisle 12 · 01-GROCERY · 6 bays' } } }),
    'Aisle 12 · 01-GROCERY · 6 bays'
  );
  assert.equal(siLocationLabel({ live: {} }), '');
});

test('hasLoadedShift is true for a real store with a visit or sheet', () => {
  assert.equal(hasLoadedShift({ storeNumber: '19', selectedShift: { visitId: 'abc' } }), true);
  assert.equal(hasLoadedShift({ storeNumber: '19', sheet: { rows: [{ id: 1 }] } }), true);
  assert.equal(hasLoadedShift({ storeNumber: '19' }), false);
  assert.equal(hasLoadedShift({ storeNumber: '999', selectedShift: { visitId: 'x' } }), false);
  assert.equal(hasLoadedShift({ storeNumber: '', selectedShift: { visitId: 'x' } }), false);
});

test('applyToPayload in test mode keeps the current store and routes mail to tester', () => {
  const out = applyToPayload(
    {
      storeNumber: '19',
      recipients: ['wolf@example.com'],
      subject: 'KOMPASS EOD FM019',
    },
    { testMode: true }
  );
  assert.equal(out.storeNumber, '19');
  assert.equal(out.testMode, true);
  assert.deepEqual(out.recipients, ['tyson.gauthier@retailodyssey.com']);
  assert.equal(out.subject, '[TEST] KOMPASS EOD FM019');
});

test('applyToPayload without test mode leaves a live store alone', () => {
  const payload = { storeNumber: '19', recipients: ['wolf@example.com'] };
  assert.equal(applyToPayload(payload, { testMode: false }), payload);
});

const fs = require('fs');
const path = require('path');

test('section nav places signatures between categories and crew', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/section-nav.js'), 'utf8');
  const ids = [...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
  const i = ids.indexOf('signoff');
  assert.ok(i >= 0);
  assert.equal(ids[i + 1], 'signatures');
  assert.equal(ids[i + 2], 'crew');
});

test('section nav uses section names and a Top control, not Previous/Next', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/section-nav.js'), 'utf8');
  assert.match(src, /id="sectionNavTop"/);
  assert.match(src, />Top</);
  assert.doesNotMatch(src, />\s*Previous\s*</);
  assert.doesNotMatch(src, />\s*Next\s*</);
  assert.match(src, /prev\.label/);
  assert.match(src, /next\.label/);
});

test('theme cycle includes dark, inverse, light, gray, holiday', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/theme.js'), 'utf8');
  assert.match(src, /\['dark', 'inverse', 'light', 'gray', 'holiday'\]/);
});

test('bottom nav lists a signatures route and theme cycle control', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /data-nav="signatures"/);
  assert.match(html, /id="themeCycleBtn"/);
  assert.match(html, /js\/features\/signatures\.js/);
  assert.match(html, /js\/features\/theme\.js/);
  for (const name of ['visit', 'categories', 'signatures', 'crew', 'dumpbin', 'send', 'helpdesk']) {
    assert.match(html, new RegExp(`icons/nav/${name}\\.png`));
  }
});

test('section nav host is pinned outside page content', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="sectionNavHost"/);
  const src = fs.readFileSync(path.join(__dirname, '../js/features/section-nav.js'), 'utf8');
  assert.match(src, /sectionNavHost/);
});

test('crew sheet no longer includes the materials card', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/crew.js'), 'utf8');
  assert.doesNotMatch(src, /<h2>Materials<\/h2>/);
  assert.doesNotMatch(src, /openMaterialsBtn/);
});

test('index.html loads send-sheet rasterizer before send.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /js\/lib\/pdf-to-image\.js/);
  assert.match(html, /js\/lib\/eod-send-sheets\.js/);
  const sendIdx = html.indexOf('js/features/send.js');
  const sheetsIdx = html.indexOf('js/lib/eod-send-sheets.js');
  assert.ok(sheetsIdx > 0 && sheetsIdx < sendIdx);
});

test('dump-bin does not steal the photos route', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/dump-bin.js'), 'utf8');
  assert.doesNotMatch(src, /register\('photos'/);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /js\/features\/photos\.js/);
  const dumpIdx = html.indexOf('js/features/dump-bin.js');
  const photosIdx = html.indexOf('js/features/photos.js');
  assert.ok(photosIdx > dumpIdx);
});

test('pilot ships overlay alerts, roles, camera, and PIC QR', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const file of [
    'js/lib/eod-alerts.js',
    'js/lib/eod-roles.js',
    'js/lib/heic.js',
    'js/lib/eod-camera.js',
    'js/features/pic-qr.js',
    'js/features/feedback-hub.js',
  ]) {
    assert.match(html, new RegExp(file.replace(/\./g, '\\.')));
  }
});

test('InstaWork save URL is the hosted eod-api, never localhost', () => {
  const photos = fs.readFileSync(path.join(__dirname, '../js/features/photos.js'), 'utf8');
  const crew = fs.readFileSync(path.join(__dirname, '../js/features/crew.js'), 'utf8');
  assert.match(photos, /https:\/\/eod-api\.the-dump-bin\.com\/instawork\/save-image/);
  assert.match(crew, /https:\/\/eod-api\.the-dump-bin\.com\/instawork\/save-image/);
  assert.doesNotMatch(photos, /127\.0\.0\.1/);
  assert.doesNotMatch(crew, /127\.0\.0\.1/);
});
