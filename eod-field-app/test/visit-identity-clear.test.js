'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('visit identity clear', () => {
  it('session clears local identity on visit/day change and always on reset', () => {
    const session = read('js/session.js');
    assert.match(session, /function clearLocalIdentity/);
    assert.match(session, /holdMirror: true, reason: 'patch-visit-clear'/);
    assert.match(session, /wipePersonal = true/);
    assert.match(session, /shouldSkipMirrorIdentity/);
    assert.match(session, /SIGNATURE_SIGNER_KEY/);
    // Nov 1: Fred Meyer recipient chips must not follow a store change.
    assert.match(session, /if \(\(storeMoved \|\| visitMoved\) && !\(partial && Object\.prototype\.hasOwnProperty\.call\(partial, 'emailRecipients'\)\)\)/);
    assert.match(session, /state\.emailRecipients = \[\];/);
  });

  it('visit memory does not auto-select managers or lead', () => {
    const mem = read('js/lib/visit-memory.js');
    assert.match(mem, /never auto-select/);
    assert.match(mem, /function leadNamePool/);
    assert.doesNotMatch(mem, /patch\.checkInManager = mem\.checkIn/);
  });

  it('visit page does not auto-fill lead name from the shift', () => {
    const visit = read('js/features/visit.js');
    assert.match(visit, /paintLeadNameChips/);
    assert.doesNotMatch(visit, /S\.patch\(\{ leadName: lead, profileName: lead \}, 'lead'\)/);
    assert.match(visit, /wipePersonal: true/);
    assert.match(visit, /id="resetWipePersonal" checked disabled/);
  });

  it('boot and send do not auto-select an auth/cover lead name', () => {
    const boot = read('js/boot.js');
    assert.doesNotMatch(boot, /auth-lead/);
    const send = read('js/features/send.js');
    assert.match(send, /if \(false && leadFill/);
  });

  it('sig pad can save and load the account signature copy', () => {
    const pad = read('js/lib/landscape-sig-pad.js');
    assert.match(pad, /eodLspLoadSaved/);
    assert.match(pad, /eodLspSaveCopy/);
    assert.match(pad, /EodLeadSavedSignature/);
    const client = read('js/lib/lead-saved-signature.js');
    assert.match(client, /\/api\/field-lead-signature/);
    const html = read('index.html');
    assert.match(html, /lead-saved-signature\.js/);
  });

  it('dept signatures expose a local-only clear', () => {
    const dept = read('js/features/dept-signatures.js');
    assert.match(dept, /function clearLocal/);
    assert.match(dept, /clearLocal,/);
  });
});
