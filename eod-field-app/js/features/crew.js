/* Crew orbit: timesheets, JOIN QR, SMS opt-in, roster add/remove, InstaWork sheet. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function rosterBadge(shift) {
    return global.EodSendSheetsLogic?.shiftRosterBadge?.(shift) || { key: '', label: '' };
  }

  /** ISE, Cut-In, Blitz, DIV, … Never the bare word Shift. */
  function shiftLabel(shift) {
    const label = rosterBadge(shift).label;
    if (label) return label;
    const id = String(shift?.visitId || '').trim();
    return id ? `Visit ${id}` : 'Visit';
  }

  function rosterVisitIds() {
    const S = global.EodSession;
    const selected = String(S.state.selectedShift?.visitId || '');
    const ids = [];
    if (selected) ids.push(selected);
    for (const raw of S.state.extraVisitIds || []) {
      const id = String(raw || '');
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  function shiftMap(list) {
    const map = new Map();
    for (const shift of list || []) {
      if (!shift) continue;
      const id = String(shift.visitId || shift.id || '');
      if (!id) continue;
      const prev = map.get(id);
      map.set(id, prev
        ? Object.assign({}, prev, shift, { visitId: shift.visitId || prev.visitId || id })
        : shift);
    }
    return map;
  }

  function unresolvedRosterIds(map) {
    return rosterVisitIds().filter((id) => !rosterBadge(map.get(id)).label);
  }

  /**
   * A restored visit keeps the selected project name and sibling visit ids,
   * but not the Cut-In / Blitz records. Pull those in before labeling.
   */
  async function loadRosterCatalog() {
    const S = global.EodSession;
    let map = shiftMap([...(S.state.shifts || []), S.state.selectedShift].filter(Boolean));
    if (!unresolvedRosterIds(map).length) return map;
    const store = S.state.storeNumber;
    const date = S.state.workDate;
    try { await global.EodShiftDay?.load?.(date); } catch (_) { /* cache miss */ }
    const cached = global.EodShiftDay?.shiftsForStore?.(store, date) || [];
    if (cached.length) map = shiftMap([...map.values(), ...cached]);
    if (!unresolvedRosterIds(map).length || !store || !date || !global.authFetch) return map;
    try {
      const resp = await global.authFetch(
        `${global.EOD_API_BASE}/api/shifts?store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`,
        { skipBusy: true }
      );
      if (!resp.ok) return map;
      const data = await resp.json().catch(() => []);
      const shifts = Array.isArray(data) ? data : (data.shifts || []);
      if (!shifts.length) return map;
      map = shiftMap([...map.values(), ...shifts]);
      S.patch({ shifts: [...map.values()] }, 'crew-shifts');
    } catch (_) { /* roster still paints with what it has */ }
    return map;
  }

  /** Selected shift first, then every other store-day shift (ISE, Cut In, Blitz, DIV, ...). */
  function rosterShifts(map) {
    const S = global.EodSession;
    const selected = S.state.selectedShift;
    if (!selected?.visitId) return [];
    const catalog = map || shiftMap([...(S.state.shifts || []), selected]);
    return rosterVisitIds().map((id) => {
      const found = catalog.get(id);
      if (String(selected.visitId) === id) {
        return Object.assign({}, found || {}, selected, { visitId: id });
      }
      return found || { visitId: id };
    });
  }

  function shiftForVisit(visitId, map) {
    const id = String(visitId || '');
    return rosterShifts(map).find((s) => String(s.visitId) === id) || global.EodSession.state.selectedShift;
  }

  async function loadMembers(opts = {}) {
    const S = global.EodSession;
    const shift = S.state.selectedShift;
    if (!shift?.visitId || String(shift.visitId).startsWith('test-')) {
      S.patch({ members: [] }, 'members');
      return [];
    }
    const catalog = opts.catalog || await loadRosterCatalog();
    const siblings = rosterShifts(catalog)
      .slice(1)
      .map((s) => String(s.visitId))
      .filter((id) => /^\d+$/.test(id));
    const qs = siblings.length ? `?visitIds=${encodeURIComponent(siblings.join(','))}` : '';
    const resp = await global.authFetch(
      `${global.EOD_API_BASE}/api/shifts/${encodeURIComponent(shift.visitId)}/members${qs}`,
      { skipBusy: opts.skipBusy !== false }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Members failed (${resp.status})`);
    }
    const data = await resp.json();
    const raw = Array.isArray(data) ? data : (data.members || data.employees || []);
    const members = raw.map((m, memberIndex) => {
      const visitId = String(m.visitId || shift.visitId);
      const badge = rosterBadge(shiftForVisit(visitId, catalog));
      return {
        ...m,
        visitId,
        memberIndex,
        rosterKey: badge.key,
        rosterLabel: badge.label,
        shiftLabel: badge.label || shiftLabel(shiftForVisit(visitId, catalog)),
      };
    });
    S.patch({ members }, 'members');
    return members;
  }

  async function loadEmployees() {
    const resp = await global.authFetch(`${global.EOD_API_BASE}/api/employees`);
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => []);
    return Array.isArray(data) ? data : (data.employees || []);
  }

  async function addMember(emp, targetVisitId) {
    const S = global.EodSession;
    const visitId = targetVisitId || S.state.selectedShift?.visitId;
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

  let activeRosterCatalog = null;

  async function requestRemoval(emp) {
    const S = global.EodSession;
    const shift = shiftForVisit(emp.visitId, activeRosterCatalog);
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

  function paintInstawork() {
    const host = document.getElementById('crewIwHost');
    if (!host) return;
    const S = global.EodSession;
    const filed = !!S.state.instaworkOfficeSubmitted;
    host.innerHTML = `
      <h2>InstaWork</h2>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="openIwBtn">InstaWork sheet</button>
        <button type="button" class="btn btn-secondary" id="iwDistributeBtn">Distribute time</button>
      </div>
      ${filed ? '<div class="iw-saved-dest" style="margin-top:8px;"><strong>Sent to the office.</strong></div>' : ''}`;

    host.querySelector('#openIwBtn').onclick = () => {
      if (global.EodTimesheetMgmt?.open) global.EodTimesheetMgmt.open('instawork');
    };
    host.querySelector('#iwDistributeBtn').onclick = () => {
      global.EodTimesheetMgmt?.distribute?.('instawork')?.catch?.((err) => {
        if (global.showAlert) global.showAlert('Distribute time', err.message || String(err));
      });
    };
  }

  async function render(mount) {
    const S = global.EodSession;
    S.syncDomBridges();
    const canRoster = global.EodRoles?.canManageRoster?.() !== false;
    const shiftsForRoster = rosterShifts();
    const multiShift = shiftsForRoster.length > 1;
    mount.innerHTML = `
      <div class="card" id="crewIwHost"></div>
      <div class="card">
        <h1>Crew & timesheets</h1>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="crewJoinQrBtn">JOIN QR</button>
          <button type="button" class="btn btn-secondary" id="openKtBtn">Kompass sheet</button>
          <button type="button" class="btn btn-secondary" id="crewDistributeBtn">Distribute time</button>
        </div>
        <div id="crewSmsHost"></div>
      </div>
      <div class="card">
        <h2>Shift roster</h2>
        <p class="muted" id="rosterShiftMeta">${shiftsForRoster.length
          ? esc(shiftsForRoster.map(shiftLabel).join(' · '))
          : 'No shift selected. Confirm the store on Visit.'}</p>
        <div id="rosterStatus" class="muted"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="refreshRosterBtn">Refresh roster</button>
        </div>
        <div id="rosterList" style="margin-top:10px;"></div>
        <div id="rosterEdit" ${canRoster ? '' : 'hidden'} style="margin-top:12px;">
          <div class="field">
            <label>Add member</label>
            <select id="smAddSelect"><option value="">—</option></select>
            ${multiShift ? `<select id="smAddShift" style="margin-top:6px;">${shiftsForRoster.map((s) =>
              `<option value="${esc(String(s.visitId))}">${esc(shiftLabel(s))}</option>`
            ).join('')}</select>` : ''}
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
    document.getElementById('openKtBtn').onclick = () => {
      if (global.EodTimesheetMgmt?.open) global.EodTimesheetMgmt.open('kompass');
    };
    document.getElementById('crewDistributeBtn').onclick = () => {
      global.EodTimesheetMgmt?.distribute?.('kompass')?.catch?.((err) => {
        if (global.showAlert) global.showAlert('Distribute time', err.message || String(err));
      });
    };
    paintInstawork();
    global.EodTimesheetMgmt?.fetchInstaworkMembers?.().then(() => paintInstawork()).catch(() => {});

    const list = document.getElementById('rosterList');
    const addSel = document.getElementById('smAddSelect');
    const addShiftSel = document.getElementById('smAddShift');
    const rmSel = document.getElementById('smRemoveSelect');
    let rosterCatalog = null;

    function addTargetVisitId() {
      return String(addShiftSel?.value || S.state.selectedShift?.visitId || '');
    }

    function paintAddOptions() {
      if (!addSel) return;
      const employees = addSel._employees || [];
      const target = addTargetVisitId();
      const onTarget = new Set((S.state.members || [])
        .filter((m) => String(m.visitId) === target)
        .map((m) => String(m.employeeId || m.id || '')));
      addSel.innerHTML = '<option value="">—</option>' + employees
        .filter((e) => !onTarget.has(String(e.employeeId || e.id || '')))
        .map((e) => `<option value="${esc(String(e.employeeId || e.id))}">${esc(e.name || 'Unknown')}</option>`)
        .join('');
    }

    function paintShiftChoices(catalog) {
      const shifts = rosterShifts(catalog);
      const meta = document.getElementById('rosterShiftMeta');
      if (meta) {
        meta.textContent = shifts.length
          ? shifts.map(shiftLabel).join(' · ')
          : 'No shift selected. Confirm the store on Visit.';
      }
      if (!addShiftSel) return;
      const current = addShiftSel.value;
      addShiftSel.innerHTML = shifts.map((s) =>
        `<option value="${esc(String(s.visitId))}">${esc(shiftLabel(s))}</option>`
      ).join('');
      if (current && [...addShiftSel.options].some((opt) => opt.value === current)) {
        addShiftSel.value = current;
      }
    }

    function rosterBadgeHtml(badges) {
      return (badges || []).map((badge) => {
        const kind = String(badge.key || '').replace(/[^a-z0-9_]+/gi, '') || 'other';
        return `<span class="roster-badge roster-badge--${esc(kind)}">${esc(badge.label)}</span>`;
      }).join('');
    }

    async function paintRoster() {
      try {
        const catalog = await loadRosterCatalog();
        rosterCatalog = catalog;
        activeRosterCatalog = catalog;
        paintShiftChoices(catalog);
        const members = await loadMembers({ catalog });
        const groups = global.EodSendSheetsLogic?.groupRosterMembers?.(members) || [];
        if (!members.length) {
          list.innerHTML = '<p class="muted">No members loaded.</p>';
        } else {
          list.innerHTML = groups.map((group) => `
            <div class="member-row roster-person">
              <div class="roster-person-line">
                <strong>${esc(group.name)}${group.isLead ? ' (Lead)' : ''}</strong>
                <span class="roster-badges">${rosterBadgeHtml(group.badges)}</span>
              </div>
              ${group.title ? `<div class="muted">${esc(group.title)}</div>` : ''}
            </div>`).join('');
        }
        if (rmSel) {
          const removal = groups.length
            ? groups.flatMap((group) => group.assignments)
            : members;
          rmSel.innerHTML = '<option value="">—</option>' + removal.map((m) => {
            const type = m.rosterLabel || m.shiftLabel || '';
            const suffix = type ? ` — ${esc(type)}` : '';
            return `<option value="${esc(String(m.memberIndex))}">${esc(m.name || 'Unknown')}${suffix}</option>`;
          }).join('');
        }
        if (canRoster && addSel) {
          addSel._employees = await loadEmployees();
          paintAddOptions();
        }
      } catch (err) {
        list.innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
      }
    }

    addShiftSel?.addEventListener('change', paintAddOptions);
    document.getElementById('refreshRosterBtn').onclick = () => paintRoster();
    document.getElementById('rosterAddBtn')?.addEventListener('click', async () => {
      const empId = addSel?.value;
      const employees = addSel?._employees || [];
      const emp = employees.find((e) => String(e.employeeId || e.id) === String(empId));
      if (!emp) return;
      const targetVisitId = addTargetVisitId();
      const targetLabel = multiShift ? ` to ${shiftLabel(shiftForVisit(targetVisitId, rosterCatalog))}` : '';
      const ok = await (global.showConfirm
        ? global.showConfirm('Add to shift', `Add ${emp.name}${targetLabel}?`)
        : Promise.resolve(confirm(`Add ${emp.name}${targetLabel}?`)));
      if (!ok) return;
      try {
        const r = await addMember(emp, targetVisitId);
        document.getElementById('rosterStatus').textContent = r.pending
          ? `Pending addition: ${r.name}`
          : `Added ${r.name}`;
        await paintRoster();
      } catch (err) {
        document.getElementById('rosterStatus').textContent = err.message || String(err);
      }
    });
    document.getElementById('rosterRemoveBtn')?.addEventListener('click', async () => {
      if (!rmSel?.value) return;
      const idx = Number(rmSel.value);
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

  global.EodCrew = { loadMembers, render, paintInstawork };
  global.EodRouter.register('crew', render);
})(typeof window !== 'undefined' ? window : globalThis);
