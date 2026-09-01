/* Background thumbs for before/after once the shift sheet is on.
 * Planogram boards load on tap (and when that set's survey opens).
 * Full-res stays on tap. Photos win origin quota over this cache. */
(function (global) {
  'use strict';

  const DS_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';
  let runToken = 0;
  let running = false;
  let pendingSheet = null;

  function Media() {
    return global.EodSetMediaCache;
  }

  async function cachePut(url, resp) {
    const M = Media();
    if (M?.put) {
      await M.put(url, resp);
    }
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'media-cached', url });
    } catch (_) { /* no SW */ }
  }

  async function warmUrl(url) {
    const M = Media();
    const abs = M?.absApiUrl(url) || '';
    if (!abs) return;
    try {
      if (await M.match(abs)) return;
    } catch (_) { /* continue */ }
    try {
      const resp = await global.authFetch(abs, { skipBusy: true });
      if (resp.ok) await cachePut(abs, resp);
    } catch (_) { /* best-effort */ }
  }

  async function prefetchRow(row, { store, date, token, policy }) {
    if (token !== runToken) return;
    const gate = await Media()?.allowPrefetch?.();
    if (gate && !gate.ok) {
      runToken += 1;
      return;
    }
    if (token !== runToken) return;
    if (!(policy && policy.prefetchThumbs)) return;
    const rowId = row.id;
    if (!rowId) return;
    try {
      const resp = await global.authFetch(`${DS_API}/rows/${encodeURIComponent(rowId)}/photos`, { skipBusy: true });
      const data = await resp.json().catch(() => ({}));
      const photos = Array.isArray(data.photos) ? data.photos : [];
      for (const p of photos) {
        if (token !== runToken) return;
        const again = await Media()?.allowPrefetch?.();
        if (again && !again.ok) {
          runToken += 1;
          return;
        }
        await warmUrl(p.thumbUrl || '');
      }
    } catch (_) { /* pack may not be ready yet */ }
  }

  async function start(sheet) {
    pendingSheet = sheet || global.EodSession?.state?.sheet || pendingSheet;
    if (running) return;
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
        try { await Media()?.bindShift?.(store, date); } catch (_) {}
        const policy = Media()?.connectionPrefetchPolicy?.() || { allowPrefetch: true, prefetchThumbs: true, prefetchPlanogramImages: true };
        if (!policy.allowPrefetch) continue;
        const gate = await Media()?.allowPrefetch?.();
        if (gate && !gate.ok) continue;
        runToken += 1;
        const token = runToken;
        for (const row of rows) {
          if (token !== runToken) break;
          await prefetchRow(row, { store, date, token, policy });
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
