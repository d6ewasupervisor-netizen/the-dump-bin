/* Display themes: dark / inverse / light / gray / gray-matter / holiday / blackout. */
(function (global) {
  'use strict';

  const KEY = 'eodFieldTheme';
  const THEMES = ['dark', 'inverse', 'light', 'gray', 'gray-matter', 'holiday', 'blackout'];
  const CURRENT_LABEL = {
    dark: 'Dark',
    inverse: 'Inverse',
    light: 'Light',
    gray: 'Gray',
    'gray-matter': 'Matter',
    holiday: 'Holiday',
    blackout: 'Night',
  };
  const META = {
    dark: '#0b1220',
    inverse: '#000000',
    light: '#0f5c8c',
    gray: '#2a3038',
    'gray-matter': '#12151a',
    holiday: '#ff7a18',
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
      btn.textContent = CURRENT_LABEL[t] || 'Theme';
      btn.title = `Theme: ${CURRENT_LABEL[t] || t} — tap to cycle`;
      btn.setAttribute('aria-label', `Cycle theme, currently ${CURRENT_LABEL[t] || t}`);
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

  global.EodTheme = { THEMES, KEY, CURRENT_LABEL, getTheme, applyTheme, cycle, init };
})(typeof window !== 'undefined' ? window : globalThis);
