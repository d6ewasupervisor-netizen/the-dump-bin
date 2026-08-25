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
