/* Fire-and-forget usage heartbeats for the consolidated ops list. */
(function (global) {
  'use strict';

  const TOOL_ID = 'eod-field-app';
  const PAYLOAD_KEYS = new Set([
    'route', 'path', 'from', 'to', 'stage', 'status', 'kind', 'slot',
    'reason', 'count', 'online',
  ]);
  let timer = null;

  function lowPiiPayload(payload) {
    const out = {};
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (!PAYLOAD_KEYS.has(key)) return;
      if (!['string', 'number', 'boolean'].includes(typeof value)) return;
      out[key] = typeof value === 'string' ? value.slice(0, 80) : value;
    });
    out.online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    return out;
  }

  function track(event, payload) {
    const fetchFn = global.authFetch || fetch;
    fetchFn(`${global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com'}/api/usage/client-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: TOOL_ID,
        event: event || 'heartbeat',
        payload: lowPiiPayload(payload || { path: location.hash || '#/' }),
      }),
      keepalive: true,
    }).catch(() => {});
  }

  function start() {
    if (timer) return;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      track('heartbeat', { path: location.hash || '#/' });
    };
    beat();
    timer = setInterval(beat, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') beat();
    });
  }

  global.EodUsage = { track, start, lowPiiPayload };
})(typeof window !== 'undefined' ? window : globalThis);
