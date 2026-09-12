/* Mirror cart / signoff / InstaWork onto Railway so a second device can finish the day. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-session';
  const Logic = () => global.EodTeamPhotoStoreLogic || {};
  let persistTimer = null;
  let hydrating = false;
  let uploading = false;

  function session() {
    return global.EodSession;
  }

  function headers() {
    return global.EodApi?.dayConfirmHeaders?.({ 'Content-Type': 'application/json' })
      || { 'Content-Type': 'application/json' };
  }

  function abs(url) {
    return Logic().absUrl ? Logic().absUrl(url) : url;
  }

  function slotKind(slot, entry) {
    return Logic().normalizeKind
      ? Logic().normalizeKind(entry?.kind, slot)
      : String(slot || '');
  }

  async function fetchSnapshot(store, date) {
    if (!store || !date || !global.authFetch) return null;
    const qs = new URLSearchParams({ store, date });
    const resp = await global.authFetch(`${API}/snapshot?${qs}`, {
      skipBusy: true,
      noBounceOn401: true,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return null;
    return data;
  }

  async function uploadOne({ store, date, kind, photoId, dataUrl, label }) {
    const resp = await global.authFetch(`${API}/photos`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        storeNumber: store,
        workDate: date,
        kind,
        photoId,
        dataUrl,
        label: label || null,
      }),
      skipBusy: true,
      noBounceOn401: true,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.photo) {
      throw new Error(data.error || `Team store upload failed (${resp.status})`);
    }
    return data.photo;
  }

  function applyPhotos(S, remote) {
    const L = Logic();
    if (!S?.state?.photos || !L.mergeRemote) return S.state.photos;
    const next = Object.assign({}, S.state.photos);
    for (const slot of ['before', 'after', 'signoff', 'instawork']) {
      const kind = slot === 'before' || slot === 'after' ? slot : slot;
      next[slot] = L.mergeRemote(next[slot] || [], remote || [], kind);
    }
    return next;
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchBytes(url) {
    const href = abs(url);
    if (!href || !global.authFetch) return null;
    const resp = await global.authFetch(href, { skipBusy: true, noBounceOn401: true });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob || blob.size < 32) return null;
    return blob;
  }

  async function hydrateThumbs(photos) {
    const L = Logic();
    if (!photos) return photos;
    for (const slot of ['before', 'after', 'signoff', 'instawork']) {
      const list = photos[slot] || [];
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const live = String(entry.previewUrl || entry.preview || '');
        if (/^blob:/i.test(live) && global.PhotoDB?.liveObjectUrls?.has?.(live)) continue;
        if (/^data:image\//i.test(live) || /^data:image\//i.test(String(entry.dataUrl || ''))) continue;
        const thumb = entry.thumbUrl || entry.teamUrl;
        if (!L.isTeamUrl?.(thumb)) continue;
        try {
          const blob = await fetchBytes(thumb);
          if (!blob) continue;
          const url = global.PhotoDB?.attachObjectUrl
            ? global.PhotoDB.attachObjectUrl(blob, entry.previewUrl)
            : URL.createObjectURL(blob);
          entry.previewUrl = url;
          entry.preview = url;
          entry.objectUrl = url;
        } catch (_) {}
      }
    }
    return photos;
  }

  async function materializeEntry(entry) {
    const L = Logic();
    if (!entry || typeof entry !== 'object') {
      return /^data:image\//i.test(String(entry || '')) ? String(entry) : '';
    }
    const local = L.localDataUrl?.(entry);
    if (local) return local;
    const live = String(entry.previewUrl || entry.objectUrl || entry.preview || '');
    if (/^blob:/i.test(live)) {
      try {
        const resp = await fetch(live);
        const blob = await resp.blob();
        if (blob && blob.size > 32) return blobToDataUrl(blob);
      } catch (_) {}
    }
    const remote = entry.teamUrl || entry.thumbUrl;
    if (!L.isTeamUrl?.(remote)) return '';
    const blob = await fetchBytes(remote);
    if (!blob) return '';
    const dataUrl = await blobToDataUrl(blob);
    entry.dataUrl = dataUrl;
    return dataUrl;
  }

  async function materializePhotos(photos) {
    if (!photos) return photos;
    for (const slot of ['before', 'after', 'signoff', 'instawork']) {
      for (const entry of photos[slot] || []) {
        try { await materializeEntry(entry); } catch (_) {}
      }
    }
    return photos;
  }

  function findEntryByJob(photos, job) {
    if (!photos || !job?.id) return null;
    for (const slot of ['before', 'after', 'signoff', 'instawork']) {
      const hit = (photos[slot] || []).find((p) => p && p.jobId === job.id);
      if (hit) return { slot, entry: hit };
    }
    return null;
  }

  async function uploadEntry(S, slot, entry, index) {
    const L = Logic();
    const store = S.state.storeNumber;
    const date = S.state.workDate;
    const kind = slotKind(slot, entry);
    if (!store || !date || !kind || !L.needsUpload?.(entry)) return null;
    const dataUrl = L.localDataUrl?.(entry) || await materializeEntry(entry);
    if (!/^data:image\//i.test(dataUrl)) return null;
    const photoId = L.photoIdFor(entry, kind, index);
    const pointer = await uploadOne({
      store,
      date,
      kind,
      photoId,
      dataUrl,
      label: entry.label || entry.kind || kind,
    });
    const next = L.applyPointer(entry, pointer);
    Object.assign(entry, next);
    return pointer;
  }

  async function syncPhotos(S) {
    if (uploading || hydrating) return;
    const store = S?.state?.storeNumber;
    const date = S?.state?.workDate;
    if (!store || !date || !global.authFetch) return;
    uploading = true;
    try {
      let changed = false;
      for (const slot of ['before', 'after', 'signoff', 'instawork']) {
        const list = S.state.photos?.[slot] || [];
        for (let i = 0; i < list.length; i++) {
          const entry = list[i];
          if (!Logic().needsUpload?.(entry)) continue;
          try {
            await uploadEntry(S, slot, entry, i);
            changed = true;
          } catch (err) {
            console.warn('[team-session] upload', err.message || err);
          }
        }
      }
      if (changed && global.PhotoDB?.savePhotos) {
        await global.PhotoDB.savePhotos(S.state.photos);
      }
    } finally {
      uploading = false;
    }
  }

  function scheduleSync(S) {
    if (hydrating) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      syncPhotos(S || session()).catch(() => {});
    }, 600);
  }

  async function hydrate(S) {
    const store = S?.state?.storeNumber;
    const date = S?.state?.workDate;
    if (!store || !date) return null;
    hydrating = true;
    try {
      const snap = await fetchSnapshot(store, date);
      if (!snap) return null;
      if (snap.mirror?.payload) {
        global.EodVisitMirror?.applyPayload?.(S, snap.mirror);
      }
      const merged = applyPhotos(S, snap.photos || []);
      await hydrateThumbs(merged);
      S.patch({ photos: merged }, 'team-session');
      if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(merged);
      return snap.mirror || null;
    } catch (err) {
      console.warn('[team-session] hydrate', err.message || err);
      return null;
    } finally {
      hydrating = false;
    }
  }

  async function onPipeline(detail) {
    const type = detail?.type;
    const job = detail?.job;
    if (!job || (type !== 'compressed' && type !== 'done')) return;
    if (job.kind === 'set') return;
    const S = session();
    if (!S?.state?.photos) return;
    const found = findEntryByJob(S.state.photos, job);
    const dataUrl = String(job.dataUrl || '');
    if (found && /^data:image\//i.test(dataUrl) && !found.entry.teamUrl) {
      found.entry.dataUrl = dataUrl;
    }
    scheduleSync(S);
  }

  function init() {
    if (init._bound) return;
    init._bound = true;
    const S = session();
    if (S?.on) {
      S.on((_state, reason) => {
        if (hydrating) return;
        if (reason === 'load' || reason === 'visit-mirror' || reason === 'team-session') return;
        if (!S.state?.storeNumber || !S.state.workDate) return;
        scheduleSync(S);
      });
    }
    if (global.EodPhotoPipeline?.onChange) {
      global.EodPhotoPipeline.onChange(onPipeline);
    }
  }

  global.EodTeamSession = {
    init,
    hydrate,
    hydrateThumbs,
    materializeEntry,
    materializePhotos,
    syncPhotos,
    scheduleSync,
    fetchSnapshot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
