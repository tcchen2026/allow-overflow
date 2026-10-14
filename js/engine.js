// Game rules and clock. Pure state + events; no DOM.
//
// Every request is a card with its own patience fuse. When a fuse burns out the
// agent runs the command anyway. Spawn rate and patience ramp with time; danger,
// context noise and chain length ramp with cards dealt. The queue opens with a
// flood and never drains below a floor, so a human reviewer always loses eventually.
//
// Two modes share the same daily seed, so they see the same requests:
//   manual  — the player reads commands and context. Ends on the third lost life
//             (dangerous work that ran, or the same honest request denied twice).
//   guarded — every card arrives already dry-run. Ends at 18:00 (clock-out).

import { Rng } from './rng.js';
import { AGENTS, QUESTS, QUIPS, TUTORIAL, composeQuest, dress } from './quests.js';

export const MAX_LIVES = 3;
export const QUEUE_CAP = 12;          // beyond this the most impatient agent just runs it
const START_AGENTS = 3;
const CALM_CARDS = 4;                 // quiet morning: one easy card at a time, no fuse
const OPENING_WAVE = 5;               // then the whole team floods in at once
const MIN_SPAWN_GAP = 0.45;           // seconds between floor refills, so cards land one by one
const CLOCK_START_MIN = 9 * 60;       // 09:00
const CLOCK_MIN_PER_SEC = 3;          // one real second = three office minutes
export const SHIFT_SECONDS = (18 * 60 - CLOCK_START_MIN) / CLOCK_MIN_PER_SEC; // 18:00

const RETRY_QUIPS = ['😤 it\'s literally in scope', 'asking again…', 'pls I\'m blocked', 'why tho 🥲', 'my manager is watching'];

// Pressure ramps with seconds since the flood: how fast cards come and how long agents wait.
const curve = {
  spawnGap: t => 1600 + 2200 * Math.exp(-t / 60),        // 3.8s → ~1.6s (a dry-run reviewer keeps up)
  fuse: t => 8000 + 12000 * Math.exp(-t / 90),           // 20s  → ~8s
  floor: t => Math.min(6, 3 + Math.floor(t / 30)),       // the queue never drains below this
};

// Content ramps with card index n, so card #n is identical in every mode
// no matter how fast the player clears the queue.
const deck = {
  danger: n => 0.36 + 0.18 * (1 - Math.exp(-n / 40)),   // 36% → 54%
  // Pool odds: all normal at first, hard from ~card 5, extreme from ~card 15. Normal never
  // drops below ~15%, so easy cards keep turning up and the pile never feels scripted.
  pools: n => {
    const hard = 0.45 * clamp01((n - 4) / 12);
    const extreme = 0.4 * clamp01((n - 14) / 20);
    return { normal: 1 - hard - extreme, hard, extreme };
  },
  noise: n => Math.min(4, Math.floor(n / 9)),
  agents: n => Math.min(AGENTS.length, START_AGENTS + Math.floor(n / 6)),
};

const clamp01 = x => Math.max(0, Math.min(1, x));

const MOODS = [
  [0, 'all hands'], [30, 'busy'], [70, 'crunch'], [110, 'chaos'], [150, 'meltdown'], [200, 'heat death'],
];

export class Game extends EventTarget {
  constructor({ guard, seed }) {
    super();
    this.guard = guard;
    this.seed = seed;
    this.mode = 'manual';
    this.reset();
  }

  reset() {
    this.rng = new Rng(this.seed);
    this.phase = 'idle';
    this.queue = [];
    this.lives = MAX_LIVES;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.t = 0;                  // live seconds (drives the office clock)
    this.waveAt = Infinity;      // when the flood hit; pressure curves start here
    this.calmLeft = 0;           // quiet-morning cards still to resolve
    this.nextSpawn = Infinity;
    this.lastSpawn = -Infinity;
    this.floorFrom = Infinity;
    this.spawned = 0;            // live cards dealt so far; seeds each card's content
    this.nextRush = Infinity;
    this.agentCount = START_AGENTS;
    this.tutorialStep = 0;
    this.seq = 0;
    this.recent = [];
    this.history = [];           // one entry per resolved card, for the share grid
    this.incidents = [];         // dangerous work that ran (a life each)
    this.escalations = [];       // honest work denied twice (a life each)
    this.lastLoss = null;        // whichever of the two took the latest life
    this.saved = [];
    this.retries = 0;
    this.timers = [];            // game-time callbacks, so pausing pauses them too
    this.endReason = null;
    this.dry = { commands: 0, ms: 0 };  // this run's analyzer work, for the punchline
  }

