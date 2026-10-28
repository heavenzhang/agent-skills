#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const CONFIG_NAME = '.agent-sync.json';
const SUPPORTED_VERSION = 1;
const STRUCTURE_VERSION = 1;
const DEFAULT_TASK_STATE_DIR = '.agent-sync/tasks';
const PROJECT_MAP_PATH = '.agent-sync/project-map.md';
const PROJECT_PLAN_PATH = '.agent-sync/plan.md';
const COMMANDS = new Set(['bind', 'observe', 'start', 'task-init', 'adopt', 'save', 'list', 'resume', 'handoff']);
const TASK_STATUSES = new Set(['in-progress', 'blocked', 'ready-for-review', 'complete']);
const MANAGED_START = '<!-- git-project-sync:start -->';
const MANAGED_END = '<!-- git-project-sync:end -->';

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage:\n' +
      '  project-sync.mjs bind --repo PATH --remote URL [--remote-name origin] ' +
      '[--canonical-branch main] [--branch-prefix codex/] [--update] [--refresh-skill] [--json]\n' +
      '  project-sync.mjs observe|start|resume|handoff --repo PATH --remote URL [--base SHA] ' +
      '[--remote-name NAME] [--canonical-branch NAME] ' +
      '[--branch-prefix PREFIX] [--json]\n' +
      '  project-sync.mjs task-init|adopt --repo PATH --remote URL [--base SHA] [--title TEXT] [--json]\n' +
      '  project-sync.mjs save --repo PATH --remote URL --path FILE [--path FILE ...] ' +
      '--message TEXT --verification TEXT [--base SHA] [--json]\n' +
      '  project-sync.mjs list --repo PATH --remote URL [--all] [--json]\n' +
      '  project-sync.mjs resume --repo PATH --remote URL [--task ID_OR_BRANCH] [--worktree PATH] [--json]',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!COMMANDS.has(command)) usage(`Unsupported or missing command: ${command ?? '(none)'}`);
  const options = {
    command,
    repo: process.cwd(),
    remote: null,
    remoteName: null,
    canonicalBranch: null,
    branchPrefix: null,
    base: null,
    title: null,
    update: false,
    refreshSkill: false,
    paths: [],
    message: null,
    verification: null,
    task: null,
    worktree: null,
    all: false,
    json: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--update') options.update = true;
    else if (arg === '--refresh-skill') options.refreshSkill = true;
    else if (arg === '--all') options.all = true;
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) usage(`Missing value for ${arg}`);
      if (arg === '--repo') options.repo = value;
      else if (arg === '--remote') options.remote = value;
      else if (arg === '--remote-name') options.remoteName = value;
      else if (arg === '--canonical-branch') options.canonicalBranch = value;
      else if (arg === '--branch-prefix') options.branchPrefix = value;
      else if (arg === '--base') options.base = value;
      else if (arg === '--title') options.title = value;
      else if (arg === '--path') options.paths.push(value);
      else if (arg === '--message') options.message = value;
      else if (arg === '--verification') options.verification = value;
      else if (arg === '--task') options.task = value;
      else if (arg === '--worktree') options.worktree = value;
      else usage(`Unknown argument: ${arg}`);
      index += 1;
    }
  }
  if ((command !== 'bind' && options.update) ||
      (!['bind', 'adopt'].includes(command) && options.refreshSkill)) {
    usage('--update is valid only with bind; --refresh-skill is valid with bind or adopt.');
  }
  if (command !== 'save' && (options.paths.length || options.message || options.verification)) usage('Save options require save.');
  if (command !== 'resume' && (options.task || options.worktree)) usage('--task and --worktree require resume.');
  if (command !== 'list' && options.all) usage('--all requires list.');
  if (!options.remote) usage('A Git destination is required: pass --remote URL for every command.');
  validateSafeRemote(options.remote);
  return options;
}

function git(repo, args, timeout = 20_000) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    raw: result.stdout ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

function hasEmbeddedCredential(value) {
  try {
    const parsed = new URL(value);
    return Boolean((parsed.protocol !== 'ssh:' && parsed.username) ||
      parsed.password || parsed.search || parsed.hash);
  } catch {
    return /^(?:https?|git):\/\/[^/]*:[^/@]+@/i.test(value) || /[?#]/.test(value);
  }
}

function stripGitSuffix(value) {
  return value.replace(/\.git\/?$/i, '').replace(/\/$/, '');
}

function normalizeRemote(value, repoRoot = process.cwd()) {
  const remote = value.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(remote)) {
    const parsed = new URL(remote);
    if (parsed.protocol === 'file:') return resolve(fileURLToPath(parsed));
    const path = stripGitSuffix(parsed.pathname.replace(/^\/+/, ''));
    return `${parsed.host.toLowerCase()}/${path}`;
  }
  const scp = remote.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
  if (scp && !/^[A-Za-z]:[\\/]/.test(remote)) {
    return `${scp[1].toLowerCase()}/${stripGitSuffix(scp[2])}`;
  }
  const absolute = isAbsolute(remote) ? remote : resolve(repoRoot, remote);
  return absolute;
}

function validateSafeRemote(value) {
  if (!value?.trim()) throw new Error('A Git remote URL is required.');
  if (hasEmbeddedCredential(value)) {
    throw new Error('Git URLs with embedded credentials, query strings, or fragments are not allowed.');
  }
}

function validBranchName(repo, branch) {
  return Boolean(branch) && git(repo, ['check-ref-format', '--branch', branch]).ok;
}

