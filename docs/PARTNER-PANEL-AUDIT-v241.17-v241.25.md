# Hotel Partner Panel Audit — Autopilot / Hybrid / Manual

**Scope:** regressions introduced into the partner panel by the v241.17 → v241.25
customer-frontend "Multi-Room Bid + Acceptance Window Hardening" era.
**Mode:** audit-first. Findings + impact tables below.
**Date:** 2026-05-29

> **STATUS — Phase 0 fix APPLIED & VERIFIED (v241.26, 2026-05-29).**
> Sachin confirmed the audit and asked for the best future-proof solution with
> no app-code alteration, covering **every** entry point (place-bid,
> negotiation, normal room booking, flash-deal booking) — not just place-bid.
> Implemented as a single central `BEFORE` trigger on `public.bids`
> (`trg_stamp_accepted_expiry`, migration
> `migrations/2026-05-29-v241.26-accepted-expiry-trigger.sql`) that stamps
> `expiresAt = now() + per-hotel acceptance_window_min (clamped ≥30)` on every
> transition into ACCEPTED. Because Railway (Prisma), the `mark_expired_holds()`
> cron RPC, and all Next.js routes write to the same Supabase DB, the trigger
> covers all paths — current and future — with zero application change.
> Verified live: a status-only flip rewrote a stale 3h `expiresAt` to exactly
> now+30 min (rolled back, no data committed). Phases 1–2 (cosmetic N4/N5)
> remain open.

---

## TL;DR — the one regression that matters

v241.17 made `bids.expiresAt` the **single source of truth** for the
ACCEPTED-unpaid window (consumed by `isBidExpired`, `isBidPayWindowOpen`,
`filterActiveBids`, the place-route `isBidStale` conflict check, and the
partner Bid Inbox). The era then stamped `expiresAt = now + 30 min` on **six
Next.js / frontend** accept paths.

It never stamped `expiresAt` on the **two server paths that actually accept
most bids in the partner panel**:

| Accept path | Stamps `expiresAt`? | Used by |
|---|---|---|
| `mark_expired_holds()` Supabase RPC (cron auto-accept) | ❌ **NO** | **Autopilot + Hybrid** (PREMIUM/STRONG flip) |
| Railway `POST /api/bids/:id/accept` | ❌ **NO** | **Manual + all-mode partner override** accept |
| Railway `POST /api/bids/:id/counter-accept` | ❌ NO | (dead — customer uses FE route) |
| Railway agent-assist accept | ❌ NO | agent tooling |
| FE `place` auto-accept | ✅ 30 min | `/bid` reverse-auction server auto-accept |
| FE `trigger-accept` | ✅ 30 min | customer watching `/my-bids` tab |
| FE `accept` | ✅ 30 min | hotel-page Book-Now auto-accept |
| FE `counter-accept` | ✅ 30 min | customer accepts hotel counter |
| FE `budget` | ✅ 30 min | budget-led re-accept |
| FE `partner/bids/[id]` **Supabase fallback only** | ✅ 30 min | only when Railway is down |

**Consequence:** any bid accepted by the cron (Autopilot/Hybrid) or by the
partner through the normal Railway path keeps its **PENDING-era `expiresAt`**
(`createdAt + 1 h` for `/bid`-flow, `createdAt + 3 h` for Negotiate/Book-Now).
Because v241.17 made every surface read `expiresAt` first, the intended 30-min
ACCEPTED-unpaid window is **not enforced** for those bids — it silently becomes
**1–3 hours**.

Before v241.17 the client computed the ACCEPTED window as `createdAt + 15 min`
and *ignored* `expiresAt`, so this path behaved roughly correctly. v241.17 is
what turned the unstamped server paths into a regression. This is squarely a
v241.x regression, and it lands hardest exactly where this audit was asked to
look — the partner panel.

---

## Evidence

### `mark_expired_holds()` (live DB, project `uxxhbdqedazpmvbvaosh`)
```sql
UPDATE public.bids
   SET status = 'ACCEPTED'              -- ← no expiresAt update
 WHERE status = 'PENDING'
   AND auto_accept_at IS NOT NULL
   AND auto_accept_at <= now();
```
This is the cron that flips scheduled (Autopilot/Hybrid) bids. It sets status
only. `expiresAt` stays at the place-time value.

