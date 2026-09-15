# Aug 20 Launch Day Checklist — Hour-by-Hour Execution

**Date:** August 20, 2026 (Wednesday)
**Launch Time:** 10:00 AM IST
**Timezone:** IST (UTC+5:30)
**Properties Go-Live:** Rishikesh, Mussoorie, Dhanaulti
**Target:** Zero blockers, 100% operational readiness

---

## Pre-Launch (Aug 18–19)

### Aug 18 (T-2 days)
- [ ] **Tech Verification** — Run full end-to-end smoke test (create investor, upload property, mint settlement ledger row)
- [ ] **Database Check** — Confirm Supabase migrations applied, host_circle hotels marked `approval_status='approved'`
- [ ] **Cron Jobs Registered** — `/api/cron/circle-settlement` registered on cron-job.org for `*/30 * * * *` (daily test run)
- [ ] **Razorpay Config** — Verify test mode checkout works (investor payment flow)
- [ ] **Admin Panel** — Confirm `/admin/circle-inventory` loads, settlement ledger visible
- [ ] **Hotel Partner Access** — 3 property managers logged in, can see their units + investor payouts view

### Aug 19 (T-1 day)
- [ ] **Investor Confirmations** — WhatsApp blast: "Going live tomorrow 10 AM IST. Check your email for activation link."
- [ ] **Hotel Comms** — Call each property manager: "Ready for investor bookings from 10 AM IST tomorrow"
- [ ] **Support Team Briefing** — Train on settlement FAQ, payout timelines, investor onboarding
- [ ] **Vercel Preview Build** — Confirm latest build is live at `staybids.in` (no rollback needed)
- [ ] **Backup Comms** — Prepare manual investor email templates (in case bulk messaging fails)
- [ ] **Monitor Setup** — Open dashboards for real-time metrics tracking (Vercel logs, Supabase queries, Razorpay dashboard)

---

## Launch Day (Aug 20)

### 09:00 AM (T-60 min) — Final Pre-Launch Checks

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Cron settlement test run (dry-run query) | Tech | [ ] | Query bookings from last 120d, log settlement rows (0 actual inserts) |
| API health check `/health` | Tech | [ ] | All 3 services respond 200 OK |
| Supabase connection test | Tech | [ ] | `SELECT COUNT(*) FROM hotels WHERE owner_type='host_circle'` → 3 rows |
| Razorpay test payment | Tech | [ ] | Create test order, verify checkout modal loads, cancel (no actual charge) |
| Admin dashboard load test | Tech | [ ] | `/admin/circle-inventory` opens in <2s, settlement ledger empty (0 rows yet) |
| All 3 property managers online (WhatsApp group) | Ops | [ ] | Ready to respond to guest inquiries |
| Customer support hotline live | Ops | [ ] | Phone forwarding active, team in headsets |
| Investor relations team standby | Investor Ops | [ ] | Email + WhatsApp monitors active |
| Vercel monitoring enabled | Tech | [ ] | Alerts set for error rates >1%, response time >2s |
| Supabase monitoring enabled | Tech | [ ] | Alerts set for query latency >500ms |

**GO / NO-GO Decision Point:** 09:50 AM IST
- All boxes checked → **PROCEED** to 10:00 AM launch
- Any RED box → **HOLD** — debug and escalate to owner

---

### 10:00 AM (Launch Moment) — Go Live

| Task | Owner | Deadline | Status |
|------|-------|----------|--------|
| **ACTIVATE** — Frontend shows Phase 1 hero badge + Circle hub | Tech | 10:00 AM | [ ] |
| **ANNOUNCE** — Send bulk WhatsApp to 50 investors: "🎉 StayBid Circle LIVE! Browse properties now." (link: `staybids.in/circle`) | Investor Ops | 10:01 AM | [ ] |
| **MONITOR** — Open live dashboard: Vercel > Analytics, Supabase > Logs, Razorpay > Transactions | Ops | 10:00 AM | [ ] |
| **HOTEL ALERT** — Call property managers: "Investors are now live. Accept bookings on CircleOps dashboard." | Ops | 10:02 AM | [ ] |
| **SUPPORT WARMUP** — Send team message: "Live launch in progress. Respond to inquiries in <2 min." | Ops | 10:00 AM | [ ] |

---

### 10:00 AM – 10:30 AM (First 30 Min) — Critical Monitoring

**Every 5 minutes, check:**
- [ ] Vercel response time (target <1.5s)
- [ ] Supabase query latency (target <500ms)
- [ ] Razorpay checkout modal loads (<3s)
- [ ] No 5xx errors in logs
- [ ] Zero blocked/failed payments

**Escalation Triggers (Immediate action):**
1. **Vercel down** (status red) → Rollback to last stable build
2. **Supabase unreachable** (query error) → Failover to read-only cache, notify owner
3. **Razorpay timeout** (>10s checkout) → Manual payment fallback (email invoice link)
4. **>10 support inquiries** about same issue → Log ticket, notify tech team

**Success Signals (expected in first 30 min):**
- ✅ 5–10 investors viewing properties
- ✅ 1–2 properties receiving inquiries
- ✅ 0 payment failures
- ✅ <100ms avg response time

---

