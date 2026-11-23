(function (global) {
  'use strict';

  var PILL = 72;

  function mount(root, opts) {
    var stops = opts.stops || [];
    var index = Math.max(0, opts.index || 0);
    var drag = null;
    var ignoreClick = false;
    root.innerHTML = ''
      + '<div class="roller-art">'
      + '<img class="roller-art-img" src="assets/roller.jpg" alt="">'
      + '<button type="button" class="roller-hit roller-hit-up" data-dir="-1" aria-label="Newer"></button>'
      + '<div class="roller-slots"></div>'
      + '<button type="button" class="roller-hit roller-hit-down" data-dir="1" aria-label="Older"></button>'
      + '</div>';
    var slots = root.querySelector('.roller-slots');
    var win = root.querySelector('.roller-art');
    var offsets = [-2, -1, 0, 1, 2];

    function labelAt(i) {
      if (i < 0 || i >= stops.length) return { label: '', sub: '' };
      return stops[i];
    }

    function draw(offset) {
      var shift = Math.round((offset || 0) / PILL);
      slots.innerHTML = offsets.map(function (slot) {
        var item = labelAt(index + slot - shift);
        var current = slot === 0 && !shift;
        return '<button type="button" class="roller-pill' + (current ? ' is-current' : '') + '" data-idx="' + (index + slot) + '">'
          + '<span class="roller-pill-main">' + escapeHtml(item.label) + '</span>'
          + '<span class="roller-pill-sub">' + escapeHtml(item.sub) + '</span>'
          + '</button>';
      }).join('');
      root.querySelector('[data-dir="-1"]').disabled = index === 0;
      root.querySelector('[data-dir="1"]').disabled = index >= stops.length - 1;
    }

    function go(next) {
      var clamped = Math.max(0, Math.min(stops.length - 1, next));
      if (clamped === index) {
        draw(0);
        return;
      }
      index = clamped;
      draw(0);
      if (opts.onChange) opts.onChange(stops[index], index);
    }

    draw(0);

    root.querySelectorAll('.roller-hit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        go(index + Number(btn.dataset.dir));
      });
    });

    slots.addEventListener('click', function (event) {
      var pill = event.target.closest('.roller-pill');
      if (!pill || drag || ignoreClick) return;
      var next = Number(pill.dataset.idx);
      if (Math.abs(next - index) <= 4) go(next);
    });

    win.addEventListener('pointerdown', function (event) {
      drag = { id: event.pointerId, y: event.clientY, moved: 0 };
      try { win.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    });
    win.addEventListener('pointermove', function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      drag.moved = event.clientY - drag.y;
      draw(drag.moved);
    });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      var moved = drag.moved;
      drag = null;
      if (Math.abs(moved) >= 8) ignoreClick = true;
      setTimeout(function () { ignoreClick = false; }, 0);
      if (Math.abs(moved) < 8) {
        draw(0);
        return;
      }
      go(index - Math.round(moved / PILL));
    }
    win.addEventListener('pointerup', endDrag);
    win.addEventListener('pointercancel', endDrag);

    win.addEventListener('wheel', function (event) {
      event.preventDefault();
      go(index + (event.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    win.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); go(index + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); go(index - 1); }
    });

    return { go: go, index: function () { return index; } };
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  global.WeekRoller = { mount: mount };
})(window);