### Railway `POST /api/bids/:id/accept` — `staybid-Live/apps/api/src/index.ts:351`
```ts
const bid = await prisma.bid.update({
  where: { id: req.params.id },
  data: { status: "ACCEPTED" },         // ← no expiresAt update
  include: { request: true },
});
```
Partner Bid Inbox accept → `app/api/partner/bids/[id]/route.ts` → tries Railway
**first** (`route.ts:45`) and returns Railway's response on success
(`route.ts:51`). The `expiresAt` stamp in that FE file lives only in the
Supabase cold-start fallback (`route.ts:69`), which is *not* reached when
Railway is up.

### The DB trigger does NOT fill the gap
`migrations/2026-05-03-bid-accept-triggers.sql` (`fn_on_bid_accepted`) fires on
→ACCEPTED but only writes commissions / loyalty points / notification queue. It
does **not** stamp `expiresAt`. So there is no central DB safety net.

### Who reads `expiresAt` and therefore inherits the wrong window
- `lib/bid-expiry.ts:124` — `isBidExpired` ACCEPTED branch (drives `filterActiveBids` **and** `filterUserVisibleBids`).
- `lib/bid-expiry.ts:218` — `isBidPayWindowOpen` (gates every customer Pay CTA + the `/hotels/[id]` lock chip at `page.tsx:2900` / `:3567`).
- `app/api/bids/place/route.ts:73` — `isBidStale` ACCEPTED branch (one-bid-per-hotel conflict lock).
- `app/partner/dashboard/page.tsx:888` — `filterActiveBids` (Bid Inbox counts, "Confirmed" stat, "Est. Revenue").

---

## Mode 1 — Full Autopilot

Spec: every tier-eligible bid auto-confirms on its timer; partner can override
before the timer fires.

| Step | Behaviour | Verdict |
|---|---|---|
| Place above-floor bid (hotel-page Negotiate/Book-Now, 1:1) | `schedule-accept` stamps `auto_accept_at = now + tierMs`; bid PENDING with `expiresAt = createdAt + 3 h` (negotiate) | ✅ correct |
| Place above-floor bid via `/bid` reverse auction | server `place` route auto-accepts **instantly** (v196), `expiresAt = now + 30 min` | ✅ correct (autopilot mode **not** consulted on this path — pre-existing v196 design, see Note 1) |
| Cron flips PENDING→ACCEPTED at `auto_accept_at` | `mark_expired_holds()` sets status only — **`expiresAt` left at `createdAt + 3 h`** | ❌ **REGRESSION** |
| Customer is watching `/my-bids` when timer hits 0 | `trigger-accept` wins the race, stamps 30 min | ✅ correct (but inconsistent with the cron path → window depends on *who flips first*) |
| ACCEPTED `expiresAt = now + 30 min`? | only if FE trigger-accept flipped it; cron-flipped bids show ~3 h | ❌ |
| Partner sees right countdown in Bid Inbox | inbox row visibility = `filterActiveBids` = `expiresAt`; lingers ~3 h instead of 30 min | ❌ |
| Override before timer: partner accept | Railway accept, status only, **no `expiresAt`** | ❌ same regression |
| Override: partner counter / reject | Railway counter resets `expiresAt` (v229) ✅ / reject ✅ | ✅ |
| Customer `/my-bids` reflects state live | yes (24 h `filterUserVisibleBids`), but Pay CTA stays open ~3 h via `isBidPayWindowOpen` | ⚠️ visible-but-wrong-window |

---

## Mode 2 — Hybrid (premium-only)

Spec: PREMIUM + STRONG auto-confirm; NORMAL / CAUTIOUS / LOWBALL wait for partner.

