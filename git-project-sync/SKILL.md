---
name: git-project-sync
description: Coordinate continuous development across agents, chats, machines, and worktrees using a user-supplied Git repository URL, committed project map, shared plan, and task handoffs. Let development chats commit independently; each deployment unit has one owning chat, and independent units may have different owners. Use when binding, starting, resuming, handing off, integrating, or coordinating deployment ownership. Does not grant deployment authorization or store runtime data or secrets.
---

# Git Project Sync

Coordinate continuous development through remote refs, immutable commit SHAs, and a task record committed with the code. Chat history may explain work, but another agent must be able to continue from Git alone.

Development chats may commit and push independently within their assigned scope. Each deployment unit has one designated chat/thread responsible for its CI coordination, builds, releases, verification, and rollback. Independently deployable units, such as a website service and a client, may have different owners; one chat may own several units. Later code changes for the same unit continue through its existing owner. Integration ownership and deployment ownership are separate roles; this rule does not require one deployment chat or one branch for the whole project.

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

The map names the actual source, test, specification, architecture/decision, operations, release, and asset locations. Existing projects retain their own directory layout; do not move code or create empty directories merely to match examples. If a category does not apply, say so in the map. The plan records scope, milestones, priorities, dependencies, acceptance evidence, unresolved decisions, and the deployment-unit ownership map. Task records hold branch-specific progress, deployment requests, and next actions; they do not replace the shared plan. Avoid duplicating a full design or test log across all three files: link to the committed authoritative file and SHA where useful.

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

When adopting deployment coordination in an existing project, add the per-unit ownership fields below to its preserved plan and route active deployment requests to the affected units. Existing single-chat plans remain valid for the scope that chat already owns; preserve that assignment, and record explicit unit mappings when splitting responsibilities. Refreshing the skill does not migrate custom plans, change CI/CD, or designate or transfer owners automatically.

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

Merging, releasing, deploying, migrating data, and changing production require their applicable authorization and acceptance evidence. Reuse existing authorization within its scope; designation of a deployment chat alone grants no new permissions. A developer may finish its authorized main-branch delivery while deployment remains queued with the affected unit owners.

## One owning chat per deployment unit

### Unit boundaries and ownership

A deployment unit is one endpoint or an inseparable set of code and artifacts that must be built, released, verified, and rolled back together. A website service and a client that can be released and rolled back independently may be separate units with different owners. A shared repository does not force one owner; different directories or branches alone do not prove independence. Treat code that requires a simultaneous switch or cannot be rolled back separately as one unit.

Before changing a deployment target, verify the affected unit's ownership under `Deployment coordination` in the latest canonical `.agent-sync/plan.md`. For each unit, record:

- **Unit and scope:** stable unit ID, code/artifact boundaries, environments/services, and dependencies on other units or shared resources. Mark deployment `not applicable` when the project has no deployable target.
- **CI/deployment chat:** exactly one stable chat/thread ID and, when available, its link; a display title alone is insufficient. The same owner may cover several units.
- **Designation:** the user instruction or authorized project decision assigning that owner and scope. Reuse verified existing ownership; do not assume the current chat owns a unit. Create or message another chat only with the required user authorization.
- **Runbook and version rules:** CI/build/deployment triggers, release-record location, concurrency controls, version allocation, and compatibility or ordering requirements.
- **Current release:** this unit's release ID, status, pinned candidate SHA/artifact digest, included tasks, and evidence or next action. Use `idle` when no release is active.

The canonical record takes precedence over an older task-branch plan. All later work on that unit, regardless of which development chat wrote it, is handed to its recorded owner. Missing, conflicting, or unverifiable ownership pauses CI/deployment actions for that unit and dependent releases; continue development, Git handoff, and unrelated independent units. Request only the missing assignment or decision.

The unit owner coordinates its shared CI, builds, migrations, deployment, verification, and rollback. Other chats may develop, run local checks, commit, and hand off, but must not independently trigger that unit's shared CI/release workflow, publish its artifacts, restart its services, or switch its versions. They may deploy a different unit they are designated to own. Identify existing automatic push/merge triggers and route target-changing actions through the affected owners under the authorized workflow. Do not silently change CI/CD or claim the Git record enforces runtime ownership.

### Requests and cross-unit coordination

Each development chat commits deployment requests in its own task record and reports the record path and immutable remote head SHA. Include:

- Affected unit IDs, required/not required/undecided status for each, target environments, and intended user-visible changes.
- Branch, task record, and test evidence. Report the head SHA outside the file; the owner resolves the integrated candidate SHA before releasing.
- Cross-unit dependencies, interface compatibility, shared configuration/data migrations, release order, rollback constraints, and the owner receiving each request. Reference authorized credential locations without secret values.
- Separate code/main-delivery, per-unit deployment, and production-acceptance states. `Ready for deployment` does not mean deployed; a partial rollout is not whole-task acceptance.

Each owner consolidates accepted requests into batches for its unit. For a cross-unit change, coordinate compatibility, order, and rollback among the affected owners; designate one executor for shared integration CI or a shared migration instead of running it from several chats. Independent units may release concurrently. Jobs that affect a shared target or resource must use the existing lock/concurrency mechanism and must not overlap unsafely. This does not require a permanent project-wide deployment owner.

A queued request does not notify or wake its owner. Without authorization to message that chat, provide the durable handoff location and do not claim the owner was notified.

### Unit releases, versions, and ownership transfer

The owner selects a unit's batch and pins a verified candidate commit plus artifact identity. Check that the batch includes the promised tasks and dependencies; list exclusions or unmet dependencies. Recheck scope/ownership, target state, active jobs, acceptance evidence, backup, and rollback readiness before execution. Later commits do not silently join a frozen batch; a changed candidate needs its affected CI revalidated. Track each unit through `queued → preparing → deploying → verifying → accepted`, with `blocked`, `failed`, or `rolled-back` when applicable. Finish or explicitly stop an overlapping release before starting the next.

Follow the project's established version rules. Independently versioned units retain their sequences; when units share a version number, record one allocator to prevent competing increments. In the absence of a rule, use `MAJOR.MINOR.PATCH` and `-rc.N` candidates. Development chats identify their changes by SHA rather than assigning competing formal versions. Joint releases map each unit's version, SHA, and artifact in a shared batch record.

Record unit ID/owner, version/tag, complete SHA, artifact digest, included tasks, environment, CI/job references, user-path acceptance, and rollback target/outcome. Do not overwrite published version/tag identities with different code or artifacts. Promote the same verified artifact from test to production; record a new candidate/build/version for a different artifact. Build success, merge success, or HTTP 200 alone does not establish production acceptance.

A Git plan is not an atomic lock. If overlapping execution for a target/resource cannot be ruled out, pause those target-changing actions while reconciling owners and jobs; independent units may continue. These Git gates do not inspect live deployment state or enforce unit boundaries or chat identity.

If a unit owner is unavailable, leave its requests queued and continue independent work. Transfer only that unit through an explicit user instruction or authorized project decision: reconcile its active release/jobs first, record the new owner and scope in the canonical plan, and have the replacement verify it before acting. Never infer takeover from silence or change other units' owners as a side effect.

### Existing project plans

Preserve existing plans and task records during `bind --update --refresh-skill`. A legacy `Deployment chat` assignment remains the owner of its previously designated scope; it is not an obstacle to adding independently owned units. Before a new split is used, record each affected unit and owner, reconcile active jobs and shared dependencies, and retain existing assignments that were not transferred. The command updates the vendored skill and managed instructions, not custom deployment plans, pipelines, or real chat permissions.

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
