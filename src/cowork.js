'use strict';
// Enumerate and parse Cowork (desktop "local agent mode") sessions.
//
// Layout (Windows example; macOS uses ~/Library/Application Support/Claude/...):
//   %APPDATA%\Claude\local-agent-mode-sessions\
//     <account-uuid>\<workspace-uuid>\
//       local_<session-uuid>.json      <- session METADATA (authoritative: title,
//                                         isArchived, lastActivityAt, sessionType, ...)
//       local_<session-uuid>\          <- per-session sandbox
//         audit.jsonl                  <- conversation audit (used for lastUserText/count)
//     skills-plugin\                   <- bundled skill assets (ignored)
//
// Cowork sessions are NOT listed by the ccd_session_mgmt MCP (that surface is
// Claude Code only). The metadata json gives us the app's real title AND the
// archive state, so archived-in-app conversations can be suppressed just like
// Code ones. Scheduled-task runs (sessionType: "scheduled") are machine-made
// and excluded entirely. Remote (cloud) Cowork sessions leave no local files
// and cannot be scanned.
const fs = require('fs');
const path = require('path');
const { textFromContent, isMeaningfulUserText, makeTitle } = require('./sessions');

const MAX_PARSE_BYTES = 60 * 1024 * 1024;

function listCoworkSessions(coworkDir) {
  const out = [];
  let accounts;
  try { accounts = fs.readdirSync(coworkDir, { withFileTypes: true }); }
  catch { return out; } // no Cowork on this machine — fine
  for (const acct of accounts) {
    if (!acct.isDirectory() || acct.name === 'skills-plugin') continue;
    const acctDir = path.join(coworkDir, acct.name);
    let workspaces;
    try { workspaces = fs.readdirSync(acctDir, { withFileTypes: true }); }
    catch { continue; }
    for (const ws of workspaces) {
      if (!ws.isDirectory()) continue;
      const wsDir = path.join(acctDir, ws.name);
      let entries;
      try { entries = fs.readdirSync(wsDir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        if (!e.isFile() || !e.name.startsWith('local_') || !e.name.endsWith('.json')) continue;
        const full = path.join(wsDir, e.name);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        out.push({
          id: e.name.replace(/\.json$/, ''),
          project: 'cowork',
          source: 'cowork',
          path: full,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
    }
  }
  return out;
}

// Light pass over the sandbox's audit.jsonl for conversational detail.
function auditDetail(metaPath) {
  const out = { lastUserText: '', messageCount: 0 };
  const auditPath = path.join(metaPath.replace(/\.json$/, ''), 'audit.jsonl');
  let raw;
  try {
    if (fs.statSync(auditPath).size > MAX_PARSE_BYTES) return out;
    raw = fs.readFileSync(auditPath, 'utf8');
  } catch { return out; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'user' && o.message) {
      const t = textFromContent(o.message.content);
      if (isMeaningfulUserText(t)) { out.lastUserText = t; out.messageCount++; }
    } else if (o.type === 'assistant' || o.type === 'result') {
      out.messageCount++;
    }
  }
  return out;
}

function parseCoworkSession(file, mtimeMs) {
  const facts = {
    title: '', firstPrompt: '', lastUserText: '',
    messageCount: 0, firstActivity: null, lastActivity: null,
    cwd: '', sizeKB: 0, isScheduledRun: false, isArchivedInApp: false,
  };
  let meta;
  try { meta = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { facts.lastActivity = new Date(mtimeMs).toISOString(); return facts; }

  facts.isScheduledRun = meta.sessionType === 'scheduled' || !!meta.scheduledTaskId;
  facts.isArchivedInApp = !!meta.isArchived;

  const init = typeof meta.initialMessage === 'string' ? meta.initialMessage : '';
  facts.firstPrompt = (isMeaningfulUserText(init) ? init : '').slice(0, 800);
  facts.title = (meta.title || '').trim() || makeTitle(facts.firstPrompt);

  const created = Number(meta.createdAt);
  const lastAct = Number(meta.lastActivityAt);
  facts.firstActivity = isFinite(created) && created > 0 ? new Date(created).toISOString() : new Date(mtimeMs).toISOString();
  facts.lastActivity = isFinite(lastAct) && lastAct > 0 ? new Date(lastAct).toISOString() : new Date(mtimeMs).toISOString();

  if (!facts.isScheduledRun) {
    const detail = auditDetail(file);
    facts.lastUserText = detail.lastUserText.slice(0, 500);
    facts.messageCount = detail.messageCount || 1; // metadata implies at least the initial message
    if (detail.messageCount) {
      try { facts.sizeKB = Math.round(fs.statSync(path.join(file.replace(/\.json$/, ''), 'audit.jsonl')).size / 1024); } catch {}
    }
  }
  return facts;
}

module.exports = { listCoworkSessions, parseCoworkSession };
