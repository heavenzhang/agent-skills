---
name: ai-yaoren
description: Orchestrate a hybrid AI team from AIRouter-preferred external models and Codex-native models, with task-aware model effort, visible dispatch, bounded execution, repair, and primary-agent acceptance. Apply when the user invokes $ai-yaoren or asks Codex to organize multiple model workers. Do not use it merely to discuss routing.
---

# AI Yaoren · 赛博摇人

Keep the current Codex agent as the accountable primary. It owns requirements, architecture, decomposition, context release, integration, independent acceptance, and any authorized deployment. Build the worker team dynamically from two channels:

- **AIRouter external workers**: use AIRouter's current preferred candidates for suitable bounded packages.
- **Codex-native workers**: use models and reasoning efforts actually exposed by the current runtime for tool-bearing, tightly coupled, sensitive, integration, or high-judgment work.

The Skill has no fixed vendor, model, or agent-count list. Runtime availability is authoritative.

## Optimize for efficient completion

The ultimate objective is to complete the user's task efficiently and to the agreed acceptance standard, within authorization and safety boundaries. Evaluate efficiency as a whole: elapsed time, accepted quality, reliability, rework, coordination overhead, token and monetary cost, and operational risk. Budget, model tier, external-model share, concurrency, token count, and nominal per-call price are routing signals, not goals of their own and not reasons to leave an achievable task incomplete.

Choose the execution path with the best expected time and total cost to an accepted result. A modest overrun can be efficient when it prevents failure or rework; a cheap call is inefficient when it predictably causes repair loops. Do not maximize model count, minimize spend, or prefer a channel mechanically. Hard authorization, safety, billing, and provider constraints still apply.

## Load the current revision

On every explicit `$ai-yaoren` invocation, use the current `SKILL.md` and the required references from this skill directory; do not rely on a copy remembered from an earlier turn. If this skill is edited during an active turn, re-read the changed files before taking further skill-governed actions.

A local file edit does not hot-reload instructions already present in an in-progress model response. It also does not refresh MCP tool schemas or the session's discovered skill metadata. Changes limited to the skill body or references normally need only a new user turn with `$ai-yaoren`; changes to the skill name, frontmatter description, invocation policy, installed skill set, or MCP schema require a project/app reload or a new task unless the runtime explicitly confirms a refresh. Report the limitation instead of claiming a reload occurred.

## Establish the contract

Before delegation:

1. Translate the request into observable acceptance criteria and identify the evidence source for each criterion. Use those criteria and efficient completion—not budget consumption or agent count—as the stopping rule.
2. Keep trivial or tightly coupled work in the primary when delegation would cost more than it adds.
3. Treat an explicit `$ai-yaoren` execution request as authorization to use available Codex-native workers and an already configured AIRouter project within its existing policy. Set a proportionate planning budget, but treat that value as a reference and overrun signal rather than a completion gate unless the user explicitly makes it a hard cap. Assessment-only, planning-only, or “do not call” requests authorize no model calls. Adding credentials, funding an account, changing provider/project policy, or overriding an explicit user hard cap requires separate authorization.
4. Never send secrets, private keys, session data, production credentials, or unrelated private context to any worker. External workers receive only sanitized, minimal context.
5. A worker submission is never acceptance. The primary independently checks artifacts and real behavior.

Read [references/hybrid-routing.md](references/hybrid-routing.md) before planning a mixed team. Read [references/mcp-workflow.md](references/mcp-workflow.md) before the first AIRouter call in a turn.

## Route across both channels

Classify every proposed package before choosing a model:

- Prefer **AIRouter external workers** for independent, sanitized text or code artifacts that can be completed inside the worker's isolated file workspace without live runtime access.
- Use **Codex-native workers** when the package needs the repository, shell, browser, build, tests, database, local files not safely released, interactive debugging, deployment tooling, or direct coordination with other local changes.
- Keep architecture, cross-package integration, production decisions, and final acceptance with the primary. A native reviewer may assist but does not replace primary accountability.

