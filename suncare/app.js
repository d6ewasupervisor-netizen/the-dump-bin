// State
let stores = {};
let currentStore = null;
let planogram = null;
let currentSide = 1;
let currentFilter = 'all'; // all, new, srp
let products = [];
let upcRedirects = {};
let removedProducts = [];
let html5QrCode;
let deferredPrompt;
let resizeBound = false;
let pdfState = null;

const pdfjsReadyPromise = new Promise(resolve => {
  if (window.pdfjsLib) resolve();
  else window.addEventListener('pdfjsReady', resolve, { once: true });
});

// Cache
const CACHE_NAME = 'suncare-pog-v1';

// DOM Elements
const app = document.getElementById('app');

// Templates
const landingTemplate = () => `
  <div class="landing-container">
    <div class="landing-title">☀️ SUNCARE POG LOOKUP</div>
    <div class="landing-subtitle">Select your store to begin</div>
    
    <select id="store-selector">
      <option value="" disabled selected>Select Store...</option>
      ${Object.keys(stores).map(s => `<option value="${s}">Store ${s}</option>`).join('')}
    </select>
    
    <div id="preview-card" class="preview-card">
      <h3 class="preview-title" id="pog-name"></h3>
      <p class="preview-meta" id="pog-subtitle"></p>
      
      <div class="preview-stats">
        <span id="pog-number"></span>
        <span id="pog-skus"></span>
      </div>
      
      <button class="btn-primary" id="load-btn">Load Planogram →</button>
    </div>
  </div>
`;

const headerTemplate = (storeId, pog) => `
  <header>
    <div class="header-top">
      <div class="header-title">☀️ ${pog.id === 'pallet' ? 'PALLET' : 'ENDCAP'}</div>
      <a class="header-guide-link" href="user-guide.html" target="_blank" rel="noopener noreferrer">User Guide</a>
      <div class="header-right">
        <span class="header-store">Store #${storeId}</span>
        <button class="btn-close-store" id="close-store">✕</button>
      </div>
    </div>

    <div class="tab-nav">
      <button class="tab-btn active" data-tab="browse">Browse</button>
      <button class="tab-btn" data-tab="scan">Scan</button>
      <button class="tab-btn" data-tab="upc">UPC</button>
      <button class="tab-btn" data-tab="pdf">PDF</button>
    </div>
  </header>

  <div class="confirm-overlay" id="confirm-overlay">
    <div class="confirm-card">
      <p class="confirm-msg">Would you really like to change stores?</p>
      <div class="confirm-buttons">
        <button class="confirm-btn confirm-yes" id="confirm-yes">Yes</button>
        <button class="confirm-btn confirm-no" id="confirm-no">No</button>
      </div>
    </div>
  </div>
`;

const browseTemplate = () => `
  <div class="browse-view" id="browse-view">
    <!-- Shelves injected here -->
  </div>
  
  <div class="scan-view" id="scan-view">
    <div id="reader"></div>
    <button class="torch-btn" id="torch-toggle" style="display:none">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4.95 11.95l.88.88A2 2 0 0 1 8.5 16h7a2 2 0 0 1 .57-1.17l.88-.88A7 7 0 0 0 12 2z"/></svg>
    </button>
  </div>
  
  <div class="upc-view" id="upc-view">
    <div class="upc-search-container">
      <div class="upc-input-group">
        <div class="upc-input-wrapper">
          <input type="text" class="upc-input" id="manual-upc" placeholder="Enter 4+ digits of UPC or product name" autocomplete="off" inputmode="search" dir="ltr">
          <button class="upc-clear-input" id="clear-upc-input" aria-label="Clear input">✕</button>
        </div>
        <button class="btn-primary upc-search-btn" id="lookup-upc">Search</button>
      </div>
      <div class="upc-search-hint" id="upc-search-hint">Enter at least 4 digits to search by UPC</div>
    </div>
    <div id="upc-result"></div>
  </div>

  <div class="bottom-nav" id="bottom-nav">
    <!-- Side buttons injected here -->
  </div>
  
  <div class="toast" id="toast"></div>
`;

const productOverlayTemplate = (p, redirect=null) => `
  <div class="overlay active" id="product-overlay">
    <div class="overlay-content">
      <button class="close-btn" id="close-overlay">✕</button>
      
      ${redirect ? `
        <div class="redirect-banner">
          <div class="redirect-banner-title">&#x1F504; UPC CHANGE DETECTED</div>
          <div class="redirect-banner-detail">
            Old UPC: <strong>${redirect.old}</strong><br>
            New UPC: <strong>${redirect.new}</strong>
          </div>
          <div class="redirect-banner-note">Both UPCs are valid for this product. Do NOT discard either version.</div>
        </div>
      ` : ''}
      
      <div class="detail-img-container">
        <img src="images/${p.upc}.webp" class="detail-img" id="detail-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'50%\\' x=\\'50%\\' dy=\\'0.35em\\' text-anchor=\\'middle\\' font-size=\\'80\\'>☀️</text></svg>'">
      </div>
      
      <h2 class="detail-title">${p.name}</h2>
      <div class="detail-upc">UPC: ${p.upc.replace(/^0+/, '')}</div>
      
      <div class="location-grid">
        <div class="loc-box">
          <span class="loc-label">Side</span>
          <span class="loc-value">${p.segment}</span>
        </div>
        <div class="loc-box">
          <span class="loc-label">Shelf</span>
          <span class="loc-value">${p.shelf}</span>
        </div>
        <div class="loc-box">
          <span class="loc-label">Position</span>
          <span class="loc-value">${p.position}</span>
        </div>
        <div class="loc-box">
          <span class="loc-label">Facings</span>
          <span class="loc-value">${p.facings}</span>
        </div>
      </div>
      
      <div class="mini-pog" id="mini-pog-container">
        <!-- Mini shelf layout -->
      </div>
      
      <button class="btn-primary" id="view-pdf">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-file-type-pdf"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" /><path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" /><path d="M17 18h2" /><path d="M20 15h-3v6" /><path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1" /></svg>
        View Planogram
      </button>

      <div class="overlay-nav-buttons">
        <button class="btn-overlay-nav scan-another" id="scan-another">Scan UPC</button>
        <button class="btn-overlay-nav return-browse" id="return-browse">See Location</button>
      </div>

      <div class="overlay-badges">
        ${p.isNew ? '<span class="overlay-badge new">NEW</span>' : ''}
        ${p.srp ? '<span class="overlay-badge srp">SRP</span>' : ''}
      </div>
    </div>
  </div>
`;

