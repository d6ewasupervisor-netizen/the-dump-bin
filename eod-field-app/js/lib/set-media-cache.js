/* Shift-scoped Cache Storage for planogram / before / after convenience copies.
 * Same origin quota as PhotoDB — photos always win. */
(function (global) {
  'use strict';

  const API_HOST = 'eod-api.the-dump-bin.com';
  const API_ORIGIN = `https://${API_HOST}`;
  const CACHE_PREFIX = 'eod-set-media:';
  const LEGACY_CACHE = 'eod-set-media';
  const NEAR_SOFT_FRAC = 0.85;
  const MEASURE_TTL_MS = 30 * 1000;

  let bound = { store: '', date: '', name: '' };
  let measureCache = { bytes: 0, at: 0 };

  function normStore(store) {
    return String(store || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '';
  }

  function normDate(date) {
    return String(date || '').slice(0, 10);
  }

  function cacheNameForShift(store, date) {
    const s = normStore(store) || '0';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(normDate(date)) ? normDate(date) : 'none';
    return `${CACHE_PREFIX}${s}:${d}`;
  }

  function isSetMediaCacheName(name) {
    return name === LEGACY_CACHE || String(name || '').startsWith(CACHE_PREFIX);
  }

  function isEodApiUrl(url) {
    const s = String(url || '').trim();
    if (!s || /^data:|^blob:/i.test(s)) return false;
    if (s.startsWith('/api/')) return true;
    try {
      const u = new URL(s, API_ORIGIN);
      return u.hostname === API_HOST && u.pathname.startsWith('/api/');
    } catch (_) {
      return false;
    }
  }

  function absApiUrl(path) {
    const s = String(path || '').trim();
    if (!s || /^data:|^blob:/i.test(s)) return '';
    if (s.startsWith('/api/')) return API_ORIGIN + s;
    if (isEodApiUrl(s)) {
      try { return new URL(s, API_ORIGIN).href; } catch (_) { return ''; }
    }
    return '';
  }

  function connectionPrefetchPolicy(conn) {
    const c = conn || (typeof navigator !== 'undefined'
      ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
      : null);
    const saveData = !!(c && c.saveData);
    const type = String(c && c.effectiveType || '').toLowerCase();
    const slowCell = /^(slow-2g|2g|3g)$/.test(type);
    return {
      saveData,
      slowCell,
      allowPrefetch: !saveData,
      prefetchThumbs: !saveData,
      prefetchPlanogramImages: !saveData && !slowCell,
    };
  }

  function prefetchAllowedFromPressure(p) {
    if (!p) return true;
    if (p.soft || p.hard || p.prefetchBlocked) return false;
    const soft = Number(p.softBytes);
    const photos = Number(p.totalBytes) || 0;
    const cache = Number(p.cacheBytes) || 0;
    if (Number.isFinite(soft) && soft > 0) {
      if (photos >= Math.floor(soft * NEAR_SOFT_FRAC)) return false;
      if (photos + cache >= soft) return false;
    }
    if (p.originPressure) return false;
    return true;
  }

  async function cacheNames() {
    try { return await caches.keys(); } catch (_) { return []; }
  }

  async function purgeNames(names) {
    let n = 0;
    for (const name of names || []) {
      try {
        if (await caches.delete(name)) n += 1;
      } catch (_) { /* ignore */ }
    }
    measureCache = { bytes: 0, at: 0 };
    return n;
  }

  async function purgeAll() {
    const names = (await cacheNames()).filter(isSetMediaCacheName);
    return purgeNames(names);
  }

  async function purgeOtherShifts(store, date) {
    const keep = cacheNameForShift(store, date);
    const names = (await cacheNames()).filter((name) => isSetMediaCacheName(name) && name !== keep);
    return purgeNames(names);
  }

  async function bindShift(store, date) {
    const name = cacheNameForShift(store, date);
    bound = { store: normStore(store), date: normDate(date), name };
    await purgeOtherShifts(store, date);
    return name;
  }

  function currentCacheName() {
    if (bound.name) return bound.name;
    const S = global.EodSession?.state;
    if (S?.storeNumber && S?.workDate) return cacheNameForShift(S.storeNumber, S.workDate);
    return cacheNameForShift('', '');
  }

  async function openCurrent() {
    try { return await caches.open(currentCacheName()); } catch (_) { return null; }
  }

  async function match(url) {
    const abs = absApiUrl(url);
    if (!abs) return null;
    try {
      const cache = await openCurrent();
      if (cache) {
        const hit = await cache.match(abs);
        if (hit) return hit;
      }
      const names = (await cacheNames()).filter(isSetMediaCacheName);
      for (const name of names) {
        const c = await caches.open(name);
        const hit = await c.match(abs);
        if (hit) return hit;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  async function put(url, resp) {
    const abs = absApiUrl(url);
    if (!abs || !resp) return false;
    try {
      const cache = await openCurrent();
      if (!cache) return false;
      await cache.put(abs, resp.clone());
      measureCache.at = 0;
      return true;
    } catch (_) {
      return false;
    }
  }

  async function measureBytes(force) {
    const now = Date.now();
    if (!force && measureCache.at && now - measureCache.at < MEASURE_TTL_MS) {
      return measureCache;
    }
    let fromDetails = null;
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usageDetails && Number.isFinite(est.usageDetails.caches)) {
        fromDetails = Math.floor(est.usageDetails.caches);
      }
    } catch (_) { /* ignore */ }
    let measured = 0;
    try {
      const names = (await cacheNames()).filter(isSetMediaCacheName);
      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const req of keys) {
          const resp = await cache.match(req);
          if (!resp) continue;
          const buf = await resp.clone().arrayBuffer();
          measured += buf.byteLength;
        }
      }
    } catch (_) { /* ignore */ }
    const bytes = measured > 0 ? measured : (fromDetails || 0);
    measureCache = { bytes, measured, fromDetails, at: now };
    return measureCache;
  }

  async function allowPrefetch() {
    const policy = connectionPrefetchPolicy();
    if (!policy.allowPrefetch) return { ok: false, reason: 'save-data', policy };
    try {
      const pressure = await global.PhotoDB?.storagePressure?.();
      if (pressure && !prefetchAllowedFromPressure(pressure)) {
        return { ok: false, reason: 'photo-cap', policy, pressure };
      }
    } catch (_) { /* allow */ }
    return { ok: true, policy };
  }

  const api = {
    API_ORIGIN,
    API_HOST,
    CACHE_PREFIX,
    LEGACY_CACHE,
    NEAR_SOFT_FRAC,
    cacheNameForShift,
    isSetMediaCacheName,
    isEodApiUrl,
    absApiUrl,
    connectionPrefetchPolicy,
    prefetchAllowedFromPressure,
    bindShift,
    purgeAll,
    purgeOtherShifts,
    currentCacheName,
    match,
    put,
    measureBytes,
    allowPrefetch,
  };

  global.EodSetMediaCache = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
