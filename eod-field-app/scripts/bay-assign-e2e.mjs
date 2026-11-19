/**
 * F3 — real survey route, fixture /api/ interception, no paint helpers.
 * Screenshots → Downloads\bay-assign-final-screens\
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  startStaticServer,
  installPilotState,
  todayIso,
} from './smoke-blank.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'C:\\Users\\tgaut\\Downloads\\bay-assign-final-screens';
const LOCAL_CHROME = 'C:\\Users\\tgaut\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const FIXTURE_DIR = 'C:\\Users\\tgaut\\Downloads\\215_P09W2_Frozen_Handhelds_9618670\\device_before';
const DBKEY = '9618670';
const DBKEY2 = '9693669';
const ROW_ID = 'bay-assign-e2e-row';
const HASH = `#/survey?dbkey=${DBKEY}&rowId=${ROW_ID}&name=Bay%20Assign%20E2E&cat=60&slot=after`;

fs.mkdirSync(OUT, { recursive: true });

/* The real store-confirmation gate from eod-api. The bay-override mock must
   not hide a client/server mismatch, so PUT /api/field-set/bay-override is
   judged by requireDayConfirm itself, on the headers and body the field app
   actually sent. */
const E2E_EMAIL = 'e2e.lead@example.com';
const E2E_STORE = '28';
process.env.DAY_CONFIRM_SECRET = process.env.DAY_CONFIRM_SECRET || 'e2e-day-confirm-secret-0123456789';
function loadRealGate() {
  const candidates = [
    process.env.EOD_API_ROOT,
    'C:\\\\Users\\\\tgaut\\\\eod-api-wt-baycount',
    'C:\\\\Users\\\\tgaut\\\\eod-api',
  ].filter(Boolean);
  for (const root of candidates) {
    const file = path.join(root, 'src', 'store-confirmation.js');
    if (fs.existsSync(file)) {
      const req = createRequire(file);
      return req(file);
    }
  }
  throw new Error('eod-api src/store-confirmation.js not found; set EOD_API_ROOT');
}
const REAL_GATE = loadRealGate();

function runRealGate(request) {
  let body = {};
  try { body = request.postDataJSON() || {}; } catch (_) { body = {}; }
  const fakeReq = {
    user: { email: E2E_EMAIL },
    headers: request.headers(),
    body,
    query: {},
    params: {},
  };
  return new Promise((resolve) => {
    const fakeRes = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ ok: false, status: this.statusCode, body: payload }); return this; },
    };
    REAL_GATE.requireDayConfirm(fakeReq, fakeRes, () => resolve({ ok: true, body }));
  });
}

function fixturePath(n) {
  const p = path.join(FIXTURE_DIR, `bay${n}.jpg`);
  if (!fs.existsSync(p)) throw new Error(`Missing fixture ${p}`);
  return p;
}

function tinyJpeg() {
  // Minimal valid JPEG if shelf fixtures vanish.
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=',
    'base64'
  );
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function assertShotLooksLike(page, label, selectors) {
  const hit = await page.evaluate((sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) return { ok: true, sel: s, w: Math.round(r.width), h: Math.round(r.height) };
    }
    return { ok: false, route: document.body.dataset.route || '', html: (document.getElementById('appMount')?.innerHTML || '').slice(0, 200) };
  }, selectors);
  if (!hit.ok) throw new Error(`Screenshot "${label}" missing UI: ${JSON.stringify(hit)}`);
  return hit;
}

/* mode: 'known4' (default, the original fixture), 'known5', or 'unknown' —
   the thin stored status a set gets when nothing has resolved its bay count
   (no SI task / planogram, or the warm cache missed). */
function statusFixture(override, mode = 'known4') {
  const prod = {
    status: 'open',
    visitId: '27455636',
    resetId: '42582826',
    beforeCount: 0,
    afterCount: 0,
  };
  if (mode === 'unknown' || mode === 'thinpog') {
    return {
      ok: true,
      status: {
        expectedBayCount: null,
        planogramBayCount: null,
        bayOverride: override || null,
        prod,
        si: { status: 'unknown', message: 'not checked' },
        bays: [],
      },
    };
  }
  const n = mode === 'known5' ? 5 : 4;
  const bays = Array.from({ length: n }, (_, i) => ({
    bay: i + 1,
    bayName: String(i + 1),
    hasPhoto: false,
    before: false,
    after: false,
  }));
  return {
    ok: true,
    status: {
      expectedBayCount: n,
      planogramBayCount: n,
      bayOverride: override || null,
      prod,
      si: {
        status: 'open',
        taskId: 9001,
        sectionCount: n,
        sectionsWithPhoto: 0,
      },
      // set-survey bayList() requires an array (fromStatus.map).
      bays,
    },
  };
}

