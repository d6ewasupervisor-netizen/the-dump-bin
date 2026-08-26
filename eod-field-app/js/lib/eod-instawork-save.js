/* InstaWork sign-out sheet save — same logic as live EOD Confirm & Save.
 * POST https://eod-api.the-dump-bin.com/instawork/save-image (never localhost).
 * Portrait JPEG (q=0.95, long edge 2400–3200) → hosted API → P#W# folder. */
(function (global) {
  'use strict';

  const SAVE_URL = 'https://eod-api.the-dump-bin.com/instawork/save-image';
  const OVERLAY_MIN_MS = 4000;
  const SUCCESS_HOLD_MS = 1200;

  let saving = false;

  function photoSrc(photo) {
    if (!photo) return '';
    if (typeof photo === 'string') return photo;
    return photo.dataUrl || photo.preview || '';
  }

  function destLine(result) {
    if (!result) return '';
    const fileName = (result.filePath || '').split(/[\\/]/).pop() || '(unknown)';
    const folder = result.folder || '';
    return folder + '\\' + fileName + (result.periodWeek ? '  \u2022  ' + result.periodWeek : '');
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode InstaWork photo.'));
      img.src = dataUrl;
    });
  }

  async function ensurePortraitOrientation(dataUrl) {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (h >= w) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = h;
    canvas.height = w;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function compressJpeg(dataUrl, maxWidth, maxHeight, quality) {
    const img = await loadImage(dataUrl);
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function buildInstaworkSignOutJpegBase64(photoDataUrl) {
    if (!photoDataUrl) throw new Error('No InstaWork sign-out sheet photo to save.');
    const portraitData = await ensurePortraitOrientation(photoDataUrl);
    const compressed = await compressJpeg(portraitData, 2400, 3200, 0.95);
    const prefix = 'data:image/jpeg;base64,';
    return compressed.startsWith(prefix)
      ? compressed.slice(prefix.length)
      : compressed.replace(/^data:[^;]+;base64,/, '');
  }

  function ensureOverlay() {
    let overlay = document.getElementById('instaworkBufferOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'instaworkBufferOverlay';
    overlay.className = 'iw-overlay';
    overlay.setAttribute('data-state', 'saving');
    overlay.innerHTML = `<div class="iw-overlay-card">
      <div class="iw-spinner" aria-hidden="true"></div>
      <div class="iw-check" aria-hidden="true">&#10003;</div>
      <div id="iwOverlayTitle" class="iw-overlay-title">Saving InstaWork sign-out sheet\u2026</div>
      <div id="iwOverlaySubtitle" class="iw-overlay-subtitle">Uploading the photo and routing it to the right period folder.</div>
    </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function setOverlay(state, opts) {
    const overlay = ensureOverlay();
    const title = document.getElementById('iwOverlayTitle');
    const sub = document.getElementById('iwOverlaySubtitle');
    if (state === 'hide') {
      overlay.classList.remove('show');
      return;
    }
    overlay.dataset.state = state;
    if (state === 'saving') {
      if (title) title.textContent = (opts && opts.title) || 'Saving InstaWork sign-out sheet\u2026';
      if (sub) {
        sub.textContent = (opts && opts.subtitle)
          || 'Uploading the photo and routing it to the right period folder.';
      }
    } else if (state === 'success') {
      if (title) title.textContent = (opts && opts.title) || 'Sign-out sheet saved!';
      if (sub) sub.textContent = (opts && opts.subtitle) || '';
    }
    overlay.classList.add('show');
  }

  function savedInfo() {
    return global.EodSession?.state?.instaworkSavedInfo || null;
  }

  function setSavedInfo(info) {
    const S = global.EodSession;
    if (!S) return;
    S.patch({ instaworkSavedInfo: info || null }, 'iw-save');
    try { S.saveDraft(); } catch (_) {}
  }

  function clearSavedInfo() {
    if (!savedInfo()) return;
    setSavedInfo(null);
  }

  async function confirmForceLive() {
    if (typeof global.confirmForceLiveIfNeeded === 'function') {
      const ok = await global.confirmForceLiveIfNeeded('InstaWork sign-out save');
      if (!ok) throw new Error('Cancelled — live delivery override was on.');
      return;
    }
    const live = !!(global.EodTestMode?.isForceLive?.());
    if (!live) return;
    const ok = global.EodAlerts?.confirm
      ? await global.EodAlerts.confirm('Live delivery', 'LIVE delivery override is ON for InstaWork sign-out save. Continue?')
      : confirm('LIVE delivery override is ON for InstaWork sign-out save. Continue?');
    if (!ok) throw new Error('Cancelled — live delivery override was on.');
  }

  async function saveImageLocally({ storeNumber, workDate, imageBase64 }) {
    await confirmForceLive();
    const headers = global.EodApi.dayConfirmHeaders();
    let response;
    try {
      response = await global.authFetch(SAVE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeNumber,
          workDate,
          imageBase64,
          forceLive: global.EodTestMode?.isForceLive?.() || undefined,
          testMode: global.EodTestMode?.isEnabled?.() || undefined,
        }),
      });
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e);
      if (msg === 'Not authenticated' || msg.includes('Not authenticated')) {
        throw new Error('Sign in is required to save the InstaWork sign-out sheet.');
      }
      throw new Error(
        'Could not reach the EOD API (eod-api.the-dump-bin.com). Check your connection and try again.'
      );
    }
    if (response.status === 412) {
      try { global.EodSession?.clearDayConfirm?.(); } catch (_) {}
      if (typeof global.showDayConfirmModal === 'function') {
        global.showDayConfirmModal({
          store: storeNumber,
          date: workDate,
          message: 'Please re-confirm your store for today before saving the InstaWork sign-out sheet.',
        });
      } else if (global.showAlert) {
        global.showAlert('Confirm store', 'Confirm today\'s store on Visit, then save again.');
        global.EodRouter?.go?.('visit');
      }
      throw new Error('Daily store confirmation required. Please confirm your store and try again.');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new Error(result.error || `InstaWork save failed (${response.status})`);
    }
    return result;
  }

  async function confirmAndSave() {
    if (saving) return savedInfo();
    const S = global.EodSession;
    const photo = (S.state.photos.instawork || [])[0];
    const dataUrl = photoSrc(photo);
    if (!dataUrl) throw new Error('Take or upload a photo of the InstaWork sign-out sheet first.');
    const storeNumber = String(S.state.storeNumber || '').trim();
    const workDate = String(S.state.workDate || '').trim();
    if (!storeNumber) throw new Error('Enter your store number before saving the InstaWork sign-out sheet.');
    if (!workDate) throw new Error('Pick a work date before saving the InstaWork sign-out sheet.');

    saving = true;
    setOverlay('saving');
    const overlayStartedAt = Date.now();
    try {
      const imageBase64 = await buildInstaworkSignOutJpegBase64(dataUrl);
      const result = await saveImageLocally({ storeNumber, workDate, imageBase64 });
      S.patch({ instaworkSavedInfo: result, instaworkYes: 'Yes' }, 'iw-save');
      try { S.saveDraft(); } catch (_) {}
      const line = destLine(result);
      setOverlay('success', { title: 'Sign-out sheet saved!', subtitle: line });
      const elapsed = Date.now() - overlayStartedAt;
      const successHold = Math.max(SUCCESS_HOLD_MS, OVERLAY_MIN_MS - elapsed);
      await new Promise((r) => setTimeout(r, elapsed < OVERLAY_MIN_MS ? successHold : SUCCESS_HOLD_MS));
      setOverlay('hide');
      return result;
    } catch (err) {
      setOverlay('hide');
      throw err;
    } finally {
      saving = false;
    }
  }

  global.EodInstaworkSave = {
    SAVE_URL,
    OVERLAY_MIN_MS,
    confirmAndSave,
    destLine,
    savedInfo,
    setSavedInfo,
    clearSavedInfo,
    isSaving: () => saving,
    photoSrc,
  };
})(typeof window !== 'undefined' ? window : globalThis);
