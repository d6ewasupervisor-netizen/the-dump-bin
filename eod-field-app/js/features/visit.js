/* Visit setup + day-confirm gate + optional cart / check-in / befores. */
(function (global) {
  'use strict';

  const STORES = [5,11,13,17,18,19,21,23,24,25,28,30,31,35,40,41,49,50,53,60,63,70,71,75,90,93,111,122,125,126,127,135,140,143,150,153,156,158,163,165,171,180,185,186,195,196,198,208,209,210,214,215,218,220,224,225,226,227,236,240,242,253,255,260,265,281,285,286,325,328,351,355,360,372,375,377,383,390,391,393,417,424,439,449,457,458,459,460,462,464,482,485,486,516,600,603,604,605,608,613,614,615,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,665,667,668,681,682,683,685,688,691,694,999];

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function preparePhoto(file, type) {
    if (global.EodPhotoCompress?.compressFile) {
      const out = await global.EodPhotoCompress.compressFile(file, type || 'cart');
      return out.dataUrl;
    }
    return readFileAsDataUrl(file);
  }

  async function verifyAndPersist(store, date, statusEl) {
    const S = global.EodSession;
    statusEl.innerHTML = '<span class="muted">Checking SAS roster…</span>';
    const resp = await global.authFetch(`${global.EOD_API_BASE}/api/verify-store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeNumber: store, date }),
    });
    const result = await resp.json().catch(() => ({}));
    if (resp.ok && result.ok && result.token) {
      S.persistDayConfirm({ token: result.token, store, date, expiresInMs: result.expiresInMs });
      S.patch({ storeNumber: S.normStoreNumber(store), workDate: S.normIsoDate(date) }, 'visit');
      S.saveDraft();
      return { ok: true };
    }
    if (resp.status === 403 && result.reason === 'not_on_roster') {
      return {
        ok: false,
        needsOverride: true,
        message: result.error || 'You don’t appear on today’s SAS roster for this store.',
      };
    }
    if (result.needsOverride || result.needsSupervisor) {
      return { ok: false, needsOverride: true, message: result.error || result.message || 'Supervisor override required' };
    }
    return { ok: false, message: result.error || result.reason || result.message || `Verify failed (${resp.status})` };
  }

  let overridePollTimer = null;

  function stopOverridePoll() {
    if (overridePollTimer) {
      clearInterval(overridePollTimer);
      overridePollTimer = null;
    }
  }

  async function requestStoreOverride(store, date, reason, statusEl) {
    const resp = await global.authFetch(`${global.EOD_API_BASE}/api/store-confirm-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeNumber: store, date, reason: String(reason || '').slice(0, 500) }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || !result.requestId) {
      throw new Error(result.error || `Request failed (${resp.status})`);
    }
    return result;
  }

  function startOverridePoll(requestId, store, date, statusEl, onApproved) {
    stopOverridePoll();
    const url = `${global.EOD_API_BASE}/api/store-confirm-request/${encodeURIComponent(requestId)}/status`;
    const tick = async () => {
      try {
        const resp = await global.authFetch(url);
        const result = await resp.json().catch(() => ({}));
        if (result.status === 'approved' && result.token) {
          stopOverridePoll();
          const S = global.EodSession;
          S.persistDayConfirm({ token: result.token, store, date, expiresInMs: result.expiresInMs });
          S.patch({ storeNumber: S.normStoreNumber(store), workDate: S.normIsoDate(date) }, 'visit');
          S.saveDraft();
          if (onApproved) await onApproved();
          return;
        }
        if (result.status === 'denied') {
          stopOverridePoll();
          statusEl.innerHTML = '<span style="color:#ef4444;">Override denied.</span>';
          return;
        }
        if (result.status === 'expired') {
          stopOverridePoll();
          statusEl.innerHTML = '<span style="color:#ef4444;">Override request expired. Try again.</span>';
        }
      } catch (_) { /* keep polling */ }
    };
    overridePollTimer = setInterval(tick, 4000);
    tick();
  }

  function showOverridePrompt(store, date, statusEl, onApproved) {
    statusEl.innerHTML =
      `<div style="color:#fbbf24;">You don’t appear on today’s SAS roster for store ${esc(store)} on ${esc(date)}.</div>` +
      `<textarea id="visitOverrideReason" rows="2" placeholder="Why are you at this store today?" style="width:100%;margin-top:8px;"></textarea>` +
      `<div class="btn-row" style="margin-top:8px;">` +
      `<button type="button" class="btn btn-primary" id="visitOverrideBtn">Request override</button>` +
      `</div>`;
    const btn = document.getElementById('visitOverrideBtn');
    if (!btn) return;
    btn.onclick = async () => {
      const reason = (document.getElementById('visitOverrideReason')?.value || '').trim();
      btn.disabled = true;
      statusEl.innerHTML = '<span class="muted">Sending override request…</span>';
      try {
        const result = await requestStoreOverride(store, date, reason, statusEl);
        const approver = result.approverEmail || 'your supervisor';
        const emailWarn = result.emailDelivered === false
          ? `<div style="color:#fbbf24;font-size:13px;margin-top:6px;">Email delivery failed (${esc(result.emailError || 'unknown')}). Ping ${esc(approver)} directly.</div>`
          : '';
        statusEl.innerHTML =
          `<div style="color:#88c4ed;">Override requested. Waiting for ${esc(approver)}…</div>${emailWarn}`;
        startOverridePoll(result.requestId, store, date, statusEl, onApproved);
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#ef4444;">${esc(err.message || String(err))}</span>`;
      }
    };
  }

  async function prefetchSheetWeek(store, date) {
    const S = global.EodSession;
    try {
      const qs = new URLSearchParams({ store, date });
      const resp = await global.authFetch(
        `https://eod-api.the-dump-bin.com/api/digital-signoffs/sheet?${qs}`
      );
      const data = await resp.json().catch(() => ({}));
      if (data.sheet?.fiscalWeek) {
        S.patch({
          sheet: data.sheet,
          sheetLoaded: true,
          fiscalWeek: data.sheet.fiscalWeek,
        }, 'sheet-prefetch');
        return data.sheet;
      }
      if (data.fiscalWeek) {
        S.patch({ fiscalWeek: data.fiscalWeek }, 'sheet-prefetch');
      }
    } catch (_) { /* optional */ }
    return null;
  }

  async function findShifts(store, date, listEl) {
    const S = global.EodSession;
    listEl.innerHTML = '<p class="muted">Searching…</p>';
    const resp = await global.authFetch(
      `${global.EOD_API_BASE}/api/shifts?store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Shift search failed (${resp.status})`);
    }
    const data = await resp.json();
    let shifts = Array.isArray(data) ? data : (data.shifts || []);
    const input = S.normStoreNumber(store);
    shifts = shifts.filter((s) => {
      const sStore = S.normStoreNumber(s.storeNumber || s.store_number || s.store);
      return sStore === input;
    });
    S.patch({ shifts, selectedShift: shifts.length === 1 ? shifts[0] : null }, 'shifts');
    if (!shifts.length) {
      listEl.innerHTML = S.normStoreNumber(store) === '999'
        ? '<p class="muted">No sandbox shift cloned yet — ask an admin to run POST /api/sandbox/clone-shift.</p>'
        : '<p class="muted">No shifts found for this store/date.</p>';
      return;
    }
    const selIdx = shifts.length === 1 ? 0 : -1;
    listEl.innerHTML = renderShiftCards(shifts, selIdx);
    wireShiftCards(listEl);
    if (shifts.length === 1) {
      await applyLeadFromShift(shifts[0]);
      advanceAfterShiftSelected();
    }
  }

  function renderShiftCards(shifts, selectedIndex) {
    return shifts.map((shift, i) => {
      const status = shift.currentStatus || shift.status || 'unknown';
      const sel = i === selectedIndex ? ' selected' : '';
      return `<div class="shift-card${sel}" data-idx="${i}">
        <strong>${esc(shift.projectName || shift.teamName || 'Shift')}</strong>
        <div class="muted">${esc(status)} · ${esc(String(shift.totalHours ?? ''))} hrs · ${esc(String(shift.empCount ?? shift.employeeCount ?? ''))} people</div>
        <div class="muted">${esc(shift.visitLead || shift.leadName || '')}</div>
      </div>`;
    }).join('');
  }

  function wireShiftCards(listEl) {
    const S = global.EodSession;
    listEl.querySelectorAll('.shift-card').forEach((card) => {
      card.onclick = async () => {
        const idx = Number(card.getAttribute('data-idx'));
        const shift = S.state.shifts[idx];
        if (!shift) return;
        listEl.querySelectorAll('.shift-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        S.patch({ selectedShift: shift }, 'shift');
        await applyLeadFromShift(shift);
        S.saveDraft();
        advanceAfterShiftSelected();
        paintOnboarding();
        updateContinueBtn();
      };
    });
  }

  async function applyLeadFromShift(shift) {
    const S = global.EodSession;
    const lead = shift.visitLead || shift.leadName || '';
    if (lead) {
      S.patch({ leadName: lead, profileName: lead }, 'lead');
      const nameEl = document.getElementById('visitLeadName');
      if (nameEl) nameEl.value = lead;
      const profileEl = document.getElementById('visitName');
      if (profileEl && !profileEl.value.trim()) profileEl.value = lead;
    }

    let email = shift.visitLeadEmail || shift.leadEmail || shift.email || '';
    if (!email && lead) {
      try {
        const resp = await global.authFetch(
          `${global.EOD_API_BASE}/api/lead-info?name=${encodeURIComponent(lead)}`
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.email) email = String(data.email).trim();
      } catch (_) { /* optional */ }
    }
    if (email) {
      S.patch({ profileEmail: email }, 'lead-email');
      const emailEl = document.getElementById('visitEmail');
      if (emailEl) emailEl.value = email;
    }
  }

  function advanceAfterShiftSelected() {
    const S = global.EodSession;
    if (!S.state.selectedShift) return;
    let step = S.state.visitStep || 'setup';
    if (step === 'setup') step = 'cart';
    S.patch({ visitStep: step }, 'visit-step');
    S.saveDraft();
  }

  /** Store confirmed + a shift selected is enough to continue. Optional steps never block. */
  function canContinue() {
    const S = global.EodSession;
    return !!(S.isVisitReady() && S.state.selectedShift);
  }

  function updateContinueBtn() {
    const continueBtn = document.getElementById('continueBtn');
    if (continueBtn) continueBtn.disabled = !canContinue();
  }

  function cartPhotos(slot) {
    const S = global.EodSession;
    const key = slot === 'after' ? 'after' : 'before';
    return (S.state.photos?.[key] || []).filter((p) => !p?.kind || p.kind === 'cart' || p.kind === `cart-${key}`);
  }

  function thumbRow(list) {
    if (!list.length) return '<p class="muted">None yet.</p>';
    return `<div class="set-thumbs">${list.map((p) => {
      const src = p.dataUrl || p.preview || p;
      return `<div class="set-thumb"><img src="${esc(typeof src === 'string' ? src : '')}" alt="cart"></div>`;
    }).join('')}</div>`;
  }

  async function pullCartFromProd(slot) {
    const S = global.EodSession;
    const visitId = S.state.selectedShift?.visitId;
    if (!visitId) throw new Error('Select a shift first');
    const path = slot === 'after'
      ? `/api/visit-photos/${encodeURIComponent(visitId)}/after-images`
      : `/api/visit-photos/${encodeURIComponent(visitId)}/before-images`;
    const resp = await global.authFetch(`${global.EOD_API_BASE}${path}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Pull failed (${resp.status})`);
    const images = Array.isArray(data.images) ? data.images.filter((i) => i?.url) : [];
    if (!images.length) throw new Error('No KOMPASS MAINTENANCE photos in PROD for this slot');

    const entries = [];
    for (const img of images) {
      entries.push({
        dataUrl: img.url,
        preview: img.url,
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        stampedAt: Date.now(),
        kind: `cart-${slot}`,
        source: 'prod',
        prodImageId: img.id || null,
        categoryResetId: data.categoryResetId || null,
      });
    }

    const photos = Object.assign({}, S.state.photos, {
      [slot]: entries,
    });
    const patch = { photos };
    if (slot === 'before') patch.cartPhotoDone = true;
    S.patch(patch, 'cart-pull-prod');
    if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(photos);
    S.saveDraft();
    return entries.length;
  }

  async function uploadCartToProd(slot, dataUrl) {
    const S = global.EodSession;
    const visitId = S.state.selectedShift?.visitId;
    if (!visitId) throw new Error('Select a shift first');
    const storeNumber = S.state.storeNumber;
    const date = S.state.workDate;
    const leadName = S.state.leadName || S.state.profileName || '';
    const padded = String(storeNumber).padStart(3, '0');
    const dateCompact = String(date || '').replace(/-/g, '');
    const filename = `fm${padded}_kompass_cart_${slot}_photo_${dateCompact}.jpg`;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const resp = await global.authFetch(`${global.EOD_API_BASE}/sas-upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        storeNumber,
        date,
        leadName,
        visitId,
        photoBase64: dataUrl,
        slot,
        targetReset: 'MAINTENANCE',
        filename,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);
    return data;
  }

  function paintOnboarding() {
    const S = global.EodSession;
    const host = document.getElementById('visitOnboarding');
    if (!host) return;

    if (!S.isVisitReady() || !S.state.selectedShift) {
      host.innerHTML = '';
      return;
    }

    const befores = cartPhotos('before');

    host.innerHTML = `
      <section class="visit-step-panel">
        <h3>Kompass cart — before</h3>
        <div class="field">
          ${thumbRow(befores)}
          <div class="btn-row">
            <label class="btn btn-primary" style="cursor:pointer;">
              Take / add
              <input type="file" accept="image/*,.heic,.heif" capture="environment" id="cartBeforeInput" hidden>
            </label>
            <button type="button" class="btn btn-secondary" id="cartBeforePull">Pull from PROD</button>
            <button type="button" class="btn btn-secondary" id="cartBeforePush" ${befores.length ? '' : 'disabled'}>Upload to PROD</button>
          </div>
        </div>
        <div id="cartMsg" class="muted" style="margin-top:8px;"></div>
      </section>

      <section class="visit-step-panel" style="margin-top:16px;">
        <h3>Manager checked in with</h3>
        <div class="field">
          <label for="checkInManager">Name / title</label>
          <input type="text" id="checkInManager" value="${esc(S.state.checkInManager || '')}" list="mgrListVisit" autocomplete="off">
          <button type="button" class="btn btn-secondary btn-block" id="pickInMgr" style="margin-top:6px;">Choose saved name</button>
        </div>
        <datalist id="mgrListVisit">${(S.state.managerNamePool || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </section>
        `;

    function setCartMsg(text, isErr) {
      const el = document.getElementById('cartMsg');
      if (!el) return;
      el.style.color = isErr ? 'var(--danger)' : '';
      el.textContent = text || '';
    }

    async function addCartFile(slot, file) {
      const pipe = global.EodPhotoPipeline;
      if (pipe?.enqueue) {
        const job = pipe.enqueue({
          kind: 'cart',
          compressType: slot === 'after' ? 'after' : 'before',
          slot,
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
          kind: `cart-${slot}`,
          jobId: job.id,
        };
        const existing = (S.state.photos?.[slot] || []).filter((p) => p?.kind && !String(p.kind).startsWith('cart'));
        const photos = Object.assign({}, S.state.photos, {
          [slot]: [...existing, entry],
        });
        const patch = { photos };
        if (slot === 'before') patch.cartPhotoDone = true;
        S.patch(patch, 'cart-photo');
        if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(photos);
        S.saveDraft();
        setCartMsg(`${slot} queued`);
        paintOnboarding();
        return;
      }
      const dataUrl = await preparePhoto(file, slot === 'after' ? 'after' : 'before');
      const entry = {
        dataUrl,
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        stampedAt: Date.now(),
        kind: `cart-${slot}`,
      };
      const existing = (S.state.photos?.[slot] || []).filter((p) => p?.kind && !String(p.kind).startsWith('cart'));
      const photos = Object.assign({}, S.state.photos, {
        [slot]: [...existing, entry],
      });
      const patch = { photos };
      if (slot === 'before') patch.cartPhotoDone = true;
      S.patch(patch, 'cart-photo');
      if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(photos);
      S.saveDraft();
      try {
        setCartMsg(`Uploading ${slot} to PROD…`);
        await uploadCartToProd(slot, dataUrl);
        setCartMsg(`${slot} uploaded to PROD (KOMPASS MAINTENANCE).`);
      } catch (err) {
        setCartMsg(err.message || String(err), true);
      }
      paintOnboarding();
    }

    const beforeInput = document.getElementById('cartBeforeInput');
    if (beforeInput) {
      beforeInput.onchange = async () => {
        const file = beforeInput.files?.[0];
        beforeInput.value = '';
        if (file) await addCartFile('before', file);
      };
    }

    document.getElementById('cartBeforePull').onclick = async () => {
      try {
        setCartMsg('Pulling before from PROD…');
        const n = await pullCartFromProd('before');
        setCartMsg(`Pulled ${n} before photo(s) from PROD.`);
        paintOnboarding();
      } catch (err) {
        setCartMsg(err.message || String(err), true);
      }
    };
    document.getElementById('cartBeforePush').onclick = async () => {
      try {
        const list = cartPhotos('before');
        for (const p of list) {
          await uploadCartToProd('before', p.dataUrl || p);
        }
        setCartMsg('Before photos uploaded to PROD.');
      } catch (err) {
        setCartMsg(err.message || String(err), true);
      }
    };

    const checkIn = document.getElementById('checkInManager');
    if (checkIn) {
      checkIn.oninput = () => {
        const name = checkIn.value.trim();
        S.patch({
          checkInManager: name,
          checkInDone: !!name,
        }, 'checkin');
        S.saveDraft();
      };
    }
    document.getElementById('pickInMgr')?.addEventListener('click', () => {
      const items = (S.state.managerNamePool || []).map((n, i) => ({ id: String(i), label: n }));
      global.EodPicker.open({
        anchor: document.getElementById('pickInMgr'),
        title: 'Saved managers',
        items: items.length ? items : [{ id: 'x', label: 'No saved names', disabled: true }],
        searchable: items.length > 6,
        onChoose(item) {
          if (!checkIn) return;
          checkIn.value = item.label;
          checkIn.dispatchEvent(new Event('input'));
        },
      });
    });


  }

  async function doReset() {
    const S = global.EodSession;
    const wipePersonal = confirm(
      'Reset visit?\n\nOK = clear store, shift, day-confirm, cart photos, and check-in.\n\nCancel = abort.\n\n(You will be asked separately about personal name/email and week before photos.)'
    );
    if (!wipePersonal) return;
    const wipeProfile = confirm('Also remove saved name / email / signature on this phone?');
    const wipeBefores = confirm(
      'Also erase week-scoped SET BEFORE photos on this phone?\n\nChoose Cancel to keep Monday befores for later backlog days.'
    );
    await S.resetVisit({ wipePersonal: wipeProfile, wipeSetBefores: wipeBefores });
    global.EodChrome?.refresh();
    global.EodRouter.render();
  }

  async function render(mount) {
    const S = global.EodSession;
    const ready = S.isVisitReady();
    if (ready && global.EodCover?.loadStoreData) {
      try { await global.EodCover.loadStoreData(S.state.storeNumber); } catch (_) {}
    }
    if (ready && global.PhotoDB?.switchToDayConfirm) {
      try {
        await global.PhotoDB.switchToDayConfirm(S.state.storeNumber, S.state.workDate, S.state.photos);
      } catch (_) {}
    }

    const selIdx = S.state.shifts.findIndex(
      (s) => s === S.state.selectedShift || s.visitId === S.state.selectedShift?.visitId
    );

    mount.innerHTML = `
      <div class="card">
        <div class="btn-row" style="justify-content:space-between;align-items:center;">
          <h1 style="margin:0;">Today's visit</h1>
          <button type="button" class="btn btn-secondary" id="resetVisitBtn">Reset</button>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Store #</label>
            <input type="text" id="visitStore" list="storeList" placeholder="Store number" value="${esc(S.state.storeNumber)}">
            <datalist id="storeList">${STORES.map((n) => `<option value="${n}">`).join('')}</datalist>
            <button type="button" class="btn btn-secondary btn-block" id="pickStoreBtn" style="margin-top:6px;">Pick from list</button>
          </div>
          <div class="field">
            <label>Work date</label>
            <input type="date" id="visitDate" value="${esc(S.state.workDate || S.todayLocalIsoDate())}">
          </div>
        </div>
        <div id="visitStatus" class="muted" style="min-height:1.2em;margin-bottom:8px;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="confirmVisitBtn">${ready ? 'Re-confirm store' : 'Confirm store & date'}</button>
          <button type="button" class="btn btn-secondary" id="findShiftsBtn" ${ready ? '' : 'disabled'}>Find shifts</button>
        </div>
      </div>

      <div class="card" id="shiftCard">
        <h2>Shifts</h2>
        <div id="shiftList">${S.state.shifts.length ? renderShiftCards(S.state.shifts, selIdx) : '<p class="muted">Confirm store, then find shifts.</p>'}</div>
        <div class="field" style="margin-top:14px;">
          <label>Lead name</label>
          <input type="text" id="visitLeadName" value="${esc(S.state.leadName || S.state.profileName || '')}">
        </div>
        <div class="field">
          <label>Lead email</label>
          <input type="email" id="visitEmail" value="${esc(S.state.profileEmail)}" placeholder="you@example.com">
        </div>
      </div>

      <div class="card">
        <div id="visitOnboarding"></div>
      </div>
`;

    if (S.state.shifts.length) wireShiftCards(document.getElementById('shiftList'));
    paintOnboarding();

    document.getElementById('resetVisitBtn').onclick = () => doReset();

    document.getElementById('visitLeadName').oninput = () => {
      const lead = document.getElementById('visitLeadName').value.trim();
      S.patch({ leadName: lead, profileName: lead || S.state.profileName }, 'lead-edit');
      S.saveDraft();
    };

    document.getElementById('visitEmail').oninput = () => {
      const email = document.getElementById('visitEmail').value.trim();
      S.patch({ profileEmail: email }, 'email-edit');
      S.saveDraft();
    };

    document.getElementById('pickStoreBtn').onclick = () => {
      global.EodPicker.open({
        anchor: document.getElementById('pickStoreBtn'),
        title: 'Store number',
        items: STORES.map((n) => ({ id: String(n), label: `Store ${n}` })),
        searchable: true,
        onChoose(item) {
          document.getElementById('visitStore').value = item.id;
        },
      });
    };

    document.getElementById('confirmVisitBtn').onclick = async () => {
      const store = document.getElementById('visitStore').value.trim();
      const date = document.getElementById('visitDate').value.trim();
      const status = document.getElementById('visitStatus');
      const email = document.getElementById('visitEmail').value.trim();
      S.patch({ profileEmail: email, storeNumber: store, workDate: date }, 'profile');
      const btn = document.getElementById('confirmVisitBtn');
      btn.disabled = true;
      try {
        const result = await verifyAndPersist(store, date, status);
        if (!result.ok) {
          if (result.needsOverride) {
            showOverridePrompt(store, date, status, async () => {
              status.innerHTML = '<span style="color:#22c55e;">Store confirmed for today.</span>';
              document.getElementById('findShiftsBtn').disabled = false;
              global.EodChrome?.refresh();
              await prefetchSheetWeek(store, date);
              try {
                await findShifts(store, date, document.getElementById('shiftList'));
              } catch (err) {
                document.getElementById('shiftList').innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
              }
              paintOnboarding();
              updateContinueBtn();
            });
            return;
          }
          status.innerHTML = `<span style="color:#ef4444;">${esc(result.message)}</span>`;
          return;
        }
        status.innerHTML = '<span style="color:#22c55e;">Store confirmed for today.</span>';
        document.getElementById('findShiftsBtn').disabled = false;
        global.EodChrome?.refresh();
        await prefetchSheetWeek(store, date);
        if (global.PhotoDB?.switchToDayConfirm) {
          await global.PhotoDB.switchToDayConfirm(store, date, S.state.photos);
        }
        try {
          await findShifts(store, date, document.getElementById('shiftList'));
        } catch (err) {
          document.getElementById('shiftList').innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
        }
        paintOnboarding();
        updateContinueBtn();
      } catch (err) {
        status.innerHTML = `<span style="color:#ef4444;">${esc(err.message)}</span>`;
      } finally {
        btn.disabled = false;
      }
    };

    document.getElementById('findShiftsBtn').onclick = async () => {
      const store = document.getElementById('visitStore').value.trim();
      const date = document.getElementById('visitDate').value.trim();
      try {
        await findShifts(store, date, document.getElementById('shiftList'));
        paintOnboarding();
        updateContinueBtn();
      } catch (err) {
        document.getElementById('shiftList').innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
      }
    };

  }

  global.EodVisitCart = { cartPhotos, preparePhoto, pullCartFromProd, uploadCartToProd, thumbRow };
  global.EodRouter.register('visit', render);
})(typeof window !== 'undefined' ? window : globalThis);
