/* 舰队监控站前端：只读快照渲染，textContent 防注入，5s 轮询 */
"use strict";

const FALLBACK_HAT = "M2 8h12l2-4 2 4h12v6H2z";

// 80s 街机像素帽：每 bot 独立轮廓（21x12 网格，方块路线）
const HATS = {
  default: [
    ".....................",
    "....##########.......",
    "..##############.....",
    ".################....",
    ".####EEEEEEEE###.....",
    ".################..A.",
    "..#############..AAA.",
    "...###########...A.A.",
  ],
  nyx: [
    "..........A..........",
    ".........AAA.........",
    "........AAAAA........",
    ".......AAAAAAA.......",
    "......CCCCCCCCC......",
    ".....CCCCCCCCCCC.....",
    "...CCCCCCCCCCCCCCC...",
    ".##################..",
  ],
  nova: [
    ".........CCC.........",
    "........CCCCC........",
    ".......CCCSCCC.......",
    "..PP..CCCCCCCCC..PP..",
    ".PPP.CCCCCCCCCCC.PPP.",
    "PPPPCCCCCCCCCCCCCPPPP",
    ".##.CCCCCCCCCCCCC.##.",
    "....##############...",
  ],
};
const HAT_COLORS = {
  "#": "#3bd6c6", // 帽体：霓虹青
  C: "#ffd23f",   // 帽体变体：霓虹紫
  E: "#0b0f1e",   // 帽带（暗）
  S: "#ffd23f",   // 星徽：琥珀
  P: "#ff5d73",   // 帽翼：品红红
  A: "#4ade80",   // 帽尖/装饰：绿
};

