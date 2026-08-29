/* Named prev / next + return-to-top at the bottom of every section. */
(function (global) {
  'use strict';

  const ORDER = [
    { id: 'visit', label: 'Visit' },
    { id: 'signoff', label: 'Categories' },
    { id: 'signatures', label: 'Signatures' },
    { id: 'send', label: 'Send' },
    { id: 'crew', label: 'Crew' },
    { id: 'dumpbin', label: 'Dump Bin' },
    { id: 'helpdesk', label: 'Helpdesk' },
  ];

  const SUB = {
    cover: { parent: 'visit', label: 'Cover' },
    survey: { parent: 'signoff', label: 'Survey' },
  };

  function routeId(route) {
    return String(route || '').toLowerCase().split('?')[0];
  }

  function indexOf(route) {
    const id = routeId(route);
    const sub = SUB[id];
    if (sub) return ORDER.findIndex((r) => r.id === sub.parent);
    return ORDER.findIndex((r) => r.id === id);
  }

  function neighbors(route) {
    const id = routeId(route);
    const sub = SUB[id];
    const i = indexOf(id);
    if (sub) {
      const parent = ORDER[i] || { id: sub.parent, label: sub.label };
      return {
        prev: parent,
        next: i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null,
        current: { id, label: sub.label },
      };
    }
    if (i < 0) return { prev: null, next: null, current: { id: id || 'page', label: '' } };
    return {
      prev: i > 0 ? ORDER[i - 1] : null,
      next: i < ORDER.length - 1 ? ORDER[i + 1] : null,
      current: ORDER[i],
    };
  }

  function scrollToTop() {
    const mount = document.getElementById('appMount');
    if (mount) {
      try { mount.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { mount.scrollTop = 0; }
    }
    const topEl = document.querySelector('.pilot-banner')
      || document.getElementById('appChrome')
      || document.querySelector('.app-shell');
    try {
      if (topEl) topEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (_) {}
    try { window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); } catch (_) {}
    const shell = document.querySelector('.app-shell');
    if (shell && shell.scrollTop) {
      try { shell.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { shell.scrollTop = 0; }
    }
  }

  function hostEl() {
    return document.getElementById('sectionNavHost');
  }

  function append(mountOrRoute, maybeRoute) {
    const route = typeof mountOrRoute === 'string' ? mountOrRoute : maybeRoute;
    const host = hostEl() || (mountOrRoute && mountOrRoute.nodeType ? mountOrRoute : null);
    if (!host) return;

    const existing = host.querySelector('.section-nav');
    if (existing) existing.remove();

    const { prev, next } = neighbors(route);

    const wrap = document.createElement('div');
    wrap.className = 'card section-nav';
    wrap.innerHTML = `
      <div class="section-nav-row">
        <button type="button" class="btn btn-secondary section-nav-side" id="sectionNavPrev" ${prev ? '' : 'disabled'}>
          <span class="section-nav-dir" aria-hidden="true">←</span>
          <span class="section-nav-name">${prev ? prev.label : ''}</span>
        </button>
        <button type="button" class="section-nav-top" id="sectionNavTop" aria-label="Top">
          <span class="section-nav-top-arrow" aria-hidden="true">↑</span>
          <span class="section-nav-top-label">Top</span>
        </button>
        <button type="button" class="btn btn-primary section-nav-side" id="sectionNavNext" ${next ? '' : 'disabled'}>
          <span class="section-nav-name">${next ? next.label : ''}</span>
          <span class="section-nav-dir" aria-hidden="true">→</span>
        </button>
      </div>`;
    host.appendChild(wrap);

    const prevBtn = wrap.querySelector('#sectionNavPrev');
    const nextBtn = wrap.querySelector('#sectionNavNext');
    const topBtn = wrap.querySelector('#sectionNavTop');
    if (prev && prevBtn) prevBtn.onclick = () => global.EodRouter.go(prev.id);
    if (next && nextBtn) nextBtn.onclick = () => global.EodRouter.go(next.id);
    if (topBtn) topBtn.onclick = () => scrollToTop();
  }

  global.EodSectionNav = { ORDER, neighbors, append, scrollToTop };
})(typeof window !== 'undefined' ? window : globalThis);
