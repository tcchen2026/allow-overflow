#!/usr/bin/env node
// Writes qr.svg (the desktop panel's "play on your phone" code) from js/config.js SITE_URL.
//   node tools/qr.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../js/config.js';
import { qrSvg } from '../js/qr.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'qr.svg');
fs.writeFileSync(out, `${qrSvg(SITE_URL)}\n`);
console.log(`wrote ${out} for ${SITE_URL}`);
