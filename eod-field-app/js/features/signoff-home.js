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
    if (global.EodCategoryCardStatus?.markActive) {
      return global.EodCategoryCardStatus.markActive(row, type);
    }
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'complete') return !!m.complete;
    if (type === 'not_in_store') return !!m.notInStore;
    if (type === 'not_in_si') return !!m.notInSi;
    if (type === 'backlog') return !!m.backlog;
    if (type === 'out_of_scope') return !!m.outOfScope;
    return m.type === type;
  }

  function rowLooksComplete(row) {
    if (global.EodCategoryCardStatus?.sheetRowDone) {
      return global.EodCategoryCardStatus.sheetRowDone(row);
    }
    return markActive(row, 'complete')
      || markActive(row, 'not_in_store')
      || markActive(row, 'out_of_scope')
      || bothLiveComplete(row);
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
      if (t === 'backlog') {
        pills.push('<span class="pill warn">backlog</span>');
        continue;
      }
      pills.push(`<span class="pill">${esc(String(t).replace(/_/g, ' '))}</span>`);
    }
    if (!pills.length) pills.push('<span class="pill">open</span>');
    return pills.join('');
  }

  function rowClass(row) {
    const c = [];
    if (rowLooksComplete(row)) c.push('marked-complete');
    if (markActive(row, 'not_in_store')) c.push('marked-nis');
    if (markActive(row, 'not_in_si') && !row?.live?.siPresent) c.push('marked-nisi');
    if (markActive(row, 'backlog') && !rowLooksComplete(row)) c.push('marked-backlog');
    if (row?.hasError || String(row?.errorMessage || row?.error_message || '').trim()) {
      c.push('manifest-error');
    }
    return c.join(' ');
  }

  async function loadSheet() {
    const S = global.EodSession;
    const store = S.state.storeNumber;
    const date = S.state.workDate;
    const weekHint = S.state.fiscalWeek || S.state.sheet?.fiscalWeek || '';
    if (!S.state.sheet && store && weekHint && global.EodGarden?.loadSheetSnapshot) {
      try {
        const snap = await global.EodGarden.loadSheetSnapshot(store, weekHint);
        if (snap && Array.isArray(snap.rows)) {
          S.patch({ sheet: snap, sheetLoaded: true, fiscalWeek: snap.fiscalWeek || weekHint }, 'sheet-garden');
        }
      } catch (_) {}
    }
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
    try { await global.EodGarden?.saveSheetSnapshot?.(sheet); } catch (_) {}
    try { await global.EodGarden?.flushMarks?.(); } catch (_) {}
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
    try { global.EodSetMediaPrefetch?.start(sheet); } catch (_) {}
    return sheet;
  }

  let syncPromise = null;
  async function syncProdSi() {
    const S = global.EodSession;
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
      const shifts = Array.isArray(S.state.shifts) ? S.state.shifts : [];
      const visitIds = shifts.map((s) => s.visitId).filter(Boolean);
      const body = JSON.stringify({
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        visitId: S.state.selectedShift?.visitId || null,
        visitIds,
      });
      const resp = await global.authFetch(`${API}/sync`, {
        method: 'POST',
        headers,
        body,
        skipBusy: true,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Sync failed (${resp.status})`);
      if (data.sheet) S.patch({ sheet: data.sheet, sheetLoaded: true }, 'prod-si-sync');
      else {
        S.patch({ sheetLoaded: false }, 'prod-si-sync');
        await loadSheet();
      }
      try { global.EodCoverNotes?.apply?.(S, 'prod-si-sync'); } catch (_) {}
      try { global.EodSetMediaPrefetch?.start(S.state.sheet); } catch (_) {}
      return data;
    })();
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  /** Fetch all signoff pages as PDF (preview) or fax via print-at-store. */
  async function openSignoffPdfPreview() {
    const S = global.EodSession;
    const sheet = S.state.sheet;
    if (!sheet) return;
    const btn = document.getElementById('sendPrintSignoffBtn');
    if (btn) btn.disabled = true;
    try {
      try { await global.EodDeptSignatures?.persistLeadSignature?.(); } catch (_) { /* PDF still builds */ }
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
    if (markActive(row, 'out_of_scope')) return false;
    return !rowLooksComplete(row)
      && !markActive(row, 'not_in_store')
      && !markActive(row, 'backlog');
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

  async function confirmOutOfScope(count) {
    const n = Number(count) || 1;
    const id = await (global.EodAlerts?.showDialog
      ? global.EodAlerts.showDialog({
        title: 'Out of Scope',
        message: n === 1
          ? 'Remove this set from the sign-off sheet? It is another project.'
          : `Remove ${n} sets from the sign-off sheet? They are another project.`,
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'ok', label: 'Remove', primary: true },
        ],
      })
      : Promise.resolve(window.confirm('Remove from the sign-off sheet?') ? 'ok' : 'cancel'));
    return id === 'ok';
  }

  async function applyMark(rowId, markType, opts) {
    const skipReload = !!(opts && opts.skipReload);
    const forceOn = !!(opts && opts.forceOn);
    const helpdeskSent = !!(opts && opts.helpdeskSent);
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders();
    const current = (S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId));
    const turningOn = markType !== 'clear' && (forceOn || !markActive(current, markType));
    const method = markType === 'clear' || (!forceOn && markActive(current, markType)) ? 'DELETE' : 'POST';
      const visitId = S.state.selectedShift?.visitId || current?.live?.prodVisitId || null;
      const resetId = current?.live?.prodResetId || null;
      const body = method === 'POST'
        ? {
            storeNumber: S.state.storeNumber,
            workDate: S.state.workDate,
            markType,
            visitId,
            resetId,
            helpdeskSent,
          }
      : {
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          markType: markType === 'clear' ? undefined : markType,
        };

    if (S.state.sheet && global.EodGarden?.applyOptimisticMark) {
      global.EodGarden.applyOptimisticMark(
        S.state.sheet,
        rowId,
        markType,
        markType === 'clear' ? false : turningOn
      );
      S.emit?.('sheet-mark');
      try { await global.EodGarden.saveSheetSnapshot(S.state.sheet); } catch (_) {}
    }

    const url = method === 'DELETE'
      ? `${API}/rows/${encodeURIComponent(rowId)}/mark${markType !== 'clear'
        ? `?markType=${encodeURIComponent(markType)}`
        : ''}`
      : `${API}/rows/${encodeURIComponent(rowId)}/mark`;

    try {
      const resp = await global.authFetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Mark failed (${resp.status})`);
      if (!skipReload) await loadSheet();
    } catch (err) {
      const msg = String(err && err.message || err || '');
      const network = /fetch|network|offline/i.test(msg)
        || (typeof navigator !== 'undefined' && navigator.onLine === false);
      const retryable = network || /\(5\d\d\)/.test(msg);
      if (retryable) {
        try {
          await global.EodGarden?.enqueueMark?.({ rowId, markType, method, body });
        } catch (_) {}
      } else if (!skipReload) {
        try { await loadSheet(); } catch (_) {}
        throw err;
      } else {
        throw err;
      }
    }

    if (markType === 'not_in_store' && turningOn) {
      const row = (S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId)) || current;
      const label = rowLabel(row);
      S.appendNote?.(`Not in store: ${label}`);
    }
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
    const row = btn.getAttribute('data-capture') || btn.getAttribute('data-before') || btn.getAttribute('data-open-set') || '';
    const name = btn.getAttribute('data-name') || '';
    if (!dbkey) {
      alert('This row has no dbkey — cannot open Capture/View.');
      return;
    }
    const qs = new URLSearchParams({ dbkey, rowId: row, name });
    if (slot) qs.set('slot', slot);
    location.hash = `#/survey?${qs.toString()}`;
  }

  function openSurveyForRow(row, slot) {
    if (!row?.dbkey) return;
    const qs = new URLSearchParams({
      dbkey: row.dbkey,
      rowId: String(row.id || ''),
      name: row.catName || row.catId || '',
    });
    if (slot) qs.set('slot', slot);
    location.hash = `#/survey?${qs.toString()}`;
  }

  function nextWalkRow(afterId) {
    const rows = global.EodSession?.state?.sheet?.rows || [];
    if (global.EodCategoryCardStatus?.nextWalkRow) {
      return global.EodCategoryCardStatus.nextWalkRow(rows, afterId);
    }
    return rows.find((r) => !rowLooksComplete(r) && r.dbkey && String(r.id) !== String(afterId)) || null;
  }

  function showMarkUndo(rowId, markType, turningOn) {
    let bar = document.getElementById('eodMarkUndo');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'eodMarkUndo';
      bar.className = 'eod-mark-undo';
      document.body.appendChild(bar);
    }
    bar.hidden = false;
    bar.innerHTML = `<span>Marked</span> <button type="button" class="btn btn-secondary" id="eodMarkUndoBtn">Undo</button>`;
    const btn = document.getElementById('eodMarkUndoBtn');
    const t = setTimeout(() => { bar.hidden = true; }, 5000);
    if (btn) {
      btn.onclick = async () => {
        clearTimeout(t);
        bar.hidden = true;
        try {
          if (turningOn) await applyMark(rowId, markType);
          else await applyMark(rowId, markType, { forceOn: true });
        } catch (_) {}
        global.EodRouter?.render?.();
      };
    }
  }

  function filteredSheetRows(sheet, q, filters) {
    let rows = (sheet.rows || []).filter((row) => {
      if (global.EodCategoryCardStatus?.matchesSheetFilters
        && !global.EodCategoryCardStatus.matchesSheetFilters(row, filters)) {
        return false;
      }
      if (!q) return true;
      const locSearch = global.EodCategoryCardStatus
        ? global.EodCategoryCardStatus.siLocationLabel(row)
        : '';
      return `${row.catName || ''} ${row.dbkey || ''} ${row.dept || ''} ${row.shiftType || ''} ${locSearch} ${row.errorMessage || ''}`
        .toLowerCase().includes(q);
    });
    if (global.EodCategoryCardStatus?.sortWalkRows) {
      rows = global.EodCategoryCardStatus.sortWalkRows(rows);
    }
    return rows;
  }

  function renderRows(sheet, q, filters, selectedIds) {
    const selected = selectedIds instanceof Set ? selectedIds : new Set();
    const rows = filteredSheetRows(sheet, q, filters);
    if (!rows.length) return '<p class="muted">No sets match.</p>';
    return rows.map((row) => {
      const locLabel = global.EodCategoryCardStatus
        ? global.EodCategoryCardStatus.siLocationLabel(row)
        : '';
      const footage = row.footageDisplay || row.size || row.footage || '';
      const est = global.EodCategoryCardStatus?.formatEstHrs?.(row.estHrs) || '';
      const btn = (type, label) => {
        const on = markActive(row, type);
        return `<button type="button" class="btn btn-secondary${on ? ' on' : ''}" data-row="${row.id}" data-mark="${type}">${label}</button>`;
      };
      const errMsg = String(row.errorMessage || row.error_message || '').trim();
      const canOpen = !!row.dbkey;
      const metaBits = [
        row.dbkey ? `DBKEY ${row.dbkey}` : '',
        locLabel,
        footage ? String(footage) : '',
        est,
      ].filter(Boolean);
      const selectedOn = selected.has(String(row.id));
      return `<div class="ds-row ds-row-compact ${rowClass(row)}${selectedOn ? ' is-selected' : ''}" data-row-id="${row.id}"${canOpen ? ` data-open-set="${row.id}" data-dbkey="${esc(row.dbkey)}" data-name="${esc(row.catName || row.catId || '')}"` : ''}>
        <input type="checkbox" class="ds-row-check" data-select-row="${row.id}" ${selectedOn ? 'checked' : ''} aria-label="Select">
        <div class="ds-row-copy${canOpen ? ' ds-row-open' : ''}">
          <strong class="ds-row-title">${esc(row.catName || row.catId || '—')}</strong>
          <div class="muted ds-row-meta">${esc(metaBits.join(' · '))}</div>
          ${errMsg ? `<div class="manifest-error-msg">${esc(errMsg)}</div>` : ''}
        </div>
        <div class="ds-actions">
          ${btn('not_in_store', 'NIS')}
          ${btn('not_in_si', 'NISI')}
          ${btn('backlog', 'Backlog')}
          ${btn('complete', 'Complete')}
          ${btn('out_of_scope', 'Out of Scope')}
        </div>
      </div>`;
    }).join('');
  }

  async function render(mount) {
    const S = global.EodSession;
    mount.innerHTML = `
      <div class="card heart">
        <div class="cat-head">
          <h1>Categories</h1>
          <div id="sheetSummary" class="sheet-summary muted">Loading…</div>
          <button type="button" class="btn btn-secondary" id="cartScanBtn">Scan</button>
          <button type="button" class="btn btn-secondary" id="syncProdSiBtn">Refresh</button>
        </div>
        <div class="ds-bulk" id="sheetBulk"></div>
        <div class="ds-filters" id="sheetFilters">
          <div class="ds-filter-row">
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="not_done">Not Done</button>
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="backlog">Backlog</button>
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="done">Done</button>
          </div>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Search sets</label>
          <input type="search" id="sheetSearch" placeholder="Category, DBKEY, aisle…">
        </div>
        <div class="ds-select-all-row">
          <input type="checkbox" class="ds-row-check" id="sheetSelectAll" aria-label="Select all visible">
        </div>
        <div id="sheetRows"></div>
      </div>`;

    const summary = document.getElementById('sheetSummary');
    const rowsEl = document.getElementById('sheetRows');
    const syncBtn = document.getElementById('syncProdSiBtn');
    const filters = { status: 'not_done' };
    const selectedIds = new Set();
    let pollTimer = null;
    if (rowsEl && typeof ResizeObserver === 'function' && !rowsEl._dsFitObs) {
      rowsEl._dsFitObs = new ResizeObserver(() => {
        try { global.EodFitText?.fitSheetCards?.(rowsEl); } catch (_) {}
      });
      rowsEl._dsFitObs.observe(rowsEl);
    }

    function paintFilterChips() {
      const host = document.getElementById('sheetFilters');
      if (!host) return;
      host.querySelectorAll('[data-filter="status"]').forEach((btn) => {
        btn.classList.toggle('on', filters.status === btn.getAttribute('data-value'));
      });
    }

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

    function paintBulkBar() {
      const bulk = document.getElementById('sheetBulk');
      if (!bulk) return;
      const n = selectedIds.size;
      if (!n) {
        bulk.classList.remove('is-on');
        bulk.innerHTML = '';
        return;
      }
      bulk.classList.add('is-on');
      bulk.innerHTML = `
        <div class="ds-bulk-count">${n} selected</div>
        <div class="ds-actions">
          <button type="button" class="btn btn-secondary" data-bulk-mark="not_in_store">NIS</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="not_in_si">NISI</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="backlog">Backlog</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="complete">Complete</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="out_of_scope">Out of Scope</button>
        </div>`;
      bulk.querySelectorAll('[data-bulk-mark]').forEach((btn) => {
        btn.onclick = () => runBulkMark(btn.getAttribute('data-bulk-mark'));
      });
    }

    function visibleRowIds() {
      const sheet = S.state.sheet;
      if (!sheet) return [];
      const q = (document.getElementById('sheetSearch')?.value || '').trim().toLowerCase();
      return filteredSheetRows(sheet, q, filters).map((r) => String(r.id));
    }

    function paintSelectAll() {
      const box = document.getElementById('sheetSelectAll');
      if (!box) return;
      const ids = visibleRowIds();
      const n = ids.filter((id) => selectedIds.has(id)).length;
      box.disabled = !ids.length;
      box.indeterminate = n > 0 && n < ids.length;
      box.checked = ids.length > 0 && n === ids.length;
    }

    function applyRowSelect(id, on) {
      if (on) selectedIds.add(id);
      else selectedIds.delete(id);
      rowsEl.querySelectorAll('[data-select-row]').forEach((box) => {
        if (String(box.getAttribute('data-select-row') || '') !== id) return;
        box.checked = on;
        box.closest('.ds-row')?.classList.toggle('is-selected', on);
      });
    }

    async function markOneRow(rowId, markType, opts) {
      const current = (S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId));
      const turningOn = current && !markActive(current, markType);
      const turningOnNis = markType === 'not_in_store' && turningOn;
      let nisChoice = opts && Object.prototype.hasOwnProperty.call(opts, 'nisChoice')
        ? opts.nisChoice
        : null;
      if (turningOnNis && nisChoice == null && typeof global.askToReportNotInStore === 'function') {
        nisChoice = await global.askToReportNotInStore(current);
        if (!nisChoice || nisChoice === 'cancel') return false;
      }
      if (markType === 'out_of_scope' && turningOn && !opts?.skipOosConfirm) {
        const ok = await confirmOutOfScope(1);
        if (!ok) return false;
      }
      await applyMark(rowId, markType, turningOnNis
        ? { helpdeskSent: nisChoice === 'report', skipReload: !!opts?.skipReload }
        : { skipReload: !!opts?.skipReload });
      if (!opts?.skipUndo) showMarkUndo(rowId, markType, turningOn);
      if (turningOnNis && nisChoice === 'report' && typeof global.openHelpdeskForSheetRow === 'function') {
        await global.openHelpdeskForSheetRow(current);
      }
      return true;
    }

    async function runBulkMark(markType) {
      const ids = [...selectedIds];
      if (!ids.length) return;
      if (markType === 'out_of_scope') {
        const ok = await confirmOutOfScope(ids.length);
        if (!ok) return;
      }
      let nisChoice = null;
      if (markType === 'not_in_store' && typeof global.askToReportNotInStore === 'function') {
        nisChoice = await global.askToReportNotInStore({ catName: `${ids.length} sets` });
        if (!nisChoice || nisChoice === 'cancel') return;
      }
      for (const rowId of ids) {
        try {
          await markOneRow(rowId, markType, {
            skipReload: true,
            skipUndo: true,
            skipOosConfirm: true,
            nisChoice,
          });
        } catch (err) {
          console.warn('[signoff] bulk mark failed', rowId, err);
        }
      }
      selectedIds.clear();
      try { await loadSheet(); } catch (_) {}
      await paint();
      try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
      global.EodChrome?.refresh();
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
        document.body.classList.add('no-hosted-sheet');
        document.body.classList.remove('has-hosted-sheet');
        paintSelectAll();
        paintBulkBar();
        return;
      }
      document.body.classList.add('has-hosted-sheet');
      document.body.classList.remove('no-hosted-sheet');
      const s = sheet.summary || {};
      const visibleRows = (sheet.rows || []).filter((r) => !markActive(r, 'out_of_scope'));
      const open = visibleRows.filter(isOpenRow).length;
      summary.innerHTML = `<strong>${esc(sheet.fiscalWeek)}</strong> · Store ${esc(sheet.storeNumber)}`
        + (sheet.team ? ` · Team ${esc(sheet.team)}` : '')
        + ` · ${s.marked || 0}/${visibleRows.length} marked`
        + ` · <span class="${open ? 'pill warn' : 'pill ok'}">${open} open</span>`;
      const q = (document.getElementById('sheetSearch').value || '').trim().toLowerCase();
      paintFilterChips();
      const liveIds = new Set((sheet.rows || []).map((r) => String(r.id)));
      for (const id of [...selectedIds]) {
        if (!liveIds.has(id) || markActive(
          (sheet.rows || []).find((r) => String(r.id) === id),
          'out_of_scope'
        )) selectedIds.delete(id);
      }
      rowsEl.innerHTML = renderRows(sheet, q, filters, selectedIds);
      paintBulkBar();
      paintSelectAll();
      rowsEl.querySelectorAll('[data-select-row]').forEach((box) => {
        box.addEventListener('click', (ev) => ev.stopPropagation());
        box.addEventListener('change', () => {
          const id = String(box.getAttribute('data-select-row') || '');
          if (!id) return;
          if (box.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          const card = box.closest('.ds-row');
          if (card) card.classList.toggle('is-selected', box.checked);
          paintBulkBar();
          paintSelectAll();
        });
      });
      rowsEl.querySelectorAll('[data-mark]').forEach((btn) => {
        btn.onclick = async () => {
          const rowId = btn.getAttribute('data-row');
          const markType = btn.getAttribute('data-mark');
          btn.disabled = true;
          try {
            const ok = await markOneRow(rowId, markType);
            if (!ok) return;
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
      rowsEl.querySelectorAll('[data-open-set]').forEach((el) => {
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('button, input, .ds-row-check')) return;
          openSetSurvey(el);
        });
      });
      requestAnimationFrame(() => {
        try { global.EodFitText?.fitSheetCards?.(rowsEl); } catch (_) {}
      });
    }

    document.getElementById('cartScanBtn')?.addEventListener('click', () => {
      global.EodCartLocate?.openScanner?.();
    });
    void global.EodCartLocate?.warmIndex?.();
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
    document.getElementById('sheetSelectAll')?.addEventListener('click', (ev) => ev.stopPropagation());
    document.getElementById('sheetSelectAll')?.addEventListener('change', () => {
      const box = document.getElementById('sheetSelectAll');
      if (!box) return;
      const ids = visibleRowIds();
      const on = !!box.checked;
      ids.forEach((id) => applyRowSelect(id, on));
      paintBulkBar();
      paintSelectAll();
    });
    document.getElementById('sheetFilters')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-filter="status"]');
      if (!btn) return;
      const value = btn.getAttribute('data-value') || 'all';
      filters.status = filters.status === value ? 'all' : value;
      paint();
    });

    await paint();
    void (async () => {
      try {
        await syncProdSi();
        if (global.EodRouter?.current && global.EodRouter.current !== 'signoff') return;
        await paint();
        try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
        global.EodChrome?.refresh();
      } catch (err) {
        console.warn('[signoff] initial sync', err.message || err);
      }
    })();
    startPoll();
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
    nextWalkRow,
    openSurveyForRow,
    syncProdSi,
  };
  global.EodRouter.register('signoff', render);
})(typeof window !== 'undefined' ? window : globalThis);
