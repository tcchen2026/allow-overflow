#!/usr/bin/env node
// Turn a CDP Page.captureScreenshot result into new_game/og.png.
//   node tools/og-capture.mjs <cdp-result.json | base64.txt> [out.png]
// The capture itself is taken from tools/og.html at 1200×630, scale 1.
// An explicit out path makes this a generic "CDP screenshot → PNG" helper.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) throw new Error('usage: og-capture.mjs <cdp-result.json | base64.txt>');
const raw = fs.readFileSync(src, 'utf8').trim();
// Accept either the raw base64 or the JSON the CDP tool saved ({ data: "..." }).
const b64 = raw.startsWith('{') ? JSON.parse(raw).data : raw;
const png = Buffer.from(b64, 'base64');
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
const out = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'og.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${w}×${h}, ${(png.length / 1024).toFixed(0)} KB)`);