function resolveCommit(repo, revision) {
  if (!revision) return null;
  const result = git(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  return result.ok ? result.stdout : null;
}

function isAncestor(repo, ancestor, descendant) {
  return git(repo, ['merge-base', '--is-ancestor', ancestor, descendant]).ok;
}

function remoteBranchSha(repo, remoteName, branch) {
  const result = git(repo, ['ls-remote', remoteName, `refs/heads/${branch}`]);
  if (!result.ok) return { ok: false, sha: null, timedOut: result.timedOut };
  const line = result.stdout.split(/\r?\n/).find(Boolean);
  const sha = line?.split(/\s+/)[0] ?? null;
  return { ok: Boolean(sha), sha, timedOut: false };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateConfig(config) {
  if (!config || config.version !== SUPPORTED_VERSION) {
    throw new Error(`Unsupported ${CONFIG_NAME} version.`);
  }
  for (const field of ['remote', 'remoteName', 'canonicalBranch', 'branchPrefix']) {
    if (typeof config[field] !== 'string' || !config[field]) {
      throw new Error(`Invalid ${CONFIG_NAME}: ${field} is required.`);
    }
  }
  validateSafeRemote(config.remote);
  if (config.structureVersion !== undefined && config.structureVersion !== STRUCTURE_VERSION) {
    throw new Error(`Unsupported project structure version in ${CONFIG_NAME}.`);
  }
  const taskStateDir = config.taskStateDir ?? DEFAULT_TASK_STATE_DIR;
  return { ...config, taskStateDir };
}

function validatePolicy(root, settings) {
  if (!/^[A-Za-z0-9._-]+$/.test(settings.remoteName) || settings.remoteName.startsWith('-')) {
    throw new Error('remoteName must be a simple Git remote name.');
  }
  if (!validBranchName(root, settings.canonicalBranch)) {
    throw new Error('canonicalBranch is not a valid Git branch name.');
  }
  if (!settings.branchPrefix || /\s/.test(settings.branchPrefix) ||
      !validBranchName(root, `${settings.branchPrefix}sync-probe`)) {
    throw new Error('branchPrefix cannot form a valid Git task branch.');
  }
  const taskSegments = settings.taskStateDir.replace(/\\/g, '/').split('/');
  if (isAbsolute(settings.taskStateDir) || taskSegments.some((segment) => !segment || segment === '..')) {
    throw new Error('taskStateDir must be a safe repository-relative directory.');
  }
  return settings;
}

function gitRoot(repo) {
  const root = git(repo, ['rev-parse', '--show-toplevel']);
  if (!root.ok) throw new Error('The selected path is not inside a Git repository.');
  return root.stdout;
}

function settingsFor(root, options) {
  const configPath = join(root, CONFIG_NAME);
  const existing = existsSync(configPath) ? validateConfig(readJson(configPath)) : null;
  if (!options.remote) throw new Error('An explicitly supplied Git destination is required.');
  validateSafeRemote(options.remote);
  if (existing) {
    const overrides = {
      remote: options.remote,
      remoteName: options.remoteName,
      canonicalBranch: options.canonicalBranch,
      branchPrefix: options.branchPrefix,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) continue;
      const same = key === 'remote'
        ? normalizeRemote(value, root) === normalizeRemote(existing.remote, root)
        : value === existing[key];
      if (!same) throw new Error(`${key} conflicts with the committed ${CONFIG_NAME}.`);
    }
    return validatePolicy(root, { ...existing, configPresent: true });
  }
  return validatePolicy(root, {
    version: SUPPORTED_VERSION,
    remote: options.remote,
    remoteName: options.remoteName ?? 'origin',
    canonicalBranch: options.canonicalBranch ?? 'main',
    branchPrefix: options.branchPrefix ?? 'codex/',
    taskStateDir: DEFAULT_TASK_STATE_DIR,
    structureVersion: STRUCTURE_VERSION,
    configPresent: false,
  });
}

function addIssue(report, code, message) {
  report.issues.push({ code, message });
}

function addWarning(report, code, message) {
  report.warnings.push({ code, message });
}

function taskStatePath(settings, branch) {
  const readable = branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
  const digest = createHash('sha256').update(branch).digest('hex').slice(0, 8);
  return `${settings.taskStateDir.replace(/\\/g, '/')}/${readable}-${digest}.md`;
}

function taskStateTemplate(branch, base, title) {
  const safeTitle = title?.trim() || branch;
  if (/[\r\n]/.test(safeTitle)) throw new Error('Task title must be a single line.');
  return [
    '<!-- git-project-sync-task:version=2 -->',
    `<!-- git-project-sync-task:id=${randomUUID()} -->`,
    `<!-- git-project-sync-task:branch=${branch} -->`,
    `<!-- git-project-sync-task:base=${base} -->`,
    '<!-- git-project-sync-task:status=in-progress -->',
    '<!-- git-project-sync-task:scaffold=true -->',
    '',
    `# Task: ${safeTitle}`,
    '',
    '## Objective',
    '',
    'Describe the user-visible outcome and scope.',
    '',
    '## Acceptance criteria',
    '',
    '- State observable completion conditions.',
    '',
    '## Completed',
    '',
    '- Record committed results, not intentions.',
    '',
    '## Verification',
    '',
    '- Record commands and outcomes tied to the current branch.',
    '',
    '## Blockers and unknowns',
    '',
    '- Record unresolved ownership, environment, authorization, or validation gaps.',
    '',
    '## Deployment request',
    '',
    '- Required: undecided; list affected deployment unit IDs and targets, or explain why not required.',
    '- Handoff: this remote branch and task record; report the resulting head SHA outside this file.',
    '- Evidence and dependencies: link tests, cross-unit compatibility/order, configuration/migrations, and rollback constraints.',
    '- Status: not submitted; track code/main delivery, each unit rollout, and production acceptance separately.',
    '- Owners: route each unit to its designated CI/deployment chat in the latest canonical plan; this task does not claim ownership.',
    '',
    '## Next step',
    '',
    '- Give the next agent one concrete starting action.',
    '',
  ].join('\n');
}

function taskMetadata(content) {
  const entries = [...content.matchAll(/<!-- git-project-sync-task:([a-z-]+)=([^>\r\n]+) -->/g)]
    .map((match) => [match[1], match[2].trim()]);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error('Task record contains duplicate metadata fields.');
  }
  return Object.fromEntries(entries);
}

function taskSection(content, name) {
  const heading = `## ${name}`;
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === heading);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

function sourceDigest(root, settings, revision) {
  const tree = git(root, ['ls-tree', '-r', '-z', revision]);
  if (!tree.ok) throw new Error('Cannot read the source tree for freshness verification.');
  const prefix = `${settings.taskStateDir.replace(/\\/g, '/')}/`;
  const entries = tree.raw.split('\0').filter(Boolean).filter((entry) => {
    const path = entry.slice(entry.indexOf('\t') + 1);
    return !path.startsWith(prefix);
  });
  return createHash('sha256').update(entries.join('\0')).digest('hex');
}

function validateTaskContent(content, report, requireVerification = true) {
  const metadata = taskMetadata(content);
  report.taskStatus = metadata.status ?? null;
  report.taskId = metadata.id ?? null;
  if (!['1', '2'].includes(metadata.version)) addIssue(report, 'task_state_version', 'Task record version is missing or unsupported.');
  if (metadata.branch !== report.localBranch) addIssue(report, 'task_state_branch', 'Task record branch does not match the selected branch.');
  if (metadata.base !== report.base) addIssue(report, 'task_state_base', 'Task record base does not match the verified base.');
  if (!TASK_STATUSES.has(metadata.status)) addIssue(report, 'task_state_status', 'Task record has an invalid status.');
  if (metadata.scaffold === 'true') addIssue(report, 'task_state_scaffold', 'Complete the task record and remove scaffold=true.');
  const placeholders = {
    Objective: 'Describe the user-visible outcome and scope.',
    'Acceptance criteria': 'State observable completion conditions.',
    Completed: 'Record committed results, not intentions.',
    Verification: 'Record commands and outcomes tied to the current branch.',
    'Blockers and unknowns': 'Record unresolved ownership, environment, authorization, or validation gaps.',
    'Next step': 'Give the next agent one concrete starting action.',
  };
  for (const [name, placeholder] of Object.entries(placeholders)) {
    const body = taskSection(content, name);
    if (name === 'Verification' && !requireVerification && body !== null) continue;
    if (!body || !body.replace(/<!--[^]*?-->|[\s*\-\[\]]/g, '') || body.includes(placeholder)) {
      addIssue(report, 'task_state_incomplete', `Fill ## ${name} with actual task information.`);
    }
  }
  return metadata;
}

