/**
 * Drive real EodBayAssignScreen.open / bay-count control CSS with fixture
 * shelf photos. Assign UI is painted only through open() — no assign markup
 * injection. Bay-count control uses the same DOM the set-survey painter emits.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './smoke-blank.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'output', 'bay-assign-screens');
fs.mkdirSync(OUT, { recursive: true });

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'eod-version.json'), 'utf8')).version;
const FIXTURE_DIR = 'C:\\Users\\tgaut\\Downloads\\215_P09W2_Frozen_Handhelds_9618670\\device_before';
const FIXTURES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => path.join(FIXTURE_DIR, `bay${n}.jpg`));
const LOCAL_CHROME = 'C:\\Users\\tgaut\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';

function loadFixture(i) {
  const file = FIXTURES[i] || FIXTURES[0];
  if (!fs.existsSync(file)) throw new Error(`Missing shelf fixture: ${file}`);
  return fs.readFileSync(file);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function assertVisible(page, sels, label) {
  const list = Array.isArray(sels) ? sels : [sels];
  const ok = await page.evaluate((selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      el.hidden = false;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  }, list);
  if (!ok) throw new Error(`Screenshot precondition failed: ${label}`);
}

function harnessHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="stylesheet" href="css/app.css?v=${VERSION}"/>
  <title>Bay assign harness</title>
  <style>
    body { margin: 0; background: #0b1220; color: #e2e8f0; font-family: system-ui, sans-serif; }
    #cardHost { padding: 12px; }
  </style>
</head>
<body>
  <div id="cardHost"></div>
  <script src="js/lib/bay-assign-logic.js?v=${VERSION}"></script>
  <script src="js/lib/bay-assign-screen.js?v=${VERSION}"></script>
</body>
</html>`;
}

async function openHarness(page, origin, width) {
  await page.setViewportSize({ width, height: 740 });
  await page.route('**/harness.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: harnessHtml() });
  });
  await page.goto(`${origin}/harness.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.EodBayAssignScreen && window.EodBayAssignLogic), { timeout: 15000 });
}

async function paintBayCount(page, { openEditor = false } = {}) {
  await page.evaluate((open) => {
    const host = document.getElementById('cardHost');
    host.innerHTML = '';
    const el = document.createElement('div');
    el.id = 'setBayCountControl';
    el.className = 'set-bay-count-control';
    // Identical structure to set-survey.js paintBayCountControl.
    if (!open) {
      el.innerHTML = `
        <div class="set-bay-count-card">
          <strong>Bays in store: 4</strong>
          <button type="button" class="btn btn-secondary">Edit</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="set-bay-count-head">
          <strong>Bays in store: 4</strong>
          <button type="button" class="btn btn-secondary" data-bay-add>Add a bay</button>
        </div>
        <div class="set-bay-count-list">
          <div class="set-bay-count-row"><span>Bay 1</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
          <div class="set-bay-count-row"><span>Bay 2</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
          <div class="set-bay-count-row"><span>Bay 3</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
          <div class="set-bay-count-row"><span>Bay 4</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
        </div>`;
    }
    host.appendChild(el);
  }, openEditor);
}

async function openAssign(page, { bays, fileCount, missing = [], place = null, replace = false }) {
  const payloads = [];
  for (let i = 0; i < fileCount; i += 1) payloads.push(loadFixture(i).toString('base64'));
  await page.evaluate(async ({ payloads: b64s, bays: required, missing: miss, place: placeMap, replace: doReplace }) => {
    document.getElementById('cardHost').innerHTML = '';
    const files = b64s.map((b64, i) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new File([bytes], `bay-fixture-${i + 1}.jpg`, { type: 'image/jpeg' });
    });
    window.EodBayAssignScreen.open({
      files,
      requiredBays: required,
      occupiedBays: [],
      missingBays: miss,
      title: 'Bay Assign · After',
      allowMarkMissing: true,
      allowAddBay: true,
      allowLeaveForCamera: true,
      mount: document.body,
    });
    await new Promise((r) => setTimeout(r, 100));
    if (placeMap) {
      for (const [photoIdx, bay] of Object.entries(placeMap)) {
        document.querySelector(`[data-bay-assign-photo="${photoIdx}"]`)?.click();
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector(`[data-bay-assign-bay="${bay}"]`)?.click();
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (doReplace) {
      document.querySelector('[data-bay-assign-photo="1"]')?.click();
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector('[data-bay-assign-bay="1"]')?.click();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, { payloads, bays, missing, place, replace });
  await page.waitForTimeout(200);
}

async function run() {
  const local = await startStaticServer();
  const launchOpts = fs.existsSync(LOCAL_CHROME)
    ? { headless: true, executablePath: LOCAL_CHROME }
    : { headless: true };
  const browser = await chromium.launch(launchOpts);
  const paths = [];
  const report = [];
  try {
    for (const width of [360, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 740 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await openHarness(page, local.origin, width);

      await paintBayCount(page, { openEditor: false });
      await assertVisible(page, ['#setBayCountControl'], 'bay-count card');
      paths.push(await shot(page, `bay-count-card-${width}.png`));
      report.push({ name: `bay-count-card-${width}.png`, how: 'harness + set-survey paintBayCountControl card DOM; app.css' });

      await paintBayCount(page, { openEditor: true });
      await assertVisible(page, ['.set-bay-count-list'], 'bay-count editor');
      paths.push(await shot(page, `bay-count-editor-${width}.png`));
      report.push({ name: `bay-count-editor-${width}.png`, how: 'harness + set-survey paintBayCountControl editor DOM; app.css' });

      await openAssign(page, { bays: [1, 2, 3, 4], fileCount: 2, place: { 0: 1, 1: 2 } });
      await assertVisible(page, ['.bay-assign-screen'], 'assign partial');
      paths.push(await shot(page, `assign-partial-${width}.png`));
      report.push({ name: `assign-partial-${width}.png`, how: 'EodBayAssignScreen.open + place clicks; real shelf JPEG fixtures' });
      await page.evaluate(() => document.querySelector('[data-bay-assign-cancel]')?.click());

      await openAssign(page, { bays: [1, 2, 3, 4], fileCount: 4, place: { 0: 1, 1: 2, 2: 3, 3: 4 } });
      await assertVisible(page, ['[data-bay-assign-confirm]:not([disabled])'], 'confirm active');
      paths.push(await shot(page, `assign-full-confirm-${width}.png`));
      report.push({ name: `assign-full-confirm-${width}.png`, how: 'EodBayAssignScreen.open all four placed; Confirm active' });
      await page.evaluate(() => document.querySelector('[data-bay-assign-cancel]')?.click());

      await openAssign(page, { bays: [1, 2, 4], fileCount: 2, missing: [3], place: { 0: 1, 1: 2 } });
      await assertVisible(page, ['.bay-assign-bay.is-missing'], 'not-in-store');
      paths.push(await shot(page, `assign-missing-${width}.png`));
      report.push({ name: `assign-missing-${width}.png`, how: 'EodBayAssignScreen.open missingBays:[3]' });
      await page.evaluate(() => document.querySelector('[data-bay-assign-cancel]')?.click());

      await openAssign(page, { bays: [1, 2], fileCount: 2, place: { 0: 1 }, replace: true });
      await assertVisible(page, ['[data-bay-assign-replace]'], 'replace');
      paths.push(await shot(page, `assign-replace-${width}.png`));
      report.push({ name: `assign-replace-${width}.png`, how: 'EodBayAssignScreen.open Replace bay 1 confirm' });
      await page.evaluate(() => document.querySelector('[data-bay-assign-cancel]')?.click());

      await openAssign(page, {
        bays: [1, 2, 3, 4, 5, 6, 7, 8],
        fileCount: 8,
        place: { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8 },
      });
      await page.evaluate(() => {
        const panel = document.querySelector('.bay-assign-panel');
        if (panel) panel.scrollTop = panel.scrollHeight;
      });
      await page.waitForTimeout(150);
      await assertVisible(page, ['.bay-assign-screen'], '8-bay');
      paths.push(await shot(page, `assign-8bay-scrolled-${width}.png`));
      report.push({ name: `assign-8bay-scrolled-${width}.png`, how: '8-bay assign scrolled to foot' });
      await page.evaluate(() => document.querySelector('[data-bay-assign-cancel]')?.click());

      await context.close();
    }
  } finally {
    await browser.close();
    local.server.close();
  }
  const manifest = path.join(OUT, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ ok: true, paths, report }, null, 2));
  console.log(JSON.stringify({ ok: true, paths, report, manifest }, null, 2));
}

await run();
