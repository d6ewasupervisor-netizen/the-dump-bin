/**
 * Repro for the lost bays on a set whose /status comes back thin.
 *
 *   APP_ROOT=<path to an eod-field-app tree> node scripts/bay-count-thin-repro.mjs
 *
 * The Categories sheet row carries the SI bay count (5). /status, stored-only on
 * the server, answers thin (no count). Five camera shots from the list. Prints
 * the HUD before each shot, what the phone stored, and what it uploaded.
 * Live 3.5.45 stores and uploads bay 1 only; 3.5.46 stores and uploads 1-5.
 * Headless Chromium with a fake camera. No SAS or Store Intelligence calls.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaticServer, installPilotState, todayIso } from './smoke-blank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : path.resolve(HERE, '..');
const DBKEY = '9693669';
const LOCAL_CHROME = 'C:\\Users\\tgaut\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';

const prod = { status: 'open', visitId: '27560582', resetId: '42582826', beforeCount: 0, afterCount: 0 };
const thinStatus = {
  ok: true,
  status: {
    expectedBayCount: null,
    planogramBayCount: null,
    bayOverride: null,
    prod,
    si: { status: 'unknown', message: 'not checked' },
    bays: [],
  },
};

const local = await startStaticServer(ROOT);
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(LOCAL_CHROME) ? { executablePath: LOCAL_CHROME } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 740 }, hasTouch: true, isMobile: true, permissions: ['camera'] });
const page = await context.newPage();
const uploads = [];
await installPilotState(page, { theme: 'gray-matter' });
await page.addInitScript(({ date }) => {
  localStorage.setItem('kompassDayConfirm', JSON.stringify({ token: 'x', store: '31', date, expiresAt: Date.now() + 36e5 }));
  const raw = JSON.parse(localStorage.getItem('kompassEOD') || '{}');
  raw.storeNumber = '31'; raw.workDate = date; raw.visitStep = 'done'; raw.selectedShift = { visitId: '27560582' };
  localStorage.setItem('kompassEOD', JSON.stringify(raw));
}, { date: todayIso() });
await page.route('**/api/**', async (route) => {
  const req = route.request();
  const p = new URL(req.url()).pathname;
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (p.includes('/api/field-set/status')) return json(200, thinStatus);
  if (p.includes('/api/field-set/planogram')) return json(404, { ok: false, error: 'No SI planogram for dbkey' });
  if (p.includes('/api/field-set/photo-bin')) {
    const meta = JSON.parse(req.headers()['x-photo-meta'] || '{}');
    uploads.push({ bay: meta.bay, expectedBayCount: meta.expectedBayCount ?? null, replace: !!(meta.replace || meta.force) });
    return json(200, { ok: true, accepted: true });
  }
  return json(200, { ok: true, rows: [], photos: [], payload: {} });
});

const survey = (capture) => `#/survey?dbkey=${DBKEY}&rowId=r1&name=Frozen%20Bread&cat=44&slot=after${capture ? '&capture=1' : ''}`;
await page.goto(`${local.origin}/${survey(false)}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.dataset.route === 'survey' && !!window.EodSession, { timeout: 30000 });
await page.evaluate(({ rowId, dbkey }) => {
  window.EodSession.state.sheet = {
    rows: [{ id: rowId, dbkey, live: { siPresent: true, siStatus: 'incomplete', sectionCount: 5, siLocation: { bayCount: 5 }, prodBeforeCount: 0, prodAfterCount: 0 } }],
  };
}, { rowId: 'r1', dbkey: DBKEY });
await page.evaluate((hash) => { window.location.hash = hash; }, survey(true).slice(1));
await page.waitForSelector('.vf-live-camera [data-act="shutter"]', { timeout: 30000 });
await page.waitForFunction(() => { const v = document.querySelector('.vf-live-camera video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, { timeout: 30000 });
await page.waitForTimeout(1500);

const shots = [];
for (let i = 1; i <= 5; i += 1) {
  const hud = (await page.textContent('[data-hud]').catch(() => '')) || '';
  const open = await page.$('.vf-live-camera');
  if (!open) { shots.push({ shot: i, note: 'camera closed' }); break; }
  await page.waitForFunction(() => !document.querySelector('.vf-live-camera [data-act="shutter"]')?.disabled);
  await page.click('.vf-live-camera [data-act="shutter"]');
  let toast = '';
  for (let k = 0; k < 12 && !toast; k += 1) {
    await page.waitForTimeout(60);
    toast = await page.evaluate(() => { const t = document.querySelector('[data-toast]'); return t && !t.hidden ? t.textContent : ''; }).catch(() => '');
  }
  await page.waitForFunction(() => { const b = document.querySelector('.vf-live-camera [data-act="shutter"]'); return !b || !b.disabled; }).catch(() => {});
  shots.push({ shot: i, hudBefore: hud.trim(), toast });
}
const stored = await page.evaluate((dbkey) => (window.EodPhotoPipeline?.listJobs?.() || [])
  .filter((j) => String(j.dbkey) === dbkey && j.status !== 'superseded').map((j) => j.bay).sort((a, b) => a - b), DBKEY);
await page.waitForTimeout(3000);
console.log(JSON.stringify({
  app: ROOT.split(path.sep).slice(-2).join('/'),
  version: JSON.parse(fs.readFileSync(path.join(ROOT, 'eod-version.json'), 'utf8')).version,
  shots,
  storedBays: stored,
  uploadedBays: uploads.map((u) => u.bay).sort((a, b) => a - b),
  uploads,
}, null, 1));
await browser.close();
local.server.close();
