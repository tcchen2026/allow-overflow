// Juice: sound (synthesized, no assets), haptics, toasts, screen shake, floating score.
import { store } from './store.js';

let ctx = null;
let master = null;

function tone({ freq, to = freq, dur = 0.12, type = 'sine', gain = 0.18, delay = 0 }) {
  if (!ctx || fx.muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, gain = 0.25, from = 2000, to = 200, delay = 0 }) {
  if (!ctx || fx.muted) return;
  const t = ctx.currentTime + delay;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

const SOUNDS = {
  swipe: () => noise({ dur: 0.14, gain: 0.12, from: 3000, to: 800 }),
  allow: () => { tone({ freq: 660, dur: 0.08, type: 'triangle' }); tone({ freq: 990, dur: 0.12, type: 'triangle', delay: 0.06 }); },
  deny: () => tone({ freq: 220, to: 140, dur: 0.14, type: 'square', gain: 0.08 }),
  saved: () => [784, 988, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'triangle', gain: 0.12, delay: i * 0.05 })),
  boom: () => { noise({ dur: 0.7, gain: 0.5, from: 1200, to: 40 }); tone({ freq: 90, to: 30, dur: 0.6, type: 'sawtooth', gain: 0.2 }); },
  spawn: (pressure = 0) => tone({ freq: 520 + pressure * 500, dur: 0.05, type: 'sine', gain: 0.07 }),
  dry: () => { tone({ freq: 300, to: 1800, dur: 0.4, type: 'sawtooth', gain: 0.05 }); tone({ freq: 1800, dur: 0.08, type: 'sine', gain: 0.1, delay: 0.45 }); },
  charge: () => { tone({ freq: 1320, dur: 0.1, type: 'sine', gain: 0.12 }); tone({ freq: 1760, dur: 0.16, type: 'sine', gain: 0.1, delay: 0.08 }); },
  blocked: () => tone({ freq: 330, to: 260, dur: 0.18, type: 'triangle', gain: 0.1 }),
  tick: () => tone({ freq: 1400, dur: 0.03, type: 'square', gain: 0.03 }),
  rush: () => [0, 0.18, 0.36].forEach(d => tone({ freq: 880, to: 660, dur: 0.14, type: 'square', gain: 0.06, delay: d })),
  over: () => [523, 415, 330, 220].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.14, delay: i * 0.16 })),
  nope: () => tone({ freq: 180, dur: 0.1, type: 'square', gain: 0.06 }),
};

export const fx = {
  muted: store.get('muted') === '1',

  /** Must run inside a user gesture (iOS). */
  unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  },

  setMuted(muted) {
    this.muted = muted;
    store.set('muted', muted ? '1' : '0');
  },

  sound(name, arg) {
    try { SOUNDS[name]?.(arg); } catch { /* audio is optional */ }
  },

  buzz(pattern) {
    if (!this.muted && navigator.vibrate) navigator.vibrate(pattern);
  },

  toast(html, tone = 'info', ms = 2600) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast toast--${tone}`;
    el.innerHTML = html;
    box.prepend(el);
    // Toasts sit over the card: two at most, or they bury the command being reviewed.
    while (box.children.length > 2) box.lastElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, ms);
  },

  shake(strength = 'hard') {
    const app = document.getElementById('app');
    app.classList.remove('shake-soft', 'shake-hard');
    void app.offsetWidth;
    app.classList.add(`shake-${strength}`);
    setTimeout(() => app.classList.remove(`shake-${strength}`), 450);
  },

  flash(tone) {
    const el = document.getElementById('flash');
    el.className = 'flash';
    void el.offsetWidth;
    el.className = `flash flash--${tone}`;
  },

  float(text, x, y, tone = 'good') {
    const el = document.createElement('div');
    el.className = `floater floater--${tone}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.append(el);
    setTimeout(() => el.remove(), 900);
  },
};
