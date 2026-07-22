# 💡 idea reminder

Resurface **neglected Claude Code conversations** as a weighted daily digest — so dropped work and half-formed ideas don't rot in your session history.

- After a conversation has been idle for **Δt**, it joins the report queue.
- Every day at time **T** you get a digest that asks, per conversation: continue, archive, dismiss, or snooze?
- Every day you leave a queued conversation unresolved, its **weight climbs** — so the more you neglect something, the harder it pushes back. It stops only when you continue it, archive it, or dismiss it.

Two purposes: nag you about **dropped progress**, and let **inspiration settle then resurface** after it's had time to compost.

> **v1 scope: Claude Code sessions only.** (Cowork and claude.ai chat are on the roadmap — see the bottom.)

## Why build instead of install?

No existing tool does this. Session browsers (Claude Code Bookmarks, claude-session-manager, CCHV, Mantra, …) let you *search/replay* sessions but have no idle-detection, digest, or resurfacing. Spaced-repetition digesters (Readwise, Reflect) do the *decay/resurface* model but for notes, not your Claude sessions. idea-reminder sits at that intersection. The weight model is spaced-repetition applied to your AI conversations.

## How it works

Claude Code stores every conversation as a JSONL file:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl   ← one "chat room" (tracked)
~/.claude/projects/<encoded-cwd>/<uuid>/…               ← subagents/workflows/tool-results (ignored)
```

The scanner enumerates those top-level `.jsonl` files, extracts a title (first real prompt), the last thing you were doing, message count, and the last-activity timestamp. "Idle" = now − last activity. State lives in `state/state.json` (git-ignored; local only).

### Weight

```
weight = 1  +  neglectStep × neglectCount  +  idleFactorPerDay × idleDays
```

- `neglectCount` — how many daily reports you've left it unresolved (the main escalator). Reset to 0 when you continue the session.
- `idleDays` — a gentle secondary aging term.

Defaults: `neglectStep = 1.0`, `idleFactorPerDay = 0.05`. Highest weight sorts first; the top `maxDetailedItems` are shown in full, the rest collapsed.

### Lifecycle

```
tracking ⇄ queued        queued when idle ≥ Δt; back to tracking (neglect reset) when you resume it
snoozed  → tracking       when the snooze timer passes
archived / dismissed      terminal, set by you; never re-queue until `activate`
```

Continuing a conversation is detected automatically: when new activity appears after it was queued, it leaves the queue and its neglect resets. Delete a conversation in Claude and the scanner drops it on the next run.

## Install

Requires Node 18+ (tested on Node 22). No dependencies.

```bash
node bin/idea-reminder.js status      # sanity-check config + paths
node bin/idea-reminder.js scan        # build initial state
node bin/idea-reminder.js report      # see today's digest
```

Optional — put it on PATH:

```bash
npm link            # then: idea-reminder report
```

### As a Claude Code skill

Copy `skill/SKILL.md` to `~/.claude/skills/idea-reminder/SKILL.md` (Windows: `C:\Users\<you>\.claude\skills\idea-reminder\SKILL.md`). Then `/idea-reminder` (or "回顧我的對話") runs the interactive review: it calls `report --json`, summarizes each stale conversation, and executes your continue/archive/dismiss/snooze choices.

### Daily trigger at time T

The scanner reads **local** files, so the scheduler must run **on your machine** — that rules out Claude Code **Cloud Routines** (they run in a fresh cloud clone with no access to `~/.claude/projects`) and **`/loop`** (session-scoped, dies on exit, 7-day expiry).

**Recommended — Claude Code Desktop scheduled task.** Runs locally, persists across restarts, needs no open session (fires on next launch if the app was closed), and can both update state *and* present the digest in-app. Just ask Claude in natural language, e.g.:

> 每天晚上 10 點跑 idea reminder：執行 `node "C:/code stuff/idea_reminder/bin/idea-reminder.js" report --json` 並用繁中呈現待回顧的對話，讓我決定繼續/歸檔/忽略。

Claude stores it under `~/.claude/scheduled-tasks/<id>/SKILL.md`; manage it in the app's **Scheduled** sidebar. It only fires while the app is open, otherwise on next launch (no multi-day catch-up — which suits a daily digest fine). The task prompt is self-contained, so this works **without** installing the global skill.

**Alternative — Windows Task Scheduler.** Use this if you want the scan to run even when Claude is fully closed (machine on). It updates state + notifies silently; review later with `report`.

```powershell
schtasks /Create /SC DAILY /ST 22:00 /TN "idea-reminder" ^
  /TR "node \"C:\code stuff\idea_reminder\bin\idea-reminder.js\" scan --daily --notify"
```

Change `/ST 22:00` to your T. Remove with `schtasks /Delete /TN "idea-reminder" /F`.

## Configuration — `config.json`

| Key | Default | Meaning |
|---|---|---|
| `deltaIdle` | `"3d"` | Idle threshold Δt before queuing. `"3d"`, `"12h"`, `"90m"`. |
| `reportTime` | `"09:00"` | Local time T for the daily report (used by the scheduler). |
| `projectsDir` | `null` | Claude projects dir. `null` → `~/.claude/projects`. |
| `statePath` | `null` | State file. `null` → `<pkg>/state/state.json`. |
| `minMessages` | `1` | Skip sessions with fewer real messages. |
| `maxDetailedItems` | `8` | How many items shown in full per report. |
| `weights.neglectStep` | `1.0` | Weight added per skipped daily report. |
| `weights.idleFactorPerDay` | `0.05` | Weight added per idle day. |
| `excludeCwdContains` | `[]` | Skip sessions whose cwd contains any substring. |
| `excludeProjects` | `[]` | Skip these encoded project folder names. |
| `notify.enabled` | `false` | Turn on the daily notification. |
| `notify.ntfyTopicUrl` | `""` | POST the summary here via `curl` (e.g. an [ntfy](https://ntfy.sh) topic). |
| `notify.command` | `""` | Or run this shell command; `{message}` is replaced by the summary. |

## Commands

| Command | Does |
|---|---|
| `report [--json] [--preview]` | The daily digest (default command). `--preview` = don't count it as today's report. |
| `scan [--daily] [--notify]` | Rescan disk, reconcile state. `--daily` bumps neglect once/day; `--notify` sends the notification. |
| `list [--all]` | One line per queued (or every) session. |
| `archive <id>` | Keep as reference, stop reminding. |
| `dismiss <id>` | Drop from reminders. |
| `activate <id>` | Bring an archived/dismissed one back. |
| `snooze <id> [days=3]` | Hide for N days. |
| `note <id> <text>` | Attach a note (shown in future digests). |
| `resume-cmd <id>` | Print the `cd … && claude --resume …` line to continue it. |
| `status` | Show config, paths, and status counts. |

IDs accept an 8-character prefix.

## Data & privacy

Everything is local. State (`state/state.json`) contains snippets of your prompts for titles/previews and never leaves your machine. idea-reminder **only reads** your session files — it never edits or deletes them.

## Roadmap

- **Cowork** — sessions live locally under `%AppData%\Roaming\Claude\local-agent-mode-sessions\…`; readable but messier structure.
- **claude.ai chat** — no official list API; would need the periodic data-export ZIP or a fragile unofficial cookie API. Lower priority.
- Trend view (which ideas keep resurfacing), and grouping resurfaced ideas into themes.
