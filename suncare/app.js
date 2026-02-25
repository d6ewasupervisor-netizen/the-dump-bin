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
      <div>
        <div class="app-title">☀️ SUNCARE POG LOOKUP</div>
        <div class="store-info">Store ${storeId} · ${pog.pogNumber}</div>
        <button class="btn-change-store" id="change-store">↩ Change Store</button>
      </div>
      <div class="live-date">LIVE ${pog.liveDate}<br>${pog.totalProducts} SKUs · ${pog.sides} Sides</div>
    </div>
    
    <div class="tab-nav">
      <button class="tab-btn active" data-tab="browse">Browse</button>
      <button class="tab-btn" data-tab="scan">Scan</button>
      <button class="tab-btn" data-tab="upc">UPC</button>
    </div>
    
    <div class="filter-chips">
      <div class="chip active" data-filter="all">All</div>
      <div class="chip" data-filter="new">🟢 New</div>
      <div class="chip" data-filter="srp">🟣 SRP</div>
      <div class="chip" id="pog-pdf-chip">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-file-type-pdf"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" /><path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" /><path d="M17 18h2" /><path d="M20 15h-3v6" /><path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1" /></svg>
        POG PDF
      </div>
    </div>
  </header>
`;

const browseTemplate = () => `
  <div class="browse-view" id="browse-view">
    <!-- Shelves injected here -->
  </div>
  
  <div class="scan-view" id="scan-view">
    <div id="reader"></div>
  </div>
  
  <div class="upc-view" id="upc-view">
    <div class="upc-search-container">
      <div class="upc-input-group">
        <div class="upc-input-wrapper">
          <input type="text" class="upc-input" id="manual-upc" placeholder="Enter 4+ digits of UPC or product name" autocomplete="off" inputmode="search">
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
        <img src="images/${p.upc}.webp" class="detail-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'50%\\' x=\\'50%\\' dy=\\'0.35em\\' text-anchor=\\'middle\\' font-size=\\'80\\'>☀️</text></svg>'">
      </div>
      
      <h2 class="detail-title">${p.name}</h2>
      <div class="detail-upc">UPC: ${p.upc.replace(/^0+/, '')}</div>
      
      <div class="badges">
        ${p.isNew ? '<span class="badge new">NEW</span>' : ''}
        ${p.srp ? '<span class="badge srp">SRP</span>' : ''}
        ${p.isChange ? '<span class="badge change">CHANGE</span>' : ''}
        ${p.isMove ? '<span class="badge move">MOVE</span>' : ''}
      </div>
      
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
        POG PDFs
      </button>

      <div class="overlay-nav-buttons">
        <button class="btn-overlay-nav scan-another" id="scan-another">Scan Another</button>
        <button class="btn-overlay-nav return-browse" id="return-browse">See Product</button>
      </div>
    </div>
  </div>
`;

const pdfViewerTemplate = (url) => `
  <div class="pdf-viewer active" id="pdf-viewer">
    <div class="pdf-header">
      <h3>Planogram PDF</h3>
      <button class="close-btn" id="close-pdf">✕</button>
    </div>
    <iframe src="${url}" class="pdf-frame"></iframe>
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
  setupFilters();
  renderShelves();
  renderBottomNav();
  setupGestures();
  setupPdfAccess();

  if (!resizeBound) {
    window.addEventListener('resize', () => {
      if (planogram) renderShelves();
    });
    resizeBound = true;
  }
}

