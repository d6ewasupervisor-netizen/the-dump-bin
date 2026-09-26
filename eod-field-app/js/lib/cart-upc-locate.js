/* Store-wide UPC locate: Kroger aisle + SI set/planogram when both hit. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const NOT_FOUND = 'This item cannot be located at this time.';

  function esc(s) {
    return global.EodApi.escapeHtml(s);
  }

  function sessionStore() {
    const S = global.EodSession?.state || {};
    return {
      store: S.storeNumber || document.getElementById('storeNumber')?.value || '',
      date: S.workDate || document.getElementById('workDate')?.value || '',
    };
  }

  function locLine(m) {
    if (m.locationVerbose) return m.locationVerbose;
    const bits = [
      m.aisle ? `Aisle ${m.aisle}` : '',
      m.bay != null ? `Bay ${m.bay}` : '',
      m.shelf != null ? `Shelf ${m.shelf}` : '',
      m.position != null ? `Position ${m.position}` : '',
      m.onShelfPosition || '',
    ].filter(Boolean);
    return bits.join(' · ');
  }

  function setLabel(m) {
    return String(m.setName || m.categoryName || '').trim();
  }

  function hasPlanogram(m) {
    return Boolean(m.dbkey);
  }

  function moneyText(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function priceHtml(m) {
    const price = m && m.price;
    if (!price || typeof price !== 'object') return '';
    const regular = moneyText(price.regular);
    const promoRaw = moneyText(price.promo);
    const promo = promoRaw && (!regular || Number(promoRaw) < Number(regular)) ? promoRaw : '';
    const headline = promo || regular;
    if (!headline) return '';
    const unit = String(price.soldBy || '').toUpperCase() === 'WEIGHT' ? '/lb' : '';
    const reg = promo && regular
      ? `<span class="eod-locate-price-reg">Reg $${esc(regular)}</span>`
      : '';
    return `<div class="eod-locate-price">$${esc(headline)}${unit}${reg}</div>`;
  }

  function matchHtml(m) {
    const src = m.source || '';
    const parts = src.split('+');
    const withKroger = parts.includes('kroger');
    const withSi = parts.includes('si') || Boolean(m.dbkey);
    const notesAction = m.notesAction === 'new' || m.notesAction === 'delete' ? m.notesAction : '';
    const set = notesAction ? (m.notesSet || setLabel(m)) : setLabel(m);
    const tap = hasPlanogram(m);
    const img = m.imageUrl
      ? (/^https?:\/\//i.test(m.imageUrl)
        ? `<img alt="" src="${esc(m.imageUrl)}">`
        : `<img alt="" data-pog-src="${esc(m.imageUrl)}">`)
      : '';
    const title = notesAction
      ? (m.name || set || 'Item')
      : (withKroger ? (m.name || 'Item') : (set || m.name || 'Item'));
    const subtitle = notesAction
      ? [m.brand, m.size].filter(Boolean).join(' · ')
      : (withKroger
        ? [m.brand, m.size].filter(Boolean).join(' · ')
        : (m.name || ''));
    const meta = withKroger
      ? (m.stockLevel ? `Stock ${m.stockLevel}` : '')
      : [m.brand, m.size].filter(Boolean).join(' · ');
    const notesTag = notesAction === 'new'
      ? '<div class="eod-locate-notes eod-locate-notes--new">New item</div>'
      : notesAction === 'delete'
        ? '<div class="eod-locate-notes eod-locate-notes--delete">Delete</div>'
        : '';
    const sourceTag = notesTag + (withKroger && withSi
      ? '<div class="muted">Fred Meyer aisle · Kompass set</div>'
      : withKroger
        ? '<div class="muted">Fred Meyer aisle</div>'
        : withSi
          ? '<div class="muted">Kompass set</div>'
          : '');
    const setBlock = set
      ? `<div class="eod-locate-set">Set: ${esc(set)}</div>`
      : '';
    const tapHint = tap
      ? '<div class="muted eod-locate-tap">Tap to open planogram</div>'
      : '';
    const cls = [
      'eod-locate-hit',
      withKroger ? 'eod-locate-hit--kroger' : '',
      tap ? 'eod-locate-hit--tap' : '',
    ].filter(Boolean).join(' ');
    return `<article class="${cls}" data-dbkey="${esc(m.dbkey || '')}" data-name="${esc(set || m.name || '')}" data-upc="${esc(m.upc || '')}" data-source="${esc(src)}">
      <div class="eod-locate-thumb">${img}</div>
      <div class="eod-locate-copy">
        ${sourceTag}
        <strong>${esc(title)}</strong>
        ${priceHtml(m)}
        ${subtitle ? `<div>${esc(subtitle)}</div>` : ''}
        ${meta ? `<div>${esc(meta)}</div>` : ''}
        ${setBlock}
        <div class="muted">UPC ${esc(m.upc || '')}</div>
        <div class="eod-locate-aisle">${esc(locLine(m))}</div>
        ${tapHint}
      </div>
    </article>`;
  }

  function resultHtml(data) {
    if (!data?.found || !(data.matches || []).length) {
      return `<p class="eod-locate-miss">${esc(NOT_FOUND)}</p>`;
    }
    return (data.matches || []).map(matchHtml).join('');
  }

  async function locate(upc) {
    const { store, date } = sessionStore();
    const qs = new URLSearchParams({ store, date, upc });
    const resp = await global.authFetch(`${API}/locate?${qs}`, { skipBusy: true });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Locate failed (${resp.status})`);
    return data;
  }

  function showResult(upc, data) {
    let host = document.getElementById('eodLocateOverlay');
    if (host) host.remove();
    host = document.createElement('div');
    host.id = 'eodLocateOverlay';
    host.className = 'set-media-overlay eod-locate-overlay';
    host.innerHTML = `<div class="set-media-overlay-bar">
      <button type="button" class="btn btn-secondary" id="eodLocateClose">Close</button>
      <button type="button" class="btn btn-secondary" id="eodLocateAgain">Scan</button>
      <strong>UPC ${esc(upc)}</strong>
    </div>
    <div id="eodLocateBody" class="eod-locate-body">${resultHtml(data)}</div>`;
    document.body.appendChild(host);
    document.body.classList.add('set-media-open');
    host.querySelector('#eodLocateClose').onclick = closeResult;
    host.querySelector('#eodLocateAgain').onclick = () => {
      closeResult();
      openScanner();
    };
    host.querySelectorAll('.eod-locate-hit').forEach((el) => {
      el.addEventListener('click', () => {
        const dbkey = el.getAttribute('data-dbkey') || '';
        const title = el.getAttribute('data-name') || '';
        const hitUpc = el.getAttribute('data-upc') || upc;
        const { store, date } = sessionStore();
        if (!dbkey || !global.EodSiPlanogram?.openOverlay) return;
        closeResult();
        global.EodSiPlanogram.openOverlay({ store, date, dbkey, title, highlightUpc: hitUpc });
      });
    });
    if (global.EodSiPlanogram?.hydrateImages) {
      global.EodSiPlanogram.hydrateImages(host.querySelector('#eodLocateBody'));
    }
  }

  function closeResult() {
    document.getElementById('eodLocateOverlay')?.remove();
    document.body.classList.remove('set-media-open');
  }

  async function onScanned(upc) {
    try {
      const data = await locate(upc);
      showResult(upc, data);
    } catch (err) {
      showResult(upc, { found: false });
      const body = document.getElementById('eodLocateBody');
      if (body && err && err.message) {
        body.innerHTML = `<p class="eod-locate-miss">${esc(NOT_FOUND)}</p>`;
      }
    }
  }

  let batch = null;

  function hideAsk() {
    document.getElementById('eodScanMoreAsk')?.remove();
  }

  function hideDone() {
    const bar = document.getElementById('eodScanDoneBar');
    if (bar) bar.hidden = true;
  }

  function paintCount() {
    const hint = document.getElementById('eodBarcodeHint');
    if (!hint || !batch?.bulk) return;
    const n = batch.items.length;
    hint.textContent = n === 1 ? '1 item' : `${n} items`;
  }

  function enqueue(upc) {
    const code = String(upc || '');
    const have = batch?.items?.find((item) => item.upc === code);
    if (have) return have;
    const item = { upc: code, status: 'looking', data: null, promise: null };
    item.promise = locate(code).then((data) => {
      item.data = data;
      item.status = data?.found ? 'ready' : 'miss';
      if (batch?.bulk) {
        global.EodScanBatch?.commit?.(batch.items);
        paintCount();
      }
      return data;
    }).catch(() => {
      item.data = { found: false };
      item.status = 'miss';
      if (batch?.bulk) global.EodScanBatch?.commit?.(batch.items);
      return item.data;
    });
    batch.items.push(item);
    if (batch.bulk) {
      global.EodScanBatch?.commit?.(batch.items);
      paintCount();
    }
    return item;
  }

  async function finishSingle(item) {
    hideAsk();
    hideDone();
    const upc = item?.upc;
    batch = null;
    await global.EodBarcodeScanner?.close?.();
    let data = item?.data;
    if (!data && item?.promise) {
      try { data = await item.promise; } catch (_) { data = { found: false }; }
    }
    showResult(upc, data || { found: false });
  }

  async function finishBulk() {
    const items = batch?.items ? batch.items.slice() : [];
    batch = null;
    hideAsk();
    hideDone();
    await global.EodBarcodeScanner?.close?.();
    if (!items.length) return;
    global.EodScanBatch?.commit?.(items);
    global.EodScanResults?.openPopup?.();
  }

  function ensureDoneBar() {
    const sheet = document.querySelector('#eodBarcodeOverlay .eod-barcode-sheet');
    if (!sheet || document.getElementById('eodScanDoneBar')) return;
    const bar = document.createElement('div');
    bar.id = 'eodScanDoneBar';
    bar.className = 'eod-scan-done';
    bar.hidden = true;
    bar.innerHTML = '<button type="button" class="btn btn-primary" id="eodScanDoneBtn">Done Scanning</button>';
    sheet.appendChild(bar);
    bar.querySelector('#eodScanDoneBtn').onclick = () => { void finishBulk(); };
  }

  function showAsk(item) {
    hideAsk();
    const host = document.createElement('div');
    host.id = 'eodScanMoreAsk';
    host.className = 'modal-overlay show eod-scan-ask';
    host.innerHTML = `<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="eodScanMoreTitle">
      <h2 id="eodScanMoreTitle">Scan more items?</h2>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="eodScanMoreNo">No</button>
        <button type="button" class="btn btn-primary" id="eodScanMoreYes">Yes</button>
      </div>
    </div>`;
    document.body.appendChild(host);
    global.EodA11y?.activate?.(host, '#eodScanMoreYes');
    host.querySelector('#eodScanMoreNo').onclick = () => { void finishSingle(item); };
    host.querySelector('#eodScanMoreYes').onclick = () => {
      global.EodA11y?.deactivate?.(host);
      host.remove();
      if (!batch) return;
      batch.bulk = true;
      global.EodBarcodeScanner?.setAccepting?.(true);
      ensureDoneBar();
      const bar = document.getElementById('eodScanDoneBar');
      if (bar) bar.hidden = false;
      global.EodScanBatch?.commit?.(batch.items);
      paintCount();
    };
  }

  function armClose() {
    const btn = document.getElementById('eodBarcodeClose');
    if (!btn || btn.dataset.scanBatch === '1') return;
    btn.dataset.scanBatch = '1';
    btn.onclick = () => {
      if (batch?.bulk && batch.items?.length) {
        void finishBulk();
        return;
      }
      batch = null;
      hideAsk();
      hideDone();
      void global.EodBarcodeScanner?.close?.();
    };
  }

  async function openScanner() {
    if (!global.EodBarcodeScanner?.start) return;
    batch = null;
    hideAsk();
    hideDone();
    await global.EodBarcodeScanner.start((upc) => {
      if (!batch) {
        batch = { items: [], bulk: false };
        global.EodBarcodeScanner.setAccepting?.(false);
        showAsk(enqueue(upc));
        return;
      }
      if (!batch.bulk) return;
      enqueue(upc);
      paintCount();
    }, { continuous: true });
    armClose();
    ensureDoneBar();
  }

  async function warmIndex() {
    const { store, date } = sessionStore();
    if (!store) return;
    try {
      const qs = new URLSearchParams({ store, date });
      await global.authFetch(`${API}/locate-index?${qs}`, { skipBusy: true });
    } catch (_) { /* first scan will build */ }
  }

  global.EodCartLocate = {
    openScanner,
    warmIndex,
    locate,
    priceHtml,
    NOT_FOUND,
  };
})(typeof window !== 'undefined' ? window : globalThis);
