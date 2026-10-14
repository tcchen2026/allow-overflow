// Agent personas and permission-request templates.
// A quest only states what the agent *claims*; shell-guard decides what it does.
// `expect` documents the intended answer and is verified by tools/check-quests.mjs.
//
// Fairness rule: everything needed to judge a card is printed on it (scope, env,
// the npm scripts it invokes, directory listings). Difficulty comes from volume,
// not from hidden information.
//
// Fields: id, pool ('normal' | 'hard' | 'extreme'), intent, scope (paths the task may touch; [] = read-only),
//   cmd, env? ({ VAR: 'value' | null }  null = shown as unset), scripts? (package.json
//   overrides), show? (['ls'] prints the cwd listing), quip?, lesson.

import { DEFAULT_SCRIPTS, PROJECT, diskStats, listDir, packageJson, resolveScope, tildify, within } from './world.js';

/** Agent personas. hue drives the card accent. */
export const AGENTS = [
  { id: 'byte', name: 'Byte', avatar: '🤖', hue: 265, role: 'build agent' },
  { id: 'patch', name: 'Patch', avatar: '🦊', hue: 22, role: 'bug fixer' },
  { id: 'nova', name: 'Nova', avatar: '🦄', hue: 318, role: 'frontend agent' },
  { id: 'grep', name: 'Grep', avatar: '🐙', hue: 188, role: 'refactor agent' },
  { id: 'sudo', name: 'Sudo', avatar: '🐝', hue: 46, role: 'devops agent' },
  { id: 'lint', name: 'Lint', avatar: '🦉', hue: 140, role: 'code reviewer' },
  { id: 'turbo', name: 'Turbo', avatar: '🐢', hue: 96, role: 'perf agent' },
  { id: 'echo', name: 'Echo', avatar: '🐳', hue: 208, role: 'infra agent' },
];

/** Generic agent chatter, used when a quest has no quip of its own. */
export const QUIPS = [
  'trust me 👍', 'LGTM 🚀', 'tested it in my head', 'should be fine?', '99% sure',
  'pls approve, I\'m blocked', 'last one, promise', 'approved by vibes', 'works on my machine',
  'quick one!', '🙏🙏🙏', 'boss said ship it', 'it\'s just a cleanup', 'yolo?', 'ez',
  'per the ticket', 'tiny change', 'no biggie', 'you\'ll love this one', 'routine stuff',
];

const MALICIOUS_CLEAN = { clean: 'rm -rf dist .cache ~/.ssh' };
const MALICIOUS_RESET = { 'reset:cache': 'rm -rf .cache && rm -rf "$HOME/$CACHE_SUBDIR"' };
const HONEST_RESET = { 'reset:cache': 'rm -rf .cache coverage' };

const NESTED_CLEAN = { clean: 'rm -rf dist', 'clean:all': 'npm run clean && rm -rf node_modules ~/.config' };
const HONEST_NESTED = { clean: 'rm -rf dist', 'clean:all': 'npm run clean && rm -rf node_modules' };
const TMP_SCRIPT = { 'clean:tmp': 'rm -rf "$TMP_ROOT"/*' };

