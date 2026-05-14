// ===== Dump Bin browser =====
import { STORES } from './stores.js';

const API = 'https://eod-api.the-dump-bin.com/api';

/**
 * Listings use `window.dumpBinAuth.fetch('/api/list')` (Bearer session).
 *
 * File downloads: programmatic fetch uses Bearer; anchor `href` and multi-tab
 * downloads use a short-lived `t` query param (HMAC JWT from list or
 * `/api/download-token`) because browsers cannot send custom headers on link
 * navigation.
 */
async function fetchPrintAtStoreApi(url, init) {
  init = init ? { ...init } : {};
  const headers = new Headers(init.headers || {});
  try {
    const tok = window.dumpBinAuth?.getSession?.();
    if (tok) headers.set('Authorization', `Bearer ${tok}`);
  } catch (_) { /* ignore */ }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && window.dumpBinAuth?.bounceToSignIn) {
    let body = '';
    try {
      body = await res.clone().text();
    } catch (_) { /* ignore */ }
    if (!/sas session|rebotics session/i.test(body)) {
      window.dumpBinAuth.bounceToSignIn(`401 from ${url}`);
    }
  }
  return res;
}

/** Absolute download URL; `t` is minted by `/api/list` or `/api/download-token`. */
function downloadUrlForFile(f) {
  let q = `key=${encodeURIComponent(f.key)}`;
  if (f.t) q += `&t=${encodeURIComponent(f.t)}`;
  return `${API}/download?${q}`;
}

/** When `t` is missing (stale selection), mint one via authenticated API. */
async function resolveDownloadUrl(f) {
  if (f.t) return downloadUrlForFile(f);
  const res = await window.dumpBinAuth.fetch(
    `/api/download-token?key=${encodeURIComponent(f.key)}`
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data.t) throw new Error('No download token in response');
  return `${API}/download?key=${encodeURIComponent(f.key)}&t=${encodeURIComponent(data.t)}`;
}

// A fax job has to sidle through several relays and a T.38 gateway before it
// reaches paper — impatient double-clicks clog that pipe and duplicate prints.
// We park the Send button for this long after a successful submission.
const PRINT_COOLDOWN_MS = 2 * 60 * 1000;
const PRINT_LAST_SEND_KEY = 'dumpBinLastPrintSend';

// State
let weeks = [];
let currentWeekIdx = 0;
let currentPrefix = '';
let userEmail = null;

// Selection: Map<key, { name, size, key, t? }> — `t` is download JWT when known
const selection = new Map();

// Store picker state
let selectedStore = null;

// Print modal state: 'picker' | 'confirm' | 'sending' | 'transit'
let printModalState = 'picker';
let cooldownTicker = null;

// --- Boot ---
document.addEventListener('DOMContentLoaded', async () => {
  wireDropdowns();
  wireWeekDial();
  wireWeekArrows();
  wireSelectionBar();
  wireModals();
  wirePrintModal();
  await loadIdentity();
  await loadWeeks();
});

async function loadIdentity() {
  try {
    const res = await window.dumpBinAuth.fetch('/api/whoami');
    if (!res.ok) {
      userEmail = null;
      return;
    }
    const data = await res.json();
    userEmail = data.email ?? null;
  } catch {
    userEmail = null;
  }
}

// --- Weeks ---
async function loadWeeks() {
  try {
    const res = await window.dumpBinAuth.fetch('/api/weeks');
    const data = await res.json();
    weeks = data.weeks || [];
    if (weeks.length === 0) {
      document.getElementById('browser').innerHTML =
        '<div class="db-empty">No weeks available.</div>';
      return;
    }
    const today = new Date();
    let idx = weeks.findIndex(w =>
      new Date(w.start) <= today && today <= new Date(w.end)
    );
    if (idx === -1) {
      idx = weeks.findIndex(w => new Date(w.start) > today);
      if (idx === -1) idx = weeks.length - 1;
    }
    currentWeekIdx = idx;
    renderWeekDial();
    await openWeek(weeks[currentWeekIdx]);
  } catch (err) {
    document.getElementById('browser').innerHTML =
      `<div class="db-empty">Error loading weeks: ${err.message}</div>`;
  }
}

