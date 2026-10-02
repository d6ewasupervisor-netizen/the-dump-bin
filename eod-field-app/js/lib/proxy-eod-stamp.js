/* Tyson-only stand-in for department and lead signatures. */
(function (global) {
  'use strict';

  const TYSON_EMAILS = new Set([
    'tyson.gauthier@retailodyssey.com',
    'd6ewa.supervisor@gmail.com',
  ]);
  const STAMP_RE = /^EOD submitted \d{2}\/\d{2}\/\d{2}$/;

  function canonicalEmail(email) {
    return String(email || '').trim().toLowerCase()
      .replace(/@retail-odyssey\.com$/, '@retailodyssey.com');
  }

  function isTysonLogin(email) {
    return TYSON_EMAILS.has(canonicalEmail(email));
  }

  function loginEmails() {
    const me = global.EodRoles?.getMe?.() || {};
    const auth = global.dumpBinAuth?.user || global.DumpBinAuth?.user || {};
    return [me.email, auth.email];
  }

  function canUse() {
    return loginEmails().some((email) => isTysonLogin(email));
  }

  function eodSubmittedStamp(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    }).formatToParts(now);
    const pick = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const month = pick('month');
    const day = pick('day');
    const year = pick('year');
    if (!month || !day || !year) return '';
    return `EOD submitted ${month}/${day}/${year}`;
  }

  function storedStamp() {
    const raw = String(global.EodSession?.state?.proxyEodStamp || '');
    return STAMP_RE.test(raw) ? raw : '';
  }

  /** Empty unless this browser is signed in as Tyson. A mirrored stamp does not bypass anyone else. */
  function activeStamp() {
    if (!canUse()) return '';
    return storedStamp();
  }

  function isActive() {
    return !!activeStamp();
  }

  function applyToSearchParams(qs) {
    if (qs && isActive()) qs.set('proxyEod', '1');
    return qs;
  }

  function toggle() {
    if (!canUse()) return '';
    const S = global.EodSession;
    if (!S?.patch) return '';
    const next = storedStamp() ? '' : eodSubmittedStamp();
    S.patch({ proxyEodStamp: next }, 'proxy-eod');
    try { S.saveDraft?.(); } catch (_) {}
    try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
    try { global.EodSend?.refreshGates?.(); } catch (_) {}
    return next;
  }

  const api = {
    isTysonLogin,
    canUse,
    eodSubmittedStamp,
    activeStamp,
    isActive,
    applyToSearchParams,
    toggle,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodProxyEod = api;
})(typeof window !== 'undefined' ? window : globalThis);
