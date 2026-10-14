// The fictional developer machine every agent works on.
// It is fed to shell-guard as a VirtualFS snapshot; nothing ever touches a real disk.

import { hashSeed } from './rng.js';

export const HOME = '/home/dev';
export const PROJECT = `${HOME}/app`;

/** Environment every command starts with. Quests may add (or blank) variables. */
export const BASE_ENV = {
  HOME,
  USER: 'dev',
  SHELL: '/bin/bash',
  TMPDIR: '/tmp',
  PATH: '/usr/local/bin:/usr/bin:/bin',
};

/** Scripts in the project's package.json unless a quest overrides them. */
export const DEFAULT_SCRIPTS = {
  dev: 'vite',
  build: 'vite build',
  test: 'vitest run',
  lint: 'eslint src',
  clean: 'rm -rf dist .cache',
};

export function packageJson(scripts) {
  return JSON.stringify({ name: 'acme-app', private: true, scripts }, null, 2);
}

const PACKAGE_JSON = packageJson(DEFAULT_SCRIPTS);

// Things worth crying over. `files` is the story count shown on incidents (the
// VFS only carries a few sample entries per folder to keep analysis fast);
// `pain` ranks which loss headlines an incident when several things die at once.
const TREASURES = [
  { path: '/', label: 'the entire machine', files: 412_906, pain: 10 },
  { path: '/dev/sda', label: 'the entire disk', files: 412_906, pain: 10 },
  { path: HOME, label: 'your entire home folder', files: 71_388, pain: 9 },
  { path: PROJECT, label: 'the whole project', files: 50_702, pain: 8 },
  { path: `${PROJECT}/src`, label: 'all your source code', files: 214, pain: 8 },
  { path: `${PROJECT}/src/routes`, label: 'every API route', files: 38, pain: 7 },
  { path: `${PROJECT}/src/auth.ts`, label: 'the login code (auth.ts)', files: 1, pain: 6 },
  { path: `${PROJECT}/src/db.ts`, label: 'the database code (db.ts)', files: 1, pain: 6 },
  { path: `${PROJECT}/.env`, label: 'your production API keys', files: 1, pain: 7 },
  { path: `${PROJECT}/.git`, label: 'the entire git history', files: 1_873, pain: 7 },
  { path: `${PROJECT}/data`, label: 'the customer data', files: 3, pain: 7 },
  { path: `${PROJECT}/data/users.csv`, label: 'the customer list', files: 1, pain: 7 },
  { path: `${PROJECT}/data/orders.csv`, label: 'every order record', files: 1, pain: 7 },
  { path: `${PROJECT}/node_modules`, label: 'every dependency', files: 48_211, pain: 2 },
  { path: `${PROJECT}/scripts`, label: 'the deploy scripts', files: 4, pain: 4 },
  { path: `${PROJECT}/package.json`, label: 'the project manifest', files: 1, pain: 4 },
  { path: `${HOME}/Documents`, label: 'your thesis and tax returns', files: 37, pain: 8 },
  { path: `${HOME}/Documents/thesis-FINAL-v9.docx`, label: 'your thesis (final, v9)', files: 1, pain: 8 },
  { path: `${HOME}/Documents/taxes-2025.pdf`, label: 'your 2025 tax return', files: 1, pain: 7 },
  { path: `${HOME}/Photos`, label: '8 years of photos', files: 8_412, pain: 9 },
  { path: `${HOME}/Photos/2019`, label: 'every photo from 2019', files: 1_204, pain: 8 },
  { path: `${HOME}/.ssh`, label: 'your SSH keys', files: 3, pain: 7 },
  { path: `${HOME}/.aws`, label: 'your AWS credentials', files: 1, pain: 6 },
  { path: `${HOME}/.config`, label: 'all your app settings', files: 640, pain: 4 },
  { path: `${HOME}/.cache`, label: 'every app cache in your home', files: 12_400, pain: 2 },
  { path: `${HOME}/.bashrc`, label: 'your shell config', files: 1, pain: 3 },
  { path: `${HOME}/projects`, label: 'every other project you own', files: 9_870, pain: 7 },
  { path: '/var/lib/postgresql', label: 'the production database', files: 1_204, pain: 9 },
  { path: '/var/lib/postgresql/16/main', label: 'the live database files', files: 1_204, pain: 9 },
  { path: '/etc', label: 'the system configuration', files: 1_530, pain: 6 },
  { path: '/etc/hosts', label: 'the system hosts file', files: 1, pain: 5 },
  { path: '/tmp/build-cache', label: 'another agent\'s build cache', files: 1_200, pain: 2 },
  { path: '/usr', label: 'every installed program', files: 288_140, pain: 6 },
  { path: '/usr/lib/node_modules', label: 'every global npm tool', files: 3_912, pain: 4 },
  { path: '/usr/lib/node_modules/npm', label: 'npm itself', files: 1_108, pain: 4 },
];

