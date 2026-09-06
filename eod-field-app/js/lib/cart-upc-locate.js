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

  function matchHtml(m) {
    const src = m.source || '';
    const withKroger = src === 'kroger' || src === 'kroger+si';
    const withSi = src === 'si' || src === 'kroger+si';
    const set = setLabel(m);
    const tap = hasPlanogram(m);
    const img = m.imageUrl
      ? (/^https?:\/\//i.test(m.imageUrl)
        ? `<img alt="" src="${esc(m.imageUrl)}">`
        : `<img alt="" data-pog-src="${esc(m.imageUrl)}">`)
      : '';
    const title = withKroger ? (m.name || 'Item') : (set || m.name || 'Item');
    const subtitle = withKroger
      ? [m.brand, m.size].filter(Boolean).join(' · ')
      : (m.name || '');
    const meta = withKroger
      ? (m.stockLevel ? `Stock ${m.stockLevel}` : '')
      : [m.brand, m.size].filter(Boolean).join(' · ');
    const sourceTag = withKroger && withSi
      ? '<div class="muted">Fred Meyer aisle · Kompass set</div>'
      : withKroger
        ? '<div class="muted">Fred Meyer aisle</div>'
        : '<div class="muted">Kompass set</div>';
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

  function openScanner() {
    if (!global.EodBarcodeScanner?.start) return;
    global.EodBarcodeScanner.start(onScanned);
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
    NOT_FOUND,
  };
})(typeof window !== 'undefined' ? window : globalThis);
