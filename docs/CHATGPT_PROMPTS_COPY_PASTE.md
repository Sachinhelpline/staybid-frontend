# ChatGPT Prompts — Ready to Copy & Paste

**Instructions:** Copy the prompt below, paste into ChatGPT, hit Enter. Request "Generate a Mermaid flowchart" or "Create a responsibility matrix" as needed.

---

## PROMPT 1: Project Manager / Launch Lead
```
I'm launching StayBid Circle Phase 1 on Aug 20, 2026, and Phase 2 starting Oct 1.

PHASE 1 (Aug 20 – Sep 25):
- Aug 20: Go-live Rishikesh, Mussoorie, Dhanaulti (3 properties)
- Aug 20–Sep 25: Investor onboarding pipeline (50 leads → KYC → payment → activation)
- Settlement ledger cron (PASS 1 SETTLE at booking confirmation, PASS 2 REVERSE at refund)
- Manual payout process (interim, before RazorpayX Oct 1)
- Sep 25: Validation gate (8/10 success metrics GREEN)

PHASE 2 (Oct 1 – Dec 31):
- Oct 1: RazorpayX automation goes live (daily 10 AM batch payouts)
- Oct 1–15: Expand to Property 4 (Rishikesh) + Property 5 (Mussoorie)
- Nov 1: Investor feature gates (pricing overrides, B2B resale, dashboard analytics)
- Nov 15–Dec 31: Scale to 25+ investors, ₹9.26 crore guest revenue projected

CRITICAL DEPENDENCIES:
- Phase 1 success (8/10 metrics) → Oct 1 Phase 2 go/no-go decision
- RazorpayX env setup (Oct 1) → Blocks auto payout

Please create a Mermaid flowchart showing:
1. All 8 major milestones (Aug 20, Sep 1, Sep 25, Oct 1, Oct 15, Nov 1, Nov 15, Dec 31)
2. Dependencies between phases (Phase 1 → validation → Phase 2)
3. Key blockers (RazorpayX env, property expansion, feature gates)
4. Success criteria at each gate

Format: Gantt chart or flowchart. Include labels for each milestone.
```

---

## PROMPT 2: Tech Lead
```
I'm launching investor payouts on StayBid Circle with this architecture:

PHASE 1 (Aug 20 – Sep 30): MANUAL PAYOUT MODE
Cron: POST /api/cron/circle-settlement (*/30 * * * *)
- PASS 1 SETTLE: Loop over confirmed bookings (checkOut ≥ today−120d, bounded 200)
  - Resolve per-night payee (owner_user_id)
  - Compute payout: paid_amount × (1 − 12% fee)
  - INSERT settlement_ledger (kind='guest_booking', status='owed', fee=12%)
  - Idempotent via UNIQUE(kind, ref_id)
- PASS 2 REVERSE: If booking is cancelled/refunded, flip owed→cancelled
- Admin manual mark_guest_booking_paid (owed→paid)

PHASE 2 (Oct 1 onwards): AUTO PAYOUT MODE (RazorpayX)
- Oct 1 10:00 AM IST: Cron phase becomes auto (checks owed→paid, triggers RazorpayX batch)
- Daily batch (10 AM IST) via RazorpayX API
- Idempotent idempotent key = settlement_ledger.id

TABLES:
- settlement_ledger (id, booking_id, owner_user_id, kind, ref_id, payout_status, amount, fee_pct)
- bookings (id, bids→assignedUnitId→owner_user_id, paidAmount, status)

Please create:
1. A flowchart showing PASS 1 SETTLE + PASS 2 REVERSE logic
2. A swimlane diagram (Phase 1 manual vs Phase 2 auto)
3. RazorpayX integration point (Oct 1 trigger)
4. Error handling paths (booking missing, owner deleted, RazorpayX timeout)

Include: data flow, decision points, fallback behaviors.
```

---

## PROMPT 3: Ops Lead / Launch Coordinator
```
I'm leading operations for StayBid Circle Phase 1 (Aug 20) and Phase 2 (Oct 1+).

PHASE 1 OPERATIONS (Aug 20 – Sep 25):
- Aug 20: Launch day execution (investor announcements, property manager comms, real-time monitoring)
- Aug 20–Sep 25: Investor WhatsApp onboarding (50 leads → inquiry → KYC → payment → activation)
- Weekly hotel manager sync calls
- Settlement payout process (manual, weekly Fridays via bank transfer)
- Support ticket triage (<2 min response time)
- Metrics tracking (daily occupancy, guest revenue, investor signups)

PHASE 2 OPERATIONS (Oct 1 – Dec 31):
- Oct 1–15: 2 new property setups (similar to Aug 20 launch for each)
- Oct 1: RazorpayX payout automation (hand-off to finance/tech, Ops monitors)
- Investor feature rollout (Nov 1: pricing overrides, B2B resale, analytics dashboard)
- Scaling: 25+ new investors by Nov 15, 50+ by Dec 31
- Weekly KPI reviews + owner syncs

TEAM ROLES:
- Ops Lead (you): Coordinates launch day, property manager comms, investor pipeline
- Hotel Ops Mgr × 3: Property-level guest bookings, investor coordination
- Investor Ops: WhatsApp/email outreach, onboarding pipeline
- Finance/Payout: Settlement ledger audits, manual payouts (Phase 1), RazorpayX monitoring (Phase 2)

Please create:
1. A daily workflow matrix for Phase 1 (Aug 20 hour-by-hour, Aug 21+ daily, weekly syncs)
2. A role responsibility chart (Ops Lead vs Hotel Ops vs Investor Ops vs Finance)
3. A Phase 2 transition chart (Oct 1 RazorpayX go-live + new property expansions)
4. Key handoff points (when Ops → Finance, Ops → Tech, etc.)

Format: Mermaid swimlane diagram or RACI matrix. Color-code by role.
```

