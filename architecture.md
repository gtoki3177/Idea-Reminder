# Architecture

How idea reminder works under the hood, and the reasoning behind the design. For install/usage see the [README](README.md).

## Overview

```
~/.claude/projects/**.jsonl  ──scan──►  reconcile ──►  state/state.json  ──report──►  weighted digest
        (data source)          (parse)   (lifecycle)      (local queue)              (what you act on)
```

A zero-dependency Node CLI. Three layers: **read** the session logs, **reconcile** them into a persistent queue with a weight per conversation, **render** the queue as a daily digest you act on.

## Data source

Claude Code writes every conversation as a JSONL log:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl   ← a MAIN session — one "chat room" (tracked)
~/.claude/projects/<encoded-cwd>/<uuid>/…               ← subagents / workflows / tool-results (IGNORED)
~/.claude/projects/<encoded-cwd>/memory/*.md            ← memory files (IGNORED)
```

A trackable "chat room" is exactly a `*.jsonl` file sitting **directly** inside a project folder. Everything nested one level deeper is internal machinery — if you don't skip it, the queue floods with subagent logs. `src/sessions.js` enforces this by only taking `*.jsonl` files that are direct children of a project dir.

### What the parser extracts

Per session, from the JSONL lines:

- **title / firstPrompt** — the first *real* user message (skipping `<system-reminder>`, `<command…>`, tool-results, interrupts). Falls back to the first `queue-operation:enqueue` content.
- **lastUserText** — the most recent real user message ("what you were last doing").
- **messageCount** — real user + assistant turns (an engagement signal).
- **cwd** — read from the log's `cwd` field (exact, unlike the lossy encoded folder name). Used for the resume command and for chain grouping.
- **lastActivity** — the **max timestamp across all lines**. Not every line carries a timestamp (`mode` lines don't), so taking the last line would be wrong; we scan for the maximum, falling back to file mtime.

Parses are **cached** in state keyed by `mtimeMs:size`, so unchanged files are never re-read on subsequent scans.

## Idle and the queue

`idle = now − lastActivity`. When `idle ≥ Δt` (`deltaIdle`, default 3 days) a session enters the **queue**. That's the whole trigger.

## Weight and escalation

```
weight = 1  +  neglectStep × neglectCount  +  idleFactorPerDay × idleDays
```

- **neglectCount** is the escalator — the number of daily reports in which the item was shown and left unresolved. It resets to 0 when you continue the session. This is spaced-repetition inverted: the more you ignore something, the *more* often (higher) it surfaces.
- **idleDays** is a gentle secondary aging term so brand-new-to-the-queue items still order sensibly.

Defaults `neglectStep = 1.0`, `idleFactorPerDay = 0.05` make neglect the dominant term. Highest weight sorts first.

### The daily bump (once per calendar day)

`applyDailyBumpIfNeeded` increments `neglectCount` for every queued item, but only once per local calendar day (guarded by `state.lastDailyRun`). It fires from whichever runs first that day — the scheduled `scan --daily` or an interactive `report`. The **first ever** run only sets the baseline date (no bump), so day-one items start at neglect 0. `report --preview` never bumps.

Consequence: escalation tracks *days you were actually reminded and skipped it* — so it works correctly whether you use the scheduler or just run `report` by hand.

## Lifecycle

```
tracking ⇄ queued          queued when idle ≥ Δt; back to tracking (neglect reset) when resumed
snoozed  → tracking         when snoozeUntil passes
archived / dismissed        terminal, user-set; excluded until `activate`
```

- **Resume detection** — during reconcile, if a queued item's `lastActivity` has advanced past the activity value captured when it was queued, you clearly continued it: it drops out of the queue and neglect resets to 0.
- **Deletion** — if a tracked session's file no longer exists on disk (you deleted the conversation in Claude), reconcile drops it.
- **archive vs dismiss** — both terminal and identical mechanically; the split is semantic (archive = "done, keep as reference"; dismiss = "not worth reminding"). Both accept several ids at once.

## Handoff chains (supersession)

**Problem.** In a long project you blow past the context window and "hand off" to a fresh conversation, again and again. Only the latest link in that chain is live; the predecessors are dead weight in the digest.

**Why not "one session per project"?** Because a project folder (cwd) can hold *independent* threads, not a chain — e.g. a junk-drawer `C:\code stuff` may contain a dozen unrelated ideas. Blanket-collapsing per cwd would wrongly bury them.

**Design: opt-in chain projects.** `chainProjects` is a list of cwd substrings you designate as linear. For a matching project, a session is **superseded** when a newer, still-live session exists in the same cwd — so only the newest link stays queued. Superseded items are:

- excluded from the queue and from neglect bumping (they stop nagging),
- **derived, not stored** — recomputed each run, so it self-corrects: archive/delete the tip and the previous link automatically becomes the new tip,
- non-destructive and reversible — the real session is untouched; `list --all` still shows them tagged `[superseded]`.

`isSuperseded(entry, state, cfg)` in `src/state.js` is the whole implementation. The digest prints how many were auto-hidden.

## Scheduling — why the Desktop task

The scanner reads **local** files, so the scheduler must run on your machine. Claude Code offers three mechanisms:

| | Cloud (Routines) | **Desktop scheduled task** | `/loop` (CronCreate) |
|---|---|---|---|
| Runs on | Anthropic cloud | **your machine** | your machine |
| Sees `~/.claude/projects` | ❌ fresh clone | **✅** | ✅ |
| Survives restart / no open session | ✅ | **✅ (fires on next launch)** | ❌ session-scoped, 7-day expiry |

Only the **Desktop scheduled task** is both local (can read your sessions) and durable — so that's what idea reminder uses. Its prompt is self-contained, so it works without installing the global skill.

## State file

`state/state.json` (git-ignored, local only) holds one record per session: identity, cached facts, `status`, `neglectCount`, `weight`, queue bookkeeping (`queuedAt`, `queuedAtActivity`), `snoozeUntil`, notes, and the `cacheKey` for parse-caching. It contains snippets of your prompts (for titles/previews) and never leaves the machine. idea reminder **only reads** your session `.jsonl` files — it never edits or deletes them.

## Why build instead of install

No existing tool does this. Session browsers (Claude Code Bookmarks, claude-session-manager, CCHV, Mantra, …) *search/replay* sessions but have no idle-detection, digest, or resurfacing. Spaced-repetition digesters (Readwise, Reflect) do the decay/resurface model but for notes, not Claude sessions. idea reminder is the intersection: spaced repetition applied to your AI conversations.

### A note on Claude's own archive

idea reminder can't see whether you archived a conversation *in Claude itself* — that state lives in the desktop app's internal IndexedDB (binary, V8-serialized, undocumented, per-version, locked while running). So the queue's source of truth is idea reminder's own archive/dismiss, which the daily digest prompts you to set. Handoff-chain supersession removes most of the need to archive predecessors by hand.

## Roadmap

- **Cowork** — sessions live locally under `%AppData%\Roaming\Claude\local-agent-mode-sessions\…`; readable but a messier, chunked structure.
- **claude.ai chat** — no official list API; would need the periodic data-export ZIP or a fragile unofficial cookie API. Lower priority.
- Trend view (which ideas keep resurfacing) and theme grouping of resurfaced ideas.
