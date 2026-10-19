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

  function api(path, opts) {
    const f = window.dumpBinAuthFetch || fetch;
    return f(`${API}${path}`, opts).then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || `Request failed (${resp.status})`);
      return data;
    });
  }

  function splitTime(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return { h: '', min: '', ap: '' };
    return { h: String(Number(m[1])), min: m[2], ap: m[3].toUpperCase() };
  }

  function vsSchedule(minutes) {
    if (minutes == null || !Number.isFinite(minutes) || minutes === 0) return '';
    const n = Math.abs(minutes);
    const span = n >= 60 ? `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m` : `${n}m`;
    return ` (${span} ${minutes < 0 ? 'early' : 'late'})`;
  }

  function instaworkClock(iw, side) {
    const time = iw && (side === 'in' ? iw.clockIn : iw.clockOut);
    if (!time) return '';
    const delta = side === 'in' ? iw.inVsScheduled : iw.outVsScheduled;
    return `<div class="muted iw-clock">Instawork ${esc(time)}${esc(vsSchedule(delta))}</div>`;
  }

  function instaworkLine(sync) {
    if (!sync || sync.skipped || sync.unchanged) return '';
    if (sync.ok === false) return `Instawork not updated: ${sync.error || 'unknown error'}`;
    return `Instawork ${sync.clockIn}–${sync.clockOut}`;
  }

  function timeSelects(field, label, value) {
    const parts = splitTime(value);
    const hours = ['<option value=""></option>'];
    for (let h = 1; h <= 12; h += 1) {
      hours.push(`<option value="${h}"${String(h) === parts.h ? ' selected' : ''}>${h}</option>`);
    }
    const mins = ['<option value=""></option>'];
    for (let m = 0; m < 60; m += 1) {
      const mm = String(m).padStart(2, '0');
      mins.push(`<option value="${mm}"${mm === parts.min ? ' selected' : ''}>${mm}</option>`);
    }
    const periods = ['', 'AM', 'PM'].map((p) => (
      `<option value="${p}"${p === parts.ap ? ' selected' : ''}>${p}</option>`
    ));
    return `<span class="time-edit" data-field="${field}">
      <select data-part="h" aria-label="${label} hour">${hours.join('')}</select>
      <select data-part="min" aria-label="${label} minute">${mins.join('')}</select>
      <select data-part="ap" aria-label="${label}">${periods.join('')}</select>
    </span>`;
  }

  function readTime(tr, field) {
    const box = tr.querySelector(`.time-edit[data-field="${field}"]`);
    if (!box) return '';
    const h = box.querySelector('[data-part="h"]').value;
    const min = box.querySelector('[data-part="min"]').value;
    const ap = box.querySelector('[data-part="ap"]').value;
    if (!h && !min && !ap) return '';
    if (!h || min === '' || !ap) {
      const err = new Error(`${field === 'clockIn' ? 'Start' : field === 'clockOut' ? 'End' : 'Break'} needs an hour, minute, and AM or PM`);
      throw err;
    }
    return `${Number(h)}:${min} ${ap}`;
  }

  function prodLine(sync) {
    if (!sync) return 'Saved';
    if (sync.skipped) return 'Saved. PROD updates when end is set.';
    if (sync.error) return sync.error;
    const shifts = sync.shifts || [];
    if (!shifts.length) return sync.ok ? 'Sent to PROD' : 'Saved';
    const bad = shifts.filter((s) => !s.ok);
    if (bad.length) return bad.map((s) => `${s.label}: ${s.error || 'not saved'}`).join(' ');
    return `PROD ${shifts.map((s) => s.label).join(', ')}`;
  }

  /** A shift this long or shorter has no break. */
  const NO_BREAK_MAX_MINUTES = 240;

  function clockMinutes(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    return (Number(m[1]) % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
  }

  function nowPacificMinutes() {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
    return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  }

  /** In to out, or in to now while still on shift today. */
  function workedMinutes(w) {
    const start = clockMinutes(w.clockIn);
    if (start == null) return null;
    let end = clockMinutes(w.clockOut);
    if (end == null) {
      if (w.workDate !== todayPacific()) return null;
      end = nowPacificMinutes();
    }
    return (end - start + 1440) % 1440;
  }

  function breakDue(w) {
    if (w.lunchOut && w.lunchIn) return false;
    const worked = workedMinutes(w);
    return worked != null && worked > NO_BREAK_MAX_MINUTES;
  }

  function statusPill(w) {
    if (w.noShow) return '<span class="pill pill-no">No show</span>';
    if (!w.clockIn) {
      return w.employeeKey
        ? '<span class="pill pill-wait">Needs start</span>'
        : '<span class="pill pill-off">Not in yet</span>';
    }
    if (breakDue(w)) return '<span class="pill pill-wait">Needs break</span>';
    if (!w.clockOut) return '<span class="pill pill-ok">On shift</span>';
    if (!w.signed) return '<span class="pill pill-wait">Needs signature</span>';
    return '<span class="pill pill-ok">Signed off</span>';
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
      const verified = list.filter((w) => w.lastLoginAt || w.assignedAt).length;
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
          <tbody>${list.map((w) => `<tr data-roster="${esc(w.id)}">
            <td data-label="Name"><strong>${esc(w.name)}</strong>${w.shiftStart ? `<br><span class="muted">${esc(w.shiftStart)}${w.shiftEnd ? ` – ${esc(w.shiftEnd)}` : ''}</span>` : ''}</td>
            <td data-label="Phone" class="num"><a href="tel:${esc(w.phone)}">${esc(prettyPhone(w.phone))}</a></td>
            <td data-label="Slot">${esc(w.employeeName || '—')}</td>
            <td data-label="Verified" class="num">${esc(pacificTime(w.lastLoginAt || w.assignedAt))}${w.signinMethod ? `<br><span class="muted">${esc(w.signinMethod)}</span>` : ''}</td>
            <td data-label="Clock in" class="num">${timeSelects('clockIn', 'Start', w.clockIn)}${instaworkClock(w.instaworkClock, 'in')}</td>
            <td data-label="Lunch" class="num">${timeSelects('lunchOut', 'Break start', w.lunchOut)}<span class="dash">–</span>${timeSelects('lunchIn', 'Break end', w.lunchIn)}</td>
            <td data-label="Clock out" class="num">${timeSelects('clockOut', 'End', w.clockOut)}${instaworkClock(w.instaworkClock, 'out')}</td>
            <td data-label="Status">${statusPill(w)}<button type="button" class="btn btn-small" data-save="${esc(w.id)}">Save</button><button type="button" class="btn btn-small btn-secondary" data-noshow="${esc(w.id)}">No show</button><div class="save-note" data-note="${esc(w.id)}" hidden></div></td>
          </tr>`).join('')}</tbody>
        </table>
      </section>`;
    }
    $('boards').innerHTML = html;
    $('boards').querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(btn));
    });
    $('boards').querySelectorAll('[data-noshow]').forEach((btn) => {
      btn.addEventListener('click', () => markNoShow(btn));
    });
    $('boards').querySelectorAll('.time-edit select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const tr = sel.closest('tr');
        if (tr && tr.dataset.roster) dirty.add(tr.dataset.roster);
      });
    });
    for (const [id, note] of Object.entries(saveNotes)) {
      const el = $('boards').querySelector(`[data-note="${id}"]`);
      if (!el || !note) continue;
      el.hidden = false;
      el.textContent = note.text;
      el.classList.toggle('is-bad', note.bad);
    }
  }

  const saveNotes = {};
  /** Rows with picker changes that are not saved yet. Auto refresh waits for them. */
  const dirty = new Set();

  async function saveRow(btn) {
    const tr = btn.closest('tr');
    const id = tr && tr.dataset.roster;
    const note = tr.querySelector('[data-note]');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Saving';
    if (note) { note.hidden = true; note.classList.remove('is-bad'); }
    try {
      const data = await api('/times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rosterId: id,
          clockIn: readTime(tr, 'clockIn'),
          lunchOut: readTime(tr, 'lunchOut'),
          lunchIn: readTime(tr, 'lunchIn'),
          clockOut: readTime(tr, 'clockOut'),
        }),
      });
      const text = [prodLine(data.prodSync), instaworkLine(data.instaworkSync)].filter(Boolean).join(' · ');
      const prodBad = Boolean(data.prodSync && data.prodSync.ok === false && !data.prodSync.skipped);
      const iwBad = Boolean(data.instaworkSync && data.instaworkSync.ok === false);
      saveNotes[id] = { text, bad: prodBad || iwBad };
      dirty.delete(id);
      await load();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      if (note) {
        note.hidden = false;
        note.textContent = err.message || 'Could not save';
        note.classList.add('is-bad');
      }
    }
  }

  async function markNoShow(btn) {
    const tr = btn.closest('tr');
    const id = tr && tr.dataset.roster;
    const note = tr.querySelector('[data-note]');
    btn.disabled = true;
    btn.textContent = 'Saving';
    try {
      const data = await api('/no-show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: id }),
      });
      dirty.delete(id);
      const cleared = data.prodSync && data.prodSync.ok ? 'No show. PROD cleared.' : 'No show saved.';
      saveNotes[id] = { text: data.prodSync && data.prodSync.error ? data.prodSync.error : cleared, bad: Boolean(data.prodSync && data.prodSync.ok === false && !data.prodSync.skipped) };
      await load();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'No show';
      if (note) {
        note.hidden = false;
        note.textContent = err.message || 'Could not save';
        note.classList.add('is-bad');
      }
    }
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
    timer = setInterval(() => {
      const el = document.activeElement;
      if (el && el.closest && el.closest('#boards select')) return;
      if (dirty.size) return;
      load();
    }, REFRESH_MS);
  }

  async function addPerson() {
    const note = $('addNote');
    const store = String($('store').value || '').replace(/\D/g, '');
    const date = $('date').value;
    const name = $('addName').value.trim();
    const phone = $('addPhone').value.trim();
    note.hidden = true;
    note.classList.remove('is-bad');
    if (!store || !date) {
      note.hidden = false;
      note.textContent = 'Set the store and date first.';
      note.classList.add('is-bad');
      return;
    }
    $('addBtn').disabled = true;
    try {
      await api('/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeNumber: store, workDate: date, name, phone }),
      });
      $('addName').value = '';
      $('addPhone').value = '';
      note.hidden = false;
      note.textContent = 'Added';
      await load();
    } catch (err) {
      note.hidden = false;
      note.textContent = err.message || 'Could not add';
      note.classList.add('is-bad');
    } finally {
      $('addBtn').disabled = false;
    }
  }

  function boot() {
    const u = new URL(window.location.href);
    $('date').value = u.searchParams.get('date') || todayPacific();
    $('store').value = u.searchParams.get('store') || '';
    const reload = () => { dirty.clear(); load(); };
    $('refreshBtn').addEventListener('click', reload);
    $('date').addEventListener('change', reload);
    $('store').addEventListener('change', reload);
    $('addBtn').addEventListener('click', addPerson);
    load();
    startTimer();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !dirty.size) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
