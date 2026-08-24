/* Digital signoff — hard heart of the day. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function bothLiveComplete(row) {
    const live = row?.live;
    if (!live) return false;
    if (live.bothComplete) return true;
    return !!(live.prodComplete && live.siComplete);
  }

  function markActive(row, type) {
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'complete') return !!m.complete;
    if (type === 'not_in_store') return !!m.notInStore;
    if (type === 'not_in_si') return !!m.notInSi;
    return m.type === type;
  }

  function rowLooksComplete(row) {
    return markActive(row, 'complete') || bothLiveComplete(row);
  }

  function syncStatusPills(row) {
    const live = row?.live;
    const pills = [];
    if (live) {
      if (live.prodComplete || String(live.prodStatus || '').toLowerCase() === 'done') {
        pills.push('<span class="pill ok">PROD complete</span>');
      }
      if (live.siComplete) {
        pills.push('<span class="pill ok">SI complete</span>');
      } else if (live.siPresent) {
        const st = String(live.siStatus || 'present').replace(/_/g, ' ');
        pills.push(`<span class="pill">${esc(st.startsWith('SI ') ? st : `SI ${st}`)}</span>`);
      }
    }
    const active = row?.marks?.active || (row?.mark?.type ? [row.mark.type] : []) || [];
    for (const t of active) {
      if (t === 'complete') {
        // System auto-complete from PROD+SI shows as sheet complete; lead override labeled separately
        const by = row?.marks?.details?.complete?.markedBy;
        if (by && by !== 'prod-si-sync') {
          pills.push('<span class="pill ok">lead complete</span>');
        } else {
          pills.push('<span class="pill ok">sheet complete</span>');
        }
        continue;
      }
      if (t === 'not_in_si' && live?.siPresent) continue;
      pills.push(`<span class="pill">${esc(String(t).replace(/_/g, ' '))}</span>`);
    }
    if (bothLiveComplete(row) && !active.includes('complete')) {
      pills.push('<span class="pill ok">sheet complete</span>');
    }
    if (!pills.length) pills.push('<span class="pill">open</span>');
    return pills.join('');
  }

  function rowClass(row) {
    const c = [];
    if (rowLooksComplete(row)) c.push('marked-complete');
    if (markActive(row, 'not_in_store')) c.push('marked-nis');
    if (markActive(row, 'not_in_si') && !row?.live?.siPresent) c.push('marked-nisi');
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

  /** Fetch all signoff pages as PDF (preview) or fax via print-at-store. */
  async function openSignoffPdfPreview() {
    const S = global.EodSession;
    const sheet = S.state.sheet;
    if (!sheet) return;
    const btn = document.getElementById('printSignoffBtn');
    if (btn) btn.disabled = true;
    try {
      const qs = new URLSearchParams({
        store: sheet.storeNumber,
        week: sheet.fiscalWeek,
        bucket: 'all',
      });
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

  async function printSignoffAtStore(faxStoreNumber) {
    const S = global.EodSession;
    const sheet = S.state.sheet;
    if (!sheet) throw new Error('No digital sheet loaded');
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const body = JSON.stringify({
      storeNumber: sheet.storeNumber,
      fiscalWeek: sheet.fiscalWeek,
      workDate: S.state.workDate,
      faxStoreNumber: String(faxStoreNumber || sheet.storeNumber).replace(/\D/g, ''),
    });
    const resp = await global.authFetch(`${API}/print-at-store`, { method: 'POST', headers, body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Print at store failed (${resp.status})`);
    return data;
  }

  function openPrintAtStoreModal() {
    const S = global.EodSession;
    const sheet = S.state.sheet;
    if (!sheet) return;
    const existing = document.getElementById('printAtStoreOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'printAtStoreOverlay';
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = `
      <div class="modal-dialog">
        <h2>Print signoff at store</h2>
        <p class="muted">Emails the full signoff PDF (all pages, including BLITZ) to the store fax via subject #<em>store</em>.</p>
        <div class="field">
          <label for="faxStoreInput">Store number for fax</label>
          <input type="text" id="faxStoreInput" inputmode="numeric" value="${esc(S.state.storeNumber || sheet.storeNumber || '')}">
        </div>
        <div id="printAtStoreMsg" class="muted" style="margin:8px 0;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="printAtStorePreview">Preview PDF</button>
          <button type="button" class="btn btn-success" id="printAtStoreSend">Send to store fax</button>
          <button type="button" class="btn btn-secondary" id="printAtStoreCancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const msg = () => document.getElementById('printAtStoreMsg');
    overlay.querySelector('#printAtStoreCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#printAtStorePreview').onclick = async () => {
      try {
        await openSignoffPdfPreview();
      } catch (err) {
        if (msg()) msg().textContent = err.message || String(err);
      }
    };
    overlay.querySelector('#printAtStoreSend').onclick = async () => {
      const faxStore = document.getElementById('faxStoreInput')?.value?.trim();
      const sendBtn = overlay.querySelector('#printAtStoreSend');
      sendBtn.disabled = true;
      if (msg()) msg().textContent = 'Sending…';
      try {
        const result = await printSignoffAtStore(faxStore);
        if (msg()) {
          msg().textContent = result.testMode
            ? `TEST send OK — ${result.subject} → ${result.to}`
            : `Sent ${result.filename || 'PDF'} as ${result.subject}`;
        }
        if (global.EodConnections?.toast) {
          global.EodConnections.toast(result.testMode ? 'Test fax emailed' : `Fax queued ${result.subject}`, 'ok');
        }
      } catch (err) {
        if (msg()) msg().textContent = err.message || String(err);
        sendBtn.disabled = false;
      }
    };
  }

  function isOpenRow(row) {
    return !rowLooksComplete(row)
      && !markActive(row, 'not_in_store')
      && !markActive(row, 'not_in_si');
  }

  function rowLabel(row) {
    return row?.catName || row?.dbkey || row?.catId || 'set';
  }

  function findRowForHelpdeskMeta(meta) {
    const rows = global.EodSession?.state?.sheet?.rows || [];
    const rowId = meta?.rowId != null ? String(meta.rowId) : '';
    const dbkey = String(meta?.dbkey || '').trim();
    const catNum = String(meta?.categoryNumber || '').replace(/\D/g, '');
    const name = String(meta?.setLabel || meta?.categoryName || '').trim().toLowerCase();
    return rows.find((r) => {
      if (rowId && String(r.id) === rowId) return true;
      if (dbkey && String(r.dbkey || '').trim() === dbkey) return true;
      const rNum = String(r.catId || '').replace(/\D/g, '');
      if (catNum && rNum && catNum === rNum) return true;
      const rName = String(r.catName || '').trim().toLowerCase();
      if (name && rName && (rName === name || rName.includes(name) || name.includes(rName))) return true;
      return false;
    }) || null;
  }

  async function applyMark(rowId, markType, opts) {
    const skipReload = !!(opts && opts.skipReload);
    const skipHelpdeskPrompt = !!(opts && opts.skipHelpdeskPrompt);
    const forceOn = !!(opts && opts.forceOn);
    const helpdeskSent = !!(opts && opts.helpdeskSent);
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders();
    const current = (S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId));
    if (markType === 'clear') {
      const resp = await global.authFetch(`${API}/rows/${encodeURIComponent(rowId)}/mark`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ storeNumber: S.state.storeNumber, workDate: S.state.workDate }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Clear failed (${resp.status})`);
    } else if (!forceOn && markActive(current, markType)) {
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
          helpdeskSent,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Mark failed (${resp.status})`);
      if (markType === 'not_in_store') {
        const row = (S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId)) || current;
        const label = rowLabel(row);
        S.appendNote?.(`Not in store: ${label}`);
        if (!skipHelpdeskPrompt) {
          try {
            if (typeof global.askToReportNotInStore === 'function') {
              await global.askToReportNotInStore(row || { id: rowId });
            } else if (typeof global.openHelpdeskForSheetRow === 'function') {
              await global.openHelpdeskForSheetRow(row || { id: rowId });
            }
          } catch (_) {}
        }
      }
    }
    if (!skipReload) await loadSheet();
  }

  async function markNotInStoreFromHelpdesk(meta) {
    const S = global.EodSession;
    const label = meta?.setLabel || meta?.categoryName || '';
    if (label) {
      const list = (S.state.notInStoreSelected || []).slice();
      if (!list.includes(label)) {
        S.patch({ notInStoreSelected: list.concat([label]) }, 'helpdesk-nis');
      }
      S.appendNote?.(`Not in store: ${label}`);
    }
    const row = findRowForHelpdeskMeta(meta || {});
    if (!row) {
      try { S.saveDraft?.(); } catch (_) {}
      return false;
    }
    await applyMark(row.id, 'not_in_store', {
      skipHelpdeskPrompt: true,
      forceOn: true,
      helpdeskSent: true,
    });
    return true;
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

  function sheetWeek() {
    const S = global.EodSession;
    return S.state.fiscalWeek || S.state.sheet?.fiscalWeek || '';
  }

  function localBeforeCount(row) {
    const S = global.EodSession;
    const week = sheetWeek();
    if (!row?.dbkey || !week) return 0;
    const list = global.EodSetBeforeStore?.getBefores?.(S.state.storeNumber, week, row.dbkey) || [];
    return Array.isArray(list) ? list.length : 0;
  }

  function openSetSurvey(btn, slot) {
    const dbkey = btn.getAttribute('data-dbkey') || '';
    const row = btn.getAttribute('data-capture') || btn.getAttribute('data-before') || '';
    const name = btn.getAttribute('data-name') || '';
    if (!dbkey) {
      alert('This row has no dbkey — cannot open Capture.');
      return;
    }
    const qs = new URLSearchParams({ dbkey, rowId: row, name });
    if (slot) qs.set('slot', slot);
    location.hash = `#/survey?${qs.toString()}`;
  }

  function renderRows(sheet, q) {
    const rows = (sheet.rows || []).filter((row) => {
      if (!q) return true;
      return `${row.catName || ''} ${row.dbkey || ''} ${row.dept || ''} ${row.shiftType || ''}`
        .toLowerCase().includes(q);
    });
    if (!rows.length) return '<p class="muted">No sets match.</p>';
    return rows.map((row) => {
      const status = syncStatusPills(row);
      const beforeCount = localBeforeCount(row);
      const btn = (type, label) => {
        const on = type === 'complete' ? rowLooksComplete(row) : markActive(row, type);
        // Selected state is the .on border only — no checkmark (renders as ? on some devices).
        return `<button type="button" class="btn btn-secondary${on ? ' on' : ''}" data-row="${row.id}" data-mark="${type}">${label}</button>`;
      };
      const beforePill = row.dbkey
        ? (beforeCount
          ? `<span class="pill ok">${beforeCount} before${beforeCount === 1 ? '' : 's'}</span>`
          : '<span class="pill warn">no befores</span>')
        : '';
      return `<div class="ds-row ${rowClass(row)}" data-row-id="${row.id}">
        <div><strong>${esc(row.catName || row.catId || '—')}</strong>
          <div class="muted">${esc(row.week || '')} ${esc(row.shiftType || '')} · ${esc(row.dbkey || '—')} · ${esc(row.dept || '')}</div>
          <div class="muted">${row.versionToken || row.version ? `Version ${esc(row.versionToken || ('V' + row.version))}` : 'Version —'}${row.footageDisplay || row.size || row.footage ? ` · Footage ${esc(row.footageDisplay || row.size || row.footage)}` : ' · Footage —'}</div>
          ${row.live ? `<div class="muted">PROD ${esc(row.live.prodStatus || '—')} · SI ${esc(row.live.siPresent ? (row.live.siStatus || 'present') : 'not found')}${row.live.photoCount ? ` · ${row.live.photoCount} ${esc(row.live.photoSource || '')} photo(s)` : ''}</div>` : ''}
        </div>
        <div style="margin-top:6px;">${status} ${beforePill}</div>
        <div class="ds-photo-actions">
          ${row.dbkey ? `<button type="button" class="btn btn-secondary" data-before="${row.id}" data-dbkey="${esc(row.dbkey)}" data-name="${esc(row.catName || row.catId || '')}">Take befores</button>` : ''}
          <button type="button" class="btn btn-primary" data-capture="${row.id}" data-dbkey="${esc(row.dbkey || '')}" data-name="${esc(row.catName || row.catId || '')}">Capture</button>
        </div>
        <div class="ds-actions">
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
        <h1>Categories</h1>
        <div id="sheetSummary" class="sheet-summary muted" style="margin-bottom:10px;">Loading…</div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="syncProdSiBtn">Sync PROD / SI</button>
          <button type="button" class="btn btn-success" id="completeAllBtn" hidden>Complete all</button>
          <button type="button" class="btn btn-secondary" id="printSignoffBtn" hidden>Print signoff PDF</button>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Search sets</label>
          <input type="search" id="sheetSearch" placeholder="Category, DBKEY, dept…">
        </div>
        <div id="sheetRows"></div>
      </div>
      <div class="card dept-sig-card" id="deptSigMount"></div>`;

    const summary = document.getElementById('sheetSummary');
    const rowsEl = document.getElementById('sheetRows');
    const completeAllBtn = document.getElementById('completeAllBtn');
    const printSignoffBtn = document.getElementById('printSignoffBtn');
    const syncBtn = document.getElementById('syncProdSiBtn');
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
      const body = JSON.stringify({
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        visitId: S.state.selectedShift?.visitId || null,
        visitIds,
      });
      const resp = await global.authFetch(`${API}/sync`, { method: 'POST', headers, body });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Sync failed (${resp.status})`);
      if (data.sheet) S.patch({ sheet: data.sheet, sheetLoaded: true }, 'prod-si-sync');
      else {
        S.patch({ sheetLoaded: false }, 'prod-si-sync');
        await loadSheet();
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
          console.warn('[signoff] poll sync', err.message || err);
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
        summary.innerHTML = 'No hosted sheet for this store/week yet.';
        rowsEl.innerHTML = '';
        completeAllBtn.hidden = true;
        printSignoffBtn.hidden = true;
        document.body.classList.add('no-hosted-sheet');
        document.body.classList.remove('has-hosted-sheet');
        return;
      }
      document.body.classList.add('has-hosted-sheet');
      document.body.classList.remove('no-hosted-sheet');
      printSignoffBtn.hidden = !(sheet.rows || []).length;
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
        btn.onclick = () => openSetSurvey(btn);
      });
      rowsEl.querySelectorAll('[data-before]').forEach((btn) => {
        btn.onclick = () => openSetSurvey(btn, 'before');
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
    printSignoffBtn.onclick = () => openPrintAtStoreModal();

    await paint();
    try {
      await syncProdSi();
      await paint();
    } catch (err) {
      console.warn('[signoff] initial sync', err.message || err);
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
      };
      try { global.EodDeptSignatures?.ensureUi?.(); } catch (_) {}
    }
  }

  global.EodSignoffHome = {
    loadSheet,
    render,
    completeAllOpen,
    applyMark,
    markNotInStoreFromHelpdesk,
    openSignoffPdfPreview,
    printSignoffAtStore,
    openPrintAtStoreModal,
  };
  global.EodRouter.register('signoff', render);
})(typeof window !== 'undefined' ? window : globalThis);