function projectMapTemplate() {
  return [
    '# Project Map',
    '',
    '<!-- git-project-sync:structure:scaffold=true -->',
    '',
    '## Project identity',
    '',
    '- Purpose and users: describe the project in one or two sentences.',
    '- Repository and canonical branch: see `.agent-sync.json`.',
    '- Main entry point: add the actual path or explain why there is none.',
    '',
    '## Locations',
    '',
    '| Category | Repository path | What belongs there |',
    '| --- | --- | --- |',
    '| Working rules | `AGENTS.md` | Agent instructions and project constraints |',
    '| Git binding | `.agent-sync.json` | Remote, branch, and structure policy |',
    '| Project plan | `.agent-sync/plan.md` | Shared milestones and current priorities |',
    '| Task handoffs | `.agent-sync/tasks/` | One committed record per task branch |',
    '| Product source | Replace with actual path | Code owned by this repository |',
    '| Tests | Replace with actual path | Test suites and fixtures |',
    '| Specifications and decisions | Replace with actual path | Requirements, architecture, and decisions |',
    '| Operations and releases | Replace with actual path | Deployment instructions and release evidence, if applicable |',
    '',
    '## Validation and environments',
    '',
    '- Add build/test commands and identify which environment each checks.',
    '- Link any separate repositories or external artifact stores by non-secret reference.',
    '',
    '## Handoff reading order',
    '',
    '1. Read this map and `.agent-sync/plan.md`.',
    '2. Read the current branch record in `.agent-sync/tasks/`.',
    '3. Verify the Git base/head and inspect the relevant source, tests, and evidence.',
    '',
  ].join('\n');
}

function projectPlanTemplate() {
  return [
    '# Development Plan',
    '',
    '<!-- git-project-sync:structure:scaffold=true -->',
    '',
    '## Outcome and scope',
    '',
    'Describe the intended project outcome and current scope.',
    '',
    '## Milestones',
    '',
    '| Milestone | Status | Acceptance evidence |',
    '| --- | --- | --- |',
    '| Add a real milestone | planned | Add a verifiable result |',
    '',
    '## Current priorities',
    '',
    '- Link active task branches or their records and identify dependencies.',
    '',
    '## Acceptance and release gates',
    '',
    '- State project-specific checks and distinguish code completion from deployment.',
    '',
    '## Deployment coordination',
    '',
    '- Define one unit per endpoint or inseparable code/artifact set; independently releasable services and clients may have different owners.',
    '- Record one owning chat/thread per unit; one chat may own several units. Later code for the same unit stays with its owner.',
    '- Mark deployment not applicable if there is no deployable target.',
    '',
    '### Unit: unassigned',
    '',
    '- Code and targets: record code/artifact scope and environments/services.',
    '- CI/deployment chat: unassigned; record one stable chat/thread ID and optional link for this unit.',
    '- Designation: record the user instruction or authorized project decision assigning this unit.',
    '- Runbook and dependencies: identify CI/build/deployment triggers, shared targets/resources, locks, ordering, and rollback constraints.',
    '- Version rules: record the existing version scheme and allocator; retain independent unit sequences or name one allocator for shared versions.',
    '- Current release: idle; record this unit batch, candidate SHA/artifact digest, included tasks, status, and evidence.',
    '',
    '### Shared coordination',
    '',
    '- Repeat the unit block for each deployment unit. Preserve established owners when adopting or refreshing the skill.',
    '- Development chats commit/push and run local checks independently; each owner coordinates its unit CI, deployment, migration, and rollback.',
    '- Independent units may release concurrently; serialize shared-target/resource jobs and designate one executor for shared CI or migrations.',
    '- Missing/conflicting ownership pauses only affected units and dependent releases; transfers reconcile active jobs before updating that unit owner.',
    '',
    '## Decisions and open questions',
    '',
    '- Link the authoritative decision or record the unresolved choice.',
    '',
  ].join('\n');
}

function verifyCommittedProjectStructure(root, settings, report) {
  if (!settings.configPresent) return;
  const config = git(root, ['show', `${report.head}:${CONFIG_NAME}`]);
  if (!config.ok) addIssue(report, 'config_not_committed', `Commit ${CONFIG_NAME} with this task.`);
  else if (configContent(validateConfig(JSON.parse(config.stdout))) !== configContent(settings)) {
    addIssue(report, 'config_not_committed', 'The committed coordination config differs from the selected policy.');
  }
  if (settings.structureVersion !== STRUCTURE_VERSION) {
    addWarning(report, 'legacy_project_structure',
      'This binding predates the project map and plan; adopt them with bind --update.');
    return;
  }
  for (const [path, label, heading, placeholders] of [
    [PROJECT_MAP_PATH, 'project map', '# Project Map',
      ['Replace with actual path', 'describe the project in one or two sentences',
        'add the actual path or explain why there is none']],
    [PROJECT_PLAN_PATH, 'development plan', '# Development Plan',
      ['Describe the intended project outcome and current scope', 'Add a real milestone',
        'Add a verifiable result']],
  ]) {
    const committed = git(root, ['show', `${report.head}:${path}`]);
    if (!committed.ok) {
      addIssue(report, 'structure_missing', `Commit the ${label} at ${path}.`);
    } else if (!committed.stdout.includes(heading) ||
        committed.stdout.includes('git-project-sync:structure:scaffold=true') ||
        placeholders.some((placeholder) => committed.stdout.includes(placeholder))) {
      addIssue(report, 'structure_incomplete', `Complete the ${label} at ${path} before continuing.`);
    }
  }
  report.projectMap = PROJECT_MAP_PATH;
  report.projectPlan = PROJECT_PLAN_PATH;
}

function verifyCommittedTaskState(root, settings, report) {
  if (!report.localBranch || report.localBranch === '(detached)' || !report.base) return;
  const relativePath = taskStatePath(settings, report.localBranch);
  report.taskStateFile = relativePath;
  const committed = git(root, ['show', `${report.head}:${relativePath}`]);
  if (!committed.ok) {
    addIssue(report, 'task_state_missing', `Commit the task continuity record at ${relativePath}.`);
    return;
  }
  const metadata = validateTaskContent(committed.stdout, report);
  report.sourceDigest = sourceDigest(root, settings, report.head);
  if (!/^[a-f0-9]{64}$/.test(metadata['source-digest'] ?? '')) {
    addIssue(report, 'task_state_freshness_missing', 'Run save with explicit verification evidence to record the source digest.');
  } else if (metadata['source-digest'] !== report.sourceDigest) {
    addIssue(report, 'task_state_stale', 'Source changed after the task record was saved; update the record and run save.');
  }
}