For packages that genuinely fit both channels, prefer an AIRouter preferred model when its expected accepted-result value is favorable. Judge value by capability fit, first-pass success likelihood, expected retries and repair, price, latency, context/output limits, and verification burden—not by nominal token price alone. Use a Codex-native worker afterward only for integration, tool-based verification, materially different review, or evidence-backed fallback—not to duplicate completed work mechanically.

Choose model capability and reasoning effort by task difficulty and failure cost, not prestige:

- lightweight model / low effort: extraction, formatting, inventory, deterministic checks, small isolated edits;
- workhorse model / medium or high effort: implementation, debugging, test design, ordinary review;
- frontier model / high or higher effort: architecture, ambiguous cross-system diagnosis, security-sensitive reasoning, integration, and final high-risk review.

Use the lowest sufficient tier and raise it only when evidence shows the current tier cannot meet the criteria. Model names in runtime metadata are examples of availability, not a Skill-side preference list.

## Treat budget as a soft control signal

Keep three different concepts separate:

1. **Planning reference**: the primary's expected total spend for the task. Crossing it does not by itself stop, degrade, or prematurely declare the work incomplete. Re-estimate the remaining work, continue when the expected acceptance value justifies the overrun, and record the reason.
2. **Run reservation ceiling**: AIRouter may require a numeric `budget_limit` for a run. Set it high enough to avoid turning an estimate into an accidental execution blocker, while staying within the configured project allowance. It is a technical guardrail, not the same thing as the planning reference.
3. **External hard constraint**: provider balance, project policy, billing controls, an explicit user hard cap, or a server-side ledger rejection cannot be bypassed. Preserve the evidence and either reroute within the already authorized task or request the specific policy/funding change required.

When a run reservation is exhausted but the same authorized task still has worthwhile, acceptance-critical work and the project permits more spend, the primary may open a clearly disclosed continuation run with a new budget and idempotency key. Do not repeat accepted packages, hide the overrun, or describe the continuation as cost-free. If continuing would require new funds, a policy change, or violation of a user hard cap, stop and ask.

Prefer completing the task with a justified reference-budget overrun over saving a small amount while leaving acceptance criteria unmet. Conversely, stop wasteful loops when additional calls have low expected value, even if nominal budget remains. Budget governs routing and visibility; acceptance governs completion.

## Preflight available channels

For AIRouter work, require `dev_team_control` tools including `list_projects`, `list_model_candidates`, `open_run`, and `submit_work_packages`.

The connection transport is not an agent capability requirement. Prefer AIRouter's HTTPS MCP endpoint with the current user's scoped, revocable Token; SSH is an optional maintenance/legacy channel, not a prerequisite. Read the connection guidance in `references/mcp-workflow.md` when tools are missing or authentication fails. Do not claim that editing this Skill connects an already-running Codex session.

- Select a project by purpose, currency, available allowance, concurrency, and risk policy. Keep the planning reference separate from the server-enforced allowance.
- Query `list_model_candidates` with required capabilities and risk. The preferred entries in the current response are the complete external routing pool; use AIRouter's ordering and metadata.
- If AIRouter tools or preferred candidates are unavailable, mark the external channel unavailable and continue with an appropriate Codex-native or primary-only plan when that still satisfies the request. Never claim an external model was called.
- For high-risk external work, preserve verification, capability, price, currency, and risk gates. Query candidates with `risk: "high"` and submit every corresponding package with explicit `risk: "high"`; never rely on the package default.
- Treat context-window tokens and single-response output tokens as separate route capabilities. Before a long code package, check the actual endpoint/plan limits in AIRouter; a model-family 1M/2M context claim does not establish that route's output cap. Where the route cap is evidenced, choose a package-level output budget suited to the deliverable and overall cost. Unknown route limits remain unknown; do not advertise an arbitrary fallback as the provider's limit.

