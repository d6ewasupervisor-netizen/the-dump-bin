/* Match a sheet row or PROD set by dbkey. Category number is never enough. */
(function (global) {
  'use strict';

  function digits(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
  }

  function rowDbkey(row) {
    return String((row && (row.dbkey || row.dbKey)) || '').trim();
  }

  function pogDbkey(planogramId) {
    const m = String(planogramId || '').match(/_(\d{6,})_/);
    return m ? m[1] : '';
  }

  function setDbkey(set) {
    return String((set && (set.dbkey || pogDbkey(set.planogramId))) || '').trim();
  }

  /**
   * Resolve one sheet row. Order: rowId, then dbkey, then unique name,
   * then unique category+name. Never first-match on category number alone.
   */
  function findSheetRowForMeta(rows, meta) {
    const list = Array.isArray(rows) ? rows : [];
    const rowId = meta && meta.rowId != null && String(meta.rowId) !== ''
      ? String(meta.rowId)
      : '';
    const dbkey = String((meta && meta.dbkey) || '').trim();
    if (rowId) {
      const hit = list.find((r) => String(r.id) === rowId);
      if (hit) return hit;
    }
    if (dbkey) {
      const hit = list.find((r) => rowDbkey(r) === dbkey);
      if (hit) return hit;
    }
    const catNum = digits(meta && meta.categoryNumber);
    const name = String((meta && (meta.setLabel || meta.categoryName)) || '')
      .trim()
      .toLowerCase();
    if (name) {
      const exact = list.filter((r) => String(r.catName || '').trim().toLowerCase() === name);
      if (exact.length === 1) return exact[0];
    }
    if (catNum && name) {
      const both = list.filter((r) => (
        digits(r.catId) === catNum
        && String(r.catName || '').trim().toLowerCase() === name
      ));
      if (both.length === 1) return both[0];
    }
    if (catNum) {
      const byCat = list.filter((r) => digits(r.catId) === catNum);
      if (byCat.length === 1) return byCat[0];
    }
    return null;
  }

  /**
   * Bind a sheet row to a PROD set. Dbkey wins. Category+name only when unique.
   */
  function matchProdSetForRow(row, setsByVisit) {
    const dbkey = rowDbkey(row);
    const catNum = digits(row && row.catId);
    const name = String((row && row.catName) || '').trim().toLowerCase();
    let unique = null;
    let uniqueCount = 0;
    const entries = setsByVisit && typeof setsByVisit === 'object' ? Object.entries(setsByVisit) : [];
    for (const [visitId, entry] of entries) {
      for (const set of (entry && entry.sets) || []) {
        const sKey = setDbkey(set);
        if (dbkey && sKey && dbkey === sKey) return { visitId, set, entry };
        const sNum = digits(set && set.number);
        const sName = String((set && set.name) || '').trim().toLowerCase();
        if (catNum && sNum && catNum === sNum && name && sName && sName === name) {
          unique = { visitId, set, entry };
          uniqueCount += 1;
        }
      }
    }
    return uniqueCount === 1 ? unique : null;
  }

  const api = {
    digits,
    rowDbkey,
    setDbkey,
    pogDbkey,
    findSheetRowForMeta,
    matchProdSetForRow,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSheetRowMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
