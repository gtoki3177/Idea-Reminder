'use strict';
const path = require('path');

function idleDaysOf(entry, now) {
  const lastActMs = Date.parse(entry.lastActivity) || now;
  return Math.max(0, (now - lastActMs) / 86400000);
}

function projectLabel(entry) {
  if (entry.cwd) return path.basename(entry.cwd);
  return (entry.project || '').replace(/^[A-Za-z]--/, '').replace(/-/g, '/');
}

function resumeCommand(entry) {
  if (String(entry.id).startsWith('local_') || entry.source === 'desktop') {
    return `(在 Claude app 裡開啟「${(entry.title || '').slice(0, 40)}」)`;
  }
  return entry.cwd ? `cd "${entry.cwd}" && claude --resume ${entry.id}` : `claude --resume ${entry.id}`;
}

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toItem(entry, now) {
  return {
    id: entry.id,
    project: projectLabel(entry),
    cwd: entry.cwd || '',
    title: entry.titleOverride || entry.title,
    firstPrompt: entry.firstPrompt,
    lastUserText: entry.lastUserText,
    messageCount: entry.messageCount,
    idleDays: Math.round(idleDaysOf(entry, now) * 10) / 10,
    neglectCount: entry.neglectCount || 0,
    weight: entry.weight,
    queuedAt: entry.queuedAt,
    notes: entry.notes || null,
    resumeCommand: resumeCommand(entry),
  };
}

function buildReport(state, cfg, now, queued, supersededCount) {
  const items = queued.map(e => toItem(e, now));
  return {
    generatedAt: new Date(now).toISOString(),
    localDate: localDate(now),
    deltaIdle: cfg.deltaIdle,
    reportTime: cfg.reportTime,
    totalTracked: Object.keys(state.sessions).length,
    totalQueued: items.length,
    supersededHidden: supersededCount || 0,
    shown: items.slice(0, cfg.maxDetailedItems),
    hidden: items.slice(cfg.maxDetailedItems),
  };
}

function renderMarkdown(rep) {
  const L = [];
  L.push(`# 💡 idea reminder — ${rep.localDate || rep.generatedAt.slice(0, 10)}`);
  L.push('');
  if (rep.totalQueued === 0) {
    const extra = rep.supersededHidden ? `（另有 ${rep.supersededHidden} 個接力鏈中較舊的對話已自動隱藏）` : '';
    L.push(`目前沒有閒置超過 **${rep.deltaIdle}** 的對話，佇列是空的 🎉（共追蹤 ${rep.totalTracked} 個）${extra}`);
    return L.join('\n');
  }
  L.push(`有 **${rep.totalQueued}** 個對話閒置超過 **${rep.deltaIdle}**（共追蹤 ${rep.totalTracked} 個），依權重排序：`);
  if (rep.supersededHidden) L.push(`_（另有 ${rep.supersededHidden} 個接力鏈中較舊的對話已自動隱藏，用 \`list --all\` 可看到）_`);
  L.push('');
  rep.shown.forEach((it, i) => {
    const nag = it.neglectCount > 0 ? ` · 已略過 ${it.neglectCount} 次` : '';
    L.push(`### ${i + 1}. ${it.title}`);
    L.push(`\`${it.project}\` · 閒置 ${it.idleDays} 天 · 權重 ${it.weight}${nag} · ${it.messageCount} 則訊息`);
    if (it.lastUserText) L.push(`> 最後在做：${it.lastUserText.replace(/\s+/g, ' ').slice(0, 160)}`);
    if (it.notes) L.push(`> 📝 ${it.notes}`);
    L.push(`繼續：\`${it.resumeCommand}\``);
    L.push('');
  });
  if (rep.hidden.length) {
    L.push(`<details><summary>還有 ${rep.hidden.length} 個權重較低的（點開）</summary>`);
    L.push('');
    rep.hidden.forEach(it => {
      L.push(`- \`${it.project}\` ${it.title} — 閒置 ${it.idleDays} 天 / 略過 ${it.neglectCount} 次 · \`${it.id.slice(0, 8)}\``);
    });
    L.push('');
    L.push('</details>');
  }
  return L.join('\n');
}

module.exports = { buildReport, renderMarkdown };
