(function () {
  'use strict';

  function init() {
    var meta = document.querySelector('meta[name="caf-app-version"]');
    var version = (meta && meta.getAttribute('content')) || '1.1';

    if (document.getElementById('cafVersionBadge')) return;

    var style = document.createElement('style');
    style.textContent = [
      '.caf-version-badge{',
      'position:fixed;top:12px;right:12px;z-index:100;',
      'display:inline-flex;align-items:center;gap:6px;',
      'font-size:11px;font-weight:700;letter-spacing:.04em;',
      'color:#00e87a;background:rgba(0,232,122,.12);',
      'border:1px solid rgba(0,232,122,.45);border-radius:999px;',
      'padding:4px 10px 4px 8px;white-space:nowrap;user-select:none;line-height:1.2;',
      'box-shadow:0 0 10px rgba(0,232,122,.35);',
      '}',
      '.caf-version-badge::before{',
      'content:"";width:7px;height:7px;border-radius:50%;flex:0 0 7px;',
      'background:#00e87a;box-shadow:0 0 6px #00e87a;',
      'animation:caf-version-pulse 2s ease-in-out infinite;',
      '}',
      '@keyframes caf-version-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
      '.caf-version-badge.caf-version-light{',
      'color:#067647;background:rgba(6,118,71,.08);',
      'border-color:rgba(6,118,71,.35);box-shadow:0 0 8px rgba(6,118,71,.2);',
      '}',
      '.caf-version-badge.caf-version-light::before{',
      'background:#067647;box-shadow:0 0 5px rgba(6,118,71,.65);',
      '}',
      '@media (max-width:640px){.caf-version-badge{top:8px;right:8px;font-size:10px;padding:3px 8px 3px 6px}}',
    ].join('');
    document.head.appendChild(style);

    var badge = document.createElement('span');
    badge.className = 'caf-version-badge' + (document.body.classList.contains('caf-sign') ? ' caf-version-light' : '');
    badge.id = 'cafVersionBadge';
    badge.title = 'CAF app version';
    badge.textContent = 'v' + version;
    document.body.appendChild(badge);

    var apiBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:3001'
      : 'https://eod-api.the-dump-bin.com';

    fetch(apiBase + '/api/caf/version', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.version) {
          badge.textContent = 'v' + data.version;
          if (meta) meta.setAttribute('content', data.version);
        }
      })
      .catch(function () { /* keep bundled/meta version */ });
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
