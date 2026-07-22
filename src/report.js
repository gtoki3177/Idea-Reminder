'use strict';
const path = require('path');

// CLI-output strings. Default is English; set `locale` in config to switch.
// (Skill/routine-mediated digests are presented by Claude in the user's
// language regardless — this only affects direct CLI output.)
const STRINGS = {
  en: {
    empty: (dt, n, extra) => `No conversations idle past **${dt}** — the queue is empty 🎉 (tracking ${n} total)${extra}`,
    emptyExtra: k => ` (${k} older handoff-chain links auto-hidden)`,
    headline: (q, dt, n) => `**${q}** conversations idle past **${dt}** (tracking ${n} total), sorted by weight:`,
    supersededNote: k => `_(${k} older handoff-chain links auto-hidden — see \`list --all\`)_`,
    meta: (project, d, w, nag, m) => `\`${project}\` · idle ${d}d · weight ${w}${nag} · ${m} msgs`,
    nag: n => ` · skipped ${n}×`,
    lastDoing: text => `> Last doing: ${text}`,
    resume: cmd => `Resume: \`${cmd}\``,
    hiddenSummary: k => `${k} more lower-weight items (expand)`,
    hiddenRow: (d, n) => `— idle ${d}d / skipped ${n}×`,
    desktopResume: title => `(open "${title}" in the Claude app)`,
    notifySome: (n, title) => `idea reminder: ${n} conversations to review (top: ${title})`,
    notifyEmpty: 'idea reminder: queue is clear 🎉',
  },
  'zh-TW': {
    empty: (dt, n, extra) => `目前沒有閒置超過 **${dt}** 的對話，佇列是空的 🎉（共追蹤 ${n} 個）${extra}`,
    emptyExtra: k => `（另有 ${k} 個接力鏈中較舊的對話已自動隱藏）`,
    headline: (q, dt, n) => `有 **${q}** 個對話閒置超過 **${dt}**（共追蹤 ${n} 個），依權重排序：`,
    supersededNote: k => `_（另有 ${k} 個接力鏈中較舊的對話已自動隱藏，用 \`list --all\` 可看到）_`,
    meta: (project, d, w, nag, m) => `\`${project}\` · 閒置 ${d} 天 · 權重 ${w}${nag} · ${m} 則訊息`,
    nag: n => ` · 已略過 ${n} 次`,
    lastDoing: text => `> 最後在做：${text}`,
    resume: cmd => `繼續：\`${cmd}\``,
    hiddenSummary: k => `還有 ${k} 個權重較低的（點開）`,
    hiddenRow: (d, n) => `— 閒置 ${d} 天 / 略過 ${n} 次`,
    desktopResume: title => `（在 Claude app 裡開啟「${title}」）`,
    notifySome: (n, title) => `idea reminder: ${n} 個對話待回顧（最高：${title}）`,
    notifyEmpty: 'idea reminder: 佇列清空 🎉',
  },
};

function t(locale) {
  return STRINGS[locale] || STRINGS.en;
}

function idleDaysOf(entry, now) {
  const lastActMs = Date.parse(entry.lastActivity) || now;
  return Math.max(0, (now - lastActMs) / 86400000);
}

function projectLabel(entry) {
  if (entry.cwd) return path.basename(entry.cwd);
  return (entry.project || '').replace(/^[A-Za-z]--/, '').replace(/-/g, '/');
}

function resumeCommand(entry, locale) {
  if (String(entry.id).startsWith('local_') || entry.source === 'desktop') {
    return t(locale).desktopResume(((entry.titleOverride || entry.title) || '').slice(0, 40));
  }
  return entry.cwd ? `cd "${entry.cwd}" && claude --resume ${entry.id}` : `claude --resume ${entry.id}`;
}

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toItem(entry, now, locale) {
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
    resumeCommand: resumeCommand(entry, locale),
  };
}

function buildReport(state, cfg, now, queued, supersededCount) {
  const items = queued.map(e => toItem(e, now, cfg.locale));
  return {
    generatedAt: new Date(now).toISOString(),
    localDate: localDate(now),
    locale: cfg.locale || 'en',
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
  const s = t(rep.locale);
  const L = [];
  L.push(`# 💡 idea reminder — ${rep.localDate || rep.generatedAt.slice(0, 10)}`);
  L.push('');
  if (rep.totalQueued === 0) {
    const extra = rep.supersededHidden ? s.emptyExtra(rep.supersededHidden) : '';
    L.push(s.empty(rep.deltaIdle, rep.totalTracked, extra));
    return L.join('\n');
  }
  L.push(s.headline(rep.totalQueued, rep.deltaIdle, rep.totalTracked));
  if (rep.supersededHidden) L.push(s.supersededNote(rep.supersededHidden));
  L.push('');
  rep.shown.forEach((it, i) => {
    const nag = it.neglectCount > 0 ? s.nag(it.neglectCount) : '';
    L.push(`### ${i + 1}. ${it.title}`);
    L.push(s.meta(it.project, it.idleDays, it.weight, nag, it.messageCount));
    if (it.lastUserText) L.push(s.lastDoing(it.lastUserText.replace(/\s+/g, ' ').slice(0, 160)));
    if (it.notes) L.push(`> 📝 ${it.notes}`);
    L.push(s.resume(it.resumeCommand));
    L.push('');
  });
  if (rep.hidden.length) {
    L.push(`<details><summary>${s.hiddenSummary(rep.hidden.length)}</summary>`);
    L.push('');
    rep.hidden.forEach(it => {
      L.push(`- \`${it.project}\` ${it.title} ${s.hiddenRow(it.idleDays, it.neglectCount)} · \`${it.id.slice(0, 8)}\``);
    });
    L.push('');
    L.push('</details>');
  }
  return L.join('\n');
}

module.exports = { buildReport, renderMarkdown, t };
