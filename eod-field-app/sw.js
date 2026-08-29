/* Field-app shell cache so a Chrome kill / airplane reopen still loads. */
const CACHE = 'eod-field-3.3.19';
const PRECACHE = [
  './',
  './index.html',
  './eod-version.json',
  './css/app.css?v=3.3.19',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('eod-field-') && k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/api\/|eod-api\.|auth-gate|store-data|send-eod|verify-store/.test(url.href)) return;

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
