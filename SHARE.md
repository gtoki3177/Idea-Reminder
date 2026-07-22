# idea reminder — what it is, what it uses, how to run it

A tiny tool that resurfaces **the Claude Code conversations you dropped**. Half-formed ideas and unfinished work pile up in your session history and rot silently. idea reminder finds the ones you've stopped touching, and once a day asks: *continue, archive, or let go?* The longer you ignore one, the harder it nudges — spaced repetition, applied to your own AI conversations.

## What you get

- **A weighted daily digest** of every Claude Code conversation idle longer than Δt (default 3 days).
- **Escalation**: skip a conversation in the digest and its weight rises the next day, and the next — until you continue it, archive it, or dismiss it. Nothing quietly falls through.
- **One-tap actions** per conversation: continue (prints the exact `claude --resume` line), archive, dismiss, snooze N days, or attach a note.
- **Two purposes in one**: a nag for dropped progress, and a place where inspiration settles and resurfaces after it's had time to compost.
- **Read-only and local**: it never edits or deletes your real session files, and nothing leaves your machine.

## How it works (30 seconds)

Claude Code stores every conversation as a JSONL log under `~/.claude/projects/`. A small Node scanner reads those, works out how long each has been idle (`now − last activity`), and keeps a local queue with a weight per conversation:

```
weight = 1  +  neglectStep × (daily reports you skipped it)  +  idleFactor × (idle days)
```

Continue a conversation and it drops out of the queue with its neglect reset. Delete it in Claude and the scanner forgets it on the next run. That's the whole model.

## What it uses (prerequisites)

| Component | Role | Required? |
| --- | --- | --- |
| **Claude Code** (desktop app / CLI) | The environment. Provides the session logs it reads, plus the scheduler and skill features. | Yes |
| **Node.js 18+** | Runs the scanner CLI. **Zero npm dependencies.** | Yes |
| **Claude Code Desktop scheduled task** | Fires the digest once a day and presents it in-app, interactively. Runs locally, persists across restarts. | For the daily auto-digest (else run it by hand) |
| A Claude Code **skill** (`/idea-reminder`) | Optional on-demand review by command. | Optional |
| **ntfy** (or any webhook) | Optional phone push when the daily scan runs. | Optional |

> It tracks **Claude Code** sessions only. (Cowork and claude.ai chat live elsewhere and aren't wired up — see the README roadmap.) So it's useful to anyone who works in Claude Code and accumulates exploratory sessions.

## Install (about 2 minutes)

```bash
git clone <repo-url> idea-reminder     # or unzip the folder
cd idea-reminder
node bin/idea-reminder.js status        # sanity check: shows config + where it'll read
npm link                                # optional: puts `idea-reminder` on your PATH
idea-reminder report                    # see your first digest
```

Then set up the once-a-day delivery — just ask Claude Code to schedule it, pasting the prompt from [`scheduled-task.md`](scheduled-task.md):

> Create a daily scheduled task at 10pm that runs the idea-reminder prompt.

That's it. The task runs whenever the app is open (or on next launch), shows you the digest, and you reply to act on each item. Full command and config reference is in the [README](README.md).
