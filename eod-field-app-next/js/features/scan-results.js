/* Scan results page and the popup you can reopen from the side nav. */
(function (global) {
  'use strict';

  function esc(s) {
    return global.EodApi?.escapeHtml?.(s) ?? String(s ?? '');
  }

  function rowLabel(row) {
    const match = row.match || {};
    return match.name || match.setName || row.upc || 'Item';
  }

  function resultsHtml(items) {
    const groups = global.EodScanBatch?.groupScanResults?.(items) || [];
    if (!groups.length) return '<p class="muted">No scans yet.</p>';
    return groups.map((group) => {
      const rows = (group.rows || []).map((row) => {
        const looking = row.status === 'looking'
          ? '<div class="muted">Looking up</div>'
          : '';
        const aisle = row.match?.locationVerbose
          ? `<div class="muted">${esc(row.match.locationVerbose)}</div>`
          : '';
        const dbkey = row.match?.dbkey || '';
        const tap = dbkey ? ' scan-result-row--tap' : '';
        return `<li class="scan-result-row${tap}" data-dbkey="${esc(dbkey)}" data-upc="${esc(row.upc || '')}" data-name="${esc(row.match?.setName || rowLabel(row))}">
          <strong>${esc(rowLabel(row))}</strong>
          <div class="muted">UPC ${esc(row.upc || '')}</div>
          ${aisle}
          ${looking}
        </li>`;
      }).join('');
      const setHead = group.setName
        ? `<h3 class="scan-result-set">${esc(group.setName)}</h3>`
        : '';
      return `<section class="scan-result-group">
        <h2>${esc(group.aisle)}</h2>
        ${setHead}
        <ul class="scan-result-list">${rows}</ul>
      </section>`;
    }).join('');
  }

  function bindPlanogram(root) {
    root?.querySelectorAll?.('.scan-result-row--tap')?.forEach((el) => {
      el.addEventListener('click', () => {
        const dbkey = el.getAttribute('data-dbkey') || '';
        if (!dbkey || !global.EodSiPlanogram?.openOverlay) return;
        const S = global.EodSession?.state || {};
        global.EodSiPlanogram.openOverlay({
          store: S.storeNumber,
          date: S.workDate,
          dbkey,
          title: el.getAttribute('data-name') || '',
          highlightUpc: el.getAttribute('data-upc') || '',
        });
      });
    });
  }

  function render(mount) {
    const items = global.EodScanBatch?.list?.() || [];
    mount.innerHTML = `<div class="card scan-results-page">
      <h1>Scan results</h1>
      <div id="scanResultsBody">${resultsHtml(items)}</div>
    </div>`;
    bindPlanogram(mount);
  }

  function openPopup() {
    const items = global.EodScanBatch?.list?.() || [];
    let host = document.getElementById('scanResultsPopup');
    if (host) host.remove();
    host = document.createElement('div');
    host.id = 'scanResultsPopup';
    host.className = 'modal-overlay show';
    host.innerHTML = `<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="scanResultsPopupTitle">
      <h2 id="scanResultsPopupTitle">Scan results</h2>
      <div id="scanResultsPopupBody" class="scan-results-popup-body">${resultsHtml(items)}</div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="scanResultsPopupClose">Close</button>
        <button type="button" class="btn btn-primary" id="scanResultsPopupOpen">Scan results</button>
      </div>
    </div>`;
    document.body.appendChild(host);
    bindPlanogram(host);
    const close = () => {
      global.EodA11y?.deactivate?.(host);
      host.remove();
    };
    host.querySelector('#scanResultsPopupClose').onclick = close;
    host.querySelector('#scanResultsPopupOpen').onclick = () => {
      close();
      global.EodRouter?.go?.('scans');
    };
    host.addEventListener('click', (e) => { if (e.target === host) close(); });
    global.EodA11y?.activate?.(host, '#scanResultsPopupOpen');
  }

  function repaint() {
    const popupBody = document.getElementById('scanResultsPopupBody');
    if (popupBody) {
      popupBody.innerHTML = resultsHtml(global.EodScanBatch?.list?.() || []);
      bindPlanogram(popupBody);
    }
    if (global.EodRouter?.current === 'scans') {
      const mount = document.getElementById('appMount');
      if (mount) render(mount);
    }
  }

  global.EodScanBatch?.subscribe?.(() => repaint());
  global.EodRouter?.register?.('scans', render);
  global.EodScanResults = { render, openPopup, resultsHtml };
})(typeof window !== 'undefined' ? window : globalThis);
