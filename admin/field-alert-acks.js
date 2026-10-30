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
  var csrfToken = '';

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
    if (String(opts.method || 'GET').toUpperCase() !== 'GET' && csrfToken) {
      headers['x-console-csrf'] = csrfToken;
    }
    if (opts.body !== undefined) opts.body = JSON.stringify(opts.body);
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
          err.code = data.code || null;
          throw err;
        }
        return data;
      });
    });
  }

  function post(path, body) {
    return api(path, { method: 'POST', body: body || {} });
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
      + '</dl>'
      + (row.understood_at
        ? ''
        : '<div class="acts">'
          + '<button class="btn secondary" data-act="remind" data-email="' + esc(row.email)
          + '" data-name="' + esc(row.display_name || row.email) + '">Remind</button>'
          + '<button class="btn" data-act="confirm" data-email="' + esc(row.email)
          + '" data-name="' + esc(row.display_name || row.email) + '">Confirm for them</button>'
          + '</div>')
      + '</article>';
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
    el('view-compose').hidden = which !== 'compose';
    el('tab-notices').setAttribute('aria-selected', which === 'list' || which === 'detail' ? 'true' : 'false');
    el('tab-failures').setAttribute('aria-selected', which === 'failures' ? 'true' : 'false');
    el('tab-compose').setAttribute('aria-selected', which === 'compose' ? 'true' : 'false');
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

  function actionLabel(action) {
    var labels = {
      resend_reminder: 'resend reminder',
      confirm_on_behalf: 'confirm on behalf',
      cancel: 'cancel',
      fix_text: 'fix text',
      correct: 'correct',
      extend: 'extend',
      expire: 'expire',
      compose_send: 'send'
    };
    return labels[action] || action;
  }

  function renderAudit(rows) {
    var box = el('detail-audit');
    if (!rows || !rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card"><h3 style="font-size:15px;margin-bottom:8px">Console actions</h3>'
      + rows.map(function (row) {
        return '<div class="chain">' + esc(fmt(row.created_at)) + ' · ' + esc(actionLabel(row.action))
          + ' · ' + esc(row.actor_email)
          + (row.recipient_email ? ' → ' + esc(row.recipient_email) : '')
          + (row.reason ? ' · “' + esc(row.reason) + '”' : '') + '</div>';
      }).join('') + '</div>';
  }

  function openNotice(id) {
    showView('detail');
    toast('');
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
          + actionBar(n)
          + (n.recipients.length
            ? n.recipients.map(recipientCard).join('')
            : '<div class="card empty">No recipients in this view.</div>');
        renderAudit(data.audit);
      })
      .catch(function (err) {
        el('detail').innerHTML = '<div class="card empty">' + esc(err.message) + '</div>';
      });
  }
