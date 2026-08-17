# StayBid Circle Model 1 — Phase 2: Pre-Launch Validation

**Status:** Ready for Oct 1 launch (pending Phase 1 success metrics)
**Timeline:** Sep 8–30 (validation window)
**Owner:** Sachin (Executive) + Prince (Operations) + Claude (Tech)

---

## EXECUTIVE SUMMARY

Phase 2 scales Model 1 from 3 properties + 10 investors to 5 properties + 25–50 investors, automates payouts via RazorpayX, and enables investor marketplace features (pricing controls, B2B selling). Success depends on Phase 1 proving the settlement engine, investor retention, and property occupancy targets.

---

## PHASE 1 SUCCESS METRICS (Must-Hit to Proceed)

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| **Properties Live** | 3/3 approved | ☐ | ☐ |
| **First Bookings** | ≥10 by Day 1 | ☐ | ☐ |
| **Settlement Ledger** | Cron creates rows | ☐ | ☐ |
| **Investor Dashboards** | 10/10 active | ☐ | ☐ |
| **Monthly Payouts** | ≥1 cycle complete | ☐ | ☐ |
| **Occupancy Avg** | ≥40% (baseline) | ☐ | ☐ |
| **Booking Completion** | ≥85% checkout rate | ☐ | ☐ |
| **Investor Satisfaction** | ≥4/5 NPS | ☐ | ☐ |
| **Cron Uptime** | 99.5%+ | ☐ | ☐ |
| **Payment Errors** | <2% | ☐ | ☐ |

**Gate:** If <8/10 metrics GREEN by Sep 25, defer Phase 2 to Nov 1.

---

## PHASE 2 READINESS CHECKLIST

### Technical Infrastructure

| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| RazorpayX account live + API keys | Prince | ☐ | Batch payout endpoint tested |
| Supabase `settlement_ledger` proven stable | Claude | ☐ | 30 days of cron runs, zero data loss |
| Investor dashboard performance (load test ≥50 users) | Claude | ☐ | Latency <500ms for 50 concurrent |
| B2B marketplace SQL schema ready (hotel_room_units transfers) | Claude | ☐ | Schema reviewed, FK constraints checked |
| Pricing override feature (investor controls) backend ready | Claude | ☐ | Admin gate verified |
| Monitoring + alerting dashboard (Vercel/Supabase/Razorpay) | Prince | ☐ | Slack integration active |

### Operational Readiness

| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| Phase 1 post-launch debrief completed (Sep 8–15) | Prince | ☐ | Lessons learned, incident log |
| RazorpayX bank account linked + test transfers passed | Prince | ☐ | ≥3 test payouts to real bank |
| Investor communication plan (Phase 2 features announcement) | Ayushi P | ☐ | Email + dashboard notification ready |
| Property 4 & 5 owner agreements signed (Rishikesh/Mussoorie expansion) | Kaaju | ☐ | Commitments locked, room counts confirmed |
| Staff training updated (new B2B features, pricing controls) | Kaaju | ☐ | Training video + checklist for all 3 properties |
| Legal review (Phase 2 investor agreements, B2B terms) | Legal | ☐ | SEBI compliance re-verified |

### Investor Readiness

| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| Phase 1 investor cohort feedback survey (NPS + pain points) | Ayushi P | ☐ | ≥70% response rate target |
| Phase 2 feature preview (pricing controls, B2B) sent to investors | Ayushi P | ☐ | Soft launch interest gauge |
| Phase 2 investor lead list (Phase 1 → Phase 2 cohort, new leads) | Ayushi P | ☐ | 15–25 warm leads identified |
| KYC pipeline ready for new Phase 2 cohort (25 investors) | Ayushi P | ☐ | Docs templates, verification checklist |

### Financial Readiness

| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| Phase 1 settlement costs analyzed (cron, DB, payout fees) | Prince | ☐ | Cost per payout calculated |
| RazorpayX pricing confirmed + budget approved | Sachin | ☐ | Payout margin modeled, impact on investor net |
| Phase 2 capital budget (5 properties, 50 investors, 3 months) | Sachin | ☐ | Operational costs + contingency 20% |
| Investor payout reconciliation (Sep receipts, disputes resolved) | Prince | ☐ | 100% payment match confirmed |

---

## PHASE 2 FEATURE GATES

### Gate 1: RazorpayX Auto-Payouts (Oct 1)
**Precondition:** Phase 1 settlement ledger proved reliable (30 days, zero data loss)
**Action:** Flip manual payout process to RazorpayX batch processor

| Precondition | Status | Owner |
|--------------|--------|-------|
| `settlement_ledger` row volume ≥100/day average | ☐ | Claude |
| Cron runs 99.5%+ uptime, no missed runs | ☐ | Prince |
| Payout disputes <1% of transactions | ☐ | Prince |
| Bank reconciliation 100% match (sample audit 10 payments) | ☐ | Prince |

