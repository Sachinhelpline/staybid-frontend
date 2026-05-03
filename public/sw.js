// StayBid Service Worker — network-first strategy
// Bump CACHE_NAME on every release so browsers fetch the new code.
const CACHE_NAME = 'staybid-v15-2026-05-03-reels-creator-watchtime';

const PRECACHE_URLS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  // Activate this SW immediately, skip waiting phase
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete ALL old caches (including v1/v2) so old HTML/JS chunks are purged
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      // Take control of all open tabs immediately
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Skip non-GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // NEVER cache API routes, auth, or Next.js RSC payloads — always fresh
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/data/') ||
    url.pathname.startsWith('/_next/static/chunks/pages/') === false &&
      req.headers.get('accept')?.includes('text/html')
  ) {
    // Network-first for HTML navigations
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Optional: cache a copy of successful HTML for offline fallback
          if (res.ok && req.headers.get('accept')?.includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for immutable static assets (icons, fonts, hashed Next.js chunks)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && (url.origin === self.location.origin)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

// Allow the page to tell SW to skip waiting
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
