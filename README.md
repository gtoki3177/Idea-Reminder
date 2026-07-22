# 💡 idea reminder

Resurface **neglected Claude Code conversations** as a weighted daily digest — so dropped work and half-formed ideas don't rot in your session history.

- After a conversation has been idle for **Δt** (default 3 days), it joins the queue.
- Once a day you get a digest that asks, per conversation: **continue, archive, dismiss, or snooze?**
- Neglect one and its **weight climbs** each day, so it pushes harder the longer you ignore it — until you act.

> Tracks **Claude Code** sessions only (for now).

## Requirements

- **Node.js 18+** (tested on 22) — zero npm dependencies.
- **Claude Code** (desktop app or CLI) — that's where the sessions and the daily scheduler live.

## Install

```bash
git clone https://github.com/gtoki3177/Idea-Reminder.git idea-reminder
cd idea-reminder
node bin/idea-reminder.js status     # sanity check: shows config + where it reads
npm link                             # optional: puts `idea-reminder` on your PATH
idea-reminder report                 # your first digest  (or: node bin/idea-reminder.js report)
```

## Usage

### The daily digest

`idea-reminder report` prints the queue, highest weight first, each with its title, project, idle days, how many times you've skipped it, and the last thing you were doing. Then you act on each (an 8-char id prefix is enough):

```bash
idea-reminder archive  <id...>    # done / keep as reference — stop reminding (several ids ok)
idea-reminder dismiss  <id...>    # not worth reminding — drop it
idea-reminder snooze   <id> 5     # hide for 5 days
idea-reminder note     <id> "text"# attach a note (shows in future digests)
idea-reminder resume-cmd <id>     # print the `cd … && claude --resume …` line to continue it
idea-reminder activate <id...>    # bring an archived/dismissed one back
```

`report --preview` shows the digest without counting it as today's report.

### Set up the once-a-day trigger

**Recommended — a Claude Code Desktop scheduled task.** It runs locally, survives restarts, and both updates the queue *and* shows you the digest in-app. Just ask Claude Code to schedule it, pasting the prompt from [`scheduled-task.md`](scheduled-task.md):

> Create a daily scheduled task at 10pm that runs the idea-reminder prompt.

It fires whenever the app is open (or on next launch), then you reply to act on each item. No global skill needed — the task prompt is self-contained.

*(Alternative: `schtasks /Create /SC DAILY /ST 22:00 /TN idea-reminder /TR "node \"<repo>\bin\idea-reminder.js\" scan --daily --notify"` runs the scan even when Claude is fully closed; you review later with `report`.)*

### Handoff chains

If you split one project across many hand-off conversations (each superseding the last), chain mode keeps only the **newest live** conversation per workspace in the digest — older links auto-hide (reversible; `list --all` shows them tagged `[superseded]`).

- `chainMode: "auto"` — every workspace chains by itself; list your junk-drawer folders (many unrelated ideas sharing one cwd) in `independentProjects` to exempt them.
- `chainMode: "list"` (default) — only workspaces matching a `chainProjects` substring chain.
- `chainMode: "off"` — never.

### As a Claude Code skill (optional)

Copy `skill/SKILL.md` to `~/.claude/skills/idea-reminder/SKILL.md`. Then `/idea-reminder` (or "回顧我的對話") runs the interactive review on demand.

## Commands

| Command | Does |
|---|---|
| `report [--json] [--preview]` | The daily digest (default). `--preview` = don't count it as today's report. |
| `scan [--daily] [--notify]` | Rescan disk, reconcile state. `--daily` bumps neglect once/day; `--notify` sends the notification. |
| `list [--all]` | One line per queued session (`--all` = every session, superseded ones tagged). |
| `archive / dismiss / activate <id...>` | Resolve (or un-resolve) one or several sessions. |
| `snooze <id> [days=3]` · `note <id> <text>` · `resume-cmd <id>` | Hide for N days · attach a note · print the resume command. |
| `status` | Show config, paths, chain projects, and counts. |

## Configuration — `config.json`

| Key | Default | Meaning |
|---|---|---|
| `deltaIdle` | `"3d"` | Idle threshold Δt before queuing (`"3d"`, `"12h"`, `"90m"`). |
| `reportTime` | `"09:00"` | Local time T for the daily report (used by the scheduler). |
| `chainMode` | `"list"` | Hand-off chain detection: `"off"`, `"list"` (only `chainProjects`), or `"auto"` (every workspace except `independentProjects`). |
| `chainProjects` | `[]` | list mode: cwd substrings that are hand-off chains. |
| `independentProjects` | `[]` | auto mode: exact cwds exempt from chaining (folders of unrelated one-off ideas). |
| `maxDetailedItems` | `8` | How many items shown in full per report. |
| `weights.neglectStep` · `weights.idleFactorPerDay` | `1.0` · `0.05` | Weight added per skipped report · per idle day. |
| `minMessages` | `1` | Skip sessions with fewer real messages. |
| `excludeCwdContains` · `excludeProjects` | `[]` | Skip sessions by cwd substring / encoded project name. |
| `projectsDir` · `statePath` | `null` | Override the Claude projects dir / state file (null = sensible defaults). |
| `notify.enabled` · `notify.ntfyTopicUrl` · `notify.command` | `false` · `""` · `""` | Optional daily push (e.g. an [ntfy](https://ntfy.sh) topic, or any shell command with `{message}`). |

## Data & privacy

Everything is local. `state/state.json` (git-ignored) holds prompt snippets for titles/previews and never leaves your machine. idea reminder **only reads** your session files — it never edits or deletes them.
