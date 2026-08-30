'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beforePillState,
  beforePillHtml,
  siLocationLabel,
  matchesSheetFilters,
  sheetRowDone,
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

test('sheet filters: Done includes live PROD+SI even without a lead mark', () => {
  const liveBoth = {
    live: { prodComplete: true, prodStatus: 'done', siComplete: true, siStatus: 'completed' },
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
  assert.equal(sheetRowDone(complete), true);
  assert.equal(matchesSheetFilters(complete, { status: 'done' }), true);
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
  const done = { id: 3, dbkey: 'c', catName: 'Done set', live: { siLocation: { label: 'Aisle 1' } }, marks: { active: ['complete'], complete: true } };
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

test('theme cycle includes dark, inverse, light, gray, holiday, blackout', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/features/theme.js'), 'utf8');
  assert.match(src, /\['dark', 'inverse', 'light', 'gray', 'holiday', 'blackout'\]/);
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
  assert.match(chrome, /data-more="photos"/);
  assert.match(chrome, /data-more="storage"/);
  assert.doesNotMatch(chrome, /data-more="signatures"/);
  for (const name of ['visit', 'categories', 'signatures', 'send', 'crew', 'dumpbin', 'helpdesk']) {
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

test('device storage is in the app: More, Send, boot purge of submitted packages', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
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
  assert.match(visit, /dayConfirmModal/);
  assert.match(visit, /dayConfirmStoreBtn/);
  assert.match(visit, /showPicker/);
});

test('compass buffering overlay ships and wraps slow authFetch', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const busy = fs.readFileSync(path.join(__dirname, '../js/lib/eod-buffering.js'), 'utf8');
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  const survey = fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8');
  assert.match(html, /js\/lib\/eod-buffering\.js/);
  assert.match(html, /js\/lib\/shift-day-cache\.js/);
  assert.match(html, /js\/lib\/shift-photo-sync\.js/);
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
  assert.match(survey, /setPlanogramMount/);
  assert.match(survey, /EodSiPlanogram/);
  assert.match(busy, /planogram/);
  assert.match(html, /si-planogram-board/);
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
  assert.match(signoff, /id="sheetNext"/);
  assert.match(signoff, /btn\('complete', 'Complete'\)/);
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
  assert.equal(fit.TITLE_MIN, 11);
  assert.equal(fit.META_MIN, 9);
  assert.match(html, /js\/lib\/fit-text\.js/);
  assert.match(signoff, /ds-row-title/);
  assert.match(signoff, /EodFitText\?\.fitSheetCards/);
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

test('cover notes rewrite the In/Out/cart line and keep extra notes', () => {
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
  assert.equal(
    mergeNotes(S.state.notes, S),
    'In: Bryce · Out: Bryce · cart 1/1 · 4/30 marked\nLead leftover'
  );
});

test('cover notes add Not in store lines from sheet marks', () => {
  const { mergeNotes } = require('../js/lib/cover-notes');
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
      notes: '',
    },
  };
  const notes = mergeNotes('', S);
  assert.match(notes, /Not in store: Isotonic/);
  assert.match(notes, /Not in SI: Soft Drinks/);
  assert.ok(notes.indexOf('Not in store: Isotonic') < notes.indexOf('Not in SI: Soft Drinks'));
});

test('category cards do not include a Capture button', () => {
  const signoff = fs.readFileSync(path.join(__dirname, '../js/features/signoff-home.js'), 'utf8');
  assert.doesNotMatch(signoff, />Capture</);
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
  assert.doesNotMatch(swipe, /closest\('\.landscape-sig, canvas/);
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
  assert.notEqual(sendGates.firstMessage(ready), 'Enter the check-out manager (or complete PIC QR)');
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