For Codex-native work, use only models, reasoning-effort values, concurrency, and agent tools actually exposed by the current runtime. If native subagents are unavailable, keep that work in the primary rather than simulating delegation.

## Make every delegation visible

Before the first worker call, send a concise commentary update headed `赛博摇人 派工单`. Show separately for every planned worker:

- execution channel: `AIRouter 外部` or `Codex 内置`;
- requested model and provider/source;
- requested reasoning effort for Codex-native workers, or `由外部服务管理` for AIRouter;
- role, concrete task, artifact scope, acceptance criteria, and important tool/context boundaries;
- AIRouter project, strategy, planning reference, run reservation ceiling, and planned external concurrency when applicable.

Distinguish `计划调用` from `已派发`. An AIRouter package is dispatched only after `submit_work_packages` succeeds; a native task is dispatched only after the runtime creates the agent/task successfully. Report run/package IDs or native agent/task IDs. On meaningful progress, name the affected channel, model, task, outcome, repair, escalation, replacement, or cancellation. Never infer a runtime-reported model identifier.

## Execute bounded work

### AIRouter external workers

Follow [references/mcp-workflow.md](references/mcp-workflow.md). External workers have an isolated text workspace with supplied files only. They cannot implicitly access the repository, shell, network, browser, database, deployment environment, or production state.

Reject or reroute any external result that claims unsupported live actions or evidence. Empty output, missing required artifacts, pseudo tool-call markup, or self-authored claims of browser/network/database activity are execution failures, not review-ready evidence.

Give every failed external model invocation exactly one automatic retry on the same work package and requested model when authorization and a valid AIRouter reservation remain available. A planning-reference overrun alone does not suppress the retry. This covers timeouts, provider/HTTP/protocol errors, malformed or empty responses, tool-call failure, and missing required artifacts. Preflight rejection, missing authorization, server-side budget denial, user cancellation, or policy gates are not failed invocations and must not be retried. If the retry also fails, close that model route; any replacement external model or Codex-native fallback is a separately disclosed routing decision, not another retry.

### Codex-native workers

Give each worker a bounded package with explicit ownership, inputs, deliverables, criteria, and stopping conditions. Parallelize independent ready work; serialize overlapping writes, shared runtime resources, and dependent integration. Use native workers for real tool execution and return evidence locations to the primary.

Do not send external paid repair attempts merely because a native integration check fails. Diagnose whether the defect belongs to the external artifact, local integration, or acceptance environment before choosing the repair channel.

## Accept, repair, and integrate

1. Check every criterion against the actual artifact and the required evidence source. Model-written descriptions are not substitutes for screenshots, logs, test output, database reads, or deployment evidence.
2. For a failed AIRouter invocation without reviewable artifacts, use its single retry opportunity; do not record acceptance. If the retry fails, close that model route and decide explicitly whether to replace, reroute, or stop. For reviewable artifacts that fail criteria, record failed acceptance and recall the same package with evidence; acceptance repair is distinct from the one execution-failure retry.
3. For native work, return the failure to the same worker when useful; change model tier or worker only after diagnosing the failure. Re-run failed checks after every repair.
4. Integrate code into the real repository and run proportionate tests, build, browser, security, and deployment checks in the tool-capable Codex channel.
5. The primary alone decides overall completion.

## Report every execution

End with a compact AI Yaoren report, including primary and worker roles, channel, requested and runtime-reported model identifiers, native reasoning effort, task/run/package IDs, planning reference, run reservation ceiling, actual AIRouter spend, any reference overrun and justification, invocation retry count, acceptance evidence, repair rounds, remaining gates, and a short routing retrospective.

Include a `模型—任务—结果` table with one row per external package, native worker, or repair attempt. Show channel, provider/source, requested model, reported model or `未知`, reasoning effort, task, identifier, outcome, acceptance, and repair count. AIRouter accounting is not the complete Codex bill; native usage and savings remain unknown unless exposed by the runtime.
