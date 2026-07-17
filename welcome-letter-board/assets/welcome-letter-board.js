(function () {
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
    return badge(status || '—', 'pending');
  }

  function deliveryBadge(delivery) {
    const d = String(delivery || 'unknown').toLowerCase();
    if (d === 'delivered') return badge('Delivered', 'delivered');
    if (d === 'failed') return badge('Failed', 'failed');
    if (d === 'complained') return badge('Complained', 'complained');
    if (d === 'sent') return badge('In flight', 'sent');
    return badge(delivery || '—', 'pending');
  }

  function openedBadge(item) {
    if (item.openCount > 0) {
      return badge(`Opened ${item.openCount > 1 ? `×${item.openCount}` : ''}`.trim(), 'opened');
    }
    return badge('Not opened', 'not-opened');
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
      return `<tr data-id="${item.id}" class="${selected}">
        <td>${fmtDate(item.createdAt)}</td>
        <td>${statusBadge(item.status)}</td>
        <td>${deliveryBadge(item.deliveryStatus || item.lastEvent)}</td>
        <td>${openedBadge(item)}</td>
        <td>${escapeHtml(firstName)}</td>
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
      ? `${item.openCount}× (first ${fmtDate(item.openedAt)})`
      : 'Not opened yet';
    const clickedLine = item.clickCount > 0
      ? `${item.clickCount}× (first ${fmtDate(item.clickedAt)})`
      : 'No link clicks yet';

    const rows = [
      ['When', fmtDate(item.createdAt)],
      ['Status', item.status],
      ['Delivery', item.deliveryStatus || item.lastEvent || '—'],
      ['Opened', openedLine],
      ['Clicked', clickedLine],
      ['First Name', item.metadata?.firstName || '—'],
      ['From', item.from || '—'],
      ['To', (item.to || []).join(', ') || '—'],
      ['CC', (item.cc || []).join(', ') || '—'],
      ['Subject', item.subject || '—'],
      ['Sent By', item.sentByEmail || '—'],
      ['Resend ID', item.resendId || '—'],
      ['Can resend', item.canResend ? 'Yes' : 'No'],
    ];
    if (item.errorMessage) rows.push(['Error', item.errorMessage]);
    meta.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');

    const iframe = document.getElementById('detailPreview');
    iframe.srcdoc = item.htmlBody || '<p style="font-family:sans-serif;color:#666;">No HTML body stored.</p>';

    const err = document.getElementById('detailError');
    err.hidden = true;
    err.textContent = '';

    const resendBtn = document.getElementById('resendBtn');
    resendBtn.disabled = !item.canResend;
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

    const allowed = await ensureWelcomeAccess();
    if (!allowed) {
      showAccessDenied();
      return;
    }
    const denied = document.getElementById('wbAccessDenied');
    const app = document.getElementById('wbApp');
    if (denied) denied.classList.add('wb-hidden');
    if (app) app.hidden = false;

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
