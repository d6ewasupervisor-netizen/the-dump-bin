/* Prev / next section navigation for primary routes. */
(function (global) {
  'use strict';

  const ORDER = [
    { id: 'visit', label: 'Visit' },
    { id: 'signoff', label: 'Signoff' },
    { id: 'crew', label: 'Crew' },
    { id: 'photos', label: 'Photos' },
    { id: 'send', label: 'Send' },
    { id: 'helpdesk', label: 'Helpdesk' },
  ];

  function indexOf(route) {
    const id = String(route || '').toLowerCase().split('?')[0];
    if (id === 'survey' || id === 'cover') return ORDER.findIndex((r) => r.id === 'signoff');
    return ORDER.findIndex((r) => r.id === id);
  }

  function neighbors(route) {
    const i = indexOf(route);
    if (i < 0) return { prev: null, next: null, current: null };
    return {
      prev: i > 0 ? ORDER[i - 1] : null,
      next: i < ORDER.length - 1 ? ORDER[i + 1] : null,
      current: ORDER[i],
    };
  }

  function append(mount, route) {
    if (!mount) return;
    const existing = mount.querySelector('.section-nav');
    if (existing) existing.remove();

    const { prev, next, current } = neighbors(route);
    if (!current) return;

    const wrap = document.createElement('div');
    wrap.className = 'card section-nav';
    wrap.innerHTML = `
      <div class="section-nav-row">
        <button type="button" class="btn btn-secondary" id="sectionNavPrev" ${prev ? '' : 'disabled'}>
          ${prev ? `← ${prev.label}` : '←'}
        </button>
        <span class="section-nav-current muted">${current.label}</span>
        <button type="button" class="btn btn-primary" id="sectionNavNext" ${next ? '' : 'disabled'}>
          ${next ? `${next.label} →` : '→'}
        </button>
      </div>`;
    mount.appendChild(wrap);

    const prevBtn = wrap.querySelector('#sectionNavPrev');
    const nextBtn = wrap.querySelector('#sectionNavNext');
    if (prev && prevBtn) {
      prevBtn.onclick = () => global.EodRouter.go(prev.id);
    }
    if (next && nextBtn) {
      nextBtn.onclick = () => global.EodRouter.go(next.id);
    }
  }

  global.EodSectionNav = { ORDER, neighbors, append };
})(typeof window !== 'undefined' ? window : globalThis);
