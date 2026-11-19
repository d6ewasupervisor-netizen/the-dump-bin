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
   *   missingBays?: number[],
   *   title?: string,
   *   mount?: HTMLElement,
   *   allowMarkMissing?: boolean,
   *   allowAddBay?: boolean,
   *   allowLeaveForCamera?: boolean,
   *   onMarkMissing?: (bay:number)=>void|Promise<void>,
   *   onUnmarkMissing?: (bay:number)=>void|Promise<void>,
   *   onAddBay?: ()=>void|Promise<number|void>,
   * }} opts
   * @returns {Promise<{
   *   cancelled: boolean,
   *   leaveForCamera?: boolean,
   *   placements?: {photoIdx:number,bay:number,file:File}[],
   *   unassignedCount?: number,
   *   missingBays?: number[],
   *   requiredBays?: number[],
   * }>}
   */
  function open(opts) {
    const files = [...(opts.files || [])];
    const L = Logic();
    if (!files.length || !L) {
      return Promise.resolve({ cancelled: true });
    }

    let requiredBays = [...(opts.requiredBays || [])].map(Number).filter((n) => n > 0);
    let missingBays = [...(opts.missingBays || [])].map(Number).filter((n) => n > 0);
    const occupied = new Set([...(opts.occupiedBays || [])].map(Number));
    const emptyBays = requiredBays.filter((b) => !occupied.has(b) && !missingBays.includes(b));
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

      function displayBayList() {
        const miss = new Set(missingBays.map(Number));
        const nums = new Set([...requiredBays, ...missingBays].map(Number));
        return [...nums].filter((n) => n > 0).sort((a, b) => a - b).map((b) => ({
          bay: b,
          missing: miss.has(b),
        }));
      }

      function statusText(plan) {
        if (plan.ready) {
          if (plan.unassignedCount) {
            return `Ready — ${plan.unassignedCount} photo${plan.unassignedCount === 1 ? '' : 's'} will be left out`;
          }
          return 'Ready — Confirm to upload';
        }
        const need = plan.missingRequired || [];
        if (need.length === 1) return `Bay ${need[0]} still needs a photo`;
        if (need.length === 2) return `Bays ${need[0]} and ${need[1]} still need a photo`;
        if (need.length > 2) {
          return `Bays ${need.slice(0, -1).join(', ')}, and ${need[need.length - 1]} still need a photo`;
        }
        return 'Assign every bay or mark it not in store';
      }

      function paint() {
        const activeRequired = requiredBays.filter((b) => !missingBays.includes(b));
        const plan = L.confirmPlan({
          assignments,
          fileCount: files.length,
          requiredBays: activeRequired,
        });
        // Device-captured / already-loaded bays count as placed for Confirm.
        const stillNeed = (plan.missingRequired || []).filter((b) => !occupied.has(b));
        const ready = stillNeed.length === 0 && activeRequired.length > 0;
        const replaceBanner = pendingReplace
          ? `<div class="bay-assign-replace" data-bay-assign-replace>
               <p>Bay ${pendingReplace.bay} already has a photo.</p>
               <div class="btn-row">
                 <button type="button" class="btn btn-primary" data-bay-assign-replace-yes>Replace bay ${pendingReplace.bay}</button>
                 <button type="button" class="btn btn-secondary" data-bay-assign-replace-no>Cancel</button>
               </div>
             </div>`
          : '';
        const bayTiles = displayBayList().map(({ bay: b, missing }) => {
          const who = occupiedMap[b];
          const filled = who != null;
          const occ = occupied.has(b) && who == null;
          const thumb = filled ? thumbUrls[Number(who)] : '';
          let caption = 'Empty';
          if (missing) caption = 'Not in store';
          else if (filled) caption = `Photo ${Number(who) + 1}`;
          else if (occ) caption = 'On device';
          return `<div class="bay-assign-bay${filled ? ' is-filled' : ''}${occ ? ' is-occupied' : ''}${missing ? ' is-missing' : ''}" data-bay-assign-bay="${b}" role="listitem">
            ${thumb ? `<img src="${esc(thumb)}" alt="">` : '<div class="bay-assign-bay-ph"></div>'}
            <span class="bay-assign-bay-n">Bay ${b}</span>
            <span class="muted">${caption}</span>
            ${missing
              ? `<button type="button" class="btn btn-secondary" data-bay-assign-undo-missing="${b}">Undo</button>`
              : (!filled && !occ && opts.allowMarkMissing !== false
                ? `<button type="button" class="btn btn-secondary" data-bay-assign-mark-missing="${b}">Not in store</button>`
                : '')}
          </div>`;
        }).join('');

        root.innerHTML = `
          <div class="bay-assign-panel">
            <header class="bay-assign-head">
              <h2>${esc(opts.title || 'Assign bays')}</h2>
              <button type="button" class="btn btn-secondary" data-bay-assign-cancel>Back</button>
            </header>
            ${replaceBanner}
            <p class="muted bay-assign-hint">Tap a photo, then a bay. Confirm when every bay has a photo or is marked not in store. Leave empty bays for the camera if you still need to shoot them.</p>
            <div class="bay-assign-photos" role="list">
              ${files.map((f, i) => {
                const bay = assignments[i];
                const sel = selectedPhoto === i ? ' is-selected' : '';
                const placed = bay != null ? ' is-placed' : '';
                return `<button type="button" class="bay-assign-photo${sel}${placed}" data-bay-assign-photo="${i}" role="listitem">
                  <img src="${esc(thumbUrls[i] || '')}" alt="">
                  <span>Photo ${i + 1}${bay != null ? ` · Bay ${bay}` : ''}</span>
                </button>`;
              }).join('')}
            </div>
            <div class="bay-assign-bays" role="list">
              ${bayTiles}
            </div>
            <div class="bay-assign-actions">
              ${opts.allowAddBay !== false
                ? '<button type="button" class="btn btn-secondary" data-bay-assign-add>Add a bay</button>'
                : ''}
              ${opts.allowLeaveForCamera !== false
                ? '<button type="button" class="btn btn-secondary" data-bay-assign-leave-camera>Take remaining with camera</button>'
                : ''}
            </div>
            <footer class="bay-assign-foot">
              <p class="muted" data-bay-assign-status>${
                ready
                  ? (plan.unassignedCount
                    ? `Ready — ${plan.unassignedCount} photo${plan.unassignedCount === 1 ? '' : 's'} will be left out`
                    : 'Ready — Confirm to upload')
                  : statusText({ ...plan, missingRequired: stillNeed, ready: false })
              }</p>
              <button type="button" class="btn btn-primary${ready ? ' is-active' : ' is-locked'}" data-bay-assign-confirm ${ready ? '' : 'disabled'} aria-disabled="${ready ? 'false' : 'true'}">Confirm</button>
            </footer>
          </div>`;

        root.querySelector('[data-bay-assign-cancel]').onclick = () => finish({
          cancelled: true,
          missingBays: [...missingBays],
          requiredBays: [...requiredBays],
        });
        root.querySelector('[data-bay-assign-confirm]').onclick = () => {
          if (!ready) return;
          finish({
            cancelled: false,
            placements: plan.placements.map((p) => ({
              photoIdx: p.photoIdx,
              bay: p.bay,
              file: files[p.photoIdx],
            })),
            unassignedCount: plan.unassignedCount,
            missingBays: [...missingBays],
            requiredBays: [...requiredBays],
          });
        };
        const leaveCam = root.querySelector('[data-bay-assign-leave-camera]');
        if (leaveCam) {
          leaveCam.onclick = () => {
            // Keep placements already made; unfinished bays stay for the camera.
            const placed = L.confirmPlan({
              assignments,
              fileCount: files.length,
              requiredBays: requiredBays.filter((b) => !missingBays.includes(b)),
            }).placements;
            finish({
              cancelled: false,
              leaveForCamera: true,
              placements: placed.map((p) => ({
                photoIdx: p.photoIdx,
                bay: p.bay,
                file: files[p.photoIdx],
              })),
              unassignedCount: files.length - placed.length,
              missingBays: [...missingBays],
              requiredBays: [...requiredBays],
            });
          };
        }
        const addBtn = root.querySelector('[data-bay-assign-add]');
        if (addBtn) {
          addBtn.onclick = async () => {
            let nextBay = Math.max(0, ...requiredBays, ...missingBays) + 1;
            if (typeof opts.onAddBay === 'function') {
              const maybe = await opts.onAddBay();
              if (Number(maybe) > 0) nextBay = Number(maybe);
            }
            if (!requiredBays.includes(nextBay)) requiredBays = [...requiredBays, nextBay].sort((a, b) => a - b);
            paint();
          };
        }
        root.querySelectorAll('[data-bay-assign-mark-missing]').forEach((btn) => {
          btn.onclick = async (ev) => {
            ev.stopPropagation();
            const bay = Number(btn.getAttribute('data-bay-assign-mark-missing'));
            if (!missingBays.includes(bay)) missingBays = [...missingBays, bay].sort((a, b) => a - b);
            // Drop a placement on that bay if any.
            for (const [idx, b] of Object.entries(assignments)) {
              if (Number(b) === bay) {
                const cleared = L.clearPhoto({ assignments, occupied: occupiedMap, photoIdx: Number(idx) });
                assignments = cleared.assignments;
                occupiedMap = cleared.occupied;
              }
            }
            if (typeof opts.onMarkMissing === 'function') await opts.onMarkMissing(bay);
            paint();
          };
        });
        root.querySelectorAll('[data-bay-assign-undo-missing]').forEach((btn) => {
          btn.onclick = async (ev) => {
            ev.stopPropagation();
            const bay = Number(btn.getAttribute('data-bay-assign-undo-missing'));
            missingBays = missingBays.filter((x) => x !== bay);
            if (!requiredBays.includes(bay)) requiredBays = [...requiredBays, bay].sort((a, b) => a - b);
            if (typeof opts.onUnmarkMissing === 'function') await opts.onUnmarkMissing(bay);
            paint();
          };
        });
        root.querySelectorAll('[data-bay-assign-photo]').forEach((btn) => {
          btn.onclick = () => {
            selectedPhoto = Number(btn.getAttribute('data-bay-assign-photo'));
            pendingReplace = null;
            paint();
          };
        });
        root.querySelectorAll('[data-bay-assign-bay]').forEach((el) => {
          el.onclick = (ev) => {
            if (ev.target.closest('button')) return;
            if (selectedPhoto == null) return;
            const bay = Number(el.getAttribute('data-bay-assign-bay'));
            if (missingBays.includes(bay)) return;
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
