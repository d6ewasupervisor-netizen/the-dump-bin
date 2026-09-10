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

    async function peek(statusUrl) {
      const url = new URL(statusUrl, API_ORIGIN).href;
      const response = await runtime.authFetch(url, { skipBusy: true });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Job status failed (${response.status})`);
      return data.job || data;
    }

    async function poll(statusUrl, { timeoutMs = 8 * 60 * 1000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let delayMs = 1000;
      let lastError = null;
      while (Date.now() < deadline) {
        try {
          const job = await peek(statusUrl);
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
      statusUrl,
    } = {}) {
      if (statusUrl) {
        try {
          const existing = await poll(statusUrl, { timeoutMs: Math.min(timeoutMs || 8 * 60 * 1000, 15000) });
          return existing;
        } catch (_) { /* resubmit */ }
      }
      const requestHeaders = Object.assign({}, headers || {});
      if (allowAsync) {
        requestHeaders.Prefer = 'respond-async';
        requestHeaders['Idempotency-Key'] = idempotencyKey;
      }
      const response = await runtime.authFetch(`${FIELD_SET_API}/${path}`, {
        method: 'POST',
        headers: requestHeaders,
        body,
        skipBusy: true,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.result) {
        throw new Error(data.error || `Field-set request failed (${response.status})`);
      }
      if (response.status === 202 && data.statusUrl) {
        const result = await poll(data.statusUrl, { timeoutMs });
        return Object.assign({ jobId: data.jobId, statusUrl: data.statusUrl }, result || {});
      }
      return data.result || data;
    }

    async function submitBinary(path, opts = {}) {
      const {
        body,
        headers,
        blob,
        checksum,
        job,
        idempotencyKey,
        timeoutMs,
        allowAsync = true,
      } = opts;
      if (job?.statusUrl) {
        try {
          const existing = await peek(job.statusUrl);
          if (existing.status === 'completed') {
            return Object.assign({
              jobId: job.serverJobId || existing.id,
              statusUrl: job.statusUrl,
              result: existing.result,
              accepted: false,
            }, existing.result || {});
          }
          if (['pending', 'retry', 'processing'].includes(existing.status)) {
            return {
              jobId: job.serverJobId || existing.id,
              statusUrl: job.statusUrl,
              accepted: true,
            };
          }
        } catch (_) { /* resubmit */ }
      }
      if (blob && checksum) {
        const meta = typeof body === 'string' ? JSON.parse(body) : (body || {});
        delete meta.photoBase64;
        const requestHeaders = Object.assign({}, headers || {}, {
          'Content-Type': blob.type || 'image/jpeg',
          'X-Photo-Checksum': checksum,
          'X-Photo-Meta': JSON.stringify(meta),
        });
        delete requestHeaders['Content-Type'];
        requestHeaders['Content-Type'] = blob.type || 'image/jpeg';
        if (allowAsync) {
          requestHeaders.Prefer = 'respond-async';
          requestHeaders['Idempotency-Key'] = idempotencyKey;
        }
        const response = await runtime.authFetch(`${FIELD_SET_API}/photo-bin`, {
          method: 'POST',
          headers: requestHeaders,
          body: blob,
          skipBusy: true,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !data.result) {
          throw new Error(data.error || `Binary photo upload failed (${response.status})`);
        }
        if (response.status === 202 && data.statusUrl) {
          if (opts.waitForResult === false) {
            return { jobId: data.jobId, statusUrl: data.statusUrl, accepted: true };
          }
          const result = await poll(data.statusUrl, { timeoutMs });
          return { jobId: data.jobId, statusUrl: data.statusUrl, result };
        }
        return { jobId: data.jobId || null, statusUrl: data.statusUrl || null, result: data.result || data };
      }
      const accepted = await submit(path, opts);
      return accepted?.result ? accepted : { result: accepted, jobId: accepted?.jobId, statusUrl: accepted?.statusUrl };
    }

    return { operationKey, hashText, peek, poll, submit, submitBinary };
  }

  const api = createClient(global);
  api.createClient = createClient;
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodFieldSetJobs = api;
})(typeof window !== 'undefined' ? window : globalThis);
