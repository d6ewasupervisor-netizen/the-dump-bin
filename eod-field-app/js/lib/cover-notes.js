/* Keep handwritten Notes separate from structured EOD cover fields. */
(function (global) {
  'use strict';

  const COVER_RE = /^In:\s/i;
  const SET_LIST_RE = /^(?:[•\-—]\s*)*Not (?:in (?:store|SI)|executable):/i;
  const DAY_SUMMARY_RE = /^(?:[•\-—]\s*)*Day summary(?:\s*[—-])?$/i;
  const SKIP = new Set(['cover-sync', 'reset', 'notes']);

  function cartCount(S, slot) {
    const arr = (S?.state?.photos && S.state.photos[slot]) || [];
    return arr.filter((p) => {
      if (!p) return false;
      if (typeof p === 'string') return true;
      return !!(p.dataUrl || p.blobId || p.previewUrl || p.objectUrl || p.preview);
    }).length;
  }

  function markActive(row, type) {
    if (global.EodCategoryCardStatus?.markActive) {
      return global.EodCategoryCardStatus.markActive(row, type);
    }
    const m = row && (row.marks || row.mark);
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'not_in_store') return !!m.notInStore;
    return m.type === type;
  }

  function cards() {
    if (global.EodCategoryCardStatus?.includeNisOnCover) return global.EodCategoryCardStatus;
    try { return require('./category-card-status'); } catch (_) { return null; }
  }

  function coverList(S, kind) {
    const rows = S?.state?.sheet?.rows || [];
    const helper = cards();
    const include = kind === 'nis'
      ? (helper?.includeNisOnCover || ((row) => markActive(row, 'not_in_store')))
      : (helper?.includeNisiOnCover || ((row) => markActive(row, 'not_in_si')));
    const prefix = kind === 'nis' ? 'Not in store: ' : 'Not in SI: ';
    const out = [];
    const seen = new Set();
    const allowed = new Set();
    for (const row of rows) {
      if (!include(row)) continue;
      const label = String(row.catName || row.dbkey || '').trim();
      if (!label) continue;
      allowed.add(label.toLowerCase());
      const line = `${prefix}${label}`;
      if (seen.has(line.toLowerCase())) continue;
      seen.add(line.toLowerCase());
      out.push(line);
    }
    const extraKey = kind === 'nis' ? 'notInStoreSelected' : 'notInSiSelected';
    const extra = Array.isArray(S?.state?.[extraKey]) ? S.state[extraKey] : [];
    for (const name of extra) {
      const label = String(name || '').trim();
      if (!label || !allowed.has(label.toLowerCase())) continue;
      const line = `${prefix}${label}`;
      if (seen.has(line.toLowerCase())) continue;
      seen.add(line.toLowerCase());
      out.push(line);
    }
    return out;
  }

  function nisLines(S) {
    return coverList(S, 'nis');
  }

  function nisiLines(S) {
    return coverList(S, 'nisi');
  }

  function notExecutableLines(S) {
    const rows = S?.state?.sheet?.rows || [];
    const out = [];
    const seen = new Set();
    for (const row of rows) {
      if (!markActive(row, 'not_executable')) continue;
      const label = String(row.catName || row.dbkey || '').trim();
      if (!label) continue;
      const line = `Not executable: ${label}`;
      if (seen.has(line.toLowerCase())) continue;
      seen.add(line.toLowerCase());
      out.push(line);
    }
    return out;
  }

  function summaryLine(S) {
    const sheet = S?.state?.sheet;
    const marked = sheet
      ? `${sheet.summary?.marked || 0}/${sheet.summary?.total || 0} marked`
      : 'no hosted sheet';
    const inn = String(S?.state?.checkInManager || '').trim() || '—';
    const out = String(S?.state?.checkOutManager || '').trim() || '—';
    return `In: ${inn} · Out: ${out} · cart ${cartCount(S, 'before')}/${cartCount(S, 'after')} · ${marked}`;
  }

  function notesWithoutSetLists(existing) {
    return String(existing || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line
        && !COVER_RE.test(line)
        && !SET_LIST_RE.test(line)
        && !DAY_SUMMARY_RE.test(line))
      .join('\n');
  }

  function mergeNotes(existing) {
    return notesWithoutSetLists(existing);
  }

  function applyToDom(next) {
    const el = document.getElementById('sendNotes');
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== next) el.value = next;
  }

  function apply(S, reason) {
    if (!S?.state) return null;
    if (reason && SKIP.has(String(reason))) return S.state.notes || '';
    const next = mergeNotes(S.state.notes, S);
    if (next === (S.state.notes || '')) {
      applyToDom(next);
      return next;
    }
    S.patch({ notes: next }, 'cover-sync');
    applyToDom(next);
    return next;
  }

  function init(S) {
    if (!S?.on || init._bound) return;
    init._bound = true;
    S.on((_state, reason) => {
      try { apply(S, reason); } catch (_) {}
    });
  }

  const api = {
    summaryLine,
    mergeNotes,
    notesWithoutSetLists,
    nisLines,
    nisiLines,
    notExecutableLines,
    apply,
    init,
    cartCount,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodCoverNotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
