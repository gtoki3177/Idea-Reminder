#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { listSessionFiles, parseSession } = require('../src/sessions');
const { listCoworkSessions, parseCoworkSession } = require('../src/cowork');
const S = require('../src/state');
const { buildReport, renderMarkdown, t } = require('../src/report');

function resolveId(state, arg) {
  if (!arg) throw new Error('missing <id>');
  if (state.sessions[arg]) return arg;
  const matches = Object.keys(state.sessions).filter(id => id.startsWith(arg));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`no tracked session matches "${arg}"`);
  throw new Error(`ambiguous id "${arg}" -> ${matches.length} matches; use more characters`);
}

function mutateStatus(state, id, cmd, now) {
  const e = state.sessions[id];
  if (cmd === 'activate') {
    e.status = 'tracking';
    e.neglectCount = 0;
    e.queuedAt = null;
    e.queuedAtActivity = null;
    e.snoozeUntil = null;
    e.resolvedReason = null;
    e.resolvedAt = null;
  } else {
    e.status = cmd === 'archive' ? 'archived' : 'dismissed';
    e.resolvedReason = cmd;
    e.resolvedAt = new Date(now).toISOString();
  }
}

function notify(cfg, state, now) {
  if (!cfg.notify || !cfg.notify.enabled) return;
  const q = S.queuedItems(state, cfg, now);
  const s = t(cfg.locale);
  const msg = q.length
    ? s.notifySome(q.length, ((q[0].titleOverride || q[0].title) || '').slice(0, 40))
    : s.notifyEmpty;
  try {
    if (cfg.notify.ntfyTopicUrl) {
      require('child_process').execFileSync('curl', ['-s', '-d', msg, cfg.notify.ntfyTopicUrl], { stdio: 'ignore' });
    } else if (cfg.notify.command) {
      require('child_process').execSync(cfg.notify.command.replace('{message}', JSON.stringify(msg)), { stdio: 'ignore' });
    }
  } catch { /* notifications are best-effort */ }
}

// One-time migration: state used to live inside the package (state/state.json),
// which plugin updates and re-clones would wipe.
function migrateLegacyState(cfg) {
  try {
    if (fs.existsSync(cfg.statePath)) return;
    const legacy = path.join(cfg.pkgRoot, 'state', 'state.json');
    if (!fs.existsSync(legacy)) return;
    fs.mkdirSync(path.dirname(cfg.statePath), { recursive: true });
    fs.copyFileSync(legacy, cfg.statePath);
    fs.renameSync(legacy, legacy + '.migrated');
    process.stderr.write(`(state migrated -> ${cfg.statePath})\n`);
  } catch { /* best-effort; a fresh state is built on next scan anyway */ }
}

