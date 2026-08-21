/* Visit setup + day-confirm gate + onboarding (cart → check-in → befores). */
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
    if (result.needsOverride || result.needsSupervisor) {
      return { ok: false, needsOverride: true, message: result.error || result.message || 'Supervisor override required' };
    }
    return { ok: false, message: result.error || result.message || `Verify failed (${resp.status})` };
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
      applyLeadFromShift(shifts[0]);
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
      card.onclick = () => {
        const idx = Number(card.getAttribute('data-idx'));
        const shift = S.state.shifts[idx];
        if (!shift) return;
        listEl.querySelectorAll('.shift-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        S.patch({ selectedShift: shift }, 'shift');
        applyLeadFromShift(shift);
        S.saveDraft();
        advanceAfterShiftSelected();
        paintOnboarding();
      };
    });
  }

  function applyLeadFromShift(shift) {
    const S = global.EodSession;
    const lead = shift.visitLead || shift.leadName || '';
    if (!lead) return;
    const patch = { leadName: lead, profileName: lead };
    S.patch(patch, 'lead');
    const nameEl = document.getElementById('visitLeadName');
    if (nameEl) nameEl.value = lead;
    const profileEl = document.getElementById('visitName');
    if (profileEl && !profileEl.value.trim()) profileEl.value = lead;
  }

  function advanceAfterShiftSelected() {
    const S = global.EodSession;
    if (!S.state.selectedShift) return;
    let step = S.state.visitStep || 'setup';
    if (step === 'setup') step = 'cart';
    S.patch({ visitStep: step }, 'visit-step');
    S.saveDraft();
  }

  function onboardingReady() {
    const S = global.EodSession;
    return !!(
      S.isVisitReady() &&
      S.state.selectedShift &&
      S.state.cartPhotoDone &&
      S.state.checkInDone &&
      S.state.beforesStepDone
    );
  }

  function paintOnboarding() {
    const S = global.EodSession;
    const host = document.getElementById('visitOnboarding');
    const continueBtn = document.getElementById('continueBtn');
    if (!host) return;

    if (!S.isVisitReady() || !S.state.selectedShift) {
      host.innerHTML = '<p class="muted">Select a shift to continue with cart photo, check-in, and before photos.</p>';
      if (continueBtn) continueBtn.disabled = true;
      return;
    }

    const step = S.state.visitStep || 'cart';
    const cartCount = (S.state.photos?.before || []).length;
    const week = S.state.fiscalWeek || S.state.sheet?.fiscalWeek || '';
    const rows = (S.state.sheet?.rows || []).filter((r) => r.dbkey);
    const beforeCounts = rows.map((r) => {
      const local = global.EodSetBeforeStore?.getBefores?.(S.state.storeNumber, week, r.dbkey) || [];
      return { row: r, count: local.length };
    });

    host.innerHTML = `
      <ol class="visit-steps">
        <li class="${S.state.cartPhotoDone ? 'done' : (step === 'cart' ? 'current' : '')}">1. Kompass cart photo</li>
        <li class="${S.state.checkInDone ? 'done' : (step === 'checkin' ? 'current' : '')}">2. Check-in contact</li>
        <li class="${S.state.beforesStepDone ? 'done' : (step === 'befores' ? 'current' : '')}">3. Before photos of sets</li>
      </ol>

      <section class="visit-step-panel" ${step === 'cart' || !S.state.cartPhotoDone ? '' : 'hidden'}>
        <h3>Kompass cart photo</h3>
        <p class="muted">Take a picture of the Kompass cart before you start sets.</p>
        <div class="btn-row">
          <label class="btn btn-primary" style="cursor:pointer;">
            Take / add cart photo
            <input type="file" accept="image/*,.heic,.heif" capture="environment" id="cartPhotoInput" hidden>
          </label>
          <button type="button" class="btn btn-success" id="cartPhotoNext" ${cartCount ? '' : 'disabled'}>Next</button>
        </div>
        <div id="cartPhotoPreview" style="margin-top:10px;">${cartCount
          ? `<img src="${esc((S.state.photos.before[0] && (S.state.photos.before[0].dataUrl || S.state.photos.before[0])) || '')}" alt="Cart" style="max-width:180px;border-radius:10px;">`
          : '<p class="muted">No cart photo yet.</p>'}</div>
      </section>

      <section class="visit-step-panel" ${step === 'checkin' || (S.state.cartPhotoDone && !S.state.checkInDone) ? '' : 'hidden'}>
        <h3>Who did you check in with?</h3>
        <div class="field">
          <label for="checkInManager">Name / title</label>
          <input type="text" id="checkInManager" value="${esc(S.state.checkInManager || '')}" placeholder="e.g. Grocery manager — Jordan">
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-success" id="checkInNext">Next</button>
        </div>
      </section>

      <section class="visit-step-panel" ${step === 'befores' || (S.state.cartPhotoDone && S.state.checkInDone && !S.state.beforesStepDone) ? '' : 'hidden'}>
        <h3>Before photos of sets</h3>
        <p class="muted">Befores stay on this phone for the whole fiscal week (${esc(week || 'loading…')}) and online in PROD/SI after upload — even if the set stays backlog until later in the week.</p>
        <div id="beforeSetList">${beforeCounts.length
          ? beforeCounts.map(({ row, count }) => `
            <div class="ds-row" style="margin-bottom:8px;">
              <strong>${esc(row.catName || row.dbkey)}</strong>
              <div class="muted">${esc(row.dbkey || '')}${row.versionToken ? ` · ${esc(row.versionToken)}` : ''}${row.footageDisplay || row.size ? ` · footage ${esc(row.footageDisplay || row.size)}` : ''} · ${count} before photo(s) on device</div>
              <button type="button" class="btn btn-secondary" data-before-set="${esc(row.dbkey)}" data-row="${row.id}" data-name="${esc(row.catName || '')}">Capture befores</button>
            </div>`).join('')
          : '<p class="muted">Load the digital sheet (or wait for ingest) to list sets. You can still continue and capture from Signoff.</p>'}</div>
        <div class="btn-row" style="margin-top:12px;">
          <button type="button" class="btn btn-success" id="beforesNext">Done with befores — continue</button>
        </div>
      </section>
    `;

    const cartInput = document.getElementById('cartPhotoInput');
    if (cartInput) {
      cartInput.onchange = async () => {
        const file = cartInput.files?.[0];
        cartInput.value = '';
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        const entry = {
          dataUrl,
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          stampedAt: Date.now(),
          kind: 'cart',
        };
        const photos = Object.assign({}, S.state.photos, {
          before: [entry, ...(S.state.photos.before || []).filter((p) => p?.kind !== 'cart')],
        });
        S.patch({ photos, cartPhotoDone: true, visitStep: 'checkin' }, 'cart-photo');
        if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(photos);
        S.saveDraft();
        paintOnboarding();
      };
    }
    const cartNext = document.getElementById('cartPhotoNext');
    if (cartNext) {
      cartNext.onclick = () => {
        if (!(S.state.photos?.before || []).length) return;
        S.patch({ cartPhotoDone: true, visitStep: 'checkin' }, 'cart-next');
        S.saveDraft();
        paintOnboarding();
      };
    }
    const checkInNext = document.getElementById('checkInNext');
    if (checkInNext) {
      checkInNext.onclick = () => {
        const name = (document.getElementById('checkInManager')?.value || '').trim();
        if (!name) {
          alert('Enter who you checked in with.');
          return;
        }
        S.patch({
          checkInManager: name,
          checkInDone: true,
          visitStep: 'befores',
        }, 'checkin');
        S.saveDraft();
        paintOnboarding();
      };
    }
    host.querySelectorAll('[data-before-set]').forEach((btn) => {
      btn.onclick = () => {
        const dbkey = btn.getAttribute('data-before-set');
        const rowId = btn.getAttribute('data-row');
        const name = btn.getAttribute('data-name') || '';
        const qs = new URLSearchParams({ dbkey, rowId, name, slot: 'before' });
        location.hash = `#/survey?${qs.toString()}`;
      };
    });
    const beforesNext = document.getElementById('beforesNext');
    if (beforesNext) {
      beforesNext.onclick = () => {
        S.patch({ beforesStepDone: true, visitStep: 'done' }, 'befores-done');
        S.saveDraft();
        paintOnboarding();
        if (continueBtn) continueBtn.disabled = !onboardingReady();
      };
    }

    if (continueBtn) continueBtn.disabled = !onboardingReady();
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
    if (ready && global.PhotoDB?.switchToDayConfirm) {
      try {
        await global.PhotoDB.switchToDayConfirm(S.state.storeNumber, S.state.workDate, S.state.photos);
      } catch (_) {}
    }

    mount.innerHTML = `
      <div class="card">
        <div class="btn-row" style="justify-content:space-between;align-items:center;">
          <h1 style="margin:0;">Today's visit</h1>
          <button type="button" class="btn btn-secondary" id="resetVisitBtn">Reset</button>
        </div>
        <p class="muted">Confirm store and date, find your shift, then complete cart photo → check-in → before photos.</p>
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
        <div class="field">
          <label>Your email</label>
          <input type="email" id="visitEmail" value="${esc(S.state.profileEmail)}" placeholder="you@example.com">
        </div>
        <div id="visitStatus" class="muted" style="min-height:1.2em;margin-bottom:8px;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="confirmVisitBtn">${ready ? 'Re-confirm store' : 'Confirm store & date'}</button>
          <button type="button" class="btn btn-secondary" id="findShiftsBtn" ${ready ? '' : 'disabled'}>Find shifts</button>
        </div>
      </div>

      <div class="card" id="shiftCard">
        <h2>Shifts</h2>
        <div id="shiftList">${S.state.shifts.length ? renderShiftCards(S.state.shifts, S.state.shifts.findIndex((s) => s === S.state.selectedShift || s.visitId === S.state.selectedShift?.visitId)) : '<p class="muted">Confirm store, then find shifts.</p>'}</div>
        <div class="field" style="margin-top:14px;">
          <label>Lead name</label>
          <input type="text" id="visitLeadName" value="${esc(S.state.leadName || S.state.profileName || '')}" placeholder="Autofills when you select a shift">
          <p class="muted" style="margin-top:4px;">Shown below the shift list — updates automatically from the selected shift lead.</p>
        </div>
      </div>

      <div class="card">
        <h2>Next steps</h2>
        <div id="visitOnboarding"></div>
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-success btn-block" id="continueBtn" ${onboardingReady() ? '' : 'disabled'}>
          Continue to digital signoff
        </button>
      </div>`;

    if (S.state.shifts.length) wireShiftCards(document.getElementById('shiftList'));
    paintOnboarding();

    document.getElementById('resetVisitBtn').onclick = () => doReset();

    document.getElementById('visitLeadName').oninput = () => {
      const lead = document.getElementById('visitLeadName').value.trim();
      S.patch({ leadName: lead, profileName: lead || S.state.profileName }, 'lead-edit');
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
      } catch (err) {
        document.getElementById('shiftList').innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
      }
    };

    document.getElementById('continueBtn').onclick = () => {
      const lead = document.getElementById('visitLeadName').value.trim();
      const email = document.getElementById('visitEmail').value.trim();
      S.patch({ leadName: lead, profileName: lead || S.state.profileName, profileEmail: email }, 'profile');
      S.saveDraft();
      if (!onboardingReady()) {
        document.getElementById('visitStatus').innerHTML =
          '<span style="color:#ef4444;">Finish cart photo, check-in, and before-photo step first.</span>';
        return;
      }
      global.EodRouter.go('signoff');
    };
  }

  global.EodRouter.register('visit', render);
})(typeof window !== 'undefined' ? window : globalThis);
