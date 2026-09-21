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

  /* Drop buckets from earlier fiscal weeks only. Other stores in the CURRENT
     week are left alone — a lead can work two stores in one week and each
     needs its own carry-forward. */
  function pruneStaleWeeks(keepWeek) {
    const keep = String(keepWeek || '').trim().toUpperCase();
    if (!keep) return 0;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith(PREFIX) && !k.startsWith(AFTER_PREFIX)) continue;
      const week = k.slice(k.lastIndexOf(':') + 1);
      if (week && week !== keep) doomed.push(k);
    }
    for (const k of doomed) {
      try { localStorage.removeItem(k); } catch (_) { /* keep pruning */ }
    }
    return doomed.length;
  }

  /* This write is what makes the multi-day carry-forward work: befores shot
     Monday have to still be here when the crew comes back Wednesday for the
     backlog revisit. A silent quota failure loses them, and nobody finds out
     until the revisit. Prune dead weeks, retry, and if it still fails, throw
     so the caller can say so. */
  function saveAll(store, fiscalWeek, map, prefix) {
    const key = storageKey(store, fiscalWeek, prefix);
    if (!key) return;
    const json = JSON.stringify(map || {});
    try {
      localStorage.setItem(key, json);
      return;
    } catch (_) {
      const freed = pruneStaleWeeks(fiscalWeek);
      try {
        localStorage.setItem(key, json);
        global.EodDiag?.note?.('set-store.pruned', `freed ${freed} stale week bucket(s)`);
      } catch (err) {
        global.EodDiag?.note?.('set-store.quota', err);
        throw err;
      }
    }
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

  function listSets(store, fiscalWeek) {
    const befores = loadAll(store, fiscalWeek);
    const afters = loadAll(store, fiscalWeek, AFTER_PREFIX);
    const keys = new Set([...Object.keys(befores), ...Object.keys(afters)]);
    return [...keys].map((dbkey) => ({
      dbkey,
      before: Array.isArray(befores[dbkey]) ? befores[dbkey] : [],
      after: Array.isArray(afters[dbkey]) ? afters[dbkey] : [],
    }));
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
    listSets,
    clearStoreWeek,
    clearAllForStore,
    pruneStaleWeeks,
    storageKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
