/* Fire-and-forget usage heartbeats for the consolidated ops list. */
(function (global) {
  'use strict';

  const TOOL_ID = 'eod-field-app';
  let timer = null;

  function track(event, payload) {
    const fetchFn = global.authFetch || fetch;
    fetchFn(`${global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com'}/api/usage/client-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: TOOL_ID,
        event: event || 'heartbeat',
        payload: payload || { path: location.hash || '#/' },
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

  global.EodUsage = { track, start };
})(typeof window !== 'undefined' ? window : globalThis);
