/* Department PIC digital signature pads for EOD.
 * Lead picks a role → hand device → name/email (remembered) → fresh signature each time → auto-CC.
 */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/dept-signatures';
  const GUEST_API = 'https://eod-api.the-dump-bin.com/api/guest-handoff';

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
  const GROCERY_EXPAND_KEYS = ['produce', 'meat', 'bakery', 'deli', 'fuel_center', 'dept_pic', 'home_manager'];

  function sheetRows() {
    return lastSheetRef?.rows
      || window.EodDigitalSignoff?.getSheet?.()?.rows
      || window.EodSession?.state?.sheet?.rows
      || [];
  }

  function rowsMatchingRole(rows, roleKey) {
    const list = Array.isArray(rows) ? rows : [];
    const key = String(roleKey || '').trim().toLowerCase();
    if (key === 'store_pic' || key === 'home_manager') return list.slice();
    const patterns = ROW_ROLE_PATTERNS[key];
    if (!patterns) return [];
    return list.filter((row) => {
      const text = haystack(row);
      if (patterns.some((re) => re.test(text))) return true;
      if (key === 'dept_pic' && /blitz/i.test(String(row.shiftType || row.shift_type || ''))) return true;
      return false;
    });
  }

  function extraDeptGroups(allRows, primaryKey) {
    const primaryIds = new Set(rowsMatchingRole(allRows, primaryKey).map((r) => r.id));
    const catalog = (catalogRoles.length ? catalogRoles : ROLE_FALLBACK);
    const groups = [];
    for (const key of GROCERY_EXPAND_KEYS) {
      if (key === primaryKey) continue;
      const role = catalog.find((r) => r.key === key) || { key, label: labelForKey(key) };
      const rows = rowsMatchingRole(allRows, key).filter((r) => !primaryIds.has(r.id));
      if (rows.length) groups.push({ key: role.key, label: role.label, rows });
    }
    return groups;
  }

  function setRowButtonHtml(row) {
    const name = row.catName || row.cat_name || 'Set';
    const dept = row.dept ? ` · ${row.dept}` : '';
    return `<button type="button" class="dept-sig-set-row" data-set-id="${escapeHtml(row.id)}">
      <strong>${escapeHtml(name)}</strong>
      ${dept ? `<span class="muted">${escapeHtml(dept)}</span>` : ''}
    </button>`;
  }

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
      overlay.addEventListener('touchmove', (e) => {
        if (e.target === overlay) e.preventDefault();
      }, { passive: false });
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
          catalogRoles = data.roles.filter((r) => String(r?.key || '').toLowerCase() !== 'lead');
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
            catalogRoles = data.roles.filter((r) => String(r?.key || '').toLowerCase() !== 'lead');
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
      if (String(sig.roleKey || '').toLowerCase() === 'lead') continue;
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
    try { window.EodLandscapeSigPad?.forceClose?.(); } catch (_) {}
  }

  function wizardBack() {
    if (!wizard) return;
    if (wizard.step === 'email') wizard.step = 'name';
    else if (wizard.step === 'title') wizard.step = 'email';
    else if (wizard.step === 'name' && contacts.length) wizard.step = 'pick';
    else if (wizard.step === 'setReview') wizard.step = 'sets';
    else if (wizard.step === 'sets') wizard.step = 'choice';
    else if (wizard.step === 'sign') wizard.step = 'choice';
    else if (wizard.step === 'choice') {
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
      wizard.step = 'choice';
      renderWizard();
      return;
    }
    if (wizard.step === 'sets') {
      wizard.step = 'sign';
      renderWizard();
      return;
    }
    if (wizard.step === 'sign') {
      await submitSignature();
    }
  }

  async function mintPicToken() {
    if (wizard.picToken) return wizard.picToken;
    const resp = await authFetch(`${GUEST_API}/store-pic`, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        leadName: window.EodSession?.state?.leadName || null,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false || !data.token) {
      throw new Error(data.error || `Could not load set photos (${resp.status})`);
    }
    wizard.picToken = data.token;
    return wizard.picToken;
  }

  async function enterSetsStep() {
    wizard.step = 'sets';
    wizard.setsError = '';
    renderWizard();
    try {
      await mintPicToken();
      if (window.EodSetReview?.preloadRole) {
        window.EodSetReview.preloadRole({
          api: GUEST_API,
          token: wizard.picToken,
          roleKey: wizard.roleKey,
        });
      }
    } catch (err) {
      wizard.setsError = err.message || 'Set photos could not be preloaded.';
    }
    renderWizard();
  }

  function bindSetRowClicks(root) {
    root.querySelectorAll('[data-set-id]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-set-id');
        const row = sheetRows().find((r) => String(r.id) === String(id));
        if (!row) return;
        wizard.reviewRow = row;
        wizard.step = 'setReview';
        renderWizard();
      };
    });
  }

  function renderSetsStep(hint, body, next) {
    const all = sheetRows();
    const mine = rowsMatchingRole(all, wizard.roleKey);
    const extras = wizard.roleKey === 'grocery' ? extraDeptGroups(all, wizard.roleKey) : [];
    hint.textContent = wizard.roleKey === 'grocery'
      ? 'Your grocery sets are listed first. Open another department only if you are signing those out too.'
      : 'Tap a set to view before and after photos.';
    next.style.display = 'inline-flex';
    next.textContent = 'Continue to signature';
    const extraHtml = extras.map((g) => `
      <details class="gh-dept-extra" data-extra-role="${escapeHtml(g.key)}">
        <summary>${escapeHtml(g.label)} (${g.rows.length})</summary>
        <div class="dept-sig-set-list">${g.rows.map(setRowButtonHtml).join('')}</div>
      </details>`).join('');
    body.innerHTML = `
      ${wizard.setsError ? `<p class="muted">${escapeHtml(wizard.setsError)}</p>` : ''}
      <div class="dept-sig-set-list">
        ${mine.length ? mine.map(setRowButtonHtml).join('') : '<p class="muted">No sets matched this department on today’s sheet.</p>'}
      </div>
      ${extraHtml}`;
    bindSetRowClicks(body);
    body.querySelectorAll('details[data-extra-role]').forEach((el) => {
      el.addEventListener('toggle', () => {
        if (!el.open || !wizard.picToken || !window.EodSetReview?.preloadRole) return;
        window.EodSetReview.preloadRole({
          api: GUEST_API,
          token: wizard.picToken,
          roleKey: el.getAttribute('data-extra-role'),
        });
      });
    });
  }

  function renderSetReviewStep(hint, body, back, next) {
    hint.textContent = '';
    next.style.display = 'none';
    back.style.display = 'inline-flex';
    const row = wizard.reviewRow;
    if (!row) {
      body.innerHTML = '<p class="muted">Set not found.</p>';
      return;
    }
    body.innerHTML = '<div id="deptSigReviewRoot"></div>';
    if (!window.EodSetReview?.createReview) {
      body.innerHTML = '<p class="muted">Photo review is not available on this device.</p>';
      return;
    }
    if (!wizard.picToken) {
      body.innerHTML = '<p class="muted">Set photos need a store PIC session. Go back and try View sets again.</p>';
      return;
    }
    window.EodSetReview.createReview({
      root: document.getElementById('deptSigReviewRoot'),
      api: GUEST_API,
      token: wizard.picToken,
      row,
      skipRemoteMark: false,
      onBack: () => {
        wizard.step = 'sets';
        renderWizard();
      },
      onMarked: () => {},
      onConfirmComplete: () => {
        wizard.step = 'sets';
        renderWizard();
      },
    });
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
      next.textContent = 'Continue';
      body.innerHTML = `<p style="margin:0;"><strong>${escapeHtml(wizard.fullName)}</strong>${wizard.title ? ` · ${escapeHtml(wizard.title)}` : ''}<br>${escapeHtml(wizard.email)}</p>`;
      return;
    }
    if (wizard.step === 'choice') {
      hint.textContent = 'Review today’s sets, or skip straight to your signature.';
      next.style.display = 'none';
      body.innerHTML = `
        <button type="button" class="dept-sig-choice" id="deptSigViewSets">
          <strong>View sets</strong><br>
          <span style="color:#94a3b8;font-size:13px;">Before and after photos for this department</span>
        </button>
        <button type="button" class="dept-sig-choice" id="deptSigJustSign">
          <strong>Just sign</strong><br>
          <span style="color:#94a3b8;font-size:13px;">Skip photo review</span>
        </button>`;
      document.getElementById('deptSigViewSets').onclick = () => enterSetsStep();
      document.getElementById('deptSigJustSign').onclick = () => {
        wizard.step = 'sign';
        renderWizard();
      };
      return;
    }
    if (wizard.step === 'sets') {
      renderSetsStep(hint, body, next);
      return;
    }
    if (wizard.step === 'setReview') {
      renderSetReviewStep(hint, body, back, next);
      return;
    }
    if (wizard.step === 'sign') {
      hint.textContent = '';
      next.textContent = 'Save signature';
      body.innerHTML = `
        <div class="dept-sig-pad-wrap">
          <canvas id="deptSigCanvas"></canvas>
        </div>
        <button type="button" class="btn btn-secondary btn-block" id="deptSigClearPad" style="margin-top:8px;">Clear</button>`;
      const pad = bindInlinePad(document.getElementById('deptSigCanvas'), {
        existingDataUrl: wizard.signatureDataUrl || '',
        onChange: (url) => { if (wizard) wizard.signatureDataUrl = url; },
      });
      document.getElementById('deptSigClearPad').onclick = () => {
        pad.clear();
        if (wizard) wizard.signatureDataUrl = '';
      };
    }
  }

  function bindInlinePad(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let last = { x: 0, y: 0 };
    let pointerId = null;

    function size() {
      const wrap = canvas.parentElement;
      const w = Math.max(240, Math.floor(wrap?.clientWidth || canvas.clientWidth || 280));
      const h = Math.max(160, Math.floor(canvas.clientHeight || 200));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (o.existingDataUrl) {
        const img = new Image();
        img.onload = () => {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        };
        img.src = o.existingDataUrl;
      }
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const src = e.touches?.[0] || e.changedTouches?.[0] || e;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return {
        x: (src.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1)) / dpr,
        y: (src.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1)) / dpr,
      };
    }
    function start(e) {
      drawing = true;
      if (e.pointerId != null && canvas.setPointerCapture) {
        pointerId = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      last = pos(e);
      e.preventDefault();
      e.stopPropagation();
    }
    function move(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }
    function stop(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        if (pointerId != null && canvas.releasePointerCapture) {
          try { canvas.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
        }
      }
      if (drawing && typeof o.onChange === 'function') o.onChange(canvas.toDataURL('image/png'));
      drawing = false;
      pointerId = null;
    }

    const ptr = { passive: false, capture: true };
    canvas.addEventListener('pointerdown', start, ptr);
    canvas.addEventListener('pointermove', move, ptr);
    canvas.addEventListener('pointerup', stop, ptr);
    canvas.addEventListener('pointercancel', stop, ptr);
    canvas.addEventListener('touchstart', start, ptr);
    canvas.addEventListener('touchmove', move, ptr);
    canvas.addEventListener('touchend', stop, ptr);
    requestAnimationFrame(size);
    return {
      clear() {
        o.existingDataUrl = '';
        size();
      },
    };
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
    return signatures
      .filter((s) => String(s.roleKey || '').toLowerCase() !== 'lead')
      .map((s) => ({
        roleKey: s.roleKey,
        roleLabel: roleLabel(s.roleKey),
        signerName: s.signerName,
        signerTitle: s.signerTitle,
        signerEmail: s.signerEmail,
        signatureUrl: s.signatureUrl,
        createdAt: s.createdAt,
      }));
  }

  function leadContactEmail() {
    const S = window.EodSession;
    const fromState = String(S?.state?.leadEmail || S?.state?.profileEmail || '').trim();
    if (fromState) return fromState;
    try {
      const u = window.dumpBinAuth?.user || window.DumpBinAuth?.user;
      if (u?.email) return String(u.email).trim();
    } catch (_) { /* ignore */ }
    return '';
  }

  async function persistLeadSignature() {
    const S = window.EodSession;
    const url = String(S?.state?.signatureDataUrl || '');
    if (!/^data:image\//i.test(url)) return false;
    const store = storeNumber();
    const date = workDate();
    const name = S.resolvedLeadName?.() || S.state.leadName || S.state.profileName;
    const email = leadContactEmail();
    if (!store || !date || !name || !email) return false;
    try {
      const resp = await authFetch(`${API}/${encodeURIComponent(store)}/signatures`, {
        method: 'POST',
        headers: dayConfirmHeaders(),
        body: JSON.stringify({
          storeNumber: store,
          workDate: date,
          date,
          roleKey: 'lead',
          fullName: name,
          email,
          signerTitle: 'KOMPASS Lead',
          signatureDataUrl: url,
        }),
      });
      return resp.ok;
    } catch (_) {
      return false;
    }
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
    persistLeadSignature,
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
    window.EodSession?.on?.((_state, reason) => {
      if (reason === 'signature') persistLeadSignature().catch(() => {});
    });
    setTimeout(() => {
      refresh().catch(console.error);
      persistLeadSignature().catch(() => {});
    }, 800);
  });
})();
