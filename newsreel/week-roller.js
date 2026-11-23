(function (global) {
  'use strict';

  var PILL = 72;

  function mount(root, opts) {
    var stops = opts.stops || [];
    var index = Math.max(0, opts.index || 0);
    var drag = null;
    var ignoreClick = false;
    root.innerHTML = ''
      + '<button type="button" class="roller-arrow" data-dir="-1" aria-label="Newer">&#9650;</button>'
      + '<div class="roller-window" tabindex="0">'
      + '<div class="roller-frame roller-frame-top"></div>'
      + '<div class="roller-frame roller-frame-mid"></div>'
      + '<div class="roller-frame roller-frame-bot"></div>'
      + '<div class="roller-track"></div>'
      + '</div>'
      + '<button type="button" class="roller-arrow" data-dir="1" aria-label="Older">&#9660;</button>';
    var track = root.querySelector('.roller-track');
    var win = root.querySelector('.roller-window');

    function draw(offset) {
      var shift = -(index * PILL) + (offset || 0);
      track.style.transform = 'translateY(calc(50% - ' + (PILL / 2) + 'px + ' + shift + 'px))';
      track.querySelectorAll('.roller-pill').forEach(function (pill) {
        var dist = Number(pill.dataset.idx) - index;
        var abs = Math.abs(dist);
        pill.style.opacity = String(Math.max(0.15, 1 - abs * 0.22));
        pill.style.transform = 'scale(' + Math.max(0.72, 1 - abs * 0.08) + ')';
        pill.classList.toggle('is-current', dist === 0);
      });
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

    track.innerHTML = stops.map(function (stop, i) {
      return '<button type="button" class="roller-pill" data-idx="' + i + '">'
        + '<span class="roller-pill-main">' + escapeHtml(stop.label) + '</span>'
        + '<span class="roller-pill-sub">' + escapeHtml(stop.sub || '') + '</span>'
        + '</button>';
    }).join('');
    draw(0);

    root.querySelectorAll('.roller-arrow').forEach(function (btn) {
      btn.addEventListener('click', function () {
        go(index + Number(btn.dataset.dir));
      });
    });

    track.addEventListener('click', function (event) {
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
