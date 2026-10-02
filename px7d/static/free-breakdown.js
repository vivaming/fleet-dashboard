// 免费模型工作 Breakdown（docs/free-model-breakdown-design.md）。
// 只读入参 bot 对象；textContent/createElement 防注入；未知不填 0。
window.FleetBreakdown = Object.freeze({ renderBotBreakdown, isFreeModel, visibleRows });

function isFreeModel(m) {
  // 三级优先级：1 chip free_status；2 模型名含 :free；3 渠道规则（调用方注入 rules 命中后标）
  if (m && (m.free_status === "已确认免费" || m.free_status === "有额度限制")) return "confident";
  if (m && typeof m.model === "string" && m.model.includes(":free")) return "confident";
  return null;
}

// 鸣哥 0924：超 7 天的记录不显示（工具演进期，历史数据无参考价值）。
// 与 app.js 模型区 SEVEN_DAY_MS 同语义。last_seen 缺失/非法/负年龄的行不能证明在 7 天内，
// 一并计入 hidden 不冒充新数据；隐藏必须显性计数（省略不许静默）。
function visibleRows(totals, nowSec) {
  const CUT = 7 * 86400;
  const kept = [], hidden = [];
  for (const r of (Array.isArray(totals) ? totals : [])) {
    const ls = (r && typeof r.last_seen === "number" && Number.isFinite(r.last_seen)) ? r.last_seen : null;
    if (ls != null && nowSec - ls >= 0 && nowSec - ls <= CUT) kept.push(r);
    else hidden.push(r);
  }
  return { kept, hidden };
}

function _fmtTok(n) {
  if (n == null || Number.isNaN(n)) return "不可用";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(Math.round(n));
}

function _activity(lastSeen, nowMs) {
  if (lastSeen == null) return "不可用";
  const s = Math.max(0, Math.round((nowMs / 1000) - lastSeen));
  if (s < 60) return "最近 " + s + "s";
  if (s < 3600) return "最近 " + Math.round(s / 60) + "分";
  if (s < 86400) return "最近 " + Math.round(s / 3600) + "时";
  return Math.round(s / 86400) + "天前";
}

function _freeTag(r, options) {
  if (!r) return null;
  const t = isFreeModel(r);
  if (t) return t;
  if (typeof r.model === "string" && r.model.includes(":free")) return "confident";
  if ((options.freeChannelModels || []).includes(r.model)) return "channel-rule";
  return null;
}

function renderBotBreakdown(container, bot, options = {}) {
  const nowMs = options.nowMs || Date.now();
  container.textContent = "";
  const head = document.createElement("div");
  head.className = "brk-head";
  head.textContent = "免费模型工作";
  container.appendChild(head);

  const totals = (bot.tokens && bot.tokens.totals) || [];
  const vis = visibleRows(totals, nowMs / 1000);
  const rows = [];
  for (const r of vis.kept) {
    const tag = _freeTag(r, options);
    if (tag) rows.push({ row: r, tag });
  }
  const hiddenFree = vis.hidden.filter(r => _freeTag(r, options)).length;
  if (!rows.length) {
    const d = document.createElement("div");
    d.className = "brk-row";
    d.textContent = hiddenFree > 0
      ? "近7天无免费模型消耗（更早 " + hiddenFree + " 条已隐藏）"
      : "无免费模型消耗记录";
    container.appendChild(d);
    return;
  }
  rows.sort((a, b) => (b.row.last_seen || 0) - (a.row.last_seen || 0));
  // 任务关联：xpi taskbook（同模型名最近一条）或子代理 config_model 匹配 → 否则"未关联"
  const tasks = [];
  for (const it of (bot.xpi_agents && bot.xpi_agents.items) || []) {
    if (it.model && it.taskbook) tasks.push({ model: it.model, task: it.taskbook });
  }
  for (const s of (bot.subagents && bot.subagents.items) || []) {
    if (s.config_model) tasks.push({ model: s.config_model, task: "子代理 " + String(s.child_session_id || "").slice(0, 12) });
  }
  for (const { row: r, tag } of rows) {
    const el = document.createElement("div");
    el.className = "brk-row";
    const name = document.createElement("span");
    name.className = "brk-model";
    name.textContent = r.model || "(未知模型)";
    el.appendChild(name);
    const mnorm = (r.model || "").toLowerCase();
    const task = tasks.find(t => (t.model || "").toLowerCase().includes(mnorm.split("/").pop()) ||
                                mnorm.includes((t.model || "").toLowerCase().split("/").pop()));
    const taskSpan = document.createElement("span");
    taskSpan.className = "brk-task";
    taskSpan.textContent = task ? task.task : "未关联(无法配对)";
    el.appendChild(taskSpan);
    const nums = document.createElement("span");
    nums.className = "brk-nums";
    const in_ = r.input, out_ = r.output;
    nums.textContent = (in_ == null || out_ == null)
      ? "消耗不可用"
      : `${_fmtTok(in_)}↑/${_fmtTok(out_)}↓ · ${r.calls != null ? r.calls + "次" : "次数不可用"} · ${_activity(r.last_seen, nowMs)}${tag === "channel-rule" ? " · (渠道规则)" : ""}`;
    el.appendChild(nums);
    container.appendChild(el);
  }
  if (hiddenFree > 0) {
    const tail = document.createElement("div");
    tail.className = "brk-row brk-hidden";
    tail.textContent = "已隐藏 " + hiddenFree + " 条 7 天前记录";
    container.appendChild(tail);
  }
}
