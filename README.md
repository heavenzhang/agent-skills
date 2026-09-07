# Codex Skills

Personal Codex skills for syncing across machines.

## Included Skills

- `handoff-sync`: Maintain `codex-handoff.md` so Codex can hand off project context across Mac, Windows, synced folders, Git branches, or fresh threads.
- [`dev-team`](dev-team/SKILL.md): Choose cost-aware single-agent or parallel software development, route models by task difficulty, share fingerprint-validated file summaries, and iterate repairs until primary-agent acceptance passes.

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
