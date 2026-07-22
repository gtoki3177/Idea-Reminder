---
name: review
description: Review neglected Claude conversations that have gone idle past the configured Δt. Use when the user says "idea reminder", "review my conversations", "回顧我的對話", "有什麼落下的想法/進度", "整理靈感", "daily idea digest", or when a daily reminder task fires. Presents a weighted digest of stale sessions (the longer neglected, the higher they rank) and helps the user continue / archive / dismiss / snooze each one.
---

# idea reminder — review

Surfaces Claude Code and desktop (Cowork) conversations idle longer than Δt as a weighted digest. Two jobs: remind the user of dropped work/ideas, and let inspiration settle then resurface. The more a conversation is neglected, the higher its weight climbs — until the user continues, archives, or dismisses it.

## The CLI

All state and scoring live in the bundled Node CLI (Node 18+, zero dependencies). Resolve it in this order:

1. **Plugin install:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/idea-reminder.js" <command>` in the shell — the variable is exported to shell commands run under this plugin.
2. **If that variable is empty** (running from a git clone): use `idea-reminder <command>` from PATH (`npm link`), or `node <repo>/bin/idea-reminder.js`.

Commands: `report [--json] [--preview]` · `sync-desktop <json>` · `scan [--daily] [--notify]` · `list [--all]` · `archive <id...>` · `dismiss <id...>` · `activate <id...>` · `snooze <id> [days]` · `note <id> <text>` · `resume-cmd <id>` · `status`. IDs may be given as an 8-char prefix. Mutable data lives in `~/.claude/idea-reminder/` (state.json, user config.json).

## Workflow when invoked

0. **Desktop sync** (desktop app only): call the MCP tool `mcp__ccd_session_mgmt__list_sessions` with `{include_archived: true, limit: 100}`, then pipe the returned JSON array to the CLI on **stdin** via a Bash heredoc — do NOT write it to a file (writes under `~/.claude` trigger a sensitive-file prompt):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/idea-reminder.js" sync-desktop - <<'IDEA_SYNC_EOF'
   [ ...the JSON array verbatim... ]
   IDEA_SYNC_EOF
   ```

   This mirrors the **Code tab's** archive state (archived in Claude = gone from the digest). Cowork conversations don't need this step — the CLI scans them straight from disk, app titles and archive state included. If the MCP tool is unavailable (plain CLI), skip silently.

1. **Get the digest**: run `report --json` (reflects fresh on-disk state and applies the once-per-day weight bump). Use `report --preview` if the user only wants to peek without counting it as today's report.

2. **Present it in the user's language.** For each item in `shown`:
   - Header line: title · project · idle `idleDays` days · weight `weight` · skipped `neglectCount`× · `messageCount` msgs.
   - One sentence on *what the idea / open thread was* — summarize from `firstPrompt` + `lastUserText`. If you need more, read the tail of the session file (path in the item) — **read only, never modify it**.
   - Highest weight first. Explicitly flag anything with `neglectCount >= 3` ("you've skipped this N times now").
   - If `hidden` is non-empty, mention how many more are collapsed; if `supersededHidden` > 0, mention that many older handoff-chain links are auto-hidden.
   Group by `project` when there are many items.

3. **Ask what to do** with each (batching is fine). Map the user's choice to a command:
   - continue → `resume-cmd <id>`, show the printed `cd … && claude --resume …` line, offer to run it. Desktop-only (`local_…`) conversations can't be resumed from CLI — tell the user to open them in the Claude app.
   - archive (done / keep as reference) → `archive <id...>`
   - dismiss (not worth reminding) → `dismiss <id...>`
   - snooze N days → `snooze <id> <days>`
   - note → `note <id> "<text>"`
   - If the user says they already handled/archived something in Claude itself, `archive` it here too.

4. **Confirm** what changed and how many remain queued.

## Important

- **Never delete or edit the real session files.** `archive`/`dismiss` only change idea-reminder's own queue — the actual Claude conversation is untouched.
- To change Δt, weights, chain mode, etc., edit `~/.claude/idea-reminder/config.json` (user-global overrides; created on demand — same keys as the package's `config.json`).
- For a daily automatic digest, the user creates a scheduled task whose prompt invokes this skill — see the repo's `scheduled-task.md`.
