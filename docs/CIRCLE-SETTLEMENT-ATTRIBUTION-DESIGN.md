# StayBid Circle — Money Attribution & Settlement Layer (Design)

> Status: **DESIGN — not built.** This is the deliberate design pass flagged in v386/v387
> ("resale-buyer guest-payout = settlement/Railway phase"). It specifies the layer that
> automatically routes a guest booking's payment to whoever currently holds the commercial
> right to each booked unit-night. Grounded in a verified read of the current money path
> (2026-07-19). Nothing here mutates money until a phase is explicitly approved + built.

---

## 0. The one-line problem

Today a guest's payment for a Circle room lands in StayBid's single Razorpay account and **stops
there** — no code reads which owner/investor earned it, no obligation is recorded, no payout runs.
This layer closes that gap: **ownership → attribution → settlement → payout** (the blueprint's
core rail), applied to *guest bookings* for the first time.

---

## 1. Verified current state (the boundary)

| Piece | State | Where |
|---|---|---|
| Guest pays (Razorpay order + HMAC verify) | ✅ guest-side only, no DB money row | `app/api/razorpay/{order,verify}` |
| Bid row carries the attribution key | ✅ `bids.assignedUnitId` written at bid time | `app/api/bids/place` → `resolveOwnedUnit` (`lib/circle/room-listings.ts`) |
| `bookings` row (paidAmount, nights) | ⚠️ created by **Railway**, not this repo | (backend `Sachinhelpline/staybid-Live`) |
| Unit-night → **payee** resolver | ❌ **MISSING** | — |
| Owner net / StayBid cut on a guest booking | ❌ **MISSING** (`lib/commission.ts` is creator-referral only) | — |
| `settlement_ledger` (generic owed ledger) | ✅ exists; written for `b2b_trade`, `auction_award` only | `migrations/…v331`; b2b/trade verify routes |
| owed → paid | ⚠️ **admin click only**, never automatic | `app/api/admin/circle-inventory` |
| Model 1 payout amount | ⚠️ **hand-typed by admin**, not computed | `circle_payouts`, `app/api/admin/circle` |
| Refund/cancel touches settlement | ❌ never | `bids/[id]/cancel`, `lib/auto-cancel.ts` |

**Boundary:** everything downstream of "guest paid" is missing for owner money. The attribution
key is persisted and correct; nothing consumes it.

---

## 2. The attribution model — the core new piece

### 2.1 The SEBI-safe key: money follows the *transferable* right

The LOCKED contract is: `hotel_room_units.owner_user_id` (the physical stamp) **never transfers
between investors**; only `inventory_blocks.investor_user_id` (the commercial right for a
`(unit, date-range)`) transfers. Therefore **earnings must follow the block, not the stamp.**

**Per-night payee precedence** for a booked `(unit_id, date)`:

1. **`inventory_blocks` overlay** — an `owned`/`listed` block on that `unit_id` whose
   `date_from ≤ date < date_to` → payee = **`investor_user_id`** (the current commercial-right
   holder; this is who bought/resold that night). *This is the new resolution nobody does today.*
2. **else `hotel_room_units.owner_user_id`** — the Model 1 provisioned owner / hotel_owner-source
   buyer who physically owns the unit.
3. **else the hotel** — `hotels.ownerId`. For classic hotels that's the real hotel owner. For
   `host_circle`/`staybid_operated` hotels `ownerId` is a sentinel (`STAYBID_CIRCLE_OPS` /
   `hco_<propId>`) → **no external payee; StayBid retains** (platform-operated night).

Because step 1 reads the transferable `investor_user_id` and never the frozen `owner_user_id`,
the layer is **SEBI-safe by construction** — the physical ownership stamp is untouched; only the
money follows the right that legitimately moved.

### 2.2 Per-NIGHT, not per-booking

