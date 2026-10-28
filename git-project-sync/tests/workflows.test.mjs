import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/project-sync.mjs');
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function git(args, cwd) {
  const result = run('git', args, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function identity(cwd) {
  git(['config', 'user.name', 'Sync Workflow Test'], cwd);
  git(['config', 'user.email', 'sync-workflow@example.invalid'], cwd);
}
function fixture(t, bound = true) {
  const root = mkdtempSync(join(tmpdir(), 'gps-workflows-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'canonical.git');
  const other = join(root, 'other.git');
  const a = join(root, 'agent-a');
  mkdirSync(a);
  git(['init', '--bare', '-q', remote], root);
  git(['init', '--bare', '-q', other], root);
  git(['init', '-q', '-b', 'main'], a);
  identity(a);
  writeFileSync(join(a, 'source.txt'), 'baseline\n');
  git(['add', 'source.txt'], a);
  git(['commit', '-q', '-m', 'baseline'], a);
  git(['remote', 'add', 'origin', remote], a);
  git(['push', '-q', '-u', 'origin', 'main'], a);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
  const f = { root, remote, other, a };
  if (bound) {
    git(['switch', '-q', '-c', 'codex/setup'], a);
    const r = cli(f, 'bind');
    assert.equal(r.code, 0, r.stderr);
    fillStructure(f);
    git(['add', '.agent-sync.json', '.agent-sync', '.agents', 'AGENTS.md'], a);
    git(['commit', '-q', '-m', 'bind protocol'], a);
    git(['switch', '-q', 'main'], a);
    git(['merge', '-q', '--ff-only', 'codex/setup'], a);
    git(['push', '-q', 'origin', 'main'], a);
  }
  f.base = git(['rev-parse', 'HEAD'], a);
  return f;
}
function cli(f, command, args = [], cwd = f.a) {
  const r = run('node', [script, command, '--repo', cwd, '--remote', f.remote, ...args, '--json'], cwd);
  return { code: r.status, stderr: r.stderr, data: r.stdout ? JSON.parse(r.stdout) : null };
}
function fillStructure(f) {
  writeFileSync(join(f.a, '.agent-sync/project-map.md'), '# Project Map\n\nSource: source.txt. Tests: fixture workflows.\n');
  writeFileSync(join(f.a, '.agent-sync/plan.md'), '# Development Plan\n\nOutcome: durable handoff. Deployment coordination: not applicable.\n');
}
function fillTask(f, record, cwd = f.a) {
  const path = join(cwd, record);
  let content = readFileSync(path, 'utf8');
  for (const [from, to] of [
    ['<!-- git-project-sync-task:scaffold=true -->\n', ''],
    ['Describe the user-visible outcome and scope.', 'Continue the source update across independent agents.'],
    ['State observable completion conditions.', 'Agent B reads the exact source saved by Agent A.'],
    ['Record committed results, not intentions.', 'Saved the requested source changes.'],
    ['Record commands and outcomes tied to the current branch.', 'Previous validation evidence is retained.'],
    ['Record unresolved ownership, environment, authorization, or validation gaps.', 'No known blockers; remote race checks remain active.'],
    ['Give the next agent one concrete starting action.', 'Read source.txt and continue the acceptance check.'],
  ]) content = content.replace(from, to);
  writeFileSync(path, content);
}
function task(f, name = 'codex/task') {
  git(['switch', '-q', '-c', name, f.base], f.a);
  const r = cli(f, 'task-init', ['--base', f.base, '--title', name]);
  assert.equal(r.code, 0, r.stderr + JSON.stringify(r.data));
  fillTask(f, r.data.taskStateFile);
  return r.data.taskStateFile;
}
function save(f, paths = ['source.txt'], cwd = f.a, extra = []) {
  return cli(f, 'save', [...paths.flatMap((path) => ['--path', path]), '--message', 'save test task',
    '--verification', 'node fixture assertion passed; source content checked', ...extra], cwd);
}
function passed(result) { assert.equal(result.code, 0, result.stderr + JSON.stringify(result.data)); }
function issue(result, code) {
  assert.equal(result.code, 1, result.stderr + JSON.stringify(result.data));
  assert.ok(result.data.issues.some((entry) => entry.code === code), JSON.stringify(result.data));
}
function savedTask(f, name = 'codex/task') {
  const record = task(f, name);
  writeFileSync(join(f.a, 'source.txt'), `${name} result\n`);
  const result = save(f);
  passed(result);
  assert.equal(result.data.synchronized, true);
  return record;
}

test('save, discover, isolated resume and return save work across two independent clones', (t) => {
  const f = fixture(t);
  const record = savedTask(f);
  const expected = git(['rev-parse', 'HEAD'], f.a);
  assert.match(readFileSync(join(f.a, record), 'utf8'), /Previous validation evidence is retained/);
  const b = join(f.root, 'agent-b');
  git(['clone', '-q', f.remote, b], f.root);
  identity(b);
  const listed = cli(f, 'list', [], b);
  passed(listed);
  assert.equal(listed.data.suggestedTask, 'codex/task');
  const selected = listed.data.tasks[0];
  assert.ok(selected.id);
  const resumedPath = join(f.root, 'agent-b-task');
  const resumed = cli(f, 'resume', ['--task', selected.id, '--worktree', resumedPath], b);
  passed(resumed);
  assert.equal(git(['rev-parse', 'HEAD'], resumedPath), expected);
  assert.equal(git(['branch', '--show-current'], b), 'main');
  assert.equal(readFileSync(join(resumedPath, 'source.txt'), 'utf8'), 'codex/task result\n');
  writeFileSync(join(resumedPath, 'source.txt'), 'agent B result\n');
  passed(save(f, ['source.txt'], resumedPath));
  issue(save(f), 'remote_task_ahead');
  assert.equal(git(['rev-parse', 'HEAD'], f.a), expected);
});

test('adopt preserves existing commits, dirty files and custom instructions, then saves explicit setup files', (t) => {
  const f = fixture(t, false);
  git(['switch', '-q', '-c', 'codex/existing'], f.a);
  writeFileSync(join(f.a, 'source.txt'), 'existing committed work\n');
  git(['commit', '-q', '-am', 'existing work'], f.a);
  const head = git(['rev-parse', 'HEAD'], f.a);
  writeFileSync(join(f.a, 'source.txt'), 'existing dirty work\n');
  writeFileSync(join(f.a, 'AGENTS.md'), 'Keep these project rules.\n');
  writeFileSync(join(f.a, 'unrelated.txt'), 'leave local\n');
  const adopted = cli(f, 'adopt', ['--title', 'Existing work']);
  passed(adopted);
  assert.equal(git(['rev-parse', 'HEAD'], f.a), head);
  assert.equal(adopted.data.base, f.base);
  assert.equal(readFileSync(join(f.a, 'source.txt'), 'utf8'), 'existing dirty work\n');
  assert.match(readFileSync(join(f.a, 'AGENTS.md'), 'utf8'), /^Keep these project rules\./);
  fillStructure(f);
  fillTask(f, adopted.data.taskStateFile);
  passed(save(f, ['source.txt', ...adopted.data.changedFiles]));
  assert.equal(git(['ls-tree', 'HEAD', 'unrelated.txt'], f.a), '');
  assert.equal(readFileSync(join(f.a, 'unrelated.txt'), 'utf8'), 'leave local\n');
});

test('all push destinations are checked and an unexpected destination receives no task', (t) => {
  const f = fixture(t);
  const record = task(f);
  const before = git(['rev-parse', 'HEAD'], f.a);
  const text = readFileSync(join(f.a, record), 'utf8');
  git(['remote', 'set-url', '--add', '--push', 'origin', f.remote], f.a);
  git(['remote', 'set-url', '--add', '--push', 'origin', f.other], f.a);
  issue(cli(f, 'observe'), 'push_remote_mismatch');
  issue(save(f), 'push_remote_mismatch');
  assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  assert.equal(readFileSync(join(f.a, record), 'utf8'), text);
  assert.equal(git(['for-each-ref', '--format=%(refname)', 'refs/heads'], f.other), '');
});

test('all fetch URLs and distinct local .git paths retain their identity', (t) => {
  const f = fixture(t);
  git(['remote', 'set-url', '--add', 'origin', f.other], f.a);
  issue(cli(f, 'observe'), 'remote_mismatch');
  const wrong = cli(f, 'observe', ['--remote', f.remote.slice(0, -4)]);
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /conflicts/);
});

test('standard ssh user is allowed while passwords and HTTP credentials are rejected without network access', (t) => {
  const f = fixture(t);
  const allowed = cli(f, 'observe', ['--remote', 'ssh://git@github.com/acme/project.git']);
  assert.equal(allowed.code, 2);
  assert.match(allowed.stderr, /conflicts/);
  for (const remote of ['ssh://git:password@github.com/acme/project.git', 'https://user@github.com/acme/project.git']) {
    const denied = cli(f, 'observe', ['--remote', remote]);
    assert.equal(denied.code, 2);
    assert.match(denied.stderr, /embedded credentials/);
    assert.ok(!denied.stderr.includes('password@'));
  }
});

test('a record retaining only placeholders is rejected before commit or staging', (t) => {
  const f = fixture(t);
  git(['switch', '-q', '-c', 'codex/blank'], f.a);
  const init = cli(f, 'task-init');
  passed(init);
  const path = join(f.a, init.data.taskStateFile);
  writeFileSync(path, readFileSync(path, 'utf8').replace('<!-- git-project-sync-task:scaffold=true -->\n', ''));
  const before = git(['rev-parse', 'HEAD'], f.a);
  issue(save(f), 'task_state_incomplete');
  assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  assert.equal(git(['diff', '--cached', '--name-only'], f.a), '');
});

test('changed source invalidates handoff and discovery until a new save updates the record', (t) => {
  const f = fixture(t);
  savedTask(f);
  writeFileSync(join(f.a, 'source.txt'), 'unrecorded source change\n');
  git(['commit', '-q', '-am', 'source changed after evidence'], f.a);
  git(['push', '-q', 'origin', 'codex/task'], f.a);
  issue(cli(f, 'handoff'), 'task_state_stale');
  const staleList = cli(f, 'list');
  passed(staleList);
  assert.equal(staleList.data.tasks[0].valid, false);
  assert.equal(staleList.data.suggestedTask, null);
  passed(save(f));
  passed(cli(f, 'handoff'));
});

test('a task-only commit cannot be claimed as a canonical baseline', (t) => {
  const f = fixture(t);
  const record = savedTask(f);
  const wrongBase = git(['rev-parse', 'HEAD'], f.a);
  const path = join(f.a, record);
  writeFileSync(path, readFileSync(path, 'utf8').replace(`base=${f.base}`, `base=${wrongBase}`));
  git(['commit', '-q', '-am', 'claim invalid base'], f.a);
  git(['push', '-q', 'origin', 'codex/task'], f.a);
  issue(cli(f, 'handoff', ['--base', wrongBase]), 'base_not_canonical');
});

test('unrelated staged changes are preserved and block save', (t) => {
  const f = fixture(t);
  const record = task(f);
  writeFileSync(join(f.a, 'other.txt'), 'another task\n');
  git(['add', 'other.txt'], f.a);
  const before = git(['rev-parse', 'HEAD'], f.a);
  const text = readFileSync(join(f.a, record), 'utf8');
  issue(save(f), 'unrelated_staged_changes');
  assert.equal(git(['diff', '--cached', '--name-only'], f.a), 'other.txt');
  assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  assert.equal(readFileSync(join(f.a, record), 'utf8'), text);
});

test('multiple tasks require selection and do not create or switch worktrees', (t) => {
  const f = fixture(t);
  savedTask(f, 'codex/one');
  savedTask(f, 'codex/two');
  const b = join(f.root, 'reader');
  git(['clone', '-q', f.remote, b], f.root);
  const path = join(f.root, 'must-not-exist');
  issue(cli(f, 'resume', ['--worktree', path], b), 'task_selection_required');
  assert.equal(existsSync(path), false);
  assert.equal(git(['branch', '--show-current'], b), 'main');
  const list = cli(f, 'list', [], b);
  assert.equal(list.data.tasks.length, 2);
  assert.equal(list.data.suggestedTask, null);
});

test('version 1 records migrate by save and retain stable task identity afterwards', (t) => {
  const f = fixture(t);
  const record = task(f);
  const path = join(f.a, record);
  writeFileSync(path, readFileSync(path, 'utf8').replace('version=2', 'version=1').replace(/^<!-- git-project-sync-task:id=.* -->\n/m, ''));
  git(['add', record], f.a);
  git(['commit', '-q', '-m', 'legacy record'], f.a);
  git(['push', '-q', '-u', 'origin', 'codex/task'], f.a);
  issue(cli(f, 'handoff'), 'task_state_freshness_missing');
  passed(save(f));
  const id = readFileSync(path, 'utf8').match(/git-project-sync-task:id=([^ ]+)/)[1];
  passed(save(f));
  assert.equal(readFileSync(path, 'utf8').match(/git-project-sync-task:id=([^ ]+)/)[1], id);
  passed(cli(f, 'handoff'));
});

test('a rejected push retains the local commit and reports no successful synchronization', (t) => {
  const f = fixture(t);
  task(f);
  mkdirSync(join(f.remote, 'hooks'), { recursive: true });
  writeFileSync(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const before = git(['rev-parse', 'HEAD'], f.a);
  const result = save(f);
  issue(result, 'push_failed');
  assert.equal(result.data.synchronized, false);
  assert.notEqual(git(['rev-parse', 'HEAD'], f.a), before);
  assert.equal(git(['status', '--porcelain'], f.a), '');
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/codex/task'], f.a), '');
});

test('save handles literal spaced paths and tracked deletions without adding an unrelated file', (t) => {
  const f = fixture(t);
  task(f);
  rmSync(join(f.a, 'source.txt'));
  writeFileSync(join(f.a, 'file with spaces.txt'), 'new source\n');
  writeFileSync(join(f.a, 'unrelated.txt'), 'local only\n');
  const result = save(f, ['source.txt', 'file with spaces.txt']);
  passed(result);
  assert.equal(git(['ls-tree', 'HEAD', 'source.txt', 'unrelated.txt'], f.a), '');
  assert.equal(git(['show', 'HEAD:file with spaces.txt'], f.a), 'new source');
  assert.ok(result.data.warnings.some((entry) => entry.code === 'unsaved_worktree_changes'));
});

test('resume can select a unique task while preserving dirty source checkout and rejects nested targets', (t) => {
  const f = fixture(t);
  savedTask(f);
  const b = join(f.root, 'reader');
  git(['clone', '-q', f.remote, b], f.root);
  writeFileSync(join(b, 'source.txt'), 'reader local edits\n');
  const nested = cli(f, 'resume', ['--worktree', join(b, 'nested-task')], b);
  assert.equal(nested.code, 2);
  assert.equal(existsSync(join(b, 'nested-task')), false);
  const resumed = cli(f, 'resume', ['--worktree', join(f.root, 'unique-task')], b);
  passed(resumed);
  assert.equal(readFileSync(join(b, 'source.txt'), 'utf8'), 'reader local edits\n');
  assert.equal(git(['branch', '--show-current'], b), 'main');
});

test('an unrecorded alternative prevents silently selecting the other task', (t) => {
  const f = fixture(t);
  savedTask(f);
  git(['switch', '-q', '-c', 'codex/unrecorded', f.base], f.a);
  writeFileSync(join(f.a, 'source.txt'), 'unfinished other task\n');
  git(['commit', '-q', '-am', 'unrecorded work'], f.a);
  git(['push', '-q', 'origin', 'codex/unrecorded'], f.a);
  const list = cli(f, 'list');
  passed(list);
  assert.equal(list.data.tasks.length, 2);
  assert.equal(list.data.suggestedTask, null);
  const b = join(f.root, 'reader');
  git(['clone', '-q', f.remote, b], f.root);
  issue(cli(f, 'resume', ['--worktree', join(f.root, 'no-auto-select')], b), 'task_selection_required');
});

test('fresh canonical history is fetched before verifying an older legitimate task base', (t) => {
  const f = fixture(t);
  savedTask(f);
  const b = join(f.root, 'maintainer');
  git(['clone', '-q', f.remote, b], f.root);
  identity(b);
  writeFileSync(join(b, 'new-main.txt'), 'concurrent main development\n');
  git(['add', 'new-main.txt'], b);
  git(['commit', '-q', '-m', 'main advanced'], b);
  git(['push', '-q', 'origin', 'main'], b);
  passed(cli(f, 'handoff'));
  assert.equal(git(['branch', '--show-current'], f.a), 'codex/task');
});

test('missing verification and directory selections do not commit or push', (t) => {
  const f = fixture(t);
  task(f);
  const before = git(['rev-parse', 'HEAD'], f.a);
  const missing = cli(f, 'save', ['--path', 'source.txt', '--message', 'no evidence']);
  assert.equal(missing.code, 2);
  const directory = save(f, ['.agent-sync']);
  assert.equal(directory.code, 2);
  assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  assert.equal(git(['diff', '--cached', '--name-only'], f.a), '');
});

test('a commit hook changing the push destination cannot cause a push to that destination', (t) => {
  const f = fixture(t);
  task(f);
  const hooks = join(f.a, '.git/hooks');
  mkdirSync(hooks, { recursive: true });
  const quoted = `'${f.other.replace(/'/g, `'\\''`)}'`;
  writeFileSync(join(hooks, 'post-commit'), `#!/bin/sh\ngit remote set-url --push origin ${quoted}\n`, { mode: 0o755 });
  const result = save(f);
  issue(result, 'push_remote_mismatch');
  assert.equal(result.data.synchronized, false);
  assert.equal(git(['for-each-ref', '--format=%(refname)', 'refs/heads'], f.other), '');
});

for (const kind of ['file', 'dangling-file', 'parent']) {
  test(`adopt rejects ${kind} symlinks before any project or external file is changed`, (t) => {
    const f = fixture(t, false);
    git(['switch', '-q', '-c', 'codex/existing'], f.a);
    const external = join(f.root, 'shared');
    mkdirSync(external);
    const note = join(external, 'rules.md');
    writeFileSync(note, 'shared rules must remain intact\n');
    if (kind === 'parent') symlinkSync(external, join(f.a, '.agent-sync'));
    else symlinkSync(kind === 'file' ? note : join(external, 'missing.md'), join(f.a, 'AGENTS.md'));
    const before = git(['rev-parse', 'HEAD'], f.a);
    const result = cli(f, 'adopt');
    assert.equal(result.code, 2, JSON.stringify(result.data));
    assert.match(result.stderr, /symlinks/);
    assert.equal(readFileSync(note, 'utf8'), 'shared rules must remain intact\n');
    assert.equal(existsSync(join(external, 'missing.md')), false);
    assert.equal(existsSync(join(external, 'project-map.md')), false);
    assert.equal(existsSync(join(f.a, '.agent-sync.json')), false);
    assert.equal(existsSync(join(f.a, '.agents')), false);
    assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  });
}

for (const phase of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) {
  test(`${phase} cannot add an unselected user file to a commit or a later retry`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.a, 'user-work.txt'), 'existing user baseline\n');
    git(['add', 'user-work.txt'], f.a);
    git(['commit', '-q', '-m', 'user baseline'], f.a);
    git(['push', '-q', 'origin', 'main'], f.a);
    f.base = git(['rev-parse', 'HEAD'], f.a);
    task(f);
    writeFileSync(join(f.a, 'source.txt'), 'selected task work\n');
    writeFileSync(join(f.a, 'user-work.txt'), 'unselected existing user work\n');
    const hook = join(f.a, '.git/hooks', phase);
    writeFileSync(hook, '#!/bin/sh\ngit add -- user-work.txt\n', { mode: 0o755 });
    const before = git(['rev-parse', 'HEAD'], f.a);
    const result = save(f);
    issue(result, 'commit_hook_changed_index');
    assert.equal(result.data.synchronized, false);
    assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
    assert.equal(readFileSync(join(f.a, 'user-work.txt'), 'utf8'), 'unselected existing user work\n');
    assert.equal(git(['ls-remote', 'origin', 'refs/heads/codex/task'], f.a), '');
    rmSync(hook);
    issue(save(f), 'unrelated_staged_changes');
    // The user explicitly resolves only the index; their file contents remain local.
    git(['restore', '--staged', '--', 'user-work.txt'], f.a);
    passed(save(f));
    assert.equal(git(['show', 'codex/task:user-work.txt'], f.remote), 'existing user baseline');
    assert.equal(readFileSync(join(f.a, 'user-work.txt'), 'utf8'), 'unselected existing user work\n');
  });
}

test('custom hook paths containing spaces and quotes preserve existing checks and commit message hooks', (t) => {
  const f = fixture(t);
  task(f);
  const hooks = join(f.root, "project hooks' directory");
  mkdirSync(hooks);
  git(['config', 'core.hooksPath', hooks], f.a);
  writeFileSync(join(hooks, 'commit-msg'), '#!/bin/sh\nprintf "\\nchecked by existing hook\\n" >> "$1"\n', { mode: 0o755 });
  passed(save(f));
  assert.match(git(['log', '-1', '--format=%B'], f.a), /checked by existing hook/);
  const checkedHook = join(hooks, 'pre-commit');
  writeFileSync(checkedHook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(f.a, 'source.txt'), 'another selected change\n');
  const before = git(['rev-parse', 'HEAD'], f.a);
  issue(save(f), 'commit_failed');
  assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  rmSync(checkedHook);
  passed(save(f));
});

test('reference-transaction hooks retain their stdin and can reject the actual commit', (t) => {
  const f = fixture(t);
  task(f);
  const hook = join(f.a, '.git/hooks/reference-transaction');
  writeFileSync(hook, '#!/bin/sh\ncat >> "$PWD/reference-input.log"\nif test "$1" = prepared; then exit 1; fi\n', { mode: 0o755 });
  const before = git(['rev-parse', 'HEAD'], f.a);
  const rejected = save(f);
  issue(rejected, 'commit_failed');
  assert.equal(git(['rev-parse', 'HEAD'], f.a), before);
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/codex/task'], f.a), '');
  assert.match(readFileSync(join(f.a, 'reference-input.log'), 'utf8'), /refs\/heads\/codex\/task/);
  rmSync(hook);
  passed(save(f));
});
