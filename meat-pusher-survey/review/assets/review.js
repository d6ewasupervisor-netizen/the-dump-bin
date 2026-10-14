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

  /* ---- import: two-phase preview → conflict resolve → commit ---- */

  var importBtn = document.getElementById('importBtn');
  var importFile = document.getElementById('importFile');
  var importStatus = document.getElementById('importStatus');
  var conflictModal = document.getElementById('conflictModal');

  function setImportStatus(msg, bad) {
    if (!importStatus) return;
    importStatus.textContent = msg;
    importStatus.style.color = bad ? '#C8102E' : '';
  }

  function closeModal() {
    if (conflictModal) conflictModal.hidden = true;
  }

  function readFileBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(',')[1]); };
      reader.onerror = function () { reject(new Error('Could not read the file')); };
      reader.readAsDataURL(file);
    });
  }

  async function doCommit(decisions, clean) {
    setImportStatus('Writing changes…');
    var res = await api('/import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: decisions, clean: clean })
    });
    var result = await res.json().catch(function () { return {}; });
    if (!res.ok || result.ok === false) throw new Error(result.error || 'Commit failed');
    return result;
  }

  function showConflictModal(conflicts, clean, filename) {
    if (!conflictModal) return;
    var decisions = {};
    conflicts.forEach(function (c) { decisions[c.storeNumber + '::' + c.field] = null; });

    function allResolved() {
      return conflicts.every(function (c) { return decisions[c.storeNumber + '::' + c.field] !== null; });
    }

    function setDecision(key, val) {
      decisions[key] = val;
      var row = conflictModal.querySelector('[data-key="' + key + '"]');
      if (row) {
        row.querySelectorAll('.conflict-action').forEach(function (b) {
          b.classList.toggle('active', b.dataset.action === val);
        });
      }
      var done = conflicts.filter(function (c) { return decisions[c.storeNumber + '::' + c.field] !== null; }).length;
      var prog = conflictModal.querySelector('#conflictProgress');
      if (prog) prog.textContent = done + ' of ' + conflicts.length + ' resolved';
      var commitBtn = conflictModal.querySelector('#conflictCommit');
      if (commitBtn) commitBtn.disabled = !allResolved();
    }

    function buildRow(c) {
      var key = c.storeNumber + '::' + c.field;
      return '<tr data-key="' + esc(key) + '">' +
        '<td class="cc-store"><strong>' + esc(c.storeNumber) + '</strong></td>' +
        '<td class="cc-field">' + esc(c.label) + '</td>' +
        '<td class="cc-db">' + esc(c.dbValue || '—') + '</td>' +
        '<td class="cc-sheet">' + esc(c.sheetValue || '—') + '</td>' +
        '<td class="cc-actions">' +
          '<button class="conflict-action" data-key="' + esc(key) + '" data-action="skip" title="Keep DB value, ignore sheet">Skip</button>' +
          '<button class="conflict-action" data-key="' + esc(key) + '" data-action="yes" title="Replace with sheet value">Yes</button>' +
          '<button class="conflict-action" data-key="' + esc(key) + '" data-action="no" title="Keep DB value and append sheet value as a conflicting detail">No</button>' +
        '</td>' +
      '</tr>';
    }

    var html = '<div class="cm-inner">' +
      '<div class="cm-head">' +
        '<h2>Conflicts in ' + esc(filename) + '</h2>' +
        '<p>' + conflicts.length + ' field' + (conflicts.length > 1 ? 's' : '') + ' differ between the sheet and the database.</p>' +
        '<div class="cm-bulk">' +
          '<button type="button" id="skipAll">Skip all</button>' +
          '<button type="button" id="yesAll">Yes to all</button>' +
          '<button type="button" id="noAll">No to all</button>' +
        '</div>' +
        '<p id="conflictProgress" class="cp">0 of ' + conflicts.length + ' resolved</p>' +
      '</div>' +
      '<div class="cm-legend">' +
        '<strong>Skip</strong> — keep the database value, ignore the sheet<br>' +
        '<strong>Yes</strong> — replace the database value with the sheet value<br>' +
        '<strong>No</strong> — keep the database value and append the sheet value as a conflicting detail' +
      '</div>' +
      '<div class="cm-table-wrap"><table class="cm-table">' +
        '<thead><tr><th>Store</th><th>Field</th><th>Current (DB)</th><th>Sheet value</th><th>Action</th></tr></thead>' +
        '<tbody>' + conflicts.map(buildRow).join('') + '</tbody>' +
      '</table></div>' +
      '<div class="cm-foot">' +
        '<button type="button" id="conflictCancel">Cancel import</button>' +
        '<button type="button" id="conflictCommit" disabled>Commit</button>' +
      '</div>' +
      '<p id="conflictStatus" class="cp" role="status"></p>' +
    '</div>';

    conflictModal.innerHTML = html;
    conflictModal.hidden = false;

    conflictModal.querySelector('#skipAll').addEventListener('click', function () {
      conflicts.forEach(function (c) { setDecision(c.storeNumber + '::' + c.field, 'skip'); });
    });
    conflictModal.querySelector('#yesAll').addEventListener('click', function () {
      conflicts.forEach(function (c) { setDecision(c.storeNumber + '::' + c.field, 'yes'); });
    });
    conflictModal.querySelector('#noAll').addEventListener('click', function () {
      conflicts.forEach(function (c) { setDecision(c.storeNumber + '::' + c.field, 'no'); });
    });
    conflictModal.querySelector('#conflictCancel').addEventListener('click', function () {
      closeModal();
      setImportStatus('Import cancelled.');
    });

    conflictModal.addEventListener('click', function (ev) {
      var b = ev.target.closest('.conflict-action');
      if (!b) return;
      setDecision(b.dataset.key, b.dataset.action);
    });

    conflictModal.querySelector('#conflictCommit').addEventListener('click', async function () {
      var commitBtn = conflictModal.querySelector('#conflictCommit');
      var conflictStatus = conflictModal.querySelector('#conflictStatus');
      commitBtn.disabled = true;
      conflictStatus.textContent = 'Writing…';
      try {
        var resolvedDecisions = conflicts.map(function (c) {
          return {
            storeNumber: c.storeNumber,
            field: c.field,
            action: decisions[c.storeNumber + '::' + c.field],
            sheetValue: c.sheetValue,
            sheetParsed: c.sheetParsed
          };
        });
        var result = await doCommit(resolvedDecisions, clean);
        closeModal();
        var msg = (result.sets || 0) + ' answers · ' + (result.comments || 0) + ' comments';
        if (result.skipped) msg += ' · ' + result.skipped + ' skipped';
        if (result.appended && result.appended.length) msg += ' · ' + result.appended.length + ' conflicting details appended';
        if (result.errors && result.errors.length) msg += ' · ' + result.errors.length + ' errors';
        setImportStatus('✓ Done — ' + msg);
        setTimeout(function () { window.location.reload(); }, 1500);
      } catch (err) {
        conflictStatus.textContent = '✗ ' + (err.message || 'Commit failed');
        commitBtn.disabled = false;
      }
    });
  }

  if (importBtn && importFile) {
    importBtn.addEventListener('click', function () { importFile.click(); });
    importFile.addEventListener('change', async function () {
      var file = importFile.files && importFile.files[0];
      if (!file) return;
      setImportStatus('Reading ' + file.name + '…');
      importBtn.disabled = true;
      try {
        var data = await readFileBase64(file);
        setImportStatus('Analyzing for conflicts…');
        var res = await api('/import/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: data })
        });
        var preview = await res.json().catch(function () { return {}; });
        if (!res.ok || preview.ok === false) throw new Error(preview.error || 'Preview failed');

        if (!preview.conflicts || !preview.conflicts.length) {
          // No conflicts — commit immediately
          setImportStatus('No conflicts. Importing ' + (preview.summary.totalRows || 0) + ' rows…');
          var result = await doCommit([], preview.clean || []);
          var msg = (result.sets || 0) + ' answers · ' + (result.comments || 0) + ' comments · ' + (result.created || 0) + ' new stores';
          setImportStatus('✓ Done — ' + msg);
          setTimeout(function () { window.location.reload(); }, 1500);
        } else {
          setImportStatus(preview.conflicts.length + ' conflict' + (preview.conflicts.length > 1 ? 's' : '') + ' found — resolve below.');
          showConflictModal(preview.conflicts, preview.clean || [], file.name);
        }
        importBtn.disabled = false;
      } catch (err) {
        setImportStatus('✗ ' + (err.message || 'Import failed'), true);
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

  /* ---- tab switching ---- */

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('on'); });
      btn.classList.add('on');
      var tab = btn.dataset.tab;
      var rev = document.getElementById('tabReview');
      var out = document.getElementById('tabOutreach');
      if (rev) rev.hidden = tab !== 'review';
      if (out) out.hidden = tab !== 'outreach';
      if (tab === 'outreach') loadOutreach();
    });
  });

  /* ---- outreach tab ---- */

  var outLoaded = false;

  function statusBadge(s) {
    return '<span class="badge-status ' + esc(s || 'open') + '">' + esc(s || 'open') + '</span>';
  }

  function loadOutreach() {
    if (outLoaded) return;
    outLoaded = true;
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    var end = new Date(); end.setDate(end.getDate() + 14);
    var endStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(end);
    document.getElementById('outStart').value = today;
    document.getElementById('outEnd').value = endStr;
    refreshAssignments();
  }

  document.getElementById('pullSas').addEventListener('click', function () {
    var start = document.getElementById('outStart').value;
    var end = document.getElementById('outEnd').value;
    var district = document.getElementById('outDistrict').value;
    var pullStatus = document.getElementById('pullStatus');
    var sasResults = document.getElementById('sasResults');
    pullStatus.textContent = 'Pulling from SAS PROD…';
    sasResults.innerHTML = '';
    var qs = '?startDate=' + encodeURIComponent(start) + '&endDate=' + encodeURIComponent(end);
    if (district) qs += '&districts=' + encodeURIComponent(district);
    api('/outreach/sas-leads' + qs).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data.ok) { pullStatus.textContent = '✗ ' + (data.error || 'Failed'); return; }
      var dists = data.districts || {};
      var keys = Object.keys(dists);
      if (!keys.length) { pullStatus.textContent = 'No leads found for that range/district.'; return; }
      pullStatus.textContent = 'Found leads in ' + keys.length + ' district' + (keys.length > 1 ? 's' : '') + '.';
      var html = '';
      keys.forEach(function (d) {
        var leads = dists[d];
        var rows = '';
        leads.forEach(function (L) {
          var storeList = (L.stores || []).map(function (s) { return s.storeNum; }).join(', ');
          rows += '<tr data-lead=\'' + esc(JSON.stringify({ name: L.name, email: L.email, district: d, stores: L.stores })) + '\'>' +
            '<td><input type="checkbox" class="sas-pick"></td>' +
            '<td>' + esc(L.name || '—') + '</td>' +
            '<td><input type="email" class="sas-email" value="' + esc(L.email || '') + '" placeholder="email@example.com"></td>' +
            '<td>' + esc(storeList) + '</td>' +
            '</tr>';
        });
        html += '<div class="out-section"><div class="out-section-head"><span>District ' + esc(d) + '</span></div>' +
          '<table class="out-table"><thead><tr><th></th><th>Name</th><th>Email</th><th>Stores</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>' +
          '<div class="out-actions">' +
            '<button type="button" class="primary assign-all" data-district="' + esc(d) + '">Assign all in D' + esc(d) + '</button>' +
            '<button type="button" class="yellow assign-sel">Assign selected</button>' +
          '</div></div>';
      });
      sasResults.innerHTML = html;
      sasResults.querySelectorAll('.assign-all').forEach(function (btn) {
        btn.addEventListener('click', function () { assignFromTable(sasResults, null); });
      });
      sasResults.querySelectorAll('.assign-sel').forEach(function (btn) {
        btn.addEventListener('click', function () { assignFromTable(btn.closest('.out-section'), true); });
      });
    }).catch(function (err) { pullStatus.textContent = '✗ ' + err.message; });
  });

  function assignFromTable(container, selectedOnly) {
    var rows = container.querySelectorAll('tbody tr');
    var assignments = [];
    rows.forEach(function (tr) {
      var cb = tr.querySelector('.sas-pick');
      if (selectedOnly && !cb.checked) return;
      var emailInput = tr.querySelector('.sas-email');
      var email = emailInput ? emailInput.value.trim() : '';
      if (!email) return;
      var lead = JSON.parse(tr.getAttribute('data-lead') || '{}');
      (lead.stores || []).forEach(function (s) {
        assignments.push({
          storeNumber: String(s.storeNum || ''),
          district: lead.district || '',
          assigneeEmail: email,
          assigneeName: lead.name || '',
        });
      });
    });
    if (!assignments.length) { document.getElementById('pullStatus').textContent = 'No rows selected or no emails filled in.'; return; }
    document.getElementById('pullStatus').textContent = 'Assigning ' + assignments.length + ' store pair' + (assignments.length > 1 ? 's' : '') + '…';
    api('/outreach/assignments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignments: assignments }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      document.getElementById('pullStatus').textContent = data.ok
        ? '✓ ' + (data.created || 0) + ' assignment' + (data.created !== 1 ? 's' : '') + ' saved.'
        : '✗ ' + (data.error || 'Failed');
      if (data.ok) refreshAssignments();
    }).catch(function (err) { document.getElementById('pullStatus').textContent = '✗ ' + err.message; });
  }

  function refreshAssignments() {
    var district = document.getElementById('asgDistrict') && document.getElementById('asgDistrict').value;
    var status = document.getElementById('asgStatus') && document.getElementById('asgStatus').value;
    var qs = '?';
    if (district) qs += 'district=' + encodeURIComponent(district) + '&';
    if (status) qs += 'status=' + encodeURIComponent(status);
    api('/outreach/assignments' + qs).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) return;
      renderAssignments(data.assignments || []);
    }).catch(function () {});
  }

  document.getElementById('loadAssignments') && document.getElementById('loadAssignments').addEventListener('click', refreshAssignments);
  document.getElementById('asgDistrict') && document.getElementById('asgDistrict').addEventListener('change', refreshAssignments);
  document.getElementById('asgStatus') && document.getElementById('asgStatus').addEventListener('change', refreshAssignments);

  function renderAssignments(assignments) {
    var container = document.getElementById('asgResults');
    if (!assignments.length) { container.innerHTML = '<p style="padding:12px">No assignments yet.</p>'; return; }

    // group by district
    var byDist = {};
    assignments.forEach(function (a) {
      var d = a.district || 'Unassigned';
      if (!byDist[d]) byDist[d] = [];
      byDist[d].push(a);
    });

    var html = '';
    var distKeys = Object.keys(byDist).sort(function (a, b) {
      return Number(a.replace(/\D/g, '') || 99) - Number(b.replace(/\D/g, '') || 99);
    });
    distKeys.forEach(function (d) {
      var rows = byDist[d].map(function (a) {
        var surveyBadge = statusBadge(a.survey_status || 'open');
        var asgBadge = statusBadge(a.status || 'assigned');
        var invited = a.invite_sent_at ? new Date(a.invite_sent_at).toLocaleDateString() : '—';
        var reminded = a.last_reminded_at ? new Date(a.last_reminded_at).toLocaleDateString() : '—';
        return '<tr>' +
          '<td><input type="checkbox" class="asg-pick" data-id="' + esc(a.id) + '"></td>' +
          '<td>' + esc(a.store_number) + '</td>' +
          '<td>' + esc(a.assignee_name || '—') + '</td>' +
          '<td>' + esc(a.assignee_email) + '</td>' +
          '<td>' + esc(a.supervisor_email || '—') + '</td>' +
          '<td>' + asgBadge + '</td>' +
          '<td>' + surveyBadge + '</td>' +
          '<td>' + esc(invited) + '</td>' +
          '<td>' + esc(reminded) + '</td>' +
          '</tr>';
      }).join('');
      html += '<div class="out-section">' +
        '<div class="out-section-head"><span>District ' + esc(d) + ' — ' + byDist[d].length + ' assignment' + (byDist[d].length !== 1 ? 's' : '') + '</span>' +
          '<label style="margin-left:auto;font-size:0.85rem;cursor:pointer"><input type="checkbox" class="sel-all-dist" style="margin-right:6px">All</label></div>' +
        '<div style="overflow-x:auto"><table class="out-table"><thead><tr>' +
          '<th></th><th>Store</th><th>Name</th><th>Email</th><th>Supervisor</th><th>Status</th><th>Survey</th><th>Invited</th><th>Last reminder</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="out-actions">' +
          '<button type="button" class="primary send-invite">Send invite</button>' +
          '<button type="button" send-remind="1" class="send-remind">Send reminder</button>' +
          '<button type="button" class="mark-done">Mark done</button>' +
        '</div></div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('.sel-all-dist').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var section = cb.closest('.out-section');
        section.querySelectorAll('.asg-pick').forEach(function (r) { r.checked = cb.checked; });
      });
    });

    container.querySelectorAll('.send-invite').forEach(function (btn) {
      btn.addEventListener('click', function () { bulkAction(btn, 'invite'); });
    });
    container.querySelectorAll('.send-remind').forEach(function (btn) {
      btn.addEventListener('click', function () { bulkAction(btn, 'remind'); });
    });
    container.querySelectorAll('.mark-done').forEach(function (btn) {
      btn.addEventListener('click', function () { bulkAction(btn, 'done'); });
    });
  }

  function bulkAction(btn, action) {
    var section = btn.closest('.out-section');
    var ids = [];
    section.querySelectorAll('.asg-pick:checked').forEach(function (cb) { ids.push(Number(cb.dataset.id)); });
    if (!ids.length) { statusEl.textContent = 'Check at least one row.'; return; }
    statusEl.textContent = action === 'invite' ? 'Sending invites…' : action === 'remind' ? 'Sending reminders…' : 'Marking done…';
    var path = action === 'invite' ? '/outreach/assignments/invite'
              : action === 'remind' ? '/outreach/assignments/remind'
              : null;
    if (!path) {
      // mark done one by one
      Promise.all(ids.map(function (id) {
        return api('/outreach/assignments/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }).then(function (r) { return r.json(); });
      })).then(function () {
        statusEl.textContent = 'Marked done.';
        refreshAssignments();
      });
      return;
    }
    api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ids }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
        var ok = (data.results || []).filter(function (r) { return r.ok; }).length;
        var fail = (data.results || []).filter(function (r) { return !r.ok; }).length;
        statusEl.textContent = '✓ ' + ok + ' sent' + (fail ? ', ' + fail + ' failed' : '') + '.';
        refreshAssignments();
      }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  }

  var ready = window.dumpBinAuthReady || Promise.resolve();
  ready.then(boot).catch(function () {});
})();
