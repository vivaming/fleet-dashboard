/* P2 · BLUEPRINT — 尺寸标注：为每个主机分区注入「N HOSTS / M BOTS」图纸小字 */
(function () {
  function tag() {
    var sections = document.querySelectorAll('.host-section');
    sections.forEach(function (sec) {
      var hostName = (sec.querySelector('.host-name') || {}).textContent || '';
      var cards = sec.querySelectorAll(':scope > .cards .bot-card');
      var tagEl = sec.querySelector('.blueprint-tag');
      if (tagEl) tagEl.remove();
      var t = document.createElement('span');
      t.className = 'blueprint-tag';
      t.textContent = hostName.trim().replace(/^[▍]\s*/, '') +
        ' · ' + cards.length + ' BOTS';
      sec.appendChild(t);
    });
  }
  // 面板数据是异步加载的，卡片分批出现——用轮询补标
  var tries = 0;
  var iv = setInterval(function () {
    tag();
    if (++tries > 40) clearInterval(iv); // ~10s 后停
  }, 250);
})();
