(function () {
  'use strict';

  var SETS = [
    { id: '556', label: '556 Ham Bar' },
    { id: '559', label: '559 Heat & Serve' },
    { id: '570', label: '570 Dinner Sausage' },
    { id: '575', label: '575 Hot Dogs' },
    { id: '578', label: '578 Bacon / Breakfast' }
  ];
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
      return '<label><input type="radio" name="fixture-' + set.id + '" value="' + line[0] + '" required> ' + line[1] + '</label>';
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
      '<label>Notes <input name="notes-' + set.id + '"></label>';
    setsRoot.appendChild(section);
    section.addEventListener('change', function (ev) {
      if (!ev.target || ev.target.name !== 'fixture-' + set.id) return;
      var noBracket = ev.target.value === 'no_bracket';
      var gone = ev.target.value === 'absent';
      section.querySelector('.measures').hidden = !noBracket;
      section.querySelector('.photos').hidden = gone;
    });
  });

  function api(path, opts) {
    var f = window.dumpBinAuthFetch || fetch;
    return f('/api/meat-pusher-survey' + path, opts);
  }

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
          reader.onload = function () {
            resolve(String(reader.result).split(',')[1]);
          };
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
        var picked = form.querySelector('input[name="fixture-' + id + '"]:checked');
        var fixture = picked ? picked.value : '';
        var photos = [];
        if (fixture !== 'absent') {
          var setPhoto = await photoField(form['set-' + id], 'set');
          var backPhoto = await photoField(form['back-' + id], 'shelf_back');
          if (setPhoto) photos.push(setPhoto);
          if (backPhoto) photos.push(backPhoto);
        }
        sets.push({
          commodity: id,
          fixture: fixture,
          shelfCount: form['count-' + id].value,
          width: form['width-' + id].value,
          depth: form['depth-' + id].value,
          notes: form['notes-' + id].value,
          photos: photos
        });
      }
      var palletPhotos = [];
      var pallet = await photoField(form.pallet, 'pallet');
      if (pallet) palletPhotos.push(pallet);
      var res = await api('', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          store: form.store.value,
          name: form.name.value,
          reportedOn: form.reportedOn.value,
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
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not save the report');
      statusEl.textContent = 'Saved. Store ' + data.report.storeNumber + ' is on file.';
      form.reset();
      form.reportedOn.value = todayPacific();
      await loadSaved();
    } catch (err) {
      statusEl.textContent = err.message || 'Could not save the report';
    } finally {
      sendBtn.disabled = false;
    }
  });

  async function loadSaved() {
    var res = await api('', { noBounceOn401: true });
    if (!res.ok) return;
    var data = await res.json();
    var list = document.getElementById('savedList');
    var box = document.getElementById('saved');
    var reports = data.reports || [];
    if (!reports.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    list.innerHTML = '';
    reports.forEach(function (report) {
      var row = document.createElement('div');
      row.className = 'saved-row';
      var when = report.reportedOn || '';
      row.innerHTML = '<strong>Store ' + esc(report.storeNumber) + '</strong> ' + esc(when);
      var thumbs = document.createElement('div');
      thumbs.className = 'thumbs';
      (report.photos || []).forEach(function (photo) {
        var img = document.createElement('img');
        img.alt = (photo.commodity || '') + ' ' + photo.slot;
        thumbs.appendChild(img);
        api('/photos/' + photo.id).then(function (r) {
          if (!r.ok) return null;
          return r.blob();
        }).then(function (blob) {
          if (blob) img.src = URL.createObjectURL(blob);
        });
      });
      row.appendChild(thumbs);
      list.appendChild(row);
    });
  }

  window.dumpBinAuthReady.then(loadSaved).catch(function () {});
})();
