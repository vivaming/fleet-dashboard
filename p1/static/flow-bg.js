/* flow-bg.js v3 — 舰队监控站 全屏流场背景（3200 粒子真丝版）
 * 核心 = v2 原型同源实现（参考 flow-field-studio 解剖参数：3D 单纯形噪声场 +
 * 湍流 + 3 颗种植涡旋 + 大理石分色 + 长拖尾低透明批绘），Sol 评审意见全落实：
 * 默认关、localStorage 记偏好、透明度交给外层 canvas（0.07），减动效直接禁用。
 * 不触碰任何数据逻辑。回滚：删掉 index.html 里 <script src="/static/flow-bg.js"> 那行。 */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var CANVAS_OPACITY = 0.07;    // Sol 建议 6-8%
  var LS_KEY = 'fleet.flowbg';

  // ---- 分层样式：canvas 垫底，既有内容抬一层，按钮右下角 ----
  var st = document.createElement('style');
  st.textContent =
    '#flowBgCanvas{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:' + CANVAS_OPACITY + '}' +
    'body>*:not(#flowBgCanvas){position:relative;z-index:1}' +
    '#flowBgToggle{position:fixed;right:14px;bottom:14px;z-index:20;appearance:none;border:1px solid #1c2450;' +
    'background:rgba(13,18,38,.85);color:#7c86b8;border-radius:3px;padding:6px 12px;' +
    'font:500 10px/1 "JetBrains Mono","Courier New",monospace;letter-spacing:.12em;cursor:pointer;' +
    'backdrop-filter:blur(4px);transition:border-color .2s,color .2s}' +
    '#flowBgToggle.on{border-color:#35e0e0;color:#35e0e0;text-shadow:0 0 12px rgba(53,224,224,.45)}';
  document.head.appendChild(st);

  var canvas = document.createElement('canvas');
  canvas.id = 'flowBgCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);
  var actx = canvas.getContext('2d', { alpha: false });

  var btn = document.createElement('button');
  btn.id = 'flowBgToggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.textContent = '流场 关';
  btn.addEventListener('click', function () {
    var on = btn.classList.toggle('on');
    btn.textContent = on ? '流场 开' : '流场 关';
    btn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(LS_KEY, on ? 'on' : 'off'); } catch (e) {}
    setRunning(on);
  });
  document.body.appendChild(btn);

  // ================= v2 同源核心 =================
  var TAU = Math.PI * 2;
  var GRAD3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
  var perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  function seedNoise(rand) {
    var p = new Uint8Array(256), i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = (rand() * (i + 1)) | 0; t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  }
  function noise3(x, y, z) {
    var F3 = 1 / 3, G3 = 1 / 6;
    var s = (x + y + z) * F3;
    var i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    var t = (i + j + k) * G3;
    var x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    var i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    var x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    var x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    var x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    var ii = i & 255, jj = j & 255, kk = k & 255;
    var n0 = 0, n1 = 0, n2 = 0, n3 = 0, g, t0, t1, t2, t3;
    t0 = .6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { g = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    t1 = .6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    t2 = .6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    t3 = .6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  var MAXP = 3200;
  var W = { v: 0 }, H = { v: 0 }, dpr = 1;
  var px = new Float32Array(MAXP), py = new Float32Array(MAXP);
  var life = new Int16Array(MAXP), col = new Uint8Array(MAXP);
  var groups = [], N = 3200, frame = 0, z = 0, cz = 0;
  var noiseF = 0.0016, curlK = 2.2, turb = 0.35, strokeLen = 220;
  var rand = Math.random, running = false, reduced = false;
  var vortices = [], thresholds = [];
  var V = new Float32Array(2);
  var raf = 0, last = 0;

  var palette = {
    bg: '#070912',
    colors: ['#35e0e0', '#9d6bff', '#7c86b8'],   // 青 / 紫 / 暗——面板令牌
    weights: [3, 2, 1],
    alpha: 0.55,
    lw: 1,
    fade: 0.025
  };

  function colourAt(x, y) {
    var f = noiseF * 0.42;
    var v = noise3(x * f + 71.3, y * f - 18.2, cz + z * 0.08);
    var c = 0;
    while (c < thresholds.length && v > thresholds[c]) c++;
    return c;
  }
  function buildThresholds() {
    var vals = [], r = mulberry(4242), f = noiseF * 0.42, k;
    for (k = 0; k < 600; k++) vals.push(noise3(r() * W.v * f + 71.3, r() * H.v * f - 18.2, cz));
    vals.sort(function (a, b) { return a - b; });
    var ws = palette.weights, tot = 0, i;
    for (i = 0; i < ws.length; i++) tot += ws[i];
    thresholds = [];
    var acc = 0;
    for (i = 0; i < ws.length - 1; i++) { acc += ws[i] / tot; thresholds.push(vals[Math.min(vals.length - 1, (acc * vals.length) | 0)]); }
  }
  function spawn(i) {
    var c = col[i], regional = rand() < 0.74, x = 0, y = 0, t;
    for (t = 0; t < 10; t++) {
      x = rand() * W.v; y = rand() * H.v;
      if (!regional || colourAt(x, y) === c) break;
    }
    px[i] = x; py[i] = y;
    life[i] = (strokeLen * (0.45 + rand() * 0.9)) | 0;
  }
  function buildGroups() {
    groups = [];
    var ws = palette.weights, tot = 0, i;
    for (i = 0; i < ws.length; i++) tot += ws[i];
    var start = 0;
    for (var c = 0; c < palette.colors.length; c++) {
      var end = c === palette.colors.length - 1 ? N : Math.min(N, start + Math.round(N * ws[c] / tot));
      for (i = start; i < end; i++) col[i] = c;
      groups.push({ c: c, start: start, end: end });
      start = end;
    }
  }
  function vel(x, y, out) {
    var f = noiseF;
    var a = noise3(x * f, y * f, z) * TAU * curlK;
    if (turb > 0) a += noise3(x * f * 3.3 + 31.7, y * f * 3.3 - 12.9, z * 1.9 + 5.1) * TAU * turb;
    var vx = Math.cos(a), vy = Math.sin(a);
    for (var k = 0; k < vortices.length; k++) {
      var v = vortices[k];
      var dx = x - v.x, dy = y - v.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < v.r * v.r) {
        var d = Math.sqrt(d2) + 1e-4;
        var fall = 1 - d / v.r;
        var w = fall * fall * v.s * v.grow;
        var ux = dx / d, uy = dy / d;
        vx += (-uy * v.dir - ux * 0.32) * w * 2.6;
        vy += (ux * v.dir - uy * 0.32) * w * 2.6;
      }
    }
    var m = Math.hypot(vx, vy) || 1;
    out[0] = vx / m; out[1] = vy / m;
  }
  function simulate(sub) {
    var speed = 1.15;
    actx.globalAlpha = palette.alpha;
    actx.lineWidth = palette.lw;
    actx.lineCap = 'round'; actx.lineJoin = 'round';
    for (var g = 0; g < groups.length; g++) {
      var G = groups[g];
      actx.strokeStyle = palette.colors[G.c];
      actx.beginPath();
      for (var i = G.start; i < G.end; i++) {
        var x = px[i], y = py[i];
        actx.moveTo(x, y);
        for (var s = 0; s < sub; s++) {
          vel(x, y, V);
          x += V[0] * speed; y += V[1] * speed;
          var dead = --life[i] <= 0 || x < -2 || y < -2 || x > W.v + 2 || y > H.v + 2;
          if (!dead && vortices.length) {
            for (var k = 0; k < vortices.length; k++) {
              var v = vortices[k], dx = x - v.x, dy = y - v.y;
              if (dx * dx + dy * dy < 9) { dead = true; break; }
            }
          }
          if (dead) { spawn(i); x = px[i]; y = py[i]; actx.moveTo(x, y); continue; }
          actx.lineTo(x, y);
        }
        px[i] = x; py[i] = y;
      }
      actx.stroke();
    }
    actx.globalAlpha = 1;
  }
  function fadeStep() {
    actx.globalAlpha = palette.fade;
    actx.fillStyle = palette.bg;
    actx.fillRect(0, 0, W.v, H.v);
    actx.globalAlpha = 1;
  }
  function resize() {
    var w = Math.max(1, Math.round(window.innerWidth));
    var h = Math.max(1, Math.round(window.innerHeight));
    var ndpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W.v && h === H.v && ndpr === dpr) return;
    W.v = w; H.v = h; dpr = ndpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    actx.fillStyle = palette.bg;
    actx.fillRect(0, 0, w, h);
    buildThresholds();
  }
  function plantVortices() {
    // 3 颗美位涡旋（同 v2 原型）：左上 / 右上 / 下中，反向旋转
    vortices.length = 0;
    vortices.push({ x: W.v * 0.25, y: H.v * 0.35, r: Math.min(W.v, H.v) * 0.18, s: 1,   dir: 1,  grow: 0 });
    vortices.push({ x: W.v * 0.72, y: H.v * 0.28, r: Math.min(W.v, H.v) * 0.15, s: 0.9, dir: -1, grow: 0 });
    vortices.push({ x: W.v * 0.5,  y: H.v * 0.72, r: Math.min(W.v, H.v) * 0.22, s: 1.1, dir: 1,  grow: 0 });
  }
  function init() {
    seedNoise(Math.random);
    buildGroups();
    for (var i = 0; i < N; i++) spawn(i);
    actx.fillStyle = palette.bg; actx.fillRect(0, 0, W.v, H.v);
  }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    simulate(reduced ? 1 : 2);
    frame++;
    z += 0.0015;
    if (frame % 12 === 0) fadeStep();
    for (var k = 0; k < vortices.length; k++) vortices[k].grow = Math.min(1, vortices[k].grow + 0.005);
  }
  function setRunning(v) {
    running = v;
    if (v) { last = performance.now(); if (!raf) raf = requestAnimationFrame(loop); }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; actx.globalAlpha = 1; actx.fillStyle = palette.bg; actx.fillRect(0, 0, W.v, H.v); }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    else if (running) { last = performance.now(); raf = requestAnimationFrame(loop); }
  });
  window.addEventListener('resize', function () { resize(); plantVortices(); buildThresholds(); });

  resize(); plantVortices(); init();

  // 恢复用户偏好（默认关）
  var pref = 'off';
  try { pref = localStorage.getItem(LS_KEY) || 'off'; } catch (e) {}
  if (pref === 'on') {
    btn.classList.add('on'); btn.textContent = '流场 开'; btn.setAttribute('aria-pressed', 'true');
    setRunning(true);
  }
})();