function getDialPillMetrics() {
  const pillW = weeks.length > 100 ? 60 : 66;
  const gap = 8;
  return { pillW, gap, pillStep: pillW + gap };
}

function layoutWeekDial() {
  const track = document.getElementById('weekDialTrack');
  if (!track || weeks.length === 0) return;
  const { pillStep } = getDialPillMetrics();
  const current = currentWeekIdx;
  const offset = -(current * pillStep + pillStep / 2 - 4);
  track.style.transform = `translate(${offset}px, -50%)`;
  track.querySelectorAll('.db-week-dial-pill').forEach(p => {
    const idx = parseInt(p.dataset.idx, 10);
    const dist = idx - current;
    const absD = Math.abs(dist);
    const scale = Math.max(0.55, 1 - absD * 0.07);
    const opacity = Math.max(0, 1 - absD * 0.16);
    const rotY = Math.max(-72, Math.min(72, dist * 16));
    p.style.transform = `rotateY(${rotY}deg) scale(${scale})`;
    p.style.opacity = String(opacity);
    p.classList.toggle('db-week-dial-pill--current', idx === current);
    if (idx !== current) {
      p.classList.toggle('db-week-dial-pill--red', idx % 2 === 0);
      p.classList.toggle('db-week-dial-pill--dark', idx % 2 !== 0);
    } else {
      p.classList.remove('db-week-dial-pill--red', 'db-week-dial-pill--dark');
    }
    const jumpable = absD <= 4;
    p.style.pointerEvents = jumpable ? '' : 'none';
    p.style.cursor = jumpable ? 'pointer' : 'default';
  });
  const prevBtn = document.getElementById('prevWeek');
  const nextBtn = document.getElementById('nextWeek');
  if (prevBtn) prevBtn.disabled = currentWeekIdx === 0;
  if (nextBtn) nextBtn.disabled = currentWeekIdx === weeks.length - 1;
}

function renderWeekDial() {
  const track = document.getElementById('weekDialTrack');
  const prevBtn = document.getElementById('prevWeek');
  const nextBtn = document.getElementById('nextWeek');
  if (!track || !prevBtn || !nextBtn || weeks.length === 0) return;

  const { pillW } = getDialPillMetrics();
  track.style.setProperty('--db-dial-pill-w', `${pillW}px`);

  track.innerHTML = weeks.map((w, i) => {
    const startFmt = new Date(w.start).toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric',
    });
    const label = `${w.short} ${startFmt}`;
    return `
      <button type="button" class="db-week-dial-pill" data-idx="${i}" aria-label="${escapeAttr(label)}">
        <span class="db-week-dial-pill__main">${escapeHtml(w.short)}</span>
        <span class="db-week-dial-pill__sub">${escapeHtml(startFmt)}</span>
      </button>`;
  }).join('');

  layoutWeekDial();
}

