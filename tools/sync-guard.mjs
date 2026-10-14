#!/usr/bin/env node
// Bundle the browser entry of the shell-guard analyzer into one file: lib/shell-guard.js.
// One ESM file (deps inlined, minified) instead of ~30 modules + an import map,
// so the page loads it in a single request.
//
//   (in vendor/atuin-shell-guard) npm run build
//   node tools/sync-guard.mjs
//
// SHELL_GUARD_DIR overrides where the analyzer checkout lives.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(here, '..');
const guardRoot = path.resolve(process.env.SHELL_GUARD_DIR ?? path.join(gameRoot, '..', 'vendor', 'atuin-shell-guard'));
const entry = path.join(guardRoot, 'dist', 'browser.js');
const outRoot = path.join(gameRoot, 'lib');
const outFile = path.join(outRoot, 'shell-guard.js');
const htmlFile = path.join(gameRoot, 'index.html');

if (!fs.existsSync(entry)) throw new Error(`missing ${entry}: run "npm run build" in ${guardRoot}`);
// The analyzer's own devDependency (npx is unreliable on this filesystem). Its native
// binary matches the OS that ran `npm install` there, so run this script on that OS.
const esbuild = await import(pathToFileURL(path.join(guardRoot, 'node_modules', 'esbuild', 'lib', 'main.js')));
let head = 'unknown';
try { head = execSync('git rev-parse --short HEAD', { cwd: guardRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* version tag is cosmetic */ }

// Build in memory first: a failed build must not leave lib/ empty.
const { outputFiles: [bundle] } = await esbuild.build({
  entryPoints: [entry],
  outfile: outFile,
  write: false,
  bundle: true,
  format: 'esm',
  platform: 'browser',      // a node: import fails the build instead of the page
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
  banner: { js: `// atuin-shell-guard ${head} · bundled by tools/sync-guard.mjs, do not edit` },
  logLevel: 'warning',
});
fs.rmSync(outRoot, { recursive: true, force: true });   // also drops the old per-module copy
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(outFile, bundle.contents);

// The import map only existed for the unbundled modules; remove it if still there.
const html = fs.readFileSync(htmlFile, 'utf8');
const next = html.replace(/\n?[ \t]*<!-- importmap:start[\s\S]*?<!-- importmap:end -->/, '');
if (next !== html) fs.writeFileSync(htmlFile, next);

const code = fs.readFileSync(outFile);
const kb = n => `${(n / 1024).toFixed(0)} KB`;
console.log(`lib/shell-guard.js @ ${head}: ${kb(code.length)} (${kb(zlib.gzipSync(code).length)} gzip)`);
const processUse = new Set(code.toString().match(/\bprocess\.[A-Za-z]+/g));
// Not fatal as long as the analyzer guards these with typeof checks.
if (processUse.size) console.log(`touches ${[...processUse].join(', ')}`);