function verifyRemoteUrls(root, settings, report) {
  for (const push of [false, true]) {
    const result = git(root, ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', settings.remoteName]);
    const key = push ? 'pushRemotes' : 'checkoutRemotes';
    const label = push ? 'push' : 'fetch';
    report[key] = [];
    if (!result.ok || !result.stdout) {
      addIssue(report, push ? 'push_remote_missing' : 'remote_missing', `Cannot resolve all ${label} URLs.`);
      continue;
    }
    for (const url of result.stdout.split(/\r?\n/)) {
      if (hasEmbeddedCredential(url)) {
        addIssue(report, push ? 'embedded_push_credential' : 'embedded_remote_credential', `${label} URL contains credentials or parameters.`);
        continue;
      }
      const normalized = normalizeRemote(url, root);
      report[key].push(normalized);
      if (normalized !== report.expectedRemote) {
        addIssue(report, push ? 'push_remote_mismatch' : 'remote_mismatch', `Every ${label} URL must match the supplied destination.`);
      }
    }
  }
  report.normalizedCheckoutRemote = report.checkoutRemotes[0] ?? null;
  report.normalizedPushRemote = report.pushRemotes[0] ?? null;
}

function inspect(root, settings, command, baseInput, { allowDirty = false } = {}) {
  const report = {
    ok: false,
    command,
    repository: root,
    configPresent: settings.configPresent,
    expectedRemote: normalizeRemote(settings.remote, root),
    normalizedCheckoutRemote: null,
    normalizedPushRemote: null,
    remoteName: settings.remoteName,
    canonicalBranch: settings.canonicalBranch,
    branchPrefix: settings.branchPrefix,
    remoteHead: null,
    localBranch: null,
    head: null,
    upstream: null,
    worktreeClean: null,
    changedEntryCount: null,
    relationToRemoteHead: 'unknown',
    base: null,
    remoteTaskHead: null,
    taskStateFile: null,
    taskStatus: null,
    projectMap: null,
    projectPlan: null,
    issues: [],
    warnings: [],
  };

  verifyRemoteUrls(root, settings, report);
  // Do not contact an unverified destination, even for a read-only query.
  if (report.issues.length) return report;

  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  report.localBranch = branch.ok && branch.stdout ? branch.stdout : '(detached)';
  report.head = resolveCommit(root, 'HEAD');
  if (!report.head) addIssue(report, 'head_missing', 'HEAD does not resolve to a commit.');

  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  report.upstream = upstream.ok ? upstream.stdout : null;

  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!status.ok) addIssue(report, 'status_failed', 'Git worktree status could not be read.');
  else {
    const entries = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean) : [];
    report.changedEntryCount = entries.length;
    report.worktreeClean = entries.length === 0;
  }

  const canonical = remoteBranchSha(root, settings.remoteName, settings.canonicalBranch);
  if (!canonical.ok) {
    addIssue(
      report,
      'canonical_remote_unverified',
      canonical.timedOut ? 'Canonical remote verification timed out.' : 'Canonical remote branch could not be resolved.',
    );
  } else report.remoteHead = canonical.sha;

  if (report.remoteHead && command !== 'observe' && !resolveCommit(root, report.remoteHead)) {
    const fetched = git(root, ['fetch', '--no-tags', settings.remoteName, `refs/heads/${settings.canonicalBranch}`]);
    if (!fetched.ok || resolveCommit(root, 'FETCH_HEAD') !== report.remoteHead) {
      addIssue(report, 'canonical_fetch_failed', 'Canonical history could not be pinned; retry after inspecting the remote.');
    }
  }

  if (report.head && report.remoteHead) {
    if (report.head === report.remoteHead) report.relationToRemoteHead = 'equal';
    else if (!resolveCommit(root, report.remoteHead)) {
      report.relationToRemoteHead = 'remote-object-not-local';
      addWarning(report, 'fetch_required', 'Fetch the canonical branch before ancestry checks.');
    } else if (isAncestor(root, report.remoteHead, report.head)) report.relationToRemoteHead = 'local-ahead';
    else if (isAncestor(root, report.head, report.remoteHead)) report.relationToRemoteHead = 'local-behind';
    else {
      report.relationToRemoteHead = 'diverged';
      addWarning(report, 'history_diverged', 'Local HEAD and the canonical remote branch have diverged.');
    }
  }

  if (!settings.configPresent) {
    if (['observe', 'list', 'adopt'].includes(command)) {
      addWarning(report, 'project_unbound', `The project has no committed ${CONFIG_NAME}.`);
    } else {
      addIssue(report, 'project_unbound', `Bind and commit ${CONFIG_NAME} before cross-agent work.`);
    }
  }
  if (!['adopt', 'save', 'list'].includes(command)) verifyCommittedProjectStructure(root, settings, report);

  if (command === 'observe' && report.localBranch === settings.canonicalBranch) {
    if (report.worktreeClean !== true) {
      addIssue(report, 'shared_canonical_dirty', 'The canonical branch has local changes of unresolved ownership.');
    }
    if (report.head && report.remoteHead && report.head !== report.remoteHead) {
      addIssue(report, 'canonical_head_mismatch', 'Local canonical HEAD does not equal the remote canonical head.');
    }
  }

  if (!['observe', 'list'].includes(command)) {
    if (!allowDirty && !['adopt', 'save'].includes(command) && report.worktreeClean !== true) {
      addIssue(report, 'worktree_dirty', 'This gate requires a clean worktree.');
    }
    if (report.localBranch === '(detached)') addIssue(report, 'detached_head', 'Use a named task branch.');
    else if (report.localBranch === settings.canonicalBranch) {
      addIssue(report, 'canonical_branch_in_use', 'Do not develop or hand off directly on the canonical branch.');
    } else if (!report.localBranch.startsWith(settings.branchPrefix)) {
      addIssue(report, 'task_branch_prefix', `Task branches must start with ${settings.branchPrefix}.`);
    }

    if (!baseInput && report.localBranch !== '(detached)') {
      const path = join(root, taskStatePath(settings, report.localBranch));
      if (existsSync(path)) baseInput = taskMetadata(readFileSync(path, 'utf8')).base;
    }
    if (!baseInput && ['start', 'task-init'].includes(command)) baseInput = report.remoteHead;
    if (!baseInput && command === 'adopt' && report.remoteHead) {
      const common = git(root, ['merge-base', report.head, report.remoteHead]);
      if (common.ok) baseInput = common.stdout;
    }
    report.base = resolveCommit(root, baseInput);
    if (!baseInput) addIssue(report, 'base_required', `--base is required for ${command}.`);
    else if (!report.base) addIssue(report, 'base_missing', 'The base revision is not a local commit.');
    else if (report.head && !isAncestor(root, report.base, report.head)) {
      addIssue(report, 'base_not_ancestor', 'The base commit is not an ancestor of HEAD.');
    }
    if (report.base && report.remoteHead && !isAncestor(root, report.base, report.remoteHead)) {
      addIssue(report, 'base_not_canonical', 'The base commit must belong to the canonical branch history.');
    }
  }

  if ((command === 'start' || command === 'task-init') && report.base && report.remoteHead) {
    if (report.base !== report.remoteHead) {
      addIssue(report, 'stale_start_base', 'A new task must start from the current canonical remote head.');
    }
    if (report.head !== report.base) {
      addIssue(report, 'start_head_mismatch', 'Before editing, task HEAD must equal the base commit.');
    }
  }

  if (command === 'resume' || command === 'handoff') {
    if (!validBranchName(root, report.localBranch)) {
      addIssue(report, 'invalid_task_branch', 'The current task branch is not a valid Git branch name.');
    } else {
      const task = remoteBranchSha(root, settings.remoteName, report.localBranch);
      report.remoteTaskHead = task.sha;
      if (!task.ok) addIssue(report, 'task_branch_not_remote', 'The task branch does not exist on the configured remote.');
      else if (report.head !== task.sha) {
        addIssue(report, 'task_branch_out_of_sync', 'Local HEAD and the remote task branch differ.');
      }
    }
    verifyCommittedTaskState(root, settings, report);
  }

  if (command === 'handoff' && report.base && report.head === report.base) {
    addWarning(report, 'no_commits_after_base', 'The handoff contains no commit after the base.');
  }

  report.ok = report.issues.length === 0;
  return report;
}

