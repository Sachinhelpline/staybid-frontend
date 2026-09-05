# StayBid Circle Model 1 — Phase 1: Launch Day Playbook

**Launch Date:** September 8, 2026 (Sunday) ☀️
**Launch Time:** 10:00 AM IST
**Primary Owner:** Prince (Operations Lead)
**Backup Leads:** Kaaju (Properties), Ayushi P (Investor Relations)

---

## EXECUTIVE SUMMARY

September 8 is the day 3 properties go LIVE and 10+ investors start earning from real guest bookings. This playbook ensures zero downtime, fast incident response, and investor confidence from Day 1.

**Success Criteria:**
- ✅ All 3 properties visible in guest browse (staysbid.in)
- ✅ First guest booking lands by 12:00 PM IST
- ✅ Cron settlement runs at 10:30 AM IST (demo run, no real bookings yet)
- ✅ All 10 investors receive go-live email
- ✅ 0 critical incidents, <5 min resolution for any issue

---

## PHASE 1: PRE-LAUNCH (Days Before)

### 48 Hours Before (August 15, Friday)

**10:00 AM IST — Full Team Standup**

| Owner | Checklist | Status |
|-------|-----------|--------|
| Prince | Verify all 3 properties in draft mode | ☐ |
| Prince | Cron `/api/cron/circle-settlement` test run | ☐ |
| Kaaju | Confirm staff trained at all 3 properties | ☐ |
| Ayushi P | Investor go-live email ready (send Sep 8 at launch) | ☐ |
| Claude | Tech stack live check (Supabase, Razorpay, Firebase) | ☐ |
| Prince | Database backup created (pre-launch snapshot) | ☐ |

**Expected Output:** Green checklist, all systems tested, team confident.

**If Any Item Red:**
- [ ] Flag immediately to Sachin
- [ ] Do NOT proceed to launch until resolved
- [ ] Defer launch 24h if critical blocker

### 24 Hours Before (August 16, Saturday)

**Infrastructure Checklist**

| Item | Check | Owner | ✓ |
|------|-------|-------|---|
| **Database** | Supabase 100% healthy | Claude | ☐ |
| **APIs** | All endpoints responding (200 OK) | Prince | ☐ |
| **Cron** | `/api/cron/circle-settlement` registered (*/30) | Prince | ☐ |
| **Razorpay** | Test payments work end-to-end | Prince | ☐ |
| **Email** | Notifications sending + not bouncing | Ayushi P | ☐ |
| **Inventory** | Room availability calculated + visible | Claude | ☐ |
| **Properties** | All 3 approval_status = DRAFT (hidden) | Kaaju | ☐ |

**Expected Output:** All green. Backup plan activated if 1+ red.

**Backup Plan (If 1 Item Red):**
- Option A: Fix and re-test (48h allowed)
- Option B: Defer launch 1 week, fix offline

### Full Team Sync (August 16, Saturday, 2:00 PM IST)

**Participants:** Prince, Kaaju, Ayushi P, Claude, Sachin (approve final go/no-go)

**Agenda (30 min):**
1. Infrastructure green light (2 min)
2. Investor readiness (3 min) — 10 investors ready, payouts queued
3. Property readiness (3 min) — Staff trained, rooms allocated
4. Communications ready (2 min) — Emails drafted, no typos
5. Incident plan rehearsal (5 min) — Test one scenario
6. Final Q&A (5 min)
7. GO/NO-GO decision (5 min)

**Decision:**
- [ ] **GO** — Proceed to launch Sep 8, 10:00 AM
- [ ] **NO-GO** — Defer, reason: [____________________]

---

## PHASE 2: LAUNCH DAY (September 8, Sunday)

### Pre-Launch Window (9:30–10:00 AM IST)

**9:30 AM IST — Ops Team Early Standup (30 min)**

**Participants:** Prince, Kaaju, Claude

| Owner | Task | Notes | ✓ |
|-------|------|-------|---|
| Prince | Check Supabase + Railway status pages | Any incidents? | ☐ |
| Prince | Verify all systems responding (curls) | 200 OK on all | ☐ |
| Claude | Recheck Spine data (base rates, live prices) | Latest from DB | ☐ |
| Kaaju | Confirm all staff on standby at 3 properties | Ready for guests | ☐ |
| Prince | Slack channel pinned (escalation link) | #circle-launch active | ☐ |
| Ayushi P | Investor email drafted + queued to send at 10:15 AM | Ready to blast | ☐ |

