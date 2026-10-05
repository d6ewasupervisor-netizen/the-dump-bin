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

  /* Aisle only. siLocation.label is "aisle · department · N bays"; the compact
     card shows walk order, not the department or the bay count. */
  function siAisleLabel(row) {
    const loc = row && row.live && row.live.siLocation;
    if (!loc) return '';
    if (typeof loc === 'string') {
      const m = loc.match(/aisle\s*[\w-]+/i);
      return m ? m[0].trim() : '';
    }
    const aisle = String(loc.aisleLabel || '').trim();
    if (aisle) return aisle;
    const first = String(loc.label || '').split('\u00b7')[0].trim();
    return /aisle/i.test(first) ? first : '';
  }

  /* "V5" for the card meta. */
  function versionLabel(row) {
    const token = String((row && row.versionToken) || '').trim();
    if (token) return token;
    const v = String((row && row.version) || '').trim();
    return v ? `V${v}` : '';
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
    if (type === 'not_executable') return !!m.notExecutable;
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
    const storedAfter = stored != null && stored !== '' ? Number(stored) || 0 : 0;
    const after = Math.max(storedAfter, afterFromPhotos);
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
    if (markActive(row, 'complete')) {
      return { kind: 'complete', ...counts };
    }
    if (!live) {
      if (counts.before || counts.after) return { kind: prodKindFromCounts(counts.before, counts.after), ...counts };
      return { kind: 'hidden', before: 0, after: 0 };
    }
    const inProd = !!live.prodStatus && String(live.prodStatus).toLowerCase() !== 'absent';
    if (!inProd && !counts.before && !counts.after) return { kind: 'hidden', ...counts };
    return { kind: prodKindFromCounts(counts.before, counts.after), ...counts };
  }

  function footageFeet(row) {
    const raw = String((row && (row.footage || row.footageDisplay || row.size)) || '').trim();
    if (!raw) return 0;
    const token = raw.match(/^F(\d+)$/i);
    if (token) return Number(token[1]) || 0;
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /* 4 ft bays, then 3 ft. 5 ft does not become 5 pictures. */
  function bayCountFromFeet(feet) {
    const n = Number(feet) || 0;
    if (n <= 0) return 0;
    for (const width of [4, 3]) {
      if (n % width === 0) {
        const bays = n / width;
        if (bays >= 1 && bays <= 48) return bays;
      }
    }
    for (let fours = Math.floor(n / 4); fours >= 0; fours -= 1) {
      const rem = n - fours * 4;
      if (rem % 3 !== 0) continue;
      const threes = rem / 3;
      const bays = fours + threes;
      if (bays >= 1 && bays <= 48) return bays;
    }
    return 0;
  }

  /* After pictures only. A before is not an SI picture, and a 0 SI count
     must not fall through to the whole photo list. */
  function siPictureHave(row) {
    const live = row && row.live;
    const photos = photoList(row);
    let siAfters = 0;
    for (const p of photos) {
      const source = String((p && p.source) || '').toLowerCase();
      const slot = String((p && p.slot) || '').toLowerCase();
      if (source === 'si' && slot !== 'before') siAfters += 1;
    }
    const explicit = live && live.siPhotoCount;
    const fromExplicit = explicit != null && explicit !== '' && Number.isFinite(Number(explicit))
      ? Number(explicit)
      : 0;
    return Math.max(fromExplicit, siAfters, prodPhotoCounts(row).after);
  }

  function siSectionCounts(row) {
    return { have: siPictureHave(row), need: expectedPhotoNeed(row) };
  }

  function siConfirmedAbsent(row) {
    const live = row && row.live;
    if (!live || live.siPresent) return false;
    const st = String(live.siStatus || '').trim().toLowerCase();
    return st === '' || st === 'absent' || st === 'not_found' || st === 'unknown' || st === 'unavailable' || st === 'no task';
  }

  /* A loaded status that names no task. An empty object is "not loaded yet". */
  function siTaskMissing(si) {
    if (!si || si.present || si.taskId) return false;
    const st = String(si.status || '').trim().toLowerCase();
    return st === 'not_found' || st === 'absent' || st === 'unknown' || st === 'unavailable' || st === 'no task';
  }

  function siExplicitlyAbsent(row) {
    const live = row && row.live;
    if (!live || live.siPresent) return false;
    return siTaskMissing({ status: live.siStatus });
  }

  function prodDoneFlag(row) {
    const live = row && row.live;
    if (!live) return false;
    if (live.prodComplete === true) return true;
    const st = String(live.prodStatus || '').trim().toLowerCase();
    return st === 'done' || st === 'complete' || st === 'completed';
  }

  function pacificDay(value) {
    if (value == null || value === '') return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch (_) {
      return '';
    }
  }

  function priorShiftNote(row, workDate) {
    if (!markActive(row, 'complete')) return '';
    const work = String(workDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(work)) return '';
    const detail = row && row.marks && row.marks.details && row.marks.details.complete;
    const day = pacificDay(detail && detail.markedAt);
    if (!day || day >= work) return '';
    return 'Completed on previous shift';
  }

  function siDisplayLabel(row) {
    if (prodClosedPartialBefore(row)) return 'no task';
    if (markActive(row, 'complete') && siConfirmedAbsent(row)) return 'no task';
    if (markActive(row, 'complete')) return 'complete';
    const live = row && row.live;
    const { have, need } = siSectionCounts(row);
    if (need > 0 && have >= need) return 'complete';
    if (live && (live.siPresent || need || have || live.siStatus)) return 'incomplete';
    return 'unknown';
  }

  function neededCaptureSlot(row, extraBefore, extraAfter) {
    const counts = prodPhotoCounts(row, extraBefore);
    const before = counts.before;
    const after = Math.max(counts.after, Number(extraAfter) || 0);
    const need = expectedPhotoNeed(row);
    if (countMeetsNeed(before, need) && countMeetsNeed(after, need)) return '';
    if (before <= 0) return 'before';
    return 'after';
  }

  function nextCaptureBay(row, slot, extraBefore, extraAfter) {
    const counts = prodPhotoCounts(row, extraBefore);
    const have = String(slot) === 'before'
      ? counts.before
      : Math.max(counts.after, Number(extraAfter) || 0);
    const next = (Number(have) || 0) + 1;
    const need = expectedPhotoNeed(row);
    if (need > 0 && next > need) return need;
    return Math.max(1, next);
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
    const siCount = siLabel === 'no task' ? '' : (need > 0 ? `${have}/${need}` : String(have));
    return `PROD <span class="pill ${prodCls}">${escape(prodLabel)}</span>`
      + ` <span class="muted">${before}/${after}</span>`
      + ` | SI <span class="pill ${siCls}">${escape(siLabel)}</span>`
      + (siCount ? ` <span class="muted">${escape(siCount)}</span>` : '');
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

  function prodPhotosReady(row, extraBefore) {
    const counts = prodPhotoCounts(row, extraBefore);
    return counts.before > 0 && counts.after > 0;
  }

  function siPhotosReady(row) {
    const { have, need } = siSectionCounts(row);
    if (have < 1) return false;
    if (need > 0) return have >= need;
    return true;
  }

  /* SI bay count when we have one. Footage is feet, turned into bays only
     when SI did not report a bay count. */
  function expectedPhotoNeed(row) {
    const live = row && row.live;
    const loc = live && live.siLocation;
    const bay = Number(loc && (loc.bayCount || loc.sectionCount)) || 0;
    const section = Number(live && (live.sectionCount || live.expectedBayCount)) || 0;
    const n = Math.max(bay, section);
    if (n > 0) return n;
    return bayCountFromFeet(footageFeet(row));
  }

  function countMeetsNeed(count, need) {
    const n = Number(count) || 0;
    if (need > 0) return n >= need;
    return n > 0;
  }

  /* An explicit open-action count still blocks Complete. The SI status
     string does not — a photographed bay is done even while the task
     still says in progress. */
  function actionsClear(row) {
    const live = row && row.live;
    if (!live) return true;
    if (live.actionsComplete === false) return false;
    if (live.openActions != null && live.openActions !== '' && Number(live.openActions) > 0) return false;
    if (live.pendingActions != null && live.pendingActions !== '' && Number(live.pendingActions) > 0) return false;
    return true;
  }

  function hasBeforePictures(row, extraBefore) {
    return prodPhotoCounts(row, extraBefore).before > 0;
  }

  /* PROD already closed, no SI task, afters cover the run, at least one before.
     A before on every bay stays the normal Complete rule when SI has a task. */
  function prodClosedPartialBefore(row) {
    if (!siExplicitlyAbsent(row) || !prodDoneFlag(row)) return false;
    const counts = prodPhotoCounts(row, 0);
    if (counts.before < 1) return false;
    return countMeetsNeed(counts.after, expectedPhotoNeed(row)) && actionsClear(row);
  }

  /* Set-screen chips. PROD afters are not SI photos when the task is missing. */
  function siCaptureLabel(si, expectedBayCount, afterCount) {
    if (siTaskMissing(si)) {
      return {
        siLabel: 'no task',
        siHave: Number(si && si.sectionsWithPhoto) || 0,
        siNeed: 0,
      };
    }
    const siHave = Math.max(Number(si && si.sectionsWithPhoto) || 0, Number(afterCount) || 0);
    const siNeed = Math.max(Number(si && si.sectionCount) || 0, Number(expectedBayCount) || 0);
    const siLabel = siNeed > 0 && siHave >= siNeed
      ? 'complete'
      : (siNeed || siHave || si ? 'incomplete' : 'unknown');
    return { siLabel, siHave, siNeed };
  }

  /* Complete section only. Send-ready and sheetRowDone stay on their own rules. */
  function sheetDisplayComplete(row) {
    if (prodClosedPartialBefore(row)) return true;
    const counts = prodPhotoCounts(row, 0);
    const need = expectedPhotoNeed(row);
    const si = siSectionCounts(row);
    const siNeed = Math.max(need, si.need);
    return countMeetsNeed(counts.before, need)
      && countMeetsNeed(counts.after, need)
      && countMeetsNeed(si.have, siNeed)
      && actionsClear(row);
  }

  function backlogDisplaced(row, extraBefore) {
    if (sheetDisplayComplete(row)) return true;
    if (markActive(row, 'complete')) return true;
    if (markActive(row, 'not_in_store')) return true;
    if (markActive(row, 'not_executable')) return true;
    if (markActive(row, 'out_of_scope')) return true;
    if (hasBeforePictures(row, extraBefore)) return true;
    return false;
  }

  /* Absent after a full-week PROD search. Unknown live data is not absence. */
  function notInProd(row) {
    const live = row && row.live;
    if (!live) return false;
    return String(live.prodStatus || '').trim().toLowerCase() === 'absent';
  }

  /* On the SI task layer, missing from the PROD visit. */
  function missingFromProd(row) {
    const live = row && row.live;
    if (!live || !live.siPresent) return false;
    return notInProd(row);
  }

  /* Not on the PROD visit and marked not in SI: nothing left to photograph. */
  function absentFromStoreAndSi(row) {
    return notInProd(row) && markActive(row, 'not_in_si');
  }

  function oddityCalloutVisible(row, extraBefore) {
    const err = String((row && (row.errorMessage || row.error_message)) || '').trim();
    if (!err) return false;
    if (markActive(row, 'backlog')) return false;
    if (markActive(row, 'not_in_store')) return false;
    if (markActive(row, 'not_in_si')) return false;
    if (markActive(row, 'not_executable')) return false;
    if (markActive(row, 'out_of_scope')) return false;
    if (markActive(row, 'complete')) return false;
    if (hasBeforePictures(row, extraBefore)) return false;
    if (prodPhotoCounts(row, 0).after > 0) return false;
    if (sheetDisplayComplete(row)) return false;
    return true;
  }

  function sheetDisplayBucket(row, extraBefore) {
    if (markActive(row, 'out_of_scope')) return 'out_of_scope';
    if (markActive(row, 'not_executable') || markActive(row, 'not_in_store') || absentFromStoreAndSi(row)) return 'not_executable';
    if (sheetDisplayComplete(row)) return 'complete';
    if (markActive(row, 'backlog') && !backlogDisplaced(row, extraBefore)) return 'backlog';
    if (hasBeforePictures(row, extraBefore)) return 'in_progress';
    return 'not_started';
  }

  function backlogLabelVisible(row, extraBefore) {
    return sheetDisplayBucket(row, extraBefore) === 'backlog';
  }

  /* Terminal marks close a set without photos on either side. */
  function terminalMark(row) {
    return markActive(row, 'not_in_store')
      || markActive(row, 'out_of_scope')
      || markActive(row, 'not_executable')
      || absentFromStoreAndSi(row);
  }

  function prodDone(row) {
    if (markActive(row, 'complete') || terminalMark(row)) return true;
    return prodPhotosReady(row);
  }

  function siDone(row) {
    if (markActive(row, 'complete') || terminalMark(row)) return true;
    return siPhotosReady(row);
  }

  function eodAfterReady(row) {
    if (String(row?.shiftType || row?.shift_type || '').trim().toUpperCase() !== 'EOD') return false;
    const photos = photoList(row);
    if (photos.some((p) => p && String(p.slot || '').toLowerCase() === 'after')) return true;
    return (Number(row?.live?.prodAfterCount) || 0) > 0;
  }

  function sheetRowDone(row) {
    if (terminalMark(row)) return true;
    if (markActive(row, 'complete')) return true;
    if (eodAfterReady(row)) return true;
    return prodPhotosReady(row) && siPhotosReady(row);
  }

  function rowSendReady(row) {
    if (terminalMark(row)) return true;
    if (markActive(row, 'backlog')) return true;
    if (markActive(row, 'complete')) return true;
    if (eodAfterReady(row)) return true;
    return prodPhotosReady(row) && siPhotosReady(row);
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

  function rowInSheetFilter(row, status, extraBefore) {
    const oos = markActive(row, 'out_of_scope');
    const ne = markActive(row, 'not_executable') || markActive(row, 'not_in_store') || absentFromStoreAndSi(row);
    const started = hasBeforePictures(row, extraBefore);
    const complete = sheetDisplayComplete(row);
    if (status === 'out_of_scope') return oos;
    if (status === 'not_executable') return ne;
    if (status === 'not_in_prod') return notInProd(row);
    if (status === 'complete') return complete && !oos && !ne;
    if (status === 'backlog') return backlogLabelVisible(row, extraBefore);
    if (status === 'in_progress') return started && !complete && !oos && !ne;
    if (status === 'not_started') return !started && !complete && !oos && !ne;
    return false;
  }

  function matchesSheetFilters(row, filters, extraBefore) {
    const f = filters || {};
    if (f.status && f.status !== 'all') {
      const alias = { done: 'complete', not_done: 'not_started' };
      const want = alias[f.status] || f.status;
      if (!rowInSheetFilter(row, want, extraBefore)) return false;
    }
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
    siAisleLabel,
    versionLabel,
    markActive,
    terminalMark,
    prodPhotoCounts,
    prodPhotoState,
    prodStatusPillHtml,
    prodKindFromCounts,
    siSectionCounts,
    siDisplayLabel,
    priorShiftNote,
    siConfirmedAbsent,
    siTaskMissing,
    siCaptureLabel,
    prodClosedPartialBefore,
    neededCaptureSlot,
    nextCaptureBay,
    liveStatusLineFromCounts,
    liveStatusLineHtml,
    prodPhotosReady,
    siPhotosReady,
    expectedPhotoNeed,
    sheetDisplayComplete,
    sheetDisplayBucket,
    backlogLabelVisible,
    notInProd,
    missingFromProd,
    oddityCalloutVisible,
    rowInSheetFilter,
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