function configContent(settings) {
  const config = {
    version: SUPPORTED_VERSION,
    remote: settings.remote,
    remoteName: settings.remoteName,
    canonicalBranch: settings.canonicalBranch,
    branchPrefix: settings.branchPrefix,
    taskStateDir: settings.taskStateDir,
  };
  if (settings.structureVersion !== undefined) config.structureVersion = settings.structureVersion;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function managedAgentsBlock() {
  return [
    MANAGED_START,
    'For any task that changes this repository or resumes another agent\'s work, first read',
    '`.agents/skills/git-project-sync/SKILL.md` and use `.agent-sync.json` as the',
    'repository coordination config. Remote refs and commit SHAs define code state;',
    'handoff prose and generated artifacts are supporting evidence only.',
    'Require a user-supplied Git URL via `--remote` for every project-sync command;',
    'verify it matches the config and checkout fetch/push URLs before saving work.',
    'Read `.agent-sync/project-map.md`, `.agent-sync/plan.md`, and the current',
    'branch record in `.agent-sync/tasks/` before continuing another agent\'s work.',
    'Use adopt for existing work, save with explicit file paths and verification',
    'evidence, and list to discover remote tasks. Resume in a new isolated worktree.',
    'Development chats may commit, push, and run local checks independently.',
    'Before shared CI or deployment, verify each affected deployment unit and its',
    'single owning chat/thread in the latest canonical-branch plan. Independent',
    'units may have different owners; later code for a unit stays with its owner.',
    'Only that unit owner coordinates its CI, deployment, migration, and rollback.',
    'Other chats commit requests per affected unit. Coordinate cross-unit changes',
    'and serialize shared-target/resource jobs; independent units may release concurrently.',
    'Unassigned or conflicting ownership pauses only affected CI/deployment and',
    'dependent releases, not development, Git handoff, or unrelated independent units.',
    MANAGED_END,
  ].join('\n');
}

function updateAgentsContent(existing) {
  const block = managedAgentsBlock();
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) {
    throw new Error('AGENTS.md contains an incomplete git-project-sync managed block.');
  }
  if (start >= 0) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + MANAGED_END.length)}`;
  }
  const prefix = existing.trimEnd();
  return `${prefix ? `${prefix}\n\n` : ''}${block}\n`;
}

function writeIfChanged(path, content, changed) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  changed.push(path);
}

function writeIfMissing(path, content, changed) {
  if (existsSync(path)) return;
  writeIfChanged(path, content, changed);
}

function assertManagedFile(root, path) {
  const parts = relative(root, path).split(/[\\/]/);
  if (parts.includes('..')) throw new Error('Managed file is outside the repository.');
  for (let index = 1; index <= parts.length; index += 1) {
    const target = join(root, ...parts.slice(0, index));
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error('Managed files cannot follow repository symlinks. Preserve them and resolve the target first.');
    }
  }
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error('Managed target must be a regular file.');
}

function physicalPath(path) {
  const missing = [];
  let parent = resolve(path);
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    parent = dirname(parent);
  }
  return resolve(realpathSync(parent), ...missing);
}

function bindProject(root, options) {
  if (!options.remote) throw new Error('bind requires --remote.');
  validateSafeRemote(options.remote);
  const configPath = join(root, CONFIG_NAME);
  const currentConfig = existsSync(configPath) ? validateConfig(readJson(configPath)) : null;
  const adopting = options.command === 'adopt';
  if (adopting && currentConfig) settingsFor(root, options);
  const settings = validatePolicy(root, {
    version: SUPPORTED_VERSION,
    remote: options.remote,
    remoteName: options.remoteName ?? currentConfig?.remoteName ?? 'origin',
    canonicalBranch: options.canonicalBranch ?? currentConfig?.canonicalBranch ?? 'main',
    branchPrefix: options.branchPrefix ?? currentConfig?.branchPrefix ?? 'codex/',
    taskStateDir: currentConfig?.taskStateDir ?? DEFAULT_TASK_STATE_DIR,
    structureVersion: STRUCTURE_VERSION,
    configPresent: false,
  });

  if (!adopting && currentConfig && configContent(currentConfig) !== configContent(settings) && !options.update) {
    throw new Error(`Existing ${CONFIG_NAME} differs; use --update only after reviewing the change.`);
  }

  const preflight = inspect(root, settings, adopting ? 'adopt' : 'observe', options.base);
  preflight.issues = preflight.issues.filter((issue) => issue.code !== 'shared_canonical_dirty');
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!adopting && (!status.ok || status.stdout)) addIssue(preflight, 'bind_requires_clean_tree', 'Bind requires a clean worktree.');
  if (!adopting && preflight.head && preflight.remoteHead && preflight.head !== preflight.remoteHead) {
    addIssue(preflight, 'bind_head_mismatch', 'Bind must start at the current canonical remote head.');
  }
  preflight.ok = preflight.issues.length === 0;
  if (!preflight.ok) return { report: preflight, changed: [] };
  const taskPath = adopting ? taskStatePath(settings, preflight.localBranch) : null;
  if (taskPath && existsSync(join(root, taskPath))) {
    throw new Error('This branch already has a task record; update it and use save.');
  }

  const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const targetRoot = join(root, '.agents', 'skills', 'git-project-sync');
  const managedFiles = [
    ['SKILL.md', join(sourceRoot, 'SKILL.md'), join(targetRoot, 'SKILL.md')],
    ['project-sync.mjs', join(sourceRoot, 'scripts', 'project-sync.mjs'), join(targetRoot, 'scripts', 'project-sync.mjs')],
    ['deployment.md', join(sourceRoot, 'references', 'deployment.md'), join(targetRoot, 'references', 'deployment.md')],
  ];
  for (const [label, source, target] of managedFiles) {
    if (!existsSync(source)) throw new Error(`Installed skill is missing ${label}.`);
    if (resolve(source) === resolve(target)) continue;
    if (existsSync(target) && readFileSync(target, 'utf8') !== readFileSync(source, 'utf8') && !options.refreshSkill) {
      throw new Error(`Vendored ${label} differs; use --refresh-skill only after review.`);
    }
  }

  const agentsPath = join(root, 'AGENTS.md');
  const agentsExisting = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
  const agentsContent = updateAgentsContent(agentsExisting);
  const taskContent = adopting ? taskStateTemplate(preflight.localBranch, preflight.base, options.title) : null;
  for (const path of [configPath, join(root, PROJECT_MAP_PATH), join(root, PROJECT_PLAN_PATH),
    agentsPath, ...managedFiles.map(([, , target]) => target), ...(taskPath ? [join(root, taskPath)] : [])]) {
    assertManagedFile(root, path);
  }

  const changed = [];
  writeIfChanged(configPath, configContent(settings), changed);
  writeIfMissing(join(root, PROJECT_MAP_PATH), projectMapTemplate(), changed);
  writeIfMissing(join(root, PROJECT_PLAN_PATH), projectPlanTemplate(), changed);
  for (const [, source, target] of managedFiles) {
    if (resolve(source) === resolve(target)) continue;
    writeIfChanged(target, readFileSync(source, 'utf8'), changed);
  }
  const targetScript = join(targetRoot, 'scripts', 'project-sync.mjs');
  if (existsSync(targetScript)) chmodSync(targetScript, 0o755);

  writeIfChanged(agentsPath, agentsContent, changed);
  if (taskPath) writeIfChanged(join(root, taskPath), taskContent, changed);

  return {
    report: {
      ...preflight,
      ok: true,
      command: adopting ? 'adopt' : 'bind',
      configPresent: true,
      taskStateFile: taskPath,
      issues: [],
      warnings: [],
    },
    changed,
  };
}

function setTaskMetadata(content, key, value) {
  const line = `<!-- git-project-sync-task:${key}=${value} -->`;
  const pattern = new RegExp(`^<!-- git-project-sync-task:${key}=[^\\r\\n]* -->$`, 'm');
  return pattern.test(content) ? content.replace(pattern, line) : `${line}\n${content}`;
}

function selectedPaths(root, options, taskPath) {
  if (!options.paths.length) throw new Error('save requires explicit --path FILE selections; the task record is added automatically.');
  const paths = [...new Set([...options.paths, taskPath])];
  for (const path of paths) {
    if (isAbsolute(path) || /[\\\r\n]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Save paths must be literal repository-relative file names.');
    }
    const absolute = join(root, path);
    // Do not follow a parent symlink while reading or writing a record.
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parent = join(root, ...parts.slice(0, index));
      if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error('Save paths cannot traverse a symlink.');
    }
    if (existsSync(absolute) && lstatSync(absolute).isDirectory()) throw new Error('Select individual files, not directories.');
    if (!existsSync(absolute) && !git(root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', path]).ok) {
      throw new Error(`Selected file does not exist or is ignored: ${path}`);
    }
  }
  if (lstatSync(join(root, taskPath)).isSymbolicLink()) throw new Error('The task record must be a regular file.');
  return paths;
}

function commitSelectedTree(root, tree, message) {
  const originalHooks = git(root, ['rev-parse', '--git-path', 'hooks']);
  if (!originalHooks.ok) throw new Error('Cannot resolve the project hook configuration.');
  const temporary = mkdtempSync(join(tmpdir(), 'git-project-sync-hooks-'));
  const violation = join(temporary, 'index-changed.json');
  const runner = join(temporary, 'run-hook.mjs');
  const settings = { root, tree, hooks: resolve(root, originalHooks.stdout), violation, temporary };
  const shellQuote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const shellPath = (value) => process.platform === 'win32' ? value.replace(/\\/g, '/') : value;
  try {
    writeFileSync(runner, `import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
