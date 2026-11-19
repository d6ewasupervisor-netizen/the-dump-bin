#!/usr/bin/env node
/**
 * Publish any branch build of the EOD field app to a PREVIEW address:
 *
 *   https://the-dump-bin.com/eod-field-app-next/
 *
 * The live app at /eod-field-app/ is never touched. Preview, test, then promote.
 *
 *   npm run publish:preview -- --ref <branch|commit> [--commit] [--push]
 *
 *   --ref     git ref holding eod-field-app/ to preview (required)
 *   --dest    folder to write (default eod-field-app-next)
 *   --commit  commit ONLY the preview folder (refuses if any live path changed)
 *   --push    push the commit to origin main (Pages deploys on a push to main)
 *
 * Run it from a clean dump-bin worktree on origin/main's line. The preview
 * copy is the shipped file set only (no tests, scripts, docs, node_modules).
 *
 * What it changes in the copy, and why:
 *   sw.js                cache name eod-field-X -> eod-preview-X, and the old-cache
 *                        sweep only touches eod-preview-*. The live worker deletes
 *                        every eod-field-* cache that is not its own, so a preview
 *                        cache named eod-field-* would be deleted by the live app.
 *   index.html           PREVIEW banner with version + source commit, noindex
 *   manifest.webmanifest own name, so it installs as a separate app
 * Service-worker scope needs no edit: boot.js registers the relative sw.js, which
 * resolves to /eod-field-app-next/sw.js and scopes to that folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = 'eod-field-app';
const SHIPPED = ['assets', 'css', 'icons', 'js', 'index.html', 'manifest.webmanifest', 'sw.js', 'eod-version.json'];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: opts.buffer ? null : 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts.exec });
}

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).trim();
const ref = arg('ref');
const destName = String(arg('dest', 'eod-field-app-next'));
const doCommit = !!arg('commit');
const doPush = !!arg('push');
const errors = [];
const fail = (m) => { errors.push(m); };

if (!ref || ref === true) {
  console.error('usage: npm run publish:preview -- --ref <branch|commit> [--commit] [--push]');
  process.exit(2);
}
if (destName === LIVE_DIR || destName.startsWith(`${LIVE_DIR}/`) || destName.includes('..')) {
  console.error(`refusing to write ${destName}: the live folder is never a destination`);
  process.exit(2);
}

const DEST = path.join(REPO, destName);
const sourceCommit = git(['rev-parse', '--short', `${ref}^{commit}`]).trim();

if (doCommit || doPush) {
  const dirty = git(['status', '--porcelain']).trim();
  if (dirty) fail(`dirty tree, refusing to publish:\n${dirty}`);
  const head = git(['rev-parse', 'HEAD']).trim();
  const main = git(['rev-parse', 'origin/main']).trim();
  if (git(['merge-base', head, main]).trim() !== main) fail("HEAD is not on origin/main's line");
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

// 1. Read the shipped files at the ref (binary safe).
const listed = git(['ls-tree', '-r', '--name-only', ref, '--', LIVE_DIR]).split('\n').filter(Boolean);
const wanted = listed.filter((p) => {
  const rel = p.slice(LIVE_DIR.length + 1);
  return SHIPPED.some((s) => rel === s || rel.startsWith(`${s}/`));
});
if (!wanted.length) { console.error(`no ${LIVE_DIR}/ files at ${ref}`); process.exit(1); }

// 2. Write the copy.
fs.rmSync(DEST, { recursive: true, force: true });
for (const p of wanted) {
  const rel = p.slice(LIVE_DIR.length + 1);
  const out = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, git(['show', `${ref}:${p}`], { buffer: true }));
}

const read = (rel) => fs.readFileSync(path.join(DEST, rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(path.join(DEST, rel), text);
const version = JSON.parse(read('eod-version.json')).version;

// 3. Own cache namespace. The live sw.js deletes eod-field-* caches that are not its own.
let sw = read('sw.js');
const cacheRe = /const CACHE = 'eod-field-([^']+)';/;
if (!cacheRe.test(sw)) fail('sw.js: CACHE constant not found');
sw = sw.replace(cacheRe, "const CACHE = 'eod-preview-$1'; // preview copy: its own cache prefix, outside what the live worker sweeps");
const sweepRe = /k\.startsWith\('eod-field-'\) && k !== CACHE/;
if (!sweepRe.test(sw)) fail('sw.js: cache sweep not found');
sw = sw.replace(sweepRe, "k.startsWith('eod-preview-') && k !== CACHE");
if (/eod-field-/.test(sw.replace(/eod-field-app/g, ''))) fail('sw.js still names an eod-field-* cache');
write('sw.js', sw);

// 4. Banner, title, noindex.
let html = read('index.html');
if (!/<body>/.test(html)) fail('index.html: <body> not found');
const banner = `<body>
<style>#eodPreviewBanner{position:fixed;top:0;left:0;right:0;z-index:2147483647;height:20px;line-height:20px;background:#b45309;color:#fff;text-align:center;font:700 12px system-ui,sans-serif;letter-spacing:.04em;pointer-events:none}body{padding-top:20px}</style>
<div id="eodPreviewBanner" role="status">PREVIEW v${version} · ${sourceCommit} · not the live app</div>`;
html = html.replace('<body>', banner);
if (/<title>/.test(html)) html = html.replace('<title>', '<title>PREVIEW ');
if (/<head>/.test(html)) html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex,nofollow">');
write('index.html', html);

// 5. Own install identity.
const manifest = JSON.parse(read('manifest.webmanifest'));
manifest.name = `KOMPASS EOD PREVIEW ${version}`;
manifest.short_name = 'EOD PREVIEW';
write('manifest.webmanifest', `${JSON.stringify(manifest, null, 2)}\n`);

write('preview-build.json', `${JSON.stringify({ version, sourceRef: String(ref), sourceCommit, builtAt: new Date().toISOString() }, null, 2)}\n`);

// 6. Every relative asset index.html names must be in the copy.
for (const m of html.matchAll(/\b(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/gi)) {
  const v = m[1];
  if (!v || /^(?:https?:|data:|blob:|mailto:|tel:|\/)/i.test(v)) continue;
  if (!fs.existsSync(path.join(DEST, v.replace(/^\.\//, '')))) fail(`index.html references ${v}, which is not in the preview copy`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

// 7. The live folder must be untouched.
const liveTouched = git(['status', '--porcelain', '--', LIVE_DIR]).trim();
if (liveTouched) { console.error(`the live folder changed:\n${liveTouched}`); process.exit(1); }

console.log(JSON.stringify({ built: destName, version, sourceRef: String(ref), sourceCommit, files: wanted.length + 1 }));

if (doCommit) {
  git(['add', '--', destName]);
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const bad = staged.filter((f) => !f.startsWith(`${destName}/`));
  if (bad.length) { git(['reset', '-q']); console.error(`refusing: staged paths outside ${destName}/:\n${bad.join('\n')}`); process.exit(1); }
  if (!staged.length) { console.log('preview already current: nothing to commit'); process.exit(0); }
  git(['commit', '-q', '-m', `Preview ${version} (${sourceCommit}) at /${destName}/. Live /${LIVE_DIR}/ unchanged.`]);
  const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').filter(Boolean);
  if (changed.some((f) => f === LIVE_DIR || f.startsWith(`${LIVE_DIR}/`))) {
    console.error('the commit touches the live folder; not pushing');
    process.exit(1);
  }
  console.log(JSON.stringify({ committed: git(['rev-parse', '--short', 'HEAD']).trim(), files: changed.length }));
}
if (doPush) {
  git(['push', 'origin', 'HEAD:main']);
  console.log('pushed to origin main; Pages deploys on a push to main');
}
