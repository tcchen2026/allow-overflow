// Seeded randomness: every player gets the same daily card sequence.

const LAUNCH_UTC = Date.UTC(2026, 9, 1); // Daily #1 = 2026-10-01
const DAY_MS = 86_400_000;

/** 32-bit FNV-1a hash of a string seed. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) with small helpers. */
export class Rng {
  constructor(seed) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed));
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  chance(p) { return this.next() < p; }
}

/** Daily puzzle number (days since launch, local calendar day) and its seed. */
export function dailyInfo(date = new Date()) {
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const number = Math.max(1, Math.floor((localDay - LAUNCH_UTC) / DAY_MS) + 1);
  return { number, seed: `allow-daily-${number}` };
}
