# StayBid Circle Model 1 — Aug 20 Execution Kickoff Checklist

**Launch Date:** August 20, 2026, 10:00 AM IST  
**Pre-Launch Window:** Aug 8–19 (12 days)  
**Owner:** Sachin (Executive) + Prince (Ops) + Kaaju (Properties) + Ayushi P (Investors) + Claude (Tech)

---

## CRITICAL PATH (Must Complete by Aug 19, 11:59 PM)

### PROPERTIES (Kaaju) — Aug 8–19

#### Property 1 (Dhanaulti)
- [ ] **Rooms Configured:** 4 Deluxe 2-pax + 2 Premium 4-pax = 6 units live in system
- [ ] **Pricing Seeded:** room_date_price rows created Aug 1–Sep 30 (own/night ₹1,000 base, guest ₹2,000)
- [ ] **Amenities + Photos:** Hero image + room thumbnails uploaded to S3
- [ ] **Staff Trained:** Housekeeping + front-desk (2 FTE) completed Circle onboarding video
- [ ] **WhatsApp Active:** Business account linked, guest comms template ready
- [ ] **Guest Page Live:** `/hotels/hco_dhanaulti_001` renders correctly (hero, rooms, pricing, booking button)
- [ ] **Backup Systems:** Emergency contact list, escalation tree posted at property

#### Property 2 (Rishikesh Foothills)
- [ ] **Rooms Configured:** 4 Deluxe 2-pax + 1 Premium 4-pax + 1 Suite 4-pax = 6 units
- [ ] **Pricing Seeded:** room_date_price rows Aug 1–Sep 30
- [ ] **Amenities + Photos:** Live on guest page
- [ ] **Staff Trained:** 2 FTE Circle-ready
- [ ] **WhatsApp Active:** Ready for guest comms
- [ ] **Guest Page Live:** `/hotels/hco_rishikesh_001` live

#### Property 3 (Mussoorie Hillside)
- [ ] **Rooms Configured:** 4 Deluxe 2-pax + 2 Premium 4-pax = 6 units
- [ ] **Pricing Seeded:** room_date_price rows Aug 1–Sep 30
- [ ] **Amenities + Photos:** Complete
- [ ] **Staff Trained:** 2 FTE ready
- [ ] **WhatsApp Active:** Live
- [ ] **Guest Page Live:** `/hotels/hco_mussoorie_001` live

#### Operations (All 3 Properties)
- [ ] **Daily Occupancy Check-in Script:** 10:00 AM IST, all 3 managers sync occupancy status
- [ ] **Incident Escalation Path:** Property manager → Kaaju → Prince → Sachin (clear ownership)
- [ ] **Payout Timeline Visual:** Printed + posted at each property (investors see payout dates)
- [ ] **Housekeeping Checklist:** Circle guests = premium service standard (linen quality, bathroom amenities)
- [ ] **Emergency Supplies:** Backup linen, toiletries, phone charger station (support guest comfort)

---

### INVESTORS (Ayushi P) — Aug 8–19

#### Investor Onboarding (10 Investors by Aug 19)
- [ ] **KYC Complete:** 10/10 investor documents verified + approved by compliance
- [ ] **Bank Details Captured:** Account number + IFSC + name (for payout setup) in system
- [ ] **Legal Agreements Signed:** SEBI-compliant disclosure + settlement terms printed + signed
- [ ] **Payment Collected:** ₹50–80 lakh per investor × 10 = ₹5–8 crore capital raised
- [ ] **Razorpay Verify:** Each payment HMAC-verified, settlement_ledger.payout_status='pending' rows created

#### Investor Activation (Aug 19, 5 PM IST)
- [ ] **Dashboard Live:** Each investor logs into `/circle/me` → sees their 3 properties, monthly rate, projected earnings
- [ ] **Portfolio Allocated:** Each investor assigned to 1–2 properties (avoid concentration risk)
- [ ] **Initial Email Sent:** "Your Circle portfolio is live! Check-in at 10 AM Aug 20 for launch"
- [ ] **WhatsApp Group Created:** "StayBid Circle Investors" (20 members = 10 Phase 1 + ops team)
- [ ] **Launch Day Explainer:** 2-min video shared (what to expect at 10 AM, how to watch bookings in real-time)

