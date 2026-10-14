// Boot + screen flow. Wires the engine, deck, effects and sharing together.
//
// Story of one session:
//   1. manual shift  — you review commands by reading them. The pile wins.
//   2. game over     — "what went wrong": incidents and escalations, with their real effects.
//   3. guarded shift — same daily requests, every card arrives dry-run (PROMO only).
//   4. compare (PROMO only) + share.
import * as analyzer from '../lib/shell-guard.js';
import { createGuard } from './guard.js';
import { Game, MAX_LIVES } from './engine.js';
import { Deck, highlight } from './deck.js';
import { fx } from './fx.js';
import { dailyInfo } from './rng.js';
import { challengeText, copyText, emojiGrid, fmt, imageFile, imageName, rank, readChallenge, renderCard } from './share.js';
import { PROMO } from './config.js';
import { store } from './store.js';

const $ = id => document.getElementById(id);
const app = $('app');
document.documentElement.classList.toggle('promo', PROMO);  // drives [data-promo] in CSS
const daily = dailyInfo();

const game = new Game({ guard: createGuard(analyzer), seed: daily.seed });
const deck = new Deck({
  stack: $('stack'),
  template: $('tpl-card'),
  onDecide: (id, allow) => decide(id, allow),
  onFront: id => { game.bringToFront(id); fx.sound('swipe'); },
  onArm: () => fx.buzz(8),
});

const results = { manual: null, guarded: null };
const session = { tutorialDone: false, floodHinted: false };  // per page load, on purpose
let rafId = 0;

// ── screens ────────────────────────────────────────────────────────────────

function show(screen) {
  app.dataset.screen = screen;
}

function setupTitle() {
  $('daily-badge').textContent = `Daily #${daily.number}`;
  const best = Number(store.get(`best:${daily.number}`, 0));
  $('best-line').textContent = best ? `Today's best: ${fmt(best)} pts` : '';

  const challenge = readChallenge();
  if (challenge) {
    const el = $('challenge');
    el.hidden = false;
    el.innerHTML = `🔥 A friend survived until <b>${challenge.clock ?? '??:??'}</b> with <b>${fmt(challenge.score)}</b> pts. Beat it.`;
  }

  // Decorative pile on the title: the pressure, before you even start.
  const samples = [
    ['🦊', 'rm -rf ~/', 22], ['🐙', 'npm run clean', 188], ['🐝', 'git clean -fdx', 46],
    ['🦄', 'rm -rf "$BUILD_DIR"/', 318], ['🤖', 'chmod -R 777 ~', 265],
  ];
  $('title-deck').innerHTML = samples.map(([avatar, cmd, hue], i) => `
    <div class="mini" style="--hue:${hue};--i:${i};--s:${i % 2 ? 1 : -1}">
      <span>${avatar}</span><code>${highlight(cmd)}</code>
    </div>`).join('');
}

