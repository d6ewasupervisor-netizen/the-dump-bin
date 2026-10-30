/*
 * Field notice console — see, act, send against /api/field-alerts/console.
 *
 * Scope is the server's call: the page renders whatever
 * GET /console/me says (admin = every district, a supervisor = their own
 * districts only) and never widens it client-side.
 */
(function () {
  'use strict';

  var API = 'https://eod-api.the-dump-bin.com';
  var me = null;
  var notices = [];
  var currentNotice = null;

  function token() {
    try {
      if (window.dumpBinAuth && typeof window.dumpBinAuth.getSession === 'function') {
        return window.dumpBinAuth.getSession() || '';
      }
      return localStorage.getItem('dumpBinSession') || '';
    } catch (e) { return ''; }
  }

  function api(path, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    if (opts.body) opts.body = JSON.stringify(opts.body);
    opts.headers = headers;
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401) {
        window.location.href = '/?next=' + encodeURIComponent(location.pathname);
        throw new Error('sign in required');
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function el(id) { return document.getElementById(id); }

  function setStatus(text) { el('status').textContent = text || ''; }

  function pill(text, cls) {
    return '<span class="pill ' + esc(cls) + '">' + esc(text) + '</span>';
  }
function countsHtml(counts) {
    var c = counts || {};
    var out = [];
    out.push('<div class="count"><b>' + (c.delivered || 0) + '/' + (c.total || 0)
      + '</b><span>Delivered</span></div>');
    out.push('<div class="count"><b>' + (c.opened || 0) + '</b><span>Opened</span></div>');
    out.push('<div class="count good"><b>' + (c.confirmed || 0) + '</b><span>Confirmed</span></div>');
    out.push('<div class="count' + ((c.unconfirmed || 0) > 0 ? ' bad' : '') + '"><b>'
      + (c.unconfirmed || 0) + '</b><span>Unconfirmed</span></div>');
    return '<div class="counts">' + out.join('') + '</div>'
      + '<div class="chain">own confirm ' + (c.own || 0) + ' · on behalf ' + (c.onBehalf || 0)
      + ' · reminders ' + (c.reminders || 0) + ' · sms failed ' + (c.smsFailed || 0)
      + ' · escalated ' + (c.escalated || 0) + '</div>';
  }

  function chainText(notice) {
    var bits = [];
    if (notice.supersedesAlertId) bits.push('corrects ' + String(notice.supersedesAlertId).slice(0, 8) + '…');
    if (notice.supersededBy) bits.push('superseded by ' + String(notice.supersededBy).slice(0, 8) + '…');
    if (notice.sourceReviewId) bits.push('review ' + notice.sourceReviewId);
    return bits.join(' · ');
  }

  function noticeCard(notice, opts) {
    var sev = String(notice.severity || 'action');
    var chain = chainText(notice);
    var actions = !opts || opts.actions !== false;
    return '<article class="card notice sev-' + esc(sev) + '" data-notice="' + esc(notice.id) + '">'
      + '<div class="notice-head"><div class="notice-title">' + esc(notice.title || notice.id) + '</div>'
      + '<div>' + pill(sev, sev) + ' ' + pill(notice.status, notice.status) + '</div></div>'
      + '<div class="meta">' + esc(notice.audienceLabel || '') + '</div>'
      + '<div class="chain">by ' + esc(notice.createdByEmail || 'unknown') + ' · '
      + esc(fmt(notice.createdAt))
      + (notice.expiresAt ? ' · expires ' + esc(fmt(notice.expiresAt)) : '') + '</div>'
      + (chain ? '<div class="chain">' + esc(chain) + '</div>' : '')
      + countsHtml(notice.counts)
      + (actions
        ? '<div class="row-actions"><button class="btn" data-open="' + esc(notice.id) + '">Open</button>'
          + '<button class="btn secondary" data-pdf="' + esc(notice.id) + '">PDF</button></div>'
        : '')
      + '</article>';
  }

  function recipientCard(row) {
    var confirmed;
    if (row.understood_at) {
      confirmed = '<span class="ok">' + esc(fmt(row.understood_at)) + '</span>'
        + ' (' + esc(row.understood_channel || 'app') + ')';
      if (row.acked_by) {
        confirmed += '<br><span class="onbehalf">confirmed by '
          + esc(String(row.acked_by).split('@')[0]) + ' on behalf of ' + esc(row.display_name) + '</span>'
          + (row.ack_note ? ' <span class="sub">“' + esc(row.ack_note) + '”</span>' : '');
      }
    } else {
      confirmed = '<span class="bad">No</span>';
    }
    var sms = row.sms_failure
      ? '<span class="bad">' + esc(row.sms_failure) + '</span>'
      : (row.sms_reminders_sent
        ? (row.sms_reminders_sent + ' sent' + (row.last_sms_at ? ' · ' + esc(fmt(row.last_sms_at)) : ''))
        : 'none');
    return '<article class="rcpt' + (row.understood_at ? '' : ' unconfirmed') + '">'
      + '<div class="who"><div><div class="name">' + esc(row.display_name || row.email) + '</div>'
      + '<div class="sub">' + esc(row.email) + '</div></div>'
      + '<div class="sub">' + (row.district != null ? 'D' + esc(row.district) : '—')
      + (row.kompass_route ? ' · ' + esc(row.kompass_route) : '') + '</div></div>'
      + '<dl class="kv">'
      + '<dt>Delivered</dt><dd>' + (row.delivered_at
        ? esc(fmt(row.delivered_at)) : '<span class="bad">not yet</span>') + '</dd>'
      + '<dt>Opened</dt><dd>' + (row.opened_at
        ? esc(fmt(row.opened_at)) + ' (' + esc(row.open_channel || '?') + ')'
        : '<span class="bad">no</span>') + '</dd>'
      + '<dt>Confirmed</dt><dd>' + confirmed + '</dd>'
      + '<dt>Reminders</dt><dd>' + (row.sms_reminders_sent || 0) + '</dd>'
      + '<dt>SMS</dt><dd>' + sms + '</dd>'
      + '<dt>Escalated</dt><dd>' + (row.escalated_at ? esc(fmt(row.escalated_at)) : '—') + '</dd>'
      + '</dl></article>';
  }
function districtOptions() {
    var list = me && Array.isArray(me.districts) && me.districts.length ? me.districts : [6, 8, 9];
    return '<option value="">All districts</option>' + list.map(function (d) {
      return '<option value="' + d + '">D' + d + '</option>';
    }).join('');
  }

  function routeOptions() {
    var routes = {};
    (notices || []).forEach(function (n) { (n.routes || []).forEach(function (r) { routes[r] = 1; }); });
    var keys = Object.keys(routes).sort();
    return '<option value="">All routes</option>' + keys.map(function (r) {
      return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
    }).join('');
  }

  function fillSelect(id, html, keep) {
    var node = el(id);
    if (!node) return;
    var value = keep ? node.value : '';
    node.innerHTML = html;
    node.value = value;
  }

  function query(filters) {
    var p = new URLSearchParams();
    Object.keys(filters || {}).forEach(function (k) {
      if (filters[k]) p.set(k, filters[k]);
    });
    var s = p.toString();
    return s ? '?' + s : '';
  }

  var listFilters = function () {
    return {
      district: el('f-district').value,
      route: el('f-route').value,
      severity: el('f-severity').value,
      status: el('f-status').value
    };
  };

  var detailFilters = function () {
    return { district: el('d-district').value, route: el('d-route').value };
  };

  function showView(which) {
    el('view-list').hidden = which !== 'list';
    el('view-detail').hidden = which !== 'detail';
    el('view-failures').hidden = which !== 'failures';
    el('tab-notices').setAttribute('aria-selected', which === 'failures' ? 'false' : 'true');
    el('tab-failures').setAttribute('aria-selected', which === 'failures' ? 'true' : 'false');
  }

  function loadMe() {
    return api('/api/field-alerts/console/me').then(function (data) {
      me = data;
      el('me').textContent = (data.displayName ? data.displayName + ' · ' : '')
        + (data.admin ? 'all districts' : ('D' + (data.districts || []).join(', D')));
      fillSelect('f-district', districtOptions(), false);
      fillSelect('d-district', districtOptions(), false);
    });
  }

  function loadList() {
    setStatus('Loading…');
    return api('/api/field-alerts/console/notices' + query(listFilters()))
      .then(function (data) {
        notices = data.notices || [];
        fillSelect('f-route', routeOptions(), true);
        fillSelect('d-route', routeOptions(), true);
        el('list').innerHTML = notices.length
          ? notices.map(noticeCard).join('')
          : '<div class="card empty">No notices match this view.</div>';
        setStatus(notices.length + ' notice' + (notices.length === 1 ? '' : 's')
          + ' · newest first');
      })
      .catch(function (err) {
        el('list').innerHTML = '';
        setStatus('Failed to load: ' + err.message);
      });
  }

  function renderAudit(rows) {
    var box = el('detail-audit');
    if (!rows || !rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card"><h3 style="font-size:15px;margin-bottom:8px">Console actions</h3>'
      + rows.map(function (row) {
        return '<div class="chain">' + esc(fmt(row.created_at)) + ' · ' + esc(row.action)
          + ' · ' + esc(row.actor_email)
          + (row.recipient_email ? ' → ' + esc(row.recipient_email) : '')
          + (row.reason ? ' · “' + esc(row.reason) + '”' : '') + '</div>';
      }).join('') + '</div>';
  }

  function openNotice(id) {
    showView('detail');
    el('detail').innerHTML = '<div class="card empty">Loading…</div>';
    el('detail-audit').innerHTML = '';
    if (location.hash !== '#notice=' + id) {
      history.replaceState(null, '', '#notice=' + encodeURIComponent(id));
    }
    return api('/api/field-alerts/console/notices/' + encodeURIComponent(id)
      + query(detailFilters()))
      .then(function (data) {
        var n = data.notice;
        currentNotice = n;
        fillSelect('d-route', routeOptions(), true);
        el('detail').innerHTML = noticeCard(n, { actions: false })
          + (n.recipients.length
            ? n.recipients.map(recipientCard).join('')
            : '<div class="card empty">No recipients in this view.</div>');
        renderAudit(data.audit);
      })
      .catch(function (err) {
        el('detail').innerHTML = '<div class="card empty">' + esc(err.message) + '</div>';
      });
  }
function loadFailures() {
    showView('failures');
    el('failures').innerHTML = '<div class="card empty">Loading…</div>';
    return api('/api/field-alerts/console/failures' + query(listFilters()))
      .then(function (data) {
        var groups = data.groups || [];
        if (!groups.length) {
          el('failures').innerHTML = '<div class="card empty">No delivery or SMS problems in this view.</div>';
          return;
        }
        el('failures').innerHTML = groups.map(function (group) {
          return '<section class="card cause"><div class="cause-head"><h3>' + esc(group.label)
            + '</h3><div class="n">' + group.recipients.length + '</div></div>'
            + '<div class="hint">' + esc(group.hint) + '</div>'
            + group.recipients.map(function (row) {
              return '<div class="rcpt"><div class="who"><div>'
                + '<div class="name">' + esc(row.display_name || row.email) + '</div>'
                + '<div class="sub">D' + esc(row.district == null ? '—' : row.district)
                + (row.kompass_route ? ' · ' + esc(row.kompass_route) : '') + '</div></div>'
                + '<button class="btn secondary" style="width:auto;min-width:72px" data-open="'
                + esc(row.alertId) + '">Open</button></div>'
                + '<div class="chain">' + esc(row.alertTitle) + ' · ' + esc(fmt(row.alertCreatedAt || ''))
                + '</div>'
                + '<div class="chain">' + (row.sms_failure
                  ? esc(row.sms_failure) : ('sms ' + esc(row.sms_state || 'none'))) + '</div>'
                + '</div>';
            }).join('') + '</section>';
        }).join('');
      })
      .catch(function (err) {
        el('failures').innerHTML = '<div class="card empty">' + esc(err.message) + '</div>';
      });
  }

  function download(name, path) {
    var t = token();
    return fetch(API + path, {
      headers: t ? { Authorization: 'Bearer ' + t } : {}
    }).then(function (res) {
      if (!res.ok) throw new Error('Export failed (HTTP ' + res.status + ')');
      return res.blob();
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }).catch(function (err) {
      window.alert(err.message);
    });
  }

  function exportView(view) {
    var filters = view === 'detail' ? detailFilters() : listFilters();
    var q = query(filters);
    var path = '/api/field-alerts/console/export.pdf?view=' + encodeURIComponent(view)
      + (view === 'detail' && currentNotice ? '&id=' + encodeURIComponent(currentNotice.id) : '')
      + (q ? '&' + q.slice(1) : '');
    return download('notice-console-' + view + '.pdf', path);
  }

  function goList() {
    history.replaceState(null, '', location.pathname);
    currentNotice = null;
    showView('list');
    loadList();
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-open],[data-pdf]');
    if (!target) return;
    if (target.dataset.open) { openNotice(target.dataset.open); return; }
    if (target.dataset.pdf) {
      currentNotice = { id: target.dataset.pdf };
      exportView('detail');
    }
  });

  el('refresh').addEventListener('click', loadList);
  el('refresh-failures').addEventListener('click', loadFailures);
  el('export-list').addEventListener('click', function () { exportView('list'); });
  el('export-failures').addEventListener('click', function () { exportView('failures'); });
  el('export-detail').addEventListener('click', function () { exportView('detail'); });
  el('back').addEventListener('click', goList);
  ['f-district', 'f-route', 'f-severity', 'f-status'].forEach(function (id) {
    el(id).addEventListener('change', loadList);
  });
  ['d-district', 'd-route'].forEach(function (id) {
    el(id).addEventListener('change', function () {
      if (currentNotice) openNotice(currentNotice.id);
    });
  });
  el('tab-notices').addEventListener('click', function () {
    if (location.hash) goList();
    else { showView('list'); loadList(); }
  });
  el('tab-failures').addEventListener('click', loadFailures);

  loadMe().then(function () {
    var match = /#notice=([0-9a-fA-F-]{8,40})/.exec(location.hash || '');
    if (match) return openNotice(match[1]);
    showView('list');
    return loadList();
  }).catch(function (err) {
    setStatus('Failed to load: ' + err.message);
  });
})();