/* Version badge + test mode (tap badge) + hotfix reload with durable save — live EOD style. */
(function (global) {
  'use strict';

  const EOD_TEST_MODE_KEY = 'eodTestMode';
  const EOD_FORCE_LIVE_KEY = 'eodForceLiveDelivery';
  const EOD_PENDING_VERSION_KEY = 'eodPendingHotfixVersion';
  const EOD_TEST_RECIPIENT = 'tyson.gauthier@retailodyssey.com';
  const EOD_TEST_STORE = '999';
  const EOD_TEST_LEAD_NAME = 'd6ewa.supervisor';
  const EOD_TEST_LEAD_EMAIL = 'd6ewa.supervisor@gmail.com';
  const UPDATE_AUTO_RELOAD_MS = 3500;
  const UPDATE_CHECK_MS = 2 * 60 * 1000;

  let eodTestMode = false;
  let eodForceLiveDelivery = false;
  let autoReloadTimer = null;
  let longPressTimer = null;
  let updating = false;

  function version() {
    return global.EOD_APP_VERSION || '0.0.0';
  }

  function toast(msg, kind) {
    if (global.EodConnections?.toast) global.EodConnections.toast(msg, kind || 'info');
  }

  function applyUi() {
    document.body.classList.toggle('eod-test-mode', eodTestMode);
    document.querySelectorAll('.eod-test-banner').forEach((el) => {
      el.classList.toggle('visible', eodTestMode);
      el.setAttribute('aria-hidden', eodTestMode ? 'false' : 'true');
    });
    const badge = document.getElementById('eodVersionBadge');
    if (badge) {
      badge.classList.toggle('eod-test-mode-active', eodTestMode);
      if (eodTestMode && eodForceLiveDelivery) badge.textContent = `TEST LIVE v${version()}`;
      else if (eodTestMode) badge.textContent = `TEST v${version()}`;
      else badge.textContent = `v${version()}`;
      badge.title = eodTestMode
        ? (eodForceLiveDelivery
          ? 'Test mode ON · LIVE delivery — tap to turn off · long-press to force Update'
          : 'Test mode ON (emails → tester only) — tap to turn off · long-press to force Update')
        : 'Tap to turn on test mode · long-press to force Update';
    }
    const forceRow = document.getElementById('eodForceLiveRow');
    if (forceRow) forceRow.hidden = !eodTestMode;
    const forceCb = document.getElementById('eodForceLiveCb');
    if (forceCb) forceCb.checked = eodForceLiveDelivery;
  }

  function canForceLive() {
    try {
      const email = (global.EodSession?.state?.profileEmail || '').toLowerCase();
      return email.includes('gauthier') || email.includes('d6ewa.supervisor');
    } catch (_) {
      return false;
    }
  }

  function setForceLive(enabled) {
    eodForceLiveDelivery = !!(enabled && eodTestMode && canForceLive());
    if (eodForceLiveDelivery) sessionStorage.setItem(EOD_FORCE_LIVE_KEY, '1');
    else sessionStorage.removeItem(EOD_FORCE_LIVE_KEY);
    try { localStorage.removeItem(EOD_FORCE_LIVE_KEY); } catch (_) {}
    applyUi();
  }

  async function setupTestScenario() {
    const S = global.EodSession;
    if (!S) return;
    S.patch({
      storeNumber: EOD_TEST_STORE,
      workDate: S.state.workDate || S.todayLocalIsoDate(),
      profileName: EOD_TEST_LEAD_NAME,
      profileEmail: EOD_TEST_LEAD_EMAIL,
      leadName: EOD_TEST_LEAD_NAME,
      leadEmail: EOD_TEST_LEAD_EMAIL,
      emailRecipients: [EOD_TEST_RECIPIENT],
    }, 'test-mode');
    S.saveProfile();
    S.saveDraft();
    try {
      const resp = await global.authFetch(`${global.EOD_API_BASE}/api/verify-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeNumber: EOD_TEST_STORE, date: S.state.workDate }),
      });
      const result = await resp.json().catch(() => ({}));
      if (resp.ok && result.ok && result.token) {
        S.persistDayConfirm({
          token: result.token,
          store: EOD_TEST_STORE,
          date: S.state.workDate,
          expiresInMs: result.expiresInMs,
        });
      }
    } catch (e) {
      console.warn('[test-mode] verify-store', e);
    }
    const mock = {
      visitId: 'test-visit-999',
      storeNumber: '999',
      projectName: 'Kompass ISE (TEST)',
      visitLead: EOD_TEST_LEAD_NAME,
      currentStatus: 'in-progress',
      totalHours: 8,
      empCount: 3,
      _testMock: true,
    };
    S.patch({ shifts: [mock], selectedShift: mock }, 'test-shift');
    S.saveDraft();
    global.EodChrome?.refresh?.();
    toast(`Test mode ON — #${EOD_TEST_STORE}, mail → ${EOD_TEST_RECIPIENT} only (unless LIVE).`, 'ok');
    if (global.EodRouter) global.EodRouter.go('visit');
  }

  function clearTestScenario() {
    const S = global.EodSession;
    if (!S) return;
    if (S.state.selectedShift?._testMock || String(S.state.selectedShift?.visitId || '').startsWith('test-')) {
      S.patch({ selectedShift: null, shifts: [] }, 'clear-test');
    }
    toast('Test mode OFF — live recipients restored.', 'ok');
  }

  function setTestMode(enabled) {
    eodTestMode = !!enabled;
    if (eodTestMode) sessionStorage.setItem(EOD_TEST_MODE_KEY, '1');
    else sessionStorage.removeItem(EOD_TEST_MODE_KEY);
    if (!eodTestMode) setForceLive(false);
    applyUi();
    if (eodTestMode) setupTestScenario().catch(console.warn);
    else clearTestScenario();
  }

  function toggleTestMode() {
    setTestMode(!eodTestMode);
  }

  function isTestStore(store) {
    const digits = String(store == null ? '' : store).replace(/\D/g, '').replace(/^0+/, '') || '';
    return digits === EOD_TEST_STORE || eodTestMode;
  }

  function applyToPayload(payload) {
    const store = payload?.storeNumber || global.EodSession?.state?.storeNumber;
    if (!isTestStore(store)) return payload;
    if (eodForceLiveDelivery) {
      return { ...payload, forceLive: true, testMode: true, storeNumber: payload.storeNumber || EOD_TEST_STORE };
    }
    return {
      ...payload,
      testMode: true,
      forceLive: false,
      storeNumber: payload.storeNumber || EOD_TEST_STORE,
      recipients: [EOD_TEST_RECIPIENT],
      subject: payload.subject && !/^\[TEST\]/i.test(payload.subject)
        ? `[TEST] ${payload.subject}`
        : payload.subject,
    };
  }

  function setUpdateBusy(busy, label) {
    updating = !!busy;
    const btn = document.getElementById('eodUpdateNowBtn');
    if (btn) {
      btn.disabled = updating;
      if (label) btn.textContent = label;
      else if (!updating) btn.textContent = 'Update';
    }
    const badge = document.getElementById('eodVersionBadge');
    if (badge) badge.classList.toggle('updating', updating);
  }

  async function hardNavigateForUpdate(remoteVersion) {
    if (updating) return;
    if (autoReloadTimer) {
      clearTimeout(autoReloadTimer);
      autoReloadTimer = null;
    }
    setUpdateBusy(true, 'Saving…');
    toast('Saving draft & photos, then reloading…', 'ok');

    try { global.EodSession?.saveDraft(); } catch (_) {}

    let saved = true;
    if (global.EodDurability?.awaitDurablePhotoSave) {
      saved = await global.EodDurability.awaitDurablePhotoSave('update', { timeoutMs: 8000 });
    }
    if (!saved) {
      setUpdateBusy(false, 'Update');
      showUpdateBanner({
        title: 'Update blocked',
        detail: 'Photos could not be saved to this device. Free storage, then tap Update again. Your work is still on screen.',
        remoteVersion,
        autoReload: false,
      });
      return;
    }

    const ver = remoteVersion || ('force-' + Date.now());
    try { sessionStorage.setItem(EOD_PENDING_VERSION_KEY, ver); } catch (_) {}

    // Persist route so we can restore after a hash-less reload (iOS cache bust).
    try {
      const hash = (location.hash || '#/visit').replace(/^#/, '');
      sessionStorage.setItem('eodReturnHash', hash.startsWith('/') ? hash : '/' + hash);
    } catch (_) {}

    setUpdateBusy(true, 'Reloading…');
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('eodv', ver);
      u.searchParams.set('_', String(Date.now()));
      // Critical: drop hash so iOS Safari / GH Pages do not reuse a sticky document.
      u.hash = '';
      window.location.replace(u.toString());
      // Fallback if replace is a no-op in a stuck WebView
      setTimeout(() => {
        try { window.location.reload(); } catch (_) {}
      }, 1500);
    } catch (_) {
      window.location.reload();
    }
  }

  function showUpdateBanner({ title, detail, remoteVersion, autoReload }) {
    const banner = document.getElementById('updateBanner');
    if (!banner) {
      // Last resort — still allow force navigate
      if (autoReload) void hardNavigateForUpdate(remoteVersion);
      return;
    }
    banner.hidden = false;
    banner.classList.add('visible');
    banner.innerHTML =
      `<div class="eod-update-banner-text"><strong>${title}</strong>`
      + `<div class="eod-update-banner-detail">${detail}</div></div>`
      + `<div class="eod-update-banner-actions">`
      + `<button type="button" class="eod-btn-update" id="eodUpdateNowBtn">Update</button>`
      + `<button type="button" class="eod-btn-later" id="eodUpdateLaterBtn">Later</button>`
      + `</div>`;

    const updateBtn = document.getElementById('eodUpdateNowBtn');
    const laterBtn = document.getElementById('eodUpdateLaterBtn');
    if (remoteVersion && updateBtn) updateBtn.dataset.remoteVersion = remoteVersion;

    updateBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void hardNavigateForUpdate(updateBtn.dataset.remoteVersion || remoteVersion);
    };
    laterBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (autoReloadTimer) {
        clearTimeout(autoReloadTimer);
        autoReloadTimer = null;
      }
      banner.hidden = true;
      banner.classList.remove('visible');
    };

    if (autoReload) {
      if (autoReloadTimer) clearTimeout(autoReloadTimer);
      autoReloadTimer = setTimeout(() => {
        void hardNavigateForUpdate(remoteVersion);
      }, UPDATE_AUTO_RELOAD_MS);
    }
  }

  async function fetchLiveVersion() {
    try {
      const resp = await fetch(`eod-version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.version ? String(data.version).trim() : null;
    } catch (_) {
      return null;
    }
  }

  async function checkVersion() {
    const remote = await fetchLiveVersion();
    if (!remote || remote === version()) {
      try {
        const pending = sessionStorage.getItem(EOD_PENDING_VERSION_KEY);
        if (pending && (pending === remote || pending === version() || String(pending).startsWith('force-'))) {
          sessionStorage.removeItem(EOD_PENDING_VERSION_KEY);
        }
      } catch (_) {}
      const banner = document.getElementById('updateBanner');
      if (banner && !updating) {
        banner.hidden = true;
        banner.classList.remove('visible');
      }
      return;
    }

    let pending = null;
    try { pending = sessionStorage.getItem(EOD_PENDING_VERSION_KEY); } catch (_) {}
    if (pending === remote) {
      // Already reloaded once; HTML/JS still stale (CDN/browser cache).
      showUpdateBanner({
        title: 'Update ready',
        detail: `This phone is still on v${version()} (server is v${remote}). Drafts & photos stay here. Tap Update, or hard-refresh if it loops.`,
        remoteVersion: remote,
        autoReload: false,
      });
      return;
    }

    showUpdateBanner({
      title: 'App update available',
      detail: `Server is v${remote} (you are on v${version()}). Drafts & photos stay on this device. Reloading automatically — or tap Update now.`,
      remoteVersion: remote,
      autoReload: true,
    });
  }

  function restoreHashAfterUpdate() {
    try {
      const u = new URL(window.location.href);
      const hadBust = u.searchParams.has('eodv') || u.searchParams.has('_');
      const retRaw = sessionStorage.getItem('eodReturnHash');
      if (!hadBust && !retRaw) return;
      const ret = (retRaw || '/visit').startsWith('/') ? (retRaw || '/visit') : '/' + (retRaw || 'visit');
      sessionStorage.removeItem('eodReturnHash');
      u.searchParams.delete('eodv');
      u.searchParams.delete('_');
      const qs = u.searchParams.toString();
      const clean = u.pathname + (qs ? '?' + qs : '') + '#' + ret;
      history.replaceState(null, '', clean);
    } catch (_) {}
  }

  function bindBadge() {
    const badge = document.getElementById('eodVersionBadge');
    if (!badge) return;
    let longPressFired = false;

    const clearLp = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (longPressFired) {
        longPressFired = false;
        return;
      }
      toggleTestMode();
    });
    badge.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      longPressFired = false;
      clearLp();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        toast('Force Update — saving then reloading…', 'ok');
        void hardNavigateForUpdate('force-' + Date.now());
      }, 650);
      if (e.cancelable) e.preventDefault();
    });
    badge.addEventListener('pointerup', clearLp);
    badge.addEventListener('pointerleave', clearLp);
    badge.addEventListener('pointercancel', clearLp);
    badge.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function init() {
    eodTestMode = sessionStorage.getItem(EOD_TEST_MODE_KEY) === '1';
    eodForceLiveDelivery = eodTestMode && sessionStorage.getItem(EOD_FORCE_LIVE_KEY) === '1';
    restoreHashAfterUpdate();
    applyUi();
    bindBadge();
    document.getElementById('eodForceLiveCb')?.addEventListener('change', (e) => {
      setForceLive(e.target.checked);
    });

    try {
      const pending = sessionStorage.getItem(EOD_PENDING_VERSION_KEY);
      if (pending && pending === version()) sessionStorage.removeItem(EOD_PENDING_VERSION_KEY);
    } catch (_) {}

    checkVersion();
    setInterval(checkVersion, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkVersion();
    });
    if (eodTestMode) {
      setTimeout(() => setupTestScenario().catch(console.warn), 400);
    }
  }

  global.forceEodAppUpdate = function forceEodAppUpdate() {
    void hardNavigateForUpdate('force-' + Date.now());
  };

  global.EodTestMode = {
    init,
    isEnabled: () => eodTestMode,
    isForceLive: () => eodForceLiveDelivery,
    setTestMode,
    toggleTestMode,
    applyToPayload,
    checkVersion,
    hardNavigateForUpdate,
    EOD_TEST_RECIPIENT,
    EOD_TEST_STORE,
  };
  global.applyEodTestModeToPayload = applyToPayload;
})(typeof window !== 'undefined' ? window : globalThis);
