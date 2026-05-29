# Hotel Partner Panel — Autopilot / Hybrid / Manual Audit (Next Session)

> Sachin's request after the v241.17 → v241.24 era:
> "double check karo deep research karke ki yeh jo autopilot and hybrid
> and manual jo hai hotel partner panel par yeh sab main toh koi
> disturbance nahi aaya hai na yeh sab toh sahi se kaam kar rahe hai…
> humne price visiting rooms in sab se kuch disturb toh nhi kar diya
> hai ya fir hmare upgrade se kuch missing toh nhi reh gaya hai."
>
> This audit was NOT done in the v241.x customer-frontend era because
> it's a different scope (partner panel) and Sachin asked for a fresh
> session with full attention. **Do not run this in an active feature
> session — start a new one.**

## Copy-paste prompt for the new session

Paste this into the next session start:

```
Deep audit of the Hotel Partner Panel — Autopilot / Hybrid / Manual modes — for any regressions introduced by the v241.17 → v241.24 customer-frontend changes.

Per CLAUDE.md's "v241.17 → v241.24 Multi-Room Bid + Acceptance Window Hardening Era", the following shared contracts changed:
  - lib/bid-expiry exports new helpers (filterUserVisibleBids, isBidPayWindowOpen, ACCEPTED_UNPAID_WINDOW_MIN/MS, USER_VIEW_FRESH_GRACE_MS)
  - bids.expiresAt is now stamped on every accept route (4 + 1 budget update + place auto-accept)
  - lib/auto-cancel ACCEPTANCE_WINDOW_MIN bumped 15 → 30
  - /api/hotel-hold-config default 15 → 30
  - lib/sb-server ensureUser two-step (no clobber on existing phone)

Three modes to audit end-to-end. Follow the audit-first rule from PR #172 onwards: NO code change until findings are presented with an impact table. After Sachin confirms, fix in phases (one PR per mode is fine).

### Mode 1: Full Autopilot
  Spec: Hotel confirms every tier-eligible bid automatically on its scheduled timer. Partner can override before timer fires.
  Walk:
  - Place a bid that should auto-accept on this hotel.
  - Verify auto_accept_at stamp on the bid (schedule-accept route).
  - Verify cron / trigger-accept flow flips PENDING → ACCEPTED at the right moment.
  - Verify the ACCEPTED expiresAt = now + 30 min (was 15 pre-v241.22). Confirm partner sees the right countdown in Bid Inbox.
  - Override path: partner accepts/counters/declines BEFORE auto_accept_at fires — both flows should still work; expiresAt stamp should still land for accept.
  - Sanity: customer's /my-bids reflects every state change live (with v241.20 customer-view 24h grace).

### Mode 2: Hybrid (premium-only)
  Spec: PREMIUM + STRONG bidders auto-confirm; NORMAL / CAUTIOUS / LOWBALL wait for partner.
  Walk:
  - Place bids at each tier (PREMIUM, STRONG, NORMAL, CAUTIOUS, LOWBALL) on a hybrid-mode hotel.
  - PREMIUM + STRONG: auto_accept_at set → flips to ACCEPTED on schedule → expiresAt = now + 30 min ✓
  - NORMAL / CAUTIOUS / LOWBALL: NO auto_accept_at → stays PENDING until partner action.
  - Partner action paths: accept (expiresAt stamp), counter (no expiresAt change), reject. Customer side reflects.
  - Lib reference: lib/bidder-score.ts (tier classification), app/api/bids/[id]/schedule-accept (tier gate).

### Mode 3: Manual Review
  Spec: Every bid waits for partner. No auto-accept ever fires.
  Walk:
  - Place bids at every tier on a manual-mode hotel.
  - NO bid should get auto_accept_at; all stay PENDING.
  - Partner accept → expiresAt stamp landed (v241.17/.22 contract).
  - Partner counter → no expiresAt change (stays COUNTER for 60 min per lib/bid-expiry).
  - Customer counter-accept (/api/bids/[id]/counter-accept) → flips to ACCEPTED with expiresAt = now + 30 min.

### Cross-cutting checks (all 3 modes)
  - Conflict check: one-active-bid-per-(customer × hotel) rule (v200/v236). Bumped 15 → 30 only affects the ACCEPTED-unpaid window; PENDING (1h/3h) and COUNTER (60 min) untouched.
  - Update Budget flow on PENDING/COUNTER bids: still works in the 30-min window after a budget-led re-acceptance.
  - filterActiveBids (strict, operator surfaces) — Partner Bid Inbox and Admin Bookings ledger still see only the right rows after the v241.20 customer/operator split.
  - capacityMismatch flag: server still flags (adults + children) > capacity × rooms — v241.21 only changed CLIENT minRoomsForGuests, NOT the server-side mismatch math.
  - Pricing visit rooms (admin/owner panels): no change in v241.x; verify recalculateRoomPrice + processFlashDeals output is still readable in the admin price-history view.
  - Hotel-hold-config per-hotel override: still wins over the v241.23 30-min default.

### Deliverable
  An audit report enumerating every consumer surface, what changed, what didn't, and any regressions found. Format: same structure as PR #172 / #174 — clear "what changes / what doesn't" tables. Only THEN propose fixes per-mode.

Do NOT modify code in the first pass. Read, trace, document, then propose. Sachin will confirm before any fix lands.
```

## Notes for the next session

- The customer-facing v241.x era is DONE. No need to revisit v241.10-v241.24 unless an explicit regression is reported.
- The 30-min ACCEPTED-unpaid window is enforced server-side at READ time (no cron). Verify the partner-inbox stale-filter behaves correctly under the new window.
- Per-hotel admin override at `/admin/hold-config` still wins. Test a hotel with `acceptance_window_min = 60` to make sure operator surfaces respect it.
- The `lib/bidder-score.ts` tier classification is unchanged in v241.x. Hybrid mode's gate logic should be intact.
- This audit may surface that the **partner Bid Inbox countdown** still shows "15 minutes" text on cached config — same 2-min cache flush from v241.23 applies.

## Files to inspect first

  - `app/partner/dashboard/page.tsx` — main partner panel
  - `app/api/partner/bids/[id]/route.ts` — partner accept/counter/reject (already v241.17 + v241.22 updated)
  - `app/api/bids/[id]/schedule-accept/route.ts` — Hybrid mode tier gate
  - `app/api/bids/[id]/trigger-accept/route.ts` — Autopilot cron-fed flip
  - `lib/bidder-score.ts` — tier classification
  - `lib/bid-expiry.ts` — single source of truth (read first)
  - `app/admin/hold-config/page.tsx` — admin window override
  - `app/api/hotel-hold-config/route.ts` — config resolver

## Out of scope for this audit

  - Customer-frontend surfaces (v241.x already covered).
  - The `/api/cron/flash-drop` cron (v241.24 fix, unrelated to partner panel).
  - PWA / mobile chrome (separate from partner panel).
  - Reel-app surfaces (separate domain).
