/* Confirm-date month grid. Kompass ISE days, today, and the overlap. */
(function (global) {
  'use strict';

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function isoOf(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) {
      const n = new Date();
      return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
    }
    return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  }

  function dayTone(iso, today, iseDates) {
    const set = iseDates instanceof Set ? iseDates : new Set(iseDates || []);
    const ise = set.has(iso);
    const isToday = iso === today;
    if (ise && isToday) return 'both';
    if (ise) return 'ise';
    if (isToday) return 'today';
    return '';
  }

  function monthCells(year, monthIndex) {
    const firstDow = new Date(year, monthIndex, 1).getDay();
    const count = new Date(year, monthIndex + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i += 1) cells.push(null);
    for (let day = 1; day <= count; day += 1) {
      cells.push({
        day,
        iso: `${year}-${pad(monthIndex + 1)}-${pad(day)}`,
      });
    }
    return cells;
  }

  function windowForMonth(year, monthIndex) {
    const start = new Date(year, monthIndex - 1, 1);
    const end = new Date(year, monthIndex + 2, 0);
    return { from: isoOf(start), to: isoOf(end) };
  }

  function longDate(iso) {
    const part = parseIso(iso);
    return `${MONTHS[part.m]} ${part.d}, ${part.y}`;
  }

  function dayAriaLabel(iso, tone) {
    const base = longDate(iso);
    if (tone === 'both') return `${base}. Kompass ISE. Today.`;
    if (tone === 'ise') return `${base}. Kompass ISE.`;
    if (tone === 'today') return `${base}. Today.`;
    return base;
  }

  function mount(root, opts) {
    if (!root) return null;
    const options = opts || {};
    const state = {
      cursor: parseIso(options.value || options.today),
      value: String(options.value || options.today || '').slice(0, 10),
      today: String(options.today || '').slice(0, 10),
      ise: new Set(),
      loadedKey: '',
      gen: 0,
    };
    root.classList.add('work-date-cal');
    root.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'work-date-cal-head';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'btn btn-secondary work-date-cal-nav';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', 'Previous month');
    const title = document.createElement('div');
    title.className = 'work-date-cal-title';
    title.setAttribute('aria-live', 'polite');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-secondary work-date-cal-nav';
    next.textContent = '›';
    next.setAttribute('aria-label', 'Next month');
    head.append(prev, title, next);

    const grid = document.createElement('div');
    grid.className = 'work-date-cal-grid';
    root.append(head, grid);

    function paint() {
      title.textContent = `${MONTHS[state.cursor.m]} ${state.cursor.y}`;
      grid.innerHTML = '';
      for (const label of DOW) {
        const el = document.createElement('div');
        el.className = 'work-date-cal-dow';
        el.textContent = label;
        grid.appendChild(el);
      }
      for (const cell of monthCells(state.cursor.y, state.cursor.m)) {
        if (!cell) {
          const padEl = document.createElement('span');
          padEl.className = 'work-date-cal-day is-pad';
          grid.appendChild(padEl);
          continue;
        }
        const tone = dayTone(cell.iso, state.today, state.ise);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'work-date-cal-day';
        if (tone) btn.classList.add(`is-${tone}`);
        if (cell.iso === state.value) {
          btn.classList.add('is-selected');
          btn.setAttribute('aria-pressed', 'true');
        } else {
          btn.setAttribute('aria-pressed', 'false');
        }
        btn.dataset.iso = cell.iso;
        btn.textContent = String(cell.day);
        btn.setAttribute('aria-label', dayAriaLabel(cell.iso, tone));
        btn.addEventListener('click', () => {
          state.value = cell.iso;
          paint();
          try { options.onChange?.(cell.iso); } catch (_) {}
        });
        grid.appendChild(btn);
      }
    }

    function shiftMonth(delta) {
      const d = new Date(state.cursor.y, state.cursor.m + delta, 1);
      state.cursor = { y: d.getFullYear(), m: d.getMonth(), d: 1 };
      paint();
      void ensureDates();
    }

    async function ensureDates() {
      const store = String(options.getStore?.() || '').trim();
      const win = windowForMonth(state.cursor.y, state.cursor.m);
      const key = `${store}|${win.from}|${win.to}`;
      if (!store) {
        state.ise = new Set();
        state.loadedKey = key;
        paint();
        return;
      }
      if (state.loadedKey === key) return;
      const gen = ++state.gen;
      try {
        const dates = await options.loadDates?.(store, win.from, win.to);
        if (gen !== state.gen || !root.isConnected) return;
        state.ise = new Set(dates || []);
        state.loadedKey = key;
      } catch (_) {
        if (gen !== state.gen || !root.isConnected) return;
      }
      paint();
    }

    prev.addEventListener('click', () => shiftMonth(-1));
    next.addEventListener('click', () => shiftMonth(1));
    paint();
    void ensureDates();

    return {
      setStore() {
        state.loadedKey = '';
        void ensureDates();
      },
      setValue(iso) {
        const nextIso = String(iso || '').slice(0, 10);
        if (!nextIso) return;
        state.value = nextIso;
        state.cursor = parseIso(nextIso);
        paint();
        void ensureDates();
      },
    };
  }

  const api = {
    dayTone,
    monthCells,
    windowForMonth,
    dayAriaLabel,
    longDate,
    mount,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.EodWorkDateCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
