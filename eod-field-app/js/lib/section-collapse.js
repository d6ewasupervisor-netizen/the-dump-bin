/* Wrap page cards so leads can collapse sections and reach the bottom quickly. */
(function (global) {
  'use strict';

  function titleFor(card, i) {
    const h = card.querySelector('h1, h2, h3, .cat-head h1');
    const t = h ? String(h.textContent || '').trim() : '';
    return t || `Section ${i + 1}`;
  }

  function wrapCard(card, i) {
    if (!card || card.closest('details.eod-collapse')) return;
    const details = document.createElement('details');
    details.className = 'eod-collapse';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'eod-collapse-sum';
    summary.textContent = titleFor(card, i);
    const parent = card.parentNode;
    if (!parent) return;
    parent.insertBefore(details, card);
    details.appendChild(summary);
    details.appendChild(card);
  }

  function enhance(mount) {
    const host = mount && mount.nodeType ? mount : document.getElementById('appMount');
    if (!host) return;
    const cards = [...host.querySelectorAll(':scope > .card')];
    cards.forEach((card, i) => wrapCard(card, i));
    host.querySelectorAll('.visit-step-panel').forEach((panel, i) => {
      if (panel.closest('details.eod-collapse')) return;
      wrapCard(panel, cards.length + i);
    });
  }

  global.EodSectionCollapse = { enhance };
})(typeof window !== 'undefined' ? window : globalThis);
