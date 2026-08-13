/* Digital signoff — hard heart of the day. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function markActive(row, type) {
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'complete') return !!m.complete;
    if (type === 'not_in_store') return !!m.notInStore;
    if (type === 'not_in_si') return !!m.notInSi;
    return m.type === type;
  }

  function rowClass(row) {
    const c = [];
    if (markActive(row, 'complete')) c.push('marked-complete');
    if (markActive(row, 'not_in_store')) c.push('marked-nis');
    if (markActive(row, 'not_in_si')) c.push('marked-nisi');
    return c.join(' ');
  }

  async function loadSheet() {
    const S = global.EodSession;
    const store = S.state.storeNumber;
    const date = S.state.workDate;
    const qs = new URLSearchParams({ store });
    if (date) qs.set('date', date);
    const resp = await global.authFetch(`${API}/sheet?${qs}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Load failed (${resp.status})`);
    const sheet = data.sheet || null;
    S.patch({ sheet, sheetLoaded: true }, 'sheet');
    try {
      global.EodDeptSignatures?.syncFromSheet?.(sheet);
    } catch (_) {
      if (sheet?.requiredRoles?.length) {
        global.EodDeptSignatures?.setRequiredRoles?.(sheet.requiredRoles);
      }
    }
    // Sync legacy NIS/NISI arrays from marks
    if (sheet?.rows) {
      const nis = [];
      const nisi = [];
      for (const row of sheet.rows) {
        const label = row.catName || row.dbkey;
        if (!label) continue;
        if (markActive(row, 'not_in_store')) nis.push(label);
        if (markActive(row, 'not_in_si')) nisi.push(label);
      }
      S.patch({ notInStoreSelected: nis, notInSiSelected: nisi }, 'marks-sync');
    }
    return sheet;
  }

  async function applyMark(rowId, markType) {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders();
    if (markType === 'clear') {
      const resp = await global.authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ storeNumber: S.state.storeNumber, workDate: S.state.workDate }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Clear failed (${resp.status})`);
    } else if (markActive((S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId)), markType)) {
      const resp = await global.authFetch(
        `${API}/rows/${encodeURIComponent(rowId)}/mark?markType=${encodeURIComponent(markType)}`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            storeNumber: S.state.storeNumber,
            workDate: S.state.workDate,
            markType,
          }),
        }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Unmark failed (${resp.status})`);
    } else {
      const visitId = S.state.selectedShift?.visitId || null;
      const resp = await global.authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          markType,
          visitId,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Mark failed (${resp.status})`);
      // Side-effect hooks for NIS (helpdesk) — optional prompt
      if (markType === 'not_in_store' && typeof global.openHelpdeskWizard === 'function') {
        // Soft prompt only; mark already saved.
      }
    }
    await loadSheet();
  }

  function renderRows(sheet, q) {
    const rows = (sheet.rows || []).filter((row) => {
      if (!q) return true;
      return `${row.catName || ''} ${row.dbkey || ''} ${row.dept || ''} ${row.shiftType || ''}`
        .toLowerCase().includes(q);
    });
    if (!rows.length) return '<p class="muted">No sets match.</p>';
    return rows.map((row) => {
      const status = (row.marks?.active || (row.mark?.type ? [row.mark.type] : []) || [])
        .map((t) => `<span class="pill">${esc(t.replace(/_/g, ' '))}</span>`).join('')
        || '<span class="pill">open</span>';
      const btn = (type, label) => {
        const on = markActive(row, type);
        return `<button type="button" class="btn btn-secondary${on ? ' on' : ''}" data-row="${row.id}" data-mark="${type}">${on ? '✓ ' : ''}${label}</button>`;
      };
      return `<div class="ds-row ${rowClass(row)}" data-row-id="${row.id}">
        <div><strong>${esc(row.catName || row.catId || '—')}</strong>
          <div class="muted">${esc(row.week || '')} ${esc(row.shiftType || '')} · ${esc(row.dbkey || '—')} · ${esc(row.dept || '')}</div>
        </div>
        <div style="margin-top:6px;">${status}</div>
        <div class="ds-actions">
          ${btn('complete', 'Complete')}
          ${btn('not_in_store', 'Not in store')}
          ${btn('not_in_si', 'Not in SI')}
          <button type="button" class="btn btn-secondary" data-row="${row.id}" data-mark="clear">Clear</button>
        </div>
      </div>`;
    }).join('');
  }

  async function render(mount) {
    const S = global.EodSession;
    mount.innerHTML = `
      <div class="card heart">
        <h1>Digital signoff sheet</h1>
        <p class="muted">This is the heart of your day. Mark Complete / Not in store / Not in SI for each set. Paper sign-off photos are only used when no hosted sheet exists.</p>
        <div id="sheetSummary" class="muted" style="margin-bottom:10px;">Loading…</div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="refreshSheetBtn">Refresh sheet</button>
          <button type="button" class="btn btn-secondary" id="ackAllBtn" hidden>Acknowledge remaining open</button>
          <button type="button" class="btn btn-secondary" id="paperFallbackBtn" hidden>Paper sign-off photos</button>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Search sets</label>
          <input type="search" id="sheetSearch" placeholder="Category, DBKEY, dept…">
        </div>
        <div id="sheetRows"></div>
      </div>
      <div class="card" id="deptSigMount"></div>`;

    const summary = document.getElementById('sheetSummary');
    const rowsEl = document.getElementById('sheetRows');
    const ackBtn = document.getElementById('ackAllBtn');
    const paperBtn = document.getElementById('paperFallbackBtn');

    async function paint() {
      let sheet = S.state.sheet;
      if (!S.state.sheetLoaded) {
        try { sheet = await loadSheet(); }
        catch (err) {
          summary.innerHTML = `<span style="color:#ef4444;">${esc(err.message)}</span>`;
          rowsEl.innerHTML = '';
          return;
        }
      }
      if (!sheet) {
        summary.innerHTML = 'No hosted sheet for this store/week yet. Use <strong>paper sign-off photos</strong> in Photos, or wait for weekly digital ingest.';
        rowsEl.innerHTML = '';
        paperBtn.hidden = false;
        ackBtn.hidden = true;
        document.body.classList.add('no-hosted-sheet');
        document.body.classList.remove('has-hosted-sheet');
        return;
      }
      document.body.classList.add('has-hosted-sheet');
      document.body.classList.remove('no-hosted-sheet');
      paperBtn.hidden = true;
      const s = sheet.summary || {};
      const open = (sheet.rows || []).filter((r) => !markActive(r, 'complete') && !markActive(r, 'not_in_store') && !markActive(r, 'not_in_si')).length;
      summary.innerHTML = `<strong>${esc(sheet.fiscalWeek)}</strong> · Store ${esc(sheet.storeNumber)}`
        + (sheet.team ? ` · Team ${esc(sheet.team)}` : '')
        + ` · ${s.marked || 0}/${s.total || 0} marked`
        + ` · <span class="${open ? 'pill warn' : 'pill ok'}">${open} open</span>`;
      ackBtn.hidden = open === 0;
      const q = (document.getElementById('sheetSearch').value || '').trim().toLowerCase();
      rowsEl.innerHTML = renderRows(sheet, q);
      rowsEl.querySelectorAll('[data-mark]').forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            await applyMark(btn.getAttribute('data-row'), btn.getAttribute('data-mark'));
            await paint();
            try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
            global.EodChrome?.refresh();
          } catch (err) {
            alert(err.message || String(err));
          } finally {
            btn.disabled = false;
          }
        };
      });
    }

    document.getElementById('refreshSheetBtn').onclick = async () => {
      S.patch({ sheetLoaded: false }, 'reload');
      await paint();
    };
    document.getElementById('sheetSearch').oninput = () => paint();
    ackBtn.onclick = () => {
      if (!confirm('Mark all remaining open sets as acknowledged for send? This sets a local acknowledge flag (does not auto-Complete every row).')) return;
      const sheet = { ...S.state.sheet, allAcknowledged: true };
      S.patch({ sheet }, 'ack');
      paint();
      global.EodChrome?.refresh();
    };
    paperBtn.onclick = () => global.EodRouter.go('photos');

    await paint();

    // Mount dept signatures into orbit card on this page for convenience
    const deptHost = document.getElementById('deptSigMount');
    if (deptHost && global.EodDeptSignatures?.mountInline) {
      await global.EodDeptSignatures.mountInline(deptHost);
      try { global.EodDeptSignatures.syncFromSheet?.(S.state.sheet); } catch (_) {}
    } else if (deptHost) {
      deptHost.innerHTML = `<h2>Department signatures</h2>
        <p class="muted">Collect PIC signatures any time. Roles filter from the sheet when available.</p>
        <button type="button" class="btn btn-primary btn-block" id="openDeptSigsBtn">Open department signatures</button>`;
      document.getElementById('openDeptSigsBtn').onclick = () => {
        if (global.EodDeptSignatures?.open) global.EodDeptSignatures.open();
        else global.EodRouter.go('cover');
      };
      // Ensure module UI exists
      try { global.EodDeptSignatures?.ensureUi?.(); } catch (_) {}
    }
  }

  global.EodSignoffHome = { loadSheet, render };
  global.EodRouter.register('signoff', render);
})(typeof window !== 'undefined' ? window : globalThis);
