/* Kompass SOP — shared behaviour.
   No framework. Template strings and DOM manipulation, matching the house pattern. */
(function () {
  'use strict';

  var BASE = document.documentElement.getAttribute('data-base') || '/sop';

  /* Page order lives in one place. Adding a section means editing this array
     and nothing else — the drawer, the pager and the index all read from it. */
  var PAGES = [
    { part: 1, url: 'part-1/01-welcome', title: 'Section 1 — Welcome' },
    { part: 1, url: 'part-1/02-what-is-kompass', title: 'Section 2 — What Is Kompass' },
    { part: 1, url: 'part-1/03-before-your-first-shift', title: 'Section 3 — Before Your First Shift' },
    { part: 1, url: 'part-1/04-professional-standards', title: 'Section 4 — Professional Standards' },
    { part: 1, url: 'part-1/05-arriving-at-the-store', title: 'Section 5 — Arriving at the Store' },
    { part: 1, url: 'part-1/06-working-safely', title: 'Section 6 — Working Safely' },
    { part: 1, url: 'part-1/07-reading-a-planogram', title: 'Section 7 — Reading a Planogram' },
    { part: 1, url: 'part-1/08-performing-a-full-reset', title: 'Section 8 — Performing a Full Reset' },
    { part: 1, url: 'part-1/09-closing-out', title: 'Section 9 — Closing Out' },
    { part: 1, url: 'part-1/10-quick-reference-card', title: 'Section 10 — Quick Reference Card' },
    { part: 2, url: 'part-2/aisle-navigation', title: 'Aisle Navigation' },
    { part: 2, url: 'part-2/bakery', title: 'Bakery' },
    { part: 2, url: 'part-2/commodities', title: 'Kompass Commodities' },
    { part: 2, url: 'part-2/conditioning-by-department', title: 'Conditioning by Department' },
    { part: 2, url: 'part-2/front-end', title: 'Front End' },
    { part: 2, url: 'part-2/glossary', title: 'Glossary' },
    { part: 2, url: 'part-2/shelf-hardware-esl-parts', title: 'Shelf Hardware and ESL Parts' },
    { part: 2, url: 'part-2/special-fixtures', title: 'Special Fixtures' },
    { part: 2, url: 'part-2/storage', title: 'Storage' }
  ];

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var href = function (url) { return BASE + '/' + url; };

  function currentUrl() {
    var p = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    for (var i = 0; i < PAGES.length; i++) {
      if (p.indexOf(PAGES[i].url) !== -1) return PAGES[i].url;
    }
    return null;
  }

  /* ---------------------------------------------------------------- nav --- */

  function buildNav() {
    var nav = document.querySelector('[data-ro-nav]');
    if (!nav) return;
    var here = currentUrl();

    function group(part, label) {
      var items = PAGES.filter(function (p) { return p.part === part; }).map(function (p) {
        return '<li><a href="' + href(p.url) + '"' +
          (p.url === here ? ' aria-current="page"' : '') + '>' + esc(p.title) + '</a></li>';
      }).join('');
      return '<p class="ro-nav__group">' + label + '</p><ol>' + items + '</ol>';
    }

    nav.innerHTML =
      '<p class="ro-nav__group">Contents</p><ol><li><a href="' + href('') + '">Start here</a></li></ol>' +
      group(1, 'Part I — Training') +
      group(2, 'Part II — Reference');
  }

  function wireDrawer() {
    var nav = document.querySelector('[data-ro-nav]');
    var toggle = document.querySelector('[data-ro-navtoggle]');
    var backdrop = document.querySelector('[data-ro-backdrop]');
    if (!nav || !toggle) return;

    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      nav.setAttribute('data-open', 'true');
      if (backdrop) backdrop.setAttribute('data-open', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      var first = nav.querySelector('a');
      if (first) first.focus();
    }

    function close() {
      nav.removeAttribute('data-open');
      if (backdrop) backdrop.removeAttribute('data-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (lastFocus) lastFocus.focus();
    }

    toggle.addEventListener('click', function () {
      if (nav.getAttribute('data-open') === 'true') close(); else open();
    });

    if (backdrop) backdrop.addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (nav.getAttribute('data-open') === 'true') close();
    });

    nav.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || nav.getAttribute('data-open') !== 'true') return;
      var f = nav.querySelectorAll('a, button');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* --------------------------------------------------------------- toc ---- */

  function buildToc() {
    var toc = document.querySelector('[data-ro-toc]');
    var main = document.querySelector('[data-ro-body]');
    if (!toc || !main) return;

    var heads = main.querySelectorAll('h2[id], h3[id], h4[id]');
    if (heads.length < 3) { toc.hidden = true; return; }

    var items = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      items.push('<li data-level="' + h.tagName.charAt(1) + '"><a href="#' + h.id + '">' +
        esc(h.textContent) + '</a></li>');
    }
    toc.innerHTML = '<summary>On this page</summary><ol>' + items.join('') + '</ol>';
    if (window.matchMedia('(min-width: 72rem)').matches) toc.open = true;
  }

  /* -------------------------------------------------------------- pager -- */

  function buildPager() {
    var pager = document.querySelector('[data-ro-pager]');
    if (!pager) return;
    var here = currentUrl();
    var i = PAGES.findIndex(function (p) { return p.url === here; });
    if (i === -1) return;

    var out = '';
    if (i > 0) {
      out += '<a href="' + href(PAGES[i - 1].url) + '" rel="prev"><span>Previous</span><strong>' +
        esc(PAGES[i - 1].title) + '</strong></a>';
    }
    if (i < PAGES.length - 1) {
      out += '<a href="' + href(PAGES[i + 1].url) + '" rel="next"><span>Next</span><strong>' +
        esc(PAGES[i + 1].title) + '</strong></a>';
    }
    pager.innerHTML = out;
  }

  /* ------------------------------------------------------------- search -- */

  function wireSearch() {
    var toggle = document.querySelector('[data-ro-searchtoggle]');
    var panel = document.querySelector('[data-ro-searchpanel]');
    if (!toggle || !panel) return;

    var input = panel.querySelector('[data-ro-searchinput]');
    var list = panel.querySelector('[data-ro-searchresults]');
    var count = panel.querySelector('[data-ro-searchcount]');
    var index = null;
    var loading = false;

    function load() {
      if (index || loading) return Promise.resolve();
      loading = true;
      return fetch(BASE + '/assets/data/search-index.json')
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(function (data) { index = data; loading = false; })
        .catch(function () {
          loading = false;
          if (count) count.textContent = 'Search is unavailable — the index did not load.';
        });
    }

    function open() {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      load().then(function () { if (input) input.focus(); });
    }

    function close() {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }

    toggle.addEventListener('click', function () {
      if (panel.hidden) open(); else close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) close();
      if (e.key === '/' && panel.hidden && document.activeElement === document.body) {
        e.preventDefault();
        open();
      }
    });

    function snippet(text, terms) {
      var low = text.toLowerCase();
      var at = -1;
      for (var i = 0; i < terms.length; i++) {
        var f = low.indexOf(terms[i]);
        if (f !== -1 && (at === -1 || f < at)) at = f;
      }
      var start = Math.max(0, at - 60);
      var slice = text.slice(start, start + 200);
      var out = esc((start > 0 ? '…' : '') + slice + (start + 200 < text.length ? '…' : ''));
      terms.forEach(function (t) {
        if (!t) return;
        out = out.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
      });
      return out;
    }

    function run() {
      if (!index) return;
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { list.innerHTML = ''; count.textContent = ''; return; }
      var terms = q.split(/\s+/);

      var hits = index.map(function (r) {
        var head = r.heading.toLowerCase();
        var body = r.text.toLowerCase();
        var score = 0;
        for (var i = 0; i < terms.length; i++) {
          if (head.indexOf(terms[i]) !== -1) score += 10;
          if (body.indexOf(terms[i]) !== -1) score += 1;
          else if (head.indexOf(terms[i]) === -1) return null;
        }
        return { r: r, score: score };
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 30);

      count.textContent = hits.length ? hits.length + (hits.length === 1 ? ' result' : ' results') : 'No results';

      list.innerHTML = hits.map(function (h) {
        var r = h.r;
        var url = href(r.url) + (r.id ? '#' + r.id : '');
        return '<li><a href="' + url + '">' +
          '<span class="ro-results__where">' + esc(r.page) + '</span>' +
          '<span class="ro-results__what">' + esc(r.heading) + '</span>' +
          '<span class="ro-results__snip">' + snippet(r.text, terms) + '</span></a></li>';
      }).join('');
    }

    var t = null;
    if (input) {
      input.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(run, 120);
      });
    }
  }

  /* --------------------------------------------------------------- init -- */

  function init() {
    buildNav();
    wireDrawer();
    buildToc();
    buildPager();
    wireSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ROSop = { PAGES: PAGES, base: BASE, esc: esc, href: href };
})();
