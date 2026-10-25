(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { tab: 'compliance', data: null, sheet: null, busy: false };

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

  function eventLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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

  function logLine(line) {
    const box = $('log');
    box.hidden = false;
    box.textContent += (box.textContent ? '\n' : '') + line;
    box.scrollTop = box.scrollHeight;
  }

  function clearLog() {
    $('log').textContent = '';
    $('log').hidden = false;
  }

  async function stream(path, body) {
    const f = window.dumpBinAuthFetch || fetch;
    const opts = { method: 'POST' };
    if (body) {
      opts.headers = { 'content-type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const resp = await f(path, opts);
    if (!resp.ok && !(resp.headers.get('content-type') || '').includes('ndjson')) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${resp.status})`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let donePayload = null;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.line) logLine(msg.line);
        if (msg.error) throw new Error(msg.error);
        if (msg.done) donePayload = msg;
      }
    }
    return donePayload;
  }

  function events() {
    return (state.data && state.data.events) || [];
  }

  function eventColumns() {
    const seen = [];
    for (const event of events()) {
      if (!seen.includes(event.created_at)) seen.push(event.created_at);
    }
    return seen;
  }

  function eventCell(email, createdAt) {
    const hit = events().find((event) => event.email === email && event.created_at === createdAt);
    return hit ? hms(hit.seconds) : '';
  }

  function people(status) {
    return ((state.data && state.data.payouts) || []).filter((row) => (
      status === 'termed'
        ? String(row.status).toLowerCase() === 'termed'
        : String(row.status).toLowerCase() !== 'termed'
    ));
  }

  function table(rows, { checks }) {
    const cols = eventColumns();
    const head = cols.map((iso) => `<th>${esc(eventLabel(iso))}</th>`).join('');
    const body = rows.map((row) => {
      const active = checks && String(row.status).toLowerCase() === 'active' && !String(row.email).startsWith('name:');
      const extra = cols.map((iso) => `<td>${esc(eventCell(row.email, iso))}</td>`).join('');
      return `<tr>
        <td>${active ? `<input class="check" type="checkbox" data-email="${esc(row.email)}" />` : ''}</td>
        <td>${esc(row.name)}</td>
        <td>${esc(row.status)}</td>
        <td>${hms(row.lifetime_seconds)}</td>
        <td>${hms(row.unpaid_seconds)}</td>
        <td>${esc(row.last_paid_date || '—')}</td>
        <td>${row.days_since == null ? '—' : esc(row.days_since)}</td>
        <td>${row.due ? '<span class="due">Due</span>' : ''}</td>
        ${extra}
        <td>${active ? `<button type="button" class="action" data-email="${esc(row.email)}">Record payout</button>` : ''}</td>
      </tr>`;
    }).join('');
    return `<table>
      <thead><tr>
        <th></th><th>Name</th><th>Status</th><th>Lifetime</th><th>Unpaid</th><th>Last paid</th><th>Days</th><th></th>
        ${head}<th></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function splitCourses(person) {
    const owed = [];
    const done = [];
    const other = [];
    for (const course of person.courses || []) {
      if (!course) continue;
      if (course.completed) done.push(course);
      else if (course.overdue || course.required) owed.push(course);
      else other.push(course);
    }
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    owed.sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue) || byName(a, b));
    done.sort(byName);
    other.sort(byName);
    return { owed, done, other };
  }

  function courseLine(course) {
    const title = course.url
      ? `<a href="${esc(course.url)}">${esc(course.name || 'Course')}</a>`
      : esc(course.name || 'Course');
    const bits = [];
    if (course.due) bits.push(esc(course.due));
    if (course.seconds != null) bits.push(esc(hms(course.seconds)));
    if (course.activity) {
      const kind = course.activity_kind ? `${course.activity_kind} ` : '';
      bits.push(esc(`${kind}${course.activity}`));
    }
    const meta = bits.length ? `<span class="muted"> — ${bits.join(' — ')}</span>` : '';
    return `<li>${title}${meta}</li>`;
  }

  function courseGroup(title, items) {
    const body = items.length
      ? `<ul>${items.map(courseLine).join('')}</ul>`
      : '<p class="muted">None.</p>';
    return `<div class="course-group"><h3>${esc(title)}</h3>${body}</div>`;
  }

  function renderCompliance() {
    const pulled = state.data && state.data.captured_at
      ? new Date(state.data.captured_at).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short',
      })
      : '';
    const roster = ((state.data && state.data.people) || []).map((person) => ({
      person,
      courses: splitCourses(person),
    })).sort((a, b) => (
      b.courses.owed.length - a.courses.owed.length
      || String(a.person.name || '').localeCompare(String(b.person.name || ''))
    ));
    const owing = roster.filter((row) => row.courses.owed.length).length;
    const peopleHtml = roster.length ? roster.map(({ person, courses }) => {
      const overdue = courses.owed.some((course) => course.overdue);
      const owedLabel = courses.owed.length
        ? `<span class="due">${courses.owed.length} owed</span>`
        : '<span class="muted">0 owed</span>';
      const extra = courses.other.length ? courseGroup('Other', courses.other) : '';
      return `<details class="person">
        <summary>
          <span class="name${overdue ? ' due' : ''}">${esc(person.name)}</span>
          <span class="counts">${owedLabel}<span class="muted">${courses.done.length} complete</span></span>
        </summary>
        <div class="groups">
          ${courseGroup('Owed', courses.owed)}
          ${courseGroup('Completions', courses.done)}
          ${extra}
        </div>
      </details>`;
    }).join('') : '<p class="muted">None.</p>';
    $('compliance').innerHTML = `
      <div class="actions">
        <span class="muted">${pulled ? 'Pulled ' + esc(pulled) : ''}${owing ? ' · ' + owing + ' owing' : ''}</span>
        <button type="button" class="action" id="downloadReport">Download report</button>
      </div>
      ${peopleHtml}`;
    const download = $('downloadReport');
    if (download) download.addEventListener('click', downloadReport);
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadReport() {
    const when = (state.data && state.data.captured_at) || '';
    const header = ['Pull', 'Person', 'Email', 'Course', 'Course id', 'Required', 'Completed', 'Overdue', 'Due', 'Time spent', 'Activity date', 'Activity', 'URL'];
    const lines = [header];
    for (const person of (state.data && state.data.people) || []) {
      const courses = person.courses && person.courses.length ? person.courses : [null];
      for (const course of courses) {
        lines.push([
          when,
          person.name,
          person.email,
          course ? course.name : '',
          course ? course.id : '',
          course ? (course.required ? 'yes' : 'no') : '',
          course ? (course.completed ? 'yes' : 'no') : '',
          course ? (course.overdue ? 'yes' : 'no') : '',
          course ? (course.due || '') : '',
          hms(course ? course.seconds : person.lifetime_seconds),
          course ? (course.activity || '') : '',
          course ? (course.activity_kind || '') : '',
          course ? (course.url || '') : '',
        ]);
      }
    }
    const blob = new Blob([lines.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pathways-${when ? when.slice(0, 10) : 'report'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function renderPayouts() {
    const rows = people('active');
    const sheet = (state.sheet || []).map((row) => (
      `<li>${esc(row.name)} — ${esc(row.hours)} hours</li>`
    )).join('');
    $('payouts').innerHTML = `
      <div class="actions">
        <button type="button" class="action secondary" id="train">Build and run training shift</button>
        <button type="button" class="action secondary" id="payAll">Pay everyone</button>
      </div>
      ${table(rows, { checks: true })}
      ${sheet ? `<ul class="sheet">${sheet}</ul>` : ''}`;
    $('train').addEventListener('click', train);
    $('payAll').addEventListener('click', () => pay({ all: true }, 'Record a payout for everyone active?'));
    $('payouts').querySelectorAll('button[data-email]').forEach((btn) => {
      btn.addEventListener('click', () => pay({ email: btn.getAttribute('data-email') }, 'Record this payout?'));
    });
  }

  function renderTerminated() {
    const rows = people('termed');
    $('terminated').innerHTML = rows.length
      ? table(rows, { checks: false })
      : '<p class="muted">None.</p>';
  }

  function render() {
    const when = state.data && state.data.captured_at
      ? new Date(state.data.captured_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      : '';
    $('when').textContent = when;
    $('compliance').hidden = state.tab !== 'compliance';
    $('payouts').hidden = state.tab !== 'payouts';
    $('terminated').hidden = state.tab !== 'terminated';
    $('tabCompliance').classList.toggle('active', state.tab === 'compliance');
    $('tabPayouts').classList.toggle('active', state.tab === 'payouts');
    $('tabTerminated').classList.toggle('active', state.tab === 'terminated');
    renderCompliance();
    renderPayouts();
    renderTerminated();
    $('pullNow').disabled = state.busy;
  }

  async function load() {
    showError(null);
    state.data = await api('/api/pathways');
    render();
  }

  async function pay(body, ask) {
    if (state.busy) return;
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

  async function pullNow() {
    if (state.busy) return;
    state.busy = true;
    clearLog();
    render();
    showError(null);
    try {
      await stream('/api/pathways/pull');
      await load();
    } catch (err) {
      showError(err);
      logLine(err.message);
    } finally {
      state.busy = false;
      render();
    }
  }

  function selectedEmails() {
    return [...$('payouts').querySelectorAll('.check:checked')].map((box) => box.getAttribute('data-email'));
  }

  async function train() {
    if (state.busy) return;
    const emails = selectedEmails();
    if (!emails.length) {
      showError(new Error('Select at least one person.'));
      return;
    }
    if (!window.confirm(`Build one store 999 Training shift for ${emails.length} ${emails.length === 1 ? 'person' : 'people'} and record the payout?`)) return;
    state.busy = true;
    state.tab = 'payouts';
    clearLog();
    render();
    showError(null);
    try {
      const result = await stream('/api/pathways/training-shift', { emails });
      state.sheet = (result && result.sheet) || [];
      await load();
    } catch (err) {
      showError(err);
      logLine(err.message);
    } finally {
      state.busy = false;
      render();
    }
  }

  $('tabCompliance').addEventListener('click', () => { state.tab = 'compliance'; render(); });
  $('tabPayouts').addEventListener('click', () => { state.tab = 'payouts'; render(); });
  $('tabTerminated').addEventListener('click', () => { state.tab = 'terminated'; render(); });
  $('pullNow').addEventListener('click', pullNow);
  load().catch(showError);
})();
