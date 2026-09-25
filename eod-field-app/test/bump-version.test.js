'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function versionHelpers() {
  const script = path.join(__dirname, '..', 'scripts', 'bump-version.mjs');
  return import(pathToFileURL(script).href);
}

test('increments the two-digit patch version', async () => {
  const { nextVersion } = await versionHelpers();
  assert.equal(nextVersion('3.4.03'), '3.4.04');
  assert.equal(nextVersion('3.4.19'), '3.4.20');
  assert.equal(nextVersion('3.4.98'), '3.4.99');
});

test('rolls patch 99 into the middle digit', async () => {
  const { nextVersion } = await versionHelpers();
  assert.equal(nextVersion('3.3.99'), '3.4.00');
  assert.equal(nextVersion('3.4.99'), '3.5.00');
});

test('rolls middle digit 9 into the major version', async () => {
  const { nextVersion } = await versionHelpers();
  assert.equal(nextVersion('3.9.99'), '4.0.00');
});

test('canonicalizes legacy patch values above 99', async () => {
  const { canonicalVersion } = await versionHelpers();
  assert.equal(canonicalVersion('3.3.100'), '3.4.00');
  assert.equal(canonicalVersion('3.3.103'), '3.4.03');
  assert.equal(canonicalVersion('3.9.100'), '4.0.00');
});

test('rejects malformed versions', async () => {
  const { nextVersion } = await versionHelpers();
  assert.throws(() => nextVersion('3.4'), /three-part version/);
  assert.throws(() => nextVersion('v3.4.03'), /three-part version/);
});
