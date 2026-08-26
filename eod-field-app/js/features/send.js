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
    const out = photosOf('signoff').map((p) => {
      if (typeof p === 'string') return { dataUrl: p, source: 'local' };
      return {
        dataUrl: p.dataUrl,
        source: p.source || 'local',
        filename: p.filename || null,
      };
    }).filter((p) => p.dataUrl);
    photosOf('before').forEach((p, i) => {
      const dataUrl = typeof p === 'string' ? p : p?.dataUrl;
      if (dataUrl) out.push({ dataUrl, filename: `cart_before_${i}.jpg`, source: 'cart-before' });
    });
    photosOf('after').forEach((p, i) => {
      const dataUrl = typeof p === 'string' ? p : p?.dataUrl;
      if (dataUrl) out.push({ dataUrl, filename: `cart_after_${i}.jpg`, source: 'cart-after' });
    });
    return out;
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
Help desk reports: ${(S.state.helpdeskSubmittedReports || []).length
      ? (S.state.helpdeskSubmittedReports || []).map((r) => {
          const kind = r.issueTypeId === 'not_in_store' ? 'Not in store' : (r.issueTypeId || 'issue');
          const setName = r.setMeta?.setLabel || r.setLabel || r.manualSetName || r.customIssue || '';
          return setName ? `${kind} — ${setName}` : kind;
        }).join('; ')
      : 'None'}
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

    const mainIse = global.EodSendSheetsLogic?.pickMainKompassIseVisit?.(
      S.state.shifts,
      S.state.selectedShift,
    ) || null;

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
      visitId: mainIse?.visitId || null,
      signoffPhotos: collectSignoffPhotos(),
      cartPhotos: {
        before: photosOf('before').map(photoSrc).filter(Boolean),
        after: photosOf('after').map(photoSrc).filter(Boolean),
      },
      // pdfBase64 omitted in pilot until PDF generator is ported.
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

  function photoSrc(p) {
    if (!p) return '';
    if (typeof p === 'string') return p;
    return p.dataUrl || '';
  }

  function gateMessage() {
    const S = global.EodSession;
    if (!S.isVisitReady()) return 'Confirm store and date first.';
    if (!S.state.profileName) return 'Enter your name on Visit.';
    if (!S.state.signatureDataUrl) return 'Add your lead signature.';
    if (!S.state.emailRecipients.length && !(S.state.profileEmail || '').trim()) {
      return 'Add at least one email recipient.';
    }
    if (!(S.state.checkInManager || '').trim()) return 'Enter the check-in manager on Visit.';
    if (!(S.state.checkOutManager || '').trim()) return 'Enter the check-out manager (or complete PIC QR).';
    if (photoCount('before') < 1) return 'Add a Kompass cart before photo.';
    if (photoCount('after') < 1) return 'Add a Kompass cart after photo.';
    if (S.hasHostedSheet() && !S.sheetSendReady()) {
      return 'Digital signoff: mark every open set (or Acknowledge remaining) before sending.';
    }
    if (!S.hasHostedSheet() && photoCount('signoff') < 1 && !(S.state.checkOutManager || '').trim()) {
      return 'No hosted sheet — add a paper sign-off photo or complete PIC checkout.';
    }
    if (S.state.instaworkYes === 'Yes' && photoCount('instawork') < 1) {
      return 'InstaWork is in use — add the sign-out photo and Confirm & Save.';
    }
    return null;
  }

  async function render(mount) {
    const S = global.EodSession;
    S.syncDomBridges();
    if (global.EodCover?.loadStoreData) {
      try { await global.EodCover.loadStoreData(S.state.storeNumber); } catch (_) {}
    }
    try { await global.EodPicQr?.refresh?.(false); } catch (_) {}

    const gate = gateMessage();
    const sheet = S.state.sheet;
    mount.innerHTML = `
      <div class="card">
        <h1>Sign & send</h1>
        <p class="muted">Store <strong>${esc(S.state.storeNumber)}</strong> · ${esc(S.state.workDate)}</p>
        <button type="button" class="btn btn-secondary btn-block" id="sendPhotosLink">Photos</button>
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
          <label>Manager checked out with</label>
          <input type="text" id="checkOutManager" value="${esc(S.state.checkOutManager || '')}" list="mgrListSend" autocomplete="off">
          <button type="button" class="btn btn-secondary btn-block" id="pickOutMgr" style="margin-top:6px;">Choose saved name</button>
          <button type="button" class="btn btn-secondary btn-block" id="saveOutMgr" style="margin-top:6px;">Save name to store</button>
        </div>
        <datalist id="mgrListSend">${(S.state.managerNamePool || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field">
          <label>Notes</label>
          <textarea id="sendNotes" rows="4">${esc(S.state.notes || '')}</textarea>
        </div>
        <div class="card" id="cartAfterCard" style="margin:12px 0;">
          <h2>Kompass cart — after</h2>
          <div id="cartAfterThumbs" class="set-thumbs" style="margin-bottom:10px;"></div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="cartAfterCam">Camera</button>
            <label class="btn btn-secondary" style="cursor:pointer;">
              Add file
              <input type="file" accept="image/*,.heic,.heif" capture="environment" id="cartAfterInput" hidden>
            </label>
            <button type="button" class="btn btn-secondary" id="cartAfterPull">Pull from PROD</button>
            <button type="button" class="btn btn-secondary" id="cartAfterPush">Upload to PROD</button>
          </div>
          <div id="cartAfterMsg" class="muted" style="margin-top:8px;"></div>
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
      </div>`;

    document.getElementById('sendPhotosLink')?.addEventListener('click', () => global.EodRouter.go('photos'));

    const notesEl = document.getElementById('sendNotes');
    if (notesEl && !(S.state.notes || '').trim()) {
      const sheet = S.state.sheet;
      const summary = `In: ${S.state.checkInManager || '—'} · Out: ${S.state.checkOutManager || '—'} · cart ${photoCount('before')}/${photoCount('after')} · ${
        sheet ? `${sheet.summary?.marked || 0}/${sheet.summary?.total || 0} marked` : 'no hosted sheet'
      }`;
      notesEl.value = summary;
      S.patch({ notes: summary }, 'day-summary');
      S.saveDraft();
    }

    const saveSendFields = () => {
      S.patch({
        checkOutManager: document.getElementById('checkOutManager')?.value?.trim() || '',
        notes: document.getElementById('sendNotes')?.value || '',
      }, 'send-cover');
      S.saveDraft();
    };
    ['checkOutManager', 'sendNotes'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', saveSendFields);
      el.addEventListener('blur', saveSendFields);
    });
    document.getElementById('saveOutMgr')?.addEventListener('click', async () => {
      const name = document.getElementById('checkOutManager')?.value?.trim();
      if (!name) return;
      try {
        await global.EodCover?.addManagerName?.(name);
        if (global.showAlert) global.showAlert('Saved', 'Manager name saved for this store.');
      } catch (err) {
        if (global.showAlert) global.showAlert('Save', err.message || String(err));
      }
    });
    document.getElementById('pickOutMgr')?.addEventListener('click', () => {
      const items = (S.state.managerNamePool || []).map((n, i) => ({ id: String(i), label: n }));
      global.EodPicker.open({
        anchor: document.getElementById('pickOutMgr'),
        title: 'Saved managers',
        items: items.length ? items : [{ id: 'x', label: 'No saved names', disabled: true }],
        searchable: items.length > 6,
        onChoose(item) {
          document.getElementById('checkOutManager').value = item.label;
          saveSendFields();
        },
      });
    });

    (function wireCartAfter() {
      const Cart = global.EodVisitCart;
      const setMsg = (t, err) => {
        const el = document.getElementById('cartAfterMsg');
        if (!el) return;
        el.style.color = err ? 'var(--danger)' : '';
        el.textContent = t || '';
      };
      function paintThumbs() {
        const host = document.getElementById('cartAfterThumbs');
        if (!host || !Cart) return;
        const list = Cart.cartPhotos('after');
        host.innerHTML = list.length
          ? Cart.thumbRow(list)
          : '<p class="muted" style="margin:0;">No after photos yet.</p>';
        const pushBtn = document.getElementById('cartAfterPush');
        if (pushBtn) pushBtn.disabled = !list.length;
      }
      paintThumbs();
      document.getElementById('cartAfterCam')?.addEventListener('click', async () => {
        if (!global.EodCamera?.open) return;
        await global.EodCamera.open({
          label: 'Kompass cart — after',
          onCapture: async (file) => {
            const input = document.getElementById('cartAfterInput');
            if (!input) return;
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change'));
          },
          shouldContinue: () => true,
        });
      });
      document.getElementById('cartAfterInput')?.addEventListener('change', async (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (!file || !Cart) return;
        try {
          const pipe = global.EodPhotoPipeline;
          if (pipe?.enqueue) {
            const job = pipe.enqueue({
              kind: 'cart',
              compressType: 'after',
              slot: 'after',
              bay: 1,
              file,
              visitId: S.state.selectedShift?.visitId,
            });
            const entry = {
              dataUrl: job.previewUrl,
              preview: job.previewUrl,
              storeNumber: S.state.storeNumber,
              workDate: S.state.workDate,
              stampedAt: Date.now(),
              kind: 'cart-after',
              jobId: job.id,
            };
            const existing = (S.state.photos?.after || []).filter((p) => p?.kind && !String(p.kind).startsWith('cart'));
            const photos = Object.assign({}, S.state.photos, { after: [...existing, entry] });
            S.patch({ photos }, 'cart-after');
            if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(photos);
            S.saveDraft();
            setMsg('After queued');
          } else {
            const dataUrl = await Cart.preparePhoto(file, 'after');
            const entry = {
              dataUrl,
              storeNumber: S.state.storeNumber,
              workDate: S.state.workDate,
              stampedAt: Date.now(),
              kind: 'cart-after',
            };
            const existing = (S.state.photos?.after || []).filter((p) => p?.kind && !String(p.kind).startsWith('cart'));
            const photos = Object.assign({}, S.state.photos, { after: [...existing, entry] });
            S.patch({ photos }, 'cart-after');
            if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(photos);
            S.saveDraft();
          }
          paintThumbs();
        } catch (err) {
          setMsg(err.message || String(err), true);
        }
      });
      document.getElementById('cartAfterPull')?.addEventListener('click', async () => {
        if (!Cart) return;
        try {
          setMsg('Pulling after from PROD…');
          const n = await Cart.pullCartFromProd('after');
          setMsg('Pulled ' + n + ' after photo(s) from PROD.');
          paintThumbs();
        } catch (err) {
          setMsg(err.message || String(err), true);
        }
      });
      document.getElementById('cartAfterPush')?.addEventListener('click', async () => {
        if (!Cart) return;
        try {
          const list = Cart.cartPhotos('after');
          for (const p of list) await Cart.uploadCartToProd('after', p.dataUrl || p);
          setMsg('After photos uploaded to PROD.');
        } catch (err) {
          setMsg(err.message || String(err), true);
        }
      });
    })();

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

    document.getElementById('signBtn').onclick = () => {
      if (!global.EodLandscapeSigPad?.open) {
        alert('Signature pad failed to load. Refresh and try again.');
        return;
      }
      global.EodLandscapeSigPad.open({
        title: 'Lead signature',
        existingDataUrl: S.state.signatureDataUrl,
        onAccept: (url) => {
          S.saveSignature(url);
          render(mount);
        },
      });
    };

    document.getElementById('previewBtn').onclick = () => {
      const payload = global.applyEodTestModeToPayload
        ? global.applyEodTestModeToPayload(buildPayload())
        : buildPayload();
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
      let payload = buildPayload();
      if (global.applyEodTestModeToPayload) payload = global.applyEodTestModeToPayload(payload);
      if (global.EodTestMode?.isForceLive?.()) {
        const ok = confirm('LIVE delivery override is ON.\n\nSend will use the real path (not tester-only).\n\nContinue?');
        if (!ok) return;
      }
      // Durable save before send — keep local copy even if network dies mid-flight.
      try { S.saveDraft(); } catch (_) {}
      if (global.EodDurability?.awaitDurablePhotoSave) {
        const saved = await global.EodDurability.awaitDurablePhotoSave('send');
        if (!saved) {
          alert('Could not save photos locally. Fix device storage, then try Send again. Nothing was emailed.');
          return;
        }
      }
      const headers = global.EodApi.dayConfirmHeaders();
      const btn = document.getElementById('sendBtn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      let generatedSheets = [];
      try {
        if (global.EodSendSheets?.prepareForEmail) {
          generatedSheets = await global.EodSendSheets.prepareForEmail({
            report: payload.report,
            sheet: S.state.sheet,
            storeNumber: payload.storeNumber,
            workDate: payload.workDate,
            testMode: !!payload.testMode,
            onStatus: (msg) => { btn.textContent = msg || 'Sending…'; },
          });
        }
        if (generatedSheets.length) {
          payload.signoffPhotos = generatedSheets.concat(payload.signoffPhotos || []);
        }
        btn.textContent = 'Sending…';
        const packageId = await uploadPackageParts(payload, headers);
        const meta = Object.assign({}, payload);
        if (packageId) {
          meta.packageId = packageId;
          delete meta.pdfBase64;
          delete meta.signoffPhotos;
          delete meta.cartPhotos;
        }
        const resp = await global.authFetch(`${global.EOD_API_BASE}/send-eod`, {
          method: 'POST',
          headers,
          body: JSON.stringify(meta),
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
        let sasNote = '';
        if (generatedSheets.length && global.EodSendSheets?.uploadAfterSend) {
          btn.textContent = 'Uploading sheets to Kompass…';
          try {
            const sas = await global.EodSendSheets.uploadAfterSend(generatedSheets, {
              storeNumber: payload.storeNumber,
              workDate: payload.workDate,
              leadName: payload.userName,
              onStatus: (msg) => { btn.textContent = msg || 'Uploading sheets to Kompass…'; },
            });
            if (sas.failed) {
              sasNote = `\n\nEmail sent. ${sas.uploaded} sheet image(s) uploaded to maintenance; ${sas.failed} failed.`;
            }
          } catch (coverErr) {
            console.warn('[coversheet] auto-upload after send failed:', coverErr);
            sasNote = '\n\nEmail sent. Maintenance after-photo upload had an issue — retry from Send if needed.';
          }
        }
        if (global.showAlert) await global.showAlert('Sent', 'EOD sent.' + sasNote);
        else alert('EOD sent.' + sasNote);
        if (global.PhotoDB?.markEmailOk) {
          try { await global.PhotoDB.markEmailOk(S.state.storeNumber, S.state.workDate); } catch (_) {}
        }
        await maybeClearAfterSend(S);
      } catch (err) {
        console.error(err);
        if (err && err.status === 412) {
          S.clearDayConfirm();
          alert('Please re-confirm your store for today (day-confirm expired), then send again.');
          global.EodRouter.go('visit');
          return;
        }
        alert(`Send error: ${networkSendMessage(err)}`);
      } finally {
        btn.disabled = !!gateMessage();
        btn.textContent = 'Send EOD';
      }
    };
  }

  async function maybeClearAfterSend(S) {
    let pref = 'ask';
    try { pref = localStorage.getItem('eodPostSendClearPref') || 'ask'; } catch (_) {}
    let wipe = pref === 'always';
    if (pref === 'never') return;
    if (pref === 'ask' && global.EodAlerts?.showDialog) {
      const id = await global.EodAlerts.showDialog({
        title: 'Clear this visit?',
        message: 'Profile and signature stay on this phone.',
        buttons: [
          { id: 'never', label: 'Never' },
          { id: 'no', label: 'Keep' },
          { id: 'yes', label: 'Clear', primary: true },
          { id: 'always', label: 'Always' },
        ],
      });
      if (id === 'always') {
        try { localStorage.setItem('eodPostSendClearPref', 'always'); } catch (_) {}
        wipe = true;
      } else if (id === 'never') {
        try { localStorage.setItem('eodPostSendClearPref', 'never'); } catch (_) {}
        wipe = false;
      } else {
        wipe = id === 'yes';
      }
    }
    if (wipe) {
      await S.resetVisit({ wipePersonal: false, wipeSetBefores: false });
      global.EodChrome?.refresh();
      global.EodRouter.go('visit');
    }
  }

  async function uploadPackageParts(payload, headers) {
    const api = global.EOD_API_BASE;
    let packageId = null;
    async function postPart(body) {
      const resp = await global.authFetch(`${api}/api/eod-artifacts/part`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (resp.status === 412) {
        const err = new Error('day_confirm_required');
        err.status = 412;
        throw err;
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || data.message || `Upload failed (${resp.status})`);
      }
      return data;
    }
    if (payload.pdfBase64) {
      const part = await postPart({
        storeNumber: payload.storeNumber,
        workDate: payload.workDate,
        kind: 'pdf',
        filename: payload.pdfFilename || `EOD_Store${payload.storeNumber}.pdf`,
        mime: 'application/pdf',
        contentBase64: String(payload.pdfBase64).replace(/\s+/g, ''),
      });
      packageId = part.packageId;
    }
    const photos = Array.isArray(payload.signoffPhotos) ? payload.signoffPhotos : [];
    for (let i = 0; i < photos.length; i++) {
      const raw = photos[i];
      const s = typeof raw === 'string' ? raw : (raw && (raw.dataUrl || raw.imageBase64 || raw.content)) || '';
      const str = String(s || '');
      const m = str.match(/^data:([^;]+);base64,(.*)$/i);
      const mime = m ? m[1] : 'image/jpeg';
      const contentBase64 = (m ? m[2] : str).replace(/\s+/g, '');
      if (!contentBase64) continue;
      const part = await postPart({
        packageId: packageId || undefined,
        storeNumber: payload.storeNumber,
        workDate: payload.workDate,
        kind: 'signoff',
        filename: (raw && raw.filename) || `signoff_${i}.jpg`,
        mime,
        contentBase64,
      });
      packageId = part.packageId;
    }
    return packageId;
  }

  function networkSendMessage(err) {
    const msg = String((err && err.message) || err || '');
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      return 'Network dropped while sending. Stay on this screen and tap Send EOD again.';
    }
    return msg || 'Unknown error';
  }

  global.EodSend = { buildPayload, gateMessage };
  global.EodRouter.register('send', render);
})(typeof window !== 'undefined' ? window : globalThis);