  later(seconds, fn) {
    this.timers.push({ at: this.t + seconds, fn });
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  start({ mode = 'manual', skipTraining = false } = {}) {
    this.mode = mode;
    this.reset();
    if (skipTraining || mode === 'guarded') this.goLive();
    else {
      this.phase = 'training';
      this.pushTutorial();
      this.emit('phase', { phase: this.phase });
    }
  }

  /** Returning players can bail out of training. */
  skipTutorial() {
    if (this.phase !== 'training') return;
    this.queue = [];
    this.goLive();
  }

  goLive() {
    // Reseed so training never shifts the stream: both modes get identical requests.
    this.rng = new Rng(this.seed);
    this.phase = 'live';
    this.t = 0;
    this.emit('phase', { phase: 'live' });

    // Quiet morning: a few easy cards, dealt one at a time, nothing auto-runs.
    // The player gets to feel competent before the flood.
    this.calmLeft = CALM_CARDS;
    this.later(0.5, () => this.spawn({ calm: true }));
  }

  /** Opening flood: the whole team piles in at once. */
  startWave() {
    this.waveAt = this.t;
    this.emit('wave', { count: OPENING_WAVE });
    // Later cards in the wave get extra patience so the burst is scary but survivable.
    for (let i = 0; i < OPENING_WAVE; i++) {
      this.later(0.5 + i * 0.2, () => this.spawn({ fuseBonus: i * 2500 }));
    }
    this.floorFrom = this.t + 0.5 + OPENING_WAVE * 0.2;
    this.nextSpawn = this.floorFrom + 3;
    this.nextRush = this.t + 60;
  }

  /** Seconds of pressure so far (0 until the flood). */
  get pt() {
    return Math.max(0, this.t - this.waveAt);
  }

  /** Advance by dt milliseconds. */
  tick(dt) {
    if (this.phase !== 'live') return;
    this.t += dt / 1000;

    const due = this.timers.filter(timer => timer.at <= this.t);
    this.timers = this.timers.filter(timer => timer.at > this.t);
    for (const timer of due) timer.fn();

    // Fuses burn on every card, front and back.
    for (const card of [...this.queue]) {
      card.left -= dt;
      if (card.left <= 0) this.resolve(card, { allow: true, auto: true });
      if (this.phase !== 'live') return;
    }

    if (this.mode === 'guarded' && this.t >= SHIFT_SECONDS) {
      this.end('clocked-out');
      return;
    }

    if (this.t >= this.nextSpawn) {
      this.spawn();
      const gap = curve.spawnGap(this.pt) * (0.75 + this.rng.next() * 0.5);
      this.nextSpawn = this.t + gap / 1000;
    } else if (this.t >= this.floorFrom && this.queue.length < curve.floor(this.pt)
      && this.t - this.lastSpawn >= MIN_SPAWN_GAP) {
      // Clearing the pile only buys a breath: someone else is always waiting.
      this.spawn();
    }

    // Periodic rush: a burst of requests on top of the normal flow.
    if (this.t >= this.nextRush) {
      this.nextRush += 55;
      this.emit('rush', {});
      for (let i = 0; i < 3 + Math.floor(this.pt / 90); i++) {
        this.later(0.8 + i * 0.45, () => this.spawn());
      }
    }
  }

  // ── player actions ───────────────────────────────────────────────────────

  decide(cardId, allow) {
    const card = this.queue.find(c => c.id === cardId);
    if (!card) return false;
    if (this.phase === 'training') return this.trainingDecide(card, allow);
    if (this.phase !== 'live') return false;
    this.resolve(card, { allow, auto: false });
    return true;
  }

  /** Tap a waiting card: it swaps places with the current front card. */
  bringToFront(cardId) {
    const i = this.queue.findIndex(c => c.id === cardId);
    if (i <= 0) return;
    [this.queue[0], this.queue[i]] = [this.queue[i], this.queue[0]];
    this.queue[0].frontSince = this.t;
    this.emit('reorder', {});
  }

  // ── internals ────────────────────────────────────────────────────────────

  pushTutorial() {
    const quest = TUTORIAL[this.tutorialStep];
    const agent = AGENTS.find(a => a.id === quest.agent);
    this.addCard(dress(quest, 0, this.rng), agent, { fuse: Infinity, quip: quest.quip ?? 'hi!' });
  }

  trainingDecide(card, allow) {
    if (allow === card.verdict.danger) {
      this.emit('training-miss', { card, reason: allow ? 'boom' : 'blocked' });
      return false;
    }
    this.queue.shift();
    this.emit('resolve', { card, allow, outcome: allow ? 'ok' : 'saved', points: 0, training: true });
    this.tutorialStep += 1;
    if (this.tutorialStep < TUTORIAL.length) this.pushTutorial();
    else this.goLive();
    return true;
  }

  spawn({ fuseBonus = 0, calm = false } = {}) {
    if (this.phase !== 'live') return;
    const n = this.spawned++;
    this.lastSpawn = this.t;
    // Per-card stream: content depends only on (seed, n), never on timing.
    const rng = new Rng(`${this.seed}#${n}`);
    const wantDanger = rng.chance(deck.danger(n));
    const noise = deck.noise(n);
    const odds = deck.pools(n);
    const roll = rng.next();
    const pool = roll < odds.normal ? 'normal' : roll < odds.normal + odds.hard ? 'hard' : 'extreme';

    let quest;
    if (pool === 'extreme' && rng.chance(0.4)) {
      quest = composeQuest(rng, wantDanger, noise);   // long chains live in the extreme pool too
    } else {
      const cards = QUESTS.filter(q => q.pool === pool && (q.expect === 'danger') === wantDanger);
      quest = rng.pick(cards);
      for (let i = 0; i < 8 && this.recent.includes(quest.id); i++) quest = rng.pick(cards);
      this.recent = [quest.id, ...this.recent].slice(0, 16);
    }

    const agents = deck.agents(n);
    if (agents > this.agentCount) {
      this.agentCount = agents;
      this.emit('agent-join', { agent: AGENTS[agents - 1] });
    }
    const card = dress(quest, noise, rng);
    const agent = AGENTS[rng.int(0, this.agentCount - 1)];
    const quip = quest.quip && rng.chance(0.7) ? quest.quip : rng.pick(QUIPS);
    // Longer cards get a little more patience, never enough.
    const fuse = calm ? Infinity : curve.fuse(this.pt) + card.cmd.length * 25 + card.contextLines * 150 + fuseBonus;
    this.addCard(card, agent, { fuse, quip, calm });

    // Overflow: the most impatient agent stops waiting.
    if (this.queue.length > QUEUE_CAP) {
      const victim = this.queue.slice(1).reduce((a, b) => (b.left < a.left ? b : a));
      this.resolve(victim, { allow: true, auto: true });
    }
  }

  addCard(quest, agent, { fuse, quip, retry = false, calm = false }) {
    const card = {
      id: `c${++this.seq}`,
      quest,
      agent,
      quip,
      retry,
      calm,                                // quiet-morning card: no fuse
      verdict: this.guard.dryRun(quest),   // real shell-guard analysis
      dry: this.mode === 'guarded',        // guarded mode shows it on arrival
      fuse,
      left: fuse,
      frontSince: this.t,
    };
    this.dry.commands += 1;
    this.dry.ms += card.verdict.ms;
    this.queue.push(card);
    this.emit('spawn', { card });
    return card;
  }

  resolve(card, { allow, auto }) {
    const i = this.queue.indexOf(card);
    if (i < 0) return;
    this.queue.splice(i, 1);
    if (i === 0 && this.queue[0]) this.queue[0].frontSince = this.t;

    const danger = card.verdict.danger;
    let outcome;
    let points = 0;

    if (allow && danger) {
      outcome = auto ? 'auto-boom' : 'boom';
      this.lives -= 1;
      this.streak = 0;
      this.incidents.push(this.lastLoss = { card, auto, at: this.clock, kind: 'incident' });
    } else if (allow && auto) {
      outcome = 'auto';       // harmless, but nobody reviewed it
      this.streak = 0;
    } else if (allow === !danger) {
      outcome = danger ? 'saved' : 'ok';
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      const base = danger ? 150 + (card.verdict.loss?.pain ?? 5) * 10 : 100;
      const thinking = this.t - card.frontSince;
      const speed = Math.max(0, Math.round((3 - thinking) * 20));
      points = Math.round(base * this.multiplier) + speed;
      this.score += points;
      if (danger) this.saved.push(card);
    } else if (card.retry) {
      // Denied the same honest work twice: the agent escalates. Without this, denying
      // everything unread is the safest strategy in the game (tools/simulate.mjs: deny-all).
      outcome = 'escalated';
      this.lives -= 1;
      this.streak = 0;
      this.escalations.push(this.lastLoss = { card, auto: false, at: this.clock, kind: 'escalation' });
    } else {
      // Denied honest work once: costs points, and the agent asks again, growing the pile.
      outcome = 'blocked';
      this.streak = 0;
      this.score = Math.max(0, this.score - 50);
      points = -50;
      this.later(0.9, () => {
        const quip = RETRY_QUIPS[this.retries++ % RETRY_QUIPS.length];
        const fuse = card.calm ? Infinity : curve.fuse(this.pt);
        this.addCard(card.quest, card.agent, { fuse, quip, retry: true, calm: card.calm });
      });
    }

    this.history.push(outcome);
    this.emit('resolve', { card, allow, auto, outcome, points });
    if (this.lives <= 0) {
      this.end('incidents');
      return;
    }

    // Quiet morning: the next easy card arrives only after this one is handled.
    if (card.calm && !card.retry) {
      this.calmLeft -= 1;
      if (this.calmLeft > 0) this.later(0.6, () => this.spawn({ calm: true }));
      else this.later(0.9, () => this.phase === 'live' && this.startWave());
    }
  }

  end(reason) {
    this.phase = 'over';
    this.endReason = reason;
    this.emit('over', { result: this.result() });
  }

  get multiplier() {
    return 1 + Math.min(3, Math.floor(this.streak / 4) * 0.5);
  }

  get clock() {
    const total = CLOCK_START_MIN + Math.floor(this.t * CLOCK_MIN_PER_SEC);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get mood() {
    if (this.phase === 'training') return 'training';
    if (this.waveAt === Infinity) return 'quiet morning';
    let label = MOODS[0][1];
    for (const [at, name] of MOODS) if (this.pt >= at) label = name;
    return label;
  }

  get snapshot() {
    return {
      mode: this.mode,
      phase: this.phase,
      queue: this.queue,
      lives: this.lives,
      score: this.score,
      streak: this.streak,
      multiplier: this.multiplier,
      clock: this.clock,
      mood: this.mood,
      shiftLeft: this.mode === 'guarded' ? Math.max(0, SHIFT_SECONDS - this.t) : null,
      pressure: Math.min(1, this.queue.length / QUEUE_CAP),
      tutorial: this.phase === 'training' ? TUTORIAL[this.tutorialStep] : null,
      tutorialStep: this.tutorialStep,
      tutorialSteps: TUTORIAL.length,
    };
  }

  result() {
    const reviewed = this.history.filter(h => h !== 'auto' && h !== 'auto-boom').length;
    const correct = this.history.filter(h => h === 'ok' || h === 'saved').length;
    const incident = ({ card, auto, at, kind }) => ({
      kind,
      cmd: card.quest.cmd,
      intent: card.quest.intent,
      agent: card.agent,
      loss: card.verdict.loss,
      effects: card.verdict.effects,
      ms: card.verdict.ms,
      lesson: card.quest.lesson,
      auto,
      at,
    });
    return {
      mode: this.mode,
      reason: this.endReason,
      seed: this.seed,
      score: this.score,
      clock: this.clock,
      seconds: Math.round(this.t),
      reviewed,
      correct,
      accuracy: reviewed ? correct / reviewed : 0,
      bestStreak: this.bestStreak,
      saved: this.saved.length,
      savedFiles: this.saved.reduce((n, c) => n + (c.verdict.loss?.files ?? 0), 0),
      autoRuns: this.history.filter(h => h === 'auto' || h === 'auto-boom').length,
      blocked: this.history.filter(h => h === 'blocked').length,
      incidents: this.incidents.map(incident),
      escalations: this.escalations.map(incident),
      death: this.lastLoss ? incident(this.lastLoss) : null,
      history: [...this.history],
      guard: { ...this.dry },
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