**Expected Output:** Zero red items. System stable, team ready.

**If Any Red:**
- [ ] Declare incident (use Escalation Tree below)
- [ ] Target resolution: 30 min
- [ ] If can't resolve, defer launch 24h
- [ ] Notify Sachin + investors (delay email)

**9:30 AM IST — Pre-Launch Email to Investors (Scheduled)**

**Sent automatically at 9:30 AM, delivered by 10:00 AM:**

```
Subject: 🎉 StayBid Circle Is LIVE in 30 Minutes!

Hi [Investor Name],

Your properties are going LIVE at 10:00 AM IST.

✨ What's happening:
• Your rooms open for guest bookings
• Live pricing + availability active
• First bookings expected within hours
• Your earnings journey begins TODAY

📱 Dashboard ready: [/circle/me link]

🎯 Next steps:
1. Log in to your investor dashboard
2. View your allocated room(s)
3. Watch for guest bookings in real-time

Questions? Reply or call Prince: +91 9876543210

Let's GO! 🚀
```

### LAUNCH (10:00 AM IST — Live Go-Time)

**10:00 AM IST — PROPERTIES LIVE**

**Action 1: Flip All 3 Hotels to 'approved'**

```
PATCH /api/admin/hotels/{hotel_id}
{ "approval_status": "approved" }

Hotels to flip:
  - hco_dhanaulti_001
  - hco_rishikesh_001
  - hco_mussoorie_001
```

**By 10:02 AM, verify:**
- [ ] All 3 properties visible in `/api/discover/feed`
- [ ] Individual rooms bookable
- [ ] Guest-facing pricing (MRP, not investor cost) showing correctly
- [ ] Images loading

**Action 2: Send Go-Live Email to Investors**

```
Subject: 🎯 You're LIVE! Earnings Start NOW

Hi [Investor Name],

Your StayBid Circle investment is officially LIVE! 🎉

Your room(s) are now open to guests. Here's what to expect:

📈 Dashboard: [/circle/me] - See bookings in real-time
💰 First payout: After first guest checkout + cron settlement
📧 Alerts: You'll get notified on every booking + payout

The "Always in Season" model is working:
  • Dhanaulti: Peak season begins (spring holidays)
  • Rishikesh: Autumn season active
  • Mussoorie: Summer escape season strong

Expect your first guest booking within 2 hours.

Questions? Call Prince: +91 9876543210

Welcome to the circle! 🚀
```

**Send at 10:05 AM IST**

### Peak Window (10:00 AM–12:00 PM IST)

**10:00–10:30 AM:** First 30 Minutes (Stabilization)

| Owner | Task | Target | Status |
|-------|------|--------|--------|
| Prince | Monitor Supabase logs (errors, anomalies) | 0 errors | ☐ |
| Prince | Check Razorpay webhook (payment confirmations) | >0 payments | ☐ |
| Claude | Monitor API response times (p99 latency) | <500ms | ☐ |
| Ayushi P | Monitor investor emails (delivery success) | 100% | ☐ |
| Kaaju | Check property booking inflow (telemetry) | >0 bookings | ☐ |

**Expected:** Properties visible, guests browsing, 0 errors.

**10:30 AM IST — Cron Settlement Test Run**

```
GET /api/cron/circle-settlement
Authorization: Bearer <CRON_SECRET>
```

**Expected Response:**
```json
{
  "status": "success",
  "processed": 0,
  "ledger_rows_created": 0,
  "message": "no confirmed bookings yet",
  "next_run": "2026-09-08T11:00:00Z"
}
```

**If Cron Fails:**
- [ ] Check `CRON_SECRET` in env
- [ ] Check DB connectivity
- [ ] Escalate (see Incident Response below)

**10:30–11:00 AM:** First Hour Monitoring

| Owner | Metric | Target | Status |
|-------|--------|--------|--------|
| Prince | Supabase CPU + memory | <70% | ☐ |
| Prince | API error rate | <0.1% | ☐ |
| Claude | Database queries (avg latency) | <200ms | ☐ |
| Kaaju | Guest booking count | ≥1 | ☐ |
| Ayushi P | Investor dashboard access count | >5 | ☐ |

**11:00 AM–12:00 PM IST:** Mid-Morning Surge

**Expected Activity:**
- 5–10 guest bookings (first wave)
- Investor dashboard traffic (+30% from baseline)
- Email notifications flowing (bookings, confirmations)