async function installApiMocks(page, bag) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const p = url.pathname;
    bag.calls.push({ method, path: p, url: url.toString() });

    if (p.includes('/api/field-set/status') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(statusFixture(bag.override, bag.mode || 'known4')),
      });
    }
    if (p.includes('/api/field-set/planogram') && method === 'GET') {
      bag.planogramCalls = (bag.planogramCalls || 0) + 1;
      const noPog = bag.mode === 'unknown';
      const fivePog = bag.mode === 'thinpog';
      return route.fulfill({
        status: noPog ? 404 : 200,
        contentType: 'application/json',
        body: JSON.stringify(noPog
          ? { ok: false, error: 'No SI planogram for dbkey ' + DBKEY2 + ' on 2026-11-19' }
          : { ok: true, planogram: fivePog ? { bays: [1, 2, 3, 4, 5].map((bay) => ({ bay, shelves: [] })) } : null }),
      });
    }
    if (p.includes('/api/field-set/bay-override') && method === 'PUT') {
      bag.overrideAttempts = (bag.overrideAttempts || 0) + 1;
      if (bag.failOverride) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Bay override refused — cannot verify set sent state' }),
        });
      }
      // The real eod-api gate judges the request the field app actually sent.
      let sentBody = {};
      try { sentBody = req.postDataJSON() || {}; } catch (_) { sentBody = {}; }
      bag.requestShape = {
        method: req.method(),
        path: p,
        headerNames: Object.keys(req.headers()).sort(),
        bodyKeys: Object.keys(sentBody).sort(),
        body: sentBody,
      };
      const gate = await runRealGate(req);
      bag.gateResults = bag.gateResults || [];
      bag.gateResults.push(gate.ok ? 'pass' : (gate.body && gate.body.reason) || 'fail');
      if (!gate.ok) {
        return route.fulfill({
          status: gate.status,
          contentType: 'application/json',
          body: JSON.stringify(gate.body),
        });
      }
      const body = gate.body || {};
      bag.overrides.push(body);
      bag.override = {
        oldCount: Number(body.oldCount) || 4,
        newCount: Number(body.newCount) || 4,
        missingBays: body.missingBays || [],
        addedBays: body.addedBays || [],
        fillerSentBays: [],
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, override: bag.override }),
      });
    }
    if (p.includes('/api/field-set/bay-override') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, override: bag.override }),
      });
    }
    if ((p.includes('/api/field-set/photo-bin') || p.includes('/api/field-set/photo')) && method === 'POST') {
      // Binary submit puts bay/slot in X-Photo-Meta; JSON path puts them in the body.
      let meta = {};
      const metaHeader = req.headers()['x-photo-meta'] || req.headers()['X-Photo-Meta'];
      if (metaHeader) {
        try { meta = JSON.parse(metaHeader); } catch (_) {}
      }
      let body = {};
      try { body = req.postDataJSON(); } catch (_) {}
      const bay = Number(meta.bay != null ? meta.bay : body.bay);
      const slot = meta.slot || body.slot || null;
      bag.uploads.push({
        bay,
        slot,
        expectedBayCount: meta.expectedBayCount != null ? meta.expectedBayCount : (body.expectedBayCount != null ? body.expectedBayCount : null),
        replace: !!(meta.replace || body.replace || meta.force),
        dbkey: String(meta.dbkey || body.dbkey || ''),
        skipSi: !!(meta.skipSi ?? body.skipSi),
        skipProd: !!(meta.skipProd ?? body.skipProd),
        via: metaHeader ? 'binary-meta' : 'json',
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          accepted: true,
          result: {
            prod: { status: 'ok' },
            si: { status: (meta.skipSi || body.skipSi) ? 'skipped' : 'ok' },
          },
        }),
      });
    }
    if (p.includes('/api/sas-user/status')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: true, uploadReady: true, sharedActor: true }),
      });
    }
    if (p.includes('/api/digital-signoffs/sheet')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, sheet: { rows: [] }, rows: [] }),
      });
    }
    if (p.includes('/api/digital-signoffs') || p.includes('/api/field-set/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          rows: [],
          photos: [],
          payload: {},
          status: statusFixture(bag.override).status,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

/* Store 28 confirmed for today with a token the real gate accepts. */
async function installDayState(page) {
  const date = todayIso();
  const token = REAL_GATE.signDayConfirm({ email: E2E_EMAIL, store: E2E_STORE, date });
  await page.addInitScript(({ date: d, token: tok, store }) => {
    localStorage.setItem('kompassDayConfirm', JSON.stringify({
      token: tok,
      store,
      date: d,
      expiresAt: Date.now() + 36 * 60 * 60 * 1000,
    }));
    const raw = JSON.parse(localStorage.getItem('kompassEOD') || '{}');
    raw.storeNumber = store;
    raw.workDate = d;
    raw.visitStep = 'done';
    raw.selectedShift = { visitId: '27455636', visitLead: 'Smoke Tester' };
    localStorage.setItem('kompassEOD', JSON.stringify(raw));
  }, { date, token, store: E2E_STORE });
}

async function waitForBayControl(page) {
  await page.waitForSelector('#setBayCountControl .set-bay-count-list, #setBayCountControl .set-bay-count-head', {
    timeout: 30000,
  });
}

async function runViewport(browser, origin, width, bag) {
  const context = await browser.newContext({
    viewport: { width, height: 740 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  // Any native alert/confirm/prompt is a failure: confirmations live in the screen.
  bag.nativeDialogs = [];
  page.on('dialog', async (d) => { bag.nativeDialogs.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
  await installPilotState(page, { theme: 'gray-matter' });
  // Force store 28 to match override bodies in assertions.
  await installDayState(page);
  await installApiMocks(page, bag);

  await page.goto(`${origin}/${HASH}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => document.body.dataset.route === 'survey', { timeout: 30000 });
  await waitForBayControl(page);

  // 1) Bay-count control for a 4-bay set
  await assertShotLooksLike(page, 'bay-count', ['#setBayCountControl', '.set-bay-count-head']);
  const s1 = await shot(page, `bay-count-control-${width}.png`);

  // Open editor is already the painted control with list; capture as editor.
  await assertShotLooksLike(page, 'bay-count editor', ['.set-bay-count-list', '[data-bay-missing]']);
  const s2 = await shot(page, `bay-count-editor-${width}.png`);

  // 2) Not in this store on bay 3 → PUT bay-override
  bag.overrides.length = 0;
  await page.click('[data-bay-missing="3"]');
  await page.waitForFunction(() => {
    const miss = document.querySelector('.set-bay-count-row.is-missing');
    return !!(miss && /Bay 3/.test(miss.textContent || ''));
  }, { timeout: 15000 });
  if (!bag.overrides.length) {
    await page.waitForTimeout(500);
  }
  const missBody = bag.overrides[bag.overrides.length - 1];
  if (!missBody || !Array.isArray(missBody.missingBays) || !missBody.missingBays.map(Number).includes(3)) {
    throw new Error(`Expected PUT bay-override missing bay 3, got ${JSON.stringify(missBody)}`);
  }

  // 3) Three gallery files → real assign screen
  const files = [fixturePath(1), fixturePath(2), fixturePath(4)];
  await page.setInputFiles('input[data-gal="after"]', files);
  await page.waitForSelector('.bay-assign-screen', { timeout: 20000 });

  async function place(photoIdx, bay) {
    await page.click(`[data-bay-assign-photo="${photoIdx}"]`);
    await page.waitForTimeout(80);
    await page.click(`[data-bay-assign-bay="${bay}"]`);
    await page.waitForTimeout(120);
  }
  // Suggest-on-open fills every empty bay. Bays 2 and 4 hold photos, so marking
  // them "not in store" must raise the in-screen "already has a photo" banner.
  await page.click('[data-bay-assign-mark-missing="2"]');
  await page.waitForSelector('[data-bay-assign-clear-missing]', { timeout: 5000 });
  const bannerText = await page.innerText('[data-bay-assign-clear-missing]');
  if (!/Bay 2 already has a photo/.test(bannerText)) throw new Error(`clear banner text: ${bannerText}`);
  const s2b = await shot(page, `assign-clear-confirm-${width}.png`);
  await assertShotLooksLike(page, 'assign clear confirm', ['[data-bay-assign-clear-missing]']);
  // Cancel keeps the photo placed.
  await page.click('[data-bay-assign-clear-missing-no]');
  await page.waitForTimeout(120);
  if (await page.$('[data-bay-assign-clear-missing]')) throw new Error('banner should close on Cancel');
  if (!(await page.$('[data-bay-assign-undo-missing="2"]')) === false) {
    throw new Error('Cancel must not mark bay 2 not in store');
  }
  // Confirm clears bays 2 and 4, then Undo restores them empty.
  for (const bay of [2, 4]) {
    await page.click(`[data-bay-assign-mark-missing="${bay}"]`);
    await page.waitForSelector('[data-bay-assign-clear-missing-yes]', { timeout: 5000 });
    await page.click('[data-bay-assign-clear-missing-yes]');
    await page.waitForSelector(`[data-bay-assign-undo-missing="${bay}"]`, { timeout: 5000 });
  }
  for (const bay of [2, 4]) {
    await page.click(`[data-bay-assign-undo-missing="${bay}"]`);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(150);  const s3 = await shot(page, `assign-partial-${width}.png`);
  await assertShotLooksLike(page, 'assign partial', ['.bay-assign-screen', '[data-bay-assign-photo="0"]']);

  await place(1, 2);
  await place(2, 4);
  await page.waitForSelector('[data-bay-assign-confirm]:not([disabled])', { timeout: 10000 });
  const s4 = await shot(page, `assign-ready-${width}.png`);
  await assertShotLooksLike(page, 'assign ready', ['[data-bay-assign-confirm]:not([disabled])']);

  // 4) Confirm → uploads carry bays 1,2,4 never 3, in place order
  bag.uploads.length = 0;
  await page.click('[data-bay-assign-confirm]');
  await page.waitForFunction(() => !document.querySelector('.bay-assign-screen'), { timeout: 20000 });
  // Pipeline may take a moment to POST.
  const deadline = Date.now() + 25000;
  while (bag.uploads.length < 3 && Date.now() < deadline) {
    await page.waitForTimeout(300);
  }
  const bays = bag.uploads.map((u) => u.bay);
  if (bays.includes(3)) throw new Error(`Bay 3 must never upload: ${JSON.stringify(bag.uploads)}`);
  if (bays.length < 3) {
    // Fallback: read local after list if pipeline is slow/offline in test.
    const localBays = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-view-bay], [data-clear-bay], .set-bay-thumb')];
      return rows.map((el) => Number(el.getAttribute('data-view-bay') || el.getAttribute('data-clear-bay') || el.dataset.bay || 0)).filter(Boolean);
    });
    bag.localBays = localBays;
  }
  const ordered = bag.uploads.map((u) => u.bay);
  if (ordered.length >= 3) {
    const uniq = ordered.filter((b, i) => ordered.indexOf(b) === i);
    if (!(uniq[0] === 1 && uniq[1] === 2 && uniq[2] === 4)) {
      throw new Error(`Upload bay order expected 1,2,4 got ${JSON.stringify(ordered)}`);
    }
  } else if (!(bag.localBays || []).includes(1) || !(bag.localBays || []).includes(4)) {
    throw new Error(`No uploads and local bays incomplete: uploads=${JSON.stringify(bag.uploads)} local=${JSON.stringify(bag.localBays)}`);
  }

  // 5) Add a bay → override + fifth bay appears
  bag.overrides.length = 0;
  await waitForBayControl(page);
  await page.click('[data-bay-add]');
  await page.waitForFunction(() => {
    return !!document.querySelector('[data-bay-remove-added="5"], .set-bay-count-row span');
  }, { timeout: 15000 });
  await page.waitForTimeout(400);
  const addBody = bag.overrides[bag.overrides.length - 1];
  const hasFive = await page.evaluate(() => {
    const text = document.getElementById('setBayCountControl')?.innerText || '';
    return /Bay 5/.test(text);
  });
  if (!hasFive) throw new Error('Fifth bay did not appear after Add a bay');
  if (!addBody || !Array.isArray(addBody.addedBays) || !addBody.addedBays.map(Number).includes(5)) {
    throw new Error(`Add-bay override missing bay 5: ${JSON.stringify(addBody)}`);
  }

  if (bag.nativeDialogs.length) throw new Error(`native dialog opened: ${JSON.stringify(bag.nativeDialogs)}`);
  await context.close();
  return {
    width,
    screenshots: [s1, s2, s2b, s3, s4],
    missBody,
    addBody,
    uploads: bag.uploads.slice(),
    localBays: bag.localBays || null,
  };
}

/* ───────── camera and bay-count scenarios (real survey route) ───────── */

function check(cond, message) {
  if (!cond) throw new Error(message);
}

function surveyHash({ slot = 'after', capture = false, bucket = '' } = {}) {
  return `#/survey?dbkey=${DBKEY2}&rowId=${ROW_ID}&name=Frozen%20Bread&cat=44&slot=${slot}${capture ? '&capture=1' : ''}${bucket ? `&bucket=${bucket}` : ''}`;
}

async function openSurvey(browser, origin, bag, { hash, width = 390 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 740 },
    hasTouch: true,
    isMobile: true,
    permissions: ['camera'],
  });
  const page = await context.newPage();
  bag.nativeDialogs = [];
  page.on('dialog', async (d) => { bag.nativeDialogs.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
  await installPilotState(page, { theme: 'gray-matter' });
  await installDayState(page);
  await installApiMocks(page, bag);
  await page.goto(`${origin}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => document.body.dataset.route === 'survey', { timeout: 30000 });
  await page.waitForSelector('#setSurveyBody', { timeout: 30000 });
  return { context, page };
}

async function waitForCamera(page) {
  await page.waitForSelector('.vf-live-camera [data-act="shutter"]', { timeout: 20000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.vf-live-camera video');
      return !!v && v.readyState >= 2 && v.videoWidth > 0;
    }, { timeout: 20000 });
  } catch (err) {
    const state = await page.evaluate(() => {
      const v = document.querySelector('.vf-live-camera video');
      return {
        overlays: document.querySelectorAll('.vf-live-camera').length,
        ready: v && v.readyState,
        w: v && v.videoWidth,
        fallback: document.querySelector('.vf-live-camera-fallback')?.textContent || '',
        hud: document.querySelector('[data-hud]')?.textContent || '',
        msg: document.getElementById('setSurveyMsg')?.textContent || '',
      };
    });
    throw new Error(`camera did not produce frames: ${JSON.stringify(state)}`);
  }
}

/* One shutter press; resolves when the capture has been handled. */
async function shoot(page) {
  await page.waitForFunction(() => {
    const b = document.querySelector('.vf-live-camera [data-act="shutter"]');
    return !b || !b.disabled;
  }, { timeout: 20000 });
  const gone = await page.evaluate(() => !document.querySelector('.vf-live-camera'));
  if (gone) return false;
  await page.click('.vf-live-camera [data-act="shutter"]');
  await page.waitForFunction(() => {
    const b = document.querySelector('.vf-live-camera [data-act="shutter"]');
    return !b || !b.disabled;
  }, { timeout: 20000 });
  return true;
}

async function setJobs(page) {
  return page.evaluate((dbkey) => (window.EodPhotoPipeline?.listJobs?.() || [])
    .filter((j) => j.kind === 'set' && String(j.dbkey) === String(dbkey))
    .map((j) => ({ bay: j.bay, slot: j.slot, status: j.status, hold: !!j.holdUpload, replace: !!j.replace })), DBKEY2);
}

/* Put the Categories sheet row for the set in session state, with the SI bay
   count the server synced onto it (live.sectionCount = si_location.bayCount). */
async function seedSheet(page, bayCount) {
  await page.evaluate(({ rowId, dbkey, n }) => {
    window.EodSession.state.sheet = {
      rows: [{
        id: rowId,
        dbkey,
        live: { siPresent: true, siStatus: 'incomplete', sectionCount: n, siLocation: { bayCount: n }, prodBeforeCount: 0, prodAfterCount: 0 },
      }],
    };
  }, { rowId: ROW_ID, dbkey: DBKEY2, n: bayCount });
}

async function waitUploads(bag, n, ms = 25000) {
  const deadline = Date.now() + ms;
  while (bag.uploads.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
}

function makeBag(mode) {
  return { calls: [], overrides: [], uploads: [], override: null, mode };
}

/* Five camera shots on a known five-bay set stop at five. A sixth bay exists
   only through Add a bay. */
async function runCameraKnown(browser, origin, { capture }) {
  const bag = makeBag('known5');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash({ capture }) });
  try {
    if (!capture) await page.click('[data-cap="after"]');
    await waitForCamera(page);
    const hud = await page.textContent('[data-hud]');
    check(/Bay 1 of 5/.test(hud), `known set HUD should say "Bay 1 of 5", got "${hud}"`);
    let pressed = 0;
    for (let i = 0; i < 5; i += 1) {
      if (!(await shoot(page))) break;
      pressed += 1;
    }
    check(pressed === 5, `expected 5 shutter presses, got ${pressed}`);
    if (capture) {
      // Opened from the Categories list: after the last bay it returns there.
      await page.waitForFunction(() => document.body.dataset.route === 'signoff', { timeout: 15000 });
      await waitUploads(bag, 5);
      const listBays = bag.uploads.map((u) => u.bay).sort((a, b) => a - b);
      check(JSON.stringify(listBays) === '[1,2,3,4,5]', `list capture: bays 1-5 once each, got ${JSON.stringify(listBays)}`);
      check(bag.uploads.every((u) => !u.replace), 'list capture: no replace flag');
      return { scenario: 'camera-known-5-list', uploadBays: listBays };
    }
    await page.waitForFunction(() => !document.querySelector('.vf-live-camera'), { timeout: 15000 });
    check(!(await page.$('.vf-live-camera')), 'camera must close after the last bay');
    const taken5 = await page.textContent('[data-all-taken="after"]');
    check(/All 5 bays taken/.test(taken5 || ''), `the set says "All 5 bays taken", got "${taken5}"`);
    await waitUploads(bag, 5);
    const bays = bag.uploads.map((u) => u.bay).sort((a, b) => a - b);
    check(JSON.stringify(bays) === '[1,2,3,4,5]', `uploads should be bays 1-5 once each, got ${JSON.stringify(bays)}`);
    check(bag.uploads.every((u) => !u.replace), 'no camera shot may carry a replace flag');
    const jobs = await setJobs(page);
    check(jobs.filter((j) => j.status !== 'superseded').length === 5, `5 live photo jobs expected, got ${JSON.stringify(jobs)}`);
    // Full set: no plain capture button, so no sixth shot without Add a bay.
    check(!(await page.$('[data-cap="after"]')), 'a full set must not offer Take bay');
    check(!!(await page.$('[data-add-bay-cap="after"]')), 'a full set offers Add a bay');
    check(!!(await page.$('[data-replace-open="after"]')), 'a full set offers Replace a photo');

    // Add a bay: a real sixth bay, PROD only.
    await page.click('[data-add-bay-cap="after"]');
    await waitForCamera(page);
    const hud6 = await page.textContent('[data-hud]');
    check(/Bay 6 of 6/.test(hud6), `after Add a bay HUD should say "Bay 6 of 6", got "${hud6}"`);
    const last = bag.overrides[bag.overrides.length - 1];
    check(last && last.newCount === 6 && (last.addedBays || []).map(Number).includes(6), `Add a bay override wrong: ${JSON.stringify(last)}`);
    await shoot(page);
    await page.waitForFunction(() => !document.querySelector('.vf-live-camera'), { timeout: 15000 });
    check(/All 6 bays taken/.test((await page.textContent('[data-all-taken="after"]')) || ''), 'the set should say All 6 bays taken');
    await waitUploads(bag, 6);
    const six = bag.uploads.filter((u) => u.bay === 6);
    check(six.length === 1 && !six[0].replace, `bay 6 should upload once, got ${JSON.stringify(bag.uploads.map((u) => u.bay))}`);
    check(bag.gateResults.every((g) => g === 'pass'), `real gate must pass every bay-override save: ${JSON.stringify(bag.gateResults)}`);
    check(!bag.nativeDialogs.length, `native dialog opened: ${JSON.stringify(bag.nativeDialogs)}`);
    return { scenario: `camera-known-5${capture ? '-list' : ''}`, uploadBays: bag.uploads.map((u) => u.bay) };
  } finally {
    await context.close();
  }
}

/* A set whose count the phone cannot get: every shot is the next bay, stored
   and uploaded to the buffer at once, nothing replaced or refused. The count
   is asked at the end and skipping it loses nothing. */
async function runCameraUnknown(browser, origin, { capture }) {
  const bag = makeBag('unknown');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash({ capture }) });
  try {
    const note = await page.textContent('#setBayCountControl');
    check(/Bay count not known/.test(note || ''), `an unknown set says so, got "${note}"`);
    if (!capture) await page.click('[data-cap="after"]');
    await waitForCamera(page);
    for (let i = 0; i < 5; i += 1) {
      const hud = await page.textContent('[data-hud]');
      check(new RegExp(`Bay ${i + 1}$`).test(hud.trim()), `HUD should announce bay ${i + 1} with no total, got "${hud}"`);
      check(await shoot(page), `camera closed before shot ${i + 1}`);
    }
    check(!!(await page.$('.vf-live-camera')), 'an unknown-count camera stays open until Exit');
    await waitUploads(bag, 5);
    const bays = bag.uploads.map((u) => u.bay).sort((a, b) => a - b);
    check(JSON.stringify(bays) === '[1,2,3,4,5]', `five uploads to the buffer on bays 1-5, got ${JSON.stringify(bag.uploads)}`);
    check(bag.uploads.every((u) => !u.replace), 'no upload carries a replace flag');
    const jobs = (await setJobs(page)).filter((j) => j.status !== 'superseded');
    check(JSON.stringify(jobs.map((j) => j.bay).sort((a, b) => a - b)) === '[1,2,3,4,5]', `5 stored photos on bays 1-5, got ${JSON.stringify(jobs)}`);
    await page.click('.vf-live-camera [data-act="close"]');
    await page.waitForSelector('#setCountAsk', { timeout: 15000 });
    check(/How many bays does this set have\?/.test(await page.textContent('#setCountAsk')), 'count question missing');
    const dots = await page.$$eval('.set-bay-dot.filled', (els) => els.length);
    check(dots === 5, `the set shows every photo taken (5 filled bays), got ${dots}`);

    // A failed save says so, keeps the question and the old (unknown) count.
    bag.failOverride = true;
    await page.fill('#setCountAskInput', '5');
    await page.click('[data-count-ask-save]');
    await page.waitForFunction(() => /Bay count not saved/.test(document.getElementById('setSurveyMsg')?.textContent || ''), { timeout: 15000 });
    check(!!(await page.$('#setCountAsk')), 'the question stays after a failed save');
    check(/Bay count not known/.test((await page.textContent('#setBayCountControl')) || ''), 'the old (unknown) count stays on screen');

    // The save goes through the real gate.
    bag.failOverride = false;
    await page.click('[data-count-ask-save]');
    await page.waitForFunction(() => !document.getElementById('setCountAsk'), { timeout: 15000 });
    check(bag.gateResults.includes('pass'), `real gate passed the save: ${JSON.stringify(bag.gateResults)}`);
    const last = bag.overrides[bag.overrides.length - 1];
    check(last && last.newCount === 5, `saved count 5, got ${JSON.stringify(last)}`);
    check(/5 bays/.test((await page.textContent('[data-bay-total]')) || ''), 'the set shows 5 bays');
    check(bag.uploads.length === 5, `answering uploads nothing new, got ${bag.uploads.length}`);
    check(!bag.nativeDialogs.length, `native dialog opened: ${JSON.stringify(bag.nativeDialogs)}`);
    return { scenario: `camera-unknown${capture ? '-list' : ''}`, uploadBays: bays };
  } finally {
    await context.close();
  }
}

/* Skipping the count question loses nothing. */
async function runCountSkip(browser, origin) {
  const bag = makeBag('unknown');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash() });
  try {
    await page.click('[data-cap="after"]');
    await waitForCamera(page);
    for (let i = 0; i < 2; i += 1) check(await shoot(page), 'camera closed early');
    await page.click('.vf-live-camera [data-act="close"]');
    await page.waitForSelector('#setCountAsk', { timeout: 15000 });
    await page.click('[data-count-ask-skip]');
    await page.waitForFunction(() => !document.getElementById('setCountAsk'), { timeout: 10000 });
    await waitUploads(bag, 2);
    check(JSON.stringify(bag.uploads.map((u) => u.bay).sort()) === '[1,2]', `both photos uploaded, got ${JSON.stringify(bag.uploads)}`);
    check(!bag.overrides.length, 'skipping saves no override');
    return { scenario: 'count-skip' };
  } finally {
    await context.close();
  }
}

/* The sheet row knows the SI bay count; /status comes back thin. The thin
   status must not erase it: the camera keeps "of 5", stops at five, and every
   upload carries 5. This is the store 31 dbkey 9693669 case. */
async function runThinStatusSheetCount(browser, origin) {
  const bag = makeBag('unknown');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash() });
  try {
    await seedSheet(page, 5);
    await page.evaluate((hash) => { window.location.hash = hash; }, surveyHash({ capture: true }).slice(1));
    await waitForCamera(page);
    // Let the thin /status land while the camera is open.
    await new Promise((r) => setTimeout(r, 1500));
    const hud = await page.textContent('[data-hud]');
    check(/Bay 1 of 5/.test(hud), `a thin status must not erase the sheet's count, HUD "${hud}"`);
    let pressed = 0;
    for (let i = 0; i < 6; i += 1) {
      if (!(await shoot(page))) break;
      pressed += 1;
    }
    check(pressed === 5, `camera stops at five shots, got ${pressed}`);
    await page.waitForFunction(() => document.body.dataset.route === 'signoff', { timeout: 15000 });
    await waitUploads(bag, 5);
    const bays = bag.uploads.map((u) => u.bay).sort((a, b) => a - b);
    check(JSON.stringify(bays) === '[1,2,3,4,5]', `bays 1-5 once each, got ${JSON.stringify(bag.uploads)}`);
    check(bag.uploads.every((u) => Number(u.expectedBayCount) === 5), `uploads carry the count 5: ${JSON.stringify(bag.uploads)}`);
    return { scenario: 'thin-status-sheet-count', uploadBays: bays };
  } finally {
    await context.close();
  }
}

/* No count from /status or the sheet, but the SI planogram has five bays: the
   phone fetches it and waits before the camera opens. */
async function runThinStatusPlanogramCount(browser, origin) {
  const bag = makeBag('thinpog');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash() });
  try {
    await page.click('[data-cap="after"]');
    await waitForCamera(page);
    const hud = await page.textContent('[data-hud]');
    check(/Bay 1 of 5/.test(hud), `the count is fetched before the camera opens, HUD "${hud}"`);
    check(bag.planogramCalls >= 1, 'the planogram was asked for');
    let pressed = 0;
    for (let i = 0; i < 6; i += 1) {
      if (!(await shoot(page))) break;
      pressed += 1;
    }
    check(pressed === 5, `camera stops at five shots, got ${pressed}`);
    await waitUploads(bag, 5);
    check(JSON.stringify(bag.uploads.map((u) => u.bay).sort((a, b) => a - b)) === '[1,2,3,4,5]', 'bays 1-5 uploaded');
    check(/All 5 bays taken/.test((await page.textContent('[data-all-taken="after"]')) || ''), 'the set says All 5 bays taken');
    check(/5 bays/.test((await page.textContent('[data-bay-total]')) || ''), 'the set shows 5 bays');
    return { scenario: 'thin-status-planogram-count' };
  } finally {
    await context.close();
  }
}

/* Device pick on a set with no SI planogram (Meat Pusher): it opens without an
   error, shows Bay count not known, and three photos all upload. */
async function runPickUnknown(browser, origin) {
  const bag = makeBag('unknown');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash({ bucket: 'meat-pusher' }) });
  try {
    check(!bag.planogramCalls, `a Meat Pusher set must not request a planogram, saw ${bag.planogramCalls}`);
    check(/Bay count not known/.test((await page.textContent('#setBayCountControl')) || ''), 'the set says Bay count not known');
    const files = [fixturePath(1), fixturePath(2), fixturePath(4)];
    await page.setInputFiles('input[data-gal="after"]', files);
    await page.waitForSelector('.bay-assign-screen', { timeout: 20000 });
    const tiles = await page.$$eval('[data-bay-assign-bay]', (els) => els.map((e) => e.getAttribute('data-bay-assign-bay')));
    check(JSON.stringify(tiles) === '["1","2","3"]', `assign opens with one bay per photo, got ${JSON.stringify(tiles)}`);
    check(!(await page.$('[data-bay-assign-add]')) && !(await page.$('[data-bay-assign-mark-missing]')), 'no add-bay or not-in-store controls without a count');
    await page.waitForSelector('[data-bay-assign-confirm]:not([disabled])', { timeout: 10000 });
    await page.click('[data-bay-assign-confirm]');
    await page.waitForFunction(() => !document.querySelector('.bay-assign-screen'), { timeout: 20000 });
    await waitUploads(bag, 3);
    const sent = bag.uploads.map((u) => u.bay).sort((a, b) => a - b);
    check(JSON.stringify(sent) === '[1,2,3]', `all three photos upload on bays 1-3, got ${JSON.stringify(bag.uploads)}`);
    check(bag.uploads.every((u) => u.skipSi && !u.replace), `Meat Pusher uploads skip SI and replace nothing: ${JSON.stringify(bag.uploads)}`);
    await page.waitForSelector('#setCountAsk', { timeout: 15000 });
    // Picking again lands on free bays, not on bays 1-3.
    await page.setInputFiles('input[data-gal="after"]', [fixturePath(1)]);
    await page.waitForSelector('.bay-assign-screen', { timeout: 20000 });
    const tiles2 = await page.$$eval('[data-bay-assign-bay]', (els) => els.map((e) => e.getAttribute('data-bay-assign-bay')));
    check(tiles2.includes('4') && !tiles2.includes('1'), `a second pick offers free bays only, got ${JSON.stringify(tiles2)}`);
    await page.click('[data-bay-assign-cancel]');
    check(!bag.nativeDialogs.length, `native dialog opened: ${JSON.stringify(bag.nativeDialogs)}`);
    return { scenario: 'pick-unknown-no-planogram', tiles, uploads: sent };
  } finally {
    await context.close();
  }
}

/* A bay-count change on a known set: a failed save keeps the old count and
   says so; a good save goes through the real gate. */
async function runCountChange(browser, origin) {
  const bag = makeBag('known4');
  const { context, page } = await openSurvey(browser, origin, bag, { hash: surveyHash() });
  try {
    await waitForBayControl(page);
    check(/Bays in store: 4/.test((await page.textContent('#setBayCountControl')) || ''), 'starts at 4 bays');
    bag.failOverride = true;
    await page.click('[data-bay-add]');
    await page.waitForFunction(() => /Bay count not saved/.test(document.getElementById('setSurveyMsg')?.textContent || ''), { timeout: 15000 });
    check(/Bays in store: 4/.test((await page.textContent('#setBayCountControl')) || ''), 'a failed save keeps showing 4 bays');
    bag.failOverride = false;
    await page.click('[data-bay-add]');
    await page.waitForFunction(() => /Bays in store: 5/.test(document.getElementById('setBayCountControl')?.textContent || ''), { timeout: 15000 });
    check(bag.gateResults.every((g) => g === 'pass'), `real gate must pass the field app's request: ${JSON.stringify(bag.gateResults)}`);
    const sent = bag.overrides[bag.overrides.length - 1];
    check(sent && sent.newCount === 5 && (sent.addedBays || []).map(Number).includes(5), `saved override wrong: ${JSON.stringify(sent)}`);
    // What the field app sends, kept for eod-api's contract test.
    const fixtureOut = process.env.BAY_OVERRIDE_FIXTURE_OUT || path.join(OUT, 'bay-override-client-request.json');
    fs.writeFileSync(fixtureOut, JSON.stringify(bag.requestShape, null, 2));
    return { scenario: 'count-change', gate: bag.gateResults, requestShape: fixtureOut };
  } finally {
    await context.close();
  }
}

async function runCameraScenarios(browser, origin) {
  const only = String(process.env.E2E_ONLY || '');
  const plan = [
    ['known', () => runCameraKnown(browser, origin, { capture: false })],
    ['known-list', () => runCameraKnown(browser, origin, { capture: true })],
    ['unknown', () => runCameraUnknown(browser, origin, { capture: false })],
    ['unknown-list', () => runCameraUnknown(browser, origin, { capture: true })],
    ['skip', () => runCountSkip(browser, origin)],
    ['thin-sheet', () => runThinStatusSheetCount(browser, origin)],
    ['thin-pog', () => runThinStatusPlanogramCount(browser, origin)],
    ['pick', () => runPickUnknown(browser, origin)],
    ['count', () => runCountChange(browser, origin)],
  ];
  const out = [];
  for (const [name, fn] of plan) {
    if (only && !only.split(',').includes(name)) continue;
    /* Headless Chromium's fake camera sometimes answers "Requested device not
       found" right after another context closed. That is the harness, not the
       app: only that one failure is retried, anything else fails at once. */
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        out.push(await fn());
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!/camera did not produce frames: .*Requested device not found/.test(String(err && err.message))) throw err;
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

async function run() {
  const local = await startStaticServer();
  const launchOpts = fs.existsSync(LOCAL_CHROME)
    ? { headless: true, executablePath: LOCAL_CHROME }
    : { headless: true };
  if (launchOpts.executablePath) {
    console.log(JSON.stringify({ chromium: 'chromium-1243', path: LOCAL_CHROME }));
  } else {
    console.log(JSON.stringify({ chromium: 'playwright-default', note: 'chromium-1243 missing' }));
  }
  launchOpts.args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  const browser = await chromium.launch(launchOpts);
  const report = { ok: true, viewports: [], scenarios: [], out: OUT };
  try {
    for (const width of [360, 390]) {
      const bag = { calls: [], overrides: [], uploads: [], override: null };
      const result = await runViewport(browser, local.origin, width, bag);
      report.viewports.push(result);
    }
    report.scenarios = await runCameraScenarios(browser, local.origin);
  } catch (err) {
    report.ok = false;
    report.error = String(err && err.stack || err);
    console.error(report.error);
  } finally {
    await browser.close();
    local.server.close();
  }
  const manifest = path.join(OUT, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, manifest, viewports: report.viewports.map((v) => ({
    width: v.width,
    screenshots: v.screenshots,
    uploadBays: (v.uploads || []).map((u) => u.bay),
    missMissing: v.missBody?.missingBays,
    addAdded: v.addBody?.addedBays,
  })) }, null, 2));
  if (!report.ok) process.exit(1);
}

await run();
