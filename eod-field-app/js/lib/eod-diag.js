/* Counter for failures the app deliberately swallows.

   Large parts of the photo and reconcile paths catch and continue on purpose -
   a single bad bay must not stop a shift. The cost was that nobody, including
   us, could tell the difference between "nothing went wrong" and "the same
   bay has failed 400 times". note() is a counter, not a handler: it never
   changes control flow and never throws. */
(function (global) {
  'use strict';

  const MAX_RECENT = 60;
  const counts = new Map();
  const recent = [];

  function note(code, detail) {
    try {
      const key = String(code || 'unknown');
      counts.set(key, (counts.get(key) || 0) + 1);
      recent.push({
        at: Date.now(),
        code: key,
        detail: String(detail && detail.message ? detail.message : (detail || '')).slice(0, 200),
      });
      if (recent.length > MAX_RECENT) recent.shift();
    } catch (_) { /* a diagnostic must never be the thing that breaks */ }
  }

  function count(code) {
    return counts.get(String(code)) || 0;
  }

  function total() {
    let n = 0;
    for (const v of counts.values()) n += v;
    return n;
  }

  function snapshot() {
    return {
      total: total(),
      counts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
      recent: recent.slice(-15).reverse(),
    };
  }

  /* Compact operator view: "reconcile.push 12 · flush.bytes-missing 3" */
  function summaryText(limit = 4) {
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!rows.length) return '';
    return rows.map(([code, n]) => `${code} ${n}`).join(' \u00b7 ');
  }

  function reset() {
    counts.clear();
    recent.length = 0;
  }

  global.EodDiag = { note, count, total, snapshot, summaryText, reset };
  if (typeof module === 'object' && module.exports) module.exports = global.EodDiag;
})(typeof window !== 'undefined' ? window : globalThis);
