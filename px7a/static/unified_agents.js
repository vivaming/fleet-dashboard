// buildUnifiedAgentList — Hermes 子代理 + XPi 代理统一列表归一（Astra v3 PASS 规格）
// 数据来源：bot.subagents.items（hermes）/ bot.xpi_agents.items（xpi）
// 五要素：desc / model / durSec / calls / status（+statusNote 无证据说明 / warn 预警）
// 状态证据原则：证据不足不设 badge（status=null），保留条目 + statusNote
"use strict";

function _fmtSince(epochSec, nowSec) {
  if (typeof epochSec !== "number" || !isFinite(epochSec)) return null;
  const m = Math.max(0, Math.round((nowSec - epochSec) / 60));
  if (m < 60) return m + " 分钟";
  return Math.floor(m / 60) + " 时 " + Math.round(m % 3600 / 60) + " 分";
}

function _hermesItem(s, nowSec) {
  const ended = typeof s.ended_at === "number";
  const running = s.confirmed_running === true;
  let status = null, statusNote = null, warn = null;
  if (running) {
    status = "进行中";
  } else if (ended) {
    status = "完成";
    if (s.end_reason && s.end_reason !== "agent_close") statusNote = "(" + s.end_reason + ")";
  } else if (s.stale_open === true) {
    status = "失联";
    const d = _fmtSince(s.last_act, nowSec);
    warn = "失联（最近活动：" + (d || "未知时间") + "前）";
  } else if (s.open_unverified === true) {
    statusNote = "（无近期活动）";
  }
  // 预警：未结束且非 confirmed_running，距最近活动 > 阈值（失联文案优先，不覆盖）
  if (!ended && !running && s.stale_open !== true && typeof s.last_act === "number") {
    const idleMin = Math.round((nowSec - s.last_act) / 60);
    if (idleMin > 30) warn = "距最近活动 " + idleMin + " 分钟";
  }
  if (!ended && !running && s.empty_shell === true) {
    warn = (warn ? warn + " · " : "") + "疑似空壳";
  }
  return {
    source: "hermes",
    id: String(s.child_session_id ?? "?"),
    desc: (s.last_activity_description || "").slice(0, 28) ||
          (s.config_model ? String(s.config_model).split("/").pop() : "") || "子代理任务",
    model: s.config_model || null,
    durSec: ended ? Math.max(0, Math.round(s.ended_at - s.started_at))
                  : (typeof s.started_at === "number" ? Math.max(0, Math.round(nowSec - s.started_at)) : null),
    calls: typeof s.api_call_count === "number" ? s.api_call_count : undefined,
    status, statusNote, warn,
  };
}

function _xpiItem(it) {
  // GLM 终审修正（0926）：finished_recent = 活着的长跑代理（非完成）；
  // exit_ago_s 只来自 xpi_seen 退出登记——进程退出是中性事件（Lane V3 C3：
  // 退出≠完成终态），标「已退出」不标「已完成」。
  let status = null, statusNote = null, doneMinAgo = null;
  if (it.fresh === true) {
    status = "进行中";
  } else if (it.state === "exited_recent" && typeof it.exit_ago_s === "number") {
    status = "已退出";
    doneMinAgo = Math.max(0, Math.round(it.exit_ago_s / 60));
    statusNote = "已退出 " + (doneMinAgo === 0 ? "刚刚" : doneMinAgo + " 分前");
  } else if (typeof it.exit_ago_s === "number") {
    status = "已退出";
    doneMinAgo = Math.max(0, Math.round(it.exit_ago_s / 60));
    statusNote = "已退出 " + (doneMinAgo === 0 ? "刚刚" : doneMinAgo + " 分前");
  } else if (it.state === "finished_recent") {
    statusNote = "（长跑 " + (typeof it.age_s === "number" ? Math.round(it.age_s / 60) : "?") + " 分，无新鲜执行证据）";
  } else {
    statusNote = "（状态证据不足）";
  }
  const desc = it.taskbook ||
    (typeof it.cmd === "string" ? it.cmd.slice(0, 28) : "") || "xpi agent";
  return {
    source: "xpi",
    id: "pid" + it.pid,
    desc: String(desc).slice(0, 28),
    model: it.model || null,
    durSec: typeof it.age_s === "number" ? it.age_s : null,
    calls: undefined, // XPi 无调用量字段，诚实省略
    status, statusNote, warn: null,
    doneMinAgo,
  };
}

const _RANK = { "进行中": 0, "失联": 1, "完成": 2 };
function buildUnifiedAgentList(bot, nowSec, idleWarnSec) {
  nowSec = typeof nowSec === "number" ? nowSec : Date.now() / 1000;
  idleWarnSec = idleWarnSec || 1800;
  const sa = bot.subagents || {};
  const xa = bot.xpi_agents || {};
  // 采集失败 vs 空列表（Astra 必改3）
  const failed = (xa && xa.error) || sa.coverage === "unknown";
  if (failed) return { error: "采集失败", items: [], summary: null };

  if (!Array.isArray(bot.agents_unified)) return {error: "统一列表未采集", items: [], summary: null};
  let items = bot.agents_unified.filter(a => a.state !== "finished").map(a =>
    a.source === "hermes" ? _hermesItem(a.raw || {}, nowSec) : _xpiItem(a.raw || {}));
  const counts = bot.agents_unified_summary || {};
  const exitedRecent = items.filter(i => i.status === "已退出" && typeof i.doneMinAgo === "number" && i.doneMinAgo <= 30).length;
  const summary = {running: counts.running, lost: counts.stale_open,
    done: exitedRecent, noBadge: counts.unverified, total: items.length};
  // 排序：证据等级（进行中>失联>完成>无证据），同级 hermes 按 durSec 升序
  items.sort((a, b) => {
    const ra = a.status ? _RANK[a.status] : 3;
    const rb = b.status ? _RANK[b.status] : 3;
    if (ra !== rb) return ra - rb;
    if (a.source !== b.source) return a.source === "hermes" ? -1 : 1;
    return (a.durSec ?? Infinity) - (b.durSec ?? Infinity);
  });
  // 截断保序：预警条目优先保留（Astra 建议3）
  const warned = items.filter(i => i.warn);
  const rest = items.filter(i => !i.warn);
  const kept = [...warned, ...rest].slice(0, 10);
  // 恢复排序展示
  kept.sort((a, b) => {
    const ra = a.status ? _RANK[a.status] : 3;
    const rb = b.status ? _RANK[b.status] : 3;
    if (ra !== rb) return ra - rb;
    if (a.source !== b.source) return a.source === "hermes" ? -1 : 1;
    return (a.durSec ?? Infinity) - (b.durSec ?? Infinity);
  });
  const truncated = items.length > kept.length;
  return { items: kept, summary, truncated,
           hidden: items.length - kept.length,
           hiddenWarned: warned.length - kept.filter(i => i.warn).length };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildUnifiedAgentList };
}
