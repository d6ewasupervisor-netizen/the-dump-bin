/* Single authFetch + day-confirm headers for eod-field-app. */
(function (global) {
  'use strict';

  const EOD_API_BASE = 'https://eod-api.the-dump-bin.com';
  const APP_VERSION = '3.0.0-pilot';

  function applyEodVersionHeader(init) {
    const opts = Object.assign({}, init || {});
    const headers = new Headers(opts.headers || {});
    if (!headers.has('X-EOD-Version')) headers.set('X-EOD-Version', APP_VERSION);
    opts.headers = headers;
    return opts;
  }

  async function authFetch(url, init) {
    const opts = applyEodVersionHeader(init);
    if (typeof global.dumpBinAuthFetch === 'function') {
      return global.dumpBinAuthFetch(url, opts);
    }
    return fetch(url, opts);
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
