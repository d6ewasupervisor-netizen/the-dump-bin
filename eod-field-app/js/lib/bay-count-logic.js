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
    // A warm/default "1" is the old lie. Only keep it when nothing else is known.
    const trusted = explicit > 1 ? explicit : 0;
    const best = Math.max(trusted, fromBays, sections, pog);
    if (best > 0) return best;
    return explicit > 0 ? explicit : null;
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

  /* Upload-side guard: a set must never take more bays than it has.
     Returns null when the capture is allowed, or the reason to refuse. */
  function refuseBayReason({ known, bay, replacing }) {
    const n = Number(bay) || 0;
    if (!n) return 'full';
    const cap = Number(known) > 0 ? Number(known) : 0;
    if (cap && n > cap && !replacing) return 'over';
    return null;
  }

  const api = {
    knownBayCount,
    displayBayCount,
    planReplaceBays,
    planFileBays,
    refuseBayReason,
  };

  global.EodBayCountLogic = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
