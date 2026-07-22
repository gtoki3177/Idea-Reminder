---
name: idea-reminder
description: Review neglected Claude Code conversations that have gone idle past the configured Δt. Use when the user says "/idea-reminder", "idea reminder", "回顧我的對話", "有什麼落下的想法/進度", "整理靈感", "daily idea digest", or when the daily reminder fires. Presents a weighted digest of stale sessions (the longer neglected, the higher they rank) and helps the user continue / archive / dismiss / snooze each one.
---

# idea reminder

Surfaces Claude Code conversations idle longer than Δt as a weighted daily digest. Its two jobs: remind the user of dropped work/ideas, and let inspiration settle then resurface. The more a conversation is neglected, the higher its weight climbs — until the user continues, archives, or dismisses it.

## The CLI

All state and scoring live in a small Node tool. If it was installed globally (`npm link` or `npm i -g .` in the repo), call it directly:

```
idea-reminder <command>
```

If it was **not** installed globally, call it by path instead: `node <repo>/bin/idea-reminder.js <command>` (the recipient sets `<repo>` to wherever they cloned it).

Commands: `report [--json] [--preview]` · `scan [--daily] [--notify]` · `list [--all]` · `archive <id>` · `dismiss <id>` · `activate <id>` · `snooze <id> [days]` · `note <id> <text>` · `resume-cmd <id>` · `status`. IDs may be given as an 8-char prefix.

## Workflow when invoked

1. **Get the digest** (this reflects fresh on-disk state and applies the once-per-day weight bump):
   ```
   idea-reminder report --json
   ```
   Use `report --preview` instead if the user only wants to peek without counting it as today's report.

2. **Present it** in the user's language (Traditional Chinese). For each item in `shown`:
   - Header line: title · project · `idleDays` 天 · 權重 `weight` · 略過 `neglectCount` 次 · `messageCount` 則.
   - A one-line read of *what the idea/open thread was* — summarize from `firstPrompt` + `lastUserText`. If you need more to give a good summary, read the session file directly (path: `<projectsDir>/<encoded-project>/<id>.jsonl`) and skim the tail — **read only, never modify it**.
   - Lead with the highest weight. Explicitly flag anything with `neglectCount >= 3` ("你已經連續略過這個 N 次了，要處理一下嗎？").
   - If `hidden` is non-empty, mention how many more are queued below the fold.
   Group by `project` when there are many items.

3. **Ask what to do** with each (batching is fine). Map the user's choice to a command:
   - 繼續 / continue → run `resume-cmd <id>` and show them the exact `cd … && claude --resume …` line. Offer to run it if they want to jump in now.
   - 歸檔 / archive (done or keep as reference) → `archive <id>`
   - 忽略 / dismiss (not worth reminding) → `dismiss <id>`
   - 稍後 N 天 / snooze → `snooze <id> <days>`
   - 記個筆記 → `note <id> "<text>"` (shows up in future digests)
   - If the user says they've **already handled or archived a conversation in Claude itself**, archive it here too (`archive <id>`) — this tool can't see Claude's own archive state, so it only knows what it's told. `archive`/`dismiss` accept several ids at once: `archive <id1> <id2> …`.

4. **Confirm** what changed, and how many remain queued.

## Important

- **Never delete or edit the real session `.jsonl` files.** `archive`/`dismiss` only change idea-reminder's own queue — the actual Claude conversation is untouched. If the user wants a conversation truly gone, they delete it in Claude; the scanner then drops it automatically on the next run.
- To change Δt or the daily time T, edit the repo's `config.json` (`deltaIdle`, `reportTime`); for T also update the scheduled task (see the project README).
- v1 tracks **Claude Code** sessions only. Cowork / claude.ai chat are future surfaces.