---

## PROMPT 4: Investor Relations Lead
```
I'm running investor onboarding for StayBid Circle Phase 1 (Aug 20 launch) and Phase 2 (Oct 1+).

PHASE 1 JOURNEY (Aug 20 – Sep 25):
Step 1 (Launch day): Announce Circle LIVE → WhatsApp blast to 50 leads
Step 2 (Explainer): Property showcase → Demo properties (Rishikesh, Mussoorie, Dhanaulti)
Step 3 (Discussion): 1:1 call → Investor questions, expectations
Step 4 (KYC): Form submission → ID + bank details
Step 5 (Legal): Agreement sign → Investment commitment
Step 6 (Payment): Razorpay checkout → Initial capital transfer
Step 7 (Activation): Dashboard access → Investor can see bookings + payouts

PHASE 2 JOURNEY (Oct 1 – Dec 31):
- Oct 1+: 25 new investors onboarded (same 7-step flow, monthly cohorts)
- Nov 1+: Feature rollout (pricing overrides, B2B resale marketplace)
- Dashboard self-service (analytics, payout history, KPIs)
- Scaling to 50+ investors by Dec 31

COMMUNICATION TEMPLATES:
- Launch announcement: "StayBid Circle LIVE. Invest now → 30–50% revenue from guest bookings."
- KYC reminder: "Complete 3-min ID verification to unlock investment."
- Payment follow-up: "Your ₹X investment is ready. Click to checkout."
- Activation: "Congrats! Your units are live. First payouts come Sep 30."
- Phase 2 upgrade: "New features live: Dynamic pricing, B2B resale. Explore dashboard."

Please create:
1. A funnel chart: 50 leads → awareness → KYC → payment → active (Phase 1)
2. A 7-step investor journey flowchart (with decision points: drop-off, convert, upgrade)
3. A communication calendar (Aug 20 announcement → weekly nurture → payout confirmation)
4. Phase 2 scaling flowchart (25 new cohorts, Nov feature rollout, Dec expansion)

Format: Funnel + flowchart + timeline. Include conversion rate estimates (e.g., 50 leads → 8 investors in Phase 1).
```

---

## PROMPT 5: Finance / Payout Lead
```
I manage payouts for StayBid Circle investors.

PHASE 1 (Aug 20 – Sep 30): MANUAL PAYOUT PROCESS
- Daily: Cron settlement ledger runs (creates "owed" rows for confirmed bookings)
- Weekly (Fridays): Manual audit → mark settlement_ledger "owed" → "paid"
- Manual transfer: Bank transfer or Razorpay Direct (investor bank account)
- Ledger schema: settlement_ledger(id, booking_id, owner_user_id, kind='guest_booking', payout_status='owed'/'paid', amount, fee_pct=12%)
- Audit gate: 0 leftover owed rows after weekly payout run

PHASE 2 (Oct 1 onwards): AUTO PAYOUT VIA RAZORPAYX
- Oct 1 10:00 AM: RazorpayX setup complete (API keys, batch mode enabled)
- Daily 10:00 AM IST cron: Auto-queries owed rows, triggers RazorpayX batch
- Idempotent: settlement_ledger.id = RazorpayX idempotency key (prevents double-pay)
- Payout lag: <24h (investor receives money by next business day)
- Exception handling: Declined account → manual retry, bounced → hold + notify
- Monthly reconciliation: compare settlement_ledger paid total vs RazorpayX payout total

PHASE 1 KPIs:
- Weekly payout volume: ₹X total across N investors
- Payout accuracy: 100% (0 failed transfers)
- Audit time: <2h per week
- Investor satisfaction: <2 payout complaints

PHASE 2 KPIs (with RazorpayX):
- Daily payout automation: 95%+ success (RazorpayX)
- 5%–10% manual retry (bounced/declined)
- Payout lag: <24h
- Month-end reconciliation time: <1h

Please create:
1. A Phase 1 manual payout workflow (daily cron → weekly audit → manual transfer)
2. A Phase 2 auto payout workflow (daily cron → RazorpayX batch → idempotent verification)
3. An exception handling matrix (bounced account, declined, API error, etc.)
4. A Phase 1 → Phase 2 transition diagram (Oct 1 cutover, parallel run option)

Format: Swimlane diagram (Process → Cron → RazorpayX → Settlement) + error tree.
```

