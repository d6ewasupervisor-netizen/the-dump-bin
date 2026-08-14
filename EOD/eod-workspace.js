/* EOD hamburger pages + searchable pickers. Pages hide/show; DOM is never destroyed. */
(function () {
  'use strict';

  const PAGE_KEY = 'eodWorkspacePage';
  const NARROW = 720;

  const PAGES = [
    { id: 'visit', label: "Today's visit", hint: 'Store, date, shifts, profile' },
    { id: 'instawork', label: 'InstaWork', hint: 'JOIN QR, punches, submit to office' },
    { id: 'kompass', label: 'Kompass team', hint: 'JOIN QR, punches, submit to supervisor' },
    { id: 'crew', label: 'Crew', hint: 'Roster, Dump Bin materials' },
    { id: 'photos', label: 'Photos', hint: 'Cart before/after, optional paper sign-off' },
    { id: 'signoff', label: 'Digital signoffs', hint: 'Hosted worksheet marks' },
    { id: 'pic', label: 'PIC / manager QR', hint: 'Show today\'s store QR for sign-out' },
    { id: 'helpdesk', label: 'Help desk', hint: 'KOMPASS help desk reports' },
    { id: 'cover', label: 'Cover sheet', hint: 'Auto-filled review + check-in + notes' },
    { id: 'send', label: 'Sign & send', hint: 'Signature, recipients, send EOD' },
  ];

  let currentPage = 'visit';

  function isNarrow() {
    return window.innerWidth < NARROW;
  }

  function loadPage() {
    try {
      const raw = localStorage.getItem(PAGE_KEY);
      if (raw && PAGES.some((p) => p.id === raw)) return raw;
    } catch (_) { /* ignore */ }
    return 'visit';
  }

  function savePage(id) {
    try { localStorage.setItem(PAGE_KEY, id); } catch (_) { /* ignore */ }
  }

  function syncChromeMeta() {
    const storeEl = document.getElementById('eodChromeStore');
    const dateEl = document.getElementById('eodChromeDate');
    const store = (document.getElementById('storeNumber')?.value || '').trim();
    const date = (document.getElementById('workDate')?.value || '').trim();
    if (storeEl) storeEl.textContent = store ? `#${store}` : 'No store';
    if (dateEl) dateEl.textContent = date || '—';
  }

  function ensureChrome() {
    if (document.getElementById('eodAppChrome')) return;
    const container = document.querySelector('.container');
    const workspace = document.getElementById('eodWorkspace');
    if (!container || !workspace) return;

    const legacyHeader = container.querySelector('.header');
    if (legacyHeader) {
      legacyHeader.classList.add('eod-legacy-header');
      legacyHeader.setAttribute('hidden', '');
    }

    const chrome = document.createElement('header');
    chrome.id = 'eodAppChrome';
    chrome.className = 'eod-app-chrome';
    chrome.innerHTML = `
      <button type="button" class="eod-menu-btn" id="eodMenuBtn" aria-label="Open menu" aria-expanded="false" aria-controls="eodDrawer">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
        </svg>
      </button>
      <div class="eod-chrome-mid" id="eodChromeMid" title="Tap for quick view">
        <div class="eod-chrome-store" id="eodChromeStore">No store</div>
        <div class="eod-chrome-date" id="eodChromeDate">—</div>
      </div>
      <div class="eod-chrome-dots" id="eodChromeDotsHost" aria-label="Connection status"></div>
      <button type="button" class="refresh-connections-btn eod-chrome-refresh" id="refreshConnectionsBtnChrome" title="Refresh SAS / Rebotics auth" aria-label="Refresh connections">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
          <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
      </button>
      <span class="eod-version-badge eod-chrome-version" id="eodVersionBadgeChrome" title="Tap to toggle test mode · long-press to force Update">v2.15.1</span>
    `;
    container.insertBefore(chrome, workspace);

    // Move conn dots into chrome (keep same IDs for existing JS)
    const dots = document.getElementById('connIndicators');
    const host = document.getElementById('eodChromeDotsHost');
    if (dots && host) host.appendChild(dots);

    // Wire refresh — prefer existing handler on #refreshConnectionsBtn
    const refreshChrome = document.getElementById('refreshConnectionsBtnChrome');
    const refreshLegacy = document.getElementById('refreshConnectionsBtn');
    if (refreshChrome) {
      refreshChrome.onclick = (e) => {
        e.stopPropagation();
        if (typeof window.refreshConnections === 'function') window.refreshConnections();
        else refreshLegacy?.click();
      };
    }

    // Mirror version badge clicks to the legacy badge
    const badgeChrome = document.getElementById('eodVersionBadgeChrome');
    const badgeLegacy = document.getElementById('eodVersionBadge');
    if (badgeChrome && badgeLegacy) {
      badgeChrome.textContent = badgeLegacy.textContent || 'v2.15.1';
      const syncBadge = () => {
        badgeChrome.textContent = badgeLegacy.textContent;
        badgeChrome.className = badgeLegacy.className.replace('eod-version-badge', 'eod-version-badge eod-chrome-version');
      };
      const mo = new MutationObserver(syncBadge);
      mo.observe(badgeLegacy, { attributes: true, childList: true, characterData: true, subtree: true });
      badgeChrome.addEventListener('click', (e) => {
        e.stopPropagation();
        badgeLegacy.click();
      });
      badgeChrome.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        badgeLegacy.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      });
      let pressTimer = null;
      badgeChrome.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => badgeLegacy.dispatchEvent(new Event('longpress')), 650);
      }, { passive: true });
      badgeChrome.addEventListener('touchend', () => clearTimeout(pressTimer));
    }

    document.getElementById('eodChromeMid')?.addEventListener('click', () => {
      if (typeof window.openQuickView === 'function') window.openQuickView();
    });

    document.getElementById('eodMenuBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDrawer(true);
    });

    ['storeNumber', 'workDate'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', syncChromeMeta);
      document.getElementById(id)?.addEventListener('change', syncChromeMeta);
    });
    syncChromeMeta();
  }

  function ensureDrawer() {
    if (document.getElementById('eodDrawer')) return;
    const overlay = document.createElement('div');
    overlay.id = 'eodDrawerOverlay';
    overlay.className = 'eod-drawer-overlay';
    overlay.innerHTML = `
      <nav class="eod-drawer" id="eodDrawer" role="navigation" aria-label="EOD sections">
        <div class="eod-drawer-head">
          <strong>KOMPASS EOD</strong>
          <button type="button" class="btn btn-secondary" id="eodDrawerClose">Close</button>
        </div>
        <div class="eod-drawer-list" id="eodDrawerList">
          ${PAGES.map((p) => `
            <button type="button" class="eod-drawer-item" data-eod-page="${p.id}">
              <span class="eod-drawer-item-label">${escapeHtml(p.label)}</span>
              <span class="eod-drawer-item-hint">${escapeHtml(p.hint)}</span>
            </button>`).join('')}
        </div>
        <button type="button" class="eod-drawer-item eod-drawer-feedback" id="eodDrawerFeedback">
          <span class="eod-drawer-item-label">Send app feedback</span>
          <span class="eod-drawer-item-hint">Screenshot + notes to Tyson</span>
        </button>
      </nav>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) toggleDrawer(false);
    });
    document.getElementById('eodDrawerClose').onclick = () => toggleDrawer(false);
    document.getElementById('eodDrawerList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-eod-page]');
      if (!btn) return;
      go(btn.getAttribute('data-eod-page'));
      toggleDrawer(false);
    });
    document.getElementById('eodDrawerFeedback')?.addEventListener('click', () => {
      toggleDrawer(false);
      window.EodFeedbackHub?.open?.();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) toggleDrawer(false);
    });
  }

  function toggleDrawer(open) {
    const overlay = document.getElementById('eodDrawerOverlay');
    const btn = document.getElementById('eodMenuBtn');
    if (!overlay) return;
    const show = open === undefined ? !overlay.classList.contains('show') : !!open;
    overlay.classList.toggle('show', show);
    if (btn) btn.setAttribute('aria-expanded', show ? 'true' : 'false');
  }

  function ensureExtraPages() {
    const workspace = document.getElementById('eodWorkspace');
    if (!workspace) return;

    const extras = [
      {
        id: 'instawork',
        title: 'InstaWork management',
        html: `
          <div class="section" id="eodPageInstaworkBody">
            <p class="sets-help" style="margin:0 0 12px;">Live InstaWork roster, JOIN QR, punches, and office submit. Download / print / email / submit live at the bottom.</p>
            <div id="eodInstaworkPageMount" class="eod-ts-page-mount"></div>
            <button type="button" class="btn btn-primary" id="eodPageOpenInstawork" style="width:100%;">Open InstaWork management</button>
          </div>`,
      },
      {
        id: 'kompass',
        title: 'Kompass team management',
        html: `
          <div class="section" id="eodPageKompassBody">
            <p class="sets-help" style="margin:0 0 12px;">Kompass / ISE roster (Instawork excluded). JOIN QR, punches, and supervisor submit. Actions at the bottom.</p>
            <div id="eodKompassPageMount" class="eod-ts-page-mount"></div>
            <button type="button" class="btn btn-primary" id="eodPageOpenKompass" style="width:100%;">Open Kompass management</button>
          </div>`,
      },
      {
        id: 'pic',
        title: 'PIC / manager QR',
        html: `
          <div class="section" id="eodPicQrSection">
            <p class="sets-help" style="margin:0 0 12px;">
              Show this QR to the Fred Meyer PIC or manager signing you out.
              They scan with their phone, pick their title, review that department&rsquo;s set photos, and sign.
            </p>
            <div id="eodPicQrCard" class="eod-pic-qr-card">
              <div id="eodPicQrStatus" class="sets-help">Confirm today&rsquo;s store to generate a QR.</div>
              <img id="eodPicQrImg" alt="PIC sign-out QR" width="280" height="280" hidden>
              <div id="eodPicQrUrl" class="eod-pic-qr-url" hidden></div>
            </div>
            <div class="button-group" style="margin-top:12px; flex-wrap:wrap; gap:8px;">
              <button type="button" class="btn btn-primary" id="eodPicQrShowBtn" style="flex:1;">Show fullscreen QR</button>
              <button type="button" class="btn btn-secondary" id="eodPicQrRefreshBtn">Refresh QR</button>
            </div>
            <p class="sets-help" style="margin-top:12px;">Tablet department signatures remain available under Digital signoffs as a fallback.</p>
          </div>`,
      },
      {
        id: 'helpdesk',
        title: 'Help desk',
        html: `
          <div class="section">
            <p class="sets-help" style="margin:0 0 12px;">Send KOMPASS help desk reports with photos. Completing a report also marks the cover sheet.</p>
            <button type="button" class="btn btn-primary" id="eodPageHelpdeskBtn" style="width:100%;">Open help desk report</button>
          </div>`,
      },
    ];

    extras.forEach((page) => {
      if (document.querySelector(`[data-eod-group="${page.id}"]`)) return;
      const el = document.createElement('section');
      el.className = 'eod-group eod-page';
      el.id = `eodGroup${page.id.charAt(0).toUpperCase()}${page.id.slice(1)}`;
      el.setAttribute('data-eod-group', page.id);
      el.hidden = true;
      el.innerHTML = `
        <div class="eod-page-heading">
          <div class="eod-group-title">${escapeHtml(page.title)}</div>
        </div>
        <div class="eod-group-body">${page.html}</div>`;
      workspace.appendChild(el);
    });

    document.getElementById('eodPageOpenInstawork')?.addEventListener('click', () => {
      if (window.EodTimesheetMgmt?.openInstawork) window.EodTimesheetMgmt.openInstawork();
      else if (typeof window.openInstaworkManagement === 'function') window.openInstaworkManagement();
    });
    document.getElementById('eodPageOpenKompass')?.addEventListener('click', () => {
      if (window.EodTimesheetMgmt?.openKompass) window.EodTimesheetMgmt.openKompass();
      else if (typeof window.openKompassManagement === 'function') window.openKompassManagement();
    });
    document.getElementById('eodPageHelpdeskBtn')?.addEventListener('click', () => {
      if (typeof window.openHelpdeskWizard === 'function') window.openHelpdeskWizard();
      else if (typeof window.toggleHelpdeskNeed === 'function') {
        const yes = document.getElementById('helpdeskNeedYes');
        if (yes) { yes.checked = true; window.toggleHelpdeskNeed(yes); }
      }
    });
  }

  function convertDetailsToPages() {
    document.querySelectorAll('details.eod-group[data-eod-group]').forEach((el) => {
      const summary = el.querySelector(':scope > summary.eod-group-summary');
      if (summary) {
        const heading = document.createElement('div');
        heading.className = 'eod-page-heading';
        const title = summary.querySelector('.eod-group-title')?.textContent || '';
        const hint = summary.querySelector('.eod-group-hint')?.textContent || '';
        heading.innerHTML = `
          <div class="eod-group-title">${escapeHtml(title)}</div>
          ${hint ? `<div class="eod-group-hint">${escapeHtml(hint)}</div>` : ''}`;
        summary.replaceWith(heading);
      }
      // Convert <details> to <section> by cloning attributes onto a wrapper class
      el.open = true; // keep body in DOM
      el.classList.add('eod-page');
      el.classList.remove('eod-group');
      // details without summary still works; force open via open attribute
      try { el.setAttribute('open', ''); } catch (_) { /* ignore */ }
    });

    // Hide chip nav if present
    document.getElementById('eodGroupNav')?.remove();
  }

  function go(id, opts) {
    const page = PAGES.find((p) => p.id === id) ? id : 'visit';
    currentPage = page;
    savePage(page);

    document.querySelectorAll('[data-eod-group]').forEach((el) => {
      const match = el.getAttribute('data-eod-group') === page;
      el.hidden = !match;
      el.classList.toggle('is-active-page', match);
      if (el.tagName === 'DETAILS') el.open = match;
    });

    document.querySelectorAll('.eod-drawer-item[data-eod-page]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-eod-page') === page);
    });

    document.body.dataset.eodPage = page;
    syncChromeMeta();

    // Auto-open management overlays when landing on those pages
    if (page === 'instawork' && !(opts || {}).skipAutoOpen) {
      if (window.EodTimesheetMgmt?.openInstawork) window.EodTimesheetMgmt.openInstawork();
    } else if (page === 'kompass' && !(opts || {}).skipAutoOpen) {
      if (window.EodTimesheetMgmt?.openKompass) window.EodTimesheetMgmt.openKompass();
    } else if (page !== 'instawork' && page !== 'kompass') {
      // Leaving timesheet pages — keep overlay open only if user is on those pages
      if (window.EodTimesheetMgmt?.close && document.getElementById('eodTsMgmtOverlay')?.classList.contains('show')) {
        // Only auto-close when navigating away from ts pages
        window.EodTimesheetMgmt.close({ fromNav: true });
      }
    }

    if (page === 'pic' && typeof window.EodPicQr?.refresh === 'function') {
      window.EodPicQr.refresh(false).catch(() => {});
    }

    if ((page === 'cover' || page === 'send' || page === 'pic')
        && typeof window.EodCoverSync?.syncAll === 'function') {
      // Refresh PIC checkout manager before filling cover fields
      Promise.resolve(
        page !== 'pic' && typeof window.EodPicQr?.refresh === 'function'
          ? window.EodPicQr.refresh(false).catch(() => {})
          : null
      ).finally(() => {
        try { window.EodCoverSync.syncAll(); } catch (_) { /* ignore */ }
      });
    }

    if ((opts || {}).scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /* Legacy API used by other modules */
  function openGroup(id, opts) {
    go(id, opts);
  }

  /* ─── Picker overlay ─────────────────────────────────────────────── */

  let pickerState = null;

  function ensurePickerDom() {
    if (document.getElementById('eodPickerOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'eodPickerOverlay';
    overlay.className = 'eod-picker-overlay';
    overlay.innerHTML = `
      <div class="eod-picker-panel" id="eodPickerPanel" role="dialog" aria-modal="true" aria-labelledby="eodPickerTitle">
        <div class="eod-picker-head">
          <h3 id="eodPickerTitle">Choose</h3>
          <button type="button" class="btn btn-secondary" id="eodPickerClose">Close</button>
        </div>
        <input type="search" id="eodPickerSearch" class="eod-picker-search" placeholder="Search…" autocomplete="off">
        <div class="eod-picker-list" id="eodPickerList"></div>
        <div class="eod-picker-foot" id="eodPickerFoot" style="display:none;">
          <button type="button" class="btn btn-secondary" id="eodPickerClear">Clear</button>
          <button type="button" class="btn btn-primary" id="eodPickerDone">Done</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePicker();
    });
    document.getElementById('eodPickerClose').onclick = closePicker;
    document.getElementById('eodPickerSearch').addEventListener('input', renderPickerList);
    document.getElementById('eodPickerDone').onclick = () => {
      if (pickerState?.multiple && typeof pickerState.onChange === 'function') {
        pickerState.onChange(pickerState.selected.slice());
      }
      closePicker();
    };
    document.getElementById('eodPickerClear').onclick = () => {
      if (!pickerState) return;
      pickerState.selected = [];
      renderPickerList();
      if (typeof pickerState.onChange === 'function') pickerState.onChange([]);
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) closePicker();
    });
  }

  function positionPanel(anchor) {
    const panel = document.getElementById('eodPickerPanel');
    if (!panel) return;
    panel.classList.remove('sheet');
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.left = '';
    panel.style.right = '';
    panel.style.width = '';

    if (isNarrow() || !anchor) {
      panel.classList.add('sheet');
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const preferUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    const width = Math.min(420, Math.max(rect.width, 280), window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    if (preferUp) {
      panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      panel.style.top = 'auto';
    } else {
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.bottom = 'auto';
    }
  }

  function renderPickerList() {
    if (!pickerState) return;
    const list = document.getElementById('eodPickerList');
    const q = (document.getElementById('eodPickerSearch').value || '').trim().toLowerCase();
    const items = pickerState.items.filter((it) => {
      if (!q) return true;
      const hay = `${it.label || ''} ${it.sublabel || ''} ${it.id || ''}`.toLowerCase();
      return hay.includes(q);
    });
    if (!items.length) {
      list.innerHTML = '<div class="eod-picker-empty">No matches</div>';
      return;
    }
    const selected = new Set(pickerState.selected.map(String));
    list.innerHTML = items.map((it) => {
      const id = String(it.id);
      const on = selected.has(id);
      const sub = it.sublabel ? `<div class="eod-picker-item-sub">${escapeHtml(it.sublabel)}</div>` : '';
      const remove = it.removable
        ? `<button type="button" class="btn btn-secondary eod-picker-remove" data-remove-id="${escapeHtml(id)}" style="width:auto;min-width:44px;padding:6px 8px;">×</button>`
        : '';
      return `<button type="button" class="eod-picker-item${on ? ' is-selected' : ''}${it.disabled ? ' is-disabled' : ''}" data-id="${escapeHtml(id)}">
        <div class="eod-picker-item-text">
          <div class="eod-picker-item-label">${escapeHtml(it.label || id)}</div>
          ${sub}
        </div>
        ${on ? '<span aria-hidden="true">✓</span>' : ''}
        ${remove}
      </button>`;
    }).join('');

    list.querySelectorAll('.eod-picker-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove-id]')) return;
        const id = btn.getAttribute('data-id');
        const item = pickerState.items.find((x) => String(x.id) === id);
        if (!item || item.disabled) return;
        if (pickerState.multiple) {
          const idx = pickerState.selected.findIndex((x) => String(x) === id);
          if (idx >= 0) pickerState.selected.splice(idx, 1);
          else pickerState.selected.push(id);
          renderPickerList();
          if (typeof pickerState.onToggle === 'function') pickerState.onToggle(item, pickerState.selected.slice());
        } else {
          if (typeof pickerState.onChoose === 'function') pickerState.onChoose(item);
          closePicker();
        }
      });
    });
    list.querySelectorAll('[data-remove-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-remove-id');
        const item = pickerState.items.find((x) => String(x.id) === id);
        if (item && typeof pickerState.onRemove === 'function') pickerState.onRemove(item);
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openPicker(opts) {
    ensurePickerDom();
    const options = opts || {};
    pickerState = {
      items: Array.isArray(options.items) ? options.items : [],
      multiple: !!options.multiple,
      selected: Array.isArray(options.selected) ? options.selected.map(String) : [],
      onChoose: options.onChoose,
      onChange: options.onChange,
      onToggle: options.onToggle,
      onRemove: options.onRemove,
      anchor: options.anchor || null,
    };
    document.getElementById('eodPickerTitle').textContent = options.title || 'Choose';
    const search = document.getElementById('eodPickerSearch');
    search.value = '';
    search.style.display = options.searchable === false ? 'none' : 'block';
    document.getElementById('eodPickerFoot').style.display = pickerState.multiple ? 'flex' : 'none';
    renderPickerList();
    const overlay = document.getElementById('eodPickerOverlay');
    overlay.classList.add('show');
    positionPanel(pickerState.anchor);
    if (options.searchable !== false) {
      setTimeout(() => search.focus(), 30);
    }
  }

  function closePicker() {
    const overlay = document.getElementById('eodPickerOverlay');
    if (overlay) overlay.classList.remove('show');
    pickerState = null;
  }

  function itemsFromSelect(select) {
    return Array.from(select.options || [])
      .filter((opt) => opt.value)
      .map((opt) => ({
        id: opt.value,
        label: (opt.textContent || opt.value).trim(),
        disabled: opt.disabled,
        selected: opt.selected,
      }));
  }

  function bindSelect(select, title) {
    if (!select || select.dataset.eodPickerBound === '1') return;
    select.dataset.eodPickerBound = '1';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.setAttribute('data-eod-select-trigger', select.id || '');
    const syncLabel = () => {
      const opt = select.options[select.selectedIndex];
      const text = (opt && opt.value) ? (opt.textContent || opt.value).trim() : (select.options[0]?.textContent || 'Select…');
      trigger.innerHTML = `<span class="eod-picker-label">${escapeHtml(text)}</span><span class="eod-picker-meta">${select.options.length > 1 ? select.options.length - 1 : 0}</span>`;
    };
    syncLabel();
    select.style.position = 'absolute';
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.width = '1px';
    select.style.height = '1px';
    select.setAttribute('tabindex', '-1');
    select.parentNode.insertBefore(trigger, select);
    trigger.addEventListener('click', () => {
      openPicker({
        anchor: trigger,
        title: title || select.getAttribute('aria-label') || 'Select',
        items: itemsFromSelect(select),
        searchable: itemsFromSelect(select).length > 8,
        onChoose(item) {
          select.value = item.id;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncLabel();
        },
      });
    });
    select.addEventListener('change', syncLabel);
    const mo = new MutationObserver(syncLabel);
    mo.observe(select, { childList: true, subtree: true, attributes: true });
  }

  function enhanceKnownSelects() {
    const map = [
      ['smAddSelect', 'Add a teammate'],
      ['smRemoveSelect', 'Remove a teammate'],
      ['notInStoreSelect', 'Not in store'],
      ['notInSiSelect', 'Not in SI'],
      ['notInShiftSelect', 'Sets from shift'],
      ['leadPickerSelect', 'Select lead'],
    ];
    map.forEach(([id, title]) => {
      const el = document.getElementById(id);
      if (el && el.tagName === 'SELECT') bindSelect(el, title);
    });
  }

  function compactRoster() {
    const list = document.getElementById('smMembersList');
    if (!list || list.dataset.eodCompact === '1') return;
    list.dataset.eodCompact = '1';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.id = 'smRosterPickerBtn';
    trigger.innerHTML = '<span class="eod-picker-label">View current roster</span><span class="eod-picker-meta" id="smRosterCount">0</span>';
    list.parentNode.insertBefore(trigger, list);
    list.classList.add('eod-hidden-list');
    const sync = () => {
      const names = Array.from(list.querySelectorAll('.sm-member-name')).map((n) => n.textContent.trim()).filter(Boolean);
      const count = document.getElementById('smRosterCount');
      if (count) count.textContent = String(names.length || list.querySelectorAll('.sm-member-row').length);
      trigger.querySelector('.eod-picker-label').textContent = names.length
        ? 'Roster · tap to view'
        : (list.textContent.trim() || 'Roster');
    };
    trigger.addEventListener('click', () => {
      const rows = Array.from(list.querySelectorAll('.sm-member-row'));
      const items = rows.map((row, i) => {
        const name = row.querySelector('.sm-member-name')?.textContent.trim() || `Person ${i + 1}`;
        const time = row.querySelector('.sm-member-time')?.textContent.trim() || '';
        return { id: String(i), label: name, sublabel: time };
      });
      openPicker({
        anchor: trigger,
        title: 'Current roster',
        items: items.length ? items : [{ id: 'empty', label: list.textContent.trim() || 'No members', disabled: true }],
        searchable: items.length > 6,
      });
    });
    const mo = new MutationObserver(sync);
    mo.observe(list, { childList: true, subtree: true, characterData: true });
    sync();
  }

  function compactFredmeyer() {
    const list = document.getElementById('fmEmailList');
    const section = document.getElementById('fmEmailPickerSection');
    if (!list || !section || list.dataset.eodCompact === '1') return;
    list.dataset.eodCompact = '1';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.id = 'fmEmailPickerBtn';
    trigger.innerHTML = '<span class="eod-picker-label">Saved Fred Meyer addresses</span><span class="eod-picker-meta" id="fmEmailPickerCount">0</span>';
    list.parentNode.insertBefore(trigger, list);
    list.classList.add('eod-hidden-list');
    const sync = () => {
      const n = list.querySelectorAll('.fm-checkbox').length;
      const checked = list.querySelectorAll('.fm-checkbox:checked').length;
      const count = document.getElementById('fmEmailPickerCount');
      if (count) count.textContent = n ? `${checked}/${n}` : '0';
    };
    trigger.addEventListener('click', () => {
      const rows = Array.from(list.querySelectorAll('.fm-email-row'));
      const items = rows.map((row, i) => {
        const cb = row.querySelector('.fm-checkbox');
        const email = row.querySelector('.fm-email-label')?.textContent.trim() || '';
        return { id: String(cb?.dataset.idx ?? i), label: email, selected: !!cb?.checked, removable: true };
      });
      openPicker({
        anchor: trigger,
        title: 'Fred Meyer addresses',
        multiple: true,
        selected: items.filter((x) => x.selected).map((x) => x.id),
        items,
        searchable: items.length > 8,
        onToggle(item, selectedIds) {
          const cb = list.querySelector(`.fm-checkbox[data-idx="${item.id}"]`);
          if (cb) {
            cb.checked = selectedIds.map(String).includes(String(item.id));
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          sync();
        },
        onChange() { sync(); },
        onRemove(item) {
          const row = list.querySelectorAll('.fm-email-row')[Number(item.id)];
          const btn = row?.querySelector('.fm-remove-btn');
          if (btn) btn.click();
        },
      });
    });
    const mo = new MutationObserver(sync);
    mo.observe(list, { childList: true, subtree: true, attributes: true });
    sync();
  }

  function compactManagers() {
    ['checkIn', 'checkOut'].forEach((which) => {
      const host = document.getElementById(`${which}ManagerSuggestions`);
      const input = document.getElementById(`${which}Manager`);
      if (!host || !input || host.dataset.eodCompact === '1') return;
      host.dataset.eodCompact = '1';
      host.classList.add('eod-hidden-chips');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'eod-picker-trigger';
      trigger.style.marginTop = '6px';
      trigger.innerHTML = `<span class="eod-picker-label">Choose saved ${which === 'checkIn' ? 'check-in' : 'check-out'} name</span><span class="eod-picker-meta" data-count>0</span>`;
      host.parentNode.insertBefore(trigger, host);
      const sync = () => {
        const n = host.querySelectorAll('.manager-chip').length;
        const meta = trigger.querySelector('[data-count]');
        if (meta) meta.textContent = String(n);
      };
      trigger.addEventListener('click', () => {
        const chips = Array.from(host.querySelectorAll('.manager-chip'));
        const items = chips.map((chip, i) => {
          const name = decodeURIComponent(chip.dataset.managerName || chip.querySelector('.chip-select')?.textContent || '');
          return { id: String(i), label: name, removable: true, raw: chip };
        });
        openPicker({
          anchor: trigger,
          title: which === 'checkIn' ? 'Check-in managers' : 'Check-out managers',
          items: items.length ? items : [{ id: 'empty', label: 'No saved names yet', disabled: true }],
          searchable: items.length > 6,
          onChoose(item) {
            if (item.raw) item.raw.click();
            else if (typeof window.selectManagerName === 'function') window.selectManagerName(which, item.label);
          },
          onRemove(item) {
            const btn = item.raw?.querySelector('.chip-remove');
            if (btn) btn.click();
          },
        });
      });
      const mo = new MutationObserver(sync);
      mo.observe(host, { childList: true, subtree: true });
      sync();
    });
  }

  function compactStorePicker() {
    const input = document.getElementById('storeNumber');
    const list = document.getElementById('storeList');
    if (!input || !list || input.dataset.eodStorePicker === '1') return;
    input.dataset.eodStorePicker = '1';
    const wrap = input.parentNode;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.style.marginTop = '6px';
    trigger.innerHTML = '<span class="eod-picker-label">Pick store number</span><span class="eod-picker-meta">list</span>';
    wrap.appendChild(trigger);
    trigger.addEventListener('click', () => {
      const items = Array.from(list.options || []).map((opt) => ({
        id: opt.value,
        label: `Store ${opt.value}`,
        selected: input.value === opt.value,
      }));
      openPicker({
        anchor: trigger,
        title: 'Store number',
        items,
        searchable: true,
        onChoose(item) {
          input.value = item.id;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        },
      });
    });
  }

  function relocateInjectedSections() {
    const host = document.getElementById('eodSignoffGroupBody');
    if (!host) return;
    ['digitalSignoffSection', 'deptSigSection'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentNode !== host) host.appendChild(el);
    });
  }

  function watchInjected() {
    const mo = new MutationObserver(() => relocateInjectedSections());
    mo.observe(document.body, { childList: true, subtree: true });
    relocateInjectedSections();
  }

  function moveSendActionsIntoSendPage() {
    const sendGroup = document.querySelector('[data-eod-group="send"] .eod-group-body');
    const actions = document.querySelector('.container > .button-group');
    if (!sendGroup || !actions || actions.dataset.eodMoved === '1') return;
    actions.dataset.eodMoved = '1';
    actions.classList.add('eod-send-actions');
    sendGroup.appendChild(actions);
  }

  function enrichCrewPage() {
    const materials = document.getElementById('materialsInfoSection');
    if (!materials) return;
    // Replace Yes/No gate with direct Dump Bin opener when Phase 5 runs;
    // for Phase 1 keep section but add always-visible Dump Bin button.
    if (document.getElementById('eodCrewDumpBinBtn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'eodCrewDumpBinBtn';
    btn.className = 'btn btn-primary';
    btn.style.cssText = 'width:100%;margin-top:10px;';
    btn.textContent = 'Open the Dump Bin';
    btn.onclick = () => {
      if (typeof window.openMaterialsBrowser === 'function') window.openMaterialsBrowser();
    };
    materials.appendChild(btn);
  }

  function labelOptionalPaperSignoff() {
    const label = document.querySelector('#signoffPhotoSection > .field.label, #signoffPhotoSection label.field');
    const title = document.querySelector('#signoffPhotoSection > label.field.label');
    const el = title || document.querySelector('#signoffPhotoSection label.field.label');
    if (el && !el.dataset.optionalLabeled) {
      el.dataset.optionalLabeled = '1';
      el.innerHTML = 'Sign-Off Sheets <span style="color:#94a3b8;font-weight:500;">(optional — digital PIC signatures preferred)</span>:';
    }
  }

  function init() {
    ensureChrome();
    ensureDrawer();
    ensureExtraPages();
    convertDetailsToPages();
    moveSendActionsIntoSendPage();
    enrichCrewPage();
    labelOptionalPaperSignoff();
    enhanceKnownSelects();
    compactRoster();
    compactFredmeyer();
    compactManagers();
    compactStorePicker();
    watchInjected();
    go(loadPage(), { skipAutoOpen: true, scroll: false });
  }

  window.EodWorkspace = {
    openGroup,
    go,
    get currentPage() { return currentPage; },
    openPicker,
    closePicker,
    enhanceSelect: bindSelect,
    syncChromeMeta,
    toggleDrawer,
    PAGES,
  };
  window.EodPicker = { open: openPicker, close: closePicker };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
