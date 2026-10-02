/* ============================================================
   PX6 · variant D「灰白」(px6-mono) · dashboard
   lane D · fleet-skins/wd_px6d

   独立渲染层：读 /api/status 快照，全部 DOM 建在 #px6 里。
   app.js 仍在 #main 渲染，但被 CSS 隐藏（容器保留以免 app.js 报错）。
   ============================================================ */
(function () {
'use strict';

var REFRESH_MS = 5000;
var state = { snap: null, bots: [], sel: null, t0: Date.now() };
var root = null;

/* ── 工具 ─────────────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function hhmmss(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function ago(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + (s % 60 ? (s % 60) + 's' : '');
  return Math.floor(m / 60) + 'h' + (m % 60 ? (m % 60) + 'm' : '');
}
function fmtNum(n) { return (Math.round(n || 0)).toLocaleString('en-US'); }
function fmtTok(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return '' + Math.round(n);
}
function pctTxt(p) { return (Math.round(p * 10) / 10).toFixed(1) + '%'; }

/* ── 成功率色阶 ─────────────────────────────────────────────
   0% 红 #ef4444 → 25% 橙 #f59e0b → 50% 黄 #eab308 → 100% 绿 #2ecc71。
   段内线性插值，再向自身灰度去饱和到 38%（mono 变体的唯一色彩轴）。 */
var SAT = 0.38;
var RAMP = [[0, 239, 68, 68], [0.25, 245, 158, 11], [0.5, 234, 179, 8], [1, 46, 204, 113]];
function rateColor(pct) {
  var t = Math.max(0, Math.min(1, (pct || 0) / 100));
  var a = RAMP[0], b = RAMP[RAMP.length - 1];
  for (var i = 0; i < RAMP.length - 1; i++) {
    if (t >= RAMP[i][0] && t <= RAMP[i + 1][0]) { a = RAMP[i]; b = RAMP[i + 1]; break; }
  }
  var span = (b[0] - a[0]) || 1;
  var f = (t - a[0]) / span;
  var rgb = [1, 2, 3].map(function (k) { return Math.round(a[k] + (b[k] - a[k]) * f); });
  var lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return 'rgb(' + rgb.map(function (v) { return Math.round(v * (1 - SAT) + lum * SAT); }).join(',') + ')';
}

/* ── 数据规整 ─────────────────────────────────────────────── */
function totalsOf(b) {
  var t = b.tokens || b.usage || null;
  if (t && Array.isArray(t.totals)) return t.totals;
  if (Array.isArray(b.usage)) return b.usage;
  return [];
}
function tokenTotal(rows) {
  var t = 0;
  rows.forEach(function (r) { t += (r.input || 0) + (r.output || 0) + (r.cache_read || 0) + (r.cache_write || 0); });
  return t;
}
function hostTokens(h) {
  var t = 0;
  (h.bots || []).forEach(function (b) { t += tokenTotal(totalsOf(b)); });
  return t;
}
function normBot(b, host, i) {
  var rows = totalsOf(b).map(function (r) {
    var total = (r.input || 0) + (r.output || 0) + (r.cache_read || 0) + (r.cache_write || 0);
    return {
      provider: r.provider || 'unknown',
      model: r.model || 'unknown',
      input: r.input | 0,
      output: r.output | 0,
      cache: (r.cache_read | 0) + (r.cache_write | 0),
      calls: r.calls | 0,
      total: total
    };
  });

  var bk = b.agents_completed_buckets || {};
  var segs = [];
  [['4h', '4h'], ['4\u201324h', '4\u201324h'], ['24h\u20137d', '24h\u20137d']].forEach(function (pair) {
    var raw = bk[pair[0]] || {};
    var n = raw.normal || 0, bad = (raw.failed || 0) + (raw.timeout || 0), unk = raw.unknown || 0;
    segs.push({
      label: pair[1], normal: n, bad: bad, unknown: unk,
      events: n + bad, rate: (n + bad) ? n / (n + bad) * 100 : null
    });
  });
  var agg = segs.reduce(function (a, s) {
    a.normal += s.normal; a.bad += s.bad; a.unknown += s.unknown; return a;
  }, { normal: 0, bad: 0, unknown: 0 });
  agg.rate = (agg.normal + agg.bad) ? agg.normal / (agg.normal + agg.bad) * 100 : 100;

  rows.sort(function (x, y) { return y.total - x.total; });
  return {
    idx: i, name: b.display_name || b.id || 'bot', id: b.id || '',
    host: host, sev: b._severity | 0,
    rows: rows, segs: segs, agg: agg, rate: agg.rate,
    total: 0, calls: 0,
    icon: ICONS[i % ICONS.length]
  };
}

/* ── 像素图标：12×12 网格，box-shadow 像素画 ───────────────── */
/* '#' = 前景像素，'.' = 透明；同一色，靠图案区分 9 只。 */
var ICONS = [
  { k: 'square', n: '方块脸', p: [
    '............',
    '............',
    '..########..',
    '.##########.',
    '.##########.',
    '.##11##11##.',
    '.##11##11##.',
    '.##########.',
    '.##########.',
    '.##111111##.',
    '.##########.',
    '..########..'
  ]},
  { k: 'visor', n: '护目镜', p: [
    '............',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.1111111111.',
    '.##########.',
    '.##########.',
    '.##########.',
    '..#11111#..',
    '.##########.',
    '.##########.'
  ]},
  { k: 'round', n: '圆头', p: [
    '............',
    '...######...',
    '..########..',
    '.##########.',
    '.##########.',
    '.#11####11#.',
    '.#11####11#.',
    '.#11####11#.',
    '.##########.',
    '..##1111##..',
    '..########..',
    '...######...'
  ]},
  { k: 'ears', n: '尖耳', p: [
    '............',
    '.1.......1..',
    '.11.....11..',
    '.111...111..',
    '.1111.1111..',
    '.1111111111.',
    '.1111111111.',
    '..111111111.',
    '..#11111#..',
    '..111111111.',
    '..111111111.',
    '...1111111..'
  ]},
  { k: 'antenna', n: '单眼天线', p: [
    '......1.....',
    '......1.....',
    '.....111....',
    '.##########.',
    '.1111111111.',
    '.1111111111.',
    '.111####111.',
    '.111####111.',
    '.1111111111.',
    '.1111111111.',
    '..#11111#..',
    '.##########.'
  ]},
  { k: 'visor2', n: '横条眼', p: [
    '............',
    '............',
    '.##########.',
    '.##########.',
    '.1111111111.',
    '.1111111111.',
    '.##########.',
    '.##########.',
    '...#1111#...',
    '.##########.',
    '.##########.',
    '..########..'
  ]},
  { k: 'wide', n: '宽脸', p: [
    '............',
    '............',
    '.##########.',
    '.##########.',
    '.##11##11##.',
    '.##11##11##.',
    '.##11##11##.',
    '.##11##11##.',
    '.##########.',
    '.#11111111#.',
    '.#11111111#.',
    '.##########.'
  ]},
  { k: 'round2', n: '圆护目', p: [
    '............',
    '....####....',
    '...######...',
    '..########..',
    '.#11111111#.',
    '.#11111111#.',
    '.##########.',
    '.##########.',
    '..#11111#..',
    '..########..',
    '...######...',
    '....####....'
  ]},
  { k: 'antenna2', n: '天线方眼', p: [
    '..1......1..',
    '..1......1..',
    '..11....11..',
    '..11....11..',
    '.##########.',
    '.##########.',
    '.#11111111#.',
    '.#11111111#.',
    '.##########.',
    '...#1111#...',
    '.##########.',
    '..########..'
  ]}
];
var iconCache = {};
function icon(pattern, color) {
  color = color || '#f2f5f7';
  var key = pattern.join('') + '|' + color;
  if (iconCache[key]) return iconCache[key];
  var sh = [], first = true;
  for (var y = 0; y < pattern.length; y++) {
    var row = pattern[y];
    for (var x = 0; x < row.length; x++) {
      var c = row.charAt(x);
      if (c !== '.' && c !== ' ' && c !== '\n') {
        sh.push(first ? '0 0 ' + color : (x + 'px ' + y + 'px ' + color));
        first = false;
      }
    }
  }
  var out = '<i style="box-shadow:' + sh.join(',') + ';background:' + color + '"></i>';
  iconCache[key] = out;
  return out;
}

/* ── 条形 ─────────────────────────────────────────────────── */
/* bar(长度%, 颜色, {thin,num}, 尾部文字?)
   尾部文字缺省 = pctTxt(长度%)；drilldown 行传"占本 bot 总量比"以区别于长度。 */
function bar(pct, color, opts, pctLabel) {
  opts = opts || {};
  var w = Math.max(0, Math.min(100, pct || 0));
  return '<div class="px6-bar' + (opts.thin ? ' thin' : '') + '">' +
    '<div class="track"><div class="fill" style="width:' + w.toFixed(2) +
      '%;--c:' + color + '"></div></div>' +
    '<b class="pct">' + esc(pctLabel || pctTxt(pct)) + '</b>' +
    (opts.num ? '<span class="nums">' + esc(opts.num) + '</span>' : '') +
    '</div>';
}

/* ── 段一：顶部状态行 ─────────────────────────────────────── */
function secTop() {
  var s = state.snap;
  var hosts = s ? (s.hosts || []) : [];
  var bots = state.bots;
  var live = !!s;
  var stamp = hhmmss(live && s.generated_at ? new Date(s.generated_at) : new Date());
  return '<div class="px6-top">' +
    '<span class="t-name">FLEET</span>' +
    '<span class="sep">·</span><span class="m" id="px6-clock">' + stamp + '</span>' +
    '<span class="sep">·</span><span class="m">' + hosts.length + ' hosts</span>' +
    '<span class="sep">·</span><span class="m">' + bots.length + ' bots</span>' +
    '<span class="sep">·</span><span class="t-live"><i class="dot"></i><span>' +
      (live ? 'live' : 'waiting') + '</span></span>' +
    '</div>';
}

/* ── 段二：HOSTS ──────────────────────────────────────────── */
function secHosts() {
  var hosts = state.snap ? (state.snap.hosts || []) : [];
  var maxTok = hosts.reduce(function (a, h) { return Math.max(a, hostTokens(h)); }, 1);
  var bodies = hosts.map(function (h) {
    var bs = h.bots || [];
    var tot = hostTokens(h);
    return '<div class="px6-hrow">' +
      '<span class="hn">' + esc(h.short || h.name || '?') + '</span>' +
      '<div class="hb">' + bar(tot / maxTok * 100, 'rgb(154,164,171)', { num: bs.length + ' bots' }) + '</div>' +
      '<span class="hm">' + esc(fmtTok(tot)) + ' tk</span>' +
      '</div>';
  }).join('');
  return '<section class="px6-sec">' +
    '<div class="px6-head"><span class="ht">HOSTS</span>' +
    '<span class="hv">' + esc(hosts.map(function (h) { return h.short || '?'; }).join(' / ')) + '</span>' +
    '<span class="hr">' + hosts.length + '/' + hosts.length + ' up</span></div>' +
    '<div class="px6-hrows">' + (bodies || '<div class="px6-empty">无主机</div>') + '</div>' +
    '</section>';
}

/* ── 段三：BOTS 像素图标矩阵 ──────────────────────────────── */
function secBots() {
  var cells = state.bots.map(function (b) {
    return '<button type="button" class="px6-cell' + (state.sel === b ? ' on' : '') +
      '" data-i="' + b.idx + '" title="' +
      esc(b.name + ' — 点击 drilldown 到 usage 详情') + '">' +
      '<span class="px6-pixel">' + icon(b.icon.p, '#f2f5f7') + '</span>' +
      '<span class="px6-cn">' + esc(b.name) + '</span>' +
      '<span class="px6-cm">' + esc(b.icon.n) + ' · ' + esc(fmtTok(b.total)) + ' tk' +
        (b.rows.length ? ' · ' + b.rows.length + 'm' : '') +
        ' · <span class="' + (b.rate >= 99.95 ? 'ok' : '') + '">' + pctTxt(b.rate) + '</span>' +
      '</span>' +
      '</button>';
  }).join('');
  return '<section class="px6-sec" id="px6-sec-bots">' +
    '<div class="px6-head"><span class="ht">BOTS</span>' +
    '<span class="hv">' + state.bots.length + ' 个像素体 · 点击任一只下钻 usage</span>' +
    '<span class="hr">' + state.bots.length + '/9</span></div>' +
    '<div class="px6-icons">' + cells + '</div>' +
    '</section>';
}

/* ── 段四：USAGE 总览 ─────────────────────────────────────── */
function secUsage() {
  var max = Math.max.apply(null, state.bots.map(function (b) { return b.total; }).concat([1]));
  var rows = state.bots.map(function (b) {
    return '<div class="px6-urow">' +
      '<span class="un">' + esc(b.name) + '</span>' +
      '<div class="ub">' + bar(b.total / max * 100, rateColor(b.rate), {
        thin: true, num: fmtTok(b.total) + ' tk · ' + fmtNum(b.calls) + ' calls'
      }) + '</div>' +
      '</div>';
  }).join('');
  return '<section class="px6-sec">' +
    '<div class="px6-head"><span class="ht">USAGE</span>' +
    '<span class="hv">各 bot 总 token · 条长=相对最大用量 · 条色=成功率</span>' +
    '<span class="hr">' + state.bots.length + ' bots</span></div>' +
    '<div class="px6-urows">' + rows + '</div>' +
    '</section>';
}

/* ── drilldown：USAGE 专项 ─────────────────────────────────── */
function viewDetail(b) {
  var max = Math.max.apply(null, b.rows.map(function (r) { return r.total; }).concat([1]));
  var byP = {};
  b.rows.forEach(function (r) {
    var g = byP[r.provider] || (byP[r.provider] = { provider: r.provider, rows: [], total: 0, calls: 0 });
    g.rows.push(r); g.total += r.total; g.calls += r.calls;
  });
  var provs = Object.keys(byP).map(function (k) { return byP[k]; })
    .sort(function (x, y) { return y.total - x.total; });

  var groups = provs.map(function (g) {
    var head = '<div class="px6-pg">' +
      '<div class="px6-pg-h" style="border-left-color:' + rateColor(b.rate) + '">' +
      '<b>' + esc(g.provider) + '</b>' +
      '<span class="dim">' + g.rows.length + ' model</span>' +
      '<span class="pt">' + fmtTok(g.total) + ' tk · ' + fmtNum(g.calls) + ' calls</span>' +
      '</div>';
    var show = g.rows.slice(0, 12);
    var more = g.rows.length - show.length;
    var body = show.map(function (r) {
      return '<div class="px6-mrow">' +
        '<span class="ml" title="' + esc(g.provider + '/' + r.model) + '">' + esc(r.model) + '</span>' +
        '<div class="mb">' + bar(r.total / max * 100, rateColor(b.rate), {
          thin: true, num: fmtTok(r.total) + ' tk · ' + fmtNum(r.calls) + ' calls'
        }, (b.total ? r.total / b.total * 100 : 0).toFixed(1) + '%') + '</div>' +
        '</div>';
    }).join('');
    if (more > 0) body += '<div class="px6-empty">… 另有 ' + more + ' 个 model 用量更低，未显示</div>';
    return head + body + '</div>';
  }).join('');

  var totalEvents = b.segs.reduce(function (a, s) { return a + s.events; }, 0);
  var segs = b.segs.map(function (s) {
    var w = totalEvents ? s.events / totalEvents * 100 : 100 / 3;
    var c = rateColor(s.rate == null ? 100 : s.rate);
    return '<div class="seg' + (s.events ? '' : ' zero') + '" style="flex:0 0 ' + w.toFixed(2) +
      '%;min-width:9%;background:' + c + '" title="' +
      esc(s.label + '：' + s.normal + ' normal / ' + s.bad + ' bad' +
        (s.rate == null ? '（无记录 → 按 100%）' : ' → ' + pctTxt(s.rate))) + '"></div>';
  }).join('');
  var histRows = b.segs.map(function (s) {
    var c = rateColor(s.rate == null ? 100 : s.rate);
    return '<div class="hrw">' +
      '<span class="sw" style="background:' + c + '"></span>' +
      '<span class="lb">' + esc(s.label) + '</span>' +
      '<span class="rv"><b>' + s.normal + '</b> normal / <b>' + s.bad + '</b> bad' +
        (s.unknown ? ' / ' + s.unknown + ' unknown' : '') +
        ' · ' + (s.rate == null ? '<span class="dim">无记录 → 按 100%</span>' : pctTxt(s.rate)) + '</span>' +
      '</div>';
  }).join('');

  return '<section class="px6-sec px6-detail">' +
    '<button type="button" class="px6-back" id="px6-back"><span>&lt; BACK</span></button>' +
    '<div class="px6-dtop">' +
      '<span class="dpix px6-pixel">' + icon(b.icon.p, '#f2f5f7') + '</span>' +
      '<span class="dn">' + esc(b.name) + '</span>' +
      '<span class="dsub"><b>' + esc(b.host && b.host.short || '?') + '</b> · ' +
        esc(b.icon.n) + ' · sev ' + b.sev + '</span>' +
      '<span class="dlive" style="color:' + rateColor(b.rate) + '"><i></i>' +
        esc(pctTxt(b.rate) + ' 成功率') + '</span>' +
    '</div>' +
    '<div class="px6-dmeta">' +
      '<span>HOST <b>' + esc(b.host && b.host.short || '?') + '</b></span>' +
      '<span>ID <b>' + esc(b.id) + '</b></span>' +
      '<span>AGENTS <b>' + b.agg.normal + '</b> normal / <b>' + b.agg.bad + '</b> bad' +
        (b.agg.unknown ? ' / ' + b.agg.unknown + ' unk' : '') + '</span>' +
      '<span>MODELS <b>' + b.rows.length + '</b></span>' +
      '<span>TOKENS <b>' + fmtTok(b.total) + '</b></span>' +
      '<span>CALLS <b>' + fmtNum(b.calls) + '</b></span>' +
    '</div>' +
    '<div class="px6-head" style="margin-top:16px"><span class="ht">USAGE BY MODEL</span>' +
      '<span class="hv">按 provider 分组 · 条长=本 bot 内相对最大 · 条色=成功率 · 尾数=占本 bot 总量比</span></div>' +
    (groups || '<div class="px6-empty">无 usage 记录</div>') +
    '<div class="px6-hist">' +
      '<div class="px6-hist-h"><span>HISTORY</span>' +
      '<span class="dim">4h / 4–24h / 24h–7d · 段宽=该段事件占比 · 段色=该段成功率</span>' +
      '<span class="hr">' + b.agg.normal + ' normal / ' + b.agg.bad + ' bad</span></div>' +
      '<div class="px6-hist-b">' + segs + '</div>' +
      '<div class="px6-hist-rows">' + histRows + '</div>' +
    '</div>' +
    '</section>';
}

/* ── 组合 ─────────────────────────────────────────────────── */
function overview() {
  return secTop() + secHosts() + secBots() + secUsage() +
    '<div class="px6-foot">' +
      '<span>' + esc((state.snap && state.snap.generated_at) || '—') + '</span>' +
      '<span>' + state.bots.length + ' bots / ' +
        (state.snap && (state.snap.hosts || []).length || 0) + ' hosts</span>' +
      '<span>sev&gt;0: ' + state.bots.filter(function (b) { return b.sev > 0; }).length + '</span>' +
      '<span>色阶 红 0% → 橙 25% → 黄 50% → 绿 100%</span>' +
    '</div>';
}
function render() {
  root.innerHTML = state.sel ? secTop() + viewDetail(state.sel) : overview();
  root.classList.toggle('on-detail', !!state.sel);
  var bk = root.querySelector('#px6-back');
  if (bk) bk.addEventListener('click', closeDetail);
}
function openDetail(i) {
  var b = state.bots[i];
  if (!b) return;
  state.sel = b;
  render();
  window.scrollTo(0, 0);
}
function closeDetail() {
  state.sel = null;
  render();
}

/* ── 数据加载 ─────────────────────────────────────────────── */
function refresh() {
  return fetch('/api/status', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (snap) {
      var acc = [];
      (snap.hosts || []).forEach(function (h) {
        (h.bots || []).forEach(function (b) {
          var n = normBot(b, h, acc.length);
          var tok = 0, cal = 0;
          n.rows.forEach(function (r) { tok += r.total; cal += r.calls; });
          n.total = tok; n.calls = cal;
          acc.push(n);
        });
      });
      state.snap = snap;
      state.bots = acc;
      state.t0 = Date.now();
      if (!state.sel || acc.indexOf(state.sel) < 0) state.sel = null;
      render();
    });
}

function boot() {
  root = document.getElementById('px6');
  if (!root) return;
  root.innerHTML = overview();
  root.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('.px6-cell');
    if (c) openDetail(parseInt(c.getAttribute('data-i'), 10));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.sel) closeDetail();
  });
  refresh().catch(function (err) {
    root.innerHTML = '<div class="px6-top"><span class="t-name">FLEET</span>' +
      '<span class="sep">·</span><span class="m">' + hhmmss(new Date()) + '</span>' +
      '<span class="sep">·</span><span class="m">无快照</span></div>' +
      '<div class="px6-empty">读取快照失败：' + esc(err && err.message || err) + '</div>';
  });
  setInterval(refresh, REFRESH_MS);
  /* 秒级时钟：快照时间戳可能停留在采集时刻，时钟单独跳动 */
  setInterval(function () {
    var el = root.querySelector('#px6-clock');
    if (el) el.textContent = hhmmss(new Date());
  }, 1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
