/* Crew orbit: timesheets, JOIN QR, SMS opt-in, roster add/remove, InstaWork photo. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  async function loadMembers(opts = {}) {
    const S = global.EodSession;
    const shift = S.state.selectedShift;
    if (!shift?.visitId || String(shift.visitId).startsWith('test-')) {
      S.patch({ members: [] }, 'members');
      return [];
    }
    const resp = await global.authFetch(
      `${global.EOD_API_BASE}/api/shifts/${encodeURIComponent(shift.visitId)}/members`,
      { skipBusy: opts.skipBusy !== false }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Members failed (${resp.status})`);
    }
    const data = await resp.json();
    const members = Array.isArray(data) ? data : (data.members || data.employees || []);
    S.patch({ members }, 'members');
    return members;
  }

  async function loadEmployees() {
    const resp = await global.authFetch(`${global.EOD_API_BASE}/api/employees`);
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => []);
    return Array.isArray(data) ? data : (data.employees || []);
  }

  async function addMember(emp) {
    const S = global.EodSession;
    const visitId = S.state.selectedShift?.visitId;
    if (!visitId) throw new Error('Select a shift first');
    const requestedBy = S.state.leadName || S.state.profileName || S.state.profileEmail || 'Unknown';
    const resp = await global.authFetch(
      `${global.EOD_API_BASE}/api/shifts/${encodeURIComponent(visitId)}/add`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employees: [{ employeeId: emp.employeeId || emp.id, name: emp.name, isLead: false }],
          requestedBy,
        }),
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Add failed (${resp.status})`);
    if (data.requestId) {
      pollShiftRequest(data.requestId, emp.name);
      return { pending: true, name: emp.name };
    }
    return { pending: false, name: emp.name, data };
  }

  async function requestRemoval(emp) {
    const S = global.EodSession;
    const shift = S.state.selectedShift;
    if (!shift?.visitId) throw new Error('Select a shift first');
    const requestedBy = S.state.leadName || S.state.profileName || S.state.profileEmail || 'Unknown';
    const resp = await global.authFetch(`${global.EOD_API_BASE}/api/shift-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitId: shift.visitId,
        cycleId: shift.cycleId || shift.cycle || null,
        storeNumber: parseInt(S.state.storeNumber, 10),
        teamName: shift.teamName || shift.projectName || '',
        date: S.state.workDate,
        remove: [{ shiftId: emp.shiftId, employeeId: emp.employeeId, name: emp.name }],
        requestedBy,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Removal request failed (${resp.status})`);
    if (data.requestId) pollShiftRequest(data.requestId, emp.name);
    return data;
  }

  function pollShiftRequest(requestId, name) {
    const started = Date.now();
    const tick = async () => {
      if (Date.now() - started > 15 * 60 * 1000) return;
      try {
        const resp = await global.authFetch(
          `${global.EOD_API_BASE}/api/shift-request/${encodeURIComponent(requestId)}/status`
        );
        const data = await resp.json().catch(() => ({}));
        const status = String(data.status || '').toLowerCase();
        if (status === 'approved' || status === 'completed') {
          const el = document.getElementById('rosterStatus');
          if (el) el.textContent = `Approved — ${name}`;
          return;
        }
        if (status === 'denied' || status === 'rejected') {
          const el = document.getElementById('rosterStatus');
          if (el) el.textContent = `Denied — ${name}`;
          return;
        }
      } catch (_) { /* keep polling */ }
      setTimeout(tick, 15000);
    };
    setTimeout(tick, 8000);
  }

  async function saveInstaworkPhoto() {
    if (global.EodInstaworkSave?.confirmAndSave) return global.EodInstaworkSave.confirmAndSave();
    if (global.EodPhotos?.saveInstawork) return global.EodPhotos.saveInstawork();
    throw new Error('InstaWork save module not loaded');
  }

  async function render(mount) {
    const S = global.EodSession;
    S.syncDomBridges();
    const canRoster = global.EodRoles?.canManageRoster?.() !== false;
    const iwYes = S.state.instaworkYes === 'Yes';
    const saved = S.state.instaworkSavedInfo;
    const dest = saved && global.EodInstaworkSave?.destLine ? global.EodInstaworkSave.destLine(saved) : '';
    mount.innerHTML = `
      <div class="card">
        <h1>Crew & timesheets</h1>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="crewJoinQrBtn">JOIN QR</button>
          <button type="button" class="btn btn-secondary" id="openIwBtn">InstaWork sheet</button>
          <button type="button" class="btn btn-secondary" id="openKtBtn">Kompass sheet</button>
        </div>
        <div id="crewSmsHost"></div>
      </div>
      <div class="card">
        <h2>InstaWork support today</h2>
        <div class="iw-yn">
          <button type="button" class="btn btn-secondary${iwYes ? ' is-on' : ''}" id="iwYesBtn">Yes</button>
          <button type="button" class="btn btn-secondary${S.state.instaworkYes === 'No' ? ' is-on' : ''}" id="iwNoBtn">No</button>
        </div>
      </div>
      ${iwYes ? `
      <div class="card" id="instaworkYesPanel">
        <h2>InstaWork sign-out photo</h2>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="iwCamBtn">Camera</button>
          <button type="button" class="btn btn-success" id="iwSaveBtn">${saved ? 'Re-save InstaWork Sign-Out Sheet' : 'Confirm &amp; Save InstaWork Sign-Out Sheet'}</button>
        </div>
        <div id="iwCrewMsg" class="${saved ? 'iw-saved-dest' : 'muted'}" style="margin-top:8px;">${
          saved ? `<strong>Saved.</strong> ${esc(dest)}` : ''
        }</div>
      </div>` : ''}
      <div class="card">
        <h2>Shift roster</h2>
        <p class="muted" id="rosterShiftMeta">${S.state.selectedShift
          ? esc(S.state.selectedShift.projectName || 'Selected shift')
          : 'No shift selected — confirm store on Visit.'}</p>
        <div id="rosterStatus" class="muted"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="refreshRosterBtn">Refresh roster</button>
        </div>
        <div id="rosterList" style="margin-top:10px;"></div>
        <div id="rosterEdit" ${canRoster ? '' : 'hidden'} style="margin-top:12px;">
          <div class="field">
            <label>Add member</label>
            <select id="smAddSelect"><option value="">—</option></select>
            <button type="button" class="btn btn-primary btn-block" id="rosterAddBtn" style="margin-top:6px;">Add to shift</button>
          </div>
          <div class="field">
            <label>Request removal</label>
            <select id="smRemoveSelect"><option value="">—</option></select>
            <button type="button" class="btn btn-secondary btn-block" id="rosterRemoveBtn" style="margin-top:6px;">Request removal</button>
          </div>
        </div>
      </div>`;

    const smsHost = document.getElementById('crewSmsHost');
    if (smsHost) smsHost.innerHTML = '';

    document.getElementById('crewJoinQrBtn').onclick = async () => {
      try {
        if (global.EodTimesheetMgmt?.showJoinQr) await global.EodTimesheetMgmt.showJoinQr();
        else if (global.showAlert) global.showAlert('JOIN QR', 'Timesheet module not loaded');
      } catch (err) {
        if (global.showAlert) global.showAlert('JOIN QR', err.message || String(err));
      }
    };
    document.getElementById('openIwBtn').onclick = () => {
      if (global.EodTimesheetMgmt?.open) global.EodTimesheetMgmt.open('instawork');
    };
    document.getElementById('openKtBtn').onclick = () => {
      if (global.EodTimesheetMgmt?.open) global.EodTimesheetMgmt.open('kompass');
    };
    document.getElementById('iwYesBtn').onclick = () => {
      S.patch({ instaworkYes: 'Yes' }, 'iw');
      S.saveDraft();
      render(mount);
    };
    document.getElementById('iwNoBtn').onclick = () => {
      S.patch({ instaworkYes: 'No' }, 'iw');
      S.saveDraft();
      render(mount);
    };
    document.getElementById('iwCamBtn')?.addEventListener('click', async () => {
      if (global.EodCamera?.open) {
        await global.EodCamera.open({
          label: 'InstaWork sign-out',
          onCapture: async (file) => {
            if (global.EodPhotos?.addFiles) await global.EodPhotos.addFiles('instawork', [file]);
          },
          shouldContinue: () => false,
        });
      } else {
        global.EodRouter.go('photos');
      }
    });
    document.getElementById('iwSaveBtn')?.addEventListener('click', async () => {
      const msg = document.getElementById('iwCrewMsg');
      try {
        if (msg) {
          msg.className = 'muted';
          msg.textContent = 'Saving…';
        }
        const result = await saveInstaworkPhoto();
        if (msg) {
          msg.className = 'iw-saved-dest';
          msg.innerHTML = `<strong>Saved.</strong> ${esc(global.EodInstaworkSave?.destLine?.(result) || '')}`;
        }
        const btn = document.getElementById('iwSaveBtn');
        if (btn) btn.textContent = 'Re-save InstaWork Sign-Out Sheet';
      } catch (err) {
        if (msg) {
          msg.className = 'iw-saved-dest iw-save-failed';
          msg.innerHTML = `<strong>Save failed.</strong> ${esc(err.message || String(err))}`;
        }
        if (global.showAlert) {
          global.showAlert('InstaWork Sign-Out Sheet Save Failed', err.message || String(err));
        }
      }
    });

    const list = document.getElementById('rosterList');
    const addSel = document.getElementById('smAddSelect');
    const rmSel = document.getElementById('smRemoveSelect');

    async function paintRoster() {
      try {
        const members = await loadMembers();
        if (!members.length) {
          list.innerHTML = '<p class="muted">No members loaded.</p>';
        } else {
          list.innerHTML = members.map((m) => `
            <div class="member-row">
              <strong>${esc(m.name || 'Unknown')}${m.isLead ? ' (Lead)' : ''}</strong>
              <div class="muted">${esc(m.shiftTime || m.title || '')}</div>
            </div>`).join('');
        }
        if (rmSel) {
          rmSel.innerHTML = '<option value="">—</option>' + members.map((m, i) =>
            `<option value="${i}">${esc(m.name || 'Unknown')}</option>`
          ).join('');
        }
        if (canRoster && addSel) {
          const employees = await loadEmployees();
          const memberIds = new Set(members.map((m) => String(m.employeeId || m.id || '')));
          addSel.innerHTML = '<option value="">—</option>' + employees
            .filter((e) => !memberIds.has(String(e.employeeId || e.id || '')))
            .map((e) => `<option value="${esc(String(e.employeeId || e.id))}">${esc(e.name || 'Unknown')}</option>`)
            .join('');
          addSel._employees = employees;
        }
      } catch (err) {
        list.innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
      }
    }

    document.getElementById('refreshRosterBtn').onclick = () => paintRoster();
    document.getElementById('rosterAddBtn')?.addEventListener('click', async () => {
      const empId = addSel?.value;
      const employees = addSel?._employees || [];
      const emp = employees.find((e) => String(e.employeeId || e.id) === String(empId));
      if (!emp) return;
      const ok = await (global.showConfirm
        ? global.showConfirm('Add to shift', `Add ${emp.name}?`)
        : Promise.resolve(confirm(`Add ${emp.name}?`)));
      if (!ok) return;
      try {
        const r = await addMember(emp);
        document.getElementById('rosterStatus').textContent = r.pending
          ? `Pending addition: ${r.name}`
          : `Added ${r.name}`;
        await paintRoster();
      } catch (err) {
        document.getElementById('rosterStatus').textContent = err.message || String(err);
      }
    });
    document.getElementById('rosterRemoveBtn')?.addEventListener('click', async () => {
      const idx = Number(rmSel?.value);
      const emp = (S.state.members || [])[idx];
      if (!emp) return;
      const ok = await (global.showConfirm
        ? global.showConfirm('Request removal', `Request removal of ${emp.name}?`)
        : Promise.resolve(confirm(`Request removal of ${emp.name}?`)));
      if (!ok) return;
      try {
        await requestRemoval(emp);
        document.getElementById('rosterStatus').textContent = `Removal requested — ${emp.name}`;
      } catch (err) {
        document.getElementById('rosterStatus').textContent = err.message || String(err);
      }
    });
    await paintRoster();
  }

  global.openInstaworkManagement = function () {
    if (global.EodTimesheetMgmt?.open) return global.EodTimesheetMgmt.open('instawork');
  };
  global.openKompassManagement = function () {
    if (global.EodTimesheetMgmt?.open) return global.EodTimesheetMgmt.open('kompass');
  };

  global.EodCrew = { loadMembers, render };
  global.EodRouter.register('crew', render);
})(typeof window !== 'undefined' ? window : globalThis);
