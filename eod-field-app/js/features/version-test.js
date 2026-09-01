/* Version badge + test mode (tap badge) + hotfix reload with durable save — live EOD style. */
(function (global) {
  'use strict';

  const EOD_TEST_MODE_KEY = 'eodTestMode';
  const EOD_FORCE_LIVE_KEY = 'eodForceLiveDelivery';
  const EOD_PENDING_VERSION_KEY = 'eodPendingHotfixVersion';
  const EOD_PENDING_AT_KEY = 'eodPendingHotfixAt';
  const EOD_SANDBOX_LAST_STORE_KEY = 'eodSandboxLastSourceStore';
  const EOD_SANDBOX_LAST_DATE_KEY = 'eodSandboxLastSourceDate';
  const EOD_TEST_KEEP_CURRENT_KEY = 'eodTestKeepCurrent';
  const EOD_TEST_SAVED_RECIPIENTS_KEY = 'eodTestSavedRecipients';
  const logic = global.EodTestModeLogic || {};
  const EOD_TEST_RECIPIENT = logic.DEFAULT_TEST_RECIPIENT || 'tyson.gauthier@retailodyssey.com';
  const EOD_TEST_STORE = logic.DEFAULT_TEST_STORE || '999';
  const EOD_TEST_LEAD_NAME = 'd6ewa.supervisor';
  const EOD_TEST_LEAD_EMAIL = 'd6ewa.supervisor@gmail.com';
  const UPDATE_AUTO_RELOAD_MS = 3500;
  const UPDATE_CHECK_MS = 30 * 1000;
  const UPDATE_RETRY_MS = 12000;

  let eodTestMode = false;
  let eodForceLiveDelivery = false;
  let autoReloadTimer = null;
  let longPressTimer = null;
  let updating = false;
  let cloningShift = false;

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
      if (global.EodRoles?.canForceLive) return !!global.EodRoles.canForceLive();
      const roles = global.EodRoles?.roles?.() || [];
      return roles.includes('admin') || roles.includes('supervisor');
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

  /** Pull whatever is currently in the store-999 sandbox (cloned shift, or
   * nothing yet) into session state — same GET /api/shifts the real Visit
   * screen uses, so the pilot exercises the real find-shifts path. */
  async function loadSandboxShiftIntoSession() {
    const S = global.EodSession;
    if (!S) return null;
    try {
      const resp = await global.authFetch(
        `${global.EOD_API_BASE}/api/shifts?store=${EOD_TEST_STORE}&date=${encodeURIComponent(S.state.workDate)}`
      );
      const data = await resp.json().catch(() => []);
      const shifts = Array.isArray(data) ? data : (data.shifts || []);
      S.patch({ shifts, selectedShift: shifts[0] || null }, 'test-shift');
      S.saveDraft();
      return shifts[0] || null;
    } catch (e) {
      console.warn('[test-mode] load sandbox shift', e);
      return null;
    }
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
    const shift = await loadSandboxShiftIntoSession();
    global.EodChrome?.refresh?.();
    if (shift) {
      toast(`Test mode ON — #${EOD_TEST_STORE}, mail → testers plus extras you add (unless LIVE).`, 'ok');
    } else {
      toast(`Test mode ON — #${EOD_TEST_STORE} has no cloned shift yet. Tap the version badge to clone one.`, 'info');
    }
    if (global.EodRouter) global.EodRouter.go('visit');
  }

  function hasLoadedShift() {
    const S = global.EodSession;
    if (logic.hasLoadedShift) return logic.hasLoadedShift(S?.state || {}, EOD_TEST_STORE);
    const store = String(S?.state?.storeNumber || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!store || store === EOD_TEST_STORE) return false;
    if (S.state.selectedShift?.visitId) return true;
    if (Array.isArray(S.state.sheet?.rows) && S.state.sheet.rows.length) return true;
    return false;
  }

  function stashRecipients() {
    const S = global.EodSession;
    try {
      sessionStorage.setItem(
        EOD_TEST_SAVED_RECIPIENTS_KEY,
        JSON.stringify(Array.isArray(S?.state?.emailRecipients) ? S.state.emailRecipients : [])
      );
    } catch (_) {}
  }

  function restoreRecipients() {
    const S = global.EodSession;
    if (!S) return;
    try {
      const raw = sessionStorage.getItem(EOD_TEST_SAVED_RECIPIENTS_KEY);
      if (!raw) return;
      const restored = JSON.parse(raw);
      if (Array.isArray(restored)) S.patch({ emailRecipients: restored }, 'clear-test');
    } catch (_) {}
  }

  function activateKeepCurrentTestMode() {
    const S = global.EodSession;
    stashRecipients();
    try { sessionStorage.setItem(EOD_TEST_KEEP_CURRENT_KEY, '1'); } catch (_) {}
    if (S) {
      S.patch({ emailRecipients: [EOD_TEST_RECIPIENT] }, 'test-keep-current');
      S.saveDraft();
    }
    setTestMode(true);
    toast(`Test mode ON — current shift kept. Mail → testers plus extras you add.`, 'ok');
  }

  function clearKeepCurrentFlags() {
    try {
      sessionStorage.removeItem(EOD_TEST_KEEP_CURRENT_KEY);
      sessionStorage.removeItem(EOD_TEST_SAVED_RECIPIENTS_KEY);
    } catch (_) {}
  }

  function isKeepCurrentTest() {
    try { return sessionStorage.getItem(EOD_TEST_KEEP_CURRENT_KEY) === '1'; }
    catch (_) { return false; }
  }

  function clearTestScenario() {
    const S = global.EodSession;
    if (!S) return;
    if (isKeepCurrentTest()) restoreRecipients();
    if (S.state.selectedShift?._testMock || String(S.state.selectedShift?.visitId || '').startsWith('test-')) {
      S.patch({ selectedShift: null, shifts: [] }, 'clear-test');
    }
    clearKeepCurrentFlags();
    toast('Test mode OFF — live recipients restored.', 'ok');
  }

  function setTestMode(enabled) {
    eodTestMode = !!enabled;
    if (eodTestMode) sessionStorage.setItem(EOD_TEST_MODE_KEY, '1');
    else sessionStorage.removeItem(EOD_TEST_MODE_KEY);
    if (!eodTestMode) setForceLive(false);
    applyUi();
  }

  // Tapping the badge to turn test mode ON now prompts for which real shift
  // to clone into the store-999 sandbox first (see openCloneModal below).
  // Tapping it OFF just tears down the local test scenario, same as before.
  function toggleTestMode() {
    if (eodTestMode) {
      setTestMode(false);
      clearTestScenario();
    } else if (hasLoadedShift()) {
      openTestModeChoiceModal();
    } else {
      openCloneModal();
    }
  }

  function ensureChoiceModal() {
    if (document.getElementById('eodTestModeChoiceModal')) return;
    const el = document.createElement('div');
    el.id = 'eodTestModeChoiceModal';
    el.className = 'modal-overlay';
    el.innerHTML = `
      <div class="modal-dialog" style="max-width:420px;">
        <h2 style="color:#93c5fd;">Test mode</h2>
        <div class="button-group" style="flex-wrap:wrap; gap:8px; margin-top:10px;">
          <button type="button" class="btn btn-primary" id="eodTestKeepCurrent">Keep current data</button>
          <button type="button" class="btn btn-secondary" id="eodTestCloneShift">Clone a new shift</button>
          <button type="button" class="btn btn-secondary" id="eodTestChoiceCancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeTestModeChoiceModal(); });
    document.getElementById('eodTestChoiceCancel').onclick = closeTestModeChoiceModal;
    document.getElementById('eodTestKeepCurrent').onclick = () => {
      closeTestModeChoiceModal();
      activateKeepCurrentTestMode();
    };
    document.getElementById('eodTestCloneShift').onclick = () => {
      closeTestModeChoiceModal();
      openCloneModal();
    };
  }

  function openTestModeChoiceModal() {
    ensureChoiceModal();
    document.getElementById('eodTestModeChoiceModal').classList.add('show');
  }

  function closeTestModeChoiceModal() {
    document.getElementById('eodTestModeChoiceModal')?.classList.remove('show');
  }

  // ─── Clone-shift sandbox prompt (tap badge while test mode is OFF) ────────

  function ensureCloneModal() {
    if (document.getElementById('eodSandboxCloneModal')) return;
    const el = document.createElement('div');
    el.id = 'eodSandboxCloneModal';
    el.className = 'modal-overlay';
    el.innerHTML = `
      <div class="modal-dialog" style="max-width:420px;">
        <h2 style="color:#93c5fd;">Clone a shift into sandbox #999</h2>
        <p class="sets-help" style="margin:0 0 12px;">Copies the roster, sets, and signoff sheet from a real, successful shift into store 999 — reset to not-started — so you can walk the whole app end to end.</p>
        <div class="field"><label for="eodSandboxSourceStore">Source store #</label>
          <input type="text" id="eodSandboxSourceStore" inputmode="numeric" placeholder="e.g. 19" style="width:100%;"></div>
        <div class="field"><label for="eodSandboxSourceDate">Source date (the successful shift)</label>
          <input type="date" id="eodSandboxSourceDate" style="width:100%;"></div>
        <div id="eodSandboxCloneStatus" class="muted" style="min-height:1.2em;margin:6px 0;"></div>
        <div class="button-group" style="flex-wrap:wrap; gap:8px; margin-top:10px;">
          <button type="button" class="btn btn-secondary" id="eodSandboxCancel">Cancel</button>
          <button type="button" class="btn btn-secondary" id="eodSandboxUseExisting">Skip — use last sandbox</button>
          <button type="button" class="btn btn-primary" id="eodSandboxCloneBtn">Clone &amp; start test mode</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeCloneModal(); });
    document.getElementById('eodSandboxCancel').onclick = closeCloneModal;
    document.getElementById('eodSandboxUseExisting').onclick = () => useExistingSandbox().catch(console.warn);
    document.getElementById('eodSandboxCloneBtn').onclick = () => runClone().catch(console.warn);
  }

  function openCloneModal() {
    ensureCloneModal();
    const S = global.EodSession;
    const storeInput = document.getElementById('eodSandboxSourceStore');
    const dateInput = document.getElementById('eodSandboxSourceDate');
    let lastStore = '';
    let lastDate = '';
    try {
      lastStore = localStorage.getItem(EOD_SANDBOX_LAST_STORE_KEY) || '';
      lastDate = localStorage.getItem(EOD_SANDBOX_LAST_DATE_KEY) || '';
    } catch (_) {}
    storeInput.value = lastStore;
    dateInput.value = lastDate || (S ? S.todayLocalIsoDate() : '');
    setCloneStatus('');
    setCloneBusy(false);
    document.getElementById('eodSandboxCloneModal').classList.add('show');
    setTimeout(() => storeInput.focus(), 30);
  }

  function closeCloneModal() {
    document.getElementById('eodSandboxCloneModal')?.classList.remove('show');
  }

  function setCloneStatus(msg, isError) {
    const el = document.getElementById('eodSandboxCloneStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#f87171' : '';
  }

  function setCloneBusy(busy) {
    cloningShift = busy;
    ['eodSandboxCloneBtn', 'eodSandboxUseExisting', 'eodSandboxCancel'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = busy;
    });
    const cloneBtn = document.getElementById('eodSandboxCloneBtn');
    if (cloneBtn) cloneBtn.textContent = busy ? 'Cloning…' : 'Clone & start test mode';
  }

  /** Flip test mode on and load whatever the sandbox currently holds, after
   * a clone completes (or when the user skips straight to an existing one). */
  async function activateSandboxTestMode() {
    clearKeepCurrentFlags();
    eodTestMode = true;
    sessionStorage.setItem(EOD_TEST_MODE_KEY, '1');
    applyUi();
    await setupTestScenario();
  }

  async function useExistingSandbox() {
    if (cloningShift) return;
    closeCloneModal();
    await activateSandboxTestMode();
  }

  async function runClone() {
    if (cloningShift) return;
    const sourceStore = (document.getElementById('eodSandboxSourceStore')?.value || '').trim();
    const sourceDate = (document.getElementById('eodSandboxSourceDate')?.value || '').trim();
    if (!sourceStore) {
      setCloneStatus('Enter the source store number.', true);
      return;
    }
    if (!sourceDate) {
      setCloneStatus('Pick the date of the successful shift.', true);
      return;
    }
    setCloneBusy(true);
    setCloneStatus('Cloning shift into sandbox #999…');
    try {
      const resp = await global.authFetch(`${global.EOD_API_BASE}/api/sandbox/clone-shift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceStore, sourceDate }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || `Clone failed (${resp.status})`);
      }
      try {
        localStorage.setItem(EOD_SANDBOX_LAST_STORE_KEY, sourceStore);
        localStorage.setItem(EOD_SANDBOX_LAST_DATE_KEY, sourceDate);
      } catch (_) {}
      closeCloneModal();
      await activateSandboxTestMode();
      toast(
        `Sandbox ready — store ${sourceStore} (${sourceDate}) → #999: ${data.memberCount} member(s), ${data.setCount} set(s).`,
        'ok'
      );
    } catch (err) {
      setCloneStatus(err.message || String(err), true);
    } finally {
      setCloneBusy(false);
    }
  }

  function isTestStore(store) {
    const digits = String(store == null ? '' : store).replace(/\D/g, '').replace(/^0+/, '') || '';
    return digits === EOD_TEST_STORE || eodTestMode;
  }

  function applyToPayload(payload) {
    if (logic.applyToPayload) {
      return logic.applyToPayload(payload, {
        testMode: eodTestMode,
        forceLive: eodForceLiveDelivery,
        testRecipient: EOD_TEST_RECIPIENT,
        testStore: EOD_TEST_STORE,
      });
    }
    const store = payload?.storeNumber || global.EodSession?.state?.storeNumber;
    if (!isTestStore(store)) return payload;
    if (eodForceLiveDelivery) {
      return { ...payload, forceLive: true, testMode: true, storeNumber: payload.storeNumber || EOD_TEST_STORE };
    }
    const extras = (Array.isArray(payload.recipients) ? payload.recipients : [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => e && !e.endsWith('@stores.fredmeyer.com'));
    return {
      ...payload,
      testMode: true,
      forceLive: false,
      storeNumber: payload.storeNumber || EOD_TEST_STORE,
      recipients: [...new Set([EOD_TEST_RECIPIENT, ...extras])],
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
    try { sessionStorage.setItem(EOD_PENDING_AT_KEY, String(Date.now())); } catch (_) {}

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

  function showUpdateBanner({ title, detail, remoteVersion, autoReload, autoReloadMs }) {
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
      }, autoReloadMs || UPDATE_AUTO_RELOAD_MS);
    }
  }

  async function fetchLiveVersion() {
    try {
      const resp = await fetch(`eod-version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
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
          sessionStorage.removeItem(EOD_PENDING_AT_KEY);
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
    let lastAt = 0;
    try {
      pending = sessionStorage.getItem(EOD_PENDING_VERSION_KEY);
      lastAt = Number(sessionStorage.getItem(EOD_PENDING_AT_KEY) || 0);
    } catch (_) {}
    const elapsed = lastAt ? Date.now() - lastAt : UPDATE_RETRY_MS;
    if (pending === remote && lastAt && elapsed < UPDATE_RETRY_MS) {
      showUpdateBanner({
        title: 'App update available',
        detail: `Server is v${remote} (you are on v${version()}). Drafts & photos stay on this device. Reloading automatically — or tap Update now.`,
        remoteVersion: remote,
        autoReload: true,
        autoReloadMs: UPDATE_RETRY_MS - elapsed,
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
      if (pending && pending === version()) {
        sessionStorage.removeItem(EOD_PENDING_VERSION_KEY);
        sessionStorage.removeItem(EOD_PENDING_AT_KEY);
      }
    } catch (_) {}

    checkVersion();
    setInterval(checkVersion, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkVersion();
    });
    window.addEventListener('pageshow', () => checkVersion());
    if (eodTestMode) {
      if (isKeepCurrentTest()) {
        const S = global.EodSession;
        if (S && !(S.state.emailRecipients || []).includes(EOD_TEST_RECIPIENT)) {
          S.patch({ emailRecipients: [EOD_TEST_RECIPIENT] }, 'test-keep-current');
        }
      } else {
        setTimeout(() => setupTestScenario().catch(console.warn), 400);
      }
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
    hasLoadedShift,
    activateKeepCurrentTestMode,
    checkVersion,
    hardNavigateForUpdate,
    EOD_TEST_RECIPIENT,
    EOD_TEST_STORE,
  };
  global.applyEodTestModeToPayload = applyToPayload;
  global.canEodForceLive = canForceLive;
  global.isEodForceLiveDelivery = () => eodForceLiveDelivery;
  global.confirmForceLiveIfNeeded = async function confirmForceLiveIfNeeded(label) {
    if (!eodForceLiveDelivery) return true;
    if (global.EodAlerts?.confirm) {
      return global.EodAlerts.confirm('Live delivery', `LIVE delivery override is ON for "${label}". Continue?`);
    }
    return confirm(`LIVE delivery override is ON for "${label}". Continue?`);
  };
  global.showDayConfirmModal = function showDayConfirmModal() {
    if (global.showAlert) {
      global.showAlert('Confirm store', 'Confirm today\'s store on Visit first.');
    }
    if (global.EodRouter?.go) global.EodRouter.go('visit');
  };
})(typeof window !== 'undefined' ? window : globalThis);
