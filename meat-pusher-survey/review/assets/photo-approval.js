(function () {
  'use strict';
  if (window.MEAT_PUSHER_TOKEN) return;
  var SLUG = 'meat-pushers-2026';
  var tabBtn = document.querySelector('.tab[data-tab="photos"]');
  var pane = document.getElementById('tabPhotos');
  if (!tabBtn || !pane) return;

  var listEl = document.getElementById('paStores');
  var viewEl = document.getElementById('paView');
  var statusEl = document.getElementById('paStatus');
  var loaded = false;
  var current = null;
  var data = null;
  var blobCache = {};
  var imgQueue = [];
  var imgBusy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pa(path, opts) {
    var f = window.dumpBinAuthFetch || fetch;
    return f('/api/projects/' + SLUG + '/photo-approval' + path, opts || {});
  }
  function post(path, body) {
    return pa(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function say(msg) { statusEl.textContent = msg || ''; }

  function pump() {
    if (imgBusy || !imgQueue.length) return;
    imgBusy = true;
    var job = imgQueue.shift();
    var done = function () { imgBusy = false; pump(); };
    if (blobCache[job.url]) { job.el.src = blobCache[job.url]; return done(); }
    pa(job.url).then(function (r) {
      if (!r.ok) throw new Error('x');
      return r.blob();
    }).then(function (b) {
      blobCache[job.url] = URL.createObjectURL(b);
      job.el.src = blobCache[job.url];
    }).catch(function () {
      if (job.fallback) job.fallback(job.el);
    }).then(done);
  }
  function loadImg(el, url, fallback) {
    imgQueue.push({ el: el, url: url, fallback: fallback });
    pump();
  }

  function unavailable(el) {
    var s = document.createElement('span');
    s.className = 'pa-unavail';
    s.textContent = 'PROD photo unavailable right now';
    var label = el.closest ? el.closest('.pa-prod') : null;
    if (label) label.classList.add('pa-prod-off');
    if (el.parentNode) el.parentNode.replaceChild(s, el);
  }

  function pill(state, flagged) {
    var t = state + (flagged && state === 'pending' ? ' · duplicate' : '');
    return '<span class="pa-pill pa-' + esc(state) + (flagged ? ' pa-flag' : '') + '">' + esc(t) + '</span>';
  }

  async function loadStores() {
    say('');
    var r = await pa('/stores');
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) { listEl.innerHTML = ''; say(d.error || 'Not available'); return; }
    loaded = true;
    listEl.innerHTML = d.stores.map(function (s) {
      return '<button type="button" class="pa-store' + (current === s.store_number ? ' on' : '') + '" data-store="' + esc(s.store_number) + '">'
        + '<b>FM' + esc(s.store_number) + '</b>'
        + '<span>' + s.total + ' photos</span>'
        + '<span>' + s.pending + ' pending' + (s.flagged ? ' · ' + s.flagged + ' dup' : '') + '</span>'
        + '<span>' + s.accepted + ' accepted · ' + s.pushed + ' pushed' + (s.in_flight ? ' · ' + s.in_flight + ' active' : '') + (s.held ? ' · ' + s.held + ' held' : '') + '</span>'
        + '</button>';
    }).join('') || '<div class="pa-empty">No stores</div>';
    listEl.querySelectorAll('.pa-store').forEach(function (b) {
      b.addEventListener('click', function () { openStore(b.dataset.store); });
    });
  }

  function targetLabel(p) {
    if (p.target) return 'Cut In ' + p.target.date.slice(5).replace('-', '/') + ' · ' + esc(p.target.setName || ('C' + p.category));
    return 'no target';
  }

  function setOptions(p) {
    var opts = (data.sets || []).map(function (s) {
      return '<option value="' + esc(s.visitId + '|' + s.resetId) + '">' + esc(s.date.slice(5).replace('-', '/') + ' · C' + s.number + ' ' + (s.name || '')) + '</option>';
    }).join('');
    return '<select class="pa-pick" data-photo="' + p.photoId + '"><option value="">Pick a set</option>' + opts + '</select>';
  }

  function renderStore() {
    var photos = data.photos;
    var html = '<div class="pa-bar">'
      + '<b>FM' + esc(data.store) + '</b>'
      + '<button type="button" class="btn-pull" id="paApproveAll">Approve all unflagged</button>'
      + '<button type="button" class="btn-pull" id="paZip">Download zip</button>'
      + '<button type="button" class="btn-pull" id="paPush">Push accepted</button>'
      + '<button type="button" class="btn-pull" id="paAudit">Audit</button>'
      + '</div><div id="paAuditBox" hidden></div>';
    html += photos.map(function (p) {
      var busy = p.state === 'pushing';
      var deleted = p.state === 'deleted';
      var prod = (p.prodImages || []).map(function (i) {
        return '<label class="pa-prod"><input type="radio" name="ow' + p.photoId + '" value="' + esc(i.id) + '"' + (p.overwriteImageId === i.id ? ' checked' : '') + '>'
          + '<img alt="PROD" data-prod="' + esc(p.target.visitId + '/' + p.target.resetId + '/' + i.id) + '"></label>';
      }).join('');
      return '<div class="pa-card' + (p.flagged ? ' pa-flagged' : '') + (deleted ? ' pa-deleted' : '') + '" data-photo="' + p.photoId + '">'
        + '<div class="pa-head">' + pill(p.state, p.flagged) + '<span>C' + esc(p.category) + ' ' + esc(p.setName) + ' · ' + esc(p.slot) + '</span><span>' + esc(p.workDate || '') + '</span></div>'
        + '<div class="pa-pair">'
        + '<div><div class="pa-cap">Ours · ' + esc((p.photographer || '').split('@')[0]) + '</div><img class="pa-ours" alt="" data-ours="' + p.photoId + '"></div>'
        + '<div><div class="pa-cap">PROD · ' + (p.target ? p.prodCount : 0) + '</div><div class="pa-prodrow">' + (prod || '<span class="pa-none">none</span>') + '</div></div>'
        + '</div>'
        + '<div class="pa-target">' + targetLabel(p) + (p.noTargetReason && !p.target ? ' · ' + esc(p.noTargetReason) : '') + (p.dupOf ? ' · same as #' + p.dupOf : '') + '</div>'
        + (p.target ? '' : (deleted ? '' : setOptions(p)))
        + (p.lastError ? '<div class="pa-err">' + esc(p.lastError) + '</div>' : '')
        + '<div class="pa-acts">'
        + (deleted
          ? '<button type="button" data-act="restore">Restore</button>'
          : '<button type="button" data-act="approve"' + (busy ? ' disabled' : '') + '>Approve</button>'
            + '<button type="button" data-act="overwrite"' + (busy || !p.prodCount ? ' disabled' : '') + '>Overwrite</button>'
            + '<button type="button" data-act="hold"' + (busy ? ' disabled' : '') + '>Hold</button>'
            + '<button type="button" data-act="delete"' + (busy ? ' disabled' : '') + '>Delete</button>')
        + '<button type="button" data-act="download">Download</button>'
        + '</div></div>';
    }).join('') || '<div class="pa-empty">No photos</div>';
    viewEl.innerHTML = html;

    viewEl.querySelectorAll('img[data-ours]').forEach(function (el) { loadImg(el, '/photos/' + el.dataset.ours + '/image'); });
    viewEl.querySelectorAll('img[data-prod]').forEach(function (el) {
      loadImg(el, '/stores/' + encodeURIComponent(data.store) + '/prod-image/' + el.dataset.prod, unavailable);
    });
    viewEl.querySelectorAll('.pa-acts button').forEach(function (b) {
      b.addEventListener('click', function () { act(b); });
    });
    $('paApproveAll').addEventListener('click', approveAll);
    $('paZip').addEventListener('click', zip);
    $('paPush').addEventListener('click', push);
    $('paAudit').addEventListener('click', audit);
  }
  function $(id) { return document.getElementById(id); }

  async function openStore(store) {
    current = store;
    listEl.querySelectorAll('.pa-store').forEach(function (b) { b.classList.toggle('on', b.dataset.store === store); });
    viewEl.innerHTML = '<div class="pa-empty">Loading</div>';
    imgQueue = [];
    var r = await pa('/stores/' + encodeURIComponent(store));
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) { viewEl.innerHTML = ''; say(d.error || 'Could not load'); return; }
    data = d;
    renderStore();
  }

  async function refresh() { await openStore(current); await loadStores(); }

  async function act(btn) {
    var card = btn.closest('.pa-card');
    var id = card.dataset.photo;
    var kind = btn.dataset.act;
    if (kind === 'download') {
      var r0 = await pa('/photos/' + id + '/image?download=1');
      if (!r0.ok) return say('Download failed');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(await r0.blob());
      a.download = 'FM' + data.store + '_' + id + '.jpg';
      a.click();
      return;
    }
    var body = {};
    var path = '/photos/' + id + '/' + (kind === 'overwrite' ? 'approve' : kind);
    if (kind === 'overwrite') {
      var pick = card.querySelector('input[type=radio]:checked');
      if (!pick) return say('Choose a PROD photo to replace');
      body = { action: 'overwrite', overwriteImageId: pick.value };
    }
    if (kind === 'approve') {
      var sel = card.querySelector('.pa-pick');
      if (sel && sel.value) { var parts = sel.value.split('|'); body = { pick: { visitId: parts[0], resetId: parts[1] } }; }
    }
    var r = await post(path, body);
    var d = await r.json().catch(function () { return {}; });
    say(r.ok ? '' : (d.code === 'no_target' ? 'No target. Pick a set or hold.' : (d.error || 'Failed')));
    await refresh();
  }

  async function approveAll() {
    var r = await post('/stores/' + encodeURIComponent(current) + '/approve-all');
    var d = await r.json().catch(function () { return {}; });
    say(r.ok ? d.accepted + ' accepted · ' + d.skippedFlagged + ' duplicate skipped · ' + d.skippedNoTarget + ' no target' : (d.error || 'Failed'));
    await refresh();
  }
  async function zip() {
    var r = await pa('/stores/' + encodeURIComponent(current) + '/download.zip');
    if (!r.ok) return say('Download failed');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = SLUG + '_FM' + current + '.zip';
    a.click();
  }
  async function push() {
    var r = await post('/stores/' + encodeURIComponent(current) + '/push');
    var d = await r.json().catch(function () { return {}; });
    say(r.ok ? (d.started ? 'Pushing' : 'Already pushing') : (d.error || 'Failed'));
    setTimeout(refresh, 8000);
  }
  async function audit() {
    var box = $('paAuditBox');
    if (!box.hidden) { box.hidden = true; return; }
    var r = await pa('/audit?store=' + encodeURIComponent(current));
    var d = await r.json().catch(function () { return {}; });
    box.innerHTML = (d.events || []).map(function (e) {
      return '<div class="pa-ev">' + esc(String(e.created_at).replace('T', ' ').slice(0, 16)) + ' · #' + e.photo_id + ' · ' + esc((e.actor || '').split('@')[0]) + ' · ' + esc(e.action) + (e.to_state ? ' → ' + esc(e.to_state) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</div>';
    }).join('') || '<div class="pa-empty">No events</div>';
    box.hidden = false;
  }

  document.addEventListener('mp-tab', function (ev) {
    if (ev.detail === 'photos' && !loaded) loadStores();
  });

  // The tab only appears for an approver.
  pa('/stores').then(function (r) {
    if (r.ok) tabBtn.hidden = false;
  }).catch(function () {});
})();
