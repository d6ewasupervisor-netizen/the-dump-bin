/* Single authFetch + day-confirm headers for eod-field-app. */
(function (global) {
  'use strict';

  const EOD_API_BASE = 'https://eod-api.the-dump-bin.com';
  const APP_VERSION = '3.1.10';

  function toPlainHeaders(h) {
    if (!h) return {};
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      const o = {};
      h.forEach((v, k) => { o[k] = v; });
      return o;
    }
    return Object.assign({}, h);
  }

  function applyEodVersionHeader(init) {
    const opts = Object.assign({}, init || {});
    const headers = toPlainHeaders(opts.headers);
    if (!headers['X-EOD-Version'] && !headers['x-eod-version']) {
      headers['X-EOD-Version'] = APP_VERSION;
    }
    // Plain object — dumpBinAuthFetch merges with Object.assign (Headers breaks that).
    opts.headers = headers;
    return opts;
  }

  async function authFetch(url, init) {
    const opts = applyEodVersionHeader(init);
    const pass = Object.assign({}, opts);
    // dumpBinAuthFetch understands noBounceOn401; native fetch must not see it.
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
