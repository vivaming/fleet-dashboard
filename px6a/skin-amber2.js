/* ============================================================
   PX6-A · skin-amber2.js — 琥珀 fleet dashboard（A 变体）
   HUB 版式 + 像素图标矩阵 + drilldown usage
   body class: px6-amber

   —— 复用 app.js 的 5s 轮询循环：本文件重定义全局 render(snap)，
      app.js 的 tick() 会继续驱动本 HUB 皮肤渲染。
      api-override.js 已把 /api/status 重定向到本地 api_status.json 快照。
   ============================================================ */
(function () {
  "use strict";

  if (!document.body) document.addEventListener("DOMContentLoaded", boot);
  else boot();

    function hUp(h) {
    return !h.error && (h.bots || []).some(function (b) {
      return b.process && b.process.state !== "dead";
    });
  }

function boot() {
    document.body.classList.add("px6-amber");

    /* ---------- 状态 ---------- */
    var state = { view: "dash", botId: null, last: null };

    /* ---------- 小工具 ---------- */
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = String(text);
      return e;
    }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function pad2(x) { return String(x).padStart(2, "0"); }
    function fmt(n) {
      if (n === undefined || n === null || isNaN(n)) return "0";
      var a = Math.abs(n);
      if (a < 1000) return String(Math.round(n));
      if (a < 1e6)  return (n / 1e3).toFixed(1) + "K";
      if (a < 1e9)  return (n / 1e6).toFixed(2) + "M";
      return (n / 1e9).toFixed(2) + "B";
    }
    function hashCode(s) {
      s = String(s);
      var h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    }

    /* ---------- 成功率 → 颜色（全站唯一映射，两段线性插值）
       rate  0  → hue  0  红 #ef4444
       rate 35  → hue 28  橙 #f59e0b
       rate 70  → hue 55  黄 #eab308
       rate 100 → hue 145 绿 #2ecc71
       百分比越高越绿。
       ---------- */
    function rateColor(rate) {
      var r = clamp(rate, 0, 100);
      var hue = r <= 70 ? (r / 70) * 55 : 55 + ((r - 70) / 30) * 90;
      return "hsl(" + hue.toFixed(1) + ", 88%, 47%)";
    }

    /* ---------- 成功率（bucket 级 / bot 级） ---------- */
    function bucketRate(b) {
      var n = (b && b.normal) || 0;
      var f = (b && b.failed) || 0;
      var t = (b && b.timeout) || 0;
      var d = n + f + t;
      return d ? (n / d) * 100 : 100;   // 无记录按 100%
    }
    function botRate(bot) {
      var bk = (bot && bot.agents_completed_buckets) || {};
      var n = 0, d = 0;
      ["4h", "4–24h", "24h–7d"].forEach(function (k) {
        var b = bk[k] || {};
        n += b.normal || 0;
        d += (b.normal || 0) + (b.failed || 0) + (b.timeout || 0);
      });
      return d ? (n / d) * 100 : 100;   // 全时段汇总；无记录按 100%
    }
    function histBuckets(bot) {
      var bk = (bot && bot.agents_completed_buckets) || {};
      return ["4h", "4–24h", "24h–7d"].map(function (k) {
        var b = bk[k] || {};
        var n = b.normal || 0, f = b.failed || 0, t = b.timeout || 0;
        return { label: k, rate: bucketRate(b), normal: n, bad: f + t, total: n + f + t };
      });
    }

    /* ---------- usage 明细 ----------
       数据源：bot.tokens.totals[]（真实字段），兼容 bot.usage.totals[]。
       同 provider+model+base_url 归并成一行，保留真实渠道差异。 */
    function totalsOf(bot) {
      var src = [];
      if (bot.tokens && Array.isArray(bot.tokens.totals)) src = bot.tokens.totals;
      else if (bot.usage && Array.isArray(bot.usage.totals)) src = bot.usage.totals;
      var map = Object.create(null);
      src.forEach(function (t) {
        var model = t.model || "?";
        var prov = (t.provider && String(t.provider) !== "") ? t.provider : "unset";
        var key = prov + "\u0000" + model + "\u0000" + (t.base_url || "");
        if (!map[key]) {
          map[key] = { provider: prov, model: model, calls: 0, sum: 0, input: 0, output: 0, cache: 0 };
        }
        var r = map[key];
        r.calls  += t.calls || 0;
        r.input  += t.input || 0;
        r.output += t.output || 0;
        r.cache  += t.cache_read || 0;
        r.sum += (t.input || 0) + (t.output || 0) + (t.cache_read || 0);
      });
      var out = Object.keys(map).map(function (k) { return map[k]; });
      out.sort(function (a, b) { return b.sum - a.sum; });
      return out;
    }
    function tokenMix(bot) {
      var input = 0, output = 0, cache = 0, calls = 0;
      totalsOf(bot).forEach(function (r) {
        input += r.input; output += r.output; cache += r.cache; calls += r.calls;
      });
      return { input: input, output: output, cache: cache, calls: calls, total: input + output + cache };
    }
    function botTotal(bot) { return tokenMix(bot).total; }

    function allBots(snap) {
      var list = [];
      ((snap && snap.hosts) || []).forEach(function (h) {
        (h.bots || []).forEach(function (b) { list.push({ host: h, bot: b }); });
      });
      return list;
    }
    function botById(snap, id) {
      var list = allBots(snap);
      for (var i = 0; i < list.length; i++) if (list[i].bot.id === id) return list[i];
      return null;
    }
    /* host 无 tri 字段（快照里为 null）→ 用 error + bots 汇总判定在线 */
    function hostUp(h) {
      if (h.error) return false;
      var bs = h.bots || [];
      if (!bs.length) return !!h.last_success_at;
      return bs.some(function (b) {
        return ((b.tri && b.tri.tri === "reachable")) || ((b._severity || 0) < 2);
      });
    }
    function hostRate(h) {
      var bs = h.bots || [];
      if (!bs.length) return h.error ? 0 : 100;
      var up = bs.filter(function (b) { return (b._severity || 0) < 2; }).length;
      return (up / bs.length) * 100;
    }

    /* ---------- 像素图标：inline SVG rect 拼 8x8 / 10x10 网格
       4 种图案 × 5 组琥珀色系配色 = 20 种组合，9 个 bot 全部不同。
       纯 SVG，禁止外链图片/emoji。 ---------------------- */
    var FACE_KEYS = ["cube", "term", "bug", "drone"];
    var FACES = {
      cube: [
        ".XXXXXX.",
        "XXXXXXXX",
        "XEXXXXEX",
        "XXXXXXXX",
        "XXXXXXXX",
        "XXMXXMXX",
        "..X..X..",
        ".XX..XX."
      ],
      term: [
        "XXXXXXXX",
        "XX....XX",
        "XX....XX",
        "XX.EE.XX",
        "XX....XX",
        "XX.XX.XX",
        "XXXXXXXX",
        "..XX.XX."
      ],
      bug: [
        "X......X",
        "X......X",
        ".X....X.",
        "..XXXX..",
        "X.XEEX.X",
        "XXXXXXXX",
        ".XXXXXX.",
        ".X....X."
      ],
      drone: [
        "...XXXX...",
        "..XXXXXX..",
        ".XXXXXXXX.",
        "XXXXXXXXXX",
        "XXXEEEEXXX",
        ".XXXXXXXX.",
        "..XXXXXX..",
        "...XXXX...",
        "..X....X..",
        ".XX....XX."
      ]
    };
    var PALES = [
      { body: "#f59e0b", eye: "#fff3cf", dark: "#1a1206" },
      { body: "#fbbf24", eye: "#fffbe6", dark: "#241703" },
      { body: "#d97706", eye: "#fde68a", dark: "#2a1602" },
      { body: "#f97316", eye: "#ffedd5", dark: "#2b1206" },
      { body: "#eab308", eye: "#fef9c3", dark: "#221a00" }
    ];
    var COMBOS = FACE_KEYS.length * PALES.length;

    function faceSVG(bot) {
      var pat = FACES.cube, pal = PALES[0];
      var c = hashCode(bot.id || "") % COMBOS;
      pat = FACES[FACE_KEYS[c % FACE_KEYS.length]];
      pal = PALES[Math.floor(c / FACE_KEYS.length) % PALES.length];
      var n = pat.length;
      var rects = "";
      for (var y = 0; y < n; y++) {
        var row = pat[y];
        for (var x = 0; x < row.length; x++) {
          var ch = row[x];
          if (ch === ".") continue;
          var col = pal.body;
          if (ch === "E") col = pal.eye;
          else if (ch === "M") col = pal.dark;
          rects += "<rect x=\"" + x + "\" y=\"" + y + "\" width=\"1.02\" height=\"1.02\" fill=\"" + col + "\"/>";
        }
      }
      return '<svg class="px-pix" viewBox="0 0 ' + n + " " + n + '" ' +
        'xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">' +
        rects + "</svg>";
    }
    /* 9 个 bot 图案去重：同图案的 bot 强制换配色 */
    function faceUnique(bot, seen) {
      var c = hashCode(bot.id || "") % COMBOS;
      if (seen[c]) c = (c + 7) % COMBOS;
      seen[c] = 1;
      var pat = FACES[FACE_KEYS[c % FACE_KEYS.length]];
      var pal = PALES[Math.floor(c / FACE_KEYS.length) % PALES.length];
      var n = pat.length;
      var rects = "";
      for (var y = 0; y < n; y++) {
        var row = pat[y];
        for (var x = 0; x < row.length; x++) {
          var ch = row[x];
          if (ch === ".") continue;
          var col = pal.body;
          if (ch === "E") col = pal.eye;
          else if (ch === "M") col = pal.dark;
          rects += "<rect x=\"" + x + "\" y=\"" + y + "\" width=\"1.02\" height=\"1.02\" fill=\"" + col + "\"/>";
        }
      }
      return '<svg class="px-pix" viewBox="0 0 ' + n + " " + n + '" ' +
        'xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">' +
        rects + "</svg>";
    }

    /* ---------- 用量条：长度=用量归一 | 颜色=成功率映射 | 尾部=百分比 ---------- */
    function usageBar(rate, frac) {
      var track = el("div", "px-track");
      var fill = el("div", "px-fill" + (frac > 0 ? "" : " zero"));
      fill.style.width = (clamp(frac, 0, 1) * 100).toFixed(2) + "%";
      fill.style.background = rateColor(rate);
      track.appendChild(fill);
      return track;
    }
    function tailPct(rate, cls) {
      return el("b", cls || "px-tail", Math.round(rate) + "%");
    }

    /* ---------- 区块头 ---------- */
    function secHead(big, valHtml) {
      var h = el("div", "px-sec-head");
      h.appendChild(el("span", "px-big", big));
      if (valHtml !== undefined && valHtml !== null) {
        var v = el("span", "px-val");
        if (typeof valHtml === "string") v.innerHTML = valHtml;
        else v.appendChild(valHtml);
        h.appendChild(v);
      }
      return h;
    }

    /* ---------- 顶部状态行 + LED 灯带 ---------- */
    function renderTop(snap) {
      var stats = document.getElementById("stats-row");
      if (!stats) return;
      stats.textContent = "";
      stats.className = "px-top";

      /* LED 灯带 */
      var led = el("div", "px-led");
      for (var i = 0; i < 28; i++) {
        var p = el("i", null);
        p.style.animationDelay = (i * 97 % 2600) + "ms";
        led.appendChild(p);
      }
      stats.appendChild(led);

      /* 状态行：FLEET · HH:MM:SS · 3 hosts · 9 bots · ● live */
      var now = new Date();
      var gen = new Date(snap.generated_at);
      var age = (Date.now() - gen.getTime()) / 1000;
      var live = !isNaN(age) && age <= (snap.unknown_after_s || 120);
      var hosts = (snap.hosts || []).length;
      var bots = allBots(snap).length;

      var line = el("div", "px-line");
      var add = function (txt, cls) { line.appendChild(el("span", cls || null, txt)); };
      add("FLEET");
      add("·", "s-dot");
      add(pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds()), "s-time");
      add("·", "s-dot");
      add(hosts + " hosts", "s-dim");
      add("·", "s-dot");
      add(bots + " bots", "s-dim");
      add("·", "s-dot");
      add("●", live ? "s-live" : "s-dim");
      add("live", live ? "s-live" : "s-dim");
      if (!live) add("· STALE " + Math.round(age) + "s", "s-dim");
      stats.appendChild(line);
    }

    /* ---------- HOSTS ---------- */
    function renderHosts(dash, snap) {
      var hosts = snap.hosts || [];
      var upCount = hosts.filter(hostUp).length;
      var sec = el("section", "px-sec");
      sec.appendChild(secHead("HOSTS",
        hosts.map(function (h) { return h.short; }).join(" / ") +
        "&nbsp;&nbsp;<b>" + upCount + "/" + hosts.length + " up</b>"));

      var box = el("div", "px-hosts");
      hosts.forEach(function (h) {
        var bs = h.bots || [];
        var up = bs.filter(function (b) { return (b._severity || 0) < 2; }).length;
        var rate = hostRate(h);
        var row = el("div", "px-host");
        row.appendChild(el("div", "px-host-name", h.short));
        row.appendChild(usageBar(rate, bs.length ? up / bs.length : (hostUp(h) ? 1 : 0)));
        row.appendChild(tailPct(rate, "px-tail"));
        var meta = el("div", "px-host-meta");
        meta.appendChild(el("b", null, up + "/" + bs.length + " bots"));
        meta.appendChild(el("span", h.error ? "bad" : (hostUp(h) ? "ok" : "warn"),
          "  ·  " + (h.error ? "error" : (hostUp(h) ? "reachable" : "partial"))));
        row.appendChild(meta);
        box.appendChild(row);
      });
      sec.appendChild(box);
      dash.appendChild(sec);
    }

    /* ---------- USAGE 总览：每 bot 一条总量条 ---------- */
    function renderUsage(dash, snap) {
      var sec = el("section", "px-sec");
      var bots = allBots(snap);
      var rows = bots.map(function (r) { return { host: r.host, bot: r.bot, total: botTotal(r.bot) }; });
      var grand = rows.reduce(function (s, r) { return s + r.total; }, 0);
      var calls = 0;
      rows.forEach(function (r) {
        totalsOf(r.bot).forEach(function (t) { calls += t.calls; });
      });

      var val = el("span", "px-val");
      val.innerHTML = "total <b>" + fmt(grand) + "</b> · <b>" + fmt(calls) + "</b> calls";
      sec.appendChild(secHead("USAGE", val));

      var max = 1;
      rows.forEach(function (r) { if (r.total > max) max = r.total; });

      var box = el("div", "px-usage");
      rows.slice().sort(function (a, b) { return b.total - a.total; }).forEach(function (r) {
        var rate = botRate(r.bot);
        var row = el("div", "px-urow");
        var name = el("div", "px-u-name");
        name.appendChild(el("span", null, r.bot.display_name || r.bot.profile || r.bot.id));
        name.appendChild(el("span", "px-u-host", " " + r.host.short));
        row.appendChild(name);
        row.appendChild(usageBar(rate, r.total / max));
        row.appendChild(tailPct(rate, "px-tail"));
        row.appendChild(el("span", "px-u-num", fmt(r.total)));
        box.appendChild(row);
      });
      sec.appendChild(box);
      dash.appendChild(sec);
    }

    /* ---------- BOTS 像素图标矩阵（按 host 分组） ---------- */
    function renderBots(dash, snap) {
      var sec = el("section", "px-sec");
      var bots = allBots(snap);
      var val = el("span", "px-val");
      val.innerHTML = "<b>" + bots.length + "</b> bots · click icon <b>→ usage</b>";
      sec.appendChild(secHead("BOTS", val));

      var wrap = el("div", "px-botrows");
      var seen = {};
      bots.forEach(function (r) { wrap.appendChild(botRow(r.host, seen)); });
      sec.appendChild(wrap);
      dash.appendChild(sec);
    }
    function botRow(host, seen) {
      var bs = host.bots || [];
      var row = el("div", "px-botrow");
      var head = el("div", "px-botrow-head");
      head.appendChild(el("span", "px-brname", host.short));
      var up = bs.filter(function (b) { return (b._severity || 0) < 2; }).length;
      head.appendChild(el("span", "px-brmeta", up + "/" + bs.length + " up · " +
        (hostUp(host) ? "reachable" : "partial")));
      row.appendChild(head);

      var grid = el("div", "px-botgrid");
      bs.forEach(function (bot) {
        var rate = botRate(bot);
        var ic = el("button", "px-botic");
        ic.type = "button";
        ic.setAttribute("title", (bot.display_name || bot.profile || bot.id) + " · " + host.short +
          " · " + Math.round(rate) + "%");
        var coin = el("div", "px-coin");
        coin.innerHTML = faceUnique(bot, seen);
        ic.appendChild(coin);
        ic.appendChild(el("div", "px-botname", bot.display_name || bot.profile || bot.id));
        var meta = el("div", "px-bothost");
        meta.appendChild(el("b", null, host.short));
        meta.appendChild(document.createTextNode(" · " + Math.round(rate) + "%"));
        ic.appendChild(meta);
        var sev = el("span", "px-sev s" + (bot._severity || 0));
        ic.appendChild(sev);
        ic.addEventListener("click", function () { openDrill(bot.id); });
        grid.appendChild(ic);
      });
      row.appendChild(grid);
      return row;
    }

    /* ---------- 视图切换 ---------- */
    function openDrill(botId) {
      state.botId = botId;
      state.view = "drill";
      render(state.last);
      try { window.scrollTo({ top: 0, behavior: "auto" }); } catch (e) { window.scrollTo(0, 0); }
    }
    function closeDrill() {
      state.view = "dash";
      render(state.last);
      try { window.scrollTo({ top: 0, behavior: "auto" }); } catch (e) { window.scrollTo(0, 0); }
    }

    /* ---------- DRILLDOWN：USAGE 专项 ----------
       条长 = 该 model 用量总量（相对本 bot 内最大值归一）
       条颜色 = 成功率映射（红→橙→黄→绿）
       条尾 = 成功率百分比（白色粗体等宽）
       右侧 dim = 用量数值 + calls 数
       历史 = 4h / 4–24h / 24h–7d 三段并排时间分段条（2px 缝） */
    function renderDrill(container, snap) {
      var found = botById(snap, state.botId);
      if (!found) { closeDrill(); return; }
      var host = found.host, bot = found.bot;
      var rate = botRate(bot);

      var wrap = el("div", "px-drill");

      var back = el("button", "px-back", "< BACK");
      back.type = "button";
      back.addEventListener("click", closeDrill);
      wrap.appendChild(back);

      /* bot 头 */
      var bhead = el("div", "px-bhead");
      var bp = el("div");
      bp.innerHTML = faceSVG(bot).replace('class="px-pix"', 'class="px-bpix"');
      bhead.appendChild(bp);
      var title = el("div", "px-btitle");
      title.appendChild(el("div", "px-bname", bot.display_name || bot.profile || bot.id));
      var bmeta = el("div", "px-bhost");
      bmeta.textContent = host.short + " · " + (bot.profile || bot.id) + " · " +
        ((bot.tri && bot.tri.tri) || "?") + " · sev " + (bot._severity || 0);
      title.appendChild(bmeta);
      bhead.appendChild(title);
      var brate = el("div", "px-brate");
      var rn = el("div", "px-rate-num", Math.round(rate) + "%");
      rn.style.color = rateColor(rate);
      brate.appendChild(rn);
      brate.appendChild(el("div", "px-rate-lbl", "SUCCESS"));
      bhead.appendChild(brate);
      wrap.appendChild(bhead);

      /* 历史 usage：时间分段条 */
      var hist = el("section", "px-sec");
      var hval = el("span", "px-val");
      var hsum = histBuckets(bot).reduce(function (a, b) { return a + b.total; }, 0);
      hval.innerHTML = "4h / 4–24h / 24h–7d &nbsp;·&nbsp; <b>" + hsum + "</b> agents";
      hist.appendChild(secHead("HISTORY", hval));

      var hb = histBuckets(bot);
      var histMax = 1;
      hb.forEach(function (b) { if (b.total > histMax) histMax = b.total; });

      var hrow = el("div", "px-hist");
      var seg = el("div", "px-hist-seg");
      hb.forEach(function (b) {
        var s = el("div", "px-hseg");
        s.title = b.label + " · " + Math.round(b.rate) + "% · " + b.normal + " ok / " + b.bad + " bad";
        var fill = el("div", "px-fill" + (b.total > 0 ? "" : " zero"));
        fill.style.width = (b.total / histMax * 100).toFixed(1) + "%";
        fill.style.background = rateColor(b.rate);
        s.appendChild(fill);
        seg.appendChild(s);
      });
      hrow.appendChild(seg);

      var leg = el("div", "px-hist-legend");
      hb.forEach(function (b) {
        var sp = el("span");
        sp.appendChild(el("b", null, b.label + " "));
        sp.appendChild(el("span", "px-pct", Math.round(b.rate) + "%"));
        sp.appendChild(document.createTextNode("  "));
        sp.appendChild(el("b", "px-ok", String(b.normal)));
        sp.appendChild(document.createTextNode(" ok / "));
        sp.appendChild(el("b", "px-bad", String(b.bad)));
        sp.appendChild(document.createTextNode(" bad"));
        leg.appendChild(sp);
      });
      hrow.appendChild(leg);
      hist.appendChild(hrow);
      wrap.appendChild(hist);

      /* token 构成（input / output / cache_read） */
      var mix = tokenMix(bot);
      var mixSec = el("section", "px-sec");
      var mval = el("span", "px-val");
      mval.innerHTML = "<b>" + fmt(mix.total) + "</b> tokens · <b>" + fmt(mix.calls) + "</b> calls";
      mixSec.appendChild(secHead("TOKEN MIX", mval));
      var mbar = el("div", "px-mix");
      var bar = el("div", "px-mix-bar");
      var parts = [
        { k: "input",  v: mix.input,  c: "#f59e0b" },
        { k: "output", v: mix.output, c: "#2ecc71" },
        { k: "cache",  v: mix.cache,  c: "#22d3ee" }
      ];
      parts.forEach(function (p) {
        var i = el("i", null);
        i.style.width = (mix.total ? p.v / mix.total * 100 : 0).toFixed(2) + "%";
        i.style.background = p.c;
        bar.appendChild(i);
      });
      mbar.appendChild(bar);
      var mleg = el("div", "px-mix-legend");
      parts.forEach(function (p) {
        var sp = el("span");
        var sw = el("span", "sw");
        sw.style.background = p.c;
        sp.appendChild(sw);
        sp.appendChild(document.createTextNode(p.k + " "));
        sp.appendChild(el("b", null, fmt(p.v)));
        mleg.appendChild(sp);
      });
      mbar.appendChild(mleg);
      mixSec.appendChild(mbar);
      wrap.appendChild(mixSec);

      /* 用量明细：provider 分组 → 组内按 model 列行 */
      var rows = totalsOf(bot);
      var us = el("section", "px-sec");
      var rowsum = rows.reduce(function (s, r) { return s + r.sum; }, 0);
      var uval = el("span", "px-val");
      uval.innerHTML = "<b>" + rows.length + "</b> lines · <b>" + fmt(rowsum) + "</b> tokens";
      us.appendChild(secHead("USAGE DETAIL", uval));

      if (!rows.length) {
        us.appendChild(el("div", "px-empty", "该 bot 快照内无 tokens.totals 记录"));
      } else {
        var maxSum = 1;
        rows.forEach(function (r) { if (r.sum > maxSum) maxSum = r.sum; });

        /* provider → 组 */
        var groups = Object.create(null);
        rows.forEach(function (r) {
          if (!groups[r.provider]) groups[r.provider] = [];
          groups[r.provider].push(r);
        });
        var provNames = Object.keys(groups).sort(function (a, b) {
          var sa = groups[a].reduce(function (s, r) { return s + r.sum; }, 0);
          var sb = groups[b].reduce(function (s, r) { return s + r.sum; }, 0);
          return sb - sa;
        });

        var box = el("div", "px-grpwrap");
        provNames.forEach(function (prov) {
          var g = el("div", "px-grp");
          var gSum = groups[prov].reduce(function (s, r) { return s + r.sum; }, 0);
          var gn = el("div", "px-grp-name");
          gn.appendChild(el("span", null, prov.toUpperCase()));
          gn.appendChild(el("span", "px-grp-sum", fmt(gSum) + " · " + groups[prov].length + " model"));
          g.appendChild(gn);

          groups[prov].slice().sort(function (a, b) { return b.sum - a.sum; }).forEach(function (r) {
            var m = el("div", "px-mrow");
            var lbl = el("div", "px-m-lbl");
            lbl.title = r.provider + "/" + r.model;
            lbl.appendChild(el("span", "px-prov", r.provider + "/"));
            lbl.appendChild(document.createTextNode(r.model));
            m.appendChild(lbl);
            m.appendChild(usageBar(rate, r.sum / maxSum));
            m.appendChild(tailPct(rate, "px-tail"));
            var num = el("div", "px-m-num");
            num.appendChild(el("b", null, fmt(r.sum)));
            num.appendChild(document.createTextNode("  " + r.calls + " calls"));
            m.appendChild(num);
            g.appendChild(m);
          });
          box.appendChild(g);
        });
        us.appendChild(box);
      }
      wrap.appendChild(us);

      container.textContent = "";
      container.appendChild(wrap);
    }

    /* ---------- 主渲染（覆写全局 render，由 app.js 的 tick 驱动） ---------- */
    function render(snap) {
      if (!snap || !snap.hosts) return;
      state.last = snap;
      renderTop(snap);

      var main = document.getElementById("main");
      if (!main) return;
      main.textContent = "";
      if (state.view === "drill") {
        renderDrill(main, snap);
        return;
      }
      var dash = el("div", "px-dash");
      renderHosts(dash, snap);
      renderUsage(dash, snap);
      renderBots(dash, snap);
      main.appendChild(dash);

      /* footer */
      var f = document.getElementById("footer-info");
      if (f) {
        f.textContent = "snapshot " + snap.generated_at +
          " · " + (snap.hosts || []).length + " hosts / " + allBots(snap).length + " bots · " +
          "amber skin (PX6-A) · read-only";
      }
    }

    window.render = render;

    /* 立即取一次快照首渲（走 api-override 重定向到 api_status.json），
       随后 app.js 的 5s tick 持续驱动本 render */
    var started = false;
    (function first() {
      if (started) return;
      started = true;
      try {
        fetch("/api/status", { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (snap) { if (snap) render(snap); })
          .catch(function () { /* app.js 的 tick 会兜底 */ });
      } catch (e) { /* app.js 的 tick 会兜底 */ }
    })();
  }
})();
