/* Group a bulk UPC locate queue by aisle and set. */
(function (global) {
  'use strict';

  const KEY = 'eodScanBatch';

  function aisleLabel(match) {
    const n = String(match?.aisle ?? '').trim();
    if (n) return `Aisle ${n}`;
    const verbose = String(match?.locationVerbose || '');
    const found = /aisle\s+([^·,]+)/i.exec(verbose);
    if (found) return found[1].trim();
    return '';
  }

  function setLabel(match) {
    return String(match?.setName || match?.categoryName || '').trim();
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
    list.sort((a, b) => {
      if (a.aisle === 'Not located') return 1;
      if (b.aisle === 'Not located') return -1;
      return a.aisle.localeCompare(b.aisle, undefined, { numeric: true })
        || a.setName.localeCompare(b.setName, undefined, { numeric: true });
    });
    return list;
  }

  let memory = [];
  let savedKey = '';
  const listeners = new Set();

  function visitKey() {
    const S = global.EodSession?.state || {};
    return `${S.storeNumber || ''}|${String(S.workDate || '').slice(0, 10)}`;
  }

  function plainItem(item) {
    return {
      upc: String(item?.upc || ''),
      status: item?.status || 'looking',
      data: item?.data || null,
    };
  }

  function persist() {
    try {
      global.sessionStorage?.setItem(KEY, JSON.stringify({ key: savedKey, items: memory }));
    } catch (_) { /* private mode */ }
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(memory.slice()); } catch (_) {}
    }
  }

  function load() {
    try {
      const raw = global.sessionStorage?.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.key !== visitKey() || !Array.isArray(parsed.items)) return;
      savedKey = parsed.key;
      memory = parsed.items.map(plainItem).filter((item) => item.upc);
    } catch (_) { /* ignore */ }
  }

  function list() {
    if (savedKey && savedKey !== visitKey()) return [];
    return memory.slice();
  }

  function commit(items) {
    const key = visitKey();
    if (savedKey && savedKey !== key) memory = [];
    savedKey = key;
    const map = new Map(memory.map((item) => [item.upc, item]));
    for (const item of items || []) {
      const row = plainItem(item);
      if (!row.upc) continue;
      map.set(row.upc, row);
    }
    memory = [...map.values()];
    persist();
    emit();
    return memory.slice();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  load();

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
