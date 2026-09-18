# StayBid Circle Model 1 — Phase 1: Property Provisioning Runbook

**Status:** Ready for execution once Properties 2 & 3 confirmed
**Timeline:** 5-7 business days (complete by August 25)
**Owner:** Kaaju (Property Operations) + Claude (Technical Guidance)

---

## Overview

Provisioning transforms 3 confirmed properties into StayBid Circle-operated hotels. Once an investor purchases rooms, they become OPERATORS on those properties and earn from guest bookings. This runbook covers the technical setup, room allocation, and investor stamping.

---

## PRE-PROVISION CHECKLIST

### Property 1: Dhanaulti Village Resort by Woodora

| Item | Status | Owner | Notes |
|------|--------|-------|-------|
| Property access granted | ☐ | Kaaju | Owner contact verified |
| Room list (10 cottages) confirmed | ☐ | Kaaju | Categories: 30k/month, 45k/month |
| Photos uploaded (hero + room images) | ☐ | Kaaju | 3+ per room via S3 staging |
| Amenities list ready | ☐ | Kaaju | WiFi, AC, TV, Parking, etc. |
| Pricing data from Spine | ☐ | Claude | Base rates retrieved for Mar-Jun peak |
| Staff training scheduled | ☐ | Kaaju | Operations, booking, checkout |

### Property 2: Rishikesh (Pending Selection)

| Item | Status | Owner | Notes |
|------|--------|-------|-------|
| Property locked | ☐ | Kaaju | Owner commitment letter |
| 8-12 rooms identified | ☐ | Kaaju | Budget/deluxe mix |
| Photos + amenities | ☐ | Kaaju | 3+ images per room |
| Pricing Spine data | ☐ | Claude | Oct-Nov peak rates |
| Staff training | ☐ | Kaaju | | |

### Property 3: Mussoorie (Pending Selection)

| Item | Status | Owner | Notes |
|------|--------|-------|-------|
| Property locked | ☐ | Kaaju | Owner commitment letter |
| 8-12 rooms identified | ☐ | Kaaju | Premium/deluxe mix |
| Photos + amenities | ☐ | Kaaju | 3+ images per room |
| Pricing Spine data | ☐ | Claude | Jun-Sep peak rates |
| Staff training | ☐ | Kaaju | | |

---

## STEP 1: CREATE CIRCLE-OWNED HOTELS (Days 1-2)

### Action: Add 3 Hotels to StayBid

**Backend:** `/api/admin/onboard-circle-property` (or manual via Supabase admin panel)

Each property is created as a **host_circle** hotel (NOT a normal hotel_owner property):

```
POST /api/admin/onboard-circle-property
{
  "name": "StayBid Circle · Dhanaulti Village Resort",
  "city": "Dhanaulti",
  "state": "Himachal Pradesh",
  "lat": 30.54,
  "lng": 77.37,
  "owner_type": "host_circle",  // CRITICAL — Circle-operated
  "owner_id": "hco_dhanaulti_001",  // NEVER a real user ID
  "approval_status": "DRAFT",  // Start hidden
  "images": [...]  // S3 URLs
}
```

**Properties to Create:**

| Property | Hotel ID | Owner ID | City | Rooms |
|----------|----------|----------|------|-------|
| Dhanaulti Village Resort | hco_dhanaulti_001 | hco_dhanaulti_001 | Dhanaulti | 10 |
| Rishikesh Wellness Retreat | hco_rishikesh_001 | hco_rishikesh_001 | Rishikesh | 10 |
| Mussoorie Mountain Lodge | hco_mussoorie_001 | hco_mussoorie_001 | Mussoorie | 10 |

**Verification:**
- [ ] All 3 hotels created with `owner_type = 'host_circle'`
- [ ] All 3 have `approval_status = 'DRAFT'` (hidden from guests until go-live)
- [ ] Owner IDs are sentinel `hco_*` (NOT real user IDs)
- [ ] Images present on each hotel card
- [ ] Amenities listed + searchable

---

## STEP 2: ALLOCATE ROOMS TO INVESTORS (Days 2-3)

### Action: Create `hotel_room_units` Per Investor

For each of the 10 investors (once acquired), create ROOM UNITS. The `owner_user_id` stamps WHO EARNED each room-night.

```
POST /api/admin/provision-room-units
{
  "hotel_id": "hco_dhanaulti_001",
  "investor_ids": [
    "investor_user_1",
    "investor_user_2",
    ...
  ],
  "allocation": "round_robin",  // Even split, or custom
  "room_count_per_investor": 1   // Each gets 1 room
}
```

**Result per Investor:** 1 room in 1 property, allocated for the FULL contract year.

**Dhanaulti Allocation Example:**

