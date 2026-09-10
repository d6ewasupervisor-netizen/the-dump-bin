'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beforePillState,
  beforePillHtml,
  siLocationLabel,
  matchesSheetFilters,
  sheetRowDone,
  rowSendReady,
  formatEstHrs,
  prodPhotoState,
  prodStatusPillHtml,
  neededCaptureSlot,
  liveStatusLineHtml,
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

test('PROD pill follows before/after photos, not SAS category_completion', () => {
  const notStarted = prodPhotoState({
    live: { prodStatus: 'done', prodComplete: true, prodBeforeCount: 0, prodAfterCount: 0 },
  });
  assert.equal(notStarted.kind, 'not_started');
  assert.match(prodStatusPillHtml(notStarted), /PROD not started/);

  const inProgress = prodPhotoState({
    live: { prodStatus: 'done', prodComplete: true, prodBeforeCount: 4, prodAfterCount: 0 },
  });
  assert.equal(inProgress.kind, 'in_progress');
  assert.match(prodStatusPillHtml(inProgress), /PROD in progress/);

  const complete = prodPhotoState({
    live: { prodStatus: 'open', prodComplete: false, prodBeforeCount: 4, prodAfterCount: 4 },
  });
  assert.equal(complete.kind, 'complete');
  assert.match(prodStatusPillHtml(complete), /PROD complete/);

  assert.equal(prodPhotoState({ live: { prodStatus: 'absent', prodBeforeCount: 0 } }).kind, 'hidden');
  assert.equal(prodStatusPillHtml({ kind: 'hidden' }), '');
});

test('neededCaptureSlot is before until any before exists, then after', () => {
  assert.equal(neededCaptureSlot({ live: { prodBeforeCount: 0, prodAfterCount: 0 } }), 'before');
  assert.equal(neededCaptureSlot({ live: { prodBeforeCount: 1, prodAfterCount: 0 } }), 'after');
  assert.equal(neededCaptureSlot({ live: { prodBeforeCount: 0, prodAfterCount: 0 } }, 2), 'after');
});

test('live status line says in progress when SAS is complete but only befores exist', () => {
  const html = liveStatusLineHtml({
    live: {
      prodComplete: true,
      prodStatus: 'done',
      prodBeforeCount: 1,
      prodAfterCount: 0,
      siPresent: true,
      siComplete: false,
      siPhotoCount: 0,
      sectionCount: 1,
    },
  });
  assert.match(html, /in progress/);
  assert.doesNotMatch(html, />complete</);
  assert.match(html, /before 1 \/ after 0/);
  assert.match(html, /incomplete/);
  assert.match(html, /0\/1 sections/);
});

test('PROD after count falls back to prod-source photos when the live column is missing', () => {
  const state = prodPhotoState({
    live: { prodStatus: 'open', prodBeforeCount: 2 },
    photos: [
      { slot: 'before', source: 'prod' },
      { slot: 'before', source: 'prod' },
      { slot: 'after', source: 'si' },
      { slot: 'after', source: 'prod' },
    ],
  });
  assert.equal(state.kind, 'complete');
  assert.equal(state.after, 1);
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
    live: {
      prodComplete: true,
      prodStatus: 'done',
      siComplete: true,
      siStatus: 'completed',
      prodBeforeCount: 3,
      prodAfterCount: 3,
      siPhotoCount: 3,
      sectionCount: 3,
    },
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
  assert.equal(matchesSheetFilters(nisi, { status: 'done' }), false);
  assert.equal(matchesSheetFilters(nisi, { status: 'not_done' }), true);
  assert.equal(matchesSheetFilters(done, { prod: 'done', si: 'done' }), true);
  assert.equal(matchesSheetFilters(open, { prod: 'done' }), false);
  assert.equal(matchesSheetFilters(open, { prod: 'not_done', si: 'not_done' }), true);
  assert.equal(matchesSheetFilters(nis, { notInStore: true }), true);
  assert.equal(matchesSheetFilters(open, { notInStore: true }), false);
  assert.equal(matchesSheetFilters(nisi, { notInSi: true }), true);
  assert.equal(matchesSheetFilters(nis, { notInStore: true, notInSi: true }), true);
});

test('sheet filters: Done requires PROD before+after and SI afters, not a lead Complete mark', () => {
  const liveBoth = {
    live: {
      prodComplete: true,
      prodStatus: 'done',
      siComplete: true,
      siStatus: 'completed',
      prodBeforeCount: 4,
      prodAfterCount: 4,
      siPhotoCount: 4,
      sectionCount: 4,
    },
    marks: { active: [] },
  };
  const backlog = { marks: { backlog: true, active: ['backlog'] } };
  const complete = { marks: { complete: true, active: ['complete'] } };
  assert.equal(sheetRowDone(liveBoth), true);
  assert.equal(matchesSheetFilters(liveBoth, { status: 'done' }), true);
  assert.equal(matchesSheetFilters(liveBoth, { status: 'not_done' }), false);
  assert.equal(sheetRowDone(backlog), false);
  assert.equal(matchesSheetFilters(backlog, { status: 'done' }), false);
  assert.equal(matchesSheetFilters(backlog, { status: 'not_done' }), true);
  assert.equal(matchesSheetFilters(backlog, { status: 'backlog' }), true);
  assert.equal(matchesSheetFilters(complete, { status: 'backlog' }), false);
  assert.equal(sheetRowDone(complete), false);
  assert.equal(matchesSheetFilters(complete, { status: 'done' }), false);
});

