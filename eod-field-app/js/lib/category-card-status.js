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
    if (type === 'backlog') return !!m.backlog;
    if (type === 'out_of_scope') return !!m.outOfScope;
    return m.type === type;
  }

  function photoList(row) {
    if (Array.isArray(row && row.photos)) return row.photos;
    if (row && row.live && Array.isArray(row.live.photos)) return row.live.photos;
    return [];
  }

  function prodPhotoCounts(row, extraBefore) {
    const live = row && row.live;
    const photos = photoList(row);
    const beforeFromPhotos = photos.filter((p) => p && String(p.slot || '').toLowerCase() === 'before').length;
    const afterFromPhotos = photos.filter((p) => {
      const slot = String((p && p.slot) || '').toLowerCase();
      const source = String((p && p.source) || '').toLowerCase();
      return slot === 'after' && (source === 'prod' || source === 'sas');
    }).length;
    const before = Math.max(
      Number(live && live.prodBeforeCount) || 0,
      beforeFromPhotos,
      Number(extraBefore) || 0
    );
    const stored = live && live.prodAfterCount;
    const after = stored != null && stored !== '' ? Number(stored) || 0 : afterFromPhotos;
    return { before, after };
  }

  function prodKindFromCounts(before, after) {
    if (before > 0 && after > 0) return 'complete';
    if (before > 0 || after > 0) return 'in_progress';
    return 'not_started';
  }

  function prodPhotoState(row, extraBefore) {
    const live = row && row.live;
    const counts = prodPhotoCounts(row, extraBefore);
    if (!live) {
      if (counts.before || counts.after) return { kind: prodKindFromCounts(counts.before, counts.after), ...counts };
      return { kind: 'hidden', before: 0, after: 0 };
    }
    const inProd = !!live.prodStatus && String(live.prodStatus).toLowerCase() !== 'absent';
    if (!inProd && !counts.before && !counts.after) return { kind: 'hidden', ...counts };
    return { kind: prodKindFromCounts(counts.before, counts.after), ...counts };
  }

  function siSectionCounts(row) {
    const live = row && row.live;
    const have = Number(live && (live.siPhotoCount || live.photoCount)) || 0;
    const need = Number(live && live.sectionCount) || 0;
    return { have, need };
  }

  function siDisplayLabel(row) {
    const live = row && row.live;
    const { have, need } = siSectionCounts(row);
    if (need > 0 && have >= need) return 'complete';
    if (live && (live.siPresent || need || have || live.siStatus)) return 'incomplete';
    return 'unknown';
  }

  function neededCaptureSlot(row, extraBefore) {
    const counts = prodPhotoCounts(row, extraBefore);
    if (counts.before <= 0) return 'before';
    return 'after';
  }

  function liveStatusLineFromCounts(opts, esc) {
    const escape = typeof esc === 'function' ? esc : (s) => String(s == null ? '' : s);
    const before = Number(opts && opts.before) || 0;
    const after = Number(opts && opts.after) || 0;
    const kind = opts && opts.prodKind ? opts.prodKind : prodKindFromCounts(before, after);
    const prodLabel = kind === 'complete' ? 'complete' : kind === 'in_progress' ? 'in progress' : 'not started';
    const prodCls = kind === 'complete' ? 'ok' : kind === 'in_progress' ? 'warn' : '';
    const siLabel = String((opts && opts.siLabel) || 'unknown');
    const siCls = siLabel === 'complete' ? 'ok' : siLabel === 'incomplete' ? 'warn' : '';
    const have = Number(opts && opts.siHave) || 0;
    const need = Number(opts && opts.siNeed) || 0;
    return `PROD <span class="pill ${prodCls}">${escape(prodLabel)}</span>`
      + ` <span class="muted">before ${before} / after ${after}</span>`
      + ` | SI <span class="pill ${siCls}">${escape(siLabel)}</span>`
      + ` <span class="muted">${have}/${need} sections</span>`;
  }

  function liveStatusLineHtml(row, esc, extraBefore) {
    const state = prodPhotoState(row, extraBefore);
    const si = siSectionCounts(row);
    return liveStatusLineFromCounts({
      prodKind: state.kind === 'hidden' ? 'not_started' : state.kind,
      before: state.before,
      after: state.after,
      siLabel: siDisplayLabel(row),
      siHave: si.have,
      siNeed: si.need,
    }, esc);
  }

  function prodStatusPillHtml(state) {
    if (!state || state.kind === 'hidden') return '';
    if (state.kind === 'complete') return '<span class="pill ok">PROD complete</span>';
    if (state.kind === 'in_progress') return '<span class="pill warn">PROD in progress</span>';
    return '<span class="pill">PROD not started</span>';
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

  function sheetRowDone(row) {
    if (markActive(row, 'out_of_scope')) return true;
    if (markActive(row, 'complete')) return true;
    if (markActive(row, 'not_in_store')) return true;
    if (prodDone(row) && siDone(row)) return true;
    return false;
  }

  function rowSendReady(row) {
    if (markActive(row, 'out_of_scope')) return true;
    if (markActive(row, 'not_in_store')) return true;
    if (markActive(row, 'complete')) return true;
    if (markActive(row, 'backlog')) return true;
    if (prodDone(row) && siDone(row)) return true;
    return false;
  }

  function formatEstHrs(raw) {
    if (raw == null || raw === '') return '';
    const text = String(raw).trim();
    const n = Number(text.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return text ? `Est ${text}` : '';
    if (n < 1) return `Est ${Math.round(n * 60)} min`;
    const shown = Number.isInteger(n) ? String(n) : String(n);
    return `Est ${shown} hr`;
  }

  function aisleNumber(row) {
    const loc = siLocationLabel(row);
    const m = loc.match(/aisle\s*(\d+)/i) || loc.match(/\b(\d{1,3})\b/);
    if (!m) return 9999;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : 9999;
  }

  function aisleSortKey(row) {
    const loc = siLocationLabel(row).toLowerCase();
    const name = String((row && (row.catName || row.dbkey || row.catId)) || '').toLowerCase();
    return [aisleNumber(row), loc, name];
  }

  function walkRank(row) {
    if (sheetRowDone(row)) return 2;
    if (markActive(row, 'backlog')) return 1;
    return 0;
  }

  function cmpWalk(a, b) {
    const ra = walkRank(a);
    const rb = walkRank(b);
    if (ra !== rb) return ra - rb;
    const ka = aisleSortKey(a);
    const kb = aisleSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  }

  function sortWalkRows(rows) {
    return (rows || []).slice().sort(cmpWalk);
  }

  function nextWalkRow(rows, afterId) {
    const open = sortWalkRows(rows).filter((r) => walkRank(r) === 0 && r && r.dbkey);
    if (!open.length) return null;
    if (afterId == null || afterId === '') return open[0];
    const i = open.findIndex((r) => String(r.id) === String(afterId));
    if (i >= 0) return open[i + 1] || null;
    return open[0];
  }

  function matchesSheetFilters(row, filters) {
    const f = filters || {};
    if (markActive(row, 'out_of_scope')) return false;
    if (f.status === 'backlog') {
      if (!markActive(row, 'backlog') || sheetRowDone(row)) return false;
    }
    if (f.status === 'done' && !sheetRowDone(row)) return false;
    if (f.status === 'not_done' && sheetRowDone(row)) return false;
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
    prodPhotoCounts,
    prodPhotoState,
    prodStatusPillHtml,
    prodKindFromCounts,
    siSectionCounts,
    siDisplayLabel,
    neededCaptureSlot,
    liveStatusLineFromCounts,
    liveStatusLineHtml,
    prodDone,
    siDone,
    sheetRowDone,
    rowSendReady,
    formatEstHrs,
    matchesSheetFilters,
    aisleNumber,
    aisleSortKey,
    walkRank,
    sortWalkRows,
    nextWalkRow,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodCategoryCardStatus = api;
})(typeof window !== 'undefined' ? window : globalThis);
