#!/usr/bin/env node
/**
 * Check the field-app preview channel.
 *
 *   node scripts/verify-field-app-preview.mjs            local: serve this checkout, load live + preview side by side
 *   node scripts/verify-field-app-preview.mjs --remote   hosted: read https://the-dump-bin.com
 *
 * Local mode proves, in headless Chromium on one origin:
 *   - the preview shows PREVIEW and its version
 *   - the preview registers its own service worker, scoped to /eod-field-app-next/
 *   - after both workers activate, the live cache (eod-field-X) and the preview
 *     cache (eod-preview-X) both still exist: neither deleted the other's
 * Remote mode proves the preview page and version are up and the live
 * eod-version.json is what it was.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { installPilotState } from '../eod-field-app/scripts/smoke-blank.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_CHROME = 'C:\\Users\\tgaut\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const remote = process.argv.includes('--remote');
const expectLive = (() => { const i = process.argv.indexOf('--live-version'); return i > 0 ? process.argv[i + 1] : null; })();
const out = { mode: remote ? 'remote' : 'local', checks: [] };
const check = (name, ok, detail) => { out.checks.push({ name, ok: !!ok, detail }); if (!ok) process.exitCode = 1; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(REPO, rel);
    if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function remoteMode() {
  const base = 'https://the-dump-bin.com';
  const html = await (await fetch(`${base}/eod-field-app-next/?t=${Date.now()}`)).text();
  const ver = await (await fetch(`${base}/eod-field-app-next/eod-version.json?t=${Date.now()}`)).json();
  const live = await (await fetch(`${base}/eod-field-app/eod-version.json?t=${Date.now()}`)).json();
  const sw = await (await fetch(`${base}/eod-field-app-next/sw.js?t=${Date.now()}`)).text();
  check('preview page has the PREVIEW banner', /id="eodPreviewBanner"[^>]*>PREVIEW v[\d.]+/.test(html), (html.match(/PREVIEW v[\d.]+ · \w+/) || [''])[0]);
  check('preview version', Boolean(ver.version), ver.version);
  check('preview worker uses eod-preview-* caches only', /const CACHE = 'eod-preview-/.test(sw) && !/startsWith\('eod-field-'\)/.test(sw), '');
  if (expectLive) check(`live eod-version.json reads ${expectLive}`, live.version === expectLive, live.version);
  out.preview = ver.version;
  out.live = live.version;
}

async function localMode() {
  const server = await serve();
  const port = server.address().port;
  const origin = `http://the-dump-bin.com:${port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(LOCAL_CHROME) ? { executablePath: LOCAL_CHROME } : {}),
    args: [`--host-resolver-rules=MAP the-dump-bin.com 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${origin}`],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 740 } });
    const page = await context.newPage();
    await installPilotState(page, { theme: 'gray-matter' });
    await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    const liveVer = JSON.parse(fs.readFileSync(path.join(REPO, 'eod-field-app', 'eod-version.json'), 'utf8')).version;
    const prevVer = JSON.parse(fs.readFileSync(path.join(REPO, 'eod-field-app-next', 'eod-version.json'), 'utf8')).version;
    const settle = async () => {
      await page.waitForFunction(async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.some((r) => r.active);
      }, { timeout: 30000 });
      await page.waitForTimeout(1500);
    };
    // Live first, then preview, then live again: each worker activates against the other's caches.
    await page.goto(`${origin}/eod-field-app/`, { waitUntil: 'domcontentloaded' });
    await settle();
    await page.goto(`${origin}/eod-field-app-next/`, { waitUntil: 'domcontentloaded' });
    await settle();
    const banner = await page.textContent('#eodPreviewBanner').catch(() => '');
    check('preview shows PREVIEW and its version', new RegExp(`PREVIEW v${prevVer.replace(/\./g, '\\.')}`).test(banner || ''), `banner="${banner}" url=${page.url()}`);
    const state = await page.evaluate(async () => ({
      scopes: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort(),
      caches: (await caches.keys()).filter((k) => /^eod-(field|preview)-/.test(k)).sort(),
    }));
    check('live and preview each have their own worker scope', state.scopes.includes('/eod-field-app/') && state.scopes.includes('/eod-field-app-next/'), JSON.stringify(state.scopes));
    check('live cache survives the preview worker', state.caches.includes(`eod-field-${liveVer}`), JSON.stringify(state.caches));
    check('preview cache uses the eod-preview prefix', state.caches.includes(`eod-preview-${prevVer}`), JSON.stringify(state.caches));
    await page.goto(`${origin}/eod-field-app/`, { waitUntil: 'domcontentloaded' });
    await settle();
    const after = await page.evaluate(async () => (await caches.keys()).filter((k) => /^eod-(field|preview)-/.test(k)).sort());
    check('preview cache survives the live worker', after.includes(`eod-preview-${prevVer}`) && after.includes(`eod-field-${liveVer}`), JSON.stringify(after));
    out.state = state;
  } finally {
    await browser.close();
    server.close();
  }
}

await (remote ? remoteMode() : localMode());
console.log(JSON.stringify(out, null, 1));
