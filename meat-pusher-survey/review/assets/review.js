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

  var statusEl = document.getElementById('status');
  var storesEl = document.getElementById('stores');
  var detailEl = document.getElementById('detail');
  var shareBtn = document.getElementById('share');
  var selected = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function api(path, opts) {
    var url;
    var f;
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

  function listPath() {
    return TOKEN ? '/' : '/review';
  }

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
    } catch (err) {
      statusEl.textContent = err.message || 'Could not create the link';
    }
  });

  function photoUrl(id) {
    return api(TOKEN ? '/photos/' + id : '/photos/' + id);
  }

  async function downloadSheet(report) {
    statusEl.textContent = 'Building the sheet.';
    var path = (TOKEN ? '/reports/' : '/reports/') + report.id + '/form.pdf';
    var res = await api(path);
    if (!res.ok) {
      var data = await res.json().catch(function () { return {}; });
      statusEl.textContent = data.error || 'Could not build the sheet';
      return;
    }
    var blob = await res.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Meat Pushers Store ' + report.storeNumber + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    statusEl.textContent = 'Sheet downloaded.';
  }

  function show(report) {
    selected = report.id;
    document.querySelectorAll('.stores button').forEach(function (btn) {
      btn.classList.toggle('on', Number(btn.dataset.id) === report.id);
    });
    var html = '<p><strong>Store ' + esc(report.storeNumber) + '</strong> ' +
      esc(report.reportedOn || '') + ' ' + esc(report.name || '') + '</p>' +
      '<p><button type="button" id="sheet">Filled sheet</button></p>';
    (report.sets || []).forEach(function (set) {
      var pics = (report.photos || []).filter(function (photo) {
        return String(photo.commodity) === String(set.commodity);
      });
      html += '<article class="set"><h2>' + esc(LABELS[set.commodity] || set.commodity) + '</h2>' +
        '<p class="answer">' + esc(set.sheet || '') + '</p>' +
        (set.notes ? '<p>' + esc(set.notes) + '</p>' : '') +
        '<div class="photos">' + pics.map(function (photo) {
          return '<figure><img data-photo="' + photo.id + '" alt="' + esc(SLOTS[photo.slot] || photo.slot) + '">' +
            '<figcaption>' + esc(SLOTS[photo.slot] || photo.slot) + '</figcaption></figure>';
        }).join('') + '</div></article>';
    });
    var loose = (report.photos || []).filter(function (photo) { return !photo.commodity; });
    if (loose.length) {
      html += '<article class="set"><h2>Pallet</h2><div class="photos">' + loose.map(function (photo) {
        return '<figure><img data-photo="' + photo.id + '" alt="Pallet"><figcaption>Pallet</figcaption></figure>';
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
      if (lines.length) {
        html += '<article class="set"><h2>Install week</h2><p>' +
          lines.map(esc).join('<br>') + '</p></article>';
      }
    }
    detailEl.innerHTML = html;
    detailEl.querySelector('#sheet').addEventListener('click', function () { downloadSheet(report); });
    detailEl.querySelectorAll('img[data-photo]').forEach(function (img) {
      photoUrl(img.getAttribute('data-photo')).then(function (res) {
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

  async function boot() {
    if (TOKEN === '' && window.MEAT_PUSHER_SHARE) {
      statusEl.textContent = 'This link is not valid.';
      return;
    }
    var res = await api(listPath());
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) {
      statusEl.textContent = data.error || 'Could not load reports';
      return;
    }
    var reports = data.reports || [];
    if (!reports.length) {
      detailEl.innerHTML = '<p>No stores on file.</p>';
      return;
    }
    reports.forEach(function (report) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = String(report.id);
      btn.innerHTML = '<span class="store-no">' + esc(report.storeNumber) + '</span>' +
        esc(report.reportedOn || '') + ' ' + esc(report.name || '');
      btn.addEventListener('click', function () { show(report); });
      storesEl.appendChild(btn);
    });
    show(reports[0]);
  }

  var ready = window.dumpBinAuthReady || Promise.resolve();
  ready.then(boot).catch(function () {});
})();
