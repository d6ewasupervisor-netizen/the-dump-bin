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
  var crewCache = {};       // district -> people[]
  var lastSummary = null;

  function pacificYmd(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d || new Date());
  }

  function badge(kind, text) {
    return '<span class="badge-status ' + esc(kind) + '">' + esc(text || kind) + '</span>';
  }

  function storeChip(storeNumber, surveyStatus) {
    var label = surveyStatus === 'done' ? 'done' : surveyStatus === 'revisit' ? 'partial' : 'open';
    return '<span class="store-chip ' + esc(surveyStatus || 'open') + '" title="' + esc(label) + '">' + esc(storeNumber) + '</span>';
  }

  function setPull(msg, bad) {
    var el = document.getElementById('pullStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = bad ? '#C8102E' : '';
  }

  function loadOutreach() {
    if (outLoaded || !document.getElementById('outStart')) return;
    outLoaded = true;
    var startEl = document.getElementById('outStart');
    var endEl = document.getElementById('outEnd');
    var today = new Date();
    var plus14 = new Date(); plus14.setDate(plus14.getDate() + 14);
    startEl.value = pacificYmd(today);
    endEl.value = pacificYmd(plus14);
    api('/outreach/cycles').then(function (r) { return r.json(); }).then(function (data) {
      var c = data && (data.current || data.next);
      if (c && c.startDate && c.endDate) {
        startEl.value = c.startDate;
        endEl.value = c.endDate;
        setPull('Range set to ' + (data.current ? 'current' : 'next') + ' ISE cycle: ' + c.name + '.');
      }
    }).catch(function () {});
    refreshAssignments();
  }

  document.getElementById('pullSas') && document.getElementById('pullSas').addEventListener('click', function () { pullCrew(false); });

  function pullCrew(refresh) {
    var start = document.getElementById('outStart').value;
    var end = document.getElementById('outEnd').value;
    var district = document.getElementById('outDistrict').value;
    var btn = document.getElementById('pullSas');
    var results = document.getElementById('sasResults');
    btn.disabled = true;
    setPull('Pulling Kompass ISE shifts from SAS PROD…');
    results.innerHTML = '';
    var qs = '?startDate=' + encodeURIComponent(start) + '&endDate=' + encodeURIComponent(end);
    if (district) qs += '&districts=' + encodeURIComponent(district);
    if (refresh) qs += '&refresh=1';
    api('/outreach/crew' + qs).then(function (r) { return r.json(); }).then(function (data) {
      btn.disabled = false;
      if (!data.ok) { setPull('✗ ' + (data.error || 'Pull failed'), true); return; }
      var dists = data.districts || {};
      var keys = Object.keys(dists);
      var diag = data.diagnostics || {};
      if (!keys.length) {
        var why = diag.visits === 0
          ? 'No ISE visits in that range.'
          : diag.shifts === 0
            ? diag.visits + ' visits but no shifts on them yet.'
            : 'Shifts found, but no team names matched a district (teams seen: ' + (diag.teamsSeen || []).join(', ') + ').';
        setPull(why, true);
        return;
      }
      var people = keys.reduce(function (n, k) { return n + dists[k].length; }, 0);
      setPull('Found ' + people + ' people across ' + keys.length + ' district' + (keys.length > 1 ? 's' : '') +
        ' (' + diag.usableVisits + ' visits, ' + diag.shifts + ' shifts' + (diag.noEmail ? ', ' + diag.noEmail + ' shifts with no email' : '') + ').');
      crewCache = dists;
      renderCrew(dists);
    }).catch(function (err) { btn.disabled = false; setPull('✗ ' + err.message, true); });
  }

  function renderCrew(dists) {
    var container = document.getElementById('sasResults');
    var html = '';
    Object.keys(dists).forEach(function (d) {
      var people = dists[d];
      var rows = people.map(function (P, i) {
        var stores = (P.stores || []).map(function (s) { return s.storeNum; });
        var uniq = stores.filter(function (v, idx) { return stores.indexOf(v) === idx; });
        return '<tr data-district="' + esc(d) + '" data-idx="' + i + '">' +
          '<td><input type="checkbox" class="crew-pick"></td>' +
          '<td><strong>' + esc(P.name || '—') + '</strong>' + (P.isLead ? ' ' + badge('lead', 'Lead') : ' ' + badge('crew', 'Crew')) + '</td>' +
          '<td><input type="email" class="crew-email" value="' + esc(P.email || '') + '" placeholder="no email on file"></td>' +
          '<td>' + (P.supervisorName ? '<div>' + esc(P.supervisorName) + '</div>' : '') +
            '<input type="email" class="crew-sup" value="' + esc(P.supervisorEmail || '') + '" placeholder="supervisor email"></td>' +
          '<td class="chips">' + uniq.map(function (sn) { return storeChip(sn, ''); }).join('') + '</td>' +
          '</tr>';
      }).join('');
      html += '<div class="out-section" data-district="' + esc(d) + '">' +
        '<div class="out-section-head"><span>District ' + esc(d.replace(/^D/, '')) + ' · ' + people.length + ' people</span>' +
          '<label class="head-check"><input type="checkbox" class="crew-all">All</label></div>' +
        '<div class="tbl-wrap"><table class="out-table"><thead><tr><th></th><th>Person</th><th>Email</th><th>Supervisor</th><th>Stores</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        '<div class="out-actions">' +
          '<button type="button" class="primary crew-assign-sel">Assign selected</button>' +
          '<button type="button" class="crew-assign-all">Assign everyone in D' + esc(d.replace(/^D/, '')) + '</button>' +
        '</div></div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('.crew-all').forEach(function (cb) {
      cb.addEventListener('change', function () {
        cb.closest('.out-section').querySelectorAll('.crew-pick').forEach(function (r) { r.checked = cb.checked; });
      });
    });
    container.querySelectorAll('.crew-assign-sel').forEach(function (btn) {
      btn.addEventListener('click', function () { assignFromSection(btn.closest('.out-section'), true); });
    });
    container.querySelectorAll('.crew-assign-all').forEach(function (btn) {
      btn.addEventListener('click', function () { assignFromSection(btn.closest('.out-section'), false); });
    });
  }

  function assignFromSection(section, selectedOnly) {
    var district = section.getAttribute('data-district');
    var people = [];
    var missing = [];
    section.querySelectorAll('tbody tr').forEach(function (tr) {
      if (selectedOnly && !tr.querySelector('.crew-pick').checked) return;
      var P = (crewCache[district] || [])[Number(tr.getAttribute('data-idx'))];
      if (!P) return;
      var email = tr.querySelector('.crew-email').value.trim().toLowerCase();
      var sup = tr.querySelector('.crew-sup').value.trim().toLowerCase();
      if (!email) { missing.push(P.name || '(no name)'); return; }
      var stores = (P.stores || []).map(function (s) { return s.storeNum; });
      people.push({
        name: P.name, email: email, district: district === 'Unknown' ? null : district,
        isLead: !!P.isLead, workdayId: P.workdayId || null,
        supervisorEmail: sup || null, supervisorName: P.supervisorName || null,
        stores: stores.filter(function (v, i) { return stores.indexOf(v) === i; })
      });
    });
    if (!people.length) {
      setPull(missing.length ? 'Fill in an email for: ' + missing.join(', ') : 'Check at least one person.', true);
      return;
    }
    setPull('Saving ' + people.length + ' assignment' + (people.length > 1 ? 's' : '') + '…');
    api('/outreach/assignments', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ people: people })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) { setPull('✗ ' + (data.error || 'Failed'), true); return; }
      var msg = '✓ ' + data.people + ' people assigned to ' + data.created + ' store slot' + (data.created !== 1 ? 's' : '') + '.';
      if (missing.length) msg += ' Skipped (no email): ' + missing.join(', ') + '.';
      setPull(msg);
      refreshAssignments();
    }).catch(function (err) { setPull('✗ ' + err.message, true); });
  }

  /* assignments */

  function refreshAssignments() {
    if (!document.getElementById('asgDistrict')) return;
    var district = document.getElementById('asgDistrict').value;
    var status = document.getElementById('asgStatus').value;
    var qs = [];
    if (district) qs.push('district=' + encodeURIComponent(district));
    if (status) qs.push('status=' + encodeURIComponent(status));
    api('/outreach/assignments' + (qs.length ? '?' + qs.join('&') : '')).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) { statusEl.textContent = data.error || 'Could not load assignments'; return; }
      renderAssignments(data.assignments || []);
      populateDistrictFilter(data.assignments || []);
    }).catch(function () {});
  }

  function populateDistrictFilter(assignments) {
    var sel = document.getElementById('asgDistrict');
    var current = sel.value;
    var seen = {};
    assignments.forEach(function (a) { if (a.district) seen[a.district] = true; });
    var keys = Object.keys(seen).sort(function (a, b) { return Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')); });
    var existing = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    keys.forEach(function (k) {
      if (existing.indexOf(k) === -1) {
        var o = document.createElement('option'); o.value = k; o.textContent = 'District ' + k.replace(/^D/, ''); sel.appendChild(o);
      }
    });
    sel.value = current;
  }

  document.getElementById('loadAssignments') && document.getElementById('loadAssignments').addEventListener('click', refreshAssignments);
  document.getElementById('asgDistrict') && document.getElementById('asgDistrict').addEventListener('change', refreshAssignments);
  document.getElementById('asgStatus') && document.getElementById('asgStatus').addEventListener('change', refreshAssignments);

  function renderAssignments(assignments) {
    var container = document.getElementById('asgResults');
    var summaryBar = document.getElementById('summaryBar');
    if (!assignments.length) {
      container.innerHTML = '<p class="none-msg">No assignments yet. Pull from PROD above, then assign.</p>';
      if (summaryBar) summaryBar.hidden = true;
      return;
    }
    if (summaryBar) summaryBar.hidden = false;

    var byDist = {};
    assignments.forEach(function (a) {
      var d = a.district || 'Unassigned';
      if (!byDist[d]) byDist[d] = {};
      var key = a.assignee_email;
      if (!byDist[d][key]) {
        byDist[d][key] = { name: a.assignee_name, email: key, isLead: !!a.is_lead, supervisor: a.supervisor_email, ids: [], stores: [], status: a.status, invited: a.invite_sent_at, reminded: a.last_reminded_at };
      }
      var P = byDist[d][key];
      P.ids.push(a.id);
      P.stores.push({ n: a.store_number, s: a.survey_status });
      if (a.status === 'done' && P.status !== 'done') P.status = a.status;
      if (a.invite_sent_at && (!P.invited || a.invite_sent_at < P.invited)) P.invited = a.invite_sent_at;
      if (a.last_reminded_at && (!P.reminded || a.last_reminded_at > P.reminded)) P.reminded = a.last_reminded_at;
    });

    var keys = Object.keys(byDist).sort(function (a, b) { return (Number(a.replace(/\D/g, '')) || 999) - (Number(b.replace(/\D/g, '')) || 999); });
    var html = '';
    keys.forEach(function (d) {
      var people = Object.keys(byDist[d]).map(function (k) { return byDist[d][k]; })
        .sort(function (a, b) { return (b.isLead - a.isLead) || String(a.name || '').localeCompare(String(b.name || '')); });
      var rows = people.map(function (P) {
        P.stores.sort(function (a, b) { return Number(a.n) - Number(b.n); });
        var allDone = P.stores.every(function (s) { return s.s === 'done'; });
        var status = allDone ? 'done' : P.status;
        return '<tr data-ids="' + esc(P.ids.join(',')) + '">' +
          '<td><input type="checkbox" class="asg-pick"></td>' +
          '<td><strong>' + esc(P.name || '—') + '</strong>' + (P.isLead ? ' ' + badge('lead', 'Lead') : '') + '<div class="sub">' + esc(P.email) + '</div></td>' +
          '<td class="sub">' + esc(P.supervisor || '—') + '</td>' +
          '<td class="chips">' + P.stores.map(function (s) { return storeChip(s.n, s.s); }).join('') + '</td>' +
          '<td>' + badge(status, status === 'done' ? 'Done' : status === 'invited' ? 'Emailed' : 'Assigned') + '</td>' +
          '<td class="sub">' + (P.invited ? esc(new Date(P.invited).toLocaleDateString()) : '—') + '</td>' +
          '<td class="sub">' + (P.reminded && P.invited && P.reminded !== P.invited ? esc(new Date(P.reminded).toLocaleDateString()) : '—') + '</td>' +
          '</tr>';
      }).join('');
      html += '<div class="out-section">' +
        '<div class="out-section-head"><span>District ' + esc(d.replace(/^D/, '')) + ' · ' + people.length + ' people</span>' +
          '<label class="head-check"><input type="checkbox" class="asg-all">All</label></div>' +
        '<div class="tbl-wrap"><table class="out-table"><thead><tr>' +
          '<th></th><th>Person</th><th>Supervisor</th><th>Stores</th><th>Status</th><th>Emailed</th><th>Reminded</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="out-actions">' +
          '<button type="button" class="primary act-invite">Send invite</button>' +
          '<button type="button" class="act-remind">Send reminder</button>' +
          '<button type="button" class="act-done">Mark done</button>' +
          '<button type="button" class="act-remove danger">Remove</button>' +
        '</div></div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('.asg-all').forEach(function (cb) {
      cb.addEventListener('change', function () {
        cb.closest('.out-section').querySelectorAll('.asg-pick').forEach(function (r) { r.checked = cb.checked; });
      });
    });
    container.querySelectorAll('.act-invite').forEach(function (b) { b.addEventListener('click', function () { bulkAction(b, 'invite'); }); });
    container.querySelectorAll('.act-remind').forEach(function (b) { b.addEventListener('click', function () { bulkAction(b, 'remind'); }); });
    container.querySelectorAll('.act-done').forEach(function (b) { b.addEventListener('click', function () { bulkAction(b, 'done'); }); });
    container.querySelectorAll('.act-remove').forEach(function (b) { b.addEventListener('click', function () { bulkAction(b, 'remove'); }); });
  }

  function checkedIds(section) {
    var ids = [];
    section.querySelectorAll('tr').forEach(function (tr) {
      var cb = tr.querySelector('.asg-pick');
      if (cb && cb.checked) {
        String(tr.getAttribute('data-ids') || '').split(',').forEach(function (v) { if (v) ids.push(Number(v)); });
      }
    });
    return ids;
  }

  function bulkAction(btn, action) {
    var section = btn.closest('.out-section');
    var ids = checkedIds(section);
    if (!ids.length) { statusEl.textContent = 'Check at least one person.'; return; }
    var people = section.querySelectorAll('.asg-pick:checked').length;
    if (action === 'remove' && !window.confirm('Remove ' + people + ' assignment' + (people > 1 ? 's' : '') + '?')) return;
    var labels = { invite: 'Sending invites…', remind: 'Sending reminders…', done: 'Marking done…', remove: 'Removing…' };
    statusEl.textContent = labels[action];
    var path = action === 'invite' ? '/outreach/assignments/invite'
      : action === 'remind' ? '/outreach/assignments/remind'
      : action === 'remove' ? '/outreach/assignments/delete'
      : '/outreach/assignments/status';
    var body = action === 'done' ? { ids: ids, status: 'done' } : { ids: ids };
    api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
        if (data.results) {
          var ok = data.results.filter(function (r) { return r.ok; });
          var fail = data.results.filter(function (r) { return !r.ok; });
          statusEl.textContent = '✓ ' + ok.length + ' email' + (ok.length !== 1 ? 's' : '') + ' sent' +
            (fail.length ? '. Failed: ' + fail.map(function (f) { return f.email + ' (' + f.error + ')'; }).join('; ') : '.');
        } else if (data.removed != null) {
          statusEl.textContent = '✓ Removed ' + data.removed + '.';
        } else {
          statusEl.textContent = '✓ Updated.';
        }
        refreshAssignments();
      }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  }

  /* summary to management */

  document.getElementById('summaryPreview') && document.getElementById('summaryPreview').addEventListener('click', function () {
    var box = document.getElementById('summaryBox');
    var district = document.getElementById('asgDistrict').value;
    statusEl.textContent = 'Building summary…';
    api('/outreach/summary' + (district ? '?district=' + encodeURIComponent(district) : '')).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
      lastSummary = data;
      box.hidden = false;
      box.innerHTML = '<div class="summary-head">To: ' + esc(data.to) + (district ? ' · District ' + esc(district.replace(/^D/, '')) : ' · all districts') + '</div>' + data.html;
      statusEl.textContent = '';
    }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  });

  document.getElementById('summarySend') && document.getElementById('summarySend').addEventListener('click', function () {
    var district = document.getElementById('asgDistrict').value;
    var to = (lastSummary && lastSummary.to) || 'amanda.mathews@retailodyssey.com';
    if (!window.confirm('Email the assignment summary to ' + to + (district ? ' for District ' + district.replace(/^D/, '') : ' for all districts') + '?')) return;
    statusEl.textContent = 'Sending summary…';
    api('/outreach/summary/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ district: district || null })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
      statusEl.textContent = '✓ Summary sent to ' + data.to + (data.cc && data.cc.length ? ' (cc ' + data.cc.join(', ') + ')' : '') + '.';
    }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  });

  var ready = window.dumpBinAuthReady || Promise.resolve();
  ready.then(boot).catch(function () {});
})();
