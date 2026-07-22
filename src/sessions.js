'use strict';
// Enumerate and parse Claude Code session logs.
//
// Layout (Windows example):
//   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl   <- a MAIN session (what we track)
//   ~/.claude/projects/<encoded-cwd>/<session-uuid>/...     <- subagents/workflows/tool-results (INTERNAL, skip)
//   ~/.claude/projects/<encoded-cwd>/memory/*.md            <- memory files (skip)
//
// So a "chat room" == one *.jsonl file sitting DIRECTLY inside a project folder.
const fs = require('fs');
const path = require('path');

const MAX_PARSE_BYTES = 60 * 1024 * 1024;

function listSessionFiles(projectsDir) {
  const out = [];
  let projects;
  try { projects = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(projectsDir, p.name);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue; // files only -> excludes nested dirs
      const full = path.join(dir, e.name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      out.push({
        id: e.name.replace(/\.jsonl$/, ''),
        project: p.name,
        path: full,
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    }
  }
  return out;
}

function textFromContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

function isMeaningfulUserText(t) {
  if (!t) return false;
  const s = t.trim();
  if (!s) return false;
  if (s.startsWith('<')) return false;                  // <system-reminder>, <command-name>, ...
  if (s.startsWith('[Request interrupted')) return false;
  if (s.startsWith('Caveat:')) return false;
  return true;
}

function makeTitle(text) {
  if (!text) return '(untitled session)';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '(untitled session)';
  return oneLine.length > 100 ? oneLine.slice(0, 100) + '…' : oneLine;
}

// Returns lightweight facts about a session. mtimeMs is a fallback clock for
// sessions with no in-content timestamps.
function parseSession(file, mtimeMs) {
  const facts = {
    title: '', firstPrompt: '', lastUserText: '',
    messageCount: 0, firstActivity: null, lastActivity: null,
    cwd: '', sizeKB: 0,
  };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { facts.lastActivity = new Date(mtimeMs).toISOString(); return facts; }

  const bytes = Buffer.byteLength(raw);
  facts.sizeKB = Math.round(bytes / 1024);
  if (bytes > MAX_PARSE_BYTES) {
    facts.title = '(large session)';
    facts.firstActivity = facts.lastActivity = new Date(mtimeMs).toISOString();
    return facts;
  }

  const lines = raw.split('\n');
  let firstPromptFull = '';
  let firstEnqueue = '';
  let minTs = null, maxTs = null;

  for (const line of lines) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (o.timestamp) {
      const t = Date.parse(o.timestamp);
      if (!isNaN(t)) {
        if (minTs === null || t < minTs) minTs = t;
        if (maxTs === null || t > maxTs) maxTs = t;
      }
    }
    if (!facts.cwd && typeof o.cwd === 'string') facts.cwd = o.cwd;

    if (o.type === 'queue-operation' && o.operation === 'enqueue' && !firstEnqueue && typeof o.content === 'string') {
      if (isMeaningfulUserText(o.content)) firstEnqueue = o.content;
    } else if (o.type === 'user' && o.message) {
      const t = textFromContent(o.message.content);
      if (isMeaningfulUserText(t)) {
        if (!firstPromptFull) firstPromptFull = t;
        facts.lastUserText = t;
        facts.messageCount++;
      }
    } else if (o.type === 'assistant' && o.message) {
      facts.messageCount++;
    }
  }

  const source = firstPromptFull || firstEnqueue || '';
  facts.title = makeTitle(source);
  facts.firstPrompt = source.slice(0, 800);
  facts.lastUserText = (facts.lastUserText || '').slice(0, 500);
  facts.firstActivity = minTs != null ? new Date(minTs).toISOString() : new Date(mtimeMs).toISOString();
  facts.lastActivity = maxTs != null ? new Date(maxTs).toISOString() : new Date(mtimeMs).toISOString();
  return facts;
}

module.exports = { listSessionFiles, parseSession };
