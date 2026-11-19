/* SAS session keep-alive beacon.
 *
 * Calls POST /api/sas-user/refresh every INTERVAL_MS so the server-side
 * SAS session for the authenticated lead stays current. The server's 4-hour
 * cooldown deduplicates calls — this is just the trigger. Silent: no toast,
 * no spinner, no user interaction.
 *
 * Primary coverage comes from the 3 AM PT pre-shift cron. This beacon is the
 * mid-shift safety net in case Railway restarted after the cron or a session
 * was invalidated early.
 */
(function (global) {
  'use strict';

  const INTERVAL_MS = 90 * 60 * 1000; // 90 minutes
  let _timer = null;
  let _started = false;

  function apiBase() {
    return global.EOD_API_BASE || '';
  }

  function leadEmail() {
    try {
      const S = global.EodSession;
      const st = S?.state || {};
      return (
        st.profileEmail
        || st.selectedShift?.visitLeadEmail
        || st.selectedShift?.leadEmail
        || global.EodRoles?.getMe?.()?.email
        || ''
      ).trim();
    } catch (_) { return ''; }
  }

  async function ping() {
    try {
      const email = leadEmail();
      const body = email ? { leadEmail: email } : {};
      const resp = await global.authFetch(`${apiBase()}/api/sas-user/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        skipBusy: true,
        body: JSON.stringify(body),
      });
      const data = resp.ok ? await resp.json().catch(() => ({})) : {};
      if (data.ok && !data.skipped) {
        console.info('[sas-beacon] session refreshed');
      }
    } catch (err) {
      console.warn('[sas-beacon] ping failed:', err.message || err);
    }
  }

  function start() {
    if (_started) return;
    _started = true;
    // First ping after 90 min; the cron covers session freshness at boot.
    _timer = setInterval(ping, INTERVAL_MS);
    console.info('[sas-beacon] started — interval', INTERVAL_MS / 60000, 'min');
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _started = false;
  }

  global.EodSasBeacon = { start, stop, ping };
})(typeof window !== 'undefined' ? window : globalThis);
