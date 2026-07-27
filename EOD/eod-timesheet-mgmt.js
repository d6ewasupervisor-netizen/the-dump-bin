/* InstaWork + Kompass live timesheet management modules for the EOD app. */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/eod/timesheet-mgmt';
  const POLL_MS = 20000;

  let state = {
    sheetKey: null,
    members: [],
    handoffs: [],
    pollTimer: null,
    loading: false,
  };

  function authFetch(url, init) {
    if (typeof window.authFetch === 'function') return window.authFetch(url, init);
    if (window.dumpBinAuthFetch) return window.dumpBinAuthFetch(url, init);
    return fetch(url, init);
  }

  function dayConfirmHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    try {
      const stored = JSON.parse(localStorage.getItem('kompassDayConfirm') || 'null');
      if (stored?.token) headers['X-Day-Confirm'] = stored.token;
    } catch (_) { /* ignore */ }
    return headers;
  }

  function storeNumber() {
    return (document.getElementById('storeNumber')?.value
      || document.getElementById('instaworkAckStoreNumber')?.value
      || document.getElementById('kompassAckStoreNumber')?.value
      || '').trim();
  }

  function workDate() {
    return (document.getElementById('workDate')?.value
      || document.getElementById('shiftDate')?.value
      || document.getElementById('dayConfirmDate')?.value
      || '').trim();
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sheetLabel(key) {
    return key === 'instawork' ? 'InstaWork' : 'Kompass Team';
  }

  function ensureStyles() {
    if (document.getElementById('eodTimesheetMgmtStyles')) return;
    const style = document.createElement('style');
    style.id = 'eodTimesheetMgmtStyles';
    style.textContent = `
      #eodTsMgmtOverlay.modal-overlay { align-items: stretch; padding: 0; }
      #eodTsMgmtOverlay .eod-ts-shell {
        width: 100%; max-width: 100%; height: 100%; max-height: 100%;
        margin: 0; border-radius: 0; display: flex; flex-direction: column;
        background: #0b1220; color: #e2e8f0; overflow: hidden;
      }
      .eod-ts-header {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        padding: 14px 16px; border-bottom: 1px solid #1e293b; background: #111827;
      }
      .eod-ts-header h2 { margin: 0; font-size: 1.15rem; color: #fde68a; }
      .eod-ts-header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; line-height: 1.4; }
      .eod-ts-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #1e293b; }
      .eod-ts-body { flex: 1; overflow: auto; padding: 12px 16px 24px; -webkit-overflow-scrolling: touch; }
      .eod-ts-table-wrap { overflow-x: auto; border: 1px solid #334155; border-radius: 10px; }
      table.eod-ts-table {
        width: 100%; border-collapse: collapse; min-width: 920px; font-size: 13px;
      }
      .eod-ts-table th, .eod-ts-table td {
        padding: 8px 8px; border-bottom: 1px solid #1e293b; text-align: left; vertical-align: top;
      }
      .eod-ts-table th { background: #1e293b; color: #cbd5e1; font-weight: 600; position: sticky; top: 0; z-index: 1; }
      .eod-ts-table tr:last-child td { border-bottom: none; }
      .eod-ts-table input[type="text"] {
        width: 100%; min-width: 72px; box-sizing: border-box; padding: 6px 8px;
        border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 13px;
      }
      .eod-ts-name { font-weight: 600; color: #f8fafc; }
      .eod-ts-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
      .eod-ts-badge {
        display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
      }
      .eod-ts-badge.pending { background: #334155; color: #e2e8f0; }
      .eod-ts-badge.confirmed { background: #065f46; color: #a7f3d0; }
      .eod-ts-badge.adjust { background: #78350f; color: #fde68a; }
      .eod-ts-note {
        margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: #422006; color: #fde68a;
        font-size: 12px; line-height: 1.35;
      }
      .eod-ts-sig {
        max-width: 120px; max-height: 40px; background: #fff; border-radius: 4px; display: block;
      }
      .eod-ts-empty { padding: 28px 16px; text-align: center; color: #94a3b8; }
      .eod-ts-statusline { font-size: 12px; color: #64748b; padding: 0 16px 10px; }
      .eod-ts-row-actions { display: flex; flex-direction: column; gap: 6px; min-width: 110px; }
      .eod-ts-row-actions .btn { padding: 6px 8px; font-size: 12px; width: 100%; }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    if (document.getElementById('eodTsMgmtOverlay')) return;
    ensureStyles();
    const el = document.createElement('div');
    el.id = 'eodTsMgmtOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = `
      <div class="eod-ts-shell modal-dialog">
        <div class="eod-ts-header">
          <div>
            <h2 id="eodTsTitle">Timesheet management</h2>
            <p id="eodTsSubtitle">Live punch times from PROD. InstaWork and Kompass are kept separate.</p>
          </div>
          <button type="button" class="btn btn-secondary" id="eodTsCloseBtn">Close</button>
        </div>
        <div class="eod-ts-actions">
          <button type="button" class="btn btn-secondary" id="eodTsRefreshBtn">Refresh</button>
          <button type="button" class="btn btn-secondary" id="eodTsShowQrBtn">Show JOIN QR</button>
          <button type="button" class="btn btn-secondary" id="eodTsPrintBtn">Print sheet</button>
          <button type="button" class="btn btn-primary" id="eodTsPhotoBtn" style="display:none;">Sign-out photo</button>
        </div>
        <div class="eod-ts-statusline" id="eodTsStatus">Loading…</div>
        <div class="eod-ts-body" id="eodTsBody"></div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('eodTsCloseBtn').onclick = close;
    document.getElementById('eodTsRefreshBtn').onclick = () => refresh(true);
    document.getElementById('eodTsShowQrBtn').onclick = () => {
      try {
        window.EodSmsOptinQr?.ensureUi?.();
        const block = document.getElementById('eodSmsOptinQrBlock');
        const toggle = document.getElementById('eodSmsOptinQrToggle');
        if (block && !block.classList.contains('is-expanded')) toggle?.click();
        block?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) { /* ignore */ }
      if (typeof showAlert === 'function') {
        showAlert(
          'SMS opt-in',
          'Have the employee scan the QR at the top of the EOD page (or text JOIN to (509) 572-9212). After they opt in, use Send link on their row.'
        );
      }
    };
    document.getElementById('eodTsPrintBtn').onclick = () => {
      if (typeof printEodTimesheet === 'function') printEodTimesheet(state.sheetKey);
    };
    document.getElementById('eodTsPhotoBtn').onclick = () => {
      close();
      const panel = document.getElementById('instaworkYesPanel');
      if (panel) panel.style.display = 'block';
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  function statusBadge(status) {
    const s = status || 'pending';
    const label = s === 'confirmed' ? 'Confirmed' : (s === 'adjust' ? 'Adjusted' : 'Pending');
    return `<span class="eod-ts-badge ${escapeHtml(s)}">${label}</span>`;
  }

  function render() {
    const body = document.getElementById('eodTsBody');
    const status = document.getElementById('eodTsStatus');
    if (!body) return;
    const label = sheetLabel(state.sheetKey);
    document.getElementById('eodTsTitle').textContent = `${label} management`;
    document.getElementById('eodTsSubtitle').textContent = state.sheetKey === 'instawork'
      ? 'Only Instawork roster people assigned on today’s PROD shift. Live clock / lunch / out from SAS punches + employee confirmations.'
      : 'Only Kompass / ISE / Blitz / Cut-in teammates (Instawork roster excluded). Live clock / lunch / out from SAS punches + employee confirmations.';
    const photoBtn = document.getElementById('eodTsPhotoBtn');
    if (photoBtn) photoBtn.style.display = state.sheetKey === 'instawork' ? '' : 'none';

    if (!state.members.length) {
      body.innerHTML = `<div class="eod-ts-empty">No ${escapeHtml(label)} teammates found on today’s PROD assignment for store #${escapeHtml(storeNumber())}.</div>`;
      if (status) status.textContent = `Updated ${new Date().toLocaleTimeString()} · 0 people`;
      return;
    }

    const rows = state.members.map((m, idx) => {
      const conf = m.confirmation || {};
      const note = conf.adjustmentNote
        ? `<div class="eod-ts-note"><strong>Reason:</strong> ${escapeHtml(conf.adjustmentNote)}</div>`
        : '';
      const sig = conf.signatureDataUrl || conf.signatureUrl
        ? `<img class="eod-ts-sig" alt="Signature" src="${escapeHtml(conf.signatureDataUrl || conf.signatureUrl)}">`
        : '<span class="eod-ts-meta">—</span>';
      return `<tr data-key="${escapeHtml(m.employeeKey)}" data-idx="${idx}">
        <td>
          <div class="eod-ts-name">${escapeHtml(m.name)}</div>
          <div class="eod-ts-meta">${m.isLead ? 'Lead · ' : ''}${escapeHtml(m.title || '')}${m.workdayId ? ` · WD ${escapeHtml(m.workdayId)}` : ''}</div>
          <div class="eod-ts-meta">Source: ${escapeHtml(m.timeSource || 'sas')}</div>
          ${note}
        </td>
        <td><input type="text" data-field="clockIn" value="${escapeHtml(m.clockIn || '')}" aria-label="Clock in"></td>
        <td><input type="text" data-field="lunchOut" value="${escapeHtml(m.lunchOut || '')}" aria-label="Lunch out"></td>
        <td><input type="text" data-field="lunchIn" value="${escapeHtml(m.lunchIn || '')}" aria-label="Lunch in"></td>
        <td><input type="text" data-field="clockOut" value="${escapeHtml(m.clockOut || '')}" aria-label="Clock out"></td>
        <td>${sig}</td>
        <td>${statusBadge(conf.status)}${conf.submittedAt ? `<div class="eod-ts-meta">${escapeHtml(new Date(conf.submittedAt).toLocaleString())}</div>` : ''}</td>
        <td>
          <div class="eod-ts-row-actions">
            <button type="button" class="btn btn-secondary eod-ts-save" data-idx="${idx}">Save</button>
            <button type="button" class="btn btn-primary eod-ts-send" data-idx="${idx}">Send link</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="eod-ts-table-wrap">
        <table class="eod-ts-table">
          <thead>
            <tr>
              <th>Teammate</th>
              <th>In</th>
              <th>Lunch out</th>
              <th>Lunch in</th>
              <th>Out</th>
              <th>Signature</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    body.querySelectorAll('.eod-ts-save').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(Number(btn.dataset.idx)).catch(console.error));
    });
    body.querySelectorAll('.eod-ts-send').forEach((btn) => {
      btn.addEventListener('click', () => sendLink(Number(btn.dataset.idx)));
    });

    if (status) {
      const adj = state.members.filter((m) => m.confirmation?.status === 'adjust').length;
      const conf = state.members.filter((m) => m.confirmation?.status === 'confirmed').length;
      status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${state.members.length} people · ${conf} confirmed · ${adj} with changes`;
    }
  }

  function readRowInputs(idx) {
    const tr = document.querySelector(`#eodTsBody tr[data-idx="${idx}"]`);
    const m = state.members[idx];
    if (!tr || !m) return null;
    const get = (field) => tr.querySelector(`input[data-field="${field}"]`)?.value?.trim() || '';
    return {
      ...m,
      clockIn: get('clockIn'),
      lunchOut: get('lunchOut'),
      lunchIn: get('lunchIn'),
      clockOut: get('clockOut'),
    };
  }

  async function saveRow(idx) {
    const row = readRowInputs(idx);
    if (!row) return;
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) {
      if (typeof showAlert === 'function') showAlert('Store & date required', 'Set store and work date first.');
      return;
    }
    const resp = await authFetch(`${API}/row`, {
      method: 'PATCH',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: state.sheetKey,
        storeNumber: store,
        workDate: date,
        employeeKey: row.employeeKey,
        employeeName: row.name,
        workdayId: row.workdayId,
        employeeId: row.employeeId,
        shiftId: row.shiftId,
        visitId: row.visitId,
        clockIn: row.clockIn,
        lunchOut: row.lunchOut,
        lunchIn: row.lunchIn,
        clockOut: row.clockOut,
        timeSource: 'lead',
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (!resp.ok || !data.ok) throw new Error(data.error || `Save failed (${resp.status})`);
    Object.assign(state.members[idx], {
      clockIn: row.clockIn,
      lunchOut: row.lunchOut,
      lunchIn: row.lunchIn,
      clockOut: row.clockOut,
      timeSource: 'lead',
    });
    if (typeof showAlert === 'function') showAlert('Saved', `${row.name} times updated on the ${sheetLabel(state.sheetKey)} sheet.`);
  }

  function sendLink(idx) {
    const row = readRowInputs(idx) || state.members[idx];
    if (!row) return;
    if (!window.EodGuestHandoff?.openSendModal) {
      if (typeof showAlert === 'function') showAlert('Unavailable', 'Guest handoff module failed to load.');
      return;
    }
    const sessionType = state.sheetKey === 'instawork' ? 'instawork_timesheet' : 'kompass_timesheet';
    window.EodGuestHandoff.openSendModal({
      sessionType,
      title: `Send ${sheetLabel(state.sheetKey)} link — ${row.name}`,
      hint: 'Employee must have texted JOIN to (509) 572-9212 first. They can edit times, give a reason, and sign. Updates appear here live.',
      recipientName: row.name,
      recipientEmail: row.email || '',
      recipientPhone: row.phone || '',
      payload: {
        employees: state.members.map((m) => m.name),
        leadName: (typeof resolveTimesheetLeadName === 'function' ? resolveTimesheetLeadName() : '') || '',
        blank: false,
        member: {
          name: row.name,
          workdayId: row.workdayId,
          employeeId: row.employeeId,
          shiftId: row.shiftId,
          visitId: row.visitId,
          title: row.title,
          clockIn: row.clockIn,
          lunchOut: row.lunchOut,
          lunchIn: row.lunchIn,
          clockOut: row.clockOut,
        },
        prefill: {
          name: row.name,
          title: row.title,
          clockIn: row.clockIn,
          lunchOut: row.lunchOut,
          lunchIn: row.lunchIn,
          clockOut: row.clockOut,
          workdayId: row.workdayId,
          employeeId: row.employeeId,
          shiftId: row.shiftId,
          visitId: row.visitId,
        },
      },
    });
  }

  async function refresh(force) {
    if (state.loading && !force) return;
    const store = storeNumber();
    const date = workDate();
    if (!store || !date || !state.sheetKey) {
      const body = document.getElementById('eodTsBody');
      if (body) {
        body.innerHTML = '<div class="eod-ts-empty">Set store # and work date on the EOD form, then open management again.</div>';
      }
      return;
    }
    state.loading = true;
    const status = document.getElementById('eodTsStatus');
    if (status && force) status.textContent = 'Refreshing live punches…';
    try {
      const url = `${API}?sheet=${encodeURIComponent(state.sheetKey)}&store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`;
      const resp = await authFetch(url);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || `Load failed (${resp.status})`);
      state.members = Array.isArray(data.members) ? data.members : [];
      state.handoffs = Array.isArray(data.handoffs) ? data.handoffs : [];
      render();
    } catch (err) {
      const body = document.getElementById('eodTsBody');
      if (body) {
        body.innerHTML = `<div class="eod-ts-empty" style="color:#fca5a5;">${escapeHtml(err.message || 'Failed to load')}</div>`;
      }
      if (status) status.textContent = err.message || 'Error';
    } finally {
      state.loading = false;
    }
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = setInterval(() => refresh(false), POLL_MS);
  }

  async function open(sheetKey) {
    const key = sheetKey === 'instawork' ? 'instawork' : 'kompass';
    ensureOverlay();
    state.sheetKey = key;
    const overlay = document.getElementById('eodTsMgmtOverlay');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    await refresh(true);
    startPoll();
  }

  function close() {
    stopPoll();
    document.getElementById('eodTsMgmtOverlay')?.classList.remove('show');
    document.body.style.overflow = '';
  }

  window.EodTimesheetMgmt = {
    open,
    close,
    openInstawork: () => open('instawork'),
    openKompass: () => open('kompass'),
    refresh: () => refresh(true),
  };
})();
