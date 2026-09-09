/* Service worker: network-first for our own files (so updates always reach the
   device when online), cache fallback so the app still works fully offline. */
const CACHE = 'expense-tracker-v44';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/util.js',
  './js/db.js',
  './js/charts.js',
  './js/csv.js',
  './js/detect.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // don't touch cross-origin

  /* Network-first: fetch fresh, update the cache, fall back to cache when offline.
     `cache: 'reload'` matters more than it looks — without it this fetch is still
     served by the browser's own HTTP cache, and a host sending `max-age=600` (GitHub
     Pages does) can hand back yesterday's app.js while we believe we went to the
     network. That made a shipped feature invisible on an installed copy. */
  e.respondWith(
    fetch(e.request, { cache: 'reload' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
