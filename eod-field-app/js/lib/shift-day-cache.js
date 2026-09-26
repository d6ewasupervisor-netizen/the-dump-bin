/* Preloaded store/day shifts from eod-api schedules cache. */
(function (global) {
  'use strict';

  const API = `${global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com'}/api/shifts`;
  let cache = { date: null, stores: [], at: 0 };
  let inflight = null;
  const iseCache = new Map();
  const iseInflight = new Map();

  function normStore(n) {
    return global.EodSession?.normStoreNumber?.(n) || String(n || '').replace(/^0+/, '') || '';
  }

  function applyPayload(date, data) {
    cache = {
      date,
      stores: Array.isArray(data?.stores) ? data.stores : [],
      at: Date.now(),
    };
    return cache;
  }

  async function load(date) {
    const day = String(date || '').slice(0, 10);
    if (!day) return cache;
    if (cache.date === day && cache.at && (
      cache.stores.length
        ? Date.now() - cache.at < 5 * 60 * 1000
        : Date.now() - cache.at < 8000
    )) return cache;
    if (inflight && inflight.date === day) return inflight.promise;
    const promise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await global.authFetch(`${API}/day?date=${encodeURIComponent(day)}`, {
        skipBusy: true,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Schedule day failed (${resp.status})`);
      return applyPayload(day, data);
    })().finally(() => {
      if (inflight && inflight.date === day) inflight = null;
    });
    inflight = { date: day, promise };
    try {
      return await promise;
    } catch (_) {
      return cache.date === day ? cache : { date: day, stores: [], at: 0 };
    }
  }

  function shiftsForStore(store, date) {
    const day = String(date || '').slice(0, 10);
    if (!day || cache.date !== day) return null;
    const want = normStore(store);
    const hit = cache.stores.find((s) => normStore(s.storeNumber) === want);
    return hit ? (hit.shifts || []) : [];
  }

  function scheduledStoreNumbers(date) {
    const day = String(date || '').slice(0, 10);
    if (!day || cache.date !== day) return [];
    return cache.stores.map((s) => Number(s.storeNumber)).filter((n) => Number.isFinite(n) && n > 0);
  }

  function prefetchToday() {
    const day = global.EodSession?.todayLocalIsoDate?.() || global.EodSession?.state?.workDate;
    if (!day) return Promise.resolve(cache);
    return load(day);
  }

  async function loadStoreIseDates(store, from, to) {
    const key = `${normStore(store)}|${String(from || '').slice(0, 10)}|${String(to || '').slice(0, 10)}`;
    const hit = iseCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.dates;
    if (iseInflight.has(key)) return iseInflight.get(key);
    const promise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const url = `${API}/store-dates?store=${encodeURIComponent(normStore(store))}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const resp = await global.authFetch(url, { skipBusy: true, signal: ctrl.signal })
        .finally(() => clearTimeout(timer));
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `ISE dates failed (${resp.status})`);
      const dates = Array.isArray(data.dates) ? data.dates : [];
      iseCache.set(key, { dates, at: Date.now() });
      return dates;
    })().finally(() => {
      iseInflight.delete(key);
    });
    iseInflight.set(key, promise);
    return promise;
  }

  global.EodShiftDay = { load, shiftsForStore, scheduledStoreNumbers, prefetchToday, loadStoreIseDates };
})(typeof window !== 'undefined' ? window : globalThis);
