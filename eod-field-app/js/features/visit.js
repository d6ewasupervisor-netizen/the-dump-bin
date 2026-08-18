/* Visit setup + day-confirm gate. */
(function (global) {
  'use strict';

  const STORES = [5,11,13,17,18,19,21,23,24,25,28,30,31,35,40,41,49,50,53,60,63,70,71,75,90,93,111,122,125,126,127,135,140,143,150,153,156,158,163,165,171,180,185,186,195,196,198,208,209,210,214,215,218,220,224,225,226,227,236,240,242,253,255,260,265,281,285,286,325,328,351,355,360,372,375,377,383,390,391,393,417,424,439,449,457,458,459,460,462,464,482,485,486,516,600,603,604,605,608,613,614,615,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,665,667,668,681,682,683,685,688,691,694,999];

  function esc(s) { return global.EodApi.escapeHtml(s); }

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

  async function findShifts(store, date, listEl) {
    const S = global.EodSession;
    listEl.innerHTML = '<p class="muted">Searching…</p>';
    // Store 999 (sandbox pilot) is served by the API from a cloned real shift
    // (see POST /api/sandbox/clone-shift) — no hardcoded mock here anymore,
    // so the app exercises the real find-shifts path end to end.
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
    if (shifts.length === 1) applyLeadFromShift(shifts[0]);
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
      };
    });
  }

  function applyLeadFromShift(shift) {
    const S = global.EodSession;
    const lead = shift.visitLead || shift.leadName || '';
    if (!lead) return;
    const patch = { leadName: lead };
    if (!S.state.profileName) patch.profileName = lead;
    S.patch(patch, 'lead');
  }

  async function render(mount) {
    const S = global.EodSession;
    const ready = S.isVisitReady();
    mount.innerHTML = `
      <div class="card">
        <h1>Today's visit</h1>
        <p class="muted">Confirm store and date, find your shift, then continue to the digital signoff sheet.</p>
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
        <div class="field-row">
          <div class="field">
            <label>Your name</label>
            <input type="text" id="visitName" value="${esc(S.state.profileName)}" placeholder="Lead name">
          </div>
          <div class="field">
            <label>Your email</label>
            <input type="email" id="visitEmail" value="${esc(S.state.profileEmail)}" placeholder="you@example.com">
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
        <div id="shiftList">${S.state.shifts.length ? renderShiftCards(S.state.shifts, S.state.shifts.findIndex((s) => s === S.state.selectedShift || s.visitId === S.state.selectedShift?.visitId)) : '<p class="muted">Confirm store, then find shifts.</p>'}</div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-success btn-block" id="continueBtn" ${ready ? '' : 'disabled'}>
          Continue to digital signoff
        </button>
      </div>`;

    if (S.state.shifts.length) wireShiftCards(document.getElementById('shiftList'));

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
      const name = document.getElementById('visitName').value.trim();
      const email = document.getElementById('visitEmail').value.trim();
      S.patch({ profileName: name, profileEmail: email, storeNumber: store, workDate: date }, 'profile');
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
        document.getElementById('continueBtn').disabled = false;
        global.EodChrome?.refresh();
        try {
          await findShifts(store, date, document.getElementById('shiftList'));
        } catch (err) {
          document.getElementById('shiftList').innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
        }
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
      } catch (err) {
        document.getElementById('shiftList').innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
      }
    };

    document.getElementById('continueBtn').onclick = () => {
      const name = document.getElementById('visitName').value.trim();
      const email = document.getElementById('visitEmail').value.trim();
      S.patch({ profileName: name, profileEmail: email }, 'profile');
      S.saveDraft();
      if (!S.isVisitReady()) {
        document.getElementById('visitStatus').innerHTML = '<span style="color:#ef4444;">Confirm store & date first.</span>';
        return;
      }
      global.EodRouter.go('signoff');
    };
  }

  global.EodRouter.register('visit', render);
})(typeof window !== 'undefined' ? window : globalThis);