### Gate 2: Property Expansion (Oct 15)
**Precondition:** Properties 1–3 at ≥50% occupancy average, investor retention ≥90%
**Action:** Onboard Properties 4–5 (Rishikesh expansion, Manali new)

| Precondition | Status | Owner |
|--------------|--------|-------|
| Property 1–3 monthly occupancy ≥50% | ☐ | Kaaju |
| Investor churn <10% (retention ≥90%) | ☐ | Ayushi P |
| Guest satisfaction ≥4/5 (booking reviews) | ☐ | Kaaju |
| Staff training completion 100% (all 3 properties) | ☐ | Kaaju |

### Gate 3: Investor Features (Nov 1)
**Precondition:** ≥25 investors committed to Phase 2, B2B marketplace SQL schema approved
**Action:** Enable pricing controls, B2B listing, dashboard analytics

| Precondition | Status | Owner |
|--------------|--------|-------|
| 25+ Phase 2 investor commitments (KYC + payment) | ☐ | Ayushi P |
| B2B marketplace schema tested (unit transfers, holds) | ☐ | Claude |
| Investor pricing override logic tested (live + sandbox) | ☐ | Claude |
| Dashboard performance test ≥50 concurrent users | ☐ | Claude |

### Gate 4: Scaling (Nov 15)
**Precondition:** Features stable (0 critical bugs, <5% error rate), ≥40 investors, Properties 4–5 live
**Action:** Ramp to 50 investors, launch holiday season campaign

| Precondition | Status | Owner |
|--------------|--------|-------|
| Phase 2 features ≥7 days incident-free | ☐ | Prince |
| API error rate <5% (all endpoints) | ☐ | Claude |
| 40+ Phase 2 investors active + satisfied | ☐ | Ayushi P |
| Properties 4–5 at ≥40% occupancy | ☐ | Kaaju |

---

## PHASE 2 TIMELINE OVERVIEW

| Week | Owner | Focus | Gate |
|------|-------|-------|------|
| Sep 8–15 (W1) | Prince | Phase 1 post-launch debrief | - |
| Sep 16–22 (W2) | Claude | RazorpayX integration testing | - |
| Sep 23–30 (W3) | Kaaju | Property 4–5 staff training | Gate 2 checkpoint |
| Oct 1–15 (W4–5) | Prince | RazorpayX go-live | Gate 1 GO |
| Oct 15–31 (W6–7) | Kaaju | Properties 4–5 live | Gate 2 GO |
| Nov 1–15 (W8–9) | Claude | Investor features launch | Gate 3 GO |
| Nov 15–Dec 15 (W10–14) | All | Scale to 50 investors | Gate 4 GO |

---

## DECISION TREE: Phase 2 Proceed/Defer

```
Phase 1 (Sep 8–30) Metrics
├─ ≥8/10 GREEN? → YES
│  ├─ RazorpayX ready? → YES → Phase 2 PROCEED (Oct 1)
│  └─ RazorpayX ready? → NO → Defer to Oct 15 (RazorpayX setup)
├─ 6–7/10 GREEN? → YELLOW FLAG
│  └─ Fix blockers by Sep 25? → YES → PROCEED; NO → DEFER to Nov 1
└─ <6/10 GREEN? → RED → DEFER Phase 2 entirely, focus Phase 1 stability
```

---

## RISK REGISTER

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|-----------|-------|
| Phase 1 occupancy <30% (properties unviable) | HIGH | MEDIUM | Adjust pricing, holiday campaign, partner OTA feeds | Kaaju |
| RazorpayX API delays / bank transfer failures | HIGH | LOW | Test 50+ transfers pre-launch, fallback to manual | Prince |
| Investor churn >15% (dissatisfaction) | HIGH | MEDIUM | NPS survey Sep 15, address complaints, feature preview | Ayushi P |
| Settlement ledger data corruption (cron bug) | CRITICAL | LOW | Full backup + test restore, cron log audit weekly | Claude |
| Properties 4–5 owner commitment falls through | MEDIUM | MEDIUM | Backup properties (Manali, Udaipur) pre-identified | Kaaju |
| API performance degrades under 50+ investors | MEDIUM | MEDIUM | Load test Sep 20, caching strategy, DB optimization | Claude |

---

## SIGN-OFF (Oct 1 only)

| Role | Name | Status | Date |
|------|------|--------|------|
| Executive | Sachin | ☐ Ready / ☐ Defer | ____ |
| Operations | Prince | ☐ Ready / ☐ Defer | ____ |
| Properties | Kaaju | ☐ Ready / ☐ Defer | ____ |
| Investors | Ayushi P | ☐ Ready / ☐ Defer | ____ |
| Tech | Claude | ☐ Ready / ☐ Defer | ____ |

**Final Decision:**
- [ ] **GO:** Phase 2 launch Oct 1
- [ ] **DEFER:** Phase 2 launch Nov 1 (reason: _______________)

---

*Phase 2 Validation — Version 1 (August 17, 2026)*
*StayBid Circle Model 1 — Phase 2 Planning*
