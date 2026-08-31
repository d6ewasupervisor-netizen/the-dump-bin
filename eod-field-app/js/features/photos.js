/* Photos live on Visit (cart before) and Send (cart after). */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function stamp(dataUrl, extra) {
    const S = global.EodSession;
    return Object.assign({
      dataUrl,
      storeNumber: S.state.storeNumber,
      workDate: S.state.workDate,
      stampedAt: Date.now(),
    }, extra || {});
  }

  function src(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.dataUrl || entry.previewUrl || entry.objectUrl || entry.preview || '';
  }

  async function preparePhoto(file, type) {
    const converted = global.EodHeic?.prepareFile ? await global.EodHeic.prepareFile(file) : file;
    if (global.EodPhotoCompress?.compressFile) {
      const out = await global.EodPhotoCompress.compressFile(converted, type || 'default');
      return out.dataUrl;
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(converted);
    });
  }

  async function persistPhotos() {
    const S = global.EodSession;
    if (global.PhotoDB?.savePhotos) await global.PhotoDB.savePhotos(S.state.photos);
    S.saveDraft();
  }

  async function loadPhotos() {
    const S = global.EodSession;
    if (global.PhotoDB?.switchToDayConfirm) {
      await global.PhotoDB.switchToDayConfirm(S.state.storeNumber, S.state.workDate, S.state.photos);
    } else if (global.PhotoDB?.loadPhotos) {
      const loaded = await global.PhotoDB.loadPhotos();
      if (loaded) S.patch({ photos: loaded }, 'photos');
    }
  }

  function gridHtml(type) {
    const S = global.EodSession;
    const arr = S.state.photos[type] || [];
    if (!arr.length) return '<p class="muted">None yet.</p>';
    return `<div class="photo-grid">${arr.map((p, i) => {
      const url = src(p);
      if (!url) return '';
      return `<div>
        <img src="${esc(url)}" alt="${esc(type)} ${i + 1}">
        <div class="btn-row" style="margin-top:4px;">
          <button type="button" class="btn btn-secondary" data-edit="${esc(type)}" data-idx="${i}" style="min-height:36px;font-size:12px;flex:1;">Edit</button>
          <button type="button" class="btn btn-danger" data-remove="${esc(type)}" data-idx="${i}" style="min-height:36px;font-size:12px;flex:1;">Remove</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  async function removeAt(type, idx) {
    const S = global.EodSession;
    const photos = Object.assign({}, S.state.photos);
    photos[type] = (photos[type] || []).slice();
    if (idx < 0 || idx >= photos[type].length) return false;
    photos[type].splice(idx, 1);
    const patch = { photos };
    if (type === 'before' && !photos[type].length) patch.cartPhotoDone = false;
    S.patch(patch, 'photos');
    await persistPhotos();
    return true;
  }

  async function editAt(type, idx) {
    const S = global.EodSession;
    let entry = (S.state.photos[type] || [])[idx];
    if (entry == null) return false;
    let dataUrl = src(entry);
    if ((!dataUrl || /^blob:/i.test(dataUrl)) && global.PhotoDB?.hydrateDataUrls) {
      try { await global.PhotoDB.hydrateDataUrls(S.state.photos); } catch (_) {}
      entry = (S.state.photos[type] || [])[idx];
      dataUrl = src(entry);
    }
    if (!dataUrl || !global.EodPhotoEditor?.open) return false;
    const out = await global.EodPhotoEditor.open({ dataUrl });
    if (!out) return false;
    const photos = Object.assign({}, S.state.photos);
    photos[type] = (photos[type] || []).slice();
    if (typeof photos[type][idx] === 'string') photos[type][idx] = out;
    else photos[type][idx] = Object.assign({}, photos[type][idx], {
      dataUrl: out,
      previewUrl: out,
      preview: out,
    });
    S.patch({ photos }, 'photos');
    await persistPhotos();
    return true;
  }

  function bindGrid(root, { afterChange } = {}) {
    if (!root) return;
    root.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = async () => {
        await removeAt(btn.getAttribute('data-remove'), Number(btn.getAttribute('data-idx')));
        if (afterChange) await afterChange();
      };
    });
    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = async () => {
        const changed = await editAt(btn.getAttribute('data-edit'), Number(btn.getAttribute('data-idx')));
        if (changed && afterChange) await afterChange();
      };
    });
  }

  async function addFiles(type, files, extraKind) {
    const S = global.EodSession;
    const photos = Object.assign({}, S.state.photos);
    photos[type] = (photos[type] || []).slice();
    for (const file of files) {
      const dataUrl = await preparePhoto(file, type);
      const entry = stamp(dataUrl, extraKind ? { kind: extraKind } : null);
      if (type === 'instawork') photos[type] = [entry];
      else photos[type].push(entry);
    }
    const patch = { photos };
    if (type === 'before') patch.cartPhotoDone = true;
    if (type === 'instawork') {
      patch.instaworkSavedInfo = null;
      patch.instaworkYes = 'Yes';
    }
    S.patch(patch, 'photos');
    await persistPhotos();
  }

  async function captureType(type, extraKind) {
    if (!global.EodCamera?.open) return;
    await global.EodCamera.open({
      label: type === 'signoff' ? 'Paper sign-off' : type === 'instawork' ? 'InstaWork sheet' : `Cart ${type}`,
      onCapture: async (file) => {
        await addFiles(type, [file], extraKind);
      },
      shouldContinue: () => type !== 'instawork',
    });
  }

  async function saveInstawork() {
    if (global.EodInstaworkSave?.confirmAndSave) return global.EodInstaworkSave.confirmAndSave();
    throw new Error('InstaWork save module not loaded');
  }

  async function paintUnsent(host) {
    if (!host || !global.PhotoDB?.unsentSessions) return;
    try {
      const unsent = await global.PhotoDB.unsentSessions();
      if (!unsent.length) {
        host.innerHTML = '';
        host.hidden = true;
        return;
      }
      host.hidden = false;
      host.innerHTML = `<div class="notice notice-error" style="margin:0;">
        ${unsent.length} unsent photo session(s) on this phone.
        <button type="button" class="btn btn-secondary" id="unsentReviewBtn" style="margin-top:8px;">Review</button>
      </div>`;
      host.querySelector('#unsentReviewBtn')?.addEventListener('click', () => {
        if (global.EodDeviceStorage?.openUnsentReview) global.EodDeviceStorage.openUnsentReview();
        else global.EodRouter.go('storage');
      });
    } catch (_) {
      host.hidden = true;
    }
  }

  async function render(mount) {
    const S = global.EodSession;
    await loadPhotos();
    const showPaper = !S.hasHostedSheet();
    const showIw = S.state.instaworkYes === 'Yes' || (S.state.photos.instawork || []).length > 0;
    mount.innerHTML = `
      <div class="card">
        <h1>Photos</h1>
        <div id="photosUnsent"></div>
      </div>
      ${['before', 'after'].map((type) => `
        <div class="card">
          <h2>Kompass cart — ${type}</h2>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-cam="${type}">Camera</button>
            <label class="btn btn-secondary" style="cursor:pointer;">
              Add file
              <input type="file" accept="image/*,.heic,.heif" data-type="${type}" hidden>
            </label>
            <button type="button" class="btn btn-secondary" data-pull="${type}">Pull PROD</button>
            <button type="button" class="btn btn-secondary" data-push="${type}">Upload PROD</button>
          </div>
          <div id="grid-${type}" style="margin-top:10px;">${gridHtml(type)}</div>
        </div>`).join('')}
      ${showPaper ? `
      <div class="card" id="paperSignoffCard">
        <h2>Paper sign-off</h2>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-cam="signoff">Camera</button>
          <label class="btn btn-secondary" style="cursor:pointer;">
            Add file
            <input type="file" accept="image/*,.heic,.heif" data-type="signoff" hidden>
          </label>
        </div>
        <div id="grid-signoff" style="margin-top:10px;">${gridHtml('signoff')}</div>
      </div>` : ''}
      ${showIw ? `
      <div class="card">
        <h2>InstaWork sign-out</h2>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-cam="instawork">Camera</button>
          <label class="btn btn-secondary" style="cursor:pointer;">
            Add file
            <input type="file" accept="image/*,.heic,.heif" data-type="instawork" hidden>
          </label>
          <button type="button" class="btn btn-success" id="iwSaveBtn">${S.state.instaworkSavedInfo ? 'Re-save InstaWork Sign-Out Sheet' : 'Confirm &amp; Save InstaWork Sign-Out Sheet'}</button>
        </div>
        <div id="iwSaveMsg" class="${S.state.instaworkSavedInfo ? 'iw-saved-dest' : 'muted'}" style="margin-top:8px;">${
          S.state.instaworkSavedInfo
            ? `<strong>Saved.</strong> ${esc(global.EodInstaworkSave?.destLine?.(S.state.instaworkSavedInfo) || '')}`
            : ''
        }</div>
        <div id="grid-instawork" style="margin-top:10px;">${gridHtml('instawork')}</div>
      </div>` : ''}
      <div class="card">
        <button type="button" class="btn btn-secondary btn-block" id="photosStorageBtn">Storage / compress old photos</button>
        <div id="photosStorageMsg" class="muted" style="margin-top:8px;"></div>
      </div>`;

    await paintUnsent(document.getElementById('photosUnsent'));

    mount.querySelectorAll('input[type="file"][data-type]').forEach((input) => {
      input.onchange = async () => {
        const type = input.getAttribute('data-type');
        const files = Array.from(input.files || []);
        input.value = '';
        if (!files.length) return;
        const kind = type === 'before' || type === 'after' ? `cart-${type}` : null;
        await addFiles(type, files, kind);
        render(mount);
      };
    });
    mount.querySelectorAll('[data-cam]').forEach((btn) => {
      btn.onclick = async () => {
        const type = btn.getAttribute('data-cam');
        const kind = type === 'before' || type === 'after' ? `cart-${type}` : null;
        await captureType(type, kind);
        render(mount);
      };
    });
    bindGrid(mount, { afterChange: () => render(mount) });
    mount.querySelectorAll('[data-pull]').forEach((btn) => {
      btn.onclick = async () => {
        const type = btn.getAttribute('data-pull');
        try {
          const n = await global.EodVisitCart.pullCartFromProd(type);
          if (global.showAlert) global.showAlert('PROD', `Pulled ${n} ${type} photo(s).`);
          render(mount);
        } catch (err) {
          if (global.showAlert) global.showAlert('PROD', err.message || String(err));
        }
      };
    });
    mount.querySelectorAll('[data-push]').forEach((btn) => {
      btn.onclick = async () => {
        const type = btn.getAttribute('data-push');
        try {
          const list = global.EodVisitCart.cartPhotos(type);
          for (const p of list) await global.EodVisitCart.uploadCartToProd(type, p.dataUrl || p);
          if (global.showAlert) global.showAlert('PROD', `Uploaded ${type} photos.`);
        } catch (err) {
          if (global.showAlert) global.showAlert('PROD', err.message || String(err));
        }
      };
    });
    document.getElementById('iwSaveBtn')?.addEventListener('click', async () => {
      const msg = document.getElementById('iwSaveMsg');
      try {
        if (msg) {
          msg.className = 'muted';
          msg.textContent = 'Saving…';
        }
        const result = await saveInstawork();
        if (msg) {
          msg.className = 'iw-saved-dest';
          msg.innerHTML = `<strong>Saved.</strong> ${esc(global.EodInstaworkSave?.destLine?.(result) || '')}`;
        }
      } catch (err) {
        if (msg) {
          msg.className = 'iw-saved-dest iw-save-failed';
          msg.innerHTML = `<strong>Save failed.</strong> ${esc(err.message || String(err))}`;
        }
        if (global.showAlert) {
          global.showAlert('InstaWork Sign-Out Sheet Save Failed', err.message || String(err));
        }
      }
    });
    document.getElementById('photosStorageBtn')?.addEventListener('click', async () => {
      const msg = document.getElementById('photosStorageMsg');
      try {
        const pressure = await global.PhotoDB?.storagePressure?.();
        const r = await global.PhotoDB?.compressOldPhotos?.();
        const mb = pressure ? (pressure.totalBytes / (1024 * 1024)).toFixed(1) : '?';
        if (msg) {
          msg.textContent = `Photos ${mb} MB. Compressed ${r?.compressed || 0} in ${r?.sessions || 0} session(s).`;
        }
      } catch (err) {
        if (msg) msg.textContent = err.message || String(err);
      }
    });
  }

  global.EodPhotos = {
    render,
    preparePhoto,
    saveInstawork,
    addFiles,
    gridHtml,
    bindGrid,
    editAt,
    removeAt,
    src,
  };
  global.EodRouter.register('photos', () => {
    global.EodRouter.go('send', { replace: true });
  });
})(typeof window !== 'undefined' ? window : globalThis);
