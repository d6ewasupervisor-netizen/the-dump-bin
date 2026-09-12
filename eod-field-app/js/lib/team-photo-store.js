/* Pure helpers for the Railway team photo store (not the PIC gallery). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EodTeamPhotoStoreLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KINDS = ['before', 'after', 'signoff', 'instawork'];
  const API_ORIGIN = 'https://eod-api.the-dump-bin.com';

  function normalizeKind(raw, slot) {
    const k = String(raw || '').toLowerCase();
    const s = String(slot || '').toLowerCase();
    if (k === 'cart-after' || (k === 'cart' && s === 'after') || (!k && s === 'after')) return 'after';
    if (k === 'cart' || k === 'cart-before' || k === 'before' || (!k && s === 'before')) return 'before';
    const resolved = k || s;
    return KINDS.includes(resolved) ? resolved : '';
  }

  function photoIdFor(entry, kind, index) {
    const existing = String(entry?.teamPhotoId || entry?.photoId || entry?.id || '').trim();
    if (existing && !/^data:|^blob:/i.test(existing)) return existing.slice(0, 80);
    return `${kind}-${Number(index) + 1}`;
  }

  function localDataUrl(entry) {
    if (!entry || typeof entry !== 'object') {
      return /^data:image\//i.test(String(entry || '')) ? String(entry) : '';
    }
    const keys = ['dataUrl', 'photoBase64', 'preview'];
    for (const key of keys) {
      const v = String(entry[key] || '');
      if (/^data:image\//i.test(v)) return v;
    }
    return '';
  }

  function applyPointer(entry, pointer) {
    const next = entry && typeof entry === 'object' ? { ...entry } : {};
    if (!pointer?.url) return next;
    next.teamUrl = pointer.url;
    next.thumbUrl = pointer.thumbUrl || pointer.url;
    next.teamPhotoId = pointer.photoId || next.teamPhotoId;
    next.kind = pointer.kind || next.kind;
    next.offloaded = true;
    delete next.dataUrl;
    delete next.photoBase64;
    const live = String(next.previewUrl || next.preview || next.objectUrl || '');
    if (!/^blob:/i.test(live) && !/^data:image\//i.test(live)) {
      delete next.preview;
      delete next.previewUrl;
      delete next.objectUrl;
    }
    return next;
  }

  function needsUpload(entry) {
    if (!entry || typeof entry !== 'object') return /^data:image\//i.test(String(entry || ''));
    if (entry.offloaded && entry.teamUrl) return false;
    return !!localDataUrl(entry);
  }

  function mergeRemote(localList, remoteList, kind) {
    const local = Array.isArray(localList) ? localList.slice() : [];
    const remote = (remoteList || []).filter((p) => p.kind === kind);
    const byId = new Map();
    local.forEach((p, i) => {
      const id = photoIdFor(p, kind, i);
      byId.set(id, typeof p === 'object' ? { ...p, teamPhotoId: id } : { dataUrl: p, teamPhotoId: id });
    });
    for (const pointer of remote) {
      const id = String(pointer.photoId || '');
      const prev = byId.get(id) || { kind, teamPhotoId: id };
      byId.set(id, applyPointer(prev, pointer));
    }
    return [...byId.values()];
  }

  function absUrl(path) {
    const s = String(path || '');
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) return API_ORIGIN + s;
    return '';
  }

  function isTeamUrl(url) {
    const s = String(url || '');
    return /\/api\/field-session\/photos\//.test(s);
  }

  return {
    KINDS,
    API_ORIGIN,
    normalizeKind,
    photoIdFor,
    localDataUrl,
    applyPointer,
    needsUpload,
    mergeRemote,
    absUrl,
    isTeamUrl,
  };
});
