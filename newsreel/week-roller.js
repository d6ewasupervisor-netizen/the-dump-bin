(function (global) {
  'use strict';

  function mount(root, opts) {
    var stops = opts.stops || [];
    var index = Math.max(0, Math.min(stops.length - 1, opts.index || 0));
    var drag = null;
    var ignoreClick = false;
    root.innerHTML = ''
      + '<button type="button" class="roller-hit" data-dir="-1" aria-label="Newer">'
      + '<img src="assets/reel-arrow.jpg" alt=""></button>'
      + '<div class="roller-track" tabindex="0"></div>'
      + '<button type="button" class="roller-hit roller-hit-down" data-dir="1" aria-label="Older">'
      + '<img src="assets/reel-arrow.jpg" alt=""></button>';
    var track = root.querySelector('.roller-track');

    function draw() {
      track.innerHTML = stops.map(function (stop, i) {
        var on = i === index ? ' is-current' : '';
        return '<button type="button" class="roller-pill' + on + '" data-idx="' + i + '">'
          + '<span class="roller-pill-main">' + escapeHtml(stop.label) + '</span>'
          + '<span class="roller-pill-sub">' + escapeHtml(stop.sub || '') + '</span>'
          + '</button>';
      }).join('');
      var current = track.querySelector('.is-current');
      if (current) current.scrollIntoView({ block: 'nearest' });
      root.querySelector('[data-dir="-1"]').disabled = index <= 0;
      root.querySelector('[data-dir="1"]').disabled = index >= stops.length - 1;
    }

    function go(next) {
      var clamped = Math.max(0, Math.min(stops.length - 1, next));
      if (clamped === index) return;
      index = clamped;
      draw();
      if (opts.onChange) opts.onChange(stops[index], index);
    }

    draw();

    root.querySelectorAll('.roller-hit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        go(index + Number(btn.dataset.dir));
      });
    });

    track.addEventListener('click', function (event) {
      var pill = event.target.closest('.roller-pill');
      if (!pill || ignoreClick) return;
      go(Number(pill.dataset.idx));
    });

    track.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.roller-hit')) return;
      drag = { id: event.pointerId, y: event.clientY, moved: 0 };
      try { track.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    });
    track.addEventListener('pointermove', function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      drag.moved = event.clientY - drag.y;
    });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      var moved = drag.moved;
      drag = null;
      if (Math.abs(moved) < 24) return;
      ignoreClick = true;
      setTimeout(function () { ignoreClick = false; }, 0);
      go(index + (moved > 0 ? -1 : 1));
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('wheel', function (event) {
      event.preventDefault();
      go(index + (event.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    track.addEventListener('keydown', function (event) {
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
