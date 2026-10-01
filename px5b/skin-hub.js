/* PX5-HUB renderer — btop 式行 + drill-down 分屏（用 api_status.json 真实数据） */
(function () {
  'use strict';
  const R = (n) => Math.round(n);
  const pct = (a, b) => (b > 0 ? Math.min(100, (a / b) * 100) : 0);
  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  function seg(p, cls) {
    // 分段块：每 5% 一格，格间 2px 暗缝 — btop 的 blocky 观感
    const full = Math.round(p / 5);
    let html = '';
    for (let i = 0; i < full; i++) html += '<span class="seg ' + cls + '" style="flex:1"></span>';
    if (full > 0 && full < 20) html += '<span class="seg gap"></span>';
    html += '<span class="seg" style="flex:' + (20 - full) + '"></span>';
    return html;
  }
  function bar(p, color) { return '<div class="hub-bar">' + seg(p, color) + '</div>'; }
  function sevColor(s) { return s >= 2 ? 'r' : s === 1 ? 'y' : 'g'; }

  let DATA = null;
  let current = null; // drill-down bot id

  function rowHtml(label, sub, p, color, vals, click) {
    return '<div class="hub-row' + (click ? ' clickable' : '') + '"' + (click ? ' data-bot="' + click + '"' : '') + '>'
      + '<div class="hub-label">' + label + (sub ? ' <small>' + sub + '</small>' : '') + '</div>'
      + bar(p, color)
      + '<div class="hub-val">' + vals + '</div>'
      + '</div>';
  }

  function botTotals(bot) {
    const t = (bot.tokens && bot.tokens.totals) || [];
    let inp = 0, out = 0, cache = 0, calls = 0;
    for (const m of t) { inp += m.input || 0; out += m.output || 0; cache += m.cache_read || 0; calls += m.calls || 0; }
    return { inp, out, cache, calls, total: inp + out + cache };
  }
  function botAgents(bot) {
    const buckets = bot.agents_completed_buckets || {};
    let normal = 0, bad = 0;
    for (const k of Object.keys(buckets)) {
      const b = buckets[k] || {};
      normal += (b.normal || 0);
      bad += (b.failed || 0) + (b.timeout || 0);
    }
    const total = normal + bad;
    return { normal, bad, total, rate: total ? (normal / total) * 100 : 100 };
  }

  function overviewHtml() {
    const hosts = DATA.hosts || [];
    let botsAll = [];
    hosts.forEach(h => (h.bots || []).forEach(b => botsAll.push({ h, b })));
    const alive = botsAll.filter(x => x.b.process && x.b.process.state !== 'dead').length;

    let html = '<div class="hub-status">FLEET <span class="dim">·</span> '
      + new Date().toUTCString().slice(17, 25) + ' <span class="dim">·</span> '
      + hosts.length + ' hosts <span class="dim">·</span> '
      + botsAll.length + ' bots <span class="dim">·</span> '
      + '<span class="live">live</span></div>';

    // SECTION: HOSTS — 健康/警告/离线占比
    let g = 0, y = 0, r = 0;
    botsAll.forEach(x => {
      const s = x.b._severity || 0;
      if (s >= 2) r++; else if (s === 1) y++; else g++;
    });
    const dead = botsAll.length - g - y - r;
    html += '<div class="hub-section hub-overview"><div class="hub-sec-head"><span class="hub-sec-title">HOSTS</span>'
      + '<span class="hub-sec-note">' + hosts.map(h => h.short || h.host_id).join(' / ') + '</span>'
      + '<span class="hub-sec-val">' + alive + '/' + botsAll.length + ' up</span></div>';
    html += rowHtml('health', botsAll.length + ' bots', botsAll.length ? ((g + y) / botsAll.length) * 100 : 0, 'g',
      '<b>' + g + '</b> ok · ' + y + ' warn · ' + r + ' crit');
    html += '</div>';

    // SECTION: BOTS — 每行一个 bot（点击 drill-down），条 = 完成率，颜色 = severity
    html += '<div class="hub-section hub-overview"><div class="hub-sec-head"><span class="hub-sec-title">BOTS</span>'
      + '<span class="hub-sec-note">click for detail</span>'
      + '<span class="hub-sec-val">agents ok%</span></div>';
    botsAll.forEach(x => {
      const b = x.b;
      const ag = botAgents(b);
      const sev = sevColor(b._severity || 0);
      html += rowHtml(
        (b.display_name || b.id || 'bot'),
        (x.h.short || ''),
        ag.rate,
        sev,
        '<b>' + R(ag.rate) + '%</b> ' + ag.normal + '/' + ag.total,
        b.id
      );
    });
    html += '</div>';

    // SECTION: USAGE — 每 bot token 总量条（相对最大值）
    html += '<div class="hub-section hub-overview"><div class="hub-sec-head"><span class="hub-sec-title">USAGE</span>'
      + '<span class="hub-sec-note">tokens total</span>'
      + '<span class="hub-sec-val">max=' + fmt(Math.max.apply(null, botsAll.map(x => botTotals(x.b).total).concat([1]))) + '</span></div>';
    const maxT = Math.max.apply(null, botsAll.map(x => botTotals(x.b).total).concat([1]));
    botsAll.forEach(x => {
      const t = botTotals(x.b);
      const p = (t.total / maxT) * 100;
      const inShare = t.total ? (t.inp / t.total) * 100 : 0;
      html += '<div class="hub-row' + '" data-bot="' + x.b.id + '" style="cursor:pointer">'
        + '<div class="hub-label">' + (x.b.display_name || x.b.id) + ' <small>' + (x.h.short || '') + '</small></div>'
        + '<div class="hub-bar">'
        + '<span class="seg c" style="flex:' + R(inShare / 5) + '"></span>'
        + '<span class="seg g" style="flex:' + R((100 - inShare) / 5) + '"></span>'
        + '<span class="seg" style="flex:' + (100 - R(inShare / 5) - R((100 - inShare) / 5)) + '"></span>'
        + '</div>'
        + '<div class="hub-val"><b>' + fmt(t.total) + '</b> · in' + R(inShare) + '% · ' + t.calls + ' calls</div>'
        + '</div>';
    });
    html += '</div>';

    html += '<div class="hub-status dim" style="font-size:11px">ctrl-c to exit · snapshot data</div>';
    return html;
  }

  function detailHtml(hostShort, bot) {
    const t = botTotals(bot);
    const ag = botAgents(bot);
    const proc = bot.process || {};
    const work = bot.work || {};
    const act = bot.activity || {};
    const logs = bot.log_errors || {};
    const models = bot.models || [];
    const uni = bot.agents_unified_summary || {};

    let html = '<div class="hub-back" id="hub-back">&lt; BACK</div>';
    html += '<div class="hub-detail-title">' + (bot.display_name || bot.id) + ' <span style="color:var(--hub-dim);font-size:12px">@ ' + (hostShort || '') + '</span></div>';
    html += '<div class="hub-detail-sub">' + (bot.id || '') + '</div>';

    // 顶部：进程/工作两栏条
    const procP = proc.state === 'S' || proc.state === 'R' ? 100 : 0;
    html += '<div class="hub-section"><div class="hub-sec-head"><span class="hub-sec-title">PROCESS</span>'
      + '<span class="hub-sec-note">pid ' + (proc.pid || '?') + '</span>'
      + '<span class="hub-sec-val">' + (proc.state_label || proc.state || '?') + '</span></div>';
    html += rowHtml('gateway', proc.start_at ? String(proc.start_at).slice(0, 10) : '', procP, procP ? 'g' : 'r', proc.start_at || '');
    html += rowHtml('work', work.progress_age_s != null ? Math.round(work.progress_age_s / 60) + 'm ago' : '', work.state && /工作|busy/i.test(work.state) ? 100 : 0, 'c', work.state || '');
    html += rowHtml('session', '', 0, 'y', (act.text || '—').slice(0, 42));
    html += '</div>';

    // AGENTS: 完成率 + unified
    html += '<div class="hub-section"><div class="hub-sec-head"><span class="hub-sec-title">AGENTS</span>'
      + '<span class="hub-sec-note">' + ag.total + ' recorded</span>'
      + '<span class="hub-sec-val">' + R(ag.rate) + '% ok</span></div>';
    html += rowHtml('completed', 'normal/bad', ag.total ? (ag.normal / ag.total) * 100 : 100, ag.bad ? 'y' : 'g', '<b>' + ag.normal + '</b> ok / ' + ag.bad + ' bad');
    if (uni && uni.count != null) {
      html += rowHtml('unified', 'live', uni.count ? (uni.running / uni.count) * 100 : 0, 'c',
        uni.running + ' run / ' + uni.finished + ' fin');
    }
    html += '</div>';

    // MODELS: 每 model 用量条
    html += '<div class="hub-section"><div class="hub-sec-head"><span class="hub-sec-title">MODELS</span>'
      + '<span class="hub-sec-note">' + models.length + ' provider' + (models.length > 1 ? 's' : '') + '</span>'
      + '<span class="hub-sec-val">tokens</span></div>';
    const maxM = Math.max.apply(null, models.map(m => (m.input || 0) + (m.output || 0) + (m.cache_read || 0)).concat([1]));
    models.forEach(m => {
      const tot = (m.input || 0) + (m.output || 0) + (m.cache_read || 0);
      const inShare = tot ? ((m.input || 0) / tot) * 100 : 0;
      html += '<div class="hub-row">'
        + '<div class="hub-label">' + (m.model || '?') + ' <small>' + (m.provider || '') + '</small></div>'
        + '<div class="hub-bar">'
        + '<span class="seg c" style="flex:' + R(inShare / 5) + '"></span>'
        + '<span class="seg g" style="flex:' + R((100 - inShare) / 5) + '"></span>'
        + '<span class="seg" style="flex:' + Math.max(0, 20 - R(inShare / 5) - R((100 - inShare) / 5)) + '"></span>'
        + '</div>'
        + '<div class="hub-val"><b>' + fmt(tot) + '</b> · ' + (m.calls || 0) + ' calls</div>'
        + '</div>';
    });
    html += '</div>';

    // LOGS
    html += '<div class="hub-section"><div class="hub-sec-head"><span class="hub-sec-title">LOGS</span>'
      + '<span class="hub-sec-note">24h</span>'
      + '<span class="hub-sec-val">' + (logs.count_24h || 0) + ' entries</span></div>';
    const errRate = logs.count_24h ? Math.min(100, (logs.count_24h / 200) * 100) : 0;
    html += rowHtml('pressure', 'vs 200 cap', errRate, errRate > 60 ? 'r' : errRate > 25 ? 'y' : 'g', logs.count_24h || 0);
    (logs.recent || []).slice(0, 3).forEach(l => {
      html += '<div class="hub-kv"><div class="k">' + new Date((l.ts || 0) * 1000).toISOString().slice(11, 19) + '</div><div class="v" style="color:var(--hub-dim)">' + String(l.msg || '').slice(0, 90) + '</div></div>';
    });
    html += '</div>';

    return html;
  }

  function mount() {
    if (!document.getElementById('hub-root')) {
      const root = document.createElement('div');
      root.id = 'hub-root';
      document.querySelector('main#main').parentNode.insertBefore(root, document.querySelector('main#main'));
    }
  }

  function render() {
    mount();
    const root = document.getElementById('hub-root');
    document.body.classList.toggle('hub-drill', !!current);
    if (current) {
      const hosts = DATA.hosts || [];
      for (const h of hosts) {
        for (const b of (h.bots || [])) {
          if (b.id === current) { root.innerHTML = detailHtml(h.short || h.host_id, b); bind(); return; }
        }
      }
      current = null;
    }
    root.innerHTML = overviewHtml();
    bind();
  }

  function bind() {
    document.querySelectorAll('.hub-row[data-bot]').forEach(el => {
      el.addEventListener('click', () => { current = el.getAttribute('data-bot'); render(); window.scrollTo(0, 0); });
    });
    const back = document.getElementById('hub-back');
    if (back) back.addEventListener('click', () => { current = null; render(); window.scrollTo(0, 0); });
  }

  async function boot() {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      DATA = await res.json();
    } catch (e) { DATA = { hosts: [] }; }
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
