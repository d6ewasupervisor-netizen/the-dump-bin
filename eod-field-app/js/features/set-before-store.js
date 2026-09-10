/* Week-scoped set before photos — survive multi-day backlog visits. */
(function (global) {
  'use strict';

  const PREFIX = 'eodSetBefores:';
  const AFTER_PREFIX = 'eodSetAfters:';

  function normStore(s) {
    return String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  function storageKey(store, fiscalWeek, prefix) {
    const s = normStore(store);
    const w = String(fiscalWeek || '').trim().toUpperCase();
    if (!s || !w) return null;
    return `${prefix || PREFIX}${s}:${w}`;
  }

  function loadAll(store, fiscalWeek, prefix) {
    const key = storageKey(store, fiscalWeek, prefix);
    if (!key) return {};
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function saveAll(store, fiscalWeek, map, prefix) {
    const key = storageKey(store, fiscalWeek, prefix);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(map || {}));
  }

  function dbkeyKey(dbkey) {
    return String(dbkey || '').replace(/\D/g, '').replace(/^0+/, '');
  }

  function getBefores(store, fiscalWeek, dbkey) {
    const all = loadAll(store, fiscalWeek);
    const k = dbkeyKey(dbkey);
    return Array.isArray(all[k]) ? all[k].slice() : [];
  }

  function setBefores(store, fiscalWeek, dbkey, photos) {
    const all = loadAll(store, fiscalWeek);
    const k = dbkeyKey(dbkey);
    if (!k) return;
    all[k] = Array.isArray(photos) ? photos : [];
    saveAll(store, fiscalWeek, all);
  }

  function getAfters(store, fiscalWeek, dbkey) {
    const all = loadAll(store, fiscalWeek, AFTER_PREFIX);
    const k = dbkeyKey(dbkey);
    return Array.isArray(all[k]) ? all[k].slice() : [];
  }

  function setAfters(store, fiscalWeek, dbkey, photos) {
    const all = loadAll(store, fiscalWeek, AFTER_PREFIX);
    const k = dbkeyKey(dbkey);
    if (!k) return;
    all[k] = Array.isArray(photos) ? photos : [];
    saveAll(store, fiscalWeek, all, AFTER_PREFIX);
  }

  function appendBefore(store, fiscalWeek, dbkey, entry) {
    const list = getBefores(store, fiscalWeek, dbkey);
    list.push(entry);
    setBefores(store, fiscalWeek, dbkey, list);
    return list;
  }

  function clearStoreWeek(store, fiscalWeek) {
    const beforeKey = storageKey(store, fiscalWeek);
    const afterKey = storageKey(store, fiscalWeek, AFTER_PREFIX);
    if (beforeKey) localStorage.removeItem(beforeKey);
    if (afterKey) localStorage.removeItem(afterKey);
  }

  function clearAllForStore(store) {
    const s = normStore(store);
    if (!s) return;
    const prefixes = [`${PREFIX}${s}:`, `${AFTER_PREFIX}${s}:`];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  global.EodSetBeforeStore = {
    loadAll,
    getBefores,
    setBefores,
    getAfters,
    setAfters,
    appendBefore,
    clearStoreWeek,
    clearAllForStore,
    storageKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
