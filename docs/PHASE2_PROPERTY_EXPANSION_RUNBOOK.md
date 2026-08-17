# StayBid Circle Model 1 — Phase 2: Property Expansion (Oct 15)

**Status:** Pre-launch documentation  
**Target Go-Live:** October 15, 2026  
**Scope:** Onboard Properties 4 (Rishikesh expansion) + Property 5 (Mussoorie new)  
**Owner:** Kaaju (Properties) + Claude (Technical) + Prince (Ops)

---

## EXECUTIVE SUMMARY

Phase 2 doubles the property portfolio from 3 to 5 properties by October 15, leveraging the proven Model-1 provisioning playbook. Properties 4–5 use the **identical technical stack** as Properties 1–3 (host_circle hotels, Spine-linked pricing, settlement ledger, investor payouts), enabling parallel portfolio management and shared investor income across seasonal calendars.

**Property Selection Rationale:**
- **Property 4 (Rishikesh):** Oct–Nov peak season; captures Diwali + festival demand; extends investor income beyond Dhanaulti off-season (Jul–Aug).
- **Property 5 (Mussoorie):** Jun–Sep peak; completes the complementary seasonal portfolio; year-round demand coverage via 3-property → 5-property arc.

---

## PRE-EXPANSION VALIDATION (Sep 8–30)

Must-hit Phase 1 success metrics (Gate 2 checkpoint, Oct 1):

| Metric | Target | Validation Owner |
|--------|--------|------------------|
| Properties 1–3 occupancy average | ≥50% (Aug/Sep/early Oct data) | Kaaju |
| Investor retention (churn <10%) | ≥90% active from Phase 1 cohort | Ayushi P |
| Guest satisfaction scores | ≥4/5 from booking reviews | Kaaju |
| Staff readiness (all 3 properties) | Training completion 100% | Kaaju |
| Settlement ledger stability | 30 days cron runs, zero data loss | Claude |

**Gate Decision:** Oct 1, if <4/5 metrics GREEN → defer Property Expansion to Nov 1.

---

## PROPERTY 4 PROVISIONING (Rishikesh) — Oct 1–10

### Step 1: Owner Agreement + Legal (Oct 1–3)

**Deliverables:**
- Signed property owner agreement (Kaaju/Legal team)
- Room count + configuration locked (e.g., 12 units, 2/4-pax mixes)
- Monthly operational rate finalized (e.g., ₹4,00,000 for Oct–Nov season)

**Why Oct 1–3:** Legal review requires 2 working days; signature capture typically 48h.

### Step 2: Infrastructure + Staffing (Oct 3–7)

**Checklist:**
- Staff training video: Module A (Circle basics) + Module B (Model 1 guest booking flow)
- Housekeeping/front-desk roster assigned (minimum 2 full-time equivalents)
- Linen/amenity audit (match Phase 1 standards; emergency supply chain confirmed)
- WhatsApp Business account active (guest comms); Razorpay Terminal if on-site payment needed

**Validation:** Kaaju signs off "ready for live operations."

### Step 3: Room + Pricing Setup (Oct 7–8)

**Technical Route:** Replicate Phase 1 provisioning exactly.

