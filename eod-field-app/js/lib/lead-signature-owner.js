/* Whose lead signature is on this phone, and whether it belongs to the selected shift's lead. */
(function (global) {
  'use strict';

  function normEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function normName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function person(p) {
    return { email: normEmail(p && p.email), name: normName(p && p.name) };
  }

  function known(p) {
    return !!(p.email || p.name);
  }

  /** The lead of a shift, from the fields the visit list carries. */
  function shiftLead(shift) {
    if (!shift) return { email: '', name: '' };
    return person({
      email: shift.visitLeadEmail || shift.leadEmail || '',
      name: shift.visitLead || shift.leadName || '',
    });
  }

  function samePerson(a, b) {
    if (a.email && b.email) return a.email === b.email;
    if (a.name && b.name) return a.name === b.name;
    return false;
  }

  /**
   * True when the signature on the phone should be dropped for this shift.
   * `signer` is who signed (recorded at signing); `fallback` stands in for a
   * signature saved before signers were recorded (this phone's owner).
   * An unknown new lead keeps the signature; an unknown signer does not.
   */
  function shouldClearSignature({ hasSignature, signer, fallback, lead }) {
    if (!hasSignature) return false;
    const want = person(lead);
    if (!known(want)) return false;
    let who = person(signer);
    if (!known(who)) who = person(fallback);
    if (!known(who)) return true;
    return !samePerson(who, want);
  }

  const api = { shiftLead, shouldClearSignature, samePerson: (a, b) => samePerson(person(a), person(b)) };

  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodLeadSignatureOwner = api;
})(typeof window !== 'undefined' ? window : globalThis);
