# StayBid Circle Model 1 — Phase 1: Settlement & Payout Guide

**Owner:** Prince (Operations) + Claude (Technical)
**Timeline:** Automated cron + manual interim admin payout
**Audience:** Admin team, Prince (Ops), Investors (payouts)

---

## Overview

Settlement is the REAL MONEY path: a guest books and pays → the booking is confirmed → a cron job runs every 30 minutes → settlement ledger entries are created (kind='guest_booking') → the admin marks them as PAID → investors receive monthly payouts.

This guide covers the **interim phase** (manual payout) and the **full automation** path (future RazorpayX integration).

---

## THE SETTLEMENT ARCHITECTURE

### High-Level Flow

```
1. GUEST BOOKS
   Guest picks room → Pays via Razorpay → Booking confirmed (status=paid)

2. GUEST CHECKS OUT (after stay)
   Checkout date passes → Booking fulfilled

3. CRON SETTLEMENT (*/30 min)
   /api/cron/circle-settlement runs
   → Finds confirmed bookings (checkOut ≥ today−120d)
   → For each booking: resolves per-night payee
   → Creates settlement_ledger rows (kind='guest_booking')

4. ADMIN MARKS PAID (manual interim)
   Prince reviews settlement ledger
   → Confirms accuracy + bank details
   → Marks ledger rows as payout_status='paid'

5. INVESTOR RECEIVES MONEY (interim manual → future RazorpayX)
   Payout executed (RazorpayX batch or manual bank transfer)
   → Investor gets ₹[net] in their account
   → Email notification sent
```

---

## SECTION 1: SETTLEMENT LEDGER STRUCTURE

### Table: `settlement_ledger`

| Column | Type | Purpose | Example |
|--------|------|---------|---------|
| `id` | CUID | Unique ledger entry | `sl_abc123def456` |
| `kind` | TEXT | Entry type | `'guest_booking'` (only kind in M1) |
| `user_id` | TEXT | Payee (investor/owner) | `'investor_user_1'` |
| `ref_id` | TEXT | Booking reference | `'booking_xyz123:investor_user_1'` |
| `amount_owed` | NUMERIC | Net payout (after 12% fee) | `₹8,800` |
| `payout_status` | TEXT | owed → paid → transferred | `'owed'` |
| `metadata` | JSONB | Booking details | `{booking_id, nights, rate, fee, ...}` |
| `created_at` | TIMESTAMP | Entry created | `2026-09-01 10:30:45 UTC` |
| `paid_at` | TIMESTAMP | Admin marked paid | `2026-09-05 14:20:00 UTC` |

### Key Constraint: Idempotent Ledger Writes

```sql
UNIQUE (kind, ref_id)
ON CONFLICT DO NOTHING;
```

**Why this matters:** If the cron runs twice (or 10 times) on the same booking, only ONE ledger row is created. No double-payouts, no duplicates.

---

## SECTION 2: HOW THE CRON WORKS

### Cron: `/api/cron/circle-settlement`

**Trigger:** Every 30 minutes (*/30 * * * *)
**Auth:** Bearer token (CRON_SECRET)
**Idempotency:** Per-booking via `uniq_settlement_kind_ref`

### Two-Pass Process

#### PASS 1: SETTLE

For each CONFIRMED, PAID booking from the past 120 days:

```
1. Fetch booking
   SELECT id, bidId, checkOut, paidAmount, ... FROM bookings
   WHERE status = 'confirmed'
   AND paidAmount IS NOT NULL
   AND checkOut >= now() - interval '120 days'
   LIMIT 200;  -- Batch limit

2. Resolve payee per-night
   FOR each booking:
     FOR each night in the stay:
       payee = resolveNightlyPayees(bookingId, night);
       // Returns: investor_user_id (if owned block)
       //        OR owner_user_id (if hotel owner)

3. Create settlement_ledger row
   INSERT INTO settlement_ledger
     (kind, user_id, ref_id, amount_owed, payout_status, metadata)
   VALUES
     ('guest_booking', payee, 'booking_xyz:payee', net_amount, 'owed', {...})
   ON CONFLICT (kind, ref_id) DO NOTHING;  // Idempotent
```

**Example Settlement Calculation:**

```
Booking Details:
  - Guest paid: ₹10,000 (for 2 nights)
  - Platform fee: 12% = ₹1,200
  - Net to owner: ₹10,000 − ₹1,200 = ₹8,800

Settlement Ledger Entry:
  - kind: 'guest_booking'
  - user_id: 'investor_user_1' (resolved from booking.assignedUnitId→owner_user_id)
  - ref_id: 'booking_xyz123:investor_user_1'
  - amount_owed: ₹8,800
  - payout_status: 'owed'
  - metadata: { booking_id: 'booking_xyz123', nights: 2, rate: ₹5000/night, fee_pct: 12 }
```

