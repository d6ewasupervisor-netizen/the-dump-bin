/* How many photos a set takes, and which bay each one lands on.

   Kept pure and separate because these rules decide whether a set is complete.
   Bay count comes from SI sections. PROD footage (F032, "32 ft") is linear
   feet, not a photo count - the server resolves feet to bays in
   resolveExpectedBayCount. Nothing here may turn feet into a bay number. */
(function (global) {
  'use strict';

  /* The resolved count, or null when it is not known yet.

     Null is load-bearing. A fallback of 1 here meant sequential capture
     stopped after one shot, loading eight photos enqueued one and dropped
     seven, and the server - which auto-closes a set once bay >=
     expectedBayCount - closed eight-bay sets on the first after-photo. */
  function knownBayCount(status) {
    const s = status || {};
    const explicit = Number(s.expectedBayCount) || 0;
    const fromBays = Array.isArray(s.bays) && s.bays.length ? s.bays.length : 0;
    const sections = Number(s.si && s.si.sectionCount) || 0;
    const pog = Number(s.planogramBayCount)
      || (s.planogram && Array.isArray(s.planogram.bays) ? s.planogram.bays.length : 0)
      || 0;
    // A warm/default "1" is the old lie — same rule as server decideExpected.
    // Lone 1 without SI/pog/bays stays null so bulk planning and camera do not clamp.
    const trusted = explicit > 1 ? explicit : 0;
    const best = Math.max(trusted, fromBays, sections, pog);
    if (best > 0) return best;
    return null;
  }

  /* Honor a stored bay override over SI / client guesses. */
  function knownBayCountWithOverride(status, override) {
    let Assign = global.EodBayAssignLogic;
    if (!Assign && typeof require === 'function') {
      try { Assign = require('./bay-assign-logic'); } catch (_) { Assign = null; }
    }
    const fromOverride = Assign && Assign.overrideExpectedCount(override);
    if (fromOverride) return fromOverride;
    return knownBayCount(status);
  }

  /* Only for drawing a grid or a HUD label. Never for a decision. */
  function displayBayCount(status, localPhotos) {
    const known = knownBayCount(status);
    if (known) return known;
    let maxLocal = 0;
    for (const p of localPhotos || []) {
      const b = Number(p && p.bay);
      if (Number.isFinite(b) && b > maxLocal) maxLocal = b;
    }
    const remote = (status && Array.isArray(status.bays)) ? status.bays.length : 0;
    return Math.max(maxLocal, remote, 1);
  }

  function toSet(taken) {
    if (taken instanceof Set) return taken;
    return new Set((taken || []).map(Number));
  }

  /* Replace rewrites bays 1..N in order. With no resolved count there is
     nothing to clamp against, so take every file rather than drop the tail. */
  function planReplaceBays({ known, fileCount }) {
    const n = Number(fileCount) || 0;
    const cap = Number(known) > 0 ? Number(known) : n;
    const count = Math.min(Math.max(n, 0), cap);
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  /* First file to the first empty bay; a full batch fills 1..N in order. */
  function planFileBays({ known, taken, fileCount }) {
    const count = Number(fileCount) || 0;
    const takenSet = toSet(taken);
    // Unknown count must not narrow the horizon or files get discarded.
    const n = Number(known) > 0 ? Number(known) : (takenSet.size + count);
    const empties = [];
    for (let i = 1; i <= n; i += 1) {
      if (!takenSet.has(i)) empties.push(i);
    }
    if (!empties.length) {
      return Array.from({ length: count }, (_, i) => Math.min(i + 1, n));
    }
    if (count >= empties.length && takenSet.size === 0) {
      return Array.from({ length: Math.min(count, n) }, (_, i) => i + 1);
    }
    const assigned = [];
    for (let i = 0; i < count; i += 1) {
      assigned.push(empties[i] != null ? empties[i] : empties[empties.length - 1]);
    }
    return assigned;
  }

  function isOccupied(occupied, n) {
    if (occupied instanceof Set) return occupied.has(n);
    if (Array.isArray(occupied)) return occupied.map(Number).includes(n);
    return !!occupied;
  }

  /* Upload-side guard. Returns null when the capture is allowed, or the
     reason to refuse.

       full    no bay to put it on
       exists  the bay already holds a photo and the caller did not ask to
               replace it. Taking or picking a photo never replaces a bay.
       over    past the set's known bay count.

     An unknown count never caps. It used to: the cap fell back to the
     highest bay drawn so far (1 on an empty set), so a set with no count took
     bay 1 and refused bays 2, 3, 4 while the camera kept announcing them. */
  function refuseBayReason({ known, bay, replacing, maxBay, occupied }) {
    const n = Number(bay) || 0;
    if (!n) return 'full';
    if (!replacing && isOccupied(occupied, n)) return 'exists';
    const k = Number(known) > 0 ? Number(known) : 0;
    if (!k) return null;
    // Sparse overrides: active bay 4 with newCount 3 must still be allowed.
    const cap = Math.max(Number(maxBay) || 0, k);
    if (n > cap && !replacing) return 'over';
    return null;
  }

  function allTakenMessage(total) {
    const n = Number(total) || 0;
    return `All ${n} bay${n === 1 ? '' : 's'} taken`;
  }

  /* Bays a device pick lands on when the set has no count: the first free
     bay numbers, one per picked photo, never one that already holds a photo. */
  function freeBays({ taken, count }) {
    const takenSet = toSet(taken);
    const want = Math.max(0, Number(count) || 0);
    const out = [];
    for (let b = 1; out.length < want; b += 1) {
      if (!takenSet.has(b)) out.push(b);
    }
    return out;
  }

  function highestBay(taken) {
    let max = 0;
    for (const b of toSet(taken)) if (Number(b) > max) max = Number(b);
    return max;
  }

  const api = {
    knownBayCount,
    knownBayCountWithOverride,
    displayBayCount,
    planReplaceBays,
    planFileBays,
    refuseBayReason,
    allTakenMessage,
    freeBays,
    highestBay,
  };

  global.EodBayCountLogic = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
