/* PX7A-FIX v3 js — 时钟对齐真实类 px6-clock + 条变化闪烁（2s 定时快照对比版） */
(function () {
  'use strict';

  /* 1. 时钟每秒走（重写文本 + 重触发动画） */
  setInterval(function () {
    var c = document.querySelector('.px6-clock');
    if (!c) return;
    var t = new Date().toTimeString().slice(0, 8);
    if (c.textContent === t) return;
    c.textContent = t;
    c.style.animation = 'none';
    void c.offsetHeight;
    c.style.animation = '';
  }, 1000);

  /* 2. 条/数值变化 → px7-updated 闪烁 */
  function flash(el) {
    if (!el) return;
    el.classList.remove('px7-updated');
    void el.offsetWidth;
    el.classList.add('px7-updated');
    setTimeout(function () { el.classList.remove('px7-updated'); }, 750);
  }

  function snapshot(root) {
    var s = {};
    var fills = root.querySelectorAll(".px6-fill, .px6-hfill");
    for (var i = 0; i < fills.length; i++) s['f' + i] = fills[i].style.width || '';
    var pcts = root.querySelectorAll(".px6-pct");
    for (var j = 0; j < pcts.length; j++) s['p' + j] = pcts[j].textContent;
    return s;
  }

  function watch(root) {
    if (root.__px7watch) return;
    root.__px7watch = true;
    var last = snapshot(root);
    setInterval(function () {
      var now = snapshot(root);
      var fills = root.querySelectorAll(".px6-fill, .px6-hfill");
      var pcts = root.querySelectorAll(".px6-pct");
      var i;
      for (i = 0; i < fills.length; i++) {
        var k = 'f' + i;
        if (now[k] !== last[k]) { flash(fills[i]); }
      }
      for (i = 0; i < pcts.length; i++) {
        var kp = 'p' + i;
        if (now[kp] !== last[kp]) { flash(pcts[i]); }
      }
      last = now;
    }, 2000);
  }

  setInterval(function () {
    var root = document.querySelector('.px6-root');
    if (root) watch(root);
  }, 2500);
})();