#### Pre-Launch Communications
- [ ] **Investor Call (Aug 19, 4 PM IST):** Sachin + Ayushi P host 30-min live call with 10 investors
  - Walk through dashboard
  - Explain settlement + payout timeline
  - Q&A (live)
  - "See you tomorrow at 10 AM!"
- [ ] **SMS Blast (Aug 19, 8 PM IST):** "Circle goes live tomorrow 10 AM. Check dashboard in real-time. Questions? Call us."
- [ ] **Email (Aug 19, 9 PM IST):** Formal launch notification + link to dashboard login

---

### SETTLEMENT ENGINE (Claude) — Aug 8–19

#### Cron Jobs + Database
- [ ] **`circle-settlement` cron registered** (*/30 * * * * = every 30 min)
  - [ ] Registered on cron-job.org (scheduled execution)
  - [ ] Bearer token auth working (CRON_SECRET in Railway env)
  - [ ] Test run: simulate 1 booking → verify settlement_ledger row created with 12% fee
- [ ] **settlement_ledger table live:**
  - [ ] Columns present: id, investor_user_id, booking_id, net_amount, payout_status, created_at
  - [ ] RLS policy confirmed (only investors see their own rows)
  - [ ] Indexes created (lookup by investor_user_id, by payout_status)
- [ ] **Booking → Settlement Chain:**
  - [ ] `/api/bids/[id]/pay` → creates booking (bids.status='paid', bookings.id created)
  - [ ] Cron PASS 1 (SETTLE): confirmed booking → settlement_ledger row (kind='guest_booking', net=paid_amount×0.88)
  - [ ] Manual test: book 3 rooms → verify 3 settlement rows created within 30 min

#### Payment Verification
- [ ] **Razorpay Webhook Setup:**
  - [ ] `/api/razorpay/webhook` registered on Razorpay dashboard
  - [ ] Test payment verified (webhook hits server, settlement created)
  - [ ] Error logging: 503 if webhook fails (ops alerted)
- [ ] **Payment Verification 4-Key Idempotent:**
  - [ ] `/api/bids/[id]/verify` checks razorpay_order_id + bid_id + status=pending_payment + owner
  - [ ] Duplicate verify returns 200 (already processed), NEVER double-charges
  - [ ] Test: verify same payment 3× → verify only 1 booking created

#### Monitoring + Dashboards
- [ ] **Admin Dashboard (`/admin/circle-inventory`):**
  - [ ] "Settlement Ledger" tab shows all rows (investor, booking, amount, payout_status, created_at)
  - [ ] Sortable by status (owed/paid/cancelled)
  - [ ] "Mark Paid" button working (manual interim payout record)
- [ ] **Payout Monitoring Script:**
  - [ ] Daily report template (email to Prince): # rows created, # rows paid, # pending, # errors
  - [ ] Script runs at 11:00 AM IST (30 min after first bookings expected)

---

### TECH INFRASTRUCTURE (Claude) — Aug 8–19

#### Frontend Deployment
- [ ] **Vercel Build Green:**
  - [ ] `npm run build` succeeds (no TypeScript errors, no SWC panics)
  - [ ] `tsc --noEmit` clean
  - [ ] Production environment variables set (NEXT_PUBLIC_API_URL, Razorpay key ID, Firebase)
- [ ] **Circle Routes Live:**
  - [ ] `/circle/discover` renders property cards (3 properties, approval_status='approved')
  - [ ] `/circle/build` (property details + room picker) works end-to-end
  - [ ] `/circle/review` (checkout, payment flow) tested with ₹100 test payment
  - [ ] `/circle/me` (investor dashboard) shows portfolio + projected earnings
- [ ] **Hotspot Feature Flags:**
  - [ ] `ENABLE_CIRCLE=1` (live)
  - [ ] `CIRCLE_LAUNCH_DATE='2026-08-20'` (used for marketing banners)

#### Backend Deployment (Railway)
- [ ] **Node/Express Healthy:**
  - [ ] `/health` returns 200 + `{ status: 'ok' }`
  - [ ] `/api/proxy/…` routes forward to Supabase correctly (no auth errors)
  - [ ] `/api/cron/circle-settlement` accepts Bearer token, rejects missing/wrong token