### 10:30 AM – 12:00 PM (First 90 Min) — Stabilization Phase

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Log first 10 page views | Tech | [ ] | Confirm Vercel analytics working |
| First investor checkout attempt (even if not completed) | Tech | [ ] | Verify Razorpay integration |
| First property manager dashboard login | Ops | [ ] | Confirm partner portal accessible |
| Send "All systems nominal" status to owner | Tech | [ ] | Brief summary of metrics |
| Investor FAQ — proactive WhatsApp responses | Investor Ops | [ ] | Answer "How do I pay?", "When do I get money?" |

**Continue monitoring dashboards** — log any anomalies.

---

### 12:00 PM – 04:00 PM (Mid-Day Operations)

| Time | Task | Owner | Status |
|------|------|-------|--------|
| 12:00 PM | Mid-day sync call (5 min standup) | Ops Lead | [ ] |
| 1:00 PM | Check Supabase for new rows (properties viewed, inquiries logged) | Tech | [ ] |
| 2:00 PM | First investor onboarding email sent (if signup detected) | Investor Ops | [ ] |
| 3:00 PM | Log payment volume vs. 10 AM predictions | Finance | [ ] |
| 3:30 PM | Team briefing: "What we learned in first 5 hours" | Ops Lead | [ ] |

**Monitoring continues:** Dashboards open, team responsive.

---

### 04:00 PM – 08:00 PM (Extended Operations)

- [ ] **Cron settlement dry-run** (if any paid bookings completed) — verify settlement ledger rows compute correctly (0 actual payouts yet, Phase 1 is manual)
- [ ] **First investor payout inquiry** — respond with: "Payouts processing weekly on Fridays (Sep 5+). Interim manual transfers via WhatsApp."
- [ ] **Evening sync** (4:00 PM IST) — 15-min team call: metrics, blockers, next 12h plan
- [ ] **Hotel manager check-ins** — call property managers: "Any issues? Any bookings?"

---

### 08:00 PM – 10:00 PM (Evening Wrap-Up)

| Task | Owner | Status | Decision |
|------|-------|--------|----------|
| **End-of-day metrics** — investors viewed, bookings/inquiries, payment success rate | Tech | [ ] | Green / Yellow / Red |
| **Errors log review** — any 5xx, timeouts, failed queries? | Tech | [ ] | Log in Slack #circle-launch |
| **Investor sentiment** — review WhatsApp feedback, support tickets | Investor Ops | [ ] | Any red flags? |
| **Hotel feedback** — any property manager concerns? | Ops | [ ] | Action items for day 2? |
| **Owner notification** — send Aug 20 summary (1 paragraph + metrics table) | Ops Lead | [ ] | Send by 9 PM IST |

**Success Criteria for Aug 20:**
- ✅ Zero critical errors (no 5xx, no payment reversal, no data loss)
- ✅ ≥5 investors active (viewed properties or created profile)
- ✅ ≥2 properties receiving inquiries/bookings
- ✅ 100% uptime (Vercel + Supabase + Razorpay)
- ✅ All team communications working (WhatsApp, email, dashboard)
- ✅ No owner escalations

---

## Aug 21–22 (Post-Launch)

### Aug 21 (Day +1)
- [ ] **Investor follow-up** — email to 50 investors who didn't sign up yet: "Missed it? Circle launches today."
- [ ] **Settlement dry-run analysis** — if any paid bookings in logs, run manual settlement query (confirm row computation logic)
- [ ] **Hotel manager sync** — debrief on first day, address feedback
- [ ] **Metrics review** — 24-hour KPI snapshot (users, bookings, revenue)

### Aug 22 (Day +2)
- [ ] **Cron job final test** — run live settlement cron if bookings pending (confirm PASS 1 SETTLE + PASS 2 REVERSE)
- [ ] **Manual payout process** — if confirmed paid bookings, run manual investor payout batch (via Razorpay/bank transfer, log in settlement tracker)
- [ ] **Week 1 plan** — confirm Aug 25 property provisioning readiness

---

## Emergency Contacts

| Role | Name | Phone | Email | WhatsApp |
|------|------|-------|-------|----------|
| **Project Lead** | [Owner Name] | [+91 ...] | [email] | [link] |
| **Tech Lead** | [Tech Owner] | [+91 ...] | [email] | [link] |
| **Ops Lead** | [Ops Owner] | [+91 ...] | [email] | [link] |
| **Investor Ops** | [Investor Owner] | [+91 ...] | [email] | [link] |
| **Finance/Payout** | [Finance Owner] | [+91 ...] | [email] | [link] |

**Escalation Chain:**
1. First issue detected → Notify on-duty Tech Lead (Slack + call)
2. Tech Lead cannot resolve in 5 min → Notify Project Lead
3. Project Lead assessment → Owner decision (pause launch / rollback / proceed with workaround)

---

## Post-Launch (Sep 1–25)

Transition to **Phase 1 Validation Checklist** (`docs/PHASE1_VALIDATION_CHECKLIST.md`):
- Daily metrics review (occupancy, guest revenue, investor payouts)
- Weekly investor cohort checks (onboarding progress, KYC completion)
- Settlement ledger audits (PASS 1/2 idempotency, payout accuracy)
- Hotel manager performance (response time, booking confirmation rate)

**Gate:** 8/10 success metrics GREEN by Sep 25 → Oct 1 Phase 2 decision.
