/* Send text/email handoff links — dept PIC signatures + Kompass/InstaWork timesheets. */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/guest-handoff';

  function authFetch(url, init) {
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
    return (document.getElementById('storeNumber')?.value || '').trim();
  }

  function workDate() {
    return (document.getElementById('workDate')?.value
      || document.getElementById('shiftDate')?.value
      || document.getElementById('dayConfirmDate')?.value
      || '').trim();
  }

  function fiscalWeek() {
    const sheet = window.EodDigitalSignoff?.getSheet?.();
    return sheet?.fiscalWeek || '';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureModal() {
    if (document.getElementById('guestHandoffModal')) return;
    const el = document.createElement('div');
    el.id = 'guestHandoffModal';
    el.className = 'modal-overlay';
    el.innerHTML = `
      <div class="modal-dialog" style="max-width:480px;">
        <h2 id="guestHandoffTitle" style="color:#93c5fd;">Send secure link</h2>
        <p id="guestHandoffHint" class="sets-help" style="margin:0 0 12px;"></p>
        <div class="field"><label for="ghRecipientName">Recipient name</label>
          <input type="text" id="ghRecipientName" autocomplete="name" style="width:100%;"></div>
        <div class="field"><label for="ghRecipientEmail">Email</label>
          <input type="email" id="ghRecipientEmail" autocomplete="email" style="width:100%;"></div>
        <div class="field"><label for="ghRecipientPhone">Mobile (for text)</label>
          <input type="tel" id="ghRecipientPhone" inputmode="tel" placeholder="10-digit US number" style="width:100%;"></div>
        <div class="toggle-switch" style="margin:10px 0; justify-content:flex-start; background:#1e293b;">
          <label class="toggle-switch-wrapper"><input type="checkbox" id="ghSendEmail" checked><span class="toggle-slider"></span></label>
          <label class="toggle-switch-label" for="ghSendEmail">Send email</label>
        </div>
        <div class="toggle-switch" style="margin:10px 0; justify-content:flex-start; background:#1e293b;">
          <label class="toggle-switch-wrapper"><input type="checkbox" id="ghSendSms"><span class="toggle-slider"></span></label>
          <label class="toggle-switch-label" for="ghSendSms">Send text (secure link)</label>
        </div>
        <p class="sets-help" style="font-size:12px;">Text recipients must text <strong>JOIN</strong> to <strong>(509) 572-9212</strong> once to opt in. Link expires in 7 days.</p>
        <div class="button-group" style="flex-wrap:wrap; gap:8px; margin-top:14px;">
          <button type="button" class="btn btn-secondary" id="guestHandoffCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="guestHandoffSend">Send link</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
    document.getElementById('guestHandoffCancel').onclick = closeModal;
    document.getElementById('guestHandoffSend').onclick = () => sendPending().catch(console.error);
  }

  let pending = null;

  function closeModal() {
    document.getElementById('guestHandoffModal')?.classList.remove('show');
    pending = null;
  }

  function openSendModal(opts) {
    ensureModal();
    pending = opts;
    document.getElementById('guestHandoffTitle').textContent = opts.title || 'Send secure link';
    document.getElementById('guestHandoffHint').textContent = opts.hint || '';
    document.getElementById('ghRecipientName').value = opts.recipientName || '';
    document.getElementById('ghRecipientEmail').value = opts.recipientEmail || '';
    document.getElementById('ghRecipientPhone').value = opts.recipientPhone || '';
    document.getElementById('ghSendEmail').checked = true;
    document.getElementById('ghSendSms').checked = !!opts.recipientPhone;
    document.getElementById('guestHandoffModal').classList.add('show');
  }

  async function sendPending() {
    if (!pending) return;
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) {
      if (typeof showAlert === 'function') showAlert('Store & date required', 'Set store and work date first.');
      return;
    }
    const sendEmail = !!document.getElementById('ghSendEmail')?.checked;
    const sendSms = !!document.getElementById('ghSendSms')?.checked;
    const email = (document.getElementById('ghRecipientEmail')?.value || '').trim().toLowerCase();
    const phone = (document.getElementById('ghRecipientPhone')?.value || '').trim();
    const name = (document.getElementById('ghRecipientName')?.value || '').trim();
    if (!sendEmail && !sendSms) {
      if (typeof showAlert === 'function') showAlert('Choose a channel', 'Enable email and/or text.');
      return;
    }
    if (sendEmail && !email) {
      if (typeof showAlert === 'function') showAlert('Email required', 'Enter an email address.');
      return;
    }
    if (sendSms && !phone) {
      if (typeof showAlert === 'function') showAlert('Phone required', 'Enter a mobile number for text.');
      return;
    }

    const live = typeof window.isEodForceLiveDelivery === 'function'
      && window.isEodForceLiveDelivery();
    if (live) {
      if (typeof window.confirmForceLiveIfNeeded === 'function') {
        const ok = await window.confirmForceLiveIfNeeded('Guest handoff send');
        if (!ok) return;
      } else if (!confirm('LIVE delivery override is ON for guest handoff. Continue?')) {
        return;
      }
    }
    const loading = document.getElementById('loadingOverlay');
    if (loading) loading.classList.add('show');
    try {
      const body = {
        sessionType: pending.sessionType,
        storeNumber: store,
        workDate: date,
        fiscalWeek: fiscalWeek() || undefined,
        roleKey: pending.roleKey,
        roleLabel: pending.roleLabel,
        recipientName: name || undefined,
        recipientEmail: email || undefined,
        recipientPhone: phone || undefined,
        sendEmail,
        sendSms,
        forceLive: live || undefined,
        payload: pending.payload || {},
      };
      const resp = await authFetch(API, {
        method: 'POST',
        headers: dayConfirmHeaders(),
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 412) {
        if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
        throw new Error('Confirm today\'s store first');
      }
      if (!resp.ok || !data.ok) {
        const smsErr = data.delivery?.sms?.find?.((r) => !r.ok)?.error;
        throw new Error(smsErr || data.error || `Send failed (${resp.status})`);
      }
      closeModal();
      const channels = [];
      if (data.delivery?.email?.sent) channels.push('email');
      if (data.delivery?.sms?.some?.((r) => r.ok)) channels.push('text');
      const msg = channels.length
        ? `Secure link sent via ${channels.join(' and ')}.`
        : `Link created: ${data.handoffUrl || 'check delivery settings'}`;
      if (typeof showAlert === 'function') showAlert('Link sent', msg);
    } catch (err) {
      if (typeof showAlert === 'function') showAlert('Send failed', err.message || String(err));
    } finally {
      if (loading) loading.classList.remove('show');
    }
  }

  function sendDeptHandoff(roleKey, roleLabel, contact) {
    openSendModal({
      sessionType: 'dept_signature',
      roleKey,
      roleLabel,
      title: `Text/email — ${roleLabel}`,
      hint: 'Manager opens the link on their phone to review their section\'s sets and sign.',
      recipientName: contact?.fullName || '',
      recipientEmail: contact?.email || '',
      recipientPhone: '',
    });
  }

  async function sendTimesheetHandoff(sheetKey) {
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) {
      if (typeof showAlert === 'function') showAlert('Store & date required', 'Set store and work date first.');
      return;
    }
    const key = sheetKey === 'instawork' ? 'instawork_timesheet' : 'kompass_timesheet';
    const label = sheetKey === 'instawork' ? 'InstaWork' : 'Kompass';
    let employees = [];
    let leadName = '';
    try {
      if (typeof resolveTimesheetLeadName === 'function') leadName = resolveTimesheetLeadName();
      if (typeof collectTimesheetEmployees === 'function') {
        employees = await collectTimesheetEmployees(store, date, sheetKey === 'instawork' ? 'instawork' : 'kompass');
      }
    } catch (_) { /* optional */ }
    openSendModal({
      sessionType: key,
      title: `Send ${label} time sheet link`,
      hint: 'Have them text JOIN to (509) 572-9212 first if needed. They can edit times, give a reason, sign, and your live sheet updates.',
      payload: { employees, leadName, blank: false },
    });
  }

  window.EodGuestHandoff = {
    sendDeptHandoff,
    sendTimesheetHandoff,
    openSendModal,
  };
})();
