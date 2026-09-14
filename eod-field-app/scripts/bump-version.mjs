import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = path.join(root, 'eod-version.json');

export function parseVersion(version) {
  const raw = String(version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(raw)) {
    throw new Error(`Expected a three-part version, got ${version}`);
  }
  return raw.split('.').map(Number);
}

export function formatVersion([major, minor, patch]) {
  return `${major}.${minor}.${String(patch).padStart(2, '0')}`;
}

export function canonicalVersion(version) {
  let [major, minor, patch] = parseVersion(version);
  minor += Math.floor(patch / 100);
  patch %= 100;
  major += Math.floor(minor / 10);
  minor %= 10;
  return formatVersion([major, minor, patch]);
}

export function nextVersion(version) {
  const [major, minor, patch] = parseVersion(canonicalVersion(version));
  return canonicalVersion(`${major}.${minor}.${patch + 1}`);
}

function run() {
  const current = JSON.parse(fs.readFileSync(versionFile, 'utf8')).version;
  const next = process.argv[2]
    ? canonicalVersion(process.argv[2])
    : nextVersion(current);

  for (const relative of ['index.html', 'js/api.js', 'js/boot.js', 'js/lib/eod-buffering.js', 'js/lib/barcode-scanner.js', 'sw.js']) {
    const file = path.join(root, relative);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replaceAll(current, next);
    if (after === before) throw new Error(`${relative} did not contain ${current}`);
    fs.writeFileSync(file, after);
  }
  fs.writeFileSync(versionFile, `{ "version": "${next}" }\n`);
  console.log(`${current} -> ${next}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
