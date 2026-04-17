// ===== Dump Bin browser =====

const API = '/api';

// State
let weeks = [];          // from /api/weeks
let currentWeekIdx = 0;  // index into weeks[]
let currentPrefix = '';  // current folder being browsed

// --- Boot ---
document.addEventListener('DOMContentLoaded', async () => {
  wireDropdowns();
  wireWeekArrows();
  await loadWeeks();
});

// --- Load week list, pick current (today's) week, render grid + browser ---
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

    // Pick the week containing today, else nearest upcoming
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

// --- Render the week pill grid ---
function renderWeekGrid() {
  const grid = document.getElementById('weekGrid');
  const today = new Date();

  grid.innerHTML = weeks.map((w, i) => {
    const isCurrent =
      new Date(w.start) <= today && today <= new Date(w.end);
    const isActive = i === currentWeekIdx;
    const startFmt = new Date(w.start).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
    });
    return `
      <button
        class="db-week-pill${isActive ? ' active' : ''}${isCurrent ? ' current' : ''}"
        data-idx="${i}"
      >
        ${w.short}
        <small>${startFmt}</small>
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

// --- Arrow nav ---
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

// --- Open a week = navigate into its prefix ---
async function openWeek(week) {
  await navigate(week.prefix);
}

// --- Navigate to a prefix, render browser + breadcrumb ---
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

// --- Breadcrumb ---
function renderBreadcrumb(prefix) {
  const bc = document.getElementById('breadcrumb');
  const parts = prefix.split('/').filter(Boolean);

  const crumbs = [];
  let accum = '';
  parts.forEach((p, i) => {
    accum += p + '/';
    const isLast = i === parts.length - 1;
    if (isLast) {
      crumbs.push(`<span>${p}</span>`);
    } else {
      crumbs.push(`<a data-prefix="${accum}">${p}</a>`);
    }
  });

  bc.innerHTML = crumbs.join(' <span class="sep">/</span> ');
  bc.querySelectorAll('a[data-prefix]').forEach(a => {
    a.addEventListener('click', () => navigate(a.dataset.prefix));
  });
}

// --- Render folder/file list ---
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
    html += '<div class="db-section"><div class="db-section__header">Files</div>';
    html += files.map(f => `
      <a class="db-item" href="${API}/download?key=${encodeURIComponent(f.key)}" target="_blank" rel="noopener">
        <span class="db-item__icon">${fileIcon(f.name)}</span>
        <span class="db-item__name">${escapeHtml(f.name)}</span>
        <span class="db-item__meta">${formatSize(f.size)}</span>
      </a>`).join('');
    html += '</div>';
  }

  browser.innerHTML = html;

  browser.querySelectorAll('.db-item--folder[data-prefix]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.prefix));
  });
}

// --- Top-nav dropdowns (Useful Folder, Non-Kompass, Special Projects) ---
function wireDropdowns() {
  const dropdowns = document.querySelectorAll('.db-dropdown');

  dropdowns.forEach(dd => {
    const toggle = dd.querySelector('.db-dropdown__toggle');
    const menu = dd.querySelector('.db-dropdown__menu');
    const prefix = menu.dataset.prefix;
    let loaded = false;

    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Close other dropdowns
      dropdowns.forEach(other => {
        if (other !== dd) other.classList.remove('open');
      });
      dd.classList.toggle('open');

      if (dd.classList.contains('open') && !loaded) {
        menu.innerHTML = '<div class="db-section-header">Loading…</div>';
        try {
          const res = await fetch(`${API}/list?prefix=${encodeURIComponent(prefix)}`);
          const data = await res.json();
          renderDropdownMenu(menu, data, prefix);
          loaded = true;
        } catch (err) {
          menu.innerHTML = `<div class="db-section-header">Error</div>`;
        }
      }
    });
  });

  // Click outside closes dropdowns
  document.addEventListener('click', () => {
    dropdowns.forEach(dd => dd.classList.remove('open'));
  });
}

function renderDropdownMenu(menu, data, rootPrefix) {
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

  // Folder clicks navigate the main browser
  menu.querySelectorAll('button[data-prefix]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.prefix);
      document.querySelectorAll('.db-dropdown').forEach(dd => dd.classList.remove('open'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}
