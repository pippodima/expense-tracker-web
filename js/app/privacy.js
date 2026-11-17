/* Private mode: masking balances or every amount, and tap-to-peek. */
'use strict';

/* ======================= Private mode =======================
   Threat model: someone glancing at your screen. What actually exposes you is
   *wealth* — account balances, the combined total, income and net — not what
   you may spend today. So "Balances" masks those; "All amounts" additionally
   masks every individual figure. Masked values un-blur on tap for a few
   seconds, and can re-hide automatically whenever the app is backgrounded. */

const privacyCfg = () =>
  Object.assign({ on: false, level: 'balances', auto: false }, DB.state.meta.privacy || {});

function applyPrivacy() {
  const p = privacyCfg();
  document.body.classList.toggle('privacy', !!p.on);
  document.body.classList.toggle('privacy-all', !!p.on && p.level === 'all');
}

async function setPrivacy(patch) {
  await DB.setMeta('privacy', Object.assign({}, privacyCfg(), patch));
  applyPrivacy();
}

async function togglePrivacy() {
  const p = privacyCfg();
  await setPrivacy({ on: !p.on });
  toast(privacyCfg().on ? 'Amounts hidden' : 'Amounts visible');
  render();
}

/** Tap a masked figure to peek at it briefly. */
function initPrivacyPeek() {
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('privacy')) return;
    // Only figures that aren't inside a button — otherwise the tap would also
    // trigger that row's action.
    const hit = e.target.closest('.hero-value.sens, .hero-sub, .total-chip, ' +
      '.t-value, .cmp-delta, .cmp-vals, .cmp-diff, .cat-detail-total');
    if (!hit || hit.closest('button')) return;
    hit.classList.add('peek');
    clearTimeout(hit._peek);
    hit._peek = setTimeout(() => hit.classList.remove('peek'), 4000);
  });
}
