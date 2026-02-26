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
    <button class="torch-btn" id="torch-toggle" style="display:none">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4.95 11.95l.88.88A2 2 0 0 1 8.5 16h7a2 2 0 0 1 .57-1.17l.88-.88A7 7 0 0 0 12 2z"/></svg>
    </button>
  </div>
  
  <div class="upc-view" id="upc-view">
    <div class="upc-input-group">
      <input type="text" class="upc-input" id="manual-upc" placeholder="Enter UPC (e.g. 8680068785)">
      <button class="btn-primary" id="lookup-upc">Search</button>
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
          ⚠️ UPC Changed — Old: ${redirect.old} → New: ${redirect.new}
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
      
      <div class="mini-pog" id="mini-pog-container"></div>
      
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
        ${p.isChange ? '<span class="overlay-badge change">CHANGE</span>' : ''}
        ${p.isMove ? '<span class="overlay-badge move">MOVE</span>' : ''}
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
const BASE_PX_PER_IN = 7;

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
  setupPullDownProtection();

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

  document.getElementById('lookup-upc').addEventListener('click', () => {
    const input = document.getElementById('manual-upc').value.trim();
    if (input) handleUpcSearch(input);
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

const SHELF_SCALE_OVERRIDES = {
  "4-2": 1.5,
  "2-1": 1.5,
};

function renderShelves() {
  const container = document.getElementById('browse-view');
  container.innerHTML = '';

  const sideProducts = products.filter(p => p.segment === currentSide);
  const maxShelf = planogram.shelves;

  const shelves = [];
  let maxShelfWidthIn = 0;

  for (let s = maxShelf; s >= 1; s--) {
    const allShelfProducts = sideProducts
      .filter(p => p.shelf === s)
      .sort((a, b) => a.position - b.position);

    const totalFacings = allShelfProducts.reduce((acc, p) => acc + p.facings, 0);
    const shelfWidthIn = allShelfProducts.reduce(
      (acc, p) => acc + getProductWidthIn(p) * p.facings,
      0
    );
    maxShelfWidthIn = Math.max(maxShelfWidthIn, shelfWidthIn);

    shelves.push({ s, allShelfProducts, totalFacings, shelfWidthIn });
  }

  const targetRowWidthPx = getTargetRowWidthPx(container, maxShelfWidthIn);

  shelves.forEach(({ s, allShelfProducts, totalFacings, shelfWidthIn }) => {
    const shelfDiv = document.createElement('div');
    shelfDiv.className = 'shelf-container';

    const label = s === maxShelf ? 'TOP' : (s === 1 ? 'BOTTOM' : '');

    let shelfScale = shelfWidthIn > 0
      ? targetRowWidthPx / shelfWidthIn
      : BASE_PX_PER_IN;

    const overrideKey = `${currentSide}-${s}`;
    const boost = SHELF_SCALE_OVERRIDES[overrideKey];

    const visibleProducts = allShelfProducts.filter(p => {
      if (currentFilter === 'new') return p.isNew;
      if (currentFilter === 'srp') return p.srp;
      return true;
    });
    const visibleFacings = visibleProducts.reduce((acc, p) => acc + p.facings, 0);

    const cardsHtml = allShelfProducts.map(p => {
      const isVisible = currentFilter === 'all' ||
        (currentFilter === 'new' && p.isNew) ||
        (currentFilter === 'srp' && p.srp);
      return createProductCard(p, !isVisible, boost);
    }).join('');

    shelfDiv.innerHTML = `
      <div class="product-shelf-row" id="shelf-row-${s}">
        ${cardsHtml}
      </div>
      <div class="shelf-header">
        <span>Shelf ${s} ${label}</span>
        <span>${visibleProducts.length} items · ${visibleFacings} facings</span>
      </div>
    `;

    container.appendChild(shelfDiv);

    const row = document.getElementById(`shelf-row-${s}`);
    if (row) {
      row.style.setProperty('--row-width', `${targetRowWidthPx}px`);
      row.style.setProperty('--inch-scale', `${shelfScale}px`);
    }
  });
}

function createProductCard(p, hidden = false, boost = null) {
  let imagesHtml = '';
  for (let i = 0; i < p.facings; i++) {
    imagesHtml += `<img src="images/${p.upc}.webp" class="product-img" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'50%\\' x=\\'50%\\' dy=\\'0.35em\\' text-anchor=\\'middle\\' font-size=\\'80\\'>☀️</text></svg>'">`;
  }

  const boostStyle = boost ? `--shelf-boost: ${boost};` : '';
  const hiddenStyle = hidden ? ' visibility: hidden;' : '';

  return `
    <div class="product-card-shelf${boost ? ' boosted' : ''}" data-upc="${p.upc}" style="--facings: ${p.facings}; --width-in: ${getProductWidthIn(p)}; --height-in: ${getProductHeightIn(p)};${boostStyle}${hiddenStyle}" onclick="openProductOverlay('${p.upc}')">
      <div class="product-img-group">
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
  
  let touchStartX = 0;
  let touchEndX = 0;
  let touchStartY = 0;
  let touchEndY = 0;
  
  const view = document.getElementById('browse-view');
  const edgeThreshold = 32;
  
  view.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  });
  
  view.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  });
  
  function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipe = 200;
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 2;
    const isEdgeSwipe =
      touchStartX <= edgeThreshold ||
      touchStartX >= window.innerWidth - edgeThreshold;

    if (isHorizontal && isEdgeSwipe && deltaX < -minSwipe) {
      // Swipe Left -> Next Side
      if (currentSide < planogram.sides) changeSide(currentSide + 1);
    }
    if (isHorizontal && isEdgeSwipe && deltaX > minSwipe) {
      // Swipe Right -> Prev Side
      if (currentSide > 1) changeSide(currentSide - 1);
    }
  }
}

// Scanner
let torchOn = false;

function startScanner() {
  if (html5QrCode) return;

  const readerEl = document.getElementById('reader');
  readerEl.innerHTML = '';

  html5QrCode = new Html5Qrcode("reader");
  const config = {
    fps: 10,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      return {
        width: Math.min(Math.floor(viewfinderWidth * 0.92), 500),
        height: Math.min(Math.floor(viewfinderHeight * 0.25), 120)
      };
    },
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true
    }
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
    () => {}
  ).then(() => {
    setupTorchButton();
  }).catch(err => {
    console.error(err);
    readerEl.innerHTML = "Camera error or permission denied.";
  });
}

function setupTorchButton() {
  const torchBtn = document.getElementById('torch-toggle');
  if (!torchBtn || !html5QrCode) return;

  try {
    const videoEl = document.querySelector('#reader video');
    if (!videoEl || !videoEl.srcObject) return;
    const track = videoEl.srcObject.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities();
    if (capabilities && capabilities.torch) {
      torchBtn.style.display = 'flex';
      torchOn = false;
      torchBtn.onclick = () => {
        torchOn = !torchOn;
        track.applyConstraints({ advanced: [{ torch: torchOn }] });
        torchBtn.classList.toggle('active', torchOn);
      };
    }
  } catch (e) {
    // Torch not supported
  }
}

function stopScanner() {
  torchOn = false;
  const torchBtn = document.getElementById('torch-toggle');
  if (torchBtn) {
    torchBtn.style.display = 'none';
    torchBtn.classList.remove('active');
  }
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

// Search & Overlay
function handleUpcSearch(upc) {
  let found = findProduct(upc);
  let redirectInfo = null;
  
  if (!found) {
    const { candidates } = getUpcCandidates(upc);
    
    // Check against redirect keys too (which might need normalization)
    for (let old in upcRedirects) {
      const cleanOld = normalizeUpcInput(old);
      if (candidates.includes(cleanOld)) {
        const newUpc = upcRedirects[old];
        found = findProduct(newUpc);
        if (found) {
          redirectInfo = { old: upc, new: newUpc };
          break;
        }
      }
    }
    
    if (!found) {
      found = findByFuzzy(upc, products);
    }
  }
  
  if (found) {
    openProductOverlay(found.upc, redirectInfo);
  } else {
    const removed = findByFuzzy(upc, removedProducts);
    if (removed) {
      showToast(`Removed from planogram: ${removed.name}`, 2500, 'warning');
      return;
    }
    alert(`Product ${upc} not found on this planogram.`);
  }
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

  const div = document.createElement('div');
  div.innerHTML = productOverlayTemplate(p, redirect);
  document.body.appendChild(div.firstElementChild);

  renderMiniPog(p);

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

  document.getElementById('detail-img').onclick = () => {
    openImageLightbox(`images/${p.upc}.webp`);
  };
}

function focusProductInBrowse(product) {
  const browseView = document.getElementById('browse-view');
  if (!browseView || !product) return;

  switchToTab('browse');
  currentSide = product.segment;
  renderShelves();
  renderBottomNav();

  setTimeout(() => {
    const shelfRow = document.getElementById(`shelf-row-${product.shelf}`);
    if (shelfRow) {
      shelfRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 0);
}

function switchToTab(tabName) {
  const tabs = document.querySelectorAll('.tab-btn');
  const views = {
    'browse': document.getElementById('browse-view'),
    'scan': document.getElementById('scan-view'),
    'upc': document.getElementById('upc-view')
  };

  tabs.forEach(b => b.classList.remove('active'));
  const activeTab = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (activeTab) activeTab.classList.add('active');

  Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });
  if (views[tabName]) views[tabName].style.display = tabName === 'scan' ? 'flex' : 'block';

  if (tabName === 'scan') {
    startScanner();
  } else {
    stopScanner();
  }

  if (tabName === 'browse') {
    renderShelves();
  }
}

function openImageLightbox(src) {
  const lightbox = document.createElement('div');
  lightbox.className = 'image-lightbox';
  lightbox.innerHTML = `
    <button class="image-lightbox-close">✕</button>
    <img src="${src}" class="image-lightbox-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'50%\\' x=\\'50%\\' dy=\\'0.35em\\' text-anchor=\\'middle\\' font-size=\\'80\\'>☀️</text></svg>'">
  `;
  document.body.appendChild(lightbox);

  lightbox.querySelector('.image-lightbox-close').onclick = () => lightbox.remove();
  lightbox.onclick = (e) => {
    if (e.target === lightbox) lightbox.remove();
  };
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

function setupPullDownProtection() {
  let startY = 0;
  let tracking = false;
  let armed = false;
  let armedTimer = null;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const target = e.target;
    if (target.closest('.overlay, .pdf-viewer')) return;
    startY = e.touches[0].clientY;
    tracking = window.scrollY === 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const target = e.target;
    if (target.closest('.overlay, .pdf-viewer')) return;

    const deltaY = e.touches[0].clientY - startY;
    if (deltaY > 40) {
      if (!armed) {
        armed = true;
        showToast('Pull down again to refresh');
        clearTimeout(armedTimer);
        armedTimer = setTimeout(() => { armed = false; }, 2000);
        e.preventDefault();
      } else {
        armed = false;
        clearTimeout(armedTimer);
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    tracking = false;
  }, { passive: true });
}

// Start
init();

// SW Update
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});
