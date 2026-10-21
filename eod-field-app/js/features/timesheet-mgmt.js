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
    unknownPhones: [],
    textMisses: [],
    pollTimer: null,
    loading: false,
    drafts: {},
  };

  function draftKey(employeeKey) {
    return `${state.sheetKey}|${storeNumber()}|${workDate()}|${employeeKey}`;
  }

  /** Unsaved typed value wins over the polled server value. */
  function fieldValue(m, field) {
    const draft = state.drafts[draftKey(m.employeeKey)];
    if (draft && Object.prototype.hasOwnProperty.call(draft, field)) return draft[field];
    return m[field] || '';
  }

  /** "6:19 AM" / "06:19" → minutes after midnight. */
  function displayMinutes(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
    if (!m) return null;
    let h = Number(m[1]) % (m[3] ? 12 : 24);
    if (m[3] && /pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  }

  function spanMinutes(from, to) {
    const a = displayMinutes(from);
    const b = displayMinutes(to);
    if (a == null || b == null) return null;
    return (b - a + 1440) % 1440;
  }

  const TIME_FIELDS = ['clockIn', 'lunchOut', 'lunchIn', 'clockOut'];

  function vsSchedule(minutes) {
    if (minutes == null || !Number.isFinite(minutes) || minutes === 0) return '';
    const n = Math.abs(minutes);
    const span = n >= 60 ? `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m` : `${n}m`;
    return ` (${span} ${minutes < 0 ? 'early' : 'late'})`;
  }

  /** The pro's own Instawork clock in and out, kept before any time edit. */
  function instaworkClockLines(iw) {
    if (!iw || (!iw.clockIn && !iw.clockOut)) return '';
    const lines = [];
    if (iw.clockIn) lines.push(`Instawork in ${escapeHtml(iw.clockIn)}${vsSchedule(iw.inVsScheduled)}`);
    if (iw.clockOut) lines.push(`Instawork out ${escapeHtml(iw.clockOut)}${vsSchedule(iw.outVsScheduled)}`);
    return lines.map((t) => `<div class="eod-ts-meta eod-ts-iw-clock">${t}</div>`).join('');
  }

  /** In-app only. Print CSS hides this; the timesheet PDF does not receive it. */
  function registeredLines(m) {
    if (!m || !Object.prototype.hasOwnProperty.call(m, 'registered')) return '';
    const reg = m.registered || {};
    const listed = reg.listed;
    let html = '';
    if (listed && (listed.name || listed.phoneDisplay)) {
      const who = [listed.name, listed.phoneDisplay].filter(Boolean).join(' · ');
      const head = listed.source === 'instawork' ? `InstaWork: ${who}` : who;
      html += `<div class="eod-ts-phone">${escapeHtml(head)}</div>`;
    } else {
      html += '<div class="eod-ts-phone">No registered phone</div>';
    }
    for (const v of reg.variants || []) {
      const bit = [v.name, v.phoneDisplay].filter(Boolean).join(' · ');
      if (!bit) continue;
      html += `<div class="eod-ts-phone eod-ts-variant">Variant · ${escapeHtml(v.label)}: ${escapeHtml(bit)}</div>`;
    }
    return html;
  }

  /** PROD's own total while the row matches PROD; after a lead edit, in to out less lunch. */
  function totalFor(m) {
    const prod = m.prodTimes || {};
    const matchesProd = TIME_FIELDS.every((f) => String(fieldValue(m, f)).trim() === String(prod[f] || '').trim());
    if (matchesProd && m.prodTotal) return m.prodTotal;
    const worked = spanMinutes(fieldValue(m, 'clockIn'), fieldValue(m, 'clockOut'));
    if (worked == null) return '';
    const total = Math.max(0, worked - (spanMinutes(fieldValue(m, 'lunchOut'), fieldValue(m, 'lunchIn')) || 0));
    return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
  }

  /** Digital office submit checks the Send gate the paper photo used to check. */
  function applyOfficeSubmitted(filed) {
    if (!filed) return;
    const S = window.EodSession;
    if (!S?.patch || S.state.instaworkOfficeSubmitted) return;
    S.patch({ instaworkOfficeSubmitted: true }, 'iw-office');
    try { S.saveDraft(); } catch (_) {}
    try { window.EodCrew?.paintInstawork?.(); } catch (_) {}
  }

  /** A clocked placeholder can light the flag early. Send is what decides No. */
  function syncInstaworkTrigger() {
    if (state.sheetKey !== 'instawork') return;
    const S = window.EodSession;
    if (!S?.patch) return;
    const Logic = window.EodSendSheetsLogic;
    const timed = state.members.some((m) => (
      Logic?.memberLoggedTime
        ? Logic.memberLoggedTime(m)
        : String(fieldValue(m, 'clockIn')).trim()
    ));
    if (!timed || S.state.instaworkYes === 'Yes') return;
    S.patch({ instaworkYes: 'Yes' }, 'iw');
    try { S.saveDraft(); } catch (_) {}
  }

  async function fetchInstaworkMembers() {
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) return [];
    const url = `${API}?sheet=instawork&store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`;
    const resp = await authFetch(url, { headers: dayConfirmHeaders(), skipBusy: true });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || `InstaWork roster failed (${resp.status})`);
    }
    applyOfficeSubmitted(!!data.officeSubmitted);
    return (data.members || []).map((m) => Object.assign({ sheetKey: 'instawork' }, m));
  }

  function isEditing() {
    const active = document.activeElement;
    const body = document.getElementById('eodTsBody');
    if (active && body && body.contains(active) && active.matches?.('input, textarea, select')) return true;
    return !!document.getElementById('eodClockPickerOverlay')?.classList.contains('show');
  }

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

  function isoDate(raw) {
    if (!raw) return '';
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      const y = raw.getUTCFullYear();
      const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
      const d = String(raw.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const s = String(raw).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function storeNumber() {
    return String(
      document.getElementById('storeNumber')?.value
      || document.getElementById('instaworkAckStoreNumber')?.value
      || document.getElementById('kompassAckStoreNumber')?.value
      || window.EodSession?.state?.storeNumber
      || window.EodSession?.state?.selectedShift?.storeNumber
      || ''
    ).trim();
  }

  function workDate() {
    return isoDate(
      document.getElementById('workDate')?.value
      || document.getElementById('shiftDate')?.value
      || document.getElementById('dayConfirmDate')?.value
      || window.EodSession?.state?.workDate
      || window.EodSession?.state?.selectedShift?.workDate
      || window.EodSession?.state?.selectedShift?.scheduledDate
      || ''
    );
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
        background: var(--bg, #0b1220); color: var(--text, #e2e8f0); overflow: hidden;
      }
      .eod-ts-header {
        display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px;
        padding: 14px 16px; border-bottom: 1px solid var(--border, #1e293b); background: var(--surface, #111827);
      }
      .eod-ts-header h2 { margin: 0; font-size: 1.15rem; color: #fde68a; }
      .eod-ts-header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; line-height: 1.4; }
      .eod-ts-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #1e293b; }
      .eod-lieu-btn { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.05; padding: 6px 10px; white-space: normal; min-width: 76px; }
      .eod-ts-lieu-stamp { font-weight: 700; color: #fde68a; }
      .eod-ts-body { flex: 1; overflow: auto; padding: 12px 16px 24px; -webkit-overflow-scrolling: touch; }
      .eod-ts-table-wrap { overflow-x: auto; border: 1px solid #334155; border-radius: 10px; }
      table.eod-ts-table { width: 100%; border-collapse: collapse; min-width: 1180px; font-size: 13px; }
      .eod-ts-table input[data-field="realName"] { min-width: 110px; }
      .eod-ts-table th, .eod-ts-table td {
        padding: 8px 8px; border-bottom: 1px solid #1e293b; text-align: left; vertical-align: top;
      }
      .eod-ts-table th { background: #1e293b; color: #cbd5e1; font-weight: 600; position: sticky; top: 0; z-index: 1; }
      .eod-ts-table input[type="text"] {
        width: 100%; min-width: 72px; box-sizing: border-box; padding: 6px 8px;
        border-radius: 6px; border: 1px solid var(--input-border, #475569); background: var(--input-bg, #0f172a); color: var(--text, #f8fafc); font-size: 13px;
      }
      .eod-ts-table .eod-clock-wrap { min-width: 96px; }
      .eod-ts-table .eod-clock-btn { width: 34px; min-width: 34px; background: #1e293b; }
      .eod-ts-pin {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 16px; font-weight: 700; letter-spacing: 0.12em; color: #fde68a;
      }
      .eod-ts-name { font-weight: 600; color: #f8fafc; }
      .eod-ts-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
      .eod-ts-phone { font-size: 12px; color: #e2e8f0; margin-top: 4px; }
      .eod-ts-variant { color: #fde68a; }
      @media print { .eod-ts-phone { display: none !important; } }
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
      .eod-ts-total { font-weight: 700; color: #f8fafc; white-space: nowrap; }
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
          padding: 10px; background: var(--row-bg, #0f172a);
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
        position: fixed; inset: 0; z-index: 45500; background: rgba(2,6,23,.92);
        display: none; align-items: center; justify-content: center; padding: 20px;
      }
      #eodTsQrOverlay.show { display: flex; }
      .eod-ts-qr-card {
        background: #fff; color: #0f172a; border-radius: 16px; padding: 24px; max-width: min(420px, 100%); width: 100%;
        text-align: center;
      }
      .eod-ts-qr-card img { width: min(280px, 100%); height: auto; aspect-ratio: 1; background: #fff; }
      .eod-ts-qr-card h3 { margin: 0 0 8px; font-size: 1.2rem; }
      .eod-ts-qr-url { font-size: 12px; word-break: break-all; color: #475569; margin: 10px 0 16px; }
      #eodTsTabletOverlay {
        position: fixed; inset: 0; z-index: 45600; background: var(--bg, #0b1220);
        display: none; flex-direction: column;
      }
      #eodTsTabletOverlay.show { display: flex; }
      #eodTsTabletBar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; background: var(--surface, #111827); border-bottom: 1px solid var(--border, #334155);
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

  function isTestContext() {
    const store = String(storeNumber() || '').replace(/\D/g, '').replace(/^0+/, '') || '';
    return store === '999'
      || (typeof window !== 'undefined' && (
        window.EodTestMode?.isEnabled?.()
        || sessionStorage.getItem('eodTestMode') === '1'
      ));
  }

  function forceLiveChecked() {
    if (typeof window.canEodForceLive === 'function' && !window.canEodForceLive()) return false;
    if (typeof window.EodRoles?.canForceLive === 'function' && !window.EodRoles.canForceLive()) return false;
    if (typeof window.isEodForceLiveDelivery === 'function') return !!window.isEodForceLiveDelivery();
    if (typeof window.EodTestMode?.isForceLive === 'function') return !!window.EodTestMode.isForceLive();
    return sessionStorage.getItem('eodTestMode') === '1'
      && sessionStorage.getItem('eodForceLiveDelivery') === '1';
  }

  const LIEU_RE = /^lieu:Signed \d{2}\/\d{2}\/\d{2}$/;

  function signatureRaw(member) {
    const conf = member?.confirmation || {};
    return String(conf.signatureDataUrl || conf.signatureUrl || '');
  }

  function lieuLabel(raw) {
    const match = LIEU_RE.exec(String(raw || '').trim());
    return match ? match[0].slice(5) : '';
  }

  function lieuOnSheet(member) {
    if (state.sheetKey !== 'instawork') return true;
    if (member?.noShow) return false;
    const timed = ['clockIn', 'clockOut', 'lunchOut', 'lunchIn'].some((field) => String(member?.[field] || '').trim());
    return timed || !!String(member?.realName || '').trim() || !!signatureRaw(member);
  }

  function lieuGaps() {
    let open = 0;
    let lieu = 0;
    for (const member of state.members || []) {
      if (!lieuOnSheet(member)) continue;
      const raw = signatureRaw(member);
      if (LIEU_RE.test(raw)) lieu += 1;
      else if (!raw) open += 1;
    }
    return { open, lieu };
  }

  function lieuButtonHtml(id, undo) {
    if (undo) return `<button type="button" class="btn btn-secondary" id="${id}">Undo</button>`;
    return `<button type="button" class="btn btn-secondary eod-lieu-btn" id="${id}"><span>Sign in</span><span>lieu of</span></button>`;
  }

  function renderActions() {
    const bar = document.getElementById('eodTsActions');
    if (!bar) return;
    const isIw = state.sheetKey === 'instawork';
    const testCtx = isTestContext();
    const canLive = (typeof window.canEodForceLive === 'function' && window.canEodForceLive())
      || (typeof window.EodRoles?.canForceLive === 'function' && window.EodRoles.canForceLive());
    const liveOn = forceLiveChecked();
    const gaps = lieuGaps();
    const lieuUndo = gaps.open === 0 && gaps.lieu > 0;
    bar.innerHTML = `
      ${lieuButtonHtml('eodTsLieuBtn', lieuUndo)}
      <button type="button" class="btn btn-secondary" id="eodTsRefreshBtn">Refresh</button>
      <button type="button" class="btn btn-primary" id="eodTsDistributeBtn">Distribute time</button>
      <button type="button" class="btn btn-primary" id="eodTsShowQrBtn">Sign-in QR</button>
      <button type="button" class="btn btn-secondary" id="eodTsDownloadBtn">Download PDF</button>
      <button type="button" class="btn btn-secondary" id="eodTsPrintBtn">Print at store</button>
      <button type="button" class="btn btn-secondary" id="eodTsEmailBtn">Email PDF</button>
      ${isIw
        ? '<button type="button" class="btn btn-primary" id="eodTsSubmitOfficeBtn">Submit to office</button>'
        : '<button type="button" class="btn btn-primary" id="eodTsSubmitSupBtn">Submit to supervisor</button>'}
      ${testCtx && canLive ? `<label class="eod-ts-live-toggle" title="Supervisor/admin only. Store 999 cannot force a live store fax." style="display:flex;align-items:center;gap:8px;margin-left:auto;padding:6px 10px;border-radius:8px;background:${liveOn ? 'rgba(180,83,9,.25)' : 'rgba(15,23,42,.55)'};border:1px solid ${liveOn ? '#fbbf24' : '#334155'};font-size:13px;cursor:pointer;">
        <input type="checkbox" data-eod-force-live id="eodTsForceLive"${liveOn ? ' checked' : ''} style="width:16px;height:16px;">
        <span>Live delivery path</span>
      </label>` : ''}`;

    document.getElementById('eodTsLieuBtn').onclick = () => signInLieu(state.sheetKey, lieuUndo).catch(showErr);
    document.getElementById('eodTsRefreshBtn').onclick = () => refresh(true);
    document.getElementById('eodTsDistributeBtn').onclick = () => distribute(state.sheetKey).catch(showErr);
    document.getElementById('eodTsShowQrBtn').onclick = () => showJoinQr();
    document.getElementById('eodTsDownloadBtn').onclick = () => downloadPdf().catch(showErr);
    document.getElementById('eodTsPrintBtn').onclick = () => printAtStore().catch(showErr);
    document.getElementById('eodTsEmailBtn').onclick = () => emailPdf().catch(showErr);
    document.getElementById('eodTsSubmitOfficeBtn')?.addEventListener('click', () => submitOffice().catch(showErr));
    document.getElementById('eodTsSubmitSupBtn')?.addEventListener('click', () => submitSupervisor().catch(showErr));
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

  function statusBadge(status, noShow) {
    if (noShow) return '<span class="eod-ts-badge adjust">No show</span>';
    const s = status || 'pending';
    const label = s === 'confirmed' ? 'Confirmed' : (s === 'adjust' ? 'Adjusted' : 'Pending');
    return `<span class="eod-ts-badge ${escapeHtml(s)}">${label}</span>`;
  }

  function unknownPhoneCard() {
    const list = state.unknownPhones || [];
    if (!list.length) return '';
    const options = (state.members || []).map((m) =>
      `<option value="${escapeHtml(m.employeeKey)}">${escapeHtml(m.name)}</option>`
    ).join('');
    return list.map((row) => `
      <div class="eod-ts-unknown" data-unknown="${row.id}" style="margin:0 0 12px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;">
        ${escapeHtml(row.phone || row.maskedPhone)} tried to sign in
        <label style="margin-left:8px;">Assign to
          <select data-unknown-id="${row.id}">
            <option value="">Select</option>
            ${options}
          </select>
        </label>
      </div>`).join('');
  }

  async function assignUnknown(unknownId, employeeKey) {
    const resp = await authFetch(`${API}/assign-phone`, {
      method: 'PUT',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        unknownId,
        employeeKey,
        sheetKey: state.sheetKey,
        storeNumber: storeNumber(),
        workDate: workDate(),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Could not assign this phone');
    state.unknownPhones = (state.unknownPhones || []).filter((row) => String(row.id) !== String(unknownId));
    render();
  }

  function textMissCard() {
    const list = state.textMisses || [];
    if (!list.length) return '';
    const options = (state.members || []).map((m) =>
      `<option value="${escapeHtml(m.employeeKey)}">${escapeHtml(m.name)}</option>`
    ).join('');
    return list.map((row) => `
      <div class="eod-ts-unknown" data-text-miss="${escapeHtml(row.id)}" style="margin:0 0 12px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;">
        …${escapeHtml(row.last4)} texted ${escapeHtml(row.keyword)} at ${escapeHtml(row.receivedLabel)}
        <label style="margin-left:8px;">Assign to
          <select data-text-miss-id="${escapeHtml(row.id)}">
            <option value="">Select</option>
            ${options}
          </select>
        </label>
        <button type="button" class="btn btn-secondary eod-ts-text-miss-dismiss" data-text-miss-id="${escapeHtml(row.id)}" style="margin-left:8px;">Dismiss</button>
      </div>`).join('');
  }

  async function resolveTextMiss(action, id, employeeKey) {
    const resp = await authFetch(`${API}/text-miss/${action}`, {
      method: 'PUT',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        id,
        employeeKey,
        sheetKey: state.sheetKey,
        storeNumber: storeNumber(),
        workDate: workDate(),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      if (resp.status === 404) {
        await refresh(true);
        return;
      }
      throw new Error(data.error || (action === 'assign' ? 'Could not assign this text' : 'Could not dismiss this text'));
    }
    state.textMisses = (state.textMisses || []).filter((row) => String(row.id) !== String(id));
    if (action === 'assign') await refresh(true);
    else render();
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
      const sigRaw = conf.signatureDataUrl || conf.signatureUrl || '';
      const sigLieu = lieuLabel(sigRaw);
      const sig = sigLieu
        ? `<span class="eod-ts-lieu-stamp">${escapeHtml(sigLieu)}</span>`
        : (sigRaw
          ? `<img class="eod-ts-sig" alt="Signature" src="${escapeHtml(sigRaw)}">`
          : '<span class="eod-ts-meta">—</span>');
      const isIw = state.sheetKey === 'instawork';
      const realNameCell = isIw
        ? `<td data-label="Real name"><input type="text" data-field="realName" value="${escapeHtml(fieldValue(m, 'realName'))}" placeholder="Legal / badge name" aria-label="Real name"></td>`
        : '';
      return `<tr data-key="${escapeHtml(m.employeeKey)}" data-idx="${idx}">
        <td data-label="Teammate">
          <div class="eod-ts-name">${escapeHtml(m.name)}</div>
          <div class="eod-ts-meta">${m.isLead ? 'Lead · ' : ''}${escapeHtml(m.title || '')}${m.workdayId ? ` · WD ${escapeHtml(m.workdayId)}` : ''}</div>
          <div class="eod-ts-meta">Source: ${escapeHtml(m.timeSource || 'sas')}</div>
          ${registeredLines(m)}
          ${m.signinMethod ? `<div class="eod-ts-meta">${escapeHtml(m.signinMethod)}</div>` : ''}
          ${isIw && m.realName ? `<div class="eod-ts-meta">Real: ${escapeHtml(m.realName)}</div>` : ''}
          ${isIw ? instaworkClockLines(m.instawork) : ''}
          ${note}
        </td>
        ${realNameCell}
        <td data-label="PIN">
          <details>
            <summary>Fallback</summary>
            <div class="eod-ts-pin">${escapeHtml(m.pin || '—')}</div>
            <div class="eod-ts-row-actions" style="margin-top:6px;">
              <button type="button" class="btn btn-secondary eod-ts-copy-pin" data-idx="${idx}">Copy PIN</button>
              <button type="button" class="btn btn-secondary eod-ts-regen" data-idx="${idx}">New PIN</button>
            </div>
          </details>
        </td>
        <td data-label="Clock in"><input type="text" data-field="clockIn" value="${escapeHtml(fieldValue(m, 'clockIn'))}" aria-label="Clock in"></td>
        <td data-label="Lunch out"><input type="text" data-field="lunchOut" value="${escapeHtml(fieldValue(m, 'lunchOut'))}" aria-label="Lunch out"></td>
        <td data-label="Lunch in"><input type="text" data-field="lunchIn" value="${escapeHtml(fieldValue(m, 'lunchIn'))}" aria-label="Lunch in"></td>
        <td data-label="Clock out"><input type="text" data-field="clockOut" value="${escapeHtml(fieldValue(m, 'clockOut'))}" aria-label="Clock out"></td>
        <td data-label="Total"><span class="eod-ts-total" data-total>${escapeHtml(totalFor(m) || '—')}</span></td>
        <td data-label="Signature">${sig}</td>
        <td data-label="Status">${statusBadge(conf.status, m.noShow)}${conf.confirmedBy ? `<div class="eod-ts-meta">${escapeHtml(conf.confirmedBy)}</div>` : ''}${conf.submittedAt ? `<div class="eod-ts-meta">${escapeHtml(new Date(conf.submittedAt).toLocaleString())}</div>` : ''}</td>
        <td data-label="Actions">
          <div class="eod-ts-row-actions">
            <button type="button" class="btn btn-primary eod-ts-confirm" data-idx="${idx}">Confirm</button>
            <button type="button" class="btn btn-secondary eod-ts-save" data-idx="${idx}">Save</button>
            ${isIw ? `<button type="button" class="btn btn-secondary eod-ts-noshow" data-idx="${idx}">No show</button>` : ''}
            <button type="button" class="btn btn-secondary eod-ts-tablet" data-idx="${idx}">Sign on tablet</button>
            <button type="button" class="btn btn-primary eod-ts-send" data-idx="${idx}">Text / email link</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    const realNameTh = state.sheetKey === 'instawork' ? '<th>Real name</th>' : '';
    const addForm = state.sheetKey === 'instawork' ? `
      <form class="eod-ts-add" id="eodTsAddPerson" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;align-items:center;">
        <input type="text" id="eodTsAddName" placeholder="Name" aria-label="Name" autocomplete="name" style="padding:8px;font:inherit;">
        <input type="tel" id="eodTsAddPhone" placeholder="Phone" aria-label="Phone" inputmode="tel" autocomplete="tel" style="padding:8px;font:inherit;">
        <button type="submit" class="btn btn-secondary">Add</button>
      </form>` : '';
    const unknownCard = unknownPhoneCard();
    const textCard = textMissCard();
    body.innerHTML = `
      ${textCard}
      ${unknownCard}
      ${addForm}
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
              <th>Total</th>
              <th>Signature</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    if (!body.dataset.draftWired) {
      body.dataset.draftWired = '1';
      const keepDraft = (e) => {
        const input = e.target.closest?.('input[data-field]');
        const tr = input?.closest('tr[data-key]');
        if (!input || !tr) return;
        const k = draftKey(tr.dataset.key);
        state.drafts[k] = { ...(state.drafts[k] || {}), [input.dataset.field]: input.value };
        const m = state.members[Number(tr.dataset.idx)];
        const totalEl = tr.querySelector('[data-total]');
        if (m && totalEl) totalEl.textContent = totalFor(m) || '—';
      };
      body.addEventListener('input', keepDraft);
      body.addEventListener('change', keepDraft);
    }

    body.querySelectorAll('.eod-ts-save').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(Number(btn.dataset.idx)).catch(showErr));
    });
    body.querySelectorAll('.eod-ts-noshow').forEach((btn) => {
      btn.addEventListener('click', () => markNoShow(Number(btn.dataset.idx)).catch(showErr));
    });
    body.querySelectorAll('.eod-ts-confirm').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(Number(btn.dataset.idx), { confirm: true }).catch(showErr));
    });
    body.querySelectorAll('.eod-ts-send').forEach((btn) => {
      btn.addEventListener('click', () => sendLink(Number(btn.dataset.idx)));
    });
    body.querySelectorAll('.eod-ts-regen').forEach((btn) => {
      btn.addEventListener('click', () => regenPin(Number(btn.dataset.idx)).catch(showErr));
    });
    const addFormEl = document.getElementById('eodTsAddPerson');
    if (addFormEl && !addFormEl.dataset.wired) {
      addFormEl.dataset.wired = '1';
      addFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        addInstaworkPerson().catch(showErr);
      });
    }
    body.querySelectorAll('select[data-unknown-id]').forEach((sel) => {
      sel.onchange = () => {
        const employeeKey = sel.value;
        if (!employeeKey) return;
        assignUnknown(sel.getAttribute('data-unknown-id'), employeeKey).catch(showErr);
      };
    });
    body.querySelectorAll('select[data-text-miss-id]').forEach((sel) => {
      sel.onchange = () => {
        const employeeKey = sel.value;
        if (!employeeKey) return;
        sel.disabled = true;
        resolveTextMiss('assign', sel.getAttribute('data-text-miss-id'), employeeKey)
          .catch((err) => { sel.disabled = false; showErr(err); });
      };
    });
    body.querySelectorAll('.eod-ts-text-miss-dismiss').forEach((btn) => {
      btn.onclick = () => {
        btn.disabled = true;
        resolveTextMiss('dismiss', btn.getAttribute('data-text-miss-id'))
          .catch((err) => { btn.disabled = false; showErr(err); });
      };
    });
    body.querySelectorAll('.eod-ts-copy-pin').forEach((btn) => {
      btn.addEventListener('click', () => copyPin(Number(btn.dataset.idx)));
    });
    body.querySelectorAll('.eod-ts-tablet').forEach((btn) => {
      btn.addEventListener('click', () => openTabletSign(Number(btn.dataset.idx)).catch(showErr));
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
      const iwHint = state.instaworkError ? ` · Instawork: ${state.instaworkError}` : '';
      status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${state.members.length} people · ${conf} signed · ${adj} adjusted${joinHint}${iwHint}`;
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

  async function saveRow(idx, opts = {}) {
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
        noShow: false,
        confirmationStatus: opts.confirm ? 'confirmed' : undefined,
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
    delete state.drafts[draftKey(row.employeeKey)];
    syncInstaworkTrigger();
    if (opts.confirm) {
      state.members[idx].confirmation = {
        ...(state.members[idx].confirmation || {}),
        status: 'confirmed',
        confirmedBy: data.row?.confirmed_by || null,
      };
      render();
      return;
    }
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
      showAlert('Saved', `${displayName(row) || row.name} times updated.${prodSaveNote(data.row?.prodSync)}${instaworkSaveNote(data.row?.instaworkSync)}`);
    }
  }

  function prodSaveNote(sync) {
    if (!sync || sync.skipped || sync.ok !== false) return '';
    const failed = (sync.shifts || []).filter((s) => !s.ok).map((s) => `${s.label}: ${s.error || 'not saved'}`);
    return ` PROD not updated: ${sync.error || failed.join('; ') || 'unknown error'}.`;
  }

  function instaworkSaveNote(sync) {
    if (!sync || sync.skipped) return '';
    if (sync.ok === false) return ` Instawork not updated: ${sync.error || 'unknown error'}`;
    if (sync.unchanged) return '';
    return ` Instawork set to ${sync.clockIn}–${sync.clockOut}.`;
  }

  async function markNoShow(idx) {
    const row = readRowInputs(idx);
    if (!row) return;
    const name = row.realName || '';
    if (!name) {
      showErr(new Error('Enter their name before marking a no-show.'));
      return;
    }
    const resp = await authFetch(`${API}/row`, {
      method: 'PATCH',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: state.sheetKey,
        storeNumber: storeNumber(),
        workDate: workDate(),
        employeeKey: row.employeeKey,
        employeeName: row.name,
        realName: name,
        workdayId: row.workdayId,
        employeeId: row.employeeId,
        shiftId: row.shiftId,
        visitId: row.visitId,
        clockIn: '',
        lunchOut: '',
        lunchIn: '',
        clockOut: '',
        timeSource: 'lead',
        noShow: true,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (!resp.ok || !data.ok) throw new Error(data.error || `Save failed (${resp.status})`);
    await load();
  }

  async function addInstaworkPerson() {
    const name = document.getElementById('eodTsAddName')?.value?.trim();
    const phone = document.getElementById('eodTsAddPhone')?.value?.trim();
    const resp = await authFetch(`${API}/instawork-person`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        name,
        phone,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (!resp.ok || !data.ok) throw new Error(data.error || `Add failed (${resp.status})`);
    const nameEl = document.getElementById('eodTsAddName');
    const phoneEl = document.getElementById('eodTsAddPhone');
    if (nameEl) nameEl.value = '';
    if (phoneEl) phoneEl.value = '';
    await load();
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

  async function paintJoinQr(img) {
    if (!img) return;
    const sheet = 'any';
    const url = `${API}/join-qr.png?store=${encodeURIComponent(storeNumber())}&date=${encodeURIComponent(workDate())}&sheet=${encodeURIComponent(sheet)}`;
    const resp = await authFetch(url);
    if (!resp.ok) throw new Error('Could not load the sign-in QR');
    const blob = await resp.blob();
    const obj = URL.createObjectURL(blob);
    if (img.dataset.objUrl) URL.revokeObjectURL(img.dataset.objUrl);
    img.dataset.objUrl = obj;
    img.src = obj;
  }

  async function refreshJoinToken(refresh) {
    const resp = await authFetch(`${API}/join-token`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        sheetKey: 'any',
        refresh: !!refresh,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Could not mint JOIN QR');
    state.join = data;
    return data;
  }

  async function showJoinQr() {
    ensureOverlay();
    try {
      if (!state.join?.joinUrl) await refreshJoinToken(false);
      const join = state.join;
      if (!join?.joinUrl) throw new Error('JOIN URL missing');
      document.getElementById('eodTsQrStore').textContent = join.storeNumber || storeNumber();
      document.getElementById('eodTsQrDate').textContent = join.workDate || workDate();
      document.getElementById('eodTsQrUrl').textContent = join.joinUrl;
      const img = document.getElementById('eodTsQrImg');
      await paintJoinQr(img);
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
          ? `TEST fax queued to ${data.testFaxLabel || 'test fax'} (requested #${storeNumber()}, not the store machine).`
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
    if (!data.testMode) applyOfficeSubmitted(true);
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
      state.instaworkError = data.instaworkError || '';
      state.handoffs = Array.isArray(data.handoffs) ? data.handoffs : [];
      state.join = data.join || state.join;
      state.unknownPhones = Array.isArray(data.unknownPhones) ? data.unknownPhones : [];
      state.textMisses = Array.isArray(data.textMisses) ? data.textMisses : [];
      if (state.sheetKey === 'instawork') applyOfficeSubmitted(!!data.officeSubmitted);
      render();
      syncInstaworkTrigger();
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
    state.pollTimer = setInterval(() => {
      if (!isEditing()) refresh(false);
    }, POLL_MS);
  }

  async function signInLieu(sheetKey, undo) {
    const key = sheetKey === 'instawork' ? 'instawork' : 'kompass';
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) {
      showErr(new Error('Set store and work date first.'));
      return null;
    }
    const resp = await authFetch(`${API}/sign-in-lieu`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: key,
        storeNumber: store,
        workDate: date,
        leadName: leadName(),
        undo: !!undo,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Could not sign in lieu');
    if (document.getElementById('eodTsMgmtOverlay')?.classList.contains('show') && state.sheetKey === key) {
      await refresh(true);
    }
    const who = data.count
      ? `${data.stamp} on ${data.count} ${data.count === 1 ? 'person' : 'people'}.`
      : (undo ? 'Nothing to undo.' : 'Everyone on this sheet already signed.');
    if (typeof showAlert === 'function') showAlert(undo ? 'Undo' : 'Sign in lieu of', who);
    return data;
  }

  async function distribute(sheetKey) {
    const key = sheetKey === 'instawork' ? 'instawork' : 'kompass';
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) {
      showErr(new Error('Set store and work date first.'));
      return null;
    }
    const status = document.getElementById('eodTsStatus');
    if (status && state.sheetKey === key) status.textContent = 'Distributing time…';
    const resp = await authFetch(`${API}/distribute-time`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        sheetKey: key,
        storeNumber: store,
        workDate: date,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 412) {
      if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
      throw new Error('Confirm today\'s store first');
    }
    if (!resp.ok || data.ok === false) throw new Error(data.error || `Distribute failed (${resp.status})`);
    const summary = data.summary || 'Done.';
    if (status && state.sheetKey === key) {
      status.style.whiteSpace = 'pre-wrap';
      status.textContent = summary;
    }
    if (typeof showAlert === 'function') showAlert('Distribute time', summary);
    const overlay = document.getElementById('eodTsMgmtOverlay');
    if (overlay?.classList.contains('show') && state.sheetKey === key) {
      try { await refresh(true); } catch (_) { /* the distribute result still stands */ }
      if (status) {
        status.style.whiteSpace = 'pre-wrap';
        status.textContent = summary;
      }
    }
    return data;
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
    try { window.EodCrew?.paintInstawork?.(); } catch (_) {}
  }

  window.EodTimesheetMgmt = {
    open,
    close,
    openInstawork: () => open('instawork'),
    openKompass: () => open('kompass'),
    refresh: () => refresh(true),
    showJoinQr,
    distribute,
    signInLieu,
    fetchInstaworkMembers,
  };
})();