const pdfViewerTemplate = () => `
  <div class="pdf-viewer active" id="pdf-viewer">
    <div class="pdf-toolbar">
      <button class="pdf-tool-btn" id="pdf-close" title="Close">✕</button>
      <button class="pdf-tool-btn" id="pdf-prev" title="Previous page">‹</button>
      <div class="pdf-page-indicator">
        <input type="number" id="pdf-page-input" value="1" min="1">
        <span id="pdf-page-total">/ 1</span>
      </div>
      <button class="pdf-tool-btn" id="pdf-next" title="Next page">›</button>
      <div class="pdf-toolbar-spacer"></div>
      <button class="pdf-tool-btn" id="pdf-zoom-out" title="Zoom out">−</button>
      <span class="pdf-zoom-level" id="pdf-zoom-level">100%</span>
      <button class="pdf-tool-btn" id="pdf-zoom-in" title="Zoom in">+</button>
      <button class="pdf-tool-btn" id="pdf-fit-btn" title="Fit to width">⤢</button>
      <button class="pdf-tool-btn" id="pdf-search-toggle" title="Search">🔍</button>
      <button class="pdf-tool-btn" id="pdf-thumbs-toggle" title="All pages">⊞</button>
    </div>
    <div class="pdf-search-bar hidden" id="pdf-search-bar">
      <input type="text" id="pdf-search-input" placeholder="Search terms or UPC...">
      <span class="pdf-search-count" id="pdf-search-count"></span>
      <button class="pdf-tool-btn pdf-search-nav" id="pdf-search-prev" title="Previous match">‹</button>
      <button class="pdf-tool-btn pdf-search-nav" id="pdf-search-next" title="Next match">›</button>
      <button class="pdf-tool-btn" id="pdf-search-close" title="Close search">✕</button>
    </div>
    <div class="pdf-body">
      <div class="pdf-content" id="pdf-content">
        <div class="pdf-page-container" id="pdf-page-container">
          <canvas id="pdf-canvas"></canvas>
          <div class="pdf-highlights" id="pdf-highlights"></div>
        </div>
      </div>
      <div class="pdf-thumbs-panel hidden" id="pdf-thumbs-panel">
        <div class="pdf-thumbs-header">
          <span>All Pages</span>
          <button class="pdf-tool-btn" id="pdf-thumbs-close">✕</button>
        </div>
        <div class="pdf-thumbs-grid" id="pdf-thumbs-grid"></div>
      </div>
    </div>
    <div class="pdf-loading" id="pdf-loading">Loading PDF...</div>
  </div>
`;

function showToast(message, duration = 1500, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.classList.remove('warning');
  if (type === 'warning') toast.classList.add('warning');

  toast.innerText = message;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// Initialize
async function init() {
  try {
    const res = await fetch('data/stores.json');
    stores = await res.json();
    renderLanding();
  } catch (e) {
    console.error("Failed to load stores", e);
    app.innerHTML = `<div style="padding:20px; text-align:center;">Failed to load app data. Please refresh.</div>`;
  }
}

const DEFAULT_WIDTH_IN = 2.5;
const DEFAULT_HEIGHT_IN = 6.0;
const BASE_PX_PER_IN = 7.2;

const STACK_OVERRIDES = {
  "7548609166": 4,
  "934710805107": 3
};

const SHELF_SCALE_OVERRIDES = {
  "4-2": 1.2,
  "2-1": 1.2
};

function getStackCount(upc) {
  return STACK_OVERRIDES[upc] || 1;
}

function getProductWidthIn(p) {
  const widthIn = Number(p.widthIn);
  return Number.isFinite(widthIn) ? widthIn : DEFAULT_WIDTH_IN;
}

function getProductHeightIn(p) {
  const heightIn = Number(p.heightIn);
  return Number.isFinite(heightIn) ? heightIn : DEFAULT_HEIGHT_IN;
}

function getTargetRowWidthPx(container, maxShelfWidthIn) {
  const containerWidth = container ? container.clientWidth : window.innerWidth;
  if (!maxShelfWidthIn) return containerWidth;
  return Math.max(containerWidth, Math.round(maxShelfWidthIn * BASE_PX_PER_IN));
}

// Render Landing
function renderLanding() {
  app.innerHTML = landingTemplate();
  
  const selector = document.getElementById('store-selector');
  const preview = document.getElementById('preview-card');
  const loadBtn = document.getElementById('load-btn');
  
  selector.addEventListener('change', async (e) => {
    const storeId = e.target.value;
    const pogType = stores[storeId];
    
    // Fetch preview data just to show info (or just assume based on type)
    // We'll just fetch the full json for now since we need it anyway
    try {
      const res = await fetch(`data/${pogType}.json`);
      const data = await res.json();
      
      document.getElementById('pog-name').innerText = data.name;
      document.getElementById('pog-subtitle').innerText = data.subtitle;
      document.getElementById('pog-number').innerText = `POG: ${data.pogNumber}`;
      document.getElementById('pog-skus').innerText = `${data.totalProducts} SKUs`;
      
      preview.classList.add('active');
      
      loadBtn.onclick = () => loadApp(storeId, data);
    } catch (err) {
      console.error(err);
    }
  });
}

// Load Main App
function loadApp(storeId, data) {
  currentStore = storeId;
  planogram = data;
  products = data.products;
  upcRedirects = data.upcRedirects || {};
  removedProducts = data.removedProducts || [];
  currentSide = 1;
  
  // Render structure
  app.innerHTML = headerTemplate(storeId, planogram) + browseTemplate();
  
  setupNavigation();
  renderShelves();
  renderBottomNav();
  setupGestures();

  if (!resizeBound) {
    window.addEventListener('resize', () => {
      if (planogram) renderShelves();
    });
    resizeBound = true;
  }
}


function clearUpcSearch() {
  const upcInput = document.getElementById('manual-upc');
  const resultDiv = document.getElementById('upc-result');
  const hintDiv = document.getElementById('upc-search-hint');
  const clearBtn = document.getElementById('clear-upc-input');

  if (upcInput) upcInput.value = '';
  if (resultDiv) resultDiv.innerHTML = '';
  if (hintDiv) {
    hintDiv.textContent = 'Enter at least 4 digits to search by UPC';
    hintDiv.style.display = 'block';
  }
  if (clearBtn) clearBtn.style.display = 'none';
  if (upcInput) upcInput.focus();
}

function highlightMatch(text, query) {
  if (!query || query.length < 3) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function switchToTab(tabName) {
  // Handle PDF tab separately — open the PDF viewer and deselect active tab highlight
  if (tabName === 'pdf') {
    openPdfViewer();
    return;
  }

  const tabs = document.querySelectorAll('.tab-btn');
  const views = {
    'browse': document.getElementById('browse-view'),
    'scan': document.getElementById('scan-view'),
    'upc': document.getElementById('upc-view')
  };

  // Clear UPC search when leaving the UPC tab
  const currentlyOnUpc = document.querySelector('.tab-btn[data-tab="upc"]')?.classList.contains('active');
  if (currentlyOnUpc && tabName !== 'upc') {
    clearUpcSearch();
  }

  tabs.forEach(b => b.classList.remove('active'));
  const activeTab = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (activeTab) activeTab.classList.add('active');

  Object.values(views).forEach(v => v.style.display = 'none');
  views[tabName].style.display = tabName === 'scan' ? 'flex' : 'block';

  if (tabName === 'scan') {
    startScanner();
  } else {
    stopScanner();
  }

  if (tabName === 'browse') {
    renderShelves();
  }

  // Auto-focus input when switching to UPC tab
  if (tabName === 'upc') {
    setTimeout(() => {
      const upcInput = document.getElementById('manual-upc');
      if (upcInput) upcInput.focus();
    }, 100);
  }
}

function setupNavigation() {
  const tabs = document.querySelectorAll('.tab-btn');

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      switchToTab(t.dataset.tab);
    });
  });

  document.getElementById('close-store').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.add('active');
  });

  document.getElementById('confirm-yes').addEventListener('click', () => {
    location.reload();
  });

  document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.remove('active');
  });

  // Manual UPC
  const upcInput = document.getElementById('manual-upc');
  const upcBtn = document.getElementById('lookup-upc');
  let upcDebounce = null;

  upcBtn.addEventListener('click', () => {
    const val = upcInput.value.trim();
    if (val) handleUpcSearch(val);
  });

  upcInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = upcInput.value.trim();
      if (val) handleUpcSearch(val);
    }
  });

  // Clear button inside input
  const clearInputBtn = document.getElementById('clear-upc-input');
  clearInputBtn.addEventListener('click', () => {
    clearUpcSearch();
  });

  // Toggle clear button visibility
  function updateClearBtnVisibility() {
    clearInputBtn.style.display = upcInput.value.length > 0 ? 'flex' : 'none';
  }
  updateClearBtnVisibility();

  upcInput.addEventListener('input', () => {
    clearTimeout(upcDebounce);
    updateClearBtnVisibility();
    const val = upcInput.value.trim();
    const resultDiv = document.getElementById('upc-result');
    const hintDiv = document.getElementById('upc-search-hint');
    const isNumeric = /^\d+$/.test(val);

    // Require 4+ digits for UPC searches, 3+ chars for name searches
    if (isNumeric && val.length < 4) {
      resultDiv.innerHTML = '';
      if (val.length > 0 && hintDiv) {
        hintDiv.textContent = `Type ${4 - val.length} more digit${4 - val.length > 1 ? 's' : ''} to search`;
        hintDiv.style.display = 'block';
      }
      return;
    }
    if (!isNumeric && val.length < 3) {
      resultDiv.innerHTML = '';
      return;
    }

    if (hintDiv) hintDiv.style.display = 'none';

    upcDebounce = setTimeout(() => {
      const matches = findAllFuzzy(val, products);
      if (matches.length === 0) {
        resultDiv.innerHTML = `<div class="upc-no-results">No products found for "${val}"</div>`;
      } else {
        resultDiv.innerHTML = `
          <div class="upc-results-header">${matches.length} product${matches.length > 1 ? 's' : ''} found</div>
          <div class="upc-results-list">
            ${matches.map(p => `
              <div class="upc-result-item" onclick="openProductOverlay('${p.upc}')">
                <img src="images/${p.upc}.webp" class="upc-result-thumb" onerror="this.style.display='none'">
                <div class="upc-result-info">
                  <div class="upc-result-name">${highlightMatch(p.name, val)}</div>
                  <div class="upc-result-detail">UPC: ${p.upc.replace(/^0+/, '')} · Side ${p.segment} · Shelf ${p.shelf} · Pos ${p.position}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }, 200);
  });
}