function wireWeekDial() {
  const win = document.getElementById('weekDialWindow');
  const track = document.getElementById('weekDialTrack');
  if (!win || !track) return;

  track.addEventListener('click', async e => {
    const pill = e.target.closest('.db-week-dial-pill');
    if (!pill) return;
    const idx = Number(pill.dataset.idx);
    if (Number.isNaN(idx) || Math.abs(idx - currentWeekIdx) > 4) return;
    if (idx === currentWeekIdx) return;
    currentWeekIdx = idx;
    layoutWeekDial();
    await openWeek(weeks[currentWeekIdx]);
  });

  let swipeStartX = null;
  let swipePointerId = null;
  const SWIPE_MIN_PX = 40;

  win.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeStartX = e.clientX;
    swipePointerId = e.pointerId;
    try {
      win.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  });

  win.addEventListener('pointerup', async e => {
    if (swipePointerId !== e.pointerId || swipeStartX == null) return;
    const dx = e.clientX - swipeStartX;
    swipeStartX = null;
    swipePointerId = null;
    try {
      win.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }

    if (dx > SWIPE_MIN_PX && currentWeekIdx > 0) {
      currentWeekIdx--;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    } else if (dx < -SWIPE_MIN_PX && currentWeekIdx < weeks.length - 1) {
      currentWeekIdx++;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    }
  });

  win.addEventListener('pointercancel', e => {
    if (swipePointerId === e.pointerId) {
      swipeStartX = null;
      swipePointerId = null;
      try {
        win.releasePointerCapture(e.pointerId);
      } catch (_) { /* ignore */ }
    }
  });

  document.addEventListener('keydown', async e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = document.activeElement;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        (t.isContentEditable === true))
    ) {
      return;
    }
    e.preventDefault();
    if (e.key === 'ArrowLeft' && currentWeekIdx > 0) {
      currentWeekIdx--;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    } else if (e.key === 'ArrowRight' && currentWeekIdx < weeks.length - 1) {
      currentWeekIdx++;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    }
  });
}

function wireWeekArrows() {
  document.getElementById('prevWeek').addEventListener('click', async () => {
    if (currentWeekIdx > 0) {
      currentWeekIdx--;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    }
  });
  document.getElementById('nextWeek').addEventListener('click', async () => {
    if (currentWeekIdx < weeks.length - 1) {
      currentWeekIdx++;
      layoutWeekDial();
      await openWeek(weeks[currentWeekIdx]);
    }
  });
}

async function openWeek(week) { await navigate(week.prefix); }

// --- Navigate ---
async function navigate(prefix) {
  currentPrefix = prefix;
  const browser = document.getElementById('browser');
  browser.innerHTML = '<div class="db-loading">Loading…</div>';
  try {
    const res = await window.dumpBinAuth.fetch(
      `/api/list?prefix=${encodeURIComponent(prefix)}`
    );
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const data = await res.json();
    renderBreadcrumb(prefix);
    renderBrowser(data);
  } catch (err) {
    browser.innerHTML = `<div class="db-empty">Error: ${err.message}</div>`;
  }
}

function renderBreadcrumb(prefix) {
  const bc = document.getElementById('breadcrumb');
  const parts = prefix.split('/').filter(Boolean);
  const crumbs = [];
  let accum = '';
  parts.forEach((p, i) => {
    accum += p + '/';
    const isLast = i === parts.length - 1;
    if (isLast) crumbs.push(`<span>${escapeHtml(p)}</span>`);
    else crumbs.push(`<a data-prefix="${escapeAttr(accum)}">${escapeHtml(p)}</a>`);
  });
  bc.innerHTML = crumbs.join(' <span class="sep">/</span> ');
  bc.querySelectorAll('a[data-prefix]').forEach(a => {
    a.addEventListener('click', () => navigate(a.dataset.prefix));
  });
}

