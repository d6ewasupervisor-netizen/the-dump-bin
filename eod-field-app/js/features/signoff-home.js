/* Digital signoff — hard heart of the day. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function markActive(row, type) {
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'complete') return !!m.complete;
    if (type === 'not_in_store') return !!m.notInStore;
    if (type === 'not_in_si') return !!m.notInSi;
    return m.type === type;
  }

  function rowClass(row) {
    const c = [];
    if (markActive(row, 'complete')) c.push('marked-complete');
    if (markActive(row, 'not_in_store')) c.push('marked-nis');
    if (markActive(row, 'not_in_si')) c.push('marked-nisi');
    return c.join(' ');
  }

  async function loadSheet() {
    const S = global.EodSession;
    const store = S.state.storeNumber;
    const date = S.state.workDate;
    const qs = new URLSearchParams({ store });
    if (date) qs.set('date', date);
    const resp = await global.authFetch(`${API}/sheet?${qs}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Load failed (${resp.status})`);
    const sheet = data.sheet || null;
    S.patch({
      sheet,
      sheetLoaded: true,
      fiscalWeek: sheet?.fiscalWeek || S.state.fiscalWeek || '',
    }, 'sheet');
    try {
      global.EodDeptSignatures?.syncFromSheet?.(sheet);
    } catch (_) {
      if (sheet?.requiredRoles?.length) {
        global.EodDeptSignatures?.setRequiredRoles?.(sheet.requiredRoles);
      }
    }
    // Sync legacy NIS/NISI arrays from marks
    if (sheet?.rows) {
      const nis = [];
      const nisi = [];
      for (const row of sheet.rows) {
        const label = row.catName || row.dbkey;
        if (!label) continue;
        if (markActive(row, 'not_in_store')) nis.push(label);
        if (markActive(row, 'not_in_si')) nisi.push(label);
      }
      S.patch({ notInStoreSelected: nis, notInSiSelected: nisi }, 'marks-sync');
    }
    return sheet;
  }

  /** Fetch the live-rendered printable signoff PDF and open it in a new tab. */
  async function openSignoffPdf(bucket) {
    const S = global.EodSession;
    const sheet = S.state.sheet;
    if (!sheet) return;
    const btn = document.getElementById(bucket === 'blitz' ? 'printBlitzBtn' : 'printSignoffBtn');
    if (btn) btn.disabled = true;
    try {
      const qs = new URLSearchParams({ store: sheet.storeNumber, week: sheet.fiscalWeek, bucket });
      const resp = await global.authFetch(`${API}/pdf?${qs}`);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `PDF failed (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function isOpenRow(row) {
    return !markActive(row, 'complete')
      && !markActive(row, 'not_in_store')
      && !markActive(row, 'not_in_si');
  }

  async function applyMark(rowId, markType, opts) {
    const skipReload = !!(opts && opts.skipReload);
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders();
    if (markType === 'clear') {
      const resp = await global.authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ storeNumber: S.state.storeNumber, workDate: S.state.workDate }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Clear failed (${resp.status})`);
    } else if (markActive((S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId)), markType)) {
      const resp = await global.authFetch(
        `${API}/rows/${encodeURIComponent(rowId)}/mark?markType=${encodeURIComponent(markType)}`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            storeNumber: S.state.storeNumber,
            workDate: S.state.workDate,
            markType,
          }),
        }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Unmark failed (${resp.status})`);
    } else {
      const visitId = S.state.selectedShift?.visitId || null;
      const resp = await global.authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          markType,
          visitId,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Mark failed (${resp.status})`);
      // Side-effect hooks for NIS (helpdesk) — optional prompt
      if (markType === 'not_in_store' && typeof global.openHelpdeskWizard === 'function') {
        // Soft prompt only; mark already saved.
      }
    }
    if (!skipReload) await loadSheet();
  }

  /** Mark every still-open set Complete. Leaves NIS / NISI alone. */
  async function completeAllOpen(onProgress) {
    const S = global.EodSession;
    const open = (S.state.sheet?.rows || []).filter(isOpenRow);
    if (!open.length) return { ok: 0, fail: 0, total: 0 };
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < open.length; i++) {
      const row = open[i];
      try {
        if (typeof onProgress === 'function') onProgress(i + 1, open.length, row);
        await applyMark(row.id, 'complete', { skipReload: true });
        ok += 1;
      } catch (err) {
        fail += 1;
        console.warn('[signoff] complete-all row failed', row.id, err);
      }
    }
    await loadSheet();
    return { ok, fail, total: open.length };
  }

  function renderRows(sheet, q) {
    const rows = (sheet.rows || []).filter((row) => {
      if (!q) return true;
      return `${row.catName || ''} ${row.dbkey || ''} ${row.dept || ''} ${row.shiftType || ''}`
        .toLowerCase().includes(q);
    });
    if (!rows.length) return '<p class="muted">No sets match.</p>';
    return rows.map((row) => {
      const status = (row.marks?.active || (row.mark?.type ? [row.mark.type] : []) || [])
        .map((t) => `<span class="pill">${esc(t.replace(/_/g, ' '))}</span>`).join('')
        || '<span class="pill">open</span>';
      const btn = (type, label) => {
        const on = markActive(row, type);
        return `<button type="button" class="btn btn-secondary${on ? ' on' : ''}" data-row="${row.id}" data-mark="${type}">${on ? '✓ ' : ''}${label}</button>`;
      };
      return `<div class="ds-row ${rowClass(row)}" data-row-id="${row.id}">
        <div><strong>${esc(row.catName || row.catId || '—')}</strong>
          <div class="muted">${esc(row.week || '')} ${esc(row.shiftType || '')} · ${esc(row.dbkey || '—')} · ${esc(row.dept || '')}</div>
          <div class="muted">${row.versionToken || row.version ? `Version ${esc(row.versionToken || ('V' + row.version))}` : 'Version —'}${row.footageDisplay || row.size || row.footage ? ` · Footage ${esc(row.footageDisplay || row.size || row.footage)}` : ' · Footage —'}</div>
          ${row.live ? `<div class="muted">PROD ${esc(row.live.prodStatus || '—')} · SI ${esc(row.live.siPresent ? (row.live.siStatus || 'present') : 'not found')}${row.live.photoCount ? ` · ${row.live.photoCount} ${esc(row.live.photoSource || '')} photo(s)` : ''}</div>` : ''}
        </div>
        <div style="margin-top:6px;">${status}</div>
        <div class="ds-actions">
          <button type="button" class="btn btn-primary" data-capture="${row.id}" data-dbkey="${esc(row.dbkey || '')}" data-name="${esc(row.catName || row.catId || '')}">Capture</button>
          ${btn('complete', 'Complete')}
          ${btn('not_in_store', 'Not in store')}
          ${btn('not_in_si', 'Not in SI')}
          <button type="button" class="btn btn-secondary" data-row="${row.id}" data-mark="clear">Clear</button>
        </div>
      </div>`;
    }).join('');
  }

  async function render(mount) {
    const S = global.EodSession;
    mount.innerHTML = `
      <div class="card heart">
        <h1>Digital signoff sheet</h1>
        <p class="muted">This is the heart of your day. Marks sync from PROD + Store Intelligence across every ISE shift for the store (Kompass, Blitz, Cut-in, DIV, Central Pet). Photos for the store view page are prebuilt as they land — SI preferred over PROD.</p>
        <div id="sheetSummary" class="muted" style="margin-bottom:10px;">Loading…</div>
        <div id="sheetSyncStatus" class="muted" style="margin-bottom:10px;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="syncProdSiBtn">Sync PROD / SI</button>
          <button type="button" class="btn btn-success" id="completeAllBtn" hidden>Complete all</button>
          <button type="button" class="btn btn-secondary" id="printSignoffBtn" hidden>Print signoff PDF</button>
          <button type="button" class="btn btn-secondary" id="printBlitzBtn" hidden>Print BLITZ signoff PDF</button>
          <button type="button" class="btn btn-secondary" id="paperFallbackBtn" hidden>Paper sign-off photos</button>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Search sets</label>
          <input type="search" id="sheetSearch" placeholder="Category, DBKEY, dept…">
        </div>
        <div id="sheetRows"></div>
      </div>
      <div class="card" id="deptSigMount"></div>`;

    const summary = document.getElementById('sheetSummary');
    const rowsEl = document.getElementById('sheetRows');
    const completeAllBtn = document.getElementById('completeAllBtn');
    const printSignoffBtn = document.getElementById('printSignoffBtn');
    const printBlitzBtn = document.getElementById('printBlitzBtn');
    const paperBtn = document.getElementById('paperFallbackBtn');
    const syncBtn = document.getElementById('syncProdSiBtn');
    const syncStatus = document.getElementById('sheetSyncStatus');
    let pollTimer = null;

    function pacificHourNow() {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          hour: 'numeric',
          hour12: false,
        }).formatToParts(new Date());
        return Number(parts.find((p) => p.type === 'hour')?.value) % 24;
      } catch {
        return new Date().getHours();
      }
    }

    function pollMs() {
      return pacificHourNow() >= 12 ? 5 * 60 * 1000 : 60 * 60 * 1000;
    }

    async function syncProdSi() {
      const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
      const shifts = Array.isArray(S.state.shifts) ? S.state.shifts : [];
      const visitIds = shifts.map((s) => s.visitId).filter(Boolean);
      const leadName = S.state.leadName
        || S.state.selectedShift?.visitLead
        || S.state.selectedShift?.leadName
        || null;
      const body = JSON.stringify({
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        visitId: S.state.selectedShift?.visitId || null,
        visitIds,
        leadName,
      });
      if (syncStatus) syncStatus.textContent = 'Syncing PROD and Store Intelligence across all ISE shifts…';
      const resp = await global.authFetch(`${API}/sync`, { method: 'POST', headers, body });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Sync failed (${resp.status})`);
      if (data.sheet) S.patch({ sheet: data.sheet, sheetLoaded: true }, 'prod-si-sync');
      else {
        S.patch({ sheetLoaded: false }, 'prod-si-sync');
        await loadSheet();
      }
      const n = data.applied || 0;
      const vCount = data.visitCount || visitIds.length || 0;
      if (syncStatus) {
        syncStatus.textContent = n
          ? `Auto-marked ${n} set(s) from ${vCount} PROD shift(s) · next check ${pacificHourNow() >= 12 ? 'in 5 min' : 'hourly until noon PT'}`
          : `PROD/SI checked across ${vCount} shift(s) · no new auto-marks · next ${pacificHourNow() >= 12 ? '5 min' : 'hourly until noon PT'}`;
      }
      return data;
    }

    function startPoll() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (global.EodRouter?.current !== 'signoff') return;
        try {
          await syncProdSi();
          await paint();
          global.EodChrome?.refresh();
        } catch (err) {
          if (syncStatus) syncStatus.textContent = err.message || 'Sync failed';
        }
      }, pollMs());
    }

    async function paint() {
      let sheet = S.state.sheet;
      if (!S.state.sheetLoaded) {
        try { sheet = await loadSheet(); }
        catch (err) {
          summary.innerHTML = `<span style="color:#ef4444;">${esc(err.message)}</span>`;
          rowsEl.innerHTML = '';
          return;
        }
      }
      if (!sheet) {
        summary.innerHTML = 'No hosted sheet for this store/week yet. Use <strong>paper sign-off photos</strong> in Photos, or wait for weekly digital ingest.';
        rowsEl.innerHTML = '';
        paperBtn.hidden = false;
        completeAllBtn.hidden = true;
        printSignoffBtn.hidden = true;
        printBlitzBtn.hidden = true;
        document.body.classList.add('no-hosted-sheet');
        document.body.classList.remove('has-hosted-sheet');
        return;
      }
      document.body.classList.add('has-hosted-sheet');
      document.body.classList.remove('no-hosted-sheet');
      paperBtn.hidden = true;
      printSignoffBtn.hidden = !(sheet.rows || []).length;
      printBlitzBtn.hidden = !sheet.summary?.hasBlitzRows;
      const s = sheet.summary || {};
      const open = (sheet.rows || []).filter(isOpenRow).length;
      summary.innerHTML = `<strong>${esc(sheet.fiscalWeek)}</strong> · Store ${esc(sheet.storeNumber)}`
        + (sheet.team ? ` · Team ${esc(sheet.team)}` : '')
        + ` · ${s.marked || 0}/${s.total || 0} marked`
        + ` · <span class="${open ? 'pill warn' : 'pill ok'}">${open} open</span>`;
      completeAllBtn.hidden = open === 0;
      completeAllBtn.disabled = false;
      completeAllBtn.textContent = open ? `Complete all (${open})` : 'Complete all';
      const q = (document.getElementById('sheetSearch').value || '').trim().toLowerCase();
      rowsEl.innerHTML = renderRows(sheet, q);
      rowsEl.querySelectorAll('[data-mark]').forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            await applyMark(btn.getAttribute('data-row'), btn.getAttribute('data-mark'));
            await paint();
            try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
            global.EodChrome?.refresh();
          } catch (err) {
            alert(err.message || String(err));
          } finally {
            btn.disabled = false;
          }
        };
      });
      rowsEl.querySelectorAll('[data-capture]').forEach((btn) => {
        btn.onclick = () => {
          const dbkey = btn.getAttribute('data-dbkey') || '';
          const row = btn.getAttribute('data-capture') || '';
          const name = btn.getAttribute('data-name') || '';
          if (!dbkey) {
            alert('This row has no dbkey — cannot open Capture.');
            return;
          }
          const qs = new URLSearchParams({ dbkey, rowId: row, name });
          location.hash = `#/survey?${qs.toString()}`;
        };
      });
    }

    document.getElementById('syncProdSiBtn').onclick = async () => {
      syncBtn.disabled = true;
      try {
        await syncProdSi();
        await paint();
        try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
        global.EodChrome?.refresh();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        syncBtn.disabled = false;
      }
    };
    document.getElementById('sheetSearch').oninput = () => paint();
    completeAllBtn.onclick = async () => {
      const open = (S.state.sheet?.rows || []).filter(isOpenRow);
      if (!open.length) return;
      if (!confirm(
        `Mark all ${open.length} open set(s) Complete?\n\n`
        + 'Already marked Not in store / Not in SI stay as-is.\n'
        + 'This writes to the hosted sheet (same as tapping Complete on each row).'
      )) return;
      try { S.saveDraft(); } catch (_) {}
      completeAllBtn.disabled = true;
      const label = completeAllBtn.textContent;
      try {
        const result = await completeAllOpen((n, total) => {
          completeAllBtn.textContent = `Completing ${n}/${total}…`;
        });
        await paint();
        try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
        global.EodChrome?.refresh();
        const msg = result.fail
          ? `Completed ${result.ok}/${result.total}. ${result.fail} failed — retry those rows or tap Complete all again.`
          : `Completed all ${result.ok} open set(s).`;
        if (global.EodConnections?.toast) global.EodConnections.toast(msg, result.fail ? 'error' : 'ok');
        else alert(msg);
      } catch (err) {
        alert(err.message || String(err));
        completeAllBtn.textContent = label;
        completeAllBtn.disabled = false;
      }
    };
    paperBtn.onclick = () => global.EodRouter.go('photos');
    printSignoffBtn.onclick = () => openSignoffPdf('main');
    printBlitzBtn.onclick = () => openSignoffPdf('blitz');

    await paint();
    try {
      await syncProdSi();
      await paint();
    } catch (err) {
      if (syncStatus) syncStatus.textContent = err.message || 'PROD/SI sync unavailable';
    }
    startPoll();

    // Mount dept signatures into orbit card on this page for convenience
    const deptHost = document.getElementById('deptSigMount');
    if (deptHost && global.EodDeptSignatures?.mountInline) {
      await global.EodDeptSignatures.mountInline(deptHost);
      try { global.EodDeptSignatures.syncFromSheet?.(S.state.sheet); } catch (_) {}
    } else if (deptHost) {
      deptHost.innerHTML = `<h2>Department signatures</h2>
        <p class="muted">Collect PIC signatures any time. Roles filter from the sheet when available.</p>
        <button type="button" class="btn btn-primary btn-block" id="openDeptSigsBtn">Open department signatures</button>`;
      document.getElementById('openDeptSigsBtn').onclick = () => {
        if (global.EodDeptSignatures?.open) global.EodDeptSignatures.open();
        else global.EodRouter.go('cover');
      };
      // Ensure module UI exists
      try { global.EodDeptSignatures?.ensureUi?.(); } catch (_) {}
    }
  }

  global.EodSignoffHome = { loadSheet, render, completeAllOpen, applyMark, openSignoffPdf };
  global.EodRouter.register('signoff', render);
})(typeof window !== 'undefined' ? window : globalThis);
