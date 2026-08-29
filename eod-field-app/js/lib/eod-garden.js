/* Persist draft, sheet snapshot, and pending sheet marks through refresh / back / close. */
(function (global) {
  'use strict';

  const DB_NAME = 'eodGarden';
  const DB_VERSION = 1;
  const KV = 'kv';
  const MARKS = 'markQueue';
  const SHEET_PREFIX = 'sheet:';
  const MARK_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  let dbp = null;
  let flushBusy = false;

  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (ev) => {
        const d = ev.target.result;
        if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(MARKS)) d.createObjectStore(MARKS, { keyPath: 'id', autoIncrement: true });
      };
    });
    return dbp;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(tx.error || new Error('garden tx aborted'));
      tx.onerror = () => reject(tx.error || new Error('garden tx error'));
    });
  }

  async function putKv(id, value) {
    const db = await openDb();
    const tx = db.transaction(KV, 'readwrite');
    tx.objectStore(KV).put({ id, value, savedAt: Date.now() });
    await txDone(tx);
  }

  async function getKv(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(KV, 'readonly').objectStore(KV).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  function sheetKey(store, week) {
    const s = String(store || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const w = String(week || '').trim().toUpperCase();
    if (!s || !w) return null;
    return `${SHEET_PREFIX}${s}:${w}`;
  }

  async function saveSheetSnapshot(sheet) {
    if (!sheet || !sheet.storeNumber) return;
    const key = sheetKey(sheet.storeNumber, sheet.fiscalWeek);
    if (!key) return;
    try { await putKv(key, sheet); } catch (err) {
      console.warn('[garden] sheet snapshot failed', err);
    }
  }

  async function listSheetSnapshots() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(KV, 'readonly').objectStore(KV).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        resolve(rows.filter((r) => String(r.id || '').startsWith(SHEET_PREFIX)).map((r) => {
          const rest = String(r.id).slice(SHEET_PREFIX.length);
          const colon = rest.lastIndexOf(':');
          const raw = JSON.stringify(r.value || '');
          return {
            id: r.id,
            store: colon >= 0 ? rest.slice(0, colon) : rest,
            week: colon >= 0 ? rest.slice(colon + 1) : '',
            savedAt: r.savedAt || 0,
            bytes: raw.length,
          };
        }));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSheetSnapshot(id) {
    if (!id || !String(id).startsWith(SHEET_PREFIX)) return false;
    const db = await openDb();
    const tx = db.transaction(KV, 'readwrite');
    tx.objectStore(KV).delete(id);
    await txDone(tx);
    return true;
  }

  async function purgeOldSheets({ keepStore, keepWeek, maxAgeMs = 3 * 24 * 60 * 60 * 1000 } = {}) {
    const keepKey = sheetKey(keepStore, keepWeek);
    const now = Date.now();
    const rows = await listSheetSnapshots();
    let removed = 0;
    for (const row of rows) {
      if (keepKey && row.id === keepKey) continue;
      if (maxAgeMs > 0 && row.savedAt && now - row.savedAt < maxAgeMs) continue;
      await deleteSheetSnapshot(row.id);
      removed += 1;
    }
    return { removed };
  }

  async function loadSheetSnapshot(store, week) {
    const key = sheetKey(store, week);
    if (!key) return null;
    try { return await getKv(key); } catch (_) { return null; }
  }

  function applyOptimisticMark(sheet, rowId, markType, on) {
    if (!sheet || !Array.isArray(sheet.rows)) return null;
    const row = sheet.rows.find((r) => String(r.id) === String(rowId));
    if (!row) return null;
    const prev = row.marks || row.mark || {};
    const active = new Set(Array.isArray(prev.active) ? prev.active : []);
    if (markType === 'clear') active.clear();
    else if (on) active.add(markType);
    else active.delete(markType);
    const arr = [...active];
    const marks = {
      complete: arr.includes('complete'),
      notInStore: arr.includes('not_in_store'),
      notInSi: arr.includes('not_in_si'),
      backlog: arr.includes('backlog'),
      active: arr,
      pending: true,
      type: arr.includes('complete') ? 'complete'
        : arr.includes('not_in_store') ? 'not_in_store'
        : arr.includes('not_in_si') ? 'not_in_si'
        : arr.includes('backlog') ? 'backlog'
        : (arr[0] || null),
    };
    row.marks = marks;
    row.mark = marks;
    const total = sheet.rows.length;
    const marked = sheet.rows.filter((r) => r.marks?.active?.length).length;
    sheet.summary = Object.assign({}, sheet.summary || {}, {
      total,
      marked,
      unresolved: total - marked,
    });
    return row;
  }

  async function enqueueMark(job) {
    const db = await openDb();
    const tx = db.transaction(MARKS, 'readwrite');
    tx.objectStore(MARKS).add({
      rowId: job.rowId,
      markType: job.markType,
      method: job.method || 'POST',
      body: job.body || {},
      queuedAt: Date.now(),
    });
    await txDone(tx);
  }

  async function listQueuedMarks() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(MARKS, 'readonly').objectStore(MARKS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteQueuedMark(id) {
    const db = await openDb();
    const tx = db.transaction(MARKS, 'readwrite');
    tx.objectStore(MARKS).delete(id);
    await txDone(tx);
  }

  async function queuedCount() {
    try { return (await listQueuedMarks()).length; } catch (_) { return 0; }
  }

  async function flushMarks() {
    if (flushBusy) return { ok: 0, fail: 0 };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: 0, fail: 0 };
    flushBusy = true;
    let ok = 0;
    let fail = 0;
    try {
      const jobs = await listQueuedMarks();
      const headers = global.EodApi?.dayConfirmHeaders?.() || { 'Content-Type': 'application/json' };
      for (const job of jobs) {
        try {
          const url = job.method === 'DELETE'
            ? `${MARK_API}/rows/${encodeURIComponent(job.rowId)}/mark${job.markType && job.markType !== 'clear'
              ? `?markType=${encodeURIComponent(job.markType)}`
              : ''}`
            : `${MARK_API}/rows/${encodeURIComponent(job.rowId)}/mark`;
          const resp = await global.authFetch(url, {
            method: job.method || 'POST',
            headers,
            body: JSON.stringify(job.body || {}),
          });
          if (!resp.ok) throw new Error(`mark ${resp.status}`);
          await deleteQueuedMark(job.id);
          ok += 1;
        } catch (_) {
          fail += 1;
        }
      }
    } finally {
      flushBusy = false;
    }
    return { ok, fail };
  }

  async function persistAll(reason) {
    const S = global.EodSession;
    try { S?.saveDraft(); } catch (_) {}
    try { S?.syncDomBridges?.(); } catch (_) {}
    if (S?.state?.sheet) {
      try { await saveSheetSnapshot(S.state.sheet); } catch (_) {}
    }
    try {
      if (global.PhotoDB?.savePhotos && S?.state?.photos) {
        await global.PhotoDB.savePhotos(S.state.photos);
      }
    } catch (err) {
      console.warn('[garden] photo save', reason, err);
    }
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try { await flushMarks(); } catch (_) {}
    }
    return true;
  }

  function start() {
    const persist = (reason) => { persistAll(reason).catch(() => {}); };
    window.addEventListener('pagehide', () => persist('pagehide'));
    window.addEventListener('beforeunload', () => persist('beforeunload'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist('hidden');
    });
    window.addEventListener('hashchange', () => persist('hashchange'));
    window.addEventListener('online', () => {
      flushMarks().then(() => global.EodChrome?.refresh?.()).catch(() => {});
    });
  }

  global.EodGarden = {
    saveSheetSnapshot,
    loadSheetSnapshot,
    listSheetSnapshots,
    deleteSheetSnapshot,
    purgeOldSheets,
    applyOptimisticMark,
    enqueueMark,
    flushMarks,
    queuedCount,
    persistAll,
    start,
  };
})(typeof window !== 'undefined' ? window : globalThis);
