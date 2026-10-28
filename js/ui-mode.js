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

window.hvSetUiMode = function (mode) {
  try {
    if (mode === 'stram') localStorage.setItem('hv-ui', 'stram');
    else localStorage.removeItem('hv-ui');
  } catch (e) {}
  if (mode === 'stram') document.documentElement.setAttribute('data-ui', 'stram');
  else document.documentElement.removeAttribute('data-ui');
};
