/* ============================================================
   FLEET MONITOR · PX MONO skin · P5D variant
   barchart 专项：黑白极简 · 唯一红色留给危险
   数据源：/api/status → api_status.json
   ============================================================ */
(function () {
  'use strict';

  const PX_BAR = document.createElement('div');
  PX_BAR.id = 'px-bar';
  PX_BAR.dataset.rendered = '0';
  document.body.insertBefore(PX_BAR, document.getElementById('main'));

  const PX_STATUS = document.createElement('div');
  PX_STATUS.className = 'px-statusline';
  document.body.insertBefore(PX_STATUS, document.querySelector('header'));

  // ---------- 通用工具 ----------
  function fmt(n) {
    n = +n || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  function pct(n) { return Math.max(0, Math.min(100, n)) + '%'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function section(title, value, valueCls) {
    const s = document.createElement('div');
    const t = el('span', 'px-t', title);
    const d = el('span', 'px-dots', '');
    const v = el('span', 'px-v' + (valueCls ? ' ' + valueCls : ''), value);
    const w = document.createElement('div');
    w.className = 'px-sec-title';
    w.appendChild(t); w.appendChild(d); w.appendChild(v);
    s.appendChild(w);
    return s;
  }

  function legendHTML(items) {
    return '<div class="px-legend">' + items.map(i =>
      `<span><i class="${i.cls}"></i>${i.label}</span>`).join('') + '</div>';
  }

  // 单条 filled bar
  function barRow(title, sub, val, valCls, w, variant, barCls, legend) {
    const r = document.createElement('div');
    r.className = 'px-bar-row';
    const m = document.createElement('div');
    m.className = 'px-meta';
    m.appendChild(el('div', 'px-title', title));
    if (sub) m.appendChild(el('div', 'px-sub', sub));
    const right = document.createElement('div');
    right.className = 'px-right';
    const bar = document.createElement('div');
    bar.className = 'px-bar' + (barCls ? ' ' + barCls : '');
    const fill = document.createElement('div');
    fill.className = 'px-fill' + (variant ? ' ' + variant : '');
    fill.style.width = pct(w);
    bar.appendChild(fill);
    const v = el('div', 'px-val' + (valCls ? ' ' + valCls : ''), val);
    right.appendChild(bar);
    right.appendChild(v);
    r.appendChild(m);
    r.appendChild(right);
    if (legend) r.insertAdjacentHTML('beforeend', legend);
    return r;
  }

  // 分段 stacked bar
  function segBarRow(title, sub, val, valCls, segs, legend) {
    const r = document.createElement('div');
    r.className = 'px-bar-row';
    const m = document.createElement('div');
    m.className = 'px-meta';
    m.appendChild(el('div', 'px-title', title));
    if (sub) m.appendChild(el('div', 'px-sub', sub));
    const right = document.createElement('div');
    right.className = 'px-right';
    const bar = document.createElement('div');
    bar.className = 'px-bar';
    segs.forEach(s => {
      if (s.w <= 0) return;
      const seg = document.createElement('div');
      seg.className = 'px-seg' + (s.variant ? ' ' + s.variant : '');
      seg.style.left = pct(s.l);
      seg.style.width = pct(s.w);
      seg.appendChild(document.createElement('div')).className = 'px-seg-fill';
      bar.appendChild(seg);
    });
    const v = el('div', 'px-val' + (valCls ? ' ' + valCls : ''), val);
    right.appendChild(bar);
    right.appendChild(v);
    r.appendChild(m);
    r.appendChild(right);
    if (legend) r.insertAdjacentHTML('beforeend', legend);
    return r;
  }

  // ---------- 数据聚合 ----------
  function aggTokens(totals) {
    const out = { input: 0, output: 0, cache: 0, calls: 0, models: 0 };
    for (const e of (totals || [])) {
      out.input   += e.input   || 0;
      out.output  += e.output  || 0;
      out.cache   += e.cache_read  || 0;
      out.cache  += e.cache_write || 0;
      out.calls   += e.calls   || 0;
      out.models += 1;
    }
    return out;
  }

  function aggBuckets(buckets) {
    const out = { normal: 0, failed: 0, timeout: 0, unknown: 0 };
    for (const b of Object.values(buckets || {})) {
      out.normal  += b.normal  || 0;
      out.failed  += b.failed  || 0;
      out.timeout += b.timeout || 0;
      out.unknown += b.unknown || 0;
    }
    return out;
  }

  function sumCallUsage(hosts) {
    let total = 0, provs = {};
    for (const h of hosts) {
      for (const [k, v] of Object.entries((h.call_usage_24h || {}).counts || {})) {
        total += v || 0;
        provs[k] = (provs[k] || 0) + (v || 0);
      }
    }
    return { total, provs };
  }

  function hostHealth(host) {
    let total = 0, working = 0, warn = 0, offline = 0;
    for (const b of (host.bots || [])) {
      if (b.tri?.tri === 'retired') continue;
      total++;
      if (b.tri?.tri === 'working') working++;
      else if (b.tri?.tri === 'unreachable') offline++;
      if ((b._severity || 0) >= 2) warn++;
    }
    const healthy = total - warn - offline;
    return { total, working, warn, offline, healthy };
  }

  // ---------- 终端状态行 ----------
  function renderStatusLine(snap) {
    const g = new Date(snap.generated_at);
    const h = pad(g.getUTCHours());
    const m = pad(g.getUTCMinutes());
    const s = pad(g.getUTCSeconds());
    const nowMs = Date.now();
    const snapAge = Math.max(0, Math.round((nowMs - g.getTime()) / 1000));
    // "up" = 主机上活体 bot 中最早的 process.start_at 至今；缺则回退 tokens.first_seen
    let earliest = 0;
    for (const host of snap.hosts || []) {
      for (const b of (host.bots || [])) {
        const st = b.process?.start_at;
        if (!st) continue;
        const t = Date.parse(st);
        if (isNaN(t)) continue;
        if (earliest === 0 || t < earliest) earliest = t;
      }
    }
    if (!earliest) {
      let es = 0;
      for (const host of snap.hosts || []) {
        for (const b of (host.bots || [])) {
          for (const e of (b.tokens || {}).totals || []) {
            const t = e.first_seen;
            if (typeof t !== 'number') continue;
            if (es === 0 || t < es) es = t;
          }
        }
      }
      earliest = es ? es * 1000 : 0;
    }
    if (!earliest) earliest = g.getTime();
    const upSec = Math.max(0, Math.floor((nowMs - earliest) / 1000));
    const upD = Math.floor(upSec / 86400);
    const upH = Math.floor((upSec % 86400) / 3600);
    const upTxt = `up ${upD}d ${upH}h`;
    PX_STATUS.innerHTML = [
      `<span><span class="px-dot"></span>HUB</span>`,
      `<span>SNAP ${h}:${m}:${s}</span>`,
      `<span>${upTxt}</span>`,
      `<span>cycle 15s · refresh 5s</span>`,
      `<span class="px-dim">age ${snapAge}s · v ${snap.schema_version ?? '?'}</span>`,
      `<span>● LIVE</span>`,
    ].join('');
  }

  // ---------- 主渲染 ----------
  function render(snap) {
    if (!snap || !snap.hosts) return;
    renderStatusLine(snap);

    PX_BAR.dataset.rendered = '1';
    PX_BAR.textContent = '';

    // ============ SECTION 01 · FLEET ============
    let total = 0, working = 0, warn = 0, offline = 0;
    for (const host of snap.hosts) {
      for (const b of (host.bots || [])) {
        if (b.tri?.tri === 'retired') continue;
        total++;
        if (b.tri?.tri === 'working') working++;
        else if (b.tri?.tri === 'unreachable') offline++;
        if ((b._severity || 0) >= 2) warn++;
      }
    }
    const healthy = total - warn - offline;

    PX_BAR.appendChild(section('01 · FLEET', `${healthy}/${total} H · ${working} W · ${warn} ! · ${offline} ✕`));
    const fleetPct = total ? healthy / total * 100 : 0;
    PX_BAR.appendChild(barRow(
      'FLEET HEALTH',
      `${healthy} healthy · ${warn} warn · ${offline} offline · ${total} total`,
      `${fleetPct.toFixed(1)}%`,
      warn > 0 ? 'dim' : '',
      fleetPct,
      warn > 0 ? 'outline' : '',
      'thick',
      legendHTML([
        { cls: '', label: 'HEALTHY' },
        { cls: 'outline', label: 'WARN' },
        { cls: 'danger', label: 'OFFLINE' },
      ])
    ));

    // ============ SECTION 02 · TOKENS · 舰队 token 汇总 ============
    let tIn = 0, tOut = 0, tCache = 0, tCalls = 0;
    for (const host of snap.hosts) {
      for (const b of (host.bots || [])) {
        const t = aggTokens((b.tokens || {}).totals);
        tIn += t.input; tOut += t.output; tCache += t.cache; tCalls += t.calls;
      }
    }
    const tTotal = tIn + tOut + tCache;
    const tInPct   = tTotal ? tIn / tTotal * 100 : 0;
    const tOutPct  = tTotal ? tOut / tTotal * 100 : 0;
    const tCachePct = tTotal ? tCache / tTotal * 100 : 0;
    PX_BAR.appendChild(section('02 · TOKENS', `${fmt(tTotal)} · ${tCalls} CALLS`));
    PX_BAR.appendChild(segBarRow(
      'FLEET TOKENS',
      `in ${fmt(tIn)} <span class="px-dim">·</span> out ${fmt(tOut)} <span class="px-dim">·</span> cache ${fmt(tCache)}`,
      `${fmt(tIn)}↑ ${fmt(tOut)}↓`,
      '',
      [
        { l: 0,         w: tInPct,      variant: '' },
        { l: tInPct,    w: tOutPct,     variant: 'outline' },
        { l: tInPct + tOutPct, w: tCachePct, variant: 'outline' },
      ],
      legendHTML([
        { cls: '', label: 'IN' },
        { cls: 'outline', label: 'OUT' },
        { cls: 'outline', label: 'CACHE' },
      ])
    ));

    // ============ SECTION 03 · CALLS 24H · 各主机调用占比 ============
    const cu = sumCallUsage(snap.hosts);
    PX_BAR.appendChild(section('03 · CALLS 24H', cu.total ? `${fmt(cu.total)} calls` : '—'));
    if (cu.total > 0) {
      // 主机级 stacked
      const hostsArr = snap.hosts.map(h => {
        let sum = 0;
        for (const v of Object.values((h.call_usage_24h || {}).counts || {})) sum += v || 0;
        return { short: h.short, id: h.host_id, sum };
      });
      let acc = 0;
      const segs = hostsArr.map(h => {
        const w = h.sum / cu.total * 100;
        const s = { l: acc, w, variant: '' };
        acc += w;
        return s;
      });
      PX_BAR.appendChild(segBarRow(
        'BY HOST',
        hostsArr.map(h => `${h.short} ${fmt(h.sum)}`).join(' <span class="px-dim">·</span> '),
        `${fmt(cu.total)}`,
        '',
        segs
      ));
    }

    // ============ SECTION 04 · AGENTS · 完成/失败 ============
    let totalNormal = 0, totalFailed = 0, totalTimeout = 0, totalUnknown = 0;
    for (const host of snap.hosts) {
      for (const b of (host.bots || [])) {
        const a = aggBuckets(b.agents_completed_buckets);
        totalNormal += a.normal;
        totalFailed += a.failed;
        totalTimeout += a.timeout;
        totalUnknown += a.unknown;
      }
    }
    const aTotal = totalNormal + totalFailed + totalTimeout + totalUnknown;
    const okRate = aTotal ? totalNormal / aTotal * 100 : 0;
    PX_BAR.appendChild(section(
      '04 · AGENTS',
      `${totalNormal} ok · ${totalFailed + totalTimeout} fail · ${totalUnknown} ?`,
      totalFailed + totalTimeout > 0 ? 'danger' : ''
    ));
    PX_BAR.appendChild(segBarRow(
      'COMPLETION',
      `normal ${totalNormal} <span class="px-dim">·</span> failed ${totalFailed} <span class="px-dim">·</span> timeout ${totalTimeout} <span class="px-dim">·</span> unknown ${totalUnknown}`,
      `${okRate.toFixed(1)}%`,
      totalFailed + totalTimeout > 0 ? 'danger' : '',
      [
        { l: 0, w: aTotal ? totalNormal / aTotal * 100 : 0, variant: '' },
        { l: aTotal ? totalNormal / aTotal * 100 : 0, w: aTotal ? totalFailed / aTotal * 100 : 0, variant: 'danger' },
        { l: aTotal ? (totalNormal + totalFailed) / aTotal * 100 : 0, w: aTotal ? totalTimeout / aTotal * 100 : 0, variant: 'outline' },
        { l: aTotal ? (totalNormal + totalFailed + totalTimeout) / aTotal * 100 : 0, w: aTotal ? totalUnknown / aTotal * 100 : 0, variant: 'outline' },
      ],
      legendHTML([
        { cls: '', label: 'OK' },
        { cls: 'danger', label: 'FAIL' },
        { cls: 'outline', label: 'TIMEOUT' },
        { cls: 'outline', label: 'UNKNOWN' },
      ])
    ));

    // ============ SECTION 05 · HOSTS · 每台主机健康 ============
    PX_BAR.appendChild(section('05 · HOSTS', `${snap.hosts.length} nodes`));
    for (const host of snap.hosts) {
      const hh = hostHealth(host);
      if (hh.total === 0) continue;
      const healthPct = hh.healthy / hh.total * 100;
      const callTotal = (host.call_usage_24h?.counts ? Object.values(host.call_usage_24h.counts).reduce((a, b) => a + (b || 0), 0) : 0);
      PX_BAR.appendChild(segBarRow(
        `${host.host_id} · ${host.short}`,
        `healthy ${hh.healthy} <span class="px-dim">·</span> warn ${hh.warn} <span class="px-dim">·</span> offline ${hh.offline} <span class="px-dim">·</span> ${hh.total} bots`,
        `${healthPct.toFixed(0)}%`,
        hh.warn > 0 || hh.offline > 0 ? 'dim' : '',
        [
          { l: 0, w: hh.healthy / hh.total * 100, variant: '' },
          { l: hh.healthy / hh.total * 100, w: hh.warn / hh.total * 100, variant: 'outline' },
          { l: (hh.healthy + hh.warn) / hh.total * 100, w: hh.offline / hh.total * 100, variant: 'danger' },
        ]
      ));
    }

    // ============ HOST BARS · 每台主机独立面板 ============
    for (const host of snap.hosts) {
      const sec = document.querySelector(`.host-section[data-short="${CSS.escape(host.short)}"]`);
      if (!sec) continue;
      let hb = sec.querySelector('.host-bars');
      if (!hb) {
        hb = document.createElement('div');
        hb.className = 'host-bars';
        const head = sec.querySelector('.host-head');
        if (head) sec.insertBefore(hb, head.nextSibling);
        else sec.appendChild(hb);
      }
      hb.textContent = '';

      const hh = hostHealth(host);
      const cuH = (host.call_usage_24h?.counts ? Object.values(host.call_usage_24h.counts).reduce((a, b) => a + (b || 0), 0) : 0);
      const botCount = (host.bots || []).filter(b => b.tri?.tri !== 'retired').length;
      hb.appendChild(section(`${host.host_id.toUpperCase()} · ${host.short}`, `${botCount} bots · ${fmt(cuH)} calls`));

      // 主机健康
      if (hh.total > 0) {
        const healthPct = hh.healthy / hh.total * 100;
        hb.appendChild(segBarRow(
          'HEALTH',
          `ok ${hh.healthy} <span class="px-dim">·</span> warn ${hh.warn} <span class="px-dim">·</span> offline ${hh.offline}`,
          `${healthPct.toFixed(0)}%`,
          hh.warn > 0 || hh.offline > 0 ? 'dim' : '',
          [
            { l: 0, w: hh.healthy / hh.total * 100, variant: '' },
            { l: hh.healthy / hh.total * 100, w: hh.warn / hh.total * 100, variant: 'outline' },
            { l: (hh.healthy + hh.warn) / hh.total * 100, w: hh.offline / hh.total * 100, variant: 'danger' },
          ]
        ));
      }

      // 24h 调用（各 provider）
      if (cuH > 0) {
        const counts = host.call_usage_24h.counts || {};
        const provs = Object.entries(counts).sort((a, b) => (b[1] || 0) - (a[1] || 0));
        let acc = 0;
        const segs = provs.map(([k, v]) => {
          const w = v / cuH * 100;
          const s = { l: acc, w, variant: '' };
          acc += w;
          return s;
        });
        hb.appendChild(segBarRow(
          'CALLS 24H',
          provs.map(([k, v]) => `${k} ${v}`).join(' <span class="px-dim">·</span> '),
          `${fmt(cuH)}`,
          ''
        ));
      }

      // 各 bot 完成桶（mini bar）
      const botsForBar = (host.bots || []).filter(b => b.tri?.tri !== 'retired');
      if (botsForBar.length) {
        const agSec = section('AGENTS · 完成桶');
        hb.appendChild(agSec);
        for (const b of botsForBar) {
          const a = aggBuckets(b.agents_completed_buckets);
          const t = a.normal + a.failed + a.timeout + a.unknown;
          const nm = b.display_name || b.profile || b.id;
          if (t === 0) {
            const r = document.createElement('div');
            r.className = 'px-bar-row';
            r.innerHTML = `<div class="px-meta"><div class="px-title">${nm}</div><div class="px-sub">no agent ledger data</div></div>`
                        + `<div class="px-right"><div class="px-bar" style="opacity:.5"></div><div class="px-val dim">—</div></div>`;
            hb.appendChild(r);
            continue;
          }
          const okPct = a.normal / t * 100;
          const rateCls = a.failed + a.timeout > 0 ? 'danger' : '';
          hb.appendChild(segBarRow(
            nm,
            `normal ${a.normal} <span class="px-dim">·</span> failed ${a.failed} <span class="px-dim">·</span> timeout ${a.timeout} <span class="px-dim">·</span> unknown ${a.unknown}`,
            `${okPct.toFixed(1)}%`,
            rateCls,
            [
              { l: 0, w: okPct, variant: '' },
              { l: okPct, w: a.failed / t * 100, variant: 'danger' },
              { l: (a.normal + a.failed) / t * 100, w: a.timeout / t * 100, variant: 'outline' },
              { l: (a.normal + a.failed + a.timeout) / t * 100, w: a.unknown / t * 100, variant: 'outline' },
            ]
          ));
        }
      }
    }

    // ============ BOT CARDS · meter 注入 ============
    document.querySelectorAll('.host-section').forEach(sec => {
      const short = sec.dataset.short;
      const host = (snap.hosts || []).find(h => h.short === short);
      if (!host) return;
      sec.querySelectorAll('.bot-card').forEach(card => {
        const bot = (host.bots || []).find(b => (b.id || b.profile) === (card.dataset.botId || card.dataset.id));
        // app.js 未给 card 打 botId；改为按名字索引
        const nmEl = card.querySelector('.bot-name');
        if (!nmEl) return;
        const nm = nmEl.textContent;
        const b = (host.bots || []).find(x => x.display_name === nm) || (host.bots || []).find(x => x.profile === nm);
        if (!b) return;

        let meter = card.querySelector('.bot-meter');
        if (meter) meter.remove();
        meter = document.createElement('div');
        meter.className = 'bot-meter';

        // (1) TOKENS 分段（in/out/cache）
        const t = aggTokens((b.tokens || {}).totals);
        const tTotal = t.input + t.output + t.cache;
        const mm1 = document.createElement('div');
        mm1.className = 'mm';
        mm1.appendChild(el('span', 'mm-label', 'TOKENS'));
        const bar1 = document.createElement('div');
        bar1.className = 'mm-bar';
        if (tTotal > 0) {
          let acc = 0;
          [['input', t.input, ''], ['output', t.output, 'outline'], ['cache', t.cache, 'outline']].forEach(([k, v, variant]) => {
            if (v <= 0) return;
            const w = v / tTotal * 100;
            const seg = document.createElement('div');
            seg.className = 'px-seg' + (variant ? ' ' + variant : '');
            seg.style.left = pct(acc);
            seg.style.width = pct(w);
            seg.appendChild(document.createElement('div')).className = 'px-seg-fill';
            bar1.appendChild(seg);
            acc += w;
          });
        }
        mm1.appendChild(bar1);
        const v1 = el('span', 'mm-val', tTotal > 0 ? `${fmt(tTotal)} · ${t.calls}c` : '—');
        mm1.appendChild(v1);
        meter.appendChild(mm1);

        // (2) AGENTS 完成率
        const a = aggBuckets(b.agents_completed_buckets);
        const aT = a.normal + a.failed + a.timeout + a.unknown;
        const mm2 = document.createElement('div');
        mm2.className = 'mm';
        mm2.appendChild(el('span', 'mm-label', 'AGENTS'));
        const bar2 = document.createElement('div');
        bar2.className = 'mm-bar';
        if (aT > 0) {
          let acc = 0;
          [['normal', a.normal, ''], ['failed', a.failed, 'danger'], ['timeout', a.timeout, 'outline'], ['unknown', a.unknown, 'outline']].forEach(([, v, variant]) => {
            if (v <= 0) return;
            const w = v / aT * 100;
            const seg = document.createElement('div');
            seg.className = 'px-seg' + (variant ? ' ' + variant : '');
            seg.style.left = pct(acc);
            seg.style.width = pct(w);
            seg.appendChild(document.createElement('div')).className = 'px-seg-fill';
            bar2.appendChild(seg);
            acc += w;
          });
        }
        mm2.appendChild(bar2);
        const okPct2 = aT ? (a.normal / aT * 100).toFixed(1) + '%' : '—';
        const v2Cls = a.failed + a.timeout > 0 ? 'mm-val danger' : 'mm-val';
        mm2.appendChild(el('span', v2Cls, `${a.normal}ok · ${okPct2}`));
        meter.appendChild(mm2);

        // (3) ERR · log_errors.count_24h / 500
        const errN = b.log_errors?.count_24h || 0;
        const errPct = clamp(errN / 500 * 100, 0, 100);
        const mm3 = document.createElement('div');
        mm3.className = 'mm';
        mm3.appendChild(el('span', 'mm-label', 'ERR·24H'));
        const bar3 = document.createElement('div');
        bar3.className = 'mm-bar';
        const fill3 = document.createElement('div');
        fill3.className = 'px-fill' + (errN >= 100 ? ' danger' : (errN > 0 ? ' outline' : ''));
        fill3.style.width = pct(errPct);
        bar3.appendChild(fill3);
        mm3.appendChild(bar3);
        const v3Cls = errN >= 100 ? 'mm-val danger' : (errN > 0 ? 'mm-val dim' : 'mm-val dim');
        mm3.appendChild(el('span', v3Cls, `${errN}/500`));
        meter.appendChild(mm3);

        // (4) AGE · progress_age_s / 8h idle 阈值
        const age = b.work?.progress_age_s ?? 0;
        const agePct = clamp(age / (8 * 3600) * 100, 0, 100);
        const mm4 = document.createElement('div');
        mm4.className = 'mm';
        mm4.appendChild(el('span', 'mm-label', 'IDLE'));
        const bar4 = document.createElement('div');
        bar4.className = 'mm-bar';
        const fill4 = document.createElement('div');
        fill4.className = 'px-fill' + (age > 2 * 3600 ? ' outline' : '');
        fill4.style.width = pct(agePct);
        bar4.appendChild(fill4);
        mm4.appendChild(bar4);
        let ageTxt = '—';
        if (age > 0) {
          if (age < 60) ageTxt = `${Math.round(age)}s`;
          else if (age < 3600) ageTxt = `${Math.round(age / 60)}m`;
          else if (age < 86400) ageTxt = `${(age / 3600).toFixed(1)}h`;
          else ageTxt = `${(age / 86400).toFixed(1)}d`;
        }
        mm4.appendChild(el('span', 'mm-val dim', ageTxt));
        meter.appendChild(mm4);

        // 插入位置：bot-top 之后
        const top = card.querySelector('.bot-top');
        if (top && top.nextSibling) card.insertBefore(meter, top.nextSibling);
        else card.appendChild(meter);
      });
    });
  }

  // ---------- 拦截 fetch，渲染 ----------
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const p = origFetch(input, init);
    if (url.includes('/api/status')) {
      p.then(r => {
        try {
          r.clone().json().then(snap => {
            if (snap && snap.hosts) render(snap);
          }).catch(() => {});
        } catch (e) {}
      }).catch(() => {});
    }
    return p;
  };

  // app.js 加载完后再兜底一次
  const waitForReady = () => {
    const tick = () => {
      if (document.querySelector('main .host-section')) {
        PX_BAR.dataset.rendered = '1';
      } else {
        setTimeout(tick, 200);
      }
    };
    tick();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForReady);
  } else {
    waitForReady();
  }
})();
