#!/usr/bin/env node
// Headless balance check: bots play the real engine + analyzer.
//   node tools/simulate.mjs
// Manual bots slow down and slip as cards get longer; guarded bots just read the verdict.

import * as analyzer from '../lib/shell-guard.js';
import { createGuard } from '../js/guard.js';
import { Game } from '../js/engine.js';

// Reading cost grows with what is printed on the card.
const load = card => card.quest.cmd.length / 40 + card.quest.contextLines / 3 + (card.quest.composite ? 1 : 0);

const BOTS = [
  { name: 'rubber stamp', mode: 'manual', think: () => 0.8, accuracy: () => 0, allowAll: true },
  // Must die about as fast as the rubber stamp, or refusing to read is the winning strategy.
  { name: 'deny-all', mode: 'manual', think: () => 0.8, accuracy: () => 0, denyAll: true },
  { name: 'casual human', mode: 'manual', think: c => 2.2 + load(c) * 1.1, accuracy: c => 0.92 - load(c) * 0.06 },
  { name: 'careful human', mode: 'manual', think: c => 2.6 + load(c) * 1.4, accuracy: c => 0.98 - load(c) * 0.03 },
  { name: 'speed-reader', mode: 'manual', think: c => 1.4 + load(c) * 0.7, accuracy: c => 0.95 - load(c) * 0.05 },
  { name: 'casual + dry-run', mode: 'guarded', think: () => 1.1, accuracy: () => 0.985 },
];

function play(bot, seed) {
  const game = new Game({ guard: createGuard(analyzer), seed });
  game.start({ mode: bot.mode, skipTraining: true });
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  let busyUntil = 0;
  let maxQueue = 0;
  let plan = null;
  while (game.phase === 'live' && game.t < 900) {
    game.tick(50);
    maxQueue = Math.max(maxQueue, game.queue.length);
    const card = game.queue[0];
    if (!card || game.t < busyUntil) continue;
    if (plan?.id !== card.id) plan = { id: card.id, think: bot.think(card), correct: rand() < bot.accuracy(card) };
    if (game.t - card.frontSince < plan.think) continue;
    const allow = bot.allowAll ? true : bot.denyAll ? false : plan.correct ? !card.verdict.danger : card.verdict.danger;
    game.decide(card.id, allow);
    busyUntil = game.t + 0.25;   // fling animation
  }
  return { ...game.result(), maxQueue };
}

for (const bot of BOTS) {
  const runs = [1, 2, 3, 4, 5, 6].map(i => play(bot, `sim-${i}`));
  const avg = key => (runs.reduce((n, r) => n + (typeof r[key] === 'number' ? r[key] : r[key].length), 0) / runs.length).toFixed(0);
  console.log(`${bot.name.padEnd(18)} ${bot.mode.padEnd(8)} survive ${avg('seconds').padStart(3)}s  score ${avg('score').padStart(6)}  reviewed ${avg('reviewed').padStart(3)}  incidents ${avg('incidents')}  esc ${avg('escalations')}  auto ${avg('autoRuns').padStart(2)}  maxQ ${avg('maxQueue').padStart(2)}  clocks ${runs.map(r => r.clock).join(' ')}`);
}