**A. Database Setup (Claude):**
```
1. Create host_circle hotel record:
   - id: hco_rishikesh_001
   - name: "Rishikesh Valley Resort" (or confirmed property name)
   - owner_type: 'host_circle'
   - approval_status: 'draft' (NOT 'approved' yet)
   - city: 'rishikesh'
   - state: 'uttarakhand'
   - lat/lng: (precise GPS from Kaaju)
   - description: "Luxury Valley Escape — Oct–Nov Peak Season"

2. Create hotel_room_units (12 rooms):
   - 6× Deluxe 2-pax (roomType='deluxe_2pax')
   - 4× Premium 4-pax (roomType='premium_4pax')
   - 2× Suite 4-pax (roomType='suite_4pax')
   - Each: owner_user_id = investor_user_id (stamped at investor activation)
   - is_listed: false (gated until approval_status='approved')

3. Seed room_date_price (Oct 1 – Nov 30):
   - base_rate: Spine wholesale cost ÷ 2 (example: ₹2,000 Deluxe base)
   - competitor_min: Safety floor (example: ₹1,800)
   - live_price: base_rate (until demand-cycle adjusts Sep 20)
   - Example seed SQL:
     INSERT INTO room_date_price (roomId, checkInDate, base_rate, competitor_min, live_price)
     SELECT id, d::date, 2000, 1800, 2000
     FROM hotel_room_units hu, generate_series('2026-10-01'::date, '2026-11-30'::date, '1 day'::interval) d
     WHERE hu.hotelId = (SELECT id FROM hotels WHERE id LIKE 'hco_rishikesh%')
     ON CONFLICT (roomId, checkInDate) DO NOTHING;
```

**B. Pricing Configuration (Claude + Kaaju):**
- Validate base_rate vs. owner's monthly operational cost (₹4,00,000 ÷ 30 = ₹13,333/day avg; per-room = ₹13,333 ÷ 12 ≈ ₹1,111/room base, NOT the example ₹2,000 — adjust to real math)
- Set competitor_min as safety anchor (e.g., 10% above base to protect margin)
- Demand-cycle boost pre-scheduled (Sep 20: Diwali week Oct 29–Nov 2 multiplier = 1.35×)

### Step 4: Circle Investor Allocation (Oct 8)

**Investors assigned to Property 4:**
- Subset of Phase 1 cohort + new leads (Ayushi P identifies ≥3 interested from Phase 1 feedback + new pipeline)
- For each investor: create `investor_hotel_allocation` record (if used in codebase; else direct assignment to hotel_room_units via investor_user_id)
- Monthly rate locked in (e.g., ₹33,333 per investor for 1 unit per month)

**Verification:** Ayushi P confirms investor commitments in writing (email/WhatsApp).

### Step 5: Go-Live Activation (Oct 9–10)

**A. Pre-Approval Checklist (Kaaju + Claude):**
- [ ] Staff trained (video + checklist signed)
- [ ] Guest-facing hotel page mirrors Phase 1 layout (hero, amenities, reviews, pricing)
- [ ] Settlement ledger test: simulate 1 mock booking → verify `settlement_ledger` row created with 12% fee
- [ ] Support channel active (WhatsApp + phone number for guest escalations)

**B. Flip to Approved (Claude):**
```sql
UPDATE hotels
SET approval_status = 'approved'
WHERE id = 'hco_rishikesh_001';

-- Now guest bookings become visible on /hotels and /discover feeds
-- investor_user_id units on the property become visible to their dashboard
```

**C. Day-1 Operations (Oct 10):**
- Notify all assigned investors: "Property 4 (Rishikesh Valley) now live"
- Post-live monitoring (hourly Slack update): bookings, guest inquiries, settlement ledger rows

---

## PROPERTY 5 PROVISIONING (Mussoorie) — Oct 10–15

**Mirror Process** (Steps 1–5 identical to Property 4, compressed timeline):

### Timeline:
- **Oct 10–11:** Owner agreement + legal (parallel to Property 4 operations)
- **Oct 11–14:** Staff training + infrastructure
- **Oct 14–15:** Room setup + pricing + investor allocation
- **Oct 15:** Go-live activation (flip approval_status='approved')

### Property 5 Specifics:
- **Name:** Mussoorie Hillside Retreat (confirmed by Kaaju)
- **Room count:** 10–14 units (finalized by Oct 10)
- **Peak season:** Jun–Sep (already past in Oct 2026; **note:** Property 5 does NOT have demand in Oct–Nov, but is provisioned for FUTURE Jun–Sep 2027 bookings + winter holidays Dec 2026; see Risk Register below)
- **Pricing strategy:** Conservative base_rate (off-season Oct–Nov), aggressive uplift Dec (holiday) + Jun 2027 (summer peak)

