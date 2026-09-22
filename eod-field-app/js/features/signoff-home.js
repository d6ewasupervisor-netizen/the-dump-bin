/* Digital signoff — hard heart of the day. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function bothLiveComplete(row) {
    const Status = global.EodCategoryCardStatus;
    if (Status?.prodPhotosReady && Status?.siPhotosReady) {
      return Status.prodPhotosReady(row) && Status.siPhotosReady(row);
    }
    const live = row?.live;
    if (!live) return false;
    return Number(live.prodBeforeCount) > 0
      && Number(live.prodAfterCount) > 0
      && (Number(live.siPhotoCount || live.photoCount) > 0);
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
    if (type === 'not_executable') return !!m.notExecutable;
    return m.type === type;
  }

  function rowLooksComplete(row) {
    if (global.EodCategoryCardStatus?.sheetRowDone) {
      return global.EodCategoryCardStatus.sheetRowDone(row);
    }
    return markActive(row, 'complete')
      || markActive(row, 'not_in_store')
      || markActive(row, 'out_of_scope')
      || markActive(row, 'not_executable')
      || bothLiveComplete(row);
  }

  function syncStatusPills(row) {
    const live = row?.live;
    const pills = [];
    if (live) {
      const Status = global.EodCategoryCardStatus;
      if (Status?.prodStatusPillHtml) {
        const prodPill = Status.prodStatusPillHtml(Status.prodPhotoState(row));
        if (prodPill) pills.push(prodPill);
      } else if (live.prodComplete || String(live.prodStatus || '').toLowerCase() === 'done') {
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
        if (by && by !== 'prod-si-sync' && by !== 'nuke-reports') {
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
    if (markActive(row, 'not_executable')) c.push('marked-ne');
    if (markActive(row, 'out_of_scope')) c.push('marked-oos');
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
    const resp = await global.authFetch(`${API}/sheet?${qs}`, { skipBusy: true });
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
    return sheet;
  }

  let syncPromise = null;
  /* Module scope on purpose: render() runs fresh every time the user comes
     back to Categories, so a function-scoped handle stacked one more 45s
     poller per visit. */
  let pollTimer = null;

  /* The prompt lives in the lazily loaded helpdesk bundle. Without this the
     typeof guard at the call sites is false and the choice is skipped in
     silence. */
  async function nisReportChoice(subject) {
    try { await global.EodRouteBundles?.ensure?.('helpdesk'); } catch (_) {}
    if (typeof global.askToReportNotInStore !== 'function') return null;
    return global.askToReportNotInStore(subject);
  }

  function isCancelled(err) {
    return err?.code === 'cancelled' || err?.name === 'AbortError';
  }

  async function syncProdSi() {
    const S = global.EodSession;
    if (syncPromise) return syncPromise;
    const run = async () => {
      const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
      const shifts = Array.isArray(S.state.shifts) ? S.state.shifts : [];
      const visitIds = shifts.map((s) => s.visitId).filter(Boolean);
      const body = JSON.stringify({
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        visitId: S.state.selectedShift?.visitId || null,
        visitIds,
      });
      let resp = await global.authFetch(`${API}/sync-async`, {
        method: 'POST',
        headers,
        body,
        skipBusy: true,
      });
      if (resp.status === 404 || resp.status === 405) {
        resp = await global.authFetch(`${API}/sync`, {
          method: 'POST',
          headers,
          body,
          skipBusy: true,
        });
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok && resp.status !== 202) throw new Error(data.error || `Sync failed (${resp.status})`);
      if (data.sheet) S.patch({ sheet: data.sheet, sheetLoaded: true }, 'prod-si-sync');
      if (resp.status === 202) {
        for (let i = 0; i < 6; i += 1) {
          await new Promise((r) => setTimeout(r, 1200));
          try { await loadSheet(); } catch (_) { break; }
          if ((S.state.sheet?.rows || []).some((row) => row.live)) break;
        }
      } else if (!data.sheet) {
        S.patch({ sheetLoaded: false }, 'prod-si-sync');
        await loadSheet();
      }
      try { global.EodCoverNotes?.apply?.(S, 'prod-si-sync'); } catch (_) {}
      try { global.EodSetMediaPrefetch?.start(S.state.sheet); } catch (_) {}
      return data;
    };
    syncPromise = run();
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function runNuke() {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const resp = await global.authFetch(`${API}/nuke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        storeNumber: S.state.storeNumber,
        workDate: S.state.workDate,
        fiscalWeek: S.state.fiscalWeek || S.state.sheet?.fiscalWeek || null,
        visitId: S.state.selectedShift?.visitId || null,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Nuke failed (${resp.status})`);
    if (data.sheet) {
      S.patch({
        sheet: data.sheet,
        sheetLoaded: true,
        fiscalWeek: data.sheet.fiscalWeek || S.state.fiscalWeek || '',
      }, 'nuke');
      try { await global.EodGarden?.saveSheetSnapshot?.(data.sheet); } catch (_) {}
      try { global.EodDeptSignatures?.syncFromSheet?.(data.sheet); } catch (_) {}
      try { global.EodCoverNotes?.apply?.(S, 'nuke'); } catch (_) {}
    }
    return data;
  }

  function showNukeResults(data, { onRefresh } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'eod-alert-overlay show ds-nuke-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const marked = data.markedComplete || [];
      const open = data.variances || [];
      const ready = !!data.sendReady;
      const ms = data.ms != null ? `${Math.round(Number(data.ms) / 100) / 10}s` : '';
      const head = ready
        ? `All sets clear${ms ? ` · ${ms}` : ''}. Send EOD when the rest of the checklist is done.`
        : `Marked ${marked.length} complete${ms ? ` in ${ms}` : ''}. ${open.length} still need a call.`;
      const varHtml = open.map((v) => {
        const opts = (v.options || []).map((o) => (
          `<button type="button" class="btn btn-secondary" data-nuke-mark="${esc(o.id)}" data-row="${esc(v.rowId)}" title="${esc(o.hint || '')}">${esc(o.label)}</button>`
        )).join('');
        return `<div class="ds-nuke-row" data-nuke-row="${esc(v.rowId)}">
          <div class="ds-nuke-row-title"><strong>${esc(v.label)}</strong> <span class="muted">${esc(v.dbkey || '')}</span></div>
          <div class="muted ds-nuke-finding">${esc(v.finding || v.kind || '')}</div>
          <div class="ds-actions">${opts}</div>
        </div>`;
      }).join('');
      overlay.innerHTML = `
        <div class="eod-alert-dialog ds-nuke-dialog">
          <h2>Nuke</h2>
          <div class="eod-alert-body">${esc(head)}</div>
          ${open.length ? `<div class="ds-nuke-list">${varHtml}</div>` : ''}
          <div class="eod-alert-actions">
            ${ready ? '<button type="button" class="btn btn-primary" data-nuke-act="send">Go to Send</button>' : ''}
            <button type="button" class="btn btn-secondary" data-nuke-act="close">Close</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      try { global.EodA11y?.activate?.(overlay); } catch (_) {}

      const finish = (act) => {
        try { global.EodA11y?.deactivate?.(overlay); } catch (_) {}
        overlay.remove();
        resolve(act);
      };

      overlay.querySelector('[data-nuke-act="close"]')?.addEventListener('click', () => finish('close'));
      overlay.querySelector('[data-nuke-act="send"]')?.addEventListener('click', () => {
        finish('send');
        try { global.EodRouter?.go?.('send'); } catch (_) {}
      });
      overlay.querySelectorAll('[data-nuke-mark]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const rowId = btn.getAttribute('data-row');
          const markType = btn.getAttribute('data-nuke-mark');
          btn.disabled = true;
          try {
            if (markType === 'not_in_store') {
              const row = (global.EodSession.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId));
              const choice = await nisReportChoice(row || { catName: 'set' });
              if (choice && choice === 'cancel') {
                btn.disabled = false;
                return;
              }
              await applyMark(rowId, markType, { forceOn: true, helpdeskSent: choice === 'report' });
              if (choice === 'report' && typeof global.openHelpdeskForSheetRow === 'function') {
                await global.openHelpdeskForSheetRow(row);
              }
            } else if (markType === 'out_of_scope') {
              const ok = await confirmOutOfScope(1);
              if (!ok) {
                btn.disabled = false;
                return;
              }
              await applyMark(rowId, markType, { forceOn: true });
            } else {
              await applyMark(rowId, markType, { forceOn: true });
            }
            const host = overlay.querySelector(`[data-nuke-row="${rowId}"]`);
            host?.remove();
            if (!overlay.querySelector('[data-nuke-row]')) {
              const body = overlay.querySelector('.eod-alert-body');
              if (body) body.textContent = 'All remaining sets marked. Go to Send when ready.';
              const actions = overlay.querySelector('.eod-alert-actions');
              if (actions && !actions.querySelector('[data-nuke-act="send"]')) {
                const go = document.createElement('button');
                go.type = 'button';
                go.className = 'btn btn-primary';
                go.setAttribute('data-nuke-act', 'send');
                go.textContent = 'Go to Send';
                go.addEventListener('click', () => {
                  finish('send');
                  try { global.EodRouter?.go?.('send'); } catch (_) {}
                });
                actions.insertBefore(go, actions.firstChild);
              }
            }
            if (typeof onRefresh === 'function') await onRefresh();
            global.EodChrome?.refresh();
          } catch (err) {
            await global.EodAlerts?.alert?.('Mark failed', err.message || String(err));
            btn.disabled = false;
          }
        });
      });
    });
  }

  function canOpenSasCategoryAdmin() {
    return !!(global.EodRoles && global.EodRoles.hasRole && global.EodRoles.hasRole('supervisor', 'admin'));
  }

  function bindSasCategoryHold(root) {
    const Sas = global.SasCategoryAdmin;
    if (!root || !Sas) return;
    const holdMs = Sas.HOLD_MS || 650;
    root.querySelectorAll('.ds-row-catnum').forEach((el) => {
      let start = 0;
      let x = 0;
      let y = 0;
      let fired = false;
      const reset = () => { start = 0; };
      el.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        fired = false;
        delete el.dataset.sasHold;
        start = Date.now();
        x = e.clientX;
        y = e.clientY;
        try { global.EodRoles?.load?.(); } catch (_) {}
      });
      el.addEventListener('pointermove', (e) => {
        if (!start) return;
        if (Math.hypot(e.clientX - x, e.clientY - y) > 14) reset();
      });
      el.addEventListener('pointerup', (e) => {
        if (!start) return;
        const held = Date.now() - start;
        reset();
        if (held < holdMs || !canOpenSasCategoryAdmin()) return;
        const rowId = el.closest('[data-row-id]')?.getAttribute('data-row-id') || '';
        const row = (global.EodSession?.state?.sheet?.rows || []).find((r) => String(r.id) === rowId);
        const visitId = Sas.visitIdForRow(row, global.EodSession?.state?.selectedShift?.visitId);
        const url = Sas.categoryAdminUrl(visitId);
        if (!url) {
          try { global.EodConnections?.toast?.('No SAS visit on this shift', 'warn'); } catch (_) {}
          return;
        }
        fired = true;
        el.dataset.sasHold = '1';
        e.preventDefault();
        e.stopPropagation();
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) {
          try { global.EodConnections?.toast?.('Allow popups to open SAS', 'warn'); } catch (_) {}
        }
      });
      el.addEventListener('pointercancel', reset);
      el.addEventListener('contextmenu', (e) => {
        if (!canOpenSasCategoryAdmin()) return;
        e.preventDefault();
      });
      el.addEventListener('click', (e) => {
        if (!fired && el.dataset.sasHold !== '1') return;
        e.preventDefault();
        e.stopPropagation();
        fired = false;
        delete el.dataset.sasHold;
      }, true);
    });
  }

  function bindNukeLongPress(titleEl, run) {
    if (!titleEl || titleEl.dataset.nukeBound) return;
    titleEl.dataset.nukeBound = '1';
    titleEl.classList.add('ds-nuke-title');
    titleEl.title = 'Hold for Nuke';
    let timer = null;
    let fired = false;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    titleEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      fired = false;
      clear();
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        try { titleEl.releasePointerCapture?.(e.pointerId); } catch (_) {}
        run();
      }, 650);
    });
    titleEl.addEventListener('pointerup', clear);
    titleEl.addEventListener('pointercancel', clear);
    titleEl.addEventListener('pointerleave', clear);
    titleEl.addEventListener('click', (e) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    }, true);
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
      await global.EodAlerts?.alert?.('PDF', err.message || String(err));
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
      testMode: !!(global.EodTestMode?.isEnabled?.() || sessionStorage.getItem('eodTestMode') === '1'),
      forceLive: (typeof global.isEodForceLiveDelivery === 'function' && global.isEodForceLiveDelivery())
        || (typeof global.EodTestMode?.isForceLive === 'function' && global.EodTestMode.isForceLive())
        || undefined,
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
            ? `TEST fax queued — ${result.subject} → ${result.testFaxLabel || result.to}`
            : `Sent ${result.filename || 'PDF'} as ${result.subject}`;
        }
        if (global.EodConnections?.toast) {
          global.EodConnections.toast(result.testMode ? `TEST fax queued ${result.testFaxLabel || result.subject}` : `Fax queued ${result.subject}`, 'ok');
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
    if (global.EodSheetRowMatch?.findSheetRowForMeta) {
      return global.EodSheetRowMatch.findSheetRowForMeta(rows, meta);
    }
    const rowId = meta?.rowId != null ? String(meta.rowId) : '';
    const dbkey = String(meta?.dbkey || '').trim();
    if (rowId) {
      const hit = rows.find((r) => String(r.id) === rowId);
      if (hit) return hit;
    }
    if (dbkey) {
      const hit = rows.find((r) => String(r.dbkey || '').trim() === dbkey);
      if (hit) return hit;
    }
    return null;
  }

  async function confirmUndoOutOfScope() {
    const id = await (global.EodAlerts?.showDialog
      ? global.EodAlerts.showDialog({
        title: 'Undo Out of Scope',
        message: 'Put this set back on the sign-off sheet?',
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'ok', label: 'Undo Out of Scope', primary: true },
        ],
      })
      : Promise.resolve(window.confirm('Undo Out of Scope?') ? 'ok' : 'cancel'));
    return id === 'ok';
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
    if (markType === 'complete') return;
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
          visitId,
          visitIds: S.state.extraVisitIds || [],
        };

    const prevMarks = current ? JSON.parse(JSON.stringify(current.marks || current.mark || null)) : null;
    if (S.state.sheet && global.EodGarden?.applyOptimisticMark) {
      global.EodGarden.applyOptimisticMark(
        S.state.sheet,
        rowId,
        markType,
        markType === 'clear' ? false : turningOn
      );
      S.emit?.('sheet-mark');
      try { await global.EodGarden.saveSheetSnapshot(S.state.sheet); } catch (_) {}
      try { await sheetView?.paint?.(); } catch (_) {}
      sheetView?.scrollAfter?.(rowId);
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
      if (!resp.ok) {
        const hard = resp.status >= 400 && resp.status < 500;
        const err = new Error(data.error || `Mark failed (${resp.status})`);
        err.hard = hard;
        throw err;
      }
      void skipReload;
    } catch (err) {
      const msg = String(err && err.message || err || '');
      const network = /fetch|network|offline/i.test(msg)
        || (typeof navigator !== 'undefined' && navigator.onLine === false);
      const retryable = !err.hard && (network || /\(5\d\d\)/.test(msg));
      if (retryable) {
        try {
          await global.EodGarden?.enqueueMark?.({ rowId, markType, method, body });
        } catch (_) {}
      } else {
        if (current && prevMarks) {
          current.marks = prevMarks;
          current.mark = prevMarks;
        }
        try { await sheetView?.paint?.(); } catch (_) {}
        throw err;
      }
    }

    if (markType === 'not_in_store') {
      const row = (S.state.sheet?.rows || []).find((r) => String(r.id) === String(rowId)) || current;
      const label = rowLabel(row);
      if (turningOn) {
        S.appendNote?.(`Not in store: ${label}`);
      } else {
        S.removeNote?.(`Not in store: ${label}`);
        S.removeNote?.(`Help desk: Set not in store — ${label}`);
        const list = (S.state.notInStoreSelected || []).filter((n) => n !== label);
        S.patch({ notInStoreSelected: list }, 'helpdesk-nis');
      }
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

  function openSetSurvey(btn, slot, extras) {
    const dbkey = btn.getAttribute('data-dbkey') || '';
    const row = btn.getAttribute('data-capture-start')
      || btn.getAttribute('data-capture')
      || btn.getAttribute('data-before')
      || btn.getAttribute('data-open-set')
      || '';
    const name = btn.getAttribute('data-name') || '';
    if (!dbkey) {
      global.showAlert?.('Set unavailable', 'This row has no dbkey — cannot open Capture/View.');
      return;
    }
    const qs = new URLSearchParams({ dbkey, rowId: row, name });
    const useSlot = slot || btn.getAttribute('data-slot') || '';
    if (useSlot) qs.set('slot', useSlot);
    if (extras && extras.capture) qs.set('capture', '1');
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

  let sheetView = null;

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

  function renderRows(sheet, q, filters, selectedIds, suggestIds) {
    const selected = selectedIds instanceof Set ? selectedIds : new Set();
    const suggested = suggestIds instanceof Set ? suggestIds : new Set();
    const rows = filteredSheetRows(sheet, q, filters);
    if (!rows.length) return '<p class="muted">No sets match.</p>';
    return rows.map((row) => {
      const aisleLabel = global.EodCategoryCardStatus
        ? global.EodCategoryCardStatus.siAisleLabel(row)
        : '';
      const footage = row.footageDisplay || row.size || row.footage || '';
      const version = global.EodCategoryCardStatus?.versionLabel?.(row) || '';
      const est = global.EodCategoryCardStatus?.formatEstHrs?.(row.estHrs) || '';
      const btn = (type, label) => {
        const on = markActive(row, type);
        return `<button type="button" class="btn btn-secondary${on ? ' on' : ''}" data-row="${row.id}" data-mark="${type}">${label}</button>`;
      };
      const errMsg = String(row.errorMessage || row.error_message || '').trim();
      const canOpen = !!row.dbkey;
      const catNum = String(row.catId || '').trim();
      const metaBits = [
        row.dbkey ? `DB ${row.dbkey}` : '',
        aisleLabel,
        footage ? String(footage) : '',
        version,
        est,
        suggested.has(String(row.id)) ? 'COM suggest' : '',
      ].filter(Boolean);
      const selectedOn = selected.has(String(row.id));
      const localBefores = localBeforeCount(row);
      const Status = global.EodCategoryCardStatus;
      const liveLine = Status?.liveStatusLineHtml
        ? Status.liveStatusLineHtml(row, esc, localBefores)
        : '';
      const captureSlot = Status?.neededCaptureSlot
        ? Status.neededCaptureSlot(row, localBefores)
        : 'after';
      return `<div class="ds-row ds-row-compact ${rowClass(row)}${selectedOn ? ' is-selected' : ''}${suggested.has(String(row.id)) ? ' is-com-suggest' : ''}" data-row-id="${row.id}"${canOpen ? ` data-open-set="${row.id}" data-dbkey="${esc(row.dbkey)}" data-name="${esc(row.catName || row.catId || '')}"` : ''}>
        <input type="checkbox" class="ds-row-check" data-select-row="${row.id}" ${selectedOn ? 'checked' : ''} aria-label="Select">
        <div class="ds-row-copy${canOpen ? ' ds-row-open' : ''}">
          <strong class="ds-row-title">${esc(row.catName || row.catId || '—')}</strong>
          <div class="muted ds-row-meta">${metaBits.map((bit) => `<span>${esc(bit)}</span>`).join('')}</div>
          ${markActive(row, 'out_of_scope') ? '<div class="ds-row-live"><span class="pill">Out of Scope</span></div>' : ''}
          ${liveLine ? `<div class="ds-row-live">${liveLine}</div>` : ''}
          ${errMsg ? `<div class="manifest-error-msg">${esc(errMsg)}</div>` : ''}
        </div>
        ${catNum ? `<div class="ds-row-catnum" title="Category">${esc(catNum)}</div>` : ''}
        ${canOpen ? `<div class="ds-row-capture"><button type="button" class="btn btn-primary" data-capture-start="${row.id}" data-dbkey="${esc(row.dbkey)}" data-name="${esc(row.catName || row.catId || '')}" data-slot="${esc(captureSlot)}">Capture</button></div>` : ''}
        <div class="ds-actions">
          ${btn('not_in_store', 'Not in Store')}
          ${btn('not_in_si', 'Not in SI')}
          ${btn('backlog', 'Backlog')}
          ${btn('out_of_scope', 'Out of Scope')}
          ${btn('not_executable', 'Not Executable')}
        </div>
      </div>`;
    }).join('');
  }

  function destroyLeftoverCameras() {
    document.querySelectorAll('.vf-live-camera').forEach((el) => {
      const video = el.querySelector('video');
      try { video?.srcObject?.getTracks?.().forEach((t) => t.stop()); } catch (_) {}
      el.remove();
    });
  }

  async function render(mount) {
    destroyLeftoverCameras();
    const S = global.EodSession;
    mount.innerHTML = `
      <div class="card heart">
        <div class="cat-head">
          <h1 id="categoriesTitle">Categories</h1>
          <div id="sheetSummary" class="sheet-summary muted">Loading…</div>
          <button type="button" class="btn btn-secondary" id="syncProdSiBtn">Refresh</button>
        </div>
        <div class="ds-bulk" id="sheetBulk"></div>
        <div class="ds-filters" id="sheetFilters">
          <div class="ds-filter-row">
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="not_done">Not Started</button>
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="in_progress">In Progress</button>
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="backlog">Backlog</button>
            <button type="button" class="btn btn-secondary" data-filter="status" data-value="done">Done</button>
          </div>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Search sets</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="search" id="sheetSearch" placeholder="Category, DBKEY, aisle…" style="flex:1;min-width:0;">
            <button type="button" class="btn btn-secondary" id="sheetScanBtn" style="flex-shrink:0;">Scan UPC</button>
          </div>
        </div>
        <div class="ds-select-all-row">
          <input type="checkbox" class="ds-row-check" id="sheetSelectAll" aria-label="Select all visible">
        </div>
        <div id="sheetRows"></div>
      </div>`;

    const summary = document.getElementById('sheetSummary');
    const rowsEl = document.getElementById('sheetRows');
    const syncBtn = document.getElementById('syncProdSiBtn');
    const filters = { status: S.state.sheetFilter || 'not_done' };
    const selectedIds = new Set();
    let lastRowsHtml = '';
    let staleReason = '';
    let suggestIdSet = new Set();

    function paintFilterChips() {
      const host = document.getElementById('sheetFilters');
      if (!host) return;
      host.querySelectorAll('[data-filter="status"]').forEach((btn) => {
        btn.classList.toggle('on', filters.status === btn.getAttribute('data-value'));
      });
    }

    function startPoll() {
      if (pollTimer) clearInterval(pollTimer);
      const ms = global.EodStoreProdWarm?.SHEET_MS || 45_000;
      pollTimer = setInterval(async () => {
        if (global.EodRouter?.current !== 'signoff') return;
        try {
          await loadSheet();
          await paint();
          global.EodStoreProdWarm?.prefetchStatuses?.();
          global.EodChrome?.refresh();
        } catch (err) {
          console.warn('[signoff] poll sheet', err.message || err);
        }
      }, ms);
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
          <button type="button" class="btn" data-bulk-com="1">Request COM</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="not_in_store">Not in Store</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="not_in_si">Not in SI</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="backlog">Backlog</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="out_of_scope">Out of Scope</button>
          <button type="button" class="btn btn-secondary" data-bulk-mark="not_executable">Not Executable</button>
        </div>`;
      bulk.querySelectorAll('[data-bulk-mark]').forEach((btn) => {
        btn.onclick = () => runBulkMark(btn.getAttribute('data-bulk-mark'));
      });
      bulk.querySelector('[data-bulk-com]')?.addEventListener('click', async () => {
        const rows = (S.state.sheet?.rows || []).filter((r) => selectedIds.has(String(r.id)));
        await global.EodComLoadRequest?.requestSelected?.(rows);
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
      if (turningOnNis && nisChoice == null) {
        nisChoice = await nisReportChoice(current);
        if (nisChoice && nisChoice === 'cancel') return false;
      }
      if (markType === 'out_of_scope' && turningOn && !opts?.skipOosConfirm) {
        const ok = await confirmOutOfScope(1);
        if (!ok) return false;
      }
      if (markType === 'out_of_scope' && current && !turningOn) {
        const ok = await confirmUndoOutOfScope();
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
      if (markType === 'not_in_store') {
        nisChoice = await nisReportChoice({ catName: `${ids.length} sets` });
        if (nisChoice && nisChoice === 'cancel') return;
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

    /* offline:true renders whatever is already in state without asking the
       network, so the saved copy is on screen before the refresh starts. */
    async function paint(opts) {
      let sheet = S.state.sheet;
      const offline = !!(opts && opts.offline);
      if (offline && !sheet) return;
      if (!offline && !S.state.sheetLoaded) {
        try {
          sheet = await loadSheet();
          staleReason = '';
        } catch (err) {
          // Never blank a populated list because a refresh failed.
          sheet = S.state.sheet;
          if (!sheet) {
            summary.innerHTML = `<span style="color:#ef4444;">${esc(err.message)}</span>`
              + ' <button type="button" class="btn btn-secondary btn-sm" id="sheetLoadRetry">Retry</button>';
            summary.querySelector('#sheetLoadRetry')?.addEventListener('click', () => { void paint(); });
            rowsEl.innerHTML = '';
            lastRowsHtml = '';
            return;
          }
          staleReason = err.message || 'Could not refresh';
        }
      }
      if (!sheet) {
        summary.innerHTML = 'No hosted sheet for this store/week yet.';
        rowsEl.innerHTML = '';
        lastRowsHtml = '';
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
        + ` · <span class="${open ? 'pill warn' : 'pill ok'}">${open} open</span>`
        + (staleReason
          ? ` · <span class="pill warn">saved copy</span> <button type="button" class="btn btn-secondary btn-sm" id="sheetLoadRetry">Retry</button>`
          : '')
        + '<span id="sheetQueuedMarks"></span>';
      summary.querySelector('#sheetLoadRetry')?.addEventListener('click', () => {
        S.patch({ sheetLoaded: false }, 'sheet-retry');
        void paint();
      });
      // Marks taken offline are still waiting to reach the server. Say so.
      void (async () => {
        try {
          const n = await global.EodGarden?.queuedCount?.();
          const host = document.getElementById('sheetQueuedMarks');
          if (host) host.innerHTML = n ? ` · <span class="pill warn">${n} mark${n === 1 ? '' : 's'} not sent</span>` : '';
        } catch (_) {}
      })();
      const q = (document.getElementById('sheetSearch').value || '').trim().toLowerCase();
      paintFilterChips();
      const liveIds = new Set((sheet.rows || []).map((r) => String(r.id)));
      for (const id of [...selectedIds]) {
        if (!liveIds.has(id) || markActive(
          (sheet.rows || []).find((r) => String(r.id) === id),
          'out_of_scope'
        )) selectedIds.delete(id);
      }
      const html = renderRows(sheet, q, filters, selectedIds, suggestIdSet);
      paintBulkBar();
      paintSelectAll();
      if (html === lastRowsHtml) return;
      const pane = document.getElementById('appMount');
      const y = (pane && pane.scrollTop) || window.scrollY || document.documentElement.scrollTop || 0;
      lastRowsHtml = html;
      rowsEl.innerHTML = html;
      if (pane) pane.scrollTop = y;
      window.scrollTo(0, y);
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
            await global.EodAlerts?.alert?.('Update failed', err.message || String(err));
          } finally {
            btn.disabled = false;
          }
        };
      });
      rowsEl.querySelectorAll('[data-capture-start]').forEach((btn) => {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          openSetSurvey(btn, btn.getAttribute('data-slot'), { capture: true });
        };
      });
      bindSasCategoryHold(rowsEl);
      rowsEl.querySelectorAll('[data-open-set]').forEach((el) => {
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('button, input, .ds-row-check')) return;
          if (ev.target.closest('.ds-row-catnum')?.dataset.sasHold === '1') return;
          openSetSurvey(el);
        });
      });
      requestAnimationFrame(() => {
        try { global.EodFitText?.fitSheetCards?.(rowsEl); } catch (_) {}
      });
    }

    void global.EodCartLocate?.warmIndex?.();
    document.getElementById('syncProdSiBtn').onclick = async () => {
      syncBtn.disabled = true;
      try {
        await syncProdSi();
        await paint();
        try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
        global.EodChrome?.refresh();
      } catch (err) {
        if (!isCancelled(err)) await global.EodAlerts?.alert?.('Sync failed', err.message || String(err));
      } finally {
        syncBtn.disabled = false;
      }
    };
    bindNukeLongPress(document.getElementById('categoriesTitle'), async () => {
      const title = document.getElementById('categoriesTitle');
      if (title) title.classList.add('is-nuking');
      try {
        const data = await runNuke();
        await paint();
        global.EodChrome?.refresh();
        await showNukeResults(data, {
          onRefresh: async () => {
            try { await loadSheet(); } catch (_) {}
            await paint();
          },
        });
      } catch (err) {
        await global.EodAlerts?.alert?.('Nuke failed', err.message || String(err));
      } finally {
        title?.classList.remove('is-nuking');
      }
    });
    // Every keystroke rebuilt every row. Coalesce them.
    let searchTimer = null;
    document.getElementById('sheetSearch').oninput = () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void paint({ offline: true });
      }, 180);
    };
    document.getElementById('sheetScanBtn').onclick = async () => {
      try { await global.EodRouteBundles?.ensure?.('survey'); } catch (_) {}
      global.EodCartLocate?.openScanner?.();
    };
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
      S.patch({ sheetFilter: filters.status }, 'sheet-filter');
      paint();
    });

    sheetView = {
      paint,
      scrollAfter(rowId) {
        const next = nextWalkRow(rowId);
        if (!next) return;
        const el = document.querySelector(`[data-row-id="${next.id}"]`);
        try { el?.scrollIntoView?.({ block: 'nearest' }); } catch (_) {}
      },
    };
    /* Put the saved copy on screen before anything touches the network. The
       snapshot is the same rows the refresh is about to return, so the list
       is readable immediately instead of after a round trip. */
    try {
      if (!S.state.sheet && global.EodGarden?.loadSheetSnapshot) {
        const week = S.state.fiscalWeek || '';
        const snap = week
          ? await global.EodGarden.loadSheetSnapshot(S.state.storeNumber, week)
          : null;
        if (snap && Array.isArray(snap.rows)) {
          S.patch({ sheet: snap, fiscalWeek: snap.fiscalWeek || week }, 'sheet-garden');
        }
      }
      await paint({ offline: true });
    } catch (_) {}

    await paint();
    try { global.EodSetMediaPrefetch?.start(S.state.sheet); } catch (_) {}
    try { global.EodStoreProdWarm?.start?.(); } catch (_) {}
    void (async () => {
      try {
        await syncProdSi();
        if (global.EodRouter?.current && global.EodRouter.current !== 'signoff') return;
        await paint();
        try { global.EodDeptSignatures?.syncFromSheet?.(S.state.sheet); } catch (_) {}
        global.EodChrome?.refresh();
        try { global.EodSetMediaPrefetch?.start(S.state.sheet); } catch (_) {}
      } catch (err) {
        if (!isCancelled(err)) console.warn('[signoff] initial sync', err.message || err);
      }
    })();
    startPoll();
  }

  global.EodSignoffHome = {
    loadSheet,
    render,
    applyMark,
    markNotInStoreFromHelpdesk,
    openSignoffPdfPreview,
    printSignoffAtStore,
    openPrintAtStoreModal,
    nextWalkRow,
    openSurveyForRow,
    runNuke,
    showDoneTab() {
      const sess = global.EodSession;
      sess.patch({ sheetFilter: 'done' }, 'sheet-filter');
      global.EodRouter.go('signoff');
    },
    syncProdSi,
  };
  global.EodRouter.register('signoff', render);
})(typeof window !== 'undefined' ? window : globalThis);