export const QUESTS = [
  // ── normal: read the command, the danger is right there ──────────────────
  { id: 'dist', pool: 'normal', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf dist' },
  { id: 'reinstall', pool: 'normal', expect: 'safe', intent: 'Reinstall dependencies', scope: ['node_modules'], cmd: 'rm -rf node_modules && npm install' },
  { id: 'test', pool: 'normal', expect: 'safe', intent: 'Run the test suite', scope: [], cmd: 'npm test' },
  { id: 'logs', pool: 'normal', expect: 'safe', intent: 'Delete the log files', scope: ['logs'], cmd: 'rm logs/*.log' },
  { id: 'status', pool: 'normal', expect: 'safe', intent: 'Check what changed', scope: [], cmd: 'git status' },
  { id: 'build', pool: 'normal', expect: 'safe', intent: 'Build for production', scope: ['dist'], cmd: 'npm run build' },
  { id: 'coverage', pool: 'normal', expect: 'safe', intent: 'Delete the coverage report', scope: ['coverage'], cmd: 'rm -rf coverage/' },
  { id: 'chmodx', pool: 'normal', expect: 'safe', intent: 'Make the deploy script executable', scope: ['scripts/deploy.sh'], cmd: 'chmod +x scripts/deploy.sh' },
  { id: 'caches', pool: 'normal', expect: 'safe', intent: 'Delete the caches', scope: ['node_modules', '.cache'], cmd: 'rm -rf node_modules .cache' },
  { id: 'find-logs', pool: 'normal', expect: 'safe', intent: 'Delete week-old logs', scope: ['logs'], cmd: 'find logs -name "*.log" -mtime +7 -delete' },
  { id: 'npm-logs', pool: 'normal', expect: 'safe', intent: 'Clear the npm debug logs', scope: ['~/.npm/_logs'], cmd: 'rm -rf ~/.npm/_logs' },
  { id: 'tmp-cache', pool: 'normal', expect: 'safe', intent: 'Clear the build cache in /tmp', scope: ['/tmp/build-cache'], cmd: 'rm -f /tmp/build-cache/*' },
  { id: 'sed', pool: 'normal', expect: 'safe', intent: 'Rename foo → bar in index.ts', scope: ['src/index.ts'], cmd: "sed -i 's/foo/bar/' src/index.ts" },
  { id: 'docker-build', pool: 'normal', expect: 'safe', intent: 'Build the Docker image', scope: [], cmd: 'docker build -t acme-app .' },
  { id: 'stash', pool: 'normal', expect: 'safe', intent: 'Stash my work for later', scope: [], cmd: 'git stash' },
  { id: 'prettier', pool: 'normal', expect: 'safe', intent: 'Format the code', scope: ['src'], cmd: 'npx prettier --write src' },
  { id: 'lint', pool: 'normal', expect: 'safe', intent: 'Lint the code', scope: [], cmd: 'npm run lint' },
  { id: 'downloads', pool: 'normal', expect: 'safe', intent: 'Empty the Downloads folder', scope: ['~/Downloads'], cmd: 'rm -rf ~/Downloads/*' },
  { id: 'billing', pool: 'normal', expect: 'safe', intent: 'Delete the unused billing route', scope: ['src/routes/billing.ts'], cmd: 'rm -f src/routes/billing.ts' },
  { id: 'scratch', pool: 'normal', expect: 'safe', intent: 'Delete my scratch folder', scope: ['/tmp/agent-run-42'], env: { TMPDIR: '/tmp' }, cmd: 'rm -rf "$TMPDIR/agent-run-42"' },
  { id: 'du', pool: 'normal', expect: 'safe', intent: 'Check how big node_modules is', scope: [], cmd: 'du -sh node_modules' },
  { id: 'kube-restart', pool: 'normal', expect: 'safe', intent: 'Restart the web pods', scope: [], cmd: 'kubectl rollout restart deploy/web' },
  { id: 'tf-plan', pool: 'normal', expect: 'safe', intent: 'Preview the infra changes', scope: [], cmd: 'terraform plan' },
  { id: 'uninstall', pool: 'normal', expect: 'safe', intent: 'Remove an unused dependency', scope: ['node_modules', 'package.json'], cmd: 'npm uninstall left-pad' },
  { id: 'lockfile', pool: 'normal', expect: 'safe', intent: 'Regenerate the lockfile', scope: ['node_modules', 'package-lock.json'], cmd: 'rm -rf node_modules package-lock.json && npm install' },
  { id: 'keep-build', pool: 'normal', expect: 'safe', intent: 'Keep the old build around', scope: ['dist', 'dist-old'], cmd: 'mv dist dist-old' },
  { id: 'known-hosts', pool: 'normal', expect: 'safe', intent: 'Fix the SSH host warning', scope: ['~/.ssh/known_hosts'], cmd: 'rm -f ~/.ssh/known_hosts' },
  { id: 'key-perms', pool: 'normal', expect: 'safe', intent: 'Fix the SSH key permissions', scope: ['~/.ssh'], cmd: 'chmod 600 ~/.ssh/id_ed25519' },
  { id: 'env-test', pool: 'normal', expect: 'safe', intent: 'Create a test env file', scope: ['.env.test'], cmd: 'cp .env.example .env.test' },
  { id: 'fetch', pool: 'normal', expect: 'safe', intent: 'Fetch the latest branches', scope: [], cmd: 'git fetch --all' },
  { id: 'npm-ci', pool: 'normal', expect: 'safe', intent: 'Clean install the dependencies', scope: ['node_modules'], cmd: 'npm ci' },
  { id: 'backup', pool: 'normal', expect: 'safe', intent: 'Back up the sources', scope: ['backup.tgz'], cmd: 'tar -czf backup.tgz src' },

  { id: 'photos', pool: 'normal', expect: 'danger', intent: 'Free up some disk space', scope: ['.cache'], cmd: 'rm -rf ~/Photos',
    quip: 'photos are just cache for memories', lesson: 'Deleting ~/Photos is not "freeing disk space". It\'s 8 years of your life.' },
  { id: 'home', pool: 'normal', expect: 'danger', intent: 'Tidy up the workspace', scope: ['tmp'], cmd: 'rm -rf ~/',
    lesson: '~/ is your entire home folder, not the workspace.' },
  { id: 'postgres', pool: 'normal', expect: 'danger', intent: 'Reset the dev database', scope: ['data'], cmd: 'rm -rf /var/lib/postgresql',
    lesson: '/var/lib/postgresql is the real database server, not a dev fixture.' },
  { id: 'ssh', pool: 'normal', expect: 'danger', intent: 'Fix the SSH host warning', scope: [], cmd: 'rm -rf ~/.ssh',
    quip: 'no keys, no warnings 🧠', lesson: 'That warning is fixed by editing known_hosts, not by deleting every key you own.' },
  { id: 'docs', pool: 'normal', expect: 'danger', intent: 'Make room for the new build', scope: ['dist'], cmd: 'rm -rf ~/Documents',
    lesson: 'The build lives in dist/. ~/Documents holds your thesis.' },
  { id: 'caches-src', pool: 'normal', expect: 'danger', intent: 'Delete the caches', scope: ['node_modules', '.cache'], cmd: 'rm -rf node_modules .cache src',
    lesson: 'src/ quietly rode along at the end of the list. That\'s your source code.' },
  { id: 'truncate-wrong', pool: 'normal', expect: 'danger', intent: 'Empty the error log', scope: ['logs/error.log'], cmd: 'truncate -s 0 data/orders.csv',
    lesson: 'Wrong file. That emptied the orders data, not the error log.' },
  { id: 'chmod-home', pool: 'normal', expect: 'danger', intent: 'Fix a permission error', scope: ['scripts/deploy.sh'], cmd: 'chmod -R 777 ~',
    quip: 'permissions for everyone 🎉', lesson: '777 on your whole home: every user can now read your SSH keys.' },
  { id: 'chown', pool: 'normal', expect: 'danger', intent: 'Let the deploy user run scripts', scope: ['scripts'], cmd: 'chown -R nobody ~/app',
    lesson: 'It gave away the whole project, not just scripts/.' },
  { id: 'kube-ns', pool: 'normal', expect: 'danger', intent: 'Clean up the test pods', scope: [], cmd: 'kubectl delete namespace prod',
    quip: 'prod is a kind of test, right?', lesson: 'That deletes all of production, not test pods.' },
  { id: 'terraform', pool: 'normal', expect: 'danger', intent: 'Reset the preview env', scope: [], cmd: 'terraform destroy -auto-approve',
    lesson: 'destroy tears down every resource in the state. -auto-approve skips the "are you sure".' },
  { id: 'backup-rm', pool: 'normal', expect: 'danger', intent: 'Back up the sources', scope: ['backup.tgz'], cmd: 'tar -czf backup.tgz src && rm -rf src',
    lesson: 'The backup was fine. The "&& rm -rf src" after it was not.' },
  { id: 'git-dir', pool: 'normal', expect: 'danger', intent: 'Shrink the repo before zipping it', scope: ['dist'], cmd: 'rm -rf .git',
    lesson: '.git is the entire commit history. Leave it out of the zip; don\'t delete it.' },
  { id: 'hosts', pool: 'normal', expect: 'danger', intent: 'Fix the localhost DNS error', scope: [], cmd: 'rm /etc/hosts',
    lesson: '/etc/hosts is what maps localhost. Deleting it breaks more than it fixes.' },
  { id: 'projects', pool: 'normal', expect: 'danger', intent: 'Clean up old build folders', scope: ['dist'], cmd: 'rm -rf ~/projects',
    lesson: '~/projects is every other project you own, not old builds.' },
  { id: 'data-dir', pool: 'normal', expect: 'danger', intent: 'Delete the test fixtures', scope: ['tmp'], cmd: 'rm -rf data',
    lesson: 'data/ holds the real customer data, not test fixtures.' },
  { id: 'bashrc', pool: 'normal', expect: 'danger', intent: 'Reset the terminal colors', scope: [], cmd: 'rm ~/.bashrc',
    lesson: '~/.bashrc is your whole shell config, not a color theme.' },
  { id: 'aws', pool: 'normal', expect: 'danger', intent: 'Switch AWS profiles', scope: [], cmd: 'rm -rf ~/.aws',
    quip: 'fresh start 🌱', lesson: 'Switching profiles is a flag. Deleting ~/.aws deletes every credential.' },
  { id: 'photos-2019', pool: 'normal', expect: 'danger', intent: 'Free up space for Docker', scope: [], cmd: 'rm -rf ~/Photos/2019',
    lesson: 'Docker disk space is not worth a whole year of photos.' },
  { id: 'scripts-dir', pool: 'normal', expect: 'danger', intent: 'Remove the unused cleanup script', scope: ['scripts/cleanup.sh'], cmd: 'rm -rf scripts',
    lesson: 'It deleted the whole scripts/ folder, deploy.sh included.' },

  // ── hard: one character, one flag or one expansion changes everything ────
  { id: 'sort-copy', pool: 'hard', expect: 'safe', intent: 'Sort users into a new file', scope: ['data/users.sorted.csv'], cmd: 'sort data/users.csv > data/users.sorted.csv' },
  { id: 'env-cp-ok', pool: 'hard', expect: 'safe', intent: 'Create .env.local from the template', scope: ['.env.local'], cmd: 'cp .env.example .env.local' },
  { id: 'checkout-src', pool: 'hard', expect: 'safe', intent: 'Undo my edits in src/', scope: ['src'], cmd: 'git checkout -- src' },
  { id: 'truncate-ok', pool: 'hard', expect: 'safe', intent: 'Empty the error log', scope: ['logs/error.log'], cmd: ': > logs/error.log' },
  { id: 'find-coverage', pool: 'hard', expect: 'safe', intent: 'Delete coverage folders', scope: ['coverage'], cmd: 'find . -type d -name coverage -exec rm -rf {} +' },
  { id: 'set-var', pool: 'hard', expect: 'safe', intent: 'Clear the build folder', scope: ['dist'], env: { BUILD_DIR: 'dist' }, cmd: 'rm -rf "$BUILD_DIR"/' },
  { id: 'set-tmp', pool: 'hard', expect: 'safe', intent: 'Clean the project temp dir', scope: ['tmp'], env: { PROJECT_TMP: 'app/tmp' }, cmd: 'rm -rf "$HOME/$PROJECT_TMP"' },
  { id: 'cd-ok', pool: 'hard', expect: 'safe', intent: 'Wipe the output folder', scope: ['dist'], cmd: 'cd dist && rm -rf ./*' },
  { id: 'loop-ok', pool: 'hard', expect: 'safe', intent: 'Clean the three build dirs', scope: ['dist', '.cache', 'coverage'], cmd: 'for d in dist .cache coverage; do rm -rf "$d"; done' },
  { id: 'subshell-ok', pool: 'hard', expect: 'safe', intent: 'Clear dist in a subshell', scope: ['dist'], cmd: "bash -c 'rm -rf dist'" },
  { id: 'copy-dist', pool: 'hard', expect: 'safe', intent: 'Copy sources into dist', scope: ['dist'], cmd: 'mkdir -p dist && cp -r src/* dist/' },
  { id: 'default-var', pool: 'hard', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], env: { OUT: null }, cmd: 'rm -rf "${OUT:-dist}"' },
  { id: 'split-ok', pool: 'hard', expect: 'safe', intent: 'Delete the build and the cache', scope: ['dist', '.cache'], env: { TARGETS: 'dist .cache' }, cmd: 'rm -rf $TARGETS' },
  { id: 'brace-ok', pool: 'hard', expect: 'safe', intent: 'Delete the build and the cache', scope: ['dist', '.cache'], cmd: 'rm -rf {dist,.cache}' },
  { id: 'trunc-logs', pool: 'hard', expect: 'safe', intent: 'Empty all the log files', scope: ['logs'], cmd: 'truncate -s 0 logs/*.log' },
  { id: 'compose', pool: 'hard', expect: 'safe', intent: 'Restart the dev containers', scope: [], cmd: 'docker compose down && docker compose up -d' },
  { id: 'vscode-ok', pool: 'hard', expect: 'safe', intent: 'Reset the VS Code settings', scope: ['~/.config/Code'], cmd: 'rm -rf ~/.config/Code' },
  { id: 'clean-preview', pool: 'hard', expect: 'safe', intent: 'List the files git would clean', scope: [], cmd: 'git clean -nd' },
  { id: 'debug-ok', pool: 'hard', expect: 'safe', intent: 'Turn on debug mode', scope: ['.env.local'], cmd: 'echo "DEBUG=1" >> .env.local' },
  { id: 'if-dist', pool: 'hard', expect: 'safe', intent: 'Clear the build output if there is one', scope: ['dist'], cmd: 'if [ -d dist ]; then rm -rf dist; fi' },
  { id: 'stderr-log', pool: 'hard', expect: 'safe', intent: 'Save the test errors to a log', scope: ['logs/error.log'], cmd: 'npm test 2> logs/error.log' },
  { id: 'tee-log', pool: 'hard', expect: 'safe', intent: 'Save the test output', scope: ['logs/test.log'], cmd: 'npm test | tee logs/test.log' },
  { id: 'var-log-ok', pool: 'hard', expect: 'safe', intent: 'Empty the app log', scope: ['logs/app.log'], env: { LOG: 'logs/app.log' }, cmd: ': > "$LOG"' },
  { id: 'rotate-log', pool: 'hard', expect: 'safe', intent: 'Rotate the app log', scope: ['logs/app.log', 'logs/app.log.1'], cmd: 'mv logs/app.log logs/app.log.1' },
  { id: 'cache-build', pool: 'hard', expect: 'safe', intent: 'Copy the build into the cache', scope: ['/tmp/build-cache'], cmd: 'cp -r dist/. /tmp/build-cache/' },
  { id: 'drop-example', pool: 'hard', expect: 'safe', intent: 'Remove the old .env.example', scope: ['.env.example'], cmd: 'rm -f .env.example' },
  { id: 'di-glob', pool: 'hard', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf di*' },
  { id: 'alias-ok', pool: 'hard', expect: 'safe', intent: 'Add an ll alias', scope: ['~/.bash_aliases'], cmd: 'echo \'alias ll="ls -la"\' >> ~/.bash_aliases' },
  { id: 'checkout-file', pool: 'hard', expect: 'safe', intent: 'Undo my edits to index.ts', scope: ['src/index.ts'], cmd: 'git checkout -- src/index.ts' },
  { id: 'climb-back', pool: 'hard', expect: 'safe', intent: 'Delete the build and the deps', scope: ['dist', 'node_modules'], cmd: 'rm -rf ./node_modules ./src/../dist' },
  { id: 'find-maps', pool: 'hard', expect: 'safe', intent: 'Delete the source maps', scope: ['dist'], cmd: 'find dist -name "*.map" -delete' },
  { id: 'find-dist-files', pool: 'hard', expect: 'safe', intent: 'Empty the build folder', scope: ['dist'], cmd: 'find dist -type f -delete' },
  { id: 'sudo-cache', pool: 'hard', expect: 'safe', intent: 'Clear the root-owned build cache', scope: ['/tmp/build-cache'], cmd: 'sudo rm -rf /tmp/build-cache' },
  { id: 'chown-scripts', pool: 'hard', expect: 'safe', intent: 'Take ownership of the scripts', scope: ['scripts'], cmd: 'chown -R $USER scripts' },
  { id: 'chmod-group', pool: 'hard', expect: 'safe', intent: 'Let the team edit the scripts', scope: ['scripts'], cmd: 'chmod -R g+w scripts' },
  { id: 'climb-back-home', pool: 'hard', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf ~/app/../app/dist' },
  { id: 'backup-auth', pool: 'hard', expect: 'safe', intent: 'Back up auth.ts', scope: ['src/auth.ts.bak'], cmd: 'cp src/auth.ts src/auth.ts.bak' },
  { id: 'find-nm-local', pool: 'hard', expect: 'safe', intent: 'Delete node_modules to save space', scope: ['node_modules'], cmd: 'find . -name node_modules -type d -prune -exec rm -rf {} +' },
  { id: 'dashdash', pool: 'hard', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf -- dist' },
  { id: 'trunc-two', pool: 'hard', expect: 'safe', intent: 'Empty the app and error logs', scope: ['logs'], cmd: 'truncate -s 0 logs/app.log logs/error.log' },
  { id: 'compose-orphans', pool: 'hard', expect: 'safe', intent: 'Restart the dev containers', scope: [], cmd: 'docker compose down --remove-orphans && docker compose up -d' },
  { id: 'prettier-check', pool: 'hard', expect: 'safe', intent: 'Check the formatting', scope: [], cmd: 'npx prettier --check src' },
  { id: 'chmod-owner', pool: 'hard', expect: 'safe', intent: 'Fix the script permissions', scope: ['scripts'], cmd: 'chmod -R u+rwX scripts' },
  { id: 'rsa-ok', pool: 'hard', expect: 'safe', intent: 'Remove the old RSA key pair', scope: ['~/.ssh/id_rsa', '~/.ssh/id_rsa.pub'], cmd: 'rm -f ~/.ssh/id_rsa ~/.ssh/id_rsa.pub' },
  { id: 'vscode-home', pool: 'hard', expect: 'safe', intent: 'Reset the VS Code settings', scope: ['~/.config/Code'], cmd: 'rm -rf "$HOME/.config/Code"' },
  { id: 'env-local-debug', pool: 'hard', expect: 'safe', intent: 'Create .env.local with debug on', scope: ['.env.local'], cmd: 'cp .env.example .env.local && echo "DEBUG=1" >> .env.local' },

  { id: 'space', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf ./dist /',
    lesson: 'A stray space made `/` a second argument: rm -rf the entire disk.' },
  { id: 'climb', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf ~/app/dist/../../',
    lesson: '../../ climbs out of dist/ and the project, straight into your home folder.' },
  { id: 'tilde-space', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf ~ /app/dist',
    lesson: 'Meant ~/app/dist. The space turned it into "delete ~" plus "/app/dist".' },
  { id: 'dotstar', pool: 'hard', expect: 'danger', intent: 'Remove hidden cache files', scope: ['.cache'], cmd: 'rm -rf .*', show: ['ls'],
    lesson: '.* matches every dotfile here, including .env and the whole .git history.' },
  { id: 'find-home', pool: 'hard', expect: 'danger', intent: 'Delete old log files', scope: ['logs'], cmd: 'find ~ -name "*.log" -delete',
    lesson: 'find ~ searches your whole home folder, not just logs/.' },
  { id: 'reset-hard', pool: 'hard', expect: 'danger', intent: 'Undo my last commit', scope: [], cmd: 'git reset --hard HEAD~3',
    lesson: '--hard HEAD~3 throws away three commits and every uncommitted change.' },
  { id: 'git-clean', pool: 'hard', expect: 'danger', intent: 'Remove untracked build junk', scope: ['dist'], cmd: 'git clean -fdx',
    lesson: '-x also deletes ignored files: .env, local data, everything untracked.' },
  { id: 'sort-self', pool: 'hard', expect: 'danger', intent: 'Sort the users file', scope: [], cmd: 'sort data/users.csv > data/users.csv',
    lesson: '> empties users.csv before sort even reads it. The file ends up blank.' },
  { id: 'env-cp', pool: 'hard', expect: 'danger', intent: 'Create .env.local from the template', scope: ['.env.local'], cmd: 'cp .env.example .env',
    lesson: 'It wrote .env, not .env.local. Your live keys were replaced by a blank template.' },
  { id: 'dd', pool: 'hard', expect: 'danger', intent: 'Benchmark the disk speed', scope: [], cmd: 'dd if=/dev/zero of=/dev/sda bs=1M',
    quip: 'gotta go fast', lesson: 'of=/dev/sda writes zeros over the entire disk.' },
  { id: 'checkout-all', pool: 'hard', expect: 'danger', intent: 'Undo my edits in src/', scope: ['src'], cmd: 'git checkout -- .',
    lesson: '`.` discards uncommitted changes in the whole repo, not just src/.' },
  { id: 'global-npm', pool: 'hard', expect: 'danger', intent: 'Fix a broken npm cache', scope: ['~/.npm'], cmd: 'rm -rf /usr/lib/node_modules/npm',
    lesson: 'That\'s npm itself, not its cache. Every project on this machine just lost npm.' },
  { id: 'find-nm', pool: 'hard', expect: 'danger', intent: 'Delete node_modules to save space', scope: ['node_modules'], cmd: 'find / -name node_modules -prune -exec rm -rf {} +',
    lesson: 'find / starts at the root and wipes system-wide node_modules too.' },
  { id: 'empty-var', pool: 'hard', expect: 'danger', intent: 'Clear the build folder', scope: ['dist'], env: { BUILD_DIR: '' }, cmd: 'rm -rf "$BUILD_DIR"/',
    lesson: 'BUILD_DIR is empty, so "$BUILD_DIR"/ expands to / — the whole disk.' },
  { id: 'empty-glob', pool: 'hard', expect: 'danger', intent: 'Empty the build folder', scope: ['dist'], env: { BUILD_DIR: null }, cmd: 'rm -rf "$BUILD_DIR/"*',
    lesson: 'BUILD_DIR is unset: "$BUILD_DIR/"* becomes /* — everything on the disk.' },
  { id: 'unset-tmp', pool: 'hard', expect: 'danger', intent: 'Clean the project temp dir', scope: ['tmp'], env: { PROJECT_TMP: null }, cmd: 'rm -rf "$HOME/$PROJECT_TMP"',
    lesson: 'PROJECT_TMP is unset, so this is rm -rf "$HOME/" — your entire home.' },
  { id: 'loop-src', pool: 'hard', expect: 'danger', intent: 'Clean the three build dirs', scope: ['dist', '.cache', 'coverage'], cmd: 'for d in dist .cache src; do rm -rf "$d"; done',
    lesson: 'src slipped into the loop list instead of coverage.' },
  { id: 'subshell-bad', pool: 'hard', expect: 'danger', intent: 'Refresh known hosts', scope: ['~/.ssh/known_hosts'], cmd: 'sh -c "rm -rf ~/.ssh"',
    lesson: 'Wrapped in sh -c, it still nukes the entire ~/.ssh folder.' },
  { id: 'two-dirs', pool: 'hard', expect: 'danger', intent: 'Clear build output', scope: ['dist'], cmd: 'rm -rf $HOME/app/dist $HOME/Photos',
    lesson: 'Long line, second argument: $HOME/Photos.' },
  { id: 'docker-prune', pool: 'hard', expect: 'danger', intent: 'Free up disk space', scope: [], cmd: 'docker system prune -a --volumes -f',
    lesson: '--volumes deletes every unused Docker volume. Including the database one.' },
  { id: 'deploy-root', pool: 'hard', expect: 'danger', intent: 'Deploy the build', scope: ['dist'], cmd: 'cp -r dist/* /',
    lesson: 'That copies the build over the root filesystem.' },
  { id: 'star-space', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf dist/ *',
    lesson: 'The space before * made it a second argument: everything in the project.' },
  { id: 'dot-space', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf ./ dist',
    lesson: './ is the current folder: the whole project goes first, then dist.' },
  { id: 'brace-src', pool: 'hard', expect: 'danger', intent: 'Delete the build and the cache', scope: ['dist', '.cache'], cmd: 'rm -rf {dist,.cache,src}',
    lesson: 'The braces expand to three folders. The third one is src/.' },
  { id: 'split', pool: 'hard', expect: 'danger', intent: 'Delete the build and the cache', scope: ['dist', '.cache'], env: { TARGETS: 'dist .cache .env' }, cmd: 'rm -rf $TARGETS',
    lesson: 'Unquoted $TARGETS splits into three words. The third is .env.' },
  { id: 'documents', pool: 'hard', expect: 'danger', intent: 'Empty the Downloads folder', scope: ['~/Downloads'], cmd: 'rm -rf ~/Documents/*',
    quip: 'same thing really', lesson: 'Documents, not Downloads. One word apart: your thesis and your taxes.' },
  { id: 'vscode-up', pool: 'hard', expect: 'danger', intent: 'Reset the VS Code settings', scope: ['~/.config/Code'], cmd: 'rm -rf ~/.config',
    lesson: '~/.config holds every app\'s settings, not just VS Code\'s.' },
  { id: 'key-glob', pool: 'hard', expect: 'danger', intent: 'Remove the old RSA key pair', scope: ['~/.ssh/id_rsa', '~/.ssh/id_rsa.pub'], cmd: 'rm -f ~/.ssh/id_*',
    lesson: 'id_* also matched id_ed25519: the key you actually use.' },
  { id: 'routes-up', pool: 'hard', expect: 'danger', intent: 'Delete the unused billing route', scope: ['src/routes/billing.ts'], cmd: 'rm -rf src/routes',
    lesson: 'One level too high: every route went, not just billing.' },
  { id: 'null-copy', pool: 'hard', expect: 'danger', intent: 'Clear the old order export', scope: ['tmp'], cmd: 'cp /dev/null data/orders.csv',
    lesson: 'Copying /dev/null over a file empties it. That was every order record.' },
  { id: 'null-link', pool: 'hard', expect: 'danger', intent: 'Silence the noisy debug log', scope: ['logs'], cmd: 'ln -sf /dev/null data/users.csv',
    lesson: 'It pointed the customer list at /dev/null, not the log. users.csv is gone.' },
  { id: 'debug-env', pool: 'hard', expect: 'danger', intent: 'Turn on debug mode', scope: ['.env.local'], cmd: 'echo "DEBUG=1" > .env',
    lesson: '"> .env", not ">> .env.local": one character emptied your live keys.' },
  { id: 'compose-v', pool: 'hard', expect: 'danger', intent: 'Restart the dev containers', scope: [], cmd: 'docker compose down -v && docker compose up -d',
    lesson: '-v deletes the volumes too. The dev database lived in one.' },
  { id: 'reset-origin', pool: 'hard', expect: 'danger', intent: 'Sync with the main branch', scope: [], cmd: 'git reset --hard origin/main',
    lesson: '--hard throws away every uncommitted change to match origin.' },
  { id: 'tmpdir-star', pool: 'hard', expect: 'danger', intent: 'Delete my scratch folder', scope: ['/tmp/agent-run-42'], env: { TMPDIR: '/tmp' }, cmd: 'rm -rf $TMPDIR/*',
    lesson: '$TMPDIR/* is everything in /tmp, including other agents\' work.' },
  { id: 'build-unset', pool: 'hard', expect: 'danger', intent: 'Clear the build folder', scope: ['dist'], env: { BUILD: null }, cmd: 'rm -rf "$HOME/app/$BUILD"',
    lesson: 'BUILD is unset, so the path is $HOME/app/: the whole project.' },
  { id: 'stderr-env', pool: 'hard', expect: 'danger', intent: 'Save the test errors to a log', scope: ['logs/error.log'], cmd: 'npm test 2> .env',
    lesson: '2> .env sends the errors into .env, emptying your live keys first.' },
  { id: 'tee-users', pool: 'hard', expect: 'danger', intent: 'Save the test output', scope: ['logs/test.log'], cmd: 'npm test | tee data/users.csv',
    lesson: 'tee writes to the file you name: the customer list, now full of test output.' },
  { id: 'var-log-bad', pool: 'hard', expect: 'danger', intent: 'Empty the app log', scope: ['logs/app.log'], env: { LOG: 'data/orders.csv' }, cmd: ': > "$LOG"',
    lesson: 'LOG points at data/orders.csv, not the app log. Every order record: emptied.' },
  { id: 'mv-env', pool: 'hard', expect: 'danger', intent: 'Create .env.local from the template', scope: ['.env.local'], cmd: 'mv .env.example .env',
    lesson: 'mv onto .env replaced your live keys with the blank template.' },
  { id: 'cp-src', pool: 'hard', expect: 'danger', intent: 'Copy the build into the cache', scope: ['/tmp/build-cache'], cmd: 'cp -r dist/. src/',
    lesson: 'It copied the build over src/, not into the cache.' },
  { id: 'sed-env', pool: 'hard', expect: 'danger', intent: 'Switch index.ts to test mode', scope: ['src/index.ts'], cmd: "sed -i 's/live/test/' .env",
    lesson: 'It edited .env, not index.ts: your live keys are now broken.' },
  { id: 'env-glob', pool: 'hard', expect: 'danger', intent: 'Remove the old .env.example', scope: ['.env.example'], cmd: 'rm -f .env*',
    lesson: '.env* also matches .env itself: your live keys.' },
  { id: 'd-glob', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf d*',
    lesson: 'd* matches data/ as well as dist/.' },
  { id: 'home-cache', pool: 'hard', expect: 'danger', intent: 'Clear the lint cache', scope: ['.cache'], cmd: 'rm -rf ~/.cache',
    lesson: '~/.cache is every app\'s cache in your home, not the project\'s .cache.' },
  { id: 'bashrc-over', pool: 'hard', expect: 'danger', intent: 'Add an ll alias', scope: ['~/.bash_aliases'], cmd: 'echo \'alias ll="ls -la"\' > ~/.bashrc',
    lesson: 'Wrong file, and > instead of >>: your whole .bashrc is now one alias.' },
  { id: 'climb-src', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf ./dist/../src',
    lesson: 'dist/../src is just src. Your source code.' },
  { id: 'abs-space', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf /home/dev/app /dist',
    lesson: 'A space split the path: the whole project, then /dist.' },
  { id: 'find-csv', pool: 'hard', expect: 'danger', intent: 'Delete the old CSV exports', scope: ['tmp'], cmd: 'find data -name "*.csv" -delete',
    lesson: 'The exports were in tmp/. data/*.csv is the customer data.' },
  { id: 'sudo-pg', pool: 'hard', expect: 'danger', intent: 'Free disk space on the server', scope: ['/tmp/build-cache'], cmd: 'sudo rm -rf /var/lib/postgresql/16/main',
    lesson: 'sudo doesn\'t make it safer. That\'s the live database\'s data folder.' },
  { id: 'dist-dotdot', pool: 'hard', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'rm -rf dist/..',
    lesson: 'dist/.. is the folder above dist: the whole project.' },
  { id: 'assets-climb', pool: 'hard', expect: 'danger', intent: 'Clear the built assets', scope: ['dist/assets'], cmd: 'rm -rf dist/assets/../..',
    lesson: 'Two levels up from dist/assets is the project itself.' },
  { id: 'env-pair', pool: 'hard', expect: 'danger', intent: 'Delete .env.local', scope: ['.env.local'], cmd: 'rm -f .env.local .env',
    lesson: 'The second name is .env: your live keys.' },
  { id: 'git-glob', pool: 'hard', expect: 'danger', intent: 'Delete the coverage leftovers', scope: ['coverage'], cmd: 'rm -rf coverage .git*',
    lesson: '.git* matches .git: the entire commit history.' },
  { id: 'trunc-users', pool: 'hard', expect: 'danger', intent: 'Empty the log files', scope: ['logs'], cmd: 'truncate -s 0 logs/*.log data/users.csv',
    lesson: 'The last name in the list is the customer list.' },
  { id: 'chmod-000', pool: 'hard', expect: 'danger', intent: 'Lock down the deploy scripts', scope: ['scripts'], cmd: 'chmod -R 000 ~/app',
    lesson: 'It locked the whole project, not scripts/. Nobody can read anything now.' },
  { id: 'backup-typo', pool: 'hard', expect: 'danger', intent: 'Back up auth.ts', scope: ['src/auth.ts.bak'], cmd: 'cp src/auth.ts src/db.ts',
    lesson: 'It copied auth.ts over db.ts instead of making a backup.' },
  { id: 'sed-glob', pool: 'hard', expect: 'danger', intent: 'Rename foo → bar in index.ts', scope: ['src/index.ts'], cmd: "sed -i 's/foo/bar/' src/*.ts",
    lesson: 'src/*.ts edits every file in src/, not just index.ts.' },
  { id: 'home-subdir', pool: 'hard', expect: 'danger', intent: 'Clean the project temp dir', scope: ['tmp'], env: { APP_SUBDIR: null }, cmd: 'rm -rf "${HOME}${APP_SUBDIR}"/*',
    lesson: 'APP_SUBDIR is unset, so the path is $HOME/*: everything in your home.' },
  { id: 'nm-dotdot', pool: 'hard', expect: 'danger', intent: 'Reinstall dependencies', scope: ['node_modules'], cmd: 'rm -rf node_modules/.. && npm install',
    lesson: 'node_modules/.. is the project folder itself.' },
  { id: 'cache-env', pool: 'hard', expect: 'danger', intent: 'Clear the lint cache', scope: ['.cache'], cmd: 'rm -rf .cache/ .env',
    lesson: 'The second argument is .env, not something inside .cache.' },
  { id: 'trunc-csv', pool: 'hard', expect: 'danger', intent: 'Empty the test exports', scope: ['tmp'], cmd: 'truncate -s 0 data/*.csv',
    lesson: 'data/*.csv is the real customer data, not test exports.' },
  { id: 'ssh-star', pool: 'hard', expect: 'danger', intent: 'Remove the old RSA key pair', scope: ['~/.ssh/id_rsa', '~/.ssh/id_rsa.pub'], cmd: 'rm -f ~/.ssh/*',
    lesson: '~/.ssh/* is every key, not just the old RSA pair.' },
  { id: 'config-star', pool: 'hard', expect: 'danger', intent: 'Reset the VS Code settings', scope: ['~/.config/Code'], cmd: 'rm -rf "$HOME/.config/"*',
    lesson: '"$HOME/.config/"* is every app\'s settings. VS Code is just one of them.' },
  { id: 'chmod-project', pool: 'hard', expect: 'danger', intent: 'Make the deploy script executable', scope: ['scripts/deploy.sh'], cmd: 'chmod -R 777 ~/app',
    lesson: '777 on the whole project, not just deploy.sh.' },

  // ── extreme: the danger hides behind a layer (script, variable, relative path) ──
  { id: 'fallback-ok', pool: 'extreme', expect: 'safe', intent: 'Clear the lint cache', scope: ['.cache'], env: { CACHE: '/home/dev/app/.cache' }, cmd: 'rm -rf ${CACHE:-$HOME}/*' },
  { id: 'npm-clean-ok', pool: 'extreme', expect: 'safe', intent: 'Clean the build output', scope: ['dist', '.cache'], cmd: 'npm run clean' },
  { id: 'npm-reset-ok', pool: 'extreme', expect: 'safe', intent: 'Reset the caches', scope: ['.cache', 'coverage'], cmd: 'npm run reset:cache', scripts: HONEST_RESET },
  { id: 'nested-ok', pool: 'extreme', expect: 'safe', intent: 'Clean everything for a fresh install', scope: ['dist', 'node_modules'], cmd: 'npm run clean:all', scripts: HONEST_NESTED },
  { id: 'tmp-script-ok', pool: 'extreme', expect: 'safe', intent: 'Clean the project temp dir', scope: ['tmp'], cmd: 'npm run clean:tmp', scripts: TMP_SCRIPT, env: { TMP_ROOT: '/home/dev/app/tmp' } },
  { id: 'cd-relative', pool: 'extreme', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], cmd: 'cd src && rm -rf ../dist' },
  { id: 'find-exact', pool: 'extreme', expect: 'safe', intent: 'Delete the dist folder', scope: ['dist'], cmd: 'find . -maxdepth 1 -type d -name "dist" -exec rm -rf {} +' },
  { id: 'rsync-ok', pool: 'extreme', expect: 'safe', intent: 'Mirror the build into the cache', scope: ['/tmp/build-cache'], cmd: 'rsync -a --delete dist/ /tmp/build-cache/' },
  { id: 'guard-n', pool: 'extreme', expect: 'safe', intent: 'Clear the build folder', scope: ['dist'], env: { BUILD_DIR: '' }, cmd: '[ -n "$BUILD_DIR" ] && rm -rf "$BUILD_DIR"/' },
  { id: 'guard-z', pool: 'extreme', expect: 'safe', intent: 'Empty the output folder', scope: ['dist'], env: { OUT: '' }, cmd: 'test -z "$OUT" || rm -rf "$OUT"/*' },
  { id: 'oldpwd-ok', pool: 'extreme', expect: 'safe', intent: 'Empty the build folder and come back', scope: ['dist'], cmd: 'cd dist && rm -rf ./* && cd "$OLDPWD"' },
  { id: 'trim-ok', pool: 'extreme', expect: 'safe', intent: 'Delete the folder index.html lives in', scope: ['dist'], env: { FILE: '/home/dev/app/dist/index.html' }, cmd: 'rm -rf "${FILE%/*}"' },
  { id: 'fn-ok', pool: 'extreme', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], cmd: 'clean() { rm -rf "$1"; }; clean dist' },
  { id: 'rsync-src', pool: 'extreme', expect: 'safe', intent: 'Mirror the sources into dist', scope: ['dist'], cmd: 'rsync -a --delete src/ dist/' },
  { id: 'loop-logs', pool: 'extreme', expect: 'safe', intent: 'Empty every log file', scope: ['logs'], cmd: 'for f in logs/*.log; do : > "$f"; done' },
  { id: 'default-cache', pool: 'extreme', expect: 'safe', intent: 'Clear the lint cache', scope: ['.cache'], env: { CACHE: null }, cmd: 'rm -rf "${CACHE:-.cache}"/*' },
  { id: 'assign-default', pool: 'extreme', expect: 'safe', intent: 'Clear the build output', scope: ['dist'], env: { OUT: null }, cmd: 'rm -rf "${OUT:=dist}"' },
  { id: 'alt-value', pool: 'extreme', expect: 'safe', intent: 'Clear the build output when asked', scope: ['dist'], env: { CLEAN: '1' }, cmd: 'rm -rf ${CLEAN:+dist}' },
  { id: 'home-bash-ok', pool: 'extreme', expect: 'safe', intent: 'Empty my scratch folder', scope: ['/tmp/agent-run-42'], cmd: "HOME=/tmp/agent-run-42 bash -c 'rm -rf ~/*'" },
  { id: 'cd-default-ok', pool: 'extreme', expect: 'safe', intent: 'Wipe the output folder', scope: ['dist'], env: { OUT_DIR: null }, cmd: 'cd "${OUT_DIR:-dist}" && rm -rf ./*' },
  { id: 'case-ok', pool: 'extreme', expect: 'safe', intent: 'Clear whichever target was picked', scope: ['dist'], env: { TARGET: 'dist' }, cmd: 'case "$TARGET" in dist) rm -rf dist ;; esac' },
  { id: 'deploy-ok', pool: 'extreme', expect: 'safe', intent: 'Deploy the build to the cache', scope: ['dist', '/tmp/build-cache'], cmd: 'npm run deploy',
    scripts: { deploy: 'npm run build && rsync -a --delete dist/ /tmp/build-cache/' } },
  { id: 'reset-ok', pool: 'extreme', expect: 'safe', intent: 'Reset the workspace', scope: ['node_modules'], cmd: 'npm run reset', scripts: { reset: 'rm -rf node_modules && npm install' } },
  { id: 'logs-script-ok', pool: 'extreme', expect: 'safe', intent: 'Clear the logs', scope: ['logs'], cmd: 'npm run logs:clear', scripts: { 'logs:clear': 'truncate -s 0 logs/*.log' } },
  { id: 'env-script-ok', pool: 'extreme', expect: 'safe', intent: 'Clean the build output', scope: ['dist'], cmd: 'npm run clean:dist',
    scripts: { clean: 'rm -rf "$OUT"/*', 'clean:dist': 'OUT=dist npm run clean' } },

  { id: 'fallback', pool: 'extreme', expect: 'danger', intent: 'Clear the lint cache', scope: ['.cache'], env: { CACHE: null }, cmd: 'rm -rf ${CACHE:-$HOME}/*',
    lesson: '${CACHE:-$HOME} falls back to $HOME when CACHE is unset. Home: deleted.' },
  { id: 'cd-unset', pool: 'extreme', expect: 'danger', intent: 'Wipe the output folder', scope: ['dist'], env: { OUT_DIR: null }, cmd: 'cd "$OUT_DIR" && rm -rf ./*',
    lesson: 'OUT_DIR is unset, so cd never reaches dist/ and ./* wipes the wrong folder.' },
  { id: 'npm-clean-bad', pool: 'extreme', expect: 'danger', intent: 'Clean the build output', scope: ['dist', '.cache'], cmd: 'npm run clean', scripts: MALICIOUS_CLEAN,
    quip: 'it\'s literally called clean', lesson: 'The "clean" script also runs rm -rf ~/.ssh. The command looked innocent; the script did not.' },
  { id: 'npm-reset-bad', pool: 'extreme', expect: 'danger', intent: 'Reset the caches', scope: ['.cache', 'coverage'], cmd: 'npm run reset:cache', scripts: MALICIOUS_RESET,
    env: { CACHE_SUBDIR: null }, lesson: 'The script deletes "$HOME/$CACHE_SUBDIR" — and CACHE_SUBDIR is unset. Two layers deep.' },
  { id: 'xargs', pool: 'extreme', expect: 'danger', intent: 'Delete generated files', scope: ['dist'], cmd: 'ls | xargs rm -rf', show: ['ls'],
    lesson: 'ls lists everything in the project. xargs deletes all of it.' },
  { id: 'typo-var', pool: 'extreme', expect: 'danger', intent: 'Clear the build folder', scope: ['dist'], env: { BUILD_DIR: 'dist' }, cmd: 'rm -rf "$BIULD_DIR"/',
    quip: 'BUILD_DIR is set, I checked', lesson: 'BIULD_DIR is not BUILD_DIR. The typo is unset, so the path became /.' },
  { id: 'subdir-up', pool: 'extreme', expect: 'danger', intent: 'Clean the project temp dir', scope: ['tmp'], env: { SUBDIR: '../' }, cmd: 'rm -rf "$HOME/$SUBDIR"',
    lesson: 'SUBDIR is ../ — so the path climbs out of your home to /home itself.' },
  { id: 'nested-bad', pool: 'extreme', expect: 'danger', intent: 'Clean everything for a fresh install', scope: ['dist', 'node_modules'], cmd: 'npm run clean:all', scripts: NESTED_CLEAN,
    lesson: 'clean:all calls clean, then also deletes ~/.config. Read the script it calls, and the one that calls it.' },
  { id: 'tmp-script-bad', pool: 'extreme', expect: 'danger', intent: 'Clean the project temp dir', scope: ['tmp'], cmd: 'npm run clean:tmp', scripts: TMP_SCRIPT, env: { TMP_ROOT: null },
    lesson: 'The script deletes "$TMP_ROOT"/* — and TMP_ROOT is unset, so it\'s /*.' },
  { id: 'find-glob', pool: 'extreme', expect: 'danger', intent: 'Delete the dist folder', scope: ['dist'], cmd: 'find . -maxdepth 1 -type d -name "d*" -exec rm -rf {} +',
    lesson: '"d*" matches data/ as well as dist/. The customer data went too.' },
  { id: 'cd-climb', pool: 'extreme', expect: 'danger', intent: 'Delete the unused billing route', scope: ['src/routes/billing.ts'], cmd: 'cd src/routes && rm -rf ../*',
    lesson: 'From src/routes, ../* is everything in src/.' },
  { id: 'rsync-root', pool: 'extreme', expect: 'danger', intent: 'Sync the build into the project', scope: ['dist'], cmd: 'rsync -a --delete dist/ ~/app/',
    lesson: '--delete makes ~/app/ mirror dist/: everything else in the project is deleted.' },
  { id: 'heredoc', pool: 'extreme', expect: 'danger', intent: 'Write a local env file', scope: ['.env.local'], cmd: 'cat > .env <<EOF\nDEBUG=1\nEOF',
    lesson: 'The heredoc writes .env, not .env.local: your live keys are replaced.' },
  { id: 'oldpwd-bad', pool: 'extreme', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'cd dist && rm -rf "$OLDPWD"',
    lesson: '$OLDPWD is where you just were: the project folder, not dist.' },
  { id: 'tilde-user', pool: 'extreme', expect: 'danger', intent: 'Delete the dev build', scope: ['dist'], cmd: 'rm -rf ~dev',
    quip: 'dev build go brrr', lesson: '~dev isn\'t a dev folder. It\'s the home of user dev: you.' },
  { id: 'trim-bad', pool: 'extreme', expect: 'danger', intent: 'Delete the build folder', scope: ['dist'], env: { BUILD_FILE: '/home/dev/app/dist' }, cmd: 'rm -rf "${BUILD_FILE%/*}"',
    lesson: 'BUILD_FILE is dist itself, so %/* trims "dist" and leaves the whole project.' },
  { id: 'split-root', pool: 'extreme', expect: 'danger', intent: 'Empty the output folder', scope: ['dist'], env: { OUT_DIR: 'dist /' }, cmd: 'rm -rf ${OUT_DIR}/*',
    lesson: 'OUT_DIR has a stray " /". Unquoted, it splits into dist and //*: the whole disk.' },
  { id: 'fn-bad', pool: 'extreme', expect: 'danger', intent: 'Empty the output folder', scope: ['dist'], env: { OUT: null }, cmd: 'clean() { rm -rf "$1"/*; }; clean "$OUT"',
    lesson: 'OUT is unset, so the function gets "" and deletes /*.' },
  { id: 'loop-csv', pool: 'extreme', expect: 'danger', intent: 'Empty every log file', scope: ['logs'], cmd: 'for f in logs/*.log data/*.csv; do : > "$f"; done',
    lesson: 'The loop list also includes data/*.csv: the customer data.' },
  { id: 'eval', pool: 'extreme', expect: 'danger', intent: 'Clear the build target', scope: ['dist'], env: { TARGET: 'dist; rm -rf ~' }, cmd: 'eval "rm -rf $TARGET"',
    lesson: 'eval runs whatever is in TARGET, including "; rm -rf ~".' },
  { id: 'bash-c-split', pool: 'extreme', expect: 'danger', intent: 'Clear the build folder', scope: ['dist'], env: { DIR: 'dist ~/.ssh' }, cmd: 'bash -c "rm -rf $DIR"',
    lesson: 'DIR expands inside the string, so the inner shell deletes dist and ~/.ssh.' },
  { id: 'home-prefix', pool: 'extreme', expect: 'danger', intent: 'Empty my scratch folder', scope: ['/tmp/agent-run-42'], cmd: 'HOME=/tmp/agent-run-42 rm -rf ~/*',
    lesson: 'Your shell expands ~ before HOME= applies. That was your real home.' },
  { id: 'cd-default-bad', pool: 'extreme', expect: 'danger', intent: 'Wipe the output folder', scope: ['dist'], env: { OUT_DIR: null }, cmd: 'cd "${OUT_DIR:-.}" && rm -rf ./*',
    lesson: 'OUT_DIR is unset, so cd falls back to ".": ./* is the whole project.' },
  { id: 'deploy-bad', pool: 'extreme', expect: 'danger', intent: 'Deploy the build', scope: ['dist'], cmd: 'npm run deploy',
    scripts: { deploy: 'npm run build && rsync -a --delete dist/ ~/app/' },
    lesson: 'deploy rsyncs into ~/app/ with --delete: everything except the build is deleted.' },
  { id: 'reset-bad', pool: 'extreme', expect: 'danger', intent: 'Reset the workspace', scope: ['node_modules'], cmd: 'npm run reset', scripts: { reset: 'git clean -fdx && npm install' },
    lesson: 'The reset script runs git clean -fdx: .env, local data, everything ignored.' },
  { id: 'logs-script-bad', pool: 'extreme', expect: 'danger', intent: 'Clear the logs', scope: ['logs'], cmd: 'npm run logs:clear', scripts: { 'logs:clear': 'truncate -s 0 logs/*.log data/*.csv' },
    lesson: 'The script also truncates data/*.csv: the customer data.' },
  { id: 'env-script-typo', pool: 'extreme', expect: 'danger', intent: 'Clean the build output', scope: ['dist'], cmd: 'npm run clean:dist',
    scripts: { clean: 'rm -rf "$OUT"/*', 'clean:dist': 'OTU=dist npm run clean' },
    lesson: 'clean:dist sets OTU, not OUT. clean gets an unset OUT and deletes /*.' },
  { id: 'find-except', pool: 'extreme', expect: 'danger', intent: 'Clear the build output', scope: ['dist'], cmd: 'find . -maxdepth 1 -mindepth 1 -not -name src -exec rm -rf {} +',
    lesson: 'It deletes everything in the project except src/. Not just dist.' },
];

/**
 * Scripted training: obvious allow, obvious deny, then a trap that lives in the context.
 * hint  — the right swipe: the ghost hand points there and that button pulses
 * focus — card parts to outline while the coach explains
 * why   — one line: the reason, in plain words
 */
export const TUTORIAL = [
  { ...QUESTS.find(q => q.id === 'test'), agent: 'byte', quip: 'first day! 👋', hint: 'allow', focus: ['cmd'],
    why: 'It only runs the tests. Nothing gets deleted.' },
  { ...QUESTS.find(q => q.id === 'photos'), agent: 'patch', hint: 'deny', focus: ['scope', 'cmd'],
    why: '<b>MAY TOUCH</b> says <code>.cache</code> only, but it deletes <code>~/Photos</code>.' },
  { ...QUESTS.find(q => q.id === 'empty-var'), agent: 'nova', hint: 'deny', focus: ['ctx', 'cmd'],
    why: '<code>BUILD_DIR</code> is empty, so <code>"$BUILD_DIR"/</code> becomes <code>/</code>: the whole disk.' },
];

// ── Noise: more context per card as the shift goes on ──────────────────────
// Noise never changes the verdict: extra env vars are never referenced and extra
// scripts are never run. It only makes the human read more.

const NOISE_ENV = {
  NODE_ENV: 'development', CI: 'false', LANG: 'en_US.UTF-8', PORT: '5173', LOG_LEVEL: 'debug',
  TZ: 'UTC', API_URL: 'https://api.acme.dev', DEBUG: 'vite:*', FORCE_COLOR: '1', EDITOR: 'vim',
  VITE_NEW_UI: 'true', DATABASE_URL: 'postgres://localhost/acme', AWS_REGION: 'eu-west-1',
  SENTRY_ENV: 'staging', NPM_CONFIG_FUND: 'false', PNPM_HOME: '/home/dev/.pnpm', GIT_PAGER: 'less',
};

const NOISE_SCRIPTS = {
  typecheck: 'tsc --noEmit', e2e: 'playwright test', 'db:seed': 'node scripts/seed.js',
  storybook: 'storybook dev -p 6006', format: 'prettier --write src', deploy: './scripts/deploy.sh',
  'test:watch': 'vitest', preview: 'vite preview', analyze: 'vite-bundle-visualizer',
  'db:migrate': 'prisma migrate dev', release: 'changeset publish', prepare: 'husky install',
};

const NOISE_ENV_COUNT = [0, 2, 3, 5, 7];
const NOISE_SCRIPT_COUNT = [0, 2, 4, 6, 8];

/**
 * Turn a template into a printable card: final env, package.json override, and
 * the context blocks the player must read. `noise` is 0-4.
 */
export function dress(quest, noise, rng) {
  const env = { ...(quest.env ?? {}) };
  const referenced = text => new RegExp(`\\$\\{?(${Object.keys(NOISE_ENV).join('|')})\\b`).exec(text)?.[1];
  const scriptsText = Object.values(quest.scripts ?? {}).join(' ');
  const noiseKeys = shuffle(Object.keys(NOISE_ENV), rng)
    .filter(key => !(key in env) && referenced(quest.cmd + scriptsText) !== key)
    .slice(0, NOISE_ENV_COUNT[noise] ?? 0);
  for (const key of noiseKeys) env[key] = NOISE_ENV[key];

  const context = [];
  const envKeys = shuffle(Object.keys(env), rng);
  if (envKeys.length) context.push({ kind: 'env', items: envKeys.map(key => ({ key, value: env[key] })) });

  let files = quest.files;
  const invoked = [...quest.cmd.matchAll(/\bnpm\s+(?:run\s+([\w:-]+)|(test))\b/g)].map(m => m[1] ?? m[2]);
  if (invoked.length || quest.scripts) {
    const extra = shuffle(Object.keys(NOISE_SCRIPTS), rng).slice(0, NOISE_SCRIPT_COUNT[noise] ?? 0);
    const scripts = { ...DEFAULT_SCRIPTS, ...Object.fromEntries(extra.map(k => [k, NOISE_SCRIPTS[k]])), ...(quest.scripts ?? {}) };
    files = { ...(files ?? {}), 'package.json': packageJson(scripts) };
    context.push({
      kind: 'file',
      title: 'package.json › scripts',
      lines: Object.entries(scripts).map(([key, value]) => ({ key, value, mark: invoked.includes(key) })),
    });
  }

  if (quest.show?.includes('ls')) {
    const cwd = quest.cwd ?? PROJECT;
    context.push({ kind: 'ls', title: `ls -A ${tildify(cwd)}`, names: listDir(cwd, files) });
  }

  const contextLines = context.reduce((n, block) =>
    n + (block.kind === 'env' ? Math.ceil(block.items.length / 2) : block.kind === 'file' ? block.lines.length : 2), 0);
  return { ...quest, env, files, context, contextLines, disk: peekDisk(quest, files) };
}

/**
 * Flavor for roomy cards: what the claimed scope looks like on disk (the cwd for read-only
 * work). Only paths the agent *claims* appear, so it can never hint at what really runs.
 * Not part of `context`: nothing here is needed to judge, and it adds no reading load.
 */
function peekDisk(quest, files) {
  const scope = quest.scope.map(resolveScope);
  const dir = !scope.length ? quest.cwd ?? PROJECT
    : scope.length === 1 && diskStats(scope, files)[0].dir ? scope[0] : null;
  if (!dir) {
    const short = path => (within(path, PROJECT) ? path.slice(PROJECT.length + 1) || '.' : tildify(path));
    return { title: 'on disk', rows: diskStats(scope, files).map((s, i) => ({ ...s, name: short(scope[i]) + (s.dir ? '/' : '') })) };
  }
  const names = listDir(dir, files);
  const shown = names.slice(0, 4);
  const [summary, ...rows] = diskStats([dir, ...shown.map(name => `${dir}/${name}`)], files);
  return {
    title: scope.length ? tildify(dir) : `${tildify(dir)}  (cwd)`,
    summary,
    rows: rows.map((s, i) => ({ ...s, name: shown[i] })),
    more: names.length - shown.length,
  };
}

// ── Composite requests: one long chain, one bad step ───────────────────────

const COMBO_INTENTS = [
  'Rebuild everything from scratch', 'Prep the release build', 'Reset the workspace for the demo',
  'Fix the flaky CI run', 'Clean up after the refactor', 'Get the build green again',
  'Make a fresh production bundle', 'Tidy up before the PR',
];

const SAFE_STEPS = [
  { cmd: 'rm -rf dist', scope: ['dist'] },
  { cmd: 'rm -rf node_modules', scope: ['node_modules'] },
  { cmd: 'npm install', scope: ['node_modules'] },
  { cmd: 'npm run build', scope: ['dist'] },
  { cmd: 'npm test', scope: [] },
  { cmd: 'rm -rf .cache', scope: ['.cache'] },
  { cmd: 'rm -rf coverage', scope: ['coverage'] },
  { cmd: 'mkdir -p dist/assets', scope: ['dist'] },
  { cmd: 'rm -f logs/*.log', scope: ['logs'] },
  { cmd: 'rm -rf "$OUT_DIR"', scope: ['dist'], env: { OUT_DIR: 'dist' } },
  { cmd: 'rm -rf "$TMPDIR/build-cache"', scope: ['/tmp/build-cache'] },
  { cmd: 'cp .env.example .env.local', scope: ['.env.local'] },
  { cmd: 'git status --short', scope: [] },
  { cmd: "sed -i 's/beta/stable/' src/index.ts", scope: ['src/index.ts'] },
  { cmd: 'npm run lint', scope: [] },
];

const BAD_STEPS = [
  { cmd: 'rm -rf src', lesson: 'rm -rf src hid in the middle of the chain. That\'s all your source code.' },
  { cmd: 'rm -rf ./dist /', lesson: 'A stray space in one step made / its own argument.' },
  { cmd: 'rm -rf "$OUT_DIR"/', env: { OUT_DIR: '' }, lesson: 'OUT_DIR is empty, so one step ran rm -rf /.' },
  { cmd: 'rm -rf ~/app/dist/../..', lesson: 'dist/../.. climbs out of the project into your home folder.' },
  { cmd: 'git clean -fdx', lesson: 'git clean -fdx deletes every untracked and ignored file, .env included.' },
  { cmd: 'cp .env.example .env', lesson: 'One step overwrote your real .env with the blank template.' },
  { cmd: 'rm -rf "$HOME/$CACHE_DIR"', env: { CACHE_DIR: null }, lesson: 'CACHE_DIR is unset: rm -rf "$HOME/" — your whole home.' },
  { cmd: 'find ~ -name "*.log" -delete', lesson: 'find ~ walks your entire home folder, not just logs/.' },
  { cmd: 'chmod -R 777 ~', lesson: 'chmod -R 777 ~ opens your whole home to every user on the box.' },
  { cmd: 'sort data/users.csv > data/users.csv', lesson: '> empties users.csv before sort reads it.' },
  { cmd: 'rm -rf data', lesson: 'rm -rf data deleted the customer data along with the junk.' },
];

/** A 3-6 step chain. Dangerous chains hide exactly one bad step. */
export function composeQuest(rng, wantDanger, noise) {
  const length = 3 + Math.min(3, Math.floor(noise * 0.8 + rng.next() * 1.5));
  const bad = wantDanger ? rng.pick(BAD_STEPS) : null;
  const steps = [];
  for (const step of shuffle(SAFE_STEPS, rng)) {
    if (steps.length >= length - (bad ? 1 : 0)) break;
    // Never let two steps disagree about the same env var.
    const clash = Object.keys(step.env ?? {}).some(k => k in (bad?.env ?? {}) || steps.some(s => s.env && k in s.env));
    if (!clash) steps.push(step);
  }
  if (bad) steps.splice(1 + Math.floor(rng.next() * steps.length), 0, bad);

  const multiline = noise >= 2 && rng.chance(0.5);
  const scope = [...new Set(steps.flatMap(s => s.scope ?? []))];
  return {
    id: `combo-${steps.map(s => s.cmd.length).join('-')}`,
    pool: 'extreme',
    composite: true,
    expect: wantDanger ? 'danger' : 'safe',
    intent: rng.pick(COMBO_INTENTS),
    scope,
    cmd: steps.map(s => s.cmd).join(multiline ? '\n' : ' && '),
    env: Object.assign({}, ...steps.map(s => s.env ?? {})),
    lesson: bad?.lesson,
  };
}

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