**Critical:** Property 5's Oct–Nov occupancy WILL BE LOW (off-season). This is EXPECTED. The property is valuable for **Nov 15–Dec 31 holiday season** (family/corporate retreats) and **Jun–Sep 2027** (peak revenue). Investor KPIs for Property 5 must reflect this seasonality.

---

## COMBINED PORTFOLIO MONITORING (Oct 15–31)

### Day-1 Success Criteria (Oct 15):
- ≥2 bookings across Properties 4 + 5 combined
- Settlement ledger: ≥2 pending payout rows created
- Zero critical support incidents (guest satisfaction)

### Weekly Targets (Oct 15–31):
| Metric | Target | Owner |
|--------|--------|-------|
| Property 4 occupancy (weekly avg) | ≥40% | Kaaju |
| Property 5 occupancy (weekly avg) | ≥15% (expected, off-season) | Kaaju |
| Investor confidence (support tickets) | ≤1 per investor | Ayushi P |
| Settlement ledger stability | 100% cron success + zero data loss | Claude |
| Payout processing (manual, interim) | 100% accuracy, <48h reconciliation | Prince |

### Post-Expansion Debrief (Oct 31):
- Kaaju: occupancy trends + guest satisfaction feedback
- Ayushi P: investor satisfaction + churn signals
- Claude: settlement ledger health + any bugs discovered
- Prince: payout reconciliation accuracy + any Razorpay issues

---

## KNOWN RISKS + MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Property owner commitment falls through (legal delay) | MEDIUM | Property launch postponed to Nov 1 | Backup property (Udaipur) pre-identified; owner LOI already signed |
| Staff onboarding incomplete by launch date | LOW | Delayed guest operations, poor experience | Hire contract staff from Phase 1 properties as backup |
| Property 5 off-season occupancy crushes investor confidence | HIGH | Early churn, negative feedback | Explicit messaging: "Property 5 is for holiday season (Dec) + summer peak (Jun 2027); Oct–Nov is seeding phase." Lower expectations in Oct targets. |
| Settlement ledger on Property 4–5 fails to create rows | CRITICAL | Investor payout never owed, earnings gap | Test mock booking → ledger row BEFORE approval_status flip; cron audit daily for first week. |
| Spine pricing unavailable for new properties | MEDIUM | Manual base_rate must be used; margin risk | Pre-seed room_date_price with conservative base_rate; trigger weekly Spine re-sync on Oct 20 |
| Guest refunds on Property 4–5 delay settlement reversal | MEDIUM | Ledger rows remain "owed" after refund | Test refund flow with 1 mock booking Oct 9; verify settlement reversal within 2 cron cycles (1 hour) |

---

## ROLLBACK PLAN (If Expansion Blocked by Oct 1 Gate)

If Phase 1 success metrics miss targets (e.g., <3/5 GREEN by Oct 1):

1. **Keep Properties 1–3 operating** (pause marketing, focus on occupancy recovery)
2. **Defer Property 4–5 to Nov 1** (re-sequence Steps 1–5 for Nov launch)
3. **No data loss:** hotel records remain in `draft` status (never approved), no guest bookings created
4. **Resume ops:** Properties 4–5 can launch independently once Phase 1 stabilizes, without impact to existing investor payouts

---

## SIGN-OFF (Oct 15 only)

| Role | Approval | Date |
|------|----------|------|
| Properties (Kaaju) | Ready / Defer | ____ |
| Investors (Ayushi P) | Ready / Defer | ____ |
| Tech (Claude) | Ready / Defer | ____ |
| Ops (Prince) | Ready / Defer | ____ |

**Decision:** Properties 4–5 GO-LIVE Oct 15 or DEFER to Nov 1 (reason: ____________)

---

*Property Expansion Runbook — Version 1 (August 17, 2026)*  
*StayBid Circle Model 1 — Phase 2 Operational Guide*