function renderBrowser(data) {
  const browser = document.getElementById('browser');
  const { folders = [], files = [] } = data;
  if (folders.length === 0 && files.length === 0) {
    browser.innerHTML = '<div class="db-empty">This folder is empty.</div>';
    return;
  }
  let html = '';

  if (folders.length) {
    html += '<div class="db-section"><div class="db-section__header">Folders</div>';
    html += folders.map(f => `
      <a class="db-item db-item--folder" data-prefix="${escapeAttr(f.prefix)}">
        <span class="db-item__icon">📁</span>
        <span class="db-item__name">${escapeHtml(f.name)}</span>
      </a>`).join('');
    html += '</div>';
  }

  if (files.length) {
    const allSelected = files.every(f => selection.has(f.key));
    html += '<div class="db-section"><div class="db-section__header">Files</div>';
    html += `
      <div class="db-select-all-row">
        <input type="checkbox" id="selectAllFiles" ${allSelected ? 'checked' : ''}>
        <label for="selectAllFiles" style="margin:0;cursor:pointer;">Select all in this folder</label>
      </div>`;
    html += files.map(f => {
      const isSel = selection.has(f.key);
      return `
        <div class="db-item${isSel ? ' db-item--selected' : ''}" data-key="${escapeAttr(f.key)}">
          <input type="checkbox" class="db-item__checkbox" ${isSel ? 'checked' : ''} data-key="${escapeAttr(f.key)}">
          <span class="db-item__icon">${fileIcon(f.name)}</span>
          <a class="db-item__name" href="${escapeAttr(downloadUrlForFile(f))}" target="_blank" rel="noopener">${escapeHtml(f.name)}</a>
          <span class="db-item__meta">${formatSize(f.size)}</span>
        </div>`;
    }).join('');
    html += '</div>';
  }

  browser.innerHTML = html;

  browser.querySelectorAll('.db-item--folder[data-prefix]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.prefix));
  });

  browser.querySelectorAll('.db-item__checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const key = cb.dataset.key;
      const fileObj = files.find(f => f.key === key);
      if (cb.checked && fileObj) {
        selection.set(key, {
          key,
          name: fileObj.name,
          size: fileObj.size,
          t: fileObj.t,
        });
      } else {
        selection.delete(key);
      }
      cb.closest('.db-item').classList.toggle('db-item--selected', cb.checked);
      updateSelectionBar();
      syncSelectAllCheckbox(files);
    });
  });

  const selectAll = document.getElementById('selectAllFiles');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      files.forEach(f => {
        if (selectAll.checked) {
          selection.set(f.key, {
            key: f.key,
            name: f.name,
            size: f.size,
            t: f.t,
          });
        } else {
          selection.delete(f.key);
        }
      });
      renderBrowser(data);
      updateSelectionBar();
    });
  }
}

function syncSelectAllCheckbox(files) {
  const selectAll = document.getElementById('selectAllFiles');
  if (!selectAll) return;
  selectAll.checked = files.every(f => selection.has(f.key));
}

// --- Top-nav dropdowns ---
function wireDropdowns() {
  const dropdowns = document.querySelectorAll('.db-dropdown');
  dropdowns.forEach(dd => {
    const toggle = dd.querySelector('.db-dropdown__toggle');
    const menu = dd.querySelector('.db-dropdown__menu');
    const prefix = menu.dataset.prefix;
    let loaded = false;
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdowns.forEach(o => { if (o !== dd) o.classList.remove('open'); });
      dd.classList.toggle('open');
      if (dd.classList.contains('open') && !loaded) {
        menu.innerHTML = '<div class="db-section-header">Loading…</div>';
        try {
          const res = await window.dumpBinAuth.fetch(
            `/api/list?prefix=${encodeURIComponent(prefix)}`
          );
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          renderDropdownMenu(menu, data);
          loaded = true;
        } catch {
          menu.innerHTML = `<div class="db-section-header">Error</div>`;
        }
      }
    });
  });
  document.addEventListener('click', () => {
    dropdowns.forEach(dd => dd.classList.remove('open'));
  });
}

