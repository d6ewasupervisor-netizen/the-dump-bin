/* Field-app shell cache so a Chrome kill / airplane reopen still loads. */
const CACHE = 'eod-field-3.3.68';
const PRECACHE = [
  './',
  './index.html',
  './eod-version.json',
  './css/app.css?v=3.3.68',
  './css/materials-browser.css?v=3.3.68',
  './manifest.webmanifest',
  './assets/buffering.gif?v=3.3.68',
  './icons/favicon-192.png',
  './icons/favicon-512.png',
];

function shellAssetsFromHtml(html) {
  const out = new Set(PRECACHE);
  const re = /\b(?:src|href)="([^"]+)"/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const value = match[1];
    if (!value || /^(?:https?:|data:|blob:|#|\/)/i.test(value)) continue;
    out.add(`./${value.replace(/^\.\//, '')}`);
  }
  return [...out];
}

function isNetworkOnly(url) {
  return url.origin !== self.location.origin
    || /\/api\/|eod-api\.|auth-gate|store-data|send-eod|send-eod-helpdesk-report|verify-store|sas-upload/.test(url.href);
}

async function cacheOne(cache, asset) {
  try { await cache.add(asset); } catch (_) { /* optional shell asset */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(PRECACHE.map((asset) => cacheOne(cache, asset)));
      try {
        const response = await fetch('./index.html', { cache: 'no-store' });
        const html = await response.text();
        await Promise.all(shellAssetsFromHtml(html).map((asset) => cacheOne(cache, asset)));
      } catch (_) { /* base shell remains available */ }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('eod-field-') && k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'media-cached' || !msg.url) return;
  /* Page wrote Cache Storage `eod-set-media:<store>:<date>`; this keeps the worker alive. Do not fetch eod-api from here. */
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const optionalRemote = url.origin !== self.location.origin
    && ['script', 'style'].includes(req.destination)
    && /^(?:https:\/\/cdnjs\.cloudflare\.com|https:\/\/cdn\.jsdelivr\.net)$/.test(url.origin);
  if (url.origin !== self.location.origin && !optionalRemote) return;
  if (!optionalRemote && isNetworkOnly(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (_) {
      const cached = await cache.match(req);
      if (cached) return cached;
      if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
        const index = await cache.match('./index.html');
        if (index) return index;
      }
      throw _;
    }
  })());
});
