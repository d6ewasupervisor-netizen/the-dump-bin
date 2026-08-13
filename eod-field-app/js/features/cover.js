/* Cover orbit: managers, notes, helpdesk, dept PIC when not on signoff. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  let loadSeq = 0;

  async function loadStoreData(store) {
    const S = global.EodSession;
    const requested = S.normStoreNumber(store);
    if (!requested) return;
    const seq = ++loadSeq;
    const resp = await global.authFetch(`${global.EOD_API_BASE}/store-data/${encodeURIComponent(requested)}`);
    if (seq !== loadSeq) return;
    if (S.normStoreNumber(S.state.storeNumber) !== requested) return;
    if (!resp.ok) return;
    const data = await resp.json();
    if (seq !== loadSeq) return;
    if (data.success) {
      S.patch({
        fredmeyerEmailPool: Array.isArray(data.fredmeyerEmails) ? data.fredmeyerEmails : [],
        managerNamePool: Array.isArray(data.managerNames) ? data.managerNames : [],
      }, 'store-data');
    }
  }

  async function render(mount) {
    const S = global.EodSession;
    S.syncDomBridges();
    try { await loadStoreData(S.state.storeNumber); } catch (_) {}

    mount.innerHTML = `
      <div class="card">
        <h1>Cover details</h1>
        <p class="muted">Managers, notes, and help desk. Not-in-store / Not-in-SI are marked on the digital signoff sheet when a hosted sheet exists.</p>
        <div class="field">
          <label>Manager checked in with</label>
          <input type="text" id="checkInManager" value="${esc(S.state.checkInManager)}" list="mgrList" autocomplete="off">
          <button type="button" class="btn btn-secondary btn-block" id="pickInMgr" style="margin-top:6px;">Choose saved name</button>
        </div>
        <div class="field">
          <label>Manager checked out with</label>
          <input type="text" id="checkOutManager" value="${esc(S.state.checkOutManager)}" list="mgrList" autocomplete="off">
          <button type="button" class="btn btn-secondary btn-block" id="pickOutMgr" style="margin-top:6px;">Choose saved name</button>
        </div>
        <datalist id="mgrList">${(S.state.managerNamePool || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field">
          <label>Notes</label>
          <textarea id="coverNotes" rows="4">${esc(S.state.notes)}</textarea>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="helpdeskBtn">Help desk report</button>
          <button type="button" class="btn btn-secondary" id="deptSigBtn">Department signatures</button>
        </div>
      </div>
      ${S.hasHostedSheet() ? '' : `
      <div class="card">
        <h2>Not in store / Not in SI (paper week)</h2>
        <p class="muted">No hosted sheet — use free-text tags here. When a digital sheet exists, mark rows there instead.</p>
        <div class="field">
          <label>Not in store</label>
          <input type="text" id="nisOther" placeholder="Set name">
          <button type="button" class="btn btn-secondary btn-block" id="addNis" style="margin-top:6px;">Add</button>
          <div id="nisTags" style="margin-top:8px;"></div>
        </div>
        <div class="field">
          <label>Not in SI</label>
          <input type="text" id="nisiOther" placeholder="Set name">
          <button type="button" class="btn btn-secondary btn-block" id="addNisi" style="margin-top:6px;">Add</button>
          <div id="nisiTags" style="margin-top:8px;"></div>
        </div>
      </div>`}
      <div id="helpdeskWizardOverlay" class="modal-overlay"></div>`;

    function paintTags() {
      const nis = document.getElementById('nisTags');
      const nisi = document.getElementById('nisiTags');
      if (nis) {
        nis.innerHTML = (S.state.notInStoreSelected || []).map((t, i) =>
          `<span class="pill bad">${esc(t)} <button type="button" data-rm-nis="${i}" style="border:0;background:transparent;color:inherit;cursor:pointer;">×</button></span>`
        ).join('');
        nis.querySelectorAll('[data-rm-nis]').forEach((b) => {
          b.onclick = () => {
            const arr = S.state.notInStoreSelected.slice();
            arr.splice(Number(b.getAttribute('data-rm-nis')), 1);
            S.patch({ notInStoreSelected: arr }, 'nis');
            S.saveDraft();
            paintTags();
          };
        });
      }
      if (nisi) {
        nisi.innerHTML = (S.state.notInSiSelected || []).map((t, i) =>
          `<span class="pill warn">${esc(t)} <button type="button" data-rm-nisi="${i}" style="border:0;background:transparent;color:inherit;cursor:pointer;">×</button></span>`
        ).join('');
        nisi.querySelectorAll('[data-rm-nisi]').forEach((b) => {
          b.onclick = () => {
            const arr = S.state.notInSiSelected.slice();
            arr.splice(Number(b.getAttribute('data-rm-nisi')), 1);
            S.patch({ notInSiSelected: arr }, 'nisi');
            S.saveDraft();
            paintTags();
          };
        });
      }
    }
    paintTags();

    function wireMgr(btnId, inputId) {
      document.getElementById(btnId).onclick = () => {
        const items = (S.state.managerNamePool || []).map((n, i) => ({ id: String(i), label: n }));
        global.EodPicker.open({
          anchor: document.getElementById(btnId),
          title: 'Saved managers',
          items: items.length ? items : [{ id: 'x', label: 'No saved names', disabled: true }],
          searchable: items.length > 6,
          onChoose(item) {
            document.getElementById(inputId).value = item.label;
          },
        });
      };
    }
    wireMgr('pickInMgr', 'checkInManager');
    wireMgr('pickOutMgr', 'checkOutManager');

    const saveFields = () => {
      S.patch({
        checkInManager: document.getElementById('checkInManager').value.trim(),
        checkOutManager: document.getElementById('checkOutManager').value.trim(),
        notes: document.getElementById('coverNotes').value,
      }, 'cover');
      S.saveDraft();
    };
    ['checkInManager', 'checkOutManager', 'coverNotes'].forEach((id) => {
      document.getElementById(id).addEventListener('change', saveFields);
      document.getElementById(id).addEventListener('blur', saveFields);
    });

    document.getElementById('addNis')?.addEventListener('click', () => {
      const v = document.getElementById('nisOther').value.trim();
      if (!v) return;
      const arr = S.state.notInStoreSelected.slice();
      if (!arr.includes(v)) arr.push(v);
      S.patch({ notInStoreSelected: arr }, 'nis');
      document.getElementById('nisOther').value = '';
      S.saveDraft();
      paintTags();
    });
    document.getElementById('addNisi')?.addEventListener('click', () => {
      const v = document.getElementById('nisiOther').value.trim();
      if (!v) return;
      const arr = S.state.notInSiSelected.slice();
      if (!arr.includes(v)) arr.push(v);
      S.patch({ notInSiSelected: arr }, 'nisi');
      document.getElementById('nisiOther').value = '';
      S.saveDraft();
      paintTags();
    });

    document.getElementById('helpdeskBtn').onclick = () => {
      if (typeof global.openHelpdeskWizard === 'function') global.openHelpdeskWizard();
      else alert('Help desk wizard not loaded');
    };
    document.getElementById('deptSigBtn').onclick = () => {
      try { global.EodDeptSignatures?.ensureUi?.(); } catch (_) {}
      if (global.EodDeptSignatures?.refresh) global.EodDeptSignatures.refresh();
      const section = document.getElementById('deptSigSection');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
      } else {
        global.EodRouter.go('signoff');
      }
    };
  }

  global.EodCover = { loadStoreData };
  global.EodRouter.register('cover', render);
})(typeof window !== 'undefined' ? window : globalThis);
