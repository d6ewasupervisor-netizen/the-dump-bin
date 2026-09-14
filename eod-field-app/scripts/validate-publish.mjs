import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const version = JSON.parse(read('eod-version.json')).version;
const errors = [];
const expect = (ok, message) => { if (!ok) errors.push(message); };

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