| Investor | Room ID | Category | Monthly Rate | Annual Investment |
|----------|---------|----------|--------------|-------------------|
| Investor 1 | dha-r1 | 45k | ₹45,000 | ₹3,60,000 (₹9L needed = 2.5 shares) |
| Investor 2 | dha-r2 | 45k | ₹45,000 | ₹3,60,000 |
| Investor 3 | dha-r3 | 30k | ₹30,000 | ₹2,40,000 |
| … | … | … | … | … |

**Verification:**
- [ ] Each investor holds at least 1 room across the 3 properties
- [ ] No room is double-allocated (UNIQUE hotel_room_units.id)
- [ ] Each `owner_user_id` matches a confirmed investor
- [ ] Room categories match property mix (30k/45k Dhanaulti, budget/deluxe Rishikesh, etc.)

---

## STEP 3: SET ROOM PRICING (Days 3-4)

### Action: Bind Spine Floor Prices to Rooms

Each room's floor is derived from its Spine **wholesale cost** (the BASE RATE the hotel would charge a travel agent). Investors NEVER sell below this floor.

```
POST /api/circle/provision/set-pricing
{
  "hotel_id": "hco_dhanaulti_001",
  "rooms": [
    {
      "room_id": "dha-r1",
      "floor_price_per_night": 2300,  // Spine floor for March (peak)
      "mrp_per_night": 4900,          // MRP for reference
      "season": "spring"
    },
    ...
  ]
}
```

**Dhanaulti Pricing (March peak):**
- Floor: ₹2,300/night (Spine wholesale)
- MRP: ₹4,900/night (Booking.com equivalent)
- Margin: ₹2,600/night (53% resale upside)

**Rishikesh Pricing (October peak):**
- Floor: ₹1,600/night (Spine wholesale, off-season for Dhanaulti)
- MRP: ₹3,500/night
- Margin: ₹1,900/night

**Verification:**
- [ ] All floors set to actual Spine data (not guessed)
- [ ] MRP set to peak booking-platform rate
- [ ] Prices reflect seasonal demand cycle
- [ ] Floors never below purchase cost (monthly_rate ÷ 30)

---

## STEP 4: ACTIVATE PROPERTIES (Days 4-5)

### Action: Flip to `approval_status = 'approved'`

Once rooms are allocated, pricing is set, and staff is trained, activate the properties for GUEST bookings:

```
PATCH /api/admin/hotels/{hotel_id}
{
  "approval_status": "approved"  // NOW visible to guests
}
```

**Pre-Activation Checklist:**
- [ ] Dhanaulti: 10 rooms allocated, floor set, images live
- [ ] Rishikesh: 8-10 rooms allocated, floor set, images live
- [ ] Mussoorie: 8-10 rooms allocated, floor set, images live
- [ ] All staff trained (checkin, checkout, guest comm, settlement reporting)
- [ ] Investor communications sent (property access, earn model explained)
- [ ] Admin `/admin/circle-inventory` access verified

**Verification Post-Activation:**
- [ ] Properties appear in `/api/discover/feed` (guest browse)
- [ ] Individual rooms are bookable per room-night
- [ ] Guests see floor price (not investor cost)
- [ ] Investor dashboard `/circle/me` shows "Your Inventory" tiles

---

## STEP 5: INVESTOR ONBOARDING (Parallel, Days 1-5)

### Action: Grant Partner Dashboard Access

Each investor becomes an OPERATOR on their allocated rooms. They access `/partner/dashboard` to:
- View their unit(s) details
- Set OTA feeds (optional)
- View guest bookings (read-only, settlements show later)

```
POST /api/circle/grant-operator-access
{
  "investor_user_id": "investor_user_1",
  "hotel_ids": ["hco_dhanaulti_001"],
  "role": "operator"  // Read-only on bookings; no payout direct access yet
}
```

**Investor Dashboard Sections:**
| Section | Data | Access |
|---------|------|--------|
| My Rooms | Allocated rooms (unit status) | View + OTA config |
| Bookings | Guest bookings on their rooms | View (settlement tab pending) |
| Earnings | Projected payout (read-only preview) | View only |
| Profile | Name, bank details, contact | Edit for future payout setup |

**Verification:**
- [ ] Each investor can log in to `/partner/dashboard`
- [ ] "My Rooms" tab shows their allocated unit(s)
- [ ] Investor sees "Projected Earnings" preview (illustrative, not final)
- [ ] Email notifications configured (booking confirmations, earnings summaries)

---

## STEP 6: SETTLEMENT LEDGER PREPARATION (Days 4-5)

### Action: Verify Cron Readiness

The settlement engine (`/api/cron/circle-settlement`) runs every 30 minutes and:
1. Finds PAID bookings on Circle properties from the past 120 days
2. Resolves per-night payees (who earned that room-night)
3. Creates `settlement_ledger` rows (kind='guest_booking') per payee
4. Admin then marks rows as PAID (manual payout for interim)

