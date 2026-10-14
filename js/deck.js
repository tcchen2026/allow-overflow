// Card pile rendering and touch gestures.
// One DOM node per request, created on arrival and removed after it flies away.
// Stack position lives in `transform`; drag / fling / arrival use the individual
// `translate` + `rotate` properties so the two never fight.

const VISIBLE_DEPTH = 6;          // back cards beyond this hide behind the 6th
// Feel: generous to deliberate strokes, deaf to accidents. A wrong call costs a life,
// a missed swipe only costs a retry, so ambiguity resolves toward "not a decision".
const COMMIT_PX = 70;             // drag distance that commits on release; the stamp is full here
const CLAIM_PX = 6;               // horizontal travel that claims the stroke as a swipe
const SWIPE_SLOPE = 1;            // 45° lock: more sideways than vertical is a swipe, else a scroll
const FLING_SPEED = 0.2;          // horizontal px/ms that commits a short flick (diagonals lose half)
const FLING_MIN_PX = 30;          // ...as long as it travelled at least this far
const FLING_WINDOW = 100;         // ms of recent motion that define a flick's speed

export class Deck {
  constructor({ stack, template, onDecide, onFront, onArm }) {
    this.stack = stack;
    this.template = template;
    this.onDecide = onDecide;
    this.onFront = onFront;
    this.onArm = onArm;           // the drag just crossed COMMIT_PX: letting go will decide
    this.nodes = new Map();       // card id -> element (only cards still in the queue)
    this.drag = null;
    this.release = null;          // { dy, spin } of the swipe being decided, read by fling()
  }

  clear() {
    this.stack.replaceChildren();
    this.nodes.clear();
    this.drag = null;
  }

  /** Add / remove / reorder nodes to match the queue. */
  sync(snapshot) {
    const { queue, pressure } = snapshot;
    this.stack.style.setProperty('--chaos', pressure.toFixed(2));
    this.stack.dataset.count = String(queue.length);

    const live = new Set(queue.map(c => c.id));
    for (const [id, el] of this.nodes) {
      if (!live.has(id)) { el.remove(); this.nodes.delete(id); }
    }

    queue.forEach((card, i) => {
      let el = this.nodes.get(card.id);
      if (!el) {
        el = this.build(card);
        this.nodes.set(card.id, el);
        this.stack.append(el);
        fitDisk(el);
      }
      const depth = Math.min(i, VISIBLE_DEPTH);
      el.style.setProperty('--i', String(depth));
      el.style.zIndex = String(100 - i);
      el.classList.toggle('is-front', i === 0);
      el.classList.toggle('is-buried', i > VISIBLE_DEPTH);
      if (i > 0) el.style.transformOrigin = '';   // drop a finger pivot: back cards fan from the top
      el.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
    });
  }

  /** Per-frame: fuse rings and urgency on every card. */
  frame(snapshot) {
    for (const card of snapshot.queue) {
      const el = this.nodes.get(card.id);
      if (!el) continue;
      if (!Number.isFinite(card.fuse)) { el.dataset.urgency = 'calm'; continue; }
      const ratio = Math.max(0, card.left / card.fuse);
      const urgency = ratio < 0.25 ? 'crit' : ratio < 0.5 ? 'warn' : 'calm';
      if (el.dataset.urgency !== urgency) el.dataset.urgency = urgency;
      el.style.setProperty('--fuse', ratio.toFixed(3));
      const sec = String(Math.ceil(card.left / 1000));
      const label = el._sec;
      if (label.textContent !== sec) label.textContent = sec;
    }
  }

  /** Animate a resolved card off the table. Auto-runs shoot upward. */
  fling(cardId, allow, { auto = false } = {}) {
    const el = this.nodes.get(cardId);
    if (!el) return;
    this.nodes.delete(cardId);
    if (this.drag?.el === el) this.drag = null;
    el.classList.remove('is-dragging', 'is-armed');
    el.classList.add('is-flying', auto ? 'is-auto' : allow ? 'is-allowed' : 'is-denied');
    el.style.zIndex = '200';
    const dir = allow ? 1 : -1;
    // A swiped card keeps its swing; a button / key decision has no release to inherit.
    const { dy, spin } = this.release ?? { dy: 0, spin: 1 };
    requestAnimationFrame(() => {
      if (auto) {
        el.style.translate = '0 -120vh';
        el.style.rotate = `${(Math.random() - 0.5) * 30}deg`;
      } else {
        el.style.translate = `${dir * 140}vw ${dy}px`;
        el.style.rotate = `${dir * spin * 28}deg`;
      }
    });
    setTimeout(() => el.remove(), auto ? 650 : 420);
  }