function hatSVG(kind) {
  const rows = HATS[kind] || HATS.default;
  let rects = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const color = HAT_COLORS[ch] || "#3bd6c6";
      rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${color}"/>`;
    }
  });
  return `<svg class="bot-hat" viewBox="0 0 21 12" xmlns="http://www.w3.org/2000/svg" ` +
         `shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

const WORK_CLASS = {
  "工作中": "st-working", "近期有工作进展": "st-recent", "在线·空闲": "st-idle",
  "代理工作中（本体空闲）": "st-working", "等待偏长": "st-wait",
  "疑似阻塞": "st-blocked",
  "offline": "st-offline", "未发现，待确认": "st-offline", "online": "st-idle",
  "unknown": "st-unknown", "retired": "st-retired",
};
const FREE_CLASS = {
  "已确认免费": "free-ok", "有额度限制": "free-limited",
  "可能收费": "free-maybe", "未知": "free-unknown",
};
const FREE_SHORT = {
  "已确认免费": "免费", "有额度限制": "限免", "可能收费": "计费", "未知": "资格未知",
};

// 三态 badge：以 tri（Astra 矩阵裁决）为主标签，work.state 细节留在 reason/detail
const TRI_CLASS = { working: "st-working", reachable: "st-idle", unreachable: "st-offline",
                    retired: "st-retired" };
function triBadgeText(bot) {
  const t = bot.tri;
  return t ? (t.reason || t.tri) : bot.work.state;
}
function triBadgeClass(bot) {
  const t = bot.tri;
  if (t && TRI_CLASS[t.tri]) return TRI_CLASS[t.tri];
  return workBadgeClass(bot.work.state);
}

// token 摘要格式化：1.2M↑ / 340K↓，cache_read>0 追加 ·缓存2.1M
function fmtTokens(n) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(Math.round(n));
}
// 时长格式（代理/子代理明细共用）：秒 → 新鲜 Ns / N 分 / N时M分
function fmtDurSecs(sec) {
  if (sec < 120) return `新鲜 ${Math.round(sec)}s`;
  return sec >= 3600
      ? `已跑 ${Math.floor(sec / 3600)}时${Math.round(sec % 3600 / 60)}分`
      : `已跑 ${Math.round(sec / 60)}分`;
}
// 渠道身份 key（与 probes/db.py GROUP BY 的四元组一致）
function channelKey(r) {
  return `${r.model}|${r.provider || ""}|${r.base_url || ""}|${r.billing_mode != null ? r.billing_mode : ""}`;
}
// 每个 chip 按渠道全身份（model+provider+base_url+billing_mode）匹配累计，
// 同 model 不同渠道绝不在摘要里合并（Astra §2）。指标缺失 → "不可用"，不填 0。
function tokenChipSuffix(model, tokenRes) {
  if (!tokenRes || !Array.isArray(tokenRes.totals)) return "";
  const rows = ((tokenRes && tokenRes.totals) || []).filter(r => channelKey(r) === channelKey(model));
  if (!rows.length) return "";
  // totals 已按四元组分组，命中即唯一行；绝不把多行相加
  const r = rows[0];
  const inNull = r.input === null || r.input === undefined;
  const outNull = r.output === null || r.output === undefined;
  if (inNull && outNull) {
    let s = " 输入/输出不可用";
    if ((r.cache_read || 0) > 0) s += `·缓存${fmtTokens(r.cache_read)}`;
    return s;
  }
  if (inNull) {  // 输入缺列 → 标该指标不可用
    let s = ` 输入不可用/↓ ${fmtTokens(r.output)}`;
    if ((r.cache_read || 0) > 0) s += `·缓存${fmtTokens(r.cache_read)}`;
    return s;
  }
  if (outNull) {  // 输出缺列 → 标该指标不可用
    let s = `↑ ${fmtTokens(r.input)}/输出不可用`;
    if ((r.cache_read || 0) > 0) s += `·缓存${fmtTokens(r.cache_read)}`;
    return s;
  }
  if (r.input === 0 && r.output === 0) return ""; // 无累计数据不填 0 冒充
  let s = ` ${fmtTokens(r.input)}↑/${fmtTokens(r.output)}↓`;
  if ((r.cache_read || 0) > 0) s += `·缓存${fmtTokens(r.cache_read)}`;
  return s;
}

// 时间归一：快照里 last_seen/last_activity/exited_at 混用三种形态——
// 秒级 epoch 数字（远端 models 行）、ISO 字符串（本地 db 行）、缺失。
// 直接 Date.parse(number) 得 NaN，会把全部远端模型折成"历史"（Astra E3）。
// 统一入口；缺失返回 0，由调用方判 0 排除比较。
function toEpochMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v * 1000;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}
// 秒视图，供与 nowMs/1000 的窗口比较
function toEpochS(v) {
  const ms = toEpochMs(v);
  return ms ? ms / 1000 : 0;
}
// 驱动关系：付费行取 last_seen 最新者记 D（推断驱动方）。无模型返回 null。
// DB 无因果链，仅按时段共现推断——必须保持"(推断)"字样。
function modelTimeKey(models) {
  if (!models || !models.length) return null;
  let best = null;
  for (const m of models) {
    if (best === null) { best = m; continue; }
    if (toEpochMs(m.last_seen_epoch ?? m.last_seen) > toEpochMs(best.last_seen_epoch ?? best.last_seen)) best = m;
  }
  return best;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 模型行按"渠道身份"展开：totals 已按 (model,provider,base_url,billing_mode) 分组，
// 同 model 不同渠道 → 独立 chip，token 摘要不跨渠道合并（Astra §2）。
// bot.models 里的模型附上 billing_mode；totals 里有累计但不在 bot.models
// （非当前模型仍累计）→ 补成"资格未知"行，不遗漏。
function channelRows(bot) {
  const allModels = bot.models || [];
  const totalsRows = (bot.tokens && bot.tokens.totals) || [];
  const out = [];
  const keySeen = new Set();
  const push = (m) => {
    const k = channelKey(m);
    if (keySeen.has(k)) return;
    keySeen.add(k);
    out.push(m);
  };
  for (const m of allModels) {
    const matches = totalsRows.filter(r =>
        r.model === m.model && (r.provider || "") === (m.provider || "") &&
        (r.base_url || "") === (m.base_url || ""));
    if (!matches.length) { push(m); continue; }
    for (const r of matches) push({ ...m, billing_mode: r.billing_mode });
  }
  for (const r of totalsRows) {
    if (!keySeen.has(channelKey(r))) {
      push({ model: r.model, provider: r.provider, base_url: r.base_url,
             billing_mode: r.billing_mode, free_status: "未知", last_seen: r.last_seen,
             _fromTotals: true });
    }
  }
  // 远端 DB bot（.67/.65）：models 缺席时最近在用排前（排序只在此态生效；
  // 合成行已统一走 keySeen 去重——独立 seen 键曾让每个 totals 行出两行，Astra B2 实锤）
  if (!allModels.length && out.length) {
    out.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
  }
  return out;
}

function workBadgeClass(state) {
  if (WORK_CLASS[state]) return WORK_CLASS[state];
  if (state && state.includes("阻塞")) return "st-blocked";
  if (state && (state.includes("等待") || state.includes("待确认"))) return "st-wait";
  return "st-idle";
}

function botSignature(bot) {
  // 变化检测签名：这些字段变化才触发业务子树重建。
  // 补齐 activity.at、subagents.open_unverified/coverage、db_status、_severity、
  // 以及三态 tri 与 token 累计（P0/P1a 新增）。相对时间类字段走独立轻量路径（light），
  // 不因时钟 tick 触发重建。
  // 台账字段（Lane G v2）：completed_24h=有结束记录(24h)；completed_7d/empty_shell_24h
  // 可能缺失（None）→ 渲染标"不可用"，签名里也纳入以触发重建。
  return JSON.stringify([
    bot.work.state, bot.activity.text, bot.activity.source, bot.activity.at,
    bot.models, bot.tri,
    bot.agents_unified, bot.agents_unified_summary,
    bot.subagents?.confirmed_running, bot.subagents?.open_unverified,
    bot.subagents?.completed_24h, bot.subagents?.completed_7d,
    bot.subagents?.empty_shell_24h, bot.subagents?.coverage,
    bot.subagents?.total, bot.subagents?.truncated,
    // Lane V3 C3：进程退出汇总（omp/xpi 24h）独立入签名，与 completed_* 分态
    bot.subagents?.omp_exits_24h,
    bot.log_errors, bot.problem_flags,
    bot.process.pid, bot.process.state_label, bot.process.dup_procs,
    bot.process.chain && bot.process.chain.length,
    bot._severity,
    bot.db_status?.status, bot.db_status?.error,
    bot.tokens && bot.tokens.totals,
  ]);
}

// 创建卡片骨架（一次），返回 {card, update}；update 只改文本，不动布局
function makeBotCard(bot, hostShort, host) {
  const card = el("div", "bot-card");
  const top = el("div", "bot-top");
  const hatWrap = el("div");
  hatWrap.innerHTML = hatSVG(bot.profile); // 静态仓库内 SVG，可信
  top.appendChild(hatWrap);
  const nameBox = el("div");
  nameBox.appendChild(el("div", "bot-name", bot.display_name));
  nameBox.appendChild(el("div", "bot-host", `${hostShort} · ${bot.profile === "default" ? "默认" : bot.profile}`));
  top.appendChild(nameBox);
  const badge = el("span", "status-badge", bot.work.state);
  top.appendChild(badge);
  card.appendChild(top);

  // 三信号独立呈现（Astra Top-2）：进程存活 / 日志更新 / 会话活动是三件事，
  // 各走各的 DOM 通道，互不冒充——徽章仍是 tri 裁决，进程行只说进程，
  // 活动行只说会话/turn 证据，日志新鲜度随活动行的「来源」一并标注。
  const proc = el("div", "proc-signal");
  const act = el("div", "activity");
  const actText = el("span", null, bot.activity.text || "—");
  const actSrc = el("span", "src");
  act.appendChild(actText); act.appendChild(actSrc);
  card.appendChild(proc);
  card.appendChild(act);

  const pline = el("div", "problem-line");
  card.appendChild(pline);
  const hline = el("div", "problem-line");
  card.appendChild(hline);

  const sub = el("div", "sub-row");
  card.appendChild(sub);
  const exitRow = el("div", "sub-row exit-row");  // Lane V3 C3 第三态
  card.appendChild(exitRow);
  let latestBot = bot;
  let latestHost = host;
  const agentSession = el("div", "agent-session");
  card.appendChild(agentSession);
  const budgetRow = el("div", "session-budget");
  card.appendChild(budgetRow);

  const modelFree = el("div", "model-chips");
  const modelPaid = el("div", "model-chips");
  card.appendChild(modelFree);
  card.appendChild(modelPaid);

  // Live 代理行：卡片折叠态也常显（鸣哥 0925：不能只在页顶、要在卡片里面）。
  const liveAgents = el("div", "live-agents");
  card.appendChild(liveAgents);

  const agentDetail = el("div", "agent-detail");
  card.appendChild(agentDetail);

  const detail = el("div", "detail");
  card.appendChild(detail);
  card.addEventListener("click", () => {
    card.classList.toggle("open");
    if (agentSession) renderAgentSession(latestHost, latestBot, agentSession, card);
  });

  function update(bot) {
    latestBot = bot;
    const procOffline = bot.process.state_label === "offline" ||
                        bot.process.state_label === "未发现，待确认";
    card.classList.toggle("offline-card", procOffline);
    const sev = bot._severity || 0;
    card.classList.toggle("sev-crit", sev >= 3);
    card.classList.toggle("sev-warn", sev === 2);
    card.classList.toggle("retired-card", bot.tri?.tri === "retired");

    badge.textContent = SNAP_UNKNOWN ? "观测不可用" : triBadgeText(bot);
    badge.className = `status-badge ${SNAP_UNKNOWN ? "st-unknown" : triBadgeClass(bot)}`;

    // 信号①进程存活：只说进程，附 pid 与进程链（双进程=解释器派生，非双 gateway）
    proc.textContent = procSignalText(bot);

    actText.textContent = bot.activity.text || "—";
    actSrc.textContent = `来源:${bot.activity.source}` +
      (fmtActAt(bot.activity.at));

    // --- problem flags highlight (from patches/app_problem.js.patch) ---
    const pf = bot.problem_flags === null ? [] : (bot.problem_flags || []);
    card.classList.toggle("problem-card", pf.length > 0);
    const urgent = pf.some(p => ["session_overrun","context_bloating"].includes(p.code));
    card.classList.toggle("problem-urgent-card", urgent);
    let ptxt = pf.length ? ("⚠ " + pf.length + " 项异常: " + pf.map(p => p.code).join(", ")) : "";
    // 卡片展开(.open)时补每条 detail+suggest（含 \n，靠 pre-line 换行）
    if (pf.length && card.classList.contains("open")) {
      ptxt += "\n" + pf.map(p => {
        let s = "· " + (p.detail || p.code);
        if (p.suggest) s += "\n  → " + p.suggest;
        return s;
      }).join("\n");
    }
    pline.textContent = ptxt;
    pline.style.display = pf.length ? "" : "none";
    renderLiveAgents(liveAgents, bot);
    // 健康观测单列 hline（Astra FINAL C4：不进 pline，收起时换行会被折叠）
    const _le = bot.log_errors || null;
    let _htxt = "";
    if (_le && _le.error) {
      _htxt = `⚠ 健康观测不可用（${String(_le.error).slice(0, 40)}）`;
    } else if (_le && _le.count_24h > 0) {
      const _first = (_le.recent && _le.recent[0] && _le.recent[0].msg)
          ? "：" + String(_le.recent[0].msg).slice(0, 60) : "";
      _htxt = `⚠ 最近请求处理失败（近24h ${_le.count_24h} 条·采样窗口）${_first}`;
    }
    if (bot.problem_flags === null) {
      _htxt += (_htxt ? " · " : "") + "⚠ 问题检测观测不可用";
    }
    if (_htxt) {
      hline.textContent = _htxt;
      hline.style.display = "";
    } else {
      hline.style.display = "none";
    }

    const sa = bot.subagents || {};
    // sub 行 = 子代理三态摘要（DB 终态来源）；exitRow = 进程退出（omp/xpi 台账）。
    const doneTxt = sa.completed_24h == null
        ? "已结束 不可用"
        : `已结束 ${sa.completed_24h}`;
    const runTxt = `活跃 ${sa.confirmed_running ?? 0}`;
    const pendingTxt = (sa.open_unverified ?? 0) > 0
        ? ` · 待确认 ${sa.open_unverified}` : "";
    sub.textContent = "";
    sub.appendChild(el("span", "state-tag", "子代理"));
    sub.append(`${runTxt} · ${doneTxt}${pendingTxt}`);
    if (sa.total != null) {
      sub.append(` · 共${sa.total}`);
      if (sa.truncated && (sa.items || []).length < sa.total)
        sub.append(`(显${(sa.items || []).length})`);
    }

    // 第三态：进程退出（omp 台账 / xpi_seen 台账，与子代理 DB 终态不同源）
    // 退出是进程事件，完成是 DB 终态——两态永不相加（Lane V3 C3）
    const ex = sa.omp_exits_24h;
    if (ex && typeof ex === "object") {
      const bits = [];
      if ((ex.omp ?? 0) > 0) bits.push(`omp ${ex.omp}`);
      if ((ex.xpi ?? 0) > 0) bits.push(`xpi_seen ${ex.xpi}`);
      exitRow.textContent = "";
      exitRow.appendChild(el("span", "state-tag", "进程退出"));
      exitRow.append(`${bits.join(" · ") || "0"} · 24h · ID 不同源·未关联`);
      exitRow.style.display = "";
    } else {
      exitRow.style.display = "none";
    }
    // === 统一代理列表：hermes 子代理 + xpi 代理归一（buildUnifiedAgentList 纯函数）===
    const unified = (typeof buildUnifiedAgentList === "function")
        ? buildUnifiedAgentList(bot, Date.now() / 1000)
        : { error: "采集失败" };
    if (unified.error) {
      const err = el("div", "unified-agent-row");
      const tx = el("span", "", unified.error);
      tx.style.color = "var(--red)";
      err.appendChild(tx);
      agentDetail.appendChild(err);
    } else {
      const sm = unified.summary || {};
      let sumTxt = `活跃 ${sm.running ?? 0} · 失联 ${sm.lost ?? 0} · 完成 ${sm.done ?? 0} · 共 ${sm.total ?? 0}`;
      if (unified.truncated) {
        sumTxt += `（已截断 显10/共${sm.total ?? 0}` +
                  (unified.hiddenWarned ? `，含告警 ${unified.hiddenWarned} 条未显` : "") +
                  "）";
      }
      const sumRow = el("div", "unified-agent-row");
      sumRow.appendChild(el("span", "", sumTxt));
      agentDetail.appendChild(sumRow);
      // 活跃代理优先置顶加亮（鸣哥 0924：active subagents must be in the bot's box）
      const _act = (unified.items || []).filter(it => it.status === "进行中" || it.warn);
      const _rest = (unified.items || []).filter(it => !(it.status === "进行中" || it.warn));
      unified.items = _act.concat(_rest);
      if (_act.length) {
        const hd = el("div", "unified-agent-row agent-active-head");
        hd.appendChild(el("span", "agent-active-head-txt", `▶ 活跃代理 ${_act.length}`));
        agentDetail.appendChild(hd);
      }
      const _fmtDur = (sec) => {
        if (typeof sec !== "number" || !isFinite(sec)) return null;
        const s = Math.max(0, Math.round(sec));
        return s >= 3600
            ? Math.floor(s / 3600) + "时" + Math.round((s % 3600) / 60) + "分"
            : Math.round(s / 60) + "分";
      };
      for (const it of (unified.items || [])) {
        const row = el("div", "unified-agent-row");
        const isXpi = it.source === "xpi";
        row.appendChild(el("span", isXpi ? "tag-xpi" : "tag-hermes",
                           isXpi ? "xpi agent" : "hermes agent"));
        row.appendChild(el("span", "", it.desc || ""));
        if (it.model) row.appendChild(el("span", "", String(it.model)));
        const dur = _fmtDur(it.durSec);
        if (dur) row.appendChild(el("span", "", dur));
        if (typeof it.calls === "number") row.appendChild(el("span", "", `calls:${it.calls}`));
        if (it.status) {
          const cls = it.status === "进行中" ? "st-progress"
                    : it.status === "完成" ? "st-done"
                    : it.status === "失联" ? "st-lost" : "";
          row.appendChild(el("span", "status-badge " + cls, it.status));
        } else if (it.statusNote) {
          row.appendChild(el("span", "", it.statusNote));
        }
        if (it.warn) row.appendChild(el("span", "idle-warn", String(it.warn)));
        agentDetail.appendChild(row);
      }
    }
    // 免费模型工作 breakdown（GLM-5.3 设计稿）：免费判定三级优先，未关联诚实标注
    if (window.FleetBreakdown) {
      FleetBreakdown.renderBotBreakdown(agentDetail, bot, { nowMs: Date.now() });
    }

    // 模型分区：免费一行 / 付费一行（远端 bot 数据缺席时诚实标注）。
    // 按渠道身份展开（同 model 不同渠道独立 chip），token 摘要不跨渠道合并。
    const allModels = channelRows(bot);
    const freeMs = allModels.filter(m => ["已确认免费", "有额度限制"].includes(m.free_status));
    const paidMs = allModels.filter(m => ["可能收费", "计费"].includes(m.free_status));
    const unkMs = allModels.filter(m => (m.free_status || "未知") === "未知");
    const noModels = !allModels.length;
    const emptyNote = noModels
        ? (bot.db_status?.status === "unavailable" ? "模型未知（远端 DB 未接）" : "模型未知")
        : null;
    // 驱动关系（免费行 chip 前缀）：DB 无因果链，按时段共现推断，必须带"(推断)"字样。
    // 付费行存在模型时取 last_seen 最新者记 D；付费行为空则不加前缀。
    const paidDriver = modelTimeKey(paidMs.length ? paidMs : null);
    // 免费的归免费行；已确认付费归付费行；资格未知的模型放付费行兜底（不伪装免费/付费）
    renderModelLine(modelFree, "免费", freeMs.length ? freeMs : null, emptyNote, bot.tokens, paidDriver);
    renderModelLine(modelPaid, "付费",
                    paidMs.length ? paidMs : (unkMs.length ? unkMs : null), null, bot.tokens, null);
  }

  // 轻量刷新：只动相对时间类字段（活动年龄 + 代理会话相对时间），不重建业务子树
  function light(bot) {
    const base = fmtActAt(bot.activity.at);
    if (actSrc.textContent !== `来源:${bot.activity.source}${base}`) {
      actSrc.textContent = `来源:${bot.activity.source}${base}`;
    }
    if (agentSession) {
      const now = Date.now() / 1000;
      const spans = agentSession.querySelectorAll(".as-ago") || [];
      spans.forEach(sp => {
        const e = parseFloat((sp.dataset && sp.dataset.epoch) || "");
        if (Number.isFinite(e)) {
          sp.textContent = (sp.dataset.prefix || "") + fmtAgo(now - e);
        }
      });
    }
  }

function procSignalText(bot) {
  // 信号①进程存活（独立通道，不与业务状态混）：pid + 进程链。
  // 双进程是 .venv 入口派生 uv 托管子进程（解释器链），不是双 gateway；
  // 链内 pid 全列出，避免"只报一个"的误读，同时明示只有一个 gateway。
  const p = bot.process || {};
  const label = p.state_label || "未知";
  let t = `进程:${label}`;
  if (p.pid != null) t += ` pid ${p.pid}`;
  const ch = Array.isArray(p.chain) ? p.chain : [];
  if (ch.length > 1) {
    t += ` · ${ch.length} 进程同属一个 gateway（${ch.map(c => `${c.pid}/${c.kind}`).join("、")}）`;
  } else if (p.dup_procs > 0) {
    t += ` · 另有 ${p.dup_procs} 个派生进程`;
  }
  return t;
}

  return { card, update, light, agentSession, budgetRow,
           setAgentCtx(h, b) { latestHost = h; latestBot = b; } };
}

function fmtActAt(at) {
  // 活动时间诚实呈现：>24h 补日期（原只显示 HH:MM:SS，3 天前看着像今天）
  if (!at) return "";
  const s = String(at);
  const t = s.slice(11, 16);
  let ageMs = 0;
  const ts = Date.parse(at);
  if (!Number.isNaN(ts)) ageMs = Date.now() - ts;
  return ` · ${s.slice(5, 10)} ${t}Z`;
}

// Live 代理行（鸣哥 0925 定版：活跃代理必须常显在 bot 卡片里面，不点开就在）。
// 有进行中/失联条目才显示；每条 = 源标签 · 描述 · 模型 · 时长 · 状态徽章。
// 30 分钟保留（鸣哥 0926）：完成的 xpi 代理（doneMinAgo ≤ 30）在常显行保留展示，
// 绿色「已完成」态排在进行中/失联之后。不设 30 分钟的硬截断在 capture 数据源侧
// （xpi_seen / tombstone），前端只按 exit_ago_s 过滤。
function renderLiveAgents(container, bot) {
  container.textContent = "";
  let unified = null;
  try {
    unified = (typeof buildUnifiedAgentList === "function")
        ? buildUnifiedAgentList(bot, Date.now() / 1000) : null;
  } catch (e) { unified = null; }
  if (!unified || unified.error) { container.style.display = "none"; return; }
  // 30 分钟保留（鸣哥 0926）：已退出（中性事件）≤30min 保留展示，GLM 修正：
  // 溢出行必须在常显行内可见（不得藏进展开层），否则保留义务事实上未达成。
  const live = (unified.items || []).filter(it =>
      it.status === "进行中" || it.status === "失联" || it.warn ||
      (it.status === "已退出" && typeof it.doneMinAgo === "number" && it.doneMinAgo <= 30));
  if (!live.length) { container.style.display = "none"; return; }
  const rank = (it) => it.status === "进行中" ? 0 : it.status === "失联" ? 1 : 2;
  live.sort((a, b) => rank(a) - rank(b) || (a.doneMinAgo ?? 0) - (b.doneMinAgo ?? 0));
  container.style.display = "";
  for (const it of live.slice(0, 6)) {
    const row = el("div", "unified-agent-row live-agent-row");
    const isXpi = it.source === "xpi";
    row.appendChild(el("span", isXpi ? "tag-xpi" : "tag-hermes",
                       isXpi ? "xpi agent" : "hermes agent"));
    row.appendChild(el("span", "", it.desc || ""));
    if (it.model) row.appendChild(el("span", "", String(it.model)));
    if (typeof it.durSec === "number" && isFinite(it.durSec)) {
      const mins = Math.max(0, Math.round(it.durSec / 60));
      row.appendChild(el("span", "", mins >= 60
          ? Math.floor(mins / 60) + "时" + (mins % 60) + "分" : mins + "分"));
    }
    if (typeof it.calls === "number") row.appendChild(el("span", "", "calls:" + it.calls));
    if (it.status) {
      const cls = it.status === "进行中" ? "st-progress"
                : it.status === "失联" ? "st-lost"
                : it.status === "已退出" ? "st-neutral" : "";
      row.appendChild(el("span", "status-badge " + cls, it.status));
    }
    if (it.warn) row.appendChild(el("span", "idle-warn", String(it.warn)));
    container.appendChild(row);
  }
  const rest = live.length - Math.min(6, live.length);
  if (rest > 0) {
    const more = el("div", "unified-agent-row live-agent-more");
    more.appendChild(el("span", "", `…另有 ${rest} 条活跃代理，点开卡片查看`));
    container.appendChild(more);
  }
}

function renderModelLine(container, label, models, emptyNote, tokenRes, driver) {
  container.textContent = "";
  if (!Array.isArray(models) && !emptyNote) return;
  if (emptyNote) {
    // 修复：#10 从隐藏切到提示态必须恢复可见
    container.style.display = "";
    container.appendChild(el("div", "model-label", label));
    container.appendChild(el("div", "model-row free-unknown", emptyNote));
    return;
  }
  // 只显示当前在用的模型（recent / last_seen ≤600s）；历史行折成一个徽章。
  // 不允许把有权限的付费模型全挂出来（Lane I §1）。
  // 空列表也要能渲染：update() 传 null（无免费行）时不能 .filter 崩整卡
  const nowMs = Date.now();
  const live = (models || []).filter(m => {
    if (m.recent === true) return true;
    const ms = toEpochMs(m.last_seen_epoch ?? m.last_seen);
    return ms > 0 && (nowMs - ms) <= 600 * 1000;
  });
  // 鸣哥 0924：超 7 天的记录不显示（工具演进期，历史数据无参考价值）
  const SEVEN_DAY_MS = 7 * 86400 * 1000;
  const week = (models || []).filter(m => {
    const ms = toEpochMs(m.last_seen_epoch ?? m.last_seen);
    return ms > 0 && (nowMs - ms) <= SEVEN_DAY_MS;
  });
  const total = week.length;
  const hist = total - live.length;
  const driving = driver && driver.model ? `←${driver.model} 驱动(推断) ` : "";
  for (const m of live) {
    // 每 chip 加 token 摘要（仅匹配该-chip 渠道累计）；无数据不加假数字
    const suf = tokenChipSuffix(m, tokenRes);
    const line = el("div", "model-row " + (FREE_CLASS[m.free_status] || "free-unknown"));
    line.appendChild(el("span", "stat-main", `${driving}${m.model} · ${FREE_SHORT[m.free_status] || "?"}`));
    line.appendChild(el("span", "stat-nums", suf.replace(/^ /, "")));
    container.appendChild(line);
  }
  if (total) {
    container.appendChild(el("div", "model-row free-unknown",
        (live.length ? "" : "近10分钟无模型调用 · ")
        + `近7天模型使用记录（${total}）${total ? " · 更早记录已隐藏" : ""} ›`));
  } else if (!live.length) {
    container.appendChild(el("div", "model-row free-unknown", "近10分钟无模型调用"));
  }
}

// 节点复用仓库：bot.id -> {card, update, sig}
const CARD_POOL = new Map();
// 快照超过 unknown 阈值：全局失联态（失联期不再把历史①计入"工作中"/播放动画）
let SNAP_UNKNOWN = false;

// ---- 代理会话（代理行 + 退出明细合并；Astra UI1 定稿 + UI2 复审修复）----
// 状态用户语言：存活·已跑 X / 已退出 X 前 / 失联·最后见于 X 前；不显示"僵死"。
// 每行：taskbook · 模型短名 / 状态（噪音文案已移除，鸣哥 0923）
// 展开（card.open）时显示全部行 + 原始退出原因解释（Astra A1/C2）。
function fmtAgo(secs) {
  if (!Number.isFinite(secs) || secs < 0) return "?";
  if (secs < 60) return "刚刚";
  if (secs < 3600) return Math.round(secs / 60) + " 分钟前";
  if (secs < 86400) return Math.round(secs / 3600) + " 小时前";
  return Math.round(secs / 86400) + " 天前";
}
function agentSessionSig(host, bot) {
  return JSON.stringify([bot.agents_completed_4h, bot.agents_completed_buckets, bot.agents_completed_coverage]);
}

function renderAgentSession(host, bot, row, card) {
  row.style.display = "";
  row.textContent = "";
  const colors = {normal: "var(--accent, #3bd6c6)", failed: "#ef4444", timeout: "#ef4444", unknown: "#94a3b8"};
  const cov = bot.agents_completed_coverage || {};
  row.appendChild(el("div", "stat-line", `退出/结束记录 · 近4h · ${bot.agents_completed_4h?.length ?? "未知"} 条（非精确任务数）`));
  if (Object.values(cov).some(v => v !== "observed" && v !== "complete")) {
    const note = el("div", "stat-line",
        host.ledger_coverage === "omp 未部署" ? "omp 未部署于该主机"
      : host.ledger_coverage === "台账未接入" ? "台账未接入（二期）"
      : "部分来源未覆盖");
    note.title = Object.entries(cov).map(([k,v]) => k + ":" + v).join(" · ");
    row.appendChild(note);
  }
  for (const item of bot.agents_completed_4h || []) {
    const line = el("div", "stat-line");
    line.style.color = colors[item.outcome] || colors.unknown;
    line.textContent = [item.taskbook || "任务书未知", item.model || "模型未知", item.tokens == null ? "tokens未知" : item.tokens + " tokens", item.outcome,
      new Date(item.ended_at * 1000).toLocaleString()].join(" · ");
    line.title = item.outcome_basis == null ? "原始原因未记录" : String(item.outcome_basis);
    row.appendChild(line);
  }
  for (const name of ["4–24h", "24h–7d", "unknown"]) {
    const bucket = bot.agents_completed_buckets?.[name] || {};
    const total = Object.values(bucket).reduce((a,b) => a+b, 0);
    row.appendChild(el("div", "stat-line", `${name === "unknown" ? "时间未知/近似" : name} · ${total} 条`));
    const bar = el("div"); bar.style.cssText = "display:flex;height:8px;background:#94a3b822;margin:3px 0";
    for (const outcome of ["normal", "failed", "timeout", "unknown"]) {
      const segment = el("span"); segment.style.width = (total ? 100 * (bucket[outcome] || 0) / total : 0) + "%";
      segment.style.background = colors[outcome]; segment.title = `${name} · ${outcome}: ${bucket[outcome] || 0}`;
      bar.appendChild(segment);
    }
    row.appendChild(bar);
  }
}
function budgetSig(bot, snap) {
  return JSON.stringify({ b: bot.session_budget || null, w: snap?.context_windows || null });
}
function renderSessionBudget(bot, row, snap) {
  const sb = bot.session_budget;
  if (!sb || (!sb.last_prompt_tokens && !sb.model)) { row.style.display = "none"; return; }
  row.style.display = "";
  row.textContent = "";
  const winMap = snap?.context_windows || {};
  const keys = Object.keys(winMap).sort((a, b) => b.length - a.length);
  const mdl = sb.model || "";
  let win = null;
  for (const k of keys) {
    if (mdl.startsWith(k)) { win = winMap[k]; break; }
  }
  const parts = [];
  parts.push("当前: " + (sb.model || "未知"));
  parts.push("上下文 " + (sb.last_prompt_tokens ? fmtTokens(sb.last_prompt_tokens) : "未知")
      + (win ? "/" + fmtTokens(win) : "/窗口未知"));
  const line = el("div", "model-row free-unknown");
  line.textContent = parts.join(" · ");
  row.appendChild(line);
}

function fmtLedgerTime(v) {
  // 秒级 epoch / ISO 字符串皆可；缺失时如实显示，不报 NaN
  const ms = toEpochMs(v);
  if (!ms) return "?";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(v);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function render(snap) {
  const main = document.getElementById("main");
  let total = 0, working = 0, warn = 0, workBefore = 0;
  // 全局失联态：快照年龄 > unknown 阈值后，历史①不再计入"当前工作中"/播放动画（Astra §1/验收）
  const gen = new Date(snap.generated_at);
  const age = (Date.now() - gen.getTime()) / 1000;
  const unknown = isNaN(age) || age > (snap.unknown_after_s || 120);
  SNAP_UNKNOWN = unknown;
  const seenIds = new Set();
  // 按 host 分组现有卡片，保持 DOM 稳定：只增补新 bot 的卡片，绝不重建旧节点
  const sections = main.querySelectorAll(":scope > .host-section");
  const hostByShort = {};
  (snap.hosts || []).forEach(h => { hostByShort[h.short] = h; });

  // 若主机集合本身变了（Phase 切换），只能整体重建一次。
  // 必须同时清空 CARD_POOL：#9 旧卡片对象已不在 DOM，但池里仍有引用，
  // 不清空后续分支只会调用 update 而从不会重新 append → 整批卡片不出现。
  const shorts = (snap.hosts || []).map(h => h.short).join("|");
  if (main.dataset.hostKey !== shorts) {
    main.textContent = "";
    main.dataset.hostKey = shorts;
    CARD_POOL.clear();
    for (const host of snap.hosts || []) {
      const sec = el("section", "host-section");
      sec.dataset.short = host.short;
      const head = el("div", "host-head");
      head.appendChild(el("span", "host-name", `▍${host.host_id}`));
      head.appendChild(el("span", "host-meta"));
      sec.appendChild(head);
      sec.appendChild(el("div", "cards"));
      main.appendChild(sec);
    }
  }

  for (const host of snap.hosts || []) {
    const sec = main.querySelector(`.host-section[data-short="${host.short}"]`);
    const meta = sec.querySelector(".host-meta");
    const ua = host.xpi_unattributed;
    const uaText = ua && ua.count > 0
        ? ` · ⚠ 未归属代理 ${ua.count}` + (ua.pipe_dropped ? `（另有跨机管道 ${ua.pipe_dropped} 已排除）` : "")
        : "";
    // host-meta（Astra R2-5）：观测时间 + 采集错误 + 未归属代理一行。
    // observed_at 缺失（远端节点未回填）时如实显示 ?，不冒充新鲜。
    const oeU = (host.omp_exits?.by_bot_24h || host.omp_exits?.recent_24h?.by_bot_24h || {}).unknown || 0;
    const uExit = oeU > 0 ? ` · 未归属退出 ${oeU}` : "";
    const metaText = `${host.short} · 观测 ${host.observed_at || "?"}` +
                     (host.error ? ` · 采集错误:${host.error}` : "") + uaText + uExit;
    if (meta.textContent !== metaText) meta.textContent = metaText;
    const cards = sec.querySelector(".cards");

    cards.querySelectorAll(".retired-row").forEach(n => n.remove());
    for (const bot of host.bots || []) {
      // 已迁移 bot 不再展示（迁移信息在活体所在主机卡片上可见）
      if (bot.tri?.tri === "retired") {
        // 已迁移 bot 不整卡跳过：掩盖"原机已死"即假正常（Nelson .65 死 50 天被整卡跳过）
        const rrow = document.createElement("div");
        rrow.className = "retired-row";
        // 旧实例未运行：标实例+最后活动记录，禁"死因"（Astra NL2 C4——不能暗示当前 bot 死亡）
        const goneAt = bot.activity && bot.activity.at
            ? String(bot.activity.at).slice(0, 10) : "?";
        const mig = bot.tri?.reason ? ` · ${bot.tri.reason}` : "";
        rrow.textContent = `${bot.display_name || bot.profile} · 旧实例未运行 · 最后活动记录 ${goneAt}${mig}`;
        rrow.style.color = "var(--dim)";
        rrow.style.fontSize = "12px";
        rrow.style.padding = "2px 12px";
        cards.appendChild(rrow);
        continue;
      }
      seenIds.add(bot.id);
      let entry = CARD_POOL.get(bot.id);
      const sig = botSignature(bot);
      if (!entry) {
        entry = makeBotCard(bot, host.short, host);
        entry.sig = sig;
        CARD_POOL.set(bot.id, entry);
        cards.appendChild(entry.card);
      } else if (entry.sig !== sig) {
        entry.update(bot);   // 内容变了 → 业务子树重建（节点身份不变）
        entry.sig = sig;
      } else {
        entry.light(bot);    // #8 相同签名：跳过业务 patch，仅轻量刷新相对时间
      }
      // 代理会话（代理行+退出明细合并）：每 bot 独立 sig 刷新，与卡片主签名解耦
      if (entry.setAgentCtx) entry.setAgentCtx(host, bot);
      if (entry.agentSession) {
        const as = agentSessionSig(host, bot);
        if (entry.agentSession.dataset.sig !== as) {
          entry.agentSession.dataset.sig = as;
          entry.agentSession.textContent = "";
          renderAgentSession(host, bot, entry.agentSession, entry.card);
        }
      }
      // 上下文预算（当前付费模型/上下文/窗口）
      if (entry.budgetRow) {
        const bs = budgetSig(bot, snap);
        if (entry.budgetRow.dataset.sig !== bs) {
          entry.budgetRow.dataset.sig = bs;
          entry.budgetRow.textContent = "";
          renderSessionBudget(bot, entry.budgetRow, snap);
        }
      }
      total++;
      // 端工作数按三态主标签统计（代理执行中/本体工作中均算 working）。
      // 失联期：历史 working 不算"当前工作中"，仅记"失联前"参考数。
      if (bot.tri?.tri === "working") { workBefore++; if (!unknown) working++; }
      if ((bot._severity || 0) >= 2) warn++;
    }
  }
  // 清理消失的 bot 卡片
  for (const id of [...CARD_POOL.keys()]) {
    if (!seenIds.has(id)) {
      CARD_POOL.get(id).card.remove();
      CARD_POOL.delete(id);
    }
  }

  document.getElementById("stats-row").textContent = "";
  const stats = document.getElementById("stats-row");
  const mk = (label, val) => { const s = el("span"); s.appendChild(el("b", null, val)); s.append(` ${label}`); return s; };
  stats.appendChild(mk("台主机", String((snap.hosts || []).length)));
  stats.appendChild(mk("个 bot", String(total)));
  stats.appendChild(mk(unknown ? "工作中(观察不可用)" : "个工作中",
                       unknown ? (workBefore ? `0（失联前 ${workBefore}）` : "0") : String(working)));
  stats.appendChild(mk("个告警", String(warn)));

  // 全局代理条：全舰队每个代理一枚胶囊（名字·模型·任务书·时长·状态）
  // 卡住判定：活进程 age>=1800s（30分无新鲜证据）→ 红胶囊 + 顶部滚动字幕
  const agStateTxt = (it) => {
    if (it.state === "dead" || it.state === "unverified_exit") return "已退出·原因未确认";
    // fresh = 进程启动≤2分钟 OR CPU 增量>0（collect 已算好）；年龄态不再冒充执行证据（Astra FINAL F4）
    if (it.fresh) return "执行中";
    if (Number.isFinite(it.age_s)) return `存活·${Math.round(it.age_s / 60)} 分无新进展`;
    return "采集失败·无法确认";
  };
  const agItems = [];
  for (const h of (snap.hosts || [])) {
    for (const b of (h.bots || [])) {
      for (const it of ((b.xpi_agents || {}).items || [])) {
        const bits = [b.display_name || b.profile];
        if (it.model) bits.push(String(it.model));
        if (it.taskbook) bits.push(String(it.taskbook));
        if (Number.isFinite(it.age_s)) {
          bits.push(it.age_s < 120 ? `新鲜 ${it.age_s}s` : `已跑 ${Math.round(it.age_s / 60)} 分`);
        }
        bits.push(agStateTxt(it));
        agItems.push({ text: bits.join(" · "),
                       stuck: it.state !== "dead" && it.state !== "unverified_exit"
                             && Number.isFinite(it.age_s) && it.age_s >= 1800 });
      }
      for (const s of ((b.subagents || {}).items || [])) {
        if (s.confirmed_running) {
          const d = s.last_activity_description ? ` · ${s.last_activity_description}` : "";
          agItems.push({ text: `${b.display_name || b.profile} · DB子代理 ${String(s.child_session_id || "").slice(0, 12)} · ${s.actual_model || s.config_model || "?"} 执行中${d}`, stuck: false });
        }
      }
    }
  }
  const agentBar = document.getElementById("agent-bar");
  agentBar.textContent = "";
  if (agItems.length) {
    agentBar.style.display = "";
    for (const a of agItems) {
      const t = el("span", a.stuck ? "agent-pill agent-stuck" : "agent-pill");
      t.textContent = a.text;
      agentBar.appendChild(t);
    }
  } else {
    agentBar.style.display = "none";
  }
  const marquee = document.getElementById("alert-marquee");
  const stuckAll = agItems.filter(a => a.stuck);
  marquee.textContent = stuckAll.length
      ? `⚠ 卡住/长跑代理（≥30分）：` + stuckAll.map(a => a.text).join("　◆　")
      : "";
  marquee.classList.toggle("hidden", !stuckAll.length);

  // 免费额度 bar（docs/free-quota-design.md）：只读快照投影，无网络
  if (window.FleetFreeQuota && snap.free_quota) {
    FleetFreeQuota.render(document.getElementById("free-quota"), snap.free_quota,
                          { snapshotFreshness: !unknown });
  }

  const fb = document.getElementById("fresh-badge");
  const banner = document.getElementById("stale-banner");
  if (!unknown) {
    if (age <= (snap.stale_after_s || 45)) {
      fb.textContent = "● LIVE"; fb.style.color = "var(--green)"; banner.classList.add("hidden");
    } else {
      fb.textContent = "● STALE"; fb.style.color = "var(--amber)";
      banner.textContent = `采集器数据已过期 ${Math.round(age)}s — 显示最后一次成功快照`;
      banner.classList.remove("hidden");
    }
  } else {
    fb.textContent = "● UNKNOWN"; fb.style.color = "var(--purple)";
    banner.textContent = `采集器失联 ${Math.round(Math.max(age, 0))}s — 数据不可信，仅作参考`;
    banner.classList.remove("hidden");
  }
  const sc = snap.self_check;
  const scNote = sc && sc.error_count + sc.warning_count > 0
      ? ` · 自检: ${sc.error_count} 错误 / ${sc.warning_count} 警告` : "";
  document.getElementById("footer-info").textContent =
    `快照 ${snap.generated_at} · cycle ${snap.collector?.cycle ?? "?"} · 15s 采集 / 5s 刷新 · 只读监控${scNote}`;
}

let lastSnap = null;      // 最后一次成功快照（丢失后用于本地时钟推进新鲜度）
let inFlight = false;     // 单在途请求约束：慢请求未归位前跳过本轮，防旧响应覆盖新响应

async function tick() {
  if (inFlight) return;   // 防重叠：上一轮请求仍在途，跳过本轮
  inFlight = true;
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const snap = await r.json();
    lastSnap = snap;
    render(snap);
  } catch (e) {
    const banner = document.getElementById("stale-banner");
    banner.textContent = `无法读取快照：${e.message}`;
    banner.classList.remove("hidden");
    // 连续失败：按最后成功证据时间用本地时钟推进新鲜度。
    // 重放最后快照（generated_at 固定 → 年龄随本地时钟增长），
    // 超过 unknown 阈值自动转灰"观测不可用"并停止工作动画。
    if (lastSnap) render(lastSnap);
  } finally {
    inFlight = false;
  }
}
tick();
setInterval(tick, 5000);

// 全部代理非活跃（无运行中/长跑活跃）的 X-Pi 行变暗色（class 单选；暗化规则内联注入，不动 style.css）
(function () {
  const st = document.createElement("style");
  st.textContent = ".xpi-row.xpi-done { color: var(--dim); opacity: .6; }";
  document.head.appendChild(st);
})();
