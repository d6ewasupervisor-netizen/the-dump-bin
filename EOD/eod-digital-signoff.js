/* Hosted digital Kompass signoff sheet — set rows with Complete / Not In Store / Not In SI. */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  let sheet = null;

  function authFetch(url, init) {
    if (typeof window.authFetch === 'function') return window.authFetch(url, init);
    const opts = typeof window.applyEodVersionHeader === 'function'
      ? window.applyEodVersionHeader(init)
      : init;
    if (window.dumpBinAuthFetch) return window.dumpBinAuthFetch(url, opts);
    return fetch(url, opts);
  }

  function dayConfirmHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const stored = JSON.parse(localStorage.getItem('kompassDayConfirm') || 'null');
      if (stored?.token) headers['X-Day-Confirm'] = stored.token;
    } catch (_) { /* ignore */ }
    return headers;
  }

  function storeNumber() {
    return (document.getElementById('storeNumber')?.value || '').trim();
  }

  function workDate() {
    return (document.getElementById('workDate')?.value
      || document.getElementById('shiftDate')?.value
      || '').trim();
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureUi() {
    if (document.getElementById('digitalSignoffSection')) return;
    const photoSection = document.getElementById('signoffPhotoSection');
    const anchor = photoSection?.closest('.section') || document.getElementById('deptSigSection');
    if (!anchor || !anchor.parentNode) return;

    const section = document.createElement('div');
    section.className = 'section';
    section.id = 'digitalSignoffSection';
    section.style.borderColor = '#38bdf8';
    section.innerHTML = `
      <div class="section-title" style="color:#7dd3fc;">Digital Signoff Sheet</div>
      <p class="sets-help" id="digitalSignoffHelp" style="margin:0 0 10px;">
        Hosted completion worksheet for this store. Toggle K/L/M independently — a set can be
        <strong>Complete</strong> and <strong>Not in SI</strong> at the same time, like the paper sheet.
        Not In Store / Not In SI still update PROD comments and can open the help desk flow.
      </p>
      <div id="digitalSignoffSummary" class="sets-help" style="margin-bottom:10px;"></div>
      <div id="digitalSignoffRows" style="overflow:auto; max-height:420px;"></div>
      <div class="button-group" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" id="digitalSignoffRefreshBtn">Load / Refresh sheet</button>
        <button type="button" class="btn btn-secondary" id="digitalSignoffPrintBtn" style="display:none;">Open printable PDF</button>
      </div>
    `;
    // Place above paper sign-off photo section when possible.
    if (photoSection?.closest('.section')) {
      photoSection.closest('.section').parentNode.insertBefore(section, photoSection.closest('.section'));
    } else {
      anchor.parentNode.insertBefore(section, anchor);
    }

    if (!document.getElementById('digitalSignoffStyles')) {
      const style = document.createElement('style');
      style.id = 'digitalSignoffStyles';
      style.textContent = `
        .ds-table { width:100%; border-collapse:collapse; font-size:13px; }
        .ds-table th, .ds-table td { border-bottom:1px solid #334155; padding:8px 6px; text-align:left; vertical-align:top; }
        .ds-table th { color:#94a3b8; font-weight:600; position:sticky; top:0; background:#0b1220; }
        .ds-actions { display:flex; flex-wrap:wrap; gap:4px; }
        .ds-actions button { font-size:12px; padding:6px 8px; }
        .ds-row-marked-complete { background:rgba(22,101,52,.25); }
        .ds-row-marked-nis { background:rgba(127,29,29,.28); }
        .ds-row-marked-nisi { background:rgba(120,53,15,.28); }
        .ds-actions button.ds-mark-on { outline: 2px solid #38bdf8; font-weight: 600; }
        .ds-actions button.ds-mark-on[data-mark="complete"] { background: #166534; border-color: #22c55e; }
        .ds-actions button.ds-mark-on[data-mark="not_in_store"] { background: #7f1d1d; border-color: #f87171; }
        .ds-actions button.ds-mark-on[data-mark="not_in_si"] { background: #78350f; border-color: #fbbf24; }
        .ds-row-marked-complete.ds-row-marked-nisi { background: linear-gradient(90deg, rgba(22,101,52,.25), rgba(120,53,15,.28)); }
        .ds-mark-pill { display:inline-block; font-size:11px; padding:2px 6px; margin:1px 2px 1px 0; border-radius:999px; background:#1e293b; }
      `;
      document.head.appendChild(style);
    }

    document.getElementById('digitalSignoffRefreshBtn').onclick = () => refresh().catch(console.error);
    document.getElementById('digitalSignoffPrintBtn').onclick = () => {
      if (sheet?.pdfR2Key && typeof window.openMaterialsBrowser === 'function') {
        // Best-effort: materials browser uses Dump Bin keys; leave as no-op if unavailable.
      }
      if (typeof showAlert === 'function') {
        showAlert(
          'Printable PDF',
          sheet?.pdfFilename
            ? `Look for ${sheet.pdfFilename} in this week’s Dump Bin Signoffs folder (materials browser / print-at-store).`
            : 'Printable PDF is placed in the Dump Bin Signoffs folder when the weekly build exports PDFs.'
        );
      }
    };
  }

  function rowMarks(row) {
    return row?.marks || row?.mark || null;
  }

  function markIsActive(row, markType) {
    const m = rowMarks(row);
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(markType);
    if (markType === 'complete') return !!m.complete;
    if (markType === 'not_in_store') return !!m.notInStore;
    if (markType === 'not_in_si') return !!m.notInSi;
    return m.type === markType;
  }

  function markStatusHtml(row) {
    const m = rowMarks(row);
    if (!m?.active?.length && !m?.type) {
      return '<span class="ds-mark-pill">open</span>';
    }
    const types = Array.isArray(m.active) && m.active.length
      ? m.active
      : [m.type].filter(Boolean);
    return types.map((t) => `<span class="ds-mark-pill">${escapeHtml(t.replace(/_/g, ' '))}</span>`).join(' ');
  }

  function rowClassForMarks(row) {
    const classes = [];
    if (markIsActive(row, 'complete')) classes.push('ds-row-marked-complete');
    if (markIsActive(row, 'not_in_store')) classes.push('ds-row-marked-nis');
    if (markIsActive(row, 'not_in_si')) classes.push('ds-row-marked-nisi');
    return classes.join(' ');
  }

  function render() {
    ensureUi();
    const summary = document.getElementById('digitalSignoffSummary');
    const host = document.getElementById('digitalSignoffRows');
    const printBtn = document.getElementById('digitalSignoffPrintBtn');
    if (!summary || !host) return;

    if (!sheet) {
      summary.textContent = 'No hosted sheet for this store/week yet. After weekly signoffs are built with digital export, it will appear here. You can still collect department signatures and use Not In Store / Not In SI pickers.';
      host.innerHTML = '';
      if (printBtn) printBtn.style.display = 'none';
      return;
    }

    const s = sheet.summary || {};
    summary.innerHTML = `<strong>${escapeHtml(sheet.fiscalWeek)}</strong> · Store ${escapeHtml(sheet.storeNumber)}`
      + (sheet.team ? ` · Team ${escapeHtml(sheet.team)}` : '')
      + ` · ${s.marked || 0}/${s.total || 0} marked`
      + ` (Complete ${s.complete || 0}, Not in store ${s.notInStore || 0}, Not in SI ${s.notInSi || 0})`;

    if (printBtn) printBtn.style.display = 'inline-flex';

    host.innerHTML = `
      <table class="ds-table">
        <thead>
          <tr>
            <th>Set</th>
            <th>DBKEY</th>
            <th>Dept</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${(sheet.rows || []).map((row) => {
            const cls = rowClassForMarks(row);
            const status = markStatusHtml(row);
            const btn = (type, label) => {
              const on = markIsActive(row, type);
              return `<button type="button" class="btn ${type === 'complete' ? 'btn-primary' : 'btn-secondary'}${on ? ' ds-mark-on' : ''}" data-mark="${type}">${on ? '✓ ' : ''}${label}</button>`;
            };
            const hasAny = !!(rowMarks(row)?.active?.length || rowMarks(row)?.type);
            return `<tr class="${cls}" data-row-id="${row.id}">
              <td><strong>${escapeHtml(row.catName || row.catId || '—')}</strong>
                <div style="color:#94a3b8;font-size:12px;">${escapeHtml(row.week || '')} ${escapeHtml(row.shiftType || '')}</div></td>
              <td>${escapeHtml(row.dbkey || '—')}</td>
              <td>${escapeHtml(row.dept || '—')}</td>
              <td>${status}</td>
              <td class="ds-actions">
                ${btn('complete', 'Complete')}
                ${btn('not_in_store', 'Not in store')}
                ${btn('not_in_si', 'Not in SI')}
                ${hasAny ? '<button type="button" class="btn btn-secondary" data-mark="clear">Clear row</button>' : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    host.querySelectorAll('tr[data-row-id]').forEach((tr) => {
      const rowId = tr.getAttribute('data-row-id');
      tr.querySelectorAll('[data-mark]').forEach((btn) => {
        btn.onclick = () => applyMark(rowId, btn.getAttribute('data-mark'));
      });
    });
  }

  async function refresh() {
    ensureUi();
    const store = storeNumber();
    const date = workDate();
    if (!store) {
      sheet = null;
      render();
      return;
    }
    const qs = new URLSearchParams({ store });
    if (date) qs.set('date', date);
    try {
      const resp = await authFetch(`${API}/sheet?${qs.toString()}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Load failed (${resp.status})`);
      sheet = data.sheet || null;
      if (sheet?.requiredRoles?.length && window.EodDeptSignatures?.setRequiredRoles) {
        window.EodDeptSignatures.setRequiredRoles(sheet.requiredRoles);
      }
      render();
      syncLegacyPickersFromMarks();
    } catch (err) {
      console.error(err);
      if (typeof showAlert === 'function') showAlert('Digital sheet', err.message || String(err));
    }
  }

  function syncLegacyPickersFromMarks() {
    if (!sheet?.rows) return;
    if (!Array.isArray(window.notInStoreSelected)) window.notInStoreSelected = [];
    if (!Array.isArray(window.notInSiSelected)) window.notInSiSelected = [];
    for (const row of sheet.rows) {
      const label = row.catName || row.dbkey;
      if (!label) continue;
      if (markIsActive(row, 'not_in_store') && !window.notInStoreSelected.includes(label)) {
        window.notInStoreSelected.push(label);
      }
      if (markIsActive(row, 'not_in_si') && !window.notInSiSelected.includes(label)) {
        window.notInSiSelected.push(label);
      }
    }
    if (typeof window.renderSetsPicker === 'function') {
      try { window.renderSetsPicker('store'); } catch (_) { /* ignore */ }
      try { window.renderSetsPicker('si'); } catch (_) { /* ignore */ }
    }
    if (typeof window.autoSave === 'function') window.autoSave();
  }

  async function applyMark(rowId, markType) {
    const store = storeNumber();
    const date = workDate();
    const row = sheet?.rows?.find((r) => String(r.id) === String(rowId));
    if (!row) return;

    const loading = document.getElementById('loadingOverlay');
    if (loading) loading.classList.add('show');
    try {
      if (markType === 'clear') {
        const resp = await authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
          method: 'DELETE',
          headers: dayConfirmHeaders(),
          body: JSON.stringify({ storeNumber: store, workDate: date, date }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 412) {
          if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
          throw new Error('Confirm today\'s store first');
        }
        if (!resp.ok) throw new Error(data.error || 'Clear failed');
        await refresh();
        return;
      }

      const togglingOff = markIsActive(row, markType);
      if (togglingOff) {
        const resp = await authFetch(
          `${API}/rows/${encodeURIComponent(rowId)}/mark?markType=${encodeURIComponent(markType)}`,
          {
            method: 'DELETE',
            headers: dayConfirmHeaders(),
            body: JSON.stringify({ storeNumber: store, workDate: date, date, markType }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 412) {
          if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
          throw new Error('Confirm today\'s store first');
        }
        if (!resp.ok) throw new Error(data.error || 'Clear mark failed');
        await refresh();
        return;
      }

      // Side effects when turning ON Not in store / Not in SI.
      // T0.12: helpdeskSent only after user confirms Send and the API succeeds.
      let prodCommentOk = null;
      let helpdeskSent = false;
      let visitId = null;
      let resetId = null;
      const label = row.catName || row.dbkey;
      if (label && typeof window.resolvePickerSetMatch === 'function') {
        const match = window.resolvePickerSetMatch(label);
        if (match?.visitId) visitId = match.visitId;
        if (match?.set?.id != null) resetId = String(match.set.id);
      }

      if (markType === 'not_in_store' || markType === 'not_in_si') {
        if (label && typeof window.handleNotInSideEffects === 'function') {
          try {
            // Drop overlay so Send/Stand-down confirm is usable (T0.12).
            if (loading) loading.classList.remove('show');
            const side = await window.handleNotInSideEffects(
              markType === 'not_in_store' ? 'store' : 'si',
              label,
              { fromOther: false, fromDigitalSheet: true }
            );
            if (loading) loading.classList.add('show');
            prodCommentOk = side?.prodCommentOk === true;
            if (markType === 'not_in_store') {
              helpdeskSent = side?.helpdeskSent === true;
            }
          } catch (e) {
            console.warn('NIS side effects', e);
            prodCommentOk = false;
            helpdeskSent = false;
            if (loading) loading.classList.add('show');
          }
        } else if (label) {
          const list = markType === 'not_in_store' ? window.notInStoreSelected : window.notInSiSelected;
          if (Array.isArray(list) && !list.includes(label)) list.push(label);
        }
      }

      const resp = await authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
        method: 'POST',
        headers: dayConfirmHeaders(),
        body: JSON.stringify({
          storeNumber: store,
          workDate: date,
          date,
          markType,
          visitId,
          resetId,
          prodCommentOk,
          helpdeskSent,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 412) {
        if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
        throw new Error('Confirm today\'s store first');
      }
      if (!resp.ok) throw new Error(data.error || 'Mark failed');
      await refresh();
    } catch (err) {
      console.error(err);
      if (typeof showAlert === 'function') showAlert('Mark failed', err.message || String(err));
    } finally {
      if (loading) loading.classList.remove('show');
    }
  }

  function getSummaryForEmail() {
    if (!sheet) return null;
    return {
      fiscalWeek: sheet.fiscalWeek,
      storeNumber: sheet.storeNumber,
      summary: sheet.summary,
      rows: (sheet.rows || []).map((r) => ({
        dbkey: r.dbkey,
        catName: r.catName,
        marks: r.marks?.active || (r.mark?.type ? [r.mark.type] : []),
      })),
    };
  }

  window.EodDigitalSignoff = {
    refresh,
    ensureUi,
    getSummaryForEmail,
    getSheet: () => sheet,
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureUi();
    const storeEl = document.getElementById('storeNumber');
    const dateEl = document.getElementById('workDate') || document.getElementById('shiftDate');
    if (storeEl) storeEl.addEventListener('change', () => refresh().catch(console.error));
    if (dateEl) dateEl.addEventListener('change', () => refresh().catch(console.error));
    setTimeout(() => refresh().catch(console.error), 1200);
  });
})();
