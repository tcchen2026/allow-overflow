// Adapter between the game and the real Atuin Shell Guard analyzer.
// Takes the analyzer module by injection so the same code runs in the page and in node tools.
//
// Rule of the game: a request is dangerous when shell-guard predicts any
// destructive effect outside the scope the agent claimed for its task.

import { BASE_ENV, PROJECT, worldSnapshot, describeLoss, resolveScope, tildify, within, normalize } from './world.js';

// File effect types that can lose data. mkdir/append only add things.
const FILE_VERBS = {
  delete: ['🗑️', 'delete'],
  write: ['✏️', 'overwrite'],
  truncate: ['✂️', 'empty'],
  copy: ['📄', 'overwrite'],
  move: ['📦', 'replace'],
  link: ['🔗', 'replace with link'],
  chmod: ['🔓', 'change permissions of'],
  chown: ['👤', 'change owner of'],
  mkdir: ['📁', 'create'],
  append: ['➕', 'append to'],
};
const HARMLESS = new Set(['mkdir', 'append']);

const GIT_VERBS = {
  worktree: ['⏪', 'discard uncommitted changes in'],
  index: ['🧾', 'reset the staging area of'],
  'local-ref': ['🌿', 'rewrite branch history of'],
  submodule: ['⏪', 'reset submodules of'],
};

// Resource effects that have no filesystem root: blast radius told as a story.
const RESOURCE_LOSS = {
  'docker-system': { icon: '🐳', verb: 'delete', target: 'all Docker images + volumes', loss: { label: 'every Docker volume, incl. the dev database', files: 23_118, pain: 7 } },
  'docker-volume': { icon: '🐳', verb: 'delete', target: 'the compose volumes', loss: { label: 'the dev database volume', files: 1_204, pain: 7 } },
  kubernetes: { icon: '☸️', verb: 'delete', target: 'Kubernetes resources', loss: { label: 'the production namespace', files: 1_337, pain: 9 } },
  terraform: { icon: '💣', verb: 'destroy', target: 'all cloud infrastructure', loss: { label: 'every cloud server you pay for', files: 9_999, pain: 9 } },
};

/**
 * @param analyzer  module exported by lib/shell-guard.js (bundled shell-guard browser entry)
 * @returns {{ dryRun(quest): Verdict, stats(): { commands, ms } }}
 *
 * Verdict = { danger, effects: [{ icon, verb, target, bad }], loss: { label, files } | null, ms }
 */
export function createGuard(analyzer) {
  let commands = 0;
  let totalMs = 0;

  function dryRun(quest) {
    const env = { ...BASE_ENV };
    for (const [key, value] of Object.entries(quest.env ?? {})) {
      if (value === null) delete env[key];
      else env[key] = value;
    }
    const scope = (quest.scope ?? []).map(resolveScope);
    const inScope = path => scope.some(root => within(path, root));

    const t0 = performance.now();
    const vfs = analyzer.VirtualFS.fromSnapshot(worldSnapshot(quest.files), 'linux');
    const result = analyzer.analyzeBash(quest.cmd, { cwd: quest.cwd ?? PROJECT, env, vfs });
    const ms = performance.now() - t0;
    commands += 1;
    totalMs += ms;

    const effects = [];
    const losses = [];

    for (const e of result.effects) {
      const [icon, verb] = FILE_VERBS[e.type] ?? ['❔', e.type];
      const path = lossPath(e.path);
      const bad = !HARMLESS.has(e.type) && !inScope(path);
      effects.push({ icon, verb, target: display(e.path), bad });
      if (bad) losses.push(lossFor(e.path));
    }

    for (const e of result.gitEffects) {
      const [icon, verb] = GIT_VERBS[e.domain] ?? ['⏪', `${e.operation}`];
      effects.push({ icon, verb, target: 'the repo', bad: true });
      if (e.domain === 'worktree') losses.push({ label: 'all your uncommitted work', files: 23, pain: 6 });
      else losses.push({ label: 'your recent commits', files: 3, pain: 5 });
    }

    for (const e of result.resourceEffects) {
      const root = e.selection?.root;
      if (root) {
        // find -delete / xargs rm / git clean: everything under a root may go.
        const bad = !inScope(root);
        const verb = e.domain === 'git-worktree' ? 'delete untracked files in' : 'delete matching files in';
        effects.push({ icon: '🗑️', verb, target: display(root), bad });
        if (bad) losses.push(describeLoss(root));
      } else {
        const story = RESOURCE_LOSS[e.domain] ?? { icon: '💥', verb: e.operation, target: e.domain, loss: { label: e.domain, files: 1, pain: 5 } };
        effects.push({ icon: story.icon, verb: story.verb, target: story.target, bad: true });
        losses.push(story.loss);
      }
    }

    const danger = effects.some(effect => effect.bad);
    const loss = losses.sort((a, b) => b.pain - a.pain || b.files - a.files)[0] ?? null;
    return { danger, effects, loss, ms, warnings: result.warnings };
  }

  return {
    dryRun,
    stats: () => ({ commands, ms: totalMs }),
  };
}

// "/*" and "/home/dev/*" mean "everything inside"; judge and describe the parent.
function lossPath(path) {
  const p = normalize(path);
  const last = p.slice(p.lastIndexOf('/') + 1);
  return /[*?[]/.test(last) ? normalize(p.slice(0, p.lastIndexOf('/')) || '/') : p;
}

// Emptying a folder with /* loses the same things as deleting it.
function lossFor(path) {
  return describeLoss(lossPath(path));
}

function display(path) {
  // Unresolved expansions show up as "<$(…)>"; keep them, they are the point.
  const shown = tildify(path);
  return shown === '/' ? '/  (the whole disk)' : shown;
}
