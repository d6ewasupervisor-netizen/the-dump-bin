(function () {
  'use strict';

  function virtualPlanogramZoomNoop() {}
  window.virtualPlanogramZoomFit = virtualPlanogramZoomNoop;
  window.virtualPlanogramZoomStep = virtualPlanogramZoomNoop;

  var PIXELS_PER_INCH = 6;
  var TILE_GAP_PX = 2;
  var MIN_TILE_HEIGHT_PX = 28;
  var EMPTY_BAY_PX = 24;
  var BAY_PADDING_PX = 4;
  /** Left gutter: peg vs shelf labels aligned to fixture stack height. */
  var BAY_RAIL_WIDTH_PX = 28;
  /** Space between rail and fixture column (matches `.planogram-bay-rail` margin). */
  var BAY_RAIL_GAP_PX = 4;
  var SHELF_EMPTY_ROW_PX = 20;
  var FACING_SPLIT_PX = 1;

  /** Persistent across bay navigations within a single planogram session. */
  var pegViewState = {
    enabled: false,
    /** 0–1 opacity for `.planogram-tile-card` overlays only (product images stay opaque). */
    tileCardOpacity: 1
  };
  var pegViewContainerEl = null;
  var pegViewSyncToolbar = function () {};
  /** Current `.planogram-wrap` for tile-card opacity slider updates. */
  var activePlanogramWrapEl = null;

  /** Ease-in so the mask darkens gradually from the start of the slider range. */
  var CARD_OPACITY_GAMMA = 0.42;
  var TILE_CARD_POS_SCALE = 0.52;

  function sliderPercentToCardOpacity(pct) {
    var t = Math.max(0, Math.min(100, pct)) / 100;
    if (t <= 0) return 0;
    return Math.pow(t, CARD_OPACITY_GAMMA);
  }

  function cardOpacityToSliderPercent(op) {
    if (!isFinite(op) || op <= 0) return 0;
    op = Math.max(0, Math.min(1, op));
    return Math.round(Math.pow(op, 1 / CARD_OPACITY_GAMMA) * 100);
  }

  window.planogramSliderPercentToCardOpacity = sliderPercentToCardOpacity;
  window.planogramCardOpacityToSliderPercent = cardOpacityToSliderPercent;

  function syncPlanogramWrapTileCardOpacity(wrapEl) {
    if (!wrapEl) return;
    var op = pegViewState.tileCardOpacity;
    if (!isFinite(op)) op = 1;
    op = Math.max(0, Math.min(1, op));
    wrapEl.style.setProperty('--planogram-card-opacity', String(op));
    wrapEl.classList.toggle('planogram-wrap--cards-hidden', op < 0.02);
  }

  function syncPlanogramTileCardFonts(rootEl) {
    if (!rootEl) return;
    var lh = 1.05;
    var padY = 4;
    var tiles = rootEl.querySelectorAll('.planogram-tile, .pog-wv-tile');
    var ti;
    for (ti = 0; ti < tiles.length; ti++) {
      var tile = tiles[ti];
      var card = tile.querySelector('.planogram-tile-card, .pog-wv-tile-card');
      if (!card) continue;
      var tw = tile.clientWidth;
      var th = tile.clientHeight;
      if (!(tw > 0) || !(th > 0)) continue;

      var isPeg = card.classList.contains('planogram-tile-card--pegboard');
      var unitCount = isPeg ? TILE_CARD_POS_SCALE + 2 : 1;
      var byHeight = (th - padY) / (unitCount * lh);

      var maxChars = 3;
      var rcSpans = card.querySelectorAll('.planogram-tile-card-rc');
      var ri;
      for (ri = 0; ri < rcSpans.length; ri++) {
        maxChars = Math.max(maxChars, String(rcSpans[ri].textContent || '').length);
      }
      if (!isPeg) {
        var posOnly = card.querySelector('.planogram-tile-card-pos');
        if (posOnly) {
          maxChars = Math.max(maxChars, String(posOnly.textContent || '').length);
        }
      }
      var byWidth = (tw - 4) / (maxChars * 0.62);

      var coordSize = Math.max(5, Math.min(byHeight, byWidth, tw * 0.28));
      card.style.fontSize = coordSize + 'px';
      card.style.lineHeight = String(lh);
      card.style.fontWeight = '800';
      card.style.overflow = 'hidden';
      card.style.padding = '1px 2px';

      var posSpan = card.querySelector('.planogram-tile-card-pos');
      if (posSpan) {
        posSpan.style.fontSize = (isPeg ? TILE_CARD_POS_SCALE : 1) * coordSize + 'px';
        posSpan.style.lineHeight = String(lh);
      }
      for (ri = 0; ri < rcSpans.length; ri++) {
        rcSpans[ri].style.fontSize = coordSize + 'px';
        rcSpans[ri].style.lineHeight = String(lh);
      }
    }
  }
  window.planogramSyncTileCardFonts = syncPlanogramTileCardFonts;

  var tileCardFontResizeTimer = null;
  function schedulePlanogramTileCardFontsDebounced() {
    if (tileCardFontResizeTimer) clearTimeout(tileCardFontResizeTimer);
    tileCardFontResizeTimer = setTimeout(function () {
      tileCardFontResizeTimer = null;
      syncPlanogramTileCardFonts(activePlanogramWrapEl);
    }, 150);
  }
  if (!window.__planogramTileFontResizeHooked) {
    window.__planogramTileFontResizeHooked = true;
    window.addEventListener(
      'resize',
      schedulePlanogramTileCardFontsDebounced,
      { passive: true }
    );
  }

  function resolveProduct(products, upc) {
    if (!products || upc == null) return null;
    var u = String(upc);
    if (products[u]) return products[u];
    if (/^\d+$/.test(u)) {
      var p = u.padStart(13, '0');
      if (products[p]) return products[p];
    }
    return null;
  }

  function productImgUrl(upc) {
    if (typeof window.PLANOGRAM_IMG_RESOLVER === 'function') {
      return window.PLANOGRAM_IMG_RESOLVER(upc);
    }
    return 'products-webp/' + encodeURIComponent(String(upc)) + '.webp';
  }

  /** R/C digits are Kroger inch coordinates; allow optional space between R and C. */
  function parsePegboardRC(positionCode) {
    var m = String(positionCode || '').match(/^R\s*(\d+)\s*C\s*(\d+)$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 10), c: parseInt(m[2], 10) };
  }

  /** Peg row count from fixture metadata or the largest R value on products. */
  function pegboardMaxRow(fx) {
    var rows = fx.rows;
    if (rows != null && isFinite(Number(rows)) && Number(rows) > 0) {
      return Math.floor(Number(rows));
    }
    var maxR = 1;
    var pitems = fx.products || [];
    var pi;
    for (pi = 0; pi < pitems.length; pi++) {
      var rc = parsePegboardRC(pitems[pi].position_code);
      if (rc) maxR = Math.max(maxR, rc.r);
    }
    return maxR;
  }

  /** Peg column count from fixture metadata or the largest C value on products. */
  function pegboardMaxCol(fx) {
    var cols = fx.cols;
    if (cols != null && isFinite(Number(cols)) && Number(cols) > 0) {
      return Math.floor(Number(cols));
    }
    var maxC = 1;
    var pitems = fx.products || [];
    var pi;
    for (pi = 0; pi < pitems.length; pi++) {
      var rc = parsePegboardRC(pitems[pi].position_code);
      if (rc) maxC = Math.max(maxC, rc.c);
    }
    return maxC;
  }

  function pegboardEffectiveWidthIn(pit) {
    var slideScale =
      typeof pit.slide_peg_scale === 'number' &&
      isFinite(pit.slide_peg_scale) &&
      pit.slide_peg_scale > 0
        ? pit.slide_peg_scale
        : 1;
    var wIn =
      typeof pit.width_in === 'number' ? pit.width_in : parseFloat(pit.width_in);
    if (!isFinite(wIn) || wIn <= 0) wIn = 1;
    return wIn * slideScale;
  }

  /** True inch height for peg products (no shelf-style minimum tile height). */
  function pegboardProductHeightPx(heightInches) {
    return inchesToPx(heightInches || 1);
  }

  /** Board height in inches: fixture rows plus any product hanging below the grid. */
  function pegboardRenderHeightIn(fx) {
    var gridRows = pegboardMaxRow(fx);
    var maxBottom = gridRows;
    var pitems = fx.products || [];
    var pi;
    for (pi = 0; pi < pitems.length; pi++) {
      var pit = pitems[pi];
      var rc = parsePegboardRC(pit.position_code);
      if (!rc) continue;
      var hIn =
        typeof pit.height_in === 'number' ? pit.height_in : parseFloat(pit.height_in);
      if (!isFinite(hIn) || hIn <= 0) hIn = 1;
      maxBottom = Math.max(maxBottom, rc.r - 1 + hIn);
    }
    return maxBottom;
  }

  /** Board width in inches: fixture cols plus any product wider than its peg column. */
  function pegboardRenderWidthIn(fx) {
    var gridCols = pegboardMaxCol(fx);
    var maxRight = gridCols;
    var pitems = fx.products || [];
    var pi;
    for (pi = 0; pi < pitems.length; pi++) {
      var pit = pitems[pi];
      var rc = parsePegboardRC(pit.position_code);
      if (!rc) continue;
      maxRight = Math.max(maxRight, rc.c - 1 + pegboardEffectiveWidthIn(pit));
    }
    return maxRight;
  }

  function pegboardGridMetrics(fx) {
    return {
      rowCount: pegboardMaxRow(fx),
      colCount: pegboardMaxCol(fx),
      renderHeightIn: pegboardRenderHeightIn(fx),
      renderWidthIn: pegboardRenderWidthIn(fx)
    };
  }

  function inchesToPx(inches) {
    var n = typeof inches === 'number' ? inches : parseFloat(inches);
    if (!isFinite(n)) n = 1;
    return Math.max(1, Math.round(n * PIXELS_PER_INCH));
  }

  /** Prefer inch-accuracy but ensure short items stay legible on screen / in bay totals. */
  function tileDisplayHeightPx(heightInches) {
    return Math.max(MIN_TILE_HEIGHT_PX, inchesToPx(heightInches || 1));
  }

  function formatPosition(bayNum, fixture, item, facingMeta) {
    var b = 'Bay ' + bayNum;
    var facingSuffix = '';
    if (facingMeta && facingMeta.total > 1) {
      facingSuffix = ' (Facing ' + facingMeta.index + ' of ' + facingMeta.total + ')';
    }
    if (fixture.type === 'pegboard') {
      var lines = ['#' + String(item.pos)];
      var rc = parsePegboardRC(item.position_code);
      if (rc) {
        lines.push('R' + rc.r);
        lines.push('C' + rc.c);
      }
      return lines.join('\n');
    }
    return b + ' · ' + (fixture.label || 'Shelf') + ' · Position ' + item.pos + facingSuffix;
  }

  function productFacings(p) {
    var f = p.facings;
    if (f == null || f === '') return 1;
    var n = Math.floor(Number(f));
    if (!isFinite(n)) return 1;
    return Math.max(1, n);
  }

  function shelfEffectiveWidthInches(shelfFx, bay) {
    var wf = bay.width_ft;
    if (wf == null || !isFinite(wf)) wf = 1;
    var bayMaxIn = wf * 12;
    var win = shelfFx.width_in;
    if (win != null && isFinite(Number(win))) {
      var effIn = Number(win);
      if (effIn > bayMaxIn) effIn = bayMaxIn;
      return effIn;
    }
    return bayMaxIn;
  }

  function bayPhysicalInnerPx(bay) {
    var wf = bay.width_ft;
    if (wf == null || !isFinite(wf)) wf = 1;
    return Math.max(1, wf * 12 * PIXELS_PER_INCH);
  }

  /** Nominal fixture width in px (clamped to bay); fallback when no width_in on fixture. */
  function fixtureInnerWidthPx(fixture, bay) {
    var bayWf = bay.width_ft;
    if (bayWf == null || !isFinite(bayWf)) bayWf = 1;
    var bayMaxIn = bayWf * 12;
    var win = fixture.width_in;
    var effIn;
    if (win != null && isFinite(Number(win))) {
      effIn = Number(win);
      if (effIn > bayMaxIn) effIn = bayMaxIn;
    } else {
      effIn = bayMaxIn;
    }
    return inchesToPx(effIn);
  }

  function shelfOverflowWidthPx(shelfFx, physicalInnerPx, bay) {
    var items = shelfFx.products || [];
    if (!items.length) return physicalInnerPx;
    void bay;
    /* Uniform horizontal scaling keeps the shelf row within fixture width. */
    return physicalInnerPx;
  }

  function computeBayInnerWidthPx(bay) {
    var physicalInner = bayPhysicalInnerPx(bay);
    var inner = physicalInner;
    var fixtures = sortFixtures(bay.fixtures || []);
    var fi;
    for (fi = 0; fi < fixtures.length; fi++) {
      var f = fixtures[fi];
      if (f.type === 'shelf') {
        inner = Math.max(inner, shelfOverflowWidthPx(f, fixtureInnerWidthPx(f, bay), bay));
      } else if (f.type === 'pegboard') {
        var dims = pegboardGridMetrics(f);
        inner = Math.max(inner, pegboardGridWidth(dims, fixtureInnerWidthPx(f, bay)));
      }
    }
    return inner;
  }

  function sortFixtures(fixtures) {
    var fxs = fixtures.slice();
    fxs.sort(function (a, b) {
      var oa = a.offset_from_base_in;
      var ob = b.offset_from_base_in;
      var na = typeof oa === 'number' ? oa : parseFloat(oa);
      var nb = typeof ob === 'number' ? ob : parseFloat(ob);
      if (!isFinite(na)) na = 0;
      if (!isFinite(nb)) nb = 0;
      if (nb !== na) return nb - na;
      return (a.fixture_num || 0) - (b.fixture_num || 0);
    });
    return fxs;
  }

  function pegboardGridWidth(dims, fixtureWidthPx) {
    var w = inchesToPx(dims.renderWidthIn || dims.colCount || 1);
    if (fixtureWidthPx != null && isFinite(fixtureWidthPx) && fixtureWidthPx > w) {
      return Math.round(fixtureWidthPx);
    }
    return w;
  }

  function pegboardGridHeight(dims) {
    return inchesToPx(dims.renderHeightIn || dims.rowCount || 1);
  }

  function computeShelfFixtureHeight(fx) {
    var items = fx.products || [];
    if (!items.length) return SHELF_EMPTY_ROW_PX;
    var h = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      h = Math.max(h, tileDisplayHeightPx(items[i].height_in));
    }
    return h;
  }

  function computeBayContentHeightBeforePadding(bay) {
    var fixtures = sortFixtures(bay.fixtures || []);
    var fh = 0;
    var fi;
    for (fi = 0; fi < fixtures.length; fi++) {
      var f = fixtures[fi];
      if (f.type === 'shelf') {
        fh += computeShelfFixtureHeight(f);
      } else if (f.type === 'pegboard') {
        fh += pegboardGridHeight(pegboardGridMetrics(f));
      }
      if (fi < fixtures.length - 1) fh += TILE_GAP_PX;
    }
    return fh;
  }

  function computeBayOuterHeight(bay) {
    return computeBayContentHeightBeforePadding(bay) + 2 * BAY_PADDING_PX;
  }

  function ensureModal() {
    var el = document.querySelector('.planogram-modal-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'planogram-modal-overlay';
    el.innerHTML =
      '<button type="button" class="planogram-modal-close" aria-label="Close">&times;</button>' +
      '<div class="planogram-modal-card">' +
      '<img alt="" decoding="async">' +
      '<div class="planogram-modal-name"></div>' +
      '<div class="planogram-modal-brand"></div>' +
      '<div class="planogram-modal-size"></div>' +
      '<div class="planogram-modal-upc"></div>' +
      '<div class="planogram-modal-position"></div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.planogram-modal-close').addEventListener('click', function () {
      if (typeof window.appNavigateBack === 'function') window.appNavigateBack();
      else {
        el.classList.remove('visible');
        if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll();
      }
    });
    el.addEventListener('click', function (e) {
      if (e.target === el) {
        if (typeof window.appNavigateBack === 'function') window.appNavigateBack();
        else {
          el.classList.remove('visible');
          if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll();
        }
      }
    });
    var card = el.querySelector('.planogram-modal-card');
    if (card) card.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('visible')) {
        if (typeof window.appNavigateBack === 'function') window.appNavigateBack();
        else {
          el.classList.remove('visible');
          if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll();
        }
      }
    });
    return el;
  }

  function openModal(products, item, bayNum, fixture, facingMeta) {
    var rec = resolveProduct(products, item.upc);
    var overlay = ensureModal();
    var img = overlay.querySelector('.planogram-modal-card img');
    var nm = overlay.querySelector('.planogram-modal-name');
    var br = overlay.querySelector('.planogram-modal-brand');
    var sz = overlay.querySelector('.planogram-modal-size');
    var up = overlay.querySelector('.planogram-modal-upc');
    var posEl = overlay.querySelector('.planogram-modal-position');

    var upc = item.upc;
    img.src = productImgUrl(upc);
    if (rec) {
      img.alt = rec.name || rec.fallback_desc || upc;
      nm.textContent = rec.name || rec.fallback_desc || '';
      br.textContent = rec.brand || '';
      sz.textContent = rec.size || '';
    } else {
      img.alt = item.desc_fallback || upc;
      nm.textContent = item.desc_fallback || '';
      br.textContent = '';
      sz.textContent = item.size_fallback || '';
    }
    up.textContent = 'UPC: ' + String(upc);
    posEl.textContent = formatPosition(bayNum, fixture, item, facingMeta);
    if (typeof window.appPushNavigationState === 'function') {
      window.appPushNavigationState('planogram-modal');
    }
    overlay.classList.add('visible');
    if (typeof window.lockBodyScroll === 'function') window.lockBodyScroll();
  }

  function buildTile(products, item, bayNum, fixture, facingMeta) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'planogram-tile';
    tile.dataset.upc = String(item.upc);
    var im = document.createElement('img');
    im.src = productImgUrl(item.upc);
    im.alt = '';
    im.decoding = 'async';
    tile.appendChild(im);
    var card = document.createElement('div');
    card.className = 'planogram-tile-card';
    card.style.lineHeight = '1.05';
    card.style.fontWeight = '800';
    card.style.overflow = 'hidden';
    if (fixture.type === 'pegboard') {
      var posSpan = document.createElement('span');
      posSpan.className = 'planogram-tile-card-pos';
      posSpan.textContent = '#' + String(item.pos);
      card.appendChild(posSpan);
      var rc = parsePegboardRC(item.position_code);
      if (rc) {
        card.classList.add('planogram-tile-card--pegboard');
        var rSpan = document.createElement('span');
        rSpan.className = 'planogram-tile-card-rc';
        rSpan.textContent = 'R' + String(rc.r);
        var cSpan = document.createElement('span');
        cSpan.className = 'planogram-tile-card-rc';
        cSpan.textContent = 'C' + String(rc.c);
        card.appendChild(rSpan);
        card.appendChild(cSpan);
      }
    } else {
      var shelfSpan = document.createElement('span');
      shelfSpan.className = 'planogram-tile-card-pos';
      shelfSpan.textContent = '#' + String(item.pos);
      card.appendChild(shelfSpan);
    }
    card.setAttribute('aria-hidden', 'true');
    tile.appendChild(card);
    (function (it, bn, fxv, fm) {
      tile.addEventListener('click', function () {
        if (typeof window.PLANOGRAM_TILE_CLICK === 'function') {
          window.PLANOGRAM_TILE_CLICK({ item: it, bayNum: bn, fixture: fxv, facingMeta: fm });
          return;
        }
        openModal(products, it, bn, fxv, fm);
      });
    })(item, bayNum, fixture, facingMeta || null);
    return tile;
  }

  /** Peg-view marker: pos number + R/C label centered over the product image. */
  function buildPegMarker(pit) {
    var pos = pit && pit.pos;
    var rcText = '';
    if (pit && pit.position_code) {
      var m = String(pit.position_code).match(/^R\s*(\d+)\s*C\s*(\d+)$/i);
      if (m) {
        var rNum = String(parseInt(m[1], 10)).padStart(2, '0');
        var cNum = String(parseInt(m[2], 10)).padStart(2, '0');
        rcText = 'R' + rNum + ' C' + cNum;
      } else {
        rcText = String(pit.position_code);
      }
    }
    if (pos == null && !rcText) return null;
    var wrap = document.createElement('div');
    wrap.className = 'planogram-peg-marker';
    var inner = document.createElement('div');
    inner.className = 'planogram-peg-marker-inner';
    if (pos != null) {
      var p1 = document.createElement('span');
      p1.className = 'planogram-peg-marker-pos';
      p1.textContent = '#' + String(pos);
      inner.appendChild(p1);
    }
    if (rcText) {
      var p2 = document.createElement('span');
      p2.className = 'planogram-peg-marker-rc';
      p2.textContent = rcText;
      inner.appendChild(p2);
    }
    wrap.appendChild(inner);
    return wrap;
  }

  /**
   * Rounds per-tile float widths so the row sums to targetPx (no gaps; fills shelf).
   */
  function distributeShelfTileWidthsPx(floatWidthsPx, targetPx) {
    var n = floatWidthsPx.length;
    if (!n) return [];
    var out = new Array(n);
    var sumF = 0;
    var partsHi = [];
    var partsLo = [];
    var i;
    for (i = 0; i < n; i++) {
      var w = floatWidthsPx[i];
      if (!isFinite(w)) w = 1;
      var fl = Math.floor(Math.max(0, w));
      out[i] = fl;
      sumF += fl;
      var frac = w - fl;
      partsHi.push({ i: i, frac: frac });
      partsLo.push({ i: i, frac: frac });
    }
    partsHi.sort(function (a, b) {
      return b.frac - a.frac;
    });
    partsLo.sort(function (a, b) {
      return a.frac - b.frac;
    });
    var err = targetPx - sumF;
    var k = 0;
    while (err > 0) {
      out[partsHi[k % n].i] += 1;
      err--;
      k++;
    }
    k = 0;
    while (err < 0 && k < n * 64) {
      var idx = partsLo[k % n].i;
      if (out[idx] > 1) {
        out[idx] -= 1;
        err++;
      }
      k++;
    }
    for (i = 0; i < n; i++) {
      if (out[i] < 1) out[i] = 1;
    }
    return out;
  }

  function buildShelfTiles(products, item, bayNum, fixture, tileWidthsPx) {
    var tiles = [];
    var facings = productFacings(item);
    var i;
    for (i = 0; i < facings; i++) {
      var facingMeta =
        facings > 1 ? { index: i + 1, total: facings } : null;
      var tile = buildTile(products, item, bayNum, fixture, facingMeta);
      var wPx =
        tileWidthsPx && tileWidthsPx.length === facings
          ? tileWidthsPx[i]
          : inchesToPx(item.width_in || 1);
      tile.style.width = Math.max(1, Math.round(wPx)) + 'px';
      tile.style.height = tileDisplayHeightPx(item.height_in) + 'px';
      if (i > 0) {
        tile.style.borderLeft =
          FACING_SPLIT_PX + 'px solid rgba(255, 255, 255, 0.18)';
      }
      tiles.push(tile);
    }
    return tiles;
  }

  function renderShelf(shelfFx, products, bayNum, physicalInnerPx, bay) {
    var outer = document.createElement('div');
    outer.className = 'planogram-shelf-outer';
    outer.style.width = '100%';
    outer.style.display = 'flex';
    outer.style.justifyContent = 'center';
    outer.style.alignItems = 'flex-end';
    outer.style.flexShrink = '0';
    outer.style.boxSizing = 'border-box';

    var el = document.createElement('div');
    el.className = 'planogram-shelf';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.flexWrap = 'nowrap';
    el.style.alignItems = 'flex-end';
    el.style.flexShrink = '0';
    el.style.boxSizing = 'border-box';

    var items = (shelfFx.products || []).slice().sort(function (a, b) {
      return a.pos - b.pos;
    });
    if (!items.length) {
      el.style.width = physicalInnerPx + 'px';
      el.style.height = SHELF_EMPTY_ROW_PX + 'px';
      el.style.minHeight = SHELF_EMPTY_ROW_PX + 'px';
      el.style.background = 'rgba(255, 255, 255, 0.04)';
      outer.appendChild(el);
      return outer;
    }

    outer.style.justifyContent = 'flex-start';
    el.style.paddingLeft = '0';
    el.style.paddingRight = '0';
    el.style.gap = '0';
    el.style.justifyContent = 'flex-start';

    var shelfWidthIn =
      bay ? shelfEffectiveWidthInches(shelfFx, bay) : physicalInnerPx / PIXELS_PER_INCH;
    if (!isFinite(shelfWidthIn) || shelfWidthIn <= 0) shelfWidthIn = physicalInnerPx / PIXELS_PER_INCH;

    var targetPx = Math.round(shelfWidthIn * PIXELS_PER_INCH);
    if (!(targetPx > 0)) targetPx = Math.max(1, Math.round(physicalInnerPx));

    var naturalWidthIn = 0;
    var ii;
    for (ii = 0; ii < items.length; ii++) {
      var pit = items[ii];
      var wIn =
        typeof pit.width_in === 'number' ? pit.width_in : parseFloat(pit.width_in);
      if (!isFinite(wIn) || wIn <= 0) wIn = 1;
      naturalWidthIn += productFacings(pit) * wIn;
    }

    var scaleFactor =
      naturalWidthIn > 0 && shelfWidthIn > 0 ? shelfWidthIn / naturalWidthIn : 1;
    if (!isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1;

    var floatWidthsAll = [];
    var pi;
    for (pi = 0; pi < items.length; pi++) {
      var sit = items[pi];
      var wInc =
        typeof sit.width_in === 'number' ? sit.width_in : parseFloat(sit.width_in);
      if (!isFinite(wInc) || wInc <= 0) wInc = 1;
      var tileFloatW =
        naturalWidthIn <= 0 || shelfWidthIn <= 0
          ? wInc * PIXELS_PER_INCH
          : wInc * scaleFactor * PIXELS_PER_INCH;
      var nf = productFacings(sit);
      var fi;
      for (fi = 0; fi < nf; fi++) {
        floatWidthsAll.push(tileFloatW);
      }
    }

    var widthPxList =
      floatWidthsAll.length && naturalWidthIn > 0 && shelfWidthIn > 0
        ? distributeShelfTileWidthsPx(floatWidthsAll, targetPx)
        : floatWidthsAll.map(function (fw) {
            return Math.max(1, Math.round(fw));
          });

    el.style.width = targetPx + 'px';

    var widthCursor = 0;
    for (pi = 0; pi < items.length; pi++) {
      var item = items[pi];
      var fc = productFacings(item);
      var slice = widthPxList.slice(widthCursor, widthCursor + fc);
      widthCursor += fc;
      var tiles = buildShelfTiles(products, item, bayNum, shelfFx, slice);
      var j;
      for (j = 0; j < tiles.length; j++) {
        tiles[j].style.flexShrink = '0';
        el.appendChild(tiles[j]);
      }
    }

    outer.appendChild(el);
    return outer;
  }

  function pegboardProductBottomPx(r, totalH, heightPx) {
    var pegTopPx = (r - 1) * PIXELS_PER_INCH;
    return totalH - pegTopPx - heightPx;
  }

  function renderPegboard(pegFx, products, bayNum, fixtureInnerPx) {
    var pitems = pegFx.products || [];
    var dims = pegboardGridMetrics(pegFx);
    var totalH = pegboardGridHeight(dims);
    var gridW = pegboardGridWidth(dims, fixtureInnerPx);
    var target = fixtureInnerPx;

    var tileBoxes = [];
    var productMarkerBoxes = [];
    var naturalMaxRight = 0;

    if (!pitems.length) {
      naturalMaxRight = gridW;
    } else {
      var pi;
      for (pi = 0; pi < pitems.length; pi++) {
        var pit = pitems[pi];
        var rc = parsePegboardRC(pit.position_code);
        var r = rc ? rc.r : 1;
        var c = rc ? rc.c : 1;
        if (r < 1) r = 1;
        if (c < 1) c = 1;

        var leftPx = (c - 1) * PIXELS_PER_INCH;
        var wPx = inchesToPx(pegboardEffectiveWidthIn(pit));
        var hPx = pegboardProductHeightPx(pit.height_in);
        var bottom = pegboardProductBottomPx(r, totalH, hPx);
        var facings = productFacings(pit);
        var x = leftPx;
        var prodLeftPx = leftPx;
        var fi;
        for (fi = 0; fi < facings; fi++) {
          var rightEdge = x + wPx;
          if (rightEdge > naturalMaxRight) naturalMaxRight = rightEdge;
          tileBoxes.push({
            pit: pit,
            facingIndex: fi,
            totalFacings: facings,
            leftPx: x,
            widthPx: wPx,
            bottomPx: bottom,
            heightPx: hPx
          });
          x += wPx;
          if (fi < facings - 1) x += FACING_SPLIT_PX;
        }
        productMarkerBoxes.push({
          pit: pit,
          leftPx: prodLeftPx,
          widthPx: x - prodLeftPx,
          bottomPx: bottom,
          heightPx: hPx
        });
      }
    }

    var pegScale = naturalMaxRight >= target ? 1 : target / naturalMaxRight;
    if (!isFinite(pegScale) || naturalMaxRight <= 0) pegScale = 1;

    var scaledBoardW = naturalMaxRight * pegScale;
    var boardW = Math.max(target, Math.ceil(scaledBoardW));

    var outerW = Math.max(fixtureInnerPx, boardW);
    var outer = document.createElement('div');
    outer.className = 'planogram-pegboard-outer';
    outer.style.width = outerW + 'px';
    outer.style.maxWidth = '100%';
    outer.style.display = 'flex';
    outer.style.justifyContent = 'center';
    outer.style.alignItems = 'flex-start';
    outer.style.flexShrink = '0';
    outer.style.marginTop = '0';
    outer.style.marginLeft = 'auto';
    outer.style.marginRight = 'auto';
    outer.style.alignSelf = 'flex-start';
    outer.style.boxSizing = 'border-box';

    var el = document.createElement('div');
    el.className = 'planogram-pegboard';
    el.style.display = 'block';
    el.style.position = 'relative';
    el.style.width = boardW + 'px';
    el.style.height = totalH + 'px';
    el.style.flexShrink = '0';
    el.style.boxSizing = 'border-box';
    el.style.overflow = 'visible';

    /* Peg-view grid cell sizing: 1 inch wide × 1 inch tall in render space.
       Horizontal axis is scaled by pegScale to match scaled tile positions;
       vertical axis is rendered at natural inch-px (no vertical scale). */
    var cellXPx = PIXELS_PER_INCH * pegScale;
    var cellYPx = PIXELS_PER_INCH;
    el.style.setProperty('--pegview-cell-x', cellXPx + 'px');
    el.style.setProperty('--pegview-cell-y', cellYPx + 'px');

    var bi;
    for (bi = 0; bi < tileBoxes.length; bi++) {
      var box = tileBoxes[bi];
      var pitB = box.pit;
      var fmeta =
        box.totalFacings > 1
          ? { index: box.facingIndex + 1, total: box.totalFacings }
          : null;
      var ptile = buildTile(products, pitB, bayNum, pegFx, fmeta);
      ptile.classList.add('planogram-tile--pegboard');
      ptile.style.position = 'absolute';
      ptile.style.left = Math.round(box.leftPx * pegScale) + 'px';
      ptile.style.width = Math.max(1, Math.round(box.widthPx * pegScale)) + 'px';
      ptile.style.height = box.heightPx + 'px';
      ptile.style.bottom = box.bottomPx + 'px';
      ptile.style.margin = '0';
      if (box.facingIndex > 0) {
        ptile.style.borderLeft =
          FACING_SPLIT_PX + 'px solid rgba(255, 255, 255, 0.18)';
      }
      el.appendChild(ptile);
    }

    /* Append peg-position markers after tiles so they paint above. One per
       product, spanning all facings, centered on the product image. Only
       rendered visibly when the parent has the .pegview-active class. */
    var mi;
    for (mi = 0; mi < productMarkerBoxes.length; mi++) {
      var mbox = productMarkerBoxes[mi];
      var marker = buildPegMarker(mbox.pit);
      if (!marker) continue;
      marker.style.left = Math.round(mbox.leftPx * pegScale) + 'px';
      marker.style.width = Math.max(1, Math.round(mbox.widthPx * pegScale)) + 'px';
      marker.style.bottom = mbox.bottomPx + 'px';
      marker.style.height = mbox.heightPx + 'px';
      el.appendChild(marker);
    }

    outer.appendChild(el);
    return outer;
  }

  function fixtureBlockHeightPx(f) {
    if (f.type === 'shelf') return computeShelfFixtureHeight(f);
    if (f.type === 'pegboard') {
      return pegboardGridHeight(pegboardGridMetrics(f));
    }
    return 0;
  }

  /**
   * One rail segment per contiguous run of pegboards or shelves (top→bottom),
   * so mixed bays get separate “Pegs” and “Shelves” blocks like a side legend.
   */
  function mergeFixtureRailGroups(sortedFixtures) {
    var groups = [];
    var i = 0;
    while (i < sortedFixtures.length) {
      var f = sortedFixtures[i];
      if (f.type !== 'shelf' && f.type !== 'pegboard') {
        i++;
        continue;
      }
      var kind = f.type === 'pegboard' ? 'peg' : 'shelf';
      var h = fixtureBlockHeightPx(f);
      var j = i + 1;
      while (j < sortedFixtures.length) {
        var fj = sortedFixtures[j];
        if (fj.type !== 'shelf' && fj.type !== 'pegboard') break;
        var k2 = fj.type === 'pegboard' ? 'peg' : 'shelf';
        if (k2 !== kind) break;
        h += TILE_GAP_PX + fixtureBlockHeightPx(fj);
        j++;
      }
      groups.push({ kind: kind, heightPx: h });
      i = j;
    }
    return groups;
  }

  function buildPlanogramBayRail(groups) {
    var rail = document.createElement('div');
    rail.className = 'planogram-bay-rail';
    var gi;
    for (gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      var seg = document.createElement('div');
      seg.className =
        'planogram-bay-rail-segment planogram-bay-rail-segment--' +
        (g.kind === 'peg' ? 'pegs' : 'shelves');
      seg.style.height = Math.max(0, Math.round(g.heightPx)) + 'px';
      seg.style.flexShrink = '0';
      var label = document.createElement('span');
      label.className = 'planogram-bay-rail-label';
      label.textContent = g.kind === 'peg' ? 'Pegs' : 'Shelves';
      var edge = document.createElement('span');
      edge.className = 'planogram-bay-rail-edge';
      edge.setAttribute('aria-hidden', 'true');
      seg.appendChild(label);
      seg.appendChild(edge);
      rail.appendChild(seg);
    }
    var spacer = document.createElement('div');
    spacer.className = 'planogram-bay-rail-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    rail.appendChild(spacer);
    return rail;
  }

  function renderBay(bay, allBaysMaxHeight, products) {
    if (!bay.fixtures || !bay.fixtures.length) {
      var empty = document.createElement('div');
      empty.className = 'planogram-bay is-empty';
      empty.style.width = EMPTY_BAY_PX + 'px';
      empty.style.height = allBaysMaxHeight + 'px';
      empty.style.boxSizing = 'border-box';
      empty.innerHTML = '<div class="planogram-empty-bay">End cap</div>';
      return empty;
    }

    var el = document.createElement('div');
    el.className = 'planogram-bay';
    el.style.padding = BAY_PADDING_PX + 'px';
    el.style.boxSizing = 'border-box';
    var bayInnerWidthPx = computeBayInnerWidthPx(bay);
    el.style.width =
      (bayInnerWidthPx +
        BAY_RAIL_WIDTH_PX +
        BAY_RAIL_GAP_PX +
        BAY_PADDING_PX * 2) + 'px';
    el.style.height = allBaysMaxHeight + 'px';

    var sorted = sortFixtures(bay.fixtures);
    var main = document.createElement('div');
    main.className = 'planogram-bay-main';
    var fixturesCol = document.createElement('div');
    fixturesCol.className = 'planogram-bay-fixtures';
    var fi;
    for (fi = 0; fi < sorted.length; fi++) {
      var f = sorted[fi];
      if (f.type === 'shelf') {
        fixturesCol.appendChild(
          renderShelf(f, products, bay.bay_num, fixtureInnerWidthPx(f, bay), bay)
        );
      } else if (f.type === 'pegboard') {
        fixturesCol.appendChild(
          renderPegboard(f, products, bay.bay_num, fixtureInnerWidthPx(f, bay))
        );
      }
    }
    var rail = buildPlanogramBayRail(mergeFixtureRailGroups(sorted));
    main.appendChild(rail);
    main.appendChild(fixturesCol);
    el.appendChild(main);
    return el;
  }

  function attachPlanogramZoom(viewport, stage, wrap) {
    var scale = 1;
    var tx = 0;
    var ty = 0;
    var pointers = new Map();
    var pinchPrevDist = 0;
    var panPtrId = null;
    var panStartX = 0;
    var panStartY = 0;
    var panTx0 = 0;
    var panTy0 = 0;
    var panActive = false;
    var pinchActive = false;
    var sessionHadPinch = false;
    var singleDownTime = 0;
    var singleDownX = 0;
    var singleDownY = 0;
    var singleDownId = null;
    var lastTapTime = 0;
    var lastTapX = 0;
    var lastTapY = 0;
    var suppressClick = false;
    var rafId = 0;
    var draggingPan = false;

    var TAP_MOVE_PX = 6;
    var TAP_MS = 300;
    var DOUBLE_TAP_MS = 250;
    var DOUBLE_TAP_MOVE_PX = 22;
    var SCALE_MAX = 10;

    /** Minimum scale: active bay fits in the bay viewport (dynamic per bay / resize) */
    var minScale = 1;

    function recomputeFitMin() {
      var natW = Math.max(1, wrap.offsetWidth || 1);
      var natH = Math.max(1, wrap.offsetHeight || 1);
      var vw = viewport.clientWidth || 1;
      var vh = viewport.clientHeight || 1;
      var sx = vw / natW;
      var sy = vh / natH;
      var ms = sx < sy ? sx : sy;
      var fillViewport =
        viewport.classList.contains('planogram-hub-bay-viewport') ||
        viewport.getAttribute('data-fill-viewport') === '1';
      if (!fillViewport && ms > 1) ms = 1;
      if (!(ms > 0 && isFinite(ms))) ms = 1;
      minScale = ms;
    }

    function zoomToggleInTarget() {
      return Math.max(3, minScale);
    }

    function clampScale(s) {
      return Math.min(SCALE_MAX, Math.max(minScale, s));
    }

    function contentSize() {
      return { cw: wrap.offsetWidth, ch: wrap.offsetHeight };
    }

    /** Center the scaled stage content in the viewport at the current scale (used at fit zoom). */
    function recenterFitTranslate() {
      var vw = viewport.clientWidth || 1;
      var vh = viewport.clientHeight || 1;
      var sz = contentSize();
      tx = (vw - sz.cw * scale) / 2;
      ty = (vh - sz.ch * scale) / 2;
    }

    function scaledBeyondFit() {
      return scale > minScale + 1e-6;
    }

    function contentOverflowsViewport() {
      var vw = viewport.clientWidth || 1;
      var vh = viewport.clientHeight || 1;
      var sz = contentSize();
      var sw = sz.cw * scale;
      var sh = sz.ch * scale;
      return sw > vw + 1e-6 || sh > vh + 1e-6;
    }

    function clampPan() {
      /* Unrestricted pan — user can move the virtual POG freely at any zoom. */
    }

    function scheduleApply() {
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = 0;
        applyNow();
      });
    }

    function applyNow() {
      clampPan();
      stage.style.transform =
        'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      var overFit = contentOverflowsViewport();
      viewport.classList.add('planogram-zoom-pannable');
      wrap.classList.toggle('planogram-wrap--zoomed', scaledBeyondFit());
      if (!overFit) {
        viewport.classList.remove('planogram-zoom-grabbing');
      }
    }

    function viewportPoint(clientX, clientY) {
      var r = viewport.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    }

    function midpoint(a, b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function dist(a, b) {
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function zoomAroundViewportPoint(mx, my, newScale) {
      var s0 = scale;
      var s1 = clampScale(newScale);
      var cx = (mx - tx) / s0;
      var cy = (my - ty) / s0;
      scale = s1;
      tx = mx - cx * scale;
      ty = my - cy * scale;
    }

    function beginPinchIfNeeded() {
      if (pointers.size !== 2) return;
      var pts = Array.from(pointers.values());
      var a = viewportPoint(pts[0].clientX, pts[0].clientY);
      var b = viewportPoint(pts[1].clientX, pts[1].clientY);
      pinchPrevDist = Math.max(1e-6, dist(a, b));
      pinchActive = true;
      panActive = false;
      panPtrId = null;
      draggingPan = false;
    }

    function updatePinch() {
      if (!pinchActive || pointers.size !== 2) return;
      var pts = Array.from(pointers.values());
      var a = viewportPoint(pts[0].clientX, pts[0].clientY);
      var b = viewportPoint(pts[1].clientX, pts[1].clientY);
      var d = Math.max(1e-6, dist(a, b));
      var mid = midpoint(a, b);
      var ratio = d / pinchPrevDist;
      var newScale = clampScale(scale * ratio);
      var cx = (mid.x - tx) / scale;
      var cy = (mid.y - ty) / scale;
      tx = mid.x - cx * newScale;
      ty = mid.y - cy * newScale;
      scale = newScale;
      pinchPrevDist = d;
      scheduleApply();
    }

    function onPointerDown(e) {
      suppressClick = false;
      pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

      if (pointers.size === 1) {
        sessionHadPinch = false;
      } else if (pointers.size >= 2) {
        sessionHadPinch = true;
        singleDownId = null;
      }

      if (pointers.size === 2) {
        beginPinchIfNeeded();
        e.preventDefault();
        return;
      }

      if (pointers.size === 1 && e.isPrimary) {
        singleDownTime = Date.now();
        var p = viewportPoint(e.clientX, e.clientY);
        singleDownX = p.x;
        singleDownY = p.y;
        singleDownId = e.pointerId;
        panPtrId = e.pointerId;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panTx0 = tx;
        panTy0 = ty;
        panActive = true;
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

      if (pointers.size >= 2) {
        if (!pinchActive) beginPinchIfNeeded();
        updatePinch();
        e.preventDefault();
        return;
      }

      if (panActive && panPtrId === e.pointerId) {
        var dx = e.clientX - panStartX;
        var dy = e.clientY - panStartY;
        if (!draggingPan && (dx * dx + dy * dy) > TAP_MOVE_PX * TAP_MOVE_PX) {
          draggingPan = true;
          suppressClick = true;
          viewport.classList.add('planogram-zoom-grabbing');
        }
        if (draggingPan) {
          tx = panTx0 + dx;
          ty = panTy0 + dy;
          scheduleApply();
          e.preventDefault();
        }
      }
    }

    function onPointerUp(e) {
      var hadPinch = pinchActive;
      pointers.delete(e.pointerId);

      if (pinchActive && pointers.size < 2) {
        pinchActive = false;
        pinchPrevDist = 0;
        clampPan();
        scheduleApply();
      }

      if (pointers.size === 0 && sessionHadPinch) {
        suppressClick = true;
        setTimeout(function () {
          suppressClick = false;
        }, 350);
      }

      if (panPtrId === e.pointerId) {
        panPtrId = null;
        panActive = false;
        viewport.classList.remove('planogram-zoom-grabbing');
        if (draggingPan) {
          suppressClick = true;
          setTimeout(function () {
            suppressClick = false;
          }, 350);
        }
        draggingPan = false;
      }

      if (pointers.size === 1 && hadPinch) {
        var rem = pointers.values().next().value;
        if (rem) {
          var pr = viewportPoint(rem.clientX, rem.clientY);
          singleDownTime = Date.now();
          singleDownX = pr.x;
          singleDownY = pr.y;
          singleDownId = Array.from(pointers.keys())[0];
          panPtrId = singleDownId;
          panStartX = rem.clientX;
          panStartY = rem.clientY;
          panTx0 = tx;
          panTy0 = ty;
          panActive = true;
        }
      }

      if (
        pointers.size === 0 &&
        !hadPinch &&
        !sessionHadPinch &&
        e.pointerId === singleDownId
      ) {
        var elapsed = Date.now() - singleDownTime;
        var pEnd = viewportPoint(e.clientX, e.clientY);
        var movedPx = Math.sqrt(
          Math.pow(pEnd.x - singleDownX, 2) + Math.pow(pEnd.y - singleDownY, 2)
        );
        if (elapsed < TAP_MS && movedPx < TAP_MOVE_PX) {
          var now = Date.now();
          var dt = now - lastTapTime;
          var dTap = Math.sqrt(
            Math.pow(pEnd.x - lastTapX, 2) + Math.pow(pEnd.y - lastTapY, 2)
          );
          if (dt < DOUBLE_TAP_MS && dTap < DOUBLE_TAP_MOVE_PX) {
            var targetScale =
              scale > minScale + 0.05 ? minScale : zoomToggleInTarget();
            zoomAroundViewportPoint(pEnd.x, pEnd.y, targetScale);
            if (Math.abs(scale - minScale) < 1e-6) {
              recenterFitTranslate();
            }
            scheduleApply();
            lastTapTime = 0;
            suppressClick = true;
            setTimeout(function () {
              suppressClick = false;
            }, 350);
          } else {
            lastTapTime = now;
            lastTapX = pEnd.x;
            lastTapY = pEnd.y;
          }
        }
      }

      if (pointers.size === 0) {
        sessionHadPinch = false;
      }

      singleDownId = null;
    }

    function onPointerCancel(e) {
      onPointerUp(e);
    }

    function onClickCapture(e) {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function onDblClick(e) {
      var p = viewportPoint(e.clientX, e.clientY);
      var targetScale =
        scale > minScale + 0.05 ? minScale : zoomToggleInTarget();
      zoomAroundViewportPoint(p.x, p.y, targetScale);
      if (Math.abs(scale - minScale) < 1e-6) {
        recenterFitTranslate();
      }
      scheduleApply();
      suppressClick = true;
      setTimeout(function () {
        suppressClick = false;
      }, 350);
      e.preventDefault();
    }

    viewport.addEventListener('pointerdown', onPointerDown, {
      capture: true,
      passive: false
    });
    viewport.addEventListener('pointermove', onPointerMove, {
      capture: true,
      passive: false
    });
    viewport.addEventListener('pointerup', onPointerUp, { capture: true });
    viewport.addEventListener('pointercancel', onPointerCancel, { capture: true });
    viewport.addEventListener('click', onClickCapture, true);
    viewport.addEventListener('dblclick', onDblClick, { capture: true });

    function refreshFitAfterResize() {
      recomputeFitMin();
      if (scale < minScale - 1e-9) {
        scale = minScale;
      }
      if (Math.abs(scale - minScale) < 1e-6) {
        recenterFitTranslate();
      }
      clampPan();
      applyNow();
      if (typeof window.planogramSyncTileCardFonts === 'function') {
        window.planogramSyncTileCardFonts(wrap);
      }
    }

    function onViewportResizeAfterPaint() {
      requestAnimationFrame(function () {
        requestAnimationFrame(refreshFitAfterResize);
      });
    }

    var ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(onViewportResizeAfterPaint)
        : null;
    if (ro) {
      ro.observe(viewport);
      ro.observe(wrap);
    }

    window.addEventListener(
      'resize',
      refreshFitAfterResize,
      { passive: true }
    );

    function buildZoomLevels() {
      var fixed = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
      var levels = [minScale];
      var fi;
      for (fi = 0; fi < fixed.length; fi++) {
        if (fixed[fi] <= SCALE_MAX + 1e-9) levels.push(fixed[fi]);
      }
      levels.sort(function (a, b) {
        return a - b;
      });
      var out = [];
      var prev = -Infinity;
      var li;
      for (li = 0; li < levels.length; li++) {
        if (levels[li] - prev > 1e-6) {
          out.push(levels[li]);
          prev = levels[li];
        }
      }
      return out;
    }

    function closestLevelIndex(levels, s) {
      var best = 0;
      var bd = Infinity;
      var ii;
      for (ii = 0; ii < levels.length; ii++) {
        var d = Math.abs(levels[ii] - s);
        if (d < bd) {
          bd = d;
          best = ii;
        }
      }
      return best;
    }

    function zoomToolbarStep(dirSign) {
      var levels = buildZoomLevels();
      if (!levels.length) return;
      var idx = closestLevelIndex(levels, scale);
      var nextIdx =
        dirSign > 0
          ? Math.min(levels.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      var newScale = levels[nextIdx];
      var mx = viewport.clientWidth * 0.5;
      var my = viewport.clientHeight * 0.5;
      zoomAroundViewportPoint(mx, my, newScale);
      if (Math.abs(scale - minScale) < 1e-6) {
        recenterFitTranslate();
      }
      scheduleApply();
    }

    function fitVirtualPlanogramToViewportNow() {
      recomputeFitMin();
      scale = minScale;
      recenterFitTranslate();
      clampPan();
      scheduleApply();
      if (typeof window.planogramSyncTileCardFonts === 'function') {
        requestAnimationFrame(function () {
          window.planogramSyncTileCardFonts(wrap);
        });
      }
    }

    window.virtualPlanogramZoomFit = function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(fitVirtualPlanogramToViewportNow);
      });
    };
    window.virtualPlanogramZoomStep = function (dir) {
      var d = Number(dir);
      if (!isFinite(d)) return;
      zoomToolbarStep(d > 0 ? 1 : -1);
    };

    function bootstrapFit() {
      recomputeFitMin();
      scale = minScale;
      recenterFitTranslate();
      clampPan();
      applyNow();
      requestAnimationFrame(function () {
        recomputeFitMin();
        scale = minScale;
        recenterFitTranslate();
        clampPan();
        applyNow();
        if (typeof window.planogramSyncTileCardFonts === 'function') {
          window.planogramSyncTileCardFonts(wrap);
        }
      });
    }

    bootstrapFit();

    return function teardown() {
      viewport.removeEventListener('pointerdown', onPointerDown, {
        capture: true
      });
      viewport.removeEventListener('pointermove', onPointerMove, {
        capture: true
      });
      viewport.removeEventListener('pointerup', onPointerUp, { capture: true });
      viewport.removeEventListener('pointercancel', onPointerCancel, {
        capture: true
      });
      viewport.removeEventListener('click', onClickCapture, true);
      viewport.removeEventListener('dblclick', onDblClick, { capture: true });
      window.removeEventListener('resize', refreshFitAfterResize);
      if (ro) ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      window.virtualPlanogramZoomFit = virtualPlanogramZoomNoop;
      window.virtualPlanogramZoomStep = virtualPlanogramZoomNoop;
    };
  }

  var planogramZoomTeardownExternal = null;
  var virtualPagerTeardown = null;
  var pegViewToolbarTeardown = null;

  function clearVirtualPagerListeners() {
    if (typeof virtualPagerTeardown === 'function') {
      virtualPagerTeardown();
      virtualPagerTeardown = null;
    }
    if (typeof pegViewToolbarTeardown === 'function') {
      pegViewToolbarTeardown();
      pegViewToolbarTeardown = null;
    }
  }

  function bayHasPegboard(bay) {
    if (!bay || !bay.fixtures) return false;
    var i;
    for (i = 0; i < bay.fixtures.length; i++) {
      var f = bay.fixtures[i];
      if (f && f.type === 'pegboard' && f.products && f.products.length) {
        return true;
      }
    }
    return false;
  }

  function applyPegViewToContainer(containerEl) {
    if (!containerEl) return;
    containerEl.classList.toggle('pegview-active', !!pegViewState.enabled);
  }

  function renderPlanogram(containerEl, layoutData, products) {
    if (!containerEl || !layoutData) return;

    if (planogramZoomTeardownExternal) {
      planogramZoomTeardownExternal();
      planogramZoomTeardownExternal = null;
    }
    clearVirtualPagerListeners();

    var bayHeading = document.getElementById('pog-virtual-bay-heading');
    var pagerRow = document.getElementById('pog-virtual-pager-row');
    var pdfJumpRow = document.getElementById('pog-virtual-pdfjump-row');
    var zoomRow = document.getElementById('pog-virtual-zoom-row');
    var pegRow = document.getElementById('pog-virtual-pegview-row');
    var bays = layoutData.bays || [];

    pegViewContainerEl = containerEl;
    applyPegViewToContainer(containerEl);

    if (!bays.length) {
      containerEl.innerHTML = '';
      containerEl.hidden = true;
      activePlanogramWrapEl = null;
      if (bayHeading) {
        bayHeading.textContent = 'No bays to display';
        bayHeading.hidden = false;
      }
      if (pagerRow) pagerRow.hidden = true;
      if (pdfJumpRow) pdfJumpRow.hidden = true;
      if (zoomRow) zoomRow.hidden = true;
      if (pegRow) pegRow.hidden = true;
      return;
    }

    containerEl.hidden = false;
    if (pagerRow) pagerRow.hidden = false;
    if (pdfJumpRow) pdfJumpRow.hidden = false;
    if (zoomRow) zoomRow.hidden = false;

    containerEl.innerHTML = '';
    var viewport = document.createElement('div');
    viewport.className = 'planogram-zoom-viewport';
    var stage = document.createElement('div');
    stage.className = 'planogram-zoom-stage';
    var wrap = document.createElement('div');
    wrap.className = 'planogram-wrap';
    activePlanogramWrapEl = wrap;
    syncPlanogramWrapTileCardOpacity(wrap);

    var allBaysMaxHeight = 0;
    var bi;
    for (bi = 0; bi < bays.length; bi++) {
      var bay = bays[bi];
      if (bay.fixtures && bay.fixtures.length) {
        allBaysMaxHeight = Math.max(allBaysMaxHeight, computeBayOuterHeight(bay));
      }
    }
    if (allBaysMaxHeight < 1) allBaysMaxHeight = EMPTY_BAY_PX;

    var virtualPogBayIndex = 0;

    function syncBayChrome() {
      var m = bays.length;
      var n = virtualPogBayIndex + 1;
      if (bayHeading) {
        bayHeading.textContent = 'Bay ' + n + ' of ' + m;
        bayHeading.hidden = false;
      }
      var prevBtn = document.getElementById('pog-virtual-prev');
      var nextBtn = document.getElementById('pog-virtual-next');
      if (prevBtn) prevBtn.disabled = virtualPogBayIndex <= 0;
      if (nextBtn) nextBtn.disabled = virtualPogBayIndex >= m - 1;
      var pegRowEl = document.getElementById('pog-virtual-pegview-row');
      if (pegRowEl) {
        pegRowEl.hidden = !bayHasPegboard(bays[virtualPogBayIndex]);
      }
      pegViewSyncToolbar();
    }

    function mountActiveBay() {
      if (planogramZoomTeardownExternal) {
        planogramZoomTeardownExternal();
        planogramZoomTeardownExternal = null;
      }
      wrap.innerHTML = '';
      wrap.appendChild(renderBay(bays[virtualPogBayIndex], allBaysMaxHeight, products));
      applyPegViewToContainer(containerEl);
      planogramZoomTeardownExternal = attachPlanogramZoom(viewport, stage, wrap);
      syncBayChrome();
      syncPlanogramWrapTileCardOpacity(wrap);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          syncPlanogramTileCardFonts(wrap);
        });
      });
    }

    stage.appendChild(wrap);
    viewport.appendChild(stage);
    containerEl.appendChild(viewport);

    mountActiveBay();

    function viewPdfPogForCurrentBay() {
      var curBay = bays[virtualPogBayIndex];
      var rawPage = curBay && curBay.pdf_page;
      var pageNum =
        rawPage != null && Number.isFinite(Number(rawPage))
          ? Number(rawPage)
          : 1;
      var opener =
        typeof window.pogOpenSubView === 'function'
          ? window.pogOpenSubView
          : null;
      if (!opener) return;
      void opener('pdf').then(function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var j =
              typeof window.jumpToPdfPage === 'function'
                ? window.jumpToPdfPage
                : null;
            if (j) void j(pageNum);
          });
        });
      });
    }

    var prevBtn = document.getElementById('pog-virtual-prev');
    var nextBtn = document.getElementById('pog-virtual-next');
    var pdfToBayBtn = document.getElementById('pog-virtual-view-pdf-btn');

    if (prevBtn && nextBtn && typeof AbortController !== 'undefined') {
      var ac = new AbortController();
      virtualPagerTeardown = function () {
        ac.abort();
      };
      prevBtn.addEventListener(
        'click',
        function () {
          if (virtualPogBayIndex <= 0) return;
          virtualPogBayIndex--;
          mountActiveBay();
        },
        { signal: ac.signal }
      );
      nextBtn.addEventListener(
        'click',
        function () {
          if (virtualPogBayIndex >= bays.length - 1) return;
          virtualPogBayIndex++;
          mountActiveBay();
        },
        { signal: ac.signal }
      );
      if (pdfToBayBtn) {
        pdfToBayBtn.addEventListener('click', viewPdfPogForCurrentBay, {
          signal: ac.signal,
        });
      }
    } else if (prevBtn && nextBtn) {
      function onPrev() {
        if (virtualPogBayIndex <= 0) return;
        virtualPogBayIndex--;
        mountActiveBay();
      }
      function onNext() {
        if (virtualPogBayIndex >= bays.length - 1) return;
        virtualPogBayIndex++;
        mountActiveBay();
      }
      prevBtn.addEventListener('click', onPrev);
      nextBtn.addEventListener('click', onNext);
      if (pdfToBayBtn) pdfToBayBtn.addEventListener('click', viewPdfPogForCurrentBay);
      virtualPagerTeardown = function () {
        prevBtn.removeEventListener('click', onPrev);
        nextBtn.removeEventListener('click', onNext);
        if (pdfToBayBtn) pdfToBayBtn.removeEventListener('click', viewPdfPogForCurrentBay);
      };
    }

    var pegToggleBtn = document.getElementById('pog-virtual-pegview-toggle');
    var pegSlider = document.getElementById('pog-virtual-pegview-slider');
    var pegValueEl = document.getElementById('pog-virtual-pegview-value');

    pegViewSyncToolbar = function () {
      if (pegToggleBtn) {
        pegToggleBtn.setAttribute(
          'aria-pressed',
          pegViewState.enabled ? 'true' : 'false'
        );
        pegToggleBtn.textContent = pegViewState.enabled
          ? 'Peg View: On'
          : 'Peg View';
      }
      if (pegSlider) {
        var pct = cardOpacityToSliderPercent(pegViewState.tileCardOpacity);
        if (String(pegSlider.value) !== String(pct)) pegSlider.value = String(pct);
        pegSlider.disabled = false;
      }
      if (pegValueEl) {
        pegValueEl.textContent =
          cardOpacityToSliderPercent(pegViewState.tileCardOpacity) + '%';
      }
    };

    function onPegToggle() {
      pegViewState.enabled = !pegViewState.enabled;
      applyPegViewToContainer(containerEl);
      pegViewSyncToolbar();
    }

    if (pegToggleBtn) pegToggleBtn.addEventListener('click', onPegToggle);

    pegViewToolbarTeardown = function () {
      if (pegToggleBtn) pegToggleBtn.removeEventListener('click', onPegToggle);
      pegViewSyncToolbar = function () {};
    };

    pegViewSyncToolbar();
  }

  window.teardownPlanogramZoom = function () {
    clearVirtualPagerListeners();
    if (pegViewContainerEl) {
      pegViewContainerEl.classList.remove('pegview-active');
      pegViewContainerEl.style.removeProperty('--pegview-opacity');
      pegViewContainerEl = null;
    }
    activePlanogramWrapEl = null;
    if (!planogramZoomTeardownExternal) return;
    planogramZoomTeardownExternal();
    planogramZoomTeardownExternal = null;
  };

  /** Programmatic toggles (used by overlay JS and exposed for external callers). */
  window.virtualPlanogramTogglePegView = function (force) {
    var next =
      typeof force === 'boolean' ? force : !pegViewState.enabled;
    pegViewState.enabled = !!next;
    applyPegViewToContainer(pegViewContainerEl);
    pegViewSyncToolbar();
    return pegViewState.enabled;
  };

  window.virtualPlanogramSetPegOpacity = function (value) {
    var n = Number(value);
    if (!isFinite(n)) return;
    if (n > 1) n = sliderPercentToCardOpacity(n);
    else n = Math.max(0, Math.min(1, n));
    pegViewState.tileCardOpacity = n;
    syncPlanogramWrapTileCardOpacity(
      activePlanogramWrapEl ||
        (pegViewContainerEl &&
          pegViewContainerEl.querySelector('.planogram-wrap'))
    );
    pegViewSyncToolbar();
  };

  /** Reset tile-card overlay slider defaults when opening Virtual POG (called from index.html). */
  window.planogramResetVirtualOverlayDefaults = function () {
    pegViewState.tileCardOpacity = 1;
    syncPlanogramWrapTileCardOpacity(
      activePlanogramWrapEl ||
        (pegViewContainerEl &&
          pegViewContainerEl.querySelector('.planogram-wrap'))
    );
    pegViewSyncToolbar();
  };

  /**
   * Hub working view: render every bay in a scroll list using the same inch-accurate
   * pegboard/shelf layout as the standalone Checklanes virtual POG.
   */
  function fitHubBayToViewport(viewport, stage, wrap) {
    function applyFit() {
      var natW = Math.max(1, wrap.offsetWidth || 1);
      var natH = Math.max(1, wrap.offsetHeight || 1);
      var vw = viewport.clientWidth || 1;
      var vh = viewport.clientHeight || 1;
      var scale = Math.min(vw / natW, vh / natH);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      var tx = (vw - natW * scale) / 2;
      var ty = (vh - natH * scale) / 2;
      stage.style.transform =
        'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      if (typeof window.planogramSyncTileCardFonts === 'function') {
        window.planogramSyncTileCardFonts(wrap);
      }
    }

    applyFit();
    requestAnimationFrame(function () {
      requestAnimationFrame(applyFit);
    });

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(applyFit);
      ro.observe(viewport);
      ro.observe(wrap);
    }
    window.addEventListener('resize', applyFit);
  }

  function renderHubPlanogramBays(containerEl, layoutData, products) {
    if (!containerEl || !layoutData) return;

    containerEl.innerHTML = '';
    containerEl.classList.add('planogram-hub-bays');

    var bays = (layoutData.bays || []).slice();
    bays.sort(function (a, b) {
      return (a.bay_num || 0) - (b.bay_num || 0);
    });
    if (!bays.length) {
      containerEl.innerHTML = '<div class="pog-wv-empty">No bays in this layout.</div>';
      return;
    }

    var allBaysMaxHeight = 0;
    var bi;
    for (bi = 0; bi < bays.length; bi++) {
      if (bays[bi].fixtures && bays[bi].fixtures.length) {
        allBaysMaxHeight = Math.max(allBaysMaxHeight, computeBayOuterHeight(bays[bi]));
      }
    }
    if (allBaysMaxHeight < 1) allBaysMaxHeight = EMPTY_BAY_PX;

    for (bi = 0; bi < bays.length; bi++) {
      var bay = bays[bi];
      var bayWrap = document.createElement('div');
      bayWrap.className = 'pog-wv-bay planogram-hub-bay-wrap';
      bayWrap.dataset.bay = String(bay.bay_num);

      var head = document.createElement('div');
      head.className = 'pog-wv-bay-head';
      var headText =
        'Bay ' + (bay.bay_num != null ? bay.bay_num : '?') +
        ' · ' + (bay.width_ft != null ? bay.width_ft : '?') + ' ft · PDF page ' +
        (bay.pdf_page != null ? bay.pdf_page : '—');
      head.textContent = headText;
      if (bay.pdf_page != null) {
        var pdfBtn = document.createElement('button');
        pdfBtn.type = 'button';
        pdfBtn.className = 'pog-wv-bay-pdf-btn';
        pdfBtn.setAttribute('data-bay-pdf-page', String(bay.pdf_page));
        pdfBtn.textContent = 'View PDF';
        head.appendChild(pdfBtn);
      }
      bayWrap.appendChild(head);

      var fixturesWrap = document.createElement('div');
      fixturesWrap.className = 'pog-wv-fixtures planogram-hub-fixtures';

      var viewport = document.createElement('div');
      viewport.className = 'planogram-zoom-viewport planogram-hub-bay-viewport';
      viewport.setAttribute('data-fill-viewport', '1');

      var stage = document.createElement('div');
      stage.className = 'planogram-zoom-stage';

      var wrap = document.createElement('div');
      wrap.className = 'planogram-wrap';
      wrap.appendChild(renderBay(bay, allBaysMaxHeight, products));

      stage.appendChild(wrap);
      viewport.appendChild(stage);
      fixturesWrap.appendChild(viewport);
      bayWrap.appendChild(fixturesWrap);
      containerEl.appendChild(bayWrap);

      fitHubBayToViewport(viewport, stage, wrap);
    }

    activePlanogramWrapEl = containerEl;
    syncPlanogramWrapTileCardOpacity(containerEl);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        syncPlanogramTileCardFonts(containerEl);
      });
    });
  }

  window.renderPlanogram = renderPlanogram;
  window.renderHubPlanogramBays = renderHubPlanogramBays;

  function applyPegSliderValueFromDom() {
    var pegSliderEl = document.getElementById('pog-virtual-pegview-slider');
    if (!pegSliderEl) return;
    var raw = parseInt(pegSliderEl.value, 10);
    if (!isFinite(raw)) raw = 100;
    raw = Math.max(0, Math.min(100, raw));
    pegViewState.tileCardOpacity = sliderPercentToCardOpacity(raw);
    syncPlanogramWrapTileCardOpacity(
      activePlanogramWrapEl ||
        (pegViewContainerEl &&
          pegViewContainerEl.querySelector('.planogram-wrap'))
    );
    pegViewSyncToolbar();
  }

  (function bindVirtualPegSliderOnce() {
    var pegSliderEl = document.getElementById('pog-virtual-pegview-slider');
    if (!pegSliderEl || pegSliderEl.dataset.planogramInputBound === '1') return;
    pegSliderEl.dataset.planogramInputBound = '1';
    pegSliderEl.addEventListener('input', applyPegSliderValueFromDom);
  })();
})();
