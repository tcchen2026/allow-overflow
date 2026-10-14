// localStorage that never throws. Some in-app WebViews disable it (null) or throw on
// access; the game must still boot, it just forgets between visits.

const PREFIX = 'allow:';
const memory = new Map();   // this visit's writes, so reads stay consistent without storage

const local = (() => {
  try { return window.localStorage ?? null; } catch { return null; }
})();

export const store = {
  get(key, fallback = null) {
    if (memory.has(key)) return memory.get(key);
    try { return local?.getItem(PREFIX + key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    memory.set(key, String(value));
    try { local?.setItem(PREFIX + key, String(value)); } catch { /* disabled or full: memory only */ }
  },
};
