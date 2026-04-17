// ===== Dump Bin browser =====
import { STORES } from './stores.js';

const API = '/api';

// State
let weeks = [];
let currentWeekIdx = 0;
let currentPrefix = '';
let userEmail = null;

// Selection: Map<key, { name, size, key }>
const selection = new Map();

// Store picker state
let selectedStore = null;

// --- Boot ---
document.addEventListener('DOMContentLoaded', async () => {
  wireDropdowns();
  wireWeekArrows();
  wireSelectionBar();
  wireModals();
  wirePrintModal();
  await loadIdentity();
  await loadWeeks();
});

async function loadIdentity() {
  try {
    const res = await fetch(`${API}/whoami`);
    const data = await res.json();
    userEmail = data.email;
  } catch {}
  document.getElementById('printRecipient').textContent = 'tyson.gauthier@retailodyssey.com';
}

// --- Weeks ---
async function loadWeeks() {
  try {
    const res = await fetch(`${API}/weeks`);
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
    renderWeekGrid();
    await openWeek(weeks[currentWeekIdx]);
  } catch (err) {
    document.getElementById('browser').innerHTML =
      `<div class="db-empty">Error loading weeks: ${err.message}</div>`;
  }
}

function renderWeekGrid() {
  const grid = document.getElementById('weekGrid');
  const today = new Date();
  grid.innerHTML = weeks.map((w, i) => {
    const isCurrent = new Date(w.start) <= today && today <= new Date(w.end);
    const isActive = i === currentWeekIdx;
    const startFmt = new Date(w.start).toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric',
    });
    return `
      <button class="db-week-pill${isActive ? ' active' : ''}${isCurrent ? ' current' : ''}" data-idx="${i}">
        ${w.short}<small>${startFmt}</small>
      </button>`;
  }).join('');
  grid.querySelectorAll('.db-week-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      currentWeekIdx = Number(btn.dataset.idx);
      renderWeekGrid();
      await openWeek(weeks[currentWeekIdx]);
    });
  });
  document.getElementById('prevWeek').disabled = currentWeekIdx === 0;
  document.getElementById('nextWeek').disabled = currentWeekIdx === weeks.length - 1;
}

function wireWeekArrows() {
  document.getElementById('prevWeek').addEventListener('click', async () => {
    if (currentWeekIdx > 0) {
      currentWeekIdx--;
      renderWeekGrid();
      await openWeek(weeks[currentWeekIdx]);
    }
  });
  document.getElementById('nextWeek').addEventListener('click', async () => {
    if (currentWeekIdx < weeks.length - 1) {
      currentWeekIdx++;
      renderWeekGrid();
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
    const res = await fetch(`${API}/list?prefix=${encodeURIComponent(prefix)}`);
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
          <a class="db-item__name" href="${API}/download?key=${encodeURIComponent(f.key)}" target="_blank" rel="noopener">${escapeHtml(f.name)}</a>
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
        selection.set(key, { key, name: fileObj.name, size: fileObj.size });
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
          selection.set(f.key, { key: f.key, name: f.name, size: f.size });
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
          const res = await fetch(`${API}/list?prefix=${encodeURIComponent(prefix)}`);
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
      `<a class="db-file" href="${API}/download?key=${encodeURIComponent(f.key)}" target="_blank" rel="noopener">${escapeHtml(f.name)}</a>`
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
      if (action === 'individual') downloadIndividual();
      else if (action === 'zip') downloadAsZip();
    });
  });

  document.getElementById('printAtStoreBtn').addEventListener('click', () => {
    openPrintModal();
  });
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
function downloadIndividual() {
  if (selection.size === 0) return;
  let i = 0;
  for (const f of selection.values()) {
    // Stagger slightly to avoid browser blocking multiple downloads
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = `${API}/download?key=${encodeURIComponent(f.key)}`;
      a.download = f.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 250);
    i++;
  }
  toast(`Started ${selection.size} download(s)`, 'success');
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
      const res = await fetch(`${API}/download?key=${encodeURIComponent(f.key)}`);
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
}

function openPrintModal() {
  if (selection.size === 0) {
    toast('Select at least one file first', 'error');
    return;
  }
  selectedStore = null;
  document.getElementById('selectedStoreLabel').textContent = 'none';
  document.getElementById('sendPrintBtn').disabled = true;
  document.getElementById('printFileCount').textContent = selection.size;
  const totalSize = Array.from(selection.values()).reduce((s, f) => s + f.size, 0);
  document.getElementById('printSize').textContent = formatSize(totalSize);
  document.getElementById('storeSearch').value = '';
  renderStoreList('');
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
  const btn = document.getElementById('sendPrintBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(`${API}/print-at-store`, {
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
    closeModal('printModal');
    selection.clear();
    updateSelectionBar();
    navigate(currentPrefix);
  } catch (err) {
    toast(`Failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
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
