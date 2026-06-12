# Codex Skills

Personal Codex skills for syncing across machines.

## Included Skills

- `handoff-sync`: Maintain `codex-handoff.md` so Codex can hand off project context across Mac, Windows, synced folders, Git branches, or fresh threads.

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
