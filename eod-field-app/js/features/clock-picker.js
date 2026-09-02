/**
 * Analog clock time picker — click to open, drag hour/minute hands.
 * Writes 12h display strings ("8:00 AM") by default for EOD punch fields.
 *
 * Usage:
 *   EodClockPicker.attach(inputEl, { format: 'display12' });
 *   EodClockPicker.enhance(rootEl, 'input[data-field]');
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'eodClockPickerStyles';
  const OVERLAY_ID = 'eodClockPickerOverlay';
  const SNAP_DEFAULT = 5;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function parseTime(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(/\u202f/g, ' ');
    if (!s) return null;

    let m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if (m) {
      let hour12 = Number(m[1]);
      const minute = Number(m[2]);
      const period = m[3].toUpperCase();
      if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
      return { hour12, minute, period };
    }

    m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) {
      let h = Number(m[1]);
      const minute = Number(m[2]);
      if (h < 0 || h > 23 || minute < 0 || minute > 59) return null;
      const period = h >= 12 ? 'PM' : 'AM';
      let hour12 = h % 12;
      if (hour12 === 0) hour12 = 12;
      return { hour12, minute, period };
    }

    return null;
  }

  function formatDisplay12(hour12, minute, period) {
    return `${Number(hour12)}:${pad2(minute)} ${period}`;
  }

  function format24(hour12, minute, period) {
    let h = Number(hour12) % 12;
    if (period === 'PM') h += 12;
    return `${pad2(h)}:${pad2(minute)}`;
  }

  function snapMinute(min, snap) {
    const s = Math.max(1, snap | 0);
    let n = Math.round(Number(min) / s) * s;
    if (n >= 60) n = 0;
    if (n < 0) n = 0;
    return n;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .eod-clock-wrap {
        display: flex; align-items: stretch; gap: 4px; width: 100%; min-width: 0;
      }
      .eod-clock-wrap > input {
        flex: 1; min-width: 0;
      }
      .eod-clock-btn {
        flex: 0 0 auto; width: var(--touch, 44px); min-width: var(--touch, 44px); padding: 0;
        border-radius: 6px; border: 1px solid var(--border, #475569); background: var(--row-bg, #1e293b);
        color: #fde68a; cursor: pointer; display: inline-flex;
        align-items: center; justify-content: center; line-height: 0;
      }
      .eod-clock-btn:hover, .eod-clock-btn:focus-visible {
        border-color: #fde68a; outline: none; box-shadow: 0 0 0 2px rgba(253,230,138,.25);
      }
      .eod-clock-btn svg { width: 20px; height: 20px; display: block; }
      #${OVERLAY_ID} {
        position: fixed; inset: 0; z-index: 12000;
        background: var(--scrim, rgba(2,6,23,.78));
        display: none; align-items: center; justify-content: center;
        padding: 16px; -webkit-tap-highlight-color: transparent;
      }
      #${OVERLAY_ID}.show { display: flex; }
      .eod-clock-sheet {
        width: min(360px, 100%); background: var(--surface, #0f172a); color: var(--text, #e2e8f0);
        border: 1px solid var(--border, #334155); border-radius: 16px; padding: 16px 16px 14px;
        box-shadow: 0 20px 50px rgba(0,0,0,.45);
      }
      .eod-clock-sheet h3 {
        margin: 0 0 4px; font-size: 1.05rem; color: #fde68a; font-weight: 700;
      }
      .eod-clock-sheet .eod-clock-hint {
        margin: 0 0 12px; font-size: 12px; color: var(--muted, #94a3b8); line-height: 1.35;
      }
      .eod-clock-readout {
        text-align: center; font-size: 1.75rem; font-weight: 700;
        font-variant-numeric: tabular-nums; letter-spacing: 0.02em;
        color: var(--text, #f8fafc); margin: 0 0 10px;
      }
      .eod-clock-face-wrap {
        position: relative; width: min(280px, 72vw); aspect-ratio: 1;
        margin: 0 auto 12px; touch-action: none; user-select: none;
      }
      .eod-clock-face-wrap svg { width: 100%; height: 100%; display: block; }
      .eod-clock-hand { cursor: grab; }
      .eod-clock-hand.is-dragging { cursor: grabbing; }
      .eod-clock-hand.is-active .eod-clock-hand-hit { stroke: rgba(253,230,138,.35); }
      .eod-clock-mode {
        display: flex; gap: 8px; justify-content: center; margin-bottom: 10px;
      }
      .eod-clock-mode button, .eod-clock-period button, .eod-clock-actions button {
        border: 1px solid var(--border, #475569); background: var(--row-bg, #1e293b); color: var(--text, #e2e8f0);
        border-radius: 8px; padding: 10px 14px; font-size: 14px; font-weight: 600;
        cursor: pointer; min-height: 44px;
      }
      .eod-clock-mode button.is-selected,
      .eod-clock-period button.is-selected {
        background: #fde68a; color: #0f172a; border-color: #fde68a;
      }
      .eod-clock-period {
        display: flex; gap: 8px; justify-content: center; margin-bottom: 12px;
      }
      .eod-clock-period button { flex: 1; max-width: 120px; }
      .eod-clock-actions {
        display: flex; gap: 8px;
      }
      .eod-clock-actions button { flex: 1; }
      .eod-clock-actions .eod-clock-done {
        background: #2F6FB0; border-color: #2F6FB0; color: #fff;
      }
      .eod-clock-actions .eod-clock-clear {
        background: transparent; color: #94a3b8;
      }
      /* Light theme for worker secure-share pages */
      .eod-clock-sheet.eod-clock-light {
        background: #fff; color: #0f172a; border-color: #e2e8f0;
      }
      .eod-clock-sheet.eod-clock-light h3 { color: #0E2A47; }
      .eod-clock-sheet.eod-clock-light .eod-clock-hint { color: #64748b; }
      .eod-clock-sheet.eod-clock-light .eod-clock-readout { color: #0f172a; }
      .eod-clock-sheet.eod-clock-light .eod-clock-mode button,
      .eod-clock-sheet.eod-clock-light .eod-clock-period button,
      .eod-clock-sheet.eod-clock-light .eod-clock-actions button {
        background: #f1f5f9; color: #0f172a; border-color: #cbd5e1;
      }
      .eod-clock-sheet.eod-clock-light .eod-clock-mode button.is-selected,
      .eod-clock-sheet.eod-clock-light .eod-clock-period button.is-selected {
        background: #2F6FB0; color: #fff; border-color: #2F6FB0;
      }
      .eod-clock-sheet.eod-clock-light .eod-clock-actions .eod-clock-done {
        background: #2F6FB0; border-color: #2F6FB0; color: #fff;
      }
      .eod-clock-btn.eod-clock-btn-light {
        background: #e2e8f0; border-color: #cbd5e1; color: #0E2A47;
      }
    `;
    document.head.appendChild(style);
  }

  function clockIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.75"/>
      <path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </svg>`;
  }

  function faceMarkup() {
    const ticks = [];
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 - 90) * Math.PI / 180;
      const major = i % 5 === 0;
      const r1 = major ? 88 : 92;
      const r2 = 96;
      const x1 = 100 + r1 * Math.cos(a);
      const y1 = 100 + r1 * Math.sin(a);
      const x2 = 100 + r2 * Math.cos(a);
      const y2 = 100 + r2 * Math.sin(a);
      ticks.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"
        stroke="${major ? '#94a3b8' : '#475569'}" stroke-width="${major ? 2.2 : 1}" stroke-linecap="round"/>`);
    }
    const nums = [];
    for (let h = 1; h <= 12; h++) {
      const a = (h * 30 - 90) * Math.PI / 180;
      const x = 100 + 72 * Math.cos(a);
      const y = 100 + 72 * Math.sin(a) + 4;
      nums.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"
        font-size="11" font-weight="700" fill="#cbd5e1" font-family="system-ui,sans-serif">${h}</text>`);
    }
    return `
      <svg viewBox="0 0 200 200" role="img" aria-label="Clock face">
        <circle cx="100" cy="100" r="98" fill="var(--surface, #111827)" stroke="var(--border, #334155)" stroke-width="2"/>
        <circle cx="100" cy="100" r="96" fill="var(--bg, #0b1220)"/>
        ${ticks.join('')}
        ${nums.join('')}
        <g class="eod-clock-hand eod-clock-hour" data-hand="hour">
          <line class="eod-clock-hand-hit" x1="100" y1="100" x2="100" y2="55"
            stroke="transparent" stroke-width="18" stroke-linecap="round"/>
          <line class="eod-clock-hand-vis" x1="100" y1="100" x2="100" y2="58"
            stroke="#93c5fd" stroke-width="5" stroke-linecap="round"/>
        </g>
        <g class="eod-clock-hand eod-clock-minute" data-hand="minute">
          <line class="eod-clock-hand-hit" x1="100" y1="100" x2="100" y2="28"
            stroke="transparent" stroke-width="16" stroke-linecap="round"/>
          <line class="eod-clock-hand-vis" x1="100" y1="100" x2="100" y2="30"
            stroke="#fde68a" stroke-width="3.5" stroke-linecap="round"/>
        </g>
        <circle cx="100" cy="100" r="5" fill="#f8fafc"/>
      </svg>`;
  }

  let activeState = null;

  function ensureOverlay() {
    ensureStyles();
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.innerHTML = `
      <div class="eod-clock-sheet" role="dialog" aria-modal="true" aria-labelledby="eodClockPickerTitle">
        <h3 id="eodClockPickerTitle">Set time</h3>
        <p class="eod-clock-hint">Drag the blue hour hand or yellow minute hand. Tap Hour / Minute to choose which drag adjusts.</p>
        <div class="eod-clock-readout" id="eodClockReadout">—</div>
        <div class="eod-clock-mode">
          <button type="button" data-mode="hour" class="is-selected">Hour</button>
          <button type="button" data-mode="minute">Minute</button>
        </div>
        <div class="eod-clock-face-wrap" id="eodClockFace">${faceMarkup()}</div>
        <div class="eod-clock-period">
          <button type="button" data-period="AM">AM</button>
          <button type="button" data-period="PM">PM</button>
        </div>
        <div class="eod-clock-actions">
          <button type="button" class="eod-clock-clear" id="eodClockClear">Clear</button>
          <button type="button" class="eod-clock-clear" id="eodClockCancel">Cancel</button>
          <button type="button" class="eod-clock-done" id="eodClockDone">Done</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => {
      if (e.target === el) close(false);
    });
    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!activeState) return;
        activeState.mode = btn.dataset.mode;
        syncUi();
      });
    });
    el.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!activeState) return;
        activeState.period = btn.dataset.period;
        syncUi();
      });
    });
    el.querySelector('#eodClockDone').onclick = () => close(true);
    el.querySelector('#eodClockCancel').onclick = () => close(false);
    el.querySelector('#eodClockClear').onclick = () => {
      if (!activeState) return;
      activeState.cleared = true;
      close(true);
    };

    wireFaceDrag(el.querySelector('#eodClockFace'));
    return el;
  }

  function angleFromEvent(faceEl, e) {
    const rect = faceEl.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = t.clientX - cx;
    const dy = t.clientY - cy;
    let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if (deg < 0) deg += 360;
    return { deg, dist: Math.sqrt(dx * dx + dy * dy), radius: rect.width / 2 };
  }

  function applyAngleToState(deg) {
    if (!activeState) return;
    if (activeState.mode === 'hour') {
      // 30° per hour; allow half-hour feel via minutes coupling only when minute≈0
      let hour = Math.round(deg / 30);
      if (hour === 0) hour = 12;
      if (hour > 12) hour = 12;
      activeState.hour12 = hour;
    } else {
      let minute = Math.round(deg / 6);
      if (minute === 60) minute = 0;
      activeState.minute = snapMinute(minute, activeState.snapMinutes);
    }
  }

  function pickModeFromPoint(deg, dist, radius) {
    if (!activeState) return;
    // Prefer nearest hand tip; fall back to ring distance
    const hourAngle = ((activeState.hour12 % 12) + activeState.minute / 60) * 30;
    const minuteAngle = activeState.minute * 6;
    const hourDist = angularDistance(deg, hourAngle);
    const minuteDist = angularDistance(deg, minuteAngle);
    if (dist < radius * 0.55) {
      activeState.mode = 'hour';
      return;
    }
    if (dist > radius * 0.72) {
      activeState.mode = 'minute';
      return;
    }
    activeState.mode = hourDist <= minuteDist ? 'hour' : 'minute';
  }

  function angularDistance(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function wireFaceDrag(faceEl) {
    let dragging = false;
    let activePointerId = null;

    function onStart(e) {
      if (!activeState) return;
      dragging = true;
      if (e.pointerId != null && faceEl.setPointerCapture) {
        activePointerId = e.pointerId;
        try { faceEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      const info = angleFromEvent(faceEl, e);
      pickModeFromPoint(info.deg, info.dist, info.radius);
      applyAngleToState(info.deg);
      syncUi();
      faceEl.querySelectorAll('.eod-clock-hand').forEach((g) => {
        g.classList.toggle('is-dragging', g.dataset.hand === activeState.mode);
      });
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging || !activeState) return;
      if (activePointerId != null && e.pointerId != null && e.pointerId !== activePointerId) return;
      const info = angleFromEvent(faceEl, e);
      applyAngleToState(info.deg);
      syncUi();
      e.preventDefault();
    }
    function onEnd(e) {
      if (activePointerId != null && e && e.pointerId != null && e.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
      faceEl.querySelectorAll('.eod-clock-hand').forEach((g) => g.classList.remove('is-dragging'));
    }

    if (typeof window !== 'undefined' && window.PointerEvent) {
      faceEl.addEventListener('pointerdown', onStart);
      faceEl.addEventListener('pointermove', onMove);
      faceEl.addEventListener('pointerup', onEnd);
      faceEl.addEventListener('pointercancel', onEnd);
    } else {
      faceEl.addEventListener('mousedown', onStart);
      faceEl.addEventListener('mousemove', onMove);
      faceEl.addEventListener('mouseup', onEnd);
      faceEl.addEventListener('touchstart', onStart, { passive: false });
      faceEl.addEventListener('touchmove', onMove, { passive: false });
      faceEl.addEventListener('touchend', onEnd);
      faceEl.addEventListener('touchcancel', onEnd);
    }
  }

  function syncUi() {
    if (!activeState) return;
    const overlay = ensureOverlay();
    const sheet = overlay.querySelector('.eod-clock-sheet');
    sheet.classList.toggle('eod-clock-light', !!activeState.light);

    const readout = overlay.querySelector('#eodClockReadout');
    readout.textContent = formatDisplay12(activeState.hour12, activeState.minute, activeState.period);

    overlay.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('is-selected', btn.dataset.mode === activeState.mode);
    });
    overlay.querySelectorAll('[data-period]').forEach((btn) => {
      btn.classList.toggle('is-selected', btn.dataset.period === activeState.period);
    });

    const hourDeg = ((activeState.hour12 % 12) + activeState.minute / 60) * 30;
    const minuteDeg = activeState.minute * 6;
    const hourG = overlay.querySelector('.eod-clock-hour');
    const minuteG = overlay.querySelector('.eod-clock-minute');
    if (hourG) {
      hourG.setAttribute('transform', `rotate(${hourDeg} 100 100)`);
      hourG.classList.toggle('is-active', activeState.mode === 'hour');
    }
    if (minuteG) {
      minuteG.setAttribute('transform', `rotate(${minuteDeg} 100 100)`);
      minuteG.classList.toggle('is-active', activeState.mode === 'minute');
    }

    const title = overlay.querySelector('#eodClockPickerTitle');
    if (title && activeState.label) title.textContent = activeState.label;
  }

  function open(input, options) {
    ensureStyles();
    const opts = options || {};
    const parsed = parseTime(input.value) || { hour12: 8, minute: 0, period: 'AM' };
    activeState = {
      input,
      hour12: parsed.hour12,
      minute: snapMinute(parsed.minute, opts.snapMinutes ?? SNAP_DEFAULT),
      period: parsed.period,
      mode: 'hour',
      snapMinutes: opts.snapMinutes ?? SNAP_DEFAULT,
      format: opts.format || 'display12',
      light: !!opts.light,
      label: opts.label || input.getAttribute('aria-label') || 'Set time',
      cleared: false,
      onApply: opts.onApply || null,
    };
    const overlay = ensureOverlay();
    overlay.classList.add('show');
    syncUi();
  }

  function close(apply) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.classList.remove('show');
    if (!activeState) return;
    const st = activeState;
    activeState = null;
    if (!apply) return;

    let value = '';
    if (!st.cleared) {
      value = st.format === 'hhmm24'
        ? format24(st.hour12, st.minute, st.period)
        : formatDisplay12(st.hour12, st.minute, st.period);
    }
    st.input.value = value;
    st.input.dispatchEvent(new Event('input', { bubbles: true }));
    st.input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof st.onApply === 'function') st.onApply(value, st.input);
  }

  function attach(input, options) {
    if (!input || input.dataset.eodClockAttached === '1') return;
    input.dataset.eodClockAttached = '1';
    ensureStyles();

    const opts = Object.assign({ format: 'display12', snapMinutes: SNAP_DEFAULT }, options || {});
    const wrap = document.createElement('div');
    wrap.className = 'eod-clock-wrap';
    const parent = input.parentNode;
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eod-clock-btn' + (opts.light ? ' eod-clock-btn-light' : '');
    btn.title = 'Open clock';
    btn.setAttribute('aria-label', `Open clock for ${input.getAttribute('aria-label') || 'time'}`);
    btn.innerHTML = clockIconSvg();
    wrap.appendChild(btn);

    const openPicker = (e) => {
      if (e) e.preventDefault();
      open(input, opts);
    };
    btn.addEventListener('click', openPicker);

    // Double-click / double-tap field also opens the clock (typing still works).
    input.addEventListener('dblclick', openPicker);

    return { open: () => open(input, opts), wrap, btn };
  }

  function enhance(root, selector, options) {
    const scope = root || document;
    const sel = selector || 'input[data-eod-clock], input[data-field="clockIn"], input[data-field="lunchOut"], input[data-field="lunchIn"], input[data-field="clockOut"]';
    const nodes = scope.querySelectorAll(sel);
    nodes.forEach((el) => attach(el, options));
    return nodes.length;
  }

  const api = {
    attach,
    enhance,
    open,
    parseTime,
    formatDisplay12,
  };
  global.EodClockPicker = api;
  global.ClockPicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
