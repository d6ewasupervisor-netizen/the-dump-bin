/* Display themes: dark / inverse / light / gray / gray-matter / holiday / blackout. */
(function (global) {
  'use strict';

  const KEY = 'eodFieldTheme';
  const THEMES = ['dark', 'inverse', 'light', 'gray', 'gray-matter', 'holiday', 'blackout'];
  const NEXT_LABEL = {
    dark: 'Inverse',
    inverse: 'Light',
    light: 'Gray',
    gray: 'Gray Matter',
    'gray-matter': 'Holiday',
    holiday: 'Blackout',
    blackout: 'Dark',
  };
  const META = {
    dark: '#0b1220',
    inverse: '#062033',
    light: '#0f5c8c',
    gray: '#4b5563',
    'gray-matter': '#1A1C1F',
    holiday: '#7f1d1d',
    blackout: '#000000',
  };

  function getTheme() {
    try {
      const t = localStorage.getItem(KEY);
      if (THEMES.includes(t)) return t;
    } catch (_) {}
    return 'dark';
  }

  function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch (_) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = META[t] || META.dark;
    const btn = document.getElementById('themeCycleBtn');
    if (btn) {
      btn.textContent = NEXT_LABEL[t] || 'Theme';
      btn.title = `Theme: ${t} — tap to cycle`;
      btn.setAttribute('aria-label', `Cycle theme, currently ${t}`);
    }
  }

  function cycle() {
    const i = THEMES.indexOf(getTheme());
    applyTheme(THEMES[(i + 1) % THEMES.length]);
  }

  function init() {
    applyTheme(getTheme());
    const btn = document.getElementById('themeCycleBtn');
    if (btn && btn.dataset.bound !== '1') {
      btn.dataset.bound = '1';
      btn.addEventListener('click', cycle);
    }
  }

  global.EodTheme = { THEMES, KEY, getTheme, applyTheme, cycle, init };
})(typeof window !== 'undefined' ? window : globalThis);
