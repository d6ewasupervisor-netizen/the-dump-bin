/* Shared Send blockers — list + jump targets. Node-testable. */
(function (global) {
  'use strict';

  function photoCount(S, type) {
    const arr = (S?.state?.photos && S.state.photos[type]) || [];
    return arr.filter((p) => {
      if (!p) return false;
      if (typeof p === 'string') return true;
      return !!(p.dataUrl || p.blobId || p.previewUrl || p.objectUrl);
    }).length;
  }

  function items(S) {
    if (!S || !S.state) return [];
    const out = [];
    const push = (id, ok, label, page, focus) => {
      out.push({ id, ok: !!ok, label, page, focus: focus || null });
    };
    push('visit', S.isVisitReady?.(), 'Confirm store and date', 'visit', 'confirmVisitBtn');
    push('name', !!(S.state.profileName || S.state.leadName), 'Enter your name on Visit', 'visit', 'visitLeadName');
    push('signature', !!S.state.signatureDataUrl, 'Add your lead signature', 'send', 'signBtn');
    push(
      'recipients',
      !!(S.state.emailRecipients || []).length || !!(S.state.profileEmail || '').trim(),
      'Add at least one email recipient',
      'send',
      'emailInput'
    );
    push('checkin', !!(S.state.checkInManager || '').trim(), 'Enter the check-in manager on Visit', 'visit', null);
    push('checkout', !!(S.state.checkOutManager || '').trim(), 'Enter the check-out manager (or complete PIC QR)', 'send', 'checkOutManager');
    push('cartBefore', photoCount(S, 'before') >= 1, 'Add a Kompass cart before photo', 'visit', null);
    push('cartAfter', photoCount(S, 'after') >= 1, 'Add a Kompass cart after photo', 'send', 'cartAfterCam');
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

  const api = { items, missing, firstMessage, go, listHtml, bindList, photoCount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSendGates = api;
})(typeof window !== 'undefined' ? window : globalThis);