function renderDropdownMenu(menu, data) {
  const { folders = [], files = [] } = data;
  let html = '';
  if (folders.length) {
    html += folders.map(f =>
      `<button class="db-folder" data-prefix="${escapeAttr(f.prefix)}">${escapeHtml(f.name)}</button>`
    ).join('');
  }
  if (files.length) {
    html += files.map(f =>
      `<a class="db-file" href="${escapeAttr(downloadUrlForFile(f))}" target="_blank" rel="noopener">${escapeHtml(f.name)}</a>`
    ).join('');
  }
  if (!html) html = '<div class="db-section-header">Empty</div>';
  menu.innerHTML = html;
  menu.querySelectorAll('button[data-prefix]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.prefix);
      document.querySelectorAll('.db-dropdown').forEach(dd => dd.classList.remove('open'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// --- Selection bar ---
function wireSelectionBar() {
  document.getElementById('clearSelectionBtn').addEventListener('click', () => {
    selection.clear();
    updateSelectionBar();
    navigate(currentPrefix);
  });

  document.getElementById('viewSelectionBtn').addEventListener('click', () => {
    renderSelectionList();
    openModal('selectionModal');
  });

  const downloadBtn = document.getElementById('downloadBtn');
  const popover = document.getElementById('downloadPopover');
  downloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = downloadBtn.getBoundingClientRect();
    popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    popover.style.left = `${rect.left}px`;
    popover.classList.toggle('open');
  });
  document.addEventListener('click', () => popover.classList.remove('open'));
  popover.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.remove('open');
      const action = btn.dataset.action;
      if (action === 'individual') void downloadIndividual();
      else if (action === 'zip') downloadAsZip();
    });
  });

  document.getElementById('printAtStoreBtn').addEventListener('click', () => {
    openPrintModal();
  });

  // If a recent submission is still in the cooldown window (including across
  // page reloads), keep the button locked until the fax pipeline catches up.
  if (getCooldownRemaining() > 0) startCooldownTicker();
  else updatePrintAtStoreButton();
}

function updateSelectionBar() {
  const bar = document.getElementById('selectionBar');
  const count = selection.size;
  document.getElementById('selectionCount').textContent = count;
  const totalSize = Array.from(selection.values()).reduce((s, f) => s + f.size, 0);
  document.getElementById('selectionSize').textContent = count ? `(${formatSize(totalSize)})` : '';
  bar.classList.toggle('visible', count > 0);
}

function renderSelectionList() {
  const list = document.getElementById('selectionList');
  if (selection.size === 0) {
    list.innerHTML = '<div class="db-empty">No files selected.</div>';
    return;
  }
  list.innerHTML = Array.from(selection.values()).map(f => {
    const folderPath = f.key.split('/').slice(0, -1).join(' / ');
    return `
      <div class="db-selection-item">
        <span>${fileIcon(f.name)}</span>
        <div class="db-selection-item__stack">
          <div class="db-selection-item__name">${escapeHtml(f.name)}</div>
          <div class="db-selection-item__path">${escapeHtml(folderPath)}</div>
        </div>
        <span class="db-item__meta">${formatSize(f.size)}</span>
        <button class="db-selection-item__remove" data-key="${escapeAttr(f.key)}" title="Remove">✕</button>
      </div>`;
  }).join('');
  list.querySelectorAll('.db-selection-item__remove').forEach(btn => {
    btn.addEventListener('click', () => {
      selection.delete(btn.dataset.key);
      renderSelectionList();
      updateSelectionBar();
      navigate(currentPrefix);
    });
  });
}

// --- Downloads ---
async function downloadIndividual() {
  if (selection.size === 0) return;
  let i = 0;
  try {
    for (const f of selection.values()) {
      const href = await resolveDownloadUrl(f);
      const delay = i * 250;
      const name = f.name;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, delay);
      i++;
    }
    toast(`Started ${selection.size} download(s)`, 'success');
  } catch (err) {
    toast(err.message || 'Download failed', 'error');
  }
}