**Monitoring During Surge:**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Supabase CPU | >80% | Alert Prince, consider scaling |
| API error rate | >1% | Investigate, escalate if >5% |
| Booking latency | >2s | Log, monitor for pattern |
| Email bounce rate | >5% | Check email service, resend |

**By 12:00 PM IST Target:**
- ✅ ≥5 guest bookings
- ✅ All 3 properties visible + bookable
- ✅ 0 critical incidents
- ✅ Investor dashboard live + accessible
- ✅ Cron ran successfully (10:30 AM run)

### Mid-Day Sync (12:00 PM–12:30 PM IST)

**12:00 PM IST — Executive Check-In (15 min)**

**Participants:** Prince, Kaaju, Ayushi P, Sachin

**Agenda:**
1. Launch status (3 min) — Green/yellow/red summary
2. Metrics review (3 min) — Bookings, errors, performance
3. Investor feedback (3 min) — Any complaints?
4. Next 12 hours (3 min) — Monitoring, handoff plan
5. Celebration ≠ relaxation (3 min) — Stay alert until 48h

**Decision:**
- [ ] **GREEN** — Proceed normally, reduced monitoring after 6 PM
- [ ] **YELLOW** — Keep elevated monitoring, review at 6 PM
- [ ] **RED** — Incident response (see below)

---

## PHASE 3: POST-LAUNCH MONITORING (Sep 8–14)

### First 24 Hours (Sep 8, 10:00 AM–Sep 9, 10:00 AM)

**Schedule:**
- 10:00 AM: Launch + 1st surge
- 2:00 PM: Mid-day check-in (booking count, cron success)
- 6:00 PM: Evening report (investor feedback, issues)
- 10:00 PM: Night handoff (escalation for overnight)
- 10:00 AM next day: 24-hour debrief

**Daily Metrics to Track:**

| Metric | Sep 8 Target | Sep 8 Actual | Notes |
|--------|--------------|--------------|-------|
| Guest bookings | ≥5 | [__] | All properties |
| Settlement ledger rows | 0 | [__] | Too early (no checkouts) |
| Investor logins | >10 | [__] | Dashboard access |
| Email errors | <2% | [__] | Notifications |
| API errors | <0.5% | [__] | 5xx responses |
| Cron runs | 3 (10:30, 11:00, 11:30 AM) | [__] | All 200 OK |

### First 7 Days (Sep 8–14)

**Daily Standups (10:00 AM, 15 min)**

| Day | Owner | Focus |
|-----|-------|-------|
| Sep 8 | Prince | Launch day recap + issues |
| Sep 9 | Prince | Investor onboarding, first checkouts expected |
| Sep 10 | Kaaju | Property ops feedback, staff issues |
| Sep 11 | Ayushi P | Investor sentiment + support tickets |
| Sep 12 | Claude | Performance metrics + optimization |
| Sep 13 | Prince | Settlement ledger review (first real payouts) |
| Sep 14 | All | Week 1 retrospective + Week 2 plan |

**Milestone Events:**

| Date | Event | Owner | Action |
|------|-------|-------|--------|
| Sep 8 | Properties go live | Prince | ✓ |
| Sep 9 | First guest checkout (estimated) | Kaaju | Verify settlement triggers |
| Sep 9–11 | Settlement cron creates first ledger rows | Claude | Audit ledger accuracy |
| Sep 12 | Admin marks first payouts as 'paid' | Prince | Execute manual bank transfer |
| Sep 14 | Investor receives first payout email | Prince/Ayushi P | Celebrate! |

### First 30 Days (Sep 8–Oct 8)

**Weekly Syncs (Every Friday, 10:00 AM)**

| Week | Date | Attendees | Agenda |
|------|------|-----------|--------|
| 1 | Sep 15 | All | Launch week debrief |
| 2 | Sep 22 | All | Booking velocity, occupancy trends |
| 3 | Sep 29 | All | Settlement accuracy, payout completeness |
| 4 | Oct 6 | All | Month 1 review, scaling plan |

---

## INCIDENT RESPONSE PLAYBOOK

### Severity Levels

| Level | Definition | Response | Owner |
|-------|-----------|----------|-------|
| **CRITICAL (Red)** | Properties not visible OR payment failures OR cron down | 5 min target | Prince + Claude |
| **HIGH (Yellow)** | Booking delays (>10s) OR email errors (>10%) OR property partial outage | 15 min target | Prince |
| **MEDIUM (Orange)** | Single investor complaint OR feature bug (non-core) | 1 hour target | Ayushi P / Kaaju |
| **LOW (Blue)** | UI polish OR documentation | EOD target | Anyone |