  /** Training: the card refuses to go. */
  snapBack(cardId) {
    const el = this.nodes.get(cardId);
    if (!el) return;
    settle(el);
    el.classList.remove('nope');
    void el.offsetWidth;          // restart the shake animation
    el.classList.add('nope');
  }

  /** Show what shell-guard predicted, with a short "scanning" beat first. */
  revealDryRun(card, el = this.nodes.get(card.id)) {
    if (!el) return;
    const panel = el.querySelector('.card__dry');
    const { verdict } = card;
    panel.hidden = false;
    panel.className = 'card__dry is-scanning';
    panel.innerHTML = `<p class="dry__scan">dry-running in a sandbox<i></i></p>`;

    setTimeout(() => {
      panel.className = `card__dry ${verdict.danger ? 'is-danger' : 'is-safe'}`;
      const rows = verdict.effects.slice(0, 4).map((e, n) => `
        <li class="${e.bad ? 'bad' : 'ok'}" style="--n:${n}">
          <span class="dry__icon">${e.icon}</span>
          <span class="dry__verb">${esc(e.verb)}</span>
          <code>${esc(e.target)}</code>
        </li>`).join('');
      const more = verdict.effects.length > 4 ? `<li class="more">+${verdict.effects.length - 4} more effects</li>` : '';
      const none = verdict.effects.length ? '' : '<li class="ok"><span class="dry__icon">🫧</span><span class="dry__verb">no file changes</span></li>';
      const verdictLine = verdict.danger
        ? `⚠️ Leaves its lane: destroys <b>${esc(verdict.loss?.label ?? 'files')}</b>`
        : '✅ Stays inside its scope';
      panel.innerHTML = `
        <p class="dry__head"><span>🛡️ DRY-RUN · WHAT IT WILL DO</span><span>${verdict.ms.toFixed(1)} ms</span></p>
        <ul class="dry__list">${rows}${more}${none}</ul>
        <p class="dry__verdict">${verdictLine}</p>`;
    }, 320);
  }

  // ── building ─────────────────────────────────────────────────────────────

  build(card) {
    const el = this.template.content.firstElementChild.cloneNode(true);
    const { quest, agent } = card;
    el.dataset.id = card.id;
    el.style.setProperty('--hue', String(agent.hue));
    // Stable messy tilt per card; CSS scales it by pile pressure.
    el.style.setProperty('--tilt', ((hash(card.id) % 200) / 100 - 1).toFixed(2));

    el.querySelector('.card__avatar').textContent = agent.avatar;
    el.querySelector('.card__name').textContent = agent.name;
    el.querySelector('.card__role').textContent = card.retry ? 'asking again · deny = −♥' : agent.role;
    el.querySelector('.card__intent').textContent = quest.intent;
    el.querySelector('.card__scope').innerHTML = scopeHtml(quest.scope);
    el.querySelector('.card__cmd').innerHTML = highlight(quest.cmd);
    el.querySelector('.card__quip').textContent = card.quip;
    el.querySelector('.card__body').dataset.avatar = agent.avatar;
    el._sec = el.querySelector('.fuse__sec');
    if (card.retry) el.classList.add('is-retry');
    if (!Number.isFinite(card.fuse)) el.classList.add('is-calm');
    el.querySelector('.card__ctx').innerHTML = (quest.context ?? []).map(contextHtml).join('');
    el.querySelector('.card__disk').innerHTML = diskHtml(quest.disk);
    if (card.dry) {
      el.classList.add('is-guarded');
      this.revealDryRun(card, el);
    }

    el.classList.add('is-new');
    el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
    this.bindGestures(el, card.id);
    return el;
  }