- [ ] **Environment Variables Set:**
  - [ ] `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (live keys, not test)
  - [ ] `CRON_SECRET` (unique value, >20 chars)
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` (for admin operations, e.g., investor user lookup)
  - [ ] `JWT_ACCESS_SECRET` (HS256 signing key)

#### Database + Backups
- [ ] **Supabase Backup Scheduled:**
  - [ ] Daily backups at 2 AM IST (before launch day)
  - [ ] Test restore: run once (confirm backups work before live)
- [ ] **Read-Only Replica (optional, for reporting):**
  - [ ] If available, confirm settlement queries run against replica (no booking perf impact)

---

### PAYMENTS (Prince + Sachin) — Aug 8–19

#### Razorpay Account
- [ ] **Live Keys Confirmed:**
  - [ ] Razorpay live account (not sandbox, production merchant ID)
  - [ ] Live keys in Vercel Production env (frontend checkout) + Railway Production env (server verify)
  - [ ] Test payment (₹1 payment) succeeds end-to-end (checkout → capture → verify → settlement)
- [ ] **Webhook Registered:**
  - [ ] URL: `https://staybid-live-production.up.railway.app/api/razorpay/webhook`
  - [ ] Event types: `payment.authorized`, `payment.failed`, `payment.captured`
  - [ ] Test: trigger webhook manually, confirm receipt logged
- [ ] **Compliance:**
  - [ ] Razorpay KYC complete (no restrictions on transaction volume)
  - [ ] Settlement to bank account enabled (payouts within 24h if applicable)

#### Investor Payout Setup
- [ ] **Manual Payout Mechanism (Interim, until RazorpayX Oct 1):**
  - [ ] Prince has access to `/admin/circle-inventory` "Mark Paid" button
  - [ ] Clicking "Mark Paid" flips settlement_ledger.payout_status='owed' → 'paid'
  - [ ] Email notification sent to investor (backend `/api/notifications/investor-payout`)
  - [ ] Test: mark 1 ledger row paid → investor receives email

---

### LAUNCH DAY READINESS (Sachin + Prince) — Aug 19

#### Pre-Launch Standup (Aug 20, 9:30 AM IST)
- [ ] **Operations Standup (30 min):**
  - [ ] Sachin: "CEO ready, final sign-off?"
  - [ ] Prince: "Ops green, payout infra confirmed"
  - [ ] Kaaju: "All 3 properties staffed + live"
  - [ ] Ayushi P: "10 investors activated, dashboard green"
  - [ ] Claude: "Settlement cron running, no errors in logs"
  - [ ] **Decision:** GO for 10:00 AM launch or HOLD
- [ ] **All-Hands Notification (9:45 AM IST):**
  - [ ] Slack post: "#staybid-circle-ops: LAUNCH IN 15 MIN — all systems GO"
  - [ ] Emergency escalation: Prince (Ops) on standby for payout issues, Claude (Tech) for bugs
  - [ ] Guest support: property managers at desks, phones live

#### Launch Execution (10:00 AM IST)
- [ ] **Property Pages Go Public:**
  - [ ] `/circle/discover` shows 3 properties (approval_status='approved' flipped at 10:00 AM)
  - [ ] Guest users can browse, open rooms, see pricing
- [ ] **Investor Dashboard Visible:**
  - [ ] Each investor logs in, sees their portfolio + "Live, earning from today"
  - [ ] Projected earnings calculated correctly (10 investors × ₹50–80k = ₹5–8 lakh total)
- [ ] **First Bookings Expected (10:00–12:00 PM):**
  - [ ] Goal: ≥5 confirmed bookings by noon (Phase 1 success metric)
  - [ ] Each booking triggers settlement_ledger row within 30 min
  - [ ] Investors see real-time payout amounts in dashboard (recalculated every 15 min)
- [ ] **24/7 Monitoring:**
  - [ ] Prince watches payout queue (Slack updates every 30 min)
  - [ ] Claude monitors settlement ledger (cron logs, error rate <1%)
  - [ ] Kaaju tracks occupancy across 3 properties

#### Post-Launch (Aug 20, Evening)
- [ ] **Day 1 Debrief (6 PM IST, 15 min):**
  - [ ] Total bookings: {count} (target: ≥5)
  - [ ] Settlement rows created: {count}
  - [ ] Investor satisfaction: any complaints?
  - [ ] Technical issues: any bugs or timeouts?
  - [ ] Action items for Aug 21
