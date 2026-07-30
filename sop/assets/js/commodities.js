/* Commodities — 422 entries, one data source, two views.
   The filter is the primary interface: the field question is "what department
   is 39", asked standing in front of it. */
(function () {
  'use strict';

  var esc = window.ROSop.esc;
  var BASE = window.ROSop.base;

  var mount = document.querySelector('[data-ro-commodities]');
  var input = document.querySelector('[data-ro-filter]');
  var count = document.querySelector('[data-ro-count]');
  var toggle = document.querySelector('[data-ro-view]');
  if (!mount) return;

  var DATA = [];
  var view = 'department';

  function markerSuffix(c) {
    if (c.marker === 'moved') return ' ‡';
    if (c.marker === 'retained') return ' †';
    return '';
  }

  function rows(list, thirdCol) {
    return list.map(function (c) {
      return '<tr id="c-' + c.number + '"><th scope="row">' + c.number + markerSuffix(c) + '</th><td>' +
        esc(c.name) + '</td><td>' + esc(c[thirdCol]) + '</td></tr>';
    }).join('');
  }

  function table(caption, list, thirdCol, thirdLabel) {
    return '<div class="ro-tablewrap ro-tablewrap--stick"><table>' +
      (caption ? '<caption>' + esc(caption) + '</caption>' : '') +
      '<thead><tr><th scope="col">No.</th><th scope="col">Commodity</th><th scope="col">' +
      thirdLabel + '</th></tr></thead><tbody>' + rows(list, thirdCol) + '</tbody></table></div>';
  }

  function byDepartment(list) {
    var depts = [];
    var seen = {};
    list.forEach(function (c) {
      if (!seen[c.department]) { seen[c.department] = []; depts.push(c.department); }
      seen[c.department].push(c);
    });
    depts.sort();
    return depts.map(function (d) {
      var id = 'd-' + d.slice(0, 2);
      return '<h2 id="' + id + '">' + esc(d) + '</h2>' +
        table('', seen[d], 'group', 'Group');
    }).join('');
  }

  function byNumber(list) {
    var sorted = list.slice().sort(function (a, b) { return a.number - b.number; });
    return table('All commodities by number', sorted, 'department', 'Department');
  }

  function render() {
    var q = input ? input.value.trim().toLowerCase() : '';
    var list = DATA;

    if (q) {
      list = DATA.filter(function (c) {
        return String(c.number) === q ||
          String(c.number).indexOf(q) === 0 ||
          c.name.toLowerCase().indexOf(q) !== -1;
      });
    }

    if (count) {
      count.textContent = q
        ? list.length + (list.length === 1 ? ' commodity' : ' commodities') + ' matching “' + q + '”'
        : DATA.length + ' commodities across ' + Object.keys(DATA.reduce(function (a, c) { a[c.department] = 1; return a; }, {})).length + ' departments';
    }

    if (!list.length) {
      mount.innerHTML = '<p class="ro-empty">Nothing matches that. Try a number, or part of a commodity name.</p>';
      return;
    }

    mount.innerHTML = view === 'department' ? byDepartment(list) : byNumber(list);
  }

  function highlightFromQuery() {
    var m = window.location.search.match(/[?&]c=(\d+)/);
    var target = m ? m[1] : (window.location.hash.match(/^#c-(\d+)$/) || [])[1];
    if (!target) return;
    var row = document.getElementById('c-' + target);
    if (!row) return;
    row.setAttribute('data-hit', 'true');
    row.scrollIntoView({ block: 'center' });
  }

  if (toggle) {
    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      view = btn.getAttribute('data-view');
      Array.prototype.forEach.call(toggle.querySelectorAll('button[data-view]'), function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      render();
    });
  }

  if (input) {
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(render, 100);
    });
  }

  mount.innerHTML = '<p class="ro-empty">Loading commodities…</p>';

  fetch(BASE + '/assets/data/commodities.json')
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function (data) {
      DATA = data;
      render();
      highlightFromQuery();
    })
    .catch(function () {
      mount.innerHTML = '<p class="ro-empty">The commodity list did not load. Reload the page, and tell me if it keeps failing.</p>';
    });
})();
