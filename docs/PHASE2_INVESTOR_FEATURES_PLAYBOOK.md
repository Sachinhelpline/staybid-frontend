# StayBid Circle Model 1 — Phase 2: Investor Features (Nov 1)

**Status:** Pre-launch documentation  
**Target Go-Live:** November 1, 2026  
**Scope:** Pricing controls, B2B marketplace integration, dashboard analytics  
**Owner:** Claude (Tech) + Ayushi P (Product) + Prince (Ops)

---

## EXECUTIVE SUMMARY

Phase 2 investor features unlock **operator scope** — investors transition from passive income (booking attribution + automatic settlement) to **active control** over:
1. **Pricing overrides** — adjust guest-facing room prices within guardrails
2. **B2B resale** — list units on the Model-2 exchange to reach travel agents + other investors
3. **Dashboard analytics** — track bookings, payouts, occupancy, revenue in real time

**All features are READ-ONLY or SCOPED WRITES** — no access to core booking/payment infrastructure. Settlement and payout execution remain centralized admin/ops functions.

---

## PRE-FEATURE VALIDATION (Oct 1–31)

Must-hit Phase 2 readiness metrics (Gate 3 checkpoint, Nov 1):

| Metric | Target | Owner |
|--------|--------|-------|
| 25+ investors committed to Phase 2 | KYC + payment completed | Ayushi P |
| B2B marketplace schema tested (unit transfers, holds) | Live SQL + sandbox runs | Claude |
| Pricing override logic tested (live + sandbox) | ≤100ms response time, no race conditions | Claude |
| Dashboard performance (≥50 concurrent users) | <500ms latency, 99.5% uptime | Claude |

**Gate Decision:** Oct 25, if <3/4 metrics GREEN → defer Features to Nov 15.

---

## FEATURE 1: PRICING OVERRIDES (Investor Control)

### Use Case:
An investor (e.g., Rajesh, owns 2 units at Dhanaulti) sees that guest bookings are below target. Today, pricing is auto-calculated from Spine (wholesale base × demand multiplier). With pricing overrides, Rajesh can **temporarily reduce price by up to 15%** to drive occupancy without changing the global pricing config.

**Guardrails:**
- Override range: base_rate − 20% (safety floor) to base_rate + 30% (ceiling)
- Auto-revert: overrides expire 30 days after set (no permanent changes)
- Fallback: if override breaks, reverts to Spine base_rate (no pricing outage)
- Admin audit: every override logged with timestamp + reason (optional free-text note)

### Technical Implementation:

**A. Schema:**
```sql
-- NEW TABLE: investor_pricing_overrides
CREATE TABLE investor_pricing_overrides (
  id TEXT PRIMARY KEY DEFAULT gen_id('ipo'),
  investor_user_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  room_type TEXT, -- e.g., 'deluxe_2pax', NULL = all rooms at hotel
  override_pct_change NUMERIC, -- e.g., -15 (reduce by 15%), +10 (raise by 10%)
  effective_date DATE NOT NULL,
  expiry_date DATE NOT NULL, -- auto-set to effective_date + 30 days
  reason TEXT, -- optional: "holiday boost", "occupancy drive", etc.
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_pricing_overrides_investor ON investor_pricing_overrides(investor_user_id, expiry_date);
CREATE INDEX idx_pricing_overrides_hotel ON investor_pricing_overrides(hotel_id, expiry_date);
```

**B. Pricing Engine (lib/circle/pricing-override.ts):**
```typescript
export function computeOverriddenPrice(
  basePrice: number,
  overridePct: number | null,
  safetyFloor: number,
  ceiling: number
): number {
  if (overridePct === null) return basePrice; // no override, use base

  const overridden = round100(basePrice * (1 + overridePct / 100));
  return Math.max(safetyFloor, Math.min(ceiling, overridden));
}

// Called at booking time: GET /api/hotels/[id] room pricing
// Returns: { basePrice, overridePct?, displayPrice, safetyFloor, ceiling }
```

**C. Investor Dashboard UI (app/circle/me/pricing-tab):**
- **Current Overrides:** per-room table (room name, override %, expires-in-N-days, remove action)
- **Set New Override:** modal (pick room-type, slider ±30%, optional reason, confirm)
- **Pricing Preview:** live update shows guest-facing price + impact on margin (e.g., "₹2,000 base → ₹1,700 override → investor margin shrinks by ₹12/night")

