/* Send review — hard gate when hosted digital sheet exists. Matches /send-eod contract. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function padStore(n) {
    return String(n || '').replace(/\D/g, '').padStart(3, '0');
  }

  function mmddyyyy(iso) {
    const s = String(iso || '').slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    return `${m[2]}/${m[3]}/${m[1]}`;
  }

  function photosOf(type) {
    const S = global.EodSession;
    return (S.state.photos[type] || []).filter((p) => {
      if (!p) return false;
      if (typeof p === 'string') return true;
      return S.normStoreNumber(p.storeNumber) === S.state.storeNumber
        && S.normIsoDate(p.workDate) === S.state.workDate
        && p.dataUrl;
    });
  }

  function photoCount(type) {
    return photosOf(type).length;
  }

  function yn(v) { return v ? 'Yes' : 'No'; }

  function collectSignoffPhotos() {
    return photosOf('signoff').map((p) => {
      if (typeof p === 'string') return { dataUrl: p, source: 'local' };
      return {
        dataUrl: p.dataUrl,
        source: p.source || 'local',
        filename: p.filename || null,
      };
    }).filter((p) => p.dataUrl);
  }

  function buildBodyAndReport() {
    const S = global.EodSession;
    const store = S.state.storeNumber;
    const dateIso = S.state.workDate;
    const dateDisp = mmddyyyy(dateIso);
    const lead = S.state.leadName || S.state.profileName || '';
    const beforeDone = photoCount('before') > 0;
    const afterDone = photoCount('after') > 0;
    const signoffCount = photoCount('signoff');
    const signoffDone = signoffCount > 0 || S.hasHostedSheet();
    const notInStoreText = (S.state.notInStoreSelected || []).join(', ') || 'None';
    const notInSiText = (S.state.notInSiSelected || []).join(', ') || 'None';
    const sheet = S.state.sheet;
    let digitalLine = 'Digital signoff: none (no hosted sheet)';
    if (sheet) {
      const s = sheet.summary || {};
      digitalLine = `Digital signoff: ${sheet.fiscalWeek || ''} ${s.marked || 0}/${s.total || 0} marked`
        + (S.sheetSendReady() ? ' (send ready)' : ' (open sets)')
        + (sheet.allAcknowledged ? ' [remaining acknowledged]' : '');
    }
    let deptSigLine = 'Department signatures: (see app)';
    try {
      const collected = global.EodDeptSignatures?.getCollectedForEmail?.() || [];
      if (collected.length) {
        deptSigLine = 'Department signatures: ' + collected.map((c) =>
          `${c.roleKey || c.role || '?'}=${c.signerName || 'signed'}`
        ).join('; ');
      } else {
        deptSigLine = 'Department signatures: none yet';
      }
    } catch (_) {}

    const body = `KOMPASS End of Day Report
Store: FM${padStore(store)}
Date: ${dateDisp}
Lead: ${lead}

Before picture of KOMPASS cart taken: ${yn(beforeDone)}
Check-in manager: ${S.state.checkInManager || '—'}
InstaWork support: ${S.state.instaworkYes || '—'}
Check-out manager: ${S.state.checkOutManager || '—'}
${digitalLine}
${deptSigLine}
Not in store: ${notInStoreText}
Not in SI: ${notInSiText}
After picture of KOMPASS cart taken: ${yn(afterDone)}
Sign-off sheets photographed: ${yn(signoffDone)}
Number of sign-off photos: ${signoffCount}
Notes:
${S.state.notes || ''}`;

    const report = {
      leadName: lead,
      date: dateDisp,
      storeNumber: store,
      beforeTaken: yn(beforeDone),
      checkInManager: S.state.checkInManager || '',
      instaworkSupport: S.state.instaworkYes || 'No',
      calledHelpDesk: (S.state.helpdeskSubmittedReports || []).length ? 'Yes' : 'No',
      commodities: 'N/A',
      issue: 'N/A',
      issueResolved: 'N/A',
      tempSolution: 'N/A',
      checkOutManager: S.state.checkOutManager || '',
      signedOutProd: '—',
      signedOutSi: '—',
      notInStore: notInStoreText,
      notInSi: notInSiText,
      digitalSignoff: digitalLine.replace(/^Digital signoff:\s*/, ''),
      deptSignatures: deptSigLine.replace(/^Department signatures:\s*/, ''),
      afterTaken: yn(afterDone),
      signoffDone: yn(signoffDone),
      signoffCount,
      notes: S.state.notes || '',
      app: 'eod-field-app',
      version: global.EOD_APP_VERSION,
    };

    return { body, report };
  }

  function buildPayload() {
    const S = global.EodSession;
    const store = S.state.storeNumber;
    const { body, report } = buildBodyAndReport();
    let recipients = (S.state.emailRecipients || []).slice();
    const userEmail = (S.state.profileEmail || '').trim().toLowerCase();
    if (userEmail) recipients = [...new Set([...recipients, userEmail])];

    return {
      storeNumber: store,
      workDate: S.state.workDate,
      subject: `KOMPASS EOD FM${padStore(store)} ${mmddyyyy(S.state.workDate)}`,
      body,
      report,
      recipients,
      userName: S.state.profileName || S.state.leadName || '',
      userEmail,
      checkInManager: S.state.checkInManager || '',
      checkOutManager: S.state.checkOutManager || '',
      signoffPhotos: collectSignoffPhotos(),
      // pdfBase64 omitted in pilot until PDF generator is ported — API accepts text+photos.
      fieldApp: {
        version: global.EOD_APP_VERSION,
        hasHostedSheet: S.hasHostedSheet(),
        sheetSendReady: S.sheetSendReady(),
        photoCounts: {
          before: photoCount('before'),
          after: photoCount('after'),
          signoff: photoCount('signoff'),
          instawork: photoCount('instawork'),
        },
      },
    };
  }

  function gateMessage() {
    const S = global.EodSession;
    if (!S.isVisitReady()) return 'Confirm store and date first.';
    if (!S.state.profileName) return 'Enter your name on Visit.';
    if (!S.state.signatureDataUrl) return 'Add your lead signature.';
    if (!S.state.emailRecipients.length && !(S.state.profileEmail || '').trim()) {
      return 'Add at least one email recipient.';
    }
    if (S.hasHostedSheet() && !S.sheetSendReady()) {
      return 'Digital signoff: mark every open set (or Acknowledge remaining) before sending.';
    }
    if (!S.hasHostedSheet() && photoCount('signoff') < 1) {
      return 'No hosted sheet — add at least one paper sign-off photo.';
    }
    return null;
  }

  async function render(mount) {
    const S = global.EodSession;
    S.syncDomBridges();
    if (global.EodCover?.loadStoreData) {
      try { await global.EodCover.loadStoreData(S.state.storeNumber); } catch (_) {}
    }

    const gate = gateMessage();
    const sheet = S.state.sheet;
    mount.innerHTML = `
      <div class="card">
        <h1>Sign & send</h1>
        <p class="muted">Review recipients and signature. Digital marks gate send when a hosted sheet exists.</p>
        <div class="card" style="border-style:dashed;">
          <h2>Day summary</h2>
          <p>Store <strong>${esc(S.state.storeNumber)}</strong> · ${esc(S.state.workDate)}</p>
          <p class="muted">${esc(S.state.selectedShift?.projectName || 'No shift selected')}</p>
          ${sheet ? `<p><span class="pill ok">Digital sheet ${esc(sheet.fiscalWeek || '')}</span>
            ${esc(String(sheet.summary?.marked || 0))}/${esc(String(sheet.summary?.total || 0))} marked
            ${S.sheetSendReady() ? '<span class="pill ok">send ready</span>' : '<span class="pill warn">open sets remain</span>'}</p>`
            : '<p><span class="pill warn">No hosted sheet</span> — paper sign-off required</p>'}
          <p class="muted">Photos — before ${photoCount('before')}, after ${photoCount('after')}, signoff ${photoCount('signoff')}, instawork ${photoCount('instawork')}</p>
        </div>
        <div class="field">
          <label>Lead signature</label>
          <div class="sig-preview" id="sigPreview">${S.state.signatureDataUrl
            ? `<img src="${S.state.signatureDataUrl}" alt="Signature">`
            : 'No signature yet'}</div>
          <button type="button" class="btn btn-primary btn-block" id="signBtn" style="margin-top:8px;">Sign</button>
        </div>
        <div class="field">
          <label>Add recipient</label>
          <div class="btn-row">
            <input type="email" id="emailInput" placeholder="recipient@example.com" style="flex:1;min-height:44px;padding:10px;border-radius:8px;border:1px solid #4b5563;background:#1f2937;color:#fff;font-size:16px;">
            <button type="button" class="btn btn-primary" id="addEmailBtn">Add</button>
          </div>
        </div>
        <div id="recipientList" style="margin-bottom:12px;"></div>
        <div class="field" id="fmPoolField" ${(S.state.fredmeyerEmailPool || []).length ? '' : 'hidden'}>
          <label>Saved Fred Meyer addresses</label>
          <button type="button" class="btn btn-secondary btn-block" id="fmPickerBtn">Choose addresses</button>
        </div>
        <div id="gateMsg" style="margin:10px 0;color:${gate ? '#fbbf24' : '#22c55e'};">${esc(gate || 'Ready to send.')}</div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="previewBtn">Preview</button>
          <button type="button" class="btn btn-success" id="sendBtn" ${gate ? 'disabled' : ''}>Send EOD</button>
        </div>
      </div>
      <div id="sigPadOverlay" class="modal-overlay">
        <div class="modal-dialog">
          <h2>Lead signature</h2>
          <canvas id="sigCanvas" width="360" height="180" style="width:100%;background:#fff;border-radius:8px;touch-action:none;"></canvas>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="sigClear">Clear</button>
            <button type="button" class="btn btn-primary" id="sigAccept">Accept</button>
            <button type="button" class="btn btn-secondary" id="sigCancel">Cancel</button>
          </div>
        </div>
      </div>`;

    function paintRecipients() {
      const host = document.getElementById('recipientList');
      host.innerHTML = (S.state.emailRecipients || []).map((e, i) =>
        `<span class="pill">${esc(e)} <button type="button" data-rm="${i}" style="border:0;background:transparent;color:inherit;cursor:pointer;">×</button></span>`
      ).join('') || '<span class="muted">No recipients yet (your profile email is added on send).</span>';
      host.querySelectorAll('[data-rm]').forEach((b) => {
        b.onclick = () => {
          const arr = S.state.emailRecipients.slice();
          arr.splice(Number(b.getAttribute('data-rm')), 1);
          S.patch({ emailRecipients: arr }, 'recipients');
          S.saveDraft();
          render(mount);
        };
      });
    }
    paintRecipients();

    document.getElementById('addEmailBtn').onclick = () => {
      const v = document.getElementById('emailInput').value.trim().toLowerCase();
      if (!v || !v.includes('@')) return;
      const arr = S.state.emailRecipients.slice();
      if (!arr.includes(v)) arr.push(v);
      S.patch({ emailRecipients: arr }, 'recipients');
      document.getElementById('emailInput').value = '';
      S.saveDraft();
      render(mount);
    };

    document.getElementById('fmPickerBtn')?.addEventListener('click', () => {
      const pool = S.state.fredmeyerEmailPool || [];
      const selected = S.state.emailRecipients.filter((e) => pool.includes(e));
      global.EodPicker.open({
        anchor: document.getElementById('fmPickerBtn'),
        title: 'Fred Meyer addresses',
        multiple: true,
        items: pool.map((e, i) => ({ id: String(i), label: e, selected: selected.includes(e) })),
        selected: pool.map((e, i) => selected.includes(e) ? String(i) : null).filter(Boolean),
        searchable: pool.length > 8,
        onChange(ids) {
          const picked = ids.map((i) => pool[Number(i)]).filter(Boolean);
          const others = S.state.emailRecipients.filter((e) => !pool.includes(e));
          S.patch({ emailRecipients: [...new Set([...others, ...picked])] }, 'fm');
          S.saveDraft();
          render(mount);
        },
      });
    });

    const overlay = document.getElementById('sigPadOverlay');
    const canvas = document.getElementById('sigCanvas');
    const ctx = canvas.getContext('2d');
    let drawing = false;
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
    }
    function start(e) { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#111';
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    function end() { drawing = false; }
    canvas.onmousedown = start;
    canvas.onmousemove = move;
    canvas.onmouseup = end;
    canvas.onmouseleave = end;
    canvas.ontouchstart = start;
    canvas.ontouchmove = move;
    canvas.ontouchend = end;

    document.getElementById('signBtn').onclick = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      overlay.classList.add('show');
    };
    document.getElementById('sigClear').onclick = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    document.getElementById('sigCancel').onclick = () => overlay.classList.remove('show');
    document.getElementById('sigAccept').onclick = () => {
      const url = canvas.toDataURL('image/png');
      S.saveSignature(url);
      overlay.classList.remove('show');
      render(mount);
    };

    document.getElementById('previewBtn').onclick = () => {
      const payload = buildPayload();
      const w = window.open('', '_blank');
      const html = `<!DOCTYPE html><html><head><title>EOD preview</title>
        <style>body{font:15px/1.45 system-ui;padding:16px;max-width:720px;margin:auto;background:#0b1220;color:#f8fafc}
        pre{white-space:pre-wrap;background:#111827;padding:12px;border-radius:8px;border:1px solid #334155}
        h1{color:#7dd3fc;font-size:1.2rem}</style></head><body>
        <h1>${esc(payload.subject)}</h1>
        <p>To: ${esc(payload.recipients.join(', '))}</p>
        <pre>${esc(payload.body)}</pre>
        <h1>Raw payload</h1>
        <pre>${esc(JSON.stringify(payload, null, 2))}</pre>
        </body></html>`;
      if (!w) {
        alert(payload.body);
        return;
      }
      w.document.write(html);
      w.document.close();
    };

    document.getElementById('sendBtn').onclick = async () => {
      const msg = gateMessage();
      if (msg) {
        alert(msg);
        return;
      }
      const payload = buildPayload();
      const headers = global.EodApi.dayConfirmHeaders();
      const btn = document.getElementById('sendBtn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const resp = await global.authFetch(`${global.EOD_API_BASE}/send-eod`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        if (resp.status === 412) {
          S.clearDayConfirm();
          alert('Please re-confirm your store for today (day-confirm expired), then send again.');
          global.EodRouter.go('visit');
          return;
        }
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
          throw new Error(data.error || data.message || `Send failed (${resp.status})`);
        }
        alert('EOD sent.');
        if (global.PhotoDB?.markEmailOk) {
          try { await global.PhotoDB.markEmailOk(S.state.storeNumber, S.state.workDate); } catch (_) {}
        }
      } catch (err) {
        console.error(err);
        alert(`Send error: ${err.message}`);
      } finally {
        btn.disabled = !!gateMessage();
        btn.textContent = 'Send EOD';
      }
    };
  }

  global.EodSend = { buildPayload, gateMessage };
  global.EodRouter.register('send', render);
})(typeof window !== 'undefined' ? window : globalThis);
