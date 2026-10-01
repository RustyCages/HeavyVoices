// Lägger automatiskt till en "visa lösenord"-knapp (öga) på alla lösenordsfält.
// Inkludera med <script src="/js/password-toggle.js" defer></script> — inga andra ändringar behövs.
(function () {
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19C5.5 19 2 12 2 12a18.4 18.4 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  const style = document.createElement('style');
  style.textContent = `
    .pw-wrap { position: relative; }
    .pw-wrap > input { padding-right: 2.75rem; }
    .pw-wrap:has(> input[style*="display: none"]) { display: none; }
    .pw-toggle {
      position: absolute; top: 0; right: 0.25rem; height: 2.6rem; width: 2.4rem;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; padding: 0; color: var(--text-muted); cursor: pointer;
    }
    .pw-toggle:hover, .pw-toggle:focus-visible { color: var(--accent); background: none; }
  `;
  document.head.appendChild(style);

  function enhance(input) {
    if (input.dataset.pwEnhanced) return;
    input.dataset.pwEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Visa lösenord');
    btn.innerHTML = EYE;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Dölj lösenord' : 'Visa lösenord');
      input.focus();
    });
    wrap.appendChild(btn);
  }

  function run() { document.querySelectorAll('input[type="password"]').forEach(enhance); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
