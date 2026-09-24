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

  async function hydrateRemoteShift() {
    const S = window.EodSession;
    if (!S?.isVisitReady?.()) return;
    try { await window.EodTeamSession?.hydrate?.(S); } catch (err) {
      console.warn('[eod-field-app] team session hydrate', err);
    }
    try { await window.EodVisitMirror?.hydrate?.(S); } catch (err) {
      console.warn('[eod-field-app] visit mirror hydrate', err);
    }
    try {
      if (window.EodTeamSession?.hydrateThumbs && S.state.photos) {
        await window.EodTeamSession.hydrateThumbs(S.state.photos);
      }
    } catch (_) {}
  }

  function repaintAfterHydrate() {
    try { window.EodChrome?.refresh?.(); } catch (_) {}
    /* Visit is the only first-paint screen showing remote photo thumbs, so it
       is the only one worth re-running. Never stomp an in-progress edit. */
    if (window.EodRouter?.current !== 'visit') return;
    const el = document.activeElement;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    try { void window.EodRouter.render(); } catch (_) {}
  }

  /* Runs after the shell is on screen. Each step repaints what it fills in,
     so a slow store connection delays detail rather than the whole app. */
  async function hydrateAfterPaint() {
    try { await window.EodApi?.ensurePersistentStorage?.(); } catch (_) {}
    try { await window.EodRoles?.load?.(); } catch (_) {}
    try {
      const me = window.EodRoles?.getMe?.();
      const authName = String(me?.name || '').trim();
      const S = window.EodSession;
      if (authName && S && !(S.state.profileName || '').trim()) {
        S.patch({ profileName: authName, leadName: S.state.leadName || authName }, 'auth-lead');
      }
    } catch (_) {}

    await loadPhotosIntoSession();
    await hydrateRemoteShift();
    repaintAfterHydrate();

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

    try { await window.EodDeviceStorage?.purgeInBackground?.(); } catch (_) {}
  }

  async function boot() {
    try {
      try { window.EodChrome?.bindNav?.(); } catch (_) {}
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

      try { window.EodBusy?.init?.(); } catch (_) {}
      try { window.EodShiftDay?.prefetchToday?.(); } catch (_) {}
      try { window.EodFeedbackHub?.init?.(); } catch (_) {}
      try { window.EodFieldAlerts?.init?.(); } catch (err) { console.warn('[eod-field-app] field alerts', err); }

      patchPortedModules();
      try { window.EodDurability?.startAutosave?.(); } catch (_) {}
      try { window.EodTheme?.init?.(); } catch (err) { console.warn('[eod-field-app] theme init', err); }
      try { window.EodChrome.init(); } catch (err) { console.warn('[eod-field-app] chrome init', err); }
      try { window.EodCoverNotes?.init?.(window.EodSession); } catch (err) { console.warn('[eod-field-app] cover notes', err); }
      try { window.EodLandscapeSigPad?.forceClose?.(); } catch (_) {}
      try { window.EodSwipeNav?.init?.(); } catch (err) { console.warn('[eod-field-app] swipe nav', err); }
      try { window.EodVisitMirror?.init?.(); } catch (err) { console.warn('[eod-field-app] visit mirror', err); }
      try { window.EodTeamSession?.init?.(); } catch (err) { console.warn('[eod-field-app] team session', err); }
      try { window.EodShiftPhotoSync?.init?.(); } catch (err) { console.warn('[eod-field-app] photo sync', err); }
      try { window.EodStoreProdWarm?.start?.(); } catch (err) { console.warn('[eod-field-app] prod warm', err); }
      try { window.EodConnections?.init?.(); } catch (err) { console.warn('[eod-field-app] connections init', err); }
      try { window.EodSasBeacon?.start?.(); } catch (err) { console.warn('[eod-field-app] sas beacon', err); }
      try { window.EodTestMode?.init?.(); } catch (err) { console.warn('[eod-field-app] version/test init', err); }
      /* First paint. Everything past this point runs against a live screen,
         so nothing below may block on the network. */
      window.EodRouter.init();
      /* Legacy before-photo keys are huge. Delete them after the visit
         screen is up, one key per turn, so the nav is not the only thing
         that paints. */
      try {
        const keys = window.EodSetBeforeStore?.legacyBeforeKeys?.() || [];
        const step = () => {
          const k = keys.shift();
          if (!k) return;
          try { localStorage.removeItem(k); } catch (_) {}
          if (keys.length) setTimeout(step, 0);
          else if (window.EodDiag?.note) window.EodDiag.note('set-store.legacy-purge', 'deferred');
        };
        if (keys.length) setTimeout(step, 0);
      } catch (_) {}
      try {
        const choosingPriorDay = window.EodVisit?.presentPriorDayChoice?.();
        if (!choosingPriorDay) window.EodVisit?.enforceDayConfirmGate?.();
      } catch (_) {}
      try {
        if ('serviceWorker' in navigator && /the-dump-bin\.com$/i.test(location.hostname || '')) {
          const hadController = !!navigator.serviceWorker.controller;
          navigator.serviceWorker.register('sw.js?v=3.4.98').catch(() => {});
          if (hadController && !navigator.serviceWorker._eodControllerBound) {
            navigator.serviceWorker._eodControllerBound = true;
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              if (reloading) return;
              try {
                if (sessionStorage.getItem('eodSwReloaded') === '1') return;
                sessionStorage.setItem('eodSwReloaded', '1');
              } catch (_) {}
              reloading = true;
              location.reload();
            });
          }
        }
      } catch (_) {}
      try { window.EodUsage?.start?.(); } catch (_) {}
      // helpdesk is here because Categories needs askToReportNotInStore from it.
      try { window.EodRouteBundles?.prefetchIdle?.(['survey', 'send', 'helpdesk']); } catch (_) {}
      try { window.EodPhotoPipeline?.warmCompressWorker?.(); } catch (_) {}

      void hydrateAfterPaint();

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          try { window.EodSession.saveDraft(); } catch (_) {}
          try { window.EodDevicePhotoFlush?.persistOpen?.(); } catch (_) {}
        } else {
          try { window.EodDeviceStorage?.purgeInBackground?.(); } catch (_) {}
          try { void window.EodDevicePhotoFlush?.flushCurrentStore?.(); } catch (_) {}
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
          <button type="button" class="btn btn-primary" id="bootReloadBtn">Reload</button></div>`;
        document.getElementById('bootReloadBtn')?.addEventListener('click', () => {
          location.hash = '#/visit';
          location.reload();
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();


