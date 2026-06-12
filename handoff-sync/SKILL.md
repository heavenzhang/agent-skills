---
name: handoff-sync
description: Create, update, and resume a project handoff file named codex-handoff.md so Codex can carry task context across machines, folders, or fresh threads. Use when the user asks to write an end-of-session handoff, prepare to switch devices, resume work from a handoff note, sync task progress between Mac and Windows, or update project progress based on dates, anchors, branches, commits, files, decisions, blockers, and next steps recorded in codex-handoff.md.
---

# Handoff Sync

## Overview

Use `codex-handoff.md` as the portable source of truth for project context. The file lives in the project root and is safe to sync with Git or a file-sync tool because it contains a concise task snapshot, dated handoff log, anchors, decisions, changed files, verification status, blockers, and next steps.

Do not treat this skill as chat-history synchronization. Preserve enough context for another Codex instance to continue work, while avoiding secrets, credentials, long transcripts, and machine-specific cache data.

## Workflow Decision

- If the user is ending a session, switching machines, or asks to "write handoff", run **End Handoff**.
- If the user is opening a synced project, switching machines, or asks to "resume from handoff", run **Resume Handoff**.
- If the user asks to update progress after doing work, run **End Handoff** and append a new log entry rather than overwriting history.
- If `codex-handoff.md` does not exist, create it at the project root during **End Handoff**. During **Resume Handoff**, say that no handoff file exists and ask whether to create one after inspecting the project.

## File Location

Prefer the repository or project root:

```text
codex-handoff.md
```

If the current directory is not the project root, locate the nearest Git root when available. Otherwise use the current working directory and state that choice in the handoff.

## Handoff File Template

Create or maintain this structure:

```markdown
# Codex Handoff

<!-- codex-handoff:version=1 -->
<!-- codex-handoff:project=<project name or folder> -->
<!-- codex-handoff:last-updated=<ISO-8601 timestamp with timezone> -->
<!-- codex-handoff:latest-anchor=<YYYYMMDD-HHMM-short-label> -->

## Current Snapshot

- Status:
- Current task:
- Latest anchor:
- Branch / commit:
- Important files:
- Key decisions:
- Blockers:
- Next steps:

## Resume Instructions

- Start by reading this file.
- Use the latest anchor and the newest dated entry in Handoff Log.
- Compare branch, commit, and working-tree status before editing.
- Continue from Next steps unless the user gives a newer instruction.

## Handoff Log

### <YYYY-MM-DD HH:MM TZ> - <machine/context> - <anchor>

- Summary:
- Changes since previous handoff:
- Decisions:
- Files touched:
- Verification:
- Open questions:
- Next steps:
```

## End Handoff

1. Identify the project root and target `codex-handoff.md`.
2. Gather lightweight state:
   - Current date/time and timezone.
   - Project name or folder.
   - Git branch, latest commit, and working-tree status when Git is available.
   - User-visible task progress from the current thread.
   - Files changed or created if known.
   - Commands/tests/checks run and their outcome if known.
3. Create a short anchor in the form `YYYYMMDD-HHMM-label`, for example `20260612-1830-token-voucher-ui`.
4. Update metadata comments:
   - `last-updated`
   - `latest-anchor`
   - `project` if missing or stale
5. Replace **Current Snapshot** with the latest concise state.
6. Append a new dated entry to **Handoff Log**. Do not rewrite older log entries except to repair formatting.
7. Keep the handoff short enough to read quickly. Prefer bullets over transcript-like prose.
8. Do not include API keys, passwords, auth tokens, cookies, private credentials, or full secrets from `.env`.

## Resume Handoff

1. Locate and read `codex-handoff.md`.
2. Parse metadata comments, **Current Snapshot**, and the newest dated **Handoff Log** entry.
3. Identify the latest anchor by preferring `codex-handoff:latest-anchor`; if absent, use the newest dated log entry.
4. Compare the handoff against the local environment:
   - Current folder and project root.
   - Git branch and latest commit when available.
   - Whether important files named in the handoff exist locally.
   - Whether the working tree has unrelated changes.
5. Tell the user what context was restored in 3-6 concise bullets.
6. State the proposed next step before making edits.
7. If the user asks to mark the machine switch, append a short "Resumed" entry to **Handoff Log** with the current machine/context and timestamp.

## Quality Rules

- Treat `codex-handoff.md` as a project artifact that may be synced through Git, Syncthing, OneDrive, or another file-sync tool.
- Prefer factual status over speculation. Mark uncertainty clearly.
- Preserve user wording for product names, business decisions, and important constraints.
- Keep machine-specific paths only when they are necessary; otherwise describe paths relative to the project root.
- If Git is available, mention branch/commit because those are stronger anchors than dates alone.
- If the handoff conflicts with current user instructions, follow the user and update the handoff to reflect the new direction.
- If this skill is used in a side conversation, do not mutate files unless the user explicitly asks to write the handoff in that side conversation.