function setupPdfAccess() {
    const pdfChip = document.getElementById('pog-pdf-chip');
    if(pdfChip) {
        pdfChip.addEventListener('click', () => {
             openPdfViewer();
        });
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

  document.getElementById('change-store').addEventListener('click', () => {
    if (confirm('Change store?')) {
      location.reload();
    }
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

function setupFilters() {
  const chips = document.querySelectorAll('.chip:not(#pog-pdf-chip)'); // Exclude PDF button
  chips.forEach(c => {
    c.addEventListener('click', () => {
      chips.forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      currentFilter = c.dataset.filter;
      renderShelves();
    });
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
    const shelfProducts = sideProducts
      .filter(p => p.shelf === s)
      .sort((a, b) => a.position - b.position);

    let displayProducts = shelfProducts;
    if (currentFilter === 'new') displayProducts = displayProducts.filter(p => p.isNew);
    if (currentFilter === 'srp') displayProducts = displayProducts.filter(p => p.srp);

    const facings = displayProducts.reduce((acc, p) => acc + p.facings, 0);
    const shelfWidthIn = displayProducts.reduce(
      (acc, p) => acc + getProductWidthIn(p) * p.facings,
      0
    );

    if (shelfWidthIn > maxShelfWidthIn) {
      maxShelfWidthIn = shelfWidthIn;
      widestShelfItemCount = displayProducts.length;
    }

    shelves.push({ s, displayProducts, facings, shelfWidthIn });
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

  shelves.forEach(({ s, displayProducts, facings, shelfWidthIn }) => {
    const shelfDiv = document.createElement('div');
    shelfDiv.className = 'shelf-container';

    const label = s === maxShelf ? 'TOP' : (s === 1 ? 'BOTTOM' : '');

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
      <div class="shelf-header">
        <span>Shelf ${s} ${label}</span>
        <span>${displayProducts.length} items · ${facings} facings</span>
      </div>
      <div class="product-shelf-row" id="shelf-row-${s}">
        ${displayProducts.map(p => createProductCard(p)).join('')}
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

function createProductCard(p) {
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

  return `
    <div class="product-card-shelf" data-upc="${p.upc}" style="--facings: ${p.facings}; --stack: ${stack}; --width-in: ${getProductWidthIn(p)}; --height-in: ${stackedHeightIn};" onclick="openProductOverlay('${p.upc}')">
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
    html += `<button class="nav-btn ${i === currentSide ? 'active' : ''}" onclick="changeSide(${i})">${i}</button>`;
  }
  nav.innerHTML = html;
}

function changeSide(side) {
  if (side < 1 || side > planogram.sides) return;
  currentSide = side;
  renderShelves();
  renderBottomNav();
  
  // Toast
  showToast(`Side ${side}`);
  
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
  if (html5QrCode) return; // already running
  
  html5QrCode = new Html5Qrcode("reader");
  const config = {
    fps: 10,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      return {
        width: Math.min(Math.floor(viewfinderWidth * 0.85), 400),
        height: Math.min(Math.floor(viewfinderHeight * 0.45), 200)
      };
    }
  };
  
  html5QrCode.start(
    { facingMode: "environment" }, 
    config, 
    (decodedText) => {
      // Success
      stopScanner();
      handleUpcSearch(decodedText);
    },
    (errorMessage) => {
      // ignore
    }
  ).catch(err => {
    console.error(err);
    document.getElementById('reader').innerHTML = "Camera error or permission denied.";
  });
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      html5QrCode = null;
    }).catch(err => console.error(err));
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
  const q = normalizeUpcInput(query).toLowerCase();
  if (!q) return [];

  const isNumeric = /^\d+$/.test(q);

  // Require at least 4 digits for UPC-based matching
  if (isNumeric && q.length < 4) return [];

  const scored = [];
  for (const p of items) {
    const pUpc = normalizeUpcInput(p.upc);
    const pName = (p.name || '').toLowerCase();
    let score = 0;

    if (pUpc === q) { score = 100; }
    else if (pUpc.endsWith(q)) { score = 90; }
    else if (pUpc.startsWith(q)) { score = 80; }
    else if (pUpc.includes(q)) { score = 70; }
    else if (pName.includes(q)) { score = 50; }
    else if (q.length >= 4) {
      const noCheck = q.length > 1 ? q.slice(0, -1) : q;
      if (pUpc.endsWith(noCheck) || pUpc.includes(noCheck)) { score = 40; }
    }

    if (score > 0) scored.push({ product: p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.product.position - b.product.position);
  return scored.map(s => s.product);
}

// Search & Overlay
function handleUpcSearch(upc) {
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
    showRemovedWarning(removedMatches[0]);
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

function showRemovedWarning(product) {
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
      <button class="btn-primary removed-warning-dismiss" onclick="this.closest('.removed-warning-overlay').remove()">Dismiss</button>
    </div>
  `;
  document.body.appendChild(div);

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
    focusProductInBrowse(p);
  };

  document.getElementById('view-pdf').onclick = () => {
    openPdfViewer();
  };

  document.getElementById('scan-another').onclick = () => {
    document.querySelector('.overlay').remove();
    switchToTab('scan');
  };

  document.getElementById('return-browse').onclick = () => {
    document.querySelector('.overlay').remove();
    focusProductInBrowse(p);
  };
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
    if (shelfRow) {
      shelfRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const cards = browseView.querySelectorAll(`.product-card-shelf[data-upc="${product.upc}"]`);
    cards.forEach(card => {
      card.classList.add('highlight-flash');
      card.addEventListener('animationend', () => {
        card.classList.remove('highlight-flash');
      }, { once: true });
    });
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

function openPdfViewer() {
  const file = planogram.id === 'pallet' ? 'pallet.pdf' : 'endcap.pdf';
  const url = `pdfs/${file}`;
  
  const div = document.createElement('div');
  div.innerHTML = pdfViewerTemplate(url);
  document.body.appendChild(div.firstElementChild);
  
  document.getElementById('close-pdf').onclick = () => {
    document.querySelector('.pdf-viewer').remove();
  };
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
