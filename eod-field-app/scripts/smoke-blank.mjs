import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VIEWPORTS = [
  { name: 'iphone-se', width: 320, height: 568 },
  { name: 'android-s', width: 360, height: 640 },
  { name: 'iphone-8', width: 375, height: 667 },
  { name: 'iphone-12', width: 390, height: 844 },
  { name: 'iphone-14-max', width: 430, height: 932 },
  { name: 'phone-landscape', width: 667, height: 375 },
  { name: 'tablet', width: 768, height: 1024 },
];

export const ROUTES = [
  { hash: '#/visit', route: 'visit' },
  { hash: '#/signoff', route: 'signoff' },
  { hash: '#/signatures', route: 'signatures' },
  { hash: '#/send', route: 'send' },
  { hash: '#/crew', route: 'crew' },
  { hash: '#/dumpbin', route: 'dumpbin' },
  { hash: '#/helpdesk', route: 'helpdesk' },
  { hash: '#/photos', route: 'photos' },
  { hash: '#/storage', route: 'storage' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function fakeJwt() {
  return ['eyJhbGciOiJub25lIn0', 'eyJlbWFpbCI6InQudGVzdEBleGFtcGxlLmNvbSJ9', 'x'].join('.');
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function startStaticServer(root = ROOT, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let filePath = path.join(root, decodeURIComponent(url.pathname));
      if (url.pathname === '/' || url.pathname.endsWith('/')) {
        filePath = path.join(root, url.pathname, 'index.html');
      }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

export function installPilotState(page, { theme = 'gray-matter' } = {}) {
  const tok = fakeJwt();
  const date = todayIso();
  return page.addInitScript(({ tok, date, theme }) => {
    localStorage.setItem('dumpBinSession', tok);
    localStorage.setItem('eodFieldTheme', theme);
    localStorage.setItem('kompassDayConfirm', JSON.stringify({
      token: 'smoke',
      store: '123',
      date,
      expiresAt: Date.now() + 36 * 60 * 60 * 1000,
    }));
    localStorage.setItem('kompassEOD', JSON.stringify({
      storeNumber: '123',
      workDate: date,
      profileName: 'Smoke Tester',
      profileEmail: 't.test@example.com',
      leadName: 'Smoke Tester',
      visitStep: 'done',
      savedAt: Date.now(),
      app: 'eod-field-app',
    }));
  }, { tok, date, theme });
}

export async function measureLayout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overflow = document.documentElement.scrollWidth - vw;
    const chrome = document.getElementById('appChrome');
    const nav = document.getElementById('bottomNav');
    const mount = document.getElementById('appMount');
    const chromeBox = chrome?.getBoundingClientRect();
    const navBox = nav?.getBoundingClientRect();
    const mountBox = mount?.getBoundingClientRect();
    const selectors = [
      '#bottomNav .nav-item',
      '#appMount .btn',
      '.eod-alert-actions .btn',
      '.more-sheet .btn',
    ];
    const small = [];
    const clipped = [];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (r.width + 0.5 < 44 || r.height + 0.5 < 44) {
          small.push({
            sel,
            text: (el.textContent || '').trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
        if (r.right > vw + 1 || r.left < -1) {
          clipped.push({
            sel,
            text: (el.textContent || '').trim().slice(0, 40),
            right: Math.round(r.right),
            left: Math.round(r.left),
          });
        }
      });
    }
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return {
      route: document.body.dataset.route || '',
      theme: document.documentElement.getAttribute('data-theme') || '',
      bg,
      overflow,
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-t').trim(),
      chromeNavGap: chromeBox && mountBox ? mountBox.top - chromeBox.bottom : null,
      mountNavGap: navBox && mountBox ? navBox.top - mountBox.bottom : null,
      small,
      clipped,
      hasMount: !!(mount && mount.innerHTML.trim()),
    };
  });
}

export async function probeAlert(page) {
  await page.evaluate(() => {
    window.EodAlerts?.alert?.('Smoke', 'Dialog should scroll and stay on screen.');
  });
  await page.waitForTimeout(150);
  const dialog = await page.evaluate(() => {
    const overlay = document.querySelector('.eod-alert-overlay.show');
    const box = overlay?.querySelector('.eod-alert-dialog');
    if (!overlay || !box) return null;
    const r = box.getBoundingClientRect();
    const focus = document.activeElement;
    return {
      visible: r.width > 0 && r.height > 0,
      inView: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1,
      overflowY: getComputedStyle(overlay).overflowY,
      focused: !!(focus && overlay.contains(focus)),
    };
  });
  await page.evaluate(() => {
    document.querySelector('.eod-alert-overlay.show')?.querySelector('button')?.click();
  });
  return dialog;
}

export async function openPage(browser, origin, viewport, hash) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true,
    isMobile: viewport.width < 768,
  });
  const page = await context.newPage();
  await installPilotState(page);
  await page.goto(`${origin}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const mount = document.getElementById('appMount');
    return !!(mount && mount.innerHTML.trim() && document.body.dataset.route);
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(250);
  return { context, page };
}

async function runVisitSmoke() {
  const provided = process.env.PILOT_URL;
  const local = provided ? null : await startStaticServer();
  const origin = provided || local.origin;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installPilotState(page, { theme: 'dark' });
  await page.goto(`${origin}/#/visit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    needsAuth: document.body.classList.contains('needs-auth'),
    route: document.body.dataset.route || '',
    mountHtmlLen: (document.getElementById('appMount')?.innerHTML || '').length,
    mountText: (document.getElementById('appMount')?.innerText || '').slice(0, 200),
    signInHidden: document.getElementById('pilotSignIn')?.hidden,
    chromeHidden: document.getElementById('appChrome')?.hidden,
    hasVisit: !!document.getElementById('confirmVisitBtn') || !!document.getElementById('storeNumber'),
    scriptsOk: typeof window.EodRouter === 'object' && typeof window.EodSession === 'object',
  }));
  console.log(JSON.stringify({ state, errors }, null, 2));
  await browser.close();
  if (local) local.server.close();
  process.exit(!state.hasVisit || !state.scriptsOk ? 1 : 0);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  await runVisitSmoke();
}
