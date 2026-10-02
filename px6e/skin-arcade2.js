/* ==========================================================================
   skin-arcade2.js — PX6-E「街机霓虹」fleet dashboard 渲染器
   数据源: /api/status（api-override.js 重定向到本地快照 api_status.json）
   字段:
     host.short(.69/.65/.67), host.error, host.bots[]
     bot.display_name / bot.id / bot._severity(0|1|2)
     bot.tokens.totals[] {model, provider, input, output, cache_read, cache_write, calls}
     bot.agents_completed_buckets {4h, 4–24h, 24h–7d, unknown} {normal,failed,timeout,unknown}
   成功率 = Σnormal / Σ(normal+failed+timeout)；无记录按 100%
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 工具 */

  // 数字缩写：15316809439 -> "15.32B"
  function fmtN(n) {
    n = Number(n) || 0;
    var a = Math.abs(n);
    if (a >= 1e9) return trim((n / 1e9).toFixed(2)) + 'B';
    if (a >= 1e6) return trim((n / 1e6).toFixed(1)) + 'M';
    if (a >= 1e3) return trim((n / 1e3).toFixed(1)) + 'k';
    return String(Math.round(n));
  }
  function trim(s) { return String(s).replace(/\.?0+$/, ''); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* --------------------------------------------------- 成功率 -> 颜色映射
     全站唯一的成功率色阶函数。hue 随 rate 分段线性插值（等价于
     hue = 0 + (rate/100)*142 的折线版）:
        0%  -> hue  0  #ef4444 红
       35%  -> hue 32  #f59e0b 橙
       70%  -> hue 48  #eab308 黄
      100%  -> hue142  #2ecc71 绿
     即成功率越高越绿；s/l 可覆盖以微调明度。
     ---------------------------------------------------------------- */
  var HUE_STOPS = [[0, 0], [35, 32], [70, 48], [100, 142]];
  function rateHue(rate) {
    var r = Math.max(0, Math.min(100, rate || 0));
    for (var i = 0; i < HUE_STOPS.length - 1; i++) {
      var a = HUE_STOPS[i], b = HUE_STOPS[i + 1];
      if (r <= b[0]) return a[1] + (b[1] - a[1]) * (r - a[0]) / (b[0] - a[0]);
    }
    return HUE_STOPS[HUE_STOPS.length - 1][1];
  }
  function rateColor(rate, sat, lit) {
    return 'hsl(' + rateHue(rate).toFixed(1) + ',' + (sat || 92) + '%,' + (lit || 54) + '%)';
  }

  /* ---------------------------------------------- 像素图案 13x10 网格
     X = 身体(currentColor)  E = 眼睛(白)  D = 暗部/口(深)  . = 空
     6 种街机生物，9 个 bot 按 i%6 分配 —— 任意 3 格相邻都不同图案。
     ---------------------------------------------------------------- */
  var PIX_PATTERNS = {
    invader: [
      '.............',
      '...X.....X...',
      '..XXXXXXXXX..',
      '.XXXXXXXXXXX.',
      '.XXEEXXXEEXX.',
      '.XXXXXXXXXXX.',
      'XXXXXXXXXXXXX',
      '.X.XXXXXXX.X.',
      '...X.X..X.X..',
      '.............'
    ],
    slime: [
      '.....XXX.....',
      '....XXXXX....',
      '...XXXXXXX...',
      '..XXXXXXXXX..',
      '.XXXXXXXXXXX.',
      'XXXXXXXXXXXXX',
      'XXXEEXXXEEXXX',
      'XXXXXXXXXXXXX',
      '.XXXXXXXXXXX.',
      '..X.XXXXX.X..'
    ],
    droid: [
      '......D......',
      '.....XXX.....',
      '.....XXX.....',
      '...XXXXXXX...',
      '.XXXXXXXXXXX.',
      'XXXXXXXXXXXXX',
      'XXEEEXXXEEEXX',
      'XXXXXXXXXXXXX',
      '..X..X..X.X..',
      '...XXXXXXX...'
    ],
    ghost: [
      '....XXXXX....',
      '...XXXXXXX...',
      '.XXXXXXXXXXX.',
      'XXXXXXXXXXXXX',
      'XXEEEXXXEEEXX',
      'XXEXEXXXEXEXX',
      'XXXXXXXXXXXXX',
      'XXXXXXXXXXXXX',
      '.XX.XXXXX.XX.',
      '..X..X.X.X.X.'
    ],
    ship: [
      '.............',
      '......X......',
      '.....XXX.....',
      '....XXXXX....',
      '..XXXXXXXXX..',
      'XXXXXXXXXXXXX',
      'XXXXDXXXDXXXX',
      '..X.X...X.X..',
      '.....DDD.....',
      '.............'
    ],
    eye: [
      '....XXXXX....',
      '..XXXXXXXXX..',
      '.XXXXXXXXXXX.',
      'XXXXXXXXXXXXX',
      'XXXEXDDDXEXXX',
      'XXXEXDDDXEXXX',
      'XXXXXXXXXXXXX',
      '.XXXXXXXXXXX.',
      '..XXXXXXXXX..',
      '....XXXXX....'
    ]
  };
  var PAT_NAMES = ['invader', 'slime', 'droid', 'ghost', 'ship', 'eye'];
  // 9 个 bot 的霓虹配色（互不相同）
  var ICON_COLORS = ['#ff2d95', '#22d3ee', '#b26bff', '#a3ff12', '#ff9f1c',
                     '#ff5cf0', '#00e5a8', '#ffd23d', '#6ba8ff'];

  function iconSvg(bot) {
    var rows = PIX_PATTERNS[bot.pattern] || PIX_PATTERNS.invader;
    var rects = '';
    for (var y = 0; y < rows.length; y++) {
      var line = rows[y];
      for (var x = 0; x < line.length; x++) {
        var c = line.charAt(x);
        if (c === '.') continue;
        var fill = c === 'E' ? '#ffffff' : c === 'D' ? 'rgba(11,6,22,.78)' : 'currentColor';
        rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill + '"/>';
      }
    }
    return '<svg class="px6-icon" viewBox="0 0 ' + line.length + ' ' + rows.length +
           '" width="46" height="46" shape-rendering="crispEdges" aria-hidden="true" style="color:' +
           esc(bot.color || '#ff2d95') + '">' + rects + '</svg>';
  }

  /* ------------------------------------------------------------- 数据解析 */

  function rateOf(normals, denom) { return denom > 0 ? Math.round(normals / denom * 100) : 100; }

  function normBot(b, host) {
    var rows = (b.tokens && b.tokens.totals) ||
               (b.usage && b.usage.totals) ||
               b.models || [];

    // (provider, model) 聚合 —— 同模型不同来源拆行，同源同模型合并
    var agg = Object.create(null);
    var total = 0, calls = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var amt = (r.input || 0) + (r.output || 0) +
                (r.cache_read || 0) + (r.cache_write || 0);
      var prov = (r.provider != null && String(r.provider).trim()) ? String(r.provider) : 'NO-PROVIDER';
      var mdl = (r.model != null && String(r.model).trim()) ? String(r.model) : 'model?';
      var key = prov + '\u0001' + mdl;
      var a = agg[key];
      if (!a) { a = { provider: prov, model: mdl, amt: 0, calls: 0 }; agg[key] = a; }
      a.amt += amt;
      a.calls += r.calls || 0;
      total += amt;
      calls += r.calls || 0;
    }
    var provs = Object.create(null);
    var keys = Object.keys(agg);
    for (var k = 0; k < keys.length; k++) {
      var it = agg[keys[k]];
      var p = provs[it.provider];
      if (!p) { p = { provider: it.provider, total: 0, calls: 0, models: [] }; provs[it.provider] = p; }
      p.total += it.amt;
      p.calls += it.calls;
      p.models.push(it);
    }
    var provList = Object.keys(provs).map(function (kk) {
      var p = provs[kk];
      p.models.sort(function (x, y) { return y.amt - x.amt; });
      p.n = p.models.length;
      return p;
    }).sort(function (x, y) { return y.total - x.total; });

    // 成功率来源: agents_completed_buckets
    var buckets = b.agents_completed_buckets || {};
    var segs = ['4h', '4–24h', '24h–7d'].map(function (key) {
      var v = buckets[key] || {};
      var n = v.normal || 0;
      var bad = (v.failed || 0) + (v.timeout || 0);
      return { key: key, normal: n, bad: bad, unknown: v.unknown || 0, total: n + bad,
               rate: rateOf(n, n + bad) };
    });
    var nAll = 0, badAll = 0;
    var bk = Object.keys(buckets);
    for (var j = 0; j < bk.length; j++) {
      var bv = buckets[bk[j]];
      if (bv && typeof bv === 'object') {
        nAll += bv.normal || 0;
        badAll += (bv.failed || 0) + (bv.timeout || 0);
      }
    }
    return {
      id: b.id || '',
      name: b.display_name || b.id || 'bot',
      host: host && host.short,
      sev: b._severity == null ? 0 : b._severity,
      total: total,
      calls: calls,
      nModels: keys.length,
      nProviders: provList.length,
      provList: provList,
      segs: segs,
      rate: rateOf(nAll, nAll + badAll),
      nNormal: nAll,
      nBad: badAll
    };
  }

  function build(snap) {
    var hosts = (snap.hosts || []).map(function (h) {
      var bots = (h.bots || []).map(function (b) { return normBot(b, h); });
      return {
        short: h.short || (h.host_id || '?'),
        hostId: h.host_id || '',
        down: h.error != null,
        error: h.error || null,
        bots: bots
      };
    });
    var all = [];
    hosts.forEach(function (h) {
      h.bots.forEach(function (bt) {
        bt.host = h.short;
        bt.pattern = PAT_NAMES[all.length % PAT_NAMES.length];
        bt.color = ICON_COLORS[all.length % ICON_COLORS.length];
        all.push(bt);
      });
    });
    return { snap: snap, hosts: hosts, bots: all };
  }

  /* ------------------------------------------------------------- 渲染工具 */

  // 一条 16px 高实心条形：条长=w%，色=color，尾部紧跟白色粗体百分比
  function barRow(opts) {
    var w = Math.max(0, Math.min(100, opts.w == null ? 0 : opts.w));
    var color = opts.color || rateColor(opts.rate, 92, 54);
    return '<div class="px6-row">' +
      '<span class="px6-name" title="' + esc(opts.name) + '">' + esc(opts.nameHtml || opts.name) + '</span>' +
      '<div class="px6-track">' +
        '<span class="px6-fill" style="width:' + w.toFixed(2) + '%;background:' + color + '"></span>' +
      '</div>' +
      '<b class="px6-pct">' + Math.round(opts.pct == null ? (opts.rate || 0) : opts.pct) + '%</b>' +
      (opts.dim ? '<span class="px6-dim">' + opts.dim + '</span>' : '') +
      '</div>';
  }

  function histBar(bot) {
    var tot = bot.segs.reduce(function (s, x) { return s + x.total; }, 0);
    if (!tot) return '<div class="px6-hist-empty">NO AGENT COMPLETION RECORDS · RATE DEFAULTED 100%</div>';
    var html = '<div class="px6-hist">';
    for (var i = 0; i < bot.segs.length; i++) {
      var s = bot.segs[i];
      var grow = s.total > 0 ? s.total : 0.15; // 空段保留可见细缝
      var fillW = s.total > 0 ? 100 : 0;
      var title = s.key + ': ' + s.normal + ' normal / ' + s.bad + ' failed-or-timeout' +
                  (s.unknown ? ' / ' + s.unknown + ' unknown' : '');
      html += '<div class="px6-hseg" style="flex-grow:' + grow + '" title="' + esc(title) + '">' +
              '<span class="px6-hl">' + esc(s.key) + '</span>' +
              '<div class="px6-hbar">' +
                '<span style="width:' + fillW + '%;background:' + rateColor(s.rate) +
                  (s.total === 0 ? ';opacity:.3' : '') + '"></span>' +
              '</div>' +
              '<span class="px6-hc">' + s.normal + 'N / ' + s.bad + 'B</span>' +
              '</div>';
    }
    return html + '</div>';
  }

  /* -------------------------------------------------------------- 状态行 */

  function renderStatus() {
    var st = STATE && STATE.data;
    var el = document.getElementById('px6-status');
    if (!el) return;
    var now = new Date();
    var clk = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    var nH = st ? st.hosts.length : 0;
    var nB = st ? st.bots.length : 0;
    var up = st ? st.hosts.filter(function (h) { return !h.down; }).length : 0;
    var stale = LIVE.stale;
    el.innerHTML =
      '<span class="px6-sword">FLEET</span>' +
      '<span class="px6-clock">' + clk + '</span>' +
      '<span><b>' + nH + '</b> HOSTS</span>' +
      '<span><b>' + nB + '</b> BOTS</span>' +
      '<span><b>' + up + '/' + nH + '</b> UP</span>' +
      '<span class="px6-live' + (stale ? ' stale' : '') + '">● ' + (stale ? 'STALE' : 'LIVE') + '</span>';
  }

  /* ------------------------------------------------------------ 主页渲染 */

  function renderHome() {
    var d = STATE.data;
    var upH = d.hosts.filter(function (h) { return !h.down; }).length;
    var hostShorts = d.hosts.map(function (h) { return h.short; }).join(' / ');
    var maxBot = d.bots.reduce(function (m, b) { return Math.max(m, b.total); }, 0);

    var html = '';

    // ---- HOSTS ----
    html += '<section class="px6-sec"><header class="px6-hd">' +
            '<span class="px6-t">HOSTS</span>' +
            '<span class="px6-sub">' + esc(hostShorts) + '</span>' +
            '<span class="px6-r"><b>' + upH + '/' + d.hosts.length + '</b> UP</span>' +
            '</header><div class="px6-hosts">';
    d.hosts.forEach(function (h) {
      var upB = h.bots.length;
      html += '<div class="px6-host' + (h.down ? ' down' : '') + '">' +
              '<div class="px6-hshort">' + esc(h.short) + '</div>' +
              '<div class="px6-hmeta"><span><b>' + h.bots.length + '</b> BOTS</span>' +
              '<span>' + esc(String(h.hostId).slice(0, 8) || 'ID?') + '</span></div>' +
              '<div class="px6-track"><span class="px6-fill" style="width:' +
                (h.down ? 0 : 100) + '%;background:' + (h.down ? 'var(--px6-red)' : 'var(--px6-green)') +
                '"></span></div>' +
              '<div class="px6-hflag">' +
                (h.down ? '✖ ' + esc(String(h.error).slice(0, 28)) : '● LINK OK') +
              '</div></div>';
    });
    html += '</div></section>';

    // ---- BOTS 像素图标矩阵 ----
    html += '<section class="px6-sec"><header class="px6-hd">' +
            '<span class="px6-t">BOTS</span>' +
            '<span class="px6-sub">PIXEL MATRIX · CLICK TO DRILL</span>' +
            '<span class="px6-r"><b>' + d.bots.length + '</b> ONLINE</span>' +
            '</header><div class="px6-grid">';
    d.bots.forEach(function (b) {
      var flag = b.sev >= 2 ? 'w2' : b.sev >= 1 ? 'w1' : '';
      html += '<button type="button" class="px6-cell" data-i="' + b.__i +
              '" title="' + esc(b.name) + ' · host ' + esc(b.host) + ' · success ' + b.rate +
              '% · ' + b.nModels + ' models — click for usage drilldown">' +
              iconSvg(b) +
              '<span class="px6-cinfo">' +
                '<span class="px6-cname">' + esc(b.name) + '</span>' +
                '<span class="px6-cmeta"><b>' + b.host + '</b> · ' + b.nModels +
                  ' mdl · ' + fmtN(b.total) + '</span>' +
                '<span class="px6-crate" style="color:' + rateColor(b.rate) + '">' + b.rate +
                  '% OK · ' + fmtN(b.calls) + ' CALLS</span>' +
              '</span>' +
              '<span class="px6-csev ' + flag + '">' + (b.sev >= 1 ? 'SEV' + b.sev : 'OK') + '</span>' +
              '<span class="px6-ctag">DRILL ▸</span>' +
              '</button>';
    });
    html += '</div></section>';

    // ---- USAGE 总览 ----
    html += '<section class="px6-sec"><header class="px6-hd">' +
            '<span class="px6-t">USAGE</span>' +
            '<span class="px6-sub">TOTAL TOKENS PER BOT · LEN ∝ USAGE · COLOR ∝ SUCCESS</span>' +
            '<span class="px6-r">PEAK <b>' + fmtN(maxBot) + '</b></span>' +
            '</header><div class="px6-overview">';
    d.bots.slice().sort(function (x, y) { return y.total - x.total; }).forEach(function (b) {
      html += barRow({
        w: maxBot ? b.total / maxBot * 100 : 0,
        rate: b.rate,
        pct: b.rate,
        name: b.name,
        nameHtml: '<b>' + esc(b.name) + '</b> <i>' + esc(b.host) + '</i>',
        dim: fmtN(b.total) + ' <b>' + fmtN(b.calls) + 'c</b>'
      });
    });
    html += '</div></section>';

    html += '<div class="px6-foot">' +
            '<span>SOURCE /api/status · SNAPSHOT ' + esc(String(d.snap.generated_at || '')) + '</span>' +
            '<span>' + fmtN(d.bots.reduce(function (s, b) { return s + b.total; }, 0)) + ' TOK TOTAL</span>' +
            '</div>';

    STATE.view = 'home';
    var v = document.getElementById('px6-view');
    v.innerHTML = html;
  }

  /* ---------------------------------------------------------- drilldown */

  function renderDrill(i) {
    var b = STATE.data.bots[i];
    if (!b) return;
    STATE.view = 'drill';
    STATE.idx = i;
    var max = b.provList.reduce(function (m, p) {
      return Math.max(m, p.models.reduce(function (mm, x) { return Math.max(mm, x.amt); }, 0));
    }, 0);

    var html = '<div class="px6-back">' +
      '<button type="button" class="px6-backbtn" data-back="1" title="back to fleet">&lt; BACK</button>' +
      '<div class="px6-dhead">' + iconSvg(b) +
        '<span><span class="px6-dname">' + esc(b.name) + '</span>' +
        '<span class="px6-dhost">HOST ' + esc(b.host) + ' · BOT ID ' + esc(b.id) + '</span></span>' +
      '</div></div>';

    // 统计小卡
    html += '<section class="px6-sec"><header class="px6-hd">' +
            '<span class="px6-t">SUMMARY</span>' +
            '<span class="px6-sub">THIS BOT</span>' +
            '<span class="px6-r" style="color:' + rateColor(b.rate) + '">' + b.rate + '% SUCCESS</span>' +
            '</header><div class="px6-stats">' +
            stat('TOTAL TOKENS', fmtN(b.total), b.nModels + ' MODELS · ' + b.nProviders + ' PROVIDERS') +
            stat('CALLS', fmtN(b.calls), 'UNIQUE MODEL ROWS ' + b.nModels) +
            stat('AGENTS OK', fmtN(b.nNormal), 'FAILURE/TO ' + fmtN(b.nBad)) +
            stat('SUCCESS RATE', b.rate + '%', 'NORMAL /(NORMAL+BAD)') +
            '</div></section>';

    // provider -> model 分组
    html += '<section class="px6-sec"><header class="px6-hd">' +
            '<span class="px6-t">USAGE</span>' +
            '<span class="px6-sub">PROVIDER → MODEL · LEN ∝ USAGE / BOT MAX · COLOR ∝ SUCCESS ' + b.rate + '%</span>' +
            '<span class="px6-r"><b>' + b.nProviders + '</b> GROUPS</span>' +
            '</header>';
    if (!b.provList.length) {
      html += '<div class="px6-empty">NO USAGE TOTALS REPORTED FOR THIS BOT</div>';
    } else {
      b.provList.forEach(function (p) {
        html += '<div class="px6-pgroup"><div class="px6-pghead">' +
                '<span class="px6-pgname">' + esc(p.provider) + '</span>' +
                '<span class="px6-pgmeta"><b>' + p.n + '</b> MODELS · <b>' + fmtN(p.total) +
                  '</b> TOK · <b>' + fmtN(p.calls) + '</b> CALLS</span>' +
                '</div><div class="px6-pgrows">';
        p.models.forEach(function (m) {
          html += barRow({
            w: max ? m.amt / max * 100 : 0,
            rate: b.rate,
            pct: b.rate,
            name: p.provider + '/' + m.model,
            nameHtml: '<i>' + esc(p.provider) + '/</i>' + esc(m.model),
            dim: fmtN(m.amt) + ' <b>' + fmtN(m.calls) + 'c</b>'
          });
        });
        html += '</div></div>';
      });
    }
    html += '<div class="px6-note">条长 = 该 model 的 input+output+cache 总量，相对本 bot 内最大值归一（最粗=100%）。' +
            '条色 = 本 bot 成功率 ' + b.rate + '% 经 hue 插值（0%红 / 35%橙 / 70%黄 / 100%绿）。' +
            '条尾百分比 = 成功率。</div></section>';

    // 历史 usage 三段条
    html += '<section class="px6-sec"><header class="px6-hd">' +
            '<span class="px6-t">HISTORY</span>' +
            '<span class="px6-sub">AGENTS COMPLETED · SEG WIDTH ∝ COUNT · SEG COLOR ∝ SEG RATE</span>' +
            '<span class="px6-r"><b>' + fmtN(b.nNormal) + '</b> N / <b>' + fmtN(b.nBad) + '</b> B</span>' +
            '</header>' + histBar(b) +
            '<div class="px6-note">N = normal, B = failed+timeout。三段: 近 4h / 4–24h / 24h–7d。' +
            '段色取该段时间窗自身的成功率，映射同上方。</div></section>';

    html += '<div class="px6-foot">' +
            '<span><b>&lt; BACK</b> TO MATRIX</span>' +
            '<span>BOT ID ' + esc(b.id) + ' · SNAPSHOT ' +
              esc(String(STATE.data.snap.generated_at || '')) + '</span></div>';

    document.getElementById('px6-view').innerHTML = html;
  }

  function stat(label, value, sub) {
    return '<div class="px6-stat"><span class="px6-sl">' + label + '</span>' +
           '<span class="px6-sv">' + value + '</span>' +
           '<span class="px6-sx">' + esc(sub) + '</span></div>';
  }

  /* --------------------------------------------------------- 8-bit 转场 */

  function flash() {
    var b = document.body;
    b.classList.remove('px6-flash');
    void b.offsetWidth; // 强制回流，重放 animation
    b.classList.add('px6-flash');
    setTimeout(function () { b.classList.remove('px6-flash'); }, 220);
  }

  /* --------------------------------------------------------------- 状态 */

  var LIVE = { stale: false };
  var STATE = { data: null, view: 'home', idx: -1 };

  function apply(snap) {
    STATE.data = build(snap);
    STATE.data.bots.forEach(function (b, i) { b.__i = i; });
    var gen = Date.parse(snap.generated_at);
    var staleAfter = (snap.stale_after_s || 45) * 1000;
    LIVE.stale = !!(isNaN(gen) || (Date.now() - gen) > staleAfter);
    renderStatus();
    renderHome();
  }

  /* --------------------------------------------------------------- 事件 */

  function wire() {
    var view = document.getElementById('px6-view');
    view.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var back = t.closest('[data-back]');
      if (back) { flash(); renderHome(); window.scrollTo(0, 0); return; }
      var cell = t.closest('.px6-cell');
      if (cell) {
        var i = parseInt(cell.getAttribute('data-i'), 10);
        if (!isNaN(i)) { flash(); renderDrill(i); window.scrollTo(0, 0); }
      }
    });
    document.addEventListener('keydown', function (e) {
      if (STATE.view === 'drill' && (e.key === 'Escape' || e.key === 'Backspace')) {
        flash(); renderHome();
      }
    });
    setInterval(renderStatus, 1000);
  }

  /* --------------------------------------------------------------- 启动 */

  function boot() {
    var root = document.getElementById('main');
    if (!root) return;
    root.innerHTML = '<div id="px6"><div class="px6-status" id="px6-status"></div>' +
                     '<div id="px6-view"><div class="px6-empty">LOADING FLEET…</div></div></div>';
    renderStatus();
    wire();
    var url = '/api/status';
    Promise.resolve(fetch(url, { cache: 'no-store' }))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(apply)
      .catch(function (err) {
        document.getElementById('px6-view').innerHTML =
          '<div class="px6-empty">FETCH FAILED · ' + esc(err && err.message) + '</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
