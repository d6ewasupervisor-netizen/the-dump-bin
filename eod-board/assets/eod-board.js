(function () {
  'use strict';

  const API = '/api/eod-board';
  const state = { eods: [], selected: null, detail: null, editing: null, focusDbkey: null };

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function shortDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : String(iso || '');
  }

  function dayLabel(iso) {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function pacificTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', month: 'numeric', day: 'numeric',
    });
  }

  function api(path, opts) {
    const f = window.dumpBinAuthFetch || fetch;
    return f(`${API}${path}`, opts).then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        const err = new Error(data.error || `Request failed (${resp.status})`);
        err.code = data.code;
        throw err;
      }
      return data;
    });
  }

  function keyOf(e) { return `${e.storeNumber}|${e.workDate}`; }

  function renderList() {
    const q = String($('search').value || '').trim().toLowerCase();
    const list = state.eods.filter((e) => !q
      || String(e.storeNumber).includes(q)
      || String(e.leadName || '').toLowerCase().includes(q));
    if (!list.length) {
      $('eodList').innerHTML = '<p class="muted">No EODs.</p>';
      return;
    }
    let html = '';
    let day = '';
    for (const e of list) {
      if (e.workDate !== day) {
        day = e.workDate;
        html += `<div class="day-head">${esc(dayLabel(day))}</div>`;
      }
      const active = state.selected && keyOf(state.selected) === keyOf(e) ? ' active' : '';
      html += `<button type="button" class="eod-item${active}" data-key="${esc(keyOf(e))}">
        <span><strong>Store ${esc(e.storeNumber)}</strong><br><span class="muted">${esc(e.leadName || e.leadEmail || '')}</span></span>
        ${e.exceptionCount ? `<span class="badge">${e.exceptionCount} exception${e.exceptionCount === 1 ? '' : 's'}</span>` : ''}
      </button>`;
    }
    $('eodList').innerHTML = html;
    $('eodList').querySelectorAll('[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [store, date] = btn.getAttribute('data-key').split('|');
        state.focusDbkey = null;
        openDetail(store, date);
      });
    });
  }

  function setQuery(store, date, edit) {
    const qs = new URLSearchParams();
    if (store) qs.set('store', store);
    if (date) qs.set('date', date);
    if (edit) qs.set('edit', edit);
    const s = qs.toString();
    history.replaceState({}, '', `${location.pathname}${s ? `?${s}` : ''}`);
  }

  async function openDetail(store, date) {
    const same = state.selected && keyOf(state.selected) === `${store}|${date}`;
    state.selected = { storeNumber: String(store), workDate: String(date) };
    if (!same) state.editing = null;
    renderList();
    setQuery(store, date, state.focusDbkey);
    $('detailEmpty').hidden = true;
    const body = $('detailBody');
    body.hidden = false;
    body.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await api(`/detail?store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`);
      if (!state.selected || keyOf(state.selected) !== `${store}|${date}`) return;
      state.detail = data;
      if (state.focusDbkey && !state.autoEdited) {
        state.autoEdited = true;
        const c = (data.categories || []).find((x) => String(x.dbkey || '').replace(/^0+/, '') === state.focusDbkey);
        if (c && data.canEdit && data.prodLive && !c.locked) state.editing = c.dbkey;
      }
      renderDetail();
    } catch (err) {
      body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }

  function commentRow(c) {
    const d = state.detail;
    const editing = state.editing === c.dbkey;
    let actions = '';
    if (c.locked) {
      actions = '<span class="lock-note">Set by a Not in Store / Not Executable mark — change it in the field app.</span>';
    } else if (d.canEdit && d.prodLive && !editing) {
      actions = `<button type="button" class="btn secondary" data-edit="${esc(c.dbkey)}">Edit</button>
        ${c.comment ? `<button type="button" class="btn danger" data-remove="${esc(c.dbkey)}">Remove</button>` : ''}`;
    }
    const commentCell = editing
      ? `<td class="editor" colspan="2">
          <textarea id="editBox" maxlength="1000">${esc(c.comment)}</textarea>
          <div class="row-actions">
            <button type="button" class="btn" data-save="${esc(c.dbkey)}">Save</button>
            <button type="button" class="btn secondary" data-cancel="1">Cancel</button>
          </div>
          <div class="error" id="editErr" hidden></div>
        </td>`
      : `<td class="comment">${c.comment ? esc(c.comment) : '<span class="muted">—</span>'}</td>
         <td class="actions">${actions}</td>`;
    const flash = state.focusDbkey && state.focusDbkey === String(c.dbkey || '').replace(/^0+/, '') ? ' class="flash"' : '';
    return `<tr id="row-${esc(c.dbkey)}"${flash}>
      <td>${esc(c.name)}</td>
      <td>${esc(c.dbkey || '')}</td>
      ${commentCell}
    </tr>`;
  }

  function renderDetail() {
    const d = state.detail;
    const body = $('detailBody');
    const exceptions = d.exceptions || [];
    const edits = d.edits || [];
    body.innerHTML = `
      <div class="detail-head">
        <h2>Store ${esc(d.storeNumber)} · ${esc(shortDate(d.workDate))}</h2>
        <span class="muted">${esc(d.leadName || d.leadEmail || '')}${d.sentAt ? ` · sent ${esc(pacificTime(d.sentAt))}` : ''}</span>
      </div>
      <div class="links">
        ${d.pdfUrl ? `<a class="btn" href="${esc(d.pdfUrl)}" target="_blank" rel="noopener">Open EOD PDF</a>` : ''}
        ${d.signoffViewUrl ? `<a class="btn secondary" href="${esc(d.signoffViewUrl)}" target="_blank" rel="noopener">Signoff review board</a>` : ''}
        ${d.prodShiftUrl ? `<a class="btn secondary" href="${esc(d.prodShiftUrl)}" target="_blank" rel="noopener">PROD shift</a>` : ''}
      </div>
      ${d.prodLive ? '' : '<p class="error">PROD is not reachable right now — comments shown are from the last sync and cannot be edited.</p>'}
      ${exceptions.length ? `
        <div class="section-title alert">Exceptions found and cleared</div>
        <table>
          <thead><tr><th>Category</th><th>DBKey</th><th>Exception</th></tr></thead>
          <tbody>${exceptions.map((x) => `<tr>
            <td>${esc(x.categoryName || '')}</td><td>${esc(x.dbkey || '')}</td><td>${esc(x.exceptionText || '')}</td>
          </tr>`).join('')}</tbody>
        </table>` : ''}
      <div class="section-title">Categories (${(d.categories || []).length})</div>
      <table>
        <thead><tr><th>Category</th><th>DBKey</th><th>PROD comment</th><th></th></tr></thead>
        <tbody>${(d.categories || []).map(commentRow).join('') || '<tr><td colspan="4" class="muted">No categories.</td></tr>'}</tbody>
      </table>
      ${edits.length ? `
        <div class="section-title">Comment changes</div>
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Category</th><th>Was</th><th>Now</th></tr></thead>
          <tbody>${edits.map((e) => `<tr>
            <td>${esc(pacificTime(e.editedAt))}</td><td>${esc(e.editedBy)}</td>
            <td>${esc(e.categoryName || e.dbkey)}</td>
            <td class="comment">${esc(e.previousComment) || '<span class="muted">—</span>'}</td>
            <td class="comment">${esc(e.newComment) || '<span class="muted">removed</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>` : ''}
      ${d.pdfUrl ? `<div class="section-title">EOD</div><iframe class="pdf-frame" src="${esc(d.pdfUrl)}" title="EOD PDF"></iframe>` : ''}
    `;
    bindDetail();
    if (state.focusDbkey) {
      const row = document.getElementById(`row-${state.focusDbkey}`)
        || [...document.querySelectorAll('tr[id^="row-"]')].find((r) => r.id.replace(/^row-0*/, '') === state.focusDbkey);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function findCategory(dbkey) {
    return (state.detail?.categories || []).find((c) => String(c.dbkey) === String(dbkey));
  }

  async function saveComment(dbkey, comment) {
    const d = state.detail;
    const out = await api('/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: d.storeNumber, date: d.workDate, dbkey, comment }),
    });
    const c = findCategory(dbkey);
    if (c) c.comment = out.comment || '';
    state.editing = null;
    await openDetail(d.storeNumber, d.workDate);
  }

  function bindDetail() {
    const body = $('detailBody');
    body.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
      state.editing = btn.getAttribute('data-edit');
      renderDetail();
      const box = $('editBox');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }));
    body.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => {
      state.editing = null;
      renderDetail();
    }));
    body.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
      const dbkey = btn.getAttribute('data-save');
      btn.disabled = true;
      try {
        await saveComment(dbkey, $('editBox').value);
      } catch (err) {
        btn.disabled = false;
        const e = $('editErr');
        if (e) { e.textContent = err.message; e.hidden = false; }
      }
    }));
    body.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      const dbkey = btn.getAttribute('data-remove');
      const c = findCategory(dbkey);
      if (!confirm(`Remove the PROD comment on ${c?.name || dbkey}?`)) return;
      btn.disabled = true;
      try {
        await saveComment(dbkey, '');
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    }));
  }

  async function boot() {
    try { await window.dumpBinAuthReady; } catch (_) {}
    const qs = new URLSearchParams(location.search);
    state.focusDbkey = (qs.get('edit') || '').replace(/\D/g, '').replace(/^0+/, '') || null;
    try {
      const data = await api('/list');
      state.eods = data.eods || [];
      $('rangeLabel').textContent = `Last ${data.days} days`;
      renderList();
    } catch (err) {
      $('eodList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
    const store = qs.get('store');
    const date = qs.get('date');
    if (store && date) openDetail(store, date);
  }

  $('search').addEventListener('input', renderList);
  boot();
})();