const config = ${JSON.stringify(settings)};
const [hook, ...args] = process.argv.slice(2);
const stdinPath = config.temporary + '/stdin-' + process.pid;
writeFileSync(stdinPath, readFileSync(0));
let original;
try {
  original = spawnSync('git', ['-c', 'core.hooksPath=' + config.hooks,
    'hook', 'run', '--ignore-missing', '--to-stdin=' + stdinPath, hook, '--', ...args],
    { cwd: config.root, stdio: 'inherit' });
} finally {
  unlinkSync(stdinPath);
}
if (original.error || original.status !== 0) process.exit(original.status || 1);
if (['pre-commit', 'prepare-commit-msg', 'commit-msg'].includes(hook)) {
  const current = spawnSync('git', ['write-tree'], { cwd: config.root, encoding: 'utf8' });
  if (current.status !== 0 || current.stdout.trim() !== config.tree) {
    writeFileSync(config.violation, JSON.stringify({ hook }));
    process.stderr.write('Git project sync: hook changed the reviewed index; no commit is allowed.\\n');
    process.exit(97);
  }
}
`, 'utf8');
    const hooks = new Set(['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']);
    if (existsSync(settings.hooks)) {
      for (const entry of readdirSync(settings.hooks, { withFileTypes: true })) {
        const name = process.platform === 'win32' ? entry.name.replace(/\.exe$/i, '') : entry.name;
        if ((entry.isFile() || entry.isSymbolicLink()) && /^[a-z][a-z0-9-]*$/.test(name)) hooks.add(name);
      }
    }
    for (const hook of hooks) {
      const wrapper = `#!/bin/sh\nexec ${shellQuote(shellPath(process.execPath))} ${shellQuote(shellPath(runner))} ${shellQuote(hook)} "$@"\n`;
      writeFileSync(join(temporary, hook), wrapper, { mode: 0o755 });
    }
    // Run every existing commit hook through Git itself, preserving its platform execution rules.
    // A guard follows each pre-commit phase, before Git can create the actual commit.
    const result = git(root, ['-c', `core.hooksPath=${temporary}`, 'commit', '-m', message], 0);
    return { ...result, indexChangedByHook: existsSync(violation) ? readJson(violation).hook : null };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function saveTask(root, settings, options) {
  const report = inspect(root, settings, 'save', options.base);
  if (!report.ok) return { report, changed: [] };
  if (!options.message?.trim() || !options.verification?.trim() || /[\r\n]/.test(options.message + options.verification)) {
    throw new Error('save requires a single-line --message and --verification (actual evidence, or not-run with a reason).');
  }
  const taskPath = taskStatePath(settings, report.localBranch);
  const absoluteTask = join(root, taskPath);
  if (!existsSync(absoluteTask)) throw new Error('Create a task record with task-init or adopt before save.');
  const paths = selectedPaths(root, options, taskPath);
  const staged = git(root, ['diff', '--cached', '--name-only', '-z']);
  if (!staged.ok) throw new Error('Cannot inspect staged changes.');
  if (staged.raw.split('\0').filter(Boolean).some((path) => !paths.includes(path))) {
    addIssue(report, 'unrelated_staged_changes', 'The index contains files outside --path selections; leave them untouched and resolve ownership first.');
  }
  const remote = git(root, ['ls-remote', '--heads', settings.remoteName, `refs/heads/${report.localBranch}`]);
  if (!remote.ok) addIssue(report, 'task_remote_unverified', 'Cannot verify the remote task before saving.');
  const remoteHead = remote.stdout.split(/\s/)[0];
  if (remoteHead && !isAncestor(root, remoteHead, report.head)) {
    addIssue(report, 'remote_task_ahead', 'Remote task work is not contained locally; fetch and review before saving.');
  }
  let content = readFileSync(absoluteTask, 'utf8').replace(/\r\n/g, '\n');
  validateTaskContent(content, report, false);
  if (report.issues.length) { report.ok = false; return { report, changed: [] }; }

  // Only explicit paths enter the index. Failures leave selected work intact for inspection.
  if (!git(root, ['--literal-pathspecs', 'add', '--', ...paths]).ok) throw new Error('Staging failed; inspect the selected paths and index before retrying.');
  const tree = git(root, ['write-tree']);
  if (!tree.ok) throw new Error('Cannot snapshot selected source changes.');
  const digest = sourceDigest(root, settings, tree.stdout);
  content = setTaskMetadata(content, 'version', '2');
  if (!taskMetadata(content).id) content = setTaskMetadata(content, 'id', randomUUID());
  content = setTaskMetadata(content, 'source-digest', digest);
  const verification = `- Source digest: \`${digest}\`; ${options.verification.trim()}`;
  const sectionStart = content.indexOf('## Verification\n');
  if (sectionStart < 0) throw new Error('Add ## Verification before saving.');
  const nextHeading = content.indexOf('\n## ', sectionStart + 1);
  const end = nextHeading < 0 ? content.length : nextHeading;
  const previousEvidence = taskSection(content, 'Verification')
    .replace(/^\s*-?\s*Record commands and outcomes tied to the current branch\.\s*$/m, '').trim();
  const evidence = previousEvidence.includes(verification)
    ? previousEvidence : `${verification}${previousEvidence ? `\n\n${previousEvidence}` : ''}`;
  content = `${content.slice(0, sectionStart)}## Verification\n\n${evidence}\n${content.slice(end)}`;
  writeFileSync(absoluteTask, content, 'utf8');
  if (!git(root, ['--literal-pathspecs', 'add', '--', taskPath]).ok) throw new Error('Cannot stage the task record.');
  const candidate = git(root, ['write-tree']);
  if (!candidate.ok) throw new Error('Cannot inspect the candidate tree.');
  const candidateReport = { ...report, head: candidate.stdout, issues: [], warnings: [...report.warnings] };
  verifyCommittedProjectStructure(root, settings, candidateReport);
  verifyCommittedTaskState(root, settings, candidateReport);
  if (!git(root, ['diff', '--cached', '--check']).ok) addIssue(candidateReport, 'staged_diff_invalid', 'Fix staged whitespace errors before committing.');
  if (candidateReport.issues.length) {
    candidateReport.ok = false;
    return { report: candidateReport, changed: [absoluteTask] };
  }
  const before = report.head;
  const hasChanges = !git(root, ['diff', '--cached', '--quiet']).ok;
  if (hasChanges) {
    const committed = commitSelectedTree(root, candidate.stdout, options.message);
    if (!committed.ok) {
      addIssue(report, committed.indexChangedByHook ? 'commit_hook_changed_index' : 'commit_failed',
        committed.indexChangedByHook
          ? `The ${committed.indexChangedByHook} hook changed the reviewed index. No push was attempted; preserve and review staged work before retrying.`
          : 'Commit did not report success. Inspect HEAD and the index before retrying; no push was attempted.');
      return { report: { ...report, ok: false, previousHead: before, savedHead: resolveCommit(root, 'HEAD'), synchronized: false }, changed: [absoluteTask] };
    }
  }
  const afterCommit = resolveCommit(root, 'HEAD');
  const prePush = inspect(root, settings, 'save', report.base);
  verifyCommittedProjectStructure(root, settings, prePush);
  verifyCommittedTaskState(root, settings, prePush);
  if (prePush.localBranch !== report.localBranch || prePush.head !== afterCommit) {
    addIssue(prePush, 'save_head_changed', 'The selected branch or HEAD changed during save; inspect before pushing.');
  }
  prePush.ok = prePush.issues.length === 0;
  if (!prePush.ok) return { report: { ...prePush, previousHead: before, savedHead: afterCommit, synchronized: false }, changed: [absoluteTask] };
  if (!git(root, ['push', '--porcelain', settings.remoteName, `${afterCommit}:refs/heads/${report.localBranch}`]).ok) {
    addIssue(prePush, 'push_failed', 'Push failed or its outcome is unknown. Keep the local commit, inspect the remote, and do not force-push.');
    return { report: { ...prePush, ok: false, previousHead: before, savedHead: afterCommit, synchronized: false }, changed: [absoluteTask] };
  }
  const verified = inspect(root, settings, 'handoff', report.base, { allowDirty: true });
  verified.command = 'save';
  verified.previousHead = before;
  verified.savedHead = afterCommit;
  verified.synchronized = verified.ok;
  verified.savedPaths = paths;
  if (!verified.worktreeClean) addWarning(verified, 'unsaved_worktree_changes', 'Other worktree changes remain local; only the selected committed files were synchronized.');
  return { report: verified, changed: [absoluteTask] };
}

