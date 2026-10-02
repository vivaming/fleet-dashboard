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

  function bucketRate(bk) {
    var n = 0, f = 0, t = 0;
    if (bk) for (var k in bk) { var v = bk[k] || {}; n += v.normal || 0; f += v.failed || 0; t += v.timeout || 0; }
    var d = n + f + t;
    return { normal: n, failed: f, timeout: t, denom: d, rate: d === 0 ? 100 : 100 * n / d };
  }
  function segRate(bk) { return leafRate(bk || {}); }

  // 单个时段叶节点 {normal,failed,timeout,unknown} → 成功率
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
     条尾粗体、字色跟条色一致（内联 color = rateColor(rate)）
     .px6-bar > .px6-track(flex) > .px6-fill + <b class="px6-pct">  紧贴
     ============================================================ */
  function barHTML(pctLen, rate, tail) {
    var w = clamp(pctLen, 2, 82);
    var c = rateColor(rate);
    return '<span class="px6-bar">'
      + '<span class="px6-track">'
      + '<span class="px6-fill" style="width:' + w.toFixed(1) + '%;background:' + c + '"></span>'
      + (tail ? '<b class="px6-pct" style="color:' + c + '">' + Math.round(rate) + '<span class="ps">%</span></b>' : '')
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
    var br = bucketRate(b.agents_completed_buckets || {});
    var segs = ['4h', '4–24h', '24h–7d'].map(function (k) {
      var bk = (b.agents_completed_buckets || {})[k] || {};
      var n = bk.normal || 0, f = bk.failed || 0, t = bk.timeout || 0;
      return { key: k, normal: n, failed: f, timeout: t, denom: n + f + t, rate: segRate(bk) };
    });
    return { bot: b, rows: rows, groups: groups, groupsByProv: groupsOf(groups), tok: tok, calls: calls, rate: br.rate, br: br, segs: segs };
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
    var age = Math.max(0, (Date.now() / 1000) - (snap.generated_at_epoch || snap.generated_at));
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
      +   '<span>collector ' + esc(String(snap.collector || '?')) + '</span>'
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
      var br = bucketRate({}), tok = 0, calls = 0, i;
      for (i = 0; i < hs.length; i++) {
        tok += hs[i].tok; calls += hs[i].calls;
        var b = hs[i].br;
        br.normal += b.normal; br.failed += b.failed; br.timeout += b.timeout;
      }
      var d = br.normal + br.failed + br.timeout;
      br.rate = d === 0 ? 100 : 100 * br.normal / d;
      hostMax = Math.max(hostMax, tok);
      return { h: h, n: hs.length, tok: tok, calls: calls, rate: br.rate };
    });
    hAgg.forEach(function (a) {
      hostRows += '<div class="px6-host">'
        + '<span class="lbl">' + esc(a.h.short) + '</span>'
        + barHTML(a.tok / hostMax * 100, a.rate, true)
        + '<span class="meta">' + a.n + ' bots · ' + fmtTok(a.tok) + '</span>'
        + '</div>';
    });

    /* --- USAGE 总览 --- */
    var usageRows = '';
    sums.forEach(function (s, i) {
      var b = s.bot;
      usageRows += '<div class="px6-row" data-bot="' + esc(i) + '" title="' + esc(b.display_name) + ' → usage 详情">'
        + '<span class="px6-rlbl">' + esc(b.display_name) + ' <em>' + esc(b.__host) + '</em></span>'
        + barHTML(s.tok / maxTok * 100, s.rate, true)
        + '<span class="px6-rval">' + fmtTok(s.tok) + ' tok<br><b>' + fmtInt(s.calls) + ' calls</b></span>'
        + '</div>';
    });

    /* --- BOTS 像素图标矩阵 --- */
    var cells = '';
    sums.forEach(function (s, i) {
      var b = s.bot;
      /* 低成功率（band 0/1 = 菊黄 / 桔灰）→ 图标边框 + 名字转菊黄 */
      var lowCls = (rateBand(s.rate) <= 1) ? ' low' : '';
      cells += '<div class="px6-cell' + lowCls + (s.tok === 0 ? ' dim' : '') + '" data-bot="' + esc(i) + '" role="button" tabindex="0"'
        + ' title="' + esc(b.display_name) + ' — ' + Math.round(s.rate) + '% · ' + fmtTok(s.tok) + ' tok · ' + fmtInt(s.calls) + ' calls">'
        + '<span class="dot"></span>'
        + faceSVG(i)
        + '<span class="px6-cname">' + esc(b.display_name) + '</span>'
        + '<span class="px6-crate" style="color:' + rateColor(s.rate) + '">' + Math.round(s.rate) + '%</span>'
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
      +     '<span>色 = 成功率 ' + legendSwatches() + '</span>'
      +     '<span>条尾 = 成功率 %</span>'
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
    var html = '';
    [0, 25, 50, 75, 100].forEach(function (r) {
      html += '<span class="sw" style="background:' + rateColor(r) + '"></span>';
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
          + barHTML(v / maxModel * 100, s.rate, true)
          + '<span class="px6-rval">' + fmtTok(v) + ' tok<br><b>' + fmtInt(m.calls) + ' calls</b></span>'
          + '</div>';
      });
      pgHTML += '</div>';
    });

    /* --- 历史 usage：3 段时间分段条 --- */
    var maxSeg = Math.max.apply(null, s.segs.map(function (x) { return x.denom; }).concat([1]));
    var histHTML = s.segs.map(function (x) {
      var vol = x.denom / maxSeg * 100;
      var noRec = x.denom === 0;
      return '<div class="px6-hseg">'
        + '<span class="px6-hlbl">' + esc(x.key) + '</span>'
        + '<span class="px6-htrack"><span class="px6-hfill" style="width:' + clamp(vol, 2, 100).toFixed(1) + '%;background:' + rateColor(x.rate) + ';opacity:' + (noRec ? '.32' : '1') + '"></span></span>'
        + '<span class="px6-hc"><span><b>' + x.normal + '</b> ok / ' + (x.failed + x.timeout) + ' bad</span>'
        + '<span>' + (noRec ? 'no records' : Math.round(x.rate) + '%') + '</span></span>'
        + '</div>';
    }).join('');

    var unk = ((b.agents_completed_buckets || {}).unknown || {}).unknown || 0;
    var rc = rateColor(s.rate);
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
      +   '<span class="px6-drate" style="color:' + rc + ';border-color:' + rc + '">'
      +     Math.round(s.rate) + '<span>%</span></span>'
      + '</div>'
      + '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">USAGE</span>'
      +     '<span class="px6-secsub">by provider → model</span>'
      +     '<span class="px6-secrval"><em>' + fmtTok(s.tok) + '</em> tok · ' + fmtInt(s.calls) + ' calls</span>'
      +   '</div>'
      +   pgHTML
      +   '<div class="px6-legend">'
      +     '<span>条长 = 用量总量 / 本 bot 最大 model</span>'
      +     '<span>条色 = 本 bot 成功率 ' + Math.round(s.rate) + '%</span>'
      +     '<span>条尾 = 成功率 %</span>'
      +   '</div>'
      + '</section>'
      + '<section class="px6-sec">'
      +   '<div class="px6-sechead">'
      +     '<span class="px6-secname">HISTORY</span>'
      +     '<span class="px6-secsub">agents_completed_buckets</span>'
      +     '<span class="px6-secrval">' + s.br.normal + ' ok / ' + (s.br.failed + s.br.timeout) + ' bad'
      + (unk ? ' · ' + unk + ' 未归档' : '') + '</span>'
      +   '</div>'
      +   '<div class="px6-hist">' + histHTML + '</div>'
      +   '<div class="px6-legend">'
      +     '<span>条长 = 记录量 / 最大时段</span>'
      +     '<span>段色 = 该时段成功率</span>'
      +     '<span>无记录按时段 100%</span>'
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
  function render() {
    if (!state.snap) return;
    if (state.view === 'detail') renderDetail(); else renderHome();
  }
  function tickClock() {
    var c = $('px6-clock');
    if (c) {
      var d = new Date();
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      c.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    var live = $('px6-live');
    if (live && state.snap) {
      var snap = state.snap;
      var age = Math.max(0, (Date.now() / 1000) - (snap.generated_at_epoch || snap.generated_at));
      var staleS = snap.unknown_after_s || 90, staleAfter = snap.stale_after_s || 45;
      var cls = age > staleS ? 'bad' : (age > staleAfter ? 'warn' : '');
      live.className = 'px6-live ' + cls;
      live.textContent = age > staleS ? '● stale' : (age > staleAfter ? '● aging' : '● live');
    }
  }
  function fatal(msg) {
    ensureRoot().innerHTML =
      '<div class="px6-top"><div class="px6-status"><b>FLEET</b><i>·</i><span class="px6-live bad">● offline</span></div></div>'
      + '<div class="px6-empty" style="margin-top:26px">' + esc(msg) + '</div>';
  }
  function load() {
    return fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (snap) {
        state.snap = snap;
        renderShell();
        render();
        tickClock();
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