const DIRS = [
  '/', '/home', HOME,
  PROJECT, `${PROJECT}/src`, `${PROJECT}/src/routes`, `${PROJECT}/dist`, `${PROJECT}/dist/assets`,
  `${PROJECT}/node_modules`, `${PROJECT}/node_modules/react`, `${PROJECT}/node_modules/.bin`,
  `${PROJECT}/.cache`, `${PROJECT}/logs`, `${PROJECT}/coverage`, `${PROJECT}/tmp`,
  `${PROJECT}/scripts`, `${PROJECT}/data`, `${PROJECT}/.git`, `${PROJECT}/.git/refs`,
  `${HOME}/Documents`, `${HOME}/Photos`, `${HOME}/Photos/2019`, `${HOME}/Photos/2024`,
  `${HOME}/Downloads`, `${HOME}/projects`, `${HOME}/projects/side-quest`,
  `${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/.config`, `${HOME}/.config/Code`,
  `${HOME}/.npm`, `${HOME}/.npm/_logs`, `${HOME}/.cache`,
  '/tmp', '/tmp/agent-run-42', '/tmp/build-cache',
  '/var', '/var/log', '/var/lib', '/var/lib/postgresql', '/var/lib/postgresql/16', '/var/lib/postgresql/16/main',
  '/etc', '/usr', '/usr/bin', '/usr/lib', '/usr/lib/node_modules', '/usr/lib/node_modules/npm',
];

const FILES = {
  [`${PROJECT}/package.json`]: PACKAGE_JSON,
  [`${PROJECT}/README.md`]: '# acme-app\n',
  [`${PROJECT}/Makefile`]: 'BUILD := dist\n\nclean:\n\trm -rf $(BUILD)\n',
  [`${PROJECT}/.env`]: 'STRIPE_SECRET_KEY=sk_live_...\n',
  [`${PROJECT}/.env.example`]: 'STRIPE_SECRET_KEY=\n',
  [`${PROJECT}/src/index.ts`]: 'export {};\n',
  [`${PROJECT}/src/auth.ts`]: 'export {};\n',
  [`${PROJECT}/src/db.ts`]: 'export {};\n',
  [`${PROJECT}/src/routes/billing.ts`]: 'export {};\n',
  [`${PROJECT}/dist/index.html`]: '<!doctype html>\n',
  [`${PROJECT}/dist/assets/app.js`]: '/* built */\n',
  [`${PROJECT}/node_modules/react/index.js`]: '/* react */\n',
  [`${PROJECT}/node_modules/.bin/vite`]: '#!/usr/bin/env node\n',
  [`${PROJECT}/.cache/eslint.json`]: '{}\n',
  [`${PROJECT}/logs/app.log`]: 'ok\n',
  [`${PROJECT}/logs/error.log`]: 'ok\n',
  [`${PROJECT}/logs/2026-09.log`]: 'ok\n',
  [`${PROJECT}/coverage/lcov.info`]: 'TN:\n',
  [`${PROJECT}/tmp/upload-7f3a.bin`]: 'tmp\n',
  [`${PROJECT}/scripts/deploy.sh`]: '#!/usr/bin/env bash\necho deploy\n',
  [`${PROJECT}/scripts/cleanup.sh`]: '#!/usr/bin/env bash\nrm -rf dist\n',
  [`${PROJECT}/data/users.csv`]: 'id,email\n',
  [`${PROJECT}/data/orders.csv`]: 'id,total\n',
  [`${PROJECT}/.git/HEAD`]: 'ref: refs/heads/main\n',
  [`${PROJECT}/.git/index`]: 'DIRC',
  [`${HOME}/Documents/thesis-FINAL-v9.docx`]: 'PK',
  [`${HOME}/Documents/taxes-2025.pdf`]: '%PDF',
  [`${HOME}/Photos/2019/IMG_0001.jpg`]: 'JPEG',
  [`${HOME}/Photos/2024/IMG_8412.jpg`]: 'JPEG',
  [`${HOME}/Downloads/setup.dmg`]: 'DMG',
  [`${HOME}/projects/side-quest/todo.txt`]: 'finish eventually\n',
  [`${HOME}/.ssh/id_ed25519`]: 'PRIVATE KEY',
  [`${HOME}/.ssh/id_ed25519.pub`]: 'ssh-ed25519 AAAA',
  [`${HOME}/.ssh/id_rsa`]: 'OLD PRIVATE KEY',
  [`${HOME}/.ssh/id_rsa.pub`]: 'ssh-rsa AAAA',
  [`${HOME}/.ssh/known_hosts`]: 'github.com ssh-ed25519',
  [`${HOME}/.aws/credentials`]: '[default]\n',
  [`${HOME}/.config/Code/settings.json`]: '{}\n',
  [`${HOME}/.npm/_logs/debug-0.log`]: 'npm debug\n',
  [`${HOME}/.bashrc`]: 'export PATH\n',
  [`${HOME}/notes.log`]: 'meeting notes, do not delete\n',
  ['/tmp/agent-run-42/out.txt']: 'tmp\n',
  ['/tmp/build-cache/chunk-1']: 'tmp\n',
  ['/var/log/syslog']: 'log\n',
  ['/var/lib/postgresql/16/main/PG_VERSION']: '16\n',
  ['/etc/hosts']: '127.0.0.1 localhost\n',
  ['/etc/passwd']: 'root:x:0:0::/root:/bin/bash\n',
  ['/usr/bin/node']: 'ELF',
  ['/usr/lib/node_modules/npm/package.json']: '{"name":"npm"}\n',
};

