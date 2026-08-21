/* Hash router: #/visit #/signoff #/crew #/photos #/send #/helpdesk */
(function (global) {
  'use strict';

  const routes = new Map();
  let current = null;

  function normalize(hash) {
    let h = String(hash || '').replace(/^#\/?/, '').split('?')[0];
    if (!h) h = 'signoff';
    return h.toLowerCase();
  }

  function register(name, handler) {
    routes.set(name, handler);
  }

  function go(name, opts) {
    const target = normalize(name);
    if ((opts || {}).replace) {
      location.replace(`#/${target}`);
    } else {
      location.hash = `#/${target}`;
    }
  }

  async function render() {
    let name = normalize(location.hash);
    const session = global.EodSession;
    if (session && !session.isVisitReady() && name !== 'visit') {
      name = 'visit';
      if (normalize(location.hash) !== 'visit') {
        location.replace('#/visit');
        return;
      }
    }
    if (session && session.isVisitReady() && name === 'visit' && (session.state.selectedShift || session.state.shifts.length)) {
      // Allow revisiting visit setup after ready.
    }
    const handler = routes.get(name) || routes.get('signoff');
    const mount = document.getElementById('appMount');
    const chrome = document.getElementById('appChrome');
    const bottomNav = document.getElementById('bottomNav');
    if (!mount || !handler) return;
    current = name;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-nav') === name);
    });
    // Sidebar + chrome stay reachable once the shell is up (even on Visit).
    if (chrome) chrome.hidden = false;
    if (bottomNav) bottomNav.hidden = false;
    document.body.dataset.route = name;
    try {
      await handler(mount, { route: name });
    } catch (err) {
      console.error(err);
      mount.innerHTML = `<div class="card error"><h2>Something went wrong</h2><p>${global.EodApi.escapeHtml(err.message || String(err))}</p></div>`;
    }
    try { global.EodSectionNav?.append?.(mount, name); } catch (_) {}
    session?.syncDomBridges();
  }

  function init() {
    window.addEventListener('hashchange', () => render());
    if (!location.hash) location.replace('#/visit');
    else render();
  }

  global.EodRouter = { register, go, render, init, get current() { return current; } };
})(typeof window !== 'undefined' ? window : globalThis);