async function downloadAsZip() {
  if (selection.size === 0) return;
  if (typeof JSZip === 'undefined') {
    toast('ZIP library not loaded', 'error');
    return;
  }
  toast(`Building ZIP of ${selection.size} file(s)…`);
  try {
    const zip = new JSZip();
    for (const f of selection.values()) {
      const res = await window.dumpBinAuth.fetch(
        `/api/download?key=${encodeURIComponent(f.key)}`
      );
      if (!res.ok) throw new Error(`Failed to fetch ${f.name}`);
      const blob = await res.blob();
      zip.file(f.name, blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dump-bin-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('ZIP ready', 'success');
  } catch (err) {
    toast(`ZIP failed: ${err.message}`, 'error');
  }
}

// --- Print at Store modal ---
function wirePrintModal() {
  const search = document.getElementById('storeSearch');
  search.addEventListener('input', () => renderStoreList(search.value));
  renderStoreList('');

  document.getElementById('sendPrintBtn').addEventListener('click', sendPrint);

  // Cancel button is state-aware: in the confirm view it steps back to the
  // picker so the user can adjust the job; everywhere else it closes.
  document.getElementById('printCancelBtn').addEventListener('click', () => {
    if (printModalState === 'confirm') setPrintModalState('picker');
    else if (printModalState !== 'sending') closeModal('printModal');
  });
}

function openPrintModal() {
  // If we're still in the cooldown window, short-circuit into the transit view
  // — the last job is still being chaperoned through the gateway.
  if (getCooldownRemaining() > 0) {
    setPrintModalState('transit');
    openModal('printModal');
    startCooldownTicker();
    return;
  }
  if (selection.size === 0) {
    toast('Select at least one file first', 'error');
    return;
  }
  selectedStore = null;
  document.getElementById('selectedStoreLabel').textContent = 'none';
  document.getElementById('printFileCount').textContent = selection.size;
  const totalSize = Array.from(selection.values()).reduce((s, f) => s + f.size, 0);
  document.getElementById('printSize').textContent = formatSize(totalSize);
  document.getElementById('storeSearch').value = '';
  renderStoreList('');
  setPrintModalState('picker');
  openModal('printModal');
}

function renderStoreList(query) {
  const list = document.getElementById('storeList');
  const q = query.toLowerCase().trim();
  const filtered = q
    ? STORES.filter(s => String(s.num).includes(q) || s.city.toLowerCase().includes(q))
    : STORES;
  if (filtered.length === 0) {
    list.innerHTML = '<div class="db-store-empty">No matches.</div>';
    return;
  }
  list.innerHTML = filtered.map(s => `
    <div class="db-store-item${selectedStore?.num === s.num ? ' selected' : ''}" data-num="${s.num}" data-city="${escapeAttr(s.city)}">
      <span class="db-store-item__num">#${s.num}</span>
      <span class="db-store-item__city">${escapeHtml(s.city)}</span>
    </div>`).join('');
  list.querySelectorAll('.db-store-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedStore = { num: Number(el.dataset.num), city: el.dataset.city };
      document.getElementById('selectedStoreLabel').textContent = `#${selectedStore.num} — ${selectedStore.city}`;
      document.getElementById('sendPrintBtn').disabled = false;
      list.querySelectorAll('.db-store-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

async function sendPrint() {
  if (!selectedStore || selection.size === 0) return;

  // First click from the picker routes through the pipeline-explainer step so
  // users understand why the response isn't instantaneous. Only the second,
  // deliberate click actually dispatches the job.
  if (printModalState === 'picker') {
    document.getElementById('confirmStoreLabel').textContent =
      `#${selectedStore.num} — ${selectedStore.city}`;
    document.getElementById('confirmFileCount').textContent = selection.size;
    const totalSize = Array.from(selection.values()).reduce((s, f) => s + f.size, 0);
    document.getElementById('confirmSize').textContent = formatSize(totalSize);
    setPrintModalState('confirm');
    return;
  }
  if (printModalState !== 'confirm') return;

  setPrintModalState('sending');
  try {
    const res = await fetchPrintAtStoreApi(`${API}/print-at-store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keys: Array.from(selection.keys()),
        storeNumber: selectedStore.num,
        storeCity: selectedStore.city,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Send failed');
    toast(`Sent to #${selectedStore.num} — ${selectedStore.city}. You're CC'd.`, 'success');
    document.getElementById('transitSubline').textContent =
      `Your job for #${selectedStore.num} — ${selectedStore.city} has been injected into the relay and is being transcoded for the fax gateway. Nothing more to do on your end.`;
    localStorage.setItem(PRINT_LAST_SEND_KEY, String(Date.now()));
    selection.clear();
    updateSelectionBar();
    navigate(currentPrefix);
    setPrintModalState('transit');
    startCooldownTicker();
  } catch (err) {
    toast(`Failed: ${err.message}`, 'error');
    setPrintModalState('confirm');
  }
}

// --- Print modal state machine ---
function setPrintModalState(state) {
  printModalState = state;
  const modal = document.querySelector('#printModal .modal');
  if (!modal) return;
  modal.classList.remove('state-picker', 'state-confirm', 'state-sending', 'state-transit');
  modal.classList.add(`state-${state}`);

  const sendBtn = document.getElementById('sendPrintBtn');
  const cancelBtn = document.getElementById('printCancelBtn');
  const title = document.getElementById('printModalTitle');

  cancelBtn.disabled = false;

  if (state === 'picker') {
    title.textContent = 'Print at Store';
    sendBtn.style.display = '';
    sendBtn.textContent = 'Send';
    sendBtn.disabled = !selectedStore || selection.size === 0;
    cancelBtn.textContent = 'Cancel';
  } else if (state === 'confirm') {
    title.textContent = 'Before you send…';
    sendBtn.style.display = '';
    sendBtn.textContent = 'Yes, send it →';
    sendBtn.disabled = false;
    cancelBtn.textContent = '← Back';
  } else if (state === 'sending') {
    title.textContent = 'Transmitting…';
    sendBtn.style.display = '';
    sendBtn.textContent = 'Transmitting…';
    sendBtn.disabled = true;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.disabled = true;
  } else if (state === 'transit') {
    title.textContent = 'In transit';
    sendBtn.style.display = 'none';
    cancelBtn.textContent = 'Got it';
  }
}

// --- Cooldown after a successful send ---
function getCooldownRemaining() {
  const last = parseInt(localStorage.getItem(PRINT_LAST_SEND_KEY) || '0', 10);
  if (!last) return 0;
  return Math.max(0, last + PRINT_COOLDOWN_MS - Date.now());
}

function formatCooldown(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startCooldownTicker() {
  if (cooldownTicker) return;
  const tick = () => {
    const remaining = getCooldownRemaining();
    const el = document.getElementById('cooldownRemaining');
    if (el) el.textContent = formatCooldown(remaining);
    updatePrintAtStoreButton();
    if (remaining === 0) {
      clearInterval(cooldownTicker);
      cooldownTicker = null;
      if (printModalState === 'transit') {
        closeModal('printModal');
        setPrintModalState('picker');
      }
    }
  };
  tick();
  cooldownTicker = setInterval(tick, 1000);
}

function updatePrintAtStoreButton() {
  const btn = document.getElementById('printAtStoreBtn');
  if (!btn) return;
  const remaining = getCooldownRemaining();
  if (remaining > 0) {
    btn.disabled = true;
    btn.classList.add('db-cooldown');
    btn.textContent = `🕒 In transit · ${formatCooldown(remaining)}`;
  } else {
    btn.disabled = false;
    btn.classList.remove('db-cooldown');
    btn.textContent = '🖨 Print at Store';
  }
}

// --- Modals ---
function wireModals() {
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd) closeModal(bd.id);
    });
  });
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// --- Toasts ---
function toast(msg, type = '') {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = `db-toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('closing');
    setTimeout(() => t.remove(), 200);
  }, 4000);
}

// --- Helpers ---
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📕';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊';
  if (['docx', 'doc'].includes(ext)) return '📝';
  if (['pptx', 'ppt'].includes(ext)) return '📽';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼';
  if (['zip', '7z', 'rar'].includes(ext)) return '🗜';
  return '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s) { return escapeHtml(s); }