test('NISI is not done; only NIS / Out of Scope / photos clear a set', () => {
  const nisi = { marks: { notInSi: true, active: ['not_in_si'] } };
  const nis = { marks: { notInStore: true, active: ['not_in_store'] } };
  const oos = { marks: { outOfScope: true, active: ['out_of_scope'] } };
  const nisiBacklog = { marks: { notInSi: true, backlog: true, active: ['not_in_si', 'backlog'] } };
  assert.equal(sheetRowDone(nisi), false);
  assert.equal(rowSendReady(nisi), false);
  assert.equal(sheetRowDone(nis), true);
  assert.equal(rowSendReady(nis), true);
  assert.equal(sheetRowDone(oos), true);
  assert.equal(rowSendReady(oos), true);
  assert.equal(rowSendReady(nisiBacklog), true);
  assert.equal(matchesSheetFilters(oos, { status: 'not_done' }), false);
  assert.equal(matchesSheetFilters(oos, { status: 'done' }), false);
  assert.equal(matchesSheetFilters(oos, { status: 'backlog' }), false);
});

test('walk sort: aisle order, backlog after open, complete at bottom, next skips done', () => {
  const {
    sortWalkRows,
    nextWalkRow,
    walkRank,
    aisleNumber,
  } = require('../js/lib/category-card-status');
  const a12 = { id: 1, dbkey: 'a', catName: 'Frozen', live: { siLocation: { label: 'Aisle 12' } }, marks: { active: [] } };
  const a3 = { id: 2, dbkey: 'b', catName: 'Dairy', live: { siLocation: { label: 'Aisle 3' } }, marks: { active: [] } };
  const done = {
    id: 3,
    dbkey: 'c',
    catName: 'Done set',
    live: {
      siLocation: { label: 'Aisle 1' },
      prodBeforeCount: 2,
      prodAfterCount: 2,
      siPhotoCount: 2,
      sectionCount: 2,
    },
    marks: { active: [] },
  };
  const back = { id: 4, dbkey: 'd', catName: 'Later', live: { siLocation: { label: 'Aisle 2' } }, marks: { active: ['backlog'], backlog: true } };
  const sorted = sortWalkRows([done, a12, back, a3]);
  assert.equal(sorted[0].id, 2);
  assert.equal(sorted[1].id, 1);
  assert.equal(sorted[2].id, 4);
  assert.equal(sorted[3].id, 3);
  assert.equal(walkRank(done), 2);
  assert.equal(aisleNumber(a12), 12);
  assert.equal(nextWalkRow(sorted).id, 2);
  assert.equal(nextWalkRow(sorted, 2).id, 1);
  assert.equal(nextWalkRow(sorted, 1), null);
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

test('applyToPayload in test mode keeps extras and strips store mailboxes', () => {
  const out = applyToPayload(
    {
      storeNumber: '19',
      recipients: ['wolf@example.com', 'mgr@stores.fredmeyer.com', 'extra@gmail.com'],
      subject: 'KOMPASS EOD FM019',
    },
    { testMode: true }
  );
  assert.equal(out.storeNumber, '19');
  assert.equal(out.testMode, true);
  assert.deepEqual(out.recipients, [
    'tyson.gauthier@retailodyssey.com',
    'wolf@example.com',
    'extra@gmail.com',
  ]);
  assert.equal(out.subject, '[TEST] KOMPASS EOD FM019');
});

test('applyToPayload without test mode leaves a live store alone', () => {
  const payload = { storeNumber: '19', recipients: ['wolf@example.com'] };
  assert.equal(applyToPayload(payload, { testMode: false }), payload);
});

const fs = require('fs');
const path = require('path');

test('section nav is visit, categories, signatures, send, then more pages', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/section-nav.js'), 'utf8');
  const ids = [...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 7), [
    'visit', 'signoff', 'signatures', 'send', 'crew', 'dumpbin', 'helpdesk',
  ]);
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

test('theme cycle includes dark, inverse, light, gray, gray-matter, holiday, blackout', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/theme.js'), 'utf8');
  assert.match(src, /\['dark', 'inverse', 'light', 'gray', 'gray-matter', 'holiday', 'blackout'\]/);
  assert.match(src, /gray: 'Gray'/);
  assert.match(src, /'gray-matter': 'Matter'/);
  assert.match(src, /blackout: 'Night'/);
  assert.match(src, /'gray-matter': '#12151a'/);
  assert.match(src, /gray: '#2a3038'/);
  assert.match(src, /holiday: '#ff7a18'/);
});

test('bottom nav is Visit, Categories, Signatures, Send; extras hide on phones', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '../js/chrome.js'), 'utf8');
  const nav = html.match(/id="bottomNav"[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /data-nav="visit"[\s\S]*data-nav="signoff"[\s\S]*data-nav="signatures"[\s\S]*data-nav="send"/);
  assert.match(nav, /data-nav="crew"/);
  assert.match(nav, /data-nav="dumpbin"/);
  assert.match(nav, /data-nav="helpdesk"/);
  assert.match(nav, /data-nav="more"/);
  assert.match(nav, /nav-hamburger/);
  assert.doesNotMatch(nav, /···|⋯|&#x22EF;/);
  assert.doesNotMatch(nav, /data-nav="photos"/);
  assert.match(css, /\[data-slot="extra"\] \{ display: none/);
  assert.match(css, /\[data-slot="extra"\] \{ display: flex/);
  assert.match(css, /\[data-slot="phone-more"\] \{ display: none/);
  assert.match(chrome, /data-more="crew"/);
  assert.match(chrome, /data-more="dumpbin"/);
  assert.match(chrome, /data-more="helpdesk"/);
  assert.match(chrome, /data-more="storage"/);
  assert.doesNotMatch(chrome, /data-more="photos"/);
  assert.doesNotMatch(chrome, /data-more="visit"/);
  assert.doesNotMatch(chrome, /data-more="signatures"/);
  assert.doesNotMatch(chrome, /data-more="send"/);
  for (const name of ['visit', 'categories', 'signatures', 'send', 'crew', 'dumpbin', 'helpdesk']) {
    assert.match(html, new RegExp(`icons/nav/${name}\\.png`));
  }
});

test('desktop keeps the side nav static while the page pane scrolls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '../js/chrome.js'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, '../js/router.js'), 'utf8');
  assert.match(html, /id="navCollapseBtn"/);
  assert.match(html, /class="app-pane"/);
  assert.match(css, /body\.nav-collapsed \.bottom-nav/);
  assert.match(css, /#appMount \{[\s\S]*overflow-y: auto/);
  assert.match(chrome, /function toggleNav/);
  assert.match(chrome, /NAV_COLLAPSE_KEY/);
  assert.match(router, /mountY/);
  assert.match(router, /mount\.scrollTop/);
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

test('send bundle loads the rasterizer before send.js', () => {
  const bundles = fs.readFileSync(path.join(__dirname, '../js/lib/route-bundles.js'), 'utf8');
  assert.match(bundles, /js\/lib\/pdf-to-image\.js/);
  assert.match(bundles, /js\/lib\/eod-send-sheets\.js/);
  const sendIdx = bundles.indexOf('js/features/send.js');
  const sheetsIdx = bundles.indexOf('js/lib/eod-send-sheets.js');
  assert.ok(sheetsIdx > 0 && sheetsIdx < sendIdx);
});

test('device storage is in the app: More, Send, boot purge of submitted packages', () => {
  const html = fs.readFileSync(path.join(__dirname, '../js/lib/route-bundles.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../js/features/device-storage.js'), 'utf8');
  const photos = fs.readFileSync(path.join(__dirname, '../js/features/photo-sessions.js'), 'utf8');
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  const boot = fs.readFileSync(path.join(__dirname, '../js/boot.js'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, '../js/router.js'), 'utf8');
  assert.match(html, /js\/features\/device-storage\.js/);
  assert.match(store, /register\('storage'/);
  assert.match(store, /purgeInBackground/);
  assert.match(photos, /purgeOnBoot/);
  assert.match(photos, /purgeSubmitted/);
  assert.match(photos, /const SENT_PRUNE_MS = 36 \* 60 \* 60 \* 1000/);
  assert.match(send, /sendDeviceBtn/);
  assert.match(send, /purgeSubmitted/);
  assert.match(boot, /EodDeviceStorage\?\.purgeInBackground/);
  assert.match(router, /name !== 'storage'/);
});

test('unsent leftovers can be reviewed, discarded, and wiped on reset', () => {
  const chrome = fs.readFileSync(path.join(__dirname, '../js/chrome.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../js/features/device-storage.js'), 'utf8');
  const photosUi = fs.readFileSync(path.join(__dirname, '../js/features/photos.js'), 'utf8');
  const photos = fs.readFileSync(path.join(__dirname, '../js/features/photo-sessions.js'), 'utf8');
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  const session = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');
  assert.match(chrome, /id="unsentOpenPhotos">Review/);
  assert.match(chrome, /openUnsentReview/);
  assert.doesNotMatch(chrome, /unsentOpenPhotos[\s\S]{0,80}go\('send'\)/);
  assert.match(store, /function openUnsentReview/);
  assert.match(store, /function openSessionReview/);
  assert.match(store, /loadSessionForView/);
  assert.match(store, /purgeUnsentLeftovers/);
  assert.match(photosUi, /id="unsentReviewBtn"/);
  assert.match(photos, /async function loadSessionForView/);
  assert.match(photos, /async function purgeUnsentLeftovers/);
  assert.match(photos, /resolved \|\| activeKey/);
  assert.match(visit, /id="resetWipeUnsent"/);
  assert.match(visit, /wipeUnsent/);
  assert.match(session, /wipeUnsent = false/);
  assert.match(session, /purgeUnsentLeftovers/);
});

test('dump-bin does not steal the photos route', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/dump-bin.js'), 'utf8');
  assert.doesNotMatch(src, /register\('photos'/);
  const bundles = fs.readFileSync(path.join(__dirname, '../js/lib/route-bundles.js'), 'utf8');
  assert.match(bundles, /js\/features\/photos\.js/);
  assert.match(bundles, /photos: 'photos'/);
  assert.match(bundles, /dumpbin: 'dumpbin'/);
});

test('dump-bin open-in-tab is a compact icon, not a stretched button', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '../js/features/dump-bin.js'), 'utf8');
  assert.match(src, /<svg class="dump-bin-open-tab-ico"/);
  assert.match(src, /stroke="currentColor"/);
  assert.match(src, /aria-label="Open in new tab"/);
  assert.match(src, /class="dump-bin-open-tab"/);
  assert.match(src, /dump-bin-open-tab-ico/);
  assert.doesNotMatch(src, />Open in tab</);
  assert.doesNotMatch(src, /class="btn btn-secondary"/);
  assert.match(css, /\.dump-bin-embed-bar\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.dump-bin-open-tab\s*\{/);
  assert.match(css, /\.dump-bin-open-tab\s*\{[^}]*flex:\s*0\s+0\s+auto/);
  assert.match(css, /\.dump-bin-open-tab\s*\{[^}]*margin-left:\s*auto/);
  assert.match(css, /\.dump-bin-open-tab\s*\{[^}]*color:\s*var\(--heading\)/);
  assert.doesNotMatch(css, /\.dump-bin-embed-bar\s+\.btn\s*\{/);
});

test('field-app hides the site-wide signed-in badge so it cannot cover chrome', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(css, /#__dumpbin_user_badge\s*\{\s*display:\s*none\s*!important/);
  assert.match(html, /auth-gate\.js\?v=/);
});

test('pilot ships overlay alerts, roles, camera, and PIC QR', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const bundles = fs.readFileSync(path.join(__dirname, '../js/lib/route-bundles.js'), 'utf8');
  for (const file of [
    'js/lib/eod-alerts.js',
    'js/lib/eod-roles.js',
    'js/lib/heic.js',
    'js/features/feedback-hub.js',
  ]) {
    assert.match(html, new RegExp(file.replace(/\./g, '\\.')));
  }
  assert.match(bundles, /js\/lib\/eod-camera\.js/);
  assert.match(bundles, /js\/features\/pic-qr\.js/);
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
  assert.match(visit, /skipBusy: true/);
  assert.doesNotMatch(visit, /busyForce: true/);
  assert.match(visit, /paintLeadFromShift/);
  assert.match(visit, /live=1/);
  assert.doesNotMatch(visit, /await applyLeadFromShift/);
  assert.match(visit, /dayConfirmModal/);
  assert.match(visit, /dayConfirmStoreBtn/);
  assert.match(visit, /showPicker/);
  assert.match(visit, /authFetchTimeout/);
  assert.match(visit, /closeDayConfirmModal\(\);/);
  assert.match(visit, /hydrateReadyVisit/);
  assert.doesNotMatch(visit, /Checking SAS roster/);
  assert.doesNotMatch(visit, /visitCartRefresh/);
  assert.doesNotMatch(visit, /saveInMgr/);
  assert.match(visit, /visibleLeadShifts/);
  assert.match(visit, /function applyShiftsToSession[\s\S]*openShiftDetails/);
  assert.match(visit, /function openShiftDetails[\s\S]*paintOnboarding/);
  assert.match(visit, /pickerItemsForStores/);
  assert.doesNotMatch(visit, /scheduled\.has\(Number\(a\)\)/);
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  assert.match(css, /\.picker-overlay \{ z-index: 46000; \}/);
  assert.match(css, /\.day-confirm-modal \{ z-index: 45000; \}/);
  const picker = fs.readFileSync(path.join(__dirname, '../js/picker.js'), 'utf8');
  assert.match(picker, /document\.body\.appendChild\(overlay\)/);
});

test('compass buffering overlay ships and wraps slow authFetch', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const busy = fs.readFileSync(path.join(__dirname, '../js/lib/eod-buffering.js'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  assert.match(html, /js\/lib\/eod-buffering\.js/);
  assert.match(html, /eod-send-sheets-logic\.js[\s\S]*features\/visit\.js/);
  assert.match(html, /js\/lib\/shift-day-cache\.js/);
  assert.match(html, /js\/lib\/shift-photo-sync\.js/);
  assert.match(html, /js\/lib\/visit-mirror\.js/);
  assert.match(html, /id="eodBuffering"/);
  assert.match(html, /assets\/buffering\.gif/);
  assert.match(html, /eod-buffering-card/);
  assert.match(html, /eodBusyTitle/);
  assert.match(busy, /assets\/buffering\.gif/);
  assert.match(busy, /wrapAuthFetch/);
  assert.match(busy, /digital-signoffs/);
  assert.match(busy, /heartbeat/);
  assert.match(busy, /runSession/);
  assert.match(busy, /showSuccess/);
  assert.match(busy, /setStage/);
  assert.match(busy, /AMBIENT_MAX_MS/);
  assert.match(busy, /dismissBusy/);
  assert.match(signoff, /skipBusy: true/);
  assert.doesNotMatch(signoff, /Pulling live data/);
  assert.doesNotMatch(signoff, /backToStoreSelect/);
  assert.match(html, /id="eodBusyCancel"/);
  assert.doesNotMatch(html, /eod-buffering-spinner/);
  assert.match(signoff, /skipBusy: true/);
  assert.match(send, /beginSession/);
  assert.match(send, /showSuccess/);
  assert.match(survey, /skipBusy: true/);
  assert.match(survey, /data-open-media="planogram"/);
  assert.match(survey, /data-open-media="before"/);
  assert.match(survey, /data-open-media="after"/);
  assert.doesNotMatch(survey, /setPlanogramMount/);
  assert.match(survey, /EodSiPlanogram/);
  assert.match(survey, /openOverlay/);
  assert.doesNotMatch(survey, /PROD date/);
  assert.doesNotMatch(survey, /SI date/);
  assert.doesNotMatch(survey, /Sheet row/);
  assert.doesNotMatch(survey, /ft = \$\{esc\(feet\)\} ft/);
  assert.match(html, /set-media-cache/);
  const bundles = fs.readFileSync(path.join(__dirname, '../js/lib/route-bundles.js'), 'utf8');
  assert.match(bundles, /set-media-prefetch/);
  assert.match(bundles, /si-planogram-board/);
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
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  const session = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');
  assert.match(signoff, /id="sheetFilters"/);
  assert.match(signoff, /data-filter="status"/);
  assert.match(signoff, /data-value="done">Done/);
  assert.match(signoff, /data-value="not_done">Not Done/);
  assert.match(signoff, /data-value="backlog">Backlog/);
  assert.match(signoff, /id="sheetBulk"/);
  assert.match(signoff, /id="sheetSelectAll"/);
  assert.match(signoff, /filteredSheetRows/);
  assert.doesNotMatch(signoff, /id="sheetNext"/);
  assert.doesNotMatch(signoff, /btn\('complete', 'Complete'\)/);
  assert.match(signoff, /btn\('out_of_scope', 'Out of Scope'\)/);
  assert.doesNotMatch(signoff, /data-bulk-mark="complete"/);
  assert.match(signoff, /data-select-row/);
  assert.match(signoff, /data-bulk-mark/);
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
  assert.match(signoff, /btn\('backlog'/);
  assert.match(signoff, /data-open-set/);
  assert.match(session, /m\.backlog/);
  const gates = fs.readFileSync(path.join(__dirname, '../js/lib/send-gates.js'), 'utf8');
  assert.match(gates, /function missing/);
  assert.match(html, /js\/lib\/send-gates\.js/);
  assert.match(html, /js\/lib\/eod-garden\.js/);
  assert.match(send, /EodSendGates/);
  assert.doesNotMatch(session, /sheetAcknowledged \|\| state\.sheet\.allAcknowledged/);
});

test('category cards shrink text to fit the card width', () => {
  const fit = require('../js/lib/fit-text');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const fitSrc = fs.readFileSync(path.join(__dirname, '../js/lib/fit-text.js'), 'utf8');
  assert.equal(fit.TITLE_MIN, 11);
  assert.equal(fit.META_MIN, 9);
  assert.match(html, /js\/lib\/fit-text\.js/);
  assert.match(signoff, /ds-row-title/);
  assert.match(signoff, /ds-row-meta/);
  assert.match(signoff, /metaBits\.map/);
  assert.match(signoff, /EodFitText\?\.fitSheetCards/);
  assert.doesNotMatch(signoff, /ResizeObserver/);
  assert.doesNotMatch(fitSrc, /ds-actions \.btn/);
  assert.doesNotMatch(fitSrc, /ds-row-meta/);
  assert.match(css, /\.ds-actions \{\s*display: grid;/);
  assert.match(css, /\.ds-row-meta \{\s*display: flex;\s*flex-wrap: wrap;/);
});

const sendGates = require('../js/lib/send-gates');

test('send gates list missing visit confirm and jump metadata', () => {
  const S = {
    state: {
      profileName: '',
      leadName: '',
      signatureDataUrl: '',
      emailRecipients: [],
      profileEmail: '',
      checkInManager: '',
      checkOutManager: '',
      photos: { before: [], after: [], signoff: [], instawork: [] },
      instaworkYes: null,
    },
    isVisitReady: () => false,
    hasHostedSheet: () => false,
    sheetSendReady: () => false,
  };
  const miss = sendGates.missing(S);
  assert.ok(miss.some((g) => g.id === 'visit' && g.page === 'visit'));
  assert.ok(miss.some((g) => g.id === 'name' && g.page === 'visit'));
  assert.equal(sendGates.firstMessage(S), 'Confirm store and date');
});

test('send gates follow visit → cart → check-in before lead signature', () => {
  const S = {
    state: {
      profileName: 'Lead',
      leadName: 'Lead',
      signatureDataUrl: '',
      emailRecipients: ['a@b.com'],
      profileEmail: 'a@b.com',
      checkInManager: '',
      checkOutManager: '',
      photos: { before: [], after: [], signoff: [], instawork: [] },
      instaworkYes: null,
    },
    isVisitReady: () => true,
    hasHostedSheet: () => true,
    sheetSendReady: () => false,
  };
  assert.equal(sendGates.firstMessage(S), 'Add a Kompass cart before photo');
  S.state.photos.before = [{ dataUrl: 'x' }];
  assert.equal(sendGates.firstMessage(S), 'Enter the check-in manager on Visit');
  S.state.checkInManager = 'April';
  assert.equal(sendGates.firstMessage(S), 'Mark every open set before sending');
  S.sheetSendReady = () => true;
  assert.equal(
    sendGates.firstMessage(S),
    'Collect management / store PIC signatures (or check-out manager)'
  );
  S.state.checkOutManager = 'April';
  assert.equal(sendGates.firstMessage(S), 'Add your lead signature');
});

test('cover notes remove the generated In/Out/cart/marked line and keep lead notes', () => {
  const { mergeNotes, summaryLine } = require('../js/lib/cover-notes');
  const S = {
    state: {
      checkInManager: 'Bryce',
      checkOutManager: 'Bryce',
      photos: { before: [{ dataUrl: 'x' }], after: [{ dataUrl: 'y' }] },
      sheet: { summary: { marked: 4, total: 30 }, rows: [] },
      notes: 'In: Bryce · Out: — · cart 1/0 · 0/30 marked\nLead leftover',
    },
  };
  assert.equal(summaryLine(S), 'In: Bryce · Out: Bryce · cart 1/1 · 4/30 marked');
  assert.equal(mergeNotes(S.state.notes, S), 'Lead leftover');
});

test('cover notes omit set lists already shown in dedicated fields', () => {
  const { mergeNotes, notesWithoutSetLists } = require('../js/lib/cover-notes');
  const S = {
    state: {
      checkInManager: 'Bryce',
      checkOutManager: '',
      photos: { before: [], after: [] },
      sheet: {
        summary: { marked: 1, total: 2 },
        rows: [
          { catName: 'Isotonic', marks: { active: ['not_in_store'], notInStore: true } },
          { catName: 'Soft Drinks', marks: { active: ['not_in_si'], notInSi: true } },
        ],
      },
      notes: [
        'Not in store: Isotonic',
        'Not in SI: Soft Drinks',
        '— Day summary —',
        '— Not in SI: Soft Drinks, Frozen',
        'Lead note stays',
      ].join('\n'),
    },
  };
  const notes = mergeNotes(S.state.notes, S);
  assert.doesNotMatch(notes, /Not in store:/);
  assert.doesNotMatch(notes, /Not in SI:/);
  assert.doesNotMatch(notes, /Day summary/);
  assert.match(notes, /Lead note stays/);
  assert.equal(notesWithoutSetLists(S.state.notes), 'Lead note stays');
});

test('attached PDF cover uses current signoff and Help Desk rules', () => {
  const sheets = fs.readFileSync(path.join(__dirname, '../js/lib/eod-send-sheets.js'), 'utf8');
  assert.match(sheets, /rowHtml\('Signoff Attached', signoffAttached \? 'Yes' : 'No'/);
  assert.doesNotMatch(sheets, /rowHtml\('Digital signoff'/);
  assert.match(sheets, /calledHelpDesk \? rowHtml\('Commodities'/);
  assert.match(sheets, /listHtml\(r\.notInSi, \/\^not in si:/);
});

test('already-sent EOD dialog offers the lead a Request PIN action', () => {
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  assert.match(send, /id: 'request', label: 'Request PIN'/);
  assert.match(send, /\/api\/eod\/resend-pin\/request/);
  assert.match(send, /choice === 'request'/);
});

test('category cards include Capture and a live PROD/SI status line', () => {
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  assert.match(signoff, />Capture</);
  assert.match(signoff, /data-capture-start/);
  assert.match(signoff, /liveStatusLineHtml/);
  assert.match(signoff, /neededCaptureSlot/);
});

test('list Capture opens a from-one session and survey status ignores SAS completed', () => {
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  assert.match(survey, /fromOne: true/);
  assert.match(survey, /Moving to bay/);
  assert.match(survey, /liveStatusLineFromCounts/);
  assert.match(survey, /prodKindFromCounts/);
  assert.doesNotMatch(survey, /live\.prodComplete \? 'completed'/);
});

test('set survey shows PROD and SI remotes and copies afters when one side is behind', () => {
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  const dept = fs.readFileSync(path.join(__dirname, '../js/features/dept-signatures.js'), 'utf8');
  assert.match(survey, /function liveCoveredBays/);
  assert.match(survey, /add\(remote\.si\)/);
  assert.match(survey, /function remoteAsPhotos/);
  assert.match(survey, /function refreshRemoteAndPaint/);
  assert.match(survey, /siHave !== prodAfter/);
  assert.doesNotMatch(survey, /function liveProdBays/);
  assert.match(dept, /function rowInScope/);
  assert.match(dept, /workRows = sheet\.rows\.filter\(rowInScope\)/);
  assert.doesNotMatch(dept, /filter\(rowHasWorkMark\)/);
});

test('Complete does not delete local afters that have not landed in PROD or SI', () => {
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  assert.match(survey, /function applyLiveProd\(status\) \{\s*local\.liveProd = true;\s*local\.status = status;\s*\}/);
  assert.doesNotMatch(survey, /pipe\.removeJob/);
  assert.doesNotMatch(survey, /if \(local\.liveProd && !uploadInFlight/);
  assert.doesNotMatch(survey, /finishSetBtn/);
  assert.match(survey, /function persistAfters/);
  assert.match(survey, /showDoneTab/);
});

test('double-swipe nav order is visit, categories, signatures, send', () => {
  const swipe = require('../js/lib/swipe-nav');
  assert.deepEqual(swipe.PRIMARY, ['visit', 'signoff', 'signatures', 'send']);
});

test('PIC can sign on the wizard pad without rotating the phone', () => {
  const dept = fs.readFileSync(path.join(__dirname, '../js/features/dept-signatures.js'), 'utf8');
  const lsp = fs.readFileSync(path.join(__dirname, '../js/lib/landscape-sig-pad.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  assert.match(dept, /deptSigCanvas/);
  assert.match(dept, /bindInlinePad/);
  assert.doesNotMatch(dept, /Turn the phone sideways/);
  assert.match(lsp, /z-index:\s*50000/);
  assert.match(lsp, /forceClose/);
  assert.doesNotMatch(lsp, /html\.eod-lsp-open, html\.eod-lsp-open body/);
  assert.match(css, /\.dept-sig-wizard-overlay \{[\s\S]*z-index:\s*45000/);
});

test('planogram is boxed so it does not steal page scroll or signatures', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const swipe = fs.readFileSync(path.join(__dirname, '../js/lib/swipe-nav.js'), 'utf8');
  assert.doesNotMatch(css, /#appMount \{[^}]*touch-action:\s*pan-y/);
  assert.match(css, /\.app-shell \{[\s\S]*?overflow:\s*visible/);
  assert.match(css, /\.si-pog-scroll \{[\s\S]*max-height:/);
  assert.match(swipe, /si-pog-scroll/);
  assert.match(swipe, /eod-lsp-overlay\.show/);
  assert.match(swipe, /set-media-overlay/);
  assert.doesNotMatch(swipe, /closest\('\.landscape-sig, canvas/);
});

test('planogram shelves and facings follow theme colors instead of a white board', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  assert.match(css, /--pog-shelf:/);
  assert.match(css, /--pog-item:/);
  assert.match(css, /\.si-pog-slots \{[\s\S]*background:\s*var\(--pog-shelf\)/);
  assert.match(css, /\.si-pog-item \{[\s\S]*background:\s*var\(--pog-item\)/);
  assert.match(css, /\.si-pog-thumb \{[\s\S]*background:\s*var\(--pog-item\)/);
  assert.doesNotMatch(css, /\.si-pog-item \{\s*background:\s*#fff/);
});

test('checkout manager gate clears when a name is set', () => {
  const ready = {
    state: {
      profileName: 'Tyson',
      leadName: 'Tyson',
      signatureDataUrl: 'data:image/png;base64,xx',
      emailRecipients: ['a@b.com'],
      profileEmail: 'a@b.com',
      checkInManager: 'April',
      checkOutManager: '',
      photos: { before: [{ dataUrl: 'x' }], after: [{ dataUrl: 'y' }], signoff: [], instawork: [] },
      instaworkYes: null,
    },
    isVisitReady: () => true,
    hasHostedSheet: () => true,
    sheetSendReady: () => true,
  };
  assert.ok(sendGates.missing(ready).some((g) => g.id === 'checkout'));
  ready.state.checkOutManager = 'April';
  assert.ok(!sendGates.missing(ready).some((g) => g.id === 'checkout'));
  assert.notEqual(
    sendGates.firstMessage(ready),
    'Collect management / store PIC signatures (or check-out manager)'
  );
});

test('digital signoff rasterizer loads standard PDF fonts', () => {
  const pdf = fs.readFileSync(path.join(__dirname, '../js/lib/pdf-to-image.js'), 'utf8');
  assert.match(pdf, /standardFontDataUrl/);
  assert.match(pdf, /cMapUrl/);
});

test('send page live-refreshes gates after checkout is chosen', () => {
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  assert.match(send, /function refreshGates/);
  assert.match(send, /EodVisitMemory\?\.setManagers/);
  assert.match(send, /checkOutField/);
  assert.match(visit, /EodVisitMemory\?\.setManagers/);
  assert.match(visit, /checkInField/);
});

test('send page can edit or remove individual photos that go out', () => {
  const send = fs.readFileSync(path.join(__dirname, '../js/features/send.js'), 'utf8');
  const photos = fs.readFileSync(path.join(__dirname, '../js/features/photos.js'), 'utf8');
  assert.match(photos, /function bindGrid/);
  assert.match(photos, /async function editAt/);
  assert.match(photos, /async function removeAt/);
  assert.match(photos, /EodPhotoEditor\?\.open/);
  assert.match(send, /id="sendBeforeGrid"/);
  assert.match(send, /id="sendPaperGrid"/);
  assert.match(send, /paintSendablePhotos/);
  assert.match(send, /Photos\.gridHtml/);
  assert.match(send, /Photos\.bindGrid/);
  assert.match(send, /loadBundle\('photos'\)/);
  assert.match(send, /hydrateDataUrls/);
  const bundles = fs.readFileSync(path.join(__dirname, '../js/lib/route-bundles.js'), 'utf8');
  assert.match(bundles, /send:[\s\S]*js\/features\/photos\.js/);
});

test('after-photo review jumps to that bay on the planogram and bottom nav Back restores it', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const review = fs.readFileSync(path.join(__dirname, '../js/lib/set-review.js'), 'utf8');
  const pog = fs.readFileSync(path.join(__dirname, '../js/lib/si-planogram-board.js'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '../js/chrome.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  assert.match(html, /id="navOverlayBack"/);
  assert.doesNotMatch(html, /data-nav="[^"]*"[\s\S]{0,40}id="navOverlayBack"/);
  assert.match(css, /#navOverlayBack\[hidden\]/);
  assert.match(review, /ghOpenPlanogram/);
  assert.match(review, /function canShowPlanogram/);
  assert.match(review, /isBeforeSlot\(slotFilter\)/);
  assert.match(review, /pushOverlayBack/);
  assert.match(review, /initialBay: bay/);
  assert.match(pog, /function openOverlay\(\{ store, date, dbkey, title, highlightUpc, initialBay \}\)/);
  assert.match(pog, /hasOverlayBack/);
  assert.match(pog, /goOverlayBack/);
  assert.match(chrome, /function pushOverlayBack/);
  assert.match(chrome, /function goOverlayBack/);
  assert.match(chrome, /function dismissOverlays/);
  assert.match(chrome, /navOverlayBack/);
  assert.match(chrome, /dismissOverlays\(\)/);
});

test('store prod warm heartbeats and Categories poll the sheet, not a full sync', () => {
  const warm = fs.readFileSync(path.join(__dirname, '../js/features/store-prod-warm.js'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  assert.match(html, /store-prod-warm\.js/);
  assert.match(warm, /\/heartbeat/);
  assert.match(warm, /HEARTBEAT_MS = 45_000/);
  assert.match(warm, /prefetchStatuses/);
  assert.match(warm, /prefetchStatuses\(\)\.then\(\(\) => prefetchPlanograms\(\)\)/);
  assert.match(warm, /prefetchPlanograms/);
  assert.match(warm, /\/planogram\?/);
  assert.match(warm, /peekPlanogram/);
  assert.doesNotMatch(warm, /planogram-image/);
  const pog = fs.readFileSync(path.join(__dirname, '../js/lib/si-planogram-board.js'), 'utf8');
  assert.match(pog, /EodStoreProdWarm\?\.peekPlanogram/);
  assert.match(signoff, /EodStoreProdWarm\?\.start/);
  assert.match(signoff, /poll sheet/);
  assert.match(survey, /EodStoreProdWarm\?\.peekStatus/);
});

test('SAS and SI bulbs own auth refresh; the title-bar reload button is gone', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const conn = fs.readFileSync(path.join(__dirname, '../js/features/connections.js'), 'utf8');
  assert.doesNotMatch(html, /refreshConnectionsBtn/);
  assert.match(html, /<button type="button" class="conn-dot" id="sasConnDot"/);
  assert.match(html, /<button type="button" class="conn-dot" id="reboticsConnDot"/);
  assert.match(conn, /function connDots/);
  assert.match(conn, /refreshConnections\(el\)/);
  assert.match(conn, /already connected/);
  assert.match(conn, /Continue anyway/);
  assert.match(conn, /showConfirm/);
  assert.doesNotMatch(conn, /showAlert/);
  assert.match(conn, /chromeDots/);
  assert.match(conn, /classList\.add\('spinning'\)/);
});

test('visit mirror hydrates the lead snapshot onto a second login', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const mirror = fs.readFileSync(path.join(__dirname, '../js/lib/visit-mirror.js'), 'utf8');
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '../js/lib/shift-photo-sync.js'), 'utf8');
  assert.match(html, /js\/lib\/visit-mirror\.js/);
  assert.match(mirror, /function hydrate/);
  assert.match(mirror, /signatureDataUrl/);
  assert.match(visit, /EodVisitMirror\?\.hydrate/);
  assert.match(sync, /setAfters/);
  assert.match(sync, /prefetchSetPhotos/);
});

