/* P3 · PAPER INK — 卡片编号角标：为每张 .bot-card 注入「№ 001」式印记
 * 面板数据异步刷新，卡片可能增删——轮询每次都完整重编号（幂等）。
 * 不改任何既有 DOM 结构，只 ensure/rewrite 一个 span.card-num。 */
(function () {
  function pad3(n) {
    return String(n).length < 3 ? ('00' + n).slice(-3) : String(n);
  }
  function tag() {
    var all = document.querySelectorAll('main .bot-card');
    var i = 0;
    for (var k = 0; k < all.length; k++) {
      var card = all[k];
      i += 1;
      var retired = card.classList.contains('retired-card') ||
                    card.classList.contains('offline-card');
      var num = card.querySelector(':scope > .card-num');
      if (!num) {
        num = document.createElement('span');
        num.className = 'card-num';
        card.appendChild(num);
      }
      var want = retired ? ('№ ' + pad3(i) + ' · 归档') : ('№ ' + pad3(i));
      if (num.textContent !== want) num.textContent = want;
    }
    return i;
  }
  var tries = 0;
  var iv = setInterval(function () {
    tag();
    if (++tries > 60) clearInterval(iv); // ~15s 后停
  }, 250);
  tag(); // 立即首标
})();
