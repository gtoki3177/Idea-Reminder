# 💡 idea reminder

Resurface **neglected Claude Code conversations** as a weighted daily digest — so dropped work and half-formed ideas don't rot in your session history.

- After a conversation has been idle for **Δt** (default 3 days), it joins the queue.
- Once a day you get a digest that asks, per conversation: **continue, archive, dismiss, or snooze?**
- Neglect one and its **weight climbs** each day, so it pushes harder the longer you ignore it — until you act.

> Tracks **Claude Code** sessions from disk, plus **Cowork / desktop-app** conversations and **Claude's own archive state** via the app's session-management MCP (synced by the daily task — see `sync-desktop`). claude.ai **web chat** is not covered (no usable API).

## Requirements

- **Node.js 18+** (tested on 22) — zero npm dependencies.
- **Claude Code** (desktop app or CLI) — that's where the sessions and the daily scheduler live.

## Install

### Option A — as a Claude Code plugin (recommended)

In Claude Code:

```
/plugin marketplace add gtoki3177/Idea-Reminder
/plugin install idea-reminder@idea-reminder
```

That's it — `/idea-reminder:review` (or just asking "review my conversations" / "回顧我的對話") runs the interactive digest. The CLI ships inside the plugin; your state and config live in `~/.claude/idea-reminder/` and survive plugin updates.

### Option B — git clone (bare CLI)

```bash
git clone https://github.com/gtoki3177/Idea-Reminder.git idea-reminder
cd idea-reminder
node bin/idea-reminder.js status     # sanity check: shows config + where it reads
npm link                             # optional: puts `idea-reminder` on your PATH
idea-reminder report                 # your first digest  (or: node bin/idea-reminder.js report)
```

## Usage

**Plugin install?** Just invoke **`/idea-reminder:review`** (or ask in plain words) — it runs everything below for you, interactively, and executes your decisions. The CLI commands in this section are what the skill runs under the hood; run them directly only on a git-clone install.

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

**Recommended — a Claude Code Desktop scheduled task.** It runs locally, survives restarts, and both updates the queue *and* shows you the digest in-app.

- **Plugin install:** the task prompt is one line — ask Claude:
  > Create a daily scheduled task at 10pm whose prompt is: "Invoke the idea-reminder:review skill and follow it through — sync, digest, then ask me what to do with each item."
- **Git-clone install:** paste the full prompt from [`scheduled-task.md`](scheduled-task.md) instead.

