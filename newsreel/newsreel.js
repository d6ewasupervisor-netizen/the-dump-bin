(function () {
  'use strict';

  var DISTRICTS = {
    49: '6', 657: '6', 214: '6', 351: '6', 163: '6', 286: '6', 486: '6', 652: '6', 654: '6',
    19: '8', 23: '8', 28: '8', 31: '8', 53: '8', 215: '8', 391: '8', 459: '8', 658: '8', 682: '8',
    156: '9', 198: '9', 226: '9', 260: '9', 383: '9', 439: '9', 449: '9', 613: '9', 662: '9', 685: '9',
  };
  var STORES = [
    { num: '19', city: 'Auburn' }, { num: '23', city: 'Bellevue' }, { num: '28', city: 'Burien' },
    { num: '31', city: 'Renton' }, { num: '49', city: "Coeur d'Alene" }, { num: '53', city: 'Covington' },
    { num: '163', city: 'Kennewick' }, { num: '214', city: 'Wandermere' }, { num: '215', city: 'Kent' },
    { num: '286', city: 'Richland' }, { num: '351', city: 'Sullivan' }, { num: '391', city: 'Kirkland' },
    { num: '459', city: 'Renton' }, { num: '486', city: 'Yakima' }, { num: '652', city: 'Ellensburg' },
    { num: '654', city: 'East Wenatchee' }, { num: '657', city: 'Thor' }, { num: '658', city: 'Issaquah' },
    { num: '682', city: 'Maple Valley' },
  ];
  var LOGO = 'assets/ro-new-logo.png';
  var reel = new URLSearchParams(location.search).get('reel') === 'cp' ? 'cp' : 'kompass';
  var posts = [];
  var stopId = 'recent';
  var openSlug = new URLSearchParams(location.search).get('p') || '';
  var roller;
  var pdfBlobUrl = '';

  document.getElementById(reel === 'cp' ? 'linkCp' : 'linkKompass').classList.add('is-on');

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function weeksOf(post) {
    if (post.periodWeeks && post.periodWeeks.length) return post.periodWeeks;
    return post.periodWeek ? [post.periodWeek] : [];
  }

  function matches(post) {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var store = document.getElementById('store').value.trim().replace(/^0+/, '');
    var district = document.getElementById('district').value;
    var day = document.getElementById('day').value;
    if (stopId !== 'recent' && weeksOf(post).indexOf(stopId) === -1) return false;
    if (q && (post.subject + ' ' + post.title + ' ' + (post.summary || '')).toLowerCase().indexOf(q) === -1) return false;
    if (store && (post.stores || []).map(String).indexOf(store) === -1) return false;
    if (district && !(post.stores || []).some(function (n) { return DISTRICTS[n] === district; })) return false;
    if (day) {
      var from = String(post.appliesFrom || '').slice(0, 10);
      var to = String(post.appliesTo || from).slice(0, 10);
      if (from && (day < from || day > to)) return false;
    }
    return true;
  }

  function renderCards() {
    var box = document.getElementById('cards');
    var rows = posts.filter(matches);
    if (!rows.length) {
      box.innerHTML = '<p class="empty">Nothing in this stop.</p>';
      return;
    }
    box.innerHTML = rows.map(function (post) {
      var when = [post.periodWeek, post.appliesFrom ? String(post.appliesFrom).slice(5) : ''].filter(Boolean).join(' · ');
      var stores = (post.stores || []).join(', ') || 'All stores';
      return '<button type="button" class="card-row" data-slug="' + esc(post.slug) + '">'
        + '<img src="' + esc(post.thumbUrl || LOGO) + '" alt="">'
        + '<span><strong>' + esc(post.subject || post.title) + '</strong>'
        + '<span class="card-meta">' + esc(stores) + '<br>' + esc(when) + '</span></span></button>';
    }).join('');
  }

  function stopsFrom(weeks) {
    var ranked = (weeks || []).slice().sort(function (a, b) {
      function rank(id) {
        var m = /^P(\d+)W(\d+)$/.exec(id);
        return m ? (Number(m[1]) * 10 + Number(m[2])) : 0;
      }
      return rank(b) - rank(a);
    });
    var stops = [{ id: 'recent', label: '2 weeks', sub: 'Newest' }];
    ranked.forEach(function (week) {
      stops.push({ id: week, label: week, sub: '' });
    });
    return stops;
  }

  function mountRoller(weeks) {
    var root = document.getElementById('roller');
    roller = WeekRoller.mount(root, {
      stops: stopsFrom(weeks),
      index: 0,
      onChange: function (stop) {
        stopId = stop.id;
        renderCards();
      },
    });
  }

  async function load() {
    var res = await dumpBinAuthFetch('/api/reel/' + reel);
    if (!res.ok) throw new Error('Could not load the reel');
    var data = await res.json();
    posts = data.posts || [];
    mountRoller(data.weeks || []);
    renderCards();
    if (openSlug) openPost(openSlug, true);
  }

  function remember() {
    return {
      reel: reel,
      stop: stopId,
      scroll: document.getElementById('cards').scrollTop,
      slug: openSlug || '',
    };
  }

  async function openPost(slug, replace) {
    var res = await dumpBinAuthFetch('/api/reel/post/' + encodeURIComponent(slug));
    if (!res.ok) return;
    var data = await res.json();
    var post = data.post;
    openSlug = slug;
    document.getElementById('detailTitle').textContent = post.subject || post.title;
    document.getElementById('detailMeta').textContent = [(post.stores || []).join(', ') || 'All stores', post.periodWeek].filter(Boolean).join(' · ');
    document.getElementById('detailHtml').innerHTML = post.html || '';
    document.getElementById('overlay').hidden = false;
    var url = '/newsreel/?reel=' + reel + '&p=' + encodeURIComponent(slug);
    var state = remember();
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
    document.getElementById('openPdf').onclick = function () { showPdf(slug, post.title); };
    document.getElementById('shareBtn').onclick = function () { sharePdf(slug, post); };
    document.getElementById('printBtn').onclick = function () { printPdf(slug); };
  }

  async function pdfBlob(slug) {
    var res = await dumpBinAuthFetch('/api/reel/post/' + encodeURIComponent(slug) + '/document');
    if (!res.ok) throw new Error('No PDF');
    return res.blob();
  }

  async function showPdf(slug, title) {
    var blob = await pdfBlob(slug);
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    pdfBlobUrl = URL.createObjectURL(blob);
    if (!window.MaterialsPdfViewer) return;
    await MaterialsPdfViewer.open({
      title: title || 'Notice',
      fileName: 'notice.pdf',
      url: pdfBlobUrl,
      onShare: function () { sharePdf(slug, { title: title }); },
      onPrintAtStore: function () { printPdf(slug); },
    });
  }

  async function sharePdf(slug, post) {
    if (!window.DocShareCompose) return;
    var blob = await pdfBlob(slug);
    var buf = await blob.arrayBuffer();
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    var b64 = btoa(bin);
    DocShareCompose.open({
      authFetch: dumpBinAuthFetch,
      toast: function (msg) { window.alert(msg); },
      getPayload: function () {
        return {
          attachments: [{ filename: (post.title || 'notice') + '.pdf', content: b64 }],
          storeNumber: (post.stores || [])[0] || '',
          source: 'news-reel',
        };
      },
    });
  }

  function printPdf(slug) {
    var store = window.prompt('Store number');
    if (!store) return;
    var known = STORES.filter(function (row) { return row.num === String(store).replace(/^0+/, ''); })[0];
    dumpBinAuthFetch('/api/reel/post/' + encodeURIComponent(slug) + '/print-at-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeNumber: store, storeCity: known ? known.city : '' }),
    }).then(function (res) {
      window.alert(res.ok ? 'Sent to the store.' : 'Print did not send.');
    });
  }

  document.getElementById('back').addEventListener('click', function () {
    if (history.state && history.state.slug) history.back();
    else closeOverlay();
  });

  function closeOverlay() {
    document.getElementById('overlay').hidden = true;
    openSlug = '';
    var state = remember();
    history.replaceState(state, '', '/newsreel/?reel=' + reel);
    if (state.scroll) document.getElementById('cards').scrollTop = state.scroll;
  }

  window.addEventListener('popstate', function (event) {
    var state = event.state || {};
    if (state.slug) {
      openPost(state.slug, true);
      return;
    }
    document.getElementById('overlay').hidden = true;
    openSlug = '';
    if (state.stop && roller) {
      stopId = state.stop;
    }
    renderCards();
    if (typeof state.scroll === 'number') document.getElementById('cards').scrollTop = state.scroll;
  });

  ['q', 'store', 'district', 'day'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderCards);
    document.getElementById(id).addEventListener('change', renderCards);
  });

  document.getElementById('cards').addEventListener('click', function (event) {
    var row = event.target.closest('[data-slug]');
    if (!row) return;
    var box = document.getElementById('cards');
    history.replaceState(Object.assign(remember(), { scroll: box.scrollTop }), '', location.href);
    openPost(row.dataset.slug, false);
  });

  load().catch(function (err) {
    document.getElementById('cards').innerHTML = '<p class="empty">' + esc(err.message) + '</p>';
  });
})();
