/**
 * Route PDF navigations on the-dump-bin.com through /pdf/ instead of the
 * browser's native viewer. Safe inside iframes (does not window.open).
 *
 * Skip with data-native-pdf on the link, or ?raw=1 / download=1 on the URL.
 */
(function (global) {
  'use strict';

  var VIEWER = '/pdf/';

  function isPdfHref(href) {
    if (!href) return false;
    try {
      var u = new URL(href, global.location.href);
      if (u.searchParams.get('raw') === '1' || u.searchParams.get('download') === '1') return false;
      if (/\.pdf$/i.test(u.pathname)) return true;
      if (/\/api\/download(?:\?|$)/i.test(u.pathname + u.search) && !/\/pdf\//i.test(u.pathname)) {
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function viewerUrl(href, name) {
    var u = new URL(VIEWER, global.location.origin);
    u.searchParams.set('file', href);
    if (name) u.searchParams.set('name', name);
    return u.toString();
  }

  function shouldIntercept(a) {
    if (!a || a.getAttribute('data-native-pdf') != null) return false;
    if (a.getAttribute('download') != null) return false;
    return isPdfHref(a.href);
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!shouldIntercept(a)) return;
    e.preventDefault();
    var name = (a.getAttribute('download') || a.textContent || '').trim();
    var dest = viewerUrl(a.href, /\.pdf$/i.test(name) ? name : '');
    if (a.target === '_blank') {
      global.open(dest, '_blank', 'noopener');
    } else {
      global.location.assign(dest);
    }
  }, true);

  global.DumpBinPdfIntercept = { isPdfHref: isPdfHref, viewerUrl: viewerUrl };
})(typeof window !== 'undefined' ? window : globalThis);
