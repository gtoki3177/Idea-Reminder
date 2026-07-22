'use strict';
// State store + lifecycle for tracked sessions.
//
// Lifecycle:
//   tracking  <-> queued        (queued when idle >= Δt; back to tracking when resumed)
//   snoozed   -> tracking       (when snoozeUntil passes)
//   archived / dismissed        (terminal; user-set; never re-queue until `activate`)
//
// "Neglect" (weight escalator): each daily report where a queued item is left
// unresolved bumps neglectCount by one. Resuming the session resets it to 0.
const fs = require('fs');
const path = require('path');

function loadState(statePath) {
  if (fs.existsSync(statePath)) {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
    catch (e) { throw new Error(`Corrupt state ${statePath}: ${e.message}`); }
  }
  return { version: 1, lastDailyRun: null, generatedAt: null, sessions: {} };
}

function saveState(statePath, state, now) {
  state.generatedAt = new Date(now || Date.now()).toISOString();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function dayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

const FACT_KEYS = ['title', 'firstPrompt', 'lastUserText', 'messageCount', 'firstActivity', 'lastActivity', 'cwd', 'sizeKB', 'isScheduledRun', 'isArchivedInApp'];
function pickFacts(entry) {
  const f = {};
  for (const k of FACT_KEYS) f[k] = entry[k];
  return f;
}

// Sync state with what's on disk. parseFn(path, mtimeMs) -> facts.
function reconcile(state, files, parseFn, cfg, now) {
  const present = new Set();

  for (const f of files) {
    // v3: parser version prefix — bumping it re-parses everything once.
    const cacheKey = `v3:${Math.round(f.mtimeMs)}:${f.size}`;
    let entry = state.sessions[f.id];

    // Reuse cached parse when the file hasn't changed since we last saw it.
    let facts;
    if (entry && entry.cacheKey === cacheKey && entry.title !== undefined) facts = pickFacts(entry);
    else facts = parseFn(f.path, f.mtimeMs, f);

    const cwd = facts.cwd || '';
    const excludedCwd = (cfg.excludeCwdContains || []).some(s => s && cwd.includes(s));
    const excludedProj = (cfg.excludeProjects || []).includes(f.project);
    const excludedTitle = (cfg.excludeTitles || []).some(x => x && String(facts.title || '').trim() === String(x).trim());
    const meaningful = (facts.messageCount || 0) >= cfg.minMessages ||
      (facts.title && facts.title !== '(untitled session)');
    if (excludedCwd || excludedProj || excludedTitle || facts.isScheduledRun || !meaningful) {
      delete state.sessions[f.id]; // was tracked but no longer qualifies
      continue;
    }

    present.add(f.id);
    if (!entry) {
      entry = state.sessions[f.id] = {
        id: f.id, status: 'tracking', neglectCount: 0, weight: 0,
        queuedAt: null, queuedAtActivity: null, lastReportDate: null,
        snoozeUntil: null, resolvedReason: null, resolvedAt: null, notes: null,
      };
    }
    entry.project = f.project;
    entry.path = f.path;
    entry.cacheKey = cacheKey;
    if (f.source) entry.source = f.source;   // 'cowork'; plain Code sessions leave it unset
    Object.assign(entry, facts);

    // Mirror the app's own archive flag (cowork metadata). One-way per origin:
    // only archives we made from this flag are un-archived when the app un-archives.
    if (facts.isArchivedInApp !== undefined) {
      if (facts.isArchivedInApp && entry.status !== 'archived' && entry.status !== 'dismissed') {
        entry.status = 'archived';
        entry.resolvedReason = 'claude-archived';
        entry.resolvedAt = new Date(now).toISOString();
      } else if (!facts.isArchivedInApp && entry.status === 'archived' && entry.resolvedReason === 'claude-archived') {
        entry.status = 'tracking';
        entry.resolvedReason = null;
        entry.resolvedAt = null;
      }
    }

    applyLifecycle(entry, cfg, now);
  }

  // Drop sessions that no longer exist on disk (deleted in Claude).
  // Desktop-sourced entries (from sync-desktop) have no jsonl file: keep them.
  for (const id of Object.keys(state.sessions)) {
    if (!present.has(id) && state.sessions[id].source !== 'desktop') delete state.sessions[id];
  }

  // Desktop-sourced entries run the same lifecycle (queue/idle/snooze/resume).
  for (const e of Object.values(state.sessions)) {
    if (e.source === 'desktop') applyLifecycle(e, cfg, now);
  }
}

// Shared lifecycle: un-snooze, resume-detect, (re)queue by idleness.
function applyLifecycle(entry, cfg, now) {
  const lastActMs = Date.parse(entry.lastActivity) || 0;

  // Un-snooze when the timer elapses.
  if (entry.status === 'snoozed' && entry.snoozeUntil && now >= Date.parse(entry.snoozeUntil)) {
    entry.snoozeUntil = null;
    entry.status = 'tracking';
  }

  // Resume detection: real activity happened after we queued it -> user continued.
  if (entry.status === 'queued' && entry.queuedAtActivity && lastActMs > Date.parse(entry.queuedAtActivity)) {
    entry.status = 'tracking';
    entry.neglectCount = 0;
    entry.queuedAt = null;
    entry.queuedAtActivity = null;
    entry.resolvedReason = 'resumed';
    entry.resolvedAt = new Date(now).toISOString();
  }

  // Terminal / paused states are left as-is.
  if (entry.status === 'archived' || entry.status === 'dismissed' || entry.status === 'snoozed') return;

  // (Re)queue based on idleness.
  const idleMs = now - lastActMs;
  if (idleMs >= cfg.deltaIdleMs) {
    if (entry.status !== 'queued') {
      entry.status = 'queued';
      entry.queuedAt = entry.queuedAt || new Date(now).toISOString();
      entry.queuedAtActivity = entry.lastActivity;
      entry.resolvedReason = null;
      entry.resolvedAt = null;
    }
  } else {
    entry.status = 'tracking';
    entry.queuedAt = null;
    entry.queuedAtActivity = null;
  }
}

// Bump neglect once per calendar day. The first ever run only establishes the
// baseline date (no bump), so day-one items start at neglect 0.
function applyDailyBumpIfNeeded(state, todayKey, cfg) {
  if (state.lastDailyRun === todayKey) return false;
  const firstEver = state.lastDailyRun === null;
  if (!firstEver) {
    for (const e of Object.values(state.sessions)) {
      if (e.status === 'queued' && !isSuperseded(e, state, cfg || {})) {
        e.neglectCount = (e.neglectCount || 0) + 1;
        e.lastReportDate = todayKey;
      }
    }
  }
  state.lastDailyRun = todayKey;
  return !firstEver;
}

function normPath(p) {
  return String(p || '').replace(/[\\/]+$/, '').toLowerCase();
}

// Is this cwd governed by hand-off-chain semantics?
//   chainMode "off"  -> never
//   chainMode "list" -> only cwds matching a chainProjects substring (default)
//   chainMode "auto" -> every workspace, EXCEPT exact cwds listed in
//                       independentProjects (junk-drawer folders whose
//                       conversations are unrelated ideas, not a chain)
function isChainCwd(cwd, cfg) {
  if (!cwd) return false;
  const mode = cfg.chainMode || 'list';
  if (mode === 'off') return false;
  if (mode === 'auto') {
    const c = normPath(cwd);
    return !(cfg.independentProjects || []).some(p => p && normPath(p) === c);
  }
  const lc = cwd.toLowerCase();
  return (cfg.chainProjects || []).some(s => s && lc.includes(String(s).toLowerCase()));
}

// Superseded = its cwd is a chain AND a newer, still-live session exists in
// the same cwd. You handed off to a later conversation, so this predecessor no
// longer needs surfacing. Reversible: it re-appears if the newer sibling is
// archived/dismissed/deleted.
function isSuperseded(entry, state, cfg) {
  if (!entry || !isChainCwd(entry.cwd, cfg)) return false;
  const mine = Date.parse(entry.lastActivity) || 0;
  for (const e of Object.values(state.sessions)) {
    if (e === entry || e.cwd !== entry.cwd) continue;
    if (e.status === 'archived' || e.status === 'dismissed') continue;
    if ((Date.parse(e.lastActivity) || 0) > mine) return true;
  }
  return false;
}

function computeWeight(entry, cfg, now) {
  const lastActMs = Date.parse(entry.lastActivity) || now;
  const idleDays = Math.max(0, (now - lastActMs) / 86400000);
  const w = 1
    + cfg.weights.neglectStep * (entry.neglectCount || 0)
    + cfg.weights.idleFactorPerDay * idleDays;
  entry.weight = Math.round(w * 100) / 100;
  return entry.weight;
}

function queuedItems(state, cfg, now) {
  const items = Object.values(state.sessions).filter(e => e.status === 'queued' && !isSuperseded(e, state, cfg));
  for (const e of items) computeWeight(e, cfg, now);
  items.sort((a, b) => (b.weight - a.weight) || ((Date.parse(a.lastActivity) || 0) - (Date.parse(b.lastActivity) || 0)));
  return items;
}

// --- Desktop (Claude app) session sync --------------------------------------
// `entries` is the parsed output of the app's ccd_session_mgmt list_sessions
// MCP tool: [{sessionId:"local_…", title, cwd, isArchived, isRunning,
// lastActivityAt}]. Two jobs:
//   1. Mirror Claude's own archive state onto the matched Code (jsonl) session
//      — matched by exact cwd + nearest lastActivity within tolerance, since
//      the desktop id and the jsonl uuid are different namespaces.
//   2. Ingest desktop-only conversations (Cowork / local-agent) as first-class
//      tracked entries (source: "desktop").
// Mirroring is one-way per origin: only entries WE archived via this sync
// (resolvedReason "claude-archived") are un-archived when Claude un-archives;
// the user's manual archive/dismiss in idea-reminder is never overridden.
const DESKTOP_MATCH_TOLERANCE_MS = 30 * 60 * 1000;

function syncDesktop(state, entries, cfg, now) {
  const out = { archivedSynced: 0, unarchivedSynced: 0, ingested: 0, updated: 0, skipped: 0 };
  const jsonlSessions = Object.values(state.sessions).filter(e => e.source !== 'desktop');
  const isExcluded = t => (cfg.excludeTitles || []).some(x => x && String(t || '').trim() === String(x).trim());

  const mirrorArchive = (e, d) => {
    if (d.isArchived && e.status !== 'archived' && e.status !== 'dismissed') {
      e.status = 'archived';
      e.resolvedReason = 'claude-archived';
      e.resolvedAt = new Date(now).toISOString();
      out.archivedSynced++;
    } else if (!d.isArchived && e.status === 'archived' && e.resolvedReason === 'claude-archived') {
      e.status = 'tracking';
      e.resolvedReason = null;
      e.resolvedAt = null;
      out.unarchivedSynced++;
    }
  };

  for (const d of entries || []) {
    if (!d || !d.sessionId) continue;
    if (isExcluded(d.title)) { out.skipped++; continue; }   // scheduled-task/routine runs etc.
    const dTime = Date.parse(d.lastActivityAt) || 0;

    // 1) Match a tracked Code (jsonl) session: same cwd, nearest activity time.
    let best = null, bestDelta = Infinity;
    for (const e of jsonlSessions) {
      if (normPath(e.cwd) !== normPath(d.cwd)) continue;
      const delta = Math.abs((Date.parse(e.lastActivity) || 0) - dTime);
      if (delta < bestDelta) { best = e; bestDelta = delta; }
    }
    if (best && bestDelta <= DESKTOP_MATCH_TOLERANCE_MS) {
      best.desktopId = d.sessionId;
      // Keep the app's curated title in a separate field: reconcile refreshes
      // `title` from the jsonl on every scan, so it must not be overwritten.
      if (d.title) best.titleOverride = d.title;
      mirrorArchive(best, d);
      out.updated++;
      continue;
    }

    // 2) Desktop-only conversation (Cowork / local-agent) -> track it.
    if (d.isRunning) { out.skipped++; continue; }
    let e = state.sessions[d.sessionId];
    if (!e) {
      e = state.sessions[d.sessionId] = {
        id: d.sessionId, source: 'desktop', status: 'tracking',
        neglectCount: 0, weight: 0, queuedAt: null, queuedAtActivity: null,
        lastReportDate: null, snoozeUntil: null, resolvedReason: null,
        resolvedAt: null, notes: null, messageCount: 0, sizeKB: 0,
        firstPrompt: '', lastUserText: '', firstActivity: d.lastActivityAt || null,
      };
      out.ingested++;
    }
    e.title = d.title || e.title || '(untitled)';
    e.cwd = d.cwd || e.cwd || '';
    e.project = e.project || 'desktop';
    e.lastActivity = d.lastActivityAt || e.lastActivity;
    mirrorArchive(e, d);
  }
  return out;
}

module.exports = {
  loadState, saveState, dayKey, reconcile,
  applyDailyBumpIfNeeded, computeWeight, queuedItems, isSuperseded,
  syncDesktop,
};
