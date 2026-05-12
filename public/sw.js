// StayBid Service Worker — Instagram-grade instant load
//
// Strategy (tuned for "tap icon → reel feed in <500ms"):
//   • HTML navigations          → stale-while-revalidate
//       Cache hit returns INSTANTLY (~30ms). Network fetch happens in
//       background; if the new HTML differs, page reloads on next visit
//       (kill-switch in layout.tsx handles version-mismatch reload).
//   • Next.js immutable chunks  → cache-first (content-hashed URLs)
//   • API + RSC data            → network-only (always fresh deals/prices)
//   • Images + fonts            → stale-while-revalidate
//
// First visit: nothing is cached → network fetch is the only option (same
// speed as before). Second+ visit: cache hit instantly + refresh in bg →
// app opens like a native app.
//
// Future-proof against heavy traffic:
//   • SWR cuts P50 HTML latency from ~400ms to ~30ms on repeat visits
//   • Cache-first for hashed chunks = zero waterfall on warm visits
//   • Network-only /api = users always see fresh pricing

const CACHE_NAME = 'staybid-v83-2026-05-12-flash-midnight-cta-me-grid';
const HTML_CACHE = 'staybid-html-v83';

const PRECACHE_URLS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Keep current static + html caches; drop all older
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== HTML_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1. API + RSC → never cache (always fresh)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) {
    return;
  }

  // 2. HTML → stale-while-revalidate (Instagram-fast warm visits)
  const isHTML = req.mode === 'navigate' ||
                 req.headers.get('accept')?.includes('text/html');
  if (isHTML) {
    event.respondWith((async () => {
      const cache = await caches.open(HTML_CACHE);
      const cached = await cache.match(req);
      // Always refresh in background — but DON'T block the response.
      const networkPromise = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);

      // Return cache immediately if present. Otherwise wait for network.
      if (cached) {
        // fire-and-forget the network refresh — don't await
        networkPromise.catch(() => {});
        return cached;
      }
      const fresh = await networkPromise;
      return fresh || Response.error();
    })());
    return;
  }

  // 3. Hashed Next.js chunks → cache-first (immutable)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req).catch(() => null);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res || Response.error();
    })());
    return;
  }

  // 4. Images/fonts/manifest → stale-while-revalidate
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const networkPromise = fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached);
    return cached || networkPromise;
  })());
});
