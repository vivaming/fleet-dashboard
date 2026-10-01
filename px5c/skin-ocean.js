/* ============================================================
   fleet-monitor · OCEAN skin  (lane P5C)
   冷海风：#081018 深蓝底 + 青/天蓝主调 + 条形图 2px 亮帽
   ------------------------------------------------------------
   纯皮肤层：自己 fetch /api/status（api-override 已重定向到
   api_status.json），按真实数据算比例，注入条形图到原面板 DOM。
   不改 static/ 原文件；命名空间 body.px-ocean（CSS 加载顺序在最后，
   与 body.jevdesk 同特异性时按源顺序覆盖）。

   画了几种条形图（数据字段）：
     SYSTEM  FLEET HEALTH  hosts[].bots -> process.state_label / tri / _severity  -> ok/warn/off
     SYSTEM  WORK LOAD     tri === "working" 占比 -> live/idle
     SYSTEM  AGENTS 7D     agents_completed_buckets 汇总 -> normal/failed+timeout/unknown
     SYSTEM  TOKEN MIX     tokens.totals 汇总 input/output/cache_read+cache_write
     SYSTEM  LOG ERR 24H   log_errors.count_24h 全舰队合计（500 封顶刻度）
     HOST    BOTS          每 host 的 bot 健康占比 -> ok/warn/off
     BOT     USAGE         该 bot tokens 总量 vs 全舰队最大 bot（in/out/cache 三段）
     BOT     AGENTS        该 bot 完成桶 normal/failed/unknown vs 全舰队最大
     BOT     LOG ERR       该 bot log_errors.count_24h vs 全舰队最大
   ============================================================ */
"use strict";

