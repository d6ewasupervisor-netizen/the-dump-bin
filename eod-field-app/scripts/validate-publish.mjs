import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const version = JSON.parse(read('eod-version.json')).version;
const errors = [];
const expect = (ok, message) => { if (!ok) errors.push(message); };
const ship = process.argv.includes('--ship') || process.env.EOD_FIELD_PUBLISH === '1';

function findGitRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

if (ship) {
  const repo = findGitRoot(root);
  expect(!!repo, 'publish guard: no git repo');
  if (repo) {
    try {
      const porcelain = execSync('git status --porcelain', { cwd: repo, encoding: 'utf8' }).trim();
      expect(!porcelain, 'publish guard: dirty tree — refuse to publish');
      const head = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
      let main = '';
      try {
        main = execSync('git rev-parse origin/main', { cwd: repo, encoding: 'utf8' }).trim();
      } catch (_) {
        main = execSync('git rev-parse main', { cwd: repo, encoding: 'utf8' }).trim();
      }
      const base = execSync(`git merge-base ${head} ${main}`, { cwd: repo, encoding: 'utf8' }).trim();
      expect(base === main, 'publish guard: branch is not on main\'s line');
    } catch (err) {
      if (!String(err.message || '').includes('publish guard')) {
        errors.push(`publish guard: ${err.message || err}`);
      }
    }
  }
}

const index = read('index.html');
const api = read('js/api.js');
const buffering = read('js/lib/eod-buffering.js');
const boot = read('js/boot.js');
const sw = read('sw.js');

expect(new RegExp(`APP_VERSION\\s*=\\s*['"]${version.replace(/\./g, '\\.')}['"]`).test(api),
  'js/api.js APP_VERSION is out of sync');
expect(index.includes(`>v${version}</span>`), 'index.html version badge is out of sync');
expect(buffering.includes(`|| '${version}'`), 'eod-buffering fallback is out of sync');
expect(boot.includes(`sw.js?v=${version}`), 'boot service-worker registration is out of sync');
expect(sw.includes(`eod-field-${version}`), 'service-worker cache name is out of sync');
expect(sw.includes(`app.css?v=${version}`), 'service-worker core CSS is out of sync');

const localVersioned = [...index.matchAll(/\b(?:src|href)="((?:js|css|icons|assets)\/[^"]+)"/g)]
  .map((match) => match[1])
  .filter((url) => /\.(?:js|css|png|gif)(?:\?|$)/i.test(url));
for (const url of localVersioned) {
  expect(new URLSearchParams(url.split('?')[1] || '').get('v') === version,
    `index asset is not cache-busted with ${version}: ${url}`);
  expect(fs.existsSync(path.join(root, url.split('?')[0])),
    `index asset does not exist: ${url}`);
}

expect(!/<script[^>]+(?:html5-qrcode|pdf\.min|pdf-lib|materials-pdf-viewer)/i.test(index),
  'route-only scanner/PDF dependency is still eagerly loaded');
expect(/shellAssetsFromHtml/.test(sw) && /req\.destination/.test(sw),
  'service worker shell discovery/cache-on-use policy is missing');

if (errors.length) {
  console.error(errors.map((message) => `- ${message}`).join('\n'));
  process.exit(1);
}
console.log(`Publish contracts valid for ${version} (${localVersioned.length} versioned assets).`);
