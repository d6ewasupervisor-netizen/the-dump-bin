/* Crew orbit: timesheets + roster management. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  async function loadMembers() {
    const S = global.EodSession;
    const shift = S.state.selectedShift;
    if (!shift?.visitId || String(shift.visitId).startsWith('test-')) {
      S.patch({ members: [] }, 'members');
      return [];
    }
    const resp = await global.authFetch(
      `${global.EOD_API_BASE}/api/shifts/${encodeURIComponent(shift.visitId)}/members`
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

  async function render(mount) {
    const S = global.EodSession;
    S.syncDomBridges();
    mount.innerHTML = `
      <div class="card">
        <h1>Crew & timesheets</h1>
        <p class="muted">InstaWork and Kompass team sheets open in a full-screen manager. Roster changes use the selected shift from Visit.</p>
        <div class="field">
          <label>InstaWork support today?</label>
          <div class="btn-row">
            <button type="button" class="btn ${S.state.instaworkYes === 'Yes' ? 'btn-primary' : 'btn-secondary'}" data-iw="Yes">Yes</button>
            <button type="button" class="btn ${S.state.instaworkYes === 'No' ? 'btn-primary' : 'btn-secondary'}" data-iw="No">No</button>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="openIwBtn">Open InstaWork management</button>
        <div class="field" style="margin-top:16px;">
          <label>Kompass team sheet today?</label>
          <div class="btn-row">
            <button type="button" class="btn ${S.state.kompassTimesheetYes === 'Yes' ? 'btn-primary' : 'btn-secondary'}" data-kt="Yes">Yes</button>
            <button type="button" class="btn ${S.state.kompassTimesheetYes === 'No' ? 'btn-primary' : 'btn-secondary'}" data-kt="No">No</button>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="openKtBtn">Open Kompass team management</button>
      </div>
      <div class="card">
        <h2>Shift roster</h2>
        <p class="muted" id="rosterShiftMeta">${S.state.selectedShift
          ? esc(S.state.selectedShift.projectName || 'Selected shift')
          : 'No shift selected — go to Visit and Find shifts.'}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="refreshRosterBtn">Refresh roster</button>
          <button type="button" class="btn btn-secondary" id="viewRosterBtn">View roster</button>
        </div>
        <div id="rosterList" style="margin-top:10px;"></div>
      </div>
      <div class="card">
        <h2>Materials</h2>
        <p class="muted">Have you read provided materials with the team?</p>
        <div class="btn-row">
          <button type="button" class="btn ${S.state.materialsReadYes === 'Yes' ? 'btn-primary' : 'btn-secondary'}" data-mat="Yes">Yes</button>
          <button type="button" class="btn btn-secondary" id="openMaterialsBtn">Open the Dump Bin</button>
        </div>
      </div>`;

    mount.querySelectorAll('[data-iw]').forEach((btn) => {
      btn.onclick = () => {
        S.patch({ instaworkYes: btn.getAttribute('data-iw') }, 'iw');
        S.saveDraft();
        render(mount);
      };
    });
    mount.querySelectorAll('[data-kt]').forEach((btn) => {
      btn.onclick = () => {
        S.patch({ kompassTimesheetYes: btn.getAttribute('data-kt') }, 'kt');
        S.saveDraft();
        render(mount);
      };
    });
    mount.querySelector('[data-mat="Yes"]').onclick = () => {
      S.patch({ materialsReadYes: 'Yes' }, 'mat');
      S.saveDraft();
      render(mount);
    };

    document.getElementById('openIwBtn').onclick = () => {
      if (global.EodTimesheetMgmt?.open) global.EodTimesheetMgmt.open('instawork');
      else if (typeof global.openInstaworkManagement === 'function') global.openInstaworkManagement();
      else alert('Timesheet module not loaded');
    };
    document.getElementById('openKtBtn').onclick = () => {
      if (global.EodTimesheetMgmt?.open) global.EodTimesheetMgmt.open('kompass');
      else if (typeof global.openKompassManagement === 'function') global.openKompassManagement();
      else alert('Timesheet module not loaded');
    };
    document.getElementById('openMaterialsBtn').onclick = () => {
      if (global.EodMaterialsBrowser?.open) global.EodMaterialsBrowser.open();
      else if (typeof global.openMaterialsBrowser === 'function') global.openMaterialsBrowser();
      else alert('Materials browser not loaded');
    };

    const list = document.getElementById('rosterList');
    async function paintRoster() {
      try {
        const members = await loadMembers();
        if (!members.length) {
          list.innerHTML = '<p class="muted">No members loaded.</p>';
          return;
        }
        list.innerHTML = members.map((m) => `
          <div class="member-row">
            <strong>${esc(m.name || 'Unknown')}${m.isLead ? ' (Lead)' : ''}</strong>
            <div class="muted">${esc(m.shiftTime || m.title || '')}</div>
          </div>`).join('');
      } catch (err) {
        list.innerHTML = `<p style="color:#ef4444;">${esc(err.message)}</p>`;
      }
    }

    document.getElementById('refreshRosterBtn').onclick = () => paintRoster();
    document.getElementById('viewRosterBtn').onclick = () => {
      const members = S.state.members || [];
      global.EodPicker.open({
        title: 'Current roster',
        items: members.length
          ? members.map((m, i) => ({
              id: String(m.employeeId || i),
              label: m.name || 'Unknown',
              sublabel: m.isLead ? 'Lead' : (m.title || ''),
            }))
          : [{ id: 'empty', label: 'No members', disabled: true }],
        searchable: members.length > 6,
      });
    };
    await paintRoster();
  }

  // Bridge names used by live timesheet module entry points
  global.openInstaworkManagement = function () {
    if (global.EodTimesheetMgmt?.open) return global.EodTimesheetMgmt.open('instawork');
  };
  global.openKompassManagement = function () {
    if (global.EodTimesheetMgmt?.open) return global.EodTimesheetMgmt.open('kompass');
  };

  global.EodRouter.register('crew', render);
})(typeof window !== 'undefined' ? window : globalThis);
