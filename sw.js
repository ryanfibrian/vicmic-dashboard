// Vicmic Dashboard service worker — network-first for same-origin, with an
// offline cache fallback. Bump CACHE_NAME on every deploy that changes assets.
const CACHE_NAME = 'vicmic-dashboard-v100';

const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/config.js',
  './js/utils.js',
  './js/ui.js',
  './js/db.js',
  './js/auth.js',
  './js/router.js',
  './js/excel.js',
  './js/priceCalc.js',
  './js/theme.js',
  './js/pages/dashboard.js',
  './js/pages/pricelist.js',
  './js/pages/reports.js',
  './js/pages/users.js',
  './js/pages/upload.js',
  './js/pages/settings.js',
  './js/pages/courier.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Let the browser handle cross-origin (CDN scripts, Supabase, Google, fonts).
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