### Incident Response Tree

**CRITICAL INCIDENT DETECTED:**

```
1. IDENTIFY
   ↓
   What's down?  Property browse? Payment? Cron?
   ↓
   Page alerting ON (escalate to on-call)

2. TRIAGE (2 min)
   ↓
   Prince: Check Supabase status page + logs
   Claude: Check Railway backend + logs
   ↓
   ROOT CAUSE: Database? API? Third-party?

3. COMMUNICATE (2 min)
   ↓
   Investor email: "Investigating property outage — ETA 10 min"
   Slack: #circle-launch with incident details
   ↓
   Set incident channel timer (decision point every 5 min)

4. MITIGATE (5 min or escalate)
   ↓
   Option A: Quick fix (restart service, flip setting)
   Option B: Rollback (previous working version)
   Option C: Failover (switch to backup environment)
   ↓
   If 5 min elapsed, escalate to Sachin

5. VERIFY (2 min)
   ↓
   Test the fix (manual booking, cron run)
   ↓
   All green? → RESOLVED

6. COMMUNICATE RESOLUTION (1 min)
   ↓
   Investor email: "Issue resolved at [time], bookings re-enabled"
   Slack: #circle-launch update
   ↓
   Post-incident review in 24h
```

### Critical Incident: Properties Not Showing

**Symptoms:** Guest browse `/api/discover/feed` returns no Circle properties

**Investigation (3 min):**
1. Check hotel status: `SELECT approval_status FROM hotels WHERE owner_type='host_circle'`
   - If DRAFT → flip to approved (accidental rollback?)
   - If approved → check visibility filters

2. Check database: Are rooms allocated? `SELECT COUNT(*) FROM hotel_room_units WHERE hotel_id IN (...)`
   - If 0 → rooms not allocated (provision step failed)
   - If >0 → check inventory availability

3. Check API: Does `/api/hotels/hco_dhanaulti_001` return 200?
   - If 404 → hotel doesn't exist (creation failed)
   - If 500 → database error

**Fix Options:**
- Option A: Hotels are in DRAFT → `PATCH approval_status='approved'`
- Option B: Rooms not allocated → Re-run provisioning step
- Option C: API error → Restart Railway backend

**If <5 min to resolve:** Implement fix, test, communicate resolution

**If >5 min:** Escalate to Sachin, consider deferring launch 24h

### Critical Incident: Razorpay Payment Fails

**Symptoms:** Guest clicks "Book" → payment says "Processing" → never completes

**Investigation (3 min):**
1. Check Razorpay status: https://razorpay.com/status
   - If down → wait + retry (not our fault)
   - If up → check API integration

2. Check webhook: Are payments being verified? `/api/razorpay/verify` logs
   - If webhook missing → re-register in Razorpay dashboard
   - If webhook 503 → API down, restart

3. Check env vars: Is `NEXT_PUBLIC_RAZORPAY_KEY_ID` set?
   - If not → payment button won't show
   - If yes → test payment flow manually

**Fix Options:**
- Option A: Razorpay down → customer retry (notify investors: "Temporary payment delays")
- Option B: Webhook down → restart Vercel deployment
- Option C: Env var missing → set in Vercel, redeploy

**If <5 min to resolve:** Implement + test

**If >5 min:** Accept guest bookings offline (email + manual payment), settle later

### Critical Incident: Cron Settlement Down

**Symptoms:** Cron `/api/cron/circle-settlement` returns 503

**Investigation (2 min):**
1. Check auth: Is `CRON_SECRET` set? `curl -H "Auth: Bearer <secret>" /api/cron/circle-settlement`
   - If 401 → secret wrong
   - If 200 → working

2. Check database: Can Supabase be reached? (test query from Railway)
   - If timeout → DB down
   - If 200 → DB fine

3. Check logs: `/admin/logs` → search 'circle-settlement'
   - Look for errors in last 5 min

**Fix Options:**
- Option A: Secret wrong → Update in Vercel env, redeploy
- Option B: DB down → Wait for Supabase recovery (monitor status page)
- Option C: API error → Restart Railway backend

**If <5 min to resolve:** Implement fix

**If >5 min:** Cron will auto-retry every 30 min; settlement can be manual later