**Pre-Launch Cron Checklist:**
- [ ] `CRON_SECRET` set in Vercel environment
- [ ] Cron registered at cron-job.org for `*/30 * * * *`
- [ ] `/api/cron/circle-settlement` returns 200 on first dry-run
- [ ] Admin `/admin/circle-inventory` "Guest-booking payouts" section visible
- [ ] Settlement calculation verified (12% platform fee frozen, per-night attribution)

**Verification:**
```bash
curl -X GET https://staybids.in/api/cron/circle-settlement \
  -H "Authorization: Bearer <CRON_SECRET>"
# Expected: 200 { "processed": 0, "ledger_rows_created": 0, "message": "no bookings yet" }
```

---

## STEP 7: GO-LIVE SIGN-OFF (Day 5, EOD)

### Checklist: All Systems Ready

**Technical:**
- [ ] All 3 hotels `approval_status = 'approved'`
- [ ] 30 rooms (10+10+10) allocated to investors
- [ ] Pricing (floors) set from Spine
- [ ] Cron running (`*/30 * * * *`)
- [ ] Admin payout panel live at `/admin/circle-inventory`

**Operational:**
- [ ] Staff trained on guest checkin/checkout
- [ ] Investor welcome emails sent (access details, earn model)
- [ ] Emergency contact tree tested (Kaaju, Prince, Claude)
- [ ] 24/7 support ready (Prince)

**Legal/Financial:**
- [ ] Investor agreements signed (3 copies each)
- [ ] Tax ID collection complete (for 1099/settlement)
- [ ] Razorpay test payments successful
- [ ] Settlement test cron (mark a test payment as owed, then paid)

**Sign-Off:**
- Prince (Operations): ✓ Ready
- Kaaju (Properties): ✓ Ready
- Ayushi P (Investor Relations): ✓ Ready
- Legal: ✓ Approved
- Claude (Tech Guidance): ✓ Ready

---

## TROUBLESHOOTING DURING PROVISIONING

### Issue: Room allocation fails (hotel_room_units INSERT fails)

**Cause:** Hotel ID doesn't exist or has wrong `owner_type`

**Fix:**
1. Verify hotel exists: `SELECT id, owner_type FROM hotels WHERE id = 'hco_dhanaulti_001'`
2. Confirm `owner_type = 'host_circle'`
3. If wrong, update: `PATCH hotels SET owner_type = 'host_circle'`
4. Retry room allocation

### Issue: Spine pricing data missing

**Cause:** `room_date_price` table has no data for the date range

**Fix:**
1. Check Spine freshness: `/api/cron/price-spine` last run time
2. If stale, trigger cron immediately: `GET /api/cron/price-spine?force=1`
3. Wait 5 min, re-check Spine
4. Fall back to manual pricing (use Booking.com ADR as reference)

### Issue: Investor can't log in to `/partner/dashboard`

**Cause:** OAuth token type mismatch or missing operator scope

**Fix:**
1. Verify investor `sb_token` (Firebase), not `sb_partner_token`
2. Re-grant operator access: `POST /api/circle/grant-operator-access`
3. Test login flow: `/auth` → Google → `/partner/dashboard`
4. Check browser console for token errors

### Issue: Settlement cron returns 503 `cron_auth_unconfigured`

**Cause:** `CRON_SECRET` missing in Vercel environment

**Fix:**
1. Go to Vercel project settings → Environment Variables
2. Add `CRON_SECRET` with a strong random value (≥32 chars)
3. Redeploy: `git push` (Vercel auto-redeploys)
4. Re-run cron: `GET /api/cron/circle-settlement` with `Authorization: Bearer <CRON_SECRET>`

---

## TIMELINE SUMMARY

| Task | Day | Owner | Sign-Off |
|------|-----|-------|----------|
| Pre-provision checklist | 1 | Kaaju | ☐ |
| Create 3 host_circle hotels | 1-2 | Claude/Admin | ☐ |
| Allocate rooms to investors | 2-3 | Claude/Admin | ☐ |
| Set Spine pricing | 3-4 | Claude | ☐ |
| Activate properties (→ approved) | 4-5 | Kaaju/Admin | ☐ |
| Grant operator access | 1-5 (parallel) | Claude | ☐ |
| Verify cron readiness | 4-5 | Prince | ☐ |
| Go-live sign-off | 5 (EOD) | All | ☐ |

**Next Phase:** Investor Onboarding Manual (concurrent with provisioning).

---

*Provisioning Runbook — Version 1 (August 17, 2026)*
*StayBid Circle Model 1 — Phase 1 Execution*
