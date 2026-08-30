/* Background build of planogram + before/after packs once the shift sheet is on. */
(function (global) {
  'use strict';

  const DS_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';
  const MEDIA_CACHE = 'eod-set-media';
  let runToken = 0;
  let running = false;
  let pendingSheet = null;

  function absUrl(path) {
    if (!path) return '';
    if (/^https?:|^data:|^blob:/i.test(path)) return path;
    return `https://eod-api.the-dump-bin.com${path}`;
  }

  async function cachePut(url, resp) {
    try {
      const cache = await caches.open(MEDIA_CACHE);
      await cache.put(url, resp.clone());
    } catch (_) { /* quota */ }
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'media-cached', url });
    } catch (_) { /* no SW */ }
  }

  async function warmUrl(url) {
    const abs = absUrl(url);
    if (!abs || /^data:|^blob:/i.test(abs)) return;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      if (await cache.match(abs)) return;
    } catch (_) { /* continue */ }
    try {
      const resp = await global.authFetch(abs, { skipBusy: true });
      if (resp.ok) await cachePut(abs, resp);
    } catch (_) { /* best-effort */ }
  }

  async function prefetchRow(row, { store, date, token }) {
    if (token !== runToken) return;
    const dbkey = String(row.dbkey || '').trim();
    if (dbkey && global.EodSiPlanogram?.prefetch) {
      try { await global.EodSiPlanogram.prefetch({ store, date, dbkey }); } catch (_) {}
    }
    if (token !== runToken) return;
    const rowId = row.id;
    if (!rowId) return;
    try {
      const resp = await global.authFetch(`${DS_API}/rows/${encodeURIComponent(rowId)}/photos`, { skipBusy: true });
      const data = await resp.json().catch(() => ({}));
      const photos = Array.isArray(data.photos) ? data.photos : [];
      for (const p of photos) {
        if (token !== runToken) return;
        await warmUrl(p.thumbUrl || p.url);
      }
    } catch (_) { /* pack may not be ready yet */ }
  }

  async function start(sheet) {
    pendingSheet = sheet || global.EodSession?.state?.sheet || pendingSheet;
    if (running) {
      runToken += 1;
      return;
    }
    running = true;
    try {
      while (pendingSheet) {
        const next = pendingSheet;
        pendingSheet = null;
        const S = global.EodSession;
        const rows = next?.rows;
        const store = S?.state?.storeNumber;
        const date = S?.state?.workDate;
        if (!store || !Array.isArray(rows) || !rows.length) continue;
        runToken += 1;
        const token = runToken;
        for (const row of rows) {
          if (token !== runToken) break;
          await prefetchRow(row, { store, date, token });
        }
      }
    } finally {
      running = false;
    }
  }

  function stop() {
    runToken += 1;
    running = false;
  }

  global.EodSetMediaPrefetch = { start, stop };
})(typeof window !== 'undefined' ? window : globalThis);