#### PASS 2: REVERSE (Refunds)

For each NOW-CANCELLED or REFUNDED booking with still-owed ledger rows:

```
1. Find cancelled bookings
   SELECT id FROM bookings
   WHERE status IN ('cancelled', 'refunded')
   AND checkOut >= now() - interval '120 days';

2. Flip ledger rows to cancelled
   UPDATE settlement_ledger
   SET payout_status = 'cancelled'
   WHERE ref_id LIKE 'booking_xyz:%'
   AND payout_status = 'owed';

   // Net result: originally-owed ₹8,800 is now cancelled (no payout)
```

### Cron Failure Handling

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| CRON_SECRET missing | 503 `cron_auth_unconfigured` | Set env var, redeploy |
| No new bookings | 200 success, 0 ledger rows created | Normal (wait for bookings) |
| Booking lookup fails | 503 `database_unavailable` | Cron auto-retries next 30min |
| Ledger INSERT fails | 503 (fails closed) | Check DB logs, investigate |
| Refund reversal fails | 503 (fails closed) | Manual reversal via admin panel |

---

## SECTION 3: MANUAL PAYOUT FLOW (INTERIM)

### Admin Panel: `/admin/circle-inventory`

**Section:** "🏠 Guest-booking Payouts Owed to Owners"

#### Part A: Settlement Ledger Viewer

**Table Shows:**
- Investor name + ID
- Booking ID + guest name
- Nights (stay duration)
- Room details
- Guest-paid amount
- Platform fee (12%)
- **Net to investor** (the row to pay)
- Payout status (owed/paid/cancelled)

**Filters:**
- Status (owed / paid / cancelled)
- Date range (createdAt)
- Investor name (search)
- Room / property (dropdown)

#### Part B: Manual Payout Action

**Action:** "Mark Paid"

```
SELECT settlement_ledger
WHERE payout_status = 'owed'
AND status NOT IN ('cancelled');

[Investor] [Booking] [Amount] [Mark Paid] [Action Log]
```

**Clicking "Mark Paid":**

1. **Validation:** Confirm investor bank details are on file
2. **Update:** `UPDATE settlement_ledger SET payout_status='paid', paid_at=now()`
3. **Logging:** Log to audit trail (who paid, when, amount)
4. **Notification:** Email investor with payout receipt + bank confirmation

**Audit Trail:**
```
[2026-09-05 14:22:30 UTC] Prince marked sl_abc123 (₹8,800) as PAID
Investor: investor_user_1 | Booking: booking_xyz123
Bank: HDFC ****1234 | Ref: Circle Settlement Sep 2026
```

### Interim Process (August–October 2026)

**Timeline:** Until RazorpayX integration (estimated Oct 2026)

| Step | Owner | Schedule | Notes |
|------|-------|----------|-------|
| Cron runs | Automated | */30 min | Creates settlement_ledger rows |
| Admin reviews | Prince | Daily (EOD) | Checks for errors, invalid amounts |
| Manual payout | Prince | 2×/week (Tue, Fri) | Marks rows as 'paid', triggers bank transfer |
| Investor notified | Automated | Same day as mark-paid | Email receipt + settlement summary |
| Bank transfer | Manual | EOD | Prince or finance team executes via bank portal |

### KPIs Tracked in Admin Panel

```
Dashboard Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Owed:        ₹2,34,000 (5 investors)
Total Paid:        ₹1,58,000 (3 investors)
Total Cancelled:   ₹24,000 (1 refunded booking)
Average Payout:    ₹46,800 per investor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Last Cron Run:     2026-09-05 10:30:00 UTC
Next Run:          2026-09-05 11:00:00 UTC
Ledger Entries:    25 (owed), 15 (paid), 2 (cancelled)
```

---

## SECTION 4: INVESTOR PAYOUT EMAIL

### Template: Monthly Payout Notification

**Subject:** "Your August Payout — ₹8,800 Credited to [Bank]"

```
Hi [Investor Name],

Your August payout has been successfully transferred to your bank account.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAYOUT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Room:                    Dhanaulti Room 5 (Deluxe)
Period:                  August 1–31, 2026
Guest Bookings:          ₹10,000
Platform Fee (12%):      −₹1,200
Your Room Cost:          −₹45,000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NET PAYOUT:              ₹[amount] ✓
TRANSFERRED TO:          [Bank name] ****1234
TRANSFER DATE:           [Date]
REFERENCE:               Circle Settlement Aug 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YEAR-TO-DATE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Received (Aug):    ₹[YTD amount]
Investment Remaining:    ₹[balance from ₹3L]
Months Left (on 1-yr lock): 4 months
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUESTIONS?
📧 Email: circle@staybid.in
📞 Call: +91 9876543210 (Prince)

Thank you for being part of StayBid Circle!
```

