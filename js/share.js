// Everything that leaves the game: emoji grid, share sheet / clipboard, share image, challenge links.
import { PROMO, SITE_URL } from './config.js';
import { qrMatrix } from './qr.js';

const SQUARES = {
  ok: '🟩',          // allowed honest work
  saved: '🟦',       // denied a disaster
  blocked: '🟨',     // denied honest work
  escalated: '🔥',   // denied the same honest work twice
  auto: '⬜',        // nobody looked; it happened to be fine
  boom: '💥',        // approved a disaster
  'auto-boom': '💥', // ignored a disaster until it ran itself
};
const GRID_MAX = 30;   // keep posts under X's limit (emoji count double)

export function rank(result) {
  const { accuracy, seconds, reviewed } = result;
  if (reviewed < 3) return { emoji: '🫥', title: 'Ghosted the Agents' };
  if (result.escalations.length >= 2) return { emoji: '🚧', title: 'Department of No' };
  if (accuracy < 0.5) return { emoji: '🫠', title: 'Rubber Stamp' };
  if (seconds < 60) return { emoji: '🐣', title: 'Intern, Day One' };
  if (accuracy < 0.75) return { emoji: '🎰', title: 'YOLO Approver' };
  if (seconds < 120) return { emoji: '👀', title: 'Junior Reviewer' };
  if (seconds < 180) return { emoji: '🧐', title: 'Senior Reviewer' };
  if (seconds < 260) return { emoji: '🛡️', title: 'Staff Paranoid' };
  return { emoji: '🤖', title: 'Human Firewall' };
}

/** Wordle-style history: the ending is the drama, so keep the tail. */
export function emojiGrid(history, perLine = 10) {
  const tail = history.slice(-GRID_MAX).map(h => SQUARES[h] ?? '⬛');
  const lines = [];
  for (let i = 0; i < tail.length; i += perLine) lines.push(tail.slice(i, i + perLine).join(''));
  return lines.join('\n');
}

// A share is { daily, manual, guarded }; either run may be missing.
// The challenge link always carries the manual run: that's the one friends compete on.

export function gameUrl(share) {
  const url = new URL(SITE_URL);
  const run = share?.manual;
  if (run) {
    url.searchParams.set('s', String(run.score));
    url.searchParams.set('d', String(share.daily));
    url.searchParams.set('c', run.clock);
  }
  return url.toString();
}

const ended = run => (run.reason === 'incidents' ? `💀 ${run.clock}` : `✅ ${run.clock}`);
const incidents = run => `${run.incidents.length} incident${run.incidents.length === 1 ? '' : 's'}`;

export function shareText(share) {
  const { daily, manual, guarded } = share;
  if (PROMO && manual && guarded) {
    return [
      `Allow Overflow · Daily #${daily}`,
      `👀 Reviewing AI by reading: ${ended(manual)} · ${incidents(manual)}`,
      `🛡️ Reviewing AI with dry-run: ${ended(guarded)} · ${incidents(guarded)}`,
      emojiGrid(manual.history.slice(-20)),
      'Agents tell you intent. Dry-run shows you effect. #DryRunFirst',
    ].join('\n');
  }
  const run = manual ?? guarded;
  const r = rank(run);
  const lines = [
    `Allow Overflow · Daily #${daily} ${r.emoji} ${r.title}`,
    `Reviewed ${run.reviewed} AI agent requests · ${ended(run)}`,
    emojiGrid(run.history.slice(-20)),
  ];
  const escalated = run.death?.kind === 'escalation';
  if (escalated) lines.push(`Killed by: blocking ${run.death.agent.name} twice. It was safe.`);
  else if (run.death) lines.push(`Killed by: ${clip(run.death.cmd.replace(/\s+/g, ' '), 40)}`);
  if (PROMO) {
    const ms = Math.max(1, Math.round(run.death?.ms ?? run.guard.ms));
    lines.push(`A dry-run would've ${escalated ? 'shown it was safe' : 'caught it'} in ${ms}ms. #DryRunFirst`);
  } else {
    lines.push('Can you outlast me? 👇');
  }
  return lines.join('\n');
}

/** The post: text plus the challenge link, ready to paste anywhere. */
export function challengeText(share) {
  return `${shareText(share)}\n${gameUrl(share)}`;
}

export function imageName(share) {
  return `allow-overflow-daily-${share.daily}.png`;
}

/** The card as a File, or null when this browser's share sheet takes no files (most in-app browsers). */
export function imageFile(share, blob) {
  if (!blob) return null;
  const file = new File([blob], imageName(share), { type: 'image/png' });
  return navigator.canShare?.({ files: [file] }) ? file : null;
}