**D. POST /api/circle/pricing-overrides (investor Bearer token):**
```
Request:
{
  "hotelId": "hco_dhanaulti_001",
  "roomType": "deluxe_2pax",
  "overridePct": -15,
  "reason": "Occupancy drive for Diwali",
  "effectiveDate": "2026-11-15"
}

Response:
{
  "id": "ipo_…",
  "expiry_date": "2026-12-15",
  "displayPrice": 1700,
  "safetyFloor": 1600,
  "ceiling": 2600,
  "status": "active"
}
```

**Validation:**
- `investor_user_id` in override row MUST equal the Bearer token subject (fail-closed)
- `hotelId` MUST be a Circle host_circle hotel with investor operator scope (via `hotel_room_units.investor_user_id`)
- `overridePct` clamped -20 to +30 (fail-closed if out of range)
- `effectiveDate` MUST be today or future (no retroactive changes)
- No overlapping active overrides for the same room (UPSERT, 1 per room)

### Success Metrics (Nov 1–7):
- 100% of overrides set succeed with <1s response time
- Zero race conditions (two investors editing same room simultaneously → last-write-wins, logged)
- Pricing display refreshes on guest page within 30 seconds of override set
- Zero payout miscalculations (settlement ledger uses displayed price, not base price)

---

## FEATURE 2: B2B RESALE (Model-2 Exchange)

### Use Case:
Rajesh holds 20 room-nights at Dhanaulti (6-night stay, 1 premium unit Oct 15–20, purchased for ₹2,000/night). He wants to resell them to a travel agent or another investor at ₹3,500/night (his ask). Today, he has no way to list. With B2B resale, Rajesh can:
1. Open `/circle/me/selling-inventory`
2. Tap "List on B2B Exchange" on his owned/listed block
3. Set ask price (regulated to ≥own price × multiplier, e.g., ₹2,000 × 2 = ₹4,000 floor)
4. Block is now visible to other investors/agents browsing `/api/b2b/marketplace`

**Guardrails:**
- Only **owned** blocks (status='owned', investor_user_id=caller) can be listed
- Ask price is **REGULATED by admin** (regulated_markup_pct, default 20% above own cost)
- Inventory hold (`invhold_<blockId>`) is automatically applied (guest bookings blocked during resale)
- Resale is **OPTIONAL** — investor can own-and-operate blocks without listing them

### Technical Implementation:

**A. Schema (existing, no change):**
```sql
-- b2b_listings already exists from v347/v349
-- investor_user_id = seller
-- block_id (FK to inventory_blocks) = the owned block
-- source = 'investor_block' (frozen at list time)
-- ask_per_night (frozen, regulated)
-- status = 'draft' | 'listed' | 'sold'
```

**B. New Route: PUT /api/circle/inventory/sell/:blockId (investor Bearer token):**
```
Request:
{
  "action": "list",        // or "pause" (remove from exchange, keep owning)
  "askPerNight": 3500,     // client suggestion; server re-prices to regulated
  "note": "Premium unit, Oct peak season"
}

Response:
{
  "listing_id": "bbl_…",
  "block_id": "ib_…",
  "status": "listed",
  "regulated_ask_per_night": 4000,  // overrides client suggestion
  "hold_id": "invhold_…",           // hold active, guest bookings blocked
  "visibility": "public_b2b_exchange",
  "expires_at": "2026-12-15"        // 30-day listing auto-expiry
}
```

**Validation:**
- Block must be `status='owned'` (not 'pending', not 'sold')
- Block's `inventory_blocks.investor_user_id` == Bearer token subject
- `askPerNight` MUST be ≥ regulated floor (server recalcs if client sends lower)
- Hotel must be approval_status='approved' + host_circle type
- NO overlapping holds (if hold already exists with source='inventory', reuse it; else create new)

**C. Pause/Relist:**
```
PUT /api/circle/inventory/sell/:blockId
{
  "action": "pause"
}

Response:
{
  "status": "paused",
  "hold_removed": true,     // invhold deleted, guest bookings now possible
  "listing_status": "draft"  // listing preserved, can re-list later
}
```

**D. Investor Dashboard UI (app/circle/me/selling-inventory):**
- **My Owned Blocks:** per-block card (dates, rooms, own price, ask price on exchange, hold status)
- **List for Resale:** modal (confirm ask price, set duration, confirm hold)
- **Pause Resale:** button to release hold, keep owning
- **Sold History:** card showing completed resales (ask price, buyer, settlement pending/completed)

