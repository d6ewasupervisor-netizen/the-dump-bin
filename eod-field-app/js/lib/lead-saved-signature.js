/* Personal lead signature copy on eod-api — Save / Load across tablets. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-lead-signature';

  async function fetchJson(url, opts) {
    if (!global.authFetch) throw new Error('Sign in required');
    const resp = await global.authFetch(url, Object.assign({ skipBusy: true }, opts || {}));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
    return data;
  }

  async function load() {
    const data = await fetchJson(API, { method: 'GET', noBounceOn401: true });
    return data.saved || null;
  }

  async function save(signatureDataUrl) {
    const data = await fetchJson(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataUrl }),
    });
    return data.saved || null;
  }

  async function remove() {
    const data = await fetchJson(API, { method: 'DELETE' });
    return !!data.deleted;
  }

  const api = { load, save, remove };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodLeadSavedSignature = api;
})(typeof window !== 'undefined' ? window : globalThis);