A stay is resolved **night by night**. A single booking can legitimately span multiple payees
(nights 1–2 = a resold block held by B, nights 3–5 = the base owner A). The resolver returns a
`date → payee` map; the settlement then aggregates to *per-payee night sets*. This is what makes
it clash-free: every unit-night has **exactly one** payee (precedence is total + deterministic),
and the physical hold layer (`room_blocks`/`invhold`) already guarantees no two paid bookings
claim the same unit-night.

### 2.3 The pure resolver (shared, read-only)

```
lib/circle/attribution.ts
  resolveNightlyPayees(unitId, roomId, hotelId, checkIn, checkOut)
    → { date, payeeUserId | null (=StayBid), source: 'block'|'unit'|'hotel' }[]
```

- Reads only: `inventory_blocks` (unit_id, status in (owned,listed), date overlap),
  `hotel_room_units` (owner_user_id), `hotels` (ownerId, owner_type).
- Pure + side-effect-free → reusable by the settlement writer, a projected-earnings preview,
  and (re-implemented identically) by Railway. **Single source of truth for "who earns this night."**
- Cross-pool payee ids (`resolveOwnerIdsCrossPool` semantics) so identity twins never mis-route.

---

## 3. The economics (guest-booking fee model)

- Guest gross for a payee's nights `G = Σ nightly_rate` over that payee's resolved nights × rooms.
- **StayBid Circle booking fee** `f` — a %, single-sourced from an admin config
  (`circle_booking_fee_pct`, proposed default **12%**, matching `PLATFORM_RESALE_FEE_PCT_DEFAULT`;
  may differ per model — see §10). Never client-set.
- Payee **net = G × (1 − f)**; StayBid keeps `G × f`.
- Tamper-safe: computed server-side from the booking's **actual paid amount** and the **frozen**
  fee at settlement time. Preview == charge == settlement (the universal rule).

---

## 4. Settlement write (record the obligation) — reuse `settlement_ledger`

At **booking-confirm (paid)**, write one row **per payee**:

| field | value |
|---|---|
| `kind` | `'guest_booking'` (new value; `kind` is free text — no schema change) |
| `ref_id` | deterministic `"<bookingId>:<payeeUserId>"` → one idempotent row per payee per booking |
| `payee_user_id` | resolved payee (§2) |
| `gross_amount` | that payee's share of guest gross |
| `platform_fee` | `gross × f` |
| `net_amount` | owed to payee |
| `payout_status` | `'owed'` |
| `metadata` | `{ bookingId, unitId, hotelId, nights:[…], ratePerNight }` |

- Idempotent via the existing **`uniq_settlement_kind_ref (kind, ref_id)`** + `Prefer:
  resolution=ignore-duplicates` — webhook/re-verify retries converge.
- **StayBid-retained nights** (precedence 3, sentinel owner) → **no row** (nothing owed out), or a
  `payee='STAYBID_CIRCLE_OPS'` bookkeeping row if we want the platform cut auditable.
