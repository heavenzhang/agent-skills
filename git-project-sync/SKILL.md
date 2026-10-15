---
name: git-project-sync
description: Coordinate continuous development across agents, chats, machines, and worktrees using a user-supplied Git repository URL, committed project map, shared plan, and task handoffs. Let development chats commit independently while one designated deployment chat owns releases. Use when binding, starting, resuming, handing off, integrating, or coordinating deployment ownership. Does not grant deployment authorization or store runtime data or secrets.
---

# Git Project Sync

Coordinate continuous development through remote refs, immutable commit SHAs, and a task record committed with the code. Chat history may explain work, but another agent must be able to continue from Git alone.

Development chats may commit and push independently within their assigned scope. Every project that deploys must designate one dedicated deployment chat; only that chat executes deployments. Integration ownership and deployment ownership are separate roles.

## Required Git destination

Before using this skill for a project, obtain the Git repository address explicitly supplied by the user. Reuse that address during the task, including every `project-sync.mjs` command via `--remote <git-url>`. If no address has been supplied, ask for it before binding, starting, resuming, or handing off. Do not select a destination from `origin`, `.agent-sync.json`, the current directory, or a handoff note on the user's behalf.

The tool checks that the supplied address matches the committed `.agent-sync.json` and the checkout's fetch and push URLs. The address names the repository where code and task records must be committed and pushed; a local commit alone is not a saved remote handoff.

## What this skill guarantees

When its gates pass, another agent can fetch the named branch and obtain the same committed project artifacts. It does not provide real-time locking, merge correctness, deployment approval, secret distribution, database replication, or synchronization of ignored/generated files.

The durable synchronization unit is:

```text
canonical Git URL + canonical branch + base SHA + task branch + head SHA + committed task record
```

## Project structure and reading order

Keep these paths in the same Git repository as the project code:

```text
AGENTS.md                              agent instructions and constraints
.agent-sync.json                       Git destination and branch policy
.agent-sync/project-map.md             authoritative navigation map
.agent-sync/plan.md                    shared development plan and milestones
.agent-sync/tasks/<branch-record>.md   one handoff record per task branch
.agents/skills/git-project-sync/       vendored skill and gate script
```

The map names the actual source, test, specification, architecture/decision, operations, release, and asset locations. Existing projects retain their own directory layout; do not move code or create empty directories merely to match examples. If a category does not apply, say so in the map. The plan records scope, milestones, priorities, dependencies, acceptance evidence, unresolved decisions, and the designated deployment chat. Task records hold branch-specific progress, deployment requests, and next actions; they do not replace the shared plan. Avoid duplicating a full design or test log across all three files: link to the committed authoritative file and SHA where useful.

For a fresh or resumed task, read the map, plan, and current branch's task record, in that order. Then inspect the named code, tests, and evidence and verify the recorded base/head against the supplied Git destination. If the map, plan, or task record is stale or incomplete, update it in the appropriate branch before claiming a complete handoff.

## Bind a project

Use the Git URL supplied by the user. Never invent a repository or silently substitute a fork.

For an existing checkout, verify that its configured remote identifies the same repository. For a new checkout, clone the supplied URL using the user's existing Git credentials; do not embed credentials in a URL.

Bind from a clean branch or worktree whose `HEAD` equals the current canonical remote head:

```bash
node <skill-root>/scripts/project-sync.mjs bind \
  --repo <project-path> \
  --remote <git-url> \
  --canonical-branch main \
  --branch-prefix codex/
```

Binding adds these versioned project resources:

- `.agent-sync.json`: repository identity and branch policy.
- `.agent-sync/project-map.md`: where each category of project knowledge and code lives.
- `.agent-sync/plan.md`: project-wide outcome, milestones, priorities, and acceptance gates.
- `.agents/skills/git-project-sync/`: a vendored copy of this skill so a fresh clone carries the protocol.
- A managed block in `AGENTS.md` telling compatible agents to load the vendored skill.
- `.agent-sync/tasks/`: branch-specific task continuity records created as work begins.

`bind` creates the map and plan as scaffolds without overwriting existing files. Fill their real project locations, goals, and gates, remove both `scaffold=true` markers, and review the result. The gate checks that completed versions are in `HEAD`; it cannot judge the semantic quality of the text, so the integration owner must review it. Commit and push the setup branch, then integrate it into the canonical branch. They do not become the project's shared protocol until merged. `bind` never commits, pushes, opens a pull request, merges, or deploys.

Use `--update` only to change an existing config deliberately. To adopt this structure in a previously bound project, first verify a clean setup branch at the canonical remote head, then run `bind --update --refresh-skill --remote <git-url>`. This preserves existing custom map/plan contents and non-managed `AGENTS.md` content; review and commit the generated changes. Legacy bindings without `structureVersion` continue with a warning until adopted. Use `--refresh-skill` only to replace the managed vendored skill with this installed version.

