# AIRouter MCP workflow

Use the MCP tool names exposed by the `dev_team_control` server. The host may prefix them in the Codex tool catalog, for example `mcp__dev_team_control__list_projects`.

## Connection and user identity

Prefer Streamable HTTP over verified HTTPS. The current IP endpoint is `https://192.144.166.234/AIRouter/mcp`; obtain a personal Token from AIRouter Settings → Codex connection and merge the following into the host's existing configuration without overwriting unrelated servers:

```toml
[mcp_servers.dev_team_control]
url = "https://192.144.166.234/AIRouter/mcp"
bearer_token_env_var = "AIROUTER_MCP_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Provide the Token to the actual Codex host process using its supported credential/environment mechanism. Never put it in committed TOML, Skill files, prompts, URLs, reports, or tool output. Desktop launches may not inherit variables exported in an unrelated terminal. Reload the MCP connection before treating tools as available; editing a Skill is not a connection refresh. A different server label such as `airouter` may produce a different tool prefix; use the tools actually discovered for the configured AIRouter endpoint.

No SSH key is required for personal HTTPS calls. SSH stdio remains a restricted legacy maintenance option, not a requirement or a fallback identity for another user. Do not use public plaintext HTTP or disable certificate verification. If the domain's TLS is broken, use the verified IP HTTPS endpoint rather than weakening TLS.

Before routing, call `get_routing_policy({})` to establish the authenticated user's policy, then `list_projects({})` for this Token's authorized projects. A read-only Token cannot execute work; ask the user to create an execution-scoped Token for the required project rather than borrowing a shared maintenance identity. Expired/revoked Tokens and Tokens invalidated by password, role, or account changes must be replaced through the normal logged-in settings page. Do not retry missing authorization as a failed external-model invocation.

## Read and selection

1. `list_projects({})`
   - Choose one existing authorized project by purpose, currency, available allowance, concurrency, and risk policy. Project membership fields do not determine the Skill's model choice.
   - Project-level spent, reserved, and remaining values are not currently returned, so do not invent them; the server still enforces the aggregate budget when reserving a request.
2. `list_model_candidates({requirements})`
   - `requirements`: `project_id`, optional `required_capabilities` (`text`, `code`, `tools`), `risk` (`low` or `high`), and `scene`.
   - `scene` must exactly match a configured catalog tag. Never put a prose task description there. For software delivery, try `development`; for external-agent delegation, try `agent-collaboration`. When the taxonomy is not known, omit the optional field on the first query, inspect the returned `scenes`, and only then apply an exact scene filter if needed.
   - This is read-only and must precede model selection. The preferred entries in this response are the complete routing pool; use AIRouter's current ordering and metadata. Do not derive another candidate list from model names, vendors, past runs, or local configuration. If no preferred candidate remains after server-side gates, stop the paid path and report the gate.

## Open and submit

3. `open_run({input})`
   - `input`: `project_id`, `title`, `budget_limit`, unique `idempotency_key`, optional `strategy` (`balanced`, `speed`, or `cost`), and `main_model` with `requested`, `reported`, and `source` when known.
   - Run-level `acceptance` is optional and its accepted wire shape can vary by deployed server version. Include it only when the current MCP tool schema documents the exact shape; otherwise omit it and carry complete acceptance criteria on each submitted package. Do not probe several guessed shapes on a live run.
   - Record an explicitly selected Codex model as `requested`. Keep `reported` null unless the runtime returns an exact identifier; model-family wording and local defaults are not runtime confirmation.
   - Keep a separate planning reference for expected total spend. `budget_limit` is the server-enforced reservation ceiling, not that estimate. Use a ceiling no larger than the project allowance, but high enough that ordinary variance and the single permitted retry do not accidentally block acceptance-critical work.
   - Crossing the planning reference does not require stopping or silently lowering quality. Re-estimate and disclose the overrun. If this run ceiling is exhausted while the same authorized task still has high-value remaining work, open a clearly identified continuation run only when project allowance remains and the user did not set a hard cap. Never duplicate accepted packages.
   - This and later write tools can require MCP approval. Explicit task authorization still needs an approval-capable Codex session; never bypass a rejecting approval policy.
4. `submit_work_packages({run_id,input})`
   - `input.idempotency_key` must be unique for this submission.
   - Each package includes `title`, `instructions`, AIRouter `model_id`, `acceptance_criteria`, sanitized `context_files` as `{path,content}`, optional `depends_on`, `required_capabilities`, `risk` (`low` or `high`), and, when the deployed schema exposes it, `max_output_tokens`. For a package selected from a high-risk candidate query, pass `risk: "high"` explicitly; omission defaults to low risk and is not equivalent.
   - `max_output_tokens` is a per-request output budget, not the model's context window. Set it only up to the configured and evidenced limit of this exact route/plan; choose a smaller package budget when the full route maximum would make worst-case cost or latency disproportionate. Do not silently reduce an evidenced route capability just to fit a package.
   - Submit at most eight packages per wave and no more than project concurrency can usefully support.
   - Candidate selection comes from the preferred entries in the current `list_model_candidates` response. Multiple packages may use different preferred models; select the count from independent ready work, not from a fixed agent target.

## Observe and retrieve

5. `wait_run_events({run_id,cursor,wait_ms})` waits at most 20 seconds. Advance to the greatest `cursor` on the returned event entries. Use `get_run_status({run_id})` for the authoritative run/package/attempt state.
6. `get_work_package_artifacts({package_id,paths:[]})` returns metadata and final-result length on servers that support chunking. Request only selected `paths`, using `offset` and `limit` (at most 65,536 characters) to advance through long files or final summaries until `next_offset === total_chars`. Verify each chunk's `attempt_id`, path, and digest metadata against the latest attempt; do not treat a clipped tool response as the complete artifact. On an older server without chunking, narrow the requested paths and report any retrieval limit rather than guessing the missing text.

## Repair, cancel, accept

7. `request_repair({package_id,input})`
   - `input`: `feedback`, complete `failed_criteria`, and a unique `idempotency_key`.
   - Repair recalls the original package; Codex must verify the new attempt.
   - When the latest attempt failed at invocation/execution level, use this to give the same package and requested model exactly one retry, provided authorization and a valid AIRouter reservation remain available. A planning-reference overrun alone does not suppress the retry. Record that this is retry `1/1`.
8. `cancel_run({run_id})` stops future dispatch and requests cancellation of active calls. Already incurred provider charges may remain.
9. `record_acceptance({run_id,input})`
   - For a package: include current `package_id`, current `attempt_id`, `passed`, complete `checks` as `{criterion,passed,evidence}`, and a unique `idempotency_key`.
   - The package must be `review_ready` and the attempt must be the current successful attempt. Use `passed: false` only for reviewable artifacts that fail criteria. For an execution-level `failed` attempt with no artifacts, skip this tool and go directly to `request_repair` or cancellation.
   - A repair still needs a new independent check.
10. `get_execution_report({})` returns AIRouter-covered execution and cost statistics. It does not include native Codex usage.

## Common gates

- `no projects`: configure a project in the AIRouter UI before execution.
- `no candidates`: first remove only an invented or inaccurate optional `scene` filter, or replace it with an exact configured scene tag. If an accurate query still has no preferred candidate, preserve the gate and inspect AIRouter preference, verification, capability, budget, and enabled-provider state; do not invent another candidate pool or silently fall back to a non-preferred model.
- `planning reference exceeded`: this is not a server failure. Re-estimate remaining work, prefer the best accepted-result value, continue when justified, and report the overrun.
- `run budget exceeded`: do not retry the rejected reservation as though a model invocation failed. If the same authorized task still needs acceptance-critical work and project allowance remains, use a disclosed continuation run with a new idempotency key; otherwise reroute or stop.
- `project/provider budget exceeded`: never bypass the ledger, billing control, provider balance, or an explicit user hard cap. Obtain authorization for the specific funding or policy change, or continue through a valid already-authorized channel.
- `approval required but policy rejects`: no AIRouter call occurred. Retry only in an approval-capable session using its normal approval or automatic review path.
- `model/provider error`: preserve the evidence and retry the same package/model exactly once (`1/1`) when authorization and a valid AIRouter reservation remain available. A planning-reference overrun alone does not suppress the retry. This applies to timeouts, provider/HTTP/protocol errors, malformed or empty responses, tool-call failure, and missing required artifacts. If retry `1/1` fails, close that model route. To change models, create an explicitly identified replacement package or new run only when reservation and artifact ownership remain clear; this is a new routing decision, not a second retry.
- `preflight/policy failure`: do not retry missing authorization, budget denial, unavailable credentials/candidates, user cancellation, or policy rejection because no valid model invocation occurred.
- `tool-call loop or poor artifact`: tighten the instructions and acceptance example before escalating model capability.
- `MCP tools missing`: reload Codex after configuration. A fresh CLI process seeing the server does not retroactively add tools to an already running task.
