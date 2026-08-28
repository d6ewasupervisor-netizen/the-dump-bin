/* SAS + Rebotics (SI) connection lights + refresh — matches live EOD protocols. */
(function (global) {
  'use strict';

  const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
  const REFRESH_COOLDOWN_KEY = 'kompassAuthRefreshLastClickAt';
  const POLL_MS = 30 * 1000;

  let pollTimer = null;
  let cooldownTimer = null;

  function toast(msg, kind) {
    if (typeof global.showToast === 'function') {
      global.showToast(msg, kind || 'info');
      return;
    }
    const el = document.getElementById('connToast');
    if (!el) {
      console.info('[conn]', msg);
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'conn-toast ' + (kind === 'error' ? 'is-error' : kind === 'ok' ? 'is-ok' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4500);
  }

  function setConnState(target, ok, minsAgo) {
    const id = target === 'sas' ? 'sasConnDot' : 'reboticsConnDot';
    const el = document.getElementById(id);
    if (!el) return;
    el.dataset.state = ok ? 'green' : 'red';
    const label = target === 'sas' ? 'SAS' : 'SI / Rebotics';
    el.title = ok
      ? (minsAgo != null
        ? `${label} auth: active (refreshed ${minsAgo} min ago)`
        : `${label} auth: active`)
      : `${label} auth: not active`;
    try {
      if (target === 'sas') sessionStorage.setItem('kompassAuthState', ok ? 'green' : 'red');
    } catch (_) {}
  }

  async function pollConnections() {
    const base = global.EOD_API_BASE;
    try {
      const r = await global.authFetch(`${base}/sas-auth-status`, { noBounceOn401: true });
      const j = r.ok ? await r.json() : { ok: false };
      setConnState('sas', !!j.ok && !j.stale, j.minutes_since_refresh);
    } catch (e) {
      console.warn('[conn] SAS probe failed:', e);
      setConnState('sas', false);
    }
    try {
      const r = await global.authFetch(`${base}/rebotics-auth-status`, { noBounceOn401: true });
      const j = r.ok ? await r.json() : { ok: false };
      setConnState('rebotics', !!j.ok && !j.stale, j.minutes_since_refresh ?? j.minutesSinceRefresh);
    } catch (e) {
      console.warn('[conn] Rebotics probe failed:', e);
      setConnState('rebotics', false);
    }
  }

  function getRefreshCooldownRemainingMs() {
    const last = parseInt(localStorage.getItem(REFRESH_COOLDOWN_KEY) || '0', 10);
    if (!last || Number.isNaN(last)) return 0;
    return Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - last));
  }

  function formatCooldownLabel(ms) {
    if (ms <= 0) return '';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0 && s > 0) return `${m}m ${s}s`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function updateRefreshButtonState() {
    const btn = document.getElementById('refreshConnectionsBtn');
    if (!btn) return;
    const remaining = getRefreshCooldownRemainingMs();
    if (remaining > 0) {
      btn.disabled = true;
      btn.classList.add('cooldown');
      btn.title = `Auth refresh available in ${formatCooldownLabel(remaining)}`;
    } else {
      btn.disabled = false;
      btn.classList.remove('cooldown');
      btn.title = 'Refresh SAS / SI auth, shifts & dept signatures';
    }
  }

  function ensureRefreshCooldownTicker() {
    updateRefreshButtonState();
    if (cooldownTimer) clearInterval(cooldownTimer);
    if (getRefreshCooldownRemainingMs() <= 0) return;
    cooldownTimer = setInterval(() => {
      updateRefreshButtonState();
      if (getRefreshCooldownRemainingMs() <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    }, 1000);
  }

  async function refreshDayData() {
    const S = global.EodSession;
    if (!S?.isVisitReady()) return;
    // Persist draft first — never risk losing local work on a flaky refresh.
    try { S.saveDraft(); } catch (_) {}
    if (global.PhotoDB?.savePhotos && S.state.photos) {
      try { await global.PhotoDB.savePhotos(S.state.photos); } catch (e) {
        console.warn('[conn] photo persist before refresh', e);
      }
    }
    try {
      if (global.EodSignoffHome?.loadSheet) {
        S.patch({ sheetLoaded: false }, 'refresh');
        await global.EodSignoffHome.loadSheet();
        global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet);
      }
    } catch (e) {
      console.warn('[conn] sheet refresh failed (kept local marks/draft)', e);
    }
    try {
      if (global.EodDeptSignatures?.refresh) await global.EodDeptSignatures.refresh();
    } catch (e) {
      console.warn('[conn] dept sig refresh failed', e);
    }
    // Re-pull shifts for current store/date (exact match still applied in visit.js helpers if exposed)
    try {
      const store = S.state.storeNumber;
      const date = S.state.workDate;
      if (store && date && store !== '999' && !String(S.state.selectedShift?.visitId || '').startsWith('test-')) {
        const resp = await global.authFetch(
          `${global.EOD_API_BASE}/api/shifts?store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`,
          { noBounceOn401: true }
        );
        if (resp.ok) {
          const data = await resp.json();
          let shifts = Array.isArray(data) ? data : (data.shifts || []);
          const input = S.normStoreNumber(store);
          shifts = shifts.filter((s) =>
            S.normStoreNumber(s.storeNumber || s.store_number || s.store) === input
          );
          const prevId = S.state.selectedShift?.visitId;
          const selected = shifts.find((s) => s.visitId === prevId) || (shifts.length === 1 ? shifts[0] : S.state.selectedShift);
          S.patch({ shifts, selectedShift: selected || null }, 'shifts-refresh');
        }
      }
    } catch (e) {
      console.warn('[conn] shift refresh failed (kept selection)', e);
    }
    try {
      if (global.EodCover?.loadStoreData) await global.EodCover.loadStoreData(S.state.storeNumber);
    } catch (_) {}
    global.EodChrome?.refresh?.();
    // Re-render current route so PIC/shift UI picks up new data
    try { await global.EodRouter?.render?.(); } catch (_) {}
  }

  function bothLightsGreen() {
    const sas = document.getElementById('sasConnDot');
    const si = document.getElementById('reboticsConnDot');
    return sas?.dataset.state === 'green' && si?.dataset.state === 'green';
  }

  async function refreshConnections() {
    const btn = document.getElementById('refreshConnectionsBtn');
    if (!btn) return;
    const remaining = getRefreshCooldownRemainingMs();
    if (bothLightsGreen()) {
      if (global.showAlert) {
        await global.showAlert(
          'Auth already connected',
          'The green lights mean SAS and Store Intelligence are signed in. A background worker keeps that connection and refreshes it as needed.\n\nThis is not a page refresh. You only need this when a light is red.'
        );
      } else {
        toast('Auth is already green — no refresh needed.', 'ok');
      }
      return;
    }
    if (remaining > 0) {
      toast(`Auth refresh available in ${formatCooldownLabel(remaining)}`, 'error');
      return;
    }

    let proceed = true;
    if (global.showConfirm) {
      proceed = await global.showConfirm(
        'Refresh SAS / SI auth',
        'This refreshes the SAS and Store Intelligence logins. It is not a page refresh, and you can only do it once every 10 minutes.'
      );
    }
    if (!proceed) return;

    // Durable save before network churn
    try { global.EodSession?.saveDraft(); } catch (_) {}
    if (global.EodDurability?.awaitDurablePhotoSave) {
      const ok = await global.EodDurability.awaitDurablePhotoSave('refresh');
      if (!ok) {
        toast('Could not save photos locally — refresh aborted to avoid data loss.', 'error');
        return;
      }
    }

    localStorage.setItem(REFRESH_COOLDOWN_KEY, String(Date.now()));
    ensureRefreshCooldownTicker();
    btn.classList.add('spinning');

    const base = global.EOD_API_BASE;
    let sasResult = null;
    let reboticsResult = null;
    try {
      const sasResp = await global.authFetch(`${base}/api/trigger-auth?force=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        noBounceOn401: true,
      });
      sasResult = await sasResp.json().catch(() => ({}));
    } catch (e) {
      sasResult = { success: false, error: e.message };
    }
    try {
      const reboticsResp = await global.authFetch(`${base}/rebotics-trigger-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        noBounceOn401: true,
      });
      reboticsResult = await reboticsResp.json().catch(() => ({}));
    } catch (e) {
      reboticsResult = { success: false, error: e.message };
    }

    const parts = [];
    if (sasResult?.success) parts.push(sasResult.skipped ? 'SAS still fresh' : 'SAS refreshed');
    else parts.push('SAS refresh failed');
    if (reboticsResult?.success) parts.push('SI/Rebotics triggered');
    else parts.push('SI refresh failed');
    toast(parts.join(' · '), sasResult?.success || reboticsResult?.success ? 'ok' : 'error');

    try {
      await pollConnections();
      await refreshDayData();
    } catch (e) {
      console.error('[refresh] post-trigger failed', e);
    } finally {
      btn.classList.remove('spinning');
    }
  }

  function init() {
    document.getElementById('refreshConnectionsBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      refreshConnections();
    });
    ensureRefreshCooldownTicker();
    pollConnections();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollConnections, POLL_MS);
  }

  global.EodConnections = {
    init,
    pollConnections,
    refreshConnections,
    refreshDayData,
    setConnState,
    toast,
  };
  global.refreshConnections = refreshConnections;
})(typeof window !== 'undefined' ? window : globalThis);
