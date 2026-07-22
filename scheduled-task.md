# Daily digest — scheduled-task prompt template

> **Plugin install? You don't need this file.** The whole task prompt is one line:
> *"Invoke the idea-reminder:review skill and follow it through — sync, digest, then ask me what to do with each item."*
> The template below is for **git-clone (bare CLI)** installs, where no skill is registered.

This is the prompt that drives the daily report. You don't create the task by hand — you **ask Claude Code** to schedule it, and paste this as the task's instructions. Claude stores it as a **Desktop scheduled task** under `~/.claude/scheduled-tasks/<id>/SKILL.md` (runs locally, persists across restarts, fires on next launch if the app was closed).

## How to set it up

In Claude Code, say something like:

> Create a daily scheduled task at 10pm that runs the prompt below.

(Any language works — write it in yours, and add e.g. "present the digest in Traditional Chinese" if you want the daily report localized.)

Then paste the prompt. (Assumes `idea-reminder` is on your PATH via `npm link`. If not, replace `idea-reminder` with `node <repo>/bin/idea-reminder.js`.)

## The prompt

```
Review my "idea reminder" queue: Claude Code conversations that have gone idle
past Δt and may be dropped work or half-formed ideas.

0. If the ccd_session_mgmt MCP tools are available, call
   mcp__ccd_session_mgmt__list_sessions (include_archived: true, limit: 100),
   then pipe the returned JSON array to the CLI on stdin via a Bash heredoc
   (do NOT write it to a file — ~/.claude writes trigger a sensitive-file prompt):
   idea-reminder sync-desktop - <<'IDEA_SYNC_EOF'
   [ ...the JSON array verbatim... ]
   IDEA_SYNC_EOF
   This mirrors the Code tab's archive state into the queue (archived in
   Claude = gone from the digest). Cowork conversations need no MCP — the CLI
   scans them from disk automatically. If the MCP is unavailable, skip this step.

1. Run this command to get today's digest (it reflects the latest on-disk state
   and applies the once-per-day weight bump):
   idea-reminder report --json

2. Present the result in my language. For each item in the JSON `shown` array:
   - One header line: title · project · idle `idleDays` days · weight `weight`
     · skipped `neglectCount`x · `messageCount` msgs
   - One sentence on what the idea / open thread was, summarized from
     `firstPrompt` + `lastUserText`. If you need more to summarize well, read the
     tail of the session file (path in the item), but READ ONLY — never modify it.
   - Sort by weight, highest first. Call out anything with neglectCount >= 3.
   - If `hidden` is non-empty, tell me how many more are collapsed below.
   Group by project when there are several.

3. Ask what to do with each (batching is fine). Map my choice to a command
   (8-char id prefix is fine):
   - continue → idea-reminder resume-cmd <id>   (show me the printed resume line)
   - archive  → idea-reminder archive <id>
   - dismiss  → idea-reminder dismiss <id>
   - snooze N → idea-reminder snooze <id> <days>
   - note     → idea-reminder note <id> "<text>"
   If I say I've already handled or archived a conversation in Claude itself,
   archive it here too so it stops resurfacing — this tool can't see Claude's
   own archive state. archive/dismiss accept several ids: archive <id1> <id2> ...

4. Confirm what changed and how many remain queued.

Important: archive/dismiss only affect idea-reminder's own queue — they never
delete or edit the real Claude session files. If the queue is empty, just say so
briefly.
```