function syncFromDisk(state, cfg, now) {
  const files = listSessionFiles(cfg.projectsDir)
    .concat(listCoworkSessions(cfg.coworkDir));
  const parseAny = (p, m, f) => (f && f.source === 'cowork') ? parseCoworkSession(p, m) : parseSession(p, m);
  S.reconcile(state, files, parseAny, cfg, now);
  return files.length;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'report';
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const pos = argv.slice(1).filter(a => !a.startsWith('--'));

  const cfg = loadConfig();
  const now = Date.now();
  const today = S.dayKey(now);
  migrateLegacyState(cfg);
  const state = S.loadState(cfg.statePath);

  switch (cmd) {
    case 'scan': {
      const n = syncFromDisk(state, cfg, now);
      if (flags.has('--daily')) S.applyDailyBumpIfNeeded(state, today, cfg);
      const q = S.queuedItems(state, cfg, now);
      S.saveState(cfg.statePath, state, now);
      if (flags.has('--notify')) notify(cfg, state, now);
      process.stdout.write(
        `Scanned ${n} sessions · tracked ${Object.keys(state.sessions).length} · queued ${q.length}` +
        `${flags.has('--daily') ? ' · daily bump applied' : ''}\n`);
      break;
    }

    case 'report': {
      syncFromDisk(state, cfg, now);
      if (!flags.has('--preview')) S.applyDailyBumpIfNeeded(state, today, cfg); // review == the daily report
      const q = S.queuedItems(state, cfg, now);
      S.saveState(cfg.statePath, state, now);
      const supersededCount = Object.values(state.sessions)
        .filter(e => e.status === 'queued' && S.isSuperseded(e, state, cfg)).length;
      const rep = buildReport(state, cfg, now, q, supersededCount);
      process.stdout.write((flags.has('--json') ? JSON.stringify(rep, null, 2) : renderMarkdown(rep)) + '\n');
      break;
    }

    case 'list': {
      syncFromDisk(state, cfg, now);
      S.queuedItems(state, cfg, now); // refresh weights
      S.saveState(cfg.statePath, state, now);
      const showAll = flags.has('--all');
      const all = Object.values(state.sessions)
        .filter(e => showAll || (e.status === 'queued' && !S.isSuperseded(e, state, cfg)))
        .sort((a, b) => (b.weight || 0) - (a.weight || 0));
      if (!all.length) { process.stdout.write('(nothing queued)\n'); break; }
      for (const e of all) {
        const sup = S.isSuperseded(e, state, cfg) ? ' [superseded]' : '';
        process.stdout.write(
          `${e.status.padEnd(9)} w${String(e.weight || 0).padStart(6)} n${e.neglectCount || 0} ` +
          `${e.id.slice(0, 8)} ${(e.titleOverride || e.title || '').slice(0, 64)}${sup}\n`);
      }
      break;
    }

    case 'sync-desktop': {
      // pos[0] = path to a JSON file holding the ccd list_sessions MCP output
      if (!pos[0]) throw new Error('sync-desktop needs <path-to-list_sessions-json>');
      const raw = require('fs').readFileSync(pos[0], 'utf8');
      let entries = JSON.parse(raw);
      if (!Array.isArray(entries)) entries = entries.sessions || entries.result || [];
      const r = S.syncDesktop(state, entries, cfg, now);
      syncFromDisk(state, cfg, now);   // re-run lifecycle so new/changed entries queue correctly
      S.saveState(cfg.statePath, state, now);
      process.stdout.write(
        `sync-desktop: ${entries.length} entries · matched+updated ${r.updated} ` +
        `· archived⇄ ${r.archivedSynced}/${r.unarchivedSynced} · ingested ${r.ingested} · skipped ${r.skipped}\n`);
      break;
    }

    case 'archive':
    case 'dismiss':
    case 'activate': {
      if (!pos.length) throw new Error(`${cmd} needs at least one <id>`);
      const ids = pos.map(p => resolveId(state, p));   // accepts several ids at once
      for (const id of ids) mutateStatus(state, id, cmd, now);
      S.saveState(cfg.statePath, state, now);
      process.stdout.write(`${cmd}: ${ids.join(', ')}\n`);
      break;
    }

    case 'snooze': {
      const id = resolveId(state, pos[0]);
      const days = parseFloat(pos[1] || '3');
      if (!isFinite(days) || days <= 0) throw new Error('snooze needs a positive number of days');
      const e = state.sessions[id];
      e.status = 'snoozed';
      e.snoozeUntil = new Date(now + days * 86400000).toISOString();
      S.saveState(cfg.statePath, state, now);
      process.stdout.write(`snoozed ${id} until ${e.snoozeUntil.slice(0, 10)}\n`);
      break;
    }

    case 'note': {
      const id = resolveId(state, pos[0]);
      state.sessions[id].notes = pos.slice(1).join(' ') || null;
      S.saveState(cfg.statePath, state, now);
      process.stdout.write(`noted ${id}\n`);
      break;
    }

    case 'resume-cmd': {
      const id = resolveId(state, pos[0]);
      const e = state.sessions[id];
      process.stdout.write((e.cwd ? `cd "${e.cwd}" && ` : '') + `claude --resume ${id}\n`);
      break;
    }

    case 'status': {
      const counts = {};
      for (const e of Object.values(state.sessions)) counts[e.status] = (counts[e.status] || 0) + 1;
      process.stdout.write(
        `config:      ${cfg.configLayers.length ? cfg.configLayers.join('  +  ') : '(defaults)'}\n` +
        `projectsDir: ${cfg.projectsDir}\n` +
        `coworkDir:   ${cfg.coworkDir}${fs.existsSync(cfg.coworkDir) ? '' : '   (absent — cowork scan skipped)'}\n` +
        `state:       ${cfg.statePath}\n` +
        `Δt:          ${cfg.deltaIdle}   ·   report T: ${cfg.reportTime}\n` +
        `chain mode:  ${cfg.chainMode || 'list'}` +
        `${(cfg.chainMode || 'list') === 'auto'
          ? `   (independent: ${JSON.stringify(cfg.independentProjects || [])})`
          : `   (chains: ${JSON.stringify(cfg.chainProjects || [])})`}\n` +
        `lastDailyRun:${state.lastDailyRun}\n` +
        `counts:      ${JSON.stringify(counts)}\n`);
      break;
    }

    default:
      process.stderr.write(
        `Unknown command: ${cmd}\n\n` +
        `Commands:\n` +
        `  scan [--daily] [--notify]   rescan disk, reconcile state (--daily bumps neglect once/day)\n` +
        `  report [--json] [--preview] the daily digest (default; --preview = no neglect bump)\n` +
        `  list [--all]                one line per queued (or all) session\n` +
        `  sync-desktop <json>         sync Claude app sessions (archive state + cowork) from a\n` +
        `                              saved ccd list_sessions MCP output file\n` +
        `  archive <id...>             keep as reference, stop reminding (accepts several ids)\n` +
        `  dismiss <id...>             drop from reminders (accepts several ids)\n` +
        `  activate <id...>            bring archived/dismissed ones back\n` +
        `  snooze <id> [days=3]        hide for N days\n` +
        `  note <id> <text>            attach a note\n` +
        `  resume-cmd <id>             print the command to continue that session\n` +
        `  status                      show config + counts\n`);
      process.exit(1);
  }
}

try { main(); }
catch (e) { process.stderr.write('idea-reminder error: ' + e.message + '\n'); process.exit(1); }
