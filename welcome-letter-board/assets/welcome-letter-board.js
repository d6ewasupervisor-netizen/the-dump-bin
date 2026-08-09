(function () {
  const UI_VERSION = 'v2.3';
  const API_PREFIX = '/api/welcome-letter/board';

  const state = {
    page: 1,
    pageSize: 50,
    total: 0,
    selectedId: null,
    filters: {},
    sortBy: 'createdAt',
    sortDir: 'desc',
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

  function kindLabel(item) {
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

  function renderRows(items) {
    const tbody = document.getElementById('rows');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="wb-muted">No welcome letters match these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const selected = item.id === state.selectedId ? ' is-selected' : '';
      const to = (item.to || []).join(', ');
      const firstName = item.metadata?.firstName || '—';
      let nameExtra = '';
      if (item.metadata?.kind === 'disregard') {
        nameExtra = ' <span class="wb-muted">(disregard)</span>';
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
    document.getElementById('listSummary').textContent = `${state.total} welcome letter(s)`;
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
      if (!window.confirm(`Resend this welcome letter exactly as sent to ${(item.to || []).join(', ')}?`)) return;
      resendBtn.disabled = true;
      try {
        const result = await api(`${API_PREFIX}/${item.id}/resend`, { method: 'POST', body: '{}' });
        await loadList();
        if (result.recordId) await selectEmail(result.recordId);
        showJustSentBanner({ ok: true, message: 'Welcome letter resent.' });
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      } finally {
        resendBtn.disabled = !item.canResend;
      }
    };

    const cancelBtn = document.getElementById('cancelBtn');
    const canCancel = Boolean(item.canCancel);
    cancelBtn.disabled = !canCancel;
    cancelBtn.title = canCancel
      ? 'Mark cancelled, block resend of this variant, and email a disregard notice'
      : 'Already cancelled or not eligible';
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

  async function ensureWelcomeAccess() {
    try {
      if (window.dumpBinAuthReady) await window.dumpBinAuthReady;
      const fetchFn = window.dumpBinAuthFetch || fetch;
      const res = await fetchFn('/api/me', { noBounceOn401: true, credentials: 'include' });
      if (!res.ok) return false;
      const me = await res.json();
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
    updateSortHeaders();

    await loadList();

    if (idParam) {
      await selectEmail(Number(idParam), { pushUrl: false });
    }
  }

  boot().catch((err) => {
    const summary = document.getElementById('listSummary');
    if (summary) summary.textContent = err.message;
  });
})();
