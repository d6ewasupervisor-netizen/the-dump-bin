/* EOD Dump Bin materials browser — mirrors /dump-bin/ week browsing inside an overlay. */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api';
  const MAX_COPIES = 5;
  const PRINT_COOLDOWN_MS = 2 * 60 * 1000;

  let weeks = [];
  let currentWeekIdx = 0;
  let currentPrefix = '';
  let lastListData = { folders: [], files: [] };
  /** @type {Map<string, {key?:string, name:string, size:number, t?:string, copies:number, contentBase64?:string, pages?:number[]}>} */
  const selection = new Map();
  let wired = false;
  let printBusy = false;
  let emailBusy = false;
  let pdfjsReady = null;
  const printCcRecipients = new Map();
  let printCcTimer = null;

  function authFetch(url, init) {
    if (typeof window.authFetch === 'function') return window.authFetch(url, init);
    const opts = typeof window.applyEodVersionHeader === 'function'
      ? window.applyEodVersionHeader(init)
      : init;
    if (window.dumpBinAuthFetch) return window.dumpBinAuthFetch(url, opts);
    return fetch(url, opts);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function formatSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }

  function fileIcon(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return '📄';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
    if (['doc', 'docx'].includes(ext)) return '📝';
    return '📎';
  }

  function isPdfName(name) {
    return /\.pdf$/i.test(String(name || ''));
  }

  function clampCopies(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return 1;
    return Math.min(MAX_COPIES, Math.max(1, v));
  }

  function downloadUrlForFile(f) {
    let q = `key=${encodeURIComponent(f.key)}`;
    if (f.t) q += `&t=${encodeURIComponent(f.t)}`;
    return `${API}/download?${q}`;
  }

  async function resolveDownloadUrl(f) {
    if (f.contentBase64) {
      return `data:application/pdf;base64,${f.contentBase64}`;
    }
    if (f.t) return downloadUrlForFile(f);
    const res = await authFetch(`${API}/download-token?key=${encodeURIComponent(f.key)}`);
    if (!res.ok) throw new Error(`Could not mint download token (${res.status})`);
    const data = await res.json();
    if (!data.t) throw new Error('No download token');
    return `${API}/download?key=${encodeURIComponent(f.key)}&t=${encodeURIComponent(data.t)}`;
  }

  function getStoreNumber() {
    const raw = (document.getElementById('storeNumber')?.value || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    const n = Number(digits);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  }

  function toast(msg, kind) {
    const el = document.getElementById('matToast');
    if (!el) {
      if (typeof window.showAlert === 'function') window.showAlert(kind === 'error' ? 'Error' : 'Notice', msg);
      return;
    }
    el.textContent = msg;
    el.dataset.kind = kind || 'info';
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 4200);
  }

  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js'));
      document.head.appendChild(script);
    });
    return pdfjsReady;
  }

  async function loadWeeks() {
    const browser = document.getElementById('matBrowser');
    if (browser) browser.innerHTML = '<div class="mat-empty">Loading weeks…</div>';
    const res = await authFetch(`${API}/weeks`);
    if (!res.ok) throw new Error(`Could not load weeks (HTTP ${res.status})`);
    const data = await res.json();
    weeks = data.weeks || [];
    if (!weeks.length) {
      if (browser) browser.innerHTML = '<div class="mat-empty">No weeks available.</div>';
      return;
    }
    const today = new Date();
    let idx = weeks.findIndex((w) => new Date(w.start) <= today && today <= new Date(w.end));
    if (idx === -1) {
      idx = weeks.findIndex((w) => new Date(w.start) > today);
      if (idx === -1) idx = weeks.length - 1;
    }
    currentWeekIdx = idx;
    renderWeekDial();
    await openWeek(weeks[currentWeekIdx]);
  }

  function getDialPillMetrics() {
    const pillW = weeks.length > 100 ? 60 : 66;
    const gap = 8;
    return { pillW, gap, pillStep: pillW + gap };
  }

  function layoutWeekDial() {
    const track = document.getElementById('matWeekDialTrack');
    if (!track || !weeks.length) return;
    const { pillStep } = getDialPillMetrics();
    const current = currentWeekIdx;
    const offset = -(current * pillStep + pillStep / 2 - 4);
    track.style.transform = `translate(${offset}px, -50%)`;
    track.querySelectorAll('.mat-week-pill').forEach((p) => {
      const idx = parseInt(p.dataset.idx, 10);
      const dist = idx - current;
      const absD = Math.abs(dist);
      const scale = Math.max(0.55, 1 - absD * 0.07);
      const opacity = Math.max(0, 1 - absD * 0.16);
      p.style.transform = `scale(${scale})`;
      p.style.opacity = String(opacity);
      p.classList.toggle('is-current', idx === current);
      p.style.pointerEvents = absD <= 4 ? '' : 'none';
    });
    const prevBtn = document.getElementById('matPrevWeek');
    const nextBtn = document.getElementById('matNextWeek');
    if (prevBtn) prevBtn.disabled = currentWeekIdx === 0;
    if (nextBtn) nextBtn.disabled = currentWeekIdx === weeks.length - 1;
  }

  function renderWeekDial() {
    const track = document.getElementById('matWeekDialTrack');
    if (!track) return;
    const { pillW } = getDialPillMetrics();
    track.style.setProperty('--mat-pill-w', `${pillW}px`);
    track.innerHTML = weeks.map((w, i) => {
      const startFmt = new Date(w.start).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      return `<button type="button" class="mat-week-pill" data-idx="${i}">
        <span class="mat-week-pill__main">${escapeHtml(w.short)}</span>
        <span class="mat-week-pill__sub">${escapeHtml(startFmt)}</span>
      </button>`;
    }).join('');
    layoutWeekDial();
  }

  async function openWeek(week) {
    await navigate(week.prefix);
  }

  async function navigate(prefix) {
    currentPrefix = prefix;
    const browser = document.getElementById('matBrowser');
    if (browser) browser.innerHTML = '<div class="mat-empty">Loading…</div>';
    const res = await authFetch(`${API}/list?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const data = await res.json();
    lastListData = data;
    renderBreadcrumb(prefix);
    renderBrowser(data);
  }

  function renderBreadcrumb(prefix) {
    const bc = document.getElementById('matBreadcrumb');
    if (!bc) return;
    const parts = prefix.split('/').filter(Boolean);
    const crumbs = [];
    let accum = '';
    parts.forEach((p, i) => {
      accum += `${p}/`;
      const isLast = i === parts.length - 1;
      if (isLast) crumbs.push(`<span>${escapeHtml(p)}</span>`);
      else crumbs.push(`<a href="#" data-prefix="${escapeAttr(accum)}">${escapeHtml(p)}</a>`);
    });
    bc.innerHTML = crumbs.join(' <span class="sep">/</span> ');
    bc.querySelectorAll('a[data-prefix]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(a.dataset.prefix).catch((err) => toast(err.message, 'error'));
      });
    });
  }

  function renderBrowser(data) {
    const browser = document.getElementById('matBrowser');
    if (!browser) return;
    const { folders = [], files = [] } = data;
    if (!folders.length && !files.length) {
      browser.innerHTML = '<div class="mat-empty">This folder is empty.</div>';
      return;
    }
    let html = '';
    if (folders.length) {
      html += '<div class="mat-section"><div class="mat-section__header">Folders</div>';
      html += folders.map((f) => `
        <button type="button" class="mat-item mat-item--folder" data-prefix="${escapeAttr(f.prefix)}">
          <span class="mat-item__icon">📁</span>
          <span class="mat-item__name">${escapeHtml(f.name)}</span>
        </button>`).join('');
      html += '</div>';
    }
    if (files.length) {
      const allSelected = files.every((f) => selection.has(f.key));
      html += '<div class="mat-section"><div class="mat-section__header">Files</div>';
      html += `<div class="mat-select-all">
        <input type="checkbox" id="matSelectAllFiles" ${allSelected ? 'checked' : ''}>
        <label for="matSelectAllFiles">Select all in this folder</label>
      </div>`;
      html += files.map((f) => {
        const isSel = selection.has(f.key);
        return `<div class="mat-item${isSel ? ' is-selected' : ''}" data-key="${escapeAttr(f.key)}">
          <input type="checkbox" class="mat-item__cb" ${isSel ? 'checked' : ''} data-key="${escapeAttr(f.key)}">
          <span class="mat-item__icon">${fileIcon(f.name)}</span>
          <button type="button" class="mat-item__name" data-open-key="${escapeAttr(f.key)}">${escapeHtml(f.name)}</button>
          <span class="mat-item__meta">${formatSize(f.size)}</span>
        </div>`;
      }).join('');
      html += '</div>';
    }
    browser.innerHTML = html;

    browser.querySelectorAll('.mat-item--folder[data-prefix]').forEach((el) => {
      el.addEventListener('click', () => navigate(el.dataset.prefix).catch((err) => toast(err.message, 'error')));
    });
    browser.querySelectorAll('.mat-item__cb').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const key = cb.dataset.key;
        const fileObj = files.find((f) => f.key === key);
        if (cb.checked && fileObj) {
          const prev = selection.get(key);
          selection.set(key, {
            key,
            name: fileObj.name,
            size: fileObj.size,
            t: fileObj.t,
            copies: clampCopies(prev?.copies ?? 1),
          });
        } else {
          selection.delete(key);
        }
        cb.closest('.mat-item')?.classList.toggle('is-selected', cb.checked);
        updateSelectionBar();
        const selectAll = document.getElementById('matSelectAllFiles');
        if (selectAll) selectAll.checked = files.every((f) => selection.has(f.key));
      });
    });
    browser.querySelectorAll('[data-open-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fileObj = files.find((f) => f.key === btn.dataset.openKey);
        if (fileObj) openFileViewer(fileObj).catch((err) => toast(err.message, 'error'));
      });
    });
    const selectAll = document.getElementById('matSelectAllFiles');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        files.forEach((f) => {
          if (selectAll.checked) {
            if (!selection.has(f.key)) {
              selection.set(f.key, { key: f.key, name: f.name, size: f.size, t: f.t, copies: 1 });
            }
          } else {
            selection.delete(f.key);
          }
        });
        renderBrowser(data);
        updateSelectionBar();
      });
    }
  }

  function selectionBytes() {
    return Array.from(selection.values()).reduce(
      (s, f) => s + (Number(f.size) || 0) * clampCopies(f.copies),
      0
    );
  }

  function selectionPageEstimate() {
    let pages = 0;
    for (const f of selection.values()) {
      const copies = clampCopies(f.copies);
      if (Array.isArray(f.pages) && f.pages.length) pages += f.pages.length * copies;
      else pages += copies;
    }
    return pages;
  }

  function updateSelectionBar() {
    const bar = document.getElementById('matSelectionBar');
    const countEl = document.getElementById('matSelectionCount');
    const sizeEl = document.getElementById('matSelectionSize');
    if (!bar) return;
    const count = selection.size;
    const bytes = selectionBytes();
    const pages = selectionPageEstimate();
    bar.classList.toggle('show', count > 0);
    if (countEl) countEl.textContent = String(count);
    if (sizeEl) {
      sizeEl.textContent = count
        ? `· ${pages} page/copy${pages === 1 ? '' : 's'} · ${formatSize(bytes)}`
        : '';
    }
  }

  function putExtractInSelection(payload) {
    const pages = payload.pages || [];
    const id = payload.sourceKey
      ? `pages:${payload.sourceKey}:${pages.join(',')}`
      : `pages:${payload.name}:${pages.join(',')}`;
    selection.set(id, {
      name: payload.name,
      size: payload.size,
      copies: 1,
      contentBase64: payload.contentBase64,
      pages,
      sourceKey: payload.sourceKey || undefined,
    });
    updateSelectionBar();
    renderBrowser(lastListData);
    return id;
  }

  function renderSelectionList() {
    const list = document.getElementById('matSelectionList');
    if (!list) return;
    if (!selection.size) {
      list.innerHTML = '<p class="mat-muted">Nothing selected.</p>';
      return;
    }
    list.innerHTML = Array.from(selection.values()).map((f) => {
      const id = f.key || f.name;
      const pagesNote = f.pages?.length ? ` · pages ${f.pages.join(', ')}` : '';
      return `<div class="mat-sel-row" data-id="${escapeAttr(id)}">
        <div class="mat-sel-row__main">
          <div class="mat-sel-row__name">${escapeHtml(f.name)}${escapeHtml(pagesNote)}</div>
          <div class="mat-sel-row__meta">${formatSize(f.size)}</div>
        </div>
        <div class="mat-sel-row__copies">
          <button type="button" data-dec="${escapeAttr(id)}">−</button>
          <span>${clampCopies(f.copies)}</span>
          <button type="button" data-inc="${escapeAttr(id)}">+</button>
        </div>
        <button type="button" class="mat-sel-row__remove" data-rm="${escapeAttr(id)}">Remove</button>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-inc],[data-dec],[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.inc || btn.dataset.dec || btn.dataset.rm;
        const f = selection.get(id);
        if (!f) return;
        if (btn.dataset.rm != null) selection.delete(id);
        else if (btn.dataset.inc != null) f.copies = clampCopies((f.copies || 1) + 1);
        else f.copies = clampCopies((f.copies || 1) - 1);
        if (f && !btn.dataset.rm) selection.set(id, f);
        renderSelectionList();
        updateSelectionBar();
        renderBrowser(lastListData);
      });
    });
  }

  async function openFileViewer(fileObj) {
    if (!isPdfName(fileObj.name)) {
      const url = await resolveDownloadUrl(fileObj);
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (!window.MaterialsPdfViewer) {
      toast('Document viewer failed to load — refresh and try again', 'error');
      return;
    }
    await ensurePdfJs();
    const url = await resolveDownloadUrl(fileObj);
    await window.MaterialsPdfViewer.open({
      title: fileObj.name,
      fileName: fileObj.name,
      url,
      fileSize: Number(fileObj.size) || 0,
      sourceKey: fileObj.key,
      onToast: toast,
      getGlobalSelection: () => ({
        count: selection.size,
        bytes: selectionBytes(),
      }),
      onAddToSelection: async (payload) => {
        putExtractInSelection(payload);
        toast(`Added ${payload.pages.length} page(s) to selection`, 'success');
      },
      onShare: async (payload) => {
        putExtractInSelection(payload);
        window.MaterialsPdfViewer.close();
        openEmailModal();
      },
      onPrintAtStore: async (payload) => {
        putExtractInSelection(payload);
        window.MaterialsPdfViewer.close();
        printSelection();
      },
      onDownload: async (payload) => {
        const bin = atob(payload.contentBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = payload.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast(`Downloaded ${payload.name}`, 'success');
      },
    });
  }

  async function downloadSelection() {
    if (!selection.size) {
      toast('Select files or pages first', 'error');
      return;
    }
    let n = 0;
    for (const f of selection.values()) {
      try {
        let href;
        let name = f.name || 'download';
        if (f.contentBase64) {
          const bin = atob(f.contentBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        } else {
          href = await resolveDownloadUrl(f);
        }
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
        if (f.contentBase64) setTimeout(() => URL.revokeObjectURL(href), 4000);
        n += 1;
      } catch (err) {
        toast(err.message || `Could not download ${f.name}`, 'error');
      }
    }
    if (n) toast(`Started ${n} download(s)`, 'success');
  }

  async function printSelection() {
    if (!selection.size || printBusy) return;
    const storeNumber = getStoreNumber();
    if (!storeNumber) {
      toast('Enter your store # on the EOD form first', 'error');
      return;
    }
    printCcRecipients.clear();
    renderPrintCcChips();
    const hint = document.getElementById('matPrintStoreHint');
    if (hint) hint.textContent = `Fax to store #${storeNumber}`;
    const search = document.getElementById('matPrintCcSearch');
    if (search) search.value = '';
    document.getElementById('matPrintCcModal')?.classList.add('show');
  }

  function renderPrintCcChips() {
    const wrap = document.getElementById('matPrintCcChips');
    if (!wrap) return;
    wrap.innerHTML = [...printCcRecipients.values()].map((p) =>
      `<span style="display:inline-flex;gap:6px;align-items:center;background:#1e293b;border-radius:999px;padding:4px 10px;font-size:12px;">${escapeHtml(p.email)} <button type="button" data-rm="${escapeAttr(p.email)}" style="border:0;background:transparent;color:#94a3b8;cursor:pointer;">&times;</button></span>`
    ).join('');
    wrap.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        printCcRecipients.delete(btn.getAttribute('data-rm'));
        renderPrintCcChips();
      });
    });
  }

  async function confirmPrintSelection() {
    if (!selection.size || printBusy) return;
    const storeNumber = getStoreNumber();
    if (!storeNumber) {
      toast('Enter your store # on the EOD form first', 'error');
      return;
    }
    const last = Number(localStorage.getItem('eodMatLastPrint') || 0);
    if (last && Date.now() - last < PRINT_COOLDOWN_MS) {
      toast('A print job was just sent — wait a minute before sending again', 'error');
      return;
    }

    printBusy = true;
    const btn = document.getElementById('matPrintConfirmBtn');
    const barBtn = document.getElementById('matPrintBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    if (barBtn) { barBtn.disabled = true; barBtn.textContent = 'Sending…'; }
    try {
      const files = [];
      const attachments = [];
      for (const f of selection.values()) {
        if (f.contentBase64) {
          for (let i = 0; i < clampCopies(f.copies); i += 1) {
            attachments.push({
              filename: clampCopies(f.copies) > 1 ? f.name.replace(/(\.pdf)?$/i, ` (${i + 1}).pdf`) : f.name,
              content: f.contentBase64,
            });
          }
        } else if (f.key) {
          files.push({ key: f.key, copies: clampCopies(f.copies) });
        }
      }
      const res = await authFetch(`${API}/print-at-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          keys: files.map((f) => f.key),
          attachments,
          storeNumber,
          extraRecipients: [...printCcRecipients.keys()],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Print failed (${res.status})`);
      localStorage.setItem('eodMatLastPrint', String(Date.now()));
      selection.clear();
      updateSelectionBar();
      renderBrowser(lastListData);
      document.getElementById('matPrintCcModal')?.classList.remove('show');
      toast(`Sent to store #${storeNumber} fax — check customer service in a couple minutes`, 'success');
    } catch (err) {
      toast(err.message || 'Print failed', 'error');
    } finally {
      printBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Send fax'; }
      if (barBtn) { barBtn.disabled = false; barBtn.textContent = '🖨 Print at Store'; }
    }
  }

  async function loadTeamRecipients() {
    const box = document.getElementById('matEmailTeamList');
    if (!box) return;
    box.innerHTML = '<div class="mat-muted">Loading assigned people…</div>';

    const members = [];
    try {
      const team = typeof window.getEodTeamForMaterials === 'function'
        ? window.getEodTeamForMaterials()
        : null;
      if (team?.members?.length) {
        members.push(...team.members);
      } else if (team?.selectedShift?.visitId) {
        const resp = await authFetch(`${API.replace(/\/api$/, '')}/api/shifts/${encodeURIComponent(team.selectedShift.visitId)}/members`);
        if (resp.ok) {
          const data = await resp.json();
          members.push(...(Array.isArray(data) ? data : []));
        }
      } else if (window.smSelectedShift?.visitId) {
        const resp = await authFetch(`${API.replace(/\/api$/, '')}/api/shifts/${encodeURIComponent(window.smSelectedShift.visitId)}/members`);
        if (resp.ok) {
          const data = await resp.json();
          members.push(...(Array.isArray(data) ? data : []));
        }
      } else {
        // T0.4: never take visits[0] from a substring-matched SAS list.
        // Exact whole-number store match only; 0 or >1 exact visits → require shift pick.
        const store = getStoreNumber();
        const date = (document.getElementById('workDate')?.value || '').trim();
        const want = String(store || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        if (store && date && want) {
          const shiftsResp = await authFetch(`${API.replace(/\/api$/, '')}/api/shifts?store=${encodeURIComponent(store)}&date=${encodeURIComponent(date)}`);
          if (shiftsResp.ok) {
            const shiftsData = await shiftsResp.json();
            const visits = Array.isArray(shiftsData) ? shiftsData : (shiftsData.visits || shiftsData.shifts || []);
            const exact = visits.filter((v) => {
              const raw = v?.storeNumber ?? v?.store_number ?? v?.store?.number ?? v?.store?.store?.number ?? '';
              const got = String(raw).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
              return got && got === want;
            });
            if (exact.length === 1) {
              const visitId = exact[0]?.visitId || exact[0]?.id;
              if (visitId) {
                const resp = await authFetch(`${API.replace(/\/api$/, '')}/api/shifts/${encodeURIComponent(visitId)}/members`);
                if (resp.ok) {
                  const data = await resp.json();
                  members.push(...(Array.isArray(data) ? data : []));
                }
              }
            } else if (exact.length > 1) {
              box.innerHTML = '<div class="mat-muted">Multiple shifts match this store — select a shift on the EOD form first.</div>';
              return;
            } else {
              box.innerHTML = '<div class="mat-muted">No exact store match for team recipients. Select a shift on the EOD form.</div>';
              return;
            }
          }
        }
      }

      // Enrich missing emails from employees directory when possible.
      let employees = team?.employees || (Array.isArray(window.smEmployeesCache) ? window.smEmployeesCache : null);
      if (!employees) {
        try {
          const resp = await authFetch(`${API.replace(/\/api$/, '')}/api/employees`);
          if (resp.ok) {
            const data = await resp.json();
            employees = Array.isArray(data) ? data : (data.employees || []);
            window.smEmployeesCache = employees;
          }
        } catch (_) { /* ignore */ }
      }
      const byId = new Map((employees || []).map((e) => [String(e.employeeId), e]));

      const rows = members.map((m) => {
        const emp = byId.get(String(m.employeeId));
        const email = (m.email || emp?.email || '').trim();
        return {
          name: m.name || emp?.name || 'Team member',
          email,
          employeeId: m.employeeId,
        };
      });

      if (!rows.length) {
        box.innerHTML = '';
        return;
      }

      box.innerHTML = rows.filter((r) => r.email).map((r, i) => {
        return `<label class="mat-email-row">
          <input type="checkbox" class="mat-email-cb" value="${escapeAttr(r.email)}" data-idx="${i}">
          <span class="mat-email-row__name">${escapeHtml(r.name)}</span>
        </label>`;
      }).join('');
      return;
    } catch (_) {
      box.innerHTML = '';
    }
  }

  function openEmailModal() {
    if (!selection.size) {
      toast('Select files or pages first', 'error');
      return;
    }
    document.getElementById('matEmailModal')?.classList.add('show');
    loadTeamRecipients();
  }

  async function sendEmailSelection() {
    if (emailBusy || !selection.size) return;
    const manual = (document.getElementById('matEmailManual')?.value || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const checked = Array.from(document.querySelectorAll('.mat-email-cb:checked'))
      .map((cb) => cb.value.trim().toLowerCase())
      .filter(Boolean);
    const to = [...new Set([...checked, ...manual])];
    const phones = (document.getElementById('matSmsPhones')?.value || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!to.length && !phones.length) {
      toast('Add an email or phone number', 'error');
      return;
    }

    emailBusy = true;
    const btn = document.getElementById('matEmailSendBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }
    try {
      const keys = [];
      const attachments = [];
      for (const f of selection.values()) {
        if (f.contentBase64) {
          attachments.push({ filename: f.name, content: f.contentBase64 });
        } else if (f.key) {
          keys.push(f.key);
        }
      }
      const note = (document.getElementById('matEmailNote')?.value || '').trim();
      const messages = [];

      if (to.length) {
        const res = await authFetch('https://eod-api.the-dump-bin.com/api/eod/email-materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            keys,
            attachments,
            note,
            storeNumber: getStoreNumber(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Email failed (${res.status})`);
        messages.push(`Emailed ${data.fileCount || keys.length + attachments.length} file(s)`);
      }

      if (phones.length) {
        const res = await authFetch('https://eod-api.the-dump-bin.com/api/secure-share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phones,
            sendSms: true,
            sendEmail: false,
            keys,
            attachments,
            note,
            storeNumber: getStoreNumber(),
            source: 'eod-materials',
            requireDelivery: false,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Text failed (${res.status})`);
        if (data.channelsOk?.sms === false) {
          throw new Error(
            data.sms?.results?.find((r) => !r.ok)?.error ||
              'SMS delivery failed. If the recipient has not opted in, they must text JOIN to (509) 572-9212 first.'
          );
        }
        messages.push('Text sent (secure link, 7-day expiry)');
      }

      document.getElementById('matEmailModal')?.classList.remove('show');
      toast(messages.join(' · '), 'success');
    } catch (err) {
      toast(err.message || 'Share failed', 'error');
    } finally {
      emailBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    }
  }

  function wireOnce() {
    if (wired) return;
    wired = true;

    document.getElementById('matPrevWeek')?.addEventListener('click', async () => {
      if (currentWeekIdx > 0) {
        currentWeekIdx -= 1;
        layoutWeekDial();
        await openWeek(weeks[currentWeekIdx]);
      }
    });
    document.getElementById('matNextWeek')?.addEventListener('click', async () => {
      if (currentWeekIdx < weeks.length - 1) {
        currentWeekIdx += 1;
        layoutWeekDial();
        await openWeek(weeks[currentWeekIdx]);
      }
    });
    document.getElementById('matWeekDialTrack')?.addEventListener('click', async (e) => {
      const pill = e.target.closest('.mat-week-pill');
      if (!pill) return;
      const idx = Number(pill.dataset.idx);
      if (Number.isNaN(idx) || Math.abs(idx - currentWeekIdx) > 4 || idx === currentWeekIdx) return;
      currentWeekIdx = idx;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    });

    document.getElementById('matClearSelectionBtn')?.addEventListener('click', () => {
      selection.clear();
      updateSelectionBar();
      renderBrowser(lastListData);
    });
    document.getElementById('matViewSelectionBtn')?.addEventListener('click', () => {
      renderSelectionList();
      document.getElementById('matSelectionModal')?.classList.add('show');
    });
    document.getElementById('matPrintBtn')?.addEventListener('click', () => printSelection());
    document.getElementById('matPrintConfirmBtn')?.addEventListener('click', () => confirmPrintSelection());
    document.getElementById('matEmailBtn')?.addEventListener('click', () => openEmailModal());
    document.getElementById('matEmailSendBtn')?.addEventListener('click', () => sendEmailSelection());
    document.getElementById('matDownloadBtn')?.addEventListener('click', () => {
      downloadSelection().catch((err) => toast(err.message || 'Download failed', 'error'));
    });

    const ccSearch = document.getElementById('matPrintCcSearch');
    if (ccSearch) {
      ccSearch.addEventListener('input', () => {
        clearTimeout(printCcTimer);
        printCcTimer = setTimeout(async () => {
          const q = ccSearch.value.trim();
          const dd = document.getElementById('matPrintCcDropdown');
          if (!dd) return;
          if (!q) { dd.hidden = true; return; }
          try {
            const res = await authFetch(`${API}/print-at-store/cc-contacts?q=${encodeURIComponent(q)}&limit=20`);
            const data = await res.json().catch(() => ({}));
            const people = data.people || [];
            const manual = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) ? q.toLowerCase() : '';
            const rows = [];
            if (manual && !printCcRecipients.has(manual)) {
              rows.push({ email: manual, name: manual });
            }
            for (const p of people) {
              const email = String(p.email || '').trim().toLowerCase();
              if (!email || printCcRecipients.has(email)) continue;
              rows.push({ email, name: p.name || email });
            }
            if (!rows.length) {
              dd.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:12px;">Keep typing a full email to add anyone</div>';
              dd.hidden = false;
              return;
            }
            dd.innerHTML = rows.map((r) =>
              `<button type="button" data-email="${escapeAttr(r.email)}" data-name="${escapeAttr(r.name)}" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #1e293b;background:transparent;color:#e2e8f0;padding:10px 12px;cursor:pointer;">${escapeHtml(r.name)}</button>`
            ).join('');
            dd.hidden = false;
            dd.querySelectorAll('[data-email]').forEach((btn) => {
              btn.addEventListener('click', () => {
                printCcRecipients.set(btn.dataset.email, { email: btn.dataset.email, name: btn.dataset.name });
                renderPrintCcChips();
                ccSearch.value = '';
                dd.hidden = true;
              });
            });
          } catch (_) {
            dd.hidden = true;
          }
        }, 220);
      });
    }

    document.querySelectorAll('[data-mat-close]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-mat-close');
        if (id) document.getElementById(id)?.classList.remove('show');
      });
    });
  }

  async function open() {
    wireOnce();
    const overlay = document.getElementById('materialsBrowserOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    try {
      await loadWeeks();
    } catch (err) {
      const browser = document.getElementById('matBrowser');
      if (browser) browser.innerHTML = `<div class="mat-empty">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function close() {
    document.getElementById('materialsBrowserOverlay')?.classList.remove('show');
    document.getElementById('matEmailModal')?.classList.remove('show');
    document.getElementById('matPrintCcModal')?.classList.remove('show');
    document.getElementById('matSelectionModal')?.classList.remove('show');
    if (window.MaterialsPdfViewer?.isOpen?.()) window.MaterialsPdfViewer.close();
    document.body.style.overflow = '';
  }

  window.EodMaterialsBrowser = { open, close };
})();
