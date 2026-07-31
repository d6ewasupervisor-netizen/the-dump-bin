/* InstaWork + Kompass live timesheet management — JOIN QR, PINs, submit actions. */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/eod/timesheet-mgmt';
  const POLL_MS = 20000;

  let state = {
    sheetKey: null,
    members: [],
    handoffs: [],
    join: null,
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

  function leadName() {
    if (typeof resolveTimesheetLeadName === 'function') {
      try { return resolveTimesheetLeadName() || ''; } catch (_) { /* ignore */ }
    }
    return (document.getElementById('leadName')?.value
      || document.getElementById('profileName')?.value
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
      table.eod-ts-table { width: 100%; border-collapse: collapse; min-width: 1080px; font-size: 13px; }
      .eod-ts-table th, .eod-ts-table td {
        padding: 8px 8px; border-bottom: 1px solid #1e293b; text-align: left; vertical-align: top;
      }
      .eod-ts-table th { background: #1e293b; color: #cbd5e1; font-weight: 600; position: sticky; top: 0; z-index: 1; }
      .eod-ts-table input[type="text"] {
        width: 100%; min-width: 72px; box-sizing: border-box; padding: 6px 8px;
        border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 13px;
      }
      .eod-ts-pin {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 16px; font-weight: 700; letter-spacing: 0.12em; color: #fde68a;
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
      .eod-ts-sig { max-width: 120px; max-height: 40px; background: #fff; border-radius: 4px; display: block; }
      .eod-ts-empty { padding: 28px 16px; text-align: center; color: #94a3b8; }
      .eod-ts-statusline { font-size: 12px; color: #64748b; padding: 0 16px 10px; }
      .eod-ts-row-actions { display: flex; flex-direction: column; gap: 6px; min-width: 110px; }
      .eod-ts-row-actions .btn { padding: 6px 8px; font-size: 12px; width: 100%; }
      #eodTsQrOverlay {
        position: fixed; inset: 0; z-index: 10050; background: rgba(2,6,23,.92);
        display: none; align-items: center; justify-content: center; padding: 20px;
      }
      #eodTsQrOverlay.show { display: flex; }
      .eod-ts-qr-card {
        background: #fff; color: #0f172a; border-radius: 16px; padding: 24px; max-width: 420px; width: 100%;
        text-align: center;
      }
      .eod-ts-qr-card img { width: 280px; height: 280px; background: #fff; }
      .eod-ts-qr-card h3 { margin: 0 0 8px; font-size: 1.2rem; }
      .eod-ts-qr-url { font-size: 12px; word-break: break-all; color: #475569; margin: 10px 0 16px; }
      #eodTsTabletOverlay {
        position: fixed; inset: 0; z-index: 10060; background: #0b1220;
        display: none; flex-direction: column;
      }
      #eodTsTabletOverlay.show { display: flex; }
      #eodTsTabletBar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; background: #111827; border-bottom: 1px solid #334155;
      }
      #eodTsTabletFrame { flex: 1; border: none; width: 100%; background: #fff; }
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
            <p id="eodTsSubtitle">Live punch times from PROD. Workers scan JOIN QR + enter their PIN.</p>
          </div>
          <button type="button" class="btn btn-secondary" id="eodTsCloseBtn">Close</button>
        </div>
        <div class="eod-ts-actions" id="eodTsActions"></div>
        <div class="eod-ts-statusline" id="eodTsStatus">Loading…</div>
        <div class="eod-ts-body" id="eodTsBody"></div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('eodTsCloseBtn').onclick = close;

    if (!document.getElementById('eodTsQrOverlay')) {
      const qr = document.createElement('div');
      qr.id = 'eodTsQrOverlay';
      qr.innerHTML = `<div class="eod-ts-qr-card">
        <h3>Scan to join today's shift</h3>
        <p style="margin:0;color:#64748b;font-size:14px;">Store #<span id="eodTsQrStore"></span> · <span id="eodTsQrDate"></span></p>
        <img id="eodTsQrImg" alt="JOIN QR code" width="280" height="280">
        <div class="eod-ts-qr-url" id="eodTsQrUrl"></div>
        <button type="button" class="btn btn-primary" id="eodTsQrClose" style="width:100%;">Done</button>
        <button type="button" class="btn btn-secondary" id="eodTsQrRefresh" style="width:100%;margin-top:8px;">Refresh QR</button>
      </div>`;
      document.body.appendChild(qr);
      document.getElementById('eodTsQrClose').onclick = () => qr.classList.remove('show');
      document.getElementById('eodTsQrRefresh').onclick = () => refreshJoinToken(true).then(showJoinQr);
    }

    if (!document.getElementById('eodTsTabletOverlay')) {
      const tablet = document.createElement('div');
      tablet.id = 'eodTsTabletOverlay';
      tablet.innerHTML = `
        <div id="eodTsTabletBar">
          <strong id="eodTsTabletTitle" style="color:#fde68a;">Worker sign-off</strong>
          <button type="button" class="btn btn-secondary" id="eodTsTabletClose">Close</button>
        </div>
        <iframe id="eodTsTabletFrame" title="Worker time sheet" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`;
      document.body.appendChild(tablet);
      document.getElementById('eodTsTabletClose').onclick = () => {
        tablet.classList.remove('show');
        document.getElementById('eodTsTabletFrame').src = 'about:blank';
        refresh(true).catch(() => {});
      };
    }
  }

  function renderActions() {
    const bar = document.getElementById('eodTsActions');
    if (!bar) return;
    const isIw = state.sheetKey === 'instawork';
    bar.innerHTML = `
      <button type="button" class="btn btn-secondary" id="eodTsRefreshBtn">Refresh</button>
      <button type="button" class="btn btn-primary" id="eodTsShowQrBtn">Show JOIN QR</button>
      <button type="button" class="btn btn-secondary" id="eodTsDownloadBtn">Download PDF</button>
      <button type="button" class="btn btn-secondary" id="eodTsPrintBtn">Print at store</button>
      <button type="button" class="btn btn-secondary" id="eodTsEmailBtn">Email PDF</button>
      ${isIw
        ? '<button type="button" class="btn btn-primary" id="eodTsSubmitOfficeBtn">Submit to office</button>'
        : '<button type="button" class="btn btn-primary" id="eodTsSubmitSupBtn">Submit to supervisor</button>'}
      ${isIw ? '<button type="button" class="btn btn-secondary" id="eodTsPhotoBtn">Sign-out photo</button>' : ''}`;

    document.getElementById('eodTsRefreshBtn').onclick = () => refresh(true);
    document.getElementById('eodTsShowQrBtn').onclick = () => showJoinQr();
    document.getElementById('eodTsDownloadBtn').onclick = () => downloadPdf().catch(showErr);
    document.getElementById('eodTsPrintBtn').onclick = () => printAtStore().catch(showErr);
    document.getElementById('eodTsEmailBtn').onclick = () => emailPdf().catch(showErr);
    document.getElementById('eodTsSubmitOfficeBtn')?.addEventListener('click', () => submitOffice().catch(showErr));
    document.getElementById('eodTsSubmitSupBtn')?.addEventListener('click', () => submitSupervisor().catch(showErr));
    document.getElementById('eodTsPhotoBtn')?.addEventListener('click', () => {
      close();
      const panel = document.getElementById('instaworkYesPanel');
      if (panel) panel.style.display = 'block';
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function showErr(err) {
    const msg = err?.message || String(err);
    if (typeof showAlert === 'function') showAlert('Timesheet', msg);
    else alert(msg);
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
    document.getElementById('eodTsTitle').textContent = `${sheetLabel(state.sheetKey)} management`;
    document.getElementById('eodTsSubtitle').textContent = state.sheetKey === 'instawork'
      ? 'Instawork roster only. PIN login + signatures fill the Instawork sheet. Submit to office files into OneDrive.'
      : 'Kompass / ISE / Blitz / Cut-in (Instawork excluded). Lead is on this sheet. Submit to supervisor emails a copy.';

    if (!state.members.length) {
      body.innerHTML = `<div class="eod-ts-empty">No ${escapeHtml(sheetLabel(state.sheetKey))} teammates found for store #${escapeHtml(storeNumber())} on ${escapeHtml(workDate())}.
        <br><br>You can still show the JOIN QR once people are clocked into PROD.</div>`;
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
        <td>
          <div class="eod-ts-pin">${escapeHtml(m.pin || '—')}</div>
          <div class="eod-ts-row-actions" style="margin-top:6px;">
            <button type="button" class="btn btn-secondary eod-ts-copy-pin" data-idx="${idx}">Copy PIN</button>
            <button type="button" class="btn btn-secondary eod-ts-regen" data-idx="${idx}">New PIN</button>
          </div>
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
            <button type="button" class="btn btn-secondary eod-ts-tablet" data-idx="${idx}">Sign on tablet</button>
            <button type="button" class="btn btn-primary eod-ts-send" data-idx="${idx}">Text / email link</button>
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
              <th>PIN</th>
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
      btn.addEventListener('click', () => saveRow(Number(btn.dataset.idx)).catch(showErr));
    });
    body.querySelectorAll('.eod-ts-send').forEach((btn) => {
      btn.addEventListener('click', () => sendLink(Number(btn.dataset.idx)));
    });
    body.querySelectorAll('.eod-ts-regen').forEach((btn) => {
      btn.addEventListener('click', () => regenPin(Number(btn.dataset.idx)).catch(showErr));
    });
    body.querySelectorAll('.eod-ts-copy-pin').forEach((btn) => {
      btn.addEventListener('click', () => copyPin(Number(btn.dataset.idx)));
    });
    body.querySelectorAll('.eod-ts-tablet').forEach((btn) => {
      btn.addEventListener('click', () => openTabletSign(Number(btn.dataset.idx)).catch(showErr));
    });

    if (status) {
      const adj = state.members.filter((m) => m.confirmation?.status === 'adjust').length;
      const conf = state.members.filter((m) => m.confirmation?.status === 'confirmed').length;
      const joinHint = state.join?.joinUrl ? ' · JOIN QR ready' : '';
      status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${state.members.length} people · ${conf} signed · ${adj} adjusted${joinHint}`;
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
      showErr(new Error('Set store and work date first.'));
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
    if (typeof showAlert === 'function') showAlert('Saved', `${row.name} times updated.`);
  }

  async function regenPin(idx) {
    const m = state.members[idx];
    if (!m) return;
    const resp = await authFetch(`${API}/pins/regenerate`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        employeeKey: m.employeeKey,
        employeeName: m.name,
        sheetKey: state.sheetKey,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Could not regenerate PIN');
    state.members[idx].pin = data.pin;
    render();
    if (typeof showAlert === 'function') showAlert('New PIN', `${m.name}: ${data.pin}`);
  }

  function copyPin(idx) {
    const pin = state.members[idx]?.pin;
    if (!pin) {
      showErr(new Error('No PIN yet — refresh the roster.'));
      return;
    }
    const done = () => {
      if (typeof showAlert === 'function') showAlert('Copied', 'PIN copied to clipboard.');
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(String(pin)).then(done).catch(() => {
        prompt('Copy PIN:', pin);
      });
    } else {
      prompt('Copy PIN:', pin);
    }
  }

  async function openTabletSign(idx) {
    const m = state.members[idx];
    if (!m) return;
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) throw new Error('Set store and work date first.');
    const resp = await authFetch(`${API}/tablet-session`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: store,
        workDate: date,
        employeeKey: m.employeeKey,
        employeeName: m.name,
        sheetKey: state.sheetKey,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (!resp.ok || !data.timeUrl) throw new Error(data.error || 'Could not open tablet sign-off');
    const overlay = document.getElementById('eodTsTabletOverlay');
    const frame = document.getElementById('eodTsTabletFrame');
    const title = document.getElementById('eodTsTabletTitle');
    if (title) title.textContent = `${m.name} — sign off`;
    if (frame) frame.src = data.timeUrl;
    overlay?.classList.add('show');
  }

  function sendLink(idx) {
    const row = readRowInputs(idx) || state.members[idx];
    if (!row) return;
    if (!window.EodGuestHandoff?.openSendModal) {
      showErr(new Error('Guest handoff module failed to load.'));
      return;
    }
    const sessionType = state.sheetKey === 'instawork' ? 'instawork_timesheet' : 'kompass_timesheet';
    window.EodGuestHandoff.openSendModal({
      sessionType,
      title: `Send ${sheetLabel(state.sheetKey)} link — ${row.name}`,
      hint: 'Employee should have texted JOIN to (509) 572-9212 first (or use the JOIN QR + PIN). They can edit times and sign.',
      recipientName: row.name,
      recipientEmail: row.email || '',
      recipientPhone: row.phone || '',
      payload: {
        employees: state.members.map((m) => m.name),
        leadName: leadName(),
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

  async function refreshJoinToken(refresh) {
    const resp = await authFetch(`${API}/join-token`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        refresh: !!refresh,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Could not mint JOIN QR');
    state.join = data;
    return data;
  }

  async function showJoinQr() {
    try {
      if (!state.join?.joinUrl) await refreshJoinToken(false);
      const join = state.join;
      if (!join?.joinUrl) throw new Error('JOIN URL missing');
      document.getElementById('eodTsQrStore').textContent = join.storeNumber || storeNumber();
      document.getElementById('eodTsQrDate').textContent = join.workDate || workDate();
      document.getElementById('eodTsQrUrl').textContent = join.joinUrl;
      const img = document.getElementById('eodTsQrImg');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(join.joinUrl)}`;
      document.getElementById('eodTsQrOverlay').classList.add('show');
    } catch (err) {
      showErr(err);
    }
  }

  async function postAction(path, body) {
    const resp = await authFetch(`${API}/${path}`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: state.sheetKey,
        storeNumber: storeNumber(),
        workDate: workDate(),
        leadName: leadName(),
        ...body,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (resp.status === 409 && data.pendingSignatures) {
      const ok = confirm(`${data.error}\n\nSubmit anyway?`);
      if (!ok) throw new Error('Cancelled');
      return postAction(path, { ...body, force: true });
    }
    if (!resp.ok || data.ok === false) throw new Error(data.error || `Request failed (${resp.status})`);
    return data;
  }

  async function downloadPdf() {
    const data = await postAction('build-pdf', {});
    const bin = atob(data.pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.filename || 'timesheet.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function printAtStore() {
    const data = await postAction('print-at-store', {});
    if (typeof showAlert === 'function') {
      showAlert('Print at store', `Fax job queued for store #${storeNumber()}.`);
    }
    return data;
  }

  async function emailPdf() {
    const to = prompt('Email timesheet PDF to:', '');
    if (!to) return;
    const data = await postAction('email', { to });
    if (typeof showAlert === 'function') showAlert('Emailed', `Sent to ${to}`);
    return data;
  }

  async function submitOffice() {
    const data = await postAction('submit-office', {});
    if (typeof showAlert === 'function') {
      showAlert('Submitted to office', `InstaWork timesheet emailed for OneDrive filing (${data.folder || 'P#W#'}).`);
    }
    return data;
  }

  async function submitSupervisor() {
    let supervisorEmail = '';
    const need = confirm('Submit Kompass timesheet to supervisor?\n\nOK = auto-resolve supervisor email\nCancel = enter email manually');
    if (!need) {
      supervisorEmail = prompt('Supervisor email:', '') || '';
      if (!supervisorEmail) return;
    }
    const data = await postAction('submit-supervisor', { supervisorEmail: supervisorEmail || undefined });
    if (typeof showAlert === 'function') {
      showAlert('Submitted to supervisor', `Emailed ${data.to?.[0] || 'supervisor'} (you are CC'd).`);
    }
    return data;
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
      state.join = data.join || state.join;
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
    renderActions();
    const overlay = document.getElementById('eodTsMgmtOverlay');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    await refresh(true);
    startPoll();
  }

  function close() {
    stopPoll();
    document.getElementById('eodTsMgmtOverlay')?.classList.remove('show');
    document.getElementById('eodTsQrOverlay')?.classList.remove('show');
    document.getElementById('eodTsTabletOverlay')?.classList.remove('show');
    const frame = document.getElementById('eodTsTabletFrame');
    if (frame) frame.src = 'about:blank';
    document.body.style.overflow = '';
  }

  window.EodTimesheetMgmt = {
    open,
    close,
    openInstawork: () => open('instawork'),
    openKompass: () => open('kompass'),
    refresh: () => refresh(true),
    showJoinQr,
  };
})();