When adopting deployment coordination in an existing project, add the deployment ownership fields below to its preserved plan and deployment requests to active task records where needed. Refreshing the skill does not migrate custom plans, change CI/CD, or designate a chat automatically.

## Categorize and save project work

GitHub is the remote view of the named Git repository, not a second source of truth. Use the map to classify each file and put it in the project's existing appropriate location:

| Category | Save and update |
| --- | --- |
| Source and tests | Product code, test cases, fixtures, and build configuration in mapped source/test paths |
| Requirements and decisions | Specifications, architecture, and decision records in mapped documentation paths |
| Shared plan | `.agent-sync/plan.md`, updated by the integration owner when milestones, priorities, or acceptance gates change |
| Task handoff | `.agent-sync/tasks/`, updated with the task branch's code and verification |
| Operations and release | Non-secret runbooks, release notes, migration plans, and validation evidence in mapped paths |
| Assets and large outputs | Version only suitable source assets; put large/generated outputs in an approved external store and link their non-secret location and digest |

Do not commit credentials, tokens, cookies, private keys, local databases, caches, build outputs, or machine-only state. Project records can name how authorized agents obtain required access, but must not contain the access material. If a file belongs in another repository, record its explicit URL and revision in the map; do not imply it was saved to this Git destination.

Before pushing a task branch, stage only the intended paths (including its task record and any changed plan/map), review `git diff --cached --name-status` and `git diff --cached --check`, commit, and push to the configured remote. Avoid blanket `git add .` when unrelated user changes may be present. Run the handoff gate against that remote after pushing. The integration owner reviews each category and updates shared map/plan entries when integrating; a pull request or GitHub upload alone does not prove the project is current or deployable.

## Start an agent task

Read `.agent-sync.json` and the committed map and plan, then run the read-only observation gate:

```bash
node .agents/skills/git-project-sync/scripts/project-sync.mjs observe \
  --repo <project-path> --remote <git-url>
```

Fetch the configured remote and canonical branch. Create a unique task branch and isolated worktree from the verified remote SHA; never let two writing agents share a worktree.

```bash
git fetch --prune <remote-name> <canonical-branch>
git worktree add -b <branch-prefix><task-id> <isolated-path> <remote-name>/<canonical-branch>
node .agents/skills/git-project-sync/scripts/project-sync.mjs start \
  --repo <isolated-path> \
  --remote <git-url> \
  --base <full-canonical-sha>
```

After the start gate passes, create the branch-specific continuity record:

```bash
node .agents/skills/git-project-sync/scripts/project-sync.mjs task-init \
  --repo <isolated-path> \
  --remote <git-url> \
  --base <full-canonical-sha> \
  --title "<task outcome>"
```

Replace the scaffold with the real objective, acceptance criteria, completed work, verification, blockers, and one concrete next step. Remove `scaffold=true`, then commit the record with the task changes. The record path is derived from the branch, so parallel branches do not overwrite one another.

The coordinator assigns branch ownership, write scope, dependencies, and the integration owner before parallel edits. Treat dirty or unpushed work from another worktree as belonging to another task unless the user explicitly reassigns it. Do not copy, stash, reset, overwrite, or commit it.

## Work and handoff

- Commit coherent project artifacts and tests on the task branch.
- Keep secrets, credentials, cookies, private keys, local databases, caches, build output, and machine-only state out of Git.
- Keep the committed task continuity record current. It carries the objective, acceptance criteria, completed scope, verification evidence, blockers, unknowns, and next action across agents.
- Record the resulting head SHA and remote branch in the task report or pull request; do not place the head SHA inside the task file because committing it would change the SHA again.
- Do not claim a handoff is synchronized until the task branch exists on the configured remote at the same head SHA.
- After handoff, do not rewrite published history or force-push. Add commits or create a new branch.

Verify handoff:

```bash
node .agents/skills/git-project-sync/scripts/project-sync.mjs handoff \
  --repo <task-worktree> \
  --remote <git-url> \
  --base <full-base-sha>
```

The handoff gate verifies both the remote branch SHA and the committed task record. If pushing is not authorized, stop after the local commit and report `local only — not synchronized to the remote`. Request authority for the exact branch; do not describe the remote handoff as complete.

## Resume another agent's task

Fetch the exact remote task branch into a new clean worktree. Read its project map, shared plan, and `.agent-sync/tasks/` record, then run:

```bash
node .agents/skills/git-project-sync/scripts/project-sync.mjs resume \
  --repo <new-worktree> \
  --remote <git-url> \
  --base <recorded-base-sha>
```

Continue from the recorded next step unless the user gives a newer instruction. Review the entire `base..HEAD` diff and rerun risk-relevant tests. A clean synchronization check proves identity and transport, not implementation quality.

