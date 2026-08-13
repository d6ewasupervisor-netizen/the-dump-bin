/* Cart photos + conditional paper sign-off. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function stamp(dataUrl) {
    const S = global.EodSession;
    return {
      dataUrl,
      storeNumber: S.state.storeNumber,
      workDate: S.state.workDate,
      stampedAt: Date.now(),
    };
  }

  function src(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.dataUrl || '';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function persistPhotos() {
    const S = global.EodSession;
    if (global.PhotoDB?.savePhotos) {
      await global.PhotoDB.savePhotos(S.state.photos);
    }
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
    if (!arr.length) return '<p class="muted">No photos yet.</p>';
    return `<div class="photo-grid">${arr.map((p, i) => {
      const url = src(p);
      if (!url) return '';
      return `<div>
        <img src="${url}" alt="${esc(type)} ${i + 1}">
        <button type="button" class="btn btn-danger btn-block" data-remove="${type}" data-idx="${i}" style="margin-top:4px;min-height:36px;font-size:12px;">Remove</button>
      </div>`;
    }).join('')}</div>`;
  }

  async function render(mount) {
    const S = global.EodSession;
    await loadPhotos();
    const hasSheet = S.hasHostedSheet();
    mount.innerHTML = `
      <div class="card">
        <h1>Photos</h1>
        <p class="muted">Cart before/after photos. ${hasSheet
          ? 'A hosted digital signoff sheet exists — paper sign-off capture is hidden.'
          : 'No hosted sheet — capture paper sign-off sheets below.'}</p>
      </div>
      ${['before', 'after'].map((type) => `
        <div class="card">
          <h2>Kompass cart — ${type}</h2>
          <div class="btn-row">
            <label class="btn btn-primary" style="cursor:pointer;">
              Add photo
              <input type="file" accept="image/*,.heic,.heif" data-type="${type}" hidden>
            </label>
          </div>
          <div id="grid-${type}" style="margin-top:10px;">${gridHtml(type)}</div>
        </div>`).join('')}
      <div class="card" id="paperSignoffCard" ${hasSheet ? 'hidden' : ''}>
        <h2>Paper sign-off sheets</h2>
        <p class="muted">Only shown when no digital sheet is ingested for this store/week.</p>
        <div class="btn-row">
          <label class="btn btn-primary" style="cursor:pointer;">
            Add sign-off photo
            <input type="file" accept="image/*,.heic,.heif" data-type="signoff" multiple hidden>
          </label>
        </div>
        <div id="grid-signoff" style="margin-top:10px;">${gridHtml('signoff')}</div>
      </div>
      ${S.state.instaworkYes === 'Yes' ? `
      <div class="card">
        <h2>InstaWork sign-out sheet</h2>
        <div class="btn-row">
          <label class="btn btn-primary" style="cursor:pointer;">
            Add photo
            <input type="file" accept="image/*,.heic,.heif" data-type="instawork" hidden>
          </label>
        </div>
        <div id="grid-instawork" style="margin-top:10px;">${gridHtml('instawork')}</div>
      </div>` : ''}`;

    mount.querySelectorAll('input[type="file"][data-type]').forEach((input) => {
      input.onchange = async () => {
        const type = input.getAttribute('data-type');
        const files = Array.from(input.files || []);
        if (!files.length) return;
        const photos = { ...S.state.photos };
        photos[type] = (photos[type] || []).slice();
        for (const file of files) {
          const dataUrl = await readFileAsDataUrl(file);
          photos[type].push(stamp(dataUrl));
        }
        S.patch({ photos }, 'photos');
        await persistPhotos();
        render(mount);
      };
    });

    mount.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = async () => {
        const type = btn.getAttribute('data-remove');
        const idx = Number(btn.getAttribute('data-idx'));
        const photos = { ...S.state.photos };
        photos[type] = (photos[type] || []).slice();
        photos[type].splice(idx, 1);
        S.patch({ photos }, 'photos');
        await persistPhotos();
        render(mount);
      };
    });
  }

  global.EodRouter.register('photos', render);
})(typeof window !== 'undefined' ? window : globalThis);