function actionBar(notice) {
    if (notice.revokedAt) {
      return '<div class="card"><div class="meta">Cancelled ' + esc(fmt(notice.revokedAt))
        + '. No further actions.</div></div>';
    }
    return '<div class="card"><div class="chain" style="margin:0 0 8px">Notice actions</div>'
      + '<div class="row-actions" style="margin-top:0">'
      + '<button class="btn secondary" data-nact="fix">Fix text</button>'
      + '<button class="btn secondary" data-nact="correct">Correct</button>'
      + '<button class="btn secondary" data-nact="expiry">Extend / expire</button>'
      + '<button class="btn danger" data-nact="cancel">Cancel notice</button>'
      + '</div></div>';
  }

  function toast(text, bad) {
    var node = el('note');
    node.textContent = text || '';
    node.className = 'note' + (bad ? ' bad' : '');
    node.hidden = !text;
  }

  var sheetMode = null;
  var diffShown = false;

  function localInput(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fieldHtml(field) {
    var id = 'sf-' + field.name;
    var label = '<label for="' + id + '">' + esc(field.label) + '</label>';
    if (field.type === 'textarea') {
      return label + '<textarea id="' + id + '" name="' + field.name + '">'
        + esc(field.value || '') + '</textarea>';
    }
    if (field.type === 'select') {
      return label + '<select id="' + id + '" name="' + field.name + '">'
        + (field.options || []).map(function (opt) {
          return '<option value="' + esc(opt) + '"'
            + (opt === field.value ? ' selected' : '') + '>' + esc(opt) + '</option>';
        }).join('') + '</select>';
    }
    var type = field.type === 'datetime' ? 'datetime-local' : (field.type || 'text');
    var value = field.type === 'datetime' ? localInput(field.value) : (field.value || '');
    return label + '<input id="' + id + '" name="' + field.name + '" type="' + type
      + '" value="' + esc(value) + '" autocomplete="off">';
  }

  function openSheet(config) {
    sheetMode = config;
    diffShown = false;
    el('sheet-title').textContent = config.title;
    el('sheet-intro').textContent = config.intro || '';
    el('sheet-error').textContent = '';
    el('sheet-fields').innerHTML = (config.fields || []).map(fieldHtml).join('');
    el('sheet-go').textContent = config.confirmLabel || 'Confirm';
    el('sheet-go').className = 'btn' + (config.danger ? ' danger' : '');
    el('sheet-go').disabled = Boolean(config.requireDiff);
    el('sheet-diff').innerHTML = config.requireDiff
      ? '<button type="button" class="btn secondary" id="sheet-showdiff">Show changes</button>'
        + '<div id="sheet-difflist"></div>'
      : '';
    el('sheet').showModal();
  }

  function sheetValues() {
    var out = {};
    ((sheetMode && sheetMode.fields) || []).forEach(function (field) {
      var node = document.getElementById('sf-' + field.name);
      out[field.name] = node ? node.value : '';
    });
    return out;
  }

  function renderDiff(rows) {
    if (!rows || !rows.length) {
      el('sheet-difflist').innerHTML = '<div class="hint">Nothing changed.</div>';
      return;
    }
    el('sheet-difflist').innerHTML = '<dl class="difflist">' + rows.map(function (row) {
      return '<dt>' + esc(row.field) + '</dt><dd>' + esc(row.from || '(empty)')
        + '<br><span class="to">→ ' + esc(row.to || '(empty)') + '</span></dd>';
    }).join('') + '</dl>';
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
    var target = event.target.closest('[data-open],[data-pdf],[data-act],[data-nact]');
    if (!target) return;
    if (target.dataset.open) { openNotice(target.dataset.open); return; }
    if (target.dataset.pdf) {
      currentNotice = { id: target.dataset.pdf };
      exportView('detail');
      return;
    }
    if (!currentNotice) return;
    if (target.dataset.act === 'remind') {
      actRemind(target.dataset.email, target.dataset.name);
      return;
    }
    if (target.dataset.act === 'confirm') {
      actConfirm(target.dataset.email, target.dataset.name);
      return;
    }
    if (target.dataset.nact === 'fix') { actFix(currentNotice); return; }
    if (target.dataset.nact === 'correct') { actCorrect(currentNotice); return; }
    if (target.dataset.nact === 'expiry') { actExpiry(currentNotice); return; }
    if (target.dataset.nact === 'cancel') { actCancel(currentNotice); }
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
    return api('/api/field-alerts/console/csrf').then(function (data) {
      csrfToken = data.csrf || '';
    }).catch(function () { csrfToken = ''; });
  }).then(function () {
    var match = /#notice=([0-9a-fA-F-]{8,40})/.exec(location.hash || '');
    if (match) return openNotice(match[1]);
    showView('list');
    return loadList();
  }).catch(function (err) {
    setStatus('Failed to load: ' + err.message);
  });