---

## SECTION 5: HANDLING EDGE CASES

### Case 1: Guest Cancels & Gets Refund

**Scenario:** Guest books, pays ₹10,000, then cancels before checkout.

**Flow:**
1. Booking status → `'refunded'`
2. Payment reversal initiated (Razorpay reverse)
3. Cron PASS 2 runs: finds cancelled booking
4. `UPDATE settlement_ledger SET payout_status = 'cancelled'` for that booking
5. Investor NEVER receives payout (no row created, or row cancelled)
6. Admin email: "Booking [ID] refunded — settlement cancelled"

### Case 2: Multi-Night Stay Across 2 Investors

**Scenario:** Guest books 3 nights (Aug 30 – Sep 2). Aug 30 is investor_user_1's room, Aug 31 – Sep 2 is investor_user_2's room.

**Flow:**
```
Booking: 3 nights, ₹15,000 total

Per-night resolution:
  Aug 30 → payee = investor_user_1 → 1/3 of ₹15,000 = ₹5,000 gross
  Aug 31 → payee = investor_user_2 → 1/3 of ₹15,000 = ₹5,000 gross
  Sep 1  → payee = investor_user_2 → 1/3 of ₹15,000 = ₹5,000 gross

Settlement ledger rows:
  Row 1: investor_user_1, amount_owed = ₹5,000 − 12% = ₹4,400
  Row 2: investor_user_2, amount_owed = ₹10,000 − 12% = ₹8,800
```

**Verification:** Admin should see 2 separate payout rows per booking, totalling the full booking amount (minus fee).

### Case 3: Partial Refund

**Scenario:** Guest paid ₹10,000, books 2 nights. Cancels 1 night (partial refund ₹5,000).

**Flow:**
1. Booking transitions to `'partially_refunded'` (if supported)
2. Refund issued: ₹5,000 back to guest
3. Revised booking amount: ₹5,000 (for 1 night)
4. Cron: creates settlement ledger for 1 night only
5. Settlement amount: ₹5,000 − 12% = ₹4,400

**Verification:** Ledger shows revised amount, admin manually adjusts if needed.

### Case 4: Admin Error (Mark Paid Twice)

**Scenario:** Prince accidentally clicks "Mark Paid" twice on the same ledger row.

**Protection:** Idempotency built-in
```
First click:  payout_status: owed → paid, paid_at = 2026-09-05 14:22
Second click: Already paid, no change (OR warning: "Already marked paid")
```

**Audit trail prevents double-payout:**
```
[2026-09-05 14:22:30] Marked as paid
[2026-09-05 14:25:00] Click again → "Already paid on Sep 5"
```

---

## SECTION 6: FUTURE: RAZORPAYX AUTOMATION

### Full Money-Out Path (Estimated October 2026)

**New Process:**

```
Cron runs (*/30 min)
  ↓
Creates settlement_ledger rows (kind='guest_booking', payout_status='owed')
  ↓
RazorpayX batch processor (*/1 min) picks up owed rows
  ↓
Verifies investor bank details + amount
  ↓
Submits batch payout to RazorpayX API
  ↓
RazorpayX processes overnight or next business day
  ↓
Payout lands in investor bank account
  ↓
Cron marks payout_status='transferred', updated_at=now()
  ↓
Investor email: "Payout received ₹[amount]"
```

### Interim → Full Automation Migration

**Phase A (Aug–Sep 2026): MANUAL**
- Cron creates ledger rows
- Admin marks 'paid' manually
- Bank transfer manual

**Phase B (Oct 2026): SEMI-AUTOMATIC**
- Cron creates ledger rows
- RazorpayX batch picks up 'paid' rows
- Auto bank transfer

**Phase C (Nov 2026+): FULLY AUTOMATIC**
- Cron creates ledger rows
- RazorpayX monitors for new rows, auto-marks 'paid'
- Auto bank transfer
- Zero manual admin touchpoints

### RazorpayX Configuration Needed

```
Environment Variables (Railway):
RAZORPAYX_ACCOUNT_ID = "acc_[id]"
RAZORPAYX_API_KEY = "[key]"
RAZORPAYX_API_SECRET = "[secret]"

Database: investor_bank_details table
  - investor_id
  - account_holder_name
  - account_number
  - ifsc_code
  - verified (boolean)
```

---

## SECTION 7: MONTHLY FINANCE CHECKLIST

### First of Every Month (Aug 1+)

**By EOD, 1st of month:**

| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| Cron summary report | Automated | ✓ | Email to Prince |
| Settlement ledger review | Prince | ☐ | Check for errors, cancellations |
| Investor payout list | Prince | ☐ | Owed, pending, ready to pay |
| Bank details verification | Prince | ☐ | Confirm no missing accounts |
| Razorpay reconciliation | Finance | ☐ | Match revenue to bookings |
| Manual payouts executed | Prince | ☐ | Mark 'paid' + trigger transfer |
| Investor emails sent | Ayushi | ☐ | Monthly payout notifications |

**By 15th of month:**
- [ ] All Sep payouts transferred to investor accounts
- [ ] 0 outstanding 'owed' rows older than 7 days (except disputed)
- [ ] Monthly finance report to Sachin

---

## SECTION 8: TROUBLESHOOTING

### Issue: Cron Returns 503 `cron_auth_unconfigured`

**Cause:** `CRON_SECRET` missing or incorrect

**Fix:**
1. Verify in Vercel: Settings → Environment Variables → Check `CRON_SECRET`
2. If missing, add it (strong random string, ≥32 chars)
3. Redeploy: `git push` (Vercel auto-redeploys)
4. Test: `curl -H "Authorization: Bearer <CRON_SECRET>" https://staybids.in/api/cron/circle-settlement`
5. Expected: 200 `{ "processed": 0 }`

### Issue: Settlement Ledger Shows ₹0 Payouts

**Cause:** No bookings yet, or cron hasn't run, or fee calculation is wrong

**Fix:**
1. Check: Are there CONFIRMED bookings? `SELECT COUNT(*) FROM bookings WHERE status='confirmed'`
2. If yes, check checkout dates: `SELECT checkOut FROM bookings WHERE checkOut >= now() - interval '120 days'`
3. If still 0, manually trigger cron: `curl https://staybids.in/api/cron/circle-settlement?force=1` (if admin override available)
4. Check logs: `/admin/logs` → search 'circle-settlement'

### Issue: Admin Marks Investor as 'Paid' But Investor Gets Email "Still Owed"

**Cause:** Email template reads old DB state, or cache is stale

**Fix:**
1. Refresh investor dashboard: F5 (browser cache clear)
2. Admin re-marks as 'paid': PATCH settlement_ledger set payout_status='paid'
3. Re-send email manually: `/admin/circle-inventory` → "Resend Receipt"
4. Verify in DB: `SELECT payout_status FROM settlement_ledger WHERE id='sl_...'` → should be 'paid'

### Issue: Double Payout (Cron Ran Twice, 2 Ledger Rows for Same Booking)

**Cause:** Cron ran twice (shouldn't happen, but manual intervention might trigger it)

**Fix:**
1. Check: `SELECT COUNT(*) FROM settlement_ledger WHERE ref_id LIKE 'booking_xyz%'`
2. Should be 1 row per booking. If >1, it's a bug (report to Claude)
3. Workaround: Manually DELETE duplicate rows (keep the first by created_at)
4. Mark the keeper row as 'paid', ignore the duplicate

---

## SECTION 9: COMMUNICATION TEMPLATES

### To Investors: Payout Delayed

**Subject:** Settlement Update — Your Payout is Processing

> Hi [Name],
>
> Your September payout is being processed and will arrive in your bank account by [date].
>
> **Details:**
> - Settlement created: Sep 1
> - Amount: ₹[amount]
> - Status: Verified + Ready for transfer
> - Expected arrival: [date]
>
> Thank you for your patience!

### To Admin: Daily Cron Report

**Email from automated cron summary:**

```
DAILY SETTLEMENT REPORT — Sep 5, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cron runs: 48 (every 30 min)
Bookings processed: 12
Settlement rows created: 12
Errors: 0
Refunds reversed: 1

Total owed: ₹94,000 (12 investors)
Total paid: ₹58,000 (8 investors)
Pending manual mark-paid: 4 investors

Next action: Admin review + manual payouts (by EOD)
```

---

## GLOSSARY

| Term | Definition |
|------|-----------|
| Settlement Ledger | Database table tracking all investor payouts (kind='guest_booking', status=owed/paid/cancelled) |
| Cron | Automated job that runs every 30 min (`*/30 * * * *`) to create settlement ledger entries |
| Payout Status | State of a ledger entry (owed → paid → transferred) |
| PASS 1 | Cron identifies new bookings + creates ledger rows |
| PASS 2 | Cron reverses refunded bookings, flips ledger rows to 'cancelled' |
| Idempotent | Safe to run multiple times; no duplicates (via UNIQUE constraint on kind, ref_id) |
| RazorpayX | Future automated bank transfer platform (currently interim manual) |
| 12% Fee | Platform commission frozen at settlement ledger creation |

---

*Settlement & Payout Guide — Version 1 (August 17, 2026)*
*StayBid Circle Model 1 — Phase 1 Execution*
