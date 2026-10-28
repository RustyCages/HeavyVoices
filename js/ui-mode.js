// Utseendeläge (test): "stram" eller nuvarande.
// Laddas tidigt i <head> så att sidan inte blinkar till i fel utseende.
// Valet sparas i webbläsaren (localStorage 'hv-ui'). Ändras under Mitt konto,
// eller med ?ui=stram / ?ui=klassisk i adressen (praktiskt för att testa snabbt).
(function () {
  try {
    var q = new URLSearchParams(location.search).get('ui');
    if (q === 'stram') localStorage.setItem('hv-ui', 'stram');
    else if (q === 'klassisk') localStorage.removeItem('hv-ui');
    if (localStorage.getItem('hv-ui') === 'stram') document.documentElement.setAttribute('data-ui', 'stram');
  } catch (e) { /* privat läge eller blockerad lagring: nuvarande utseende */ }
})();

// Stramt läge: ta bort inledande emoji i knappar, länkar och rubriker ("💾 Spara" → "Spara").
// Knappar som bara består av en emoji lämnas orörda. Följer med när sidorna ritar nytt innehåll.
(function () {
  if (document.documentElement.getAttribute('data-ui') !== 'stram') return;
  var re;
  try { re = new RegExp('^[\\s\\u200d\\ufe0f]*(?:[\\p{Extended_Pictographic}\\u2295\\u2302-\\u23ff\\u25a0-\\u25ff\\u2700-\\u27bf][\\ufe0e\\ufe0f\\u200d]*\\s*)+', 'u'); } catch (e) { return; }
  var SEL = 'button, a, summary, h1, h2, h3, h4, label, legend, .badge, .tab-btn';
  function clean(el) {
    if (el.closest('[data-keep-emoji], .ui-tabbar')) return;
    var n = el.firstChild;
    while (n && n.nodeType === 1 && /^(svg|img|span|b|i|small|strong)$/i.test(n.nodeName) && !n.textContent.trim()) n = n.nextSibling;
    if (!n || n.nodeType !== 3) return;
    var t = n.nodeValue, m = t.match(re);
    if (!m || !m[0].trim()) return;
    var rest = t.slice(m[0].length);
    if (!/\p{L}/u.test(rest + (n.nextSibling ? n.nextSibling.textContent || '' : ''))) return;
    if (!el.hasAttribute('aria-label') && el.matches('button, a')) el.setAttribute('data-emoji-stripped', '');
    n.nodeValue = rest;
  }
  function run(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SEL)) clean(root);
    root.querySelectorAll(SEL).forEach(clean);
  }
  var queued = [];
  function flush() { var q = queued; queued = []; q.forEach(run); }
  document.addEventListener('DOMContentLoaded', function () {
    run(document.body);
    new MutationObserver(function (list) {
      list.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) queued.push(n); else if (n.nodeType === 3 && n.parentElement) queued.push(n.parentElement); }); });
      if (queued.length) requestAnimationFrame(flush);
    }).observe(document.body, { childList: true, subtree: true, characterData: false });
  });
})();

window.hvSetUiMode = function (mode) {
  try {
    if (mode === 'stram') localStorage.setItem('hv-ui', 'stram');
    else localStorage.removeItem('hv-ui');
  } catch (e) {}
  if (mode === 'stram') document.documentElement.setAttribute('data-ui', 'stram');
  else document.documentElement.removeAttribute('data-ui');
};
