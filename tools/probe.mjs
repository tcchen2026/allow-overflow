#!/usr/bin/env node
// Print raw shell-guard effects for commands against the game world.
//   node tools/probe.mjs 'rm -rf "$X"/' 'npm run clean'
//   node tools/probe.mjs @commands.txt     (one command per line; avoids shell quoting)

import fs from 'node:fs';
import * as analyzer from '../lib/shell-guard.js';
import { worldSnapshot, PROJECT, BASE_ENV } from '../js/world.js';

const vfs = () => analyzer.VirtualFS.fromSnapshot(worldSnapshot(), 'linux');
const commands = process.argv.slice(2).flatMap(arg => arg.startsWith('@')
  ? fs.readFileSync(arg.slice(1), 'utf8').split(/\r?\n/).filter(Boolean)
  : [arg]);

for (const raw of commands) {
  const t0 = performance.now();
  const r = analyzer.analyzeBash(raw, { cwd: PROJECT, env: { ...BASE_ENV }, vfs: vfs() });
  const ms = (performance.now() - t0).toFixed(2);
  console.log(`\n$ ${raw}   (${ms}ms)`);
  for (const e of r.effects) console.log(`  file ${e.type.padEnd(8)} ${e.path}${e.uncertain ? '  ?' + e.uncertainty.join(',') : ''}`);
  for (const e of r.gitEffects) console.log(`  git  ${e.domain}/${e.operation} mode=${e.mode} ${e.target ?? ''}`);
  for (const e of r.resourceEffects) console.log(`  res  ${e.domain} ${e.operation} ${JSON.stringify(e.selection)}`);
  for (const w of r.warnings) console.log(`  warn ${w}`);
}
