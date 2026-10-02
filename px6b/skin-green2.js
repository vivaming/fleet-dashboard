/* ============================================================
   PX6-B · skin-green2.js — 终端绿磷光 fleet dashboard
   HUB 版式 + 像素图标矩阵 + drilldown usage
   body class: px6-green
   —— 复用 app.js 的 5s 轮询循环：重定义全局 render(snap)，
      由 app.js 的 tick() 驱动本 HUB 皮肤渲染。
   ============================================================ */
(function () {
  "use strict";
  if (!document.body) document.addEventListener("DOMContentLoaded", boot);
  else boot();

  function boot() {
    document.body.classList.add("px6-green");

    /* ---------- 状态 ---------- */
    const state = { botId: null, last: null };

    /* ---------- 小工具 ---------- */
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function fmt(n) {
      if (n === undefined || n === null || isNaN(n)) return "0";
      if (n < 1000) return String(Math.round(n));
      if (n < 1e6) return (n / 1e3).toFixed(1) + "K";
      if (n < 1e9) return (n / 1e6).toFixed(1) + "M";
      return (n / 1e9).toFixed(2) + "B";
    }
    const epochPad = (seg) => String(seg).padStart(2, "0");

    /* ---------- 成功率 → 颜色（全站统一：橙→绿，hue 插值）
       hue = 0 + (rate/100)*110
       rate 0   → hue 0   (红橙 #ef4444 一带)
       rate 70  → hue 77  (橙黄 #f59e0b 一带)
       rate 100 → hue 110 (终端绿 #2ecc71 一带)
       百分比越高越绿。                        ---------- */
    function rateColor(rate) {
      const r = Math.max(0, Math.min(100, rate));
      const hue = (r / 100) * 110;
      return "hsl(" + hue.toFixed(1) + ", 92%, 46%)";
    }
    function successRate(bucket) {
      const n = (bucket && bucket.normal) || 0,
            f = (bucket && bucket.failed) || 0,
            t = (bucket && bucket.timeout) || 0;
      const denom = n + f + t;
      return denom ? (n / denom) * 100 : 100;
    }
    function histBuckets(bot) {
      const b = (bot && bot.agents_completed_buckets) || {};
      const out = [];
      for (const key of ["4h", "4–24h", "24h–7d"]) {
        const bb = b[key] || {};
        const rate = successRate(bb);
        out.push({
          label: key, rate,
          normal: bb.normal || 0,
          bad: (bb.failed || 0) + (bb.timeout || 0),
          total: (bb.normal || 0) + (bb.failed || 0) + (bb.timeout || 0),
        });
      }
      return out;
    }
    function totalsOf(bot) {
      const src = (bot.tokens && Array.isArray(bot.tokens.totals) && bot.tokens.totals) ||
                 (bot.usage && Array.isArray(bot.usage.totals) && bot.usage.totals) || [];
      const map = Object.create(null);
      /* 同 provider+model 归并（多渠道累计仍独立展示，保真实性） */
      for (const t of src) {
        const model = t.model || "?";
        const prov = (t.provider && t.provider !== "") ? t.provider : "unset";
        const k = prov + "\u0000" + model + "\u0000" + (t.base_url || "");
        const inAmt = t.input || 0, outAmt = t.output || 0, cache = t.cache_read || 0;
        if (!map[k]) {
          map[k] = { provider: prov, model, base_url: t.base_url || "",
                     calls: 0, sum: 0 };
        }
        const r = map[k];
        r.calls += t.calls || 0;
        r.sum += inAmt + outAmt + cache;
      }
      return Object.keys(map).map((k) => map[k]);
    }
    function allBots(snap) {
      const list = [];
      for (const h of (snap && snap.hosts) || []) {
        for (const b of (h.bots) || []) list.push({ host: h, bot: b });
      }
      return list;
    }
    function botById(snap, id) {
      for (const h of (snap && snap.hosts) || []) {
        for (const b of (h.bots) || []) if (b.id === id) return { host: h, bot: b };
      }
      return null;
    }

    /* ---------- 像素图标：inline SVG rect 拼网格 (8x8 / 10x10)
       3 种基础图案，按 bot 取 3 组绿系配色 → 9 个 bot 各有区分。---------- */
    const FACES = {
      bot: [
        ".XX..XX.",
        ".X....X.",
        "XX....XX",
        "XXXXXXXX",
        "XEXXXXEX",
        "XXXXXXXX",
        "XXMXXMXX",
        ".XXXXXX.",
      ],
      term: [
        "....XX....",
        "...XXXX...",
        "..XXXXXX..",
        ".XXXXXXXX.",
        ".XEX..XEX.",
        ".XXXXXXXX.",
        ".XX.XX.XX.",
        ".XX.XX.XX.",
        ".XXXXXXXX.",
        "..XXXXXX..",
      ],
      ant: [
        ".X..X..X..",
        ".XX..XX...",
        "..XXXX....",
        ".X.EEX....",
        "XX.EEX....",
        ".X.XXX....",
        "..XXXX....",
        ".XX..XX...",
        ".X....X...",
        ".X....X...",
      ],
    };
    const FACE_COLORS = [
      ["#2ecc71", "#0aff7a"],
      ["#22d3ee", "#34f8ff"],
      ["#1dd079", "#7dffb6"],
      ["#16a34a", "#4ade80"],
      ["#0f9e62", "#35e0e0"],
    ];
    function hashCode(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    function faceSVG(bot) {
      const names = Object.keys(FACES);
      const fn = hashCode(bot.id || "");
      const pat = FACES[names[fn % names.length]];
      const pal = FACE_COLORS[fn % FACE_COLORS.length];
      const n = pat.length;
      let rects = "";
      for (let y = 0; y < n; y++) {
        const row = pat[y];
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === ".") continue;
          let col = pal[0];
          if (ch === "E") col = pal[1];
          else if (ch === "M") col = "#0d1b14";
          rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${col}"/>`;
        }
      }
      return `<svg class="px-pix" viewBox="0 0 ${n} ${n}" ` +
        `xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" ` +
        `aria-hidden="true">${rects}</svg>`;
    }

    /* ---------- 用量条（长度=用量大小 | 颜色=成功率 | 尾部=百分比粗体白）---------- */
    function usageBar(rate, frac) {
      const track = el("div", "px-track");
      const fill = el("div", "px-fill");
      fill.style.width = (Math.max(0, Math.min(100, frac)) * 100).toFixed(2) + "%";
      fill.style.background = rateColor(rate);
      track.appendChild(fill);
      return track;
    }
    function tailPct(rate) {
      const b = el("b", "px-u-tail", Math.round(rate) + "%");
      return b;
    }

    /* ---------- 区块头 ---------- */
    function secHead(big, val) {
      const h = el("div", "px-sec-head");
      h.appendChild(el("span", "px-big", big));
      if (val) h.appendChild(el("span", "px-val", val));
      return h;
    }

    /* ---------- HOSTS ---------- */
    function renderHosts(dash, snap) {
      const sec = el("section", "px-sec");
      const hosts = (snap.hosts || []);
      const nBots = allBots(snap).length;
      let up = 0;
      const triCounts = {};
      for (const h of hosts) {
        const tri = (h.tri && h.tri.tri) || "?";
        triCounts[tri] = (triCounts[tri] || 0) + 1;
        if (tri === "reachable" || tri === "working") up++;
      }
      const shorts = hosts.map((h) => h.short).join(" / ");
      sec.appendChild(secHead("HOSTS", shorts + "     " + up + "/" + hosts.length + " up"));
      const box = el("div", "px-hosts");
      for (const h of hosts) {
        const row = el("div", "px-host");
        row.appendChild(el("div", "px-host-name", h.short));
        const bs = h.bots || [];
        const ups = bs.filter((b) => ((b._severity || 0) < 2)).length;
        const frac = bs.length ? ups / bs.length : 0;
        const rate = bs.length ? (ups / bs.length) * 100 : 100;
        const track = usageBar(rate, frac);
        row.appendChild(track);
        const meta = el("div", "px-host-meta");
        meta.appendChild(el("b", null, ups + "/" + bs.length));
        meta.appendChild(document.createTextNode(" up · " + ((h.tri && h.tri.tri) || "?")));
        row.appendChild(meta);
        box.appendChild(row);
      }
      sec.appendChild(box);
      dash.appendChild(sec);
    }

    /* ---------- USAGE 总览：每 bot 一条总量条（橙→绿按成功率着色，条尾百分比）---------- */
    function renderUsage(dash, snap) {
      const sec = el("section", "px-sec");
      const bots = allBots(snap);
      let grand = 0;
      for (const { bot } of bots) {
        for (const r of totalsOf(bot)) grand += r.sum;
      }
      sec.appendChild(secHead("USAGE", "total " + fmt(grand)));
      const box = el("div", "px-usage");
      /* 归一基准：本 dash 内最大 bot 总量 */
      let max = 1;
      for (const { bot } of bots) {
        let s = 0;
        for (const r of totalsOf(bot)) s += r.sum;
        if (s > max) max = s;
      }
      for (const { host, bot } of bots) {
        let s = 0;
        for (const r of totalsOf(bot)) s += r.sum;
        const rate = successRate(bot.agents_completed_buckets && bot.agents_completed_buckets["4–24h"]);
        const row = el("div", "px-urow");
        const name = el("div", "px-u-name", bot.display_name || bot.profile || bot.id);
        name.appendChild(el("span", "px-u-host", "  " + host.short));
        row.appendChild(name);
        row.appendChild(usageBar(rate, s / max));
        const tail = tailPct(rate);
        tail.className = "px-u-tail";
        row.appendChild(tail);
        row.appendChild(el("span", "px-u-num", fmt(s)));
        box.appendChild(row);
      }
      sec.appendChild(box);
      dash.appendChild(sec);
    }

    /* ---------- BOTS 像素图标矩阵 ---------- */
    function renderBots(dash, snap) {
      const sec = el("section", "px-sec");
      sec.appendChild(secHead("BOTS", (allBots(snap)).length + " bots · click icon for usage"));
      const grid = el("div", "px-botgrid");
      const bots = allBots(snap);
      for (const { host, bot } of bots) {
        const rate = successRate(bot.agents_completed_buckets && bot.agents_completed_buckets["4–24h"]);
        const ic = el("button", "px-botic");
        ic.setAttribute("title", bot.display_name || bot.profile);
        ic.appendChild(document.createRange().createContextualFragment(faceSVG(bot)));
        const name = el("div", "px-botname", bot.display_name || bot.profile || bot.id);
        ic.appendChild(name);
        ic.appendChild(el("div", "px-bothost", host.short + " · " + Math.round(rate) + "%"));
        ic.addEventListener("click", () => { state.botId = bot.id; state.view = "drill"; render(state.last); });
        grid.appendChild(ic);
      }
      sec.appendChild(grid);
      dash.appendChild(sec);
    }
    /* __APPEND5__ */

    /* ---------- DRILLDOWN：bot usage 详情
       provider 分组 → 组内按 model 列行；
       条长=用量大小(相对本 bot 内最大值归一)；颜色=成功率映射；条尾=百分比粗体白；
       右侧 dim 显示用量数值+calls；下方 4h/4-24h/24h-7d 历史分段条。 ---------- */
    function renderDrill(container, snap) {
      const found = botById(snap, state.botId);
      if (!found) { state.view = "dash"; render(snap); return; }
      const { host, bot } = found;
      const wrap = el("div", "px-drill");
      const back = el("div", "px-back", "< BACK");
      back.addEventListener("click", () => { state.view = "dash"; render(snap); });
      wrap.appendChild(back);
      const bhead = el("div", "px-bhead");
      bhead.appendChild(el("div", "px-bname", bot.display_name || bot.profile || bot.id));
      bhead.appendChild(el("div", "px-bhost", host.short));
      const triTxt = (bot.tri && bot.tri.tri) || "?";
      bhead.appendChild(el("div", "px-bmeta", bot.profile + " · " + triTxt + " · sev " + (bot._severity || 0)));
      wrap.appendChild(bhead);

      /* 历史 usage（分段条） */
      const hist = el("section", "px-sec");
      hist.appendChild(secHead("HISTORY", "4h / 4–24h / 24h–7d"));
      const hbucket = histBuckets(bot);
      const histRow = el("div", "px-hist");
      const seg = el("div", "px-hist-seg");
      let histMax = 1;
      for (const b of hbucket) if (b.total > histMax) histMax = b.total;
      for (const b of hbucket) {
        const s = el("div", "px-hseg");
        s.title = b.label + " · " + Math.round(b.rate) + "%";
        const fill = el("div", "px-fill");
        fill.style.width = (b.total / histMax * 100).toFixed(1) + "%";
        fill.style.background = rateColor(b.rate);
        s.appendChild(fill);
        seg.appendChild(s);
      }
      histRow.appendChild(seg);
      const leg = el("div", "px-hist-legend");
      for (const b of hbucket) {
        const span = el("span");
        span.appendChild(document.createTextNode(b.label + "  "));
        const okb = el("b", "px-ok", String(b.normal));
        span.appendChild(okb);
        span.appendChild(document.createTextNode(" ok / "));
        const badb = el("b", "px-bad", String(b.bad));
        span.appendChild(badb);
        span.appendChild(document.createTextNode(" bad"));
        leg.appendChild(span);
      }
      histRow.appendChild(leg);
      hist.appendChild(histRow);
      wrap.appendChild(hist);

      /* 用量明细：provider 分组 */
      const rows = totalsOf(bot);
      const us = el("section", "px-sec");
      let totSum = 0;
      for (const r of rows) totSum += r.sum;
      us.appendChild(secHead("USAGE DETAIL", rows.length + " lines · " + fmt(totSum)));
      let maxSum = 1;
      for (const r of rows) if (r.sum > maxSum) maxSum = r.sum;
      /* provider → 组 */
      const groups = {};
      for (const r of rows) {
        if (!groups[r.provider]) groups[r.provider] = [];
        groups[r.provider].push(r);
      }
      const provNames = Object.keys(groups).sort((a, b) => {
        const sa = groups[a].reduce((s, r) => s + r.sum, 0);
        const sb = groups[b].reduce((s, r) => s + r.sum, 0);
        return sb - sa;
      });
      const box = el("div", "px-grpwrap");
      for (const prov of provNames) {
        const g = el("div", "px-grp");
        const gSum = groups[prov].reduce((s, r) => s + r.sum, 0);
        g.appendChild(el("div", "px-grp-name", prov + "   " + fmt(gSum)));
        /* 组内按 model 列行 */
        groups[prov].slice().sort((a, b) => b.sum - a.sum).forEach((r) => {
          const m = el("div", "px-mrow");
          const lbl = el("div", "px-m-lbl");
          lbl.appendChild(el("span", "px-prov", r.provider + "/"));
          lbl.appendChild(document.createTextNode(r.model));
          m.appendChild(lbl);
          m.appendChild(usageBar(successRate(bot.agents_completed_buckets && bot.agents_completed_buckets["4–24h"]), r.sum / maxSum));
          const tail = tailPct(successRate(bot.agents_completed_buckets && bot.agents_completed_buckets["4–24h"]));
          tail.className = "px-m-tail";
          m.appendChild(tail);
          const num = el("div", "px-m-num");
          num.appendChild(el("b", null, fmt(r.sum)));
          num.appendChild(document.createTextNode("  ·  " + r.calls + " calls"));
          m.appendChild(num);
          g.appendChild(m);
        });
        box.appendChild(g);
      }
      us.appendChild(box);
      wrap.appendChild(us);

      container.textContent = "";
      container.appendChild(wrap);
    }
    /* __APPEND6__ */

    /* ---------- 顶部状态行 ---------- */
    function renderTop(snap) {
      const stats = document.getElementById("stats-row");
      if (!stats) return;
      const now = new Date();
      const hh = epochPad(now.getHours()), mm = epochPad(now.getMinutes()), ss = epochPad(now.getSeconds());
      const gen = new Date(snap.generated_at);
      const age = (Date.now() - gen.getTime()) / 1000;
      const live = !isNaN(age) && age <= (snap.unknown_after_s || 120);
      const hosts = (snap.hosts || []).length;
      const bots = allBots(snap).length;
      stats.textContent = "";
      stats.className = "px-top";
      const add = (txt, cls) => stats.appendChild(el("span", cls || null, txt));
      add("FLEET", "s-dim");
      add("·");
      add(hh + ":" + mm + ":" + ss);
      add("·");
      add(hosts + " hosts", "s-dim");
      add("·");
      add(bots + " bots", "s-dim");
      add("·");
      add("●", live ? "s-live" : "s-dim");
      add("live", live ? "s-live" : "s-dim");
      if (!live) add("· STALE", "s-dim");
    }

    /* ---------- 主渲染（重定义全局 render，被 app.js 的 tick 驱动）---------- */
    function render(snap) {
      state.last = snap;
      renderTop(snap);
      const main = document.getElementById("main");
      main.textContent = "";
      if (state.view === "drill") {
        renderDrill(main, snap);
      } else {
        const dash = el("div", "px-dash");
        renderHosts(dash, snap);
        renderUsage(dash, snap);
        renderBots(dash, snap);
        main.appendChild(dash);
      }
    }

    /* 覆写全局 render，使 app.js 的 5s tick 渲染本 HUB 皮肤 */
    window.render = render;

    /* 立即初次渲染：自己取一次快照（走 api-override 重定向到 api_status.json）
       随后 app.js 的 5s tick 会持续驱动本 render */
    let started = false;
    async function first() {
      if (started) return;
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        const snap = await r.json();
        started = true;
        render(snap);
      } catch (e) { /* app.js 的 tick 会兜底驱动 */ }
    }
    first();
  }
})();