function listTasks(root, settings, options) {
  const report = inspect(root, settings, 'list', null);
  report.tasks = [];
  if (!report.ok) return report;
  const refs = git(root, ['ls-remote', '--heads', settings.remoteName, `refs/heads/${settings.branchPrefix}*`]);
  if (!refs.ok) {
    addIssue(report, 'task_list_unverified', 'Cannot list remote task branches.');
    report.ok = false;
    return report;
  }
  const branches = refs.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [head, ref] = line.split(/\s+/);
    return { head, branch: ref.slice('refs/heads/'.length) };
  });
  if (branches.length) {
    const fetched = git(root, ['fetch', '--no-tags', settings.remoteName, ...branches.map((task) => `refs/heads/${task.branch}`)]);
    if (!fetched.ok) {
      addIssue(report, 'task_fetch_failed', 'Remote tasks changed or could not be fetched; inspect and retry.');
      report.ok = false;
      return report;
    }
  }
  for (const { head, branch } of branches) {
    if (!resolveCommit(root, head)) {
      addIssue(report, 'task_snapshot_changed', 'A listed remote commit is unavailable after fetch; rerun discovery.');
      continue;
    }
    const recordPath = taskStatePath(settings, branch);
    const record = git(root, ['show', `${head}:${recordPath}`]);
    const merged = isAncestor(root, head, report.remoteHead);
    const task = { branch, head, taskStateFile: recordPath, merged, issues: [], warnings: [], valid: false };
    if (record.ok) {
      try {
        const metadata = taskMetadata(record.stdout);
        Object.assign(task, {
          id: metadata.id ?? null,
          base: metadata.base ?? null,
          status: metadata.status ?? 'unknown',
          title: record.stdout.match(/^# Task: (.+)$/m)?.[1] ?? branch,
          nextStep: taskSection(record.stdout, 'Next step'),
        });
        const committedConfig = git(root, ['show', `${head}:${CONFIG_NAME}`]);
        if (!committedConfig.ok) throw new Error('Missing committed task binding.');
        const taskSettings = validatePolicy(root, { ...validateConfig(JSON.parse(committedConfig.stdout)), configPresent: true });
        const check = { ...task, localBranch: branch, head, issues: [], warnings: [] };
        if (normalizeRemote(taskSettings.remote, root) !== report.expectedRemote ||
            taskSettings.canonicalBranch !== settings.canonicalBranch || taskSettings.branchPrefix !== settings.branchPrefix ||
            taskSettings.taskStateDir !== settings.taskStateDir) {
          addIssue(check, 'task_policy_mismatch', 'Task binding differs from the selected repository policy.');
        }
        verifyCommittedProjectStructure(root, taskSettings, check);
        verifyCommittedTaskState(root, taskSettings, check);
        if (!task.base || !isAncestor(root, task.base, head) || !isAncestor(root, task.base, report.remoteHead)) {
          addIssue(check, 'base_not_canonical', 'Task baseline is not shared with the canonical branch.');
        }
        task.issues = check.issues;
        task.valid = task.issues.length === 0;
      } catch {
        task.issues.push({ code: 'task_record_invalid', message: 'Task record or binding cannot be parsed.' });
      }
    } else {
      task.status = 'unrecorded';
      task.title = branch;
      task.issues.push({ code: 'task_state_missing', message: 'No committed task record on this branch.' });
    }
    if (options.all || (!merged && task.status !== 'complete')) report.tasks.push(task);
  }
  const active = report.tasks.filter((task) => !task.merged && task.status !== 'complete');
  // An invalid/unrecorded alternative still creates ambiguity; never silently ignore it.
  report.suggestedTask = active.length === 1 && active[0].valid ? active[0].branch : null;
  report.ok = report.issues.length === 0;
  return report;
}