function renderShelves() {
  const container = document.getElementById('browse-view');
  container.innerHTML = '';

  const sideProducts = products.filter(p => p.segment === currentSide);
  const maxShelf = planogram.shelves;

  const shelves = [];
  let maxShelfWidthIn = 0;
  let widestShelfItemCount = 0;

  for (let s = maxShelf; s >= 1; s--) {
    const allShelfProducts = sideProducts
      .filter(p => p.shelf === s)
      .sort((a, b) => a.position - b.position);

    const allFacings = allShelfProducts.reduce((acc, p) => acc + p.facings, 0);
    const shelfWidthIn = allShelfProducts.reduce(
      (acc, p) => acc + getProductWidthIn(p) * p.facings,
      0
    );

    if (shelfWidthIn > maxShelfWidthIn) {
      maxShelfWidthIn = shelfWidthIn;
      widestShelfItemCount = allShelfProducts.length;
    }

    const visibleSet = new Set();
    if (currentFilter === 'new') allShelfProducts.filter(p => p.isNew).forEach(p => visibleSet.add(p.upc));
    else if (currentFilter === 'srp') allShelfProducts.filter(p => p.srp).forEach(p => visibleSet.add(p.upc));

    const displayProducts = allShelfProducts.map(p => ({
      ...p,
      hidden: currentFilter !== 'all' && !visibleSet.has(p.upc)
    }));

    const visibleProducts = displayProducts.filter(p => !p.hidden);
    const visibleFacings = visibleProducts.reduce((acc, p) => acc + p.facings, 0);

    shelves.push({ s, displayProducts, facings: visibleFacings, allFacings, shelfWidthIn, visibleCount: visibleProducts.length });
  }

  const rawWidth = container ? container.clientWidth : window.innerWidth;
  const cs = container ? getComputedStyle(container) : null;
  const containerPad = cs
    ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    : 0;
  const contentWidth = rawWidth - containerPad;

  const isEndcap = planogram.id === 'endcap';
  const GAP_PX = 4;

  let endcapScale;
  if (isEndcap && maxShelfWidthIn > 0) {
    const padRight = 24;
    const widestGaps = Math.max(0, widestShelfItemCount - 1) * GAP_PX;
    endcapScale = ((contentWidth - padRight - widestGaps) / maxShelfWidthIn) * 2.0;
  }

  shelves.forEach(({ s, displayProducts, facings, shelfWidthIn, visibleCount }) => {
    const shelfDiv = document.createElement('div');
    shelfDiv.className = 'shelf-container';

    const label = s === maxShelf ? 'TOP' : (s === 1 ? 'BOTTOM' : '');
    const boostKey = `${currentSide}-${s}`;
    const boost = SHELF_SCALE_OVERRIDES[boostKey] || 0;

    let shelfScale;
    if (isEndcap) {
      shelfScale = endcapScale || BASE_PX_PER_IN;
    } else {
      const gaps = Math.max(0, displayProducts.length - 1) * GAP_PX;
      shelfScale = shelfWidthIn > 0
        ? (contentWidth - gaps) / shelfWidthIn
        : BASE_PX_PER_IN;
    }

    shelfDiv.innerHTML = `
      <div class="product-shelf-row" id="shelf-row-${s}">
        ${displayProducts.map(p => createProductCard(p, p.hidden, boost)).join('')}
      </div>
      <div class="shelf-header">
        <span>Shelf ${s} ${label}</span>
        <span>${visibleCount} items · ${facings} facings</span>
      </div>
    `;

    container.appendChild(shelfDiv);

    const row = document.getElementById(`shelf-row-${s}`);
    if (row) {
      row.style.setProperty('--row-width', `${contentWidth}px`);
      row.style.setProperty('--inch-scale', `${shelfScale}px`);
      if (isEndcap) row.style.paddingRight = '24px';
    }
  });
}

