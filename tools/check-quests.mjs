#!/usr/bin/env node
// Verify every quest's intended answer against the real analyzer, with and
// without noise, plus a batch of random composite chains.
//   node tools/check-quests.mjs [-v]
// Exits non-zero when the analyzer disagrees with a quest's `expect`.
// Runs against the shipped bundle, so it also verifies tools/sync-guard.mjs output.

import * as analyzer from '../lib/shell-guard.js';
import { createGuard } from '../js/guard.js';
import { QUESTS, TUTORIAL, composeQuest, dress } from '../js/quests.js';
import { Rng } from '../js/rng.js';

const verbose = process.argv.includes('-v');
const guard = createGuard(analyzer);
const rng = new Rng('check');
let failures = 0;

function check(quest, noise, label = quest.id) {
  const card = dress(quest, noise, rng);
  const verdict = guard.dryRun(card);
  const got = verdict.danger ? 'danger' : 'safe';
  const ok = got === quest.expect;
  if (!ok) failures += 1;
  if (!ok || (verbose && noise === 0)) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${quest.pool.padEnd(7)} n${noise} ${label.padEnd(14)} expect=${quest.expect.padEnd(6)} got=${got.padEnd(6)} ${quest.cmd.replace(/\n/g, ' ⏎ ')}`);
    for (const e of verdict.effects) console.log(`       ${e.bad ? '✗' : '✓'} ${e.icon} ${e.verb} ${e.target}`);
    if (verdict.loss) console.log(`       loss: ${verdict.loss.label} · ${verdict.loss.files} files`);
    if (quest.expect === 'danger' && !quest.lesson) console.log('       (missing lesson)');
  }
}

for (const quest of [...QUESTS, ...TUTORIAL]) {
  check(quest, 0);
  check(quest, 4);
}

let combos = 0;
for (let i = 0; i < 400; i++) {
  const quest = composeQuest(rng, i % 2 === 0, i % 5);
  check(quest, i % 5, 'combo');
  combos += 1;
}

const { commands, ms } = guard.stats();
const pools = ['normal', 'hard', 'extreme'].map(pool => {
  const qs = QUESTS.filter(q => q.pool === pool);
  return `${pool}: ${qs.filter(q => q.expect === 'safe').length}/${qs.filter(q => q.expect === 'danger').length}`;
});
console.log(`\n${QUESTS.length} quests (safe/danger ${pools.join(', ')}) + ${combos} composites`);
console.log(`${commands} dry-runs in ${ms.toFixed(1)}ms (${(ms / commands).toFixed(2)}ms avg), ${failures} mismatch(es)`);
process.exit(failures ? 1 : 0);
