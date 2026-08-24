/* Department PIC digital signature pads for EOD.
 * Lead picks a role → hand device → name/email (remembered) → fresh signature each time → auto-CC.
 */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/dept-signatures';

  const ROLE_FALLBACK = [
    { key: 'grocery', label: 'Grocery PIC' },
    { key: 'fuel_center', label: 'Fuel Center PIC' },
    { key: 'deli', label: 'Deli Dept. PIC' },
    { key: 'meat', label: 'Meat Dept. PIC' },
    { key: 'produce', label: 'Produce Dept. PIC' },
    { key: 'bakery', label: 'Bakery Dept. PIC' },
    { key: 'home_manager', label: 'Home Manager' },
    { key: 'dept_pic', label: 'Dept. PIC' },
  ];

  let roles = ROLE_FALLBACK.slice();
  let contacts = [];
  let signatures = [];
  let wizard = null; // { roleKey, step, contactId, fullName, email }
  /** When set, only these role keys are shown (day-scoped from the digital sheet). */
  let scopedRoleKeys = null; // string[] | null
  let catalogRoles = ROLE_FALLBACK.slice();
  let lastSheetRef = null;

  /** Patterns to map sheet rows → PIC roles (grocery is NOT "all rows"). */
  const ROW_ROLE_PATTERNS = {
    grocery: [/grocery/i],
    produce: [/produce/i],
    meat: [/meat/i],
    bakery: [/bakery/i],
    deli: [/deli/i],
    fuel_center: [/fuel/i],
    home_manager: [/home|general merch|\bgm\b/i],
    dept_pic: [/blitz|dept\.?\s*pic/i],
  };
  const ROLE_ORDER = ROLE_FALLBACK.map((r) => r.key);

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

  function notify(title, msg) {
    if (typeof showAlert === 'function') showAlert(title, msg);
    else alert(msg || title);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roleLabel(key) {
    return (roles.find((r) => r.key === key) || {}).label || key;
  }

  const ROLE_LABEL_BY_KEY = Object.fromEntries(ROLE_FALLBACK.map((r) => [r.key, r.label]));

  function haystack(row) {
    return [
      row?.dept,
      row?.catName,
      row?.cat_name,
      row?.pog,
      row?.pageBucket,
      row?.page_bucket,
      row?.shiftType,
      row?.shift_type,
    ].filter(Boolean).join(' ');
  }

  function rowHasWorkMark(row) {
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active) && m.active.length) return true;
    if (m.type) return true;
    if (m.complete || m.notInStore || m.notInSi) return true;
    return false;
  }

  function roleKeysMatchingRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const found = new Set();
    for (const row of list) {
      const text = haystack(row);
      const st = String(row?.shiftType || row?.shift_type || '');
      for (const key of ROLE_ORDER) {
        const patterns = ROW_ROLE_PATTERNS[key];
        if (!patterns) continue;
        if (patterns.some((re) => re.test(text))) found.add(key);
        else if (key === 'dept_pic' && /blitz/i.test(st)) found.add(key);
      }
    }
    return ROLE_ORDER.filter((k) => found.has(k));
  }

  function labelForKey(key) {
    const fromCatalog = (catalogRoles || []).find((r) => r.key === key);
    return fromCatalog?.label || ROLE_LABEL_BY_KEY[key] || key;
  }

  function applyScopedKeys(keys, { allowEmpty = false } = {}) {
    const seen = new Set();
    const normalized = (Array.isArray(keys) ? keys : [])
      .map((k) => String(k || '').trim().toLowerCase())
      .filter((k) => {
        if (!k || seen.has(k)) return false;
        if (!ROLE_LABEL_BY_KEY[k] && !(catalogRoles || []).some((r) => r.key === k)) return false;
        seen.add(k);
        return true;
      });
    scopedRoleKeys = normalized;
    if (!normalized.length) {
      roles = allowEmpty ? [] : [];
    } else {
      roles = normalized.map((k) => ({ key: k, label: labelForKey(k) }));
    }
    renderRoleList();
  }

  function applyRequiredRoleKeys(keys) {
    // Legacy API: ingest requiredRoles for the store/week.
    // Prefer syncFromSheet when a live sheet is available (day marks).
    if (!Array.isArray(keys) || !keys.length) {
      if (!lastSheetRef) {
        scopedRoleKeys = null;
        roles = (catalogRoles.length ? catalogRoles : ROLE_FALLBACK).slice();
        renderRoleList();
      }
      return;
    }
    applyScopedKeys(keys, { allowEmpty: true });
  }

  /**
   * Scope PIC signature slots to departments worked today on the digital sheet.
   * Only roles implied by marked rows (Complete / NIS / NISI) are listed —
   * e.g. Produce + Grocery marked → those two PICs only. Already-collected
   * signatures stay visible.
   */
  function syncFromSheet(sheet) {
    lastSheetRef = sheet || null;
    if (!sheet || !Array.isArray(sheet.rows)) {
      // No hosted sheet: don't dump the full catalog in the field app.
      scopedRoleKeys = [];
      roles = [];
      renderRoleList();
      return roles;
    }

    const markedRows = sheet.rows.filter(rowHasWorkMark);
    const keySet = new Set(roleKeysMatchingRows(markedRows));
    for (const sig of signatures) {
      const k = String(sig.roleKey || '').toLowerCase();
      if (k && ROLE_LABEL_BY_KEY[k]) keySet.add(k);
    }
    const keys = ROLE_ORDER.filter((k) => keySet.has(k));
    applyScopedKeys(keys, { allowEmpty: true });
    return roles;
  }

  function ensureUi() {
    if (document.getElementById('deptSigSection')) return;
    const host = document.getElementById('deptSigMount')
      || document.getElementById('eodSignoffGroupBody');
    const sigSection = document.querySelector('.signature-section');
    if (!host && (!sigSection || !sigSection.parentNode)) return;

    const section = document.createElement('div');
    section.className = 'section dept-sig-section';
    section.id = 'deptSigSection';
    section.innerHTML = `
      <div class="dept-sig-header">
        <div class="section-title">Department Signatures</div>
        <span class="dept-sig-progress" id="deptSigPickerMeta">0/0</span>
      </div>
      <p class="sets-help muted dept-sig-help" id="deptSigHelp">
        Only departments worked on today’s sheet appear here. Hand the device to
        that PIC — name/email are remembered for this store.
      </p>
      <div id="deptSigRoleList" class="dept-sig-role-list"></div>
      <div class="dept-sig-actions">
        <button type="button" class="btn btn-primary dept-sig-collect-btn" id="deptSigPickerBtn">
          Collect a department signature
        </button>
        <button type="button" class="btn btn-secondary" id="deptSigRefreshBtn">Refresh</button>
      </div>
    `;
    if (host) host.appendChild(section);
    else sigSection.parentNode.insertBefore(section, sigSection);

    if (!document.getElementById('deptSigWizardOverlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'deptSigWizardOverlay';
      overlay.className = 'dept-sig-wizard-overlay';
      overlay.innerHTML = `
        <div class="dept-sig-wizard-dialog" role="dialog" aria-modal="true">
          <div class="dept-sig-wizard-header">
            <h2 id="deptSigWizardTitle">Department signature</h2>
            <button type="button" class="btn btn-secondary" id="deptSigWizardCancel">Cancel</button>
          </div>
          <p id="deptSigWizardHint" class="sets-help muted"></p>
          <div id="deptSigWizardBody"></div>
          <div class="button-group dept-sig-wizard-actions">
            <button type="button" class="btn btn-secondary" id="deptSigWizardBack" style="display:none;">Back</button>
            <button type="button" class="btn btn-primary" id="deptSigWizardNext">Continue</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeWizard();
      });
      document.getElementById('deptSigWizardCancel').onclick = closeWizard;
      document.getElementById('deptSigWizardBack').onclick = wizardBack;
      document.getElementById('deptSigWizardNext').onclick = wizardNext;
    }

    document.getElementById('deptSigRefreshBtn').onclick = () => refresh().catch(console.error);
  }

  function renderRoleList() {
    const host = document.getElementById('deptSigRoleList');
    if (!host) return;
    const help = document.getElementById('deptSigHelp');
    const byRole = new Map(signatures.map((s) => [s.roleKey, s]));
    if (!roles.length) {
      host.innerHTML = `<p class="muted" style="margin:0;">
        No department signature slots yet.
        ${lastSheetRef
          ? 'Mark Produce, Grocery, etc. on the digital sheet — matching PIC roles show up here.'
          : 'Confirm a store with a digital sheet, or collect after sets are marked.'}
      </p>`;
      if (help) {
        help.textContent = lastSheetRef
          ? 'Signature slots follow departments you mark on today’s sheet (e.g. Produce + Grocery only → those two PICs).'
          : 'Department signatures follow the digital sheet for this store/day.';
      }
      const meta = document.getElementById('deptSigPickerMeta');
      if (meta) meta.textContent = '0/0';
      const pickerBtn = document.getElementById('deptSigPickerBtn');
      if (pickerBtn) pickerBtn.disabled = true;
      return;
    }
    if (help) {
      help.textContent = 'Only departments worked on today’s sheet appear here. Hand the device to that PIC — name/email are remembered for this store.';
    }
    host.innerHTML = roles.map((role) => {
      const sig = byRole.get(role.key);
      const collected = !!sig;
      return `
        <div class="dept-sig-role-row ${collected ? 'collected' : ''}">
          <div>
            <div><strong>${escapeHtml(role.label)}</strong></div>
            <div class="dept-sig-role-meta">
              ${collected
                ? `Signed by ${escapeHtml(sig.signerName)} · ${escapeHtml(sig.signerEmail)}`
                : 'Not collected yet'}
            </div>
          </div>
          <div class="dept-sig-role-actions">
            <button type="button" class="btn btn-primary" data-dept-sig-collect="${escapeHtml(role.key)}">
              ${collected ? 'Re-collect' : 'Hand to signer'}
            </button>
            <button type="button" class="btn btn-secondary" data-dept-sig-send="${escapeHtml(role.key)}" title="Text or email a secure link">
              Send text
            </button>
            ${collected ? `<button type="button" class="btn btn-secondary" data-dept-sig-clear="${escapeHtml(role.key)}">Clear</button>` : ''}
          </div>
        </div>`;
    }).join('');

    host.querySelectorAll('[data-dept-sig-collect]').forEach((btn) => {
      btn.onclick = () => openWizard(btn.getAttribute('data-dept-sig-collect'));
    });
    host.querySelectorAll('[data-dept-sig-send]').forEach((btn) => {
      btn.onclick = () => {
        const roleKey = btn.getAttribute('data-dept-sig-send');
        const sig = byRole.get(roleKey);
        const contact = sig
          ? { fullName: sig.signerName, email: sig.signerEmail }
          : contacts.find((c) => false);
        if (window.EodGuestHandoff?.sendDeptHandoff) {
          window.EodGuestHandoff.sendDeptHandoff(roleKey, roleLabel(roleKey), sig ? { fullName: sig.signerName, email: sig.signerEmail } : null);
        } else if (typeof showAlert === 'function') {
          showAlert('Not loaded', 'Guest handoff module is not available.');
        }
      };
    });
    host.querySelectorAll('[data-dept-sig-clear]').forEach((btn) => {
      btn.onclick = () => clearRole(btn.getAttribute('data-dept-sig-clear'));
    });

    const meta = document.getElementById('deptSigPickerMeta');
    const collectedN = roles.filter((r) => byRole.has(r.key)).length;
    if (meta) {
      meta.textContent = `${collectedN}/${roles.length}`;
      meta.classList.toggle('is-complete', collectedN > 0 && collectedN === roles.length);
      meta.classList.toggle('is-partial', collectedN > 0 && collectedN < roles.length);
    }
    const pickerBtn = document.getElementById('deptSigPickerBtn');
    if (pickerBtn) {
      pickerBtn.disabled = false;
      pickerBtn.textContent = collectedN === roles.length
        ? 'Re-collect a department signature'
        : 'Collect a department signature';
      if (pickerBtn.dataset.bound !== '1') {
        pickerBtn.dataset.bound = '1';
        pickerBtn.addEventListener('click', () => {
          const latest = new Map(signatures.map((s) => [s.roleKey, s]));
          const items = roles.map((role) => {
            const sig = latest.get(role.key);
            return {
              id: role.key,
              label: role.label,
              sublabel: sig ? `Signed by ${sig.signerName}` : 'Not collected yet',
              selected: !!sig,
            };
          });
          const open = window.EodPicker?.open || window.EodWorkspace?.openPicker;
          if (!open) return;
          open({
            anchor: pickerBtn,
            title: 'Department signatures',
            items,
            searchable: items.length > 6,
            onChoose(item) { openWizard(item.id); },
          });
        });
      }
    }
  }

  async function refresh() {
    ensureUi();
    const store = storeNumber();
    const date = workDate();
    if (!store) {
      renderRoleList();
      return;
    }
    try {
      const rolesResp = await authFetch(`${API}/roles`);
      if (rolesResp.ok) {
        const data = await rolesResp.json();
        if (Array.isArray(data.roles) && data.roles.length) {
          catalogRoles = data.roles;
        }
      }
    } catch (_) { /* keep fallback catalog */ }

    try {
      const cResp = await authFetch(`${API}/${encodeURIComponent(store)}/contacts`);
      if (cResp.ok) {
        const data = await cResp.json();
        contacts = Array.isArray(data.contacts) ? data.contacts : [];
      }
    } catch (_) { contacts = []; }

    if (date) {
      try {
        const sResp = await authFetch(
          `${API}/${encodeURIComponent(store)}/signatures?date=${encodeURIComponent(date)}`
        );
        if (sResp.ok) {
          const data = await sResp.json();
          signatures = Array.isArray(data.signatures) ? data.signatures : [];
          if (Array.isArray(data.roles) && data.roles.length) {
            catalogRoles = data.roles;
          }
        }
      } catch (_) { signatures = []; }
    } else {
      signatures = [];
    }

    // Never replace the day-scoped list with the full catalog.
    if (lastSheetRef) {
      syncFromSheet(lastSheetRef);
    } else if (scopedRoleKeys) {
      applyScopedKeys(scopedRoleKeys, { allowEmpty: true });
    } else {
      roles = (catalogRoles.length ? catalogRoles : ROLE_FALLBACK).slice();
      renderRoleList();
    }
    syncRecipientsFromSignatures();
  }

  function syncRecipientsFromSignatures() {
    if (!Array.isArray(window.emailRecipients)) return;
    let changed = false;
    for (const sig of signatures) {
      const em = String(sig.signerEmail || '').toLowerCase();
      if (em && !window.emailRecipients.includes(em)) {
        window.emailRecipients.push(em);
        changed = true;
      }
    }
    if (changed && typeof window.renderRecipientList === 'function') {
      window.renderRecipientList();
      if (typeof window.autoSave === 'function') window.autoSave();
    }
  }

  function addRecipientEmail(email) {
    const em = String(email || '').toLowerCase().trim();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return;
    if (!Array.isArray(window.emailRecipients)) window.emailRecipients = [];
    if (!window.emailRecipients.includes(em)) {
      window.emailRecipients.push(em);
      if (typeof window.renderRecipientList === 'function') window.renderRecipientList();
      if (typeof window.autoSave === 'function') window.autoSave();
    }
  }

  function openWizard(roleKey) {
    const store = storeNumber();
    const date = workDate();
    if (!store) {
      notify('Store required', 'Enter a store number first.');
      return;
    }
    if (!date) {
      notify('Date required', 'Select the shift / work date first.');
      return;
    }
    wizard = { roleKey, step: contacts.length ? 'pick' : 'name', contactId: null, fullName: '', email: '', title: '', signatureDataUrl: '' };
    renderWizard();
    document.getElementById('deptSigWizardOverlay')?.classList.add('show');
  }

  function closeWizard() {
    wizard = null;
    document.getElementById('deptSigWizardOverlay')?.classList.remove('show');
  }

  function wizardBack() {
    if (!wizard) return;
    if (wizard.step === 'email') wizard.step = 'name';
    else if (wizard.step === 'title') wizard.step = 'email';
    else if (wizard.step === 'name' && contacts.length) wizard.step = 'pick';
    else if (wizard.step === 'sign') {
      wizard.step = wizard.contactId || wizard.email ? 'confirm' : 'title';
    } else if (wizard.step === 'confirm') {
      wizard.step = contacts.length ? 'pick' : 'name';
    }
    renderWizard();
  }

  async function wizardNext() {
    if (!wizard) return;
    const body = document.getElementById('deptSigWizardBody');
    if (wizard.step === 'pick') {
      // handled by buttons
      return;
    }
    if (wizard.step === 'name') {
      const name = (body.querySelector('#deptSigNameInput')?.value || '').trim();
      if (!name) {
        if (typeof showAlert === 'function') showAlert('Name required', 'Please enter your name.');
        return;
      }
      wizard.fullName = name;
      wizard.step = 'email';
      renderWizard();
      return;
    }
    if (wizard.step === 'email') {
      const email = (body.querySelector('#deptSigEmailInput')?.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (typeof showAlert === 'function') showAlert('Email required', 'Please enter a valid email address.');
        return;
      }
      wizard.email = email;
      wizard.step = 'title';
      renderWizard();
      return;
    }
    if (wizard.step === 'title') {
      wizard.title = (body.querySelector('#deptSigTitleInput')?.value || '').trim();
      wizard.step = 'confirm';
      renderWizard();
      return;
    }
    if (wizard.step === 'confirm') {
      wizard.step = 'sign';
      renderWizard();
      return;
    }
    if (wizard.step === 'sign') {
      await submitSignature();
    }
  }

  function renderWizard() {
    const title = document.getElementById('deptSigWizardTitle');
    const hint = document.getElementById('deptSigWizardHint');
    const body = document.getElementById('deptSigWizardBody');
    const back = document.getElementById('deptSigWizardBack');
    const next = document.getElementById('deptSigWizardNext');
    if (!wizard || !body) return;

    title.textContent = roleLabel(wizard.roleKey);
    back.style.display = wizard.step === 'pick' ? 'none' : 'inline-flex';

    if (wizard.step === 'pick') {
      hint.textContent = 'Select who is signing, or choose Someone new.';
      next.style.display = 'none';
      body.innerHTML = contacts.map((c) => `
        <button type="button" class="dept-sig-choice" data-contact-id="${c.id}">
          <strong>${escapeHtml(c.fullName)}</strong><br>
          <span style="color:#94a3b8;font-size:13px;">${escapeHtml(c.email)}</span>
        </button>`).join('') + `
        <button type="button" class="dept-sig-choice" data-contact-id="new">
          <strong>Someone new</strong><br>
          <span style="color:#94a3b8;font-size:13px;">Enter name and email once — we will remember them for this store.</span>
        </button>`;
      body.querySelectorAll('[data-contact-id]').forEach((btn) => {
        btn.onclick = () => {
          const id = btn.getAttribute('data-contact-id');
          if (id === 'new') {
            wizard.contactId = null;
            wizard.fullName = '';
            wizard.email = '';
            wizard.step = 'name';
          } else {
            const c = contacts.find((x) => String(x.id) === String(id));
            if (!c) return;
            wizard.contactId = c.id;
            wizard.fullName = c.fullName;
            wizard.email = c.email;
            wizard.step = 'confirm';
          }
          renderWizard();
        };
      });
      return;
    }

    next.style.display = 'inline-flex';
    if (wizard.step === 'name') {
      hint.textContent = 'What is your name?';
      next.textContent = 'Continue';
      body.innerHTML = `<div class="field"><label>Full name</label>
        <input type="text" id="deptSigNameInput" value="${escapeHtml(wizard.fullName)}" autocomplete="name" style="width:100%;"></div>`;
      setTimeout(() => document.getElementById('deptSigNameInput')?.focus(), 50);
      return;
    }
    if (wizard.step === 'email') {
      hint.textContent = 'What is your email address? We will remember it for this store and CC you on the EOD.';
      next.textContent = 'Continue';
      body.innerHTML = `<div class="field"><label>Email</label>
        <input type="email" id="deptSigEmailInput" value="${escapeHtml(wizard.email)}" autocomplete="email" style="width:100%;"></div>`;
      setTimeout(() => document.getElementById('deptSigEmailInput')?.focus(), 50);
      return;
    }
    if (wizard.step === 'title') {
      hint.textContent = 'What is your title? (e.g. Bakery Manager, Produce PIC)';
      next.textContent = 'Continue';
      body.innerHTML = `<div class="field"><label>Title</label>
        <input type="text" id="deptSigTitleInput" value="${escapeHtml(wizard.title)}" autocomplete="organization-title" style="width:100%;"></div>`;
      setTimeout(() => document.getElementById('deptSigTitleInput')?.focus(), 50);
      return;
    }
    if (wizard.step === 'confirm') {
      hint.innerHTML = `You will only need to enter your information once because our system remembers who you are at this store.<br><strong>You will still be asked to sign each time.</strong>`;
      next.textContent = 'Continue to signature';
      body.innerHTML = `<p style="margin:0;"><strong>${escapeHtml(wizard.fullName)}</strong>${wizard.title ? ` · ${escapeHtml(wizard.title)}` : ''}<br>${escapeHtml(wizard.email)}</p>`;
      return;
    }
    if (wizard.step === 'sign') {
      hint.textContent = 'Sign';
      next.textContent = 'Save signature';
      body.innerHTML = `
        <div class="sig-preview" id="deptSigPreview">${wizard.signatureDataUrl
          ? `<img src="${wizard.signatureDataUrl}" alt="Signature">`
          : 'No signature yet'}</div>
        <button type="button" class="btn btn-primary btn-block" id="deptSigOpenPad" style="margin-top:8px;">Sign</button>`;
      document.getElementById('deptSigOpenPad').onclick = openDeptSignPad;
    }
  }

  function openDeptSignPad() {
    if (!window.EodLandscapeSigPad?.open) {
      notify('Signature pad', 'Signature pad failed to load. Refresh and try again.');
      return;
    }
    window.EodLandscapeSigPad.open({
      title: 'Sign',
      existingDataUrl: wizard?.signatureDataUrl || '',
      onAccept: (url) => {
        if (!wizard) return;
        wizard.signatureDataUrl = url;
        const preview = document.getElementById('deptSigPreview');
        if (preview) preview.innerHTML = `<img src="${url}" alt="Signature">`;
      },
    });
  }

  async function submitSignature() {
    if (!wizard?.signatureDataUrl) {
      notify('Signature required', 'Please sign before saving.');
      return;
    }
    const dataUrl = wizard.signatureDataUrl;
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) {
      notify(store ? 'Date required' : 'Store required', store
        ? 'Select the shift / work date first.'
        : 'Enter a store number first.');
      return;
    }
    const loading = document.getElementById('loadingOverlay');
    if (loading) loading.classList.add('show');
    try {
      const resp = await authFetch(`${API}/${encodeURIComponent(store)}/signatures`, {
        method: 'POST',
        headers: dayConfirmHeaders(),
        body: JSON.stringify({
          storeNumber: store,
          workDate: date,
          date,
          roleKey: wizard.roleKey,
          fullName: wizard.fullName,
          email: wizard.email,
          signerTitle: wizard.title || undefined,
          signatureDataUrl: dataUrl,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 412) {
        if (typeof showAlert === 'function') {
          showAlert('Confirm store first', 'Please confirm today\'s store before collecting signatures.');
        }
        if (typeof showDayConfirmModal === 'function') showDayConfirmModal();
        return;
      }
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || `Save failed (${resp.status})`);
      }
      addRecipientEmail(wizard.email);
      closeWizard();
      await refresh();
      if (typeof showAlert === 'function') {
        showAlert('Signature saved', `${roleLabel(data.signature.roleKey)} signed by ${data.signature.signerName}. Added to EOD recipients.`);
      }
    } catch (err) {
      console.error(err);
      if (typeof showAlert === 'function') showAlert('Signature save failed', err.message || String(err));
    } finally {
      if (loading) loading.classList.remove('show');
    }
  }

  async function clearRole(roleKey) {
    const store = storeNumber();
    const date = workDate();
    if (!store || !date) return;
    try {
      const resp = await authFetch(
        `${API}/${encodeURIComponent(store)}/signatures/${encodeURIComponent(roleKey)}?date=${encodeURIComponent(date)}`,
        {
          method: 'DELETE',
          headers: dayConfirmHeaders(),
          body: JSON.stringify({ storeNumber: store, workDate: date, date }),
        }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Clear failed (${resp.status})`);
      await refresh();
    } catch (err) {
      if (typeof showAlert === 'function') showAlert('Clear failed', err.message || String(err));
    }
  }

  function getCollectedForEmail() {
    return signatures.map((s) => ({
      roleKey: s.roleKey,
      roleLabel: roleLabel(s.roleKey),
      signerName: s.signerName,
      signerTitle: s.signerTitle,
      signerEmail: s.signerEmail,
      signatureUrl: s.signatureUrl,
      createdAt: s.createdAt,
    }));
  }

  function mountInline(host) {
    if (!host) return;
    ensureUi();
    const section = document.getElementById('deptSigSection');
    if (section) {
      host.innerHTML = '';
      host.appendChild(section);
      section.style.display = 'block';
    } else {
      host.innerHTML = '<p class="muted">Department signatures UI could not mount (missing bridge host).</p>';
    }
    refresh().catch(console.error);
  }

  window.EodDeptSignatures = {
    refresh,
    ensureUi,
    mountInline,
    getCollectedForEmail,
    setRequiredRoles: applyRequiredRoleKeys,
    syncFromSheet,
    roles: () => roles.slice(),
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureUi();
    const storeEl = document.getElementById('storeNumber');
    const dateEl = document.getElementById('workDate') || document.getElementById('shiftDate');
    if (storeEl) storeEl.addEventListener('change', () => refresh().catch(console.error));
    if (dateEl) dateEl.addEventListener('change', () => refresh().catch(console.error));
    setTimeout(() => refresh().catch(console.error), 800);
  });
})();