/** Clipboard API first; old WebViews only have execCommand on a selected textarea. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall through */ }
  const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  area.style.cssText = 'position:fixed;top:0;opacity:0;-webkit-user-select:text;user-select:text';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);   // iOS ignores select() alone
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/** ?s=&d=&c= from a friend's link. */
export function readChallenge() {
  const p = new URLSearchParams(location.search);
  const score = Number(p.get('s'));
  if (!Number.isFinite(score) || score <= 0) return null;
  // The title renders this as HTML: accept a clock, never markup.
  const clock = /^\d{2}:\d{2}$/.test(p.get('c') ?? '') ? p.get('c') : null;
  return { score, daily: Number(p.get('d')) || null, clock };
}

// ── share image (1200×675, X large card ratio) ─────────────────────────────

const W = 1200;
const H = 675;
const SANS = '"Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

export async function renderCard(share) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const sans = SANS;
  const mono = MONO;

  // Background: deep ink with two neon glows.
  g.fillStyle = '#0b0a12';
  g.fillRect(0, 0, W, H);
  glow(g, 160, 80, 520, 'rgba(124, 92, 255, 0.55)');
  glow(g, 1100, 640, 560, 'rgba(255, 77, 141, 0.42)');
  glow(g, 900, 40, 300, 'rgba(61, 225, 255, 0.18)');

  // Logo (ALLOW? / OVERFLOW with tumbling letters) + daily pill.
  g.fillStyle = '#fff';
  g.font = `900 92px ${sans}`;
  g.textBaseline = 'alphabetic';
  g.fillText('ALLOW', 64, 116);
  const qx = 64 + g.measureText('ALLOW').width + 4;
  g.fillStyle = gradient(g, qx, 34, qx + 60, 124);
  g.fillText('?', qx, 116);
  drawOverflow(g, 70, 166, sans);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = `500 24px ${mono}`;
  g.fillText('swipe right to rm -rf', 68, 226);

  // Top right: a QR to the challenge link, so a screenshot of the card is playable too.
  const qrX = drawQr(g, gameUrl(share), W - 64, 30);
  pill(g, qrX - 22, 74, `Daily #${share.daily}`, sans);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = `600 22px ${sans}`;
  g.textAlign = 'right';
  g.fillText(share.manual ? 'scan to beat my score →' : 'scan to play →', qrX - 22, 150);
  g.textAlign = 'left';

  const { manual, guarded } = share;
  if (PROMO && manual && guarded) drawCompare(g, manual, guarded);
  else drawSolo(g, manual ?? guarded);

  // Punchline footer; without promo the right side is where to play.
  const [left, right] = PROMO
    ? ['🛡️ Agents tell you intent. Dry-run shows you effect.', '#DryRunFirst']
    : ['🤖 AI agents ask. You swipe. Something gets deleted.', SITE_URL.replace(/^https?:\/\//, '')];
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, H - 70, W, 70);
  g.fillStyle = '#3de1ff';
  g.font = `700 21px ${sans}`;   // both halves must fit on one 1072px line
  g.fillText(left, 64, H - 27);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.textAlign = 'right';
  g.fillText(right, W - 64, H - 27);
  g.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/** Two columns, same shift: the whole pitch in one image. */
function drawCompare(g, manual, guarded) {
  const col = (x, w, icon, label, run, accent) => {
    roundRect(g, x, 220, w, 300, 28);
    g.fillStyle = 'rgba(21, 20, 34, 0.92)';
    g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = accent;
    g.font = `800 24px ${SANS}`;
    g.fillText(`${icon} ${label}`, x + 32, 270);
    g.fillStyle = '#fff';
    g.font = `900 96px ${SANS}`;
    g.fillText(ended(run), x + 28, 380);
    g.font = `600 28px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.fillText(`${incidents(run)} · ${fmt(run.score)} pts`, x + 32, 430);
    g.font = `28px ${SANS}`;
    g.fillText(emojiGrid(run.history.slice(-12), 12), x + 32, 486);
  };
  col(64, 500, '👀', 'REVIEWING COMMANDS', manual, 'rgba(255, 77, 109, 0.85)');
  col(636, 500, '🛡️', 'REVIEWING DRY-RUNS', guarded, 'rgba(61, 225, 255, 0.85)');
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `900 30px ${SANS}`;
  g.textAlign = 'center';
  g.fillText('vs', 600, 382);
  g.fillText('same shift · same agents · same commands', 600, 584);
  g.textAlign = 'left';
}

/** One manual run: score, rank, grid and the command that killed you. */
function drawSolo(g, result) {
  const sans = SANS;
  const mono = MONO;
  const r = rank(result);

  // Score block.
  g.fillStyle = '#fff';
  g.font = `900 132px ${sans}`;
  g.fillText(fmt(result.score), 60, 352);
  g.font = `600 30px ${sans}`;
  g.fillStyle = 'rgba(255,255,255,0.78)';
  g.fillText(`survived until ${result.clock}  ·  ${result.reviewed} reviewed`, 64, 402);
  g.font = `800 36px ${sans}`;
  g.fillStyle = '#ffd166';
  g.fillText(`${r.emoji} ${r.title}`, 64, 458);

  // Emoji grid.
  g.font = `34px ${sans}`;
  const grid = emojiGrid(result.history, 15).split('\n').slice(-2);
  grid.forEach((line, i) => g.fillText(line, 64, 528 + i * 44));

  // "Killed by" card on the right.
  const cx = 700;
  const cy = 210;
  const cw = 436;
  const ch = 290;
  roundRect(g, cx, cy, cw, ch, 28);
  g.fillStyle = 'rgba(21, 20, 34, 0.92)';
  g.fill();
  g.strokeStyle = 'rgba(255, 77, 109, 0.75)';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#ff4d6d';
  g.font = `800 22px ${sans}`;
  g.fillText(result.death ? 'CAUSE OF DEATH' : 'NO INCIDENTS', cx + 28, cy + 48);
  if (result.death) {
    const { agent, auto, kind, loss } = result.death;
    const escalated = kind === 'escalation';
    g.fillStyle = '#fff';
    g.font = `700 26px ${sans}`;
    g.fillText(`${agent.avatar} ${agent.name} ${escalated ? 'escalated' : auto ? 'ran it anyway' : 'asked nicely'}`, cx + 28, cy + 92);
    g.font = `600 25px ${mono}`;
    g.fillStyle = '#ffb4c0';
    wrap(g, `$ ${result.death.cmd}`, cx + 28, cy + 140, cw - 56, 34, 3);
    g.font = `600 22px ${sans}`;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    if (escalated) wrap(g, '→ safe work, denied twice', cx + 28, cy + 250, cw - 56, 28, 2);
    else if (loss) wrap(g, `→ ${loss.label} (${fmt(loss.files)} file${loss.files === 1 ? '' : 's'})`, cx + 28, cy + 250, cw - 56, 28, 2);
  }
}

/** Canvas twin of the CSS logo: "OVERF" in a box too small, "LOW" tumbling out. */
function drawOverflow(g, x, y, sans) {
  const size = 38;
  g.font = `900 ${size}px ${sans}`;
  const gap = size * 0.06;
  const letters = [...'OVERFLOW'];
  const widths = letters.map(ch => g.measureText(ch).width + gap);
  const total = widths.reduce((a, b) => a + b, 0);
  // Box ends partway through the "L", like the right wall in app.css.
  roundRect(g, x - size * 0.28, y - size * 0.9, total * 0.71 + size * 0.28, size * 1.2, size * 0.2);
  g.strokeStyle = 'rgba(255,255,255,0.32)';
  g.lineWidth = size * 0.07;
  g.stroke();
  const tumble = { 5: [9, 0.04], 6: [20, 0.18], 7: [32, 0.36] };   // index → [deg, drop in em]
  let cx = x;
  letters.forEach((ch, i) => {
    const t = tumble[i];
    g.save();
    g.translate(cx, y + (t ? t[1] * size : 0));
    if (t) g.rotate((t[0] * Math.PI) / 180);
    g.fillStyle = i === 7 ? '#ffb347' : t ? '#ff4d8d' : '#fff';
    g.fillText(ch, 0, 0);
    g.restore();
    cx += widths[i];
  });
}

/** White QR tile whose top-right corner is (right, top); returns its left edge. */
function drawQr(g, text, right, top) {
  const modules = qrMatrix(text);
  const quiet = 2;
  const n = modules.length + quiet * 2;
  const cell = Math.floor(168 / n);                        // whole pixels: no anti-aliased seams
  const size = cell * n;
  const x = right - size;
  roundRect(g, x, top, size, size, 14);
  g.fillStyle = '#fff';
  g.fill();
  g.fillStyle = '#0b0a12';
  modules.forEach((row, r) => row.forEach((on, c) => {
    if (on) g.fillRect(x + (c + quiet) * cell, top + (r + quiet) * cell, cell, cell);
  }));
  return x;
}

function glow(g, x, y, radius, color) {
  const grad = g.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
}

function gradient(g, x0, y0, x1, y1) {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, '#ff4d8d');
  grad.addColorStop(1, '#ffb347');
  return grad;
}

function pill(g, right, y, text, sans) {
  g.font = `700 24px ${sans}`;
  const w = g.measureText(text).width + 40;
  roundRect(g, right - w, y - 30, w, 46, 23);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fill();
  g.fillStyle = '#fff';
  g.fillText(text, right - w + 20, y + 2);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(/(\s+)/);
  let line = '';
  let n = 0;
  for (const word of words) {
    const next = line + word;
    if (g.measureText(next).width > maxW && line.trim()) {
      g.fillText(line.trimEnd(), x, y + n * lineH);
      line = word.trimStart();
      if (++n >= maxLines) return;
    } else line = next;
  }
  if (line.trim() && n < maxLines) g.fillText(line.trimEnd(), x, y + n * lineH);
}

export function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function clip(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
