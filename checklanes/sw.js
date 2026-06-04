const CACHE_NAME = 'checklanes-shell-v20260604-1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './hub.html',
  './planogram.css',
  './pog-pdf-viewer.css',
  './planogram.js',
  './pog-pdf-viewer.js',
  './hub-presence.js',
  './hub-chat.js',
  './hub-bay-photos.js',
  './scanner.js',
];

function isBypassRequest(requestUrl) {
  return requestUrl.pathname.endsWith('.html') ||
    requestUrl.pathname.endsWith('/auth-gate.js') ||
    requestUrl.pathname.endsWith('/hub-version.json') ||
    requestUrl.pathname.includes('/api/') ||
    requestUrl.pathname.endsWith('/stream');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== CACHE_NAME) return caches.delete(key);
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isBypassRequest(url)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    const cache = await caches.open(CACHE_NAME);
    if (response && response.ok) {
      cache.put(event.request, response.clone()).catch(() => {});
    }
    return response;
  })());
});
