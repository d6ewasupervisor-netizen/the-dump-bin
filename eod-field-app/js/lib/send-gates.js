/* Shared Send blockers — list + jump targets. Node-testable. */
(function (global) {
  'use strict';

  function photoCount(S, type) {
    const arr = (S?.state?.photos && S.state.photos[type]) || [];
    const L = global.EodSendSheetsLogic || {};
    const live = global.PhotoDB?.liveObjectUrls;
    if (typeof L.cartSlotHasLoadedPhotos === 'function') {
      return arr.filter((p) => L.hasRecoverablePhoto
        ? L.hasRecoverablePhoto(p, live)
        : L.cartSlotHasLoadedPhotos([p], live)).length;
    }
    return arr.filter((p) => {
      if (!p) return false;
      if (typeof p === 'string') return true;
      return !!(
        p.dataUrl || p.blobId || p.previewUrl || p.objectUrl
        || p.teamUrl || p.thumbUrl || p.offloaded
      );
    }).length;
  }

  function collectedPicRoles() {
    return (global.EodDeptSignatures?.getCollectedForEmail?.() || [])
      .map((s) => String(s.roleKey || '').toLowerCase())
      .filter((k) => k && k !== 'lead');
  }

  function scopedPicRoles() {
    return (global.EodDeptSignatures?.scopedRoleKeys?.() || [])
      .map((k) => String(k || '').toLowerCase())
      .filter((k) => k && k !== 'lead' && k !== 'store_pic' && k !== 'home_manager');
  }

  function picSignoffReady(S) {
    if (!S.hasHostedSheet?.()) {
      return !!(S.state.checkOutManager || '').trim() || photoCount(S, 'signoff') >= 1;
    }
    const collected = collectedPicRoles();
    if (collected.includes('store_pic') || collected.includes('home_manager')) return true;
    const scoped = scopedPicRoles();
    if (scoped.length) return scoped.every((k) => collected.includes(k));
    return collected.length > 0;
  }

  function items(S) {
    if (!S || !S.state) return [];
    const out = [];
    const push = (id, ok, label, page, focus) => {
      out.push({ id, ok: !!ok, label, page, focus: focus || null });
    };
    // Field day order: store → cart before → check-in → categories →
    // management/PIC → lead signature → send leftovers.
    push('visit', S.isVisitReady?.(), 'Confirm store and date', 'visit', 'confirmVisitBtn');
    push('name', !!(S.state.profileName || S.state.leadName), 'Enter your name on Visit', 'visit', 'visitLeadName');
    push('cartBefore', photoCount(S, 'before') >= 1, 'Add a Kompass cart before photo', 'visit', 'cartBeforeCam');
    push('checkin', !!(S.state.checkInManager || '').trim(), 'Enter the check-in manager on Visit', 'visit', 'checkInManager');
    if (S.hasHostedSheet?.()) {
      push('sheet', !!S.sheetSendReady?.(), 'Mark every open set before sending', 'signoff', null);
    } else {
      push(
        'paper',
        photoCount(S, 'signoff') >= 1 || !!(S.state.checkOutManager || '').trim(),
        'No hosted sheet — add a paper sign-off photo or complete PIC checkout',
        'send',
        'sendPaperCam'
      );
    }
    push(
      'checkout',
      picSignoffReady(S),
      'Collect department PIC signatures',
      'signatures',
      null
    );
    push('signature', !!S.state.signatureDataUrl, 'Add your lead signature', 'send', 'signBtn');
    push(
      'recipients',
      !!(S.state.emailRecipients || []).length || !!(S.state.profileEmail || '').trim(),
      'Add at least one email recipient',
      'send',
      'emailInput'
    );
    push('cartAfter', photoCount(S, 'after') >= 1, 'Add a Kompass cart after photo', 'send', 'cartAfterCam');
    if (S.state.instaworkYes === 'Yes') {
      push('instaworkPhoto', photoCount(S, 'instawork') >= 1, 'InstaWork is in use — take a photo of the sign-out timesheet', 'crew', 'iwCamBtn');
      push('instaworkSave', !!S.state.instaworkSavedInfo, 'Tap Confirm & Save so the InstaWork sign-out sheet is routed', 'crew', 'iwSaveBtn');
    }
    return out;
  }

  function missing(S) {
    return items(S).filter((g) => !g.ok);
  }

  function firstMessage(S) {
    const m = missing(S)[0];
    return m ? m.label : null;
  }

  function go(item) {
    if (!item) return;
    const router = global.EodRouter;
    if (router?.go && item.page) router.go(item.page);
    if (item.focus) {
      setTimeout(() => {
        const el = document.getElementById(item.focus);
        if (!el) return;
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        try { el.focus(); } catch (_) {}
      }, 80);
    }
  }

  function listHtml(S, escFn) {
    const esc = typeof escFn === 'function' ? escFn : (s) => String(s == null ? '' : s);
    const miss = missing(S);
    if (!miss.length) return '';
    return `<div class="eod-send-gates" id="eodSendGates">
      ${miss.map((g) => `<button type="button" class="btn btn-secondary btn-block eod-send-gate" data-gate="${esc(g.id)}">${esc(g.label)}</button>`).join('')}
    </div>`;
  }

  function bindList(host, S) {
    if (!host) return;
    host.querySelectorAll('[data-gate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-gate');
        const item = missing(S).find((g) => g.id === id) || items(S).find((g) => g.id === id);
        go(item);
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Kick store-day settle-drain and poll until completed/failed or timeout.
   * Soft-warn path: never hard-blocks Send; returns { ok, pending, openBacklog, job }.
   */
  async function kickSettleDrain(opts) {
    const {
      storeNumber,
      workDate,
      authFetch,
      apiBase,
      headers,
      timeoutMs = 180_000,
      pollMs = 4000,
      onStatus,
    } = opts || {};
    const fetchFn = authFetch || global.authFetch;
    const base = String(apiBase || global.EOD_API_BASE || '').replace(/\/$/, '');
    if (!fetchFn || !base || !storeNumber || !workDate) {
      return { ok: true, skipped: true, pending: false, openBacklog: 0 };
    }
    let kick;
    try {
      const resp = await fetchFn(`${base}/api/field-set/settle-now`, {
        method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
        body: JSON.stringify({ storeNumber, workDate }),
      });
      kick = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return {
          ok: false,
          pending: true,
          openBacklog: Number(kick.openBacklog) || 0,
          error: kick.error || `settle-now ${resp.status}`,
        };
      }
    } catch (err) {
      return { ok: false, pending: true, openBacklog: 0, error: err.message || String(err) };
    }

    const jobId = kick.job?.jobId || kick.job?.id;
    const openBacklog = Number(kick.openBacklog) || 0;
    if (!jobId) {
      return { ok: true, pending: openBacklog > 0, openBacklog, job: kick.job || null };
    }

    const deadline = Date.now() + Math.max(5_000, Number(timeoutMs) || 180_000);
    let lastJob = kick.job;
    while (Date.now() < deadline) {
      try {
        onStatus?.('Closing SI sets…');
        const statusResp = await fetchFn(`${base}/api/field-set/jobs/${jobId}`, {
          headers: headers || {},
        });
        const body = await statusResp.json().catch(() => ({}));
        lastJob = body.job || lastJob;
        const status = String(lastJob?.status || '');
        if (status === 'completed') {
          const pendingLeft = Array.isArray(lastJob?.result?.pending)
            ? lastJob.result.pending.length
            : 0;
          return {
            ok: true,
            pending: pendingLeft > 0,
            openBacklog: pendingLeft,
            job: lastJob,
          };
        }
        if (status === 'failed') {
          return {
            ok: false,
            pending: true,
            openBacklog: openBacklog || 1,
            job: lastJob,
            error: lastJob?.error || 'settle-drain failed',
          };
        }
      } catch (_) { /* keep polling */ }
      await sleep(Math.max(1000, Number(pollMs) || 4000));
    }
    return {
      ok: false,
      pending: true,
      openBacklog: openBacklog || 1,
      job: lastJob,
      timedOut: true,
    };
  }

  const api = {
    items,
    picSignoffReady,
    missing,
    firstMessage,
    go,
    listHtml,
    bindList,
    photoCount,
    kickSettleDrain,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSendGates = api;
})(typeof window !== 'undefined' ? window : globalThis);
