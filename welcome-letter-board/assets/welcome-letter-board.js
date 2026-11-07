(function () {
  const UI_VERSION = 'v2.34';
  const API_PREFIX = '/api/welcome-letter/board';

  const state = {
    page: 1,
    pageSize: 50,
    total: 0,
    selectedId: null,
    filters: {},
    sortBy: 'createdAt',
    sortDir: 'desc',
    signedInEmail: null,
    activeHireChatId: null,
    idleCutoff: '',
  };

  const chatState = {
    hireId: null,
    employeeId: null,
    hires: [],
  };

  function setVersionBadge(apiVersion) {
    const el = document.getElementById('wbVersion');
    if (!el) return;
    el.textContent = UI_VERSION;
    if (apiVersion) {
      el.title = `UI ${UI_VERSION} · API ${apiVersion}`;
      if (apiVersion !== UI_VERSION) {
        el.textContent = `${UI_VERSION} / api ${apiVersion}`;
      }
    } else {
      el.title = `Employee Board UI ${UI_VERSION}`;
    }
  }

  async function refreshApiVersion() {
    try {
      const fetchFn = window.dumpBinAuthFetch || fetch;
      const res = await fetchFn('/api/welcome-letter/version', {
        noBounceOn401: true,
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.version) setVersionBadge(data.version);
    } catch (_err) {
      // Keep UI-only badge if API version is unreachable.
    }
  }

  let busyCount = 0;

  function showBusy(on) {
    busyCount += on ? 1 : -1;
    if (busyCount < 0) busyCount = 0;
    const el = document.getElementById('wbBusy');
    if (!el) return;
    el.hidden = busyCount === 0;
    el.setAttribute('aria-busy', busyCount ? 'true' : 'false');
  }

  window.EmployeeBoardBusy = {
    start() { showBusy(true); },
    stop() { showBusy(false); },
  };

  async function api(path, options = {}) {
    const fetchFn = window.dumpBinAuthFetch || fetch;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    showBusy(true);
    try {
      const res = await fetchFn(path, {
        credentials: 'include',
        ...options,
        headers,
      });
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch (_err) { body = { raw: text }; }
      if (!res.ok) {
        const err = new Error(body.error || body.message || `HTTP ${res.status}`);
        err.steps = body.steps;
        err.item = body.item;
        throw err;
      }
      return body;
    } finally {
      showBusy(false);
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_err) {
      return iso;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badge(label, kind) {
    return `<span class="wb-badge wb-badge-${kind}">${escapeHtml(label)}</span>`;
  }

  function statusBadge(status) {
    const s = String(status || 'unknown').toLowerCase();
    if (s === 'sent') return badge('Sent', 'sent');
    if (s === 'failed') return badge('Failed', 'failed');
    if (s === 'pending') return badge('Pending', 'pending');
    if (s === 'cancelled' || s === 'canceled') return badge('Cancelled', 'cancelled');
    return badge(status || '—', 'pending');
  }

  function fmtShortDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString();
    } catch (_err) {
      return String(iso).slice(0, 10);
    }
  }

  function kindLabel(item) {
    const st = String(item.sourceType || '');
    if (st === 'first-shift-packet') return 'First-shift packet';
    if (st === 'orientation-route-offer') return 'Route offer';
    if (st === 'orientation-route-confirm') return 'Route confirmation';
    if (st === 'orientation-nudge') return 'Orientation nudge';
    if (st === 'orientation-nudge-staff') return 'Orientation nudge (staff)';
    if (st === 'employee-notice') {
      if (item.metadata?.kind === 'reply') return 'Employee reply';
      if (item.metadata?.kindLabel) return item.metadata.kindLabel;
      return 'Employee notice';
    }
    if (item.metadata?.kind === 'disregard') return 'Disregard notice';
    if (item.status === 'cancelled') return 'Welcome letter (cancelled)';
    return 'Welcome letter';
  }

  function deliveryBadge(delivery) {
    const d = String(delivery || 'unknown').toLowerCase();
    if (d === 'delivered') return badge('Delivered (MTA)', 'delivered');
    if (d === 'failed') return badge('Failed', 'failed');
    if (d === 'complained') return badge('Complained', 'complained');
    if (d === 'sent') return badge('In flight', 'sent');
    return badge(delivery || '—', 'pending');
  }

  function openedBadge(item) {
    if (item.openCount > 0) {
      const src = item.trackingSource === 'eod-api' ? ' (ours)' : '';
      return badge(`Opened${item.openCount > 1 ? ` ×${item.openCount}` : ''}${src}`, 'opened');
    }
    return badge('—', 'not-opened');
  }

  function formatEngagementEvents(events) {
    const list = Array.isArray(events) ? events : [];
    if (!list.length) return 'No beacon events yet';
    return list.slice(0, 12).map((ev) => {
      const when = fmtDate(ev.createdAt);
      if (ev.eventType === 'click') {
        return `${when} — click — ${ev.url || '(no url)'}`;
      }
      return `${when} — open`;
    }).join('; ');
  }

  async function loadHires() {
    const tbody = document.getElementById('hireRows');
    if (!tbody) return;
    try {
      const data = await api('/api/welcome-letter/hires');
      const items = data.items || [];
      chatState.hires = items;
      if (data.idleCutoff) state.idleCutoff = data.idleCutoff;
      paintAlertDots();
      fillChatSelect();
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="wb-muted">No hires ingested yet.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((h) => {
        const welcome = h.welcomeSentAt ? badge('Sent', 'sent') : badge('Pending', 'pending');
        const notices = Number(h.noticeCount || 0);
        const noticeKind = notices >= 7 ? 'failed' : notices >= 4 ? 'cancelled' : notices > 0 ? 'pending' : 'not-opened';
        const orientComplete = Boolean(h.orientationComplete);
        const orientBtn = orientComplete
          ? `<button type="button" class="wb-btn wb-btn-ghost wb-orient-btn" data-id="${escapeHtml(h.id)}" data-complete="0" style="padding:4px 10px;font-size:12px;">Yes — set No</button>`
          : `<button type="button" class="wb-btn wb-btn-primary wb-orient-btn" data-id="${escapeHtml(h.id)}" data-complete="1" style="padding:4px 10px;font-size:12px;">No — set Yes</button>`;
        const orientBadge = orientComplete ? badge('Complete', 'sent') : badge('Incomplete', 'pending');
        const routeBadge = h.routePreference
          ? badge(`Route ${h.routePreference}`, 'sent')
          : badge('—', 'not-opened');
        const routeDate = h.routeStartDate
          ? `<div class="wb-muted" style="font-size:12px;margin-top:4px;">${escapeHtml(h.routeStartDate)}</div>`
          : '';
        const paid = Boolean(h.orientationPaid);
        const paidDate = paid && h.orientationPaidAt
          ? `<div class="wb-muted" style="font-size:12px;margin-top:4px;">${escapeHtml(fmtShortDate(h.orientationPaidAt))}</div>`
          : '';
        const paidErr = h.orientationSasError
          ? `<div class="wb-muted" style="font-size:11px;color:#b00020;margin-top:4px;">${escapeHtml(h.orientationSasError)}</div>`
          : '';
        const paidBtn = paid
          ? `<button type="button" class="wb-btn wb-btn-ghost wb-paid-btn" data-id="${escapeHtml(h.id)}" data-paid="0" style="padding:4px 10px;font-size:12px;">Yes — set No</button>`
          : `<button type="button" class="wb-btn wb-btn-primary wb-paid-btn" data-id="${escapeHtml(h.id)}" data-paid="1" style="padding:4px 10px;font-size:12px;">No — set Yes</button>`;
        const paidBadge = paid ? badge('Yes', 'sent') : badge('No', 'pending');
        const chat = h.chatUrl
          ? `<div class="wb-chat-actions">
              <button type="button" class="wb-btn wb-btn-primary wb-reply-btn" data-id="${escapeHtml(h.id)}" data-name="${escapeHtml(h.firstName || h.fullName || 'hire')}" style="padding:4px 10px;font-size:12px;">Reply as staff</button>
              <a href="${escapeHtml(h.chatUrl)}" target="_blank" rel="noopener" class="wb-muted" style="font-size:12px;">Hire view (read-only)</a>
            </div>`
          : '—';
        return `<tr>
          <td>${escapeHtml(h.fullName || h.firstName || '—')}</td>
          <td>${escapeHtml(h.hireEmail || '—')}</td>
          <td>${escapeHtml(h.eid || '—')}</td>
          <td>${welcome}</td>
          <td>${orientBadge}<div style="margin-top:6px;">${orientBtn}</div></td>
          <td>${routeBadge}${routeDate}</td>
          <td>${paidBadge}${paidDate}${paidErr}<div style="margin-top:6px;">${paidBtn}</div></td>
          <td>${badge(String(notices), noticeKind)}</td>
          <td>${chat}</td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('.wb-orient-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const id = btn.dataset.id;
          const complete = btn.dataset.complete === '1';
          if (complete) {
            if (!window.confirm(
              'Mark orientation complete?\n\nThis will email the route offer (if needed) and build the 1-hour Orientation pay shift at store 999 (project 147) if not already paid.',
            )) return;
          }
          btn.disabled = true;
          try {
            await api(`/api/welcome-letter/hires/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                orientationComplete: complete,
                sendRouteOffer: complete,
                buildPayShift: complete,
              }),
            });
            await loadHires();
            showJustSentBanner({
              ok: true,
              message: complete
                ? 'Orientation marked complete (route offer + pay shift if needed).'
                : 'Orientation marked incomplete.',
            });
          } catch (err) {
            showJustSentBanner({ ok: false, message: err.message });
            btn.disabled = false;
          }
        });
      });

      tbody.querySelectorAll('.wb-paid-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const id = btn.dataset.id;
          const markPaid = btn.dataset.paid === '1';
          if (markPaid) {
            if (!window.confirm(
              'Mark Paid / build Orientation pay shift?\n\nCreates project 147 admin visit at store 999 (team Orientation), 1 hour, mileage off, then starts and completes the shift if one does not already exist.',
            )) return;
          }
          btn.disabled = true;
          try {
            await api(`/api/welcome-letter/hires/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ orientationPaid: markPaid }),
            });
            await loadHires();
            showJustSentBanner({
              ok: true,
              message: markPaid ? 'Paid marked (shift built/completed if needed).' : 'Paid cleared.',
            });
          } catch (err) {
            showJustSentBanner({ ok: false, message: err.message });
            btn.disabled = false;
          }
        });
      });

      tbody.querySelectorAll('.wb-reply-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openHireChat(btn.dataset.id, btn.dataset.name);
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" class="wb-muted">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderRows(items) {
    const tbody = document.getElementById('rows');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="wb-muted">No emails match these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const selected = item.id === state.selectedId ? ' is-selected' : '';
      const to = (item.to || []).join(', ');
      const firstName = item.metadata?.firstName || '—';
      let nameExtra = '';
      if (item.metadata?.kind === 'disregard') {
        nameExtra = ' <span class="wb-muted">(disregard)</span>';
      } else if (item.sourceType === 'orientation-route-offer') {
        nameExtra = ' <span class="wb-muted">(route offer)</span>';
      } else if (item.sourceType === 'orientation-route-confirm') {
        nameExtra = ' <span class="wb-muted">(route confirm)</span>';
      } else if (String(item.sourceType || '').startsWith('orientation-nudge')) {
        nameExtra = ' <span class="wb-muted">(nudge)</span>';
      }
      return `<tr data-id="${item.id}" class="${selected}">
        <td>${fmtDate(item.createdAt)}</td>
        <td>${statusBadge(item.status)}</td>
        <td>${deliveryBadge(item.deliveryStatus || item.lastEvent)}</td>
        <td>${openedBadge(item)}</td>
        <td>${escapeHtml(firstName)}${nameExtra}</td>
        <td>${escapeHtml(to || '—')}</td>
        <td class="wb-muted">${escapeHtml(item.sentByEmail || '—')}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => selectEmail(Number(row.dataset.id)));
    });
  }

  function sortIndicator(column) {
    if (state.sortBy !== column) return '';
    return state.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function updateSortHeaders() {
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      const col = th.dataset.sort;
      const label = th.dataset.label || th.textContent.replace(/[▲▼]/g, '').trim();
      th.textContent = `${label}${sortIndicator(col)}`;
      th.classList.toggle('is-sorted', state.sortBy === col);
    });
  }

  function onSortColumn(column) {
    if (state.sortBy === column) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortBy = column;
      state.sortDir = column === 'to' ? 'asc' : 'desc';
    }
    state.page = 1;
    updateSortHeaders();
    loadList();
  }

  function pushIdToUrl(id) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('id', String(id));
    else url.searchParams.delete('id');
    url.searchParams.delete('justSent');
    url.searchParams.delete('msg');
    window.history.replaceState(null, '', url.toString());
  }

  async function loadList() {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize),
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    });
    Object.entries(state.filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const data = await api(`${API_PREFIX}?${params.toString()}`);
    if (data.sortBy) state.sortBy = data.sortBy;
    if (data.sortDir) state.sortDir = data.sortDir;
    updateSortHeaders();
    state.total = data.total || 0;
    document.getElementById('listSummary').textContent = `${state.total} email(s)`;
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    document.getElementById('pageLabel').textContent = `Page ${state.page} / ${totalPages}`;
    document.getElementById('prevPage').disabled = state.page <= 1;
    document.getElementById('nextPage').disabled = state.page >= totalPages;
    renderRows(data.items || []);
  }

  async function selectEmail(id, { pushUrl = true } = {}) {
    state.selectedId = id;
    document.querySelectorAll('#rows tr[data-id]').forEach((row) => {
      row.classList.toggle('is-selected', Number(row.dataset.id) === id);
    });
    if (pushUrl) pushIdToUrl(id);
    try {
      const data = await api(`${API_PREFIX}/${id}`);
      renderDetail(data.item);
    } catch (e) {
      document.getElementById('detailEmpty').hidden = false;
      document.getElementById('detailEmpty').textContent = e.message;
      document.getElementById('detailBody').hidden = true;
    }
  }

  function renderDetail(item) {
    document.getElementById('detailEmpty').hidden = true;
    document.getElementById('detailBody').hidden = false;
    const meta = document.getElementById('detailMeta');

    const openedLine = item.openCount > 0
      ? `${item.openCount}× (first ${fmtDate(item.openedAt)})${item.trackingSource === 'eod-api' ? ' — eod-api beacon' : ''}`
      : 'Not opened yet';
    const clickedLine = item.clickCount > 0
      ? `${item.clickCount}× (first ${fmtDate(item.clickedAt)})`
      : 'No link clicks yet';

    const rows = [
      ['When', fmtDate(item.createdAt)],
      ['Type', kindLabel(item)],
      ['Status', item.status],
      ['Delivery', item.deliveryStatus || item.lastEvent || '—'],
      ['Last event', item.lastEvent || '—'],
      ['Opened', openedLine],
      ['Clicked', clickedLine],
      ['Tracking', item.trackingSource === 'eod-api' ? 'eod-api pixel + link wrap' : '—'],
      ['First Name', item.metadata?.firstName || '—'],
      ['From', item.from || '—'],
      ['To', (item.to || []).join(', ') || '—'],
      ['CC', (item.cc || []).join(', ') || '—'],
      ['Subject', item.subject || '—'],
      ['Sent By', item.sentByEmail || '—'],
      ['Resend ID', item.resendId || '—'],
      ['Can resend', item.canResend ? 'Yes' : 'No'],
      ['Can cancel', item.canCancel ? 'Yes' : 'No'],
      ['Engagement log', formatEngagementEvents(item.events)],
    ];
    if (item.metadata?.cancelledAt) {
      rows.push(['Cancelled at', fmtDate(item.metadata.cancelledAt)]);
      rows.push(['Cancelled by', item.metadata.cancelledBy || '—']);
    }
    if (item.errorMessage) rows.push(['Error', item.errorMessage]);
    meta.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');

    const iframe = document.getElementById('detailPreview');
    iframe.srcdoc = item.htmlBody || '<p style="font-family:sans-serif;color:#666;">No HTML body stored.</p>';

    const err = document.getElementById('detailError');
    err.hidden = true;
    err.textContent = '';

    const resendBtn = document.getElementById('resendBtn');
    resendBtn.disabled = !item.canResend;
    resendBtn.title = item.canResend
      ? 'Send this exact letter again'
      : (item.status === 'cancelled'
        ? 'Cancelled variants cannot be resent — send a new welcome letter'
        : 'Resend not available for this message');
    resendBtn.onclick = async () => {
      if (!item.canResend) return;
      if (!window.confirm(`Resend this email exactly as sent to ${(item.to || []).join(', ')}?`)) return;
      resendBtn.disabled = true;
      try {
        const result = await api(`${API_PREFIX}/${item.id}/resend`, { method: 'POST', body: '{}' });
        await loadList();
        if (result.recordId) await selectEmail(result.recordId);
        showJustSentBanner({ ok: true, message: `${kindLabel(item)} resent.` });
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      } finally {
        resendBtn.disabled = !item.canResend;
      }
    };

    const cancelBtn = document.getElementById('cancelBtn');
    const canCancel = Boolean(item.canCancel) && item.sourceType === 'welcome-letter';
    cancelBtn.disabled = !canCancel;
    cancelBtn.title = canCancel
      ? 'Mark cancelled, block resend of this variant, and email a disregard notice'
      : (item.sourceType !== 'welcome-letter'
        ? 'Cancel/disregard is only for welcome letters'
        : 'Already cancelled or not eligible');
    cancelBtn.onclick = async () => {
      if (!canCancel) return;
      const to = (item.to || []).join(', ') || 'recipient';
      const openedNote = item.openCount > 0
        ? '\n\nNote: our open beacon shows this may already have been opened. Cancel still marks it cancelled and sends the disregard notice, but we cannot remove the original from their inbox.'
        : '\n\nIf they have not opened it yet, they may still receive/see the original — cancel marks it in our board and sends a polite disregard notice.';
      if (!window.confirm(
        `Cancel this welcome letter to ${to}?\n\n`
        + '• Marks it Cancelled on the board\n'
        + '• Blocks exact resend of this variant\n'
        + '• Sends a polite "please disregard" email (tools & contacts updating)'
        + openedNote,
      )) return;

      cancelBtn.disabled = true;
      resendBtn.disabled = true;
      try {
        const result = await api(`${API_PREFIX}/${item.id}/cancel`, { method: 'POST', body: '{}' });
        await loadList();
        await selectEmail(item.id);
        const disregardNote = result.disregardSent
          ? ' Disregard notice sent.'
          : (result.error ? ` ${result.error}` : ' Disregard notice may have failed.');
        showJustSentBanner({
          ok: Boolean(result.disregardSent),
          message: `Welcome letter cancelled.${disregardNote}`,
        });
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
        cancelBtn.disabled = !canCancel;
        resendBtn.disabled = !item.canResend;
      }
    };
  }

  async function refreshFromResend() {
    const btn = document.getElementById('refreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
    }
    try {
      const result = await api(`${API_PREFIX}/refresh`, { method: 'POST', body: '{}' });
      await loadList();
      if (state.selectedId) await selectEmail(state.selectedId, { pushUrl: false });
      const opens = result.opensFound != null ? ` (${result.opensFound} Resend last_event open/click — use eod-api beacon for opens)` : '';
      showJustSentBanner({
        ok: true,
        message: `Refreshed delivery from Resend: checked ${result.checked || 0}, updated ${result.updated || 0}${opens}. Opens/clicks on this board come from eod-api beacons.`,
      });
    } catch (e) {
      showJustSentBanner({ ok: false, message: `Refresh failed: ${e.message}` });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh delivery (Resend)';
      }
    }
  }

  function readFiltersFromForm() {
    state.filters = {
      search: document.getElementById('search').value.trim(),
      status: document.getElementById('status').value,
      deliveryStatus: document.getElementById('deliveryStatus').value,
    };
    state.page = 1;
  }

  function showJustSentBanner({ ok, message }) {
    const el = document.getElementById('justSentBanner');
    el.classList.remove('wb-hidden', 'ok', 'err');
    el.classList.add(ok ? 'ok' : 'err');
    el.textContent = message;
  }

  function renderChatMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return '<p class="wb-muted">No messages yet.</p>';
    return list.map((m) => {
      const cls = m.sender_role === 'hire' ? 'hire' : (m.sender_role === 'staff' ? 'staff' : 'system');
      const when = m.created_at ? fmtDate(m.created_at) : '';
      const who = escapeHtml(m.sender_name || m.sender_role || '—');
      const body = escapeHtml(m.body || '');
      return `<div class="wb-chat-msg ${cls}"><div class="wb-muted" style="font-size:12px;margin-bottom:4px;">${who} · ${escapeHtml(when)}</div>${body}</div>`;
    }).join('');
  }

  async function openHireChat(hireId, hireName) {
    state.activeHireChatId = hireId;
    const modal = document.getElementById('hireChatModal');
    const title = document.getElementById('hireChatTitle');
    const log = document.getElementById('hireChatLog');
    const status = document.getElementById('hireChatStatus');
    const compose = document.getElementById('hireChatCompose');
    if (!modal || !log) return;
    title.textContent = `Staff reply — ${hireName || 'hire'}`;
    compose.value = '';
    status.textContent = 'Loading…';
    modal.hidden = false;
    modal.classList.remove('wb-hidden');
    try {
      const data = await api(`/api/welcome-letter/hires/${encodeURIComponent(hireId)}`);
      log.innerHTML = renderChatMessages(data.messages);
      log.scrollTop = log.scrollHeight;
      status.textContent = state.signedInEmail
        ? `Signed in as ${state.signedInEmail} — your reply will show as staff, not as ${hireName}.`
        : '';
      markChatRead(hireId).catch(() => {});
    } catch (err) {
      log.innerHTML = '';
      status.textContent = err.message;
    }
  }

  function closeHireChat() {
    const modal = document.getElementById('hireChatModal');
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('wb-hidden');
    state.activeHireChatId = null;
  }

  async function sendHireChatReply() {
    const hireId = state.activeHireChatId;
    const compose = document.getElementById('hireChatCompose');
    const status = document.getElementById('hireChatStatus');
    const log = document.getElementById('hireChatLog');
    const btn = document.getElementById('hireChatSend');
    if (!hireId || !compose) return;
    const body = compose.value.trim();
    if (!body) return;
    btn.disabled = true;
    status.textContent = 'Sending…';
    try {
      const data = await api(`/api/welcome-letter/hires/${encodeURIComponent(hireId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      compose.value = '';
      const refreshed = await api(`/api/welcome-letter/hires/${encodeURIComponent(hireId)}`);
      log.innerHTML = renderChatMessages(refreshed.messages);
      log.scrollTop = log.scrollHeight;
      status.textContent = 'Sent.';
      if (data.message) {
        /* refresh hire table optional */
      }
    } catch (err) {
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function ensureWelcomeAccess() {
    try {
      if (window.dumpBinAuthReady) await window.dumpBinAuthReady;
      const fetchFn = window.dumpBinAuthFetch || fetch;
      let res = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetchFn('/api/me', { noBounceOn401: true, credentials: 'include' });
        } catch (_err) {
          res = null;
        }
        if (res && (res.ok || res.status === 401 || res.status === 403)) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 700));
      }
      if (res && res.status === 401) {
        if (window.dumpBinAuth && window.dumpBinAuth.bounceToSignIn) {
          window.dumpBinAuth.bounceToSignIn('employee board');
        }
        return 'session';
      }
      if (!res || !res.ok) return 'unreachable';
      const me = await res.json();
      state.signedInEmail = me?.email || null;
      const signedEl = document.getElementById('signedInAs');
      if (signedEl && state.signedInEmail) {
        signedEl.textContent = `Signed in as ${state.signedInEmail}`;
        signedEl.hidden = false;
      }
      return (me && me.hasWelcomeLetterAccess) ? 'ok' : 'denied';
    } catch (_err) {
      return 'unreachable';
    }
  }

  function showAccessDenied(reason) {
    const denied = document.getElementById('wbAccessDenied');
    const app = document.getElementById('wbApp');
    if (app) app.hidden = true;
    if (!denied) return;
    const note = denied.querySelector('p');
    if (note) {
      note.textContent = reason === 'unreachable'
        ? 'The board could not check access. Refresh the page.'
        : 'The Employee Board is limited to authorized supervisors. If you need access, contact Tyson Gauthier.';
    }
    denied.classList.remove('wb-hidden');
  }

  async function boot() {
    if (window.dumpBinAuthReady) await window.dumpBinAuthReady;
    setVersionBadge(null);

    const access = await ensureWelcomeAccess();
    if (access === 'session') return;
    if (access !== 'ok') {
      showAccessDenied(access);
      return;
    }
    const denied = document.getElementById('wbAccessDenied');
    const app = document.getElementById('wbApp');
    if (denied) denied.classList.add('wb-hidden');
    if (app) app.hidden = false;
    refreshApiVersion();

    const url = new URL(window.location.href);
    const justSent = url.searchParams.get('justSent');
    const msg = url.searchParams.get('msg');
    const idParam = url.searchParams.get('id');

    if (justSent !== null) {
      showJustSentBanner({
        ok: justSent === '1',
        message: msg || (justSent === '1' ? 'Welcome letter sent.' : 'Welcome letter send failed.'),
      });
    }

    document.getElementById('filterForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      readFiltersFromForm();
      await loadList();
    });
    document.getElementById('clearFilters').addEventListener('click', async () => {
      document.getElementById('search').value = '';
      document.getElementById('status').value = '';
      document.getElementById('deliveryStatus').value = '';
      readFiltersFromForm();
      await loadList();
    });
    document.getElementById('prevPage').addEventListener('click', async () => {
      if (state.page > 1) { state.page -= 1; await loadList(); }
    });
    document.getElementById('nextPage').addEventListener('click', async () => {
      state.page += 1;
      await loadList();
    });
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => onSortColumn(th.dataset.sort));
    });
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshFromResend().catch((e) => {
          showJustSentBanner({ ok: false, message: e.message });
        });
      });
    }
    const hireChatClose = document.getElementById('hireChatClose');
    const hireChatSend = document.getElementById('hireChatSend');
    const hireChatModal = document.getElementById('hireChatModal');
    if (hireChatClose) hireChatClose.addEventListener('click', closeHireChat);
    if (hireChatSend) hireChatSend.addEventListener('click', () => sendHireChatReply().catch(() => {}));
    if (hireChatModal) {
      hireChatModal.addEventListener('click', (e) => {
        if (e.target === hireChatModal) closeHireChat();
      });
    }
    updateSortHeaders();
    initReferrals();

    await loadHires();
    await loadEmployees();
    await loadList();

    if (idParam) {
      await selectEmail(Number(idParam), { pushUrl: false });
    }
  }

  const employeeState = { selected: null, items: [] };

  function noticePayload() {
    const emp = employeeState.selected;
    if (!emp) return null;
    return {
      kind: document.getElementById('noticeKind').value,
      employeeId: emp.employeeId,
      email: contactEmail(emp),
      fullName: emp.name,
      firstName: (emp.preferredName || emp.name || '').split(/\s+/)[0],
      lastWorkedOn: document.getElementById('noticeLastWorked').value,
      initialNoticeDate: document.getElementById('noticeInitialDate').value,
      scheduledDate: document.getElementById('noticeShiftDate').value,
      scheduledTime: document.getElementById('noticeShiftTime').value,
    };
  }

  function syncNoticeFields() {
    const kind = document.getElementById('noticeKind').value;
    document.getElementById('lastWorkedWrap').classList.toggle('wb-hidden', kind !== 'noncomm-initial');
    document.getElementById('initialDateWrap').classList.toggle('wb-hidden', kind !== 'noncomm-final');
    document.getElementById('shiftWrap').classList.toggle('wb-hidden', kind !== 'job-abandonment');
  }

  let noticeDraftKey = '';
  let noticeDraftStale = false;

  function noticeFieldKey(payload) {
    return JSON.stringify([
      payload.kind,
      payload.employeeId,
      payload.email,
      payload.lastWorkedOn,
      payload.initialNoticeDate,
      payload.scheduledDate,
      payload.scheduledTime,
    ]);
  }

  function clearNoticeDraft() {
    noticeDraftKey = '';
    noticeDraftStale = false;
    const wrap = document.getElementById('noticePreviewWrap');
    const frame = document.getElementById('noticePreview');
    const subject = document.getElementById('noticeSubject');
    if (wrap) wrap.classList.add('wb-hidden');
    if (frame) {
      frame.onload = null;
      frame.srcdoc = '';
      frame.style.height = '';
    }
    if (subject) subject.value = '';
  }

  function markNoticeStale() {
    if (!noticeDraftKey) return;
    const payload = noticePayload();
    if (!payload || noticeFieldKey(payload) === noticeDraftKey) {
      noticeDraftStale = false;
      return;
    }
    noticeDraftStale = true;
    const status = document.getElementById('noticeStatus');
    if (status) status.textContent = 'Preview again before sending.';
  }

  function fitNoticeFrame(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0, 320);
    frame.style.height = `${h}px`;
  }

  function prepareNoticeFrame(frame) {
    const doc = frame.contentDocument;
    if (!doc || !doc.body || doc.body.dataset.noticeReady === '1') return;
    doc.body.dataset.noticeReady = '1';
    const style = doc.createElement('style');
    style.setAttribute('data-notice-editor', '1');
    style.textContent = [
      'td[data-notice="body"], td[data-notice="signature"], td[data-notice="addendum"] { outline: none; }',
      'td[data-notice="body"]:focus, td[data-notice="signature"]:focus, td[data-notice="addendum"]:focus { background: #F7FBFF; }',
      'td[data-notice="addendum"]:empty:before { content: attr(data-placeholder); color: #8A9AAB; }',
    ].join('\n');
    doc.head.appendChild(style);
    doc.querySelectorAll('[data-notice="body"], [data-notice="signature"], [data-notice="addendum"]').forEach((el) => {
      el.setAttribute('contenteditable', 'true');
    });
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      const sel = doc.getSelection();
      const node = sel && sel.anchorNode;
      const cell = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!cell || !cell.closest || !cell.closest('[contenteditable="true"]')) return;
      event.preventDefault();
      doc.execCommand('insertLineBreak');
    });
    doc.addEventListener('input', () => fitNoticeFrame(frame));
    fitNoticeFrame(frame);
  }

  function armNoticeDraft(frame, key) {
    if (!frame.contentDocument || !frame.contentDocument.querySelector('[data-notice="body"]')) return;
    prepareNoticeFrame(frame);
    noticeDraftKey = key;
    noticeDraftStale = false;
  }

  function readNoticeDraft() {
    const frame = document.getElementById('noticePreview');
    const doc = frame && frame.contentDocument;
    if (!doc || !doc.documentElement || !doc.body) return null;
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('style[data-notice-editor]').forEach((el) => el.remove());
    const subject = document.getElementById('noticeSubject');
    return {
      editedHtml: `<!DOCTYPE html>\n${clone.outerHTML}`,
      editedText: String(doc.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim(),
      editedSubject: subject ? subject.value.trim() : '',
    };
  }

  function renderEmployeeThread(items) {
    const el = document.getElementById('employeeThread');
    if (!items.length) {
      el.textContent = 'No notices yet.';
      return;
    }
    el.innerHTML = items.map((item) => {
      const who = item.kind === 'reply'
        ? `${item.from || 'Associate'}${item.fromNote ? ` — ${item.fromNote}` : ''}`
        : (item.sentByEmail || 'Staff');
      const label = item.kind === 'reply' ? 'Reply' : (item.metadata?.kindLabel || item.kind || 'Notice');
      return `<button type="button" class="wb-thread-item${employeeState.openNoticeId === item.id ? ' is-open' : ''}" data-id="${escapeHtml(item.id)}">
        <div><strong>${escapeHtml(label)}</strong> · ${escapeHtml(fmtDate(item.sentAt))}</div>
        <div class="wb-muted">${escapeHtml(item.subject || who)}</div>
      </button>`;
    }).join('');
  }

  async function loadEmployeeThread(emp) {
    const el = document.getElementById('employeeThread');
    el.textContent = 'Loading…';
    const q = new URLSearchParams();
    if (emp.employeeId) q.set('employeeId', String(emp.employeeId));
    else if (emp.email) q.set('email', emp.email);
    const data = await api(`/api/welcome-letter/employees/notices?${q.toString()}`);
    const items = data.items || [];
    renderEmployeeThread(items);
    const initial = items.find((item) => item.kind === 'noncomm-initial');
    if (initial && initial.sentAt) {
      document.getElementById('noticeInitialDate').value = String(initial.sentAt).slice(0, 10);
    }
  }

  let workLoadToken = 0;

  function listText(values) {
    const list = (Array.isArray(values) ? values : [values]).map((v) => String(v || '').trim()).filter(Boolean);
    return list.length ? list.join(', ') : '';
  }

  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (local.length !== 10) return String(value || '').trim();
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }

  function phoneText(values) {
    const list = (Array.isArray(values) ? values : [values]).map(formatPhone).filter(Boolean);
    return list.length ? list.join(', ') : '';
  }

  function contactEmail(emp) {
    return listText(emp.personalEmails) || listText(emp.workEmails) || emp.email || '';
  }

  function punchLabel(emp) {
    const day = emp.lastPunchOn || emp.lastLoggedOn || emp.lastWorkedOn || '';
    if (!day) return '—';
    return emp.lastPunchTime ? `${day} · ${emp.lastPunchTime}` : day;
  }

  function toneClass(tone) {
    if (tone === 'final') return 'is-final';
    if (tone === 'open') return 'is-open';
    if (tone === 'stale') return 'is-stale';
    return '';
  }

  function prodWorkforceUrl(employeeId) {
    return `https://prod.sasretail.com/en/sasretail/workforce/full-profile/${encodeURIComponent(employeeId)}`;
  }

  function fmtHours(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 100) / 100);
  }

  function fmtMoney(value) {
    const n = Number(value);
    return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
  }

  function renderWorkHistory(panel, data) {
    const summary = data.summary || {};
    const rows = data.rows || [];
    const range = `${summary.from || data.from || ''} – ${summary.to || data.to || ''}`;
    const headline = [
      `${summary.days || 0} days`,
      `${fmtHours(summary.totalHours)} payroll hours`,
      `${fmtHours(summary.regularHours)} regular`,
      `${fmtHours(summary.overtimeHours)} overtime`,
      `${fmtHours(summary.doubleHours)} double`,
      `${fmtMoney(summary.travelDollars)} travel`,
      `${fmtHours(summary.travelHours)} travel hrs`,
      `${fmtMoney(summary.perDiem)} per diem`,
      `${summary.approved || 0} approved`,
      `${summary.unapproved || 0} unapproved`,
    ].join(' · ');
    const body = rows.length
      ? rows.map((row) => `<tr>
          <td>${escapeHtml(row.executedOn || '—')}</td>
          <td>${escapeHtml(row.reportedOn || '—')}</td>
          <td>${escapeHtml(fmtHours(row.totalHours))}</td>
          <td>${escapeHtml(fmtHours(row.overtimeHours))}</td>
          <td>${escapeHtml(fmtMoney(row.travelDollars))}</td>
          <td>${row.approved ? 'Approved' : 'Unapproved'}</td>
        </tr>`).join('')
      : '<tr><td colspan="6">No workforce history</td></tr>';
    panel.classList.remove('wb-muted');
    panel.innerHTML = `<h4 style="margin:0 0 6px;color:var(--wb-navy);">Time logged</h4>
      <p class="wb-muted" style="margin:0 0 8px;font-size:13px;">${escapeHtml(range)}</p>
      <p class="wb-work-summary">${escapeHtml(headline)}</p>
      <div class="wb-work-scroll">
        <table class="wb-table">
          <thead>
            <tr>
              <th>Executed</th>
              <th>Reported</th>
              <th>Hours</th>
              <th>OT</th>
              <th>Travel</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function applyWorkBounds(data) {
    const from = document.getElementById('workFrom');
    const to = document.getElementById('workTo');
    if (!from || !to || !data) return;
    if (data.earliest) {
      from.min = data.earliest;
      to.min = data.earliest;
    }
    if (data.today) {
      from.max = data.today;
      to.max = data.today;
    }
    if (data.from) from.value = data.from;
    if (data.to) to.value = data.to;
  }

  async function loadWorkHistory(emp, range) {
    const panel = document.getElementById('workPanel');
    const token = ++workLoadToken;
    panel.classList.add('wb-muted');
    panel.textContent = 'Loading…';
    try {
      const q = new URLSearchParams();
      if (range && range.from) q.set('from', range.from);
      if (range && range.to) q.set('to', range.to);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      const data = await api(`/api/welcome-letter/employees/${encodeURIComponent(emp.employeeId)}/work${suffix}`);
      if (token !== workLoadToken) return;
      applyWorkBounds(data);
      renderWorkHistory(panel, data);
    } catch (err) {
      if (token !== workLoadToken) return;
      panel.classList.add('wb-muted');
      panel.textContent = err.message;
    }
  }

  function selectEmployee(emp) {
    employeeState.selected = emp;
    document.getElementById('employeeEmpty').hidden = true;
    document.getElementById('employeeBody').hidden = false;
    document.getElementById('employeeName').textContent = emp.name || 'Employee';
    const personal = listText(emp.personalEmails);
    const work = listText(emp.workEmails);
    const phone = phoneText(emp.phones && emp.phones.length ? emp.phones : [emp.phone]);
    const bits = [];
    if (personal) bits.push(`Personal ${escapeHtml(personal)}`);
    if (work) bits.push(`Work ${escapeHtml(work)}`);
    if (!personal && !work && emp.email) bits.push(escapeHtml(emp.email));
    if (phone) bits.push(escapeHtml(phone));
    if (emp.title) bits.push(escapeHtml(emp.title));
    document.getElementById('employeeMeta').innerHTML = bits.join('<br>');
    syncLoaButton(document.getElementById('loaBtn'), emp);
    document.getElementById('noticeLastWorked').value = emp.lastPunchOn || emp.lastLoggedOn || emp.lastWorkedOn || '';
    document.getElementById('noticeStatus').textContent = '';
    clearNoticeDraft();
    closeNoticeCopy();
    document.querySelectorAll('#employeeRows tr').forEach((tr) => {
      tr.classList.toggle('is-selected', String(tr.dataset.id) === String(emp.employeeId));
    });
    const from = document.getElementById('workFrom');
    const to = document.getElementById('workTo');
    if (from) from.value = '';
    if (to) to.value = '';
    syncNoticeFields();
    loadWorkHistory(emp);
    loadEmployeeThread(emp).catch((err) => {
      document.getElementById('employeeThread').textContent = err.message;
    });
  }

  function pacificTodayYmd() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function addDaysYmd(ymd, delta) {
    const parts = String(ymd || '').split('-').map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return '';
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
  }

  function pacificYmdFromIso(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function idleCutoffYmd() {
    return state.idleCutoff || addDaysYmd(pacificTodayYmd(), -7);
  }

  function digits10(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 10) return '';
    return digits.slice(-10);
  }

  function normPersonName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function seenHires() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('wbHireSeen') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  function markHireSeen(hireId) {
    if (!hireId) return;
    const map = seenHires();
    map[hireId] = new Date().toISOString();
    try {
      window.localStorage.setItem('wbHireSeen', JSON.stringify(map));
    } catch (_err) { /* private mode */ }
  }

  function hireIsNew(hire) {
    if (!hire) return false;
    if (hire.staffReadAt) return false;
    if (seenHires()[hire.id]) return false;
    if (typeof hire.isNew === 'boolean') return hire.isNew;
    const created = pacificYmdFromIso(hire.createdAt);
    if (!created) return false;
    return created >= idleCutoffYmd();
  }

  function employeeNoTime(emp) {
    if (!emp || emp.onLoa) return false;
    if (typeof emp.noTimeInSevenDays === 'boolean') return emp.noTimeInSevenDays;
    const punch = emp.lastPunchOn || '';
    return !punch || punch < idleCutoffYmd();
  }

  function matchHireForEmployee(emp, hires) {
    const list = hires || [];
    if (emp.hireId) {
      const linked = list.find((hire) => hire.id === emp.hireId);
      if (linked) return linked;
    }
    const emails = new Set(
      [emp.email].concat(emp.personalEmails || []).concat(emp.workEmails || [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const phones = new Set(
      [].concat(emp.phones || []).concat(emp.phone ? [emp.phone] : []).map(digits10).filter(Boolean),
    );
    const names = new Set([normPersonName(emp.name), normPersonName(emp.preferredName)].filter(Boolean));
    const hits = list.filter((hire) => {
      const email = String(hire.hireEmail || '').trim().toLowerCase();
      if (email && emails.has(email)) return true;
      const phone = digits10(hire.phone);
      if (phone && phones.has(phone)) return true;
      const name = normPersonName(hire.fullName);
      return Boolean(name && names.has(name));
    });
    hits.sort((a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0));
    return hits[0] || null;
  }

  function setTabDot(id, count, title) {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(count) || 0;
    if (n < 1) {
      el.hidden = true;
      el.textContent = '';
      el.title = '';
      return;
    }
    el.hidden = false;
    el.textContent = n > 99 ? '99+' : String(n);
    el.title = title || '';
  }

  function paintAlertDots() {
    const employees = employeeState.items || [];
    const hires = chatState.hires || [];
    const noTime = employees.filter(employeeNoTime).length;
    const fresh = hires.filter(hireIsNew).length;
    const unread = hires.reduce((sum, hire) => sum + Number(hire.unreadCount || 0), 0);
    const boardTitle = [
      fresh ? `${fresh} new hire${fresh === 1 ? '' : 's'}` : '',
      noTime ? `${noTime} with no time in 7 days` : '',
    ].filter(Boolean).join(', ');
    setTabDot('boardDot', noTime + fresh, boardTitle);
    setTabDot('chatDot', unread, unread ? `${unread} new message${unread === 1 ? '' : 's'}` : '');
  }

  function syncLoaButton(btn, person) {
    if (!btn) return;
    if (!person || !person.employeeId) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.textContent = person.onLoa ? 'Clear leave' : 'Mark leave';
    btn.dataset.on = person.onLoa ? '1' : '0';
    btn.dataset.id = String(person.employeeId);
    btn.dataset.name = person.preferredName || person.name || '';
  }

  function renderEmployeeRows() {
    const tbody = document.getElementById('employeeRows');
    if (!tbody) return;
    const items = employeeState.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="wb-muted">No direct reports returned.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((emp) => `<tr data-id="${escapeHtml(emp.employeeId)}" class="${toneClass(emp.tone)}">
      <td><span class="wb-name-line"><span>${escapeHtml(emp.preferredName || emp.name)}</span>${emp.onLoa ? '<span class="wb-loa">On leave</span>' : ''}<a class="wb-prod-link" href="${prodWorkforceUrl(emp.employeeId)}" target="_blank" rel="noopener">Open profile</a></span></td>
      <td>${escapeHtml(punchLabel(emp))}</td>
    </tr>`).join('');
    tbody.querySelectorAll('tr').forEach((tr) => {
      const link = tr.querySelector('.wb-prod-link');
      if (link) link.addEventListener('click', (event) => event.stopPropagation());
      tr.addEventListener('click', () => {
        const emp = employeeState.items.find((e) => String(e.employeeId) === tr.dataset.id);
        if (emp) selectEmployee(emp);
      });
      if (employeeState.selected && String(tr.dataset.id) === String(employeeState.selected.employeeId)) {
        tr.classList.add('is-selected');
      }
    });
  }

  async function toggleEmployeeLoa(employeeId, name, currentlyOn) {
    const data = await api(`/api/welcome-letter/employees/${encodeURIComponent(employeeId)}/loa`, {
      method: 'POST',
      body: JSON.stringify({ onLoa: !currentlyOn, name: name || '' }),
    });
    const emp = employeeState.items.find((item) => String(item.employeeId) === String(employeeId));
    if (emp) {
      emp.onLoa = Boolean(data.onLoa);
      const punch = emp.lastPunchOn || '';
      emp.noTimeInSevenDays = emp.onLoa ? false : (!punch || punch < idleCutoffYmd());
      if (employeeState.selected && String(employeeState.selected.employeeId) === String(employeeId)) {
        employeeState.selected.onLoa = emp.onLoa;
        employeeState.selected.noTimeInSevenDays = emp.noTimeInSevenDays;
      }
    }
    renderEmployeeRows();
    syncLoaButton(document.getElementById('loaBtn'), employeeState.selected);
    fillChatSelect();
    if (chatState.employeeId && String(chatState.employeeId) === String(employeeId)) {
      syncLoaButton(document.getElementById('chatLoaBtn'), {
        employeeId,
        name,
        onLoa: Boolean(data.onLoa),
      });
    }
    paintAlertDots();
  }

  function chatChoices() {
    const employees = employeeState.items || [];
    const hires = chatState.hires || [];
    const used = new Set();
    const rows = employees.map((emp) => {
      const hire = matchHireForEmployee(emp, hires);
      if (hire) used.add(hire.id);
      return {
        key: `emp:${emp.employeeId}`,
        employeeId: String(emp.employeeId),
        hireId: hire ? hire.id : '',
        name: emp.preferredName || emp.name || 'Employee',
        onLoa: Boolean(emp.onLoa),
        unread: Number((hire && hire.unreadCount) || emp.unreadCount || 0),
      };
    });
    hires.forEach((hire) => {
      if (!hire || used.has(hire.id)) return;
      rows.push({
        key: `hire:${hire.id}`,
        employeeId: '',
        hireId: hire.id,
        name: hire.fullName || hire.firstName || 'Hire',
        onLoa: false,
        unread: Number(hire.unreadCount || 0),
      });
    });
    rows.sort((a, b) => (b.unread - a.unread) || a.name.localeCompare(b.name));
    return rows;
  }

  function choiceLabel(choice) {
    const bits = [choice.name];
    if (choice.onLoa) bits.push('LOA');
    if (choice.unread) bits.push(String(choice.unread));
    return bits.join(' · ');
  }

  function fillChatSelect() {
    const select = document.getElementById('chatEmployee');
    if (!select) return;
    bindChatSelect();
    const current = chatState.employeeId
      ? `emp:${chatState.employeeId}`
      : (chatState.hireId ? `hire:${chatState.hireId}` : select.value);
    const rows = chatChoices();
    select.innerHTML = '<option value="">Select an employee</option>' + rows.map((row) => (
      `<option value="${escapeHtml(row.key)}">${escapeHtml(choiceLabel(row))}</option>`
    )).join('');
    if (rows.some((row) => row.key === current)) select.value = current;
  }

  let chatSelectBound = false;
  function bindChatSelect() {
    if (chatSelectBound) return;
    const select = document.getElementById('chatEmployee');
    if (!select) return;
    chatSelectBound = true;
    select.addEventListener('change', () => {
      const choice = chatChoices().find((row) => row.key === select.value);
      if (!choice) {
        chatState.hireId = null;
        chatState.employeeId = null;
        const body = document.getElementById('chatBody');
        if (body) body.hidden = true;
        return;
      }
      openTabChat(choice).catch((err) => {
        const status = document.getElementById('chatStatus');
        if (status) status.textContent = err.message;
      });
    });
  }

  async function markChatRead(hireId) {
    if (!hireId) return;
    markHireSeen(hireId);
    const hire = (chatState.hires || []).find((item) => item.id === hireId);
    if (hire) {
      hire.staffReadAt = hire.staffReadAt || new Date().toISOString();
      hire.isNew = false;
      hire.unreadCount = 0;
    }
    paintAlertDots();
    fillChatSelect();
    try {
      await api(`/api/welcome-letter/hires/${encodeURIComponent(hireId)}/read`, {
        method: 'POST',
        body: '{}',
      });
    } catch (_err) { /* read route arrives with the API */ }
  }

  async function openTabChat(choice) {
    chatState.hireId = choice.hireId || null;
    chatState.employeeId = choice.employeeId || null;
    const body = document.getElementById('chatBody');
    const name = document.getElementById('chatName');
    const log = document.getElementById('chatLog');
    const compose = document.getElementById('chatCompose');
    const send = document.getElementById('chatSend');
    const status = document.getElementById('chatStatus');
    if (body) body.hidden = false;
    if (name) name.textContent = choice.name || 'Employee';
    syncLoaButton(document.getElementById('chatLoaBtn'), choice.employeeId ? {
      employeeId: choice.employeeId,
      name: choice.name,
      preferredName: choice.name,
      onLoa: choice.onLoa,
    } : null);
    if (!choice.hireId) {
      if (log) log.innerHTML = '<p class="wb-muted">No chat on file.</p>';
      if (compose) compose.hidden = true;
      if (send) send.hidden = true;
      if (status) status.textContent = '';
      return;
    }
    if (compose) {
      compose.hidden = false;
      compose.value = '';
    }
    if (send) send.hidden = false;
    if (status) status.textContent = 'Loading…';
    const data = await api(`/api/welcome-letter/hires/${encodeURIComponent(choice.hireId)}`);
    if (chatState.hireId !== choice.hireId) return;
    if (log) {
      log.innerHTML = renderChatMessages(data.messages);
      log.scrollTop = log.scrollHeight;
    }
    if (status) status.textContent = '';
    await markChatRead(choice.hireId);
  }

  async function sendTabChat() {
    const hireId = chatState.hireId;
    const compose = document.getElementById('chatCompose');
    const status = document.getElementById('chatStatus');
    const log = document.getElementById('chatLog');
    const btn = document.getElementById('chatSend');
    if (!hireId || !compose) return;
    const body = compose.value.trim();
    if (!body) return;
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Sending…';
    try {
      await api(`/api/welcome-letter/hires/${encodeURIComponent(hireId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      compose.value = '';
      const refreshed = await api(`/api/welcome-letter/hires/${encodeURIComponent(hireId)}`);
      if (log) {
        log.innerHTML = renderChatMessages(refreshed.messages);
        log.scrollTop = log.scrollHeight;
      }
      if (status) status.textContent = 'Sent.';
      await markChatRead(hireId);
    } catch (err) {
      if (status) status.textContent = err.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadEmployees(refresh) {
    const tbody = document.getElementById('employeeRows');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="2" class="wb-muted">Loading…</td></tr>';
    try {
      const data = await api(`/api/welcome-letter/employees${refresh ? '?refresh=1' : ''}`);
      employeeState.items = data.employees || [];
      if (data.idleCutoff) state.idleCutoff = data.idleCutoff;
      renderEmployeeRows();
      paintAlertDots();
      fillChatSelect();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="2" class="wb-error">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function previewNotice() {
    const status = document.getElementById('noticeStatus');
    const payload = noticePayload();
    if (!payload) return;
    status.textContent = 'Building preview…';
    const data = await api('/api/welcome-letter/employees/notice/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const frame = document.getElementById('noticePreview');
    const key = noticeFieldKey(payload);
    noticeDraftKey = '';
    frame.onload = () => armNoticeDraft(frame, key);
    frame.srcdoc = String(data.html || '').replace('</body>', `<!--${Date.now()}--></body>`);
    document.getElementById('noticeSubject').value = data.subject || '';
    document.getElementById('noticePreviewWrap').classList.remove('wb-hidden');
    const copies = data.cc || data.bcc || [];
    status.textContent = `Reply-to ${data.replyTo}. CC ${copies.join(', ')}.`;
  }

  async function sendNotice() {
    const status = document.getElementById('noticeStatus');
    const payload = noticePayload();
    if (!payload) return;
    if (!noticeDraftKey || noticeDraftStale || noticeFieldKey(payload) !== noticeDraftKey) {
      status.textContent = 'Preview again before sending.';
      return;
    }
    const draft = readNoticeDraft();
    if (!draft || !draft.editedHtml) {
      status.textContent = 'Preview again before sending.';
      return;
    }
    if (!window.confirm(`Send this notice to ${payload.email}?`)) return;
    status.textContent = 'Sending…';
    const data = await api('/api/welcome-letter/employees/notice/send', {
      method: 'POST',
      body: JSON.stringify({ ...payload, ...draft }),
    });
    noticeDraftKey = '';
    status.textContent = `Sent to ${data.to}.`;
    if (employeeState.selected) await loadEmployeeThread(employeeState.selected);
    await loadList();
  }

  function closeNoticeCopy() {
    employeeState.openNoticeId = null;
    const wrap = document.getElementById('noticeCopy');
    const frame = document.getElementById('noticeCopyFrame');
    if (wrap) {
      wrap.hidden = true;
      wrap.classList.add('wb-hidden');
    }
    if (frame) frame.srcdoc = '';
  }

  async function openNoticeCopy(id) {
    const wrap = document.getElementById('noticeCopy');
    const meta = document.getElementById('noticeCopyMeta');
    const frame = document.getElementById('noticeCopyFrame');
    if (!wrap || !frame) return;
    wrap.hidden = false;
    wrap.classList.remove('wb-hidden');
    if (meta) meta.textContent = 'Loading…';
    frame.srcdoc = '';
    const data = await api(`/api/welcome-letter/employees/notices/${encodeURIComponent(id)}`);
    employeeState.openNoticeId = data.id;
    employeeState.openNoticeFile = `${String(data.subject || 'notice').replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'notice'}.eml`;
    const copies = [].concat(data.to || [], data.cc || []).filter(Boolean);
    if (meta) {
      meta.textContent = [data.subject, data.from, copies.join(', '), fmtDate(data.sentAt)].filter(Boolean).join(' · ');
    }
    const html = data.html || `<pre style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif;padding:16px;">${escapeHtml(data.text || '')}</pre>`;
    frame.onload = () => {
      const doc = frame.contentDocument;
      const h = doc ? Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0, 320) : 320;
      frame.style.height = `${h}px`;
    };
    frame.srcdoc = html;
    document.querySelectorAll('.wb-thread-item').forEach((btn) => {
      btn.classList.toggle('is-open', String(btn.dataset.id) === String(data.id));
    });
  }

  async function downloadOpenNotice() {
    const id = employeeState.openNoticeId;
    if (!id) return;
    const fetchFn = window.dumpBinAuthFetch || fetch;
    const res = await fetchFn(`/api/welcome-letter/employees/notices/${encodeURIComponent(id)}/download`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text();
      let message = `HTTP ${res.status}`;
      try { message = JSON.parse(text).error || message; } catch (_err) { /* keep status */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = employeeState.openNoticeFile || `notice-${id}.eml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindEmployeeNotice() {
    const kind = document.getElementById('noticeKind');
    const refresh = document.getElementById('employeesRefresh');
    const preview = document.getElementById('noticePreviewBtn');
    const send = document.getElementById('noticeSendBtn');
    const workApply = document.getElementById('workApply');
    const thread = document.getElementById('employeeThread');
    const noticeDownload = document.getElementById('noticeCopyDownload');
    if (thread) thread.addEventListener('click', (event) => {
      const btn = event.target.closest('.wb-thread-item');
      if (!btn) return;
      openNoticeCopy(btn.dataset.id).catch((err) => {
        const meta = document.getElementById('noticeCopyMeta');
        if (meta) meta.textContent = err.message;
      });
    });
    if (noticeDownload) noticeDownload.addEventListener('click', () => {
      downloadOpenNotice().catch((err) => {
        const meta = document.getElementById('noticeCopyMeta');
        if (meta) meta.textContent = err.message;
      });
    });
    if (workApply) workApply.addEventListener('click', () => {
      const emp = employeeState.selected;
      if (!emp) return;
      loadWorkHistory(emp, {
        from: document.getElementById('workFrom').value,
        to: document.getElementById('workTo').value,
      }).catch((err) => {
        document.getElementById('workPanel').textContent = err.message;
      });
    });
    if (kind) kind.addEventListener('change', () => {
      syncNoticeFields();
      markNoticeStale();
    });
    ['noticeLastWorked', 'noticeInitialDate', 'noticeShiftDate', 'noticeShiftTime'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', markNoticeStale);
    });
    if (refresh) refresh.addEventListener('click', () => loadEmployees(true));
    if (preview) preview.addEventListener('click', () => previewNotice().catch((err) => {
      document.getElementById('noticeStatus').textContent = err.message;
    }));
    if (send) send.addEventListener('click', () => sendNotice().catch((err) => {
      document.getElementById('noticeStatus').textContent = err.message;
    }));
  }

  const REFERRAL_API = '/api/welcome-letter/referrals';
  const referralState = { items: [], due: [] };

  const DUE_LABELS = {
    waiting_for_first_shift: 'Waiting for first shift',
    upcoming: 'Upcoming',
    needs_referred_eid: 'Needs referred EID',
    needs_good_standing: 'Needs good standing',
    not_in_good_standing: 'Not in good standing',
    needs_hours: 'Needs hours',
    short_hours: 'Short hours',
    eligible: 'Eligible',
    paid: 'Paid',
    closed: 'Closed',
  };

  const STATUS_LABELS = {
    reported: 'Reported',
    contacted: 'Contacted',
    submitted: 'Submitted',
    interview: 'Interview',
    offer: 'Offer',
    hired: 'Hired',
    not_selected: 'Not selected',
  };

  const PAYOUT_LABELS = {
    pending: 'Pending',
    eligible: 'Eligible',
    tracker_prepared: 'Tracker prepared',
    submitted_to_director: 'Submitted to director',
    vp_approved: 'VP approved',
    sent: 'Sent',
    paid: 'Paid',
  };

  function setPanel(el, show) {
    if (!el) return;
    el.hidden = !show;
    el.classList.toggle('wb-hidden', !show);
  }

  function fmtDay(iso) {
    if (!iso) return '—';
    const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return fmtShortDate(iso) || String(iso);
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return day.toLocaleDateString();
  }

  function dateInputValue(iso) {
    const match = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function emptyToNull(value) {
    const text = String(value ?? '').trim();
    return text ? text : null;
  }

  function standingSelect(value) {
    if (value === true) return 'true';
    if (value === false) return 'false';
    return '';
  }

  function parseStanding(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  }

  function standingText(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return 'Not set';
  }

  function labelOf(map, value) {
    const key = String(value || '');
    return map[key] || (key ? key.replace(/_/g, ' ') : '—');
  }

  function milestoneOf(referral, n) {
    const milestones = referral && referral.milestones;
    if (!milestones) return {};
    return milestones[n] || milestones[String(n)] || {};
  }

  function milestoneTitle(source, n) {
    const days = source && source.daysRequired;
    const hours = source && source.hoursRequired;
    if (days && hours) return `${days}-day / ${hours}-hour`;
    return n === 2 ? '30-day / 80-hour' : '15-day / 40-hour';
  }

  function dueBadge(state) {
    const label = labelOf(DUE_LABELS, state);
    const key = String(state || '');
    if (key === 'eligible' || key === 'paid') return badge(label, 'sent');
    if (key === 'needs_hours' || key === 'short_hours' || key === 'upcoming') return badge(label, 'pending');
    if (key === 'needs_referred_eid' || key === 'needs_good_standing' || key === 'not_in_good_standing') {
      return badge(label, 'failed');
    }
    return badge(label, 'not-opened');
  }

  function referralStatusBadge(status) {
    const label = labelOf(STATUS_LABELS, status);
    const key = String(status || '');
    if (key === 'hired' || key === 'offer') return badge(label, 'sent');
    if (key === 'not_selected') return badge(label, 'failed');
    if (key === 'interview' || key === 'submitted' || key === 'contacted') return badge(label, 'pending');
    return badge(label, 'not-opened');
  }

  function showRefBanner({ ok, message }) {
    const el = document.getElementById('refBanner');
    if (!el) return;
    el.classList.remove('wb-hidden', 'ok', 'err');
    el.hidden = false;
    el.classList.add(ok ? 'ok' : 'err');
    el.textContent = message;
  }

  function setSelectValue(id, value, fallback) {
    const el = document.getElementById(id);
    if (!el) return;
    const next = value || fallback || '';
    if (next && ![...el.options].some((opt) => opt.value === next)) {
      const option = document.createElement('option');
      option.value = next;
      option.textContent = labelOf(PAYOUT_LABELS, next);
      el.appendChild(option);
    }
    el.value = next || fallback || '';
  }

  function showFormError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function hoursLine(milestone) {
    const required = milestone && milestone.hoursRequired != null ? `${milestone.hoursRequired}h required` : '';
    if (!milestone || milestone.hoursConfirmed == null) {
      return required ? `Hours not confirmed · ${required}` : 'Hours not confirmed';
    }
    return `${milestone.hoursConfirmed}h confirmed${required ? ` · ${required}` : ''}`;
  }

  function milestoneCell(referral, n) {
    const milestone = milestoneOf(referral, n);
    const payout = labelOf(PAYOUT_LABELS, milestone.payoutStatus || referral[`m${n}PayoutStatus`]);
    return `<div><strong>${escapeHtml(milestoneTitle(milestone, n))}</strong></div>
      <div>${escapeHtml(fmtDay(milestone.eligibleOn))}</div>
      <div>${dueBadge(milestone.dueState)}</div>
      <div class="wb-muted">${escapeHtml(hoursLine(milestone))}</div>
      <div class="wb-muted">Payout record: ${escapeHtml(payout)}</div>`;
  }

  function standingCell(referrer, referred) {
    return `<div>Referrer: ${escapeHtml(standingText(referrer))}</div>
      <div>Referred: ${escapeHtml(standingText(referred))}</div>`;
  }

  function renderReferralRows(items) {
    const tbody = document.getElementById('refRows');
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="wb-muted">No referrals yet.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => `<tr data-id="${escapeHtml(item.id)}">
      <td>${escapeHtml(item.referrerName || '—')}</td>
      <td>${escapeHtml(item.referralName || '—')}</td>
      <td>${referralStatusBadge(item.status)}</td>
      <td>
        <div>Referred ${escapeHtml(item.referredEid || '—')}</div>
        <div class="wb-muted">Referrer ${escapeHtml(item.referrerEid || '—')}</div>
      </td>
      <td>${escapeHtml(fmtDay(item.firstShiftOn))}</td>
      <td>${milestoneCell(item, 1)}</td>
      <td>${milestoneCell(item, 2)}</td>
      <td>${standingCell(item.referrerGoodStanding, item.referredGoodStanding)}</td>
    </tr>`).join('');
    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const found = referralState.items.find((item) => item.id === row.dataset.id);
        if (found) openReferralForm(found);
      });
    });
  }

  function renderDueRows(items) {
    const tbody = document.getElementById('refDueRows');
    const count = document.getElementById('refDueCount');
    if (count) count.textContent = items.length ? String(items.length) : '';
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="wb-muted">No milestones have arrived that still need hours.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => `<tr>
      <td>${escapeHtml(item.referrerName || '—')}</td>
      <td>${escapeHtml(item.referralName || '—')}</td>
      <td>${escapeHtml(milestoneTitle(item, item.milestone))}</td>
      <td>
        <div>${escapeHtml(fmtDay(item.eligibleOn))}</div>
        <div class="wb-muted">First shift ${escapeHtml(fmtDay(item.firstShiftOn))}</div>
      </td>
      <td>${dueBadge(item.dueState)}<div class="wb-muted" style="margin-top:4px;">${escapeHtml(hoursLine(item))}</div></td>
      <td>
        <div>Referred ${escapeHtml(item.referredEid || '—')}</div>
        <div class="wb-muted">Referrer ${escapeHtml(item.referrerEid || '—')}</div>
      </td>
      <td>${standingCell(item.referrerGoodStanding, item.referredGoodStanding)}</td>
      <td><button type="button" class="wb-btn wb-btn-primary ref-hours-btn" data-id="${escapeHtml(item.referralId)}" data-milestone="${escapeHtml(item.milestone)}" style="padding:6px 10px;font-size:13px;">Enter hours</button></td>
    </tr>`).join('');
    tbody.querySelectorAll('.ref-hours-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = referralState.due.find((item) => (
          item.referralId === btn.dataset.id && String(item.milestone) === String(btn.dataset.milestone)
        ));
        if (found) openHoursForm(found);
      });
    });
  }

  async function loadReferralList() {
    const tbody = document.getElementById('refRows');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="wb-muted">Loading…</td></tr>';
    const params = new URLSearchParams();
    const status = document.getElementById('refStatusFilter');
    if (status && status.value) params.set('status', status.value);
    const query = params.toString();
    const data = await api(`${REFERRAL_API}${query ? `?${query}` : ''}`);
    referralState.items = data.items || [];
    renderReferralRows(referralState.items);
  }

  async function loadDue() {
    const tbody = document.getElementById('refDueRows');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="wb-muted">Loading…</td></tr>';
    const data = await api(`${REFERRAL_API}/due`);
    const arrived = (data.items || []).filter((item) => (
      item.dueState === 'needs_hours' || item.dueState === 'short_hours'
    ));
    referralState.due = arrived;
    renderDueRows(arrived);
  }

  async function loadReferrals() {
    const banner = document.getElementById('refBanner');
    if (banner) {
      banner.classList.add('wb-hidden');
      banner.hidden = true;
      banner.textContent = '';
    }
    const errors = [];
    try {
      await loadReferralList();
    } catch (err) {
      errors.push(err.message);
      const tbody = document.getElementById('refRows');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="wb-error">${escapeHtml(err.message)}</td></tr>`;
    }
    try {
      await loadDue();
    } catch (err) {
      errors.push(err.message);
      const tbody = document.getElementById('refDueRows');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="wb-error">${escapeHtml(err.message)}</td></tr>`;
    }
    if (errors.length) showRefBanner({ ok: false, message: errors.join(' ') });
    return errors.length === 0;
  }

  function openReferralForm(item) {
    setReferralView('list', { pushUrl: true });
    showFormError('refFormError', '');
    document.getElementById('refEditingId').value = item ? item.id : '';
    document.getElementById('refFormTitle').textContent = item ? 'Edit referral' : 'Add referral';
    document.getElementById('refReferrerName').value = item ? (item.referrerName || '') : '';
    document.getElementById('refReferrerEid').value = item ? (item.referrerEid || '') : '';
    document.getElementById('refReferrerPhone').value = item ? (item.referrerPhone || '') : '';
    document.getElementById('refReferrerStore').value = item ? (item.referrerStoreNumber || '') : '';
    document.getElementById('refReferrerDept').value = item ? (item.referrerDeptNumber || '') : '';
    document.getElementById('refRetailer').value = item ? (item.retailer || '') : '';
    document.getElementById('refReferrerSupervisor').value = item ? (item.referrerSupervisorName || '') : '';
    document.getElementById('refReferralName').value = item ? (item.referralName || '') : '';
    document.getElementById('refReferralPhone').value = item ? (item.referralPhone || '') : '';
    document.getElementById('refReferralEmail').value = item ? (item.referralEmail || '') : '';
    document.getElementById('refReferredEid').value = item ? (item.referredEid || '') : '';
    setSelectValue('refStatus', item ? item.status : 'reported', 'reported');
    document.getElementById('refReportedOn').value = item ? dateInputValue(item.reportedOn) : '';
    document.getElementById('refTaFormOn').value = item ? dateInputValue(item.taFormSubmittedOn) : '';
    document.getElementById('refFirstShiftOn').value = item ? dateInputValue(item.firstShiftOn) : '';
    document.getElementById('refOnboardHireId').value = item ? (item.onboardHireId || '') : '';
    document.getElementById('refReferrerStanding').value = item ? standingSelect(item.referrerGoodStanding) : '';
    document.getElementById('refReferredStanding').value = item ? standingSelect(item.referredGoodStanding) : '';
    document.getElementById('refSupervisorContacted').checked = item ? Boolean(item.supervisorContacted) : false;
    setSelectValue('refM1Payout', item ? item.m1PayoutStatus : 'pending', 'pending');
    setSelectValue('refM2Payout', item ? item.m2PayoutStatus : 'pending', 'pending');
    document.getElementById('refNotes').value = item ? (item.notes || '') : '';
    const form = document.getElementById('referralForm');
    setPanel(form, true);
    document.getElementById('refReferrerName').focus();
  }

  function closeReferralForm() {
    setPanel(document.getElementById('referralForm'), false);
    showFormError('refFormError', '');
  }

  function referralPayload(creating) {
    const payload = {
      referrerName: document.getElementById('refReferrerName').value.trim(),
      referrerEid: emptyToNull(document.getElementById('refReferrerEid').value),
      referrerStoreNumber: emptyToNull(document.getElementById('refReferrerStore').value),
      referrerDeptNumber: emptyToNull(document.getElementById('refReferrerDept').value),
      referrerPhone: emptyToNull(document.getElementById('refReferrerPhone').value),
      referrerSupervisorName: emptyToNull(document.getElementById('refReferrerSupervisor').value),
      retailer: emptyToNull(document.getElementById('refRetailer').value),
      referralName: document.getElementById('refReferralName').value.trim(),
      referralPhone: emptyToNull(document.getElementById('refReferralPhone').value),
      referralEmail: emptyToNull(document.getElementById('refReferralEmail').value),
      reportedOn: emptyToNull(document.getElementById('refReportedOn').value),
      supervisorContacted: document.getElementById('refSupervisorContacted').checked,
      taFormSubmittedOn: emptyToNull(document.getElementById('refTaFormOn').value),
      status: document.getElementById('refStatus').value,
      referredEid: emptyToNull(document.getElementById('refReferredEid').value),
      onboardHireId: emptyToNull(document.getElementById('refOnboardHireId').value),
      firstShiftOn: emptyToNull(document.getElementById('refFirstShiftOn').value),
      referrerGoodStanding: parseStanding(document.getElementById('refReferrerStanding').value),
      referredGoodStanding: parseStanding(document.getElementById('refReferredStanding').value),
      m1PayoutStatus: document.getElementById('refM1Payout').value,
      m2PayoutStatus: document.getElementById('refM2Payout').value,
      notes: emptyToNull(document.getElementById('refNotes').value),
    };
    if (!payload.referrerName || !payload.referralName) {
      throw new Error('Referrer name and referred person are required.');
    }
    if (!creating) return payload;
    Object.keys(payload).forEach((key) => {
      if (payload[key] == null) delete payload[key];
    });
    if (!payload.notes) delete payload.notes;
    return payload;
  }

  async function saveReferral(event) {
    event.preventDefault();
    const btn = document.getElementById('refSaveBtn');
    const id = document.getElementById('refEditingId').value;
    showFormError('refFormError', '');
    let payload;
    try {
      payload = referralPayload(!id);
    } catch (err) {
      showFormError('refFormError', err.message);
      return;
    }
    btn.disabled = true;
    try {
      if (id) {
        await api(`${REFERRAL_API}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api(REFERRAL_API, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      closeReferralForm();
      const refreshed = await loadReferrals();
      if (refreshed) {
        showRefBanner({
          ok: true,
          message: id ? 'Referral updated.' : 'Referral added.',
        });
      }
    } catch (err) {
      showFormError('refFormError', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function openHoursForm(item) {
    showFormError('refHoursError', '');
    document.getElementById('refHoursId').value = item.referralId || '';
    document.getElementById('refHoursMilestone').value = String(item.milestone || 1);
    document.getElementById('refHoursValue').value = '';
    document.getElementById('refHoursReferrerStanding').value = standingSelect(item.referrerGoodStanding);
    document.getElementById('refHoursReferredStanding').value = standingSelect(item.referredGoodStanding);
    const last = item.hoursConfirmed == null
      ? 'No hours are confirmed yet.'
      : `Last confirmed figure on file: ${item.hoursConfirmed} hours${item.hoursConfirmedBy ? ` (${item.hoursConfirmedBy})` : ''}.`;
    document.getElementById('refHoursContext').textContent = `${item.referrerName || 'Referrer'} referred ${item.referralName || 'the new hire'}. ${milestoneTitle(item, item.milestone)}. ${last} Type the hours from PROD. They are not confirmed until you submit.`;
    setPanel(document.getElementById('referralHoursForm'), true);
    document.getElementById('refHoursValue').focus();
  }

  function closeHoursForm() {
    setPanel(document.getElementById('referralHoursForm'), false);
    document.getElementById('refHoursValue').value = '';
    showFormError('refHoursError', '');
  }

  async function saveHours(event) {
    event.preventDefault();
    const btn = document.getElementById('refHoursSaveBtn');
    const id = document.getElementById('refHoursId').value;
    const milestone = Number(document.getElementById('refHoursMilestone').value);
    const hours = Number(document.getElementById('refHoursValue').value);
    showFormError('refHoursError', '');
    if (!id) {
      showFormError('refHoursError', 'Choose a milestone from the Due list first.');
      return;
    }
    if (!Number.isFinite(hours) || hours < 0 || hours > 1000) {
      showFormError('refHoursError', 'Hours must be a number from 0 to 1000.');
      return;
    }
    const title = milestone === 2 ? '30-day / 80-hour' : '15-day / 40-hour';
    if (!window.confirm(`Confirm ${hours} hours from PROD for the ${title} milestone? This records those hours. It does not email a payout.`)) {
      return;
    }
    btn.disabled = true;
    try {
      await api(`${REFERRAL_API}/${encodeURIComponent(id)}/hours`, {
        method: 'POST',
        body: JSON.stringify({
          milestone,
          hours,
          referrerGoodStanding: parseStanding(document.getElementById('refHoursReferrerStanding').value),
          referredGoodStanding: parseStanding(document.getElementById('refHoursReferredStanding').value),
        }),
      });
      closeHoursForm();
      const refreshed = await loadReferrals();
      if (refreshed) {
        showRefBanner({
          ok: true,
          message: `Confirmed ${hours} hours from PROD for the ${title} milestone.`,
        });
      }
    } catch (err) {
      showFormError('refHoursError', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function filenameFromDisposition(header, fallback) {
    if (!header) return fallback;
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (encoded) {
      try { return decodeURIComponent(encoded[1].trim()); } catch (_err) { return fallback; }
    }
    const plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
    return plain ? plain[1].trim() : fallback;
  }

  async function downloadTracker(format) {
    // GET download only. Never POST /tracker, never markPrepared, never email.
    const fetchFn = window.dumpBinAuthFetch || fetch;
    const xlsxBtn = document.getElementById('refXlsxBtn');
    const csvBtn = document.getElementById('refCsvBtn');
    if (xlsxBtn) xlsxBtn.disabled = true;
    if (csvBtn) csvBtn.disabled = true;
    try {
      const res = await fetchFn(`${REFERRAL_API}/tracker?format=${encodeURIComponent(format)}`, {
        method: 'GET',
        credentials: 'include',
      });
      const type = res.headers.get('Content-Type') || '';
      if (!res.ok || type.includes('application/json')) {
        const text = await res.text();
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (_err) { body = {}; }
        const missing = Array.isArray(body.incomplete)
          ? body.incomplete.map((row) => `milestone ${row.milestone} missing ${(row.missing || []).join(', ')}`).join('; ')
          : '';
        throw new Error([body.error || `HTTP ${res.status}`, missing].filter(Boolean).join(' '));
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get('Content-Disposition'),
        `SAS_Referral_Payout_Tracker.${format}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showRefBanner({
        ok: true,
        message: `Downloaded ${filename}. The file was not emailed, and no payout was submitted.`,
      });
    } catch (err) {
      showRefBanner({ ok: false, message: err.message });
    } finally {
      if (xlsxBtn) xlsxBtn.disabled = false;
      if (csvBtn) csvBtn.disabled = false;
    }
  }

  function setReferralView(view, { pushUrl = true } = {}) {
    const due = view === 'due';
    setPanel(document.getElementById('refListView'), !due);
    setPanel(document.getElementById('refDueView'), due);
    const listBtn = document.getElementById('refViewList');
    const dueBtn = document.getElementById('refViewDue');
    if (listBtn) {
      listBtn.classList.toggle('is-active', !due);
      listBtn.setAttribute('aria-selected', String(!due));
    }
    if (dueBtn) {
      dueBtn.classList.toggle('is-active', due);
      dueBtn.setAttribute('aria-selected', String(due));
    }
    if (pushUrl) {
      const url = new URL(window.location.href);
      if (due) url.searchParams.set('view', 'due');
      else url.searchParams.delete('view');
      window.history.replaceState(null, '', url.toString());
    }
  }

  const ptoState = { items: [], people: [], selectedId: null, year: null, openKey: null };

  function renderPtoSteps(steps) {
    const host = document.getElementById('ptoSteps');
    if (!host) return;
    if (!steps || !steps.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    host.innerHTML = steps.map((step) => (
      `<li><span class="wb-step-label">${escapeHtml(step.label)}</span><span>${escapeHtml(step.detail)}</span></li>`
    )).join('');
  }

  function stepsFromLog(entries) {
    const list = entries || [];
    const withArray = list.find((entry) => Array.isArray(entry.detail?.steps) && entry.detail.steps.length);
    if (withArray) return withArray.detail.steps;
    const stepped = list.filter((entry) => entry.detail?.step);
    if (!stepped.length) return [];
    const runId = stepped[0].detail.runId;
    return stepped
      .filter((entry) => entry.detail.runId === runId)
      .slice()
      .reverse()
      .map((entry) => ({ id: entry.detail.id, label: entry.detail.label, detail: entry.detail.detail }));
  }

  function setPtoBusy(busy) {
    ['ptoApprove', 'ptoDeny', 'ptoBuild'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = busy;
    });
  }

  function showPtoBanner(message, ok) {
    const banner = document.getElementById('ptoBanner');
    if (!banner) return;
    banner.classList.remove('wb-hidden', 'ok', 'err');
    if (!message) {
      banner.classList.add('wb-hidden');
      banner.textContent = '';
      return;
    }
    banner.classList.add(ok === false ? 'err' : 'ok');
    banner.textContent = message;
  }

  function ptoDates(item) {
    if (!item) return '';
    if (item.startDate === item.endDate) return item.startDate;
    return `${item.startDate} – ${item.endDate}`;
  }

  function ptoYes(on) {
    return on
      ? '<span class="wb-badge wb-badge-sent">Yes</span>'
      : '<span class="wb-muted">—</span>';
  }

  function ptoIsBuilt(item) {
    return !!(item && (item.status === 'built' || item.visitId));
  }

  function ptoHoursLabel(hours) {
    const n = Number(hours);
    if (!Number.isFinite(n)) return '';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function ptoRequestsFor(person) {
    if (person && Array.isArray(person.requests) && person.requests.length) return person.requests;
    const name = String(person && person.employeeName || '').trim().toLowerCase();
    return (ptoState.items || []).filter((item) => String(item.employeeName || '').trim().toLowerCase() === name);
  }

  function ptoRequestState(item) {
    if (!item) return '';
    if (item.status === 'denied' || item.oracleStatus === 'rejected') return 'Denied';
    if (item.ranAt) return 'Finished';
    if (ptoIsBuilt(item)) return 'Shift created';
    if (item.oracleStatus === 'approved') return 'Approved';
    return 'Waiting for a decision';
  }

  function ptoRequestLabel(item) {
    const when = item.startDate === item.endDate || !item.endDate
      ? item.startDate
      : `${item.startDate} – ${item.endDate}`;
    return `${when} · ${item.absenceType || 'Time off'} · ${ptoHoursLabel(item.hours)} hours · ${ptoRequestState(item)}`;
  }

  function placePtoDetail() {
    const detail = document.getElementById('ptoDetail');
    if (!detail) return;
    const person = (ptoState.people || []).find((row) => (
      ptoRequestsFor(row).some((item) => item.id === ptoState.selectedId)
    ));
    const slot = person && document.querySelector(`[data-pto-slot="${CSS.escape(person.key)}"]`);
    if (slot) slot.appendChild(detail);
  }

  function parkPtoDetail() {
    const detail = document.getElementById('ptoDetail');
    const park = document.getElementById('ptoDetailPark');
    if (detail && park && detail.parentElement !== park) park.appendChild(detail);
  }

  function renderPtoRows() {
    const body = document.getElementById('ptoRows');
    if (!body) return;
    parkPtoDetail();
    const people = ptoState.people || [];
    if (!people.length) {
      body.innerHTML = '<tr><td class="wb-muted">No time off requests this year.</td></tr>';
      return;
    }
    body.innerHTML = people.map((person) => {
      const open = ptoState.openKey === person.key;
      const requests = ptoRequestsFor(person).map((item) => `
        <button type="button" class="wb-subitem${item.id === ptoState.selectedId ? ' is-selected' : ''}" data-pto-id="${escapeHtml(item.id)}">${escapeHtml(ptoRequestLabel(item))}</button>`).join('');
      return `<tr class="${person.open ? 'wb-pto-open' : ''}">
        <td>
          <button type="button" class="wb-menu-name${person.open ? ' is-behind' : ''}" data-pto-key="${escapeHtml(person.key)}">${escapeHtml(person.employeeName)}</button>
          <span class="wb-muted"> ${escapeHtml(person.latestDate || '')} · ${escapeHtml(String(person.days))} days · ${escapeHtml(ptoHoursLabel(person.hours))} hours</span>
          <div class="wb-submenu" data-pto-menu="${escapeHtml(person.key)}" ${open ? '' : 'hidden'}>
            ${requests || '<p class="wb-muted">No requests on file.</p>'}
            <div data-pto-slot="${escapeHtml(person.key)}"></div>
          </div>
        </td>
      </tr>`;
    }).join('');
    body.querySelectorAll('[data-pto-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-pto-key');
        ptoState.openKey = ptoState.openKey === key ? null : key;
        renderPtoRows();
      });
    });
    body.querySelectorAll('[data-pto-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openPto(btn.getAttribute('data-pto-id')).catch((err) => showPtoBanner(err.message, false));
      });
    });
    placePtoDetail();
  }

  async function openPto(id) {
    ptoState.selectedId = id;
    const item = ptoState.items.find((row) => row.id === id);
    const detail = document.getElementById('ptoDetail');
    if (!item || !detail) return;
    const person = (ptoState.people || []).find((row) => ptoRequestsFor(row).some((entry) => entry.id === id));
    if (person) ptoState.openKey = person.key;
    renderPtoRows();
    detail.hidden = false;
    document.getElementById('ptoDetailTitle').textContent = `${item.employeeName} · ${ptoRequestLabel(item)}`;
    const clock = [item.startTime, item.endTime].filter(Boolean).join(' – ');
    const built = ptoIsBuilt(item) && item.visitId ? ` Shift number ${item.shiftId}.` : '';
    const err = !ptoIsBuilt(item) && item.buildError ? ` ${item.buildError}` : '';
    const oracleErr = item.oracleError ? ` ${item.oracleError}` : '';
    document.getElementById('ptoDetailMeta').textContent =
      `${ptoRequestLabel(item)}${clock ? ` · ${clock}` : ''}.${built}${err}${oracleErr}`;
    const buildBtn = document.getElementById('ptoBuild');
    if (buildBtn) buildBtn.hidden = item.oracleStatus !== 'approved' || !!item.ranAt;
    document.getElementById('ptoNote').value = item.decisionNote || '';
    document.getElementById('ptoActionStatus').textContent = '';
    const log = await api(`/api/pto/log?requestId=${encodeURIComponent(id)}`);
    const host = document.getElementById('ptoLog');
    const entries = log.items || [];
    const visible = entries.filter((entry) => !entry.detail?.step);
    host.innerHTML = visible.length
      ? visible.map((entry) => `<p style="margin:0 0 8px;">${escapeHtml(entry.summary)}</p>`).join('')
      : '<p class="wb-muted" style="margin:0;">No log lines yet.</p>';
    renderPtoSteps(stepsFromLog(entries));
  }

  async function loadPto() {
    const data = await api('/api/pto');
    ptoState.year = data.year || null;
    ptoState.items = data.items || [];
    ptoState.people = data.people || [];
    renderPtoRows();
    let sessionNote = '';
    try {
      const session = await api('/api/pto/session');
      if (!session.signedIn) {
        sessionNote = 'The time-off system is not signed in on the server. Open it in Chrome with the automator running, then get new requests.';
      }
    } catch (err) {
      sessionNote = err.message;
    }
    if (sessionNote) showPtoBanner(sessionNote, false);
    if (ptoState.selectedId && ptoState.items.some((row) => row.id === ptoState.selectedId)) {
      await openPto(ptoState.selectedId);
    }
  }

  async function pollPtoSteps(id, runId) {
    const log = await api(`/api/pto/log?requestId=${encodeURIComponent(id)}`);
    const rows = (log.items || []).filter((entry) => entry.detail?.step && entry.detail.runId === runId);
    if (!rows.length) return;
    renderPtoSteps(rows.slice().reverse().map((entry) => ({
      id: entry.detail.id,
      label: entry.detail.label,
      detail: entry.detail.detail,
    })));
  }

  async function runPtoBuild(id, note, status) {
    const runId = `pto-${Date.now()}`;
    setPtoBusy(true);
    status.textContent = 'Working…';
    renderPtoSteps([]);
    const timer = setInterval(() => {
      pollPtoSteps(id, runId).catch(() => {});
    }, 1200);
    try {
      const body = await api(`/api/pto/${encodeURIComponent(id)}/build`, {
        method: 'POST',
        body: JSON.stringify({ note, runId }),
      });
      renderPtoSteps(body.steps || []);
      status.textContent = body.item ? body.item.status : 'Done.';
      showPtoBanner('', true);
    } catch (err) {
      status.textContent = err.message;
      if (err.steps && err.steps.length) renderPtoSteps(err.steps);
      showPtoBanner(err.message, false);
    } finally {
      clearInterval(timer);
      setPtoBusy(false);
    }
    await loadPto();
  }

  async function ptoAct(action) {
    const id = ptoState.selectedId;
    if (!id) return;
    const status = document.getElementById('ptoActionStatus');
    const note = document.getElementById('ptoNote').value;
    if (action === 'build') {
      await runPtoBuild(id, note, status);
      return;
    }
    status.textContent = 'Working…';
    try {
      const item = await api(`/api/pto/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      status.textContent = item.item ? item.item.status : 'Done.';
      showPtoBanner('', true);
    } catch (err) {
      status.textContent = err.message;
      showPtoBanner(err.message, false);
    }
    await loadPto();
  }

  async function loadPastEmployees() {
    const tbody = document.getElementById('pastRows');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="wb-muted">Loading…</td></tr>';
    const data = await api('/api/welcome-letter/employees/past');
    const items = data.employees || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="wb-muted">No one has left the roster yet.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((emp) => `<tr class="${toneClass(emp.tone)}">
      <td><span class="wb-name-line"><span>${escapeHtml(emp.preferredName || emp.name)}</span><a class="wb-prod-link" href="${prodWorkforceUrl(emp.employeeId)}" target="_blank" rel="noopener">Open profile</a></span></td>
      <td>${escapeHtml(listText(emp.personalEmails) || '—')}</td>
      <td>${escapeHtml(listText(emp.workEmails) || '—')}</td>
      <td>${escapeHtml(phoneText(emp.phones) || '—')}</td>
      <td>${escapeHtml(punchLabel(emp))}</td>
      <td>${escapeHtml(emp.lastSeenOn || emp.removedOn || '—')}</td>
    </tr>`).join('');
  }

  const shiftState = {
    action: 'add',
    types: [],
    lead: null,
    people: [],
    preview: null,
    template: null,
    ready: false,
    roster: [],
    letterText: '',
  };

  function selectedShiftType() {
    const id = document.getElementById('shiftType') && document.getElementById('shiftType').value;
    return (shiftState.types || []).find((row) => row.id === id) || null;
  }

  function renderShiftActions() {
    const add = document.getElementById('shiftActionAdd');
    const remove = document.getElementById('shiftActionRemove');
    if (add) add.className = shiftState.action === 'add' ? 'wb-btn wb-btn-primary' : 'wb-btn wb-btn-ghost';
    if (remove) remove.className = shiftState.action === 'remove' ? 'wb-btn wb-btn-primary' : 'wb-btn wb-btn-ghost';
    const wrap = document.getElementById('shiftRemoveLeadWrap');
    const hasLead = shiftState.people.some((person) => person.role === 'lead');
    if (wrap) wrap.style.display = shiftState.action === 'add' && hasLead ? 'block' : 'none';
  }

  function renderShiftPeople() {
    const host = document.getElementById('shiftPeople');
    if (!host) return;
    if (!shiftState.people.length) {
      host.innerHTML = '';
    } else {
      host.innerHTML = shiftState.people.map((person, index) => `<div style="display:flex;gap:8px;align-items:center;">
        <span>${escapeHtml(person.name)}</span>
        <select data-shift-role="${index}" style="font:inherit;padding:4px 8px;">
          <option value="rep"${person.role === 'rep' ? ' selected' : ''}>On the crew</option>
          <option value="lead"${person.role === 'lead' ? ' selected' : ''}>Lead</option>
        </select>
        <button type="button" class="wb-btn wb-btn-ghost" data-shift-drop="${index}">Take off</button>
      </div>`).join('');
      host.querySelectorAll('[data-shift-role]').forEach((select) => {
        select.addEventListener('change', () => {
          const person = shiftState.people[Number(select.dataset.shiftRole)];
          if (!person) return;
          person.role = select.value === 'lead' ? 'lead' : 'rep';
          const leads = shiftState.people.filter((item) => item.role === 'lead');
          if (leads.length > 1) {
            shiftState.people.forEach((item) => {
              if (item !== person) item.role = 'rep';
            });
            renderShiftPeople();
            return;
          }
          renderShiftActions();
        });
      });
      host.querySelectorAll('[data-shift-drop]').forEach((btn) => {
        btn.addEventListener('click', () => {
          shiftState.people.splice(Number(btn.dataset.shiftDrop), 1);
          renderShiftPeople();
          renderShiftActions();
        });
      });
    }
    const lead = document.getElementById('shiftLeadPick');
    if (lead) {
      lead.innerHTML = shiftState.lead
        ? `${escapeHtml(shiftState.lead.name)} <button type="button" class="wb-btn wb-btn-ghost" id="shiftLeadClear">Clear</button>`
        : '';
      const clear = document.getElementById('shiftLeadClear');
      if (clear) clear.addEventListener('click', () => { shiftState.lead = null; renderShiftPeople(); });
    }
    renderShiftActions();
  }

  function renderShiftResults(preview, template) {
    const host = document.getElementById('shiftPreviewList');
    if (!host) return;
    const visits = (preview && preview.visits) || [];
    if (!visits.length) {
      host.innerHTML = '<p class="wb-muted">No shifts match those choices.</p>';
      return;
    }
    const blocks = visits.map((visit) => {
      const lines = (visit.lines || []).map((line) => {
        const verb = line.change === 'skip' ? line.reason : `${line.change} as ${line.role}`;
        return `<div>${escapeHtml(line.name)} — ${escapeHtml(verb)}</div>`;
      }).join('');
      return `<div style="padding:8px 0;border-bottom:1px solid var(--wb-line);">
        <strong>${escapeHtml(visit.store || '—')} · ${escapeHtml(visit.date || '')}</strong>
        <span class="wb-muted"> ${escapeHtml(visit.team || '')}${visit.leadName ? ` · lead ${escapeHtml(visit.leadName)}` : ''}</span>
        ${lines}
      </div>`;
    }).join('');
    const templateLines = ((template && template.changes) || []).map((row) => {
      const verb = row.change === 'skip'
        ? row.reason
        : `${row.change}${row.clearLeadName ? ` · current lead ${row.clearLeadName} becomes rep` : ''}`;
      return `<div>${escapeHtml(row.name || row.emp || '')} · store ${escapeHtml(row.store || '')} · ${escapeHtml(row.date || '')} — ${escapeHtml(verb)}</div>`;
    }).join('');
    const templateBlock = template
      ? `<h3 style="margin:14px 0 6px;color:var(--wb-navy);font-size:1rem;">Weekly template</h3>${templateLines || '<p class="wb-muted">Nothing to change on the weekly template.</p>'}`
      : '';
    host.innerHTML = blocks + templateBlock;
  }

  async function loadShiftCycles() {
    const host = document.getElementById('shiftCycles');
    if (!host) return;
    host.innerHTML = '<span class="wb-muted">Loading schedule weeks…</span>';
    const type = document.getElementById('shiftType').value;
    const data = await api(`/api/welcome-letter/shifts/cycles?shiftType=${encodeURIComponent(type)}`);
    const today = pacificTodayYmd();
    host.innerHTML = (data.cycles || []).map((cycle) => {
      const on = cycle.start && cycle.end && cycle.start <= today && today <= cycle.end;
      return `<label style="font-size:13px;"><input type="checkbox" value="${escapeHtml(cycle.id)}"${on ? ' checked' : ''}> ${escapeHtml(cycle.name || cycle.id)}</label>`;
    }).join('') || '<span class="wb-muted">No open schedule weeks for this kind of work.</span>';
    host.querySelectorAll('input').forEach((box) => {
      box.addEventListener('change', () => { loadShiftTeams().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    });
    await loadShiftTeams();
  }

  function checkedCycleIds() {
    return [...document.querySelectorAll('#shiftCycles input:checked')].map((el) => Number(el.value));
  }

  async function loadShiftTeams() {
    const select = document.getElementById('shiftTeam');
    if (!select) return;
    const previous = select.value;
    const cycleIds = checkedCycleIds();
    if (!cycleIds.length) {
      select.innerHTML = '<option value="">Choose a team</option>';
      return;
    }
    select.innerHTML = '<option value="">Loading teams…</option>';
    const data = await api('/api/welcome-letter/shifts/teams', {
      method: 'POST',
      body: JSON.stringify({
        shiftType: document.getElementById('shiftType').value,
        cycleIds,
        dateFrom: document.getElementById('shiftFrom').value,
        dateTo: document.getElementById('shiftTo').value,
      }),
    });
    const names = data.teams || [];
    select.innerHTML = `<option value="">Choose a team</option>${names.map((name) => (
      `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    )).join('')}`;
    if (names.includes(previous)) select.value = previous;
  }

  function shiftSearchList(host, people, onPick) {
    if (!host) return;
    if (!people.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = people.map((person, index) => `<button type="button" class="wb-btn wb-btn-ghost" data-i="${index}" style="margin:0 6px 6px 0;">${escapeHtml(person.name)}</button>`).join('');
    host.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => onPick(people[Number(btn.dataset.i)]));
    });
  }

  async function searchShiftPeople(query) {
    if (!query || query.trim().length < 2) return [];
    const data = await api(`/api/welcome-letter/shifts/people?q=${encodeURIComponent(query.trim())}`);
    return data.people || [];
  }

  function templateMirrorBody() {
    const person = (shiftState.people || [])[0] || {};
    const type = selectedShiftType();
    return {
      kind: type && type.template,
      action: shiftState.action,
      mirrorTeam: document.getElementById('shiftTeam') ? document.getElementById('shiftTeam').value : '',
      rows: [{
        workdayId: person.workdayId,
        name: person.name,
        role: person.role,
      }],
    };
  }

  function templateRowsFromPreview(preview) {
    const rows = [];
    (preview.visits || []).forEach((visit) => {
      (visit.lines || []).forEach((line) => {
        if (line.change === 'skip') return;
        rows.push({
          workdayId: line.workdayId,
          name: line.name,
          role: line.role,
          store: visit.store,
          date: visit.date,
          team: visit.team,
        });
      });
    });
    return rows;
  }

  async function localTemplate(path, body) {
    const res = await fetch(`http://127.0.0.1:3002${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Template HTTP ${res.status}`);
    return data;
  }

  function plainShiftError(err) {
    const msg = (err && err.message) || 'That did not finish.';
    if (/lease unavailable|busy with other work/i.test(msg)) {
      return 'PROD is busy with other work. Wait a moment and try again.';
    }
    if (/SAS session|not signed in|not active/i.test(msg)) {
      return 'PROD is not signed in on the server. Open PROD in Chrome with the automator running, then try again.';
    }
    if (/HTTP 404/.test(msg)) return 'This tool is not on the live server yet.';
    return msg;
  }

  function rosterEmail(person) {
    return (person.personalEmails && person.personalEmails[0])
      || person.email
      || (person.workEmails && person.workEmails[0])
      || '';
  }

  function fillShiftRoster(people) {
    shiftState.roster = people || [];
    const employee = document.getElementById('shiftEmployee');
    const options = shiftState.roster.map((person) => (
      `<option value="${escapeHtml(person.employeeId)}">${escapeHtml(person.preferredName || person.name)}</option>`
    )).join('');
    if (employee) employee.innerHTML = `<option value="">Choose an employee</option>${options}`;
  }

  function chooseShiftEmployee() {
    const select = document.getElementById('shiftEmployee');
    const person = shiftState.roster.find((row) => String(row.employeeId) === String(select && select.value));
    if (!person) {
      shiftState.people = [];
      renderShiftPeople();
      return;
    }
    shiftState.people = [{
      id: person.employeeId,
      name: person.preferredName || person.name,
      workdayId: person.workdayId || '',
      role: 'rep',
    }];
    const nameInput = document.getElementById('shiftLetterName');
    const emailInput = document.getElementById('shiftLetterEmail');
    if (nameInput) nameInput.value = String(person.preferredName || person.name || '').split(/\s+/)[0];
    if (emailInput) emailInput.value = rosterEmail(person);
    renderShiftPeople();
  }

  async function previewShifts() {
    const status = document.getElementById('shiftStatus');
    const execute = document.getElementById('shiftExecute');
    status.textContent = 'Looking up the shifts…';
    if (execute) execute.disabled = true;
    shiftState.preview = null;
    shiftState.template = null;
    const cycleIds = [...document.querySelectorAll('#shiftCycles input:checked')].map((el) => Number(el.value));
    const preview = await api('/api/welcome-letter/shifts/preview', {
      method: 'POST',
      body: JSON.stringify({
        action: shiftState.action,
        shiftType: document.getElementById('shiftType').value,
        cycleIds,
        team: document.getElementById('shiftTeam') ? document.getElementById('shiftTeam').value : '',
        stores: document.getElementById('shiftStores').value,
        dateFrom: document.getElementById('shiftFrom').value,
        dateTo: document.getElementById('shiftTo').value,
        employees: shiftState.people,
        removeCurrentLead: document.getElementById('shiftRemoveLead').checked,
      }),
    });
    shiftState.preview = preview;
    const useTemplate = document.getElementById('shiftTemplate').checked;
    if (useTemplate) {
      const type = selectedShiftType();
      try {
        shiftState.template = await localTemplate('/api/period-template/preview', templateMirrorBody());
      } catch (_err) {
        shiftState.template = null;
        status.textContent = 'The weekly template on this computer did not answer. The shift list below is still from PROD.';
      }
    }
    renderShiftResults(preview, shiftState.template);
    const jobs = templateRowsFromPreview(preview);
    if (execute) execute.disabled = jobs.length === 0;
    const extra = preview.truncated ? ' Showing the first 200.' : '';
    const templateMiss = useTemplate && !shiftState.template
      ? ' The weekly template on this computer did not answer.'
      : '';
    status.textContent = `${jobs.length} change${jobs.length === 1 ? '' : 's'}.${extra}${templateMiss}`;
  }

  async function executeShifts() {
    const status = document.getElementById('shiftStatus');
    const preview = shiftState.preview;
    if (!preview) return;
    const jobs = [];
    (preview.visits || []).forEach((visit) => {
      (visit.lines || []).forEach((line) => {
        if (line.change === 'skip') return;
        jobs.push({
          visitId: visit.visitId,
          store: visit.store,
          employeeId: line.employeeId,
          role: line.role,
          shiftId: line.shiftId,
        });
      });
    });
    status.textContent = 'Applying the changes…';
    const result = await api('/api/welcome-letter/shifts/execute', {
      method: 'POST',
      body: JSON.stringify({
        action: shiftState.action,
        removeCurrentLead: document.getElementById('shiftRemoveLead').checked,
        jobs,
      }),
    });
    let templateNote = '';
    if (document.getElementById('shiftTemplate').checked && shiftState.template) {
      const type = selectedShiftType();
      const applied = await localTemplate('/api/period-template/apply', templateMirrorBody());
      templateNote = applied.backup ? ` Template backup ${applied.backup}.` : ' Template updated.';
    }
    const done = (result.results || []).filter((row) => !row.skipped).length;
    status.textContent = `${done} shift change${done === 1 ? '' : 's'} applied.${templateNote}`;
    document.getElementById('shiftExecute').disabled = true;
  }

  let shiftLetterDays = [];

  function rosterPhone(person) {
    if (!person) return '';
    if (person.phone) return String(person.phone);
    const listed = person.phones && person.phones[0];
    if (!listed) return '';
    return typeof listed === 'object' ? String(listed.number || listed.value || '') : String(listed);
  }

  function letterContact() {
    const selected = document.getElementById('shiftEmployee');
    const roster = shiftState.roster.find((row) => String(row.employeeId) === String(selected && selected.value));
    return {
      phone: rosterPhone(roster),
      fullName: (roster && (roster.preferredName || roster.name)) || '',
    };
  }

  async function previewFirstDaysLetter() {
    const person = shiftState.people[0];
    const nameInput = document.getElementById('shiftLetterName');
    const emailInput = document.getElementById('shiftLetterEmail');
    const name = (nameInput.value || '').trim() || (person && String(person.name || '').split(/\s+/)[0]) || '';
    const email = (emailInput.value || '').trim();
    if (!name || !email) throw new Error('Choose an employee and an email before writing the letter.');
    nameInput.value = name;
    let scheduleNote = '';
    shiftLetterDays = [];
    const cycleIds = checkedCycleIds();
    const team = document.getElementById('shiftTeam') ? document.getElementById('shiftTeam').value : '';
    if (team && cycleIds.length) {
      const sched = await api('/api/welcome-letter/shifts/schedule', {
        method: 'POST',
        body: JSON.stringify({
          team,
          cycleIds,
          shiftType: document.getElementById('shiftType').value,
          dateFrom: document.getElementById('shiftFrom').value,
          dateTo: document.getElementById('shiftTo').value,
        }),
      });
      shiftLetterDays = sched.days || [];
      shiftState.letterLead = sched.lead || null;
    } else if (!team) {
      scheduleNote = 'Choose a team.';
    } else {
      scheduleNote = 'Choose a schedule week.';
    }
    let subject = "Your first week's schedule.";
    let text = '';
    let html = '';
    try {
      const letter = await api('/api/welcome-letter/shifts/first-days/preview', {
        method: 'POST',
        body: JSON.stringify({
          firstName: name,
          email,
          phone: letterContact().phone,
          fullName: letterContact().fullName,
          lead: shiftState.letterLead || null,
          days: shiftLetterDays,
        }),
      });
      subject = letter.subject || subject;
      text = letter.text || '';
      html = letter.html || '';
    } catch (err) {
      scheduleNote = scheduleNote || plainShiftError(err);
    }
    const editor = document.getElementById('shiftLetterEditor');
    const subjectInput = document.getElementById('shiftLetterSubject');
    const bodyInput = document.getElementById('shiftLetterBody');
    const frame = document.getElementById('shiftLetterFrame');
    if (editor) editor.hidden = false;
    if (subjectInput) subjectInput.value = subject;
    if (bodyInput) bodyInput.value = text;
    if (frame) {
      frame.hidden = !html;
      frame.srcdoc = html;
    }
    shiftState.letterText = text;
    shiftState.letterSubject = subject;
    document.getElementById('shiftLetterSend').disabled = false;
    const daysLabel = `${shiftLetterDays.length} day${shiftLetterDays.length === 1 ? '' : 's'}`;
    document.getElementById('shiftStatus').textContent = [scheduleNote, `${daysLabel} in the letter. Edit it, then send.`].filter(Boolean).join(' ');
  }

  async function sendFirstDaysLetter() {
    const name = document.getElementById('shiftLetterName').value.trim();
    const email = document.getElementById('shiftLetterEmail').value.trim();
    if (!email) throw new Error('An email address is required.');
    const subject = document.getElementById('shiftLetterSubject').value.trim();
    const text = document.getElementById('shiftLetterBody').value.trim();
    if (!text) throw new Error('Write the letter before sending it.');
    if (!window.confirm(`Send this letter to ${email}?`)) return;
    const bodyChanged = text !== shiftState.letterText;
    const result = await api('/api/welcome-letter/shifts/first-days/send', {
      method: 'POST',
      body: JSON.stringify({
        firstName: name,
        email,
        phone: letterContact().phone,
        fullName: letterContact().fullName,
        lead: shiftState.letterLead || null,
        days: shiftLetterDays,
        editedSubject: subject === shiftState.letterSubject ? '' : subject,
        editedText: bodyChanged ? text : '',
      }),
    });
    document.getElementById('shiftStatus').textContent = `Sent to ${result.to}.`;
    document.getElementById('shiftLetterSend').disabled = true;
  }

  function initShiftPanel() {
    if (shiftState.ready) return;
    shiftState.ready = true;
    const from = document.getElementById('shiftFrom');
    const to = document.getElementById('shiftTo');
    const today = pacificTodayYmd();
    if (from && !from.value) from.value = today;
    if (to && !to.value) to.value = addDaysYmd(today, 13);
    const add = document.getElementById('shiftActionAdd');
    const remove = document.getElementById('shiftActionRemove');
    if (add) add.addEventListener('click', () => { shiftState.action = 'add'; renderShiftActions(); });
    if (remove) remove.addEventListener('click', () => { shiftState.action = 'remove'; renderShiftActions(); });
    const type = document.getElementById('shiftType');
    if (type) type.addEventListener('change', () => { loadShiftCycles().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    [from, to].forEach((input) => {
      if (!input) return;
      input.addEventListener('change', () => { loadShiftTeams().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    });
    const employee = document.getElementById('shiftEmployee');
    if (employee) employee.addEventListener('change', chooseShiftEmployee);
    const preview = document.getElementById('shiftPreview');
    const execute = document.getElementById('shiftExecute');
    if (preview) preview.addEventListener('click', () => { previewShifts().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    if (execute) execute.addEventListener('click', () => { executeShifts().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    const letterPreview = document.getElementById('shiftLetterPreview');
    const letterSend = document.getElementById('shiftLetterSend');
    if (letterPreview) letterPreview.addEventListener('click', () => { previewFirstDaysLetter().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    if (letterSend) letterSend.addEventListener('click', () => { sendFirstDaysLetter().catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); }); });
    api('/api/welcome-letter/employees').then((data) => {
      fillShiftRoster(data.employees || []);
    }).catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); });
    api('/api/welcome-letter/shifts/types').then((data) => {
      shiftState.types = data.types || [];
      if (type) {
        type.innerHTML = shiftState.types.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`).join('');
      }
      return loadShiftCycles();
    }).catch((err) => { document.getElementById('shiftStatus').textContent = plainShiftError(err); });
    renderShiftActions();
  }

  function switchMainTab(name, { pushUrl = true } = {}) {
    const tab = name === 'referrals' || name === 'pto' || name === 'past' || name === 'chat' || name === 'shifts' || name === 'pathways' ? name : 'board';
    setPanel(document.getElementById('panelBoard'), tab === 'board');
    setPanel(document.getElementById('panelChat'), tab === 'chat');
    setPanel(document.getElementById('panelShifts'), tab === 'shifts');
    setPanel(document.getElementById('panelPast'), tab === 'past');
    setPanel(document.getElementById('panelReferrals'), tab === 'referrals');
    setPanel(document.getElementById('panelPto'), tab === 'pto');
    setPanel(document.getElementById('panelPathways'), tab === 'pathways');
    const boardActions = document.getElementById('boardActions');
    if (boardActions) boardActions.classList.toggle('wb-hidden', tab !== 'board');
    [
      ['tabBoard', 'board'],
      ['tabChat', 'chat'],
      ['tabShifts', 'shifts'],
      ['tabPast', 'past'],
      ['tabPto', 'pto'],
      ['tabPathways', 'pathways'],
      ['tabReferrals', 'referrals'],
    ].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = tab === key;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', String(on));
    });
    if (pushUrl) {
      const url = new URL(window.location.href);
      if (tab === 'board') {
        url.searchParams.delete('tab');
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('tab', tab);
        if (tab !== 'referrals') url.searchParams.delete('view');
      }
      window.history.replaceState(null, '', url.toString());
    }
    if (tab === 'past') {
      loadPastEmployees().catch((err) => {
        const tbody = document.getElementById('pastRows');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="wb-error">${escapeHtml(err.message)}</td></tr>`;
      });
    }
    if (tab === 'referrals') {
      loadReferrals().catch((err) => showRefBanner({ ok: false, message: err.message }));
    }
    if (tab === 'pto') {
      loadPto().catch((err) => showPtoBanner(err.message, false));
    }
    if (tab === 'shifts') initShiftPanel();
    if (tab === 'pathways' && window.PathwaysPanel) window.PathwaysPanel.open();
  }

  function initReferrals() {
    const boardTab = document.getElementById('tabBoard');
    const chatTab = document.getElementById('tabChat');
    const shiftsTab = document.getElementById('tabShifts');
    const ptoTab = document.getElementById('tabPto');
    const pathwaysTab = document.getElementById('tabPathways');
    const referralTab = document.getElementById('tabReferrals');
    const pastTab = document.getElementById('tabPast');
    if (boardTab) boardTab.addEventListener('click', () => switchMainTab('board'));
    if (chatTab) chatTab.addEventListener('click', () => switchMainTab('chat'));
    if (shiftsTab) shiftsTab.addEventListener('click', () => switchMainTab('shifts'));
    if (pastTab) pastTab.addEventListener('click', () => switchMainTab('past'));
    if (ptoTab) ptoTab.addEventListener('click', () => switchMainTab('pto'));
    if (pathwaysTab) pathwaysTab.addEventListener('click', () => switchMainTab('pathways'));
    if (referralTab) referralTab.addEventListener('click', () => switchMainTab('referrals'));
    const pastRefresh = document.getElementById('pastRefresh');
    if (pastRefresh) pastRefresh.addEventListener('click', () => {
      loadPastEmployees().catch((err) => {
        const tbody = document.getElementById('pastRows');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="wb-error">${escapeHtml(err.message)}</td></tr>`;
      });
    });
    const ptoRefresh = document.getElementById('ptoRefresh');
    if (ptoRefresh) ptoRefresh.addEventListener('click', () => {
      loadPto().catch((err) => showPtoBanner(err.message, false));
    });
    const ptoPull = document.getElementById('ptoPull');
    if (ptoPull) ptoPull.addEventListener('click', () => {
      ptoPull.disabled = true;
      api('/api/pto/pull', { method: 'POST', body: '{}' })
        .then(async (result) => {
          await loadPto();
          showPtoBanner(
            `Oracle: ${result.seen || 0} open, ${result.created || 0} new, ${result.updated || 0} updated.`,
            true,
          );
        })
        .catch((err) => showPtoBanner(err.message, false))
        .finally(() => { ptoPull.disabled = false; });
    });
    const ptoApprove = document.getElementById('ptoApprove');
    const ptoDeny = document.getElementById('ptoDeny');
    const ptoBuild = document.getElementById('ptoBuild');
    if (ptoApprove) ptoApprove.addEventListener('click', () => { ptoAct('approve').catch((err) => showPtoBanner(err.message, false)); });
    if (ptoDeny) ptoDeny.addEventListener('click', () => { ptoAct('deny').catch((err) => showPtoBanner(err.message, false)); });
    if (ptoBuild) ptoBuild.addEventListener('click', () => { ptoAct('build').catch((err) => showPtoBanner(err.message, false)); });
    const listBtn = document.getElementById('refViewList');
    const dueBtn = document.getElementById('refViewDue');
    if (listBtn) listBtn.addEventListener('click', () => setReferralView('list'));
    if (dueBtn) dueBtn.addEventListener('click', () => setReferralView('due'));
    const filter = document.getElementById('refFilterForm');
    if (filter) {
      filter.addEventListener('submit', (event) => {
        event.preventDefault();
        loadReferralList().catch((err) => showRefBanner({ ok: false, message: err.message }));
      });
    }
    const addBtn = document.getElementById('refAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => openReferralForm(null));
    const refreshBtn = document.getElementById('refRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadReferrals().catch((err) => showRefBanner({ ok: false, message: err.message }));
      });
    }
    const form = document.getElementById('referralForm');
    if (form) form.addEventListener('submit', (event) => { saveReferral(event).catch(() => {}); });
    const cancel = document.getElementById('refCancelBtn');
    if (cancel) cancel.addEventListener('click', closeReferralForm);
    const hoursForm = document.getElementById('referralHoursForm');
    if (hoursForm) hoursForm.addEventListener('submit', (event) => { saveHours(event).catch(() => {}); });
    const hoursCancel = document.getElementById('refHoursCancelBtn');
    if (hoursCancel) hoursCancel.addEventListener('click', closeHoursForm);
    const xlsx = document.getElementById('refXlsxBtn');
    const csv = document.getElementById('refCsvBtn');
    if (xlsx) xlsx.addEventListener('click', () => { downloadTracker('xlsx').catch(() => {}); });
    if (csv) csv.addEventListener('click', () => { downloadTracker('csv').catch(() => {}); });

    const url = new URL(window.location.href);
    const tab = url.searchParams.get('tab');
    if (tab === 'referrals') {
      switchMainTab('referrals', { pushUrl: false });
      if (url.searchParams.get('view') === 'due') setReferralView('due', { pushUrl: false });
    } else if (tab === 'past') {
      switchMainTab('past', { pushUrl: false });
    } else if (tab === 'pto') {
      switchMainTab('pto', { pushUrl: false });
    } else if (tab === 'pathways') {
      switchMainTab('pathways', { pushUrl: false });
    } else if (tab === 'chat') {
      switchMainTab('chat', { pushUrl: false });
    } else if (tab === 'shifts') {
      switchMainTab('shifts', { pushUrl: false });
    }
    const loaBtn = document.getElementById('loaBtn');
    if (loaBtn) {
      loaBtn.addEventListener('click', () => {
        const emp = employeeState.selected;
        if (!emp) return;
        toggleEmployeeLoa(emp.employeeId, emp.preferredName || emp.name, Boolean(emp.onLoa)).catch((err) => {
          const status = document.getElementById('noticeStatus');
          if (status) status.textContent = err.message;
        });
      });
    }
    const chatLoaBtn = document.getElementById('chatLoaBtn');
    if (chatLoaBtn) {
      chatLoaBtn.addEventListener('click', () => {
        const id = chatState.employeeId;
        if (!id) return;
        const emp = employeeState.items.find((item) => String(item.employeeId) === String(id));
        const name = emp ? (emp.preferredName || emp.name) : (document.getElementById('chatName').textContent || '');
        toggleEmployeeLoa(id, name, emp ? Boolean(emp.onLoa) : false).catch((err) => {
          const status = document.getElementById('chatStatus');
          if (status) status.textContent = err.message;
        });
      });
    }
    const chatSend = document.getElementById('chatSend');
    if (chatSend) chatSend.addEventListener('click', () => { sendTabChat().catch(() => {}); });
  }

  bindEmployeeNotice();

  boot().catch((err) => {
    const summary = document.getElementById('listSummary');
    if (summary) summary.textContent = err.message;
  });
})();
