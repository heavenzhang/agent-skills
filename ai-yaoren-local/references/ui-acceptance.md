# UI quality ownership and acceptance

Apply to changes affecting rendered pages or user interactions, including backend changes that alter visible states or permissions. Backend-only work with no user-visible effect does not need a UI lane. This is a quality gate within dev-team, not a new coordinator or permission to redesign unrelated screens.

## Owner and scheduling

- Name the UI quality owner when planning, not only after coding. For new pages, substantial layout changes, multi-step workflows, shared UI components, or recurring UX defects, default to one independent acceptance worker who did not implement the reviewed change. It can prepare criteria while implementation proceeds, inspect the representative page when ready, then review integrated journeys.
- Use `gpt-5.6-terra` at medium/high effort for established-design regression; use `gpt-5.6-sol` at high effort for ambiguous visual quality, complex interaction flows, or repeated defects. Luna can gather deterministic evidence but should not be the sole judge of complex UX. Follow the main skill's availability and provenance rules.
- Small isolated low-risk changes can use zero workers: the primary explicitly owns a focused rendered-page check and affected interactions. If independent review is unavailable for substantive work, record why, keep the UI checks under the primary, and disclose the lack of independent review. Do not silently omit a required gate or describe self-review as independent review.
- Count UI reviewers in the normal cap. Reuse one bounded reviewer across related pages, not one per page. Reserve browser/session ownership for one actor at a time; isolate tabs, accounts and test data where supported. Do not run competing navigation or test mutations in a shared browser/session. Start review only against an identified running revision; new relevant changes invalidate affected results.
- The reviewer owns criteria and findings, not product-source edits, deployment or final acceptance. If a reviewer must implement a fix, explicitly reassign exclusive write ownership and have the primary or another non-author verify it. Primary remains accountable for decisions and acceptance.

## Define the contract before implementation

Keep a small page/journey matrix in the task plan; use a project-local artifact only when scope warrants it. Include: route or component, user role, viewport, starting state, action sequence, expected visible result, baseline reference, owner, and evidence/status.

Use the user's supplied design or an existing agreed design system. If absent, the primary defines and discloses a minimal baseline using the existing product: hierarchy, spacing, typography, density, component behavior and navigation. Request a user decision only for material ambiguity; do not invent user approval or require a formal design document for a small fix. Tie aesthetic findings to this baseline or an observable usability problem, not the reviewer's personal taste.

Select applicable cases, not a universal exhaustive checklist:

- Main journeys: entry/navigation, locating information, editing/submitting, cancel/back, refresh and recovery. Verify visible results and persistence when relevant; avoid inert buttons, duplicate submissions and lost input.
- States: loading, empty, populated, validation failure, server/network error, success, disabled/read-only and permission denial as applicable. Include recovery actions and preserve user input where required.
- Presentation: hierarchy, alignment, spacing, typography, information density, consistent controls, understandable labels and feedback, readable errors, overlays/stacking and scroll behavior.
- Supported layouts and access: declared desktop/mobile viewports or other target widths, long realistic content, keyboard navigation, visible focus, accessible names, modal focus/exit, and readable contrast where affected. Do not claim full accessibility certification from these checks or add unsupported device targets.

For repeated new/redesigned page patterns, implement and inspect one representative running page with key states before expanding the pattern. Once it passes primary acceptance, freeze the relevant shared pattern; unrelated backend work can continue. A static mockup can establish direction but cannot satisfy this running-page gate.

## Verify the actual product

Use available supported browser/app controls or the project's existing browser-test tooling; inspect rendered screenshots for visual quality and execute action sequences for behavior. Do not install a new framework, product-design plugin, telemetry or recorder merely because this reference exists. Prefer existing reproducible checks; add focused regression tests for repeatable defects when within implementation scope.

Record the actual environment URL, running revision when ascertainable, role (without credentials), viewport, case, expected/actual result, and evidence location. Mark revision uncertainty explicitly. Capture only the relevant screens/failure excerpts; use synthetic or sanitized data and do not persist secrets, session state or private business records. A reviewer summary is not a substitute for evidence of executed checks.

Local or mocked checks can validate layout and isolated states; they do not prove authenticated integration, persistence or permissions against the intended backend. Test the critical integrated journey in the target environment when required. Production is read-only by default; business writes, destructive actions, payments, external messages and fault injection require appropriate task authorization and safe test scope. If the needed safe environment or access is unavailable, keep the corresponding case blocked/unverified and request the concrete prerequisite.

Do not equate source-level assertions, passing unit tests, an HTTP 200, or screenshots of the default happy state with completed UI acceptance. A working primary action must also have correct feedback and relevant failure/recovery behavior. If interaction tools are unavailable, screenshot/source review is partial evidence only.

## Defects, repair and release

Record each actionable defect compactly: ID, failed criterion, route/role/viewport/revision, reproduction steps, expected versus actual behavior, impact, evidence, implementation owner and status. Distinguish requirement failures from optional polish; do not introduce unrelated scope or allow an aggregate aesthetic score to hide a broken required journey.

The primary recalls the original implementer with bounded repairs. The UI owner reruns the failed case and affected nearby states/layouts; the primary inspects the actual repair and independently exercises critical integrated journeys, plus affected failed checks, before closing acceptance. Reuse existing worker context and send only changed evidence. Diagnose repeated failures, refine the baseline or ownership, and adjust the worker model under the main routing policy rather than repeating vague requests such as "make it polished."

Required visual, interaction and responsive criteria must pass; optional suggestions can remain separately listed. No required failure can be relabeled optional without an explicit user-approved scope change. Missing browser access or backend/test-data prerequisites leaves a gate open. A user request to stop ends work with an incomplete report, not a pass. Authorized test deployment may enable verification; production promotion and a claim of UI completion remain blocked until required gates pass. Do not bypass a blocker through unsafe tests or endless retries.

## Final UI report

Extend the normal execution report only for UI work: name the UI owner (or primary-owned fallback and reason); show visual, interaction and responsive statuses as passed/failed/blocked/unverified/not-applicable with a reason for exclusions; list tested routes/journeys, environment/role/viewports and evidence; include defects, repair rounds and remaining gates. If only local/mock verification passed, say so. Report observed design deviations and recurrence in the retrospective, not unmeasured quality or token-saving scores.
