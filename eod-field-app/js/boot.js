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
      try { await window.EodDeviceStorage?.purgeInBackground?.(); } catch (_) {}
      try { window.EodBusy?.init?.(); } catch (_) {}
      try { await window.EodRoles?.load?.(); } catch (_) {}
      try { window.EodShiftDay?.prefetchToday?.(); } catch (_) {}
      try {
        const me = window.EodRoles?.getMe?.();
        const authName = String(me?.name || '').trim();
        const S = window.EodSession;
        if (authName && S && !(S.state.profileName || '').trim()) {
          S.patch({ profileName: authName, leadName: S.state.leadName || authName }, 'auth-lead');
        }
      } catch (_) {}
      try { window.EodFeedbackHub?.init?.(); } catch (_) {}

      patchPortedModules();
      try { window.EodDurability?.startAutosave?.(); } catch (_) {}
      try { window.EodTheme?.init?.(); } catch (err) { console.warn('[eod-field-app] theme init', err); }
      try { window.EodChrome.init(); } catch (err) { console.warn('[eod-field-app] chrome init', err); }
      try { window.EodCoverNotes?.init?.(window.EodSession); } catch (err) { console.warn('[eod-field-app] cover notes', err); }
      try { window.EodLandscapeSigPad?.forceClose?.(); } catch (_) {}
      try { window.EodSwipeNav?.init?.(); } catch (err) { console.warn('[eod-field-app] swipe nav', err); }
      try { window.EodShiftPhotoSync?.init?.(); } catch (err) { console.warn('[eod-field-app] photo sync', err); }
      try { window.EodConnections?.init?.(); } catch (err) { console.warn('[eod-field-app] connections init', err); }
      try { window.EodTestMode?.init?.(); } catch (err) { console.warn('[eod-field-app] version/test init', err); }
      await loadPhotosIntoSession();
      window.EodRouter.init();
      try { window.EodVisit?.enforceDayConfirmGate?.(); } catch (_) {}
      try {
        if ('serviceWorker' in navigator && /the-dump-bin\.com$/i.test(location.hostname || '')) {
          navigator.serviceWorker.register('sw.js?v=3.3.43').catch(() => {});
        }
      } catch (_) {}
      try { window.EodUsage?.start?.(); } catch (_) {}

      if (window.EodSession.isVisitReady() && window.EodSignoffHome?.loadSheet) {
        try {
          const S = window.EodSession;
          if (!S.state.sheet && window.EodGarden?.loadSheetSnapshot) {
            const snap = await window.EodGarden.loadSheetSnapshot(S.state.storeNumber, S.state.fiscalWeek);
            if (snap) S.patch({ sheet: snap, sheetLoaded: true, fiscalWeek: snap.fiscalWeek || S.state.fiscalWeek }, 'sheet-garden');
          }
          await window.EodSignoffHome.loadSheet();
          window.EodChrome.refresh();
        } catch (_) {}
      }

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          try { window.EodSession.saveDraft(); } catch (_) {}
        } else {
          try { window.EodDeviceStorage?.purgeInBackground?.(); } catch (_) {}
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
