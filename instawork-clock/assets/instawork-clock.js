(function () {
  'use strict';

  const API = '/api/instawork-clock';
  const REFRESH_MS = 60 * 1000;
  const $ = (id) => document.getElementById(id);
  let timer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function todayPacific() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function dayLabel(iso) {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function pacificTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  }

  function prettyPhone(e164) {
    const d = String(e164 || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 || '');
  }

  function api(path) {
    const f = window.dumpBinAuthFetch || fetch;
    return f(`${API}${path}`).then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || `Request failed (${resp.status})`);
      return data;
    });
  }

  function statusPill(w) {
    if (!w.employeeKey) return '<span class="pill pill-off">Not in yet</span>';
    if (w.signed) return '<span class="pill pill-ok">Signed</span>';
    if (w.clockOut) return '<span class="pill pill-wait">Out, not signed</span>';
    if (w.clockIn) return '<span class="pill pill-ok">On shift</span>';
    return '<span class="pill pill-wait">Verified</span>';
  }

  function render(workers) {
    const groups = new Map();
    for (const w of workers) {
      const key = `${w.workDate}|${w.storeNumber}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    if (!groups.size) {
      $('boards').innerHTML = '<div class="card"><p class="muted">No InstaWorkers on the roster for this range.</p></div>';
      return;
    }
    let html = '';
    for (const [key, list] of groups) {
      const [date, store] = key.split('|');
      const inCount = list.filter((w) => w.clockIn).length;
      const signedCount = list.filter((w) => w.signed).length;
      const verified = list.filter((w) => w.employeeKey).length;
      html += `<section class="card">
        <div class="board-head">
          <h2>Store ${esc(store)} · ${esc(dayLabel(date))}</h2>
          <span class="counts muted">${list.length} booked · ${verified} verified · ${inCount} clocked in · ${signedCount} signed</span>
        </div>
        <table>
          <thead><tr>
            <th>Name</th><th>Phone</th><th>Slot</th><th>Verified</th>
            <th>Clock in</th><th>Lunch</th><th>Clock out</th><th>Status</th>
          </tr></thead>
          <tbody>${list.map((w) => `<tr>
            <td data-label="Name"><strong>${esc(w.name)}</strong>${w.shiftStart ? `<br><span class="muted">${esc(w.shiftStart)}${w.shiftEnd ? ` – ${esc(w.shiftEnd)}` : ''}</span>` : ''}</td>
            <td data-label="Phone" class="num"><a href="tel:${esc(w.phone)}">${esc(prettyPhone(w.phone))}</a></td>
            <td data-label="Slot">${esc(w.employeeName || '—')}</td>
            <td data-label="Verified" class="num">${esc(pacificTime(w.lastLoginAt || w.assignedAt))}</td>
            <td data-label="Clock in" class="num">${esc(w.clockIn)}</td>
            <td data-label="Lunch" class="num">${w.lunchOut ? `${esc(w.lunchOut)} – ${esc(w.lunchIn)}` : ''}</td>
            <td data-label="Clock out" class="num">${esc(w.clockOut)}</td>
            <td data-label="Status">${statusPill(w)}${w.confirmedBy ? `<br><span class="muted">by ${esc(w.confirmedBy)}</span>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </section>`;
    }
    $('boards').innerHTML = html;
  }

  async function load() {
    const date = $('date').value || todayPacific();
    const store = String($('store').value || '').replace(/\D/g, '');
    const qs = new URLSearchParams({ date, days: '7' });
    if (store) qs.set('store', store);
    try {
      const data = await api(`/overview?${qs.toString()}`);
      render(data.workers || []);
      $('updatedLabel').textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } catch (err) {
      $('boards').innerHTML = `<div class="card"><p class="muted">${esc(err.message || 'Could not load')}</p></div>`;
    }
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(load, REFRESH_MS);
  }

  function boot() {
    const u = new URL(window.location.href);
    $('date').value = u.searchParams.get('date') || todayPacific();
    $('store').value = u.searchParams.get('store') || '';
    $('refreshBtn').addEventListener('click', load);
    $('date').addEventListener('change', load);
    $('store').addEventListener('change', load);
    load();
    startTimer();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
