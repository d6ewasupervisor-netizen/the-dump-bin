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
    // Prefer window.authFetch (sets X-EOD-Version). Fallback still stamps it.
    if (typeof window.authFetch === 'function') return window.authFetch(url, init);
    const opts = typeof window.applyEodVersionHeader === 'function'
      ? window.applyEodVersionHeader(init)
      : init;
    if (window.dumpBinAuthFetch) return window.dumpBinAuthFetch(url, opts);
    return fetch(url, opts);
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

  function displayName(m) {
    return (m?.realName || m?.name || '').trim();
  }

  /** Add minutes to "8:00 AM" / "08:00" display times. */
  function addMinutesToDisplayTime(raw, addMins) {
    if (window.EodClockPicker?.parseTime && window.EodClockPicker?.formatDisplay12) {
      const parsed = window.EodClockPicker.parseTime(raw);
      if (!parsed) return '';
      let h24 = parsed.hour12 % 12;
      if (parsed.period === 'PM') h24 += 12;
      let total = h24 * 60 + parsed.minute + Number(addMins || 0);
      total = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
      let h = Math.floor(total / 60);
      const minute = total % 60;
      const period = h >= 12 ? 'PM' : 'AM';
      let hour12 = h % 12;
      if (hour12 === 0) hour12 = 12;
      return window.EodClockPicker.formatDisplay12(hour12, minute, period);
    }
    const s = String(raw || '').trim().replace(/\u202f/g, ' ');
    const m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if (!m) return '';
    let h24 = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM') h24 += 12;
    let total = h24 * 60 + Number(m[2]) + Number(addMins || 0);
    total = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
    let h = Math.floor(total / 60);
    const minute = String(total % 60).padStart(2, '0');
    const period = h >= 12 ? 'PM' : 'AM';
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return `${hour12}:${minute} ${period}`;
  }

  function wireLunchAutoFill(scope) {
    const root = scope || document;
    root.querySelectorAll('input[data-field="lunchOut"], input#lunchOut').forEach((outEl) => {
      if (outEl.dataset.lunchAutoWired === '1') return;
      outEl.dataset.lunchAutoWired = '1';
      const apply = () => {
        const tr = outEl.closest('tr') || outEl.closest('.gh-time-grid') || outEl.closest('.gh-card');
        const inEl = tr
          ? (tr.querySelector('input[data-field="lunchIn"]') || tr.querySelector('input#lunchIn'))
          : document.getElementById('lunchIn');
        if (!inEl) return;
        const next = addMinutesToDisplayTime(outEl.value, 30);
        if (next) {
          inEl.value = next;
          inEl.dispatchEvent(new Event('input', { bubbles: true }));
          inEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      outEl.addEventListener('change', apply);
      outEl.addEventListener('input', () => {
        // Debounce light: only auto when a parseable time is present
        if (addMinutesToDisplayTime(outEl.value, 30)) apply();
      });
    });
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
      .eod-ts-header-tools { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .eod-ts-refresh-btn {
        width: 40px; height: 40px; border-radius: 999px; border: 1px solid #334155;
        background: #1e293b; color: #93c5fd; display: flex; align-items: center; justify-content: center;
        cursor: pointer; padding: 0;
      }
      .eod-ts-refresh-btn.spinning svg { animation: eod-ts-spin 1s linear infinite; }
      @keyframes eod-ts-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .eod-ts-actions {
        display: flex; flex-wrap: wrap; gap: 8px;
        padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid #1e293b; background: #111827; order: 99;
      }
      .eod-ts-shell { display: flex; flex-direction: column; }
      .eod-ts-body { flex: 1; overflow: auto; padding: 12px 16px 16px; -webkit-overflow-scrolling: touch; }
      .eod-ts-table-wrap { overflow-x: auto; border: 1px solid #334155; border-radius: 10px; }
      table.eod-ts-table { width: 100%; border-collapse: collapse; min-width: 1180px; font-size: 13px; }
      .eod-ts-table input[data-field="realName"] { min-width: 110px; }
      .eod-ts-table th, .eod-ts-table td {
        padding: 8px 8px; border-bottom: 1px solid #1e293b; text-align: left; vertical-align: top;
      }
      .eod-ts-table th { background: #1e293b; color: #cbd5e1; font-weight: 600; position: sticky; top: 0; z-index: 1; }
      .eod-ts-table input[type="text"] {
        width: 100%; min-width: 72px; box-sizing: border-box; padding: 6px 8px;
        border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 13px;
      }
      .eod-ts-table .eod-clock-wrap { min-width: 96px; }
      .eod-ts-table .eod-clock-btn { width: 34px; min-width: 34px; background: #1e293b; }
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
      @media (max-width: 720px) {
        table.eod-ts-table { min-width: 0; }
        .eod-ts-table thead { display: none; }
        .eod-ts-table, .eod-ts-table tbody, .eod-ts-table tr, .eod-ts-table td { display: block; width: 100%; }
        .eod-ts-table tr {
          border: 1px solid #334155; border-radius: 12px; margin-bottom: 12px;
          padding: 10px; background: #0f172a;
        }
        .eod-ts-table td { border: 0; padding: 6px 0; }
        .eod-ts-table td[data-label]::before {
          content: attr(data-label); display: block; font-size: 11px; color: #94a3b8;
          font-weight: 700; margin-bottom: 4px;
        }
        .eod-ts-row-actions { flex-direction: row; flex-wrap: wrap; }
        .eod-ts-row-actions .btn { width: auto; flex: 1 1 46%; }
      }
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
          <div class="eod-ts-header-tools">
            <button type="button" class="eod-ts-refresh-btn" id="eodTsRefreshBtn" title="Refresh punches" aria-label="Refresh">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
                <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
            </button>
            <button type="button" class="btn btn-secondary" id="eodTsCloseBtn">Back</button>
          </div>
        </div>
        <div class="eod-ts-statusline" id="eodTsStatus">Loading…</div>
        <div class="eod-ts-body" id="eodTsBody"></div>
        <div class="eod-ts-actions" id="eodTsActions"></div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('eodTsCloseBtn').onclick = () => {
      close();
      if (window.EodWorkspace?.go) window.EodWorkspace.go('crew', { skipAutoOpen: true });
    };
    document.getElementById('eodTsRefreshBtn').onclick = () => {
      const btn = document.getElementById('eodTsRefreshBtn');
      btn?.classList.add('spinning');
      refresh(true).finally(() => btn?.classList.remove('spinning'));
    };

    if (!document.getElementById('eodTsQrOverlay')) {
      const qr = document.createElement('div');
      qr.id = 'eodTsQrOverlay';
      qr.innerHTML = `<div class="eod-ts-qr-card">
        <h3 id="eodTsQrTitle">Scan to join today's shift</h3>
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

  function isTestContext() {
    const store = String(storeNumber() || '').replace(/\D/g, '').replace(/^0+/, '') || '';
    return store === '999'
      || (typeof window !== 'undefined' && sessionStorage.getItem('eodTestMode') === '1');
  }

  function forceLiveChecked() {
    const can = typeof window.canEodForceLive === 'function'
      ? window.canEodForceLive()
      : false;
    if (!can) return false;
    return typeof window.isEodForceLiveDelivery === 'function'
      ? window.isEodForceLiveDelivery()
      : (sessionStorage.getItem('eodTestMode') === '1'
        && sessionStorage.getItem('eodForceLiveDelivery') === '1');
  }

  function renderActions() {
    const bar = document.getElementById('eodTsActions');
    if (!bar) return;
    const isIw = state.sheetKey === 'instawork';
    const testCtx = isTestContext();
    const canLive = typeof window.canEodForceLive === 'function' && window.canEodForceLive();
    const liveOn = forceLiveChecked();
    bar.innerHTML = `
      <button type="button" class="btn btn-primary" id="eodTsShowQrBtn">Show JOIN QR</button>
      <button type="button" class="btn btn-secondary" id="eodTsDownloadBtn">Download PDF</button>
      <button type="button" class="btn btn-secondary" id="eodTsPrintBtn">Print at store</button>
      <button type="button" class="btn btn-secondary" id="eodTsEmailBtn">Email PDF</button>
      ${isIw
        ? '<button type="button" class="btn btn-primary" id="eodTsSubmitOfficeBtn">Submit to office</button>'
        : '<button type="button" class="btn btn-primary" id="eodTsSubmitSupBtn">Submit to supervisor</button>'}
      ${isIw ? '<button type="button" class="btn btn-secondary" id="eodTsPhotoBtn">Sign-out photo</button>' : ''}
      ${testCtx && canLive ? `<label class="eod-ts-live-toggle" title="Supervisor/admin only. Store 999 fax stays blocked." style="display:flex;align-items:center;gap:8px;margin-left:auto;padding:6px 10px;border-radius:8px;background:${liveOn ? 'rgba(180,83,9,.25)' : 'rgba(15,23,42,.55)'};border:1px solid ${liveOn ? '#fbbf24' : '#334155'};font-size:13px;cursor:pointer;">
        <input type="checkbox" data-eod-force-live id="eodTsForceLive"${liveOn ? ' checked' : ''} style="width:16px;height:16px;">
        <span>Live delivery path</span>
      </label>` : ''}`;

    document.getElementById('eodTsShowQrBtn').onclick = () => showJoinQr();
    document.getElementById('eodTsDownloadBtn').onclick = () => downloadPdf().catch(showErr);
    document.getElementById('eodTsPrintBtn').onclick = () => printAtStore().catch(showErr);
    document.getElementById('eodTsEmailBtn').onclick = () => emailPdf().catch(showErr);
    document.getElementById('eodTsSubmitOfficeBtn')?.addEventListener('click', () => submitOffice().catch(showErr));
    document.getElementById('eodTsSubmitSupBtn')?.addEventListener('click', () => submitSupervisor().catch(showErr));
    document.getElementById('eodTsPhotoBtn')?.addEventListener('click', () => {
      close();
      if (window.EodWorkspace?.go) window.EodWorkspace.go('photos', { skipAutoOpen: true });
      const iwYes = document.getElementById('instaworkYes');
      const iwNo = document.getElementById('instaworkNo');
      if (iwYes) { iwYes.checked = true; if (iwNo) iwNo.checked = false; }
      const panel = document.getElementById('instaworkYesPanel');
      if (panel) panel.style.display = 'block';
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const liveToggle = document.getElementById('eodTsForceLive');
    if (liveToggle) {
      liveToggle.addEventListener('change', () => {
        if (typeof window.setEodForceLiveDelivery === 'function') {
          window.setEodForceLiveDelivery(liveToggle.checked);
        } else if (liveToggle.checked) {
          sessionStorage.setItem('eodForceLiveDelivery', '1');
        } else {
          sessionStorage.removeItem('eodForceLiveDelivery');
        }
        renderActions();
      });
    }
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
      const isIw = state.sheetKey === 'instawork';
      const realNameCell = isIw
        ? `<td data-label="Real name"><input type="text" data-field="realName" value="${escapeHtml(m.realName || '')}" placeholder="Legal / badge name" aria-label="Real name"></td>`
        : '';
      return `<tr data-key="${escapeHtml(m.employeeKey)}" data-idx="${idx}">
        <td data-label="Teammate">
          <div class="eod-ts-name">${escapeHtml(m.name)}</div>
          <div class="eod-ts-meta">${m.isLead ? 'Lead · ' : ''}${escapeHtml(m.title || '')}${m.workdayId ? ` · WD ${escapeHtml(m.workdayId)}` : ''}</div>
          <div class="eod-ts-meta">Source: ${escapeHtml(m.timeSource || 'sas')}</div>
          ${isIw && m.realName ? `<div class="eod-ts-meta">Real: ${escapeHtml(m.realName)}</div>` : ''}
          ${note}
        </td>
        ${realNameCell}
        <td data-label="PIN">
          <div class="eod-ts-pin">${escapeHtml(m.pin || '—')}</div>
          <div class="eod-ts-row-actions" style="margin-top:6px;">
            <button type="button" class="btn btn-secondary eod-ts-copy-pin" data-idx="${idx}">Copy PIN</button>
            <button type="button" class="btn btn-secondary eod-ts-regen" data-idx="${idx}">New PIN</button>
          </div>
        </td>
        <td data-label="Clock in"><input type="text" data-field="clockIn" value="${escapeHtml(m.clockIn || '')}" aria-label="Clock in"></td>
        <td data-label="Lunch out"><input type="text" data-field="lunchOut" value="${escapeHtml(m.lunchOut || '')}" aria-label="Lunch out"></td>
        <td data-label="Lunch in"><input type="text" data-field="lunchIn" value="${escapeHtml(m.lunchIn || '')}" aria-label="Lunch in"></td>
        <td data-label="Clock out"><input type="text" data-field="clockOut" value="${escapeHtml(m.clockOut || '')}" aria-label="Clock out"></td>
        <td data-label="Signature">${sig}</td>
        <td data-label="Status">${statusBadge(conf.status)}${conf.submittedAt ? `<div class="eod-ts-meta">${escapeHtml(new Date(conf.submittedAt).toLocaleString())}</div>` : ''}</td>
        <td data-label="Actions">
          <div class="eod-ts-row-actions">
            <button type="button" class="btn btn-secondary eod-ts-save" data-idx="${idx}">Save</button>
            <button type="button" class="btn btn-secondary eod-ts-assign" data-idx="${idx}">Sets / notes / PDFs</button>
            <button type="button" class="btn btn-secondary eod-ts-tablet" data-idx="${idx}">Sign on tablet</button>
            <button type="button" class="btn btn-primary eod-ts-send" data-idx="${idx}">Text / email link</button>
          </div>
          ${m.assignment?.notes || (m.assignment?.materials || []).length
            ? `<div class="eod-ts-meta" style="margin-top:6px;">Has shared notes/materials</div>` : ''}
        </td>
      </tr>`;
    }).join('');

    const realNameTh = state.sheetKey === 'instawork' ? '<th>Real name</th>' : '';
    body.innerHTML = `
      <div class="eod-ts-table-wrap">
        <table class="eod-ts-table">
          <thead>
            <tr>
              <th>Teammate</th>
              ${realNameTh}
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
    body.querySelectorAll('.eod-ts-assign').forEach((btn) => {
      btn.addEventListener('click', () => assignMaterials(Number(btn.dataset.idx)).catch(showErr));
    });

    if (window.EodClockPicker) {
      window.EodClockPicker.enhance(body, 'input[data-field="clockIn"], input[data-field="lunchOut"], input[data-field="lunchIn"], input[data-field="clockOut"]', {
        format: 'display12',
        snapMinutes: 5,
      });
    }
    wireLunchAutoFill(body);

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
    let lunchOut = get('lunchOut');
    let lunchIn = get('lunchIn');
    if (lunchOut && !lunchIn) {
      lunchIn = addMinutesToDisplayTime(lunchOut, 30) || lunchIn;
    }
    return {
      ...m,
      realName: get('realName') || m.realName || '',
      clockIn: get('clockIn'),
      lunchOut,
      lunchIn,
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
    if (state.sheetKey === 'instawork' && !row.realName) {
      showErr(new Error('Enter a Real name for this InstaWork teammate before saving — it travels with their PIN.'));
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
        realName: row.realName || '',
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
      realName: row.realName || '',
      clockIn: row.clockIn,
      lunchOut: row.lunchOut,
      lunchIn: row.lunchIn,
      clockOut: row.clockOut,
      timeSource: 'lead',
    });
    // Refresh real-name label under teammate without full re-fetch
    const tr = document.querySelector(`#eodTsBody tr[data-idx="${idx}"]`);
    if (tr && state.sheetKey === 'instawork') {
      let meta = tr.querySelector('.eod-ts-real-label');
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'eod-ts-meta eod-ts-real-label';
        tr.querySelector('td')?.appendChild(meta);
      }
      meta.textContent = row.realName ? `Real: ${row.realName}` : '';
    }
    if (typeof showAlert === 'function') {
      showAlert('Saved', `${displayName(row) || row.name} times updated.`);
    }
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
    if (typeof showAlert === 'function') showAlert('New PIN', `${displayName(m) || m.name}: ${data.pin}`);
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
        realName: m.realName || '',
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
    if (title) title.textContent = `${displayName(m) || m.name} — sign off`;
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
    const who = displayName(row) || row.name;
    const sessionType = state.sheetKey === 'instawork' ? 'instawork_timesheet' : 'kompass_timesheet';
    window.EodGuestHandoff.openSendModal({
      sessionType,
      title: `Send ${sheetLabel(state.sheetKey)} link — ${who}`,
      hint: 'Employee should have texted JOIN to (509) 572-9212 first (or use the JOIN QR + PIN). They can edit times and sign.',
      recipientName: who,
      recipientEmail: row.email || '',
      recipientPhone: row.phone || '',
      payload: {
        employees: state.members.map((m) => displayName(m) || m.name),
        leadName: leadName(),
        blank: false,
        member: {
          name: who,
          realName: row.realName || '',
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
          name: who,
          realName: row.realName || '',
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

  async function assignMaterials(idx) {
    const row = state.members[idx];
    if (!row) return;
    const prev = row.assignment || {};
    const notes = prompt(
      `Notes for ${displayName(row)} (shown after PIN login):`,
      prev.notes || ''
    );
    if (notes === null) return;
    const setsRaw = prompt(
      'Set names / dbkeys (comma-separated), or leave blank:',
      Array.isArray(prev.setDbkeys) ? prev.setDbkeys.join(', ') : ''
    );
    if (setsRaw === null) return;
    const matsRaw = prompt(
      'PDF / material URLs (comma-separated secure-share or Dump Bin links), or leave blank:',
      Array.isArray(prev.materials) ? prev.materials.map((m) => m.url || '').filter(Boolean).join(', ') : ''
    );
    if (matsRaw === null) return;
    const setDbkeys = String(setsRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
    const materials = String(matsRaw || '').split(',').map((s) => s.trim()).filter(Boolean)
      .map((url, i) => ({ name: `Document ${i + 1}`, url }));
    const resp = await authFetch(`${API}/assignment`, {
      method: 'PUT',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: state.sheetKey,
        storeNumber: storeNumber(),
        workDate: workDate(),
        employeeKey: row.employeeKey,
        notes,
        setDbkeys,
        materials,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Could not save assignment');
    row.assignment = data.assignment;
    render();
    if (typeof showAlert === 'function') showAlert('Assignment saved', `${displayName(row)} will see these after PIN login.`);
  }

  async function refreshJoinToken(refresh) {
    const resp = await authFetch(`${API}/join-token`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        sheetKey: state.sheetKey || 'kompass',
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
      const titleEl = document.getElementById('eodTsQrTitle');
      if (titleEl) {
        titleEl.textContent = state.sheetKey === 'instawork'
          ? 'InstaWork — scan to join'
          : 'Kompass — scan to join';
      }
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

  async function postAction(path, body, opts = {}) {
    const live = forceLiveChecked();
    const deliveryPaths = new Set(['print-at-store', 'email', 'submit-office', 'submit-supervisor']);
    if (!opts.skipLiveConfirm && deliveryPaths.has(path) && live) {
      if (typeof window.confirmForceLiveIfNeeded === 'function') {
        const ok = await window.confirmForceLiveIfNeeded(path);
        if (!ok) throw new Error('Cancelled');
      } else {
        const ok = confirm(`LIVE delivery override is ON for "${path}". Continue?`);
        if (!ok) throw new Error('Cancelled');
      }
    }
    const resp = await authFetch(`${API}/${path}`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: state.sheetKey,
        storeNumber: storeNumber(),
        workDate: workDate(),
        leadName: leadName(),
        forceLive: (live && deliveryPaths.has(path)) || undefined,
        testMode: isTestContext() || undefined,
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
      return postAction(path, { ...body, force: true }, { skipLiveConfirm: true });
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
      showAlert(
        data.forceLive || (forceLiveChecked() && !data.testMode) ? 'Print at store (LIVE)' : 'Print at store',
        data.testMode
          ? `TEST — emailed to tester only (not store fax) for #${storeNumber()}.`
          : `Fax job queued for store #${storeNumber()}.`
      );
    }
    return data;
  }

  async function emailPdf() {
    const to = prompt('Email timesheet PDF to:', forceLiveChecked() ? '' : '');
    if (!to) return;
    const data = await postAction('email', { to });
    if (typeof showAlert === 'function') {
      showAlert(
        data.testMode ? 'Emailed (TEST)' : 'Emailed',
        data.testMode ? `Routed to tester only (requested ${to}).` : `Sent to ${to}`
      );
    }
    return data;
  }

  async function submitOffice() {
    const data = await postAction('submit-office', {});
    if (typeof showAlert === 'function') {
      if (data.testMode) {
        showAlert(
          'Submitted (TEST)',
          `Emailed the tester only — not filed into live OneDrive. Check "Live delivery path" to exercise Gmail → OneDrive (${data.folder || 'P#W#'}).`
        );
      } else if (data.forceLive) {
        showAlert(
          'Submitted (LIVE path)',
          `InstaWork timesheet emailed on the live path for OneDrive filing (${data.folder || 'P#W#'}). Store still #999 in the PDF.`
        );
      } else {
        showAlert('Submitted to office', `InstaWork timesheet emailed for OneDrive filing (${data.folder || 'P#W#'}).`);
      }
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
      showAlert(
        data.testMode ? 'Submitted (TEST)' : 'Submitted to supervisor',
        data.testMode
          ? 'Emailed tester only (not the live supervisor inbox).'
          : `Emailed ${data.to?.[0] || 'supervisor'} (you are CC'd).`
      );
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
      if (state.sheetKey === 'instawork' && state.members.length) {
        const iwYes = document.getElementById('instaworkYes');
        const iwNo = document.getElementById('instaworkNo');
        if (iwYes) { iwYes.checked = true; if (iwNo) iwNo.checked = false; }
      }
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

  function close(opts) {
    stopPoll();
    document.getElementById('eodTsMgmtOverlay')?.classList.remove('show');
    document.getElementById('eodTsQrOverlay')?.classList.remove('show');
    document.getElementById('eodTsTabletOverlay')?.classList.remove('show');
    const frame = document.getElementById('eodTsTabletFrame');
    if (frame) frame.src = 'about:blank';
    document.body.style.overflow = '';
    if (!(opts || {}).fromNav && window.EodWorkspace?.currentPage) {
      const p = window.EodWorkspace.currentPage;
      if (p === 'instawork' || p === 'kompass') {
        /* stay on page shell; overlay closed */
      }
    }
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