It fires whenever the app is open (or on next launch), then you reply to act on each item. (The git-clone prompt is fully self-contained — it doesn't need any skill installed.)

> The MCP sync step (Cowork + Claude-archive mirroring) only works in the **desktop app**, where the `ccd_session_mgmt` MCP exists. Plain-CLI users still get full Claude Code session tracking — the sync step just skips itself.

### Permissions — avoid daily prompts

**Plugin installs: nothing to configure.** Approve the first run's prompts (pick "always allow", or click **Run now** once on the scheduled task — approvals are remembered per task). A plugin update changes the CLI's cache path, so you may be asked once more after updating.

**Git-clone installs** running unattended should pre-allow the CLI instead. Add these to `~/.claude/settings.json` (adjust the repo path):

```json
{
  "permissions": {
    "allow": [
      "Bash(node \"<absolute-path-to-repo>/bin/idea-reminder.js\" *)",
      "PowerShell(node \"<absolute-path-to-repo>/bin/idea-reminder.js\" *)",
      "Bash(idea-reminder *)",
      "Read(~/.claude/projects/**)"
    ]
  }
}
```

Two approvals can't be pre-granted in settings: the MCP `list_sessions` call and the Write of its output file. Those are remembered **per task** — click **Run now** once after creating the task to grant them, and every later run is fully unattended.

*(Alternative: `schtasks /Create /SC DAILY /ST 22:00 /TN idea-reminder /TR "node \"<repo>\bin\idea-reminder.js\" scan --daily --notify"` runs the scan even when Claude is fully closed; you review later with `report`.)*

### Handoff chains

If you split one project across many hand-off conversations (each superseding the last), chain mode keeps only the **newest live** conversation per workspace in the digest — older links auto-hide (reversible; `list --all` shows them tagged `[superseded]`).

- `chainMode: "auto"` — every workspace chains by itself; list your junk-drawer folders (many unrelated ideas sharing one cwd) in `independentProjects` to exempt them.
- `chainMode: "list"` (default) — only workspaces matching a `chainProjects` substring chain.
- `chainMode: "off"` — never.

### As a standalone skill (git-clone installs only)

The plugin already ships the skill. On a bare git clone, copy `skills/review/SKILL.md` to `~/.claude/skills/idea-reminder/SKILL.md` to get the same interactive review on demand.

## Commands

| Command | Does |
|---|---|
| `report [--json] [--preview]` | The daily digest (default). `--preview` = don't count it as today's report. |
| `scan [--daily] [--notify]` | Rescan disk, reconcile state. `--daily` bumps neglect once/day; `--notify` sends the notification. |
| `list [--all]` | One line per queued session (`--all` = every session, superseded ones tagged). |
| `sync-desktop <json>` | Sync from a saved `list_sessions` MCP output: mirrors Claude's archive state onto matched sessions and ingests Cowork/desktop conversations. The daily task does this automatically. |
| `archive / dismiss / activate <id...>` | Resolve (or un-resolve) one or several sessions. |
| `snooze <id> [days=3]` · `note <id> <text>` · `resume-cmd <id>` | Hide for N days · attach a note · print the resume command. |
| `status` | Show config, paths, chain projects, and counts. |

## Configuration

Config is layered, later wins: `config.json` (shipped defaults — leave it alone) ← **`~/.claude/idea-reminder/config.json`** (your overrides — the right place for plugin installs, survives updates) ← `config.local.json` in the repo (gitignored, for git-clone installs) ← `$IDEA_REMINDER_CONFIG`. Put only the keys you override. Example:

```json
{
  "chainMode": "auto",
  "independentProjects": ["C:\\path\\to\\your\\junk-drawer-folder"],
  "excludeTitles": ["<your daily task name>"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `deltaIdle` | `"3d"` | Idle threshold Δt before queuing (`"3d"`, `"12h"`, `"90m"`). |
| `locale` | `"en"` | CLI output language (`"en"` or `"zh-TW"`). Skill-mediated digests follow your conversation language regardless. |
| `reportTime` | `"09:00"` | Local time T for the daily report (used by the scheduler). |
| `chainMode` | `"list"` | Hand-off chain detection: `"off"`, `"list"` (only `chainProjects`), or `"auto"` (every workspace except `independentProjects`). |
| `chainProjects` | `[]` | list mode: cwd substrings that are hand-off chains. |
| `independentProjects` | `[]` | auto mode: exact cwds exempt from chaining (folders of unrelated one-off ideas). |
| `excludeTitles` | `[]` | Desktop sync: skip sessions with these exact titles. **Add your daily digest task's name here** so its own runs don't get tracked. |
| `maxDetailedItems` | `8` | How many items shown in full per report. |
| `weights.neglectStep` · `weights.idleFactorPerDay` | `1.0` · `0.05` | Weight added per skipped report · per idle day. |
| `minMessages` | `1` | Skip sessions with fewer real messages. |
| `excludeCwdContains` · `excludeProjects` | `[]` | Skip sessions by cwd substring / encoded project name. |
| `projectsDir` · `statePath` | `null` | Override the Claude projects dir / state file (null = sensible defaults). |
| `notify.enabled` · `notify.ntfyTopicUrl` · `notify.command` | `false` · `""` · `""` | Optional daily push (e.g. an [ntfy](https://ntfy.sh) topic, or any shell command with `{message}`). |

## Data & privacy

Everything is local. State lives in `~/.claude/idea-reminder/state.json` — it holds prompt snippets for titles/previews and never leaves your machine. idea reminder **only reads** your session files — it never edits or deletes them.
