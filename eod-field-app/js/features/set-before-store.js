/* Week-scoped set before photos — survive multi-day backlog visits. */
(function (global) {
  'use strict';

  const PREFIX = 'eodSetBefores:';

  function normStore(s) {
    return String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  function storageKey(store, fiscalWeek) {
    const s = normStore(store);
    const w = String(fiscalWeek || '').trim().toUpperCase();
    if (!s || !w) return null;
    return `${PREFIX}${s}:${w}`;
  }

  function loadAll(store, fiscalWeek) {
    const key = storageKey(store, fiscalWeek);
    if (!key) return {};
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function saveAll(store, fiscalWeek, map) {
    const key = storageKey(store, fiscalWeek);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(map || {}));
  }

  function getBefores(store, fiscalWeek, dbkey) {
    const all = loadAll(store, fiscalWeek);
    const k = String(dbkey || '').replace(/\D/g, '').replace(/^0+/, '');
    return Array.isArray(all[k]) ? all[k].slice() : [];
  }

  function setBefores(store, fiscalWeek, dbkey, photos) {
    const all = loadAll(store, fiscalWeek);
    const k = String(dbkey || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!k) return;
    all[k] = Array.isArray(photos) ? photos : [];
    saveAll(store, fiscalWeek, all);
  }

  function appendBefore(store, fiscalWeek, dbkey, entry) {
    const list = getBefores(store, fiscalWeek, dbkey);
    list.push(entry);
    setBefores(store, fiscalWeek, dbkey, list);
    return list;
  }

  function clearStoreWeek(store, fiscalWeek) {
    const key = storageKey(store, fiscalWeek);
    if (key) localStorage.removeItem(key);
  }

  function clearAllForStore(store) {
    const s = normStore(store);
    if (!s) return;
    const prefix = `${PREFIX}${s}:`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  global.EodSetBeforeStore = {
    loadAll,
    getBefores,
    setBefores,
    appendBefore,
    clearStoreWeek,
    clearAllForStore,
    storageKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
