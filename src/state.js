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

const FACT_KEYS = ['title', 'firstPrompt', 'lastUserText', 'messageCount', 'firstActivity', 'lastActivity', 'cwd', 'sizeKB'];
function pickFacts(entry) {
  const f = {};
  for (const k of FACT_KEYS) f[k] = entry[k];
  return f;
}

// Sync state with what's on disk. parseFn(path, mtimeMs) -> facts.
function reconcile(state, files, parseFn, cfg, now) {
  const present = new Set();

  for (const f of files) {
    const cacheKey = `${Math.round(f.mtimeMs)}:${f.size}`;
    let entry = state.sessions[f.id];

    // Reuse cached parse when the file hasn't changed since we last saw it.
    let facts;
    if (entry && entry.cacheKey === cacheKey && entry.title !== undefined) facts = pickFacts(entry);
    else facts = parseFn(f.path, f.mtimeMs);

    const cwd = facts.cwd || '';
    const excludedCwd = (cfg.excludeCwdContains || []).some(s => s && cwd.includes(s));
    const excludedProj = (cfg.excludeProjects || []).includes(f.project);
    const meaningful = (facts.messageCount || 0) >= cfg.minMessages ||
      (facts.title && facts.title !== '(untitled session)');
    if (excludedCwd || excludedProj || !meaningful) {
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
    Object.assign(entry, facts);

    const lastActMs = Date.parse(entry.lastActivity) || f.mtimeMs;

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
    if (entry.status === 'archived' || entry.status === 'dismissed' || entry.status === 'snoozed') continue;

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

  // Drop sessions that no longer exist on disk (deleted in Claude).
  for (const id of Object.keys(state.sessions)) {
    if (!present.has(id)) delete state.sessions[id];
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

function matchesChain(cwd, cfg) {
  if (!cwd) return false;
  const c = cwd.toLowerCase();
  return (cfg.chainProjects || []).some(s => s && c.includes(String(s).toLowerCase()));
}

// Superseded = belongs to a configured chain project AND a newer, still-live
// session exists in the same project (cwd). You handed off to a later
// conversation, so this predecessor no longer needs surfacing. Reversible: it
// re-appears if the newer sibling is archived/dismissed/deleted.
function isSuperseded(entry, state, cfg) {
  if (!entry || !matchesChain(entry.cwd, cfg)) return false;
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

module.exports = {
  loadState, saveState, dayKey, reconcile,
  applyDailyBumpIfNeeded, computeWeight, queuedItems, isSuperseded,
};
