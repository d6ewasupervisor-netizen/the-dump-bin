/* Pure bay-assign + override rules for the field app and node tests.

   Device file picks never upload until Confirm. Camera stays sequential. */
(function (global) {
  'use strict';

  function toNumList(list) {
    return (list || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }

  /* Sparse active bay numbers. Missing bays keep their holes (1,2,4). */
  function activeBayNumbers({ baseCount, missingBays, addedBays }) {
    const base = Math.max(0, Number(baseCount) || 0);
    const missing = new Set(toNumList(missingBays));
    const added = toNumList(addedBays);
    const out = [];
    for (let i = 1; i <= base; i += 1) {
      if (!missing.has(i)) out.push(i);
    }
    for (const b of added) {
      if (!out.includes(b) && !missing.has(b)) out.push(b);
    }
    return out.sort((a, b) => a - b);
  }

  function overrideExpectedCount(override) {
    if (!override) return null;
    const n = Number(override.newCount != null ? override.newCount : override.new_count);
    if (Number.isFinite(n) && n > 0) return n;
    const active = activeBayNumbers({
      baseCount: override.oldCount != null ? override.oldCount : override.old_count,
      missingBays: override.missingBays || override.missing_bays,
      addedBays: override.addedBays || override.added_bays,
    });
    return active.length || null;
  }

  /* Pre-fill empty bays from selection order. Suggestion only. */
  function suggestAssignments({ fileCount, emptyBays }) {
    const empties = toNumList(emptyBays);
    const n = Math.max(0, Number(fileCount) || 0);
    const map = Object.create(null);
    for (let i = 0; i < n; i += 1) {
      map[i] = empties[i] != null ? empties[i] : null;
    }
    return map;
  }

  /* Place photoIdx onto bay. occupied = bay -> photoIdx already placed.
     Returns { ok, needReplaceConfirm, assignments } — never mutates input. */
  function placePhoto({ assignments, occupied, photoIdx, bay, confirmReplace }) {
    const bayN = Number(bay);
    const idx = Number(photoIdx);
    if (!Number.isFinite(bayN) || bayN < 1 || !Number.isFinite(idx) || idx < 0) {
      return { ok: false, reason: 'bad', assignments: { ...assignments }, occupied: { ...occupied } };
    }
    const nextA = { ...assignments };
    const nextO = { ...occupied };
    const priorIdx = nextO[bayN];
    if (priorIdx != null && Number(priorIdx) !== idx && !confirmReplace) {
      return {
        ok: false,
        needReplaceConfirm: true,
        replaceBay: bayN,
        replacePhotoIdx: Number(priorIdx),
        assignments: nextA,
        occupied: nextO,
      };
    }
    const prevBay = nextA[idx];
    if (prevBay != null && nextO[prevBay] === idx) delete nextO[prevBay];
    if (priorIdx != null && Number(priorIdx) !== idx) {
      delete nextA[priorIdx];
    }
    nextA[idx] = bayN;
    nextO[bayN] = idx;
    return { ok: true, assignments: nextA, occupied: nextO };
  }

  function clearPhoto({ assignments, occupied, photoIdx }) {
    const idx = Number(photoIdx);
    const nextA = { ...assignments };
    const nextO = { ...occupied };
    const bay = nextA[idx];
    if (bay != null && nextO[bay] === idx) delete nextO[bay];
    delete nextA[idx];
    return { assignments: nextA, occupied: nextO };
  }

  /* Confirm is allowed only when every required bay has a photo. Extra
     unassigned files are reported, not uploaded. */
  function confirmPlan({ assignments, fileCount, requiredBays }) {
    const required = toNumList(requiredBays);
    const byBay = Object.create(null);
    const unassigned = [];
    const n = Math.max(0, Number(fileCount) || 0);
    for (let i = 0; i < n; i += 1) {
      const bay = assignments[i];
      if (bay == null) {
        unassigned.push(i);
        continue;
      }
      byBay[Number(bay)] = i;
    }
    const missingRequired = required.filter((b) => byBay[b] == null);
    const placements = required
      .filter((b) => byBay[b] != null)
      .map((b) => ({ photoIdx: byBay[b], bay: b }));
    return {
      ready: missingRequired.length === 0 && required.length > 0,
      placements,
      unassignedCount: unassigned.length,
      unassigned,
      missingRequired,
    };
  }

  /* Camera: order taken = next empty active bay. */
  function cameraNextBay({ taken, activeBays }) {
    const takenSet = new Set(toNumList(taken));
    const active = toNumList(activeBays);
    if (!active.length) {
      let i = 1;
      while (takenSet.has(i)) i += 1;
      return i;
    }
    for (const b of active) {
      if (!takenSet.has(b)) return b;
    }
    return null;
  }

  function markMissing({ baseCount, missingBays, addedBays, bay }) {
    const b = Number(bay);
    const missing = new Set(toNumList(missingBays));
    const added = toNumList(addedBays).filter((x) => x !== b);
    if (Number.isFinite(b) && b > 0) missing.add(b);
    const active = activeBayNumbers({ baseCount, missingBays: [...missing], addedBays: added });
    return {
      missingBays: [...missing].sort((a, c) => a - c),
      addedBays: added,
      newCount: active.length,
      activeBays: active,
    };
  }

  function unmarkMissing({ baseCount, missingBays, addedBays, bay }) {
    const b = Number(bay);
    const missing = toNumList(missingBays).filter((x) => x !== b);
    const active = activeBayNumbers({ baseCount, missingBays: missing, addedBays });
    return {
      missingBays: missing,
      addedBays: toNumList(addedBays),
      newCount: active.length,
      activeBays: active,
    };
  }

  function addBay({ baseCount, missingBays, addedBays }) {
    const active = activeBayNumbers({ baseCount, missingBays, addedBays });
    const max = Math.max(Number(baseCount) || 0, ...active, 0);
    const next = max + 1;
    const added = [...toNumList(addedBays), next];
    const out = activeBayNumbers({ baseCount, missingBays, addedBays: added });
    return {
      missingBays: toNumList(missingBays),
      addedBays: added,
      newCount: out.length,
      activeBays: out,
      bay: next,
    };
  }

  function removeAddedBay({ baseCount, missingBays, addedBays, bay }) {
    const b = Number(bay);
    const added = toNumList(addedBays).filter((x) => x !== b);
    const active = activeBayNumbers({ baseCount, missingBays, addedBays: added });
    return {
      missingBays: toNumList(missingBays),
      addedBays: added,
      newCount: active.length,
      activeBays: active,
    };
  }

  /* Added bays are beyond the SI section count — PROD only. */
  function uploadTargetsForBay({ bay, siSectionCount, addedBays, missingBays }) {
    const b = Number(bay);
    if (toNumList(missingBays).includes(b)) {
      return { skipProd: true, skipSi: false, blurrySi: true };
    }
    if (toNumList(addedBays).includes(b)) {
      return { skipProd: false, skipSi: true, blurrySi: false };
    }
    const si = Number(siSectionCount) || 0;
    if (si > 0 && b > si) {
      return { skipProd: false, skipSi: true, blurrySi: false };
    }
    return { skipProd: false, skipSi: false, blurrySi: false };
  }

  const api = {
    activeBayNumbers,
    overrideExpectedCount,
    suggestAssignments,
    placePhoto,
    clearPhoto,
    confirmPlan,
    cameraNextBay,
    markMissing,
    unmarkMissing,
    addBay,
    removeAddedBay,
    uploadTargetsForBay,
  };

  global.EodBayAssignLogic = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
