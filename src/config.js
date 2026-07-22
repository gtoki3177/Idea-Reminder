'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  deltaIdle: '3d',            // idle threshold before a session enters the queue
  reportTime: '09:00',        // local time T for the daily report (used by the scheduler)
  projectsDir: null,          // null -> ~/.claude/projects
  statePath: null,            // null -> <pkg>/state/state.json
  minMessages: 1,             // ignore sessions with fewer real messages than this
  maxDetailedItems: 8,        // how many items to show in full in a report
  weights: {
    neglectStep: 1.0,         // weight added per daily report the user skips it
    idleFactorPerDay: 0.05,   // weight added per day of idleness (secondary signal)
  },
  excludeCwdContains: [],     // skip sessions whose cwd contains any of these substrings
  excludeProjects: [],        // skip sessions in these encoded project folder names
  notify: { enabled: false, ntfyTopicUrl: '', command: '' },
};

function parseDurationMs(v) {
  if (typeof v === 'number' && isFinite(v)) return v * 86400000; // bare number = days
  const m = /^\s*(\d+(?:\.\d+)?)\s*([dhm])\s*$/i.exec(String(v));
  if (!m) throw new Error(`Invalid duration "${v}" (use e.g. "3d", "12h", "90m")`);
  const n = parseFloat(m[1]);
  const mult = { d: 86400000, h: 3600000, m: 60000 }[m[2].toLowerCase()];
  return n * mult;
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    const bv = base[k];
    const ov = over[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[k] = ov;
    }
  }
  return out;
}

function loadConfig() {
  const configPath = process.env.IDEA_REMINDER_CONFIG || path.join(PKG_ROOT, 'config.json');
  let user = {};
  if (fs.existsSync(configPath)) {
    try { user = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (e) { throw new Error(`Failed to parse config ${configPath}: ${e.message}`); }
  }
  const cfg = deepMerge(DEFAULTS, user);
  cfg.pkgRoot = PKG_ROOT;
  cfg.configPath = configPath;
  cfg.projectsDir = cfg.projectsDir || path.join(os.homedir(), '.claude', 'projects');
  cfg.statePath = cfg.statePath || path.join(PKG_ROOT, 'state', 'state.json');
  cfg.deltaIdleMs = parseDurationMs(cfg.deltaIdle);
  return cfg;
}

module.exports = { loadConfig, parseDurationMs, PKG_ROOT };
