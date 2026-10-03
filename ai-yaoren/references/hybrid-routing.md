# Hybrid routing

Use this reference to turn a request into a mixed AIRouter and Codex-native team without duplicating work.

Optimize for the fastest reliable path to an accepted result within authorization and safety boundaries. Treat price, tokens, model tier, external share, latency, and concurrency as inputs to that judgment, not independent targets. The best route minimizes total time and cost including retries, repair, integration, and verification.

## Route by execution boundary

| Package characteristic | Preferred channel | Reason |
| --- | --- | --- |
| Sanitized analysis, drafting, alternative design, isolated code or tests supplied as text | AIRouter external | Independent package fits the bounded file workspace |
| Repository exploration or modification, shell, build, test runner, browser, database, local application, deployment | Codex native | Requires real tools and local state |
| Architecture, decomposition, integration, production decision, final acceptance | Codex primary | Requires global context and accountability |
| Independent second opinion on an existing sanitized artifact | AIRouter external first | Gains model diversity without local mutation and often at lower accepted-result cost |
| Tool-based verification of an external artifact | Codex native | Produces real behavioral evidence |

External-first applies only after the package passes the external boundary check. Never strip necessary tools or evidence merely to make a task externally eligible.

## Optimize accepted-result value

For work that fits both channels, compare candidates by expected cost to an accepted result:

- capability and context/output fit;
- observed or evidenced success and artifact quality;
- likely retry, repair, and integration cost;
- token price and any fixed request charge;
- latency and concurrency impact;
- verification work still required in Codex.

Prefer the better-value AIRouter candidate when it is likely to satisfy the package without creating extra repair or verification work. The cheapest request is not necessarily the cheapest accepted result. Do not use Codex-native workers merely because they are available, and do not use an external model when missing tools or evidence make acceptance unlikely. When two routes have comparable acceptance prospects, prefer the lower-cost external route.

## Choose Codex model tier and effort

Use model and reasoning-effort values actually supported by the runtime.

For this user's Codex-native worker routing, prefer `gpt-6-luna` for lightweight, bounded tasks when the runtime offers it and its expected accepted-result cost is favorable. Keep stronger models for work whose complexity, risk, or likely repair cost justifies them. For packages that fit both channels, give an eligible AIRouter external candidate a slight preference when expected acceptance quality and total cost are comparable; keep tool and evidence requirements decisive.

| Work | Model tier | Typical effort |
| --- | --- | --- |
| Extraction, file inventory, mechanical transformation, deterministic smoke checks | Lightweight | low or medium |
| Ordinary implementation, debugging, unit tests, focused review | Workhorse | medium or high |
| Complex implementation, cross-module diagnosis, difficult repair | Strong workhorse or frontier | high or xhigh |
| Architecture, security-sensitive decisions, ambiguous integration, high-risk final review | Frontier | high, xhigh, or max only when justified |

Do not create a higher-tier agent merely to restate another worker's result. Escalate when acceptance failed, ambiguity remains material, or the expected cost of a wrong result exceeds the added inference cost.

## Build an efficient wave

1. Identify ready, independent packages and their evidence requirements.
2. Route externally eligible packages to AIRouter preferred candidates first.
3. Route tool-bearing or tightly coupled packages to Codex-native workers with explicit file/module ownership.
4. Reserve primary attention for interfaces, integration, acceptance, and authorized deployment.
5. Start another wave only after reviewing new dependencies or failed evidence.

Concurrency is capacity, not a target. A single primary is correct when coordination cost exceeds parallel value.

## Apply soft budgets

- Set a planning reference before dispatch so material overruns are visible.
- Crossing the planning reference is an alert, not an automatic stop. Re-estimate remaining packages and continue acceptance-critical work when its expected value justifies the overrun.
- Keep AIRouter's numeric run ceiling above the immediate expected spend when project policy allows, so ordinary variance or the single permitted retry does not fail solely because the estimate was too tight.
- If a run ceiling is exhausted, a disclosed continuation run is allowed for the same authorized task when project allowance remains and the user did not impose a hard cap.
- Provider balance, project policy, billing controls, and explicit user hard caps remain hard gates and must not be bypassed.
- Stop low-value repetition even below budget; continue high-value completion work even above the planning reference.

## Fallback rules

- External invocation failure: retry the same work package and requested model exactly once when authorization and a valid run reservation remain available. A planning-reference overrun is not a retry denial. Treat timeout, provider/HTTP/protocol error, malformed or empty response, tool-call failure, and missing required artifacts as retryable invocation failures. If the retry fails, close that model route and make any replacement-model or Codex-native fallback a new, explicitly reported routing decision.
- External preflight or policy gate: do not retry missing authorization, budget denial, unavailable credentials/candidates, user cancellation, or policy rejection because no valid model invocation occurred.
- External artifact acceptance failure: repair the same package first when the model can address the evidence; do not switch channels reflexively.
- Unsupported evidence claim: reject the claim and move real verification to a tool-capable Codex worker.
- Native worker failure: return reproducible evidence to the same worker before escalating tier.
- Channel unavailable: disclose it, preserve completed work, and continue through another channel only if the original acceptance contract still holds.