### Settlement on Resale:
When a buyer purchases from `/api/b2b/listings/[id]/checkout`:
1. Buyer pays regulated ask price (frozen on listing at time of purchase)
2. `b2b_trades` row created with source='investor_block' (NOT 'hotel_owner')
3. On verify (HMAC payment verified), block flips owner_user_id → buyer
4. **Settlement:** seller gets their portion (ask × nights − seller fee %) as a `settlement_ledger` row with kind='b2b_resale'
5. Payout: seller receives net amount via admin manual payout (RazorpayX auto later in Phase 3)

### Success Metrics (Nov 1–14):
- ≥5 blocks listed by Nov 7 (adoption from Phase 1 cohort)
- ≥1 successful resale completed by Nov 14 (end-to-end settlement flow works)
- Zero data loss on block transfer (buyer's unit assignment + hold creation + settlement row creation all idempotent)
- Zero regulatory risk (ask price always ≥regulated floor, never discounted below cost)

---

## FEATURE 3: DASHBOARD ANALYTICS (Investor Portal)

### Use Case:
Rajesh logs into `/circle/me` and sees:
- **Occupancy Trend:** 30-day graph of how full his units are (e.g., "avg 45%, peak 82%")
- **Revenue Snapshot:** month-to-date owed payout (₹1,23,456 pending, ₹45,670 paid out last month)
- **Booking List:** all guest bookings on his owned units (dates, guests, status, payout linked)
- **Settlement Detail:** per-booking breakdown (room cost, guest price, settlement fee, investor net)

**Guardrails:**
- Data is READ-ONLY (no mutations through dashboard)
- Visible only to the investor who owns/operates the units (cross-pool identity resolution)
- Payout amounts are **illustrative pending** (not ledger-of-record; settlement_ledger is source of truth)

### Technical Implementation:

**A. New Routes (read-only):**

**GET /api/circle/portfolio (investor Bearer token):**
```
Response:
{
  "investor_id": "user_…",
  "ownedHotels": [
    {
      "hotelId": "hco_dhanaulti_001",
      "name": "Dhanaulti Escape",
      "monthlyRate": 60000,
      "rooms": 2,
      "occupancyTrend": {
        "currentMonth": "45%",
        "last7Days": "52%",
        "peak30Day": "82%"
      }
    }
  ],
  "bookingsSummary": {
    "activeBookings": 3,
    "completedThisMonth": 12,
    "totalNights": 18
  },
  "payoutSummary": {
    "pendingOwed": 123456,
    "paidThisMonth": 45670,
    "totalPaidAll": 512340
  },
  "b2bInventory": {
    "ownedBlocks": 1,
    "activeListings": 1,
    "soldThisMonth": 0
  }
}
```

**GET /api/circle/bookings?hotelId=hco_dhanaulti_001 (investor Bearer token):**
```
Response:
[
  {
    "bookingId": "bk_…",
    "guestName": "Priya Sharma",
    "checkInDate": "2026-11-15",
    "checkOutDate": "2026-11-20",
    "roomType": "deluxe_2pax",
    "roomCount": 1,
    "nights": 5,
    "guestPrice": 2000,
    "totalGuestPaid": 10000,
    "platformFee": 1200,  // 12%
    "investorNet": 8800,
    "status": "confirmed_paid",
    "settlementStatus": "owed"  // or "paid"
  }
]
```

**GET /api/circle/settlement-ledger?hotelId=… (investor Bearer token):**
```
Response:
[
  {
    "id": "sl_…",
    "bookingId": "bk_…",
    "hotelId": "hco_dhanaulti_001",
    "investorNet": 8800,
    "payout_status": "owed",
    "createdAt": "2026-11-15T10:30:00Z",
    "payoutDate": null  // becomes date when status='paid'
  }
]
```

**B. Dashboard UI (app/circle/me/analytics-tab):**
- **KPI Cards:** occupancy %, revenue (₹), bookings count, avg rating
- **Occupancy Graph:** 30-day trend with peak/trough markers
- **Revenue Pipeline:** pending owed → this month → last 3 months (bar chart)
- **Booking List:** sortable table (date, room, guest, price, status, settlement status)
- **Payout Calendar:** month-by-month distribution (when was each owed row paid)

**Validation:**
- Investor can only see their own data (investor_user_id = Bearer token subject)
- Cross-pool identity resolution (if investor has twin accounts, data aggregates)
- All monetary values are FROZEN at ledger row creation (no live price changes)
- Occupancy % calculated from room_blocks (source='booking') on the hotel

### Success Metrics (Nov 1–7):
- 100% of investors can load their dashboard in <2 seconds (no timeouts)
- Dashboard refreshes every 5 minutes (not real-time, but near-live)
- Zero data exposure (an investor can never see another investor's bookings)
- Zero calculation errors (occupancy % matches booking reality, payout sums match settlement ledger)

---

## FEATURE 3b: INTEGRATION WITH EXISTING FEATURES

### Interaction with Pricing Overrides:
- Dashboard shows **effective price** (base + override applied), not base price
- Settlement ledger records **effective price** at booking time, so payout calculation is correct
- If override expires mid-month, new bookings use base price (no retroactive adjustment)

### Interaction with B2B Resale:
- Dashboard shows owned blocks separately from "resold inventory" (if a block is listed, its status switches to 'listed')
- On resale completion, investor sees settlement row with kind='b2b_resale' + buyer name + ask price realized

### Interaction with Multi-Property Portfolio:
- Dashboard aggregates across all 5 properties (Dhanaulti, Rishikesh, Mussoorie, + Phase 2 Properties 4–5)
- Occupancy/payout filters by hotel (per-property drill-down available)

---

## FEATURE ROLLOUT SCHEDULE (Oct 25 – Nov 7)

| Date | Component | Owner | Validation |
|------|-----------|-------|-----------|
| Oct 25–28 | Pricing override schema + engine tested | Claude | 50 test cases: guardrails, race conditions, fallback |
| Oct 28–31 | B2B resale integration tested (block transfer, hold, settlement) | Claude | End-to-end: list → buy → transfer → payout |
| Oct 31–Nov 1 | Dashboard analytics tested (data freshness, aggregation) | Claude | Concurrent loads, query performance |
| Nov 1 | Go-live: flip feature flags `ENABLE_PRICING_OVERRIDES=1`, `ENABLE_B2B_RESALE=1`, `ENABLE_ANALYTICS_DASHBOARD=1` | Claude | Gradual rollout: 10% → 50% → 100% over 48h |
| Nov 1–2 | Investor comms: "New features live — pricing controls, resale, analytics" (email + dashboard notification) | Ayushi P | Message sent to all active investors |
| Nov 2–7 | Support escalation monitoring (helpline + Slack) | Prince | <2h SLA on feature bugs |
| Nov 7 | Post-rollout retro (what worked, what didn't) | All | Blockers identified for Nov 15 scaling |

---

## KNOWN RISKS + MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Pricing override causes race condition (two edits simultaneously) | LOW | Incorrect price charged, payout mismatch | Pessimistic lock on room row; last-write-wins + audit log |
| B2B block transfer fails partway (block flipped but hold not created) | LOW | Block double-booked (guest + agent), data corruption | Transactional verify (4-key idempotent PATCH; if hold write fails, entire transaction rolls back) |
| Dashboard query times out under 50+ concurrent users | MEDIUM | Poor UX, investors abandon feature | Pre-compute aggregates nightly (occupancy %, payout sums); dashboard reads cache (5-min TTL) instead of raw query |
| Investor sees peer investor's data due to cross-pool bug | CRITICAL | Data exposure, regulatory risk | Explicit `investor_user_id = subject` check on EVERY query; unit test with twin IDs |
| Resale ask price is regulated below investor's own cost | HIGH | Investor loses money on resale, churn | Regulated floor = own_per_night × (1 + admin markup %) — pre-compute at block ownership time; NEVER allow manual below-cost asks |

---

## SUCCESS CRITERIA (Nov 1–15)

**Feature Adoption:**
- ≥50% of active investors enable pricing overrides (at least 1 override set)
- ≥20% of investors list blocks on B2B exchange (≥5 active listings)
- 100% of investors access analytics dashboard (at least 1 login per investor)

**Financial Accuracy:**
- Settlement ledger rows match investor dashboard payout totals (0 variance)
- B2B resale payouts are 100% accurate (ask price × nights − seller fee %)
- Zero disputed payouts due to pricing override bugs

**Performance:**
- Dashboard load time <500ms (p95 latency)
- Pricing override set/pause <1s (p95)
- B2B list/pause <2s (p95)
- Zero data corruption or lost transactions

**Support:**
- <5 feature-related support tickets by Nov 7 (expected, normal friction)
- Zero critical bugs (only minor UI polish or edge cases)

---

## SIGN-OFF (Nov 1 only)

| Role | Approval | Date |
|------|----------|------|
| Tech (Claude) | Ready / Defer | ____ |
| Product (Ayushi P) | Ready / Defer | ____ |
| Ops (Prince) | Ready / Defer | ____ |

**Decision:** Features GO-LIVE Nov 1 or DEFER to Nov 15 (reason: ____________)

---

*Investor Features Playbook — Version 1 (August 17, 2026)*  
*StayBid Circle Model 1 — Phase 2 Product Launch Guide*
