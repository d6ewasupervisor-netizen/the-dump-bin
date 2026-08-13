/**
 * Local/pilot auth (localhost / non–dump-bin hosts).
 *
 * IMPORTANT: Signing in on the-dump-bin.com does NOT put a JWT in localhost
 * storage — localStorage is per-origin. Use SMS PIN, paste a session JWT, or
 * request a magic link with returnTo pointing at this pilot URL (after eod-api
 * allows localhost return hosts).
 */
(function () {
  'use strict';

  var SESSION_KEY = 'dumpBinSession';
  var LEGACY_KEY = 'eodSession';
  var API_BASE = (function () {
    var hashApi = (location.hash.match(/api=([^&]+)/) || [])[1];
    if (hashApi) return decodeURIComponent(hashApi).replace(/\/+$/, '');
    return 'https://eod-api.the-dump-bin.com';
  })();

  function getSession() {
    try {
      var v = localStorage.getItem(SESSION_KEY);
      if (v) return v;
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
  function setSession(v) {
    try {
      localStorage.setItem(SESSION_KEY, v);
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
  }

  function showAuthBanner(msg) {
    function paint() {
      var el = document.getElementById('authBanner');
      if (!el) return;
      el.hidden = !msg;
      el.textContent = msg || '';
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
    else paint();
  }

  function hideSignIn() {
    var panel = document.getElementById('pilotSignIn');
    if (panel) panel.hidden = true;
    document.body.classList.remove('needs-auth');
  }

  function showSignIn(statusMsg, kind) {
    document.body.classList.add('needs-auth');
    var panel = document.getElementById('pilotSignIn');
    if (!panel) return;
    panel.hidden = false;
    var status = document.getElementById('pilotAuthStatus');
    if (status) {
      status.hidden = !statusMsg;
      status.textContent = statusMsg || '';
      status.className = 'notice ' + (kind === 'ok' ? 'notice-ok' : 'notice-error');
    }
    showAuthBanner(statusMsg || 'Sign in required for this pilot (localhost cannot reuse Dump Bin cookies).');
  }

  async function exchangeLinkToken() {
    var qp = new URLSearchParams(location.search);
    var linkToken = qp.get('token');
    if (!linkToken) return !!getSession();
    try {
      var res = await fetch(API_BASE + '/api/verify-token?token=' + encodeURIComponent(linkToken));
      var data = await res.json().catch(function () { return {}; });
      qp.delete('token');
      var newUrl = location.pathname + (qp.toString() ? ('?' + qp.toString()) : '') + location.hash;
      try { history.replaceState({}, '', newUrl); } catch (_) {}
      if (!res.ok || !data.ok || !data.token) {
        showSignIn(data.error || 'Sign-in link invalid or already used.', 'error');
        return !!getSession();
      }
      setSession(data.token);
      hideSignIn();
      showAuthBanner('');
      return true;
    } catch (err) {
      showSignIn('Could not verify sign-in link (network/CORS). Try SMS PIN below.', 'error');
      return !!getSession();
    }
  }

  function toPlainHeaders(h) {
    if (!h) return {};
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      var o = {};
      h.forEach(function (v, k) { o[k] = v; });
      return o;
    }
    return Object.assign({}, h);
  }

  async function dumpBinAuthFetch(url, opts) {
    opts = opts || {};
    var headers = toPlainHeaders(opts.headers);
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
      showSignIn('API blocked from this origin (CORS/network). If you just updated eod-api, wait for deploy — or paste a session JWT after signing in on Dump Bin.', 'error');
      throw err;
    }
    if (res.status === 401 && !opts.noBounceOn401) {
      var body = '';
      try { body = await res.clone().text(); } catch (_) {}
      if (!/sas session|rebotics session/i.test(body)) {
        clearSession();
        showSignIn('Session expired or missing. Sign in again below.', 'error');
      }
    }
    return res;
  }

  function wireSignInUi() {
    var emailEl = document.getElementById('pilotAuthEmail');
    var pinEl = document.getElementById('pilotAuthPin');
    var pasteEl = document.getElementById('pilotAuthPaste');
    if (!emailEl) return;

    document.getElementById('pilotAuthSmsBtn')?.addEventListener('click', async function () {
      var email = (emailEl.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showSignIn('Enter a valid email first.', 'error');
        return;
      }
      var btn = document.getElementById('pilotAuthSmsBtn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        var res = await fetch(API_BASE + '/api/request-sms-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) {
          showSignIn(data.error || 'Could not send text code.', 'error');
        } else {
          document.getElementById('pilotAuthPinRow').hidden = false;
          showSignIn('Text sent to ' + (data.maskedPhone || 'your phone') + '. Enter the 6-digit PIN.', 'ok');
          pinEl.focus();
        }
      } catch (err) {
        showSignIn('Network/CORS error requesting SMS. eod-api must allow localhost origins — deploy pending or use Paste JWT.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Text me a PIN';
      }
    });

    document.getElementById('pilotAuthVerifyBtn')?.addEventListener('click', async function () {
      var email = (emailEl.value || '').trim().toLowerCase();
      var code = (pinEl.value || '').trim();
      if (!/^\d{6}$/.test(code)) {
        showSignIn('Enter the 6-digit code from your text.', 'error');
        return;
      }
      var btn = document.getElementById('pilotAuthVerifyBtn');
      btn.disabled = true;
      try {
        var res = await fetch(API_BASE + '/api/verify-sms-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, code: code }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok || !data.token) {
          showSignIn(data.error || 'Could not verify code.', 'error');
          return;
        }
        setSession(data.token);
        hideSignIn();
        showAuthBanner('');
        location.reload();
      } catch (err) {
        showSignIn('Network/CORS error verifying PIN.', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('pilotAuthEmailBtn')?.addEventListener('click', async function () {
      var email = (emailEl.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showSignIn('Enter a valid email first.', 'error');
        return;
      }
      var returnTo = location.origin + location.pathname + (location.search || '') + (location.hash || '');
      // Strip existing token= if any
      try {
        var u = new URL(returnTo);
        u.searchParams.delete('token');
        returnTo = u.toString();
      } catch (_) {}
      var btn = document.getElementById('pilotAuthEmailBtn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        var res = await fetch(API_BASE + '/api/request-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, returnTo: returnTo }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) {
          showSignIn(data.error || 'Could not send email link. Try SMS or Paste JWT.', 'error');
        } else {
          showSignIn('Check email — open the link (it should return to this pilot URL).', 'ok');
        }
      } catch (err) {
        showSignIn('Network/CORS error requesting email link. Use SMS or Paste JWT.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Email me a link';
      }
    });

    document.getElementById('pilotAuthPasteBtn')?.addEventListener('click', async function () {
      var raw = (pasteEl.value || '').trim();
      if (!raw) {
        showSignIn('Paste a session JWT or a magic-link token.', 'error');
        return;
      }
      // Full URL with ?token=
      var linkTok = null;
      try {
        if (/^https?:/i.test(raw) || raw.indexOf('token=') >= 0) {
          var u = new URL(raw, location.origin);
          linkTok = u.searchParams.get('token');
          if (!linkTok && u.searchParams.get('to')) {
            var inner = new URL(u.searchParams.get('to'));
            linkTok = inner.searchParams.get('token');
          }
        }
      } catch (_) {}
      if (linkTok) {
        try {
          var res = await fetch(API_BASE + '/api/verify-token?token=' + encodeURIComponent(linkTok));
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok || !data.ok || !data.token) {
            showSignIn(data.error || 'Link token invalid.', 'error');
            return;
          }
          setSession(data.token);
          hideSignIn();
          location.reload();
          return;
        } catch (err) {
          showSignIn('Could not exchange link token (CORS/network).', 'error');
          return;
        }
      }
      // Assume long-lived session JWT (three segments)
      if (raw.split('.').length >= 3) {
        setSession(raw);
        // Quick validate
        try {
          var me = await dumpBinAuthFetch(API_BASE + '/api/me', { noBounceOn401: true });
          if (!me.ok) {
            clearSession();
            showSignIn('That JWT was rejected by /api/me (' + me.status + '). Copy dumpBinSession from Dump Bin DevTools while signed in.', 'error');
            return;
          }
        } catch (_) {
          // CORS may block; still keep JWT for after CORS deploy
        }
        hideSignIn();
        location.reload();
        return;
      }
      showSignIn('Paste either a JWT (eyJ…) or a full magic-link URL containing token=.', 'error');
    });

    document.getElementById('pilotAuthSignOut')?.addEventListener('click', function () {
      clearSession();
      showSignIn('Signed out.', 'ok');
    });
  }

  window.dumpBinAuthFetch = dumpBinAuthFetch;
  window.dumpBinGetSession = getSession;
  window.dumpBinClearSession = clearSession;
  window.DUMP_BIN_API_BASE = API_BASE;
  window.EodPilotAuth = { showSignIn: showSignIn, hideSignIn: hideSignIn, getSession: getSession };

  function boot() {
    wireSignInUi();
    exchangeLinkToken().then(function (ok) {
      if (ok) {
        hideSignIn();
        showAuthBanner('');
      } else {
        showSignIn(
          'localhost cannot see Dump Bin login. Use Text PIN, email link (returns here), or paste dumpBinSession from DevTools.',
          'error'
        );
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
