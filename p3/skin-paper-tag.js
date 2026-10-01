/* ============================================================
   fleet-monitor · P3 "PAPER INK" tag layer
   lane: xpi
   纯只读 DOM 装饰，不干扰 app.js 数据渲染：
    1) 头版刊头「期号/社名」小字（.paper-masthead）
    2) 每个 bot 卡的「№ 000」编号角标（红印）
    3) 页脚「第 N 版 · 数据快照」版权行
   卡片由 app.js 异步分批渲染/复用 → 用轮询补标。
   ============================================================ */
(function () {
  "use strict";

  // 1) 头版期号小字（只建一次）
  var masthead = function () {
    var header = document.querySelector("body.paper header");
    if (!header) return;
    if (header.querySelector(".paper-masthead")) return;
    var m = document.createElement("div");
    m.className = "paper-masthead";
    var d = document.createElement("span");
    d.className = "date-line";
    var now = new Date();
    d.textContent =
      now.getFullYear() + " 年 " +
      (now.getMonth() + 1) + " 月 " +
      now.getDate() + " 日 ";
    var v = document.createElement("span");
    v.className = "volume";
    v.textContent = "THE FLEET MONITOR · 舰队快报";
    m.appendChild(d);
    m.appendChild(v);
    header.appendChild(m);
  };

  // 2) 卡片 № 编号角标（按主机分区内顺序，001/002/... ）
  var cardNums = function () {
    var sections = document.querySelectorAll("body.paper .host-section");
    var n = 0;
    sections.forEach(function (sec) {
      var cards = sec.querySelectorAll(":scope > .cards .bot-card");
      cards.forEach(function (card) {
        n += 1;
        var num = card.querySelector(".card-num");
        if (!num) {
          num = document.createElement("span");
          num.className = "card-num";
          card.appendChild(num);
        }
        // 仅补 / 更新编号；不改 app.js 已写的内容
        var label = "№ " + String(n).padStart(3, "0");
        if (num.textContent !== label) num.textContent = label;
      });
    });
  };

  // 3) 页脚「第 N 版 · 数据快照」版权行
  var edition = function () {
    var footer = document.querySelector("body.paper footer");
    if (!footer) return;
    if (footer.querySelector(".edition-line")) return;
    var e = document.createElement("div");
    e.className = "edition-line";
    e.textContent = "第 " + String(Math.max(1, new Date().getDate())) + " 版 · 数据快照";
    footer.insertBefore(e, footer.firstChild);
  };

  var stamp = function () { masthead(); cardNums(); edition(); };

  // 页面切换（连清空重建）也会重绘卡片，轮询补标，~12s 停。
  stamp();
  var tries = 0;
  var iv = setInterval(function () {
    stamp();
    if (++tries > 48) clearInterval(iv);
  }, 250);

  // 数据源初始加载完成后多次重建 → 监听 main 子树，保持编号最新
  var main = document.getElementById("main");
  if (main && "MutationObserver" in window) {
    var mo = new MutationObserver(function () { cardNums(); });
    mo.observe(main, { childList: true, subtree: true });
  }
})();
