/* ============================================================
   PX7 · 变体 A「灰白 / 菊黄 / 深灰」 px7-a — skin-px7a.js
   骨架 = 用户钦定 HUB 版式（FLEET 状态行 / HOSTS / USAGE /
         BOTS 像素图标矩阵 / drilldown）——与 PX6-C「冰蓝」一致，
         仅配色语义整体换为「菊黄=危险 · 深灰=健康」
   ------------------------------------------------------------
   数据（快照真实字段）：
     hosts[].short / hosts[].bots[]
     bot.display_name / bot.id / bot._severity
     bot.usage.totals[] 或 bot.tokens.totals[]
       { model, provider, input, output, cache_read, calls }
     bot.agents_completed_buckets.{4h, 4–24h, 24h–7d, unknown}
       { normal, failed, timeout, unknown }
   成功率 = 各桶 normal / (normal+failed+timeout)；无记录按 100%
   成功率 → 5 档离散色阶（不做插值）：
     <40    菊黄 #FFB300   40–60  桔灰 #C2955C
     60–80  中灰 #6E747C   80–95  灰白 #C9CDD2
     ≥95    深灰 #3A3F46（健康）
   ============================================================ */
(function () {
  'use strict';
  if (window.__PX7__ === 1) return;
  window.__PX7__ = 1;

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmtTok(n) {
    n = n || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  function fmtInt(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ============================================================
     成功率 → 颜色映射（5 档离散色阶，全站统一，不做插值）
       rate <40    → #FFB300 菊黄   （危险端）
       40–60       → #C2955C 桔灰
       60–80       → #6E747C 中灰
       80–95       → #C9CDD2 灰白
       ≥95         → #3A3F46 深灰   （健康端）
     ============================================================ */
  var rateBands = [
    [0,  40, '#FFB300'],   /* <40    菊黄（危险） */
    [40, 60, '#C2955C'],   /* 40–60  桔灰 */
    [60, 80, '#6E747C'],   /* 60–80  中灰 */
    [80, 95, '#C9CDD2'],   /* 80–95  灰白 */
    [95, 101, '#3A3F46']   /* ≥95    深灰（健康） */
  ];
  function rateColor(rate) {
    var r = clamp(rate, 0, 100);
    for (var i = 0; i < rateBands.length; i++) {
      if (r >= rateBands[i][0] && r < rateBands[i][1]) return rateBands[i][2];
    }
    return '#3A3F46';
  }
  /* 档位下标（0..4），供 CSS/边框语义使用 */
  function rateBand(rate) {
    var r = clamp(rate, 0, 100);
    for (var i = 0; i < rateBands.length; i++) {
      if (r >= rateBands[i][0] && r < rateBands[i][1]) return i;
    }
    return 4;
  }

  /* 档位 → 文字色（同族，非新色）：
     填充/边框用 rateColor；**文字**必须按底色换族内变体，否则失读。
     rateTailText：条尾文字坐在暗轨道 #10151C 上 → 深灰两档提亮为同族浅灰
     rateText    ：矩阵 pct / 详情大字坐在浅灰白纸面 #F4F4F6 上 → 菊黄/灰白两档压深 */
  var rateTailText = ['#FFB300', '#D8AE77', '#A9B0B7', '#E3E6E9', '#B8C0C7'];
  var rateText     = ['#8A5A00', '#6B4F2E', '#4E545B', '#5E646C', '#3A3F46'];
  function tailColor(rate) { return rateTailText[rateBand(rate)]; }
  function textColor(rate) { return rateText[rateBand(rate)]; }

  /* 快照年龄（秒）。generated_at 是 ISO8601 字符串（如 2026-10-01T05:31:55Z），
     不是 epoch；只有出现数值型 generated_at_epoch 才按秒用 */
  function snapAge(snap) {
    var ref = snap.generated_at_epoch;
    if (typeof ref !== 'number') {
      var t = Date.parse(snap.generated_at);
      if (isNaN(t)) return 0;
      ref = t / 1000;
    }
    return Math.max(0, Date.now() / 1000 - ref);
  }
  /* ============================================================
     数据归一
     ============================================================ */
  function usageRows(bot) {
    if (bot.usage && bot.usage.totals) return bot.usage.totals;
    if (bot.tokens && bot.tokens.totals) return bot.tokens.totals;
    return [];
  }
  function usageOf(r) { return (r.input || 0) + (r.output || 0) + (r.cache_read || 0); }
  function provOf(r) { return ((r.provider || '').trim() || 'unknown'); }

  // provider 分组 → 组内按 model 合并
  function groupUsage(rows) {
    var map = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var k = provOf(r) + '|' + (r.model || 'unknown');
      var g = map.get(k);
      if (!g) { g = { provider: provOf(r), model: r.model || 'unknown', input: 0, output: 0, cache_read: 0, calls: 0, bases: 0 }; map.set(k, g); }
      g.input += r.input || 0;
      g.output += r.output || 0;
      g.cache_read += r.cache_read || 0;
      g.calls += r.calls || 0;
      g.bases++;
    }
    var out = [];
    map.forEach(function (g) { out.push(g); });
    out.sort(function (a, b) { return (b.input + b.output + b.cache_read) - (a.input + a.output + a.cache_read); });
    return out;
  }
  function groupsOf(rows) {
    var order = [], map = new Map();
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i], p = g.provider;
      if (!map.has(p)) { map.set(p, { provider: p, models: [], input: 0, output: 0, cache_read: 0, calls: 0 }); order.push(p); }
      var o = map.get(p);
      o.models.push(g);
      o.input += g.input; o.output += g.output; o.cache_read += g.cache_read; o.calls += g.calls;
    }
    var res = order.map(function (p) { return map.get(p); });
    res.sort(function (a, b) {
      return (b.input + b.output + b.cache_read) - (a.input + a.output + a.cache_read);
    });
    return res;
  }
  function totalOf(g) { return (g.input || 0) + (g.output || 0) + (g.cache_read || 0); }

  /* 三态聚合（R2-audit 修正，Astra ROUND5 采纳版）：
     state='rate'          denom>0：现有口径照算
     state='unclassified'  denom=0 且 unknown>0：有记录但结局全不可判定，禁显百分比
     state='nodata'        denom=0 且 unknown=0：无任何记录
     注意：遍历全部桶键（unknown 既是时段桶名也是叶字段名） */
  function bucketCounts(bk) {
    var n = 0, f = 0, t = 0, u = 0, es = 0;
    if (bk) for (var k in bk) {
      var v = bk[k] || {};
      n += v.normal || 0; f += v.failed || 0; t += v.timeout || 0; u += v.unknown || 0;
      es += v.empty_shell || 0;
    }
    var d = n + f + t;
    return {
      normal: n, failed: f, timeout: t, unknown: u, empty_shell: es,
      denom: d, all: d + u,
      state: d > 0 ? 'rate' : (u > 0 ? 'unclassified' : 'nodata'),
      rate: d > 0 ? 100 * n / d : 0
    };
  }
  /* 兼容旧调用点（host 聚合手算处仍要对象形状） */
  function bucketRate(bk) { return bucketCounts(bk); }
  /* 平面计数版（host 聚合累加结果用） */
  function countsFromFlat(n, f, t, u, es) {
    var d = n + f + t;
    return {
      normal: n, failed: f, timeout: t, unknown: u, empty_shell: es || 0,
      denom: d, all: d + u,
      state: d > 0 ? 'rate' : (u > 0 ? 'unclassified' : 'nodata'),
      rate: d > 0 ? 100 * n / d : 0
    };
  }

  /* 视图层：全站唯一决定「画什么」。非 rate 态绝不进 rateColor
     （rateColor(NaN/undefined) 兜底 #3A3F46 健康深灰 = 地雷；rateColor(0)=菊黄 误报危险）
     UNK_TX = rateText[2] 同值 #4E545B，面板上对比度 6.97:1 */
  var UNK_TX = '#4E545B';
  function rateView(br) {
    if (br.state === 'rate') {
      return { cls: '', glyph: '', pctText: Math.round(br.rate) + '%',
               fill: 'background:' + rateColor(br.rate),
               pctColor: tailColor(br.rate), cellColor: textColor(br.rate) };
    }
    if (br.state === 'unclassified') {
      return { cls: ' px6-fill--unk', glyph: '?', pctText: '?',
               fill: '', pctColor: UNK_TX, cellColor: UNK_TX };
    }
    return { cls: ' px6-fill--nodata', glyph: '\u2013', pctText: '\u2013',
             fill: '', pctColor: UNK_TX, cellColor: UNK_TX };
  }

  // 单时段叶节点三态版（HISTORY seg 用）
  function leafCounts(bk) {
    var n = (bk && bk.normal) || 0, f = (bk && bk.failed) || 0, t = (bk && bk.timeout) || 0;
    var u = (bk && bk.unknown) || 0;
    var es = (bk && bk.empty_shell) || 0;
    var d = n + f + t;
    return {
      normal: n, failed: f, timeout: t, unknown: u, empty_shell: es, denom: d, all: d + u,
      state: d > 0 ? 'rate' : (u > 0 ? 'unclassified' : 'nodata'),
      rate: d > 0 ? 100 * n / d : 0
    };
  }
  function segRate(bk) { return leafRate(bk || {}); }
  // 单个时段叶节点 → 成功率（rate 态专用；非 rate 态由调用方走三态渲染）
  function leafRate(bk) {
    var n = (bk && bk.normal) || 0, f = (bk && bk.failed) || 0, t = (bk && bk.timeout) || 0;
    var d = n + f + t;
    return d === 0 ? 100 : 100 * n / d;
  }

  /* ============================================================
     像素图标：12×12 网格，'#' = 主体 / 'o' = 亮部
     纯 inline SVG path 拼块（run-length 编码），无外链图片
     配色 = 灰白 / 深灰三色系；菊黄只留给低成功率 bot 的边框/名字
     ============================================================ */
  var PATS = {
    visor: [
      '.....oo.....', '.....##.....', '..########..', '..#......#..',
      '..#.oo.oo#..', '..#.oo.oo#..', '..#......#..', '..##oooo##..',
      '..########..', '..########..', '............', '............'
    ],
    term: [
      '............', '.##########.', '.#........#.', '.#.########.',
      '.#........#.', '.#.oo.....#.', '.#.oo.....#.', '.#........#.',
      '.#.#####..#.', '.#........#.', '.##########.', '............'
    ],
    ghost: [
      '....####....', '...######...', '..########..', '..########..',
      '..#oo##oo#..', '..#oo##oo#..', '..###..###..', '..###..###..',
      '..########..', '..########..', '...#.##.#...', '............'
    ],
    alien: [
      '.....oo.....', '....####....', '...######...', '..########..',
      '.##########.', '.##oo##oo##.', '.##oo##oo##.', '.##########.',
      '.####..####.', '..########..', '....####....', '............'
    ],
    chip: [
      '............', '............', '...oo..oo...', '..########..',
      '.o########o.', '.o##oooo##o.', '.o##oooo##o.', '.o########o.',
      '.o########o.', '...oo..oo...', '............', '............'
    ],
    bug: [
      '............', '....#..#....', '....####....', '..########..',
      '.###o..o###.', '.####..####.', '..###..###..', '.####..####.',
      '.####..####.', '..########..', '...#....#...', '............'
    ]
  };
  var PAT_ORDER = ['chip', 'ghost', 'term', 'bug', 'visor', 'alien', 'chip', 'ghost', 'term'];
  // 灰白 / 深灰家族配色，9 个 bot 各不相同（菊黄不进图标本体）
  var TINTS = ['#26282B', '#3A3F46', '#40454C', '#34383E', '#4A5058', '#2E3338', '#5A6169', '#2A2E33', '#3A3F46'];

  function runs(rows, ch) {
    var d = '';
    for (var y = 0; y < rows.length; y++) {
      var row = rows[y], x = 0;
      while (x < 12) {
        if (row[x] === ch) {
          var x2 = x;
          while (x2 + 1 < 12 && row[x2 + 1] === ch) x2++;
          var w = x2 - x + 1;
          d += 'M' + x + ',' + y + 'h' + w + 'v1h' + (-w) + 'z';
          x = x2 + 1;
        } else x++;
      }
    }
    return d;
  }
  function faceSVG(i) {
    var rows = PATS[PAT_ORDER[i % PAT_ORDER.length]] || PATS.visor;
    var tint = TINTS[i % TINTS.length];
    var dH = runs(rows, '#'), dO = runs(rows, 'o');
    return '<svg class="px6-face" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">'
      + '<path d="' + dH + '" fill="' + tint + '"/>'
      + (dO ? '<path d="' + dO + '" fill="#E5E7EA" opacity=".95"/>' : '')
      + '</svg>';
  }

  /* ============================================================
     条组件
     长度 = pctLen(%)  颜色 = rateColor(rate)  条尾 <b> = 成功率%
     条尾粗体、与条色同族（tailColor：暗轨道上深灰两档提亮）
     .px6-bar > .px6-track(flex) > .px6-fill + <b class="px6-pct">  紧贴
     ============================================================ */
  function barHTML(pctLen, rate, tail) {
    /* rate 参数兼容两形态: 数字(旧) / br对象(R2三态)。对象时按 state 分支,
       非 rate 态尾标 '?' 不显百分比 (修 HOSTS/USAGE NaN%: 调用点传 br, Math.round(br)=NaN) */
    var isObj = rate && typeof rate === 'object';
    var w = clamp(pctLen, 2, 82);
    if (isObj && rate.state !== 'rate') {
      return '<span class="px6-bar">'
        + '<span class="px6-track">'
        + '<span class="px6-fill px6-fill--unk" style="width:' + w.toFixed(1) + '%"></span>'
        + (tail ? '<b class="px6-pct" style="color:' + UNK_TX + '">?</b>' : '')
        + '</span></span>';
    }
    var r = isObj ? rate.rate : rate;
    var c = rateColor(r);
    return '<span class="px6-bar">'
      + '<span class="px6-track">'
      + '<span class="px6-fill" style="width:' + w.toFixed(1) + '%;background:' + c + '"></span>'
      + (tail ? '<b class="px6-pct" style="color:' + tailColor(r) + '">' + Math.round(r) + '<span class="ps">%</span></b>' : '')
      + '</span></span>';
  }

  /* ============================================================
     状态
     ============================================================ */
  var state = { snap: null, view: 'home', botKey: null };

  function botsOf(snap) {
    var out = [];
    (snap.hosts || []).forEach(function (h, hi) {
      (h.bots || []).forEach(function (b) {
        b.__host = h.short; b.__hostIdx = hi;
        out.push(b);
      });
    });
    return out;
  }
  function summarize(b) {
    var rows = usageRows(b), groups = groupUsage(rows);
    var tok = 0, calls = 0, i;
    for (i = 0; i < groups.length; i++) { tok += totalOf(groups[i]); calls += groups[i].calls; }
    var br = bucketCounts(b.agents_completed_buckets || {});
    var segs = ['4h', '4–24h', '24h–7d'].map(function (k) {
      var bk = (b.agents_completed_buckets || {})[k] || {};
      var lc = leafCounts(bk);
      return { key: k, normal: lc.normal, failed: lc.failed, timeout: lc.timeout,
               unknown: lc.unknown, denom: lc.denom, state: lc.state, rate: lc.rate };
    });
    return { bot: b, rows: rows, groups: groups, groupsByProv: groupsOf(groups), tok: tok, calls: calls, br: br, segs: segs };
  }

  /* ============================================================
     渲染：外壳
     ============================================================ */
  function ensureRoot() {
    var root = $('px6-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'px6-root';
      document.body.appendChild(root);
    }
    return root;
  }
  function renderShell() {
    var snap = state.snap;
    var bots = botsOf(snap);
    var hosts = snap.hosts || [];
    var up = bots.length;
    var live = $('px6-live');
    var staleS = snap.unknown_after_s || 90, staleAfter = snap.stale_after_s || 45;
    var age = snapAge(snap);
    var cls = age > staleS ? 'bad' : (age > staleAfter ? 'warn' : '');
    var txt = age > staleS ? '● stale' : (age > staleAfter ? '● aging' : '● live');

    var snapTs = snap.generated_at || '';
    ensureRoot().innerHTML =
      '<div class="px6-top">'
      +   '<div class="px6-status">'
      +     '<b>FLEET</b><i>·</i>'
      +     '<span class="px6-clock" id="px6-clock">--:--:--</span><i>·</i>'
      +     '<b>' + hosts.length + ' hosts</b><i>·</i>'
      +     '<b>' + bots.length + ' bots</b><i>·</i>'
      +     '<span class="px6-live ' + cls + '" id="px6-live">' + txt + '</span>'
      +   '</div>'
      +   '<span class="px6-snap">snapshot ' + esc(snapTs) + '</span>'
      + '</div>'
      + '<div id="px6-main"></div>'
      + '<div class="px6-foot">'
      +   '<span>PX7 · GREY-YELLOW-INK HUB</span>'
      +   '<span>scheme v' + esc(String(snap.schema_version || '?')) + '</span>'
      +   '<span>collector ' + esc(String((snap.collector && snap.collector.pid) || '?'))
        + ' · cycle ' + esc(String((snap.collector && snap.collector.cycle) != null ? snap.collector.cycle : '?')) + '</span>'
      +   '<span>' + esc(String(snap.collect_interval_s || '?')) + 's 采集 / 只读</span>'
      + '</div>';
  }

  /* ============================================================
     渲染：Home（HOSTS → USAGE 总览 → BOTS 像素图标矩阵）
     ============================================================ */
  function renderHome() {
    var snap = state.snap, hosts = snap.hosts || [];
    var sums = botsOf(snap).map(summarize);
    var maxTok = Math.max.apply(null, sums.map(function (s) { return s.tok; }).concat([1]));

    /* --- HOSTS --- */
    var hostRows = '';
    var hostMax = 1;
    var hAgg = hosts.map(function (h) {
      var hs = sums.filter(function (s) { return s.bot.__host === h.short; });
      var acc = { normal: 0, failed: 0, timeout: 0, unknown: 0, empty_shell: 0 }, tok = 0, calls = 0, i;
      for (i = 0; i < hs.length; i++) {
        tok += hs[i].tok; calls += hs[i].calls;
        var b = hs[i].br;
        acc.normal += b.normal; acc.failed += b.failed; acc.timeout += b.timeout; acc.unknown += b.unknown;
        acc.empty_shell += b.empty_shell || 0;
      }
      /* Astra ROUND5 BLOCKER：累加后必须重算 denom/state，不能漏。
         acc 是平面对象（非桶结构），用 countsFromFlat 判三态 */
      var br = countsFromFlat(acc.normal, acc.failed, acc.timeout, acc.unknown, acc.empty_shell);
      hostMax = Math.max(hostMax, tok);
      return { h: h, n: hs.length, tok: tok, calls: calls, br: br, acc: acc };
    });
    hAgg.forEach(function (a) {
      var hv = rateView(a.br);
      /* F: 悬浮明细 — 问号来源拆解 (approx 源 / 空壳) */
      var tip = a.h.short + ' 结局口径: ' + a.br.normal + ' ok / ' + (a.br.failed + a.br.timeout) + ' bad'
        + (a.br.unknown ? ' / ' + a.br.unknown + ' 证据不足(?)' : '')
        + (a.br.empty_shell ? ' / ' + a.br.empty_shell + ' 空壳' : '');
      hostRows += '<div class="px6-host" title="' + esc(tip) + '">'
        + '<span class="lbl">' + esc(a.h.short) + '</span>'
        + barHTML(a.tok / hostMax * 100, a.br, true)
        + '<span class="meta">' + a.n + ' bots · ' + fmtTok(a.tok) + (a.br.unknown ? ' · ' + a.br.unknown + ' 证据不足' : '') + (a.br.empty_shell ? ' · ' + a.br.empty_shell + ' 空壳' : '') + '</span>'
        + '</div>';
    });

    /* --- USAGE 总览 --- */
    var usageRows = '';
    sums.forEach(function (s, i) {
      var b = s.bot;
      var uv = rateView(s.br);
      usageRows += '<div class="px6-row" data-bot="' + esc(i) + '" title="' + esc(b.display_name) + ' → usage 详情">'
        + '<span class="px6-rlbl">' + esc(b.display_name) + ' <em>' + esc(b.__host) + '</em></span>'
        + barHTML(s.tok / maxTok * 100, s.br, true)
        + '<span class="px6-rval">' + fmtTok(s.tok) + ' tok<br><b>' + fmtInt(s.calls) + ' calls</b></span>'
        + '</div>';
    });

    /* --- BOTS 像素图标矩阵 --- */
    var cells = '';
    sums.forEach(function (s, i) {
      var b = s.bot;
      var v = rateView(s.br);
      /* low 判定仅在 rate 态（unclassified/nodata 不取色、不触发菊黄边框） */
      var lowCls = (v.cls === '' && rateBand(s.br.rate) <= 1) ? ' low' : '';
      var pctTxt = (v.cls === '') ? Math.round(s.br.rate) + '%' : v.pctText;
      var tip = b.display_name + ' \u2014 ' + (v.cls === '' ? pctTxt : v.pctText + (' (\u672a\u5f52\u6863 ' + s.br.unknown + '/' + s.br.all + ')'))
        + ' · ' + fmtTok(s.tok) + ' tok · ' + fmtInt(s.calls) + ' calls';
      cells += '<div class="px6-cell' + lowCls + (s.tok === 0 ? ' dim' : '') + '" data-bot="' + esc(i) + '" role="button" tabindex="0"'
        + ' title="' + esc(tip) + '">'
        + '<span class="dot"></span>'
        + faceSVG(i)
        + '<span class="px6-cname">' + esc(b.display_name) + (s.br.unknown > 0 && v.cls === '' ? '<sup class="px6-q">?</sup>' : '') + '</span>'
        + '<span class="px6-crate' + (v.cls ? ' px6-crate--unk' : '') + '" style="color:' + v.cellColor + '">' + pctTxt + '</span>'
        + '<span class="px6-csub">' + fmtTok(s.tok) + '</span>'
        + '</div>';
    });

    $('px6-main').innerHTML =
      '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">HOSTS</span>'
      +     '<span class="px6-secsub">' + hAgg.map(function (a) { return esc(a.h.short); }).join(' / ') + '</span>'
      +     '<span class="px6-secrval"><em>' + sums.length + '</em>/' + sums.length + ' up</span>'
      +   '</div>'
      +   '<div class="px6-hosts">' + hostRows + '</div>'
      +   '<div class="px6-legend"><span>条长=token 量（相对最大 host）</span><span>色=成功率</span><span>条尾=成功率</span></div>'
      + '</section>'
      + '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">USAGE</span>'
      +     '<span class="px6-secsub">bot 总量 · 点击下钻</span>'
      +     '<span class="px6-secrval">Σ <em>' + fmtTok(sums.reduce(function (a, s) { return a + s.tok; }, 0)) + '</em> tok</span>'
      +   '</div>'
      +   '<div class="px6-usage">' + usageRows + '</div>'
      +   '<div class="px6-legend">'
      +     '<span>条长=总量 / 最大 bot</span>'
      +     '<span>色 = 已归类成功率 ' + legendSwatches() + '</span>'
      +     '<span class="sw--unk-text">? = 结局未归档（不显示百分比）</span>'
      +     '<span class="sw--nodata-text">\u2013 = 无记录</span>'
      +   '</div>'
      + '</section>'
      + '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">BOTS</span>'
      +     '<span class="px6-secsub">像素图标矩阵 · 点击 drilldown</span>'
      +     '<span class="px6-secrval">' + PAT_ORDER.slice(0, 6).length + ' 种图案 · ' + sums.length + ' bot</span>'
      +   '</div>'
      +   '<div class="px6-matrix">' + cells + '</div>'
      + '</section>';

    var main = $('px6-main');
    var go = function (el) {
      var k = el.getAttribute('data-bot');
      if (k !== null && k !== '' && !isNaN(+k)) { state.view = 'detail'; state.botKey = +k; render(); }
    };
    main.querySelectorAll('[data-bot]').forEach(function (el) {
      el.addEventListener('click', function () { go(el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(el); }
      });
    });
  }
  function legendSwatches() {
    /* 每档取一个代表值，保证 5 个色阶都在图例里出现 */
    var html = '';
    [[20, '&lt;40'], [50, '40-60'], [70, '60-80'], [88, '80-95'], [100, '≥95']].forEach(function (p) {
      html += '<span class="sw" style="background:' + rateColor(p[0]) + '"></span>' + p[1] + ' ';
    });
    return html;
  }

  /* ============================================================
     渲染：Drilldown 详情（USAGE 专项）
       按 provider 分组 → 组内按 model 列行
       条长 = 该 model 用量（相对本 bot 最大值归一）
       条色 = bot 成功率映射   条尾 = 成功率 %
     ============================================================ */
  function renderDetail() {
    var sums = botsOf(state.snap).map(summarize);
    var s = sums[clamp(state.botKey, 0, sums.length - 1)];
    if (!s) { state.view = 'home'; return renderHome(); }
    var b = s.bot;
    var i = sums.indexOf(s);

    /* --- provider 分组行 --- */
    var maxModel = Math.max.apply(null, s.groups.map(function (g) { return totalOf(g); }).concat([1]));
    var pgHTML = '';
    if (!s.groups.length) {
      pgHTML = '<div class="px6-empty">该 bot 无 usage 记录（tokens.totals 为空）</div>';
    }
    s.groupsByProv.forEach(function (p) {
      pgHTML += '<div class="px6-pg">'
        + '<div class="px6-pgname">' + esc(p.provider) + '<i>' + p.models.length + ' model</i>'
        + '<em>' + fmtTok(p.input + p.output + p.cache_read) + ' tok · ' + fmtInt(p.calls) + ' calls</em></div>';
      p.models.forEach(function (m) {
        var v = totalOf(m);
        pgHTML += '<div class="px6-row">'
          + '<span class="px6-rlbl" title="' + esc(p.provider + '/' + m.model) + '"><em>' + esc(p.provider) + '</em>/' + esc(m.model) + '</span>'
          + barHTML(v / maxModel * 100, s.br, true)
          + '<span class="px6-rval">' + fmtTok(v) + ' tok<br><b>' + fmtInt(m.calls) + ' calls</b></span>'
          + '</div>';
      });
      pgHTML += '</div>';
    });

    /* --- 历史 usage：3 段时间分段条（三态版） --- */
    var maxSeg = Math.max.apply(null, s.segs.map(function (x) { return x.all || x.denom; }).concat([1]));
    var histHTML = s.segs.map(function (x) {
      var vol = (x.all || x.denom) / maxSeg * 100;
      var segCls = '';
      var segFill = 'background:' + rateColor(x.rate);
      var segOpacity = '1';
      var rightTxt;
      if (x.denom > 0) {
        rightTxt = Math.round(x.rate) + '%';
      } else if (x.unknown > 0) {
        segCls = ' px6-hfill--unk'; segFill = '';
        rightTxt = '? (' + x.unknown + ' 未归档)';
      } else {
        segCls = ' px6-hfill--nodata'; segFill = ''; segOpacity = '.32';
        rightTxt = 'no records';
      }
      return '<div class="px6-hseg">'
        + '<span class="px6-hlbl">' + esc(x.key) + '</span>'
        + '<span class="px6-htrack"><span class="px6-hfill' + segCls + '" style="width:' + clamp(vol, 2, 100).toFixed(1) + '%;' + segFill + ';opacity:' + segOpacity + '"></span></span>'
        + '<span class="px6-hc"><span><b>' + x.normal + '</b> ok / ' + (x.failed + x.timeout) + ' bad</span>'
        + '<span>' + rightTxt + '</span></span>'
        + '</div>';
    }).join('');

    var unk = s.br.unknown;
    var dv = rateView(s.br);
    var dvPct = (dv.cls === '') ? Math.round(s.br.rate) + '%' : dv.pctText;
    $('px6-main').innerHTML =
      '<div class="px6-detail">'
      + '<button class="px6-back" id="px6-back" type="button">&lt; BACK</button>'
      + '<div class="px6-dhead">'
      +   '<span>' + faceSVG(i) + '</span>'
      +   '<div class="px6-dmeta">'
      +     '<div class="px6-dname">' + esc(b.display_name) + '</div>'
      +     '<div class="px6-dsub">' + esc(b.__host) + ' <i>·</i> ' + esc(b.id)
      +       ' <i>·</i> ' + s.groups.length + ' model <i>·</i> ' + s.groupsByProv.length + ' provider</div>'
      +   '</div>'
      +   '<span class="px6-drate' + (dv.cls ? ' px6-drate--unk' : '') + '" style="color:' + dv.cellColor + ';border-color:' + (dv.cls ? UNK_TX : rateColor(s.br.rate)) + '"'
      +     (dv.cls === '' && s.br.unknown > 0 ? ' title="已归类成功率；另有 ' + s.br.unknown + ' 条未归档（占 ' + (Math.round(100 * s.br.unknown / s.br.all * 10) / 10) + '%）"' : '')
      +   '>'
      +     dvPct + (dv.cls === '' ? '<span>%</span>' : '') + '</span>'
      +   (dv.cls !== '' ? '<span class="px6-dsub" style="color:' + UNK_TX + '">结局未归档 ' + s.br.unknown + '/' + s.br.all + ' 条（来源缺 omp_ledger）</span>' : '')
      +   (dv.cls === '' && s.br.unknown > 0 ? '<span class="px6-dsub" style="color:' + UNK_TX + '">已归类口径 · 另有 ' + s.br.unknown + '/' + s.br.all + ' 未归档</span>' : '')
      + '</div>'
      + '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">USAGE</span>'
      +     '<span class="px6-secsub">累计自首记录 · tok 含缓存读</span>'
      +     '<span class="px6-secrval"><em>' + fmtTok(s.tok) + '</em> tok · ' + fmtInt(s.calls) + ' calls</span>'
      +   '</div>'
      +   pgHTML
      +   '<div class="px6-legend">'
      +     '<span>条长 = 用量总量 / 本 bot 最大 model</span>'
      +     '<span>条色 = 本 bot 已归类成功率 ' + (dv.cls === '' ? Math.round(s.br.rate) + '%' : dv.pctText) + '</span>'
      +     '<span>条尾 = 已归类成功率 %</span>'
      +   '</div>'
      + '</section>'
      + '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">HISTORY</span>'
      +     '<span class="px6-secsub">agents_completed_buckets</span>'
      +     '<span class="px6-secrval">' + s.br.normal + ' ok / ' + (s.br.failed + s.br.timeout) + ' bad'
      + (s.br.empty_shell ? ' · ' + s.br.empty_shell + ' 空壳' : '')
      + (unk ? ' · ' + unk + ' 未归档' : '') + '</span>'
      +   '</div>'
      +   '<div class="px6-hist">' + histHTML + '</div>'
      +   '<div class="px6-legend">'
      +     '<span>条长 = 记录量（含未归档）/ 最大时段</span>'
      +     '<span>段色 = 该时段已归类成功率</span>'
      +     '<span>? = 结局未归档 · \u2013 = 无记录</span>'
      +   '</div>'
      + '</section>'
      + '</div>';

    var back = $('px6-back');
    if (back) back.addEventListener('click', goBack);
    window.scrollTo(0, 0);
  }
  function goBack() { state.view = 'home'; state.botKey = null; render(); }

  /* ============================================================
     入口
     ============================================================ */
  /* 工作态判定（任务4）：work.state 含「工作」或「进展」。
     ⚠ 只按 display_name 建立矩阵 cell ↔ bot 的映射不可靠（重名/显示名
     与 id 不一致），改为在 renderHome 的 cells 构建处直接内联标记。 */
  function isWorking(b) {
    var st = (b && b.work && b.work.state) || '';
    return st.indexOf('工作') >= 0 || st.indexOf('进展') >= 0;
  }
  function render() {
    if (!state.snap) return;
    if (state.view === 'detail') renderDetail(); else renderHome();
    /* 任务4：按快照给矩阵 cell / drilldown 标题加 .working
       （data-widx 是 renderHome 写入的 bots 数组下标，稳定不重名） */
    try {
      var bots = botsOf(state.snap);
      var root = $('px6-main');
      if (state.view === 'detail') {
        var s = bots[clamp(state.botKey, 0, bots.length - 1)];
        var det = root.querySelector('.px6-detail');
        if (det && s) det.classList.toggle('working', isWorking(s)); /* botsOf 返回裸 bot，无 .bot 包装 */
      } else {
        root.querySelectorAll('.px6-cell[data-bot]').forEach(function (el) {
          var b = bots[+el.getAttribute('data-bot')];
          if (b) el.classList.toggle('working', isWorking(b));
        });
      }
    } catch (e) { /* 不阻塞主渲染 */ }
    /* 任务5：FREE QUOTA section 重渲 + 重挂（若 quota 层已就绪） */
    if (window.__PX7_RENDER_QUOTA__) window.__PX7_RENDER_QUOTA__(state.snap);
  }
  /* live 轮询层把新快照推进来（skin-px7a-live.js） */
  window.__PX7_SET_SNAPSHOT__ = function (snap, via) {
    var first = !state.snap; /* 首帧：必须完整渲染 */
    var changed = false;
    if (state.snap && snap && state.snap.generated_at !== snap.generated_at) changed = true;
    state.snap = snap;
    window.__PX7_MODE__ = via; /* 旧 load() 兜底轮询的门卫信号 */
    if (first || !document.getElementById('px6-root')) {
      renderShell();
      render();
    } else if (changed) {
      render(); /* generated_at 变了 → 全量重渲（条宽瞬时跳变，非平滑过渡） */
    }
    tickClock();
  };
  function tickClock() {
    var c = $('px6-clock');
    if (c) {
      var d = new Date();
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      c.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    var live = $('px6-live');
    if (live && state.snap) {
      /* live 层（skin-px7a-live.js）接管徽章文案时（data-src 已设），此处不覆盖 */
      if (!live.getAttribute('data-src')) {
        var snap = state.snap;
        var age = snapAge(snap);
        var staleS = snap.unknown_after_s || 90, staleAfter = snap.stale_after_s || 45;
        var cls = age > staleS ? 'bad' : (age > staleAfter ? 'warn' : '');
        live.className = 'px6-live ' + cls;
        live.textContent = age > staleS ? '● stale' : (age > staleAfter ? '● aging' : '● live');
      }
    }
  }
  function fatal(msg) {
    ensureRoot().innerHTML =
      '<div class="px6-top"><div class="px6-status"><b>FLEET</b><i>·</i><span class="px6-live bad">● offline</span></div></div>'
      + '<div class="px6-empty" style="margin-top:26px">' + esc(msg) + '</div>';
  }
  function load() {
    /* R2-rev2：旧 120s 兜底轮询改走 live 层同一入口。
       direct 模式下旧快照轮询**不得覆盖**直连数据（Astra R2 MINOR）；
       首帧（state.snap 为空）时仍负责 bootstrap。 */
    if (state.snap && window.__PX7_MODE__ === 'direct') return;
    return fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (snap) {
        /* 异步窗口防护：请求期间 live 层已切 direct → 旧快照响应作废 */
        if (window.__PX7_MODE__ === 'direct') return snap;
        if (window.__PX7_SET_SNAPSHOT__) {
          window.__PX7_SET_SNAPSHOT__(snap, 'snapshot');
        } else {
          state.snap = snap;
          renderShell();
          render();
          tickClock();
        }
      })
      .catch(function (e) { fatal('无法读取快照：' + e.message); });
  }

  // 原版 DOM 隐藏由 body.px7-a 的 CSS 负责
  (function boot() {
    document.body.className = (document.body.className || '').replace(/px[67]-[a-z]+/g, '').trim() + ' px7-a';
    window.addEventListener('keydown', function (e) {
      if (state.view === 'detail' && (e.key === 'Escape' || e.key === 'ArrowLeft')) goBack();
    });
    window.setInterval(tickClock, 1000);
    load();
    window.setInterval(load, 120000);
  })();
})();