- **Authoritative writer = Railway** (that's where the confirmed `bookings` row is created). The
  frontend `bids/[id]/pay` MAY write it best-effort as an interim for FE-driven pays — guarded by
  the same idempotency so there is never a double credit. **Recommendation: one authoritative
  writer in Railway; the resolver logic shared/mirrored.**

---

## 5. Payout execution (owed → paid → money-out)

- **Admin surface (this repo):** extend the existing settlement admin to list `kind='guest_booking'`
  owed rows grouped by payee, with `mark_paid` (owed→paid + `paid_at` + `payout_ref`). Reuses the
  `app/api/admin/circle-inventory` `mark_settlement_paid` pattern.
- **Auto money-out (Railway):** a payout batch reads owed rows per payee, executes the transfer,
  flips owed→paid. Two candidate rails (§10 decision):
  - **RazorpayX batch payouts** — StayBid captures all, holds float (escrow), pays owners on a
    cycle from the owed ledger. **Matches today's owed-ledger pattern; light owner onboarding.** ✅ recommended.
  - **Razorpay Route (split at capture)** — money splits to each owner's *linked account* at the
    instant the guest pays; no owed float. Cleaner cash-flow but requires per-owner KYC'd linked
    accounts. Heavier onboarding.

---

## 6. Refunds / cancellations (reversal)

On a guest cancellation/refund (Railway-driven), reverse the matching rows keyed on the same
`ref_id`:
- `payout_status='owed'` → flip to `'cancelled'` (never pay).
- already `'paid'` → write a **negative** reversal row (`kind='guest_booking_refund'`,
  `net_amount` negative) netted in the payee's next payout cycle (claw-back).
- **Partial-night** cancellation → reverse only the affected nights (per-night rows make this exact).

---

## 7. Bulletproof / clash-free guarantees

- **Deterministic, total attribution** — each unit-night has exactly one payee; no double credit.
- **Physical hold layer** (`room_blocks`/`invhold`) already blocks double-booking a unit-night, so
  two paid bookings can never claim the same night.
- **Idempotent** — `uniq_settlement_kind_ref` + deterministic `ref_id`.
- **Tamper-safe** — fee frozen server-side; amounts from the actual booking, never client.
- **SEBI-safe** — attribution reads the transferable right; `owner_user_id` never moves.
- **No auto money-out in this repo** — obligations only, consistent with every existing Circle path.

---

## 8. Schema / migration footprint (small, additive)

- **No new table** — `settlement_ledger` reused.
- New `kind` values `'guest_booking'` / `'guest_booking_refund'` — free text, **no DDL**.
- Optional additive columns for reporting: `settlement_ledger.unit_id`, `nights_count`,
  `payout_ref` (all nullable).
- New fee config `circle_booking_fee_pct` (in `circle_revenue_config` or a dedicated config row).

---

## 9. Phased rollout

- **S1 — resolver + projected earnings (frontend, pure, zero money-risk).**
  `lib/circle/attribution.ts` + a read-only "Projected from live bookings" panel on `/circle/earnings`
  and the owner dashboard (shows what an owner *would* be owed from real bids/bookings). Validates
  the resolver against production data. **No writes.** ← safe first ship.
- **S2 — settlement record.** Write `guest_booking` owed rows at booking-confirm (authoritative in
  Railway; interim best-effort in FE `bids/pay`). Admin view + `mark_paid`.
- **S3 — payout execution (Railway).** RazorpayX batch owed→paid + money-out; refund reversal.
- **S4 — Model 1 unification.** Migrate `circle_payouts` to read the computed settlement, deprecating
  hand-typed amounts (keep a manual top-up override).

---

## 10. Open decisions for the owner (before S2/S3)

1. **Fee %** — reuse 12% (resale fee), or a distinct Circle operating/mgmt fee? Same for Model 1
   income-share vs Model 2/3 commerce, or per-model?
2. **StayBid-retained nights** — classic-hotel / unowned nights: does the hotel owner get paid via
   this ledger, or does the existing (separate) Railway hotel-settlement own that? (Proposed:
   Circle owners via this ledger; classic hotels stay on their existing settlement.)
3. **Payout rail** — RazorpayX batch (recommended, matches owed-ledger) vs Razorpay Route
   (split-at-capture, heavier onboarding)?
4. **Escrow/float** — is StayBid comfortable holding owner funds between capture and payout cycle
   (RazorpayX), or must money split at capture (Route)?

---

## 11. What ships where (repo split)

| Piece | Repo |
|---|---|
| `resolveNightlyPayees` resolver | frontend `lib/circle/attribution.ts` (mirrored in Railway) |
| Projected-earnings preview (S1) | frontend |
| Settlement write on booking-confirm (S2) | **Railway** (authoritative) + optional FE interim |
| Admin owed-view + mark_paid (S2) | frontend admin |
| Payout batch money-out (S3) | **Railway** |
| Fee config | frontend admin + shared |
