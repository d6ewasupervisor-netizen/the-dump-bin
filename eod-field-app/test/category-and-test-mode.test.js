'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beforePillState,
  beforePillHtml,
  siLocationLabel,
  matchesSheetFilters,
  formatEstHrs,
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

test('sheet filters: Done / Not Done plus leftover prod/si/nis keys', () => {
  const done = {
    live: { prodComplete: true, prodStatus: 'done', siComplete: true, siStatus: 'completed' },
    marks: { active: ['complete'] },
  };
  const open = {
    live: { prodStatus: 'open', siPresent: true, siStatus: 'in_progress' },
    marks: { active: [] },
  };
  const nis = { live: { prodStatus: 'absent' }, marks: { notInStore: true, active: ['not_in_store'] } };
  const nisi = { live: { siPresent: false }, marks: { notInSi: true, active: ['not_in_si'] } };
  assert.equal(matchesSheetFilters(done, { status: 'done' }), true);
  assert.equal(matchesSheetFilters(open, { status: 'done' }), false);
  assert.equal(matchesSheetFilters(open, { status: 'not_done' }), true);
  assert.equal(matchesSheetFilters(done, { status: 'not_done' }), false);
  assert.equal(matchesSheetFilters(nis, { status: 'done' }), true);
  assert.equal(matchesSheetFilters(nisi, { status: 'done' }), true);
  assert.equal(matchesSheetFilters(done, { prod: 'done', si: 'done' }), true);
  assert.equal(matchesSheetFilters(open, { prod: 'done' }), false);
  assert.equal(matchesSheetFilters(open, { prod: 'not_done', si: 'not_done' }), true);
  assert.equal(matchesSheetFilters(nis, { notInStore: true }), true);
  assert.equal(matchesSheetFilters(open, { notInStore: true }), false);
  assert.equal(matchesSheetFilters(nisi, { notInSi: true }), true);
  assert.equal(matchesSheetFilters(nis, { notInStore: true, notInSi: true }), true);
});

test('formatEstHrs shows minutes under an hour', () => {
  assert.equal(formatEstHrs(0.5), 'Est 30 min');
  assert.equal(formatEstHrs(1), 'Est 1 hr');
  assert.equal(formatEstHrs(''), '');
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
  const saver = fs.readFileSync(path.join(__dirname, '../js/lib/eod-instawork-save.js'), 'utf8');
  const photos = fs.readFileSync(path.join(__dirname, '../js/features/photos.js'), 'utf8');
  const crew = fs.readFileSync(path.join(__dirname, '../js/features/crew.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /js\/lib\/eod-instawork-save\.js/);
  assert.match(html, /id="instaworkBufferOverlay"/);
  assert.match(saver, /https:\/\/eod-api\.the-dump-bin\.com\/instawork\/save-image/);
  assert.match(saver, /OVERLAY_MIN_MS = 4000/);
  assert.match(saver, /ensurePortraitOrientation/);
  assert.doesNotMatch(saver, /127\.0\.0\.1/);
  assert.doesNotMatch(photos, /127\.0\.0\.1/);
  assert.doesNotMatch(crew, /127\.0\.0\.1/);
  assert.doesNotMatch(saver, /localhost:\d+/);
});

test('Visit confirm loads shifts; Find shifts button is gone', () => {
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  assert.doesNotMatch(visit, /findShiftsBtn/);
  assert.match(visit, /Confirm store to load shifts/);
  assert.match(visit, /busyForce: true/);
});

test('compass buffering overlay ships and wraps slow authFetch', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const busy = fs.readFileSync(path.join(__dirname, '../js/lib/eod-buffering.js'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  assert.match(html, /js\/lib\/eod-buffering\.js/);
  assert.match(html, /id="eodBuffering"/);
  assert.match(html, /assets\/buffering\.gif/);
  assert.match(busy, /assets\/buffering\.gif/);
  assert.match(busy, /wrapAuthFetch/);
  assert.match(busy, /digital-signoffs/);
  assert.match(busy, /\(\?:sync\|heartbeat\)/);
  assert.match(busy, /MAX_VISIBLE_MS = 12000/);
  assert.match(busy, /dismissBusy/);
  assert.match(signoff, /skipBusy: true/);
  assert.match(survey, /skipBusy: true/);
});

test('Not in store prompt uses Don\'t Report / Please Report / Cancel before marking', () => {
  const wizard = fs.readFileSync(path.join(__dirname, '../js/features/helpdesk-wizard.js'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  assert.match(wizard, /Don't Report/);
  assert.match(wizard, /Please Report/);
  assert.match(wizard, /id: 'cancel', label: 'Cancel'/);
  assert.match(signoff, /askToReportNotInStore/);
  assert.match(signoff, /nisChoice === 'cancel'/);
  assert.match(signoff, /openHelpdeskForSheetRow/);
  assert.doesNotMatch(signoff, /skipHelpdeskPrompt/);
});

test('Categories sheet has Done / Not Done pills; Clear, Complete all, ack, and print are gone', () => {
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  const session = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');
  assert.match(signoff, /id="sheetFilters"/);
  assert.match(signoff, /data-filter="status"/);
  assert.match(signoff, /data-value="done">Done/);
  assert.match(signoff, /data-value="not_done">Not Done/);
  assert.doesNotMatch(signoff, /data-filter="prod"/);
  assert.doesNotMatch(signoff, /data-filter="si"/);
  assert.doesNotMatch(signoff, /data-filter="notInStore"/);
  assert.doesNotMatch(signoff, /data-filter="notInSi"/);
  assert.doesNotMatch(signoff, /data-mark="clear"/);
  assert.doesNotMatch(signoff, /id="completeAllBtn"/);
  assert.doesNotMatch(signoff, /id="ackRemainingBtn"/);
  assert.doesNotMatch(signoff, /id="printSignoffBtn"/);
  assert.match(signoff, /formatEstHrs/);
  assert.match(send, /id="sendPrintSignoffBtn"/);
  assert.match(send, /openPrintAtStoreModal/);
  assert.doesNotMatch(session, /sheetAcknowledged \|\| state\.sheet\.allAcknowledged/);
});

test('category cards shrink text to fit the card width', () => {
  const fit = require('../js/lib/fit-text');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  assert.equal(fit.TITLE_MIN, 11);
  assert.equal(fit.META_MIN, 9);
  assert.match(html, /js\/lib\/fit-text\.js/);
  assert.match(signoff, /ds-row-title/);
  assert.match(signoff, /EodFitText\?\.fitSheetCards/);
});