---

## ESCALATION CONTACT TREE

**Severity CRITICAL:**

```
First response: Prince (Operations Lead)
├─ Can't resolve in 5 min?
│  └─ Escalate to Sachin (CEO)
│     ├─ Can't resolve in 15 min?
│     │  └─ Escalate to Claude (Tech Lead, advisory)
│     │     └─ Consider: defer launch 24h OR accept manual workaround
```

**Contact Details:**

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Prince | Prince | [phone] | prince@staybid.in |
| Ayushi P | Ayushi | [phone] | ayushi@staybid.in |
| Kaaju | Kaaju | [phone] | kaaju@staybid.in |
| Claude | Claude | (advisory) | claude@staybid.in |
| Sachin | Sachin | [phone] | sachin@staybid.in |

**Escalation Triggers:**
- 5+ consecutive errors
- Any CRITICAL level incident
- >30 min unresolved issue
- Investor complaints (>3 same issue)

---

## GO-LIVE SUCCESS CRITERIA

### Day 1 (Sep 8)

- [x] ✅ All 3 properties visible in guest browse
- [x] ✅ ≥5 guest bookings
- [x] ✅ Cron runs 3+ times, 0 errors
- [x] ✅ All 10+ investors receive go-live email
- [x] ✅ Investor dashboards accessible
- [x] ✅ 0 critical incidents
- [x] ✅ <5 min resolution for any issue

### First 24 Hours (Sep 8–9)

- [x] ✅ ≥10 total guest bookings
- [x] ✅ ≥1 guest checkout (settlement trigger)
- [x] ✅ Settlement ledger rows created (cron PASS 1)
- [x] ✅ Investor emails sent (payout notifications)
- [x] ✅ <2% payment error rate
- [x] ✅ <1% API error rate

### First 7 Days (Sep 8–14)

- [x] ✅ ≥50 total guest bookings
- [x] ✅ All 10 investors receive ≥1 payout email
- [x] ✅ Settlement accuracy verified (12% fee, per-night attribution)
- [x] ✅ 0 duplicate payouts
- [x] ✅ 0 investor escalations (except expected questions)
- [x] ✅ Booking velocity stable (trend analysis)

### First 30 Days (Sep 8–Oct 8)

- [x] ✅ ≥300 total guest bookings
- [x] ✅ All investors receive monthly payout
- [x] ✅ Average occupancy ≥60% (expected: 70%)
- [x] ✅ Average investor satisfaction ≥4/5 stars
- [x] ✅ 0 money-path regressions

---

## POST-LAUNCH DEBRIEF (Sep 14, 10:00 AM)

**30-min all-hands review:**

1. **What Went Well (10 min)**
   - Smooth launch? ✓
   - Metrics hit targets? ✓
   - Investor feedback positive? ✓

2. **What Could Improve (10 min)**
   - Any bottlenecks?
   - Unexpected issues?
   - Team friction?

3. **Metrics Review (5 min)**
   - Bookings, payouts, errors (compare vs targets)

4. **Week 2 Plan (5 min)**
   - Scale to 20 investors?
   - Add 4th property?
   - Any fixes needed?

---

## APPENDIX: QUICK REFERENCE

### Critical Endpoints (Test Before Launch)

```bash
# Database health
curl https://staybids.in/api/health → 200

# Properties visible
curl https://staybids.in/api/discover/feed?city=dhanaulti → 200, >0 hotels

# Razorpay working
curl -X POST https://staybids.in/api/bids/checkout → 200, razorpay_order_id returned

# Cron running
curl -H "Authorization: Bearer <CRON_SECRET>" https://staybids.in/api/cron/circle-settlement → 200

# Admin panel
curl https://staybids.in/admin/circle-inventory (with admin token) → 200
```

### Environment Variable Checklist

- [x] `NEXT_PUBLIC_RAZORPAY_KEY_ID` → active test/live key
- [x] `RAZORPAY_KEY_SECRET` → set in Vercel server secrets
- [x] `CRON_SECRET` → strong random ≥32 chars
- [x] `JWT_ACCESS_SECRET` → shared with Railway, ≥32 chars
- [x] `SUPABASE_SERVICE_ROLE_KEY` → only for admin gate

---

*Launch Day Playbook — Version 1 (August 17, 2026)*
*10:00 AM Start Time — All Timings Adjusted*
*StayBid Circle Model 1 — Phase 1 Go-Live*
