/* Group a bulk UPC locate queue by aisle and set. */
(function (global) {
  'use strict';

  const KEY = 'eodScanBatch';

  function aisleLabel(match) {
    const n = String(match?.aisle ?? '').trim();
    const verbose = String(match?.locationVerbose || '');
    const placed = n || /aisle\s+/i.test(verbose);
    if (!placed && match?.notesAction === 'new') return 'New items';
    if (!placed && match?.notesAction === 'delete') return 'Deletes';
    if (n) return `Aisle ${n}`;
    const found = /aisle\s+([^·,]+)/i.exec(verbose);
    if (found) return found[1].trim();
    return '';
  }

  function setLabel(match) {
    const name = String(match?.setName || match?.categoryName || '').trim();
    const week = String(match?.notesPeriodWeek || '').trim();
    if (week && name) return `${week} · ${name}`;
    return name || week;
  }

  function groupScanResults(items) {
    const buckets = new Map();
    function put(aisle, setName, row) {
      const a = aisle || 'Aisle unknown';
      const s = setName || '';
      const key = `${a}\n${s}`;
      if (!buckets.has(key)) buckets.set(key, { aisle: a, setName: s, rows: [] });
      buckets.get(key).rows.push(row);
    }
    for (const item of items || []) {
      const matches = item?.data?.found && Array.isArray(item.data.matches) ? item.data.matches : [];
      if (!matches.length) {
        put('Not located', '', {
          upc: item?.upc || '',
          status: item?.status || 'miss',
          match: null,
        });
        continue;
      }
      for (const match of matches) {
        put(aisleLabel(match), setLabel(match), {
          upc: item.upc || match.upc || '',
          status: item.status || 'ready',
          match,
        });
      }
    }
    const list = [...buckets.values()];
    function aisleRank(aisle) {
      if (aisle === 'Not located') return 4;
      if (aisle === 'Aisle unknown') return 3;
      if (aisle === 'Deletes') return 2;
      if (aisle === 'New items') return 1;
      return 0;
    }
    list.sort((a, b) => {
      const rank = aisleRank(a.aisle) - aisleRank(b.aisle);
      if (rank) return rank;
      return a.aisle.localeCompare(b.aisle, undefined, { numeric: true })
        || a.setName.localeCompare(b.setName, undefined, { numeric: true });
    });
    return list;
  }

  const MAX_ITEMS = 300;

  let memory = [];
  let savedKey = null;
  const listeners = new Set();

  function visitKey() {
    const S = global.EodSession?.state || {};
    return `${S.storeNumber || ''}|${String(S.workDate || '').slice(0, 10)}`;
  }

  function storageKey(key) {
    return `${KEY}:${key}`;
  }

  function plainItem(item) {
    return {
      upc: String(item?.upc || ''),
      status: item?.status || 'looking',
      data: item?.data || null,
    };
  }

  function readStored(key) {
    try {
      const raw = global.localStorage?.getItem(storageKey(key));
      if (raw) {
        const items = JSON.parse(raw);
        if (Array.isArray(items)) return items;
      }
      const legacy = global.sessionStorage?.getItem(KEY);
      if (legacy) {
        global.sessionStorage.removeItem(KEY);
        const parsed = JSON.parse(legacy);
        if (parsed?.key === key && Array.isArray(parsed.items)) return parsed.items;
      }
    } catch (_) { /* private mode or bad JSON */ }
    return [];
  }

  // One visit's scans on the device. Changing store or date drops the old list.
  // A lookup cut off by a closed app has no answer to show, so it is dropped.
  function sync() {
    const key = visitKey();
    if (key === savedKey) return;
    savedKey = key;
    memory = key.startsWith('|')
      ? []
      : readStored(key).map(plainItem).filter((item) => item.upc && item.status !== 'looking');
  }

  function persist() {
    if (!savedKey || savedKey.startsWith('|')) return;
    try {
      const ls = global.localStorage;
      if (!ls) return;
      const mine = storageKey(savedKey);
      for (let i = ls.length - 1; i >= 0; i -= 1) {
        const k = ls.key(i);
        if (k && k.startsWith(`${KEY}:`) && k !== mine) ls.removeItem(k);
      }
      ls.setItem(mine, JSON.stringify(memory));
    } catch (_) { /* private mode or full */ }
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(memory.slice()); } catch (_) {}
    }
  }

  function list() {
    sync();
    return memory.slice();
  }

  function commit(items) {
    sync();
    const map = new Map(memory.map((item) => [item.upc, item]));
    for (const item of items || []) {
      const row = plainItem(item);
      if (!row.upc) continue;
      map.delete(row.upc);
      map.set(row.upc, row);
    }
    memory = [...map.values()].slice(-MAX_ITEMS);
    persist();
    emit();
    return memory.slice();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = {
    aisleLabel,
    setLabel,
    groupScanResults,
    list,
    commit,
    subscribe,
    visitKey,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.EodScanBatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
