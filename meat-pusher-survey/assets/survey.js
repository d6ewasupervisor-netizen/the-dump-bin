(function () {
  'use strict';

  var OPEN = !!window.MEAT_PUSHER_OPEN;
  var SETS = [
    { id: '556', label: '556 Ham Bar' },
    { id: '559', label: '559 Heat & Serve' },
    { id: '570', label: '570 Dinner Sausage' },
    { id: '575', label: '575 Hot Dogs' },
    { id: '578', label: '578 Bacon / Breakfast' }
  ];
  var LABEL = {};
  SETS.forEach(function (set) { LABEL[set.id] = set.label; });
  var LINES = [
    ['rear_bracket', 'Flat shelves, rear bracket'],
    ['no_bracket', 'Flat shelves, no rear bracket'],
    ['grid', 'Grid pushers'],
    ['slanted', 'Slanted meat shelves'],
    ['bunker', 'In a bunker'],
    ['absent', 'Not in this store']
  ];

  var form = document.getElementById('form');
  var setsRoot = document.getElementById('sets');
  var statusEl = document.getElementById('status');
  var sendBtn = document.getElementById('send');
  var byStore = {};
  var token = '';
  document.getElementById('setCount').textContent = SETS.length + ' sets';

  function todayPacific() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  }
  form.reportedOn.value = todayPacific();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  SETS.forEach(function (set) {
    var choices = LINES.map(function (line) {
      return '<label><input type="radio" name="fixture-' + set.id + '" value="' + line[0] + '"> ' + line[1] + '</label>';
    }).join('');
    var section = document.createElement('section');
    section.className = 'block';
    section.dataset.commodity = set.id;
    section.innerHTML =
      '<div class="set-head">' + esc(set.label) + '</div>' +
      '<div class="choices">' + choices + '</div>' +
      '<div class="measures" hidden>' +
        '<label>Shelves <input name="count-' + set.id + '" inputmode="numeric"></label>' +
        '<label>Width <input name="width-' + set.id + '"></label>' +
        '<label>Depth <input name="depth-' + set.id + '"></label>' +
      '</div>' +
      '<div class="photos">' +
        '<label class="file">Whole set <input name="set-' + set.id + '" type="file" accept="image/*" capture="environment"></label>' +
        '<label class="file">Shelf back or fixture <input name="back-' + set.id + '" type="file" accept="image/*" capture="environment"></label>' +
      '</div>' +
      '<label class="set-notes">Notes <input name="notes-' + set.id + '"></label>';
    setsRoot.appendChild(section);
    section.addEventListener('change', function (ev) {
      if (!ev.target || ev.target.name !== 'fixture-' + set.id) return;
      section.querySelector('.measures').hidden = ev.target.value !== 'no_bracket';
      section.querySelector('.photos').hidden = ev.target.value === 'absent';
    });
  });

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (OPEN && token) headers.authorization = 'Bearer ' + token;
    var url = OPEN ? '/api/meat-pusher-survey/open' + path : '/api/meat-pusher-survey' + path;
    var f = OPEN ? fetch : (window.dumpBinAuthFetch || fetch);
    return f(url, Object.assign({}, opts, { headers: headers }));
  }

  function paintStores(stores) {
    var select = form.store;
    var current = select.value;
    select.innerHTML = '<option value=""></option>';
    (stores || []).forEach(function (store) {
      var opt = document.createElement('option');
      opt.value = String(store.number);
      opt.textContent = String(store.number);
      opt.classList.toggle('done', store.status === 'done');
      opt.classList.toggle('revisit', store.status === 'revisit');
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  function clearFiles() {
    form.querySelectorAll('input[type="file"]').forEach(function (input) { input.value = ''; });
  }

  function unlockAll() {
    form.querySelectorAll('[data-commodity]').forEach(function (section) {
      section.classList.remove('locked');
      delete section.dataset.locked;
      delete section.dataset.fixture;
      section.querySelectorAll('.locked-answer, .locked-note, .add-detail').forEach(function (el) { el.remove(); });
      section.querySelector('.choices').hidden = false;
      section.querySelector('.photos').hidden = false;
      section.querySelector('.measures').hidden = true;
      section.querySelector('.set-notes').hidden = false;
      section.querySelectorAll('input[type="radio"]').forEach(function (el) { el.checked = false; });
      var id = section.dataset.commodity;
      form['count-' + id].value = '';
      form['width-' + id].value = '';
      form['depth-' + id].value = '';
      form['notes-' + id].value = '';
    });
  }

  function lockSection(section, set) {
    var id = section.dataset.commodity;
    section.classList.add('locked');
    section.dataset.locked = '1';
    section.dataset.fixture = set.fixture || '';
    section.querySelector('.choices').hidden = true;
    section.querySelector('.measures').hidden = true;
    section.querySelector('.set-notes').hidden = true;
    section.querySelector('.photos').hidden = false;
    var answer = document.createElement('p');
    answer.className = 'locked-answer';
    answer.textContent = set.answer || '';
    section.querySelector('.set-head').insertAdjacentElement('afterend', answer);
    if (set.notes) {
      var note = document.createElement('p');
      note.className = 'locked-note';
      note.textContent = set.notes;
      answer.insertAdjacentElement('afterend', note);
    }
    var add = document.createElement('label');
    add.className = 'add-detail';
    add.innerHTML = 'Add a detail <input name="addnote-' + id + '">';
    section.appendChild(add);
  }

  function showNote(store) {
    var note = document.getElementById('storeNote');
    if (!store || !store.status || store.status === 'open') {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    note.hidden = false;
    if (store.status === 'done') {
      note.className = 'note';
      note.textContent = 'Store ' + store.number + ' is already done. You can add details. Previous answers stay.';
      return;
    }
    var names = (store.missing || []).map(function (id) { return LABEL[id] || id; });
    note.className = 'note revisit';
    note.textContent = 'Store ' + store.number + ' is partly answered and needs to be revisited. Still open: ' + names.join(', ') + '.';
  }

  function showComment(text) {
    var held = document.getElementById('heldComment');
    held.hidden = !text;
    held.textContent = text || '';
    document.getElementById('commentLabelText').textContent = text ? 'Add a detail' : 'Comment';
    form.comment.value = '';
  }

  async function openStore(number) {
    if (!number) {
      unlockAll();
      showNote(null);
      showComment('');
      return;
    }
    var store = byStore[number];
    if (OPEN) {
      var res = await api('/stores/' + encodeURIComponent(number));
      if (res.status === 401) { showLogin(); throw new Error('Sign in again.'); }
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not open the store');
      store = data.store;
      if (byStore[number]) {
        store.status = store.status || byStore[number].status;
        store.missing = store.missing || byStore[number].missing;
      }
    }
    unlockAll();
    clearFiles();
    showNote(store || { number: number, status: 'open', missing: [] });
    showComment(store && store.comment);
    ((store && store.sets) || []).forEach(function (set) {
      var section = form.querySelector('[data-commodity="' + set.commodity + '"]');
      if (section) lockSection(section, set);
    });
  }

  form.store.addEventListener('change', function () {
    statusEl.textContent = '';
    openStore(form.store.value).catch(function (err) {
      statusEl.textContent = err.message || 'Could not open the store';
    });
  });

  function fileToJpeg(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('Photo could not be prepared'));
          var reader = new FileReader();
          reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
          reader.onerror = function () { reject(new Error('Photo could not be prepared')); };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Photo could not be prepared'));
      };
      img.src = url;
    });
  }

  async function photoField(input, slot) {
    if (!input || !input.files || !input.files[0]) return null;
    return { slot: slot, mime: 'image/jpeg', data: await fileToJpeg(input.files[0]) };
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    statusEl.textContent = 'Sending.';
    sendBtn.disabled = true;
    try {
      var sets = [];
      for (var i = 0; i < SETS.length; i++) {
        var id = SETS[i].id;
        var section = form.querySelector('[data-commodity="' + id + '"]');
        var photos = [];
        var setPhoto = await photoField(form['set-' + id], 'set');
        var backPhoto = await photoField(form['back-' + id], 'shelf_back');
        if (setPhoto) photos.push(setPhoto);
        if (backPhoto) photos.push(backPhoto);
        if (section.dataset.locked === '1') {
          var extra = (form['addnote-' + id] && form['addnote-' + id].value) || '';
          if (!extra && !photos.length) continue;
          sets.push({
            commodity: id,
            fixture: section.dataset.fixture || 'rear_bracket',
            notes: extra,
            photos: photos
          });
          continue;
        }
        var picked = form.querySelector('input[name="fixture-' + id + '"]:checked');
        if (!picked) continue;
        if (picked.value === 'no_bracket') {
          if (!form['count-' + id].value || !form['width-' + id].value || !form['depth-' + id].value) {
            throw new Error(LABEL[id] + ' needs a count, width, and depth.');
          }
        }
        sets.push({
          commodity: id,
          fixture: picked.value,
          shelfCount: form['count-' + id].value,
          width: form['width-' + id].value,
          depth: form['depth-' + id].value,
          notes: form['notes-' + id].value,
          photos: picked.value === 'absent' ? [] : photos
        });
      }
      var palletPhotos = [];
      var pallet = await photoField(form.pallet, 'pallet');
      if (pallet) palletPhotos.push(pallet);
      if (!sets.length && !palletPhotos.length && !form.comment.value.trim()) {
        throw new Error('Add an answer or a detail.');
      }
      var path = OPEN ? '/report' : '';
      var res = await api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          store: form.store.value,
          reportedOn: form.reportedOn.value,
          comment: form.comment.value,
          sets: sets,
          palletPhotos: palletPhotos,
          install: {
            status: form.installStatus.value,
            time: form.installTime.value,
            issues: form.issues.value,
            adjustments: form.adjustments.value,
            recommendations: form.recommendations.value
          }
        })
      });
      if (res.status === 401 && OPEN) { showLogin(); throw new Error('Sign in again.'); }
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not save the report');
      statusEl.textContent = 'Saved. Store ' + (data.report && data.report.storeNumber ? data.report.storeNumber : form.store.value) + '.';
      form.store.value = '';
      form.comment.value = '';
      form.reportedOn.value = todayPacific();
      unlockAll();
      showNote(null);
      showComment('');
      clearFiles();
      await loadCatalog();
    } catch (err) {
      statusEl.textContent = err.message || 'Could not save the report';
    } finally {
      sendBtn.disabled = false;
    }
  });

  function takeCatalog(rows, completed) {
    byStore = {};
    var prior = {};
    (completed || []).forEach(function (row) { prior[String(row.number)] = row; });
    (rows || []).forEach(function (row) {
      var have = prior[String(row.number)] || {};
      byStore[String(row.number)] = {
        number: String(row.number),
        status: row.status,
        missing: row.missing || [],
        comment: have.comment || '',
        sets: (have.sets || []).map(function (set) {
          return {
            commodity: String(set.commodity),
            fixture: set.fixture,
            shelfCount: set.shelfCount,
            width: set.width || '',
            depth: set.depth || '',
            notes: set.notes || '',
            answer: set.answer || '',
            locked: true
          };
        })
      };
    });
    paintStores(rows);
  }

  async function loadCatalog() {
    var res = await api(OPEN ? '/stores' : '/', { noBounceOn401: true });
    if (OPEN && res.status === 401) { showLogin(); return; }
    if (!res.ok) return;
    var data = await res.json();
    takeCatalog(data.stores || data.catalog || [], OPEN ? [] : data.completed);
    var review = document.getElementById('reviewLink');
    if (review && data.seeAll) review.hidden = false;
  }

  function showLogin() {
    token = '';
    try { sessionStorage.removeItem('meatPusherField'); } catch (_) {}
    var login = document.getElementById('login');
    if (login) login.hidden = false;
    form.hidden = true;
  }

  function showForm() {
    var login = document.getElementById('login');
    if (login) login.hidden = true;
    form.hidden = false;
  }

  if (OPEN) {
    var sendCode = document.getElementById('sendCode');
    var checkCode = document.getElementById('checkCode');
    var loginStatus = document.getElementById('loginStatus');
    sendCode.addEventListener('click', async function () {
      loginStatus.textContent = 'Sending the code.';
      sendCode.disabled = true;
      try {
        var res = await fetch('/api/meat-pusher-survey/open/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identity: document.getElementById('identity').value,
            website: document.getElementById('website').value
          })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not send the code');
        document.getElementById('codeLabel').hidden = false;
        checkCode.hidden = false;
        loginStatus.textContent = 'Enter the code.';
        try { sessionStorage.setItem('meatPusherIdentity', document.getElementById('identity').value.trim()); } catch (_) {}
      } catch (err) {
        loginStatus.textContent = err.message || 'Could not send the code';
      } finally {
        sendCode.disabled = false;
      }
    });
    checkCode.addEventListener('click', async function () {
      loginStatus.textContent = 'Checking the code.';
      checkCode.disabled = true;
      try {
        var identity = document.getElementById('identity').value.trim();
        var res = await fetch('/api/meat-pusher-survey/open/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ identity: identity, code: document.getElementById('code').value })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || data.ok === false || !data.token) throw new Error(data.error || 'That code is not valid.');
        token = data.token;
        try { sessionStorage.setItem('meatPusherField', token); } catch (_) {}
        showForm();
        await loadCatalog();
        loginStatus.textContent = '';
      } catch (err) {
        loginStatus.textContent = err.message || 'That code is not valid.';
      } finally {
        checkCode.disabled = false;
      }
    });
    try { token = sessionStorage.getItem('meatPusherField') || ''; } catch (_) { token = ''; }
    if (token) {
      showForm();
      loadCatalog().catch(function () { showLogin(); });
    }
  } else {
    var ready = window.dumpBinAuthReady || Promise.resolve();
    ready.then(loadCatalog).catch(function () {});
  }
})();
