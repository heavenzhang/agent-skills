import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const skillRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = join(skillRoot, 'scripts', 'project-sync.mjs');

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

function exerciseGitWorkflow(deploymentLayout) {
  const fixture = mkdtempSync(join(tmpdir(), 'git-project-sync-test-'));
  try {
    const remote = join(fixture, 'canonical.git');
    const otherRemote = join(fixture, 'other.git');
    const work = join(fixture, 'work');
    mkdirSync(work);
    git(['init', '--bare', '--quiet', remote], fixture);
    git(['init', '--bare', '--quiet', otherRemote], fixture);
    git(['init', '--quiet'], work);
    git(['config', 'user.name', 'Sync Test'], work);
    git(['config', 'user.email', 'sync-test@example.invalid'], work);
    git(['commit', '--allow-empty', '--quiet', '-m', 'baseline'], work);
    git(['branch', '-M', 'main'], work);
    git(['remote', 'add', 'origin', remote], work);
    git(['push', '--quiet', '-u', 'origin', 'main'], work);
    git(['switch', '--quiet', '-c', 'codex/setup'], work);

    const bind = run('node', [script, 'bind', '--repo', work, '--remote', remote], work);
    assert.equal(bind.status, 0, bind.stdout + bind.stderr);
    const configPath = join(work, '.agent-sync.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.remote, remote);
    assert.equal(config.structureVersion, 1);
    const projectMapPath = join(work, '.agent-sync', 'project-map.md');
    const projectPlanPath = join(work, '.agent-sync', 'plan.md');
    assert.equal(existsSync(projectMapPath), true);
    assert.equal(existsSync(projectPlanPath), true);

    for (const command of ['bind', 'observe', 'start', 'task-init', 'handoff', 'resume']) {
      const omitted = run('node', [script, command, '--repo', work], work);
      assert.equal(omitted.status, 2, `${command} accepted a missing --remote`);
      assert.match(omitted.stderr, /Git destination is required/);
    }

    const observed = run('node', [script, 'observe', '--repo', work, '--remote', remote, '--json'], work);
    assert.equal(observed.status, 1, observed.stdout + observed.stderr);
    const report = JSON.parse(observed.stdout);
    assert.equal(report.expectedRemote, report.normalizedCheckoutRemote);
    assert.equal(report.expectedRemote, report.normalizedPushRemote);
    assert.ok(report.issues.some((issue) => issue.code === 'structure_missing'));

    const mismatch = run('node', [script, 'observe', '--repo', work, '--remote', otherRemote], work);
    assert.equal(mismatch.status, 2);
    assert.match(mismatch.stderr, /conflicts with the committed .agent-sync.json/);
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).remote, remote);
    assert.equal(existsSync(join(work, '.agent-sync', 'tasks')), false);

    git(['remote', 'set-url', '--push', 'origin', otherRemote], work);
    const wrongPush = run('node', [script, 'observe', '--repo', work, '--remote', remote, '--json'], work);
    assert.equal(wrongPush.status, 1);
    assert.ok(JSON.parse(wrongPush.stdout).issues.some((issue) => issue.code === 'push_remote_mismatch'));
    git(['remote', 'set-url', '--push', 'origin', remote], work);

    git(['add', '.agent-sync.json', '.agent-sync/project-map.md', '.agent-sync/plan.md',
      '.agents/skills/git-project-sync', 'AGENTS.md'], work);
    git(['commit', '--quiet', '-m', 'bind project'], work);
    git(['push', '--quiet', '-u', 'origin', 'codex/setup'], work);
    git(['switch', '--quiet', 'main'], work);
    git(['merge', '--quiet', '--ff-only', 'codex/setup'], work);
    git(['push', '--quiet', 'origin', 'main'], work);
    const scaffoldGate = run('node', [script, 'observe', '--repo', work, '--remote', remote, '--json'], work);
    assert.equal(scaffoldGate.status, 1);
    assert.ok(JSON.parse(scaffoldGate.stdout).issues.some((issue) => issue.code === 'structure_incomplete'));
    git(['switch', '--quiet', '-c', 'codex/incomplete'], work);
    const incompleteBase = git(['rev-parse', 'HEAD'], work);
    const incompleteStart = run('node', [script, 'start', '--repo', work, '--remote', remote,
      '--base', incompleteBase, '--json'], work);
    assert.equal(incompleteStart.status, 1);
    assert.ok(JSON.parse(incompleteStart.stdout).issues.some((issue) => issue.code === 'structure_incomplete'));
    git(['switch', '--quiet', 'main'], work);
    writeFileSync(projectMapPath, readFileSync(projectMapPath, 'utf8')
      .replace('<!-- git-project-sync:structure:scaffold=true -->\n', '')
      .replace('describe the project in one or two sentences', 'support reproducible agent handoffs')
      .replace('add the actual path or explain why there is none', 'see src/ for the entry point')
      .replace('Replace with actual path', 'src/')
      .replace('Replace with actual path', 'tests/')
      .replace('Replace with actual path', 'docs/')
      .replace('Replace with actual path', 'ops/'));
    writeFileSync(projectPlanPath, readFileSync(projectPlanPath, 'utf8')
      .replace('<!-- git-project-sync:structure:scaffold=true -->\n', '')
      .replace('Describe the intended project outcome and current scope.', 'Keep development work reproducible across agents.')
      .replace('Add a real milestone', 'Bind and hand off a task')
      .replace('Add a verifiable result', 'The handoff gate passes.'));
    const deploymentPlan = deploymentLayout === 'legacy-single-owner'
      ? [
        '## Deployment coordination',
        '',
        '- Deployment chat: chat-legacy-owner; designated by the user for the existing service.',
        '- Targets and runbook: service/test; ops/service.md.',
        '- Current release: idle.',
      ].join('\n')
      : [
        '## Deployment coordination',
        '',
        '### Unit: website',
        '',
        '- Code and targets: server/; website/test.',
        '- CI/deployment chat: chat-website-owner.',
        '- Designation: user assigned the website unit.',
        '- Version rules: service versions; website owner allocates.',
        '- Current release: idle.',
        '',
        '### Unit: client',
        '',
        '- Code and targets: client/; desktop/test.',
        '- CI/deployment chat: chat-client-owner.',
        '- Designation: user assigned the independently releasable client.',
        '- Version rules: client versions; client owner allocates.',
        '- Current release: idle.',
        '',
        '### Shared coordination',
        '',
        '- Website and client may release independently under the compatible API contract.',
        '- Shared integration CI: website owner; shared migration jobs serialize.',
      ].join('\n');
    writeFileSync(projectPlanPath, readFileSync(projectPlanPath, 'utf8')
      .replace(/## Deployment coordination\n[\s\S]*?(?=## Decisions and open questions\n)/,
        `${deploymentPlan}\n\n`));
    git(['add', '.agent-sync/project-map.md', '.agent-sync/plan.md'], work);
    git(['commit', '--quiet', '-m', 'complete project structure'], work);
    git(['push', '--quiet', 'origin', 'main'], work);
    const completedMap = readFileSync(projectMapPath, 'utf8');
    const completedPlan = readFileSync(projectPlanPath, 'utf8');
    const rebound = run('node', [script, 'bind', '--repo', work, '--remote', remote,
      '--update', '--refresh-skill'], work);
    assert.equal(rebound.status, 0, rebound.stdout + rebound.stderr);
    assert.equal(readFileSync(projectMapPath, 'utf8'), completedMap);
    assert.equal(readFileSync(projectPlanPath, 'utf8'), completedPlan);
    git(['switch', '--quiet', '-c', 'codex/continue-task'], work);
    const base = git(['rev-parse', 'HEAD'], work);
    const vendored = join(work, '.agents', 'skills', 'git-project-sync', 'scripts', 'project-sync.mjs');
    for (const command of ['start', 'task-init']) {
      const result = run('node', [vendored, command, '--repo', work, '--remote', remote,
        '--base', base], work);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const taskDir = join(work, '.agent-sync', 'tasks');
    const taskFile = join(taskDir, git(['ls-files', '--others', '--exclude-standard', '.agent-sync/tasks'], work)
      .split('/').at(-1));
    let taskText = readFileSync(taskFile, 'utf8');
    taskText = taskText.replace('<!-- git-project-sync-task:scaffold=true -->\n', '')
      .replace('Describe the user-visible outcome and scope.', 'Continue this task from Git.')
      .replace('State observable completion conditions.', 'Both remote gates pass.')
      .replace('Record committed results, not intentions.', 'Bound the repository and saved this task record.')
      .replace('Record commands and outcomes tied to the current branch.', 'The start gate passed.')
      .replace('Record unresolved ownership, environment, authorization, or validation gaps.', 'No blocker.')
      .replace('Give the next agent one concrete starting action.', 'Fetch this branch and run resume.');
    writeFileSync(taskFile, taskText);
    git(['add', '.agent-sync/tasks'], work);
    git(['commit', '--quiet', '-m', 'save task continuity'], work);
    git(['push', '--quiet', '-u', 'origin', 'codex/continue-task'], work);
    for (const command of ['handoff', 'resume']) {
      const result = run('node', [vendored, command, '--repo', work, '--remote', remote,
        '--base', base], work);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }

    const configuredUrl = 'https://git.example.invalid:8443/team/project.git';
    git(['remote', 'set-url', 'origin', configuredUrl], work);
    config.remote = configuredUrl;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const wrongPort = run('node', [script, 'observe', '--repo', work,
      '--remote', 'https://git.example.invalid:9443/team/project.git'], work);
    assert.equal(wrongPort.status, 2);
    assert.match(wrongPort.stderr, /conflicts with the committed .agent-sync.json/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

for (const deploymentLayout of ['legacy-single-owner', 'independent-units']) {
  test(`Git gates and refresh preserve ${deploymentLayout} deployment plans`, () => {
    exerciseGitWorkflow(deploymentLayout);
  });
}
