/* EOD Speakap-style tabs + searchable pickers. Pages hide/show; DOM is never destroyed. */
(function () {
  'use strict';

  const PAGE_KEY = 'eodWorkspacePage';
  const TAB_MEMORY_KEY = 'eodWorkspaceTabMemory';
  const NARROW = 720;
  const VERSION = 'v2.17.1';

  /* Primary bottom tabs (Speakap-style). Help desk lives under More. */
  const TAB_PAGES = [
    { id: 'visit', label: 'Start', hint: 'Store, date, shifts', next: 'crew', nextLabel: 'Continue to Crew', icon: 'home' },
    { id: 'crew', label: 'Crew', hint: 'Roster & timesheets', next: 'info', nextLabel: 'Continue to Information', hub: true, icon: 'people' },
    { id: 'info', label: 'Info', hint: 'Materials / Dump Bin', next: 'signoff', nextLabel: 'Go to Sheet', icon: 'book' },
    { id: 'signoff', label: 'Sheet', hint: 'Marks & manager QR', next: 'eod', nextLabel: 'Finish EOD', hub: true, icon: 'sheet' },
    { id: 'eod', label: 'EOD', hint: 'Cover, photos, send', next: null, nextLabel: null, hub: true, icon: 'send' },
  ];

  const MORE_PAGES = [
    { id: 'helpdesk', label: 'Help desk', hint: 'KOMPASS help desk reports', next: 'signoff', nextLabel: 'Back to Sheet' },
  ];

  const DRAWER_PAGES = [...TAB_PAGES, ...MORE_PAGES];

  const SUBPAGES = {
    'crew-roster': { parent: 'crew', label: 'Shift roster', hint: 'Add and remove teammates' },
    instawork: { parent: 'crew', label: 'InstaWork', hint: 'Yes/No, sign-out photo, live sheet' },
    kompass: { parent: 'crew', label: 'Kompass timesheet', hint: 'Yes/No, open live sheet' },
    'crew-join': { parent: 'crew', label: 'Team JOIN QR', hint: 'Workers scan to log in' },
    'signoff-marks': { parent: 'signoff', label: 'Digital marks', hint: 'Worksheet and department PIC signatures' },
    pic: { parent: 'signoff', label: 'Manager QR', hint: 'PIC / manager sign-out' },
    cover: { parent: 'eod', label: 'Cover sheet', hint: 'Managers, notes, SI' },
    photos: { parent: 'eod', label: 'Cart photos', hint: 'Before / after cart photos' },
    send: { parent: 'eod', label: 'Sign & send', hint: 'Lead signature, recipients, send' },
  };

  const HUB_CARDS = {
    crew: [
      { id: 'crew-roster', title: 'Shift roster', hint: 'Add / remove teammates on today\'s visit' },
      { id: 'instawork', title: 'InstaWork', hint: 'Yes/No + sign-out photo · open live sheet separately' },
      { id: 'kompass', title: 'Kompass timesheet', hint: 'Yes/No · open live sheet separately' },
      { id: 'crew-join', title: 'Team JOIN QR', hint: 'Show QR or text JOIN to (509) 572-9212' },
    ],
    signoff: [
      { id: 'signoff-marks', title: 'Digital marks', hint: 'Hosted worksheet and department signatures' },
      { id: 'pic', title: 'Manager QR', hint: 'PIC / manager scans to sign out' },
    ],
    eod: [
      { id: 'cover', title: 'Cover sheet', hint: 'Managers, notes, sets not in store / SI' },
      { id: 'photos', title: 'Cart photos', hint: 'Before / after Kompass cart' },
      { id: 'send', title: 'Sign & send', hint: 'Lead signature, recipients, and send' },
    ],
  };

  const HUB_MOUNT = {
    crew: 'eodHubCrew',
    signoff: 'eodHubSheet',
    eod: 'eodHubEod',
  };

  const PAGES = DRAWER_PAGES;

  const LEGACY_PAGE_MAP = {
    materials: 'info',
  };

  let currentPage = 'visit';
  let tabMemory = {};

  function tabIcon(name) {
    const icons = {
      home: '<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>',
      people: '<path d="M16 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 16 11zm-8 0a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8 11zm0 2c-2.8 0-5.2 1.4-5.2 3.2V19h10.4v-2.8C13.2 14.4 10.8 13 8 13zm8 0c-.4 0-.8 0-1.2.1 1.3.9 2.2 2.1 2.2 3.5V19H21v-2.8c0-1.8-2.4-3.2-5-3.2z"/>',
      book: '<path d="M6 4h9a3 3 0 0 1 3 3v13H8a2 2 0 0 0-2 2V4zm2 2v12.2A3.8 3.8 0 0 1 8.8 18H16V7a1 1 0 0 0-1-1H8z"/>',
      sheet: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V9h4.5L14 4.5zM9 12h8v1.5H9V12zm0 3.5h8V17H9v-1.5z"/>',
      send: '<path d="M4 12l16-8-6.5 16-2.2-5.8L4 12zm9.2 1.1l1.2 3.2 3.6-8.8-8.3 4.1 3.5 1.5z"/>',
      more: '<circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/>',
    };
    return '<svg class="eod-tab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (icons[name] || icons.more) + '</svg>';
  }

  function isTabRoot(id) {
    return TAB_PAGES.some((p) => p.id === id);
  }

  function isDrawerPage(id) {
    return DRAWER_PAGES.some((p) => p.id === id);
  }

  function parentOf(id) {
    return SUBPAGES[id]?.parent || null;
  }

  function resolvePage(id) {
    let page = id;
    if (LEGACY_PAGE_MAP[page]) page = LEGACY_PAGE_MAP[page];
    if (isDrawerPage(page) || SUBPAGES[page]) return page;
    return 'visit';
  }

  function tabRootOf(id) {
    const page = resolvePage(id);
    if (isTabRoot(page)) return page;
    if (MORE_PAGES.some((p) => p.id === page)) return null;
    return parentOf(page) || 'visit';
  }

  function pageTitle(id) {
    const page = resolvePage(id);
    if (SUBPAGES[page]) return SUBPAGES[page].label;
    const root = DRAWER_PAGES.find((p) => p.id === page);
    return root?.label || 'EOD';
  }

  function loadTabMemory() {
    try {
      const raw = JSON.parse(localStorage.getItem(TAB_MEMORY_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_) {
      return {};
    }
  }

  function saveTabMemory() {
    try { localStorage.setItem(TAB_MEMORY_KEY, JSON.stringify(tabMemory)); } catch (_) { /* ignore */ }
  }

  function rememberTabPage(page) {
    const root = tabRootOf(page);
    if (!root) return;
    tabMemory[root] = page;
    saveTabMemory();
  }

  function lastInTab(root) {
    const remembered = tabMemory[root];
    if (!remembered) return root;
    const resolved = resolvePage(remembered);
    if (tabRootOf(resolved) === root) return resolved;
    return root;
  }

  function drawerHighlightId(id) {
    return tabRootOf(id) || id;
  }

  tabMemory = loadTabMemory();

function isNarrow() {
    return window.innerWidth < NARROW;
  }

  function loadPage() {
    try {
      const raw = localStorage.getItem(PAGE_KEY);
      if (!raw) return 'visit';
      return resolvePage(raw);
    } catch (_) { /* ignore */ }
    return 'visit';
  }

  function savePage(id) {
    try { localStorage.setItem(PAGE_KEY, id); } catch (_) { /* ignore */ }
  }

  function syncChromeMeta() {
    const titleEl = document.getElementById('eodChromeTitle');
    const storeEl = document.getElementById('eodChromeStore');
    const dateEl = document.getElementById('eodChromeDate');
    const store = (document.getElementById('storeNumber')?.value || '').trim();
    const date = (document.getElementById('workDate')?.value || '').trim();
    if (titleEl) titleEl.textContent = pageTitle(currentPage);
    if (storeEl) storeEl.textContent = store ? ('#' + store) : 'No store';
    if (dateEl) dateEl.textContent = date || '—';
    document.body.classList.add('eod-has-tabbar');
    document.body.classList.toggle(
      'eod-on-subpage',
      !!parentOf(currentPage) || MORE_PAGES.some((p) => p.id === currentPage)
    );
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
    chrome.innerHTML = [
      '<button type="button" class="eod-menu-btn eod-chrome-back" id="eodChromeBackBtn" aria-label="Back" hidden>',
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
      '</button>',
      '<button type="button" class="eod-menu-btn" id="eodMenuBtn" aria-label="More" aria-expanded="false" aria-controls="eodDrawer">',
      tabIcon('more'),
      '</button>',
      '<div class="eod-chrome-mid" id="eodChromeMid" title="Tap for quick view">',
      '<div class="eod-chrome-title" id="eodChromeTitle">Start</div>',
      '<div class="eod-chrome-sub">',
      '<span class="eod-chrome-store" id="eodChromeStore">No store</span>',
      '<span class="eod-chrome-sep">·</span>',
      '<span class="eod-chrome-date" id="eodChromeDate">—</span>',
      '</div></div>',
      '<div class="eod-chrome-dots" id="eodChromeDotsHost" aria-label="Connection status"></div>',
      '<button type="button" class="refresh-connections-btn eod-chrome-refresh" id="refreshConnectionsBtnChrome" title="Refresh SAS / Rebotics auth" aria-label="Refresh connections">',
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>',
      '<path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
      '</svg></button>',
      '<span class="eod-version-badge eod-chrome-version" id="eodVersionBadgeChrome" title="Tap to toggle test mode · long-press to force Update">v2.17.1</span>',
    ].join('');
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
      badgeChrome.textContent = badgeLegacy.textContent || VERSION;
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

    document.getElementById('eodChromeBackBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const parent = parentOf(currentPage);
      if (parent) go(parent);
      else if (MORE_PAGES.some((p) => p.id === currentPage)) go('visit');
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
    overlay.className = 'eod-drawer-overlay eod-more-sheet-overlay';
    const items = MORE_PAGES.map((p) => (
      '<button type="button" class="eod-drawer-item" data-eod-page="' + p.id + '">'
      + '<span class="eod-drawer-item-label">' + escapeHtml(p.label) + '</span>'
      + '<span class="eod-drawer-item-hint">' + escapeHtml(p.hint) + '</span></button>'
    )).join('');
    overlay.innerHTML = [
      '<nav class="eod-drawer eod-more-sheet" id="eodDrawer" role="navigation" aria-label="More">',
      '<div class="eod-drawer-head"><strong>More</strong>',
      '<button type="button" class="btn btn-secondary" id="eodDrawerClose">Close</button></div>',
      '<div class="eod-drawer-list" id="eodDrawerList">' + items + '</div>',
      '<button type="button" class="eod-drawer-item eod-drawer-feedback" id="eodDrawerFeedback">',
      '<span class="eod-drawer-item-label">Send app feedback</span>',
      '<span class="eod-drawer-item-hint">Screenshot + notes to Tyson</span></button>',
      '</nav>',
    ].join('');
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

  function ensureTabBar() {
    if (document.getElementById('eodTabBar')) return;
    const bar = document.createElement('nav');
    bar.id = 'eodTabBar';
    bar.className = 'eod-tabbar';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'EOD sections');
    bar.innerHTML = TAB_PAGES.map((p) => (
      '<button type="button" class="eod-tab" role="tab" data-eod-tab="' + p.id + '" aria-label="' + escapeHtml(p.label) + '">'
      + tabIcon(p.icon)
      + '<span class="eod-tab-label">' + escapeHtml(p.label) + '</span></button>'
    )).join('');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-eod-tab]');
      if (!btn) return;
      const root = btn.getAttribute('data-eod-tab');
      const activeRoot = tabRootOf(currentPage);
      if (activeRoot === root) go(root);
      else go(lastInTab(root));
    });
  }

  function refreshTabBar() {
    const root = tabRootOf(currentPage);
    document.querySelectorAll('.eod-tab[data-eod-tab]').forEach((btn) => {
      const id = btn.getAttribute('data-eod-tab');
      const on = id === root;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const back = document.getElementById('eodChromeBackBtn');
    const more = document.getElementById('eodMenuBtn');
    const deep = !!parentOf(currentPage) || MORE_PAGES.some((p) => p.id === currentPage);
    if (back) back.hidden = !deep;
    if (more) more.hidden = !!deep;
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
    // Help desk / PIC / timesheet mounts now live in index.html.
    // Wire page buttons once.
    if (!document.getElementById('eodPageHelpdeskBtn')?.dataset.eodWired) {
      const helpBtn = document.getElementById('eodPageHelpdeskBtn');
      if (helpBtn) {
        helpBtn.dataset.eodWired = '1';
        helpBtn.addEventListener('click', () => {
          if (typeof window.openHelpdeskWizard === 'function') window.openHelpdeskWizard();
          else if (typeof window.toggleHelpdeskNeed === 'function') {
            const yes = document.getElementById('helpdeskNeedYes');
            if (yes) { yes.checked = true; window.toggleHelpdeskNeed(yes); }
          }
        });
      }
    }

    if (!document.getElementById('eodCrewSheetIwBtn')?.dataset.eodWired) {
      const iw = document.getElementById('eodCrewSheetIwBtn');
      const kp = document.getElementById('eodCrewSheetKpBtn');
      // JOIN page: mint QR via overlay sheet open (fullscreen), never inline employee list
      if (iw) {
        iw.dataset.eodWired = '1';
        iw.addEventListener('click', async () => {
          try {
            if (window.EodTimesheetMgmt?.openInstawork) await window.EodTimesheetMgmt.openInstawork();
            else if (typeof window.openInstaworkManagement === 'function') window.openInstaworkManagement();
            paintCrewJoinQr();
          } catch (err) {
            if (typeof showAlert === 'function') showAlert('JOIN QR', err.message || String(err));
          }
        });
      }
      if (kp) {
        kp.dataset.eodWired = '1';
        kp.addEventListener('click', async () => {
          try {
            if (window.EodTimesheetMgmt?.openKompass) await window.EodTimesheetMgmt.openKompass();
            else if (typeof window.openKompassManagement === 'function') window.openKompassManagement();
            paintCrewJoinQr();
          } catch (err) {
            if (typeof showAlert === 'function') showAlert('JOIN QR', err.message || String(err));
          }
        });
      }
      document.getElementById('eodCrewJoinQrShowBtn')?.addEventListener('click', () => {
        if (window.EodTimesheetMgmt?.showJoinQr) window.EodTimesheetMgmt.showJoinQr();
        else paintCrewJoinQr(true);
      });
      document.getElementById('eodCrewJoinQrRefreshBtn')?.addEventListener('click', async () => {
        try {
          if (window.EodTimesheetMgmt?.refreshJoinToken) await window.EodTimesheetMgmt.refreshJoinToken(true);
          else if (window.EodTimesheetMgmt?.refresh) await window.EodTimesheetMgmt.refresh();
          paintCrewJoinQr(true);
        } catch (err) {
          if (typeof showAlert === 'function') showAlert('JOIN QR', err.message || String(err));
        }
      });
    }
  }

  function paintCrewJoinQr(forceShow) {
    const status = document.getElementById('eodCrewJoinQrStatus');
    const img = document.getElementById('eodCrewJoinQrImg');
    const urlEl = document.getElementById('eodCrewJoinQrUrl');
    const join = window.EodTimesheetMgmt?.getJoin?.() || null;
    if (!join?.joinUrl) {
      if (status) {
        status.hidden = false;
        status.textContent = 'Open InstaWork or Kompass (fullscreen) once to mint today\'s JOIN QR, then return here.';
      }
      if (img) img.hidden = true;
      if (urlEl) urlEl.hidden = true;
      return;
    }
    if (status) status.hidden = true;
    if (img) {
      img.hidden = false;
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(join.joinUrl)}`;
    }
    if (urlEl) {
      urlEl.hidden = false;
      urlEl.textContent = join.joinUrl;
    }
    if (forceShow && window.EodTimesheetMgmt?.showJoinQr) {
      window.EodTimesheetMgmt.showJoinQr();
    }
  }

  function paintHub(hubId) {
    const mountId = HUB_MOUNT[hubId];
    const mount = mountId ? document.getElementById(mountId) : null;
    const cards = HUB_CARDS[hubId];
    if (!mount || !cards) return;

    mount.innerHTML = `
      <p class="eod-hub-intro">Pick a task. Tap a bottom tab anytime to jump sections — re-tap the active tab to return home.</p>
      <div class="eod-hub-grid">
        ${cards.map((c) => `
          <button type="button" class="eod-hub-card" data-eod-hub-go="${c.id}">
            <span class="eod-hub-card-title">${escapeHtml(c.title)}</span>
            <span class="eod-hub-card-hint">${escapeHtml(c.hint)}</span>
            <span class="eod-hub-card-go">Open →</span>
          </button>`).join('')}
      </div>`;

    mount.querySelectorAll('[data-eod-hub-go]').forEach((btn) => {
      btn.addEventListener('click', () => go(btn.getAttribute('data-eod-hub-go')));
    });
  }

  function ensureBackButton(pageId) {
    // Top chrome owns Back (Speakap-style). Strip any leftover in-page bars.
    document.querySelectorAll('.eod-back-bar').forEach((el) => el.remove());
    void pageId;
  }

  function ensureNextStepButtons() {
    DRAWER_PAGES.forEach((page) => {
      if (!page.next) return;
      // Hubs: next button on hub body; leaf drawer pages on their body
      const hosts = document.querySelectorAll(`[data-eod-group="${page.id}"] .eod-group-body`);
      hosts.forEach((host) => {
        if (host.querySelector(`[data-eod-next="${page.id}"]`)) return;
        const wrap = document.createElement('div');
        wrap.className = 'eod-next-step';
        wrap.innerHTML = `<button type="button" class="btn btn-success" data-eod-next="${page.id}" style="width:100%;margin-top:14px;">${escapeHtml(page.nextLabel || 'Continue')}</button>`;
        host.appendChild(wrap);
        wrap.querySelector('button').onclick = () => go(page.next);
      });
    });
    // Leaf subpages that finish a hub get a light continue
    const leafNext = {
      'crew-join': { next: 'info', label: 'Continue to Information' },
      pic: { next: 'eod', label: 'Continue to EOD' },
      send: { next: null, label: null },
    };
    Object.entries(leafNext).forEach(([id, cfg]) => {
      if (!cfg.next) return;
      const hosts = document.querySelectorAll(`[data-eod-group="${id}"] .eod-group-body`);
      hosts.forEach((host) => {
        if (host.querySelector(`[data-eod-next="${id}"]`)) return;
        const wrap = document.createElement('div');
        wrap.className = 'eod-next-step';
        wrap.innerHTML = `<button type="button" class="btn btn-success" data-eod-next="${id}" style="width:100%;margin-top:14px;">${escapeHtml(cfg.label)}</button>`;
        host.appendChild(wrap);
        wrap.querySelector('button').onclick = () => go(cfg.next);
      });
    });
  }

  function pageStatusHint(id) {
    try {
      if (id === 'crew') {
        const list = document.getElementById('smMembersList');
        const n = list?.querySelectorAll('.sm-member-row')?.length || 0;
        return n ? `${n} on roster` : 'pick a task';
      }
      if (id === 'info') return 'materials';
      if (id === 'signoff') {
        const sheet = window.EodDigitalSignoff?.getSheet?.();
        if (!sheet) return 'pick a task';
        const s = sheet.summary || {};
        const open = Math.max(0, (s.total || 0) - (s.marked || 0));
        return open ? `${open} open` : `${s.marked || 0} marked`;
      }
      if (id === 'eod') {
        const before = document.querySelectorAll('#previewBefore .photo-item, #previewBefore img')?.length || 0;
        return before ? 'photos ready' : 'pick a task';
      }
    } catch (_) { /* ignore */ }
    return '';
  }

  function refreshDrawerHints() {
    document.querySelectorAll('.eod-drawer-item[data-eod-page]').forEach((btn) => {
      const id = btn.getAttribute('data-eod-page');
      const hint = btn.querySelector('.eod-drawer-item-hint');
      const page = DRAWER_PAGES.find((p) => p.id === id);
      if (!hint || !page) return;
      const status = pageStatusHint(id);
      hint.textContent = status ? `${page.hint} · ${status}` : page.hint;
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
      el.open = true;
      el.classList.add('eod-page');
      el.classList.remove('eod-group');
      try { el.setAttribute('open', ''); } catch (_) { /* ignore */ }
    });

    document.getElementById('eodGroupNav')?.remove();
  }

  function go(id, opts) {
    const page = resolvePage(id);
    const prev = currentPage;
    currentPage = page;
    savePage(page);
    rememberTabPage(page);

    document.querySelectorAll('[data-eod-group]').forEach((el) => {
      const match = el.getAttribute('data-eod-group') === page;
      el.hidden = !match;
      el.classList.toggle('is-active-page', match);
      if (match && prev !== page) {
        el.classList.remove('eod-page-enter');
        void el.offsetWidth;
        el.classList.add('eod-page-enter');
      }
      if (el.tagName === 'DETAILS') el.open = match;
    });

    document.querySelectorAll('.eod-drawer-item[data-eod-page]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-eod-page') === page);
    });

    document.body.dataset.eodPage = page;
    syncChromeMeta();
    refreshDrawerHints();
    refreshTabBar();
    ensureBackButton(page);

    if (HUB_CARDS[page]) paintHub(page);

    if (page === 'crew-join') {
      paintCrewJoinQr();
    }

    if (parentOf(page) !== 'crew' && page !== 'crew') {
      if (window.EodTimesheetMgmt?.close && document.getElementById('eodTsMgmtOverlay')?.classList.contains('show')) {
        window.EodTimesheetMgmt.close({ fromNav: true });
      }
    }

    if ((page === 'pic' || page === 'signoff') && typeof window.EodPicQr?.refresh === 'function') {
      window.EodPicQr.refresh(false).catch(() => {});
    }

    if ((page === 'eod' || page === 'cover' || page === 'photos' || page === 'send' || page === 'signoff' || page === 'signoff-marks' || page === 'pic')
        && typeof window.EodCoverSync?.syncAll === 'function') {
      Promise.resolve(
        (page === 'pic' || page === 'signoff') && typeof window.EodPicQr?.refresh === 'function'
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
    const sendGroup = document.querySelector('[data-eod-group="send"] .eod-group-body')
      || document.querySelector('#eodGroupSend .eod-group-body');
    const actions = document.querySelector('.container > .button-group');
    if (!sendGroup || !actions || actions.dataset.eodMoved === '1') return;
    actions.dataset.eodMoved = '1';
    actions.classList.add('eod-send-actions');
    sendGroup.appendChild(actions);
  }

  function enrichInfoPage() {
    const materials = document.getElementById('materialsInfoSection');
    if (!materials) return;
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
    ensureTabBar();
    ensureExtraPages();
    convertDetailsToPages();
    moveSendActionsIntoSendPage();
    enrichInfoPage();
    labelOptionalPaperSignoff();
    enhanceKnownSelects();
    compactRoster();
    compactFredmeyer();
    compactManagers();
    compactStorePicker();
    watchInjected();
    ensureNextStepButtons();
    Object.keys(HUB_CARDS).forEach(paintHub);
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
    DRAWER_PAGES,
    SUBPAGES,
  };
  window.EodPicker = { open: openPicker, close: closePicker };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