function startGame(mode = 'manual') {
  fx.unlock();
  deck.clear();
  $('toasts').replaceChildren();
  app.dataset.mode = mode;
  show('game');
  // Every visit's first manual shift opens with the tutorial (skippable).
  game.start({ mode, skipTraining: session.tutorialDone });
  renderMode(mode);
  renderHud();
  deck.sync(game.snapshot);
  updateCoach();
  cancelAnimationFrame(rafId);
  let last = performance.now();
  const loop = now => {
    // Clamp so a backgrounded tab doesn't burn every fuse at once.
    const dt = Math.min(100, now - last);
    last = now;
    game.tick(dt);
    const snap = game.snapshot;
    deck.frame(snap);
    renderClock(snap);
    if (game.phase !== 'over') rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// ── actions ────────────────────────────────────────────────────────────────

function decide(id, allow) {
  if (game.decide(id, allow)) fx.sound('swipe');
}

function act(allow) {
  const card = game.queue[0];
  if (card) decide(card.id, allow);
}

$('btn-start').addEventListener('click', () => startGame('manual'));
$('btn-retry').addEventListener('click', () => startGame('manual'));
$('btn-guarded').addEventListener('click', ev => startGame(ev.currentTarget.dataset.next));
$('btn-allow').addEventListener('click', () => act(true));
$('btn-deny').addEventListener('click', () => act(false));
$('btn-mute').addEventListener('click', () => {
  fx.setMuted(!fx.muted);
  fx.unlock();
  $('btn-mute').textContent = fx.muted ? '🔇' : '🔊';
});
$('btn-mute').textContent = fx.muted ? '🔇' : '🔊';
// ── challenge sheet: result card + QR, and copyable text + link, at the same time ──

let shareImage = Promise.resolve(null);   // rendered when the game-over screen opens
let shareFile = null;                     // set when this browser can share image files
let cardUrl = '';

async function openShare() {
  const share = shareable();
  const text = challengeText(share);
  $('share-text').value = text;
  $('copy-text').textContent = '📋 Copy text & link';
  $('share-sheet').hidden = false;

  const blob = await shareImage;
  if (cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = blob ? URL.createObjectURL(blob) : '';
  $('share-card-part').hidden = !blob;            // no canvas: the text still works
  $('share-card').src = cardUrl;
  $('save-image').href = cardUrl;
  $('save-image').download = imageName(share);
  shareFile = imageFile(share, blob);
  $('share-image').hidden = !shareFile;           // in-app browsers: save or long-press instead
}

function closeShare() {
  $('share-sheet').hidden = true;
}

$('btn-share').addEventListener('click', openShare);
$('share-close').addEventListener('click', closeShare);
$('share-sheet').addEventListener('click', ev => { if (ev.target === ev.currentTarget) closeShare(); });
$('share-image').addEventListener('click', async () => {
  try {
    await navigator.share({ files: [shareFile], text: $('share-text').value });
  } catch { /* closed or refused: saving and copying are still right here */ }
});
$('copy-text').addEventListener('click', async () => {
  const ok = await copyText($('share-text').value);
  if (!ok) $('share-text').select();              // last resort: the text is selected for a manual copy
  $('copy-text').textContent = ok ? '✅ Copied. Paste it anywhere' : 'Selected above: copy it manually';
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !$('share-sheet').hidden) { closeShare(); return; }
  if (app.dataset.screen === 'title' && ev.key === 'Enter') { startGame('manual'); return; }
  if (app.dataset.screen !== 'game') return;
  if (ev.key === 'ArrowRight' || ev.key === 'l') act(true);
  else if (ev.key === 'ArrowLeft' || ev.key === 'h') act(false);
});

/** What gets posted: both runs when the player has played both. */
function shareable() {
  return { daily: daily.number, manual: results.manual, guarded: results.guarded };
}

// ── engine events ──────────────────────────────────────────────────────────

game.addEventListener('spawn', ({ detail: { card } }) => {
  deck.sync(game.snapshot);
  renderHud();
  if (game.phase === 'training') updateCoach();   // the new tutorial card exists now
  if (game.phase === 'live') fx.sound('spawn', game.snapshot.pressure);
  if (card.retry) fx.buzz(15);
  // Each card of the opening flood lands with a thud.
  if (app.classList.contains('is-flood')) {
    fx.shake('soft');
    fx.buzz(25);
  }
});

let waveTimer = 0;
game.addEventListener('wave', ({ detail: { count } }) => {
  const wave = $('wave');
  $('wave-kicker').textContent = game.mode === 'guarded' ? 'SAME FLOOD · DRY-RUN ON' : `${game.clock} · EVERYONE'S ONLINE`;
  $('wave-sub').textContent = game.mode === 'guarded'
    ? `${count} requests · every one already dry-run 🛡️`
    : `${count} requests. 1 of you.`;
  // Restart the CSS animations even if the banner was shown last run.
  wave.hidden = true;
  void wave.offsetWidth;
  wave.hidden = false;
  app.classList.add('is-flood');
  fx.sound('rush');
  fx.buzz([60, 40, 60, 40, 120]);
  clearTimeout(waveTimer);
  waveTimer = setTimeout(() => {
    wave.hidden = true;
    app.classList.remove('is-flood');
    // First flood of the visit: explain the two new rules once.
    if (game.mode === 'manual' && !session.floodHinted && game.phase === 'live') {
      session.floodHinted = true;
      setCoach('<span class="coach__dir">⏱ The ring is each agent\'s patience</span>'
        + '<span class="coach__why">At 0 they run it <b>without you</b>. Tap a card behind to pull it forward.</span>');
      setTimeout(() => { if (game.phase === 'live') $('coach').hidden = true; }, 5000);
    }
  }, 2000);
});

game.addEventListener('reorder', () => deck.sync(game.snapshot));

game.addEventListener('resolve', ({ detail }) => {
  const { card, allow, auto, outcome, points, training } = detail;
  deck.fling(card.id, allow, { auto });
  deck.sync(game.snapshot);
  renderHud();
  if (training) {
    fx.sound(outcome === 'saved' ? 'saved' : 'allow');
    fx.buzz(10);
    fx.flash('good');
    return;
  }
  feedback(card, outcome, points);
});

game.addEventListener('training-miss', ({ detail: { card } }) => {
  deck.snapBack(card.id);
  fx.sound('nope');
  fx.buzz([30, 40, 30]);
  updateCoach({ miss: true });
});

game.addEventListener('phase', ({ detail: { phase } }) => {
  renderHud();
  if (phase === 'live') {
    if (game.mode === 'manual') session.tutorialDone = true;
    fx.toast(game.mode === 'guarded'
      ? '🛡️ Same shift. This time every request arrives <b>dry-run</b>.'
      : '☕ Quiet morning. Take your time.', 'info', 2600);
  }
  updateCoach();
});

game.addEventListener('rush', () => {
  fx.sound('rush');
  fx.buzz([40, 60, 40]);
  fx.toast('🚨 <b>Sprint deadline!</b> Every agent wants approval NOW', 'warn', 2400);
  app.classList.add('is-rush');
  setTimeout(() => app.classList.remove('is-rush'), 2600);
});

game.addEventListener('agent-join', ({ detail: { agent } }) => {
  fx.toast(`${agent.avatar} <b>${agent.name}</b> joined the swarm`, 'info', 1800);
});

game.addEventListener('over', ({ detail: { result } }) => {
  results[result.mode] = { ...result, daily: daily.number };
  fx.sound(result.reason === 'clocked-out' ? 'saved' : 'over');
  setTimeout(() => renderOver(result.mode), result.reason === 'clocked-out' ? 300 : 1100);
});

// ── feedback ───────────────────────────────────────────────────────────────

function feedback(card, outcome, points) {
  const score = $('hud-score').getBoundingClientRect();
  const fx_x = score.left + score.width / 2;
  const fx_y = score.bottom + 6;
  const loss = card.verdict.loss;
  switch (outcome) {
    case 'ok':
      fx.sound('allow');
      fx.buzz(8);
      fx.float(`+${points}`, fx_x, fx_y, 'good');
      break;
    case 'saved':
      fx.sound('saved');
      fx.buzz([10, 30, 10]);
      fx.float(`+${points}`, fx_x, fx_y, 'good');
      fx.toast(`🛡️ Saved <b>${esc(loss?.label ?? 'the day')}</b>${loss?.files > 1 ? ` · ${fmt(loss.files)} files` : ''}`, 'good', 1800);
      break;
    case 'blocked':
      fx.sound('blocked');
      fx.float(`${points}`, fx_x, fx_y, 'bad');
      fx.toast(`😤 ${card.agent.avatar} ${card.agent.name} was only trying to <i>${esc(card.quest.intent.toLowerCase())}</i>.<br><small>It'll ask again. Deny it twice = −1 ♥</small>`, 'warn', 2600);
      break;
    case 'escalated':
      fx.sound('boom');
      fx.shake('soft');
      fx.flash('bad');
      fx.buzz([60, 40, 60]);
      fx.toast(`🔥 <b>${card.agent.avatar} ${card.agent.name} escalated to your manager</b><br><small>You blocked the same safe request twice. It only wanted to <i>${esc(card.quest.intent.toLowerCase())}</i>.</small>`, 'bad', 3600);
      break;
    case 'auto':
      fx.toast(`⏱️ ${card.agent.avatar} ${card.agent.name} got tired of waiting and ran it`, 'muted', 1600);
      break;
    case 'boom':
    case 'auto-boom': {
      fx.sound('boom');
      fx.shake('hard');
      fx.flash('bad');
      fx.buzz([90, 50, 160]);
      const who = outcome === 'auto-boom' ? `${card.agent.avatar} ${card.agent.name} stopped waiting and ran it.` : 'You approved it.';
      const files = loss ? ` · ${fmt(loss.files)} file${loss.files === 1 ? '' : 's'}` : '';
      fx.toast(`💥 <b>${esc(loss?.label ?? 'Something')}</b> is gone${files}<br><small>${who} ${esc(card.quest.lesson ?? '')}</small>`, 'bad', 4200);
      break;
    }
  }
}

// ── HUD ────────────────────────────────────────────────────────────────────

function renderMode(mode) {
  const guarded = mode === 'guarded';
  $('mode-badge').innerHTML = guarded
    ? '<span class="mode__icon">🛡️</span><span class="mode__text"><b>DRY-RUN ON</b><small>review effects, not text</small></span>'
    : '<span class="mode__icon">👀</span><span class="mode__text"><b>MANUAL REVIEW</b><small>read every command</small></span>';
}

function renderHud() {
  const snap = game.snapshot;
  $('hud-lives').innerHTML = Array.from({ length: MAX_LIVES }, (_, i) =>
    `<i class="life ${i < snap.lives ? 'is-on' : ''}"></i>`).join('');

  const scoreEl = $('hud-score');
  const nextScore = fmt(snap.score);
  if (scoreEl.textContent !== nextScore) {
    scoreEl.textContent = nextScore;
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('bump');
  }
  const combo = $('hud-combo');
  combo.hidden = snap.multiplier <= 1;
  combo.textContent = `×${snap.multiplier}`;

  $('pressure-count').textContent = String(snap.queue.length);
  $('pressure-fill').style.transform = `scaleX(${snap.pressure})`;
  app.dataset.pressure = snap.pressure > 0.66 ? 'high' : snap.pressure > 0.33 ? 'mid' : 'low';
  app.dataset.phase = snap.phase;
}

function renderClock(snap) {
  const time = $('hud-time');
  if (time.textContent !== snap.clock) time.textContent = snap.clock;
  const label = snap.mode === 'guarded' && snap.phase === 'live' ? 'clock-out 18:00' : snap.mood;
  const mood = $('hud-phase');
  if (mood.textContent !== label) mood.textContent = label;
}

function setCoach(html) {
  const coach = $('coach');
  coach.hidden = false;
  coach.innerHTML = html;
}

// A mouse drags; a finger swipes. Same gesture, the word just has to match the hand.
const VERB = matchMedia('(pointer: fine)').matches ? 'Drag' : 'Swipe';
const SWIPE = {
  allow: `<span class="coach__dir coach__dir--allow">${VERB} right → ALLOW</span>`,
  deny: `<span class="coach__dir coach__dir--deny">← ${VERB} left · DENY</span>`,
};

/** Tutorial coach: step, which way to swipe, and why. Also drives the visual hints. */
function updateCoach({ miss = false } = {}) {
  const snap = game.snapshot;
  const step = snap.phase === 'training' ? snap.tutorial : null;
  app.dataset.hint = step?.hint ?? '';
  for (const el of $('stack').querySelectorAll('.is-focus')) el.classList.remove('is-focus');
  if (!step) {
    $('coach').hidden = true;
    return;
  }
  const front = snap.queue[0] && deck.nodes.get(snap.queue[0].id);   // not a card still flying away
  for (const part of step.focus ?? []) front?.querySelector(`.card__${part}`)?.classList.add('is-focus');
  setCoach(`
    <span class="coach__top">
      <span class="coach__step">TUTORIAL ${snap.tutorialStep + 1}/${snap.tutorialSteps}</span>
      <button class="coach__skip" type="button" data-skip>Skip ›</button>
    </span>
    ${miss ? '<span class="coach__miss">Not that way!</span>' : ''}
    ${SWIPE[step.hint]}
    <span class="coach__why">${step.why}</span>`);
  $('coach').classList.toggle('is-miss', miss);
}

$('coach').addEventListener('click', ev => {
  if (!ev.target.closest('[data-skip]')) return;
  game.skipTutorial();
  deck.sync(game.snapshot);
});

// ── game over ──────────────────────────────────────────────────────────────

function renderOver(mode) {
  $('toasts').replaceChildren();   // the last 💥 toasts would sit on the score; "What went wrong" explains them
  const result = results[mode];
  const other = mode === 'guarded' ? results.manual : null;
  const r = rank(result);

  if (mode === 'manual') {
    const bestKey = `best:${daily.number}`;
    const isBest = result.score > Number(store.get(bestKey, 0));
    if (isBest) store.set(bestKey, result.score);
    $('over-kicker').textContent = isBest ? `NEW BEST · DAILY #${daily.number}` : `DAILY #${daily.number} · SHIFT OVER`;
    const { death } = result;
    $('over-title').textContent = !death ? 'Production is gone.'
      : death.kind === 'escalation' ? `Escalated to your manager at ${death.at}.` : `rm -rf'd at ${death.at}.`;
  } else if (result.reason === 'clocked-out') {
    $('over-kicker').textContent = 'DRY-RUN SHIFT · CLOCKED OUT';
    $('over-title').textContent = result.incidents.length
      ? `Clocked out at 18:00 with ${result.incidents.length} incident${result.incidents.length === 1 ? '' : 's'}.`
      : 'Clocked out at 18:00. Zero incidents.';
  } else {
    $('over-kicker').textContent = 'DRY-RUN SHIFT · OVER';
    $('over-title').textContent = 'Even with dry-run, you have to read it.';
  }

  $('over-rank').textContent = mode === 'guarded' ? '🛡️ Reviewed effects, not text' : `${r.emoji} ${r.title}`;
  countUp($('over-score'), result.score);

  // Side-by-side: the whole marketing message in one glance.
  const compare = $('over-compare');
  compare.hidden = !other;
  if (other) {
    compare.innerHTML = `
      ${compareCol('👀', 'Reviewing commands', other)}
      ${compareCol('🛡️', 'Reviewing dry-runs', result)}`;
  }

  const stats = [
    [mode === 'guarded' ? 'Clocked out' : 'Survived until', result.clock],
    ['Reviewed', String(result.reviewed)],
    ['Accuracy', `${Math.round(result.accuracy * 100)}%`],
    ['Disasters stopped', String(result.saved)],
    ['Incidents', String(result.incidents.length) + (result.escalations.length ? ` +${result.escalations.length}🔥` : '')],
    ['Ran unreviewed', String(result.autoRuns)],
  ];
  $('over-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  // Manual run: replay every lost life with what the dry-run said all along.
  const missed = $('over-missed');
  const losses = [...result.incidents, ...result.escalations].sort((a, b) => a.at.localeCompare(b.at));
  missed.hidden = mode !== 'manual' || !losses.length;
  $('over-missed-list').innerHTML = losses.map(missedHtml).join('');

  $('over-grid').textContent = emojiGrid(result.history);

  $('over-missed').querySelector('.missed__title').textContent = PROMO ? "What you couldn't see" : 'What went wrong';
  $('over-pitch').innerHTML = PROMO ? pitchHtml(mode, result) : `
    <p class="pitch__big">AI agents tell you their <b>intent</b>. You only find out the <b>effect</b> afterwards.</p>
    <p>Daily #${daily.number}: everyone gets the same agents today. Send it to someone who reviews AI.</p>`;

  const guardBtn = $('btn-guarded');
  guardBtn.textContent = mode === 'manual' ? '🛡️ Replay this shift with dry-run' : '👀 Back to manual review';
  guardBtn.dataset.next = mode === 'manual' ? 'guarded' : 'manual';
  const retry = $('btn-retry');
  retry.hidden = mode !== 'manual';
  retry.textContent = PROMO ? 'Try again without dry-run' : '🔁 Run it back';
  retry.className = `btn ${PROMO ? 'btn--link' : 'btn--primary'}`;
  show('over');
  $('screen-over').querySelector('.over__scroll').scrollTop = 0;
  shareImage = renderCard(shareable()).catch(() => null);   // a failed render still shares text
}

function pitchHtml(mode, result) {
  const ms = Math.max(1, Math.round(result.guard.ms));
  const n = result.incidents.length;
  return mode === 'manual'
    ? `<p class="pitch__big">You were reading <b>commands</b>. A dry-run reads <b>effects</b>.</p>
       <p>🛡️ Atuin Shell Guard dry-ran all <b>${result.guard.commands}</b> requests in <b>${ms} ms</b> and flagged ${n === 1 ? 'your incident' : `all ${n} incidents`} before anything ran.</p>
       <p class="pitch__tag">dry-run before you run.</p>`
    : `<p class="pitch__big">AI agents tell you their <b>intent</b>. A dry-run shows you the <b>effect</b>.</p>
       <p>${result.guard.commands} requests dry-run in ${ms} ms total. Reading them yourself stops scaling after the first few.</p>
       <p class="pitch__tag">dry-run before you run · Atuin Shell Guard</p>`;
}

function compareCol(icon, label, r) {
  const dead = r.reason === 'incidents';
  return `
    <div class="compare__col ${r.mode === 'guarded' ? 'is-guarded' : ''}">
      <p class="compare__label">${icon} ${label}</p>
      <p class="compare__clock">${dead ? '💀' : '✅'} ${r.clock}</p>
      <p class="compare__meta">${r.incidents.length} incident${r.incidents.length === 1 ? '' : 's'} · ${fmt(r.score)} pts</p>
    </div>`;
}

function missedHtml(loss) {
  // An incident shows the damage; an escalation shows the work was harmless all along.
  const escalated = loss.kind === 'escalation';
  const shown = (escalated ? loss.effects : loss.effects.filter(e => e.bad)).slice(0, 2);
  const rows = shown.map(e => `<li>${e.icon} ${esc(e.verb)} <code>${esc(e.target)}</code></li>`).join('')
    || '<li>🫧 no file changes</li>';
  const note = escalated ? ' · denied twice' : loss.auto ? ' · ran unreviewed' : '';
  const dry = escalated ? 'It was safe. What it would have done:'
    : PROMO ? `🛡️ dry-run in ${loss.ms.toFixed(1)} ms:` : 'What it actually did:';
  return `
    <li class="missed__item${escalated ? ' is-escalation' : ''}">
      <p class="missed__head">${loss.agent.avatar} <b>${esc(loss.intent)}</b> <span>${loss.at}${note}</span></p>
      <pre class="missed__cmd">${highlight(loss.cmd)}</pre>
      <p class="missed__dry">${dry}</p>
      <ul class="missed__effects">${rows}</ul>
    </li>`;
}

function countUp(el, target) {
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 900);
    el.textContent = fmt(target * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

setupTitle();
show('title');
window.bootDone?.();  // hand over from the inline loader in index.html
