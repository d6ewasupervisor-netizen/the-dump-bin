(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const statusEl = el('status');
  const storeSel = el('f-store');
  const dateSel = el('f-date');
  const rowsBody = el('rows');
  const groupsEl = el('groups');
  const countsEl = el('counts');
  const checkAll = el('check-all');
  const enqueueSelectedBtn = el('btn-enqueue-selected');

  let state = { groups: [], rows: [], totalPending: 0 };

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusPill(value, side) {
    const v = String(value || '').trim();
    if (!v) return '<span class="pill warn">pending</span>';
    const ok = /^(ok|exists|skipped|already_present|ok_already_complete)$/i.test(v);
    const bad = /^(error|failed|unavailable)$/i.test(v);
    const cls = ok ? 'ok' : bad ? 'bad' : 'warn';
    return `<span class="pill ${cls}" title="${esc(side)}">${esc(v)}</span>`;
  }

  function selectedIds() {
    return [...rowsBody.querySelectorAll('input.row-check:checked')]
      .map((n) => Number(n.value))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  function syncSelectionUi() {
    const boxes = [...rowsBody.querySelectorAll('input.row-check')];
    const picked = boxes.filter((b) => b.checked).length;
    enqueueSelectedBtn.disabled = picked === 0;
    if (!boxes.length) {
      checkAll.checked = false;
      checkAll.indeterminate = false;
      return;
    }
    checkAll.checked = picked === boxes.length;
    checkAll.indeterminate = picked > 0 && picked < boxes.length;
  }

  function fillFilterOptions(groups) {
    const stores = [...new Set(groups.map((g) => String(g.store_number || '')))].filter(Boolean).sort((a, b) => Number(a) - Number(b));
    const dates = [...new Set(groups.map((g) => String(g.work_date || '').slice(0, 10)))].filter(Boolean).sort().reverse();
    const curStore = storeSel.value;
    const curDate = dateSel.value;
    storeSel.innerHTML = '<option value="">All stores</option>' + stores.map((s) =>
      `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    dateSel.innerHTML = '<option value="">All dates</option>' + dates.map((d) =>
      `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    if (stores.includes(curStore)) storeSel.value = curStore;
    if (dates.includes(curDate)) dateSel.value = curDate;
  }

  function renderCounts(data) {
    const groups = data.groups || [];
    const prod = groups.reduce((n, g) => n + (Number(g.prod_pending) || 0), 0);
    const si = groups.reduce((n, g) => n + (Number(g.si_pending) || 0), 0);
    countsEl.innerHTML = [
      ['Pending', data.totalPending || 0],
      ['Store-days', groups.length],
      ['PROD short', prod],
      ['SI short', si],
    ].map(([label, n]) => `<div class="count"><b>${esc(n)}</b><span>${esc(label)}</span></div>`).join('');
  }

  function renderGroups(groups) {
    if (!groups.length) {
      groupsEl.innerHTML = '<p class="empty">No pending buffer rows.</p>';
      return;
    }
    groupsEl.innerHTML = groups.map((g) => {
      const store = esc(g.store_number);
      const date = esc(String(g.work_date || '').slice(0, 10));
      return `<div class="group">
        <div>
          <div class="title">FM${store} · ${date}</div>
          <div class="meta">${esc(g.pending)} pending · before ${esc(g.before_count)} · after ${esc(g.after_count)} · PROD ${esc(g.prod_pending)} · SI ${esc(g.si_pending)}</div>
        </div>
        <div class="acts">
          <button type="button" class="btn secondary" data-filter-store="${store}" data-filter-date="${date}">View</button>
          <button type="button" class="btn" data-enqueue-store="${store}" data-enqueue-date="${date}">Enqueue</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderRows(rows) {
    if (!rows.length) {
      rowsBody.innerHTML = '<tr><td colspan="10" class="empty">No pending bays for this filter.</td></tr>';
      syncSelectionUi();
      return;
    }
    rowsBody.innerHTML = rows.map((r) => `<tr>
      <td><input type="checkbox" class="row-check" value="${esc(r.id)}"></td>
      <td>${esc(r.storeNumber)}</td>
      <td>${esc(r.workDate)}</td>
      <td class="mono">${esc(r.dbkey)}</td>
      <td>${esc(r.slot)}</td>
      <td>${esc(r.bay)}</td>
      <td>${statusPill(r.prodStatus, 'PROD')}</td>
      <td>${statusPill(r.siStatus, 'SI')}</td>
      <td>${esc((r.actorEmail || '').split('@')[0] || '—')}</td>
      <td class="err">${esc(r.lastError || '')}</td>
    </tr>`).join('');
    syncSelectionUi();
  }

  async function load() {
    setStatus('Loading…');
    const qs = new URLSearchParams();
    if (storeSel.value) qs.set('store', storeSel.value);
    if (dateSel.value) qs.set('date', dateSel.value);
    qs.set('limit', '300');
    const res = await dumpBinAuthFetch(`/api/field-set/reconcile/pending?${qs.toString()}`, { noBounceOn401: true });
    if (res.status === 403) {
      setStatus('Owner access only.', 'bad');
      groupsEl.innerHTML = '<p class="empty">No access.</p>';
      rowsBody.innerHTML = '<tr><td colspan="10" class="empty">No access.</td></tr>';
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(body.error || `Load failed (${res.status})`, 'bad');
      return;
    }
    const data = await res.json();
    state = data;
    fillFilterOptions(data.groups || []);
    renderCounts(data);
    renderGroups(data.groups || []);
    renderRows(data.rows || []);
    setStatus(`${data.totalPending || 0} pending across ${(data.groups || []).length} store-days`, 'ok');
  }

  async function enqueue(payload) {
    setStatus('Enqueueing…');
    const res = await dumpBinAuthFetch('/api/field-set/reconcile/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      noBounceOn401: true,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      setStatus(body.error || `Enqueue failed (${res.status})`, 'bad');
      return;
    }
    setStatus(`Queued ${body.queued || 0}, skipped ${body.skipped || 0}`, 'ok');
    await load();
  }

  async function boot() {
    try {
      const meRes = await dumpBinAuthFetch('/api/me', { noBounceOn401: true });
      if (meRes.ok) {
        const me = await meRes.json();
        el('me').textContent = me.name || me.email || 'Signed in';
        const cards = me.cards || [];
        if (!cards.includes('set-photo-reconcile')) {
          setStatus('Owner access only.', 'bad');
          return;
        }
      }
    } catch (_) { /* continue; API gate still applies */ }
    await load();
  }

  el('btn-refresh').addEventListener('click', () => { load().catch((e) => setStatus(e.message, 'bad')); });
  storeSel.addEventListener('change', () => { load().catch((e) => setStatus(e.message, 'bad')); });
  dateSel.addEventListener('change', () => { load().catch((e) => setStatus(e.message, 'bad')); });
  checkAll.addEventListener('change', () => {
    rowsBody.querySelectorAll('input.row-check').forEach((b) => { b.checked = checkAll.checked; });
    syncSelectionUi();
  });
  rowsBody.addEventListener('change', (ev) => {
    if (ev.target && ev.target.classList.contains('row-check')) syncSelectionUi();
  });
  enqueueSelectedBtn.addEventListener('click', () => {
    const ids = selectedIds();
    if (!ids.length) return;
    enqueue({ ids }).catch((e) => setStatus(e.message, 'bad'));
  });
  el('btn-enqueue-filtered').addEventListener('click', () => {
    const payload = { limit: 40 };
    if (storeSel.value) payload.storeNumber = storeSel.value;
    if (dateSel.value) payload.workDate = dateSel.value;
    enqueue(payload).catch((e) => setStatus(e.message, 'bad'));
  });
  groupsEl.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.filterStore) {
      storeSel.value = t.dataset.filterStore;
      dateSel.value = t.dataset.filterDate || '';
      load().catch((e) => setStatus(e.message, 'bad'));
      return;
    }
    if (t.dataset.enqueueStore) {
      enqueue({
        storeNumber: t.dataset.enqueueStore,
        workDate: t.dataset.enqueueDate,
        limit: 40,
      }).catch((e) => setStatus(e.message, 'bad'));
    }
  });

  boot().catch((e) => setStatus(e.message || String(e), 'bad'));
})();
