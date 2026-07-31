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
// v288 — StayCircle™ Community Partner Platform (/circle vertical + nav
// entries + partner StayCircle tab + admin page). Bump so warm SWR clients
// load the new menu rows + chrome hide-gates.
// v289 — StayCircle Discover rebuilt as Instagram-style reel feed + Airbnb
// filter pill bar + full property-tour page (/circle/[id]) + admin media
// upload. Bump so warm SWR clients load the new reel-feed markup.
// v291 — StayCircle reel native 9:16 stage (no control overlap, responsive),
// clear Bundle/Invest CTAs, List-property entry + per-room accordion tours +
// auto-comparison table on /circle/[id]. Bump so warm clients get the markup.
// v291.1 — laptop reels black-screen fix (persistent poster layer), Invest→
// "Lock for Investment", Support/Tour widgets hidden on /circle, List-property
// re-routed to the public lease panel /host/list-property (was /admin/circle).
// v291.2 — reel: removed the duplicate top "Bundle" pill (single "Lock for
// Investment" CTA + a "✓ Locked" state tag); /circle/build: each locked
// property now has an "✕ Remove" button to unlock/remove it anytime.
// v291.4 — laptop black screen ROOT-CAUSE fix (found via live headless
// inspect): app/desktop.css pins `html.is-reel-page{--reel-vh:auto!important}`
// at ≥1024px, which poisoned StayCircle's `height:var(--reel-vh)` reel cards
// → collapsed to 0 → black. Fix: on ≥700px force .sbc-rapp/.sbc-rfull/
// .sbc-rfull-stage to a LITERAL 100dvh (immune to the poisoned var) with
// position:fixed. Verified: rfull=1440x820, stage=461x820 (9:16 portrait).
// v292 — StayCircle full-screen ROOM-TOUR reel: the "Rooms" dock now opens an
// immersive one-reel-per-room feed (ken-burns of each room's photos + property
// film toggle + full amenities/view/ROI/desc), city/property-wise, with
// Add-to-Bundle + Remove-property; replaces the old room bottom-sheet.
// v293.1 — StayCircle property/room reels no longer force native fullscreen
// (useReelFullscreen({ immersive:false })); full-bleed layout preserved.
// v293.2 — room-tour overlay z-index 60→50 so the bottom dock stays visible.
// v293.4 — Step-2 room reel replaced by a clean room-selection sheet.
// v294 — reel Lock = lock-only (no auto-jump) + tap-to-release; every room is
// a select+lock stepper that expands into a shared complete tour (gallery +
// all amenities + full details); /circle/[id] room cards get the same picker.
// v294.8 — /circle home: 3D gold quick-action tiles, de-stretched desktop
// hero (2×2 right-sized cards), capped + clarified "Build Investment Bundle" CTA.
// v294.9 — /circle/build Investment & Returns: revenue → bifurcation → net
// income breakdown (gross revenue − StayBid management % = your net income).
// v294.10 — /circle home portfolio snapshot routed through the SAME
// computeBundle engine as build (no drift) + relabelled "potential across N
// locked properties" + diversification-bonus note (SS1↔SS2 consistency).
// v294.11 — SS3 rooms sheet: wide-desktop auto-fill grid fills the canvas (no
// left/right dead space, cards never stuck) + mobile bottom nav stays visible
// while choosing rooms (dock raised above the sheet in its reserved strip).
// v295.1 — one-time HTML_CACHE bump (v110 -> v111). The desktop CircleTopbar
// "Discover"/"Rooms" nav links now dispatch sbc:rooms-close / sbc:rooms
// instead of plain same-URL <Link> navs, so tapping header "Discover" while
// the room-select sheet is open closes it (the sheet was staying stuck on
// laptop because the bottom dock — which had this wiring — is CSS-hidden
// ≥1024px). SWR-cached HTML must refresh so the header carries the new wiring.
// v297.1 — one-time HTML_CACHE bump (v113 -> v114). StayCircle /circle/build
// dropped the monthly single-property lock (every plan now works for
// multi-property bundles) and re-worked the pay row so the refundable
// security deposit is visibly separate from the advance rent + carries an
// explicit "returns are unaffected by it" note. SWR-cached HTML must refresh.
// v297.3 — one-time HTML_CACHE bump (v115 -> v116). StayCircle /circle/build
// Investment & Returns polish: platform-fee + management rows now show per-plan
// SAVINGS ("↓ you save ₹X vs Monthly"), booking-revenue (gross) is a bold
// highlighted reflective-shimmer card showing BOTH the plan-period total AND the
// /mo turnover, investment shows the total advance alongside the /mo figure, and
// a pre-known "Property from date" picker (rent-start, server-clamped to
// available_from) was added.
// v297.4 — one-time HTML_CACHE bump (v116 -> v117). StayCircle /circle home
// "Portfolio potential" snapshot now derives from the SAME room-selection state
// (sb_circle_room_sel_v1) + same computeBundle + same revenue-config that
// /circle/build uses, so the two pages can never show divergent property count /
// monthly investment / income / diversification numbers. SWR-cached HTML must
// refresh so the unified snapshot ships.
// v298 — one-time HTML_CACHE bump (v118 -> v119). Partner dashboard gains a
// multi-property switcher (owners with 2+ hotels). The dashboard render + the
// partner API routes now thread ?hotelId= so every tab scopes to the active
// property. SWR-cached HTML must refresh so the switcher + threaded fetches ship.
// v305 — one-time HTML_CACHE bump (v122 -> v123). Host "List your property"
// gains real Google/OSM location, a comprehensive listing form, and a
// per-property owner/admin reel+photo studio (/host/property/[id]). SWR-cached
// HTML must refresh so the new pages + routes ship.
// v306 — host list-property photo upload moved server-side (service-role,
// real per-file errors + progress). SWR HTML refresh so the fixed page ships.
// v307 — host list-property redesigned to professional hospitality onboarding
// (property types, per-category room builder, room vs property amenities,
// meal plans, add-ons, policies, name-resolve location). SWR HTML refresh.
// v308 — one-time HTML_CACHE bump (v125 -> v126). Admin catalog Listings
// editor rebuilt for hospitality: property-type select, room builder,
// property vs room amenities, meal plans, add-ons, policies. SWR HTML refresh.
// v309 — one-time HTML_CACHE bump (v126 -> v127). Admin "Approve + Provision"
// on a listing → creates the operated StayBid-Circle hotel (rooms + units),
// grants the lister /partner/dashboard access via unit-ownership. SWR HTML.
// v310 — one-time HTML_CACHE bump (v127 -> v128). owner_type='host_circle'
// discriminator surfaced: /admin/hotels Type badge + partner-dashboard
// "Operated by StayBid" chip. SWR HTML refresh.
// v313 — one-time HTML_CACHE bump (v130 -> v131). StayCircle room-category
// builder gains per-room photo upload + per-room amenities (admin +
// /circle/onboard, shared form); focus-loss "one letter at a time" bug fixed
// by hoisting <Section> out of the render body. SWR HTML refresh.
// v325 — one-time HTML_CACHE bump (v137 -> v138). Circle multi-investor Phase A:
// the partner "My Rooms" tab (CircleUnitsTab) gains a per-unit auto-confirm
// mode control. Bumping HTML_CACHE drops the stale cached partner-dashboard
// HTML so operators see the new control on next visit.
// v326 — one-time HTML_CACHE bump (v138 -> v139). Circle multi-investor Phase B:
// OtaFeedManager gains a per-unit picker (a StayBid Circle investor attaches an
// OTA/Airbnb iCal feed to a specific room they own). Fresh HTML so the picker
// + per-feed unit chip appear on the Availability / Channel Manager tabs.
// v333 — one-time HTML_CACHE bump (v145 -> v146). Circle multi-investor Phase D3:
// Model 4 B2B marketplace (buy other investors' listings) + admin settlement
// payout execution. Bumping HTML_CACHE drops the stale cached partner-dashboard
// + admin HTML so the new marketplace panel + payout table ship on next visit.
// v334 — one-time HTML_CACHE bump (v146 -> v147). Circle multi-investor Phase D4:
// dynamic B2B markdown badge on listed exchange listings + admin exchange
// oversight (expire/cancel listings). Drops stale cached partner + admin HTML.
// v335 — one-time HTML_CACHE bump (v147 -> v148). Circle Phase E: Model-1
// "expected income" legal language — every StayCircle income/return/payout
// surface now reads "expected, based on actual bookings, never guaranteed"
// (the "guaranteed monthly inflow" copy is gone). Drops stale cached
// partner-dashboard + /circle HTML that still shows the old wording.
// v336 — one-time HTML_CACHE bump (v148 -> v149). Circle Phase F: operated
// supply growth — the /admin/host Property Listings tab gains a one-tap
// "🚀 Go Live" on a provisioned (DRAFT) host-circle hotel, so the list →
// provision → publish journey completes from one admin surface. Drops stale
// cached /admin/host HTML that lacks the Go Live control.
// v337 — one-time HTML_CACHE bump (v149 -> v150). Customer /circle home gains
// the premium "3 Ways to Grow" hub (Model 1 Managed Income · Model 3 Pre-Buy
// Deals · Model 4 Investor Exchange) + a live member pre-buy strip. Bumping
// HTML_CACHE drops the stale cached /circle markup so the hub shows on first
// warm visit.
// v338 — one-time HTML_CACHE bump (v150 -> v151). The Model 3 "Pre-Buy Deals"
// card now routes to the investor pre-buy inventory (/partner/dashboard) instead
// of the customer /flash-deals page — it's an investor path, not a same-day
// customer deal. Bumping HTML_CACHE drops the stale cached /circle markup so the
// corrected link shows on first warm visit.
// v341 — one-time HTML_CACHE bump (v153 -> v154). Circle Marketplace M2:
// Model-3 pre-buy supply admin (/admin/circle-supply) enable + optional pre-buy
// window; the marketplace quote/checkout routes now gate the check-in date to
// the hotel's window. Bumping HTML_CACHE drops the stale cached markup so the
// new admin sidebar entry + window enforcement show on first warm visit.
// v343 — one-time HTML_CACHE bump (v155 -> v156). Circle Marketplace M4:
// Model-4 B2B SUPPLY side — a hotel owner lists room-nights from their own
// inventory on the exchange (partner "Pre-buy Inventory" tab gains a "List your
// own inventory" form). Bumping HTML_CACHE drops the stale cached partner markup
// so the new supply form shows on first warm visit.
// v345 — one-time HTML_CACHE bump (v156 -> v157). Circle Marketplace M6: unified
// investor "My Circle" dashboard (/circle/me now aggregates Model 3/4 blocks +
// B2B listings/trades + operated-hotel dashboard access + resale KPIs, with the
// disclosure sweep). Bumping HTML_CACHE drops the stale cached /circle/me markup.
// v346 — one-time HTML_CACHE bump (v157 -> v158). Circle "Model 2" rename/merge:
// the old Model 3 (pre-buy) + Model 4 (exchange) are now a single "Model 2 —
// Multi-City Inventory Bundle" (hub shows 2 model cards; /circle/model2 canonical
// route; all visible labels rebranded). Bump drops stale cached /circle markup.
// v347 — one-time HTML_CACHE bump (v158 -> v159). Circle Model 2 dual B2B
// commission: buyer pays ask + buyer% and seller receives ask − seller% (both
// admin-controlled, default 5/5). Buy/list/quote surfaces now show the buyer
// charge + fee breakdown. Bump drops stale cached exchange markup.
// v348 — one-time HTML_CACHE bump (v159 -> v160). Circle Model 2 city access:
// investors unlock a city once (₹999 lifetime) from /circle/me to buy inventory
// there; the buy-checkout is gated on it. Bump drops stale cached /circle/me.
// v349 — one-time HTML_CACHE bump (v160 -> v161). Circle Model 2 regulated
// pricing: the B2B ask is now StayBid-regulated (Spine wholesale × admin markup),
// not a free seller input — supply/list forms show the regulated price instead
// of an ask field. Bump drops stale cached exchange markup.
// v350 — one-time HTML_CACHE bump (v161 -> v162). Circle Model 2 basket:
// new /circle/model2/browse (per-city released-inventory browse + multi-select
// basket + multi-city bundle checkout in ONE payment). Hub Model 2 card now
// routes here. Bump drops stale cached /circle markup.
// v351 — HTML_CACHE bump (v162 -> v163). Model 2 'My Selling Inventory' on
// /circle/me: owned blocks + sell-through channels (StayBid feed / B2B exchange /
// OTA Channel Manager / direct booking link). Drops stale cached /circle/me.
// v352 — HTML_CACHE bump (v163 -> v164). Model 2 browse: full inventory shown
// upfront (no pre-activation gate); city-access fee is added at basket/single
// checkout for new cities + readable title/subtitle colors. Drops stale markup.
// v353 — HTML_CACHE bump (v164 -> v165). Model 2 browse derives city chips from
// the actual live B2B listings (marketplace-summary never returned model4.cities);
// + demo released inventory seeded. Drops stale cached /circle/model2/browse.
// v354 — HTML_CACHE bump (v165 -> v166). Model 2 resale price is now DOUBLE the
// buy price (regulated markup default 100%): owner paid 1k/day -> lists at 2k/day.
// v355 — HTML_CACHE bump (v166 -> v167). Model 2 resale price = owner's OWN price
// (monthly/30) x multiplier; new premium browse UI + room/property tour; admin
// resale-multiplier control. Drops stale cached browse so the tour + prices show.
// v356 — HTML_CACHE bump (v167 -> v168). Model 2 rebuilt into the Model-1-style
// journey: property browse → property/room tour with live availability calendar
// (pick your own nights) + trading panel (buy price vs ADR/low/high market) →
// build bundle → review → pay. Drops stale cached browse.
// v357 — HTML_CACHE bump (v168 -> v169). Model 2 rebuilt to Model-1 parity:
// real routes (browse → /circle/model2/[id] full property tour → review page),
// Model-2 step-dock, clean check-in→check-out range calendar (all released
// nights available), no internal 2×/own-price shown to the buyer. Drops stale
// cached Model-2 pages.
// v358 — HTML_CACHE bump (v169 -> v170). Model 2 calendar is now MULTI-SELECT
// (tap any nights across months, deck-style), review shows the exact picked
// dates per month, premium dark-gold calendar + panels.
// v359 — HTML_CACHE bump (v170 -> v171). NEW Your Selling Inventory surface
// (/circle/model2/selling): owned room-nights + sell-through channels routing to
// the real owner/partner controls.
// v360 — HTML_CACHE bump (v171 -> v172). Model 2 sell-to-public: demo inventory
// on Circle-operated hotels + 'list for public booking' (releases hold) on the
// selling page.
// v405 — HTML_CACHE bump (v215 -> v216). manifest.json display fullscreen ->
// standalone (kills the repeated Android "To exit full screen" toast); flash
// rail/viewer images gain onError fallbacks so a broken hotel photo never
// black-screens the home page or a flash-deal story.
// v406 — HTML_CACHE bump (v216 -> v217). The toast's REAL source was the
// forced Fullscreen API in useReelFullscreen (fires on first reel tap), not
// the manifest. /discover + /reels now call it with immersive:false, so no
// requestFullscreen -> no toast. Full-bleed reel layout unchanged (CSS-driven).
// v407 — HTML_CACHE bump (v217 -> v218). Navigation speed: instant route
// loading.tsx skeletons (hotels/[id], flash-deals, bid), the flash-deal
// story "View hotel" now does a client router.push (was a full reload), and
// socket.io-client is lazy-loaded on the hotel page (smaller initial chunk).
// v408 — HTML_CACHE bump (v218 -> v219). Standalone-PWA native polish: a
// per-route status-bar colour (no mismatched black strip on light pages) and
// a dark walnut bottom dock on the immersive reel (bottom blends instead of a
// bright block over the phone's system nav bar).
// v409 — HTML_CACHE bump (v219 -> v220). Root-cause fix for the recurring
// status-bar mismatch: StatusBarColor is now the SINGLE authority for
// theme-color (the reel hook's competing #000 override was removed) and it is
// rail-aware (cream when the flash-deals rail leads the discover feed, black on
// the pure reel). The flash rail's cream now fills the status-bar safe area too.
// v410 — HTML_CACHE bump (v220 -> v221). ROOT-CAUSE fix (owner decision):
// the installed status/nav bars were locked by the manifest and couldn't be
// themed per-page at runtime. Switched manifest back to display:fullscreen so
// Android HIDES both system bars (edge-to-edge) — no mismatched status-bar
// strip up top, no phone nav bar double-layer at the bottom. Tradeoff (owner-
// accepted): the "exit full screen" toast returns. Needs one reinstall.
// v411 — HTML_CACHE bump (v221 -> v222). Screenshots proved the runtime
// StatusBarColor works (the revealed status bar is cream-matched on home), so
// the black band was a FULLSCREEN artifact (fullscreen hid that cream bar and
// showed the reel's black bg behind it). Reverted manifest fullscreen ->
// standalone + cream launch colours: the status bar stays visible + matched,
// no black band, no toast.
// v412 — HTML_CACHE bump (v222 -> v223). App-level TOP safe-area paint
// (#sb-safe-top-fill): stops the installed-PWA dark window background showing
// as a black band above the content, in ANY display mode — so even a stale
// fullscreen install gets a matched top after a plain refresh (no reinstall).
// v413 — HTML_CACHE bump (v223 -> v224). Two /bid polish fixes: (1) the
// immersive /bid flow hid the bottom dock but still reserved its 60px, leaving
// a dead gap under PRESS START — now the reserved dock-height collapses too;
// (2) the /bid dark game zone paints its TOP safe-area walnut (was cream).
// v414 — HTML_CACHE bump (v224 -> v225). Flash Deals control bar: the inert
// "N live deals" label (which auto-jumped the grid to the last deal on tap via
// data-autonext) is now a REAL live search input; sort gains price high→low +
// most-rooms-left; deal cards get a defined bottom action-bar (no dead gap).
// v415 — HTML_CACHE bump (v225 -> v226). Flash Deals premium flagship cards:
// editorial serif (Cormorant) hotel name, rounder deeper card, bigger tabular
// price, refined gold Grab CTA — first screen of the design-language uplift.
// v416 — HTML_CACHE bump (v226 -> v227). Design-language uplift screen 2 (Home
// reel feed): editorial serif (Cormorant) hotel name on each reel card, tabular
// price, and a slightly larger flash-deal rail title. Visual-only; the reel
// engine, dedup, fullscreen, and video/audio are untouched.
// v417 — HTML_CACHE bump (v227 -> v228). Design-language uplift screen 3 (the
// /hotels browse grid): editorial serif (Cormorant) hotel-card name + bigger
// tabular price. Pure globals.css class refinement; no markup/logic change.
// v418 — HTML_CACHE bump (v228 -> v229). /hotels/[id] dark-mode legibility fix:
// 7 hotel-detail .hx-* headings/prices that sit on theme-aware --bg-card/page
// surfaces (stat value, availability title, secondary CTA, sticky rate, back
// chip, active tab, teaser title) swapped from the non-flipping --cozy-warm-dark
// to --text-base. Light mode byte-identical (--text-base==--cozy-warm-dark in
// light); dark mode now legible. All-device; no markup/logic change.
// v419 — HTML_CACHE bump (v229 -> v230). Design-language uplift screen 4/5
// (My Bids + Bookings): editorial serif (Cormorant) card hotel names, tabular-nums
// on the ₹ prices (your bid / counter / accepted / total / booking amount), and
// deeper 22px card radius. Tailwind className + the pages' own plain <style>
// blocks; no bid-expiry/pay-gate/handler/logic change.
// v420 — HTML_CACHE bump (v230 -> v231). /hotels/[id] dark-mode completeness
// sweep (10 more elements flagged by the v418 review): amenity chips, flash-deal
// banner price, sticky-rail tip + rate label, section/OTA/availability eyebrow
// labels, accent stat pill, stable-price trend chip — swapped fixed
// --cozy-warm-dark/--cozy-cocoa/--cozy-cocoa-soft to the theme-aware
// --text-base/--text-soft/--text-muted (byte-identical in light).
// v471 — HTML_CACHE bump (v280 -> v281). Desktop reel unified window: the two
// side panels + a full-width Flash Deals rail merge into one glass "desktop app
// window" on ≥1440px home. Bumping drops the stale cached reel markup.
// v471.2 — bump (v281 -> v282). Aesthetic pass on the window: defined frosted
// card, fixed broken up-next thumbnails, amenity chips, centred now-playing.
// v472 — bump (v282 -> v283). Seamless window: neutral blend (no pasted-box
// colour edge), taller flash rail (fully visible), tighter cohesive columns.
// v473 — bump (v283 -> v284). Cozy canvas: calmed even backdrop (no disturbing
// colour), borderless warm window (no box edge / divider lines), now-playing
// fills top→bottom (no dead space).
// v474 — bump (v284 -> v285). Full-width layout: removed the floating window box
// (killed the centre-vs-side colour difference), full-width flash rail, columns
// fill the side margins, now-playing cover image back (no dead space).
// v475 — bump (v285 -> v286). Rebalanced: bigger prominent frame, moderate
// columns (not stretched), rail spans the 3-column cluster; thumbnail/cover
// gradient fallbacks (no black boxes); now-playing cover fills the column.
// v476 — bump (v286 -> v287). Up-next thumbnails: broken images now fall back
// to a clean initial-letter card (was a dull empty gradient box).
// v477 — bump (v287 -> v288). Home desktop reel canvas flipped to LIGHT cozy
// cream (dark text/chips/rail/navbar); /discover + /reels stay dark.
// v478 — bump (v288 -> v289). Flash rail: taller (labels not clipped) +
// readable dark names + scroll arrows/edge-fade (drag affordance); now-playing
// cover cream placeholder (no black box on the light canvas).
// v479 — bump (v289 -> v290). Hotel detail desktop: revived the 2-column
// sticky-rail layout (dead .max-w-6xl selectors -> .max-w-7xl).
// v480 — bump (v290 -> v291). Flash Deals desktop: bigger premium card
// images + larger cards (300px min).
// v481 — bump (v291 -> v292). /bid Step-2 form centered on desktop (climber
// stays fullscreen per owner decision).
// v482 — bump (v292 -> v293). /bookings column widened on desktop so its
// xl 2-col grid breathes (was squeezed into 1024px).
// v483 — bump (v293 -> v294). /my-bids column widened on desktop + fixed the
// 5-col collateral on its KPI chips + card details strip.
// v484 — bump (v294 -> v295). /passport desktop 2-column hub (mobile identical
// via display:contents) + fixed the 5-col strip bug.
// v485 — bump (v295 -> v296). /saved (.lux-soft max-w-5xl) widened on desktop so
// its lg:grid-cols-4 grid breathes.
const HTML_CACHE = 'staybid-html-v415';
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

// ─────────────────────────────────────────────────────────────────────
// v321 — Web Push (FCM) handlers.
// FCM delivers messages to THIS service worker's `push` event (the client
// passes this registration to getToken). We render the notification here
// so we control the icon/title/body/click-through. The Railway sender
// SHOULD send data-only payloads ({ data: { title, body, url, icon } }) so
// Chrome does not auto-display a second notification. We also read a
// top-level `notification` block defensively.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {
    try { payload = { data: { body: event.data && event.data.text() } }; } catch (e2) { payload = {}; }
  }
  const d = payload.data || {};
  const n = payload.notification || {};
  const title = d.title || n.title || 'StayBid';
  const body  = d.body  || n.body  || '';
  const url   = d.url   || (d.click_action) || '/';
  const options = {
    body: body,
    icon: d.icon || n.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: d.tag || n.tag || undefined,       // same tag replaces, not stacks
    data: { url: url },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap on the notification → focus an open StayBid tab (and navigate it) or
// open a new one at the target URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      // Reuse any existing StayBid window.
      if ('focus' in client) {
        try { if ('navigate' in client && target) await client.navigate(target); } catch (e) {}
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
