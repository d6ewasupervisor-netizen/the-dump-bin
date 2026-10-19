'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('Audit is an extra route: side nav, More menu, section order, router, bundle', () => {
  assert.match(read('index.html'), /data-nav="audit" data-slot="extra"/);
  assert.match(read('js/chrome.js'), /data-more="audit"/);
  const order = read('js/features/section-nav.js');
  assert.ok(order.indexOf("id: 'audit'") > order.indexOf("id: 'scans'"));
  const router = read('js/router.js');
  assert.match(router, /audit: 4/);
  assert.match(router, /'scans', 'audit'\]\.includes\(name\)/);
  const bundles = read('js/lib/route-bundles.js');
  assert.match(bundles, /audit: \[\s*'js\/features\/location-audit\.js',\s*\]/);
  assert.match(bundles, /audit: 'audit'/);
  assert.match(bundles, /audit: 'css\/location-audit\.css'/);
  assert.match(read('js/lib/swipe-nav.js'), /'visit', 'signoff', 'signatures', 'send'/);
  assert.doesNotMatch(read('js/lib/swipe-nav.js'), /audit/);
});

test('the sidebar Audit button is hidden for anyone who is not a lead, supervisor, or admin', () => {
  assert.match(read('css/app.css'), /body:not\(\.role-lead\):not\(\.role-supervisor\):not\(\.role-admin\) \.bottom-nav \[data-nav="audit"\]/);
});

test('the page registers with the router without throwing when the router is missing', () => {
  delete globalThis.EodRouter;
  require('../js/features/location-audit.js');
  assert.equal(typeof globalThis.EodLocationAudit.render, 'function');
  assert.match(read('js/features/location-audit.js'), /global\.EodRouter\?\.register\?\.\('audit', render\)/);
});

test('progress: a set is ready only when the set check, checks, strips, and owed photos are in', () => {
  require('../js/features/location-audit.js');
  const { progress } = globalThis.EodLocationAudit;
  const d = {
    set: { setChecks: { setMatches: 'yes', aisleMatches: 'yes', bayOrder: 'unsure' } },
    shelves: [{ bay: 1, fix: 2 }, { bay: 1, fix: 1 }],
    items: [
      { id: 'a', bay: 1, fix: 2, pos: 1, checkKind: 'flagged', answer: 'kroger_wrong' },
      { id: 'b', bay: 1, fix: 1, pos: 1, checkKind: 'spot', answer: 'match' },
    ],
    strips: [
      { bay: 1, fix: 2, skin: 'ok', indicators: 'match', tags: 'match' },
      { bay: 1, fix: 1, skin: 'damaged', indicators: 'match', tags: 'match' },
    ],
    photos: [{ kind: 'bay', bay: 1 }],
  };
  let p = progress(d);
  assert.equal(p.ready, false);
  assert.deepEqual(p.missingPhotos.map((m) => m.kind).sort(), ['item', 'strip']);
  assert.equal(p.suggestedVerdict, 'incorrect');
  d.photos.push({ kind: 'item', itemId: 'a' }, { kind: 'strip', bay: 1, fix: 1 });
  p = progress(d);
  assert.equal(p.ready, true);
  assert.equal(p.counts.krogerWrong, 1);
  assert.equal(p.counts.stripIssues, 1);
});

test('location lines read the way the shelf is labeled', () => {
  require('../js/features/location-audit.js');
  const { krogerLine, pogLine } = globalThis.EodLocationAudit;
  assert.equal(
    krogerLine({ found: true, primary: { aisle: '17', side: 'R', bay: '25', shelf: '5', position: '2', facings: '1' } }),
    'Aisle 17 right · Bay 25 · Shelf 5 · Position 2 · 1 facing'
  );
  assert.equal(krogerLine({ found: true, primary: { aisle: '0', description: 'DRUG/GM' } }), 'DRUG/GM');
  assert.equal(krogerLine({ found: false }), 'Not listed at this store');
  assert.equal(pogLine({ bay: 1, fix: 6, pos: 2, facings: 2, widthIn: 5.25 }), 'Bay 1 · Shelf 6 · Position 2 · 2 facings · 5.25 in wide');
});