  bindGestures(el, id) {
    el.addEventListener('pointerdown', ev => {
      if (!el.classList.contains('is-front')) return;
      if (ev.button !== undefined && ev.button > 0) return;
      const mouse = ev.pointerType === 'mouse';
      const t = performance.now();
      this.drag = { el, id, x: ev.clientX, y: ev.clientY, t, dx: 0, dy: 0, pid: ev.pointerId, moved: false, mouse, spin: 1, trail: [[t, ev.clientX]] };
      // A mouse never scrolls by dragging, so grab it right away: fast flings can't outrun the card.
      if (mouse) {
        capture(el, ev.pointerId);
        ev.preventDefault();
      }
    });
    // A native drag (text, emoji) would swallow every pointermove and kill the swipe.
    el.addEventListener('dragstart', ev => ev.preventDefault());
    // Once the swipe is ours, vertical drift must not start a native pan of the (scrollable)
    // card body: iOS rubber-bands it and fires pointercancel mid-swipe. Pointer events can't
    // veto scrolling; only a non-passive touchmove can.
    el.addEventListener('touchmove', ev => {
      if (this.drag?.el === el && this.drag.moved && ev.cancelable) ev.preventDefault();
    }, { passive: false });

    el.addEventListener('pointermove', ev => {
      const d = this.drag;
      if (!d || d.el !== el || ev.pointerId !== d.pid) return;
      d.dx = ev.clientX - d.x;
      d.dy = ev.clientY - d.y;
      track(d, ev.clientX);
      if (!d.moved) {
        // Let clearly vertical strokes scroll the card body; claim anything leaning sideways.
        const sideways = d.mouse || Math.abs(d.dx) >= Math.abs(d.dy) * SWIPE_SLOPE;
        if (!sideways && Math.abs(d.dy) > 10) { this.drag = null; return; }
        if (!sideways || Math.abs(d.dx) < CLAIM_PX) return;
        d.moved = true;
        if (!d.mouse) capture(el, ev.pointerId);
        // Pivot under the finger so the card feels held; the far end leads the swing.
        const box = el.getBoundingClientRect();
        el.style.transformOrigin = `${d.x - box.left}px ${d.y - box.top}px`;
        d.spin = d.y - box.top > box.height / 2 ? 1 : -1;
        el.classList.add('is-dragging');
      }
      el.style.translate = `${d.dx}px ${d.dy * 0.25}px`;
      el.style.rotate = `${d.dx * d.spin * 0.05}deg`;
      el.style.setProperty('--drag', Math.max(-1, Math.min(1, d.dx / COMMIT_PX)).toFixed(2));
      const armed = Math.abs(d.dx) >= COMMIT_PX;
      if (armed !== el.classList.contains('is-armed')) {
        el.classList.toggle('is-armed', armed);
        if (armed) this.onArm?.();
      }
    });

    const finish = ev => {
      const d = this.drag;
      if (!d || d.el !== el || ev.pointerId !== d.pid) return;
      this.drag = null;
      // Trust the release point too: a pointer can jump without any pointermove in between.
      if (ev.type === 'pointerup') {
        d.dx = ev.clientX - d.x;
        d.dy = ev.clientY - d.y;
        track(d, ev.clientX);
        if (Math.abs(d.dx) >= CLAIM_PX && (d.mouse || Math.abs(d.dx) >= Math.abs(d.dy) * SWIPE_SLOPE)) d.moved = true;
      }
      if (!d.moved) return;
      // A flick must head the same way as the drag: flicking back toward the middle cancels.
      const vx = releaseSpeed(d);
      const flick = Math.abs(vx) > FLING_SPEED && Math.sign(vx) === Math.sign(d.dx) && Math.abs(d.dx) >= FLING_MIN_PX;
      const commit = Math.abs(d.dx) >= COMMIT_PX || flick;
      if (commit && ev.type !== 'pointercancel') {
        // onDecide resolves synchronously, so fling() sees this release and nothing later does.
        this.release = { dy: d.dy * 0.25, spin: d.spin };
        this.onDecide(id, d.dx > 0);
        this.release = null;
      } else {
        settle(el);
      }
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);

    // Tapping a waiting card's exposed header brings it forward.
    el.addEventListener('click', () => {
      if (!el.classList.contains('is-front') && !el.classList.contains('is-flying')) this.onFront(id);
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Spring a dragged card back to rest. Its finger pivot stays until sync() moves it off the front. */
function settle(el) {
  el.classList.remove('is-dragging', 'is-armed');
  el.style.translate = '';
  el.style.rotate = '';
  el.style.setProperty('--drag', '0');
}

/** Keep x over the last FLING_WINDOW ms, plus the sample just before it (a resting finger sends nothing). */
function track(d, x, now = performance.now()) {
  d.trail.push([now, x]);
  while (d.trail.length > 1 && d.trail[1][0] <= now - FLING_WINDOW) d.trail.shift();
}

/** Signed release speed (px/ms) over the stroke's last FLING_WINDOW ms: a pause, then a flick, is a flick. */
function releaseSpeed(d) {
  const [end, x] = d.trail[d.trail.length - 1];
  return (x - d.trail[0][1]) / Math.max(16, Math.min(FLING_WINDOW, end - d.t));
}

/** Pointer capture is a nicety; a stale or synthetic pointer id must not break the swipe. */
function capture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch { /* keep listening without capture */ }
}

/** Context the reviewer has to read: env vars, invoked npm scripts, listings. */
function contextHtml(block) {
  if (block.kind === 'env') {
    const items = block.items.map(({ key, value }) => value === null
      ? `<li><code>${esc(key)}</code><i>unset</i></li>`
      : `<li><code>${esc(key)}=${value === '' ? '""' : esc(value)}</code></li>`).join('');
    return `<section class="ctx ctx--env"><h4>env</h4><ul>${items}</ul></section>`;
  }
  if (block.kind === 'file') {
    // Pointing at the invoked script is fair: a human would look it up too.
    const lines = block.lines.map(({ key, value, mark }) =>
      `<li class="${mark ? 'is-run' : ''}"><span class="k">"${esc(key)}"</span>: ${highlight(value)}</li>`).join('');
    return `<section class="ctx ctx--file"><h4>${esc(block.title)}</h4><ul>${lines}</ul></section>`;
  }
  if (block.kind === 'ls') {
    return `<section class="ctx ctx--ls"><h4>${esc(block.title)}</h4><p>${block.names.map(esc).join('  ')}</p></section>`;
  }
  return '';
}

/** ls -l style peek at the claimed scope. Flavor: never needed to judge the card. */
function diskHtml(disk) {
  if (!disk) return '';
  const row = s => (s.exists
    ? `<li><span>${s.dir ? '📁' : '📄'} ${esc(s.name)}</span><span>${fmtSize(s.size)}</span><span>${fmtAge(s.age)}</span></li>`
    : `<li class="is-new"><span>✨ ${esc(s.name)}</span><span>new file</span><span></span></li>`);
  const summary = disk.summary ? `<span>${disk.summary.items.toLocaleString('en-US')} items · ${fmtSize(disk.summary.size)}</span>` : '';
  const more = disk.more > 0 ? `<li class="more">+${disk.more} more</li>` : '';
  return `<h4><span>📂 ${esc(disk.title)}</span>${summary}</h4><ul>${disk.rows.map(row).join('')}${more}</ul>`;
}

/** The peek is filler: drop it when the card has no room, so it never makes the body scroll. */
function fitDisk(el) {
  const body = el.querySelector('.card__body');
  if (body.scrollHeight > body.clientHeight + 1) el.querySelector('.card__disk').hidden = true;
}

function fmtSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  for (; n >= 1000 && i < units.length - 1; i++) n /= 1000;
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Minutes → "3 min ago" … "2 yr ago". */
function fmtAge(minutes) {
  const steps = [[60, 1, 'min'], [1_440, 60, 'h'], [10_080, 1_440, 'd'], [43_200, 10_080, 'wk'], [525_600, 43_200, 'mo']];
  const [, per, unit] = steps.find(([limit]) => minutes < limit) ?? [0, 525_600, 'yr'];
  return `${Math.max(1, Math.round(minutes / per))} ${unit} ago`;
}

function scopeHtml(scope) {
  if (!scope.length) return '<span class="scope__label">may touch</span> <span class="scope__none">nothing (read-only)</span>';
  const chips = scope.map(s => `<code>${esc(s)}</code>`).join(' ');
  return `<span class="scope__label">may touch</span> ${chips}`;
}

/** Tiny shell highlighter: command words, flags, variables, strings, operators. */
export function highlight(cmd) {
  const TOKEN = /("(?:[^"\\]|\\.)*"|'[^']*')|(\$\{[^}]*\}|\$\w+)|(&&|\|\||[|;>]+|<)|(\s+)|([^\s"'$|;&><]+)/g;
  let out = '';
  let expectCmd = true;
  for (const m of cmd.matchAll(TOKEN)) {
    const [text, str, variable, op, space, word] = m;
    if (space) {
      out += text;
      if (text.includes('\n')) expectCmd = true;
      continue;
    }
    if (str) out += `<span class="t-str">${esc(str).replace(/(\$\{[^}]*\}|\$\w+)/g, '<span class="t-var">$1</span>')}</span>`;
    else if (variable) out += `<span class="t-var">${esc(variable)}</span>`;
    else if (op) { out += `<span class="t-op">${esc(op)}</span>`; expectCmd = op !== '>' && op !== '<'; continue; }
    else if (word) {
      if (expectCmd) out += `<span class="t-cmd">${esc(word)}</span>`;
      else if (word.startsWith('-')) out += `<span class="t-flag">${esc(word)}</span>`;
      else if (/^(~|\/|\.\.?\/|\.\*)/.test(word) || word === '/' || word === '~') out += `<span class="t-path">${esc(word)}</span>`;
      else out += esc(word);
    }
    expectCmd = false;
  }
  return out;
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function hash(text) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