(function () {
  var REFRESH = 5000;   // 数据轮询，与 app.js 同频
  var POLL = 400;       // DOM 注入巡检（app.js 会重建 host-section，需自愈合）
  var ERR_CAP = 500;    // log_errors 单条刻度封顶（采样窗口计数，非线性指标）

  /* ---------------- 工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function pct(v) { v = isFinite(v) ? v : 0; return v < 0 ? 0 : (v > 100 ? 100 : v); }
  function maxOf(list, fn) { return list.reduce(function (a, m) { return Math.max(a, fn(m)); }, 0); }

  // 1.45G / 73.2M / 200.8K：条形图右侧与图例统一精度
  function fmtTok(n) {
    n = n || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "G";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
    return String(n);
  }

  /* ---------------- 数据 -> 指标 ---------------- */
  // 单 bot 指标：tokens 汇总 / 完成桶汇总 / 子代理 / 日志 / 三态健康
  function botMetrics(b, short, hostId) {
    var t = { in: 0, out: 0, cr: 0, cw: 0, calls: 0 };
    (b.tokens && b.tokens.totals || []).forEach(function (x) {
      t.in += x.input || 0;
      t.out += x.output || 0;
      t.cr += x.cache_read || 0;
      t.cw += x.cache_write || 0;
      t.calls += x.calls || 0;
    });
    t.total = t.in + t.out + t.cr + t.cw;

    var ag = { normal: 0, failed: 0, timeout: 0, unknown: 0 };
    var bk = b.agents_completed_buckets || {};
    Object.keys(bk).forEach(function (k) {
      var x = bk[k] || {};
      ag.normal += x.normal || 0;
      ag.failed += x.failed || 0;
      ag.timeout += x.timeout || 0;
      ag.unknown += x.unknown || 0;
    });
    ag.fail = ag.failed + ag.timeout;
    ag.total = ag.normal + ag.fail + ag.unknown;

    var sa = b.subagents || {};
    var pl = b.process || {};
    var le = b.log_errors || {};
    var tri = (b.tri && b.tri.tri) || "";
    var label = pl.state_label || "未知";
    var offline = label === "offline" || label === "未发现，待确认" || tri === "unreachable";
    var health = offline ? "off" : ((b._severity || 0) >= 2 ? "warn" : "ok");

    return {
      id: b.id, name: b.display_name || b.profile, profile: b.profile,
      short: short, hostId: hostId,
      health: health, sev: b._severity || 0, tri: tri,
      working: tri === "working", state: (b.work && b.work.state) || "",
      proc: label, pid: pl.pid, startAt: pl.start_at || null,
      t: t, ag: ag,
      sub24: sa.completed_24h || 0, subRun: sa.confirmed_running || 0,
      err24: le.count_24h || 0, calls: t.calls
    };
  }

  // 全舰队汇总 + 各 host 健康计数 + 归一化刻度（max*）
  function compute(snap) {
    var hosts = (snap.hosts || []).map(function (h) {
      var bots = (h.bots || []).map(function (b) { return botMetrics(b, h.short, h.host_id); });
      var c = { ok: 0, warn: 0, off: 0, live: 0 };
      bots.forEach(function (m) { c[m.health]++; if (m.working) c.live++; });
      return { id: h.host_id, short: h.short, observed: h.observed_at || "?",
               error: h.error || null, bots: bots, count: bots.length, c: c };
    });
    var all = hosts.reduce(function (a, h) { return a.concat(h.bots); }, []);
    var tok = { in: 0, out: 0, cr: 0, cw: 0, calls: 0 };
    var ag = { normal: 0, fail: 0, unknown: 0 };
    var err24 = 0;
    all.forEach(function (m) {
      tok.in += m.t.in; tok.out += m.t.out; tok.cr += m.t.cr; tok.cw += m.t.cw;
      tok.calls += m.t.calls;
      ag.normal += m.ag.normal; ag.fail += m.ag.fail; ag.unknown += m.ag.unknown;
      err24 += m.err24;
    });
    tok.total = tok.in + tok.out + tok.cr + tok.cw;
    ag.total = ag.normal + ag.fail + ag.unknown;

    // 集群 up 时长 = 最早进程启动 -> 快照生成时刻
    var starts = all.map(function (m) { return Date.parse(m.startAt || ""); })
                    .filter(function (v) { return isFinite(v); });
    var upS = 0;
    if (starts.length) {
      upS = (Date.parse(snap.generated_at) - Math.min.apply(null, starts)) / 1000;
      if (!isFinite(upS) || upS < 0) upS = 0;
    }

    return {
      snap: snap, hosts: hosts, bots: all, n: all.length,
      ok: hosts.reduce(function (a, h) { return a + h.c.ok; }, 0),
      warn: hosts.reduce(function (a, h) { return a + h.c.warn; }, 0),
      off: hosts.reduce(function (a, h) { return a + h.c.off; }, 0),
      live: hosts.reduce(function (a, h) { return a + h.c.live; }, 0),
      tok: tok, ag: ag, err24: err24, upS: upS,
      maxTok: maxOf(all, function (m) { return m.t.total; }),
      maxAg: maxOf(all, function (m) { return m.ag.total; }),
      maxErr: maxOf(all, function (m) { return m.err24; })
    };
  }

  /* ---------------- 条形图组件 ----------------
     实心色块 + 暗底轨道 + 2px 亮帽；条高 16px、直角、无渐变。
     segs = [[色类, 数值], ...]；fillPct 为整条填充百分比，
     各段宽度 = 段值 / 段合计（组成精确，条长 = 相对刻度）。 */
  function segBar(fillPct, segs) {
    var bar = el("div", "ox-bar");
    var fill = el("div", "ox-fill");
    fill.style.width = pct(fillPct) + "%";
    var tot = 0;
    segs.forEach(function (s) { tot += s[1] || 0; });
    if (fillPct > 0 && tot > 0) {
      segs.forEach(function (s) {
        if (!(s[1] > 0)) return;
        var sp = el("div", "ox-seg ox-" + s[0]);
        sp.style.width = (s[1] / tot * 100) + "%";
        fill.appendChild(sp);
      });
      fill.appendChild(el("div", "ox-cap"));
    }
    bar.appendChild(fill);
    return bar;
  }

  // 一行情节：左标签(+副标) / 中条 / 右数值
  function row(label, sub, bar, right, cls) {
    var r = el("div", "ox-row");
    var rl = el("div", "ox-rl");
    var t = el("div", "ox-rt"); t.textContent = label; rl.appendChild(t);
    if (sub) { var s = el("div", "ox-rs"); s.textContent = sub; rl.appendChild(s); }
    r.appendChild(rl);
    r.appendChild(bar);
    var rn = el("div", "ox-rn" + (cls ? " " + cls : ""));
    rn.textContent = right == null ? "" : String(right);
    r.appendChild(rn);
    return r;
  }

  // 参考图 section 标题行：NAME ———— value
  function titleRow(label, val) {
    var d = el("div", "ox-title");
    var l = el("div", "ox-tt"); l.textContent = label; d.appendChild(l);
    d.appendChild(el("div", "ox-tr"));
    var v = el("div", "ox-tv"); v.textContent = val || ""; d.appendChild(v);
    return d;
  }

  /* ---------------- 图例 ---------------- */
  var LEG = [["s", "IN"], ["t", "OUT"], ["c", "CACHE"], ["g", "OK"],
             ["r", "FAIL"], ["y", "WARN"], ["n", "IDLE"]];
  function legend() {
    var d = el("div", "ox-legend");
    LEG.forEach(function (p) {
      var i = el("div", "ox-lg");
      i.appendChild(el("i", "ox-seg ox-" + p[0]));
      var s = el("span", "ox-ls"); s.textContent = p[1]; i.appendChild(s);
      d.appendChild(i);
    });
    return d;
  }

  /* ---------------- 静态骨架自愈合 ----------------
     app.js 在 host 集合变化时 main.textContent="" 整体重建，
     会顺带清掉注入的 #ox-dash / #ox-status，这里补齐。 */
  function ensure() {
    var head = $("header");
    if (head && !head.querySelector("#ox-status")) {
      var st = el("div", "ox-status");
      st.id = "ox-status";
      head.insertBefore(st, head.firstChild);
    }
    var main = $("main");
    if (main && !main.querySelector("#ox-dash")) {
      var dash = el("section", "ox-dash");
      dash.id = "ox-dash";
      main.insertBefore(dash, main.firstChild);
    }
    if (!document.querySelector(".ox-bg")) {
      var bg = el("div", "ox-bg");
      bg.setAttribute("aria-hidden", "true");
      document.body.insertBefore(bg, document.body.firstChild);
    }
  }

  /* ---------------- 终端状态行 ----------------
     hub · WED 22:37:15 · up 7d 9h · every 5s · ● LIVE */
  var _stSig = "";
  function renderStatus(sys) {
    var host = $("#ox-status");
    if (!host) return;
    var snap = sys.snap;
    var d = new Date(snap.generated_at);
    if (!(d instanceof Date) || isNaN(d.getTime())) return;
    var age = (Date.now() - d.getTime()) / 1000;
    var lost = !isFinite(age) || age > (snap.unknown_after_s || 145);
    var fresh = isFinite(age) && age <= (snap.stale_after_s || 70);
    var days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    var time = days[d.getDay()] + " " + pad(d.getHours()) + ":" +
               pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    var u = sys.upS;
    var ud = Math.floor(u / 86400), uh = Math.floor((u % 86400) / 3600);
    var up = (ud ? ud + "d " : "") + uh + "h";
    var parts = [
      ["hub", ""],
      ["t", time],
      ["u", "up " + up],
      ["e", "every " + (snap.web_refresh_hint_s || 5) + "s"],
      ["l", lost ? "● LOST" : (fresh ? "● LIVE" : "● STALE")]
    ];
    var sig = parts.map(function (p) { return p[1]; }).join("|");
    if (sig === _stSig) return;
    _stSig = sig;
    host.innerHTML = "";
    parts.forEach(function (p, i) {
      var s = el("span", "ox-st" + (i === parts.length - 1 ? " ox-live" : ""));
      s.textContent = p[1];
      host.appendChild(s);
      if (i < parts.length - 1) host.appendChild(document.createTextNode("  ·  "));
    });
  }

  /* ---------------- SYSTEM 概览面板 ---------------- */
  var _dashSig = "";
  function renderDash(sys) {
    var host = $("#ox-dash");
    if (!host) return;
    var sig = JSON.stringify([sys.n, sys.ok, sys.warn, sys.off, sys.live,
                              sys.tok, sys.ag, sys.err24]);
    if (sig === _dashSig) return;
    _dashSig = sig;
    host.innerHTML = "";
    host.appendChild(titleRow("SYSTEM",
      sys.n + " BOTS · " + sys.live + " LIVE" + (sys.warn ? " · " + sys.warn + " WARN" : "")));

    var g = el("div", "ox-grid");
    g.appendChild(row("FLEET HEALTH", "ok / warn / off",
      segBar(100, [["g", sys.ok], ["y", sys.warn], ["r", sys.off]]),
      sys.ok + " ok" + (sys.warn ? " · " + sys.warn + " warn" : "") +
        (sys.off ? " · " + sys.off + " off" : "")));
    g.appendChild(row("WORK LOAD", "live / idle",
      segBar(100, [["c", sys.live], ["n", Math.max(0, sys.n - sys.live)]]),
      sys.live + " live"));
    g.appendChild(row("AGENTS 7D", "normal / fail / unknown",
      segBar(100, [["g", sys.ag.normal], ["r", sys.ag.fail], ["s", sys.ag.unknown]]),
      sys.ag.normal + " ok · " + sys.ag.fail + " fail"));
    g.appendChild(row("TOKEN MIX", "in / out / cache",
      segBar(100, [["s", sys.tok.in], ["t", sys.tok.out], ["c", sys.tok.cr + sys.tok.cw]]),
      fmtTok(sys.tok.total)));
    var eCls = sys.err24 >= 600 ? "ox-hot" : (sys.err24 >= 250 ? "" : "ox-cold");
    g.appendChild(row("LOG ERR 24H", "24h · sample window",
      segBar(pct(sys.err24 / ERR_CAP * 100),
             [[sys.err24 >= 600 ? "r" : "y", sys.err24]]),
      String(sys.err24), eCls));
    g.appendChild(row("CALLS", "api calls · total",
      segBar(100, [["c", sys.tok.calls]]),
      fmtTok(sys.tok.calls)));
    host.appendChild(g);
    host.appendChild(legend());
  }

  /* ---------------- HOST 概览条 ---------------- */
  function renderHostBars(sys) {
    sys.hosts.forEach(function (h) {
      var sec = document.querySelector('.host-section[data-short="' + (h.short || "").replace(/"/g, "") + '"]');
      if (!sec) return;
      var sig = JSON.stringify([h.count, h.c, h.observed, h.error]);
      var old = sec.querySelector(".ox-hostbar");
      if (old && old.dataset.sig === sig) return;
      if (old) old.remove();

      var wrap = el("div", "ox-hostbar");
      wrap.dataset.sig = sig;
      var c = h.c;
      wrap.appendChild(row("BOTS", (h.short || "") + " · " + (h.id || ""),
        segBar(100, [["g", c.ok], ["y", c.warn], ["r", c.off]]),
        h.count + " · " + c.ok + " ok" +
          (c.live ? " · " + c.live + " live" : "") +
          (c.warn ? " · " + c.warn + " warn" : "") +
          (c.off ? " · " + c.off + " off" : "")));
      sec.appendChild(wrap);
    });
  }

  /* ---------------- BOT 卡片条形图 ---------------- */
  function renderBotBars(sys) {
    var maxTok = sys.maxTok || 1, maxAg = sys.maxAg || 1, maxErr = sys.maxErr || 1;
    all(".bot-card").forEach(function (card) {
      var top = card.querySelector(".bot-top");
      var nm = top && top.querySelector(".bot-name");
      if (!nm) return;
      var key = "";
      var hs = card.querySelector(".bot-host");
      if (hs && hs.firstChild) key = hs.firstChild.textContent.split("·")[0].trim();
      var m = sys.bots.filter(function (x) {
        return x.name === nm.textContent && (!key || x.short === key);
      })[0];
      if (!m) return;

      var sig = JSON.stringify([m.t, m.ag, m.err24, m.calls, maxTok, maxAg, maxErr]);
      var old = card.querySelector(".ox-bars");
      if (old && old.dataset.sig === sig) return;
      if (old) old.remove();

      var wrap = el("div", "ox-bars");
      wrap.dataset.sig = sig;
      var tokTxt = fmtTok(m.t.total) + " · " + m.calls + " calls";
      wrap.appendChild(row("USAGE", "in / out / cache",
        segBar(pct(m.t.total / maxTok * 100),
          [["s", m.t.in], ["t", m.t.out], ["c", m.t.cr + m.t.cw]]),
        tokTxt, m.t.total === maxTok ? "ox-hot" : ""));
      var agTxt = m.ag.total === 0 ? "0"
        : m.ag.normal + " ok · " + m.ag.fail + " fail";
      wrap.appendChild(row("AGENTS", "normal / fail · 7d",
        segBar(pct(m.ag.total / maxAg * 100),
          [["g", m.ag.normal], ["r", m.ag.fail], ["s", m.ag.unknown]]),
        agTxt, m.ag.fail > 0 ? "ox-hot" : ""));
      wrap.appendChild(row("LOG ERR", "24h · sample window",
        segBar(pct(m.err24 / maxErr * 100),
          [m.err24 >= 250 ? "r" : (m.err24 >= 80 ? "y" : "c"), m.err24]),
        String(m.err24), m.err24 >= 250 ? "ox-hot" : ""));
      card.insertBefore(wrap, top ? top.nextSibling : card.firstChild);
    });
  }

  /* ---------------- 主循环 ---------------- */
  var sys = null;
  function sync() {
    ensure();
    if (!sys) return;
    renderStatus(sys);
    renderDash(sys);
    renderHostBars(sys);
    renderBotBars(sys);
  }

  function load() {
    if (typeof window.fetch !== "function") return;
    window.fetch("/api/status", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (snap) { sys = compute(snap); sync(); })
      .catch(function () { /* 静默：app.js 自己有错误横幅 */ });
  }

  function init() {
    ensure();
    load();
    setInterval(load, REFRESH);
    setInterval(sync, POLL);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
