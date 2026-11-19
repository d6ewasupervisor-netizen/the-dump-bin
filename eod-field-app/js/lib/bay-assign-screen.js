/* Device file-pick assign screen. Tap a photo, tap a bay. No drag, no browser dialogs. */
(function (global) {
  'use strict';

  function Logic() {
    return global.EodBayAssignLogic;
  }

  function revokeAll(urls) {
    for (const u of urls || []) {
      try { if (u && String(u).startsWith('blob:')) URL.revokeObjectURL(u); } catch (_) {}
    }
  }

  /**
   * @param {{
   *   files: File[],
   *   requiredBays: number[],
   *   occupiedBays?: Set|number[],
   *   title?: string,
   *   mount?: HTMLElement,
   * }} opts
   * @returns {Promise<{ cancelled: boolean, placements?: {photoIdx:number,bay:number,file:File}[], unassignedCount?: number }>}
   */
  function open(opts) {
    const files = [...(opts.files || [])];
    const requiredBays = [...(opts.requiredBays || [])].map(Number).filter((n) => n > 0);
    const occupied = new Set([...(opts.occupiedBays || [])].map(Number));
    const L = Logic();
    if (!files.length || !L) {
      return Promise.resolve({ cancelled: true });
    }

    const emptyBays = requiredBays.filter((b) => !occupied.has(b));
    let assignments = L.suggestAssignments({ fileCount: files.length, emptyBays });
    let occupiedMap = Object.create(null);
    for (const [idx, bay] of Object.entries(assignments)) {
      if (bay != null) occupiedMap[bay] = Number(idx);
    }
    let selectedPhoto = files.length === 1 ? 0 : null;
    let pendingReplace = null;
    const thumbUrls = files.map((f) => {
      try { return URL.createObjectURL(f); } catch (_) { return ''; }
    });

    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'bay-assign-screen';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', 'Assign photos to bays');
      const mount = opts.mount || document.body;
      mount.appendChild(root);

      function finish(result) {
        revokeAll(thumbUrls);
        try { root.remove(); } catch (_) {}
        resolve(result);
      }

      function paint() {
        const plan = L.confirmPlan({
          assignments,
          fileCount: files.length,
          requiredBays,
        });
        const replaceBanner = pendingReplace
          ? `<div class="bay-assign-replace" data-bay-assign-replace>
               <p>Bay ${pendingReplace.bay} already has a photo.</p>
               <div class="btn-row">
                 <button type="button" class="btn btn-primary" data-bay-assign-replace-yes>Replace bay ${pendingReplace.bay}</button>
                 <button type="button" class="btn btn-secondary" data-bay-assign-replace-no>Cancel</button>
               </div>
             </div>`
          : '';
        root.innerHTML = `
          <div class="bay-assign-panel">
            <header class="bay-assign-head">
              <h2>${esc(opts.title || 'Assign bays')}</h2>
              <button type="button" class="btn btn-secondary" data-bay-assign-cancel>Back</button>
            </header>
            ${replaceBanner}
            <p class="muted bay-assign-hint">Tap a photo, then a bay. Confirm when every bay has a photo.</p>
            <div class="bay-assign-photos" role="list">
              ${files.map((f, i) => {
                const bay = assignments[i];
                const sel = selectedPhoto === i ? ' is-selected' : '';
                const placed = bay != null ? ' is-placed' : '';
                return `<button type="button" class="bay-assign-photo${sel}${placed}" data-bay-assign-photo="${i}" role="listitem">
                  <img src="${esc(thumbUrls[i] || '')}" alt="">
                  <span>${bay != null ? `Bay ${bay}` : 'Unassigned'}</span>
                </button>`;
              }).join('')}
            </div>
            <div class="bay-assign-bays" role="list">
              ${requiredBays.map((b) => {
                const who = occupiedMap[b];
                const filled = who != null;
                const occ = occupied.has(b) && who == null;
                return `<button type="button" class="bay-assign-bay${filled ? ' is-filled' : ''}${occ ? ' is-occupied' : ''}" data-bay-assign-bay="${b}" role="listitem">
                  <span class="bay-assign-bay-n">${b}</span>
                  <span class="muted">${filled ? `Photo ${Number(who) + 1}` : (occ ? 'On device' : 'Empty')}</span>
                </button>`;
              }).join('')}
            </div>
            <footer class="bay-assign-foot">
              <p class="muted" data-bay-assign-status>${
                plan.ready
                  ? (plan.unassignedCount
                    ? `Ready — ${plan.unassignedCount} photo${plan.unassignedCount === 1 ? '' : 's'} will be left out`
                    : 'Ready')
                  : `Need ${plan.missingRequired.length} more bay${plan.missingRequired.length === 1 ? '' : 's'}`
              }</p>
              <button type="button" class="btn btn-primary" data-bay-assign-confirm ${plan.ready ? '' : 'disabled'}>Confirm</button>
            </footer>
          </div>`;

        root.querySelector('[data-bay-assign-cancel]').onclick = () => finish({ cancelled: true });
        root.querySelector('[data-bay-assign-confirm]').onclick = () => {
          if (!plan.ready) return;
          finish({
            cancelled: false,
            placements: plan.placements.map((p) => ({
              photoIdx: p.photoIdx,
              bay: p.bay,
              file: files[p.photoIdx],
            })),
            unassignedCount: plan.unassignedCount,
          });
        };
        root.querySelectorAll('[data-bay-assign-photo]').forEach((btn) => {
          btn.onclick = () => {
            selectedPhoto = Number(btn.getAttribute('data-bay-assign-photo'));
            pendingReplace = null;
            paint();
          };
        });
        root.querySelectorAll('[data-bay-assign-bay]').forEach((btn) => {
          btn.onclick = () => {
            if (selectedPhoto == null) return;
            const bay = Number(btn.getAttribute('data-bay-assign-bay'));
            const result = L.placePhoto({
              assignments,
              occupied: occupiedMap,
              photoIdx: selectedPhoto,
              bay,
              confirmReplace: false,
            });
            if (result.needReplaceConfirm) {
              pendingReplace = { bay: result.replaceBay, photoIdx: selectedPhoto };
              paint();
              return;
            }
            if (!result.ok) return;
            assignments = result.assignments;
            occupiedMap = result.occupied;
            pendingReplace = null;
            if (files.length > 1) selectedPhoto = null;
            paint();
          };
        });
        const yes = root.querySelector('[data-bay-assign-replace-yes]');
        const no = root.querySelector('[data-bay-assign-replace-no]');
        if (yes && pendingReplace) {
          yes.onclick = () => {
            const result = L.placePhoto({
              assignments,
              occupied: occupiedMap,
              photoIdx: pendingReplace.photoIdx,
              bay: pendingReplace.bay,
              confirmReplace: true,
            });
            if (result.ok) {
              assignments = result.assignments;
              occupiedMap = result.occupied;
            }
            pendingReplace = null;
            if (files.length > 1) selectedPhoto = null;
            paint();
          };
        }
        if (no) no.onclick = () => { pendingReplace = null; paint(); };
      }

      paint();
    });
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const api = { open };
  global.EodBayAssignScreen = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
