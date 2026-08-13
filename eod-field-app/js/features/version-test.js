/* Version badge + test mode (tap badge) + hotfix reload with durable save — live EOD style. */
(function (global) {
  'use strict';

  const EOD_TEST_MODE_KEY = 'eodTestMode';
  const EOD_FORCE_LIVE_KEY = 'eodForceLiveDelivery';
  const EOD_PENDING_VERSION_KEY = 'eodPendingVersion';
  const EOD_TEST_RECIPIENT = 'tyson.gauthier@retailodyssey.com';
  const EOD_TEST_STORE = '999';
  const EOD_TEST_LEAD_NAME = 'd6ewa.supervisor';
  const EOD_TEST_LEAD_EMAIL = 'd6ewa.supervisor@gmail.com';
  const UPDATE_AUTO_RELOAD_MS = 8000;

  let eodTestMode = false;
  let eodForceLiveDelivery = false;
  let autoReloadTimer = null;
  let longPressTimer = null;

  function version() {
    return global.EOD_APP_VERSION || '0.0.0';
  }

  function applyUi() {
    document.body.classList.toggle('eod-test-mode', eodTestMode);
    document.querySelectorAll('.eod-test-banner').forEach((el) => {
      el.classList.toggle('visible', eodTestMode);
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
    global.EodConnections?.toast?.(
      `Test mode ON — #${EOD_TEST_STORE}, mail → ${EOD_TEST_RECIPIENT} only (unless LIVE).`,
      'ok'
    );
    if (global.EodRouter) global.EodRouter.go('visit');
  }

  function clearTestScenario() {
    // Leave drafts alone — only drop test mock shift if present.
    const S = global.EodSession;
    if (!S) return;
    if (S.state.selectedShift?._testMock || String(S.state.selectedShift?.visitId || '').startsWith('test-')) {
      S.patch({ selectedShift: null, shifts: [] }, 'clear-test');
    }
    global.EodConnections?.toast?.('Test mode OFF — live recipients restored.', 'ok');
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

  async function hardNavigateForUpdate(remoteVersion) {
    try { global.EodSession?.saveDraft(); } catch (_) {}
    if (global.EodDurability?.awaitDurablePhotoSave) {
      const saved = await global.EodDurability.awaitDurablePhotoSave('update');
      if (!saved) {
        showUpdateBanner({
          title: 'Update blocked',
          detail: 'Photos could not be saved to this device. Free storage, then tap Update again. Your work is still on screen.',
          remoteVersion,
          autoReload: false,
        });
        return;
      }
    }
    const ver = remoteVersion || String(Date.now());
    try { sessionStorage.setItem(EOD_PENDING_VERSION_KEY, ver); } catch (_) {}
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('eodv', ver);
      u.searchParams.set('_', String(Date.now()));
      u.hash = location.hash || '#/visit';
      window.location.replace(u.toString());
    } catch (_) {
      location.reload();
    }
  }

  function showUpdateBanner({ title, detail, remoteVersion, autoReload }) {
    const banner = document.getElementById('updateBanner');
    if (!banner) return;
    banner.hidden = false;
    banner.innerHTML = `<strong>${title}</strong> <span style="font-weight:500">${detail}</span>
      <button type="button" class="btn btn-secondary" id="eodUpdateNowBtn" style="margin-left:8px;min-height:32px;padding:4px 10px;">Update</button>
      <button type="button" class="btn btn-secondary" id="eodUpdateLaterBtn" style="margin-left:4px;min-height:32px;padding:4px 10px;">Later</button>`;
    document.getElementById('eodUpdateNowBtn').onclick = () => hardNavigateForUpdate(remoteVersion);
    document.getElementById('eodUpdateLaterBtn').onclick = () => {
      if (autoReloadTimer) clearTimeout(autoReloadTimer);
      banner.hidden = true;
    };
    if (autoReload) {
      if (autoReloadTimer) clearTimeout(autoReloadTimer);
      autoReloadTimer = setTimeout(() => hardNavigateForUpdate(remoteVersion), UPDATE_AUTO_RELOAD_MS);
    }
  }

  async function checkVersion() {
    try {
      const resp = await fetch(`eod-version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      const remote = data?.version ? String(data.version).trim() : null;
      if (!remote || remote === version()) {
        const banner = document.getElementById('updateBanner');
        if (banner && !banner.querySelector('#eodUpdateNowBtn')) banner.hidden = true;
        return;
      }
      showUpdateBanner({
        title: 'App update available',
        detail: `Server is v${remote} (you are on v${version()}). Drafts & photos stay on this device.`,
        remoteVersion: remote,
        autoReload: true,
      });
    } catch (_) {}
  }

  function bindBadge() {
    const badge = document.getElementById('eodVersionBadge');
    if (!badge) return;
    let longPressFired = false;
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (longPressFired) {
        longPressFired = false;
        return;
      }
      toggleTestMode();
    });
    badge.addEventListener('pointerdown', () => {
      longPressFired = false;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        hardNavigateForUpdate('force-' + Date.now());
      }, 700);
    });
    const clearLp = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    badge.addEventListener('pointerup', clearLp);
    badge.addEventListener('pointerleave', clearLp);
    badge.addEventListener('pointercancel', clearLp);
  }

  function init() {
    eodTestMode = sessionStorage.getItem(EOD_TEST_MODE_KEY) === '1';
    eodForceLiveDelivery = eodTestMode && sessionStorage.getItem(EOD_FORCE_LIVE_KEY) === '1';
    applyUi();
    bindBadge();
    document.getElementById('eodForceLiveCb')?.addEventListener('change', (e) => {
      setForceLive(e.target.checked);
    });
    checkVersion();
    setInterval(checkVersion, 5 * 60 * 1000);
    if (eodTestMode) setupTestScenario().catch(console.warn);
  }

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
