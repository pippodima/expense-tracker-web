/* Boot: load data, wire global events, register the service worker. Load this file last. */
'use strict';

/* ======================= Boot ======================= */

async function boot() {
  await DB.init();
  await repairData();  // heal any raw/mis-imported records before first render
  focusLatestData();   // don't open onto an empty current month when data is elsewhere

  // Autosave: snapshot after changes and whenever the app is backgrounded/closed.
  await restoreFileHandle();
  DB.onWrite = scheduleAutosave;
  applyPrivacy();
  initPrivacyPeek();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      runAutosave('hidden');
      // Re-hide amounts when the app goes to the background, if asked to
      if (privacyCfg().auto && !privacyCfg().on) setPrivacy({ on: true }).then(render);
    }
  });
  window.addEventListener('pagehide', () => { runAutosave('close'); });
  $$('.tabbar [data-tab]').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.tab)));
  $('#fab').addEventListener('click', () => openTxSheet(null));
  // Re-render charts when the system theme flips
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => render());
  }
  show('dashboard');

  // Deep link: ?action=add opens straight into a new transaction (used by the
  // Home/Lock Screen Shortcut). Clear the param so a refresh doesn't re-open it.
  const launched = handleLaunchAction();
  if (!launched) maybeRemindBackup();
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (refreshToday()) render();      // a new month started while suspended
      if (!handleLaunchAction()) maybeRemindBackup();
    }
  });

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' ||
       location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      /* An installed PWA can stay resident for days, so registration alone never
         notices a new release. Re-check whenever the app comes back to the front;
         when a new worker takes over, reload once so the running page isn't half
         old code and half new. */
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    }).catch((e) => console.warn('SW registration failed:', e));
  }
}

function handleLaunchAction() {
  const params = new URLSearchParams(location.search);
  if (params.get('action') === 'add') {
    history.replaceState(null, '', location.pathname);
    if (!document.querySelector('.sheet')) setTimeout(() => openTxSheet(null), 250);
    return true;
  }
  return false;
}

document.addEventListener('DOMContentLoaded', boot);