| Tier | `auto_accept_at` set? | Path | Verdict |
|---|---|---|---|
| PREMIUM | yes (`resolveAutoAcceptMs` passes baseMs) | cron flip | ❌ window wrong (cron doesn't stamp) |
| STRONG | yes | cron flip | ❌ window wrong |
| NORMAL | **no** (`resolveAutoAcceptMs` → Infinity → `schedule-accept` leaves `auto_accept_at` NULL) | stays PENDING | ✅ correct |
| CAUTIOUS | no | stays PENDING | ✅ correct |
| LOWBALL | no (LOWBALL never schedules in any mode) | stays PENDING | ✅ correct |

- Tier gate itself (`lib/bidder-score.ts` + `lib/autopilot.ts:resolveAutoAcceptMs`
  + `schedule-accept/route.ts:28`): **unchanged in v241.x, intact.** ✅
- Partner action on the manual tiers: accept → Railway, **no `expiresAt`** ❌;
  counter → resets `expiresAt` ✅; reject ✅.
- Customer side reflects state but with the long pay window on the
  PREMIUM/STRONG auto-accepts and on any partner accept.

---

## Mode 3 — Manual Review

Spec: every bid waits for the partner; no auto-accept ever fires.

| Step | Behaviour | Verdict |
|---|---|---|
| Place bid at any tier on a manual hotel (hotel-page flow) | `resolveAutoAcceptMs(_, _, "manual") = Infinity` → `schedule-accept` leaves `auto_accept_at` NULL → stays PENDING | ✅ correct |
| Place bid via `/bid` reverse auction on a manual hotel | server `place` auto-accepts above-floor **instantly**, ignoring manual mode | ⚠️ **Note 1** — pre-existing (v196), not a v241 regression, but violates the manual-mode spec |
| Partner accept → `expiresAt` stamped | Railway accept, status only — **no `expiresAt`** | ❌ same regression |
| Partner counter → no `expiresAt` change, 60-min COUNTER | Railway counter *does* reset `expiresAt` to 1 h/3 h (v229); FE filter ignores it and uses `createdAt + 60 min` anyway | ⚠️ pre-existing COUNTER divergence (see Note 2) |
| Customer counter-accept → ACCEPTED, `expiresAt = now + 30 min` | FE `counter-accept/route.ts:27` stamps 30 min ✅ (customer hits FE route, not Railway) | ✅ correct |

---

## Cross-cutting checks

| Check | Result |
|---|---|
| One-active-bid-per-(customer×hotel) conflict lock | FE `place` `isBidStale` keys ACCEPTED off `expiresAt` → lock persists 1–3 h for cron/Railway-accepted bids instead of 30 min. ❌ same root cause. PENDING (1 h/3 h) + COUNTER (60 min) windows untouched ✅. **Note 3:** Railway `place` still locks **per-city** (`findActiveBidInCity`) while FE `place` locks **per-hotel** (`findActiveBidOnHotel`) — pre-existing divergence. |
| Update-Budget on PENDING/COUNTER in the 30-min window | FE `budget/route.ts:16` uses shared `ACCEPTED_UNPAID_WINDOW_MS` on budget-led re-accept ✅. Works for both PENDING and COUNTER. No regression. |
| `filterActiveBids` strict on operator surfaces (partner inbox, admin ledger) | Still strict and still operator-only ✅, but the "active" ACCEPTED window it enforces is wrong (1–3 h) for cron/Railway-accepted bids → inflates Bid Inbox "Confirmed" count + "Est. Revenue" for up to 3 h. ❌ same root cause. |
| `capacityMismatch` server math | `app/api/bids/place/route.ts:239` = `guests > capacity × numRooms` using total guests. **Unchanged** — v241.21 only touched client `minRoomsForGuests`. ✅ no regression. |
| Pricing visit rooms (`recalculateRoomPrice` + `processFlashDeals`) readable in admin price-history | `lib/pricing/engine.ts` + `lib/pricing/flash.ts` untouched in shape by v241.x. v241.24 parallelised `processFlashDeals` batching + added a time-budget guard but did **not** change the `price_history` output rows. ✅ low risk — recommend a spot-check of the admin price-history view. |
| Hotel-hold-config per-hotel override wins over the v241.25 clamp for values ≥ 30 | `app/api/hotel-hold-config/route.ts:45` = `Math.max(30, config?.acceptance_window_min ?? defaults ?? 30)`. A per-hotel 60 survives ✅. Explicit per-hotel values **< 30 are silently upgraded to 30** — by design per the v241.25 comment, but the clamp can't tell an intentional 20 from a legacy 15. ⚠️ minor. |
| Per-room lock chip gated by `isBidPayWindowOpen` (v241.25); partner-side gating mismatch? | Customer chip: `/hotels/[id]:2900,3567`. Partner side has **no analogous `isBidPayWindowOpen` gate** (uses `filterActiveBids` only) → no chip-type mismatch. ✅. BUT both the customer chip and the partner inbox read the same broken `expiresAt`, so both show the wrong window for cron/Railway-accepted bids. |

---

## Minor / secondary findings

- **N4 — `AcceptedBidTimer` vs `isBidPayWindowOpen` divergence.** The timer
  computes its countdown from `acceptedAt + windowMin` (hold-config, default 30)
  via `lib/auto-cancel.startAcceptanceWindow`, while `isBidExpired` /
  `isBidPayWindowOpen` read `expiresAt`. For a cron/Railway-accepted bid these
  disagree: the timer can read "Expired / 0:00" while the Pay CTA stays rendered
  (because `expiresAt` is still 1–3 h out), or vice-versa.
- **N5 — `/admin/hold-config` UI staleness (v241.23/.25 missed spots).**
  `app/admin/hold-config/page.tsx:318` hint still reads "Default 15.";
  `:319` empty-input fallback is `|| 15`; the override card `:195` shows the
  **raw stored** `acceptance_window_min` (e.g. "15 min") rather than the clamped
  effective 30. Save clamp `:273` is `Math.max(1, Math.min(120, …))` — still
  permits storing < 30 (read-time clamp then masks it). Cosmetic/UX only.
- **N6 — Railway accept creates a `CONFIRMED` booking pre-payment** (`index.ts:359`)
  with no `paidAmount`. The FE accept route does not. Pre-existing divergence,
  out of v241 scope; flagged for awareness only.

---

## Proposed fixes (per mode / phase — NOT yet applied)

**Phase 0 — close the `expiresAt` contract on the two server paths (fixes Modes 1, 2, 3 partner-accept + Autopilot/Hybrid auto-accept at once):**
1. `mark_expired_holds()` — add `"expiresAt" = now() + INTERVAL '30 minutes'` to
   the PENDING→ACCEPTED `UPDATE`. (Apply via Supabase migration.) Optionally make
   it honour each hotel's `acceptance_window_min` instead of a flat 30.
2. Railway `POST /api/bids/:id/accept` and `/counter-accept` — set
   `expiresAt: new Date(Date.now() + 30*60_000)` on the `prisma.bid.update`.
   Mirror the shared constant.
3. *(Belt-and-suspenders)* extend `fn_on_bid_accepted` trigger to stamp
   `expiresAt` when it's still at a PENDING-era value, so *any* future accept
   path is covered centrally — preferred if we don't want to chase every caller.

**Phase 1 — partner Bid Inbox:** once Phase 0 lands, no code change needed; the
30-min window flows through `filterActiveBids` automatically. Optionally surface
a real countdown chip on ACCEPTED-unpaid rows.

**Phase 2 — cosmetic: DONE (v241.26).** N5 hold-config text/fallbacks/clamp
fixed; N4 `AcceptedBidTimer` now prefers `expiresAt` so the countdown agrees
with `isBidPayWindowOpen` / `isBidExpired`.

**N6 — by design, NOT changed.** The FE `/api/bids/:id/pay` route only stamps
the Razorpay id on `bids.message`; it does not create a booking. The booking
record originates solely from Railway's accept-time creation, so the pre-pay
CONFIRMED booking is load-bearing, not a bug.

**Note 1 / N1 — DONE (v241.26).** `/bid` server auto-accept
(`app/api/bids/place`) now respects Autopilot mode: `auto` instant (unchanged),
`manual` stays PENDING, `hybrid` only PREMIUM/STRONG (tier computed server-side
via the shared `computeBidderScore`). Closes the only path that bypassed mode.

**Note 3 / N3 — DONE (v241.26).** Railway `/api/bids/place` conflict lock
aligned per-CITY → per-HOTEL (`findActiveBidOnHotel`), matching the v200 rule +
the FE route (`staybid-Live`).

**All audit items now resolved or consciously left (N6 by design).**

---

## ADDENDUM — timezone parse bug (the real "expired on launch" cause)

Customer screenshots (pre-session) showed a freshly accepted bid reading
"expired" immediately, no Pay-Now, and a room upgrade that charged only the
₹2,200 delta on a (wrongly) expired ₹3,200 anchor.

**Root cause:** `bids.createdAt` / `bids.expiresAt` are `timestamp without time
zone`; PostgREST returns them WITHOUT a tz marker. On an IST browser
`new Date("…T16:30:00")` parses as local = **5.5h behind UTC**, so a 30-min
window is always "expired" client-side at placement. Server (UTC) read it
right → silent client/server disagreement. The v241.26 trigger fixed the
stored value; this fixes the client read. Proven under `TZ=Asia/Kolkata`
(old → expired −300 min; new → +30 min).

**Fix:** shared `parseDbTime()` in `lib/bid-expiry.ts` (tz-less ⇒ UTC), wired
into every client expiry read (`isBidExpired`, `isBidPayWindowOpen`,
`filterUserVisibleBids`/`filterActiveBids`, `/my-bids` liveBids +
PendingBidCountdown, `AcceptedBidTimer`, `ActiveBidConflictSheet`). Plus a
pay-window money-guard on the room-upgrade flow (client CTA + pre-Razorpay
re-check + server 400) so a closed-window anchor can never be upgraded.

This is why merely applying the v241.26 trigger did NOT fix the screenshots on
its own — the value was right, the IST read was wrong.

---

*Audit only — awaiting confirmation before any fix lands, per the PR #172+ rule.*