- [ ] **Investor Communications (7 PM IST):**
  - [ ] Email to all 10 investors: "Day 1 Recap — X bookings secured, your payout growing"
  - [ ] WhatsApp update: "Circle live and earning! Check your dashboard anytime"

---

## SECONDARY READINESS (Aug 8–19, Parallel Work)

### Documentation (Complete ✓)
- [ ] Phase 1 Provisioning Runbook (final copy to team)
- [ ] Phase 1 Investor Onboarding Manual (send to Ayushi P)
- [ ] Phase 1 Settlement Payout Guide (send to Prince + Claude)
- [ ] Phase 1 Launch Day Playbook (distribute to all ops team)
- [ ] StayBid_Circle_Phase1_LaunchPackage.pdf (print + bind copies for team)

### Marketing (Ayushi P)
- [ ] **Social Media Blast (Aug 19):**
  - [ ] Instagram story: "StayBid Circle launches tomorrow — guaranteed income for investors"
  - [ ] LinkedIn post: "Investor-powered hospitality — Aug 20"
  - [ ] Email to waitlist (500 emails): "Registrations opening soon"
- [ ] **Press Kit Ready:**
  - [ ] 1-page summary (what is Circle, why investors love it, launch date)
  - [ ] Team photos (Sachin, Prince, Kaaju, Ayushi P, Claude)
  - [ ] Property hero images (social media + press)

### Investor Relations (Ayushi P)
- [ ] **FAQ Document:**
  - [ ] "How do I see my earnings?" → dashboard
  - [ ] "When do I get paid?" → monthly payouts (manual Aug–Sep, automated Oct onward)
  - [ ] "What if occupancy drops?" → settlement tied to real bookings, no guarantees
- [ ] **Support Handbook:**
  - [ ] Common issues + solutions (e.g., dashboard login, payout verification)
  - [ ] Escalation contacts (Ayushi P first, then Sachin for disputes)

---

## GO/NO-GO DECISION (Aug 19, 10 PM IST)

### Must-Have GREEN (Hard Stop Conditions)
- [ ] All 3 properties approval_status='approved' (settlement won't flow without it)
- [ ] 10/10 investors activated + dashboard login working
- [ ] Razorpay live keys verified + test payment successful
- [ ] Settlement cron registered + test run successful (1 booking → 1 ledger row)
- [ ] `/health` endpoint returns 200 (backend alive)

### Nice-to-Have GREEN (Non-Blocking)
- [ ] Marketing ready (social media, email blasts)
- [ ] Phase 1 documentation printed + distributed
- [ ] Investor FAQ finalized

### Decision Owners
| Role | Approval | Status |
|------|----------|--------|
| Executive (Sachin) | GO / NO-GO | ☐ |
| Operations (Prince) | GO / NO-GO | ☐ |
| Properties (Kaaju) | GO / NO-GO | ☐ |
| Investors (Ayushi P) | GO / NO-GO | ☐ |
| Tech (Claude) | GO / NO-GO | ☐ |

**Final Launch Decision:**
- [ ] **GO: Launch Aug 20, 10:00 AM IST (all 5 approvals GREEN)**
- [ ] **HOLD: Defer to Aug 27 (reason: _________________)**
- [ ] **ABORT: Defer to Sep 3 (reason: _________________)**

---

## EMERGENCY CONTACTS (Aug 20, 24/7)

| Role | Name | Phone | Slack | Responsibility |
|------|------|-------|-------|-----------------|
| Executive | Sachin | [phone] | @sachin | Final decision authority, investor escalations |
| Operations | Prince | [phone] | @prince | Payout processing, bank issues, incident command |
| Properties | Kaaju | [phone] | @kaaju | On-site issues, staff coordination, occupancy |
| Investors | Ayushi P | [phone] | @ayushi-p | Investor comms, satisfaction, churn prevention |
| Tech | Claude | [phone] | @claude | Platform bugs, cron failures, data issues |

**Escalation Path (Critical Issue):**
1. Issue detected → notify responsible owner (above)
2. Not resolved in 30 min → page Sachin (final decision)
3. Payment/settlement issue → priority 1 (Sachin + Prince both)

---

*Aug 20 Execution Checklist — Version 1 (August 17, 2026)*  
*StayBid Circle Model 1 — Launch Readiness & GO/NO-GO Gating*
