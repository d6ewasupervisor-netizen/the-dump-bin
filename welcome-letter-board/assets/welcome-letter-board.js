(function () {
  const UI_VERSION = 'v2.12';
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
      el.title = `Welcome Letter Board UI ${UI_VERSION}`;
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

  async function api(path, options = {}) {
    const fetchFn = window.dumpBinAuthFetch || fetch;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const res = await fetchFn(path, {
      credentials: 'include',
      ...options,
      headers,
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_err) { body = { raw: text }; }
    if (!res.ok) {
      throw new Error(body.error || body.message || `HTTP ${res.status}`);
    }
    return body;
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
      const res = await fetchFn('/api/me', { noBounceOn401: true, credentials: 'include' });
      if (!res.ok) return false;
      const me = await res.json();
      state.signedInEmail = me?.email || null;
      const signedEl = document.getElementById('signedInAs');
      if (signedEl && state.signedInEmail) {
        signedEl.textContent = `Signed in as ${state.signedInEmail}`;
        signedEl.hidden = false;
      }
      // Single source of truth: eod-api's WELCOME_LETTER_ALLOWED_EMAILS,
      // via /api/me's hasWelcomeLetterAccess. Don't keep a separate copy of
      // the allowlist here — that's exactly what caused it to drift before.
      return !!(me && me.hasWelcomeLetterAccess);
    } catch (_err) {
      return false;
    }
  }

  function showAccessDenied() {
    const denied = document.getElementById('wbAccessDenied');
    const app = document.getElementById('wbApp');
    if (app) app.hidden = true;
    if (denied) denied.classList.remove('wb-hidden');
  }

  async function boot() {
    if (window.dumpBinAuthReady) await window.dumpBinAuthReady;
    setVersionBadge(null);

    const allowed = await ensureWelcomeAccess();
    if (!allowed) {
      showAccessDenied();
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
      email: emp.email,
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

  function renderEmployeeThread(items) {
    const el = document.getElementById('employeeThread');
    if (!items.length) {
      el.textContent = 'No notices yet.';
      return;
    }
    el.innerHTML = items.map((item) => {
      const who = item.kind === 'reply'
        ? (item.from || 'Associate')
        : (item.sentByEmail || 'Staff');
      const label = item.kind === 'reply' ? 'Reply' : (item.metadata?.kindLabel || item.kind || 'Notice');
      return `<div style="padding:8px 0;border-bottom:1px solid var(--wb-line);">
        <div><strong>${escapeHtml(label)}</strong> · ${escapeHtml(fmtDate(item.sentAt))}</div>
        <div class="wb-muted">${escapeHtml(who)}</div>
      </div>`;
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

  function selectEmployee(emp) {
    employeeState.selected = emp;
    document.getElementById('employeeEmpty').hidden = true;
    document.getElementById('employeeBody').hidden = false;
    document.getElementById('employeeName').textContent = emp.name || 'Employee';
    document.getElementById('employeeMeta').textContent = [emp.email, emp.phone, emp.title].filter(Boolean).join(' · ');
    document.getElementById('noticeLastWorked').value = emp.lastWorkedOn || '';
    document.getElementById('noticeStatus').textContent = '';
    document.querySelectorAll('#employeeRows tr').forEach((tr) => {
      tr.classList.toggle('is-selected', String(tr.dataset.id) === String(emp.employeeId));
    });
    syncNoticeFields();
    loadEmployeeThread(emp).catch((err) => {
      document.getElementById('employeeThread').textContent = err.message;
    });
  }

  async function loadEmployees(refresh) {
    const tbody = document.getElementById('employeeRows');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="wb-muted">Loading…</td></tr>';
    try {
      const data = await api(`/api/welcome-letter/employees${refresh ? '?refresh=1' : ''}`);
      employeeState.items = data.employees || [];
      if (!employeeState.items.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="wb-muted">No direct reports returned.</td></tr>';
        return;
      }
      tbody.innerHTML = employeeState.items.map((emp) => `<tr data-id="${escapeHtml(emp.employeeId)}">
        <td>${escapeHtml(emp.preferredName || emp.name)}</td>
        <td>${escapeHtml(emp.email || '—')}</td>
        <td>${escapeHtml(emp.lastWorkedOn || '—')}</td>
      </tr>`).join('');
      tbody.querySelectorAll('tr').forEach((tr) => {
        tr.addEventListener('click', () => {
          const emp = employeeState.items.find((e) => String(e.employeeId) === tr.dataset.id);
          if (emp) selectEmployee(emp);
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="wb-error">${escapeHtml(err.message)}</td></tr>`;
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
    document.getElementById('noticePreview').srcdoc = data.html;
    document.getElementById('noticePreviewWrap').classList.remove('wb-hidden');
    status.textContent = `Reply-to ${data.replyTo}. BCC ${ (data.bcc || []).join(', ') }.`;
  }

  async function sendNotice() {
    const status = document.getElementById('noticeStatus');
    const payload = noticePayload();
    if (!payload) return;
    if (!window.confirm(`Send this notice to ${payload.email}?`)) return;
    status.textContent = 'Sending…';
    const data = await api('/api/welcome-letter/employees/notice/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    status.textContent = `Sent to ${data.to}.`;
    if (employeeState.selected) await loadEmployeeThread(employeeState.selected);
    await loadList();
  }

  function bindEmployeeNotice() {
    const kind = document.getElementById('noticeKind');
    const refresh = document.getElementById('employeesRefresh');
    const preview = document.getElementById('noticePreviewBtn');
    const send = document.getElementById('noticeSendBtn');
    if (kind) kind.addEventListener('change', syncNoticeFields);
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

  function switchMainTab(name, { pushUrl = true } = {}) {
    const referrals = name === 'referrals';
    setPanel(document.getElementById('panelBoard'), !referrals);
    setPanel(document.getElementById('panelReferrals'), referrals);
    const boardActions = document.getElementById('boardActions');
    if (boardActions) boardActions.classList.toggle('wb-hidden', referrals);
    const boardTab = document.getElementById('tabBoard');
    const referralTab = document.getElementById('tabReferrals');
    if (boardTab) {
      boardTab.classList.toggle('is-active', !referrals);
      boardTab.setAttribute('aria-selected', String(!referrals));
    }
    if (referralTab) {
      referralTab.classList.toggle('is-active', referrals);
      referralTab.setAttribute('aria-selected', String(referrals));
    }
    if (pushUrl) {
      const url = new URL(window.location.href);
      if (referrals) url.searchParams.set('tab', 'referrals');
      else {
        url.searchParams.delete('tab');
        url.searchParams.delete('view');
      }
      window.history.replaceState(null, '', url.toString());
    }
    if (referrals) {
      loadReferrals().catch((err) => showRefBanner({ ok: false, message: err.message }));
    }
  }

  function initReferrals() {
    const boardTab = document.getElementById('tabBoard');
    const referralTab = document.getElementById('tabReferrals');
    if (boardTab) boardTab.addEventListener('click', () => switchMainTab('board'));
    if (referralTab) referralTab.addEventListener('click', () => switchMainTab('referrals'));
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
    if (url.searchParams.get('tab') === 'referrals') {
      switchMainTab('referrals', { pushUrl: false });
      if (url.searchParams.get('view') === 'due') setReferralView('due', { pushUrl: false });
    }
  }

  bindEmployeeNotice();

  boot().catch((err) => {
    const summary = document.getElementById('listSummary');
    if (summary) summary.textContent = err.message;
  });
})();
