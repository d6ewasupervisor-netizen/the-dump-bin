/* Keep this store on the API warm list and prefetch set status. */
(function (global) {
  'use strict';

  const DS_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';
  const FIELD_API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const HEARTBEAT_MS = 45_000;
  const SHEET_MS = 45_000;
  const STATUS_TTL_MS = 180_000;
  const STATUS_CONCURRENCY = 2;
  const POG_TTL_MS = 8 * 60_000;
  const POG_PREFETCH = 6;
  const POG_CONCURRENCY = 1;

  const statusCache = new Map();
  const pogCache = new Map();
  let beatTimer = null;
  let prefetching = false;
  let pogPrefetching = false;
  let started = false;

  function cacheKey(dbkey) {
    const S = global.EodSession;
    return `${S?.state?.storeNumber || ''}|${S?.state?.workDate || ''}|${String(dbkey || '').replace(/^0+/, '')}`;
  }

  function putStatus(dbkey, status) {
    if (!dbkey || !status) return;
    statusCache.set(cacheKey(dbkey), { at: Date.now(), status });
  }

  function peekStatus(dbkey) {
    const hit = statusCache.get(cacheKey(dbkey));
    if (!hit) return null;
    if (Date.now() - hit.at >= STATUS_TTL_MS) {
      statusCache.delete(cacheKey(dbkey));
      return null;
    }
    return hit.status;
  }

  function dropStatus(dbkey) {
    statusCache.delete(cacheKey(dbkey));
  }

  function putPlanogram(dbkey, planogram) {
    if (!dbkey || !planogram?.bays?.length) return;
    pogCache.set(cacheKey(dbkey), { at: Date.now(), planogram });
  }

  function peekPlanogram(dbkey) {
    const hit = pogCache.get(cacheKey(dbkey));
    if (!hit) return null;
    if (Date.now() - hit.at >= POG_TTL_MS) {
      pogCache.delete(cacheKey(dbkey));
      return null;
    }
    return hit.planogram;
  }

  function visitReady() {
    return !!(global.EodSession?.isVisitReady?.() && global.EodSession.state.storeNumber);
  }

  function storeDayVisitIds() {
    const S = global.EodSession;
    const fromList = (S.state.shifts || []).map((s) => s.visitId).filter(Boolean);
    const selected = S.state.selectedShift?.visitId;
    return [...new Set([...fromList, selected].filter(Boolean).map(String))];
  }

  async function beat() {
    if (!visitReady() || !global.authFetch) return;
    const S = global.EodSession;
    try {
      await global.authFetch(`${DS_API}/heartbeat`, {
        method: 'POST',
        headers: global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          fiscalWeek: S.state.fiscalWeek || S.state.sheet?.fiscalWeek || null,
          visitId: S.state.selectedShift?.visitId || null,
        }),
        skipBusy: true,
      });
    } catch (_) { /* keep trying next tick */ }
  }

  function openRows() {
    const rows = global.EodSession?.state?.sheet?.rows || [];
    return rows.filter((row) => {
      if (!row?.dbkey) return false;
      if (row.live?.bothComplete) return false;
      const marks = row.marks?.active || [];
      if (marks.includes('complete') || marks.includes('not_in_store') || marks.includes('out_of_scope')) {
        return false;
      }
      return true;
    });
  }

  async function fetchOneStatus(row) {
    const S = global.EodSession;
    const qs = new URLSearchParams({
      store: S.state.storeNumber,
      date: S.state.workDate,
      dbkey: row.dbkey,
    });
    if (row.id) qs.set('rowId', row.id);
    if (S.state.selectedShift?.visitId) qs.set('visitId', S.state.selectedShift.visitId);
    const ids = storeDayVisitIds();
    if (ids.length) qs.set('visitIds', ids.join(','));
    const resp = await global.authFetch(`${FIELD_API}/status?${qs}`, { skipBusy: true });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.status) return;
    putStatus(row.dbkey, data.status);
  }

  async function prefetchStatuses() {
    if (prefetching || !visitReady()) return;
    const need = openRows().filter((row) => !peekStatus(row.dbkey));
    if (!need.length) return;
    prefetching = true;
    try {
      let i = 0;
      async function worker() {
        while (i < need.length) {
          const row = need[i];
          i += 1;
          try { await fetchOneStatus(row); } catch (_) { /* skip */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, need.length) }, () => worker()));
    } finally {
      prefetching = false;
    }
  }

  async function fetchOnePlanogram(row) {
    const S = global.EodSession;
    const qs = new URLSearchParams({
      store: S.state.storeNumber,
      date: S.state.workDate,
      dbkey: row.dbkey,
    });
    const resp = await global.authFetch(`${FIELD_API}/planogram?${qs}`, { skipBusy: true });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.planogram) return;
    putPlanogram(row.dbkey, data.planogram);
  }

  async function prefetchPlanograms() {
    if (pogPrefetching || !visitReady()) return;
    const need = openRows().filter((row) => !peekPlanogram(row.dbkey)).slice(0, POG_PREFETCH);
    if (!need.length) return;
    pogPrefetching = true;
    try {
      let i = 0;
      async function worker() {
        while (i < need.length) {
          const row = need[i];
          i += 1;
          try { await fetchOnePlanogram(row); } catch (_) { /* skip */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(POG_CONCURRENCY, need.length) }, () => worker()));
    } finally {
      pogPrefetching = false;
    }
  }

  function start() {
    if (started) {
      beat();
      prefetchStatuses();
      prefetchPlanograms();
      return;
    }
    started = true;
    beat();
    prefetchStatuses();
    prefetchPlanograms();
    if (beatTimer) clearInterval(beatTimer);
    beatTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      beat();
      prefetchStatuses();
      prefetchPlanograms();
    }, HEARTBEAT_MS);
  }

  function stop() {
    started = false;
    if (beatTimer) clearInterval(beatTimer);
    beatTimer = null;
  }

  global.EodStoreProdWarm = {
    start,
    stop,
    beat,
    prefetchStatuses,
    prefetchPlanograms,
    peekStatus,
    putStatus,
    dropStatus,
    peekPlanogram,
    putPlanogram,
    HEARTBEAT_MS,
    SHEET_MS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
