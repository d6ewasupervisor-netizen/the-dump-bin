/*
 * the-dump-bin.com — site-wide auth gate
 * --------------------------------------
 * Replaces the old Cloudflare Access cookie that used to protect every page.
 * Every gated HTML page in this repo loads this script as the very first
 * thing in <head>. The flow is:
 *
 *   1. signin.html collects the user's email and asks eod-api to mail them
 *      a one-shot magic link (POST /api/request-link).
 *   2. The email links to https://the-dump-bin.com/?token=<single-use-jwt>
 *      (or any other gated page with ?token=).
 *   3. This script swaps the link token for a long-lived session JWT via
 *      GET /api/verify-token and stores it in localStorage.dumpBinSession.
 *   4. window.dumpBinAuthFetch() sends `Authorization: Bearer <jwt>` on
 *      every API call. A 401 wipes the stored token and bounces the user
 *      back to signin.html (unless the caller opts out, e.g. EOD's red-dot
 *      logic for downstream SAS-session 401s).
 *
 * Public (un-gated) pages: signin.html, admin.html, open-sign-in.html. Everything else under
 * the-dump-bin.com requires a session.
 */
(function () {
  'use strict';

  var SESSION_KEY = 'dumpBinSession';
  var LEGACY_KEY  = 'eodSession'; // pre-rename; auto-migrated on first read
  var CHECKLANES_ENTRY_KEY = 'dumpBinChecklanesEntry';
  var SIGNIN_PATH = '/signin.html';
  var ADMIN_PATH  = '/admin.html';
  var OPEN_SIGNIN_PATH = '/open-sign-in.html';

  // Public paths that MUST stay reachable without a session. Anything else
  // is gated. The /admin.html flow has its own login UI (admin password,
  // not the user magic-link), so we leave it un-gated here.
  var PUBLIC_PATHS = [SIGNIN_PATH, ADMIN_PATH, OPEN_SIGNIN_PATH];

  // Resolve the API base the same way signin.html / admin.html do.
  // Override locally with #api=http://localhost:3001 for dev.
  var API_BASE = (function () {
    var hashApi = (location.hash.match(/api=([^&]+)/) || [])[1];
    if (hashApi) return decodeURIComponent(hashApi).replace(/\/+$/, '');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    return 'https://eod-api.the-dump-bin.com';
  })();

  function getSession() {
    try {
      var v = localStorage.getItem(SESSION_KEY);
      if (v) return v;
      // Migrate the older EOD-only key once.
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        try {
          localStorage.setItem(SESSION_KEY, legacy);
          localStorage.removeItem(LEGACY_KEY);
        } catch (_) {}
        return legacy;
      }
    } catch (_) {}
    return '';
  }
  function setSession(v) { try { localStorage.setItem(SESSION_KEY, v); } catch (_) {} }
  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
  }

  function currentPathname() {
    var p = (location.pathname || '/').toLowerCase();
    // Treat "/foo/" the same as "/foo/index.html" for matching.
    return p;
  }
  function isPublicPath() {
    var p = currentPathname();
    for (var i = 0; i < PUBLIC_PATHS.length; i++) {
      if (p === PUBLIC_PATHS[i].toLowerCase()) return true;
    }
    return false;
  }

  function isChecklanesPath() {
    var p = currentPathname();
    return p === '/checklanes' || p === '/checklanes/' || p.indexOf('/checklanes/') === 0;
  }

  function isHubHomeReferrer() {
    try {
      var ref = document.referrer;
      if (!ref) return false;
      var u = new URL(ref);
      if (u.hostname !== location.hostname) return false;
      var path = (u.pathname || '/').toLowerCase();
      return path === '/' || path === '/index.html';
    } catch (_) {
      return false;
    }
  }

  function markDirectChecklanesEntry() {
    try { localStorage.setItem(CHECKLANES_ENTRY_KEY, '1'); } catch (_) {}
  }

  function noteDirectChecklanesEntryIfNeeded() {
    if (isChecklanesPath() && !isHubHomeReferrer()) {
      markDirectChecklanesEntry();
    }
  }

  function bounceToSignIn(reason) {
    revealPage();
    clearSession();
    if (isPublicPath()) return;
    if (isChecklanesPath()) markDirectChecklanesEntry();
    try { console.warn('[auth-gate] redirect to signin:', reason || ''); } catch (_) {}
    var next = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(SIGNIN_PATH + '?next=' + next);
  }

  // Hide the page body while we're settling auth. Without this, a magic-link
  // arrival (?token=) flashes the un-gated page content for a beat while the
  // exchange roundtrips. Removed once the exchange completes or the redirect
  // fires.
  var _hideStyle = null;
  function hidePage() {
    if (_hideStyle) return;
    _hideStyle = document.createElement('style');
    _hideStyle.id = '__dumpbin_auth_gate_hide';
    _hideStyle.textContent = 'html, body { visibility: hidden !important; }';
    (document.head || document.documentElement).appendChild(_hideStyle);
  }
  function revealPage() {
    if (_hideStyle && _hideStyle.parentNode) {
      _hideStyle.parentNode.removeChild(_hideStyle);
    }
    _hideStyle = null;
  }

  async function exchangeLinkToken() {
    var qp = new URLSearchParams(location.search);
    var linkToken = qp.get('token');
    if (!linkToken) return !!getSession();

    hidePage();
    try {
      var res = await fetch(API_BASE + '/api/verify-token?token=' + encodeURIComponent(linkToken));
      var data = await res.json().catch(function () { return {}; });
      // Always strip the token from the URL so a refresh can't replay it.
      qp.delete('token');
      var newUrl = location.pathname + (qp.toString() ? ('?' + qp.toString()) : '') + location.hash;
      try { history.replaceState({}, '', newUrl); } catch (_) {}

      if (!res.ok || !data.ok || !data.token) {
        try { sessionStorage.setItem('dumpBinSignInError', (data && data.error) || 'This sign-in link is invalid or has been used.'); } catch (_) {}
        return !!getSession();
      }
      setSession(data.token);
      return true;
    } catch (err) {
      try { console.warn('[auth-gate] verify-token failed:', err && err.message); } catch (_) {}
      return !!getSession();
    }
  }

  // dumpBinAuthFetch: Bearer-fortified fetch.
  //
  // Options accepted on top of the standard fetch RequestInit:
  //   noBounceOn401 — don't redirect on a 401. The caller will handle it
  //                   (used by EOD/index.html for SAS-session 401s).
  //
  // String URLs that start with "/api/" are resolved against API_BASE so
  // callers can write `dumpBinAuthFetch('/api/me')` without thinking about
  // the cross-origin Railway hostname.
  async function authFetch(url, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var tok = getSession();
    if (tok) headers.Authorization = 'Bearer ' + tok;

    var fullUrl = url;
    if (typeof url === 'string' && url.indexOf('/api/') === 0) {
      fullUrl = API_BASE + url;
    }

    var passThru = Object.assign({}, opts);
    delete passThru.noBounceOn401;
    passThru.headers = headers;

    var res;
    try {
      res = await fetch(fullUrl, passThru);
    } catch (err) {
      throw err;
    }

    if (res.status === 401 && !opts.noBounceOn401) {
      var body = '';
      try { body = await res.clone().text(); } catch (_) {}
      // Leave downstream-auth 401s (SAS / Rebotics tokens etc.) to the
      // caller. Our own session 401s wipe state and force re-sign-in.
      if (!/sas session|rebotics session/i.test(body)) {
        bounceToSignIn('401 from ' + url);
      }
    }
    return res;
  }

  function signOut() {
    clearSession();
    location.assign(SIGNIN_PATH);
  }

  // ── Signed-in-as badge ────────────────────────────────────────────────
  //
  // Site-wide "Signed in as <email> / Log out" bar injected at the very top
  // of every gated page once boot() confirms a valid session. Decodes the
  // email straight out of the session JWT payload (display only — the
  // server independently verifies the token on every API call), so this
  // needs no extra network round trip.
  function decodeEmailFromToken(token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length < 2) return '';
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var json = new TextDecoder('utf-8').decode(bytes);
      var payload = JSON.parse(json);
      return (payload && payload.email) || '';
    } catch (_) {
      return '';
    }
  }

  function injectUserBadge(email) {
    if (!email || document.getElementById('__dumpbin_user_badge')) return;

    var bar = document.createElement('div');
    bar.id = '__dumpbin_user_badge';
    bar.setAttribute('style', [
      'display:flex', 'align-items:center', 'justify-content:flex-end',
      'flex-wrap:wrap', 'gap:10px', 'padding:6px 14px',
      'background:#141c27', 'border-bottom:1px solid #2f4562',
      'font-family:"Segoe UI",system-ui,-apple-system,sans-serif',
      'font-size:12px', 'line-height:1.4', 'color:#8fa3b8',
      'position:relative', 'z-index:1000',
    ].join(';'));

    var label = document.createElement('span');
    label.appendChild(document.createTextNode('Signed in as '));
    var emailEl = document.createElement('strong');
    emailEl.setAttribute('style', 'color:#e8ecf1;font-weight:600;word-break:break-all;');
    emailEl.textContent = email;
    label.appendChild(emailEl);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Log out';
    btn.setAttribute('style', [
      'padding:4px 12px', 'border-radius:6px', 'border:1px solid #2f4562',
      'background:#2a3a4e', 'color:#e8ecf1', 'font-size:12px',
      'font-weight:600', 'font-family:inherit', 'cursor:pointer',
    ].join(';'));
    btn.addEventListener('click', signOut);

    bar.appendChild(label);
    bar.appendChild(btn);

    function place() {
      if (document.body.firstChild) {
        document.body.insertBefore(bar, document.body.firstChild);
      } else {
        document.body.appendChild(bar);
      }
    }
    if (document.body) place();
    else document.addEventListener('DOMContentLoaded', place);
  }

  // ── Boot guard ────────────────────────────────────────────────────────
  //
  // 1. Public pages (signin/admin) don't run the gate — they have their
  //    own UI for collecting credentials.
  // 2. If a ?token= is present, swap it for a session JWT. Hide the page
  //    until the exchange finishes so the user doesn't see a flash.
  // 3. Otherwise: if we have a session, do nothing and let the page
  //    render. If we don't, redirect to signin.html before anything
  //    sensitive can render.
  //
  // bootPromise settles when this gate finishes (success path or bounce).
  // Nested apps await dumpBinAuth.bootPromise before their own boot logic.
  var bootPromise = (async function boot() {
    if (isPublicPath()) {
      revealPage();
      return;
    }

    var qp = new URLSearchParams(location.search);
    var hasToken = !!qp.get('token');
    var hadSession = !!getSession();

    if (!hadSession && !hasToken) {
      // Fast path: no token, no session — bounce before any render.
      hidePage();
      bounceToSignIn('no session and no ?token=');
      return;
    }

    if (hasToken) {
      hidePage();
      var ok = await exchangeLinkToken();
      if (!ok) {
        bounceToSignIn('verify-token did not produce a session');
        return;
      }
    }
    noteDirectChecklanesEntryIfNeeded();
    injectUserBadge(decodeEmailFromToken(getSession()));
    revealPage();
  })();

  window.dumpBinAuth = {
    API_BASE: API_BASE,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    signOut: signOut,
    fetch: authFetch,
    bounceToSignIn: bounceToSignIn,
    bootPromise: bootPromise,
  };
  window.dumpBinAuthFetch = authFetch;
  window.dumpBinSignOut   = signOut;
  window.dumpBinAuthReady = bootPromise;
})();
