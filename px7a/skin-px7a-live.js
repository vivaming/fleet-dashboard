/* PX7A-LIVE v1 — 数值层「真实时」（零成本纯浏览器方案）
   ① 三级数据源：try 直连 .69:8710（3s 超时降级，公网 CORS 必拦）→ 同源快照轮询 5s
   ② 状态行徽章：● LIVE·5s（直连成功）/ ◐ SYNC·30m（快照模式）
   ③ 页脚 last update HH:MM:SS · via direct|snapshot
   ④ generated_at 变化 → render() 全量重渲（条宽瞬时跳变，无跨节点过渡）；
      px7-updated 闪烁由 fix2.js 的 2s 定时快照对比负责
   ⑤ FREE QUOTA section 挂载点：#px6-quota（USAGE 后 BOTS 前），
      渲染在 skin-px7a-quota.js，这里只在快照刷新时重渲它 */
(function () {
  'use strict';
  if (window.__PX7LIVE__) return;
  window.__PX7LIVE__ = 1;

  var DIRECT_URL = 'http://x.x.x.x:8710/api/status';
  var DIRECT_TIMEOUT_MS = 3000;
  var POLL_MS = 5000;            /* 快照轮询间隔（同源，零成本） */
  var mode = null;               /* 'direct' | 'snapshot' */
  var lastFetchOk = null;        /* Date */
  var pageBoot = Date.now();
  var probing = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- ① 直连探测（一次性，3s 超时） ----------
     必须用原生 XHR：api-override.js 劫持了 window.fetch，会把**任何**
     含 '/api/status' 的 URL（含 .69 绝对地址）重写到本地快照 —— 用被
     劫持的 fetch 探测会得到假「direct」。XHR 未被劫持，CORS 语义同 fetch。 */
  function rawJSON(url, timeoutMs, cb) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = timeoutMs;
      x.onload = function () {
        if (x.status === 200) {
          try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); }
        } else cb(new Error('HTTP ' + x.status));
      };
      x.onerror = function () { cb(new Error('network/CORS')); };
      x.ontimeout = function () { cb(new Error('timeout')); };
      x.send();
    } catch (e) { cb(e); }
  }

  function probeDirect() {
    if (probing) return;
    probing = true;
    rawJSON(DIRECT_URL, DIRECT_TIMEOUT_MS, function (err, snap) {
      probing = false;
      if (!err && snap && snap.generated_at) setMode('direct', snap);
      else setMode('snapshot');
    });
  }

  /* ---------- 同源快照拉取（经 api-override.js 重写到 api_status.json） ---------- */
  function fetchSnapshot() {
    return window.fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ---------- ③ 徽章 + 页脚 ---------- */
  function fmtClock(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function renderChrome() {
    var live = document.getElementById('px6-live');
    if (live) {
      live.setAttribute('data-src', mode || '');
      if (mode === 'direct') live.textContent = '● LIVE·5s';
      else live.textContent = '◐ SYNC·30m';
    }
    var foot = document.querySelector('.px6-foot');
    if (foot && lastFetchOk) {
      var f = foot.querySelector('.px7-lastupd');
      if (!f) {
        f = document.createElement('span');
        f.className = 'px7-lastupd';
        foot.appendChild(f);
      }
      f.textContent = 'last update ' + fmtClock(lastFetchOk) + ' · via ' + (mode === 'direct' ? 'direct' : 'snapshot');
    }
  }

  /* ---------- 数据送达 ---------- */
  function deliver(snap, via) {
    if (!snap || !snap.generated_at) return;
    mode = via;
    lastFetchOk = new Date();
    if (window.__PX7_SET_SNAPSHOT__) window.__PX7_SET_SNAPSHOT__(snap, via);
    renderChrome();
  }

  function setMode(m, snap) {
    mode = m;
    if (snap) deliver(snap, m);
    else renderChrome();
  }

  /* ---------- 轮询引擎 ---------- */
  function loop() {
    if (mode === 'direct') {
      /* LIVE·5s：直连也保持 5s 真轮询（XHR，绕过 fetch 劫持）；
         直连失败 → 立即降级快照 */
      rawJSON(DIRECT_URL, DIRECT_TIMEOUT_MS, function (err, snap) {
        if (!err && snap && snap.generated_at) deliver(snap, 'direct');
        else setMode('snapshot');
      });
    } else {
      fetchSnapshot()
        .then(function (snap) {
          if (mode !== 'direct') deliver(snap, 'snapshot');
        })
        .catch(function () { /* 静态站最坏情况：文件在，不会持续失败 */ });
    }
  }

  (function boot() {
    /* 等 skin-px7a.js 首帧渲染完再接管徽章 */
    var t = setInterval(function () {
      if (document.getElementById('px6-live')) {
        clearInterval(t);
        probeDirect();
        loop();
        setInterval(loop, POLL_MS);
        setInterval(renderChrome, 1000); /* 页脚时钟刷新 */
      }
    }, 250);
  })();
})();