## Integrate

Only the designated integration owner integrates task branches. Verify the reviewed remote head SHA immediately before integration, incorporate the current canonical branch deliberately, resolve conflicts through source review, and rerun affected tests. Never force-push the canonical branch.

Merging, releasing, deploying, migrating data, and changing production require their applicable authorization and acceptance evidence. Reuse existing authorization within its scope; designation of a deployment chat alone grants no new permissions. A developer may finish its authorized main-branch delivery while deployment remains queued with the designated chat.

## One dedicated deployment chat

### Designation and authority

Before the first deployment, record these fields under `Deployment coordination` in `.agent-sync/plan.md` and integrate them into the canonical branch:

- **Deployment chat:** stable chat/thread ID and, when available, its link; a display title alone is insufficient.
- **Designation:** who assigned the chat and the instruction or decision supporting that assignment. Use a chat explicitly selected by the user or assigned under the project's existing coordination authority. Do not assume the current chat owns deployment. Create or message another chat only with the required user authorization.
- **Targets and runbook:** environments/services covered, deployment workflow, release-record location, and any existing CI/CD concurrency mechanism. Mark deployment `not applicable` for projects with no deployable target.
- **Current release:** release ID, status, pinned candidate SHA/artifact digest, and evidence or next action. Use `idle` when no release is active.

The latest verified canonical-branch record is authoritative, even when a task branch carries an older plan. Check it when starting/resuming release-related work and again before changing a target. If the designation is absent, conflicting, or cannot be verified, continue development and Git handoff but stop deployment. Request only the missing designation or decision.

The designated chat handles deployment preparation, execution, migrations, rollout, verification, and rollback for the recorded targets. It may commit release records or deployment fixes under the normal branch/integration rules. Other chats must not independently publish artifacts, restart services, switch production versions, run migrations or rollbacks, or trigger deployment workflows. Existing automatic deployments must also respect this ownership: identify merge/push triggers before integration, and route deployment-triggering actions through the designated chat using the authorized release mechanism. Do not silently change CI/CD or claim centralization is enforced merely by this document.

### Development-to-deployment handoff

Each development chat records its deployment request in its own task record, commits and pushes it, and reports the record path and resulting remote head SHA. Include:

- Deployment required, not required, or undecided; target environment/service and intended user-visible change.
- Remote branch and task record; report the immutable head SHA outside the file as usual. The deployment chat resolves the corresponding integrated canonical SHA before release.
- Test evidence, dependencies and ordering, configuration/migration requirements, and risks or rollback constraints. Reference authorized credential locations without secret values.
- Separate code/main-delivery status from deployment and production-acceptance status. `Ready for deployment` does not mean deployed.

Developers keep unrelated task records separate; the deployment chat consolidates accepted requests into a release batch in the mapped release-record location. A queued request does not itself notify or wake another chat. Without authorization to message it, provide the durable handoff location to the user and do not claim the chat was notified.

### Serialized release and ownership transfer

The deployment chat selects the batch and pins a verified canonical commit plus artifact identity. Recheck ownership, target state, active jobs, acceptance evidence, backup, and rollback readiness before execution. Later commits do not silently join that batch. Use `queued → preparing → deploying → verifying → accepted`, with `blocked`, `failed`, or `rolled-back` recorded when applicable. Complete or explicitly stop the current release before starting another that can affect the same targets.

Use the project's existing deployment lock or CI/CD concurrency control where available. A Git plan is a durable coordination record, not an atomic lock; if overlapping execution cannot be ruled out, stop target-changing actions until ownership and active jobs are reconciled. These Git gates do not inspect live deployment state or enforce deployment-chat identity.

Record the deployed SHA/version and artifact digest, environment, job/run reference, verification of the real user path, and rollback outcome where relevant. Build success, merge success, or HTTP 200 alone does not establish production acceptance. Update the shared release status and link evidence back to the included task records.

If the deployment chat is unavailable, leave requests queued and continue independent development. Transfer ownership only through an explicit user instruction or authorized project decision: reconcile any active release/job first, record the replacement chat and transfer in the canonical plan, and have the replacement verify that record before acting. Never let two chats deploy during a transfer or infer a takeover from silence.

## Stop conditions

Stop and report the exact mismatch when:

- The checkout fetch or push URL differs from the supplied Git destination or project config.
- The user has not supplied a Git URL for this project, or a command omits `--remote`.
- The canonical remote head cannot be verified.
- A canonical/shared worktree is dirty or does not match the remote head.
- A task branch has the wrong prefix, base SHA, or ancestry.
- The committed project map or plan is missing or still a scaffold in a structure-enabled project.
- A remote task branch is missing or resolves to a different head SHA.
- Ownership of existing local changes is unclear.

Do not repair these conditions with destructive cleanup, `reset --hard`, checkout-overwrite, or force-push.
