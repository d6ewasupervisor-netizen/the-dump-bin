/* Single authFetch + day-confirm headers + storage telemetry for eod-field-app. */
(function (global) {
  'use strict';

  const EOD_API_BASE = 'https://eod-api.the-dump-bin.com';
  const APP_VERSION = '3.4.71';

  let eodStorageTelemetry = {
    quota: null,
    usage: null,
    photoBytes: null,
    cacheBytes: null,
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
      if (global.EodSetMediaCache?.measureBytes) {
        const cache = await global.EodSetMediaCache.measureBytes();
        if (cache && Number.isFinite(cache.bytes)) eodStorageTelemetry.cacheBytes = cache.bytes;
      } else if (global.PhotoDB?.storagePressure) {
        const p = await global.PhotoDB.storagePressure();
        if (p && Number.isFinite(p.cacheBytes)) eodStorageTelemetry.cacheBytes = p.cacheBytes;
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
    if (t.cacheBytes != null && !headers['X-EOD-Cache-Bytes'] && !headers['x-eod-cache-bytes']) {
      headers['X-EOD-Cache-Bytes'] = String(t.cacheBytes);
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

  /* Nothing in the app used to bound a request. One socket that opened and
     then stalled - the usual dying-signal case in a back aisle - wedged the
     upload queue for the rest of the shift with no way out. Every call now
     inherits a ceiling unless it brings its own signal or timeoutMs. */
  const READ_TIMEOUT_MS = 30000;
  const WRITE_TIMEOUT_MS = 180000;

  function timeoutFor(init) {
    const explicit = Number(init && init.timeoutMs);
    if (Number.isFinite(explicit)) return explicit;
    const method = String((init && init.method) || 'GET').toUpperCase();
    return method === 'GET' || method === 'HEAD' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
  }

  async function authFetch(url, init) {
    const opts = applyEodVersionHeader(init);
    const pass = Object.assign({}, opts);
    void refreshEodStorageTelemetry(false);
    const ms = timeoutFor(pass);
    delete pass.timeoutMs;

    let timer = null;
    if (ms > 0 && !pass.signal && typeof AbortController === 'function') {
      const ctrl = new AbortController();
      pass.signal = ctrl.signal;
      timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, ms);
    }

    /* The timer is deliberately NOT cleared on success. fetch settles as soon
       as headers arrive, so clearing here would leave every `await resp.json()`
       unprotected - a server that sends headers and then stalls mid-body is
       the same hang this ceiling exists to stop. Leaving it armed keeps the
       body read covered; aborting an already-finished request is a no-op. */
    try {
      if (typeof global.dumpBinAuthFetch === 'function') {
        return await global.dumpBinAuthFetch(url, pass);
      }
      delete pass.noBounceOn401;
      return await fetch(url, pass);
    } catch (err) {
      if (timer) clearTimeout(timer);
      // Only our own timer produces a timeout. A caller-supplied signal keeps
      // its AbortError so cancellation still reads as cancellation.
      if (timer && err && err.name === 'AbortError') {
        // Wording matters: the pipeline's transient-retry test matches /timeout/i.
        const e = new Error(`Request timeout after ${Math.round(ms / 1000)}s`);
        e.name = 'TimeoutError';
        e.timeout = true;
        throw e;
      }
      throw err;
    }
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


