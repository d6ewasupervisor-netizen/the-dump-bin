(function () {
  'use strict';

  var TOKEN = window.MEAT_PUSHER_TOKEN || '';
  var LABELS = {
    '556': '556 Ham Bar',
    '559': '559 Heat & Serve',
    '570': '570 Dinner Sausage',
    '575': '575 Hot Dogs',
    '578': '578 Bacon/Breakfast'
  };
  var SLOTS = { set: 'Set', shelf_back: 'Shelf back', pallet: 'Pallet', cases: 'Cases' };
  var STATUS_LABEL = { done: 'Done', revisit: 'Needs revisit', open: 'Not started' };

  var statusEl = document.getElementById('status');
  var storesEl = document.getElementById('stores');
  var detailEl = document.getElementById('detail');
  var shareBtn = document.getElementById('share');
  var toolbarEl = document.getElementById('toolbar');
  var filterSupEl = document.getElementById('filterSup');
  var filterStatusEl = document.getElementById('filterStatus');
  var selectAllEl = document.getElementById('selectAll');
  var countEl = document.getElementById('selCount');

  var allReports = [];
  var selected = null;
  var picked = {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function api(path, opts) {
    var url, f;
    if (TOKEN) {
      url = 'https://eod-api.the-dump-bin.com/api/meat-pusher-survey/shared' + path;
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(TOKEN);
      f = fetch;
    } else {
      url = '/api/meat-pusher-survey' + path;
      f = window.dumpBinAuthFetch || fetch;
    }
    return f(url, opts || {});
  }

  function listPath() { return TOKEN ? '/' : '/review'; }

  if (TOKEN) shareBtn.hidden = true;

  shareBtn.addEventListener('click', async function () {
    statusEl.textContent = '';
    try {
      var res = await api('/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not create the link');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(data.url);
        statusEl.textContent = 'Link copied.';
      } else {
        statusEl.textContent = data.url;
      }
    } catch (err) { statusEl.textContent = err.message || 'Could not create the link'; }
  });

  /* ---- filter helpers ---- */

  function visibleReports() {
    var sup = filterSupEl ? filterSupEl.value : '';
    var st = filterStatusEl ? filterStatusEl.value : '';
    return allReports.filter(function (r) {
      if (sup && (r.supervisor || '') !== sup) return false;
      if (st && (r.status || 'open') !== st) return false;
      return true;
    });
  }

  function updateCount() {
    var chosen = Object.keys(picked).filter(function (id) { return picked[id]; }).length;
    if (countEl) countEl.textContent = chosen ? chosen + ' selected' : '';
  }

  function applyFilters() {
    paintStores(visibleReports());
    updateCount();
  }

  if (filterSupEl) filterSupEl.addEventListener('change', applyFilters);
  if (filterStatusEl) filterStatusEl.addEventListener('change', applyFilters);

  if (selectAllEl) {
    selectAllEl.addEventListener('change', function () {
      var on = selectAllEl.checked;
      var vis = visibleReports();
      vis.forEach(function (r) { picked[String(r.id)] = on; });
      document.querySelectorAll('.store-row input[type=checkbox]').forEach(function (cb) {
        cb.checked = on;
      });
      updateCount();
    });
  }

  /* ---- export ---- */

  function chosenOrVisible() {
    var ids = Object.keys(picked).filter(function (id) { return picked[id]; });
    var list;
    if (ids.length) {
      list = allReports.filter(function (r) { return ids.indexOf(String(r.id)) !== -1; });
    } else {
      list = visibleReports().slice();
    }
    list.sort(function (a, b) { return Number(a.storeNumber) - Number(b.storeNumber); });
    return list;
  }

  async function doExport(fmt) {
    var list = chosenOrVisible();
    if (!list.length) { statusEl.textContent = 'No stores to export.'; return; }
    var pdfPath = TOKEN ? '/print.pdf' : '/reports/print.pdf';
    var xlsxPath = TOKEN ? '/export.xlsx' : '/reports/export.xlsx';
    var path = fmt === 'xlsx' ? xlsxPath : pdfPath;
    var filename = fmt === 'xlsx' ? 'Meat Pushers.xlsx' : 'Meat Pushers.pdf';
    statusEl.textContent = 'Building export.';
    try {
      var res = await api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ids: list.filter(function (r) { return !r.commentOnly; }).map(function (r) { return r.id; }),
          stores: list.filter(function (r) { return r.commentOnly; }).map(function (r) { return r.storeNumber; })
        })
      });
      if (!res.ok) {
        var data = await res.json().catch(function () { return {}; });
        statusEl.textContent = data.error || 'Could not export';
        return;
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      if (fmt !== 'xlsx') {
        var opened = window.open(url);
        if (!opened) { var a2 = document.createElement('a'); a2.href = url; a2.download = filename; document.body.appendChild(a2); a2.click(); a2.remove(); }
      } else {
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      statusEl.textContent = list.length + ' store' + (list.length > 1 ? 's' : '') + ' exported.';
    } catch (err) { statusEl.textContent = err.message || 'Could not export'; }
  }

  document.getElementById('printBtn').addEventListener('click', function () { doExport('pdf'); });
  document.getElementById('xlsxBtn').addEventListener('click', function () { doExport('xlsx'); });

  /* ---- import ---- */

  var importBtn = document.getElementById('importBtn');
  var importFile = document.getElementById('importFile');
  var importStatus = document.getElementById('importStatus');

  if (importBtn && importFile) {
    importBtn.addEventListener('click', function () { importFile.click(); });
    importFile.addEventListener('change', async function () {
      var file = importFile.files && importFile.files[0];
      if (!file) return;
      importStatus.textContent = 'Reading ' + file.name + '…';
      importBtn.disabled = true;
      try {
        var data = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result.split(',')[1]); };
          reader.onerror = function () { reject(new Error('Could not read the file')); };
          reader.readAsDataURL(file);
        });
        importStatus.textContent = 'Uploading…';
        var res = await api('/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: data })
        });
        var result = await res.json().catch(function () { return {}; });
        if (!res.ok || result.ok === false) throw new Error(result.error || 'Import failed');
        var msg = result.rows + ' rows · ' + (result.created || 0) + ' new stores · ' + (result.updated || 0) + ' updated · ' + (result.sets || 0) + ' answers · ' + (result.comments || 0) + ' comments';
        if (result.errors && result.errors.length) msg += ' · ' + result.errors.length + ' errors';
        importStatus.textContent = '✓ ' + msg;
        importStatus.style.color = '#2e8b57';
        statusEl.textContent = 'Sheet imported. Reloading board.';
        await new Promise(function (r) { setTimeout(r, 1200); });
        window.location.reload();
      } catch (err) {
        importStatus.textContent = '✗ ' + (err.message || 'Import failed');
        importStatus.style.color = '#C8102E';
        importBtn.disabled = false;
      }
      importFile.value = '';
    });
  }

  /* ---- store list ---- */

  function paintStores(reports) {
    storesEl.innerHTML = '';
    if (!reports.length) {
      storesEl.innerHTML = '<p class="none-msg">No stores match this filter.</p>';
      return;
    }
    reports.forEach(function (report) {
      var wrap = document.createElement('div');
      wrap.className = 'store-row';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!picked[String(report.id)];
      box.setAttribute('aria-label', 'Store ' + report.storeNumber);
      box.addEventListener('change', function () {
        picked[String(report.id)] = box.checked;
        if (selectAllEl) {
          var vis = visibleReports();
          selectAllEl.checked = vis.length > 0 && vis.every(function (r) { return picked[String(r.id)]; });
        }
        updateCount();
      });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = String(report.id);
      if (report.status) btn.classList.add(report.status);
      var mark = report.status === 'revisit' ? 'Needs revisit' : report.status === 'open' ? 'Not started' : '';
      var supLine = report.supervisor ? '<span class="sup-name">' + esc(report.supervisor) + '</span>' : '';
      btn.innerHTML = '<span class="store-no">' + esc(report.storeNumber) + '</span>' + supLine + esc(mark || report.reportedOn || '');
      btn.addEventListener('click', function () { show(report); });
      if (selected != null && String(report.id) === String(selected)) btn.classList.add('on');
      wrap.appendChild(box);
      wrap.appendChild(btn);
      storesEl.appendChild(wrap);
    });
  }

  /* ---- detail pane ---- */

  function show(report) {
    selected = report.id;
    document.querySelectorAll('.stores button').forEach(function (btn) {
      btn.classList.toggle('on', btn.dataset.id === String(report.id));
    });
    var stateHtml = '';
    if (report.status === 'revisit') {
      var missing = (report.missing || []).map(function (id) { return LABELS[id] || id; });
      stateHtml = '<p class="revisit">Needs to be revisited. Still open: ' + esc(missing.join(', ')) + '.</p>';
    } else if (report.status === 'open') {
      stateHtml = '<p>No answers yet.</p>';
    }
    var html = stateHtml +
      '<p class="detail-meta"><strong>Store ' + esc(report.storeNumber) + '</strong>' +
      (report.supervisor ? ' · ' + esc(report.supervisor) : '') +
      (report.reportedOn ? ' · ' + esc(report.reportedOn) : '') + '</p>' +
      '<label>Comment <textarea id="storeComment" rows="2">' + esc(report.comment || '') + '</textarea></label>' +
      '<p class="detail-btns"><button type="button" id="saveComment">Save comment</button>' +
      ' <button type="button" id="sheetThis">PDF this store</button>' +
      ' <button type="button" id="xlsxThis">XLSX this store</button></p>';
    (report.sets || []).forEach(function (set) {
      var pics = (report.photos || []).filter(function (p) { return String(p.commodity) === String(set.commodity); });
      var photoHtml = pics.length
        ? '<div class="photos">' + pics.map(function (p) {
          return '<figure><img data-photo="' + p.id + '" alt="' + esc(SLOTS[p.slot] || p.slot) + '"><figcaption>' + esc(SLOTS[p.slot] || p.slot) + '</figcaption></figure>';
        }).join('') + '</div>' : '';
      html += '<article class="set"><h2>' + esc(LABELS[set.commodity] || set.commodity) + '</h2>' +
        '<p class="answer">' + esc(set.sheet || set.answer || '') + '</p>' +
        (set.notes && set.sheet !== set.notes && set.answer !== set.notes ? '<p>' + esc(set.notes) + '</p>' : '') +
        photoHtml + '</article>';
    });
    var loose = (report.photos || []).filter(function (p) { return !p.commodity; });
    if (loose.length) {
      html += '<article class="set"><h2>Pallet</h2><div class="photos">' + loose.map(function (p) {
        return '<figure><img data-photo="' + p.id + '" alt="Pallet"><figcaption>Pallet</figcaption></figure>';
      }).join('') + '</div></article>';
    }
    if (report.install) {
      var inst = report.install;
      var lines = [
        inst.status ? 'Installation status: ' + inst.status : '',
        inst.time ? 'Installation time: ' + inst.time : '',
        inst.issues ? 'Issues faced: ' + inst.issues : '',
        inst.adjustments ? 'Shelf adjustments: ' + inst.adjustments : '',
        inst.recommendations ? 'Recommendations: ' + inst.recommendations : ''
      ].filter(Boolean);
      if (lines.length) html += '<article class="set"><h2>Install week</h2><p>' + lines.map(esc).join('<br>') + '</p></article>';
    }
    detailEl.innerHTML = html;

    detailEl.querySelector('#sheetThis').addEventListener('click', async function () {
      statusEl.textContent = 'Building PDF.';
      var path = TOKEN ? '/reports/' + report.id + '/form.pdf' : '/reports/' + report.id + '/form.pdf';
      var res = await api(path);
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); statusEl.textContent = d.error || 'Could not build'; return; }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'Meat Pushers Store ' + report.storeNumber + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
      statusEl.textContent = 'PDF downloaded.';
    });

    detailEl.querySelector('#xlsxThis').addEventListener('click', async function () {
      var single = { ids: report.commentOnly ? [] : [report.id], stores: report.commentOnly ? [report.storeNumber] : [] };
      var path = TOKEN ? '/export.xlsx' : '/reports/export.xlsx';
      statusEl.textContent = 'Building XLSX.';
      var res = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(single) });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); statusEl.textContent = d.error || 'Could not build'; return; }
      var blob = await res.blob();
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Meat Pushers Store ' + report.storeNumber + '.xlsx'; document.body.appendChild(a); a.click(); a.remove();
      statusEl.textContent = 'XLSX downloaded.';
    });

    detailEl.querySelector('#saveComment').addEventListener('click', async function () {
      var text = detailEl.querySelector('#storeComment').value;
      statusEl.textContent = 'Saving comment.';
      try {
        var res = await api('/comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ store: report.storeNumber, comment: text }) });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not save comment');
        report.comment = text;
        statusEl.textContent = 'Comment saved.';
      } catch (err) { statusEl.textContent = err.message || 'Could not save comment'; }
    });

    detailEl.querySelectorAll('img[data-photo]').forEach(function (img) {
      api((TOKEN ? '/photos/' : '/photos/') + img.getAttribute('data-photo')).then(function (res) {
        if (!res.ok) return null;
        return res.blob();
      }).then(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        img.src = url;
        img.addEventListener('click', function () { window.open(url, '_blank'); });
      });
    });
  }

  /* ---- boot ---- */

  async function boot() {
    if (TOKEN === '' && window.MEAT_PUSHER_SHARE) { statusEl.textContent = 'This link is not valid.'; return; }
    var res = await api(listPath());
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) { statusEl.textContent = data.error || 'Could not load reports'; return; }

    if (data.board && data.board.length) {
      allReports = data.board;
    } else {
      allReports = data.reports || [];
      (data.comments || []).forEach(function (row) {
        var hits = allReports.filter(function (r) { return r.storeNumber === row.number; });
        if (!hits.length) {
          allReports.push({ id: 'store-' + row.number, storeNumber: row.number, comment: row.comment, sets: [], photos: [], commentOnly: true });
        } else hits.forEach(function (r) { r.comment = row.comment; });
      });
      allReports.sort(function (a, b) { return Number(a.storeNumber) - Number(b.storeNumber); });
    }
    if (!allReports.length) { detailEl.innerHTML = '<p>No stores on file.</p>'; return; }

    /* populate supervisor filter */
    if (filterSupEl) {
      var sups = [];
      allReports.forEach(function (r) { if (r.supervisor && sups.indexOf(r.supervisor) === -1) sups.push(r.supervisor); });
      sups.sort();
      sups.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        filterSupEl.appendChild(opt);
      });
    }

    if (toolbarEl) toolbarEl.hidden = false;
    applyFilters();
    if (allReports.length) show(allReports[0]);
  }

  var ready = window.dumpBinAuthReady || Promise.resolve();
  ready.then(boot).catch(function () {});
})();
