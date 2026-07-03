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
// v226 — one-time HTML_CACHE bump (v8 → v9). v225 still left two
// silent-fail paths in /bid submit(): the !user redirect and the 409
// conflict branch both returned without setting submitError, so the
// Review modal stayed on its hourglass "Launch your bid first" branch
// — looked indistinguishable from "never tapped Launch". v226 sets
// submitError on both paths so the modal ALWAYS shows a reason. Also
// removes the BidGameZone ambient drone (user feedback: "background
// sound chal raha hai jiska koi kaam nahi"). Cache bump forces fresh
// HTML on next visit so the fix lands without an SWR cycle wait.
// v227 — one-time HTML_CACHE bump (v9 → v10). Three independent fixes
// ship together: (a) hotel detail page was scroll-locked when a user
// arrived from /discover or /reels — the `is-reel-page` body class
// (position:fixed; overflow:hidden; height:100vh) wasn't always
// cleaned by useReelFullscreen's unmount on fast Next.js client-side
// nav. /hotels/[id] now defensively strips the class on mount. (b)
// /bid's mandatory "pick 3 property types" rule is gone — zero picks
// = "Any type" + a single pick advances Step 1. (c) /bid's submit()
// property-type + meal-plan filters soften from HARD-throw to
// SOFT-fallback so Dhanaulti (resort/lodge/camp/hotel only) no
// longer rejects a user who picked villa/cottage/homestay; the bid
// launches across every city hotel and the preference is recorded in
// `requirements` for the hotel to read. Cache bump forces v227 HTML
// delivery on next visit.
// v228 — one-time HTML_CACHE bump (v10 → v11). Two user-facing fixes:
// (a) /bid Step 6 "Review Bid & Visit" used to surface a confusing
// generic "Couldn't reach hotels · Try Again" card whenever the city
// already had an active bid — even though the ActiveBidConflictSheet
// also opened on top. Now the Step 6 error branch detects bidConflict
// and shows a dedicated card: "You already have an active bid in {city}"
// + ₹X/night recap + 👀 View Active Bid → (routes to /my-bids#bid-id)
// + ✏️ Update existing budget (reopens the sheet). Generic error card
// preserved for every NON-conflict failure mode. (b) BookingReview
// modal payment options were cut from the bottom on the Shimla flow:
// the old `maxHeight: calc(94vh - 64px - 96px)` body cap assumed a 96px
// footer, but Pay Full + Hold + Pay-at-Hotel rendered ~220px → body
// extended behind the CTAs. New flex layout (header shrink-0 · body
// flex-1 min-h-0 · footer shrink-0 + env(safe-area-inset-bottom) inset)
// makes the body shrink to whatever the footer leaves free, regardless
// of how many CTAs render. Cache bump forces v228 HTML delivery on
// next page open so the fix lands without an SWR refresh cycle wait.
// v229 — one-time HTML_CACHE bump (v11 → v12). Three bid-washout +
// customer-cancel fixes ship together: (a) NEW endpoint POST
// /api/bids/:id/cancel on staybid-Live for customer-side withdrawal of
// own PENDING/COUNTER bids (the conflict sheet "Cancel" button had been
// a UI-dismiss only since launch — now actually flips status=CANCELLED).
// (b) /api/cron/expire-holds now also runs mark_orphaned_accepted_bids()
// — flips ACCEPTED bids to EXPIRED when the 15-min acceptance window
// died and no payment landed (20+ orphan rows verified in prod showing
// "Pay Now" forever). (c) mark_stale_pending_bids extended to also
// sweep COUNTER rows past expiresAt+6h (1 stuck COUNTER bid verified
// 9 days old in prod). The Railway counter endpoint also resets
// expiresAt so a hotel countering at minute 55 of a 60-min /bid no
// longer leaves the customer 5 min before sweep. /my-bids gets a new
// ✕ Cancel bid CTA on every PENDING/COUNTER row; STATUS_META gains
// CANCELLED + EXPIRED entries. Cache bump forces v229 HTML on next
// page open.
// v230 — one-time HTML_CACHE bump (v12 → v13). Four UX fixes ship
// together: (a) /bid "Pay Now & Grab" CTA — previously navigated to
// /my-bids and the auto-open BookingReview effect only fired for
// ACCEPTED bids → user landed on the bid list (Issue 1). Now the
// effect also fires for PENDING/COUNTER bids landing from /bid auction
// so the BookingReview modal opens immediately. (b) /bid uses
// router.replace (was push) for the Pay Now nav so back from /my-bids
// doesn't return to /bid Step 1 form (Issue 2). (c) ActiveBidConflict-
// Sheet's onClose no longer nulls bidConflict — split sheet visibility
// into conflictSheetOpen state so the Step 6 conflict-aware card with
// hotel name + amount + "View Active Bid →" CTA stays rendered even
// after the user dismisses the sheet (Issue 3). (d) /my-bids hides
// EXPIRED + CANCELLED bids from default view (Place Bid / Negotiate
// tab counts updated to match). The v229 DB cleanup left 116+ EXPIRED
// rows visible under ALL filter; users explicitly asked for them gone
// (Issue 4). Cache bump forces v230 HTML delivery on next page open.
// v231 — one-time HTML_CACHE bump (v13 → v14). When customer has an
// active bid for a hotel placed via /bid reverse-auction, the bid
// often carries no specific roomId. Pre-v231, every room on /hotels/[id]
// fell back to Book Now + Negotiate buttons because lockedRoomId
// matched nothing. Fix: auto-anchor the bid to the cheapest non-flash
// available room → cheapest room shows the locked CTA, every other
// room surfaces as an Upgrade candidate priced as bid amount + room
// rent difference. Same fallback covers PENDING + COUNTER orphans
// without roomId. Plus: OTA market-comparison block now gates on
// otaSaving > 0 so when StayBid is NOT cheaper, the whole block
// disappears (no empty space) — premium-clean room body.
// v232 — one-time HTML_CACHE bump (v14 → v15). The 15-min acceptance
// timer was NOT real-time. AcceptedBidTimer's v74 "reset on stale"
// branch RE-CREATED a fresh 15-min window every time the customer
// opened /my-bids on a bid that was accepted >15 min ago. An 8-day-
// old bid showed "12:43 remaining" every page refresh, forever. Fix:
// trust the bid's actual acceptedAt (server timestamp), compute the
// real expiresAt from it, render expired state when past. Plus: the
// hydration merge now ALWAYS prefers the server's acceptedAt (the
// "save only if local is older" condition was backwards — local was
// always newer because the reset branch just stamped now()). Plus:
// /my-bids now applies filterActiveBids so visually-stale ACCEPTED-
// unpaid + COUNTER + PENDING bids drop off the customer's views the
// moment they cross their per-status window — no waiting for the
// 15-min mark_orphaned_accepted_bids cron to catch up.
// v233 — bump v15 → v16. Surgical fix on top of v232's /my-bids
// filter. The full filterActiveBids() rule set included a hard
// IST-midnight cutoff that hid FRESH PENDING bids when the customer
// crossed midnight (Sachin: "bid launch hone ke baad place bid section
// empty show kar raha hai"). Replaced with a 15-min ACCEPTED-unpaid
// gate — the only case v232 actually needed. PENDING/COUNTER bids
// always stay visible until the DB cron flips them to EXPIRED.
// v234 — bump v16 → v17. Three fixes ship together: (1) Broader
// /my-bids stale-bid filter covering PENDING + COUNTER + REJECTED via
// per-status windows but WITHOUT the IST-midnight cutoff that bit v232
// (Sachin: "ek bid pending reh gyi hai" — 32-day-old PENDING row stuck
// visible because v233 only handled ACCEPTED-unpaid). 30-min fresh-grace
// shields just-launched bids from any clock-skew false-positive. (2)
// Place Bid detection now ALSO trusts the server's `flow` field when
// echoed back from Railway, regex stays as fallback for legacy rows.
// (3) Desktop top-nav rename "Place Bid" → "Bid" so it matches the
// mobile bottom dock + drawer label.
// v235 — bump v17 → v18. Desktop /bid surface rewrite: the climber +
// boot screen now fills the entire viewport (was a 600-720px portrait
// card with the old cream Navbar + "Name Your Price" hero + StepBar
// leaking through the surrounding empty band on MacBook Pro). Page-
// level hero + StepBar hidden on Step 1; `.bx-page-wrap` swapped for
// `.bx-page-wrap-climber` (no max-width, no padding); `.bgz-stage.
// cmm-stage` desktop max-width 600/680/720 → none. Back chip z-index
// 80 → 200 so it stays clickable above the fullscreen .bgz-stage
// isolation context.
// v236 — bump v18 → v19. Two fixes. (1) Revert v235's chrome removal:
// Sachin's feedback "full screen ka mtlb yeh nhi tha ki jab baar bhi
// remove ho jaye ur na hi koi nav baar hai na hi koi scroll karne ke
// liye scroller ya gesture button. Ek simple solution chahiye". Slim
// hero + StepBar restored on Step 1 + climber back to centered
// portrait card (widened 720/820/920 from v221's 600/680/720). Back
// chip z-index 200 stays. (2) CRITICAL ghost-conflict fix in
// /api/bids/place: findActiveBidOnHotel now also skips bids that are
// past their per-status window (PENDING 1h-place/3h-negotiate/6h-cap,
// COUNTER 60min, ACCEPTED-unpaid 15min) mirroring lib/bid-expiry.ts
// + v193 server cron. Sachin: "Dhanaulti abhi bhi active bid show
// kar raha hai jabki SS2 main clearly mention hai ki koi bhi active
// bid show nhi ho rahi" — root cause: v193 cron delayed → bid stays
// PENDING in DB → conflict check ghosts → /my-bids client filter
// hides it → user trapped. v236 closes the gap client-side.
// v237 — bump v19 → v20. /bid desktop chrome rewrite #3 (v235 fullscreen
// hid navbar, v236 constrained climber broke fullscreen, v237 lands the
// real ask): climber + boot screen render edge-to-edge BELOW the Navbar.
// .bgz-shell `top: 0` → `top: 56px` carves out Navbar room. Navbar
// z-50 → z-1100. .bgz-stage.cmm-stage desktop max-width restored to
// `none`. Back chip z-200 → z-1200 stays above everything. Sachin:
// "yeh mobile ki traha full screen ho raha tha nav baar hide ho raha
// tha jish se confused ho raha tha ki ab ish page se dushre page pe
// kaishe jayege. Full screen ka matlb yeh bhi tha ki nav baar bhi
// rakhna".
// v238 — bump v20 → v21. Three fixes: (1) OTA comparison block on
// /hotels/[id] room cards was invisible because .hx-reveal-io
// stayed at opacity:0 — the IO observer only re-runs on hotel.id
// + tab change, but the OTA block mounts later (after datesSelected
// becomes true) and was never observed. Removed .hx-reveal-io from
// both the OTA block AND the Available Rooms wrapper. Sachin's SS3/
// SS4 blank space between chips + Pay CTA now shows the OTA bars.
// (2) /bid climber shell gets ALWAYS-VISIBLE scrollbar on desktop
// (≥1024px). Mobile keeps touch-scroll. Sachin: "laptop ya destop
// par scroll baar ya fir navigation gesture se hi karega na toh
// ko premium lage". (3) Review Bid modal's live-responses list gets
// capped height + visible scrollbar so multiple hotel responses
// scroll WITHIN the modal instead of blowing past viewport.
// v239 — bump v21 → v22. Two surface-bug fixes Sachin caught on the
// staybids.in admin + partner panels: (1) Admin /admin/bookings was
// rendering the Bid ID column as `BID-{id.slice(0,8)}`. CUIDs share
// a timestamp-derived 8-char prefix (`bid_mpn0/1/2/q…`), so 10+
// adjacent rows looked identical. Switched to last-6 suffix
// (`BID-…xxxxxx`) which is the random portion — visually distinct
// per row. Full id kept in title attribute. Same fix applied to the
// detail-modal heading. (2) Partner /partner/dashboard Bid Inbox
// "Accepted (24)" tab counted raw bids while the list rendered the
// stale-filtered set — 24 ACCEPTED in DB but only 6 within the
// 15-min unpaid window. Tab now counts activeBidsForInbox so
// count = list rows. Cache bump forces fresh HTML on next visit.
// v240 — bump v22 → v23. Future-proof fix for /my-bids "Place Bid
// section empty" feedback cycle (v233/v234/v240). Two structural
// changes: (a) bid_requests gains a `source` column stamped at
// /api/bids/request time (place|negotiate|direct|flash). /my-bids
// detection reads b.request.source server-authoritatively instead
// of the v234 message-regex which broke whenever a path stripped
// the message. (b) resolveUserIds widened from phone-only to also
// walk email + reject Firebase `unknown_<uid>` placeholder phones.
// Pre-v240 a user who placed bids via Google Firebase (customerId
// =`Ld6xDB42…`) then opened /my-bids via Phone OTP (`cmnr4b8ol…`)
// missed every Firebase-authored bid because resolver didn't link
// the two identities. Cache bump forces v240 HTML delivery on next
// visit.
// v241.3 — HTML_CACHE bump v25 → v26 because /auth now reads a
// ?return query param + a new lib/auth-intent.ts module gates every
// sign-in-then-resume flow. Stale v25 HTML would still router.push("/")
// after sign-in, defeating the whole point of v241.3.
// v243 — one-time bump (v26 → v27). The SB_BUILD badge sat stuck on "v242"
// across PRs #186-#195 (it was never bumped), and returning visitors on the
// SWR HTML cache kept seeing the old build label + occasionally stale markup
// even though all those PRs had shipped to main. Bumping HTML_CACHE drops the
// stale HTML on next visit so everyone lands on the current build immediately.
// v246 — one-time bump (v29 → v30). EXPIRED/CANCELLED bids were being treated
// as "active" by lib/bid-expiry (no terminal-status branch), so the hotel page
// kept surfacing the one-bid-per-hotel conflict sheet + /my-bids kept showing a
// dead bid. The fix is client-side, so returning visitors on the SWR HTML cache
// must drop the stale v29 HTML to pick up the corrected bundle on next visit.
// v247 — one-time bump (v30 → v31). Multi-room consistency: Book Now preview +
// Negotiate arena now multiply the total by rooms (were showing 1-room totals),
// the picker auto-suggests rooms from the guest mix, and real per-unit
// inventory blocking (N rooms block N units, date-aware oversell guard) lands.
// All client-rendered, so drop the stale v30 HTML on next visit.
// v247.4 — one-time bump (v34 → v35). The v247.2/v247.3 software back-guard
// couldn't beat Next.js's router, so the reel restored the immersive
// Fullscreen request (the only reliable way to absorb Android's edge
// back-gesture). Client-rendered, so drop stale v34 HTML.
// v250 — premium verification-video overhaul (customer + partner + admin):
// new TrustRing / VerifChecklist / VerifStatusFlow surfaces. Drop stale v35.
// v256 — kiosk mobile sizing: display QR no longer clips behind footer;
// book-flow horizontal overflow (left-cut) fixed. Drop stale v48.
// v257 — kiosk book: premium compact header, rooms picker + hybrid auto-fit,
// check-in/check-out date summary with nights. Drop stale v49.
// v258 — kiosk display: kills the QR↔CTA blank space (flex space-between +
// scan band), active/clickable kiosk-native hotel scorecard, animated QR
// scan-line + shimmering Scan-to-book CTA. Bump so warm SWR clients pick up
// the new markup on next visit.
// v263 — admin-approval-before-live gate (discovery surfaces filter on
// approval_status='approved') + sole-proprietor KYC copy + admin review
// queue + express real-query scraper fix. Bump so warm SWR clients pick up
// the new admin/wizard markup on next visit.
// v263.3 — Express AI onboard rebuilt as a TWO-PHASE flow: hotel name + city
// BOTH mandatory → Gemini location-filters then lists real candidates → owner
// confirms which is theirs → deep-scrape ONLY the confirmed property (real
// og:image photos + room categories without prices). Kills the fabricated
// single-shot scrape. Drop stale v54 HTML so the new wizard markup loads.
// v263.4 — Onboard "City" free-text field replaced with a REAL geotag location
// picker (device GPS reverse-geocode + Nominatim forward search). One pick
// captures verified city/state/lat/lng → seeds the manual form AND tightens
// the Express AI candidate search. Bump so warm SWR clients load the new
// wizard markup.
// v264 — Passport cum Wallet hub at /passport. The /wallet, /points,
// /points/redeem, /my-codes routes now redirect into the unified tabbed hub
// (Passport · Wallet · Rewards · Codes). Drop stale v56 HTML so warm SWR
// clients load the redirect shells + new hub markup.
// v265 — Partner "Passport Guests" tab (read-only Explorer Passport holders
// per hotel). Bump so warm SWR clients load the new partner dashboard markup.
// v267 — Admin Passport (config/issue/adjust) at /admin/passport + bonus_xp
// column. Bump so warm SWR clients load the new admin-route markup.
// v268 — Passport 3D medals: PassportMedal + PassportDetailSheet (tap-to-open
// animated 3D badge/stamp/reward). Bump so warm SWR clients load new markup.
// v269 — Reflective cast-metal medals (glare + specular + rivets), native
// gold-gradient IDs, clickable HowItGrows, reflective Family Passport. Bump
// so warm SWR clients load the new markup.
// v278 — Host "My activity" page (/host/me) + hero entry-point link. Bump so
// warm SWR clients load the new /host markup.
// v281 — Host property-listing separation (/host/list-property + admin
// Property Listings tab). Bump so warm SWR clients load the new /host markup.
// v282 — Host catalog admin CRUD (/admin/host/catalog). Bump so warm SWR
// clients load the new admin markup.
// v283 — Workforce onboarding + worker panel (/worker, /host/workforce/join,
// admin Workers tab). Bump so warm SWR clients load the new markup.
const HTML_CACHE = 'staybid-html-v71';
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
