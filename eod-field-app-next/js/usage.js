/* Fire-and-forget usage heartbeats for the consolidated ops list. */
(function (global) {
  'use strict';

  const TOOL_ID = 'eod-field-app';
  const PAYLOAD_KEYS = new Set([
    'route', 'path', 'from', 'to', 'stage', 'status', 'kind', 'slot',
    'reason', 'count', 'online',
    /* One-per-session device shape (no identifiers): viewport, platform family,
       pixel ratio, PWA-vs-tab and app version. Feeds the mobile baseline. */
    'vw', 'vh', 'dpr', 'platform', 'pwa', 'ver',
  ]);
  let booted = false;

  function platformFamily() {
    try {
      const ua = navigator.userAgent || '';
      const iPadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
      if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return 'ios';
      if (/Android/i.test(ua)) return 'android';
      if (/Windows/i.test(ua)) return 'windows';
      if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
      if (/CrOS/i.test(ua)) return 'chromeos';
      if (/Linux/i.test(ua)) return 'linux';
      return 'other';
    } catch (_) { return 'other'; }
  }

  function isStandalone() {
    try {
      if (navigator.standalone === true) return true;
      return !!(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
    } catch (_) { return false; }
  }

  /* One event per app session, so "what phones do the leads use" is answerable
     without a user-agent string or any identifier. */
  function trackSessionDevice() {
    if (booted) return;
    booted = true;
    track('session_start', {
      kind: 'device',
      vw: Math.round(global.innerWidth || 0),
      vh: Math.round(global.innerHeight || 0),
      dpr: Math.round((global.devicePixelRatio || 1) * 100) / 100,
      platform: platformFamily(),
      pwa: isStandalone() ? 'standalone' : 'browser',
      ver: String(global.EOD_APP_VERSION || ''),
      path: location.hash || '#/',
    });
  }
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
    trackSessionDevice();
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

  global.EodUsage = { track, start, lowPiiPayload, trackSessionDevice, platformFamily };
})(typeof window !== 'undefined' ? window : globalThis);
