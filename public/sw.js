// StayBid Service Worker — Instagram-grade instant load
//
// Strategy (tuned for "tap icon → reel feed in <500ms"):
//   • HTML navigations          → stale-while-revalidate
//       Cache hit returns INSTANTLY (~30ms). Network fetch happens in
//       background; controllerchange in layout.tsx swaps the user onto
//       the new build on the NEXT navigation.
//   • Next.js immutable chunks  → cache-first (content-hashed URLs are
//                                 globally unique → never stale)
//   • Safe GET feed APIs        → SWR (v107 — was network-only)
//       /api/social/feed, /api/flash/near. The endpoints already
//       server-side cache via sbCached, but the round-trip was the
//       killer on mid-tier Android + India 3G. SWR returns the warm
//       response in ~30ms while a background revalidate keeps it
//       fresh. Result: home-page open feels native after first visit.
//   • Other APIs + RSC data     → network-only (mutations, personalised
//                                 endpoints with auth or POST body)
//   • Images + fonts            → stale-while-revalidate
//
// First visit: nothing is cached → network fetch is the only option (same
// speed as before). Second+ visit: cache hit instantly + refresh in bg →
// app opens like a native app.
//
// v93 — cache names are now STABLE across releases. Previously each release
// renamed both caches, so the activate handler dropped the entire warm
// cache and every returning user paid a full cold-start. With content-
// hashed chunk URLs, the same `static` cache is safe to reuse forever —
// new builds simply add new entries. HTML is SWR so stale content is
// always refreshed in the background. Bump CACHE_NAME ONLY when this
// fetch-handler logic changes, not on every UI release.
//
// v107 — bumped to v2 because the fetch handler now applies SWR to a new
// class of requests (safe GET feed APIs). Without a bump, returning users
// would keep hitting the v1 SW that skips API responses entirely.
//
// Future-proof against heavy traffic:
//   • SWR cuts P50 HTML latency from ~400ms to ~30ms on repeat visits
//   • Cache-first for hashed chunks = zero waterfall on warm visits
//   • SWR for shared GET feed APIs = first card paints almost instantly
//   • Network-only for mutations/personalised = users always see fresh
//   • Stable cache name across UI releases = no cold-start punishment

// v112.4 — one-time HTML_CACHE bump (v2 → v3). Users between v112.0
// and v112.2 had stale HTML cached via SWR that still referenced the
// pre-v112.2 PostsScrollFeed chunk (old single-field "Edit caption"
// sheet) — even though v112.2 + v112.3 had shipped to main, the SW
// kept serving the cached HTML which kept loading the old chunks.
// On next visit the SW activate handler drops any cache not in the
// keep-set below, the stale HTML is purged, and a fresh HTML fetch
// loads the new chunk references → user sees the comprehensive
// Edit Post sheet (Caption + Location + Tagged hotel + Highlight +
// Hide likes + Disable comments). Static + API cache names left
// alone (hashed chunks are immutable, API is network-only).
const CACHE_NAME = 'staybid-static-v2';
// v131 — one-time HTML_CACHE bump (v4 → v5). Users on v130 had SWR-cached
// HTML from the brief window during the v131 deploy where wrong column
// names in social_posts / hotel_videos / social_profiles projections made
// PostgREST 400 the entire response. Bumping the cache name forces the
// activate handler to drop the stale HTML → fresh fetch on next nav.
// v194.1 — one-time HTML_CACHE bump (v5 → v6). After v192-v194 merge,
// mobile users were getting stuck on v191 HTML — SWR was serving the
// stale cached copy from staybid-html-v5 and the background fetch
// wasn't progressing to a re-render on second visit. Same recovery
// pattern as the v131 bump.
// v224 — one-time HTML_CACHE bump (v6 → v7). Sachin was stuck on v222
// HTML for 10+ hours despite v223 being deployed — SWR HTML strategy
// kept serving cached v222 markup on every reopen.
// v225 — one-time HTML_CACHE bump (v7 → v8). v223 disabled desktop
// success takeover + v217 had disabled mobile success overlay; net
// result was NO visible confirmation on either surface after Launch
// Bid. v225 re-enables the success OVERLAY (not a takeover — climber
// stays mounted underneath) for both surfaces. Cache bump forces
// every device to fetch v225 HTML on next page load so the fix
// reaches users immediately instead of waiting for the SWR cycle.
const HTML_CACHE = 'staybid-html-v8';
const API_CACHE  = 'staybid-api-v2';

const PRECACHE_URLS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Safe-to-SWR GET API endpoints. POST routes and routes with `Authorization`
// headers are deliberately skipped — they're personalised. A request only
// qualifies if (a) path matches one of these prefixes AND (b) the request
// has no Authorization header AND (c) method === GET.
const SWR_API_PREFIXES = [
  '/api/social/feed',
  '/api/flash/near',
  '/api/hotels',
  '/api/discover/saves/enriched',
];

const isSwrApi = (url, req) => {
  if (req.method !== 'GET') return false;
  if (req.headers.get('authorization')) return false;
  return SWR_API_PREFIXES.some((p) => url.pathname.startsWith(p));
};

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Keep current static + html + api caches; drop all older
    const keep = new Set([CACHE_NAME, HTML_CACHE, API_CACHE]);
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
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

  // 1. RSC data → never cache
  if (url.pathname.startsWith('/_next/data/')) return;

  // 2. Safe GET feed APIs → SWR (v107 new lane)
  //    Cache hit returns in ~30 ms; background refresh keeps data ≤ 30 s old.
  if (url.pathname.startsWith('/api/') && isSwrApi(url, req)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req).then((res) => {
        // Only cache 200s with JSON-ish content. Skip 4xx/5xx so a transient
        // backend hiccup doesn't poison the warm response.
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) {
        networkPromise.catch(() => {}); // fire-and-forget
        return cached;
      }
      const fresh = await networkPromise;
      return fresh || Response.error();
    })());
    return;
  }

  // 3. All other APIs (POST routes are handled by the method check above,
  //    GETs with Authorization or non-SWR prefixes get network-only).
  if (url.pathname.startsWith('/api/')) return;

  // 4. HTML → stale-while-revalidate (Instagram-fast warm visits)
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

  // 5. Hashed Next.js chunks → cache-first (immutable)
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

  // 6. Images/fonts/manifest → stale-while-revalidate
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
