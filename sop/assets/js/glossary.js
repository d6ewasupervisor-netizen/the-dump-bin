/* Glossary — 137 terms. Every id here is a link target for the whole
   document. Renaming one silently breaks inbound links from other sections. */
(function () {
  'use strict';

  var esc = window.ROSop.esc;
  var BASE = window.ROSop.base;

  var mount = document.querySelector('[data-ro-glossary]');
  var alpha = document.querySelector('[data-ro-alpha]');
  var input = document.querySelector('[data-ro-filter]');
  var count = document.querySelector('[data-ro-count]');
  if (!mount) return;

  var DATA = [];

  /* Term bodies contain markdown bold and cross-references. Convert the
     limited subset that actually appears, and escape everything else. */
  function body(md) {
    return esc(md)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  function render() {
    var q = input ? input.value.trim().toLowerCase() : '';
    var list = q
      ? DATA.filter(function (t) {
          return t.term.toLowerCase().indexOf(q) !== -1 || t.body.toLowerCase().indexOf(q) !== -1;
        })
      : DATA;

    if (count) {
      count.textContent = q
        ? list.length + (list.length === 1 ? ' term' : ' terms') + ' matching “' + q + '”'
        : DATA.length + ' terms';
    }

    if (!list.length) {
      mount.innerHTML = '<p class="ro-empty">No term matches that.</p>';
      if (alpha) alpha.hidden = true;
      return;
    }

    var letters = [];
    var seen = {};
    list.forEach(function (t) {
      if (!seen[t.letter]) { seen[t.letter] = []; letters.push(t.letter); }
      seen[t.letter].push(t);
    });
    letters.sort();

    if (alpha) {
      alpha.hidden = false;
      alpha.innerHTML = letters.map(function (l) {
        return '<li><a href="#letter-' + l + '">' + l + '</a></li>';
      }).join('');
    }

    mount.innerHTML = letters.map(function (l) {
      return '<h2 id="letter-' + l + '">' + l + '</h2>' +
        seen[l].map(function (t) {
          return '<div class="ro-def" id="' + t.id + '">' +
            '<span class="ro-def__term">' + esc(t.term) + '</span>' +
            '<p>' + body(t.body) + '</p></div>';
        }).join('');
    }).join('');
  }

  function jumpToHash() {
    if (!window.location.hash) return;
    var el = document.getElementById(window.location.hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
  }

  if (input) {
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(render, 100);
    });
  }

  mount.innerHTML = '<p class="ro-empty">Loading glossary…</p>';

  fetch(BASE + '/assets/data/glossary.json')
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function (data) {
      DATA = data;
      render();
      jumpToHash();
    })
    .catch(function () {
      mount.innerHTML = '<p class="ro-empty">The glossary did not load. Reload the page, and tell me if it keeps failing.</p>';
    });
})();
