(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { tab: 'compliance', data: null, sheet: null };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hms(seconds) {
    if (seconds == null) return '—';
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function api(path, opts) {
    const f = window.dumpBinAuthFetch || fetch;
    return f(path, opts).then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        const err = new Error(data.error || `Request failed (${resp.status})`);
        err.status = resp.status;
        throw err;
      }
      return data;
    });
  }

  function showError(err) {
    $('error').hidden = !err;
    $('error').textContent = err ? err.message : '';
  }

  function renderCompliance() {
    const rows = (state.data && state.data.overdue_required) || [];
    if (!rows.length) {
      $('compliance').innerHTML = '<p class="muted">None.</p>';
      return;
    }
    $('compliance').innerHTML = rows.map((course) => {
      const title = course.url
        ? `<a href="${esc(course.url)}">${esc(course.name || 'Course')}</a>`
        : esc(course.name || 'Course');
      const people = (course.people || []).map((person) => `<li>${esc(person.name)}</li>`).join('');
      return `<article class="card"><h2>${title}</h2><ul>${people}</ul></article>`;
    }).join('');
  }

  function renderPayouts() {
    const rows = (state.data && state.data.payouts) || [];
    const body = rows.map((row) => {
      const active = String(row.status).toLowerCase() === 'active' && !String(row.email).startsWith('name:');
      return `<tr>
        <td>${esc(row.name)}</td>
        <td>${esc(row.status)}</td>
        <td>${hms(row.lifetime_seconds)}</td>
        <td>${hms(row.unpaid_seconds)}</td>
        <td>${esc(row.last_paid_date || '—')}</td>
        <td>${row.days_since == null ? '—' : esc(row.days_since)}</td>
        <td>${row.due ? '<span class="due">Due</span>' : ''}</td>
        <td>${active ? `<button type="button" class="action" data-email="${esc(row.email)}">Record payout</button>` : ''}</td>
      </tr>`;
    }).join('');
    const sheet = (state.sheet || []).map((row) => (
      `<li>${esc(row.name)} — ${esc(row.hours)} hours</li>`
    )).join('');
    $('payouts').innerHTML = `
      <div class="actions">
        <button type="button" class="action secondary" id="payAll">Pay everyone</button>
      </div>
      <table>
        <thead><tr>
          <th>Name</th><th>Status</th><th>Lifetime</th><th>Unpaid</th><th>Last paid</th><th>Days</th><th></th><th></th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${sheet ? `<ul class="sheet">${sheet}</ul>` : ''}`;
    const all = $('payAll');
    if (all) all.addEventListener('click', () => pay({ all: true }, 'Record a payout for everyone active?'));
    $('payouts').querySelectorAll('[data-email]').forEach((btn) => {
      btn.addEventListener('click', () => pay({ email: btn.getAttribute('data-email') }, 'Record this payout?'));
    });
  }

  function render() {
    const when = state.data && state.data.captured_at
      ? new Date(state.data.captured_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      : '';
    $('when').textContent = when;
    $('compliance').hidden = state.tab !== 'compliance';
    $('payouts').hidden = state.tab !== 'payouts';
    $('tabCompliance').classList.toggle('active', state.tab === 'compliance');
    $('tabPayouts').classList.toggle('active', state.tab === 'payouts');
    renderCompliance();
    renderPayouts();
  }

  async function load() {
    showError(null);
    state.data = await api('/api/pathways');
    render();
  }

  async function pay(body, ask) {
    if (!window.confirm(ask)) return;
    showError(null);
    try {
      const result = await api('/api/pathways/payout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      state.sheet = result.sheet || [];
      state.tab = 'payouts';
      await load();
    } catch (err) {
      showError(err);
    }
  }

  $('tabCompliance').addEventListener('click', () => { state.tab = 'compliance'; render(); });
  $('tabPayouts').addEventListener('click', () => { state.tab = 'payouts'; render(); });
  load().catch(showError);
})();
