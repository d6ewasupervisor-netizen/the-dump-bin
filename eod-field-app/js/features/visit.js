/* Visit setup + day-confirm gate + optional cart / check-in / befores. */
(function (global) {
  'use strict';

  const FALLBACK_STORES = [5,11,13,17,18,19,21,23,24,25,28,30,31,35,40,41,49,50,53,60,63,70,71,75,90,93,111,122,125,126,127,135,140,143,150,153,156,158,163,165,171,180,185,186,195,196,198,208,209,210,214,215,218,220,224,225,226,227,236,240,242,253,255,260,265,281,285,286,325,328,351,355,360,372,375,377,383,390,391,393,417,424,439,449,457,458,459,460,462,464,482,485,486,516,600,603,604,605,608,613,614,615,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,665,667,668,681,682,683,685,688,691,694,999];
  const STORE_CACHE_KEY = 'eodCatalogStores';
  let catalogStores = null;

  function storeNumbers() {
    const src = Array.isArray(catalogStores) && catalogStores.length ? catalogStores : FALLBACK_STORES;
    const nums = src.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
    if (!nums.includes(999)) nums.push(999);
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  async function ensureStoreCatalog() {
    if (catalogStores && catalogStores.length) return storeNumbers();
    try {
      const cached = JSON.parse(localStorage.getItem(STORE_CACHE_KEY) || 'null');
      if (Array.isArray(cached) && cached.length) catalogStores = cached;
    } catch (_) {}
    try {
      const resp = await global.authFetch(`${global.EOD_API_BASE}/api/digital-signoffs/catalog-stores`);
      const data = await resp.json().catch(() => ({}));
      const nums = (data.stores || []).map((s) => Number(s.storeNum || s.storeNumber || s)).filter((n) => Number.isFinite(n) && n > 0);
      if (nums.length) {
        catalogStores = nums;
        try { localStorage.setItem(STORE_CACHE_KEY, JSON.stringify(nums)); } catch (_) {}
      }
    } catch (_) {}
    return storeNumbers();
  }

  function esc(s) { return global.EodApi.escapeHtml(s); }

  const VERIFY_MS = 15000;
  const SHIFT_MS = 20000;
  const HYDRATE_MS = 12000;

  function withTimeout(promise, ms, label) {
    if (!promise) return Promise.resolve(null);
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => { if (timer) clearTimeout(timer); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label || `Timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  }

  function authFetchTimeout(url, init, ms, label) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const opts = Object.assign({}, init || {}, { signal: ctrl.signal });
    return global.authFetch(url, opts).finally(() => clearTimeout(timer)).catch((err) => {
      if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')))) {
        throw new Error(label || `Timed out after ${Math.round(ms / 1000)}s`);
      }
      throw err;
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function preparePhoto(file, type) {
    const converted = global.EodHeic?.prepareFile ? await global.EodHeic.prepareFile(file) : file;
    if (global.EodPhotoCompress?.compressFile) {
      const out = await global.EodPhotoCompress.compressFile(converted, type || 'cart');
      return out.dataUrl;
    }
    return readFileAsDataUrl(converted);
  }

  async function verifyAndPersist(store, date, statusEl) {
    const S = global.EodSession;
    statusEl.innerHTML = '<span class="muted">Confirming store…</span>';
    const resp = await authFetchTimeout(
      `${global.EOD_API_BASE}/api/verify-store`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeNumber: store, date }),
        skipBusy: true,
      },
      VERIFY_MS,
      'Store check timed out. Try again.'
    );
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

  function siblingExtraIds(shifts, selected) {
    const primary = String(selected?.visitId || '');
    return (shifts || [])
      .map((s) => String(s.visitId || ''))
      .filter((id) => id && id !== primary);
  }

  function leadNameNow() {
    const S = global.EodSession;
    return String(
      S.resolvedLeadName?.()
      || S.state.leadName
      || S.state.profileName
      || ''
    ).trim();
  }

  function applyShiftsToSession(shifts, listEl, reason) {
    const S = global.EodSession;
    const L = global.EodSendSheetsLogic || {};
    const picked = L.pickVisibleLeadShift
      ? L.pickVisibleLeadShift(shifts, leadNameNow(), S.state.selectedShift)
      : {
        visible: shifts,
        selected: shifts.length === 1 ? shifts[0] : S.state.selectedShift,
      };
    const selected = picked.selected || null;
    S.patch({
      shifts,
      selectedShift: selected,
      extraVisitIds: selected ? siblingExtraIds(shifts, selected) : [],
    }, reason);
    paintShiftList(listEl);
    return picked;
  }

  function paintShiftList(listEl) {
    if (!listEl) return;
    const S = global.EodSession;
    const L = global.EodSendSheetsLogic || {};
    const all = S.state.shifts || [];
    const visible = L.visibleLeadShifts
      ? L.visibleLeadShifts(all, leadNameNow())
      : all;
    const selId = String(S.state.selectedShift?.visitId || '');
    if (!all.length) {
      listEl.innerHTML = '<p class="muted">Confirm store to load shifts.</p>';
      return;
    }
    if (!visible.length) {
      listEl.innerHTML = '<p class="muted">No ISE, Cut In, Blitz, DIV, or Central Pet shift for this store.</p>';
      return;
    }
    listEl.innerHTML = renderShiftCards(visible, selId);
    wireShiftCards(listEl, visible);
  }

  function paintCachedShifts(store, date, listEl) {
    const cached = global.EodShiftDay?.shiftsForStore?.(store, date);
    if (!cached || !cached.length || !listEl) return false;
    const S = global.EodSession;
    const input = S.normStoreNumber(store);
    const shifts = cached.filter((s) => S.normStoreNumber(s.storeNumber || s.store_number || s.store) === input);
    if (!shifts.length) return false;
    applyShiftsToSession(shifts, listEl, 'shifts-cache');
    return true;
  }

  async function findShifts(store, date, listEl) {
    const S = global.EodSession;
    try { await global.EodShiftDay?.load?.(date); } catch (_) {}
    const hadCache = paintCachedShifts(store, date, listEl);
    if (!hadCache && listEl) listEl.innerHTML = '<p class="muted">Searching…</p>';
    const resp = await authFetchTimeout(
      `${global.EOD_API_BASE}/api/shifts?store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`,
      hadCache ? { skipBusy: true } : { busyForce: true },
      SHIFT_MS,
      'Shift search timed out. Pull to refresh or tap Confirm again.'
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
    if (!shifts.length) {
      S.patch({ shifts: [], selectedShift: null, extraVisitIds: [] }, 'shifts');
      listEl.innerHTML = S.normStoreNumber(store) === '999'
        ? '<p class="muted">No sandbox shift cloned yet — ask an admin to run POST /api/sandbox/clone-shift.</p>'
        : '<p class="muted">No shifts found for this store/date.</p>';
      return;
    }
    const picked = applyShiftsToSession(shifts, listEl, 'shifts');
    if (picked.selected) {
      await applyLeadFromShift(picked.selected);
      applyShiftsToSession(shifts, listEl, 'shifts-lead');
      advanceAfterShiftSelected();
    }
  }

  function renderShiftCards(shifts, selectedVisitId) {
    const sel = String(selectedVisitId || '');
    return shifts.map((shift) => {
      const status = shift.currentStatus || shift.status || 'unknown';
      const vid = String(shift.visitId || '');
      const on = vid && vid === sel ? ' selected' : '';
      return `<div class="shift-card${on}" data-visit="${esc(vid)}">
        <strong>${esc(shift.projectName || shift.teamName || 'Shift')}</strong>
        <div class="muted">${esc(status)} · ${esc(String(shift.totalHours ?? ''))} hrs · ${esc(String(shift.empCount ?? shift.employeeCount ?? ''))} people</div>
        <div class="muted">${esc(shift.visitLead || shift.leadName || '')}</div>
        ${/closed|transmitted|complete/i.test(String(status))
          ? '<div class="muted">Closed — still usable for EOD / reports</div>'
          : ''}
      </div>`;
    }).join('');
  }

  function wireShiftCards(listEl, visible) {
    const S = global.EodSession;
    const cards = visible || [];
    listEl.querySelectorAll('.shift-card').forEach((card) => {
      card.onclick = async () => {
        const vid = card.getAttribute('data-visit');
        const shift = cards.find((s) => String(s.visitId) === vid)
          || (S.state.shifts || []).find((s) => String(s.visitId) === vid);
        if (!shift) return;
        listEl.querySelectorAll('.shift-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        S.patch({
          selectedShift: shift,
          extraVisitIds: siblingExtraIds(S.state.shifts, shift),
        }, 'shift');
        await applyLeadFromShift(shift);
        S.saveDraft();
        advanceAfterShiftSelected();
        try { global.EodShiftPhotoSync?.run?.('shift'); } catch (_) {}
        paintOnboarding();
        updateContinueBtn();
        paintShiftList(listEl);
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
    if (!email && lead && !(S.state.profileEmail || '').trim()) {
      try {
        const resp = await authFetchTimeout(
          `${global.EOD_API_BASE}/api/lead-info?name=${encodeURIComponent(lead)}`,
          { skipBusy: true },
          8000,
          'Lead lookup timed out'
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.email) email = String(data.email).trim();
      } catch (_) { /* optional */ }
    }
    if (email) {
      S.patch({ profileEmail: email, profileLocked: true }, 'lead-email');
      const emailEl = document.getElementById('visitEmail');
      if (emailEl) {
        emailEl.value = email;
        emailEl.readOnly = true;
      }
      const nameEl = document.getElementById('visitLeadName');
      if (nameEl) nameEl.readOnly = true;
      const editBtn = document.getElementById('unlockProfileBtn');
      if (editBtn) editBtn.hidden = false;
    }
  }

  function advanceAfterShiftSelected() {
    const S = global.EodSession;
    if (!S.state.selectedShift) return;
    let step = S.state.visitStep || 'setup';
    if (step === 'setup') step = 'cart';
    S.patch({ visitStep: step }, 'visit-step');
    S.saveDraft();
    try { global.EodShiftPhotoSync?.run?.('shift'); } catch (_) {}
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
    const L = global.EodSendSheetsLogic || {};
    const live = global.PhotoDB?.liveObjectUrls;
    return `<div class="set-thumbs">${list.map((p) => {
      const raw = L.photoEntrySrc ? L.photoEntrySrc(p) : (
        typeof p === 'string' ? p : (p.dataUrl || p.previewUrl || p.preview || '')
      );
      const ok = L.isDisplayablePhotoSrc
        ? L.isDisplayablePhotoSrc(raw, live)
        : /^data:image\//i.test(raw);
      const img = ok ? `<img src="${esc(raw)}" alt="cart">` : '';
      const warn = ok ? '' : '<span class="muted">Didn\'t save. Retake or Pull from PROD.</span>';
      return `<div class="set-thumb">${img}${warn}</div>`;
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
    const images = Array.isArray(data.images) ? data.images : [];
    const entries = [];
    for (const img of images) {
      const dataUrl = String(img?.dataUrl || '');
      if (!/^data:image\//i.test(dataUrl)) continue;
      entries.push({
        dataUrl,
        preview: dataUrl,
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        stampedAt: Date.now(),
        kind: `cart-${slot}`,
        source: 'prod',
        prodImageId: img.id || null,
        categoryResetId: data.categoryResetId || null,
        mime: img.mime || null,
        bytes: img.bytes || null,
      });
    }
    if (!entries.length) {
      const failed = Array.isArray(data.failed) ? data.failed.length : 0;
      throw new Error(failed
        ? 'PROD cart photo(s) did not save. Retake or Pull from PROD again.'
        : 'No KOMPASS MAINTENANCE photos in PROD for this slot');
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

  async function paintOnboarding() {
    const S = global.EodSession;
    const host = document.getElementById('visitOnboarding');
    if (!host) return;

    if (!S.isVisitReady() || !S.state.selectedShift) {
      host.innerHTML = '';
      return;
    }

    if (global.PhotoDB?.hydrateArrays) {
      try { await global.PhotoDB.hydrateArrays(S.state.photos); } catch (_) {}
    }

    const befores = cartPhotos('before');

    host.innerHTML = `
      <section class="visit-step-panel">
        <h3>Kompass cart — before</h3>
        <div class="field">
          ${thumbRow(befores)}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="cartBeforeCam">Camera</button>
            <label class="btn btn-secondary" style="cursor:pointer;">
              Add file
              <input type="file" accept="image/*,.heic,.heif" capture="environment" id="cartBeforeInput" hidden>
            </label>
            <button type="button" class="btn btn-secondary" id="cartBeforePull">Pull from PROD</button>
            <button type="button" class="btn btn-secondary" id="cartBeforePush" ${befores.length ? '' : 'disabled'}>Upload to PROD</button>
          </div>
          <button type="button" class="btn btn-secondary btn-block" id="noCartBtn" style="margin-top:8px;">No Kompass Cart</button>
        </div>
        <div id="cartMsg" class="muted" style="margin-top:8px;"></div>
      </section>

      <section class="visit-step-panel" style="margin-top:16px;">
        <h3>Manager checked in with</h3>
        <div class="field" id="checkInField">
          <label for="checkInManager">Name / title</label>
          <input type="text" id="checkInManager" value="${esc(S.state.checkInManager || '')}" list="mgrListVisit" autocomplete="off">
          ${global.EodVisitMemory?.chipsHtml?.(S.state.managerNamePool, S.state.checkInManager, esc) || ''}
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
          previewUrl: job.previewUrl,
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          stampedAt: Date.now(),
          kind: `cart-${slot}`,
          jobId: job.id,
        };
        try { global.PhotoDB?.noteLiveObjectUrl?.(job.previewUrl); } catch (_) {}
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
        paintOnboarding();
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
        if (global.EodVisitMemory?.setManagers) {
          global.EodVisitMemory.setManagers(S, { checkInManager: name }, 'checkin');
        } else {
          S.patch({
            checkInManager: name,
            checkInDone: !!name,
          }, 'checkin');
          S.saveDraft();
        }
      };
    }
    try { global.EodVisitMemory?.bindChipField?.('checkInField', 'in'); } catch (_) {}
    document.getElementById('cartBeforeCam')?.addEventListener('click', async () => {
      if (!global.EodCamera?.open) return;
      await global.EodCamera.open({
        label: 'Kompass cart — before',
        onCapture: async (file) => { await addCartFile('before', file); },
        shouldContinue: () => true,
      });
    });
    document.getElementById('noCartBtn')?.addEventListener('click', async () => {
      if (!global.EodCamera?.open) return;
      await global.EodCamera.open({
        label: 'Photograph the area / Vestcom',
        onCapture: async (file) => { await addCartFile('before', file); },
        shouldContinue: () => false,
      });
    });
    document.getElementById('pickInMgr')?.addEventListener('click', () => {
      const items = (S.state.managerNamePool || []).map((n, i) => ({
        id: String(i),
        label: n,
        removable: true,
      }));
      global.EodPicker.open({
        anchor: document.getElementById('pickInMgr'),
        title: 'Saved names',
        items: items.length ? items : [{ id: 'x', label: 'No saved names', disabled: true }],
        searchable: items.length > 6,
        onChoose(item) {
          const el = document.getElementById('checkInManager');
          if (el) el.value = item.label;
          if (global.EodVisitMemory?.setManagers) {
            global.EodVisitMemory.setManagers(S, { checkInManager: item.label }, 'checkin');
          } else {
            S.patch({ checkInManager: item.label, checkInDone: true }, 'checkin');
            S.saveDraft();
          }
        },
        async onRemove(item) {
          try {
            await global.EodCover?.removeManagerName?.(item.label);
            paintOnboarding();
          } catch (err) {
            setCartMsg(err.message || String(err), true);
          }
        },
      });
    });

  }

  const RESET_OPTS_KEY = 'eodVisitResetOpts';

  function loadResetOpts() {
    try {
      const raw = JSON.parse(localStorage.getItem(RESET_OPTS_KEY) || '{}');
      return {
        wipePersonal: !!raw.wipePersonal,
        wipeSetBefores: !!raw.wipeSetBefores,
        wipeUnsent: !!raw.wipeUnsent,
      };
    } catch (_) {
      return { wipePersonal: false, wipeSetBefores: false, wipeUnsent: false };
    }
  }

  function saveResetOpts(opts) {
    try {
      localStorage.setItem(RESET_OPTS_KEY, JSON.stringify({
        wipePersonal: !!opts.wipePersonal,
        wipeSetBefores: !!opts.wipeSetBefores,
        wipeUnsent: !!opts.wipeUnsent,
      }));
    } catch (_) {}
  }

  function closeResetOverlay() {
    const overlay = document.getElementById('visitResetOverlay');
    global.EodA11y?.deactivate?.(overlay);
    overlay?.remove();
  }

  async function openResetOverlay() {
    closeResetOverlay();
    const opts = loadResetOpts();
    let unsentCount = 0;
    try { unsentCount = (await global.PhotoDB?.unsentSessions?.() || []).length; } catch (_) {}
    const unsentHint = unsentCount
      ? `${unsentCount} other visit${unsentCount === 1 ? '' : 's'} on this phone`
      : 'None on this phone';
    const overlay = document.createElement('div');
    overlay.id = 'visitResetOverlay';
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitResetTitle">
        <h2 id="visitResetTitle">Reset</h2>
        <div class="reset-level">
          <div class="reset-level-copy">
            <strong>This visit</strong>
            <span>Store, shift, day-confirm, cart, check-in</span>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="resetWipeVisit" checked disabled>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="reset-level">
          <div class="reset-level-copy">
            <strong>Personal</strong>
            <span>Name, email, signature on this phone</span>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="resetWipePersonal" ${opts.wipePersonal ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="reset-level">
          <div class="reset-level-copy">
            <strong>Week befores</strong>
            <span>Set-before photos for this store this week</span>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="resetWipeBefores" ${opts.wipeSetBefores ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="reset-level">
          <div class="reset-level-copy">
            <strong>Unsent leftovers</strong>
            <span>${esc(unsentHint)}</span>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="resetWipeUnsent" ${opts.wipeUnsent ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button type="button" class="btn btn-secondary" id="visitResetCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="visitResetConfirm">Reset</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    global.EodA11y?.activate?.(overlay);
    overlay.addEventListener('eod-dialog-escape', closeResetOverlay);

    function currentOpts() {
      return {
        wipePersonal: !!overlay.querySelector('#resetWipePersonal')?.checked,
        wipeSetBefores: !!overlay.querySelector('#resetWipeBefores')?.checked,
        wipeUnsent: !!overlay.querySelector('#resetWipeUnsent')?.checked,
      };
    }

    overlay.querySelector('#resetWipePersonal').onchange = () => saveResetOpts(currentOpts());
    overlay.querySelector('#resetWipeBefores').onchange = () => saveResetOpts(currentOpts());
    overlay.querySelector('#resetWipeUnsent').onchange = () => saveResetOpts(currentOpts());
    overlay.querySelector('#visitResetCancel').onclick = closeResetOverlay;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeResetOverlay(); });
    overlay.querySelector('#visitResetConfirm').onclick = async () => {
      const chosen = currentOpts();
      saveResetOpts(chosen);
      closeResetOverlay();
      await global.EodSession.resetVisit(chosen);
      global.EodChrome?.refresh();
      global.EodRouter.render();
    };
  }

  function doReset() {
    void openResetOverlay();
  }

  function closeDayConfirmModal() {
    const overlay = document.getElementById('dayConfirmModal');
    global.EodA11y?.deactivate?.(overlay);
    overlay?.remove();
  }

  async function cancelDayConfirm() {
    const cancelBtn = document.getElementById('dayConfirmCancel');
    const confirmBtn = document.getElementById('dayConfirmSubmit');
    if (cancelBtn) cancelBtn.disabled = true;
    if (confirmBtn) confirmBtn.disabled = true;
    try { global.EodVisitMemory?.forgetLastStore?.(); } catch (_) {}
    try { await global.EodSession?.resetVisit?.({}); } catch (_) {}
    closeDayConfirmModal();
    location.reload();
  }

  async function finishConfirmedVisit(store, date) {
    const S = global.EodSession;
    global.EodVisitMemory?.rememberLastStore?.(store);
    try { global.EodVisitMemory?.applyToSession?.(S, store); } catch (_) {}
    closeDayConfirmModal();
    global.EodUsage?.track?.('visit_confirm_success', { status: 'confirmed' });
    global.EodA11y?.announce?.('Visit confirmed');
    global.EodChrome?.refresh();
    if (global.EodRouter?.current === 'visit') {
      try { await global.EodRouter.render(); } catch (_) {}
    }
  }

  async function openDayConfirmModal(options) {
    const S = global.EodSession;
    if (document.getElementById('dayConfirmModal')) return;
    const stores = await ensureStoreCatalog();
    const opts = options || {};
    const last = opts.initialStore || global.EodVisitMemory?.lastStore?.() || S.state.storeNumber || '';
    const date = opts.initialDate || S.todayLocalIsoDate();
    const overlay = document.createElement('div');
    overlay.id = 'dayConfirmModal';
    overlay.className = 'modal-overlay show day-confirm-modal';
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="dayConfirmTitle">
        <h2 id="dayConfirmTitle">Confirm store and date</h2>
        <div class="field">
          <label>Store</label>
          <input type="hidden" id="dayConfirmStore" value="${esc(last)}">
          <button type="button" class="btn btn-secondary btn-block" id="dayConfirmStoreBtn">${last ? `Store ${esc(last)}` : 'Choose store'}</button>
        </div>
        <div class="field">
          <label for="dayConfirmDate">Date</label>
          <input type="date" id="dayConfirmDate" value="${esc(date)}">
        </div>
        <div id="dayConfirmStatus" class="muted" style="min-height:1.2em;margin:8px 0;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="dayConfirmCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="dayConfirmSubmit">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    global.EodA11y?.activate?.(overlay, '#dayConfirmStoreBtn');
    overlay.addEventListener('eod-dialog-escape', () => { void cancelDayConfirm(); });
    const storeBtn = overlay.querySelector('#dayConfirmStoreBtn');
    const storeHidden = overlay.querySelector('#dayConfirmStore');
    const dateEl = overlay.querySelector('#dayConfirmDate');
    const statusEl = overlay.querySelector('#dayConfirmStatus');
    try { await global.EodShiftDay?.load?.(date); } catch (_) {}
    storeBtn.onclick = () => {
      const scheduled = new Set(global.EodShiftDay?.scheduledStoreNumbers?.(dateEl.value || date) || []);
      const ordered = [...stores].sort((a, b) => {
        const aS = scheduled.has(Number(a)) ? 0 : 1;
        const bS = scheduled.has(Number(b)) ? 0 : 1;
        return aS - bS || Number(a) - Number(b);
      });
      global.EodPicker.open({
        anchor: storeBtn,
        title: 'Store number',
        items: ordered.map((n) => ({ id: String(n), label: `Store ${n}` })),
        searchable: true,
        onChoose(item) {
          storeHidden.value = item.id;
          storeBtn.textContent = `Store ${item.id}`;
        },
      });
    };
    dateEl.addEventListener('click', () => {
      try { dateEl.showPicker?.(); } catch (_) {}
    });
    dateEl.addEventListener('focus', () => {
      try { dateEl.showPicker?.(); } catch (_) {}
    });
    dateEl.addEventListener('change', () => {
      try { global.EodShiftDay?.load?.(dateEl.value); } catch (_) {}
    });
    overlay.querySelector('#dayConfirmCancel').onclick = () => { void cancelDayConfirm(); };
    overlay.querySelector('#dayConfirmSubmit').onclick = async () => {
      const store = (storeHidden.value || '').trim();
      const workDate = (dateEl.value || '').trim();
      if (!store || !stores.map(String).includes(String(store))) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Choose a store from the list.</span>';
        return;
      }
      if (!workDate) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Pick a date.</span>';
        return;
      }
      const btn = overlay.querySelector('#dayConfirmSubmit');
      btn.disabled = true;
      try {
        const result = await verifyAndPersist(store, workDate, statusEl);
        if (!result.ok) {
          btn.disabled = false;
          if (result.needsOverride) {
            showOverridePrompt(store, workDate, statusEl, async () => {
              await finishConfirmedVisit(store, workDate);
            });
            return;
          }
          statusEl.innerHTML = `<span style="color:#ef4444;">${esc(result.message)}</span>`;
          return;
        }
        statusEl.innerHTML = '<span class="muted">Store confirmed.</span>';
        await finishConfirmedVisit(store, workDate);
      } catch (err) {
        btn.disabled = false;
        statusEl.innerHTML = `<span style="color:#ef4444;">${esc(err.message || String(err))}</span>`;
      }
    };
  }

  function enforceDayConfirmGate() {
    const S = global.EodSession;
    if (!S) return;
    if (S.isVisitReady()) {
      closeDayConfirmModal();
      return;
    }
    openDayConfirmModal();
  }

  function closePriorDayChoice() {
    const overlay = document.getElementById('priorDayChoice');
    global.EodA11y?.deactivate?.(overlay);
    overlay?.remove();
  }

  function presentPriorDayChoice() {
    const S = global.EodSession;
    const prior = S?.getPriorDayDraft?.();
    if (!prior || document.getElementById('priorDayChoice')) return false;
    const overlay = document.createElement('div');
    overlay.id = 'priorDayChoice';
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="priorDayTitle">
        <h2 id="priorDayTitle">Unfinished visit</h2>
        <p>Store ${esc(prior.storeNumber || '—')} · ${esc(prior.workDate || '')}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="priorDayStart">Start today</button>
          <button type="button" class="btn btn-primary" id="priorDayResume">Resume</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    global.EodA11y?.activate?.(overlay, '#priorDayResume');
    overlay.querySelector('#priorDayResume')?.addEventListener('click', async () => {
      S.resolvePriorDayDraft?.('resume');
      closePriorDayChoice();
      if (!S.isVisitReady()) {
        await openDayConfirmModal({ initialStore: prior.storeNumber, initialDate: prior.workDate });
      } else {
        await global.EodRouter?.render?.();
      }
    });
    overlay.querySelector('#priorDayStart')?.addEventListener('click', async () => {
      S.resolvePriorDayDraft?.('start');
      closePriorDayChoice();
      await S.resetVisit({});
      await global.EodRouter?.render?.();
      await openDayConfirmModal();
    });
    return true;
  }

  async function render(mount) {
    const S = global.EodSession;
    const stores = await ensureStoreCatalog();
    const authName = String(global.EodRoles?.getMe?.()?.name || '').trim();
    if (authName && !(S.state.profileName || '').trim() && !(S.state.leadName || '').trim()) {
      S.patch({ profileName: authName, leadName: authName }, 'auth-lead');
    }
    const ready = S.isVisitReady();

    mount.innerHTML = `
      <div class="card">
        <div class="btn-row" style="justify-content:space-between;align-items:center;">
          <h1 style="margin:0;">Today's visit</h1>
          <button type="button" class="btn btn-secondary" id="resetVisitBtn">Reset</button>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Store</label>
            <div class="visit-confirmed">${ready && S.state.storeNumber ? `Store ${esc(S.state.storeNumber)}` : 'Not confirmed'}</div>
          </div>
          <div class="field">
            <label>Work date</label>
            <div class="visit-confirmed">${esc(S.state.workDate || S.todayLocalIsoDate())}</div>
          </div>
        </div>
        <div id="visitStatus" class="muted" style="min-height:1.2em;margin-bottom:8px;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="confirmVisitBtn">${ready ? 'Change store & date' : 'Confirm store & date'}</button>
        </div>
      </div>

      <div class="card" id="shiftCard">
        <h2>Shifts</h2>
        <div id="shiftList"></div>
        <div class="field" style="margin-top:14px;">
          <label>Lead name</label>
          <input type="text" id="visitLeadName" value="${esc(S.resolvedLeadName?.() || S.state.leadName || S.state.profileName || '')}" ${S.state.profileLocked ? 'readonly' : ''}>
        </div>
        <div class="field">
          <label>Lead email</label>
          <input type="email" id="visitEmail" value="${esc(S.state.profileEmail)}" placeholder="you@example.com" ${S.state.profileLocked ? 'readonly' : ''}>
        </div>
        <button type="button" class="btn btn-secondary btn-block" id="unlockProfileBtn" ${S.state.profileLocked ? '' : 'hidden'}>Edit name / email</button>
      </div>

      <div class="card">
        <div id="visitOnboarding"></div>
      </div>
`;

    paintShiftList(document.getElementById('shiftList'));
    if (global.EodShiftPhotoSync?.ensureCartPhotos) {
      try { await global.EodShiftPhotoSync.ensureCartPhotos(); } catch (_) {}
    }
    await paintOnboarding();

    document.getElementById('resetVisitBtn').onclick = () => doReset();

    document.getElementById('visitLeadName').oninput = () => {
      const lead = document.getElementById('visitLeadName').value.trim();
      S.patch({ leadName: lead, profileName: lead || S.state.profileName }, 'lead-edit');
      S.saveDraft();
      if (S.state.shifts.length) {
        applyShiftsToSession(S.state.shifts, document.getElementById('shiftList'), 'lead-filter');
        updateContinueBtn();
      }
    };

    document.getElementById('visitEmail').oninput = () => {
      const email = document.getElementById('visitEmail').value.trim();
      S.patch({ profileEmail: email }, 'email-edit');
      S.saveDraft();
    };

    document.getElementById('unlockProfileBtn')?.addEventListener('click', () => {
      S.patch({ profileLocked: false }, 'unlock-profile');
      const nameEl = document.getElementById('visitLeadName');
      const emailEl = document.getElementById('visitEmail');
      if (nameEl) nameEl.readOnly = false;
      if (emailEl) emailEl.readOnly = false;
      document.getElementById('unlockProfileBtn').hidden = true;
    });

    document.getElementById('confirmVisitBtn').onclick = () => {
      if (S.isVisitReady()) S.clearDayConfirm();
      openDayConfirmModal();
    };

    if (!ready && !S.getPriorDayDraft?.()) enforceDayConfirmGate();
    else {
      try { global.EodVisitMemory?.applyToSession?.(S, S.state.storeNumber); } catch (_) {}
      void hydrateReadyVisit();
    }

  }

  async function hydrateReadyVisit() {
    const S = global.EodSession;
    const store = S.state.storeNumber;
    const date = S.state.workDate;
    const statusEl = document.getElementById('visitStatus');
    const listEl = document.getElementById('shiftList');
    if (statusEl && !S.state.shifts.length) {
      statusEl.textContent = 'Loading shifts…';
    }
    try { await withTimeout(global.EodCover?.loadStoreData?.(store), HYDRATE_MS); } catch (_) {}
    try { await withTimeout(prefetchSheetWeek(store, date), HYDRATE_MS); } catch (_) {}
    if (global.PhotoDB?.switchToDayConfirm) {
      try {
        await withTimeout(global.PhotoDB.switchToDayConfirm(store, date, S.state.photos), 8000);
      } catch (_) {}
    }
    if (!S.state.shifts.length && listEl) {
      try {
        await findShifts(store, date, listEl);
      } catch (err) {
        listEl.innerHTML = `<p class="muted">${esc(err.message || 'Could not load shifts.')}</p>`;
      }
    }
    if (statusEl) statusEl.textContent = '';
  }

  global.EodVisitCart = { cartPhotos, preparePhoto, pullCartFromProd, uploadCartToProd, thumbRow };
  global.EodVisit = {
    enforceDayConfirmGate,
    openDayConfirmModal,
    closeDayConfirmModal,
    ensureStoreCatalog,
    presentPriorDayChoice,
  };
  global.EodRouter.register('visit', render);
})(typeof window !== 'undefined' ? window : globalThis);