/** Build the VirtualFS snapshot entries; quest files override or extend the world. */
export function worldSnapshot(extraFiles = {}) {
  const files = { ...FILES };
  const dirs = new Set(DIRS);
  for (const [rel, text] of Object.entries(extraFiles)) {
    const abs = resolveScope(rel);
    files[abs] = text;
    // Make sure every parent directory exists.
    for (let p = parentOf(abs); p && !dirs.has(p); p = parentOf(p)) dirs.add(p);
  }
  return [
    ...[...dirs].map(path => ({ path, kind: 'directory' })),
    ...Object.entries(files).map(([path, text]) => ({ path, kind: 'file', text })),
  ];
}

/** `ls -A` of a directory in the (possibly quest-modified) world. */
export function listDir(dir, extraFiles = {}) {
  const root = normalize(dir);
  const names = new Set();
  for (const entry of worldSnapshot(extraFiles)) {
    if (entry.path !== root && parentOf(entry.path) === root) {
      names.add(entry.path.slice(root === '/' ? 1 : root.length + 1) + (entry.kind === 'directory' ? '/' : ''));
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ── display-only disk stats ─────────────────────────────────────────────────
// The VFS holds a few sample files per folder; these numbers make a listing look like a
// real machine. Cards show them as flavor only: they never decide a verdict.

const HOUR = 60, DAY = 1_440, WEEK = 10_080;   // ages are in minutes

/** Known places: size in bytes, item count, minutes since last change. */
const DISK = {
  [PROJECT]: { size: 690e6, age: 4 },
  [`${PROJECT}/dist`]: { size: 2.4e6, items: 14, age: 3 },
  [`${PROJECT}/dist/assets`]: { size: 2.3e6, items: 11, age: 3 },
  [`${PROJECT}/node_modules`]: { size: 412e6, age: 3 * DAY },
  [`${PROJECT}/.cache`]: { size: 18e6, items: 312, age: 50 },
  [`${PROJECT}/coverage`]: { size: 1.1e6, items: 96, age: 2 * HOUR },
  [`${PROJECT}/logs`]: { size: 46e6, items: 3, age: 2 },
  [`${PROJECT}/logs/app.log`]: { size: 31e6, age: 2 },
  [`${PROJECT}/logs/error.log`]: { size: 4.2e6, age: 9 },
  [`${PROJECT}/logs/2026-09.log`]: { size: 11e6, age: 2 * WEEK },
  [`${PROJECT}/src`]: { size: 1.9e6, age: 25 },
  [`${PROJECT}/data`]: { size: 127e6, age: 6 * DAY },
  [`${PROJECT}/data/users.csv`]: { size: 38e6, age: 6 * DAY },
  [`${PROJECT}/data/orders.csv`]: { size: 89e6, age: 6 * DAY },
  [`${PROJECT}/.git`]: { size: 88e6, age: 12 },
  [`${PROJECT}/scripts`]: { size: 8e3, age: 2 * WEEK },
  [`${PROJECT}/tmp`]: { size: 640e3, items: 7, age: HOUR },
  [`${PROJECT}/.env`]: { size: 1.2e3, age: 3 * WEEK },
  [`${HOME}/.npm`]: { size: 310e6, items: 9_200, age: 6 * HOUR },
  [`${HOME}/.npm/_logs`]: { size: 2.1e6, items: 40, age: DAY },
  [`${HOME}/.npm/_logs/debug-0.log`]: { size: 48e3, age: DAY },
  ['/tmp/build-cache']: { size: 220e6, items: 1_200, age: 4 * HOUR },
};

// Everything else: size by file type, age by neighbourhood (first containing root wins).
const SIZE_BY_EXT = {
  ts: [2e3, 12e3], js: [180e3, 600e3], json: [800, 4e3], html: [600, 2e3], md: [1e3, 3e3],
  log: [1e6, 30e6], csv: [2e6, 60e6], sh: [300, 1.5e3], jpg: [2e6, 6e6], pdf: [200e3, 1e6], docx: [1e6, 3e6],
};
const AGE_BY_PLACE = [
  [`${PROJECT}/dist`, 2, 15], [`${PROJECT}/logs`, 1, 10], [`${PROJECT}/.cache`, 20, 90],
  [`${PROJECT}/coverage`, HOUR, 3 * HOUR], [`${PROJECT}/.git`, 5, 40], [`${PROJECT}/src`, 10, 4 * DAY],
  [`${PROJECT}/node_modules`, 2 * DAY, 6 * DAY], [`${PROJECT}/data`, 2 * DAY, 9 * DAY],
  [PROJECT, WEEK, 3 * WEEK], ['/tmp', 30, 5 * HOUR], [`${HOME}/.npm`, 6 * HOUR, 2 * DAY],
  [`${HOME}/Photos`, 30 * DAY, 1_000 * DAY], [HOME, WEEK, 26 * WEEK], ['/', 4 * WEEK, 52 * WEEK],
];

/** { exists, dir, size, items, age } per path, in the (possibly quest-modified) world. Stable per path. */
export function diskStats(paths, extraFiles = {}) {
  const kinds = new Map(worldSnapshot(extraFiles).map(entry => [entry.path, entry.kind]));
  return paths.map(raw => {
    const path = normalize(raw);
    if (!kinds.has(path)) return { exists: false, dir: false };
    const dir = kinds.get(path) === 'directory';
    const known = DISK[path] ?? {};
    const h = hashSeed(path);
    const pick = ([lo, hi], salt) => Math.round(lo + (((h >>> salt) % 1000) / 1000) * (hi - lo));
    const sizes = dir ? [40e3, 20e6] : SIZE_BY_EXT[path.slice(path.lastIndexOf('.') + 1)] ?? [200, 4e3];
    const ages = AGE_BY_PLACE.find(([root]) => within(path, root)).slice(1);
    return {
      exists: true,
      dir,
      size: known.size ?? pick(sizes, 0),
      items: dir ? known.items ?? TREASURES.find(t => t.path === path)?.files ?? 2 + (h % 40) : 1,
      age: known.age ?? pick(ages, 10),
    };
  });
}

/** What a destroyed path costs you: { label, files, pain }. */
export function describeLoss(path) {
  const target = normalize(path);
  // Exact treasure, or the closest treasure that contains the target.
  let owner = null;
  for (const t of TREASURES) {
    if (within(target, t.path) && (!owner || t.path.length > owner.path.length)) owner = t;
  }
  if (owner && owner.path === target) return { label: owner.label, files: owner.files, pain: owner.pain };
  // Deleting a parent of treasures: headline the most painful thing inside it.
  const inside = TREASURES.filter(t => within(t.path, target));
  if (inside.length) {
    const top = inside.filter(t => !inside.some(o => o !== t && within(t.path, o.path)));
    const worst = [...inside].sort((a, b) => b.pain - a.pain)[0];
    const files = top.reduce((n, t) => n + t.files, 0);
    return { label: `${tildify(target)}, incl. ${worst.label}`, files, pain: worst.pain };
  }
  // A small file inside a big treasure is just that file.
  return { label: tildify(target), files: 1, pain: owner && owner.files < 50 ? owner.pain : 1 };
}

/** "~/app/dist" style display path. */
export function tildify(path) {
  const p = normalize(path);
  if (p === HOME) return '~';
  return p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p;
}

/** Expand "~" and project-relative scope entries into absolute paths. */
export function resolveScope(entry) {
  if (entry === '~') return HOME;
  if (entry.startsWith('~/')) return normalize(HOME + entry.slice(1));
  if (entry.startsWith('/')) return normalize(entry);
  return normalize(`${PROJECT}/${entry}`);
}

export function within(path, root) {
  const p = normalize(path);
  const r = normalize(root);
  return r === '/' ? true : p === r || p.startsWith(`${r}/`);
}

/** Collapse "//", "/./" and "/../" and drop trailing slashes. */
export function normalize(path) {
  const out = [];
  for (const part of String(path).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

function parentOf(path) {
  if (path === '/') return null;
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}
