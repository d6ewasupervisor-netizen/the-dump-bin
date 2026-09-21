/* Set carry-forward store — AFTERS ONLY now.
   Before photos used to be cached here (full base64, in localStorage) so a
   backlog set's befores would survive to a later-shift revisit. PROD now
   keeps that job: once a before photo lands, it shows up as
   row.live.prodBeforeCount / status.prod.beforeCount, and the app already
   treats those bays as covered (category-card-status.js, takenBays()).
   Caching a second full-resolution copy here was pure duplication, and
   because localStorage quota is tiny (~5-10MB) next to IndexedDB, a handful
   of unsynced before photos was enough to fill a device and trip the
   "storage full" state — which then stuck until the day reset. getBefores/
   setBefores/appendBefore are kept as no-ops so existing callers don't need
   to change; they just always see an empty before set now, and PROD's
   status is the only source of truth for befores from here on. */
(function (global) {
  'use strict';

  const PREFIX = 'eodSetBefores:'; // legacy only — purged on boot, never written again
  const AFTER_PREFIX = 'eodSetAfters:';

  function normStore(s) {
    return String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  function storageKey(store, fiscalWeek, prefix) {
    const s = normStore(store);
    const w = String(fiscalWeek || '').trim().toUpperCase();
    if (!s || !w) return null;
    return `${prefix || AFTER_PREFIX}${s}:${w}`;
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

  /* Drop after-buckets from earlier fiscal weeks only. Other stores in the
     CURRENT week are left alone — a lead can work two stores in one week
     and each needs its own carry-forward. */
  function pruneStaleWeeks(keepWeek) {
    const keep = String(keepWeek || '').trim().toUpperCase();
    if (!keep) return 0;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith(AFTER_PREFIX)) continue;
      const week = k.slice(k.lastIndexOf(':') + 1);
      if (week && week !== keep) doomed.push(k);
    }
    for (const k of doomed) {
      try { localStorage.removeItem(k); } catch (_) { /* keep pruning */ }
    }
    return doomed.length;
  }

  function saveAfters(store, fiscalWeek, map) {
    const key = storageKey(store, fiscalWeek, AFTER_PREFIX);
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

  /* Retired — PROD is now the sole source for carried-forward befores.
     Kept as no-ops so every existing caller (set-survey.js, signoff-home.js,
     device-photo-flush.js, set-photo-reconcile.js) keeps working unchanged;
     they just always see an empty before set. */
  function getBefores() {
    return [];
  }

  function setBefores() {
    /* no-op — see file header */
  }

  function appendBefore() {
    return [];
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
    saveAfters(store, fiscalWeek, all);
  }

  function clearStoreWeek(store, fiscalWeek) {
    const afterKey = storageKey(store, fiscalWeek, AFTER_PREFIX);
    if (afterKey) localStorage.removeItem(afterKey);
  }

  function listSets(store, fiscalWeek) {
    const afters = loadAll(store, fiscalWeek, AFTER_PREFIX);
    return Object.keys(afters).map((dbkey) => ({
      dbkey,
      before: [],
      after: Array.isArray(afters[dbkey]) ? afters[dbkey] : [],
    }));
  }

  function clearAllForStore(store) {
    const s = normStore(store);
    if (!s) return;
    const prefix = `${AFTER_PREFIX}${s}:`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  /* One-time sweep: earlier builds wrote full-resolution base64 before-
     photos into eodSetBefores:* keys. That's the actual cause of "storage
     full" — this clears it out immediately on any device that already hit
     quota, rather than waiting for a day-reset that never fully cleared it
     anyway (see the retired comment this file used to carry). */
  function legacyBeforeKeys() {
    const doomed = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) doomed.push(k);
      }
    } catch (_) { /* listing keys must not block boot */ }
    return doomed;
  }

  /* Sync sweep. Do not call this while the shell is still painting — a device
     full of base64 before-keys (Wolf's iPad) freezes on the nav and never
     reaches the visit screen. Boot schedules one delete per turn instead. */
  function purgeLegacyBefores() {
    const doomed = legacyBeforeKeys();
    for (const k of doomed) {
      try { localStorage.removeItem(k); } catch (_) { /* keep purging */ }
    }
    if (doomed.length) global.EodDiag?.note?.('set-store.legacy-purge', `${doomed.length} key(s)`);
    return doomed.length;
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
    legacyBeforeKeys,
    purgeLegacyBefores,
  };
})(typeof window !== 'undefined' ? window : globalThis);