function createProductCard(p, hidden = false, boost = 0) {
  const stack = getStackCount(p.upc);
  const heightIn = getProductHeightIn(p);
  const stackedHeightIn = heightIn * stack;
  const totalImages = p.facings * stack;
  const isStacked = stack > 1;
  const imgSrc = `images/${p.upc}.webp`;
  const fallback = `data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'50%\\' x=\\'50%\\' dy=\\'0.35em\\' text-anchor=\\'middle\\' font-size=\\'80\\'>☀️</text></svg>`;

  let imagesHtml = '';
  for (let i = 0; i < totalImages; i++) {
    imagesHtml += `<img src="${imgSrc}" class="product-img" loading="lazy" onerror="this.onerror=null; this.src='${fallback}'">`;
  }

  const hiddenStyle = hidden ? 'visibility: hidden;' : '';
  const boostedClass = (boost > 0 && !isStacked) ? ' boosted' : '';
  const boostStyle = (boost > 0 && !isStacked) ? `--shelf-boost: ${boost};` : '';

  return `
    <div class="product-card-shelf${boostedClass}" data-upc="${p.upc}" style="--facings: ${p.facings}; --stack: ${stack}; --width-in: ${getProductWidthIn(p)}; --height-in: ${stackedHeightIn}; ${hiddenStyle}${boostStyle}" onclick="openProductOverlay('${p.upc}')">
      <div class="product-img-group${isStacked ? ' stacked' : ''}">
        ${imagesHtml}
        ${p.isNew ? '<span class="badge new">NEW</span>' : ''}
        ${p.srp ? '<span class="badge srp">SRP</span>' : ''}
      </div>
      <div class="pos-badge">${p.position}</div>
    </div>
  `;
}

function renderBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (planogram.sides <= 1) {
    nav.style.display = 'none';
    return;
  }
  
  let html = '';
  for (let i = 1; i <= planogram.sides; i++) {
    html += `<button class="nav-btn ${i === currentSide ? 'active' : ''}" onclick="changeSide(${i})">Bay ${i}</button>`;
  }
  nav.innerHTML = html;
}

function changeSide(side) {
  if (side < 1 || side > planogram.sides) return;
  currentSide = side;
  renderShelves();
  renderBottomNav();
  
  // Toast
  showToast(`Bay ${side}`);
  
  // Haptic
  if (navigator.vibrate) navigator.vibrate(30);
}

function setupGestures() {
  if (planogram.sides <= 1) return;

  let twoFingerStartX = 0;
  let twoFingerActive = false;
  const MIN_SWIPE = 60;

  const view = document.getElementById('browse-view');

  view.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      twoFingerActive = true;
      twoFingerStartX = (e.touches[0].screenX + e.touches[1].screenX) / 2;
    }
  }, { passive: true });

  view.addEventListener('touchend', (e) => {
    if (!twoFingerActive) return;
    if (e.touches.length === 0) {
      const endX = e.changedTouches[0].screenX;
      const deltaX = endX - twoFingerStartX;

      if (deltaX < -MIN_SWIPE && currentSide < planogram.sides) {
        changeSide(currentSide + 1);
      } else if (deltaX > MIN_SWIPE && currentSide > 1) {
        changeSide(currentSide - 1);
      }
      twoFingerActive = false;
    }
  }, { passive: true });
}

// Scanner
function startScanner() {
  if (html5QrCode) return;

  const readerEl = document.getElementById('reader');
  readerEl.innerHTML = `
    <div class="scanner-loading">
      <div class="scanner-loading-spinner"></div>
      <div class="scanner-loading-text">Starting camera&hellip;</div>
    </div>
  `;

  html5QrCode = new Html5Qrcode("reader");
  const config = {
    fps: 10,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      return {
        width: Math.min(Math.floor(viewfinderWidth * 0.92), 500),
        height: Math.min(Math.floor(viewfinderHeight * 0.25), 120)
      };
    },
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  html5QrCode.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      stopScanner();
      const found = findProduct(decodedText) || findByFuzzy(decodedText, products);
      if (found) {
        openProductOverlay(found.upc);
      } else {
        const removed = findByFuzzy(decodedText, removedProducts);
        if (removed) {
          showToast(`Removed from planogram: ${removed.name}`, 2500, 'warning');
        } else {
          showToast(`Product ${decodedText} not found`, 2500, 'warning');
        }
        setTimeout(() => startScanner(), 1500);
      }
    },
    (errorMessage) => {
      // ignore per-frame decode failures
    }
  ).then(() => {
    setupTorchButton();
  }).catch(err => {
    console.error(err);
    readerEl.innerHTML = `
      <div class="scanner-loading">
        <div class="scanner-loading-text">Camera error or permission denied.</div>
      </div>
    `;
  });
}

let torchOn = false;

function setupTorchButton() {
  const btn = document.getElementById('torch-toggle');
  if (!btn || !html5QrCode) return;
  try {
    const track = html5QrCode.getRunningTrackSettings && html5QrCode.getRunningTrackCameraCapabilities
      ? null : null;
    const videoElement = document.querySelector('#reader video');
    if (!videoElement) return;
    const stream = videoElement.srcObject;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    const caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    if (!caps.torch) return;
    btn.style.display = 'flex';
    btn.onclick = () => {
      torchOn = !torchOn;
      videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
      btn.classList.toggle('active', torchOn);
    };
  } catch (e) {
    console.warn('Torch not available:', e);
  }
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      html5QrCode = null;
    }).catch(err => console.error(err));
  }
  torchOn = false;
  const torchBtn = document.getElementById('torch-toggle');
  if (torchBtn) {
    torchBtn.style.display = 'none';
    torchBtn.classList.remove('active');
  }
}

function normalizeUpcInput(value) {
  return value.replace(/^0+/, '');
}

function getUpcCandidates(raw) {
  const cleanScan = normalizeUpcInput(raw);
  const scanNoCheck = cleanScan.length > 1 ? cleanScan.slice(0, -1) : cleanScan;
  return { cleanScan, scanNoCheck, candidates: [cleanScan, scanNoCheck] };
}

