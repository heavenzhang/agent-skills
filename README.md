# Codex Skills

Personal Codex skills for syncing across machines.

## Included Skills

- `handoff-sync`: Maintain `codex-handoff.md` so Codex can hand off project context across Mac, Windows, synced folders, Git branches, or fresh threads.
- [`dev-team`](dev-team/SKILL.md): Choose cost-aware single-agent or parallel software development, route models by task difficulty, share fingerprint-validated file summaries, and iterate repairs until primary-agent acceptance passes.

Migrated from `SomeSkills4Agents/skills/` (2026-10-03):

- [`ai-yaoren`](ai-yaoren/SKILL.md): Orchestrate a hybrid AI team from AIRouter-preferred external models and Codex-native models; invoke with `$ai-yaoren`.
- [`ai-yaoren-local`](ai-yaoren-local/SKILL.md): Organize Codex-native agents for cost-aware software delivery; invoke with `$ai-yaoren-local`.
- [`everyday-visual-design`](everyday-visual-design/SKILL.md): Create or review visual arrangement of text and images based on four design principles, typography, and color.
- [`git-project-sync`](git-project-sync/SKILL.md): Use an explicitly supplied Git repository as the durable record for continuous development across agents, threads, machines, or worktrees. Development chats commit independently; each deployment unit has one owning chat for CI coordination, release batches, deployment, verification, and rollback. Independently deployable units may have different owners.
- [`mori-dispatch`](mori-dispatch/SKILL.md): Dispatch tasks to Mori digital employees via verified MCP or HTTP API channels, with user-driven employee selection.

## Using dev-team

Install the `dev-team` folder with the same copy/link procedure below, replacing `handoff-sync` with `dev-team`. Keep its `agents`, `references`, and `scripts` subdirectories together. Then invoke:

```text
Use $dev-team to implement this feature and verify it against the acceptance criteria.
```

The primary chooses whether delegation is worthwhile. Architecture and high-risk acceptance prefer GPT-6 Astra; bounded workers use suitable GPT-5.6 variants when the runtime supports them. Model switching and concurrency depend on the actual host capabilities; the skill does not change your global model settings or guarantee a switch.

Every task ends with a [collaboration execution report and retrospective](dev-team/references/execution-report.md), including single-agent tasks. It records the actual participants, requested or runtime-confirmed models and reasoning efforts, responsibilities, acceptance and repair results, available efficiency evidence, and a concrete lesson for future work. Missing model/usage information stays explicitly unknown.

The optional shared-context tool uses Python 3.9+ with the standard library, including SQLite. It stores compact summaries and source/dependency fingerprints under the user's `.codex/cache/dev-team/` directory, isolated by project root. Runtime caches, logs, credentials, session histories, and user-level Codex configuration are not included in this repository. See [shared context](dev-team/references/shared-context.md) and [lean execution](dev-team/references/lean-execution.md) for the scoped workflow and limitations.

Run the included cache tests from the repository root:

```bash
python3 dev-team/scripts/test_context_cache.py
```

On Windows, use `python` or `py -3` instead of `python3` if needed. The tests exercise POSIX-specific FIFO and symlink behavior and have been verified on macOS; Windows behavior has not been validated. Invoking the skill does not itself authorize deployment, publishing, or business-data writes. External projects are referenced as design inspiration, not bundled dependencies; no fixed token-savings percentage is claimed.

## Install On macOS

Copy or link a skill folder into:

```text
~/.codex/skills/
```

Example:

```bash
mkdir -p ~/.codex/skills
cp -R handoff-sync ~/.codex/skills/handoff-sync
```

## Install On Windows

Copy a skill folder into:

```text
C:\Users\<you>\.codex\skills\
```

Example in PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force .\handoff-sync "$env:USERPROFILE\.codex\skills\handoff-sync"
```

Restart Codex or start a new thread after adding or updating skills.
