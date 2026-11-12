/* Nav + on-page TOC for the EOD field-app guide. */
(function () {
  'use strict';

  const NAV = [
    { href: 'index.html', label: 'Home' },
    { href: 'field-guide.html', label: 'Field app instructions' },
    { href: '00-daily-routine.html', label: '0 — Daily routine' },
    { href: '01-quick-start.html', label: '1 — Quick start' },
    { href: '02-morning-setup.html', label: '2 — Store and shifts' },
    { href: '03-during-the-day.html', label: '3 — Categories and sets' },
    { href: '04-closing-out.html', label: '4 — Signatures, crew, and send' },
    { href: '05-smart-features.html', label: '5 — Smart features' },
    { href: '06-troubleshooting.html', label: '6 — Troubleshooting' },
  ];

  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // A standalone page is published without the chapters, so its menu is its own sections.
  function navItems() {
    if (!document.body.hasAttribute('data-ro-single')) return NAV;
    return [...document.querySelectorAll('[data-ro-body] h2[id]')]
      .map((h) => ({ href: `#${h.id}`, label: h.textContent }));
  }

  function buildNav() {
    const nav = document.querySelector('[data-ro-nav]');
    if (!nav) return;
    const ul = document.createElement('ul');
    ul.style.cssText = 'list-style:none;margin:0;padding:0.75rem;';
    navItems().forEach((item) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (item.href.startsWith('#')) {
        a.addEventListener('click', () => {
          nav.removeAttribute('data-open');
          document.querySelector('[data-ro-backdrop]')?.removeAttribute('data-open');
          document.querySelector('[data-ro-navtoggle]')?.setAttribute('aria-expanded', 'false');
        });
      }
      a.style.cssText = 'display:block;padding:0.65rem 0.75rem;border-left:3px solid transparent;color:inherit;text-decoration:none;border-radius:0 6px 6px 0;';
      if (item.href.toLowerCase() === page || (page === '' && item.href === 'index.html')) {
        a.setAttribute('aria-current', 'page');
        a.style.borderLeftColor = 'var(--ro-sky)';
        a.style.background = 'var(--ro-wash)';
        a.style.fontWeight = '600';
      }
      li.appendChild(a);
      ul.appendChild(li);
    });
    nav.appendChild(ul);
  }

  function wireChrome() {
    const nav = document.querySelector('[data-ro-nav]');
    const backdrop = document.querySelector('[data-ro-backdrop]');
    const toggle = document.querySelector('[data-ro-navtoggle]');
    const searchToggle = document.querySelector('[data-ro-searchtoggle]');
    const searchPanel = document.querySelector('[data-ro-searchpanel]');

    function setNavOpen(open) {
      if (nav) {
        if (open) nav.setAttribute('data-open', 'true');
        else nav.removeAttribute('data-open');
      }
      if (backdrop) {
        if (open) backdrop.setAttribute('data-open', 'true');
        else backdrop.removeAttribute('data-open');
      }
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeNav() {
      setNavOpen(false);
    }

    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        setNavOpen(nav.getAttribute('data-open') !== 'true');
      });
    }
    if (backdrop) backdrop.addEventListener('click', closeNav);

    if (searchToggle && searchPanel) {
      searchToggle.addEventListener('click', () => {
        const hidden = searchPanel.hasAttribute('hidden');
        if (hidden) searchPanel.removeAttribute('hidden');
        else searchPanel.setAttribute('hidden', '');
        searchToggle.setAttribute('aria-expanded', hidden ? 'true' : 'false');
        if (hidden) searchPanel.querySelector('input')?.focus();
      });
    }

    const input = document.querySelector('[data-ro-searchinput]');
    const results = document.querySelector('[data-ro-searchresults]');
    const count = document.querySelector('[data-ro-searchcount]');
    if (input && results) {
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        results.innerHTML = '';
        if (!q) {
          if (count) count.textContent = '';
          return;
        }
        const hits = [];
        document.querySelectorAll('[data-ro-body] h2, [data-ro-body] h3, [data-ro-body] p, [data-ro-body] li').forEach((el) => {
          const text = el.textContent || '';
          if (text.toLowerCase().includes(q) && hits.length < 20) {
            hits.push({ text: text.slice(0, 120), id: el.id || null });
          }
        });
        if (count) count.textContent = hits.length ? `${hits.length} on this page` : 'No matches on this page';
        hits.forEach((h) => {
          const li = document.createElement('li');
          if (h.id) {
            const a = document.createElement('a');
            a.href = `#${h.id}`;
            a.textContent = h.text;
            a.addEventListener('click', closeNav);
            li.appendChild(a);
          } else {
            li.textContent = h.text;
          }
          results.appendChild(li);
        });
      });
    }
  }

  function buildToc() {
    const toc = document.querySelector('[data-ro-toc]');
    if (!toc) return;
    const heads = document.querySelectorAll('[data-ro-body] h2[id], [data-ro-body] h3[id]');
    if (!heads.length) {
      toc.hidden = true;
      return;
    }
    const summary = document.createElement('summary');
    summary.textContent = 'On this page';
    const ol = document.createElement('ol');
    heads.forEach((h) => {
      const li = document.createElement('li');
      li.dataset.level = h.tagName === 'H3' ? '3' : '2';
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent;
      li.appendChild(a);
      ol.appendChild(li);
    });
    toc.appendChild(summary);
    toc.appendChild(ol);
  }

  function buildFooter() {
    const shell = document.querySelector('.ro-shell');
    if (!shell || shell.querySelector('[data-ro-footer]')) return;
    const footer = document.createElement('footer');
    footer.className = 'ro-footer';
    footer.setAttribute('data-ro-footer', '');
    footer.textContent = 'Retail Odyssey';
    shell.appendChild(footer);
  }

  buildNav();
  wireChrome();
  buildToc();
  buildFooter();
})();
