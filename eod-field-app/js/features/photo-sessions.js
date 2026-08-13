/**
 * Batch 5 / T0.1 — day-confirm-keyed photo sessions (IndexedDB).
 *
 * Records: session:<store>:<YYYY-MM-DD>
 * Quarantine: quarantine:legacy (unstamped migration only)
 * Legacy allPhotos: never deleted (rollback safety for ≤2.11.8).
 *
 * Caps: percentage of navigator.storage.estimate().quota when available
 * (soft 30% / hard 50%). Fallback fixed 40 MB / 90 MB if estimate missing —
 * fixed hard cap alone is meaningless vs Safari eviction; prefer % of quota.
 */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LEGACY_ID = 'allPhotos';
  const QUARANTINE_ID = 'quarantine:legacy';
  const MIGRATION_ID = 'migration:photoSessions:v1';
  const PHOTO_TYPES = ['before', 'signoff', 'after', 'instawork'];

  /** Fallback when Storage API estimate is unavailable. */
  const FALLBACK_SOFT_BYTES = 40 * 1024 * 1024;
  const FALLBACK_HARD_BYTES = 90 * 1024 * 1024;
  /** Fractions of reported origin quota. */
  const SOFT_QUOTA_FRAC = 0.30;
  const HARD_QUOTA_FRAC = 0.50;
  const SENT_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
  /** Email ok + only failed jobs (no open) → eligible for sentAt after this window. */
  const FAILED_AFTER_EMAIL_ELIGIBLE_MS = 14 * 24 * 60 * 60 * 1000;

  let cachedEstimate = { quota: null, usage: null, at: 0 };
  const ESTIMATE_TTL_MS = 60 * 1000;

  async function readStorageEstimate(force) {
    const now = Date.now();
    if (!force && cachedEstimate.at && now - cachedEstimate.at < ESTIMATE_TTL_MS) {
      return cachedEstimate;
    }
    let quota = null;
    let usage = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        if (est) {
          if (Number.isFinite(est.quota) && est.quota > 0) quota = Math.floor(est.quota);
          if (Number.isFinite(est.usage) && est.usage >= 0) usage = Math.floor(est.usage);
        }
      }
    } catch (_) { /* Safari quirks — fall back */ }
    cachedEstimate = { quota, usage, at: now };
    return cachedEstimate;
  }

  function capsFromQuota(quota) {
    if (!Number.isFinite(quota) || quota <= 0) {
      return {
        softBytes: FALLBACK_SOFT_BYTES,
        hardBytes: FALLBACK_HARD_BYTES,
        mode: 'fallback',
      };
    }
    const softBytes = Math.max(5 * 1024 * 1024, Math.floor(quota * SOFT_QUOTA_FRAC));
    let hardBytes = Math.max(softBytes + (2 * 1024 * 1024), Math.floor(quota * HARD_QUOTA_FRAC));
    // Never claim a hard cap above 80% of reported quota — leave headroom for eviction.
    hardBytes = Math.min(hardBytes, Math.floor(quota * 0.80));
    return { softBytes, hardBytes, mode: 'quota-frac' };
  }

  function emptyArrays() {
    return { before: [], signoff: [], after: [], instawork: [] };
  }

  function sessionId(store, date) {
    const s = String(store || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const d = String(date || '').slice(0, 10);
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return `session:${s}:${d}`;
  }

  function parseSessionId(id) {
    const m = String(id || '').match(/^session:(\d+):(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    return { store: m[1], date: m[2] };
  }

  function photoSrc(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.dataUrl || '';
  }

  function entryBytes(entry) {
    const src = photoSrc(entry);
    return src ? Math.floor(src.length * 0.75) : 0;
  }

  function arraysBytes(arrs) {
    let n = 0;
    for (const t of PHOTO_TYPES) {
      for (const p of arrs[t] || []) n += entryBytes(p);
    }
    return n;
  }

  function arraysCount(arrs) {
    let n = 0;
    for (const t of PHOTO_TYPES) n += (arrs[t] || []).length;
    return n;
  }

  function stampOf(entry) {
    if (!entry || typeof entry === 'string') return null;
    const store = String(entry.storeNumber || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const date = String(entry.workDate || '').slice(0, 10);
    if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { store, date };
  }

  function dedupe(arr) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr.filter((photo) => {
      const prefix = photoSrc(photo).substring(0, 1000);
      if (!prefix || seen.has(prefix)) return false;
      seen.add(prefix);
      return true;
    });
  }

  function mergeArrays(into, from) {
    const out = emptyArrays();
    for (const t of PHOTO_TYPES) {
      out[t] = dedupe([...(into[t] || []), ...(from[t] || [])]);
      if (t === 'instawork') out[t] = out[t].slice(-1);
    }
    return out;
  }

  function createPhotoDB(opts) {
    opts = opts || {};
    const dbName = opts.dbName || 'kompassEODPhotos';
    const storeName = opts.storeName || 'photos';
    let db = null;
    let activeKey = null; // { store, date, id }
    let migrationDone = false;

    async function init() {
      if (db) return db;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, opts.dbVersion || 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          db = request.result;
          resolve(db);
        };
        request.onupgradeneeded = (event) => {
          const d = event.target.result;
          if (!d.objectStoreNames.contains(storeName)) {
            d.createObjectStore(storeName, { keyPath: 'id' });
          }
        };
      });
    }

    function txStore(mode) {
      return init().then((d) => {
        const tx = d.transaction([storeName], mode);
        return { tx, store: tx.objectStore(storeName) };
      });
    }

    function awaitTx(tx, request) {
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onabort = () => reject(tx.error || request?.error || new Error('IndexedDB aborted'));
        tx.onerror = () => reject(tx.error || request?.error || new Error('IndexedDB error'));
        if (request) {
          request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        }
      });
    }

    async function getRecord(id) {
      const { store } = await txStore('readonly');
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async function putRecord(record) {
      const { tx, store } = await txStore('readwrite');
      const req = store.put(record);
      await awaitTx(tx, req);
      return true;
    }

    async function deleteRecord(id) {
      const { tx, store } = await txStore('readwrite');
      const req = store.delete(id);
      await awaitTx(tx, req);
      return true;
    }

    async function getAllRecords() {
      const { store } = await txStore('readonly');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
      });
    }

    function normalizeSasJobs(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        const id = String(k || '').trim();
        if (!id) continue;
        const status = String(v || '').toLowerCase();
        if (status === 'pending' || status === 'processing' || status === 'completed' || status === 'failed') {
          out[id] = status;
        } else {
          out[id] = 'pending';
        }
      }
      return out;
    }

    function sessionMetaFrom(existing) {
      return {
        sentAt: existing?.sentAt ?? null,
        emailOk: !!existing?.emailOk,
        emailOkAt: existing?.emailOkAt || null,
        failuresDismissedAt: existing?.failuresDismissedAt || null,
        sasJobs: normalizeSasJobs(existing?.sasJobs),
      };
    }

    function buildSessionRecord(store, date, arrs, sentAtOrMeta, maybeExtra) {
      // Compat: (store, date, arrs, sentAt) or (store, date, arrs, metaObject)
      let meta;
      if (sentAtOrMeta && typeof sentAtOrMeta === 'object' && !Array.isArray(sentAtOrMeta)) {
        meta = {
          sentAt: sentAtOrMeta.sentAt ?? null,
          emailOk: !!sentAtOrMeta.emailOk,
          emailOkAt: sentAtOrMeta.emailOkAt || null,
          failuresDismissedAt: sentAtOrMeta.failuresDismissedAt || null,
          sasJobs: normalizeSasJobs(sentAtOrMeta.sasJobs),
        };
      } else {
        meta = {
          sentAt: sentAtOrMeta == null ? null : sentAtOrMeta,
          emailOk: !!(maybeExtra && maybeExtra.emailOk),
          emailOkAt: (maybeExtra && maybeExtra.emailOkAt) || null,
          failuresDismissedAt: (maybeExtra && maybeExtra.failuresDismissedAt) || null,
          sasJobs: normalizeSasJobs(maybeExtra && maybeExtra.sasJobs),
        };
      }
      return {
        id: sessionId(store, date),
        schemaVersion: SCHEMA_VERSION,
        store: String(store),
        date: String(date).slice(0, 10),
        before: arrs.before || [],
        signoff: arrs.signoff || [],
        after: arrs.after || [],
        instawork: arrs.instawork || [],
        sentAt: meta.sentAt == null ? null : meta.sentAt,
        emailOk: meta.emailOk,
        emailOkAt: meta.emailOkAt,
        failuresDismissedAt: meta.failuresDismissedAt,
        sasJobs: meta.sasJobs,
        timestamp: Date.now(),
      };
    }

    function arraysFromRecord(rec) {
      return {
        before: rec?.before || [],
        signoff: rec?.signoff || [],
        after: rec?.after || [],
        instawork: rec?.instawork || [],
      };
    }

    function jobsAllCompleted(sasJobs) {
      const ids = Object.keys(sasJobs || {});
      if (!ids.length) return true;
      return ids.every((id) => sasJobs[id] === 'completed');
    }

    function jobsHaveOpen(sasJobs) {
      return Object.values(sasJobs || {}).some(
        (s) => s === 'pending' || s === 'processing'
      );
    }

    function jobsHaveFailed(sasJobs) {
      return Object.values(sasJobs || {}).some((s) => s === 'failed');
    }

    function jobsHaveOpenOrFailed(sasJobs) {
      return jobsHaveOpen(sasJobs) || jobsHaveFailed(sasJobs);
    }

    /** Email sent, no open jobs, failures dismissed or aged past the window. */
    function failuresResolvedForComplete(meta, nowMs) {
      if (!jobsHaveFailed(meta.sasJobs)) return true;
      if (meta.failuresDismissedAt) return true;
      const emailAt = meta.emailOkAt ? new Date(meta.emailOkAt).getTime() : NaN;
      if (Number.isFinite(emailAt) && nowMs - emailAt >= FAILED_AFTER_EMAIL_ELIGIBLE_MS) {
        return true;
      }
      return false;
    }

    function canSessionComplete(meta, nowMs) {
      if (meta.sentAt) return { ok: true, already: true };
      if (!meta.emailOk) return { ok: false, reason: 'email-pending' };
      if (jobsHaveOpen(meta.sasJobs)) return { ok: false, reason: 'jobs-open' };
      if (jobsAllCompleted(meta.sasJobs)) return { ok: true, reason: 'all-completed' };
      if (jobsHaveFailed(meta.sasJobs) && failuresResolvedForComplete(meta, nowMs)) {
        return { ok: true, reason: meta.failuresDismissedAt ? 'failures-dismissed' : 'failures-aged' };
      }
      if (jobsHaveFailed(meta.sasJobs)) {
        return { ok: false, reason: 'jobs-failed' };
      }
      return { ok: false, reason: 'jobs-incomplete' };
    }

    async function patchSessionById(id, mutator) {
      const parsed = parseSessionId(id);
      if (!parsed) return null;
      const existing = await getRecord(id);
      if (!existing && !mutator) return null;
      const arrs = arraysFromRecord(existing);
      const meta = sessionMetaFrom(existing);
      const nextMeta = mutator(meta, arrs) || meta;
      const rec = buildSessionRecord(parsed.store, parsed.date, arrs, nextMeta);
      // Preserve photo arrays from existing when mutator didn't touch arrs via rebuild —
      // buildSessionRecord already got arrs from existing.
      await putRecord(rec);
      return rec;
    }

    async function patchActiveSession(mutator) {
      activeKey = resolveActiveKey();
      if (!activeKey) return null;
      return patchSessionById(activeKey.id, mutator);
    }

    function resolveActiveKey() {
      // Spec: active key comes from the day-confirm token only — not wall clock,
      // not the form alone (form can lag or rollover independently).
      const dc = typeof opts.getActiveDayConfirm === 'function' ? opts.getActiveDayConfirm() : null;
      if (dc?.store && dc?.date) {
        const id = sessionId(dc.store, dc.date);
        if (id) return { store: String(dc.store), date: String(dc.date).slice(0, 10), id };
      }
      return null;
    }

    async function listSessionSummaries() {
      const all = await getAllRecords();
      const out = [];
      for (const rec of all) {
        const parsed = parseSessionId(rec.id);
        if (!parsed) continue;
        const arrs = {
          before: rec.before || [],
          signoff: rec.signoff || [],
          after: rec.after || [],
          instawork: rec.instawork || [],
        };
        const meta = sessionMetaFrom(rec);
        out.push({
          id: rec.id,
          store: parsed.store,
          date: parsed.date,
          sentAt: meta.sentAt || null,
          emailOk: meta.emailOk,
          emailOkAt: meta.emailOkAt,
          failuresDismissedAt: meta.failuresDismissedAt,
          sasJobs: meta.sasJobs,
          hasOpenJobs: jobsHaveOpen(meta.sasJobs),
          hasFailedJobs: jobsHaveFailed(meta.sasJobs),
          bytes: arraysBytes(arrs),
          count: arraysCount(arrs),
          timestamp: rec.timestamp || 0,
        });
      }
      return out;
    }

    async function pruneSentOlderThan7Days() {
      const now = Date.now();
      const sessions = await listSessionSummaries();
      for (const s of sessions) {
        if (!s.sentAt) continue;
        const t = new Date(s.sentAt).getTime();
        if (!Number.isFinite(t) || now - t < SENT_PRUNE_MS) continue;
        // Never prune active
        if (activeKey && s.id === activeKey.id) continue;
        await deleteRecord(s.id);
      }
    }

    async function enforceHardCap() {
      const est = await readStorageEstimate(false);
      const caps = capsFromQuota(est.quota);
      let sessions = await listSessionSummaries();
      let total = sessions.reduce((a, s) => a + s.bytes, 0);
      while (total > caps.hardBytes) {
        const victims = sessions
          .filter((s) => s.sentAt && (!activeKey || s.id !== activeKey.id))
          .sort((a, b) => {
            const ta = new Date(a.sentAt).getTime() || 0;
            const tb = new Date(b.sentAt).getTime() || 0;
            if (ta !== tb) return ta - tb;
            return (a.timestamp || 0) - (b.timestamp || 0);
          });
        if (!victims.length) {
          return {
            dropped: false,
            fullUnsent: true,
            totalBytes: total,
            hardBytes: caps.hardBytes,
            quotaBytes: est.quota,
          };
        }
        await deleteRecord(victims[0].id);
        sessions = await listSessionSummaries();
        total = sessions.reduce((a, s) => a + s.bytes, 0);
      }
      return {
        dropped: true,
        fullUnsent: false,
        totalBytes: total,
        hardBytes: caps.hardBytes,
        quotaBytes: est.quota,
      };
    }

    async function storagePressure() {
      const sessions = await listSessionSummaries();
      const totalBytes = sessions.reduce((a, s) => a + s.bytes, 0);
      const unsent = sessions.filter((s) => !s.sentAt && s.count > 0);
      const est = await readStorageEstimate(false);
      const caps = capsFromQuota(est.quota);
      const originUsageFrac = (est.quota && est.usage != null)
        ? est.usage / est.quota
        : null;
      return {
        totalBytes,
        sessionCount: sessions.length,
        soft: totalBytes >= caps.softBytes,
        hard: totalBytes >= caps.hardBytes,
        unsentCount: unsent.length,
        softBytes: caps.softBytes,
        hardBytes: caps.hardBytes,
        capMode: caps.mode,
        softFrac: SOFT_QUOTA_FRAC,
        hardFrac: HARD_QUOTA_FRAC,
        quotaBytes: est.quota,
        usageBytes: est.usage,
        originUsageFrac,
        // Browser already using most of origin quota — warn even if photo soft not hit.
        originPressure: originUsageFrac != null && originUsageFrac >= HARD_QUOTA_FRAC,
      };
    }

    /**
     * Idempotent migration from legacy allPhotos using T0.1a stamps.
     * Never deletes allPhotos.
     */
    async function migrateFromLegacyIfNeeded() {
      if (migrationDone) return { skipped: true };
      const marker = await getRecord(MIGRATION_ID);
      const legacy = await getRecord(LEGACY_ID);

      // Even if marker exists, a fresh allPhotos with new stamps can still
      // be absorbed — but only once per marker generation. Marker means
      // "initial split done"; we still merge any remaining stamped leftovers
      // that aren't already in a session (safe re-run).
      if (!legacy) {
        if (!marker) {
          await putRecord({
            id: MIGRATION_ID,
            schemaVersion: SCHEMA_VERSION,
            migratedAt: Date.now(),
            note: 'no-legacy-allPhotos',
          });
        }
        migrationDone = true;
        return { skipped: true, reason: 'no-legacy' };
      }

      const stampedBuckets = new Map(); // id -> arrays
      const quarantine = emptyArrays();
      let stampedCount = 0;
      let unstampedCount = 0;

      for (const t of PHOTO_TYPES) {
        for (const entry of legacy[t] || []) {
          const stamp = stampOf(entry);
          if (stamp) {
            stampedCount++;
            const id = sessionId(stamp.store, stamp.date);
            if (!stampedBuckets.has(id)) stampedBuckets.set(id, emptyArrays());
            stampedBuckets.get(id)[t].push(entry);
          } else {
            unstampedCount++;
            quarantine[t].push(entry);
          }
        }
      }

      for (const [id, arrs] of stampedBuckets) {
        const parsed = parseSessionId(id);
        const existing = await getRecord(id);
        const merged = mergeArrays(
          {
            before: existing?.before || [],
            signoff: existing?.signoff || [],
            after: existing?.after || [],
            instawork: existing?.instawork || [],
          },
          arrs
        );
        await putRecord(
          buildSessionRecord(parsed.store, parsed.date, merged, sessionMetaFrom(existing))
        );
      }

      if (unstampedCount > 0) {
        const existingQ = await getRecord(QUARANTINE_ID);
        const mergedQ = mergeArrays(
          {
            before: existingQ?.before || [],
            signoff: existingQ?.signoff || [],
            after: existingQ?.after || [],
            instawork: existingQ?.instawork || [],
          },
          quarantine
        );
        await putRecord({
          id: QUARANTINE_ID,
          schemaVersion: SCHEMA_VERSION,
          label: 'Unstamped legacy photos (recoverable)',
          before: mergedQ.before,
          signoff: mergedQ.signoff,
          after: mergedQ.after,
          instawork: mergedQ.instawork,
          timestamp: Date.now(),
        });
      }

      // Never delete allPhotos — leave for ≤2.11.8 rollback.
      await putRecord({
        id: MIGRATION_ID,
        schemaVersion: SCHEMA_VERSION,
        migratedAt: Date.now(),
        stampedCount,
        unstampedCount,
        sessionsCreated: stampedBuckets.size,
        allPhotosPreserved: true,
      });
      migrationDone = true;
      return { stampedCount, unstampedCount, sessionsCreated: stampedBuckets.size };
    }

    async function loadActiveInto(photosObj) {
      await migrateFromLegacyIfNeeded();
      await pruneSentOlderThan7Days().catch(() => {});
      activeKey = resolveActiveKey();
      const empty = emptyArrays();
      if (!activeKey) {
        photosObj.before = [];
        photosObj.signoff = [];
        photosObj.after = [];
        photosObj.instawork = [];
        return { key: null, ...empty };
      }
      const rec = await getRecord(activeKey.id);
      photosObj.before = dedupe(rec?.before || []);
      photosObj.signoff = dedupe(rec?.signoff || []);
      photosObj.after = dedupe(rec?.after || []);
      photosObj.instawork = dedupe(rec?.instawork || []).slice(-1);
      return {
        key: activeKey,
        before: photosObj.before,
        signoff: photosObj.signoff,
        after: photosObj.after,
        instawork: photosObj.instawork,
      };
    }

    async function savePhotos(photosObj) {
      activeKey = resolveActiveKey();
      const arrs = {
        before: photosObj.before || [],
        signoff: photosObj.signoff || [],
        after: photosObj.after || [],
        instawork: (photosObj.instawork || []).slice(-1),
      };

      // Dual-write allPhotos mirror of active (or empty) for ≤2.11.8 rollback.
      const legacyMirror = {
        id: LEGACY_ID,
        before: arrs.before,
        signoff: arrs.signoff,
        after: arrs.after,
        instawork: arrs.instawork,
        timestamp: Date.now(),
      };

      if (activeKey) {
        const existing = await getRecord(activeKey.id);
        const rec = buildSessionRecord(
          activeKey.store,
          activeKey.date,
          arrs,
          sessionMetaFrom(existing)
        );
        const { tx, store } = await txStore('readwrite');
        store.put(rec);
        store.put(legacyMirror);
        await awaitTx(tx);
      } else {
        // No active session — still mirror memory to allPhotos for rollback,
        // but do not invent a session key (would bypass day-confirm).
        await putRecord(legacyMirror);
      }

      await enforceHardCap().catch(() => {});
      return true;
    }

    /** Clear only the active session (+ allPhotos mirror). Other sessions stay. */
    async function clearPhotos() {
      activeKey = resolveActiveKey();
      const { tx, store } = await txStore('readwrite');
      if (activeKey) store.delete(activeKey.id);
      store.put({
        id: LEGACY_ID,
        before: [],
        signoff: [],
        after: [],
        instawork: [],
        timestamp: Date.now(),
      });
      await awaitTx(tx);
      return true;
    }

    /** Switch after day-confirm change: persist outgoing memory, load incoming. */
    async function switchToDayConfirm(store, date, photosObj) {
      const nextId = sessionId(store, date);
      if (!nextId) return loadActiveInto(photosObj);

      // Save current memory into previous active key if any
      const prev = activeKey;
      if (prev && prev.id !== nextId) {
        const existing = await getRecord(prev.id);
        await putRecord(
          buildSessionRecord(prev.store, prev.date, {
            before: photosObj.before || [],
            signoff: photosObj.signoff || [],
            after: photosObj.after || [],
            instawork: photosObj.instawork || [],
          }, sessionMetaFrom(existing))
        );
      }

      activeKey = { store: String(store), date: String(date).slice(0, 10), id: nextId };
      const rec = await getRecord(nextId);
      photosObj.before = dedupe(rec?.before || []);
      photosObj.signoff = dedupe(rec?.signoff || []);
      photosObj.after = dedupe(rec?.after || []);
      photosObj.instawork = dedupe(rec?.instawork || []).slice(-1);

      // Mirror active to allPhotos
      await putRecord({
        id: LEGACY_ID,
        before: photosObj.before,
        signoff: photosObj.signoff,
        after: photosObj.after,
        instawork: photosObj.instawork,
        timestamp: Date.now(),
      });
      return { key: activeKey };
    }

    async function unsentSessions() {
      const sessions = await listSessionSummaries();
      const activeId = resolveActiveKey()?.id;
      return sessions
        .filter((s) => !s.sentAt && s.count > 0 && s.id !== activeId)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    async function quarantineSummary() {
      const q = await getRecord(QUARANTINE_ID);
      if (!q) return null;
      const arrs = {
        before: q.before || [],
        signoff: q.signoff || [],
        after: q.after || [],
        instawork: q.instawork || [],
      };
      const count = arraysCount(arrs);
      if (!count) return null;
      return { id: QUARANTINE_ID, count, bytes: arraysBytes(arrs), label: q.label };
    }

    /** Batch 7 — track a SAS/coversheet job on the active session. */
    async function trackSasJob(jobId, status) {
      const id = String(jobId || '').trim();
      if (!id) return null;
      activeKey = resolveActiveKey();
      if (!activeKey) return null;
      return setSessionSasJobStatus(activeKey.id, id, status);
    }

    async function setSasJobStatus(jobId, status) {
      return trackSasJob(jobId, status);
    }

    async function setSessionSasJobStatus(sessionRecId, jobId, status) {
      const id = String(jobId || '').trim();
      if (!id || !sessionRecId) return null;
      const st = String(status || 'pending').toLowerCase();
      return patchSessionById(sessionRecId, (meta) => {
        meta.sasJobs[id] = (st === 'processing' || st === 'completed' || st === 'failed')
          ? st
          : 'pending';
        // A later completed job means prior failures were retried — drop failed
        // entries so session-complete can close once email + open jobs settle.
        if (meta.sasJobs[id] === 'completed') {
          for (const [jid, s] of Object.entries(meta.sasJobs)) {
            if (s === 'failed') delete meta.sasJobs[jid];
          }
        }
        return meta;
      });
    }

    async function markEmailOk() {
      const at = new Date().toISOString();
      return patchActiveSession((meta) => {
        meta.emailOk = true;
        if (!meta.emailOkAt) meta.emailOkAt = at;
        return meta;
      });
    }

    /**
     * Lead acknowledges email-sent + terminal upload failure(s).
     * Removes failed job entries and marks failuresDismissedAt so sentAt can close.
     */
    async function dismissFailedUploads(sessionRecId) {
      const id = sessionRecId || resolveActiveKey()?.id;
      if (!id) return { ok: false, reason: 'no-session' };
      const existing = await getRecord(id);
      if (!existing) return { ok: false, reason: 'no-record' };
      const meta = sessionMetaFrom(existing);
      if (!meta.emailOk) return { ok: false, reason: 'email-pending' };
      if (jobsHaveOpen(meta.sasJobs)) return { ok: false, reason: 'jobs-open' };
      if (!jobsHaveFailed(meta.sasJobs)) {
        return tryCompleteSessionById(id);
      }
      const at = new Date().toISOString();
      await patchSessionById(id, (m) => {
        m.failuresDismissedAt = at;
        for (const [jid, s] of Object.entries(m.sasJobs)) {
          if (s === 'failed') delete m.sasJobs[jid];
        }
        return m;
      });
      return tryCompleteSessionById(id);
    }

    /**
     * Session-complete = emailOk AND (all jobs completed, OR no open jobs and
     * failures dismissed/aged). Sets sentAt, hard-cap prune, clears if active.
     */
    async function tryCompleteSessionById(sessionRecId) {
      const id = sessionRecId || resolveActiveKey()?.id;
      if (!id) {
        return { complete: false, reason: 'no-session' };
      }
      const parsed = parseSessionId(id);
      if (!parsed) {
        return { complete: false, reason: 'bad-id' };
      }
      const existing = await getRecord(id);
      if (!existing) {
        return { complete: false, reason: 'no-record' };
      }
      const meta = sessionMetaFrom(existing);
      const gate = canSessionComplete(meta, Date.now());
      if (gate.already) {
        return { complete: true, already: true, sentAt: meta.sentAt, id };
      }
      if (!gate.ok) {
        return { complete: false, reason: gate.reason, sasJobs: meta.sasJobs, id };
      }

      const sentAt = new Date().toISOString();
      const arrs = arraysFromRecord(existing);
      // Drop residual failed entries once we're closing (aged/dismissed path).
      const closingJobs = { ...meta.sasJobs };
      for (const [jid, s] of Object.entries(closingJobs)) {
        if (s === 'failed') delete closingJobs[jid];
      }
      await putRecord(
        buildSessionRecord(parsed.store, parsed.date, arrs, {
          ...meta,
          sasJobs: closingJobs,
          sentAt,
        })
      );
      await enforceHardCap().catch(() => {});

      const active = resolveActiveKey();
      const isActive = active && active.id === id;
      if (!isActive) {
        return { complete: true, sentAt, cleared: false, id, reason: gate.reason };
      }
      try {
        await clearPhotos();
      } catch (err) {
        return {
          complete: true,
          sentAt,
          cleared: false,
          clearError: err && err.message ? err.message : String(err),
          id,
          reason: gate.reason,
        };
      }
      return { complete: true, sentAt, cleared: true, id, reason: gate.reason };
    }

    async function tryCompleteSession() {
      activeKey = resolveActiveKey();
      if (!activeKey) {
        return { complete: false, reason: 'no-active-session' };
      }
      return tryCompleteSessionById(activeKey.id);
    }

    /** Sessions with pending/processing jobs — for startup reconciliation. */
    async function sessionsWithOpenJobs() {
      const all = await listSessionSummaries();
      return all.filter((s) => s.hasOpenJobs && !s.sentAt);
    }

    /**
     * Close emailOk sessions whose failures aged past the eligibility window
     * (no open jobs). Safe to run on every open.
     */
    async function settleAgedFailedSessions() {
      const all = await listSessionSummaries();
      const now = Date.now();
      const settled = [];
      for (const s of all) {
        if (s.sentAt || !s.emailOk || s.hasOpenJobs || !s.hasFailedJobs) continue;
        const emailAt = s.emailOkAt ? new Date(s.emailOkAt).getTime() : NaN;
        if (!Number.isFinite(emailAt) || now - emailAt < FAILED_AFTER_EMAIL_ELIGIBLE_MS) continue;
        const result = await tryCompleteSessionById(s.id);
        if (result.complete) settled.push(result);
      }
      return settled;
    }

    async function getSessionOutboundState() {
      activeKey = resolveActiveKey();
      if (!activeKey) return null;
      const existing = await getRecord(activeKey.id);
      if (!existing) return { id: activeKey.id, ...sessionMetaFrom(null) };
      return { id: activeKey.id, ...sessionMetaFrom(existing) };
    }

    // Compatibility aliases used by existing index.html call sites
    return {
      dbName,
      dbVersion: 1,
      storeName,
      get db() { return db; },
      init,
      savePhotos,
      loadPhotos: async () => {
        // Deprecated path — callers should use loadActiveInto. Return active only.
        const tmp = emptyArrays();
        await loadActiveInto(tmp);
        return tmp;
      },
      clearPhotos,
      loadActiveInto,
      migrateFromLegacyIfNeeded,
      switchToDayConfirm,
      unsentSessions,
      quarantineSummary,
      readStorageEstimate,
      storagePressure,
      listSessionSummaries,
      resolveActiveKey,
      sessionId,
      trackSasJob,
      setSasJobStatus,
      setSessionSasJobStatus,
      markEmailOk,
      dismissFailedUploads,
      tryCompleteSession,
      tryCompleteSessionById,
      sessionsWithOpenJobs,
      settleAgedFailedSessions,
      getSessionOutboundState,
      FAILED_AFTER_EMAIL_ELIGIBLE_MS,
      FALLBACK_SOFT_BYTES,
      FALLBACK_HARD_BYTES,
      SOFT_QUOTA_FRAC,
      HARD_QUOTA_FRAC,
      LEGACY_ID,
      QUARANTINE_ID,
    };
  }

  global.EodPhotoSessions = {
    createPhotoDB,
    sessionId,
    parseSessionId,
    SCHEMA_VERSION,
    FALLBACK_SOFT_BYTES,
    FALLBACK_HARD_BYTES,
    SOFT_QUOTA_FRAC,
    HARD_QUOTA_FRAC,
    FAILED_AFTER_EMAIL_ELIGIBLE_MS,
    readStorageEstimate,
    capsFromQuota,
    LEGACY_ID,
    QUARANTINE_ID,
    PHOTO_TYPES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
