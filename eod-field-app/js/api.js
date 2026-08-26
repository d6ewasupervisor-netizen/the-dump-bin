/* Single authFetch + day-confirm headers + storage telemetry for eod-field-app. */
(function (global) {
  'use strict';

  const EOD_API_BASE = 'https://eod-api.the-dump-bin.com';
  const APP_VERSION = '3.3.2';

  let eodStorageTelemetry = {
    quota: null,
    usage: null,
    photoBytes: null,
    displayMode: null,
    persisted: null,
    at: 0,
  };

  function toPlainHeaders(h) {
    if (!h) return {};
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      const o = {};
      h.forEach((v, k) => { o[k] = v; });
      return o;
    }
    return Object.assign({}, h);
  }

  function eodDisplayMode() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        return 'standalone';
      }
      if (typeof navigator !== 'undefined' && navigator.standalone === true) {
        return 'standalone';
      }
    } catch (_) { /* ignore */ }
    return 'browser';
  }

  async function ensurePersistentStorage() {
    try {
      if (!navigator.storage) return null;
      if (typeof navigator.storage.persisted === 'function') {
        const already = await navigator.storage.persisted();
        if (already) {
          eodStorageTelemetry.persisted = true;
          return true;
        }
      }
      if (typeof navigator.storage.persist === 'function') {
        const ok = await navigator.storage.persist();
        eodStorageTelemetry.persisted = !!ok;
        return ok;
      }
    } catch (_) { /* Safari / private mode */ }
    return null;
  }

  async function refreshEodStorageTelemetry(force) {
    const now = Date.now();
    if (!force && eodStorageTelemetry.at && now - eodStorageTelemetry.at < 60 * 1000) {
      return eodStorageTelemetry;
    }
    try {
      if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        if (est) {
          if (Number.isFinite(est.quota)) eodStorageTelemetry.quota = Math.floor(est.quota);
          if (Number.isFinite(est.usage)) eodStorageTelemetry.usage = Math.floor(est.usage);
        }
      }
      if (navigator.storage && typeof navigator.storage.persisted === 'function') {
        eodStorageTelemetry.persisted = await navigator.storage.persisted();
      }
    } catch (_) { /* ignore */ }
    eodStorageTelemetry.displayMode = eodDisplayMode();
    try {
      if (global.PhotoDB?.listSessionSummaries) {
        const sessions = await global.PhotoDB.listSessionSummaries();
        eodStorageTelemetry.photoBytes = (sessions || []).reduce((a, s) => a + (s.bytes || 0), 0);
      } else if (global.PhotoDB?.readStorageEstimate) {
        const est = await global.PhotoDB.readStorageEstimate(!!force);
        if (est && Number.isFinite(est.usage)) eodStorageTelemetry.photoBytes = est.usage;
      }
    } catch (_) { /* ignore */ }
    eodStorageTelemetry.at = now;
    return eodStorageTelemetry;
  }

  function applyStorageHeaders(headers) {
    const t = eodStorageTelemetry;
    if (t.quota != null && !headers['X-EOD-Storage-Quota'] && !headers['x-eod-storage-quota']) {
      headers['X-EOD-Storage-Quota'] = String(t.quota);
    }
    if (t.usage != null && !headers['X-EOD-Storage-Usage'] && !headers['x-eod-storage-usage']) {
      headers['X-EOD-Storage-Usage'] = String(t.usage);
    }
    if (t.photoBytes != null && !headers['X-EOD-Photo-Bytes'] && !headers['x-eod-photo-bytes']) {
      headers['X-EOD-Photo-Bytes'] = String(t.photoBytes);
    }
    if (t.displayMode && !headers['X-EOD-Display-Mode'] && !headers['x-eod-display-mode']) {
      headers['X-EOD-Display-Mode'] = t.displayMode;
    }
    if (t.persisted != null && !headers['X-EOD-Storage-Persisted'] && !headers['x-eod-storage-persisted']) {
      headers['X-EOD-Storage-Persisted'] = t.persisted ? '1' : '0';
    }
    return headers;
  }

  function applyEodVersionHeader(init) {
    const opts = Object.assign({}, init || {});
    const headers = toPlainHeaders(opts.headers);
    if (!headers['X-EOD-Version'] && !headers['x-eod-version']) {
      headers['X-EOD-Version'] = APP_VERSION;
    }
    applyStorageHeaders(headers);
    opts.headers = headers;
    return opts;
  }

  async function authFetch(url, init) {
    const opts = applyEodVersionHeader(init);
    const pass = Object.assign({}, opts);
    void refreshEodStorageTelemetry(false);
    if (typeof global.dumpBinAuthFetch === 'function') {
      return global.dumpBinAuthFetch(url, pass);
    }
    delete pass.noBounceOn401;
    return fetch(url, pass);
  }

  function dayConfirmHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    try {
      const stored = JSON.parse(localStorage.getItem('kompassDayConfirm') || 'null');
      if (stored?.token) headers['X-Day-Confirm'] = stored.token;
    } catch (_) { /* ignore */ }
    return headers;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.EOD_API_BASE = EOD_API_BASE;
  global.EOD_APP_VERSION = APP_VERSION;
  global.applyEodVersionHeader = applyEodVersionHeader;
  global.authFetch = authFetch;
  global.EodApi = {
    base: EOD_API_BASE,
    version: APP_VERSION,
    authFetch,
    dayConfirmHeaders,
    escapeHtml,
    applyEodVersionHeader,
    ensurePersistentStorage,
    refreshEodStorageTelemetry,
  };
})(typeof window !== 'undefined' ? window : globalThis);
