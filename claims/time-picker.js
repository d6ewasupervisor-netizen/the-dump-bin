(function () {
  'use strict';

  const SNAP_MINUTES = 15;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function snapMinute(raw) {
    const n = Math.max(0, Math.min(59, parseInt(raw, 10) || 0));
    const snapped = Math.round(n / SNAP_MINUTES) * SNAP_MINUTES;
    return snapped === 60 ? 0 : snapped;
  }

  function parse24(value) {
    if (!value || typeof value !== 'string') return null;
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return { hour12: h12, minute: min, period };
  }

  function format24(hour12, minute, period) {
    let h = hour12 % 12;
    if (period === 'PM') h += 12;
    return pad2(h) + ':' + pad2(minute);
  }

  function buildWidget(originalInput) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ro-time-picker';
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-labelledby', originalInput.id ? originalInput.id + '-label' : '');

    const hourInput = document.createElement('input');
    hourInput.type = 'text';
    hourInput.inputMode = 'numeric';
    hourInput.maxLength = 2;
    hourInput.placeholder = 'HH';
    hourInput.className = 'ro-time-field ro-time-hour';
    hourInput.setAttribute('aria-label', 'Hour');

    const colon = document.createElement('span');
    colon.className = 'ro-time-colon';
    colon.textContent = ':';
    colon.setAttribute('aria-hidden', 'true');

    const minuteInput = document.createElement('input');
    minuteInput.type = 'text';
    minuteInput.inputMode = 'numeric';
    minuteInput.maxLength = 2;
    minuteInput.placeholder = 'MM';
    minuteInput.className = 'ro-time-field ro-time-minute';
    minuteInput.setAttribute('aria-label', 'Minute');

    const periodGroup = document.createElement('div');
    periodGroup.className = 'ro-time-period';
    periodGroup.setAttribute('role', 'radiogroup');
    periodGroup.setAttribute('aria-label', 'AM or PM');

    const amBtn = document.createElement('button');
    amBtn.type = 'button';
    amBtn.className = 'ro-time-period-btn';
    amBtn.dataset.period = 'AM';
    amBtn.textContent = 'AM';
    amBtn.setAttribute('role', 'radio');
    amBtn.setAttribute('aria-checked', 'false');

    const pmBtn = document.createElement('button');
    pmBtn.type = 'button';
    pmBtn.className = 'ro-time-period-btn';
    pmBtn.dataset.period = 'PM';
    pmBtn.textContent = 'PM';
    pmBtn.setAttribute('role', 'radio');
    pmBtn.setAttribute('aria-checked', 'false');

    periodGroup.appendChild(amBtn);
    periodGroup.appendChild(pmBtn);

    wrapper.appendChild(hourInput);
    wrapper.appendChild(colon);
    wrapper.appendChild(minuteInput);
    wrapper.appendChild(periodGroup);

    return { wrapper, hourInput, minuteInput, amBtn, pmBtn, periodGroup };
  }

  function setPeriod(state, period) {
    state.period = period;
    state.amBtn.classList.toggle('is-selected', period === 'AM');
    state.pmBtn.classList.toggle('is-selected', period === 'PM');
    state.amBtn.setAttribute('aria-checked', period === 'AM' ? 'true' : 'false');
    state.pmBtn.setAttribute('aria-checked', period === 'PM' ? 'true' : 'false');
  }

  function syncHidden(state, originalInput) {
    const h = parseInt(state.hourInput.value, 10);
    const m = parseInt(state.minuteInput.value, 10);
    if (!state.period || isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) {
      originalInput.value = '';
      return;
    }
    originalInput.value = format24(h, m, state.period);
  }

  function selectAllOnFocus(input) {
    input.addEventListener('focus', function () {
      setTimeout(function () { input.select(); }, 0);
    });
  }

  function attach(originalInput) {
    if (originalInput.dataset.timePickerAttached === '1') return;
    originalInput.dataset.timePickerAttached = '1';

    const built = buildWidget(originalInput);
    const state = Object.assign({ period: null }, built);

    originalInput.type = 'hidden';
    originalInput.parentNode.insertBefore(built.wrapper, originalInput);

    if (originalInput.value) {
      const parsed = parse24(originalInput.value);
      if (parsed) {
        built.hourInput.value = String(parsed.hour12);
        built.minuteInput.value = pad2(parsed.minute);
        setPeriod(state, parsed.period);
      }
    }

    selectAllOnFocus(built.hourInput);
    selectAllOnFocus(built.minuteInput);

    built.hourInput.addEventListener('input', function () {
      built.hourInput.value = built.hourInput.value.replace(/\D/g, '').slice(0, 2);
      if (built.hourInput.value.length === 2) {
        built.minuteInput.focus();
      }
      syncHidden(state, originalInput);
    });

    built.hourInput.addEventListener('keydown', function (e) {
      if (e.key === ':' || e.key === ' ') {
        e.preventDefault();
        built.minuteInput.focus();
      }
    });

    built.hourInput.addEventListener('blur', function () {
      const n = parseInt(built.hourInput.value, 10);
      if (!isNaN(n) && n >= 1 && n <= 12) {
        built.hourInput.value = String(n);
      } else if (built.hourInput.value !== '') {
        built.hourInput.value = '';
      }
      syncHidden(state, originalInput);
    });

    built.minuteInput.addEventListener('input', function () {
      built.minuteInput.value = built.minuteInput.value.replace(/\D/g, '').slice(0, 2);
      syncHidden(state, originalInput);
    });

    built.minuteInput.addEventListener('blur', function () {
      if (built.minuteInput.value === '') {
        syncHidden(state, originalInput);
        return;
      }
      const snapped = snapMinute(built.minuteInput.value);
      built.minuteInput.value = pad2(snapped);
      syncHidden(state, originalInput);
    });

    function pickPeriod(period) {
      setPeriod(state, period);
      syncHidden(state, originalInput);
    }

    built.amBtn.addEventListener('click', function () { pickPeriod('AM'); });
    built.pmBtn.addEventListener('click', function () { pickPeriod('PM'); });

    const form = originalInput.form;
    if (form && originalInput.required) {
      form.addEventListener('submit', function (e) {
        if (!originalInput.value) {
          e.preventDefault();
          e.stopImmediatePropagation();
          built.wrapper.classList.add('ro-time-invalid');
          built.hourInput.focus();
        } else {
          built.wrapper.classList.remove('ro-time-invalid');
        }
      }, true);
    }
  }

  function init() {
    const inputs = document.querySelectorAll('input[type="time"]');
    inputs.forEach(attach);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
