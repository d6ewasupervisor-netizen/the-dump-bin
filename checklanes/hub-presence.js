(function (global) {
  'use strict';

  var SESSION_KEY = 'clPresenceSession';
  var HEARTBEAT_MS = 20000;
  var sessionId = null;
  var metaFn = function () { return { page: 'unknown' }; };
  var timer = null;
  var started = false;
  var pollTimers = {};

  function apiFetch(path, options) {
    var fn = global.dumpBinAuthFetch || global.fetch;
    return fn('/api/hub' + path, options || {});
  }

  function getSessionId() {
    if (sessionId) return sessionId;
    try {
      sessionId = sessionStorage.getItem(SESSION_KEY);
    } catch (_) {}
    if (!sessionId) {
      sessionId = (global.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch (_) {}
    }
    return sessionId;
  }

  function buildPayload(extra) {
    var meta = metaFn() || {};
    return Object.assign({
      sessionId: getSessionId(),
      page: meta.page || 'unknown',
      storeNumber: meta.storeNumber || null,
      visitId: meta.visitId || null,
      view: meta.view || null,
      detail: meta.detail || null,
    }, extra || {});
  }

  function ping(extra) {
    if (!started) return Promise.resolve();
    return apiFetch('/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(extra)),
      noBounceOn401: true,
    }).catch(function () {});
  }

  function leave() {
    if (!sessionId) return;
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon('/api/hub/presence?sessionId=' + encodeURIComponent(sessionId));
        return;
      } catch (_) {}
    }
    apiFetch('/presence?sessionId=' + encodeURIComponent(sessionId), {
      method: 'DELETE',
      noBounceOn401: true,
    }).catch(function () {});
  }

  function start() {
    if (started) return;
    started = true;
    ping();
    timer = setInterval(ping, HEARTBEAT_MS);
    global.addEventListener('pagehide', leave);
    global.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') ping();
    });
  }

  function normalizeStoreNumber(value) {
    if (value == null || value === '') return '';
    var digits = String(value).replace(/\D/g, '');
    if (!digits) return '';
    var n = Number(digits);
    return Number.isFinite(n) ? String(n) : digits.replace(/^0+/, '') || '0';
  }

  function sameStore(a, b) {
    return normalizeStoreNumber(a) === normalizeStoreNumber(b);
  }

  function filterSessions(sessions, options) {
    options = options || {};
    var currentEmail = (options.currentEmail || '').toLowerCase();
    var storeNumber = options.storeNumber != null ? normalizeStoreNumber(options.storeNumber) : null;
    var hubOnly = !!options.hubOnly;

    return (sessions || []).filter(function (session) {
      if (currentEmail && (session.email || '').toLowerCase() === currentEmail) return false;
      if (hubOnly && session.page !== 'hub') return false;
      if (storeNumber && !sameStore(session.storeNumber, storeNumber)) return false;
      return true;
    });
  }

  function locationLabel(session) {
    if (!session) return '';
    if (session.page === 'store-picker') return 'Store picker';
    if (session.page !== 'hub') return session.page;

    var parts = [];
    if (session.storeName) parts.push(session.storeName);
    else if (session.storeNumber) parts.push('Store ' + String(session.storeNumber).padStart(5, '0'));
    if (session.view && session.view !== 'assignments') parts.push(session.view);
    if (session.detail) parts.push(session.detail);
    else if (session.view === 'assignments') parts.push('Assignments');
    else if (!parts.length) parts.push('Reset Hub');
    return parts.join(' · ');
  }

  function hubSessionWhereLabel(session) {
    if (!session) return '';
    if (session.detail) return session.detail;
    if (session.view === 'assignments') return 'Assignments';
    if (session.view) return session.view;
    return 'Reset Hub';
  }

  function formatRelative(iso) {
    if (!iso) return '';
    var ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return 'just now';
    var sec = Math.round(ms / 1000);
    if (sec < 10) return 'just now';
    if (sec < 60) return sec + 's ago';
    var min = Math.round(sec / 60);
    return min + 'm ago';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPresencePanel(container, sessions, options) {
    if (!container) return;
    container.innerHTML = '';

    var visible = filterSessions(sessions, options);
    var emptyMsg = (options && options.emptyMessage)
      || (sessions && sessions.length
        ? 'No one else is on the dashboard right now.'
        : 'No one is on the dashboard right now.');

    if (!visible.length) {
      container.innerHTML = '<p class="cl-store-meta">' + escapeHtml(emptyMsg) + '</p>';
      return;
    }

    var list = document.createElement('div');
    list.className = 'cl-presence-list';

    visible.forEach(function (session) {
      var row = document.createElement('div');
      row.className = 'cl-presence-row';

      var who = document.createElement('div');
      who.className = 'cl-presence-who';
      who.innerHTML =
        '<span class="cl-presence-dot" aria-hidden="true"></span>' +
        '<span class="cl-presence-name">' + escapeHtml(session.name || session.email) + '</span>' +
        (session.name ? '<span class="cl-presence-email">' + escapeHtml(session.email) + '</span>' : '');

      var where = document.createElement('div');
      where.className = 'cl-presence-where';
      where.textContent = options && options.sameStore
        ? hubSessionWhereLabel(session)
        : locationLabel(session);

      var when = document.createElement('div');
      when.className = 'cl-presence-when';
      when.textContent = formatRelative(session.lastSeen);

      row.appendChild(who);
      row.appendChild(where);
      row.appendChild(when);
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  function renderHubHeaderSummary(summaryEl, sessions) {
    if (!summaryEl) return;
    if (!sessions.length) {
      summaryEl.textContent = 'Only you here';
      return;
    }
    var names = sessions.map(function (session) {
      return session.name || (session.email || '').split('@')[0] || session.email;
    });
    if (names.length === 1) {
      summaryEl.textContent = 'With ' + names[0];
      return;
    }
    if (names.length === 2) {
      summaryEl.textContent = 'With ' + names[0] + ' & ' + names[1];
      return;
    }
    summaryEl.textContent = 'With ' + names.slice(0, 2).join(', ') + ' +' + (names.length - 2);
  }

  function renderHubHeaderList(container, sessions) {
    if (!container) return;
    container.innerHTML = '';

    if (!sessions.length) {
      container.innerHTML = '<p class="hub-header-presence-empty">No one else is in this store right now.</p>';
      return;
    }

    sessions.forEach(function (session) {
      var row = document.createElement('div');
      row.className = 'hub-header-presence-row';

      var who = document.createElement('div');
      who.className = 'hub-header-presence-who';
      who.innerHTML =
        '<span class="hub-header-presence-dot" aria-hidden="true"></span>' +
        '<span class="hub-header-presence-name">' + escapeHtml(session.name || session.email) + '</span>';

      var where = document.createElement('div');
      where.className = 'hub-header-presence-where';
      where.textContent = hubSessionWhereLabel(session);

      var when = document.createElement('div');
      when.className = 'hub-header-presence-when';
      when.textContent = formatRelative(session.lastSeen);

      row.appendChild(who);
      row.appendChild(where);
      row.appendChild(when);
      container.appendChild(row);
    });
  }

  function startPolling(key, refreshFn, intervalMs) {
    if (pollTimers[key]) clearInterval(pollTimers[key]);
    refreshFn();
    pollTimers[key] = setInterval(refreshFn, intervalMs || 15000);
  }

  function startAdminPanel(options) {
    var panel = options && options.panel;
    var statusEl = options && options.statusEl;
    if (!panel) return;

    startPolling('admin', function () {
      apiFetch('/presence', { noBounceOn401: true })
        .then(function (resp) {
          if (!resp.ok) throw new Error('unavailable');
          return resp.json();
        })
        .then(function (data) {
          if (statusEl) {
            statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          }
          renderPresencePanel(panel, data.sessions || [], {
            currentEmail: options.currentEmail,
          });
        })
        .catch(function () {
          if (statusEl) statusEl.textContent = 'Could not refresh activity';
        });
    });
  }

  function startHubHeaderPanel(options) {
    var wrap = options && options.wrap;
    var summaryEl = options && options.summaryEl;
    var listEl = options && options.listEl;
    var statusEl = options && options.statusEl;
    var toggleEl = options && options.toggleEl;
    var popoverEl = options && options.popoverEl;
    if (!wrap || !listEl) return Promise.resolve(false);

    function setOpen(open) {
      if (!popoverEl || !toggleEl) return;
      popoverEl.hidden = !open;
      toggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (toggleEl && popoverEl && !toggleEl.__presenceBound) {
      toggleEl.__presenceBound = true;
      toggleEl.addEventListener('click', function () {
        setOpen(popoverEl.hidden);
      });
      document.addEventListener('click', function (evt) {
        if (!wrap.contains(evt.target)) setOpen(false);
      });
    }

    return apiFetch('/presence', { noBounceOn401: true })
      .then(function (resp) {
        if (resp.status === 403) return false;
        if (!resp.ok) throw new Error('unavailable');
        wrap.hidden = false;

        startPolling('hub-header', function () {
          apiFetch('/presence', { noBounceOn401: true })
            .then(function (innerResp) {
              if (!innerResp.ok) throw new Error('unavailable');
              return innerResp.json();
            })
            .then(function (data) {
              var visible = filterSessions(data.sessions || [], {
                currentEmail: options.currentEmail,
                storeNumber: options.storeNumber,
                hubOnly: true,
              });
              renderHubHeaderSummary(summaryEl, visible);
              renderHubHeaderList(listEl, visible);
              if (statusEl) {
                statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              }
            })
            .catch(function () {
              if (statusEl) statusEl.textContent = 'Could not refresh';
            });
        });

        return true;
      })
      .catch(function () {
        return false;
      });
  }

  global.ChecklanePresence = {
    configure: function (fn) { metaFn = fn; },
    start: start,
    ping: ping,
    leave: leave,
    startAdminPanel: startAdminPanel,
    startHubHeaderPanel: startHubHeaderPanel,
    locationLabel: locationLabel,
    hubSessionWhereLabel: hubSessionWhereLabel,
  };
})(window);
