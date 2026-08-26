/* Shared category-card helpers — node-testable, also loaded in the field app. */
(function (global) {
  'use strict';

  function beforePillState(row, localCount) {
    const live = row && row.live;
    const local = Number(localCount) || 0;
    const prod = Number(live && live.prodBeforeCount) || 0;
    const count = Math.max(local, prod);
    if (count > 0) return { kind: 'ok', count };
    if (!live) return { kind: 'hidden' };
    const inProd = !!live.prodStatus && String(live.prodStatus).toLowerCase() !== 'absent';
    if (!inProd) return { kind: 'hidden' };
    return { kind: 'warn' };
  }

  function beforePillHtml(state, esc) {
    if (!state || state.kind === 'hidden') return '';
    const escape = typeof esc === 'function' ? esc : (s) => String(s == null ? '' : s);
    if (state.kind === 'ok') {
      const n = Number(state.count) || 0;
      return `<span class="pill ok">${escape(n)} before${n === 1 ? '' : 's'}</span>`;
    }
    return '<span class="pill warn">no befores</span>';
  }

  function siLocationLabel(row) {
    const loc = row && row.live && row.live.siLocation;
    if (!loc) return '';
    if (typeof loc === 'string') return loc.trim();
    return String(loc.label || loc.aisleLabel || '').trim();
  }

  function markActive(row, type) {
    const m = row && (row.marks || row.mark);
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'complete') return !!m.complete;
    if (type === 'not_in_store') return !!m.notInStore;
    if (type === 'not_in_si') return !!m.notInSi;
    return m.type === type;
  }

  function prodDone(row) {
    const live = row && row.live;
    if (!live) return false;
    if (live.prodComplete) return true;
    return String(live.prodStatus || '').toLowerCase() === 'done';
  }

  function siDone(row) {
    const live = row && row.live;
    if (!live) return false;
    if (live.siComplete) return true;
    const st = String(live.siStatus || '').toLowerCase();
    return st === 'completed' || st === 'complete' || st === 'done';
  }

  function matchesSheetFilters(row, filters) {
    const f = filters || {};
    if (f.prod === 'done' && !prodDone(row)) return false;
    if (f.prod === 'not_done' && prodDone(row)) return false;
    if (f.si === 'done' && !siDone(row)) return false;
    if (f.si === 'not_done' && siDone(row)) return false;
    const wantNis = !!f.notInStore;
    const wantNisi = !!f.notInSi;
    if (wantNis || wantNisi) {
      const nis = markActive(row, 'not_in_store');
      const nisi = markActive(row, 'not_in_si');
      if (wantNis && wantNisi) {
        if (!nis && !nisi) return false;
      } else if (wantNis && !nis) return false;
      else if (wantNisi && !nisi) return false;
    }
    return true;
  }

  const api = {
    beforePillState,
    beforePillHtml,
    siLocationLabel,
    markActive,
    prodDone,
    siDone,
    matchesSheetFilters,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodCategoryCardStatus = api;
})(typeof window !== 'undefined' ? window : globalThis);
