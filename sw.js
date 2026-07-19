const CACHE_NAME = 'vicmic-dashboard-v39';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Install: cache essential assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(
                names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: Network-first, fallback to cache for offline support
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Skip caching for external resources (Google, Supabase, SheetJS CDN)
    if (url.origin !== location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // If network succeeds, cache the fresh response
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                // If network fails (offline), try the cache
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    // Fallback to index.html for navigation requests (SPA)
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