---

## PROMPT 6: Hotel Operations Manager (Per Property)
```
I manage a property on StayBid Circle (Phase 1 Aug 20 launch → Phase 2 Oct 1+).

MY PROPERTY:
- Name: [Rishikesh / Mussoorie / Dhanaulti]
- Units: N rooms
- Guest bookings: [occupancy % expected in Phase 1]

PHASE 1 OPERATIONS (Aug 20 – Sep 25):
- Aug 20 10:00 AM: Properties go live for investor bookings
- Investor requirements: View unit details, book unit for given dates
- My role:
  - Confirm bookings (accept/decline within 1h of inquiry)
  - Answer investor questions (<2h response time)
  - Provide guest booking data (occupancy, dates, guest details)
  - Coordinate with investors on special requests
  - Report issues to Ops Lead
- Revenue flow: Guest pays → Booking confirmed → Settlement ledger creates "owed" row for investor
- Weekly payouts (Sep 1, 8, 15, 22, 29): Investors receive money every Friday

PHASE 2 OPERATIONS (Oct 1 – Dec 31):
- Oct 1+: RazorpayX auto payouts (I don't need to approve, happens automatically)
- Oct 15–20: New property expansion (if applicable) — 2 additional properties join Circle
- Nov 1: Investors gain pricing overrides (can adjust rates ±20–30% on their units)
- My new role: Coordinate with multiple investors on dynamic pricing adjustments
- Monthly analytics: Dashboard shows occupancy, revenue by investor, rating trends

DAILY CHECKLIST:
- Check new investor bookings (inquiries)
- Respond to investor messages
- Update occupancy calendar
- Report blockers to Ops

Please create:
1. A daily Phase 1 operational checklist (Aug 20 onwards)
2. A Phase 2 transition checklist (Oct 1 RazorpayX, Nov 1 pricing features)
3. A communication template: investor inquiry → response → booking confirmation
4. A dashboard mockup showing what I'll see as a property manager (occupancy, investor names, payout status)

Format: Checklist + workflow + screenshot mockup.
```

---

## PROMPT 7: Admin / Super Admin
```
I'm the admin/super-admin for StayBid Circle Phase 1 & 2.

PHASE 1 ADMIN DUTIES (Aug 20 – Sep 25):
- Sep 25 Validation Checklist: Track 8/10 success metrics
  - Metric 1: ≥8 investors active (KYC complete + payment done)
  - Metric 2: ≥80% occupancy on 3 properties
  - Metric 3: ₹ X total guest revenue (Phase 1 target)
  - Metric 4: 100% settlement ledger accuracy (0 orphaned rows)
  - Metric 5: <2h investor support response time
  - Metric 6: 0 failed payouts
  - Metric 7: 0 critical system errors
  - Metric 8: Investor satisfaction NPS >50
- Weekly settlement audits: Verify cron PASS 1/2 logic, approve manual payouts
- Dashboard access: `/admin/circle-inventory` (settlement ledger, investor payouts, KPIs)
- Oct 1 Phase 2 decision: GO/NO-GO based on Sep 25 metrics

PHASE 2 ADMIN DUTIES (Oct 1 – Dec 31):
- Oct 1: RazorpayX automation monitoring (daily payout success rate ≥95%)
- Oct 1–15: Approve 2 new property expansions
- Nov 1: Feature gate review (pricing overrides enable, B2B resale enable, analytics dashboard enable)
- Monthly scaling reviews: 25 → 50+ investors, revenue tracking
- Dec 31: Year-end audit (total guest revenue, investor payouts, system health)

ADMIN TOOLS:
- Settlement ledger (query, audit, manual mark_guest_booking_paid)
- Investor dashboard (KYC status, payment status, payout history)
- Property manager dashboard (occupancy, revenue, bookings)
- Cron job monitoring (settlement runs, RazorpayX batch status)
- Alerts: Failed payment, settlement orphan rows, high response time

Please create:
1. A Sep 25 validation checklist (8/10 metrics, GO/NO-GO framework, decision tree)
2. A Phase 2 feature gate rollout chart (Oct 1 RazorpayX → Oct 15 properties → Nov 1 features → Nov 15 scaling)
3. An admin dashboard layout mockup (settlement ledger, KPIs, alerts)
4. A monthly admin audit checklist (Oct, Nov, Dec)

Format: Checklist + flowchart + dashboard mockup.
```

---

## How to Use

1. **Pick your role** (1–7 above)
2. **Copy the entire prompt** from the triple backticks (```)
3. **Open ChatGPT** (chat.openai.com)
4. **Paste the prompt** into the chat
5. **Hit Enter** and let ChatGPT generate
6. **Request format:**
   - "Generate a Mermaid flowchart" → Get diagram code
   - "Create a responsibility matrix" → Get table/CSV
   - "Make a swimlane diagram" → Get structured diagram
   - "Export as SVG" → Get vector-ready graphic
7. **Save outputs** locally or print

---

**Done.** Copy any prompt above → ChatGPT → generates workflow/diagram.
