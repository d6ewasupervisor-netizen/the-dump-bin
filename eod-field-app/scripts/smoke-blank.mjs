import { chromium } from 'playwright';

const base = process.env.PILOT_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

// Fake JWT shape (will 401 API but should still render Visit UI)
const fakeJwt = ['eyJhbGciOiJub25lIn0', 'eyJlbWFpbCI6InQudGVzdEBleGFtcGxlLmNvbSJ9', 'x'].join('.');
await page.addInitScript((tok) => {
  localStorage.setItem('dumpBinSession', tok);
}, fakeJwt);

await page.goto(base + '/#/visit', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

const state = await page.evaluate(() => ({
  needsAuth: document.body.classList.contains('needs-auth'),
  route: document.body.dataset.route || '',
  mountHtmlLen: (document.getElementById('appMount')?.innerHTML || '').length,
  mountText: (document.getElementById('appMount')?.innerText || '').slice(0, 200),
  signInHidden: document.getElementById('pilotSignIn')?.hidden,
  chromeHidden: document.getElementById('appChrome')?.hidden,
  hasVisit: !!document.getElementById('visitStore'),
  scriptsOk: typeof window.EodRouter === 'object' && typeof window.EodSession === 'object',
  routes: window.EodRouter ? ['probe'] : [],
}));

console.log(JSON.stringify({ state, errors }, null, 2));
await browser.close();
process.exit(errors.length && !state.hasVisit ? 1 : 0);
