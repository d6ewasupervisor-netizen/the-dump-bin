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
  var groupChipsEl = document.getElementById('groupChips');
  var statusChipsEl = document.getElementById('statusChips');
  var selectAllEl = document.getElementById('selectAll');
  var countEl = document.getElementById('selCount');
  var filterSummaryEl = document.getElementById('filterSummary');

  var allReports = [];
  var groups = [];
  var groupByKey = {};
  var selected = null;
  var picked = {};
  var filters = { groups: {}, statuses: {} }; // key -> true; empty = all

  function $(id) { return document.getElementById(id); }

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

  if (TOKEN && shareBtn) shareBtn.hidden = true;

  if (shareBtn) shareBtn.addEventListener('click', async function () {
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

  /* ---- shared filter: district · supervisor groups × status ---- */

  function activeGroupKeys() { return Object.keys(filters.groups).filter(function (k) { return filters.groups[k]; }); }
  function activeStatuses() { return Object.keys(filters.statuses).filter(function (k) { return filters.statuses[k]; }); }

  function visibleReports() {
    var g = activeGroupKeys();
    var s = activeStatuses();
    return allReports.filter(function (r) {
      if (g.length && g.indexOf(r.groupKey || '') === -1) return false;
      if (s.length && s.indexOf(r.status || 'open') === -1) return false;
      return true;
    });
  }

  function describeFilter() {
    var g = activeGroupKeys();
    var s = activeStatuses();
    var parts = [];
    parts.push(g.length ? g.map(function (k) { return (groupByKey[k] || {}).label || k; }).join(', ') : 'All districts');
    parts.push(s.length ? s.map(function (k) { return STATUS_LABEL[k] || k; }).join(' + ') : 'any status');
    return parts.join(' · ');
  }

  function renderChips() {
    if (groupChipsEl) {
      var g = activeGroupKeys();
      groupChipsEl.innerHTML =
        '<span class="chip-label">District · Supervisor</span>' +
        '<button type="button" class="chip' + (g.length ? '' : ' on') + '" data-group="">All</button>' +
        groups.map(function (grp) {
          var n = allReports.filter(function (r) { return r.groupKey === grp.key; }).length;
          return '<button type="button" class="chip' + (filters.groups[grp.key] ? ' on' : '') + '" data-group="' + esc(grp.key) + '" title="' + esc(grp.supervisorEmail || '') + '">' +
            esc(grp.label) + ' <span class="chip-n">' + n + '</span></button>';
        }).join('');
    }
    if (statusChipsEl) {
      var s = activeStatuses();
      var notDone = filters.statuses.revisit && filters.statuses.open && !filters.statuses.done;
      statusChipsEl.innerHTML =
        '<span class="chip-label">Status</span>' +
        '<button type="button" class="chip' + (s.length ? '' : ' on') + '" data-status="">All</button>' +
        ['done', 'revisit', 'open'].map(function (k) {
          var n = allReports.filter(function (r) { return (r.status || 'open') === k; }).length;
          return '<button type="button" class="chip st-' + k + (filters.statuses[k] ? ' on' : '') + '" data-status="' + k + '">' + esc(STATUS_LABEL[k]) + ' <span class="chip-n">' + n + '</span></button>';
        }).join('') +
        '<button type="button" class="chip chip-combo' + (notDone ? ' on' : '') + '" data-status="notdone">Not done</button>';
    }
    if (filterSummaryEl) {
      var vis = visibleReports();
      filterSummaryEl.textContent = vis.length + ' store' + (vis.length === 1 ? '' : 's') + ' · ' + describeFilter();
    }
  }

  function applyFilters() {
    renderChips();
    paintStores(visibleReports());
    if (selectAllEl) {
      var vis = visibleReports();
      selectAllEl.checked = vis.length > 0 && vis.every(function (r) { return picked[String(r.id)]; });
    }
    updateCount();
    if (outreachVisible()) renderOutreachStores();
  }

  if (groupChipsEl) groupChipsEl.addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip');
    if (!b) return;
    var key = b.getAttribute('data-group');
    if (key === '') filters.groups = {};
    else filters.groups[key] = !filters.groups[key];
    applyFilters();
  });

  if (statusChipsEl) statusChipsEl.addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip');
    if (!b) return;
    var key = b.getAttribute('data-status');
    if (key === '') filters.statuses = {};
    else if (key === 'notdone') {
      var on = filters.statuses.revisit && filters.statuses.open && !filters.statuses.done;
      filters.statuses = on ? {} : { revisit: true, open: true };
    } else filters.statuses[key] = !filters.statuses[key];
    applyFilters();
  });

  function updateCount() {
    var chosen = Object.keys(picked).filter(function (id) { return picked[id]; }).length;
    if (countEl) countEl.textContent = chosen ? chosen + ' selected' : '';
  }

  if (selectAllEl) {
    selectAllEl.addEventListener('change', function () {
      var on = selectAllEl.checked;
      visibleReports().forEach(function (r) { picked[String(r.id)] = on; });
      document.querySelectorAll('.store-row input[type=checkbox]').forEach(function (cb) { cb.checked = on; });
      updateCount();
    });
  }

  /* ---- export ---- */

  function chosenOrVisible() {
    var ids = Object.keys(picked).filter(function (id) { return picked[id]; });
    var list = ids.length
      ? allReports.filter(function (r) { return ids.indexOf(String(r.id)) !== -1; })
      : visibleReports().slice();
    list.sort(function (a, b) { return Number(a.storeNumber) - Number(b.storeNumber); });
    return list;
  }

  async function doExport(fmt) {
    var list = chosenOrVisible();
    if (!list.length) { statusEl.textContent = 'No stores to export.'; return; }
    var path = fmt === 'xlsx' ? (TOKEN ? '/export.xlsx' : '/reports/export.xlsx') : (TOKEN ? '/print.pdf' : '/reports/print.pdf');
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
        var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      }
      statusEl.textContent = list.length + ' store' + (list.length > 1 ? 's' : '') + ' exported.';
    } catch (err) { statusEl.textContent = err.message || 'Could not export'; }
  }

  if ($('printBtn')) $('printBtn').addEventListener('click', function () { doExport('pdf'); });
  if ($('xlsxBtn')) $('xlsxBtn').addEventListener('click', function () { doExport('xlsx'); });

  /* ---- import: preview → resolve conflicts → commit ---- */

  var importBtn = $('importBtn');
  var importFile = $('importFile');
  var importStatus = $('importStatus');
  var conflictModal = $('conflictModal');

  function setImportStatus(msg, bad) {
    if (!importStatus) return;
    importStatus.textContent = msg;
    importStatus.style.color = bad ? '#C8102E' : '';
  }

  function closeModal() { if (conflictModal) conflictModal.hidden = true; }

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
      method: 'POST', headers: { 'content-type': 'application/json' },
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

    function allResolved() { return conflicts.every(function (c) { return decisions[c.storeNumber + '::' + c.field] !== null; }); }

    function setDecision(key, val) {
      decisions[key] = val;
      var row = conflictModal.querySelector('[data-key="' + key + '"]');
      if (row) row.querySelectorAll('.conflict-action').forEach(function (b) { b.classList.toggle('active', b.dataset.action === val); });
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
        '</td></tr>';
    }

    conflictModal.innerHTML = '<div class="cm-inner">' +
      '<div class="cm-head"><h2>Conflicts in ' + esc(filename) + '</h2>' +
        '<p>' + conflicts.length + ' field' + (conflicts.length > 1 ? 's' : '') + ' differ between the sheet and the database.</p>' +
        '<div class="cm-bulk"><button type="button" id="skipAll">Skip all</button><button type="button" id="yesAll">Yes to all</button><button type="button" id="noAll">No to all</button></div>' +
        '<p id="conflictProgress" class="cp">0 of ' + conflicts.length + ' resolved</p></div>' +
      '<div class="cm-legend"><strong>Skip</strong> — keep the database value, ignore the sheet<br><strong>Yes</strong> — replace the database value with the sheet value<br><strong>No</strong> — keep the database value and append the sheet value as a conflicting detail</div>' +
      '<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Store</th><th>Field</th><th>Current (DB)</th><th>Sheet value</th><th>Action</th></tr></thead><tbody>' + conflicts.map(buildRow).join('') + '</tbody></table></div>' +
      '<div class="cm-foot"><button type="button" id="conflictCancel">Cancel import</button><button type="button" id="conflictCommit" disabled>Commit</button></div>' +
      '<p id="conflictStatus" class="cp" role="status"></p></div>';
    conflictModal.hidden = false;

    conflictModal.querySelector('#skipAll').addEventListener('click', function () { conflicts.forEach(function (c) { setDecision(c.storeNumber + '::' + c.field, 'skip'); }); });
    conflictModal.querySelector('#yesAll').addEventListener('click', function () { conflicts.forEach(function (c) { setDecision(c.storeNumber + '::' + c.field, 'yes'); }); });
    conflictModal.querySelector('#noAll').addEventListener('click', function () { conflicts.forEach(function (c) { setDecision(c.storeNumber + '::' + c.field, 'no'); }); });
    conflictModal.querySelector('#conflictCancel').addEventListener('click', function () { closeModal(); setImportStatus('Import cancelled.'); });
    conflictModal.addEventListener('click', function (ev) {
      var b = ev.target.closest('.conflict-action');
      if (b) setDecision(b.dataset.key, b.dataset.action);
    });
    conflictModal.querySelector('#conflictCommit').addEventListener('click', async function () {
      var commitBtn = conflictModal.querySelector('#conflictCommit');
      var conflictStatus = conflictModal.querySelector('#conflictStatus');
      commitBtn.disabled = true;
      conflictStatus.textContent = 'Writing…';
      try {
        var resolved = conflicts.map(function (c) {
          return { storeNumber: c.storeNumber, field: c.field, action: decisions[c.storeNumber + '::' + c.field], sheetValue: c.sheetValue, sheetParsed: c.sheetParsed };
        });
        var result = await doCommit(resolved, clean);
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
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: data })
        });
        var preview = await res.json().catch(function () { return {}; });
        if (!res.ok || preview.ok === false) throw new Error(preview.error || 'Preview failed');
        if (!preview.conflicts || !preview.conflicts.length) {
          setImportStatus('No conflicts. Importing ' + (preview.summary.totalRows || 0) + ' rows…');
          var result = await doCommit([], preview.clean || []);
          setImportStatus('✓ Done — ' + (result.sets || 0) + ' answers · ' + (result.comments || 0) + ' comments · ' + (result.created || 0) + ' new stores');
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

  /* ---- store list (Review tab) ---- */

  function paintStores(reports) {
    if (!storesEl) return;
    storesEl.innerHTML = '';
    if (!reports.length) { storesEl.innerHTML = '<p class="none-msg">No stores match this filter.</p>'; return; }
    reports.forEach(function (report) {
      var wrap = document.createElement('div');
      wrap.className = 'store-row';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!picked[String(report.id)];
      box.setAttribute('aria-label', 'Store ' + report.storeNumber);
      box.addEventListener('change', function () {
        picked[String(report.id)] = box.checked;
        if (selectAllEl) { var vis = visibleReports(); selectAllEl.checked = vis.length > 0 && vis.every(function (r) { return picked[String(r.id)]; }); }
        updateCount();
      });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = String(report.id);
      if (report.status) btn.classList.add(report.status);
      var mark = report.status === 'revisit' ? 'Needs revisit' : report.status === 'open' ? 'Not started' : '';
      var sub = report.group ? '<span class="sup-name">' + esc(report.group) + '</span>' : (report.supervisor ? '<span class="sup-name">' + esc(report.supervisor) + '</span>' : '');
      btn.innerHTML = '<span class="store-no">' + esc(report.storeNumber) + (report.storeName ? ' <span class="store-name">' + esc(report.storeName) + '</span>' : '') + '</span>' + sub + esc(mark || report.reportedOn || '');
      btn.addEventListener('click', function () { show(report); });
      if (selected != null && String(report.id) === String(selected)) btn.classList.add('on');
      wrap.appendChild(box);
      wrap.appendChild(btn);
      storesEl.appendChild(wrap);
    });
  }

  /* ---- detail pane ---- */

  function show(report) {
    if (!detailEl) return;
    selected = report.id;
    document.querySelectorAll('.stores button').forEach(function (btn) { btn.classList.toggle('on', btn.dataset.id === String(report.id)); });
    var stateHtml = '';
    if (report.status === 'revisit') {
      var missing = (report.missing || []).map(function (id) { return LABELS[id] || id; });
      stateHtml = '<p class="revisit">Needs to be revisited. Still open: ' + esc(missing.join(', ')) + '.</p>';
    } else if (report.status === 'open') stateHtml = '<p>No answers yet.</p>';
    var html = stateHtml +
      '<p class="detail-meta"><strong>Store ' + esc(report.storeNumber) + '</strong>' + (report.storeName ? ' ' + esc(report.storeName) : '') +
      (report.group ? ' · ' + esc(report.group) : (report.supervisor ? ' · ' + esc(report.supervisor) : '')) +
      (report.reportedOn ? ' · ' + esc(report.reportedOn) : '') + '</p>' +
      '<label>Comment <textarea id="storeComment" rows="2">' + esc(report.comment || '') + '</textarea></label>' +
      '<p class="detail-btns"><button type="button" id="saveComment">Save comment</button> <button type="button" id="sheetThis">PDF this store</button> <button type="button" id="xlsxThis">XLSX this store</button></p>';
    (report.sets || []).forEach(function (set) {
      var pics = (report.photos || []).filter(function (p) { return String(p.commodity) === String(set.commodity); });
      var photoHtml = pics.length ? '<div class="photos">' + pics.map(function (p) {
        return '<figure><img data-photo="' + p.id + '" alt="' + esc(SLOTS[p.slot] || p.slot) + '"><figcaption>' + esc(SLOTS[p.slot] || p.slot) + '</figcaption></figure>';
      }).join('') + '</div>' : '';
      html += '<article class="set"><h2>' + esc(LABELS[set.commodity] || set.commodity) + '</h2><p class="answer">' + esc(set.sheet || set.answer || '') + '</p>' +
        (set.notes && set.sheet !== set.notes && set.answer !== set.notes ? '<p>' + esc(set.notes) + '</p>' : '') + photoHtml + '</article>';
    });
    var loose = (report.photos || []).filter(function (p) { return !p.commodity; });
    if (loose.length) html += '<article class="set"><h2>Pallet</h2><div class="photos">' + loose.map(function (p) { return '<figure><img data-photo="' + p.id + '" alt="Pallet"><figcaption>Pallet</figcaption></figure>'; }).join('') + '</div></article>';
    if (report.install) {
      var inst = report.install;
      var lines = [inst.status ? 'Installation status: ' + inst.status : '', inst.time ? 'Installation time: ' + inst.time : '', inst.issues ? 'Issues faced: ' + inst.issues : '', inst.adjustments ? 'Shelf adjustments: ' + inst.adjustments : '', inst.recommendations ? 'Recommendations: ' + inst.recommendations : ''].filter(Boolean);
      if (lines.length) html += '<article class="set"><h2>Install week</h2><p>' + lines.map(esc).join('<br>') + '</p></article>';
    }
    detailEl.innerHTML = html;

    detailEl.querySelector('#sheetThis').addEventListener('click', async function () {
      statusEl.textContent = 'Building PDF.';
      var res = await api('/reports/' + report.id + '/form.pdf');
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); statusEl.textContent = d.error || 'Could not build'; return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'Meat Pushers Store ' + report.storeNumber + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
      statusEl.textContent = 'PDF downloaded.';
    });
    detailEl.querySelector('#xlsxThis').addEventListener('click', async function () {
      var single = { ids: report.commentOnly ? [] : [report.id], stores: report.commentOnly ? [report.storeNumber] : [] };
      statusEl.textContent = 'Building XLSX.';
      var res = await api(TOKEN ? '/export.xlsx' : '/reports/export.xlsx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(single) });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); statusEl.textContent = d.error || 'Could not build'; return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'Meat Pushers Store ' + report.storeNumber + '.xlsx'; document.body.appendChild(a); a.click(); a.remove();
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
      api('/photos/' + img.getAttribute('data-photo')).then(function (res) { return res.ok ? res.blob() : null; }).then(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        img.src = url;
        img.addEventListener('click', function () { window.open(url, '_blank'); });
      });
    });
  }

  /* ---- tabs ---- */

  function outreachVisible() { var o = $('tabOutreach'); return !!(o && !o.hidden); }

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('on'); });
      btn.classList.add('on');
      var tab = btn.dataset.tab;
      if ($('tabReview')) $('tabReview').hidden = tab !== 'review';
      if ($('tabOutreach')) $('tabOutreach').hidden = tab !== 'outreach';
      if (tab === 'outreach') loadOutreach();
    });
  });

  /* ---- outreach: filtered stores → scheduled leads → assign ---- */

  var outLoaded = false;
  var leadsByStore = {};       // storeNumber -> [lead]
  var leadsPulled = false;
  var assignmentsAll = [];     // raw rows from server
  var lastSummary = null;

  function pacificYmd(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d || new Date()); }
  function badge(kind, text) { return '<span class="badge-status ' + esc(kind) + '">' + esc(text || kind) + '</span>'; }
  function storeChip(n, st) { return '<span class="store-chip ' + esc(st || 'open') + '">' + esc(n) + '</span>'; }
  function setPull(msg, bad) { var el = $('pullStatus'); if (!el) return; el.textContent = msg; el.style.color = bad ? '#C8102E' : ''; }
  function fmt(d) { return d ? new Date(d).toLocaleDateString() : '—'; }

  function loadOutreach() {
    if (!$('outStart')) return;
    if (!outLoaded) {
      outLoaded = true;
      var plus14 = new Date(); plus14.setDate(plus14.getDate() + 14);
      $('outStart').value = pacificYmd(new Date());
      $('outEnd').value = pacificYmd(plus14);
      api('/outreach/cycles').then(function (r) { return r.json(); }).then(function (data) {
        var c = data && (data.current || data.next);
        if (c && c.startDate && c.endDate) {
          $('outStart').value = c.startDate;
          $('outEnd').value = c.endDate;
          setPull('Dates set to the ' + (data.current ? 'current' : 'next') + ' ISE cycle: ' + c.name + '.');
        }
      }).catch(function () {});
      refreshAssignments();
    }
    renderOutreachStores();
  }

  if ($('pullLeads')) $('pullLeads').addEventListener('click', function () { pullLeads(false); });
  if ($('pullLeadsRefresh')) $('pullLeadsRefresh').addEventListener('click', function () { pullLeads(true); });

  function pullLeads(refresh) {
    var vis = visibleReports();
    if (!vis.length) { setPull('No stores in the current filter.', true); return; }
    var btn = $('pullLeads');
    btn.disabled = true;
    setPull('Pulling ISE, Blitz, and Cut-In leads for ' + vis.length + ' store' + (vis.length > 1 ? 's' : '') + '…');
    var qs = '?startDate=' + encodeURIComponent($('outStart').value) + '&endDate=' + encodeURIComponent($('outEnd').value) +
      '&stores=' + encodeURIComponent(vis.map(function (r) { return r.storeNumber; }).join(','));
    if (refresh) qs += '&refresh=1';
    api('/outreach/leads' + qs).then(function (r) { return r.json(); }).then(function (data) {
      btn.disabled = false;
      if (!data.ok) { setPull('✗ ' + (data.error || 'Pull failed'), true); return; }
      leadsByStore = data.byStore || {};
      leadsPulled = true;
      var diag = data.diagnostics || {};
      var hit = vis.filter(function (r) { return (leadsByStore[r.storeNumber] || []).length; }).length;
      var msg = hit + ' of ' + vis.length + ' filtered stores have a lead in range';
      if (diag.byProject) {
        msg += ' (' + ['ISE', 'Blitz', 'Cut-In'].map(function (k) { return (diag.byProject[k] || 0) + ' ' + k; }).join(', ');
      } else if (diag.usableVisits != null) {
        msg += ' (' + diag.usableVisits + ' visits division-wide';
      }
      if (diag.visitsWithoutLead) msg += ', ' + diag.visitsWithoutLead + ' with no lead set';
      if (diag.leadsWithoutEmail) msg += ', ' + diag.leadsWithoutEmail + ' leads with no email in SAS';
      if (diag.byProject || diag.usableVisits != null) msg += ').';
      if (diag.projectErrors && diag.projectErrors.length) msg += ' SAS miss: ' + diag.projectErrors.join('; ') + '.';
      if (!hit && diag.usableVisits === 0) msg = 'No ISE, Blitz, or Cut-In visits in that date range.';
      setPull(msg, !hit);
      renderOutreachStores();
    }).catch(function (err) { btn.disabled = false; setPull('✗ ' + err.message, true); });
  }

  function existingAssigneesFor(storeNumber) {
    return assignmentsAll.filter(function (a) { return a.store_number === storeNumber; });
  }

  var typed = {}; // storeNumber -> { email, sup } typed before a re-render

  function rememberTyped() {
    var c = $('outStores');
    if (!c) return;
    c.querySelectorAll('tbody tr[data-store]').forEach(function (tr) {
      var e = tr.querySelector('.lead-email');
      var s = tr.querySelector('.lead-sup');
      var p = tr.querySelector('.lead-pick');
      var n = tr.querySelector('.lead-name');
      if (e || s || p) typed[tr.getAttribute('data-store')] = {
        email: e ? e.value : undefined,
        sup: s ? s.value : undefined,
        pick: p ? p.value : undefined,
        name: n ? n.value : undefined
      };
    });
  }

  function districtOfReport(r) {
    return String((r && r.district) || '').replace(/\D/g, '');
  }

  function peopleInDistrict(district) {
    if (!district) return [];
    var seen = {};
    var out = [];
    function add(person) {
      var email = String(person.email || '').trim().toLowerCase();
      if (!email || seen[email]) return;
      seen[email] = true;
      out.push({
        name: person.name || person.assignee_name || '',
        email: email,
        workdayId: person.workdayId || person.workday_id || null,
        supervisorName: person.supervisorName || person.supervisor_name || '',
        supervisorEmail: person.supervisorEmail || person.supervisor_email || ''
      });
    }
    Object.keys(leadsByStore).forEach(function (sn) {
      var rep = reportByStore(sn);
      if (districtOfReport(rep) !== district) return;
      (leadsByStore[sn] || []).forEach(add);
    });
    assignmentsAll.forEach(function (a) {
      var rep = reportByStore(a.store_number);
      var d = districtOfReport(rep) || String(a.district || '').replace(/\D/g, '');
      if (d !== district) return;
      add(a);
    });
    out.sort(function (a, b) { return String(a.name || a.email).localeCompare(String(b.name || b.email)); });
    return out;
  }

  function personInDistrict(district, email) {
    var want = String(email || '').trim().toLowerCase();
    var list = peopleInDistrict(district);
    for (var i = 0; i < list.length; i++) if (list[i].email === want) return list[i];
    return null;
  }

  function renderOutreachStores() {
    var container = $('outStores');
    if (!container) return;
    rememberTyped();
    var vis = visibleReports().slice().sort(function (a, b) { return Number(a.storeNumber) - Number(b.storeNumber); });
    if ($('outFilterLine')) $('outFilterLine').textContent = vis.length + ' store' + (vis.length === 1 ? '' : 's') + ' · ' + describeFilter();
    if (!vis.length) { container.innerHTML = '<p class="none-msg">No stores match the filter. Change the filter above.</p>'; return; }

    var rows = vis.map(function (r) {
      var leads = leadsByStore[r.storeNumber] || [];
      var L = leads[0] || null;
      var existing = existingAssigneesFor(r.storeNumber);
      var t = typed[r.storeNumber] || {};
      var pick = t.pick != null ? t.pick : (L ? 'sas' : '');
      var district = districtOfReport(r);
      var districtPeople = peopleInDistrict(district).filter(function (p) { return !(L && L.email && p.email === String(L.email).toLowerCase()); });
      var sasLine = !leadsPulled
        ? ''
        : L
          ? '<strong>' + esc(L.name || '—') + '</strong>' + (leads.length > 1 ? ' <span class="sub">+' + (leads.length - 1) + ' more</span>' : '') +
            '<div class="sub">' + esc(L.date || '') + (L.project ? ' · ' + esc(L.project) : '') + (L.team ? ' · ' + esc(L.team) : '') + '</div>'
          : '<div class="sub warn">No ISE, Blitz, or Cut-In visit in range</div>';
      var opts = '<option value="">Choose a lead</option>';
      if (L) opts += '<option value="sas"' + (pick === 'sas' ? ' selected' : '') + '>SAS · ' + esc(L.name || L.email || 'lead') + '</option>';
      if (districtPeople.length) {
        opts += '<optgroup label="Same district">';
        districtPeople.forEach(function (p) {
          opts += '<option value="' + esc(p.email) + '"' + (pick === p.email ? ' selected' : '') + '>' + esc(p.name || p.email) + '</option>';
        });
        opts += '</optgroup>';
      }
      opts += '<option value="manual"' + (pick === 'manual' ? ' selected' : '') + '>Type a lead</option>';
      var nameVal = t.name != null ? t.name : '';
      var leadCell = sasLine +
        '<select class="lead-pick">' + opts + '</select>' +
        '<input class="lead-name" placeholder="Name"' + (pick === 'manual' ? '' : ' hidden') + ' value="' + esc(nameVal) + '">';
      var emailVal = t.email != null && t.email !== '' ? t.email : (pick === 'sas' && L ? L.email || '' : (pick && pick !== 'manual' && pick !== 'sas' ? pick : ''));
      var pickedPerson = pick && pick !== 'manual' && pick !== 'sas' ? personInDistrict(district, pick) : null;
      var supVal = t.sup != null && t.sup !== '' ? t.sup
        : (pick === 'sas' && L ? (L.supervisorEmail || r.supervisorEmail || '')
          : (pickedPerson && pickedPerson.supervisorEmail ? pickedPerson.supervisorEmail : (r.supervisorEmail || '')));
      var supName = (pick === 'sas' && L && L.supervisorName) ? L.supervisorName : (pickedPerson && pickedPerson.supervisorName) || r.supervisor || '';
      var emailCell = '<input type="email" class="lead-email" value="' + esc(emailVal) + '" placeholder="email">';
      var supCell = '<input type="email" class="lead-sup" value="' + esc(supVal) + '" placeholder="supervisor email">' +
        (supName ? '<div class="sub">' + esc(supName) + '</div>' : '');
      var assignedCell = existing.length
        ? existing.map(function (a) { return badge(a.status === 'done' ? 'done' : a.invite_sent_at ? 'invited' : 'assigned', (a.assignee_name || a.assignee_email) + (a.invite_sent_at ? ' · emailed' : '')); }).join(' ')
        : '<span class="sub">—</span>';
      var canAssign = pick === 'sas' || pick === 'manual' || (pick && pick.indexOf('@') !== -1);
      return '<tr data-store="' + esc(r.storeNumber) + '"' + (canAssign ? '' : ' class="no-lead"') + '>' +
        '<td><input type="checkbox" class="out-pick"' + (canAssign ? '' : ' disabled') + '></td>' +
        '<td><strong>' + esc(r.storeNumber) + '</strong>' + (r.storeName ? '<div class="sub">' + esc(r.storeName) + '</div>' : '') + '</td>' +
        '<td class="sub">' + esc(r.group || '') + '</td>' +
        '<td>' + badge(r.status || 'open', STATUS_LABEL[r.status] || 'Not started') + '</td>' +
        '<td>' + leadCell + '</td>' +
        '<td>' + emailCell + '</td>' +
        '<td>' + supCell + '</td>' +
        '<td>' + assignedCell + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div class="out-section">' +
      '<div class="out-section-head"><span>Stores in filter · ' + vis.length + '</span>' +
        '<label class="head-check"><input type="checkbox" id="outAll">All with a lead</label></div>' +
      '<div class="tbl-wrap"><table class="out-table"><thead><tr><th></th><th>Store</th><th>District · Supervisor</th><th>Survey</th><th>Lead</th><th>Lead email</th><th>Lead\'s supervisor</th><th>Assigned</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="out-actions">' +
        '<button type="button" class="primary" id="assignSel">Assign selected stores to their lead</button>' +
        '<button type="button" id="assignAllLeads">Assign every store with a lead</button>' +
      '</div></div>';

    var all = $('outAll');
    if (all) all.addEventListener('change', function () {
      container.querySelectorAll('.out-pick:not(:disabled)').forEach(function (cb) { cb.checked = all.checked; });
    });
    if ($('assignSel')) $('assignSel').addEventListener('click', function () { assignStores(true); });
    if ($('assignAllLeads')) $('assignAllLeads').addEventListener('click', function () { assignStores(false); });
    container.querySelectorAll('.lead-pick').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var tr = sel.closest('tr');
        var pick = sel.value;
        var nameEl = tr.querySelector('.lead-name');
        var emailEl = tr.querySelector('.lead-email');
        var supEl = tr.querySelector('.lead-sup');
        var cb = tr.querySelector('.out-pick');
        var sn = tr.getAttribute('data-store');
        var rep = reportByStore(sn) || {};
        var L0 = (leadsByStore[sn] || [])[0] || null;
        if (nameEl) nameEl.hidden = pick !== 'manual';
        if (pick === 'sas' && L0) {
          if (emailEl) emailEl.value = L0.email || '';
          if (supEl) supEl.value = L0.supervisorEmail || rep.supervisorEmail || '';
        } else if (pick && pick !== 'manual') {
          var person = personInDistrict(districtOfReport(rep), pick);
          if (emailEl) emailEl.value = pick;
          if (supEl) supEl.value = (person && person.supervisorEmail) || rep.supervisorEmail || '';
        } else if (pick === 'manual') {
          if (emailEl) emailEl.value = '';
          if (nameEl) nameEl.focus();
        }
        if (cb) {
          cb.disabled = !pick;
          cb.checked = !!pick;
        }
        tr.classList.toggle('no-lead', !pick);
      });
    });
  }

  function assignStores(selectedOnly) {
    var container = $('outStores');
    var items = [];
    var missing = [];
    container.querySelectorAll('tbody tr').forEach(function (tr) {
      var cb = tr.querySelector('.out-pick');
      if (!cb || cb.disabled) return;
      if (selectedOnly && !cb.checked) return;
      var sn = tr.getAttribute('data-store');
      var rep = reportByStore(sn) || {};
      var pick = (tr.querySelector('.lead-pick') || {}).value || '';
      var email = ((tr.querySelector('.lead-email') || {}).value || '').trim();
      var sup = ((tr.querySelector('.lead-sup') || {}).value || '').trim();
      var typedName = ((tr.querySelector('.lead-name') || {}).value || '').trim();
      var L = (leadsByStore[sn] || [])[0] || null;
      var person = (pick && pick !== 'sas' && pick !== 'manual') ? personInDistrict(districtOfReport(rep), pick) : null;
      var name = pick === 'manual' ? (typedName || null) : pick === 'sas' ? (L && L.name) || null : (person && person.name) || null;
      var workdayId = pick === 'sas' ? (L && L.workdayId) || null : (person && person.workdayId) || null;
      var supervisorName = pick === 'sas' ? (L && L.supervisorName) || rep.supervisor || null : (person && person.supervisorName) || rep.supervisor || null;
      if (!email) { missing.push(sn + (name ? ' (' + name + ')' : '')); return; }
      items.push({
        storeNumber: sn, email: email, name: name, isLead: true, workdayId: workdayId,
        supervisorEmail: sup || null, supervisorName: supervisorName,
        notes: pick === 'manual' ? 'manual' : (pick && pick !== 'sas' ? 'district' : null)
      });
    });
    if (!items.length) {
      setPull(missing.length ? 'Fill in an email for: ' + missing.join(', ') : 'Check at least one store.', true);
      return;
    }
    setPull('Assigning ' + items.length + ' store' + (items.length > 1 ? 's' : '') + '…');
    api('/outreach/assignments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assignments: items }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { setPull('✗ ' + (data.error || 'Failed'), true); return; }
        var msg = '✓ ' + data.created + ' store' + (data.created !== 1 ? 's' : '') + ' assigned.';
        if (missing.length) msg += ' Skipped, no email: ' + missing.join(', ') + '.';
        setPull(msg);
        refreshAssignments();
      }).catch(function (err) { setPull('✗ ' + err.message, true); });
  }

  /* assignments list, filtered by the same chips via store → group */

  function refreshAssignments() {
    if (!$('asgResults')) return;
    api('/outreach/assignments').then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) { statusEl.textContent = data.error || 'Could not load assignments'; return; }
      assignmentsAll = data.assignments || [];
      renderAssignments();
      renderOutreachStores();
    }).catch(function () {});
  }

  if ($('loadAssignments')) $('loadAssignments').addEventListener('click', refreshAssignments);

  function reportByStore(sn) {
    for (var i = 0; i < allReports.length; i++) if (allReports[i].storeNumber === sn) return allReports[i];
    return null;
  }

  function filteredAssignments() {
    var g = activeGroupKeys();
    var s = activeStatuses();
    var st = $('asgStatus') ? $('asgStatus').value : '';
    return assignmentsAll.filter(function (a) {
      var r = reportByStore(a.store_number) || {};
      if (g.length && g.indexOf(r.groupKey || '') === -1) return false;
      if (s.length && s.indexOf(r.status || 'open') === -1) return false;
      if (st && a.status !== st) return false;
      return true;
    });
  }

  if ($('asgStatus')) $('asgStatus').addEventListener('change', renderAssignments);

  function renderAssignments() {
    var container = $('asgResults');
    var bar = $('summaryBar');
    if (!container) return;
    var list = filteredAssignments();
    if (!list.length) {
      container.innerHTML = '<p class="none-msg">' + (assignmentsAll.length ? 'No assignments match the filter.' : 'No assignments yet.') + '</p>';
      if (bar) bar.hidden = !assignmentsAll.length;
      return;
    }
    if (bar) bar.hidden = false;

    var byGroup = {};
    list.forEach(function (a) {
      var r = reportByStore(a.store_number) || {};
      var gk = r.groupKey || '?';
      if (!byGroup[gk]) byGroup[gk] = { label: r.group || 'Unassigned', district: r.district, people: {} };
      var P = byGroup[gk].people[a.assignee_email];
      if (!P) P = byGroup[gk].people[a.assignee_email] = { name: a.assignee_name, email: a.assignee_email, isLead: !!a.is_lead, supervisor: a.supervisor_email, ids: [], stores: [], status: a.status, invited: a.invite_sent_at, reminded: a.last_reminded_at };
      P.ids.push(a.id);
      P.stores.push({ n: a.store_number, s: a.survey_status });
      if (a.status === 'done') P.status = 'done';
      if (a.invite_sent_at && (!P.invited || a.invite_sent_at < P.invited)) P.invited = a.invite_sent_at;
      if (a.last_reminded_at && (!P.reminded || a.last_reminded_at > P.reminded)) P.reminded = a.last_reminded_at;
    });

    var keys = Object.keys(byGroup).sort(function (a, b) {
      return (Number(byGroup[a].district) || 999) - (Number(byGroup[b].district) || 999) || byGroup[a].label.localeCompare(byGroup[b].label);
    });
    container.innerHTML = keys.map(function (gk) {
      var G = byGroup[gk];
      var people = Object.keys(G.people).map(function (k) { return G.people[k]; }).sort(function (a, b) { return (b.isLead - a.isLead) || String(a.name || '').localeCompare(String(b.name || '')); });
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
          '<td class="sub">' + fmt(P.invited) + '</td>' +
          '<td class="sub">' + (P.reminded && P.invited && P.reminded !== P.invited ? fmt(P.reminded) : '—') + '</td>' +
          '</tr>';
      }).join('');
      return '<div class="out-section"><div class="out-section-head"><span>' + esc(G.label) + ' · ' + people.length + ' lead' + (people.length !== 1 ? 's' : '') + '</span>' +
        '<label class="head-check"><input type="checkbox" class="asg-all">All</label></div>' +
        '<div class="tbl-wrap"><table class="out-table"><thead><tr><th></th><th>Lead</th><th>CC supervisor</th><th>Stores</th><th>Status</th><th>Emailed</th><th>Reminded</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="out-actions"><button type="button" class="primary act-invite">Send invite</button><button type="button" class="act-remind">Send reminder</button><button type="button" class="act-done">Mark done</button><button type="button" class="act-remove danger">Remove</button></div></div>';
    }).join('');

    container.querySelectorAll('.asg-all').forEach(function (cb) {
      cb.addEventListener('change', function () { cb.closest('.out-section').querySelectorAll('.asg-pick').forEach(function (r) { r.checked = cb.checked; }); });
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
      if (cb && cb.checked) String(tr.getAttribute('data-ids') || '').split(',').forEach(function (v) { if (v) ids.push(Number(v)); });
    });
    return ids;
  }

  function bulkAction(btn, action) {
    var section = btn.closest('.out-section');
    var ids = checkedIds(section);
    if (!ids.length) { statusEl.textContent = 'Check at least one lead.'; return; }
    var people = section.querySelectorAll('.asg-pick:checked').length;
    if (action === 'remove' && !window.confirm('Remove ' + people + ' lead' + (people > 1 ? 's' : '') + ' from the assignment list?')) return;
    if ((action === 'invite' || action === 'remind') && !window.confirm((action === 'invite' ? 'Email ' : 'Send a reminder to ') + people + ' lead' + (people > 1 ? 's' : '') + ' now, supervisor copied?')) return;
    statusEl.textContent = { invite: 'Sending invites…', remind: 'Sending reminders…', done: 'Marking done…', remove: 'Removing…' }[action];
    var path = action === 'invite' ? '/outreach/assignments/invite' : action === 'remind' ? '/outreach/assignments/remind' : action === 'remove' ? '/outreach/assignments/delete' : '/outreach/assignments/status';
    var body = action === 'done' ? { ids: ids, status: 'done' } : { ids: ids };
    api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
        if (data.results) {
          var ok = data.results.filter(function (r) { return r.ok; });
          var fail = data.results.filter(function (r) { return !r.ok; });
          statusEl.textContent = '✓ ' + ok.length + ' email' + (ok.length !== 1 ? 's' : '') + ' sent' + (fail.length ? '. Failed: ' + fail.map(function (f) { return f.email + ' (' + f.error + ')'; }).join('; ') : '.');
        } else if (data.removed != null) statusEl.textContent = '✓ Removed ' + data.removed + '.';
        else statusEl.textContent = '✓ Updated.';
        refreshAssignments();
      }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  }

  /* summary to management, scoped to the active group chips */

  if ($('summaryPreview')) $('summaryPreview').addEventListener('click', function () {
    var box = $('summaryBox');
    var g = activeGroupKeys();
    statusEl.textContent = 'Building summary…';
    api('/outreach/summary' + (g.length ? '?groups=' + encodeURIComponent(g.join(',')) : '')).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
      lastSummary = data;
      box.hidden = false;
      box.innerHTML = '<div class="summary-head">To: ' + esc(data.to) + ' · ' + esc(g.length ? g.map(function (k) { return (groupByKey[k] || {}).label || k; }).join(', ') : 'all districts') + '</div>' + data.html;
      statusEl.textContent = '';
    }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  });

  if ($('summarySend')) $('summarySend').addEventListener('click', function () {
    var g = activeGroupKeys();
    var label = g.length ? g.map(function (k) { return (groupByKey[k] || {}).label || k; }).join(', ') : null;
    var to = (lastSummary && lastSummary.to) || 'amanda.mathews@retailodyssey.com';
    if (!window.confirm('Email the assignment summary to ' + to + ' for ' + (label || 'all districts') + '?')) return;
    statusEl.textContent = 'Sending summary…';
    api('/outreach/summary/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: g, groupLabel: label }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { statusEl.textContent = '✗ ' + (data.error || 'Failed'); return; }
        statusEl.textContent = '✓ Summary sent to ' + data.to + (data.cc && data.cc.length ? ' (cc ' + data.cc.join(', ') + ')' : '') + '.';
      }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
  });

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
        if (!hits.length) allReports.push({ id: 'store-' + row.number, storeNumber: row.number, comment: row.comment, sets: [], photos: [], commentOnly: true });
        else hits.forEach(function (r) { r.comment = row.comment; });
      });
      allReports.sort(function (a, b) { return Number(a.storeNumber) - Number(b.storeNumber); });
    }
    if (!allReports.length) { if (detailEl) detailEl.innerHTML = '<p>No stores on file.</p>'; return; }

    // Groups: from the API when signed in, else derived from the board.
    var seen = {};
    allReports.forEach(function (r) {
      if (r.groupKey && !seen[r.groupKey]) seen[r.groupKey] = { key: r.groupKey, label: r.group, district: r.district, supervisor: r.supervisor, supervisorEmail: r.supervisorEmail };
    });
    groups = Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) {
      return (Number(a.district) || 999) - (Number(b.district) || 999) || String(a.supervisor || '').localeCompare(String(b.supervisor || ''));
    });
    groups.forEach(function (g) { groupByKey[g.key] = g; });

    if (toolbarEl) toolbarEl.hidden = false;
    applyFilters();
    show(allReports[0]);
  }

  var ready = window.dumpBinAuthReady || Promise.resolve();
  ready.then(boot).catch(function () {});
})();
