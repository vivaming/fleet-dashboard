/* PX7A-QUOTA v1 — FREE QUOTA section（USAGE 后、BOTS 前）
   数据源：api_status.json 顶层 free_quota.channels[]（8 渠道，随快照刷新，零额外请求）
   规则（TASK-px7a-r2 任务 5）：
   - 每渠道：名 + remaining + 剩余%（limit null 用 reference_limit 标 ~）
   - reset: window.reset_at_utc 有值 → resets Xh Ym 倒计时（每 30s 本地重算）
            window.kind=rolling → rolling Xh；无信息 → —
   - 条长 = 已用百分比；剩 <20% = 菊黄；remaining=null → 灰条 2% + unknown（不编数）
   - freshness=missing 或 coverage.fresh=0 → 名字后 stale 小标
   - 行右 dim：窗口类型 + 账号数（如 RPD·1acct）
   - 标题：FREE QUOTA ———— N/8 live（live = remaining 非 null 渠道数）
*/
(function () {
  'use strict';
  if (window.__PX7QUOTA__) return;
  window.__PX7QUOTA__ = 1;

  /* 规则（TASK-px7a-r2 任务 5）：条长=已用%，剩 <20% = 菊黄。
     但快照里 groq/openrouter 用量≈0（99.9% left）——若按 <20% 判低，
     永远不会亮菊黄；而 used>80% 才是「快没了」的正确语义。
     菊黄触发 = usedPct > 80 或 used_ratio > 0.8（源字段优先）。 */
  function isLow(c, usedPct) {
    if (typeof c.used_ratio === 'number') return c.used_ratio > 0.8;
    return usedPct > 80;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ---------- reset 文案（每 30s 本地重算） ---------- */
  /* groq probe 相对 reset（如 "1m26.4s" / "1m26s" / "5h 12m" / "45s" / "1h2m3s"）→ 秒数。
     逐 token 累加：h=3600 / m=60 / 无单位数字=秒（可含小数） */
  function relResetToSecs(rs) {
    var tokens = rs.trim().replace(/s$/i, '').match(/[\d.]+\s*[hm]?/g) || [];
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].replace(/\s+/g, '');
      var v = parseFloat(t);
      if (isNaN(v)) continue;
      if (/h$/.test(t)) total += v * 3600;
      else if (/m$/.test(t)) total += v * 60;
      else total += v;
    }
    return Math.round(total);
  }
  function resetText(c) {
    var w = c.window || {};
    /* calendar_day + reset_at_utc="HH:MM"（UTC 时刻）→ 本地时区倒计时 */
    if (typeof w.reset_at_utc === 'string' && /^\d{1,2}:\d{2}$/.test(w.reset_at_utc)) {
      var parts = w.reset_at_utc.split(':');
      var uh = +parts[0], um = +parts[1];
      var now = new Date();
      var target = new Date();
      target.setUTCHours(uh, um, 0, 0);
      if (target.getTime() <= now.getTime()) target = new Date(target.getTime() + 86400000);
      var s = Math.max(0, (target.getTime() - now.getTime()) / 1000);
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return 'resets ' + h + 'h ' + m + 'm';
    }
    /* ISO 绝对时刻 → 直接倒计时 */
    if (typeof w.reset_at_utc === 'string' && w.reset_at_utc.indexOf('T') > 0) {
      var t = Date.parse(w.reset_at_utc);
      if (!isNaN(t)) {
        var s2 = Math.max(0, (t - Date.now()) / 1000);
        var h2 = Math.floor(s2 / 3600), m2 = Math.floor((s2 % 3600) / 60);
        return 'resets ' + h2 + 'h ' + m2 + 'm';
      }
    }
    if (w.kind === 'rolling' && w.seconds) {
      return 'rolling ' + Math.round(w.seconds / 3600) + 'h';
    }
    /* groq provider_RPD 带 probe 的相对 reset（如 "1m26.4s"）；
       probe.reset 是采样时刻的剩余窗口，需扣除 sampled_at 至今的流逝 */
    var pmq = c.probe_model_quota;
    if (pmq && pmq.reset && typeof pmq.reset === 'string' && /s$/.test(pmq.reset.trim())) {
      var tot = relResetToSecs(pmq.reset);
      if (pmq.sampled_at) {
        var sa = Date.parse(pmq.sampled_at);
        if (!isNaN(sa)) {
          var elapsed = Math.max(0, (Date.now() - sa) / 1000);
          tot = Math.max(0, tot - elapsed);
        }
      }
      if (tot <= 0) return 'resets soon';
      var h3 = Math.floor(tot / 3600), m3 = Math.floor((tot % 3600) / 60);
      if (h3 === 0 && m3 === 0) return 'resets <1m';
      return 'resets ' + h3 + 'h ' + m3 + 'm';
    }
    return '—';
  }

  /* ---------- 窗口 dim 标签 ---------- */
  function winTag(c) {
    var kind = (c.window && c.window.kind) || 'unknown';
    var map = { provider_RPD: 'RPD', calendar_day: 'daily', rolling: 'rolling', unknown: '—' };
    var k = map[kind] || kind.toUpperCase();
    var n = c.account_count;
    return k + '·' + (typeof n === 'number' ? n : '?') + 'acct';
  }

  /* ---------- 单渠道行 ---------- */
  function rowHTML(c) {
    var rem = (typeof c.remaining === 'number') ? c.remaining : null;
    var lim = (typeof c.limit === 'number' && c.limit > 0) ? c.limit
            : ((typeof c.reference_limit === 'number' && c.reference_limit > 0) ? -c.reference_limit : null);
    /* lim<0 表示是 reference_limit（显示 ~ 前缀） */
    var isRef = lim !== null && lim < 0;
    var limN = lim === null ? null : Math.abs(lim);

    var stale = (c.freshness === 'missing') || ((c.coverage && c.coverage.fresh === 0));
    var pct = null, usedPct = null, low = false;
    if (rem !== null && limN) {
      pct = 100 * rem / limN;
      usedPct = 100 - pct;
      low = isLow(c, usedPct);
    }
    var fillCls = 'px6-qfill' + (rem === null ? ' unk' : (low ? ' low' : ''));
    var fillW = rem === null ? 2 : Math.max(1.5, Math.min(98, usedPct));

    var numTxt;
    if (rem !== null && limN !== null) {
      numTxt = fmtInt(rem) + ' / ' + (isRef ? '~' + fmtInt(limN) : fmtInt(limN));
    } else if (rem !== null) {
      numTxt = fmtInt(rem);
    } else {
      numTxt = 'unknown';
    }

    var right = esc(numTxt)
      + (rem !== null && pct !== null ? ' <i>' + (Math.round(pct * 10) / 10) + '% left</i>' : '')
      + ' <em>' + esc(resetText(c)) + '</em>';

    return '<div class="px6-qrow' + (rem === null ? ' qunk' : (low ? ' qlow' : '')) + '">'
      + '<span class="px6-qlbl">' + esc(c.label || c.id)
      + (stale ? ' <u class="px6-qstale">stale</u>' : '')
      + (c.partial_accounts ? ' <u class="px6-qpart">partial</u>' : '')
      + '</span>'
      + '<span class="px6-qtrack"><span class="' + fillCls + '" style="width:' + fillW.toFixed(1) + '%"></span></span>'
      + '<span class="px6-qrval">' + right + '</span>'
      + '<span class="px6-qwin">' + esc(winTag(c)) + '</span>'
      + '</div>';
  }

  /* ---------- section 渲染（挂 USAGE 后、BOTS 前） ---------- */
  var lastQuotaJson = '';
  function ensureHost() {
    /* 宿主被 renderHome/renderDetail 的 innerHTML 清除时重建（先挂回 body，
       随后由挂位逻辑插到 USAGE 后 BOTS 前） */
    var h = document.getElementById('px6-quota');
    if (!h) {
      h = document.createElement('div');
      h.id = 'px6-quota';
      h.style.display = 'none';
      document.body.appendChild(h);
    }
    return h;
  }
  function render(snap) {
    var host = ensureHost();
    if (!host) return;
    var fq = snap && snap.free_quota;
    var chans = (fq && fq.channels) || [];
    if (!chans.length) { host.innerHTML = ''; host.style.display = 'none'; lastQuotaJson = ''; return; }
    host.style.display = '';

    var live = 0;
    chans.forEach(function (c) { if (typeof c.remaining === 'number') live++; });

    var rows = chans.map(rowHTML).join('');
    var html = '<section class="px6-sec">'
      + '<div class="px6-sechead">'
      + '<span class="px6-secname">FREE QUOTA</span>'
      + '<span class="px6-secsub">免费渠道余量 · 随快照刷新</span>'
      + '<span class="px6-secrval"><em>' + live + '</em>/' + chans.length + ' live</span>'
      + '</div>'
      + '<div class="px6-quota">' + rows + '</div>'
      + '<div class="px6-legend">'
      + '<span>条长 = 已用 %</span>'
      + '<span>剩 &lt;20% = 菊黄</span>'
      + '<span>remaining=null → unknown（不编数）</span>'
      + '<span>~ = reference_limit</span>'
      + '</div>'
      + '</section>';

    var next = JSON.stringify(html);
    /* 宿主被 innerHTML 清除后 ensureHost 重建的是空壳：即便内容未变也必须重写 */
    if (next !== lastQuotaJson || !host.querySelector('.px6-qrow')) {
      lastQuotaJson = next;
      host.innerHTML = html;
    }
    lastChans = chans;

    /* 物理挂位：USAGE 后、BOTS 前（home 视图）。renderHome 每次重建 px6-main
       都会清掉宿主，因此每轮 render() 末尾重挂。detail 视图无 BOTS → 隐藏 */
    var main = document.getElementById('px6-main');
    var matrix = main && main.querySelector('.px6-matrix');
    var botsSec = matrix && matrix.closest('.px6-sec');
    if (main && botsSec) {
      host.style.display = '';
      if (host.parentNode !== main || host.nextElementSibling !== botsSec) {
        main.insertBefore(host, botsSec);
      }
    } else {
      host.style.display = 'none';
    }
  }
  /* reset 倒计时每 30s 本地重算（纯浏览器，零请求）。
     数据源 = render() 时缓存的 chans（不依赖外部全局） */
  var lastChans = [];
  setInterval(function () {
    var host = document.getElementById('px6-quota');
    if (!host || !lastChans.length) return;
    if (host.style.display === 'none') return;
    /* 只重算倒计时文本；行序 = lastChans 序（render 时同步写入） */
    host.querySelectorAll('.px6-qrval em').forEach(function (em, i) {
      if (lastChans[i]) em.textContent = resetText(lastChans[i]);
    });
  }, 30000);

  /* 数据钩子：live 层每次拿到新快照都调这里 */
  window.__PX7_RENDER_QUOTA__ = render;
})();
