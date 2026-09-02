/* Four-stage workflow progress derived from the existing send gates. */
(function (global) {
  'use strict';

  const STAGES = [
    { id: 'visit', label: 'Visit', gates: ['visit', 'name', 'checkin', 'cartBefore'] },
    { id: 'categories', label: 'Categories', gates: ['sheet'] },
    { id: 'signatures', label: 'Signatures', gates: ['signature', 'checkout', 'paper'] },
    { id: 'send', label: 'Send', gates: ['recipients', 'cartAfter', 'instaworkPhoto', 'instaworkSave'] },
  ];

  function derive(S, gateApi) {
    const api = gateApi || global.EodSendGates;
    const all = api?.items?.(S) || [];
    const byId = new Map(all.map((item) => [item.id, item]));
    const firstMissing = all.find((item) => !item.ok) || null;
    let reachedOpen = false;
    const stages = STAGES.map((stage) => {
      const relevant = stage.gates.map((id) => byId.get(id)).filter(Boolean);
      const complete = relevant.length === 0 || relevant.every((item) => item.ok);
      let status = 'upcoming';
      if (complete && !reachedOpen) status = 'complete';
      else if (!reachedOpen) {
        status = 'current';
        reachedOpen = true;
      }
      return { id: stage.id, label: stage.label, status, complete };
    });
    return {
      stages,
      next: firstMissing
        ? { id: firstMissing.id, label: firstMissing.label, page: firstMissing.page, focus: firstMissing.focus || null }
        : null,
    };
  }

  const api = { STAGES, derive };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodWorkflowProgress = api;
})(typeof window !== 'undefined' ? window : globalThis);
