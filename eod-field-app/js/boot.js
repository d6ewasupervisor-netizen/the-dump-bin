/* Boot eod-field-app. */
(function () {
  'use strict';

  function ensureHiddenBridges() {
    if (document.getElementById('storeNumber')) return;
    const bridge = document.createElement('div');
    bridge.className = 'hidden-bridge';
    bridge.setAttribute('aria-hidden', 'true');
    bridge.innerHTML = `
      <input type="text" id="storeNumber">
      <input type="date" id="workDate">
      <input type="text" id="profileName">
      <input type="email" id="profileEmail">
      <input type="hidden" id="leadName">
      <input type="hidden" id="leadEmail">
      <div id="eodSignoffGroupBody"></div>
      <div class="signature-section"></div>
      <div id="signoffPhotoSection"></div>
      <div id="smSection"></div>
      <div id="smMembersList"></div>
      <select id="smAddSelect"></select>
      <select id="smRemoveSelect"></select>
    `;
    document.body.appendChild(bridge);
  }

  function patchPortedModules() {
    if (!globalThis.openMaterialsBrowser && globalThis.EodMaterialsBrowser?.open) {
      globalThis.openMaterialsBrowser = () => globalThis.EodMaterialsBrowser.open();
    }
  }

  async function loadPhotosIntoSession() {
    const S = window.EodSession;
    if (!window.PhotoDB || !S?.isVisitReady()) return;
    try {
      if (window.PhotoDB.switchToDayConfirm) {
        await window.PhotoDB.switchToDayConfirm(S.state.storeNumber, S.state.workDate, S.state.photos);
      } else if (window.PhotoDB.loadPhotos) {
        const loaded = await window.PhotoDB.loadPhotos();
        if (loaded) S.patch({ photos: loaded }, 'photos');
      }
    } catch (err) {
      console.warn('[eod-field-app] photo load', err);
    }
  }

  async function boot() {
    try {
      const verEl = document.getElementById('pilotVer');
      if (verEl && window.EOD_APP_VERSION) verEl.textContent = window.EOD_APP_VERSION;

      document.body.classList.remove('needs-auth');
      const signIn = document.getElementById('pilotSignIn');
      if (signIn && window.dumpBinGetSession?.()) signIn.hidden = true;

      ensureHiddenBridges();
      window.EodSession.loadDraft();
      window.EodSession.syncDomBridges();

      try {
        if (window.EodPhotoSessions?.createPhotoDB) {
          window.PhotoDB = window.EodPhotoSessions.createPhotoDB({
            getActiveDayConfirm: () => window.EodSession?.getActiveDayConfirm?.() || null,
          });
        }
      } catch (err) {
        console.warn('[eod-field-app] PhotoDB init failed', err);
      }

      try { await window.EodApi?.ensurePersistentStorage?.(); } catch (_) {}
      try { await window.EodRoles?.load?.(); } catch (_) {}
      try { window.EodFeedbackHub?.init?.(); } catch (_) {}

      patchPortedModules();
      try { window.EodDurability?.startAutosave?.(); } catch (_) {}
      try { window.EodTheme?.init?.(); } catch (err) { console.warn('[eod-field-app] theme init', err); }
      try { window.EodChrome.init(); } catch (err) { console.warn('[eod-field-app] chrome init', err); }
      try { window.EodConnections?.init?.(); } catch (err) { console.warn('[eod-field-app] connections init', err); }
      try { window.EodTestMode?.init?.(); } catch (err) { console.warn('[eod-field-app] version/test init', err); }
      await loadPhotosIntoSession();
      window.EodRouter.init();
      try { window.EodUsage?.start?.(); } catch (_) {}

      if (window.EodSession.isVisitReady() && window.EodSignoffHome?.loadSheet) {
        try {
          await window.EodSignoffHome.loadSheet();
          window.EodChrome.refresh();
        } catch (_) {}
      }

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          try { window.EodSession.saveDraft(); } catch (_) {}
        }
      });
      window.addEventListener('beforeunload', () => {
        try { window.EodSession.saveDraft(); } catch (_) {}
      });
    } catch (err) {
      console.error('[eod-field-app] boot failed', err);
      const mount = document.getElementById('appMount');
      if (mount) {
        mount.innerHTML = `<div class="card error"><h2>App failed to start</h2><p>${window.EodApi?.escapeHtml?.(err.message) || String(err)}</p>
          <button type="button" class="btn btn-primary" onclick="location.hash='#/visit';location.reload()">Reload</button></div>`;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