/* ─── Phase B: act ─────────────────────────────────────────────────────── */

  function basePath() {
    return '/api/field-alerts/console/notices/' + encodeURIComponent(currentNotice.id);
  }

  function afterAction(message, options) {
    var opts = options || {};
    var reload = currentNotice ? openNotice(currentNotice.id) : Promise.resolve();
    reload.then(function () { toast(message, opts.bad); });
    if (opts.refreshList) loadList();
  }

  function actRemind(email, name) {
    openSheet({
      title: 'Resend reminder',
      intro: 'One SMS to ' + name + '. Limited to one per person per hour.',
      fields: [{ name: 'reason', label: 'Note (optional)' }],
      confirmLabel: 'Send text',
      path: basePath() + '/recipients/' + encodeURIComponent(email) + '/resend',
      body: function (values) { return { reason: values.reason || null }; },
      done: function (data) {
        return data.sent
          ? 'Reminder text sent to ' + name + '.'
          : 'No text sent — ' + (data.failure || 'see the SMS row') + '.';
      }
    });
  }

  function actConfirm(email, name) {
    openSheet({
      title: 'Confirm on behalf of ' + name,
      intro: 'Recorded as confirmed by you, on their behalf. Their notice clears on the next poll.',
      fields: [{ name: 'reason', label: 'Reason (required)', type: 'textarea' }],
      confirmLabel: 'Confirm for them',
      path: basePath() + '/recipients/' + encodeURIComponent(email) + '/confirm',
      body: function (values) { return { reason: values.reason }; },
      done: function () { return 'Confirmed on behalf of ' + name + '.'; }
    });
  }

  function actCancel(notice) {
    var counts = notice.counts || {};
    openSheet({
      title: 'Cancel this notice',
      intro: 'Revokes for ' + (counts.total || 0) + ' recipients ('
        + (counts.unconfirmed || 0) + ' still unconfirmed). Their overlay clears on the next poll.',
      fields: [{ name: 'reason', label: 'Reason (required)', type: 'textarea' }],
      confirmLabel: 'Cancel notice',
      danger: true,
      path: basePath() + '/cancel',
      body: function (values) { return { reason: values.reason }; },
      refreshList: true,
      done: function () { return 'Notice cancelled.'; }
    });
  }

  function actFix(notice) {
    openSheet({
      title: 'Fix text',
      intro: 'Title and body only. No new version, no re-confirm.',
      fields: [
        { name: 'title', label: 'Title', value: notice.title },
        { name: 'bodyMd', label: 'Body', type: 'textarea', value: notice.bodyMd }
      ],
      confirmLabel: 'Save text',
      path: basePath() + '/fix-text',
      body: function (values) { return { title: values.title, bodyMd: values.bodyMd }; },
      refreshList: true,
      done: function (data) { return data.changed ? 'Text updated.' : 'Nothing changed.'; }
    });
  }

  function actCorrect(notice) {
    openSheet({
      title: 'Correct notice',
      intro: 'Creates a new version for ' + (((notice.counts || {}).total) || 0)
        + ' recipients and requires everyone to confirm again.',
      fields: [
        { name: 'title', label: 'Title', value: notice.title },
        { name: 'bodyMd', label: 'Body', type: 'textarea', value: notice.bodyMd },
        {
          name: 'severity',
          label: 'Severity',
          type: 'select',
          value: notice.severity,
          options: ['info', 'action', 'urgent']
        },
        { name: 'reason', label: 'Reason (required)', type: 'textarea' }
      ],
      requireDiff: true,
      confirmLabel: 'Correct notice',
      danger: true,
      path: basePath() + '/correct',
      body: function (values) {
        return {
          title: values.title,
          bodyMd: values.bodyMd,
          severity: values.severity,
          reason: values.reason
        };
      },
      refreshList: true,
      done: function (data) {
        return 'Corrected — ' + (data.recipients || 0) + ' recipients must confirm again.';
      }
    });
  }

  function actExpiry(notice) {
    openSheet({
      title: 'Extend or expire',
      intro: 'A time in the future extends the notice; a past time (or empty) ends it now.',
      fields: [
        { name: 'expiresAt', label: 'Expires at', type: 'datetime', value: notice.expiresAt },
        { name: 'reason', label: 'Note (optional)' }
      ],
      confirmLabel: 'Save',
      path: basePath() + '/expiry',
      body: function (values) {
        var iso = values.expiresAt ? new Date(values.expiresAt).toISOString() : null;
        return { expiresAt: iso, reason: values.reason || null };
      },
      refreshList: true,
      done: function (data) {
        return data.action === 'extend' ? 'Expiry extended.' : 'Notice expired.';
      }
    });
  }

  el('sheet-cancel').addEventListener('click', function () {
    el('sheet').close();
  });

  el('sheet-diff').addEventListener('click', function (event) {
    if (event.target.id !== 'sheet-showdiff' || !sheetMode) return;
    var values = sheetValues();
    var query = new URLSearchParams();
    if (values.title != null) query.set('title', values.title);
    if (values.bodyMd != null) query.set('bodyMd', values.bodyMd);
    if (values.severity != null) query.set('severity', values.severity);
    api(basePath() + '/diff?' + query.toString()).then(function (data) {
      renderDiff(data.diff);
      diffShown = true;
      el('sheet-go').disabled = false;
    }).catch(function (err) {
      el('sheet-error').textContent = err.message;
    });
  });

  el('sheet-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!sheetMode) return;
    if (sheetMode.requireDiff && !diffShown) {
      el('sheet-error').textContent = 'Show the changes first.';
      return;
    }
    var values = sheetValues();
    var mode = sheetMode;
    el('sheet-error').textContent = '';
    el('sheet-go').disabled = true;
    post(mode.path, mode.body(values)).then(function (data) {
      el('sheet').close();
      el('sheet-go').disabled = false;
      afterAction(mode.done ? mode.done(data) : 'Done.', { refreshList: mode.refreshList });
    }).catch(function (err) {
      el('sheet-error').textContent = err.message;
      el('sheet-go').disabled = false;
    });
  });
