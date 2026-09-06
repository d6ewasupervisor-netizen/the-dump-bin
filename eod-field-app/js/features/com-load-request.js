(function (global) {
  const API = 'https://eod-api.the-dump-bin.com/api/com-load';

  function esc(s) {
    return global.EodApi?.escapeHtml?.(s) ?? String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dayHeaders() {
    return global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
  }

  async function authFetch(url, opts) {
    const fn = global.authFetch || fetch;
    return fn(url, opts);
  }

  function sessionCtx() {
    const S = global.EodSession?.state || {};
    return {
      storeNumber: String(S.storeNumber || S.store || '').replace(/^0+/, ''),
      visitDate: S.workDate || S.visitDate || S.date || '',
      fiscalWeek: S.fiscalWeek || S.week || '',
      leadEmail: S.leadEmail || S.profileEmail || S.userEmail || '',
      leadName: S.leadName || S.profileName || S.userName || '',
    };
  }

  function rowToPayload(row, source) {
    const ctx = sessionCtx();
    return {
      sheetRowId: row.id,
      dbkey: row.dbkey,
      category: row.catId,
      catId: row.catId,
      pogName: row.catName,
      catName: row.catName,
      mappedSize: row.footageDisplay || row.size || 1,
      size: row.size,
      scheduledHours: row.estHrs != null && Number(row.estHrs) > 0 ? row.estHrs : 1,
      estHrs: row.estHrs,
      week: row.week || ctx.fiscalWeek,
      fiscalWeek: row.week || ctx.fiscalWeek,
      pog: row.pog,
      shiftType: row.shiftType,
      setType: row.shiftType || 'NII',
      dept: row.dept,
      department: row.dept,
      pageBucket: row.pageBucket,
      source: source || 'sheet',
    };
  }

  async function submitRows(rows, source) {
    const ctx = sessionCtx();
    if (!ctx.storeNumber) throw new Error('Confirm store/day first');
    const payload = {
      storeNumber: ctx.storeNumber,
      visitDate: ctx.visitDate,
      fiscalWeek: ctx.fiscalWeek || undefined,
      leadEmail: ctx.leadEmail,
      leadName: ctx.leadName,
      rows: rows.map((r) => rowToPayload(r, source)),
    };
    const res = await authFetch(`${API}/requests`, {
      method: 'POST',
      headers: dayHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'COM load submit failed');
    return data;
  }

  async function submitManual(fields) {
    const ctx = sessionCtx();
    const body = {
      storeNumber: ctx.storeNumber,
      visitDate: ctx.visitDate,
      fiscalWeek: fields.fiscalWeek || ctx.fiscalWeek,
      leadEmail: ctx.leadEmail,
      leadName: ctx.leadName,
      rows: [{
        category: Number(fields.category),
        pogName: fields.pogName,
        mappedSize: Number(fields.mappedSize) || 1,
        scheduledHours: Number(fields.scheduledHours) || 1,
        department: fields.department || '',
        setType: fields.setType || 'NII',
        loadType: fields.loadType || undefined,
        fiscalWeek: fields.fiscalWeek || ctx.fiscalWeek,
        pog: fields.pogId || '',
        source: 'manual',
      }],
    };
    const res = await authFetch(`${API}/requests`, {
      method: 'POST',
      headers: dayHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'COM load submit failed');
    return data;
  }

  async function fetchSuggestions() {
    const ctx = sessionCtx();
    if (!ctx.storeNumber) return [];
    const q = new URLSearchParams({
      store: ctx.storeNumber,
      date: ctx.visitDate || '',
      week: ctx.fiscalWeek || '',
    });
    const res = await authFetch(`${API}/suggest?${q}`, { headers: dayHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) return [];
    return data.suggestions || [];
  }

  function closeModal() {
    document.getElementById('comLoadModal')?.remove();
  }

  function showToast(msg) {
    let bar = document.getElementById('comLoadToast');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'comLoadToast';
      bar.className = 'com-load-toast';
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
    bar.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { bar.hidden = true; }, 4000);
  }

  function openManualModal(prefill) {
    closeModal();
    const ctx = sessionCtx();
    const p = prefill && typeof prefill === 'object' ? prefill : {};
    const modal = document.createElement('div');
    modal.id = 'comLoadModal';
    modal.className = 'com-load-modal';
    modal.innerHTML = `
      <div class="com-load-sheet" role="dialog" aria-label="COM Load">
        <h2>COM Load</h2>
        <label>Category #<input id="comCat" inputmode="numeric" value="${esc(p.category || '')}" required></label>
        <label>POG / name<input id="comName" value="${esc(p.pogName || '')}" required></label>
        <label>Department<input id="comDept" placeholder="GROCERY" value="${esc(p.department || '')}"></label>
        <label>Footage<input id="comSize" inputmode="decimal" value="${esc(p.mappedSize != null ? p.mappedSize : '1')}"></label>
        <label>Est hours<input id="comHrs" inputmode="decimal" value="${esc(p.scheduledHours != null ? p.scheduledHours : '1')}"></label>
        <label>Set type<input id="comSet" value="${esc(p.setType || 'NII')}"></label>
        <label>Fiscal week<input id="comWeek" value="${esc(p.fiscalWeek || ctx.fiscalWeek || '')}"></label>
        <label>Load type
          <select id="comType">
            <option value="">Auto</option>
            <option>ISE</option>
            <option>CUT-IN</option>
            <option>DIV</option>
            <option>BLITZ</option>
          </select>
        </label>
        <label>POGID / DBKEY (optional)<input id="comPog" value="${esc(p.pogId || p.dbkey || '')}"></label>
        <div class="com-load-actions">
          <button type="button" class="btn btn-secondary" id="comCancel">Cancel</button>
          <button type="button" class="btn" id="comSubmit">Queue</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    if (p.loadType) {
      const sel = modal.querySelector('#comType');
      if (sel) sel.value = p.loadType;
    }
    modal.querySelector('#comCancel').onclick = closeModal;
    modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(); });
    modal.querySelector('#comSubmit').onclick = async () => {
      const btn = modal.querySelector('#comSubmit');
      btn.disabled = true;
      try {
        const data = await submitManual({
          category: modal.querySelector('#comCat').value,
          pogName: modal.querySelector('#comName').value,
          department: modal.querySelector('#comDept').value,
          mappedSize: modal.querySelector('#comSize').value,
          scheduledHours: modal.querySelector('#comHrs').value,
          setType: modal.querySelector('#comSet').value,
          fiscalWeek: modal.querySelector('#comWeek').value,
          loadType: modal.querySelector('#comType').value || undefined,
          pogId: modal.querySelector('#comPog').value,
        });
        closeModal();
        showToast(data.queueLabel || 'Queued');
      } catch (err) {
        showToast(err.message || String(err));
        btn.disabled = false;
      }
    };
    const focusId = p.category ? 'comName' : 'comCat';
    setTimeout(() => modal.querySelector(`#${focusId}`)?.focus?.(), 50);
  }

  async function requestSelected(rows) {
    if (!rows.length) return;
    const ok = confirm(`Queue ${rows.length} set(s) for COM load?`);
    if (!ok) return;
    try {
      const data = await submitRows(rows, 'sheet');
      showToast(data.queueLabel || 'Queued');
    } catch (err) {
      showToast(err.message || String(err));
    }
  }

  async function selectSuggested(selectedIds, sheetRows) {
    const suggestions = await fetchSuggestions();
    if (!suggestions.length) {
      showToast('No on-manifest / not-on-PROD sets');
      return 0;
    }
    const byId = new Map((sheetRows || []).map((r) => [Number(r.id), r]));
    let n = 0;
    for (const s of suggestions) {
      const id = String(s.sheetRowId);
      if (byId.has(Number(id))) {
        selectedIds.add(id);
        n += 1;
      }
    }
    showToast(n ? `Selected ${n} suggested` : 'Suggested sets not on this sheet');
    return n;
  }

  function suggestIds(sheetRows, suggestions) {
    const set = new Set((suggestions || []).map((s) => String(s.sheetRowId)));
    return (sheetRows || []).filter((r) => set.has(String(r.id)));
  }

  global.EodComLoadRequest = {
    openManualModal,
    requestSelected,
    selectSuggested,
    fetchSuggestions,
    suggestIds,
    showToast,
    submitRows,
  };
})(typeof window !== 'undefined' ? window : globalThis);
