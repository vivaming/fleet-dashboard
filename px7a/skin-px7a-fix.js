/* PX7A-FIX v2 — js 补丁：时钟走秒 + 数据变化检测闪烁
   以 IIFE 追加，不改原 skin-px7a.js 逻辑，靠 MutationObserver + 定时器驱动 */
(function () {
  'use strict';

  /* ---- 1. 时钟：状态行时间每秒重写，触发 px7tick 动画 ---- */
  var clockEl = null;
  function ensureClock() {
    var status = document.querySelector('.px7-status');
    if (!status) return false;
    if (!clockEl || !clockEl.isConnected) {
      clockEl = status.querySelector('.px7-clock');
      if (!clockEl) {
        // 原状态行形如 "FLEET · 12:34:56 · 3 hosts · 9 bots · ● live"
        // 找含时间的文本节点包一层
        var walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT, null);
        var n;
        while ((n = walker.nextNode())) {
          var m = n.textContent.match(/(\d{1,2}:\d{2}:\d{2})/);
          if (m) {
            var span = document.createElement('span');
            span.className = 'px7-clock';
            span.textContent = m[1];
            n.parentNode.replaceChild(span, n);
            span.insertBefore(document.createTextNode(n.textContent.replace(m[1], '')), null);
            clockEl = span;
            break;
          }
        }
      }
    }
    return !!clockEl;
  }

  var lastSec = -1;
  setInterval(function () {
    if (!ensureClock()) return;
    var now = new Date();
    var s = now.getSeconds();
    if (s === lastSec) return;
    lastSec = s;
    var t = now.toTimeString().slice(0, 8);
    // 重写文本并重触发动画
    clockEl.textContent = t;
    clockEl.style.animation = 'none';
    void clockEl.offsetHeight; /* reflow 重启动画 */
    clockEl.style.animation = '';
  }, 1000);

  /* ---- 2. 数据变化检测：observer 监视 fill 宽度与 val 文本，变化时闪 ---- */
  function watchRow(row) {
    if (row.__px7watched) return;
    row.__px7watched = true;
    var fill = row.querySelector('.px7-fill');
    var val = row.querySelector('.px7-val');
    var lastW = fill ? fill.style.width : '';
    var lastT = val ? val.textContent : '';
    setInterval(function () {
      if (fill) {
        var w = fill.style.width;
        if (w !== lastW) {
          lastW = w;
          fill.classList.remove('px7-updated');
          void fill.offsetWidth;
          fill.classList.add('px7-updated');
          setTimeout(function () { fill.classList.remove('px7-updated'); }, 750);
        }
      }
      if (val) {
        var t = val.textContent;
        if (t !== lastT) {
          lastT = t;
          val.classList.remove('px7-updated');
          void val.offsetWidth;
          val.classList.add('px7-updated');
          setTimeout(function () { val.classList.remove('px7-updated'); }, 750);
        }
      }
    }, 2000);
  }

  /* 轮询挂监（render 每次重建 DOM，新行自动被拾起） */
  setInterval(function () {
    var rows = document.querySelectorAll('.px7-row');
    for (var i = 0; i < rows.length; i++) watchRow(rows[i]);
  }, 2500);
})();
