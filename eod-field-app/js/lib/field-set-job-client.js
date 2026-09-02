/* Durable field-set API client: submit once, then poll the server-owned job. */
(function (global) {
  'use strict';

  const API_ORIGIN = 'https://eod-api.the-dump-bin.com';
  const FIELD_SET_API = `${API_ORIGIN}/api/field-set`;

  function createClient(runtime, options) {
    const opts = options || {};
    const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    function operationKey(scope, value) {
      const clean = String(value || '')
        .replace(/[^A-Za-z0-9._:-]/g, '-')
        .slice(0, 160);
      return `eod-${scope}:${clean || Date.now().toString(36)}`;
    }

    function hashText(value) {
      let hash = 2166136261;
      const text = String(value || '');
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    async function poll(statusUrl, { timeoutMs = 8 * 60 * 1000 } = {}) {
      const url = new URL(statusUrl, API_ORIGIN).href;
      const deadline = Date.now() + timeoutMs;
      let delayMs = 1000;
      let lastError = null;
      while (Date.now() < deadline) {
        try {
          const response = await runtime.authFetch(url, { skipBusy: true });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || `Job status failed (${response.status})`);
          const job = data.job || data;
          if (job.status === 'completed') return job.result;
          if (job.status === 'failed') {
            const err = new Error(job.error || 'Field-set job failed');
            err.terminal = true;
            throw err;
          }
          lastError = null;
        } catch (err) {
          if (err?.terminal) throw err;
          lastError = err;
        }
        await sleep(delayMs);
        delayMs = Math.min(5000, Math.round(delayMs * 1.5));
      }
      throw new Error(lastError?.message || 'Field-set job is still processing. Try again shortly.');
    }

    async function submit(path, {
      body,
      headers,
      idempotencyKey,
      timeoutMs,
      allowAsync = true,
    } = {}) {
      const requestHeaders = Object.assign({}, headers || {});
      if (allowAsync) {
        requestHeaders.Prefer = 'respond-async';
        requestHeaders['Idempotency-Key'] = idempotencyKey;
      }
      const response = await runtime.authFetch(`${FIELD_SET_API}/${path}`, {
        method: 'POST',
        headers: requestHeaders,
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.result) {
        throw new Error(data.error || `Field-set request failed (${response.status})`);
      }
      if (response.status === 202 && data.statusUrl) {
        return poll(data.statusUrl, { timeoutMs });
      }
      return data.result || data;
    }

    return { operationKey, hashText, poll, submit };
  }

  const api = createClient(global);
  api.createClient = createClient;
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodFieldSetJobs = api;
})(typeof window !== 'undefined' ? window : globalThis);