function resumeTask(root, settings, options) {
  const current = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).stdout;
  if (!options.task && !options.worktree && current !== settings.canonicalBranch) {
    return inspect(root, settings, 'resume', options.base);
  }
  const discovery = listTasks(root, settings, { ...options, all: true });
  discovery.command = 'resume';
  if (!discovery.ok) return discovery;
  const active = discovery.tasks.filter((task) => !task.merged && task.status !== 'complete');
  const matches = options.task
    ? discovery.tasks.filter((task) => task.branch === options.task || task.id === options.task)
    : active;
  if (matches.length !== 1) {
    addIssue(discovery, 'task_selection_required', 'Select one remote task with --task ID_OR_BRANCH; no worktree was changed.');
    discovery.ok = false;
    return discovery;
  }
  const task = matches[0];
  discovery.selectedTask = task;
  if (!task.valid) {
    addIssue(discovery, 'selected_task_invalid', 'The selected task has unresolved synchronization issues; repair its record before resume.');
    discovery.ok = false;
    return discovery;
  }
  if (options.base && resolveCommit(root, options.base) !== task.base) {
    addIssue(discovery, 'task_state_base', '--base differs from the selected remote task record.');
    discovery.ok = false;
    return discovery;
  }
  if (current === task.branch && !options.worktree) return inspect(root, settings, 'resume', task.base);
  if (!options.worktree) {
    addIssue(discovery, 'worktree_required', 'Provide --worktree PATH to resume without switching or overwriting the current checkout.');
    discovery.ok = false;
    return discovery;
  }
  const path = physicalPath(options.worktree);
  const worktrees = git(root, ['worktree', 'list', '--porcelain', '-z']);
  if (!worktrees.ok) throw new Error('Cannot inspect existing worktree ownership.');
  const roots = worktrees.raw.split('\0').filter((part) => part.startsWith('worktree '))
    .map((part) => physicalPath(part.slice('worktree '.length)));
  if (roots.some((work) => path === work || path.startsWith(`${work}/`)) || existsSync(path)) {
    throw new Error('Resume requires a new isolated worktree path outside the current checkout.');
  }
  const latest = remoteBranchSha(root, settings.remoteName, task.branch);
  if (!latest.ok || latest.sha !== task.head) {
    addIssue(discovery, 'task_snapshot_changed', 'The selected remote task changed during discovery; rerun resume.');
    discovery.ok = false;
    return discovery;
  }
  const existing = resolveCommit(root, `refs/heads/${task.branch}`);
  if (existing && existing !== task.head) throw new Error('The local task branch differs from the selected remote commit; preserve it and reconcile first.');
  const added = git(root, ['worktree', 'add', ...(existing ? [] : ['-b', task.branch]), path, existing ? task.branch : task.head]);
  if (!added.ok) throw new Error('Cannot create the isolated worktree; the branch may already be owned by another worktree. No branch was reset.');
  const resumedSettings = settingsFor(path, options);
  const result = inspect(path, resumedSettings, 'resume', task.base);
  result.selectedTask = task;
  result.resumedWorktree = path;
  return result;
}

function initializeTask(root, settings, options) {
  const report = inspect(root, settings, 'task-init', options.base);
  if (!report.ok) return { report, changed: [] };
  const relativePath = taskStatePath(settings, report.localBranch);
  const absolutePath = join(root, ...relativePath.split('/'));
  assertManagedFile(root, absolutePath);
  if (existsSync(absolutePath)) {
    throw new Error(`Task continuity record already exists: ${relativePath}`);
  }
  const changed = [];
  writeIfChanged(absolutePath, taskStateTemplate(report.localBranch, report.base, options.title), changed);
  report.taskStateFile = relativePath;
  report.taskStatus = 'in-progress';
  return { report, changed };
}

function printReport(report, json, changed = []) {
  const relativeChanged = changed.map((path) => path.startsWith(`${report.repository}/`)
    ? path.slice(report.repository.length + 1)
    : path);
  if (json) {
    console.log(JSON.stringify({ ...report, changedFiles: relativeChanged }, null, 2));
  } else {
    console.log(`Git project sync: ${report.ok ? 'PASS' : 'BLOCKED'} (${report.command})`);
    console.log(`repository: ${report.repository}`);
    console.log(`configured remote: ${report.expectedRemote}`);
    console.log(`checkout remote: ${report.normalizedCheckoutRemote ?? 'unknown'}`);
    console.log(`push remote: ${report.normalizedPushRemote ?? 'unknown'}`);
    console.log(`branch: ${report.localBranch ?? 'unknown'}`);
    console.log(`head: ${report.head ?? 'unknown'}`);
    console.log(`canonical ${report.canonicalBranch}: ${report.remoteHead ?? 'unverified'}`);
    console.log(`relation: ${report.relationToRemoteHead}`);
    console.log(`worktree: ${report.worktreeClean === true ? 'clean' : report.worktreeClean === false ? 'dirty' : 'unknown'}`);
    if (report.base) console.log(`base: ${report.base}`);
    if (report.remoteTaskHead) console.log(`remote task head: ${report.remoteTaskHead}`);
    if (report.taskStateFile) console.log(`task state: ${report.taskStateFile}`);
    if (report.taskStatus) console.log(`task status: ${report.taskStatus}`);
    if (report.projectMap) console.log(`project map: ${report.projectMap}`);
    if (report.projectPlan) console.log(`project plan: ${report.projectPlan}`);
    if (report.sourceDigest) console.log(`source digest: ${report.sourceDigest}`);
    if (report.synchronized !== undefined) console.log(`synchronized: ${report.synchronized}`);
    if (report.resumedWorktree) console.log(`resumed worktree: ${report.resumedWorktree}`);
    for (const task of report.tasks ?? []) {
      console.log(`TASK ${task.id ?? task.branch} [${task.status}] ${task.title} (${task.valid ? 'valid' : 'needs repair'})`);
      console.log(`  branch: ${task.branch}; head: ${task.head}; record: ${task.taskStateFile}`);
      if (task.nextStep) console.log(`  next: ${task.nextStep.replace(/\s+/g, ' ')}`);
      for (const issue of task.issues) console.log(`  ISSUE ${issue.code}: ${issue.message}`);
    }
    for (const path of relativeChanged) console.log(`CHANGED ${path}`);
    for (const warning of report.warnings) console.log(`WARNING ${warning.code}: ${warning.message}`);
    for (const issue of report.issues) console.log(`BLOCKER ${issue.code}: ${issue.message}`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const root = gitRoot(options.repo);
    if (['bind', 'adopt'].includes(options.command)) {
      const result = bindProject(root, options);
      printReport(result.report, options.json, result.changed);
      return;
    }
    const settings = settingsFor(root, options);
    if (options.command === 'save') {
      const result = saveTask(root, settings, options);
      printReport(result.report, options.json, result.changed);
      return;
    }
    if (options.command === 'list' || options.command === 'resume') {
      const report = options.command === 'list' ? listTasks(root, settings, options) : resumeTask(root, settings, options);
      printReport(report, options.json);
      return;
    }
    if (options.command === 'task-init') {
      const result = initializeTask(root, settings, options);
      printReport(result.report, options.json, result.changed);
      return;
    }
    const report = inspect(root, settings, options.command, options.base);
    printReport(report, options.json);
  } catch (error) {
    console.error(`Git project sync: ERROR\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

main();