function findByFuzzy(upc, items) {
  const { cleanScan, scanNoCheck, candidates } = getUpcCandidates(upc);

  return items.find(p => {
    const pUpc = normalizeUpcInput(p.upc);
    if (candidates.includes(pUpc)) return true;
    if (pUpc === scanNoCheck) return true;

    if (pUpc.length > 8 && (pUpc.startsWith(cleanScan) || cleanScan.startsWith(pUpc))) {
      if (Math.abs(pUpc.length - cleanScan.length) === 1) return true;
    }

    return false;
  });
}

function findAllFuzzy(query, items) {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];

  const isNumeric = /^\d+$/.test(raw);

  if (isNumeric && raw.length < 4) return [];

  const qNorm = normalizeUpcInput(raw);

  const scored = [];
  for (const p of items) {
    const pUpc = normalizeUpcInput(p.upc);
    const pUpcFull = p.upc.toLowerCase();
    const pName = (p.name || '').toLowerCase();
    let score = 0;

    if (pUpc === qNorm) { score = 100; }
    else if (pUpc.endsWith(qNorm)) { score = 90; }
    else if (pUpc.startsWith(qNorm)) { score = 80; }
    else if (pUpc.includes(raw) || pUpcFull.includes(raw)) { score = 70; }
    else if (pName.includes(raw)) { score = 50; }
    else if (raw.length >= 4) {
      const noCheck = qNorm.length > 1 ? qNorm.slice(0, -1) : qNorm;
      if (pUpc.endsWith(noCheck) || pUpc.includes(noCheck)) { score = 40; }
    }

    if (score > 0) scored.push({ product: p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.product.position - b.product.position);
  return scored.map(s => s.product);
}

// Search & Overlay
function handleUpcSearch(upc, fromScanner = false) {
  const resultDiv = document.getElementById('upc-result');

  let found = findProduct(upc);
  let redirectInfo = null;

  if (found) {
    const reverseRedirect = findReverseRedirect(found.upc);
    if (reverseRedirect) {
      redirectInfo = { old: reverseRedirect.oldUpc, new: found.upc };
    }
    openProductOverlay(found.upc, redirectInfo);
    if (resultDiv) resultDiv.innerHTML = '';
    return;
  }

  const { candidates } = getUpcCandidates(upc);
  for (let old in upcRedirects) {
    const cleanOld = normalizeUpcInput(old);
    if (candidates.includes(cleanOld)) {
      const newUpc = upcRedirects[old];
      found = findProduct(newUpc);
      if (found) {
        redirectInfo = { old: upc, new: newUpc };
        openProductOverlay(found.upc, redirectInfo);
        if (resultDiv) resultDiv.innerHTML = '';
        return;
      }
    }
  }

  const matches = findAllFuzzy(upc, products);
  const removedMatches = findAllFuzzy(upc, removedProducts);

  if (matches.length === 1) {
    openProductOverlay(matches[0].upc);
    if (resultDiv) resultDiv.innerHTML = '';
    return;
  }

  if (fromScanner) switchToTab('upc');

  if (matches.length > 1) {
    resultDiv.innerHTML = `
      <div class="upc-results-header">${matches.length} products found</div>
      <div class="upc-results-list">
        ${matches.map(p => `
          <div class="upc-result-item" onclick="openProductOverlay('${p.upc}')">
            <img src="images/${p.upc}.webp" class="upc-result-thumb" onerror="this.style.display='none'">
            <div class="upc-result-info">
              <div class="upc-result-name">${p.name}</div>
              <div class="upc-result-detail">UPC: ${p.upc.replace(/^0+/, '')} · Side ${p.segment} · Shelf ${p.shelf} · Pos ${p.position}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  if (removedMatches.length > 0) {
    showRemovedWarning(removedMatches[0], fromScanner);
    return;
  }

  resultDiv.innerHTML = `<div class="upc-no-results">No products found for "${upc}"</div>`;
}

function findReverseRedirect(productUpc) {
  const cleanProduct = normalizeUpcInput(productUpc);
  for (let old in upcRedirects) {
    const newUpc = normalizeUpcInput(upcRedirects[old]);
    if (newUpc === cleanProduct) {
      return { oldUpc: normalizeUpcInput(old), newUpc: cleanProduct };
    }
  }
  return null;
}

function showRemovedWarning(product, fromScanner = false) {
  const existing = document.getElementById('removed-warning-overlay');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'removed-warning-overlay';
  div.className = 'removed-warning-overlay';
  div.innerHTML = `
    <div class="removed-warning-card">
      <div class="removed-warning-icon">&#x26D4;</div>
      <div class="removed-warning-title">ITEM REMOVED FROM PLANOGRAM</div>
      <div class="removed-warning-name">${product.name}</div>
      <div class="removed-warning-upc">UPC: ${product.upc}</div>
      <div class="removed-warning-note">This product is no longer on the current planogram. Do not place on shelf.</div>
      <div class="removed-warning-buttons">
        <button class="btn-primary removed-warning-dismiss" id="removed-dismiss-btn">Dismiss</button>
        <button class="btn-primary removed-warning-scan-another" id="removed-scan-btn">Scan Another</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  document.getElementById('removed-dismiss-btn').onclick = () => {
    div.remove();
  };
  document.getElementById('removed-scan-btn').onclick = () => {
    div.remove();
    switchToTab('scan');
  };

  setTimeout(() => {
    const el = document.getElementById('removed-warning-overlay');
    if (el) el.remove();
  }, 8000);
}

function findProduct(upc) {
  // Direct lookup
  // We need to account for the fact that findProduct is called with "newUpc" from redirect
  // which comes from the JSON value.
  return products.find(p => p.upc === upc);
}

function openProductOverlay(upc, redirect=null) {
  const p = findProduct(upc);
  if (!p) return;
  
  // Create overlay
  const div = document.createElement('div');
  div.innerHTML = productOverlayTemplate(p, redirect);
  document.body.appendChild(div.firstElementChild);
  
  // Render mini pog
  renderMiniPog(p);
  
  // Events
  document.getElementById('close-overlay').onclick = () => {
    document.querySelector('.overlay').remove();
    switchToTab('browse');
  };

  document.getElementById('view-pdf').onclick = () => {
    openPdfViewer(p.upc.replace(/^0+/, ''));
  };

  document.getElementById('scan-another').onclick = () => {
    document.querySelector('.overlay').remove();
    switchToTab('scan');
  };

  document.getElementById('return-browse').onclick = () => {
    document.querySelector('.overlay').remove();
    focusProductInBrowse(p);
  };

  const detailImg = document.getElementById('detail-img');
  if (detailImg) {
    detailImg.onclick = () => openImageLightbox(detailImg.src);
  }
}

function openImageLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'image-lightbox';
  lb.innerHTML = `
    <button class="image-lightbox-close">✕</button>
    <img src="${src}" class="image-lightbox-img">
  `;
  document.body.appendChild(lb);
  lb.querySelector('.image-lightbox-close').onclick = () => lb.remove();
  lb.onclick = (e) => { if (e.target === lb) lb.remove(); };
}

function focusProductInBrowse(product) {
  const browseView = document.getElementById('browse-view');
  if (!browseView || !product) return;

  // Switch to browse tab
  const tabs = document.querySelectorAll('.tab-btn');
  const views = {
    'browse': browseView,
    'scan': document.getElementById('scan-view'),
    'upc': document.getElementById('upc-view')
  };

  tabs.forEach(b => b.classList.remove('active'));
  const browseTab = document.querySelector('.tab-btn[data-tab="browse"]');
  if (browseTab) browseTab.classList.add('active');

  Object.values(views).forEach(v => {
    if (v) v.style.display = 'none';
  });
  browseView.style.display = 'block';
  stopScanner();

  // Navigate to product side and shelf
  currentSide = product.segment;
  renderShelves();
  renderBottomNav();

  setTimeout(() => {
    const shelfRow = document.getElementById(`shelf-row-${product.shelf}`);
    const cards = browseView.querySelectorAll(`.product-card-shelf[data-upc="${product.upc}"]`);
    const targetCard = cards.length > 0 ? cards[0] : null;

    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

      const scrollSettleMs = planogram.id === 'endcap' ? 600 : 100;
      setTimeout(() => {
        cards.forEach(card => {
          card.classList.add('highlight-flash');
          card.addEventListener('animationend', () => {
            card.classList.remove('highlight-flash');
          }, { once: true });
        });
      }, scrollSettleMs);
    } else if (shelfRow) {
      shelfRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 0);
}

function renderMiniPog(activeProduct) {
  const container = document.getElementById('mini-pog-container');
  // Render current side shelves
  const sideProds = products.filter(p => p.segment === activeProduct.segment);
  
  let html = '';
  for (let s = planogram.shelves; s >= 1; s--) {
    const shelfItems = sideProds.filter(p => p.shelf === s).sort((a,b) => a.position - b.position);
    
    let itemsHtml = '';
    shelfItems.forEach(item => {
      const isTarget = item.upc === activeProduct.upc;
      // flex-grow based on facings
      itemsHtml += `<div class="mini-item ${isTarget ? 'highlight' : ''}" style="flex: ${item.facings}"></div>`;
    });
    
    html += `<div class="mini-shelf" style="display:flex; gap:1px;">${itemsHtml}</div>`;
  }
  container.innerHTML = html;
}

function openPdfViewer(searchTerm) {
  if (document.getElementById('pdf-viewer')) closePdfViewer();

  const file = planogram.id === 'pallet' ? 'pallet.pdf' : 'endcap.pdf';
  const url = `pdfs/${file}`;

  const div = document.createElement('div');
  div.innerHTML = pdfViewerTemplate();
  document.body.appendChild(div.firstElementChild);
  document.body.style.overflow = 'hidden';

  document.addEventListener('keydown', handlePdfKeydown);
  initPdfViewer(url, searchTerm || null);
}

async function initPdfViewer(url, searchTerm) {
  const loadingEl = document.getElementById('pdf-loading');
  try {
    await pdfjsReadyPromise;
    const pdfjsLib = window.pdfjsLib;
    const pdf = await pdfjsLib.getDocument(url).promise;

    pdfState = {
      pdf,
      currentPage: 1,
      totalPages: pdf.numPages,
      scale: 0,
      baseScale: 1,
      pageTextData: new Map(),
      searchResults: [],
      currentSearchIdx: -1,
      thumbsRendered: new Set(),
      renderTask: null,
    };

    loadingEl.style.display = 'none';
    document.getElementById('pdf-page-total').textContent = `/ ${pdf.numPages}`;
    document.getElementById('pdf-page-input').max = pdf.numPages;

    setupPdfToolbar();
    setupPdfSwipeGestures();
    setupPdfPinchZoom();
    await pdfRenderPage(1);
    pdfExtractAllText();

    if (searchTerm) {
      pdfToggleSearch(true);
      document.getElementById('pdf-search-input').value = searchTerm;
      let waited = 0;
      const waitForText = setInterval(() => {
        waited += 100;
        if (!pdfState) { clearInterval(waitForText); return; }
        if (pdfState.pageTextData.size >= pdfState.totalPages || waited > 5000) {
          clearInterval(waitForText);
          pdfPerformSearch(searchTerm);
        }
      }, 100);
    }
  } catch (err) {
    console.error('Failed to load PDF:', err);
    loadingEl.textContent = 'Failed to load PDF. Please try again.';
  }
}

function closePdfViewer() {
  document.removeEventListener('keydown', handlePdfKeydown);
  const viewer = document.getElementById('pdf-viewer');
  if (viewer) viewer.remove();
  if (pdfState?.renderTask) {
    pdfState.renderTask.cancel().catch(() => {});
  }
  pdfState = null;
  document.body.style.overflow = '';
}

function handlePdfKeydown(e) {
  if (!pdfState) return;
  if (e.key === 'Escape') closePdfViewer();
  if (e.key === 'ArrowRight') pdfGoToPage(pdfState.currentPage + 1);
  if (e.key === 'ArrowLeft') pdfGoToPage(pdfState.currentPage - 1);
}

// ===== PDF RENDERING =====

async function pdfRenderPage(pageNum) {
  if (!pdfState) return;
  if (pdfState.renderTask) {
    pdfState.renderTask.cancel().catch(() => {});
    pdfState.renderTask = null;
  }

  const page = await pdfState.pdf.getPage(pageNum);
  const content = document.getElementById('pdf-content');
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');

  const unscaledVP = page.getViewport({ scale: 1 });
  const contentWidth = content.clientWidth - 16;
  pdfState.baseScale = contentWidth / unscaledVP.width;

  if (pdfState.scale === 0) pdfState.scale = pdfState.baseScale;

  const viewport = page.getViewport({ scale: pdfState.scale });
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';
  ctx.scale(dpr, dpr);

  try {
    pdfState.renderTask = page.render({ canvasContext: ctx, viewport });
    await pdfState.renderTask.promise;
  } catch (err) {
    if (err.name !== 'RenderingCancelledException') console.error('Render error:', err);
    return;
  }

  pdfState.renderTask = null;
  pdfState.currentPage = pageNum;
  document.getElementById('pdf-page-input').value = pageNum;
  pdfUpdateZoomDisplay();
  pdfRenderHighlights(pageNum);
  pdfUpdateThumbHighlight();
  content.scrollTop = 0;
}

function pdfGoToPage(pageNum) {
  if (!pdfState) return;
  pageNum = Math.max(1, Math.min(pdfState.totalPages, pageNum));
  if (pageNum === pdfState.currentPage) return;
  pdfRenderPage(pageNum);
}

function pdfSetScale(newScale) {
  if (!pdfState) return;
  pdfState.scale = Math.max(0.25, Math.min(5, newScale));
  pdfRenderPage(pdfState.currentPage);
}

function pdfUpdateZoomDisplay() {
  if (!pdfState) return;
  const pct = Math.round((pdfState.scale / pdfState.baseScale) * 100);
  const el = document.getElementById('pdf-zoom-level');
  if (el) el.textContent = pct + '%';
}

// ===== PDF TOOLBAR =====

function setupPdfToolbar() {
  document.getElementById('pdf-close').onclick = closePdfViewer;

  document.getElementById('pdf-prev').onclick = () => pdfGoToPage(pdfState.currentPage - 1);
  document.getElementById('pdf-next').onclick = () => pdfGoToPage(pdfState.currentPage + 1);

  const pageInput = document.getElementById('pdf-page-input');
  pageInput.onchange = () => pdfGoToPage(parseInt(pageInput.value) || 1);
  pageInput.onkeydown = (e) => {
    if (e.key === 'Enter') { pageInput.blur(); pdfGoToPage(parseInt(pageInput.value) || 1); }
  };

  document.getElementById('pdf-zoom-out').onclick = () => pdfSetScale(pdfState.scale / 1.25);
  document.getElementById('pdf-zoom-in').onclick = () => pdfSetScale(pdfState.scale * 1.25);
  document.getElementById('pdf-fit-btn').onclick = () => {
    pdfState.scale = 0;
    pdfRenderPage(pdfState.currentPage);
  };

  document.getElementById('pdf-search-toggle').onclick = () => pdfToggleSearch();
  document.getElementById('pdf-thumbs-toggle').onclick = () => pdfToggleThumbs();

  // Search handlers
  document.getElementById('pdf-search-close').onclick = () => pdfToggleSearch(false);

  let searchDebounce;
  const searchInput = document.getElementById('pdf-search-input');
  searchInput.oninput = (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => pdfPerformSearch(e.target.value.trim()), 300);
  };
  searchInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchDebounce);
      if (pdfState && pdfState.searchResults.length > 0) {
        const idx = (pdfState.currentSearchIdx + 1) % pdfState.searchResults.length;
        pdfNavigateToMatch(idx);
      } else {
        pdfPerformSearch(e.target.value.trim());
      }
    }
  };

  document.getElementById('pdf-search-prev').onclick = () => {
    if (pdfState && pdfState.searchResults.length > 0) {
      const idx = (pdfState.currentSearchIdx - 1 + pdfState.searchResults.length) % pdfState.searchResults.length;
      pdfNavigateToMatch(idx);
    }
  };
  document.getElementById('pdf-search-next').onclick = () => {
    if (pdfState && pdfState.searchResults.length > 0) {
      const idx = (pdfState.currentSearchIdx + 1) % pdfState.searchResults.length;
      pdfNavigateToMatch(idx);
    }
  };
}

// ===== PDF SEARCH =====

function pdfToggleSearch(forceOpen) {
  const bar = document.getElementById('pdf-search-bar');
  const shouldOpen = forceOpen !== undefined ? forceOpen : bar.classList.contains('hidden');
  bar.classList.toggle('hidden', !shouldOpen);
  if (shouldOpen) {
    const input = document.getElementById('pdf-search-input');
    input.focus();
    input.select();
  } else {
    pdfState.searchResults = [];
    pdfState.currentSearchIdx = -1;
    document.getElementById('pdf-search-count').textContent = '';
    pdfRenderHighlights(pdfState?.currentPage);
  }
}

async function pdfExtractAllText() {
  if (!pdfState) return;
  for (let i = 1; i <= pdfState.totalPages; i++) {
    if (!pdfState) return;
    const page = await pdfState.pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(item => item.str);
    const fullText = items.map(item => item.str).join('\n');

    let offset = 0;
    const itemOffsets = items.map((item, idx) => {
      const entry = { idx, start: offset, end: offset + item.str.length };
      offset += item.str.length + 1;
      return entry;
    });

    pdfState.pageTextData.set(i, { items, fullText, itemOffsets });
  }
}

function pdfPerformSearch(query) {
  if (!pdfState || !query) {
    if (pdfState) {
      pdfState.searchResults = [];
      pdfState.currentSearchIdx = -1;
    }
    document.getElementById('pdf-search-count').textContent = query ? 'Extracting...' : '';
    pdfRenderHighlights(pdfState?.currentPage);
    return;
  }

  const results = [];
  const lowerQuery = query.toLowerCase();

  for (let pageNum = 1; pageNum <= pdfState.totalPages; pageNum++) {
    const data = pdfState.pageTextData.get(pageNum);
    if (!data) continue;
    const lowerText = data.fullText.toLowerCase();
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      const matchEnd = pos + lowerQuery.length;
      const matchedItems = data.itemOffsets.filter(io => io.start < matchEnd && io.end > pos);
      results.push({ pageNum, start: pos, end: matchEnd, items: matchedItems });
      pos += 1;
    }
  }

  pdfState.searchResults = results;
  pdfState.currentSearchIdx = results.length > 0 ? 0 : -1;
  pdfUpdateSearchCount();

  if (results.length > 0) {
    pdfNavigateToMatch(0);
  } else {
    pdfRenderHighlights(pdfState.currentPage);
  }
}

function pdfNavigateToMatch(idx) {
  if (!pdfState || idx < 0 || idx >= pdfState.searchResults.length) return;
  pdfState.currentSearchIdx = idx;
  pdfUpdateSearchCount();
  const match = pdfState.searchResults[idx];
  if (match.pageNum !== pdfState.currentPage) {
    pdfRenderPage(match.pageNum);
  } else {
    pdfRenderHighlights(match.pageNum);
  }
}

function pdfUpdateSearchCount() {
  const el = document.getElementById('pdf-search-count');
  if (!el || !pdfState) return;
  const total = pdfState.searchResults.length;
  el.textContent = total === 0 ? 'No matches' : `${pdfState.currentSearchIdx + 1} / ${total}`;
}

async function pdfRenderHighlights(pageNum) {
  const container = document.getElementById('pdf-highlights');
  if (!container || !pdfState) return;
  container.innerHTML = '';
  if (pdfState.searchResults.length === 0) return;

  const pageMatches = pdfState.searchResults.filter(r => r.pageNum === pageNum);
  if (pageMatches.length === 0) return;

  const data = pdfState.pageTextData.get(pageNum);
  if (!data) return;

  const page = await pdfState.pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: pdfState.scale });

  pageMatches.forEach(match => {
    const isActive = pdfState.searchResults[pdfState.currentSearchIdx] === match;
    match.items.forEach(io => {
      const item = data.items[io.idx];
      if (!item) return;
      const rect = pdfGetItemRect(item, viewport);
      const div = document.createElement('div');
      div.className = 'pdf-highlight' + (isActive ? ' active' : '');
      div.style.left = rect.left + 'px';
      div.style.top = rect.top + 'px';
      div.style.width = rect.width + 'px';
      div.style.height = rect.height + 'px';
      container.appendChild(div);

      if (isActive) {
        const content = document.getElementById('pdf-content');
        const cRect = content.getBoundingClientRect();
        if (rect.top < content.scrollTop || rect.top > content.scrollTop + cRect.height) {
          content.scrollTop = rect.top - cRect.height / 3;
        }
      }
    });
  });
}

function pdfGetItemRect(item, viewport) {
  const tx = item.transform[4];
  const ty = item.transform[5];
  const [left, bottom] = viewport.convertToViewportPoint(tx, ty);
  const fontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
  const height = fontSize * viewport.scale;
  const width = item.width * viewport.scale;
  return {
    left,
    top: bottom - height,
    width: Math.max(width, 20),
    height: Math.max(height, 10),
  };
}

// ===== PDF THUMBNAILS =====

function pdfToggleThumbs(forceOpen) {
  const panel = document.getElementById('pdf-thumbs-panel');
  const shouldOpen = forceOpen !== undefined ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  if (shouldOpen) {
    pdfRenderThumbnails();
    pdfUpdateThumbHighlight();
  }
}

function pdfRenderThumbnails() {
  const grid = document.getElementById('pdf-thumbs-grid');
  if (!grid || !pdfState || grid.children.length > 0) return;

  document.getElementById('pdf-thumbs-close').onclick = () => pdfToggleThumbs(false);

  for (let i = 1; i <= pdfState.totalPages; i++) {
    const thumb = document.createElement('div');
    thumb.className = 'pdf-thumb';
    thumb.dataset.page = i;
    thumb.innerHTML = `<canvas class="pdf-thumb-canvas"></canvas><span class="pdf-thumb-label">${i}</span>`;
    thumb.onclick = () => { pdfToggleThumbs(false); pdfGoToPage(i); };
    grid.appendChild(thumb);
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page);
        if (!pdfState.thumbsRendered.has(pageNum)) {
          pdfRenderSingleThumb(pageNum, entry.target.querySelector('canvas'));
          pdfState.thumbsRendered.add(pageNum);
        }
        observer.unobserve(entry.target);
      }
    });
  }, { root: document.getElementById('pdf-thumbs-panel'), threshold: 0.1 });

  grid.querySelectorAll('.pdf-thumb').forEach(t => observer.observe(t));
}

async function pdfRenderSingleThumb(pageNum, canvas) {
  if (!pdfState) return;
  const page = await pdfState.pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 0.3 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}

function pdfUpdateThumbHighlight() {
  if (!pdfState) return;
  document.querySelectorAll('.pdf-thumb').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.page) === pdfState.currentPage);
  });
}

// ===== PDF GESTURES =====

function setupPdfSwipeGestures() {
  const content = document.getElementById('pdf-content');
  if (!content) return;
  let startX = 0, startY = 0;

  content.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  content.addEventListener('touchend', (e) => {
    if (!pdfState || e.changedTouches.length !== 1) return;
    const deltaX = e.changedTouches[0].clientX - startX;
    const deltaY = e.changedTouches[0].clientY - startY;
    if (Math.abs(deltaX) > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
      const pageContainer = document.getElementById('pdf-page-container');
      if (pageContainer && pageContainer.scrollWidth > content.clientWidth + 10) return;
      if (deltaX < 0) pdfGoToPage(pdfState.currentPage + 1);
      else pdfGoToPage(pdfState.currentPage - 1);
    }
  }, { passive: true });
}

function setupPdfPinchZoom() {
  const content = document.getElementById('pdf-content');
  const canvas = document.getElementById('pdf-canvas');
  if (!content || !canvas) return;
  let initialDist = 0, initialScale = 0;

  content.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && pdfState) {
      initialDist = pdfTouchDistance(e.touches);
      initialScale = pdfState.scale;
      e.preventDefault();
    }
  }, { passive: false });

  content.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialDist > 0) {
      const ratio = pdfTouchDistance(e.touches) / initialDist;
      const cssScale = Math.max(0.25, Math.min(5, initialScale * ratio)) / pdfState.scale;
      canvas.style.transform = `scale(${cssScale})`;
      canvas.style.transformOrigin = 'center center';
      e.preventDefault();
    }
  }, { passive: false });

  content.addEventListener('touchend', (e) => {
    if (initialDist > 0 && e.touches.length < 2) {
      const m = canvas.style.transform.match(/scale\((.+?)\)/);
      if (m) {
        canvas.style.transform = '';
        pdfSetScale(pdfState.scale * parseFloat(m[1]));
      }
      initialDist = 0;
    }
  }, { passive: true });
}

function pdfTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function findScrollParent(el) {
  while (el && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function setupPullDownProtection() {
  let startX = 0;
  let startY = 0;
  let gestureDecided = false;
  let blockThisGesture = false;

  let threeFingerActive = false;
  let threeFingerStartY = 0;
  let threeFingerLastY = 0;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      gestureDecided = false;
      blockThisGesture = false;
    }
    if (e.touches.length >= 3) {
      threeFingerActive = true;
      threeFingerStartY = avgTouchY(e.touches);
      threeFingerLastY = threeFingerStartY;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (threeFingerActive && e.touches.length >= 3) {
      threeFingerLastY = avgTouchY(e.touches);
      return;
    }

    if (e.touches.length !== 1) return;

    if (!gestureDecided) {
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;

      if (Math.abs(deltaY) < 10 && Math.abs(deltaX) < 10) return;

      gestureDecided = true;

      if (deltaY > 0 && Math.abs(deltaY) >= Math.abs(deltaX)) {
        const scrollParent = findScrollParent(e.target);
        blockThisGesture = !scrollParent || scrollParent.scrollTop <= 0;
      }
    }

    if (blockThisGesture) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (threeFingerActive && e.touches.length === 0) {
      if (threeFingerLastY - threeFingerStartY > 80) {
        location.reload();
      }
      threeFingerActive = false;
    }
  }, { passive: true });
}

function avgTouchY(touches) {
  let sum = 0;
  for (let i = 0; i < touches.length; i++) sum += touches[i].clientY;
  return sum / touches.length;
}

// Start
setupPullDownProtection();
init();

// SW Update
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});
