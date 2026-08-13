(function () {
  const API_PREFIX = '/api/usage';
  const state = { tools: [], totals: null, dayKey: '' };

  function authFetch(url, options = {}) {
    const fetchFn = window.dumpBinAuthFetch || fetch;
    const headers = { ...(options.headers || {}) };
    if (!window.dumpBinAuthFetch) {
      let token = '';
      try {
        token = localStorage.getItem('dumpBinSession') || localStorage.getItem('eodSession') || '';
      } catch (_err) {}
      if (token) headers.Authorization = 'Bearer ' + token;
    }
    return fetchFn(url, { credentials: 'include', ...options, headers });
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtWhen(iso) {
    if (!iso) return 'never';
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch (_err) {
      return String(iso);
    }
  }

  function todayLabel(row) {
    if (!row.todayEvents) return '0';
    const bits = [];
    if (row.todayActions) bits.push(row.todayActions + ' action' + (row.todayActions === 1 ? '' : 's'));
    if (row.todayHeartbeats) bits.push(row.todayHeartbeats + ' min');
    if (row.todayActors) bits.push(row.todayActors + ' actor' + (row.todayActors === 1 ? '' : 's'));
    return bits.join(' · ') || String(row.todayEvents);
  }

  function currentFilters() {
    return {
      q: (document.getElementById('search').value || '').trim().toLowerCase(),
      group: document.getElementById('group').value,
      kind: document.getElementById('kind').value,
      today: document.getElementById('today').value,
    };
  }

  function filtered() {
    const f = currentFilters();
    return state.tools.filter((t) => {
      if (f.group && t.group !== f.group) return false;
      if (f.kind && t.kind !== f.kind) return false;
      if (f.today === 'used' && !t.todayEvents) return false;
      if (f.today === 'unused' && t.todayEvents) return false;
      if (f.q) {
        const hay = `${t.name} ${t.group} ${t.id} ${t.kind}`.toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
  }

  function render() {
    const rows = filtered();
    const tbody = document.getElementById('rows');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="muted">No matching tools.</td></tr>';
    } else {
      tbody.innerHTML = rows.map((t) => {
        const unused = !t.todayEvents;
        return `<tr class="${unused ? 'unused' : ''}">
          <td>${esc(t.name)}<span class="pill">${esc(t.kind)}</span>
            <span class="sub">${esc(t.group)}</span></td>
          <td class="num">${esc(todayLabel(t))}</td>
          <td>${esc(fmtWhen(t.lastAt))}${t.lastActor ? `<span class="sub">${esc(t.lastActor)}</span>` : ''}</td>
        </tr>`;
      }).join('');
    }
    const s = state.totals || {};
    document.getElementById('stats').innerHTML =
      `<strong>${s.usedToday || 0}</strong> used today · ` +
      `<strong>${s.unusedToday || 0}</strong> unused · ` +
      `<strong>${s.todayActions || 0}</strong> actions · ` +
      `<strong>${s.listed || 0}</strong> in catalog` +
      (state.dayKey ? ` · Pacific day <strong>${esc(state.dayKey)}</strong>` : '');
  }

  function fillGroups() {
    const sel = document.getElementById('group');
    const groups = [...new Set(state.tools.map((t) => t.group))].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">All groups</option>' +
      groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    if (current && groups.includes(current)) sel.value = current;
  }

  async function load() {
    const res = await authFetch(API_PREFIX + '/summary');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      document.getElementById('rows').innerHTML =
        `<tr><td colspan="3" class="error">${esc(err.error || ('HTTP ' + res.status))}</td></tr>`;
      return;
    }
    const data = await res.json();
    state.tools = data.tools || [];
    state.totals = data.totals || {};
    state.dayKey = data.dayKey || '';
    fillGroups();
    render();
  }

  document.getElementById('filterForm').addEventListener('input', render);
  document.getElementById('filterForm').addEventListener('change', render);
  document.getElementById('refreshBtn').addEventListener('click', () => load());
  document.getElementById('digestBtn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.hidden = false;
    status.textContent = 'Sending digest…';
    const res = await authFetch(API_PREFIX + '/digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json().catch(() => ({}));
    status.textContent = data.sent
      ? `Digest sent to ${data.to || 'you'}.`
      : (data.reason || data.error || 'Could not send digest');
  });

  load().catch((err) => {
    document.getElementById('rows').innerHTML =
      `<tr><td colspan="3" class="error">${esc(err.message)}</td></tr>`;
  });
})();
