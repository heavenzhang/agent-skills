# Collaboration execution report

Use at the end of every dev-team task, including single-agent and blocked outcomes. The primary owns this report. Use the user's language. This is a delivery record built from observed work, not an additional review agent or a requirement to collect private transcripts.

## Required content

1. **Outcome and execution mode.** State what was delivered, whether acceptance passed, and whether the task used one agent or multiple agents. Briefly explain the mode choice. Count actual participating agents for this task, not available slots, prior unrelated agents, or hypothetical roles. If relevant, distinguish unique workers from peak concurrent workers; neither is the number of work packages.
2. **Participant and model table.** List the primary and each participating worker, including a curator or reviewer that actually ran. Include the stable worker identifier or recognizable task name, responsibility, model family/tier and exact identifier when verified, reasoning effort, acceptance result, and repair count. If one worker changes model, show its separate phases rather than assigning the final model to all prior work.
3. **Verification evidence.** Link relevant artifacts or diffs and name the actual focused/integration checks with results. Keep code, automated tests, deployment, and real user-path acceptance separate when applicable. Failed and unverified required gates remain open.
4. **Efficiency evidence.** Include runtime-provided usage, task elapsed time, and shared-cache statistics when available and useful. Otherwise say unavailable or not measured; do not obtain these by importing full session archives. Keep the section short when no trustworthy accounting exists.
5. **Retrospective.** Explain the observed value or overhead of the chosen division of work; identify any repair, model escalation, context duplication, resource contention, or blocker that mattered; propose one concrete improvement for a similar future task. If there is no evidence that a change is needed, say retain the current approach. Recommendations are proposals, not permission to rewrite global policy or persistent user memory.

## Model and metric provenance

- Distinguish **runtime-confirmed**, **requested but unconfirmed**, and **unknown**. Configuration defaults and a model's self-description are not proof of exact runtime model or reasoning effort. Report the requested value with that label when no confirming runtime metadata is exposed; do not invent an effective tier.
- The primary can report known model-family identity at that granularity while leaving the exact variant or effort unknown. Do not assume all workers inherited the primary's model or that an attempted switch succeeded.
- Include a verification outcome for every worker submission: accepted, needs repair, blocked, or unverified. A worker saying "done" is not primary acceptance.
- Count a repair round when a failed primary acceptance leads to a concrete repair dispatch or primary repair iteration. Do not count every tool retry as a repair round. Separate current-run counts from historical totals; if rounds were not recorded, report unknown.
- If reporting first-pass acceptance, show the numerator and denominator. Use only packages whose first primary review actually occurred; identify pending/unreviewed packages separately. A single-agent task with no worker submissions has no worker first-pass acceptance rate.
- End-to-end duration is wall-clock task duration, not the sum of parallel worker durations. Without a comparable single-agent baseline, do not report a speedup percentage; a qualitative assessment must be labeled as an inference.
- Keep actual token data separate from cached-character/read-count proxies. Do not add parent totals that already include child usage to child totals again. Missing usage is unknown, never zero. Do not turn subscription usage into an API bill, or cache hits into a measured savings percentage.

## Compact multi-agent layout

Adapt this template to observed participants and evidence; never populate it with demonstration numbers in an actual report.

```markdown
Delivered: [result, acceptance status, remaining gates].
Execution: [single/parallel], [reason and actual participant count].

| Participant / role | Model and effort (provenance) | Work package | Primary acceptance / repairs |
| --- | --- | --- | --- |
| [actual primary] | [known values or unknown] | [actual responsibility] | [result] |
| [actual worker] | [known values or explicitly requested values] | [actual scope] | [result and observed rounds] |

Evidence: [artifacts, checks and outcomes, deployment/user-path evidence if required].
Efficiency: [measured duration/usage/cache activity, or not measured].
Retrospective: [what worked; observed overhead or blocker; next adjustment with rationale].
```

For large runs, place detailed per-package evidence in a local report artifact within the task's authorized output location, and include a compact roster and key findings in the final reply. Do not require the user to open a file to learn which model tiers were requested/confirmed or whether acceptance passed. Save no external report, message, or repository update unless that destination is in scope.

## Single-agent form

Use a short paragraph or a few lines: mode and zero workers; known primary model/effort or uncertainty; delivered change and verification; one sentence on why delegation was unnecessary and what to retain/change next time. Do not create an empty worker table, a fictional collaboration metric, or a cost-saving claim without a baseline. Required failures and blockers still need to be visible.
