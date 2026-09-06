# Lean execution and evidence

Read when large tool results or multi-wave delivery justify output reduction and a small progress ledger. These are original adaptations of useful public workflow patterns, not a requirement to install another package or enforce a new review layer.

## Preprocess before asking a model

Use deterministic tools for file discovery, symbol/count extraction, structured-field selection, formatting, hashing, and duplicate-log grouping. Start with bounded paths and relevant keywords; do not scan every repository or import all results into the model. Delegate interpretation only after extracting the relevant evidence. Do not spawn Luna for a task one cheap local command can finish adequately.

For a noisy test, build, or search result:

1. Retain the command's real exit status and the relevant execution context.
2. Emit a compact result: command/check identity, pass/fail/unknown, counts where trustworthy, and actionable error excerpts with locations.
3. If more evidence is needed, retain a task-authorized local log and point to it; do not persist secret-bearing output just to improve observability. Fetch the relevant range on demand.
4. Mark omitted output and preserve access to the evidence. A tail/head filter, success-looking line, or empty excerpt cannot turn a failing command into a pass. When using pipelines, preserve the tested command's status rather than reporting only the filter's exit code.

Group repeated errors for orientation but retain representative evidence and counts. Keep genuinely distinct failures separate. Do not deduplicate nondeterministic runtime observations as if they were immutable file content. Do not treat a process sandbox as making otherwise unauthorized commands safe.

## Compact dispatch and results

A work package carries its objective, exclusive ownership, necessary interface constraints, relevant shared-context keys, and observable acceptance checks. Include sufficient source context to implement correctly, not a full parent transcript. Prefer source references and actual patches/artifacts over embedding complete files in both instructions and replies.

Workers return a short record with these fields:

```text
status: review-ready | blocked | needs-decision
result: concrete outcome and changed files/artifacts
checks: executed checks, outcomes, revision/environment, evidence locations
open: assumptions, failures, unresolved decisions, or none
usage: runtime-reported model/effort and usage if available; otherwise unknown
```

Keep ordinary returns to a few short paragraphs. This is a relevance target, not a hard truncation rule: never drop a defect, uncertainty, or required evidence to meet a length limit. Expanded logs remain on demand. Claims requiring an exact source must point to that source. The primary verifies consequential claims rather than accepting a terse summary on confidence alone.

During iteration, send changed requirements, current diffs, stale context keys, and new failed checks. Avoid repeated plan summaries, unchanged status polls, or copying artifacts that are already accessible. Use the runtime's supported completion notifications or bounded waits. Preserve necessary user-facing progress and promptly surface blockers.

## Small progress and usage ledger

For a substantial multi-wave task, keep one primary-owned record in the existing task plan or handoff artifact. Use a task-specific local scratch file outside the repository only when durable recovery adds value. Do not create a database or dashboard for routine work, and do not use the persistent user-memory directory for operational records.

Record one row per work package, updating at dispatch, returned work, repair, and acceptance boundaries:

| Field | Meaning |
| --- | --- |
| package / owner | Stable package key and actual worker identifier, or primary |
| state / dependencies | Ready, active, review-ready, repairing, accepted, or blocked; prerequisites |
| scope / evidence | Owned files, artifact or diff locations, revision and relevant environment |
| model / effort | Runtime-confirmed values; otherwise requested values labeled as requested |
| acceptance / repairs | Check outcomes, unresolved issues, and repair rounds |
| elapsed / usage | Actual observed duration and exposed usage, with provenance and measurement scope |

Leave missing usage unknown, never zero. Keep cumulative counters separate from per-call increments; do not add parent totals that already include child usage to the child totals again. Store only non-secret derived metrics. If no trustworthy usage feed is available, track readily observable outcomes and label cache character counts or prompt-size estimates as proxies. Do not import full Codex session logs or scan unrelated histories to fill this gap.

Report monetary cost only if both applicable current rates and usage accounting are established, distinguishing input, cached input, output, and reasoning where the provider reports them. Subscription/product-usage measures are not automatically an API bill. Include curator, coordination, review, and repair work when comparing modes. Do not extrapolate an external project's benchmark percentage onto this task.

Use a user-specified budget when provided. Otherwise, repeated failures or growing context should trigger a brief reassessment of scope, decomposition, and model choice, not an invented spending cap or a claim of success. Reuse valid artifacts before rerunning work. Keep required acceptance checks open if an actual budget or external constraint prevents completion.

## Review once at the appropriate scope

At review, check two dimensions: did the implementation satisfy the agreed behavior, and is the implementation correct and maintainable for this scope? The primary can cover both in one review. Add another reviewer only if independence is likely to improve the result enough to justify its context and execution cost.

Run focused checks during implementation and integration checks on the combined result. Reuse unchanged evidence only while its code, dependencies, configuration, test data, and relevant environment remain valid. Source hashes alone cannot validate live system state. Once required checks pass, repeat them only for a new change, failure, missing evidence, or an explicit release requirement. Do not weaken tests, remove failed assertions, or replace actual acceptance with another model's opinion to save tokens.

## Reference provenance and exclusions

Patterns reviewed on 2026-09-07:

- [AOC](https://github.com/ZypherHQ/agent-orchestration-skill): a bounded primary/worker structure and explicit distinction between measured usage and estimated orchestration overhead. Adapted as a small task record; no npm installation, full-session importer, GUI, or extra coordinator.
- [Context Mode](https://github.com/mksglu/context-mode): process data with code and return selected results. Adapted using existing authorized tools; no copied source implementation, mandatory MCP routing, hook interception, hosted analytics, or assumed benchmark savings.
- [Superpowers subagent-driven development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md): self-contained briefs, requirement/quality review, and evidence before completion. Adapted without mandatory fresh workers, repeated approval checkpoints, universal TDD/review ceremony, or workflow-implied publication authority.
- [Fable](https://github.com/darrenoakey/skill-fable/blob/main/SKILL.md): concise source-bearing returns and checking existing artifacts before replacing a worker. Adapted without personal absolute paths, special model assumptions, a second orchestrator, blanket expensive implementation models, or indefinite background polling.

These links explain design provenance; reading this reference does not activate those skills or require network access. Reassess any external code's license, runtime compatibility, and authority separately if a future task actually requests its integration.
