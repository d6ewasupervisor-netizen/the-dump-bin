#!/usr/bin/env node
/**
 * Smoke checks for the Checklanes assignment hub stack:
 * - the-dump-bin.com/checklanes (GitHub Pages)
 * - eod-api.the-dump-bin.com (Railway)
 * - checklanes.the-dump-bin.com (POG static assets)
 */
import { API_BASE, HUB_BASE, POG_BASE, SITE_BASE } from '../config.mjs';

const UA = 'Mozilla/5.0 (compatible; ChecklanesStrengthTest/1.0)';

/** @type {{ name: string, pass: boolean, detail: string }[]} */
const checks = [];

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, pass: result.pass, detail: result.detail });
  } catch (err) {
    checks.push({ name, pass: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

async function headOrGet(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    ...opts,
  });
  return res;
}

await check('GET auth-gate.js', async () => {
  const res = await headOrGet(`${SITE_BASE}/auth-gate.js`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const text = await res.text();
  const ok = text.includes('eod-api.the-dump-bin.com') || text.includes('dumpBinAuthFetch');
  return ok
    ? { pass: true, detail: 'auth gate references eod-api' }
    : { pass: false, detail: 'auth-gate.js missing expected API wiring' };
});

await check('GET checklanes/index.html', async () => {
  const res = await headOrGet(`${HUB_BASE}/index.html`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const text = await res.text();
  const ok = /checklanes|select store/i.test(text) && text.includes('auth-gate.js');
  return ok ? { pass: true, detail: 'HTML + auth-gate' } : { pass: false, detail: 'unexpected index.html body' };
});

await check('GET checklanes/hub.html', async () => {
  const res = await headOrGet(`${HUB_BASE}/hub.html`);
  return res.ok ? { pass: true, detail: `HTTP ${res.status}` } : { pass: false, detail: `HTTP ${res.status}` };
});

await check('GET checklanes/hub-presence.js', async () => {
  const res = await headOrGet(`${HUB_BASE}/hub-presence.js`);
  return res.ok ? { pass: true, detail: `HTTP ${res.status}` } : { pass: false, detail: `HTTP ${res.status}` };
});

await check('GET eod-api hub routes reachable', async () => {
  const res = await fetch(`${API_BASE}/api/hub/stores`, {
    headers: { Origin: SITE_BASE, 'User-Agent': UA },
  });
  if (res.status >= 500) return { pass: false, detail: `HTTP ${res.status}` };
  return { pass: true, detail: `HTTP ${res.status} (Railway eod-api responding)` };
});

await check('GET /api/hub/stores requires auth (401)', async () => {
  const res = await fetch(`${API_BASE}/api/hub/stores`, {
    headers: { Origin: SITE_BASE, 'User-Agent': UA },
  });
  if (res.status === 401) return { pass: true, detail: 'HTTP 401' };
  if (res.status === 403) return { pass: true, detail: 'HTTP 403' };
  return { pass: false, detail: `HTTP ${res.status} (expected 401/403, not 5xx)` };
});

await check('CORS allows the-dump-bin.com on hub API', async () => {
  const res = await fetch(`${API_BASE}/api/hub/stores`, {
    method: 'OPTIONS',
    headers: {
      Origin: SITE_BASE,
      'User-Agent': UA,
      'Access-Control-Request-Method': 'GET',
    },
  });
  const allowOrigin = res.headers.get('access-control-allow-origin') || '';
  const ok = res.status < 500 && (allowOrigin === SITE_BASE || allowOrigin === '*');
  return ok
    ? { pass: true, detail: allowOrigin || `HTTP ${res.status}` }
    : { pass: false, detail: `missing CORS for ${SITE_BASE} (HTTP ${res.status})` };
});

await check('GET POG /health', async () => {
  const res = await headOrGet(`${POG_BASE}/health`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = await res.json();
  return body.ok === true ? { pass: true, detail: 'ok: true' } : { pass: false, detail: JSON.stringify(body) };
});

for (const path of ['/products.json', '/pog_previews.json']) {
  await check(`GET POG ${path}`, async () => {
    const res = await headOrGet(`${POG_BASE}${path}`);
    if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
    try {
      JSON.parse(await res.text());
      return { pass: true, detail: 'valid JSON' };
    } catch {
      return { pass: false, detail: 'invalid JSON' };
    }
  });
}

await check('GET POG scan_index/615.json', async () => {
  const res = await headOrGet(`${POG_BASE}/scan_index/615.json`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = await res.json();
  return body.store === 615
    ? { pass: true, detail: 'store 615 index' }
    : { pass: false, detail: 'unexpected scan index payload' };
});

await check('GET POG canonical PDF (hub CORS)', async () => {
  const pdfPath = '/pdfs/D701_L00000_D03_C201_VQ49_F002_MX_8920140.pdf';
  const res = await headOrGet(`${POG_BASE}${pdfPath}`, {
    headers: { Origin: SITE_BASE },
  });
  const allowOrigin = res.headers.get('access-control-allow-origin') || '';
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const ok = allowOrigin === SITE_BASE || allowOrigin === '*';
  return ok
    ? { pass: true, detail: 'application/pdf + CORS' }
    : { pass: false, detail: `missing CORS (${allowOrigin || 'none'})` };
});

await check('GET POG store-specific PDF (163 dbkey index)', async () => {
  const pdfPath = '/pdfs/D701_L00163_D03_C201_VS02_F024_MX_8844804.pdf';
  const res = await headOrGet(`${POG_BASE}${pdfPath}`, {
    headers: { Origin: SITE_BASE },
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const allowOrigin = res.headers.get('access-control-allow-origin') || '';
  const ok = allowOrigin === SITE_BASE || allowOrigin === '*';
  return ok
    ? { pass: true, detail: 'store 163 side-shelf PDF reachable' }
    : { pass: false, detail: `missing CORS (${allowOrigin || 'none'})` };
});

await check('GET POG expected_pdfs.txt', async () => {
  const res = await headOrGet(`${POG_BASE}/expected_pdfs.txt`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((ln) => /_\d{7}\.pdf$/i.test(ln.trim()));
  return lines.length >= 200
    ? { pass: true, detail: `${lines.length} pdf entries` }
    : { pass: false, detail: `only ${lines.length} pdf entries` };
});

await check('hub.html resolves PDFs via expected_pdfs dbkey index', async () => {
  const res = await headOrGet(`${HUB_BASE}/hub.html`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const text = await res.text();
  const ok =
    text.includes('expected_pdfs.txt') &&
    text.includes('pogPdfByDbkey') &&
    text.includes('buildPogPdfIndexFromManifestText');
  return ok
    ? { pass: true, detail: 'hub loads dbkey→pdf map from POG host' }
    : { pass: false, detail: 'hub.html missing expected_pdfs.pdf index wiring' };
});

const ok = checks.every((c) => c.pass);
console.log(
  JSON.stringify(
    { ok, target: 'hub', siteBase: SITE_BASE, hubBase: HUB_BASE, apiBase: API_BASE, pogBase: POG_BASE, checks },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