/* ─── Phase C: send ────────────────────────────────────────────────────── */

  var compose = {
    severity: 'action',
    audType: 'districts',
    picked: { districts: [], routes: [], stores: [], emails: [] },
    channel: 'eod_field_app',
    docId: null,
    existingDoc: null,
    docUrl: null,
    options: null,
    resolved: null,
    previewed: false
  };

  function composeTitle() { return el('c-title').value.trim(); }

  function composeBullets() {
    return ['c-b1', 'c-b2', 'c-b3', 'c-b4']
      .map(function (id) { return el(id).value.trim(); })
      .filter(Boolean)
      .slice(0, 4);
  }

  function composeAudience() {
    var picked = compose.picked;
    if (compose.audType === 'districts') return { districts: picked.districts.map(Number) };
    if (compose.audType === 'routes') {
      var stores = (compose.options ? compose.options.stores : [])
        .filter(function (s) { return picked.routes.indexOf(s.kompass_route) >= 0; })
        .map(function (s) { return s.store_number; });
      return { stores: stores };
    }
    if (compose.audType === 'stores') return { stores: picked.stores.slice() };
    return { emails: picked.emails.slice() };
  }

  function composeAudienceEmpty() {
    var aud = composeAudience();
    return !(aud.districts || aud.stores || aud.emails || []).length;
  }

  function renderMatrix() {
    var matrix = (compose.options && compose.options.severityMatrix) || {};
    var policy = matrix[compose.severity] || {};
    var bits = [];
    bits.push(policy.blocking ? 'blocks the app until confirmed' : 'does not block');
    bits.push(policy.smsAfterMs != null
      ? 'SMS after ' + Math.round(policy.smsAfterMs / 60000) + ' min'
      : 'no SMS');
    bits.push(policy.escalateAfterMs != null
      ? 'escalates after ' + Math.round(policy.escalateAfterMs / 60000) + ' min'
      : 'no escalation');
    if (policy.windowStartHour != null) {
      bits.push('window ' + policy.windowStartHour + ':00–' + policy.windowEndHour + ':00 PT');
    }
    el('c-matrix').textContent = bits.join(' · ');
  }

  function setSeg(containerId, attr, value) {
    Array.prototype.forEach.call(el(containerId).querySelectorAll('.seg-btn'), function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset[attr] === value ? 'true' : 'false');
    });
  }

  function renderAudienceList() {
    var options = compose.options || { districts: [], routes: [], stores: [], people: [] };
    var type = compose.audType;
    var items = [];
    if (type === 'districts') {
      items = (options.districts || []).map(function (d) { return { key: d, label: 'D' + d }; });
    } else if (type === 'routes') {
      items = (options.routes || []).map(function (r) {
        var stores = (options.stores || []).filter(function (s) { return s.kompass_route === r; });
        return {
          key: r,
          label: r + ' — FM' + stores.map(function (s) { return s.store_number; }).join(', ')
        };
      });
    } else if (type === 'stores') {
      items = (options.stores || []).map(function (s) { return { key: s.store_number, label: s.label }; });
    } else {
      items = (options.people || []).map(function (p) {
        return {
          key: p.email,
          label: (p.display_name || p.email) + ' · D' + (p.districts || []).join(', D')
            + (p.kompass_route ? ' ' + p.kompass_route : '')
        };
      });
    }
    el('c-aud-list').innerHTML = items.length
      ? items.map(function (item) {
        var on = compose.picked[type].indexOf(item.key) >= 0;
        return '<label><input type="checkbox" data-pick="' + esc(type) + '" value="' + esc(item.key) + '"'
          + (on ? ' checked' : '') + '>' + esc(item.label) + '</label>';
      }).join('')
      : '<div class="empty">Nothing in your districts.</div>';
  }

  function composeDocUrl() {
    if (compose.docId) return '/api/field-alerts/console/docs/' + compose.docId + '.pdf';
    if (compose.existingDoc) return compose.existingDoc.url;
    return null;
  }

  function updateSendButton() {
    var count = compose.resolved ? compose.resolved.recipients.length : 0;
    var ready = compose.previewed && el('c-approve').checked && count > 0;
    el('c-send').disabled = !ready;
  }

  function renderResolved(resolved) {
    compose.resolved = resolved;
    var list = resolved.recipients || [];
    el('c-aud-summary').textContent = list.length
      ? list.length + ' recipient' + (list.length === 1 ? '' : 's') + ': '
        + list.slice(0, 6).map(function (r) { return r.display_name; }).join(', ')
        + (list.length > 6 ? ' +' + (list.length - 6) + ' more' : '')
      : 'Nobody resolves from that audience.';
    var warnings = resolved.warnings || [];
    el('c-aud-warnings').innerHTML = warnings.length
      ? warnings.map(function (w) {
        return '<div class="warn">' + esc(w.message) + '</div>';
      }).join('')
      : '';
    updateSendButton();
  }

  var resolveTimer = null;
  function scheduleResolve() {
    compose.previewed = false;
    el('c-send').disabled = true;
    if (resolveTimer) clearTimeout(resolveTimer);
    if (composeAudienceEmpty()) {
      renderResolved({ recipients: [], warnings: [], summary: {} });
      return;
    }
    resolveTimer = setTimeout(function () {
      post('/api/field-alerts/console/compose/resolve', {
        audience: composeAudience(),
        channel: compose.channel
      }).then(renderResolved).catch(function (err) {
        el('c-aud-summary').textContent = err.message;
        el('c-aud-warnings').innerHTML = '';
        compose.resolved = null;
      });
    }, 220);
  }

  function loadComposeOptions() {
    if (compose.options) {
      renderMatrix();
      renderAudienceList();
      return Promise.resolve(compose.options);
    }
    return api('/api/field-alerts/console/compose/options').then(function (data) {
      compose.options = data;
      renderMatrix();
      renderAudienceList();
      var docs = data.documents || [];
      el('c-doc-existing').innerHTML = '<option value="">No document</option>'
        + docs.map(function (doc) {
          return '<option value="' + esc(doc.reviewId + '|' + doc.variant) + '">'
            + esc(doc.reviewId + ' · ' + doc.variant) + '</option>';
        }).join('');
      return data;
    });
  }

  function renderPreview(preview) {
    var sev = preview.severity || 'action';
    el('c-preview-out').innerHTML = '<div class="phone"><div class="phone-card">'
      + '<div class="phone-head ' + esc(sev) + '">' + esc(preview.title || '(no title)') + '</div>'
      + '<div class="phone-body">' + (preview.bodyHtml || '<p>(no bullets)</p>') + '</div>'
      + '<div class="phone-foot"><span>☐ I understand</span><span>Dismiss</span></div>'
      + '</div></div>'
      + '<div class="smsbox">' + esc(preview.smsText) + '</div>'
      + '<div class="chain">' + (preview.docUrl ? 'Document attached' : 'No document') + '</div>';
    compose.previewed = true;
    updateSendButton();
  }

  function readFileBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('could not read that file')); };
      reader.readAsDataURL(file);
    });
  }
