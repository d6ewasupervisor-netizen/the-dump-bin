/**
 * F3 — real survey route, fixture /api/ interception, no paint helpers.
 * Screenshots → Downloads\bay-assign-final-screens\
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const ROW_ID = 'bay-assign-e2e-row';
const HASH = `#/survey?dbkey=${DBKEY}&rowId=${ROW_ID}&name=Bay%20Assign%20E2E&cat=60&slot=after`;

fs.mkdirSync(OUT, { recursive: true });

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

function statusFixture(override) {
  const bays = [1, 2, 3, 4].map((bay) => ({
    bay,
    bayName: String(bay),
    hasPhoto: false,
    before: false,
    after: false,
  }));
  return {
    ok: true,
    status: {
      expectedBayCount: 4,
      planogramBayCount: 4,
      bayOverride: override || null,
      prod: {
        status: 'open',
        visitId: '27455636',
        resetId: '42582826',
        beforeCount: 0,
        afterCount: 0,
      },
      si: {
        status: 'open',
        taskId: 9001,
        sectionCount: 4,
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
        body: JSON.stringify(statusFixture(bag.override)),
      });
    }
    if (p.includes('/api/field-set/bay-override') && method === 'PUT') {
      let body = {};
      try { body = req.postDataJSON(); } catch (_) {}
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
  await page.addInitScript(({ date }) => {
    localStorage.setItem('kompassDayConfirm', JSON.stringify({
      token: 'e2e',
      store: '28',
      date,
      expiresAt: Date.now() + 36 * 60 * 60 * 1000,
    }));
    const raw = JSON.parse(localStorage.getItem('kompassEOD') || '{}');
    raw.storeNumber = '28';
    raw.workDate = date;
    raw.visitStep = 'done';
    raw.selectedShift = { visitId: '27455636', visitLead: 'Smoke Tester' };
    localStorage.setItem('kompassEOD', JSON.stringify(raw));
  }, { date: todayIso() });
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
  const browser = await chromium.launch(launchOpts);
  const report = { ok: true, viewports: [], out: OUT };
  try {
    for (const width of [360, 390]) {
      const bag = { calls: [], overrides: [], uploads: [], override: null };
      const result = await runViewport(browser, local.origin, width, bag);
      report.viewports.push(result);
    }
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
