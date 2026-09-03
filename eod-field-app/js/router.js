/* Hash router: #/visit #/signoff #/signatures #/crew #/photos #/send #/helpdesk */
(function (global) {
  'use strict';

  const routes = new Map();
  const routeState = new Map();
  const completedRoutes = new Set();
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
    const from = current;
    if (from) {
      const focused = document.activeElement;
      const pane = document.getElementById('appMount');
      routeState.set(from, {
        x: global.scrollX || 0,
        y: global.scrollY || 0,
        mountY: pane ? pane.scrollTop : 0,
        focusId: focused?.id && pane?.contains(focused) ? focused.id : '',
      });
    }
    const session = global.EodSession;
    if (session && !session.isVisitReady() && name !== 'visit' && name !== 'storage') {
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
      const nav = el.getAttribute('data-nav');
      const on = nav === name
        || (nav === 'signoff' && (name === 'survey' || name === 'cover'))
        || (nav === 'dumpbin' && name === 'dumpbin')
        || (nav === 'more' && ['crew', 'dumpbin', 'helpdesk', 'photos', 'storage'].includes(name));
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    // Sidebar + chrome stay reachable once the shell is up (even on Visit).
    if (chrome) chrome.hidden = false;
    if (bottomNav) bottomNav.hidden = false;
    document.body.dataset.route = name;
    try { global.EodSectionNav?.append?.(name); } catch (_) {}
    try {
      await handler(mount, { route: name });
      try { global.EodSectionCollapse?.enhance?.(mount); } catch (_) {}
    } catch (err) {
      console.error(err);
      mount.innerHTML = `<div class="card error"><h2>Something went wrong</h2><p>${global.EodApi.escapeHtml(err.message || String(err))}</p></div>`;
    }
    session?.syncDomBridges();
    const saved = routeState.get(name);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      global.scrollTo?.(saved?.x || 0, saved?.y || 0);
      mount.scrollTop = saved?.mountY || 0;
      if (saved?.focusId) {
        document.getElementById(saved.focusId)?.focus?.({ preventScroll: true });
      } else {
        mount.focus?.({ preventScroll: true });
      }
    }));
    if (from !== name) {
      global.EodUsage?.track?.('route_navigation', { from: from || 'boot', to: name });
      global.EodA11y?.announce?.(`${name === 'signoff' ? 'Categories' : name} page`);
    }
    const stageId = name === 'signoff' || name === 'survey' ? 'categories' : name;
    const progress = global.EodWorkflowProgress?.derive?.(session, global.EodSendGates);
    const stage = progress?.stages?.find?.((item) => item.id === stageId);
    if (stage?.complete && !completedRoutes.has(stageId)) {
      completedRoutes.add(stageId);
      global.EodUsage?.track?.('route_completion', { route: stageId, status: 'complete' });
    }
  }

  function init() {
    window.addEventListener('hashchange', () => render());
    if (!location.hash) location.replace('#/visit');
    else render();
  }

  global.EodRouter = { register, go, render, init, get current() { return current; } };
})(typeof window !== 'undefined' ? window : globalThis);