function resetCompose() {
    el('c-title').value = '';
    ['c-b1', 'c-b2', 'c-b3', 'c-b4', 'c-approval-note'].forEach(function (id) { el(id).value = ''; });
    el('c-approve').checked = false;
    el('c-doc-file').value = '';
    el('c-doc-existing').value = '';
    el('c-doc-status').textContent = '';
    el('c-preview-out').innerHTML = '';
    compose.docId = null;
    compose.existingDoc = null;
    compose.previewed = false;
    compose.resolved = null;
    el('c-send-note').hidden = true;
    updateSendButton();
  }

  function sendComposeNotice() {
    var body = {
      title: composeTitle(),
      bullets: composeBullets(),
      severity: compose.severity,
      audience: composeAudience(),
      channel: compose.channel,
      docId: compose.docId,
      existingDoc: compose.existingDoc
        ? { reviewId: compose.existingDoc.reviewId, variant: compose.existingDoc.variant }
        : null,
      approved: el('c-approve').checked === true,
      approvalNote: el('c-approval-note').value.trim() || null
    };
    var note = el('c-send-note');
    note.hidden = false;
    note.className = 'note';
    note.textContent = 'Sending…';
    el('c-send').disabled = true;
    post('/api/field-alerts/console/compose', body).then(function (data) {
      note.textContent = 'Sent to ' + data.recipients + ' recipient'
        + (data.recipients === 1 ? '' : 's') + '.';
      var newId = data.alert && data.alert.id;
      resetCompose();
      loadList();
      if (newId) openNotice(newId);
    }).catch(function (err) {
      note.className = 'note bad';
      note.textContent = err.message;
      updateSendButton();
    });
  }

  el('tab-compose').addEventListener('click', function () {
    history.replaceState(null, '', location.pathname);
    currentNotice = null;
    showView('compose');
    loadComposeOptions().catch(function (err) {
      el('c-matrix').textContent = err.message;
    });
  });

  el('c-severity').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-sev]');
    if (!btn) return;
    compose.severity = btn.dataset.sev;
    setSeg('c-severity', 'sev', compose.severity);
    renderMatrix();
    compose.previewed = false;
    updateSendButton();
  });

  el('c-aud-type').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-aud]');
    if (!btn) return;
    compose.audType = btn.dataset.aud;
    setSeg('c-aud-type', 'aud', compose.audType);
    renderAudienceList();
    scheduleResolve();
  });

  el('c-aud-list').addEventListener('change', function (event) {
    var box = event.target.closest('[data-pick]');
    if (!box) return;
    var type = box.dataset.pick;
    var value = box.dataset.pick === 'districts' ? Number(box.value) : box.value;
    var list = compose.picked[type];
    var at = list.indexOf(value);
    if (box.checked && at < 0) list.push(value);
    if (!box.checked && at >= 0) list.splice(at, 1);
    scheduleResolve();
  });

  el('c-channel').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-ch]');
    if (!btn || btn.disabled) return;
    compose.channel = btn.dataset.ch;
    setSeg('c-channel', 'ch', compose.channel);
  });

  el('c-doc-existing').addEventListener('change', function () {
    var value = el('c-doc-existing').value;
    compose.docId = null;
    compose.existingDoc = null;
    if (value) {
      var parts = value.split('|');
      var docs = (compose.options && compose.options.documents) || [];
      var hit = docs.find(function (d) { return d.reviewId === parts[0] && d.variant === parts[1]; });
      compose.existingDoc = hit || { reviewId: parts[0], variant: parts[1],
        url: '/api/central-pet/updates/' + encodeURIComponent(parts[0]) + '/document.pdf' };
      el('c-doc-status').textContent = 'Attached: ' + parts[0] + ' · ' + parts[1];
    } else {
      el('c-doc-status').textContent = '';
    }
    compose.previewed = false;
    updateSendButton();
  });

  el('c-doc-file').addEventListener('change', function () {
    var file = el('c-doc-file').files && el('c-doc-file').files[0];
    if (!file) return;
    el('c-doc-status').textContent = 'Uploading ' + file.name + '…';
    readFileBase64(file).then(function (dataUrl) {
      return post('/api/field-alerts/console/docs', { dataUrl: dataUrl, filename: file.name });
    }).then(function (data) {
      compose.docId = data.doc.id;
      compose.existingDoc = null;
      el('c-doc-existing').value = '';
      el('c-doc-status').textContent = 'Attached: ' + file.name;
      compose.previewed = false;
      updateSendButton();
    }).catch(function (err) {
      el('c-doc-status').textContent = err.message;
    });
  });

  el('c-preview').addEventListener('click', function () {
    post('/api/field-alerts/console/compose/preview', {
      title: composeTitle(),
      bullets: composeBullets(),
      severity: compose.severity,
      docUrl: composeDocUrl()
    }).then(function (data) {
      renderPreview(data.preview);
    }).catch(function (err) {
      el('c-preview-out').innerHTML = '<div class="warn">' + esc(err.message) + '</div>';
      compose.previewed = false;
      updateSendButton();
    });
  });

  el('c-approve').addEventListener('change', updateSendButton);
  el('c-reset').addEventListener('click', resetCompose);
  el('c-send').addEventListener('click', sendComposeNotice);
})();