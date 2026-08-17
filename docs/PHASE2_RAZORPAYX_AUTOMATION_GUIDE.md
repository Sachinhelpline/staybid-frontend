# StayBid Circle Model 1 — Phase 2: RazorpayX Auto-Payouts (Oct 1)

**Status:** Pre-launch documentation  
**Target Go-Live:** October 1, 2026  
**Scope:** Automated investor payouts via RazorpayX Batch API  
**Owner:** Prince (Ops) + Claude (Tech) + Sachin (Finance)

---

## EXECUTIVE SUMMARY

Phase 2 automates investor payouts using **RazorpayX Batch Payouts API**, eliminating manual reconciliation and wallet transfers. Instead of Prince reviewing settlement ledger rows and processing each payout manually, a **cron job (`/api/cron/circle-settlement-batch-payout`)** runs daily (10 AM IST), aggregates all `settlement_ledger` rows with status='owed', submits them to RazorpayX as a **batch**, and marks them 'paid' on successful confirmation.

**Outcome:** Investors see payouts in their bank account within 24–48 hours (vs. the current 2–5 day manual process).

**Constraint:** RazorpayX **batch payout** (ACH bulk transfer) is fundamentally different from Razorpay **customer payments** (checkout). A separate RazorpayX account, API keys, and bank account linkage are REQUIRED.

---

## PRE-AUTOMATION VALIDATION (Sep 8–30)

Must-hit Phase 1 success metrics (Gate 1 checkpoint, Oct 1):

| Metric | Target | Validation Owner |
|--------|--------|------------------|
| settlement_ledger row volume | ≥100/day average (from ≥10 confirmed bookings/day) | Claude |
| Cron `circle-settlement` uptime | 99.5%+ (28 consecutive days, zero missed runs) | Prince |
| Payout disputes | <1% of transactions (0–1 disputes across Phase 1 bookings) | Ayushi P |
| Bank reconciliation | 100% match (sample audit of 10 payouts, no discrepancies) | Prince |

**Gate Decision:** Sep 25, if <3/4 metrics GREEN → defer RazorpayX to Oct 15 (manual payouts continue).

---

## RAZORPAYX ACCOUNT SETUP (Sep 1–15)

### Step 1: RazorpayX Account Registration (Prince + Sachin)

**Timeline:** 2–3 business days (Razorpay KYC + account review)

**Deliverables:**
- RazorpayX account created (business entity: StayBid, PAN on file)
- **Current Account** linked to the operational bank (e.g., ICICI, HDFC)
- Account verified + activated by Razorpay ops

**Why:** RazorpayX is a **separate platform** from the Razorpay Checkout (customer payments). Investors will be paid OUT of this account via batch payouts.

### Step 2: API Credentials + Testing (Prince + Claude)

**Deliverables:**
- RazorpayX API key + secret (from dashboard Settings → API Keys)
- **Batch Payout API** enabled (request from Razorpay support if not default)
- Test mode credentials (for sandbox testing before live)

**Environment Setup (Railway):**
```
RAZORPAYX_KEY_ID=rzp_live_…          # or rzp_test_… for sandbox
RAZORPAYX_KEY_SECRET=…                # environment-only, NEVER logged
RAZORPAYX_ACCOUNT_ID=acc_…            # the Current Account ID from RazorpayX dashboard
RAZORPAYX_PAYOUT_MODE=NEFT|IMPS|UPI  # default NEFT (batch, 24-48h); IMPS instant but higher fee
```

### Step 3: Test Transfers (Prince + Claude)

**Before Oct 1, execute 3 test transfers in SANDBOX:**

**A. Single Payout Test (Sep 20):**
```
POST /razorpayx/payouts
{
  "account_number": "1234567890123456",  // investor bank account
  "ifsc": "HDFC0000001",
  "amount": 10000,                        // ₹100
  "reference_id": "test_single_20sep",
  "mode": "NEFT"
}
→ Response: payout_id, status='processing'
→ Verify in 2h: status='completed', funds in test bank
```

**B. Batch Payout Test (Sep 25):**
```
POST /razorpayx/payouts/batch
{
  "payouts": [
    { "account_number": "…", "ifsc": "…", "amount": 50000, "reference_id": "batch_test_25sep_1" },
    { "account_number": "…", "ifsc": "…", "amount": 75000, "reference_id": "batch_test_25sep_2" },
    { "account_number": "…", "ifsc": "…", "amount": 30000, "reference_id": "batch_test_25sep_3" }
  ]
}
→ Response: batch_id, status='queued'
→ Verify in 4h: status='processed', 3 payouts in 'completed' state
```

**C. Reconciliation Test (Sep 26):**
```
// Fetch batch details by batch_id
GET /razorpayx/payouts/batch/{batch_id}
→ Verify all 3 individual payout status = 'completed'
→ Verify total amount matches our ledger sum (₹155,000)
→ Mark test ledger rows 'paid' (simulate settlement payout flow)
```

**Success Criteria (Sep 26 EOD):**
- ✅ All 3 test transfers succeeded
- ✅ Test bank received correct amounts in test accounts
- ✅ RazorpayX API latency <2s (p95)
- ✅ Manual reconciliation matched our ledger (0 discrepancies)

### Step 4: Live Bank Account Linkage (Prince + Finance)

**Timeline:** Sep 27–30 (final KYC + compliance)

**Checklist:**
- [ ] Current Account fully activated by Razorpay (no pending KYC)
- [ ] Daily payout limit set to ₹50 lakhs (or per business plan)
- [ ] Investor payee database (name, bank account, IFSC) validated by sample audit
- [ ] Compliance: payout destination accounts are SEBI-registered investors only (no unknown third parties)

**Risk:** If bank account is NOT fully activated by Oct 1, live payouts will fail. **Mitigation:** Confirm activation status Sep 29; if delayed, defer to Oct 15.

---

## PAYOUT SETTLEMENT ENGINE (`/api/cron/circle-settlement-batch-payout`)

### Architecture Overview

**Daily Batch Payout Cron (10:00 AM IST):**
```
SCHEDULE: 0 4 * * * (UTC) = 9:30 AM IST (IST = UTC+5:30)
Run Time: Sep 26 onward (pre-launch testing)
Live Date: Oct 1, 2026

EXECUTION STEPS:
1. SELECT all settlement_ledger rows WHERE payout_status='owed' AND created_at <= now()-24h
2. GROUP by investor_user_id (aggregate per investor)
3. BUILD batch request with investor bank details (from investors.bank_account, investors.ifsc_code)
4. SUBMIT batch to RazorpayX Batch Payout API
5. RECORD batch_id on settlement ledger (settlement_ledger.razorpayx_batch_id)
6. POLL for batch completion (wait up to 4 hours for RazorpayX to process)
7. ON completion: mark settlement_ledger.payout_status='paid', payout_date=now()
8. NOTIFY investor: "₹{amount} sent to your bank account" (email + dashboard message)
```

### Phase A: Aggregate Owed Payouts (3–5 min)

**Query:**
```sql
SELECT
  sl.id,
  sl.investor_user_id,
  sl.booking_id,
  sl.net_amount,
  u.bank_account_number,
  u.bank_ifsc,
  u.email
FROM settlement_ledger sl
JOIN users u ON u.id = sl.investor_user_id
WHERE sl.payout_status = 'owed'
  AND sl.created_at <= now() - INTERVAL '24 hours'  -- 24-hour hold to avoid reversals
  AND u.bank_account_number IS NOT NULL             -- MUST have bank details
  AND u.bank_ifsc IS NOT NULL
ORDER BY sl.investor_user_id;

-- OUTPUT: 20–50 rows (Phase 1 scale), grouped by investor
```

**Aggregation (pseudo-code):**
```typescript
const payoutsByInvestor = new Map();

for (const row of settledRows) {
  const key = row.investor_user_id;
  if (!payoutsByInvestor.has(key)) {
    payoutsByInvestor.set(key, {
      investorId: key,
      totalAmount: 0,
      bankAccount: row.bank_account_number,
      ifsc: row.bank_ifsc,
      email: row.email,
      ledgerIds: []
    });
  }

  const payout = payoutsByInvestor.get(key);
  payout.totalAmount += row.net_amount;
  payout.ledgerIds.push(row.id);
}
```

**Output:** 10–15 payouts (one per investor), total ₹5–10 lakhs (Phase 1 scale).

### Phase B: Build Batch Request (2–3 min)

**Transformation:**
```typescript
const batchPayouts = [];

for (const [investorId, payout] of payoutsByInvestor) {
  // VALIDATION
  if (payout.totalAmount < 1000) {
    // Amount too small, hold until next day (accumulate)
    continue;
  }
  if (payout.totalAmount > 500000) {
    // Amount exceeds daily investor limit, split into 2 batches
    // (business rule: no single payout >₹5 lakhs)
    batchPayouts.push({
      account_number: payout.bankAccount,
      ifsc: payout.ifsc,
      amount: 500000,
      reference_id: `sb-circle-${investorId}-1`,
      recipient_settlement_id: `sl-batch-${Date.now()}`
    });
    batchPayouts.push({
      account_number: payout.bankAccount,
      ifsc: payout.ifsc,
      amount: payout.totalAmount - 500000,
      reference_id: `sb-circle-${investorId}-2`,
      recipient_settlement_id: `sl-batch-${Date.now()}`
    });
  } else {
    // Normal payout
    batchPayouts.push({
      account_number: payout.bankAccount,
      ifsc: payout.ifsc,
      amount: payout.totalAmount,
      reference_id: `sb-circle-${investorId}`,
      recipient_settlement_id: investorId
    });
  }
}

// API REQUEST
const request = {
  account_number: RAZORPAYX_ACCOUNT_ID,
  payouts: batchPayouts,
  batch_purpose: "StayBid Circle Investor Payouts",
  total_amount: sum(batchPayouts.map(p => p.amount))
};
```

### Phase C: Submit to RazorpayX (2–5 min)

**API Call:**
```typescript
import axios from 'axios';

const response = await axios.post(
  'https://api.razorpay.com/v1/payouts/batch',
  request,
  {
    auth: {
      username: RAZORPAYX_KEY_ID,
      password: RAZORPAYX_KEY_SECRET
    },
    timeout: 10000
  }
);

const batchId = response.data.id;
const batchStatus = response.data.status; // 'queued'

// RECORD batch_id
await updateSettlementLedger({
  ledgerIds: flatMap(batchPayouts.map(p => p.recipient_settlement_id)),
  razorpayx_batch_id: batchId,
  payout_status: 'submitted'  // interim state
});
```

**Failure Handling:**
- If API call fails (timeout, 5xx): log error, DO NOT mark ledger rows 'submitted' (retry tomorrow)
- If request is invalid (missing account, bad IFSC): return 400 (sync error, investigate)

### Phase D: Poll for Completion (async, background)

**Polling Job (runs every 1 hour for 4 hours after submission):**
```typescript
async function pollBatchStatus(batchId) {
  const response = await axios.get(
    `https://api.razorpay.com/v1/payouts/batch/${batchId}`,
    { auth: { username, password } }
  );

  const { status, payouts } = response.data;

  if (status === 'processed') {
    // All payouts have terminal state
    for (const payout of payouts) {
      if (payout.status === 'completed') {
        // Mark ledger row 'paid'
        await updateSettlementLedger({
          razorpayx_batch_id: batchId,
          payout_status: 'paid',
          payout_date: new Date()
        });

        // NOTIFY investor
        await sendPayoutNotification({
          investor_id: payout.recipient_settlement_id,
          amount: payout.amount,
          email: getInvestorEmail(payout.recipient_settlement_id)
        });
      } else if (payout.status === 'failed') {
        // Mark ledger row 'failed', retry next cycle
        await updateSettlementLedger({
          razorpayx_batch_id: batchId,
          payout_status: 'failed',
          failure_reason: payout.failure_reason
        });

        // NOTIFY ops (escalate to Prince)
        await sendOpsAlert(`Payout failed: ${payout.reference_id}, ${payout.failure_reason}`);
      }
    }
  } else if (status === 'failed') {
    // Entire batch failed, mark all rows 'failed' and escalate
    await updateSettlementLedger({
      razorpayx_batch_id: batchId,
      payout_status: 'failed',
      failure_reason: `Batch ${batchId} rejected by RazorpayX`
    });
  }
  // If status='queued' or 'processing', re-poll in 1 hour
}
```

### Phase E: Reconciliation + Notification (10–15 min)

**Daily Settlement Report (10:30 AM IST, after payout completion):**
```
FROM: ops-alert@staybid.in
TO: prince@staybid.in
SUBJECT: Circle Payout Batch Report — Oct 1

SUMMARY:
  Total Investors Processed: 12
  Total Payout Amount: ₹8,45,670
  Successful: 12 (₹8,45,670)
  Failed: 0
  Pending: 0

DETAILS:
  Investor 1 (Rajesh): ₹50,000 → COMPLETED
  Investor 2 (Priya): ₹72,340 → COMPLETED
  ...

ACTION ITEMS:
  - Verify 12 investors received funds (sample audit: call 2–3 investors)
  - Update investor dashboard: "Payout ₹50,000 processed on Oct 1"
```

**Investor Notification (email + dashboard):**
```
SUBJECT: Your StayBid Circle Payout — ₹50,000

Hi Rajesh,

Your September payout has been processed.

Amount: ₹50,000
Date: Oct 1, 2026, 10:15 AM IST
Status: Successfully transferred to your bank account (HDFC)

Expected delivery: Oct 2–3 (via NEFT)

View details: https://staybids.in/circle/me?tab=payouts
```

---

## FALLBACK PLAN (Manual Payouts, Oct 1–31)

If RazorpayX automation fails (batch rejects, API outage, compliance block), **manual payouts continue** until issue is resolved:

**Daily Manual Process (Prince, 11:00 AM IST):**
1. Query settlement_ledger WHERE payout_status='owed' AND created_at <= now()-24h
2. Download CSV (investor ID, bank account, IFSC, amount)
3. Import into RazorpayX dashboard → submit as manual batch
4. Manually mark ledger rows 'paid' after confirmation
5. Send investor notifications manually

**Timeline:** Manual payouts take 2–3 hours (vs. 15 min automated). If 3 consecutive days of automation fail, escalate to Sachin (decision: technical fix or extend manual process).

---

## PAYOUT ARCHITECTURE DIAGRAM

```
Settlement Ledger (Supabase)
├─ kind='guest_booking', payout_status='owed'
├─ kind='b2b_resale', payout_status='owed'
└─ kind='auction_award', payout_status='owed' (future)
        ↓
CRON: circle-settlement-batch-payout (daily 10:00 AM IST)
├─ Phase A: Aggregate by investor_user_id
├─ Phase B: Build RazorpayX batch request
├─ Phase C: Submit to RazorpayX API
├─ Phase D: Poll for completion (hourly × 4 hours)
├─ Phase E: Reconciliation + notifications
        ↓
RazorpayX Batch Payout API
├─ Individual payouts → investor bank accounts
├─ Batch status tracking
└─ Completion webhook (if enabled) → update ledger 'paid'
        ↓
Investor Bank Account (NEFT transfer, 24–48h)
        ↓
Investor Dashboard
└─ "Payout ₹50,000 — Oct 1" (marked 'paid')
```

---

## MONITORING + ALERTS (Oct 1–31)

### Daily Metrics Dashboard (`/admin/circle-payouts`):

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Batch submission success rate | 100% | <99% = page Prince |
| Payout completion rate (24h) | ≥95% | <95% = investigate delay |
| Failed payouts | <1% | ≥1% = escalate |
| Average payout latency | 12–36h | >48h = review RazorpayX status |
| Investor notification delivery | 100% | <100% = check email queue |

### Alerts (automatic Slack → ops-alerts channel):

```
ALERT: Batch {batchId} failed to submit
  Reason: Invalid IFSC code for investor {id}
  Action: Verify investor bank details, resubmit tomorrow

ALERT: Payout {payoutId} still processing after 4h
  Reason: RazorpayX delay (high volume)
  Action: Normal, check again in 2h

ALERT: 3 consecutive batch failures
  Reason: API authentication error (possible expired key)
  Action: Page Claude + Prince immediately
```

### Weekly Reconciliation (Prince, Friday 5 PM IST):

```
Reconciliation Checklist:
1. Cross-check settlement_ledger 'paid' rows vs. RazorpayX batch receipts
2. Sample audit: call 3 investors, confirm funds received
3. Review any failed/pending payouts, determine cause
4. Aggregate weekly stats (total paid, investor count, average amount)
5. File variance report if ledger ≠ bank statement
```

---

## KNOWN RISKS + MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| RazorpayX API rate limit (>100 payouts/batch) | LOW | Batch rejected, retry fails tomorrow | Split large batches into <100 payouts; pre-test with Phase 1 scale (10–15 investors) |
| Investor bank account closed mid-payout | MEDIUM | Payout fails, ledger marked 'failed', retry needed | Maintain investor bank detail audit trail; ask investors to confirm account active quarterly |
| Reconciliation mismatch (batch marked paid but fund delayed) | MEDIUM | Investor queries "where's my money?" at 36h | Set investor expectations: "funds typically arrive in 24–48h"; provide batch receipt number in notification |
| Compliance block (SEBI/RBI halts batch) | LOW | All payouts frozen, escalate to Sachin | Maintain compliance checklist (investor KYC, AML, destination verification); defer to Nov if blocked |
| RazorpayX key rotation (new key deployed) | LOW | Old key fails, cron breaks until key updated | Rotate keys in Railway env Secrets BEFORE RazorpayX, test manually once |
| Automation code bug (wrong amount, wrong investor) | CRITICAL | Investor receives wrong payout, data corruption | Pre-launch: test with 1 real investor payout Sep 26, audit amount end-to-end before Oct 1 go-live |

---

## ROLLBACK PLAN (If Automation Blocked by Oct 1 Gate)

If Phase 1 settlement metrics miss targets (e.g., <3/4 GREEN by Sep 25):

1. **Defer RazorpayX to Oct 15** (manual payouts continue via the fallback above)
2. **Keep cron infrastructure ready** (code deployed, not activated)
3. **Resume ops:** When Phase 1 stabilizes, activate automation by flipping env var `RAZORPAYX_ENABLED=1` (no code redeploy needed)

---

## SIGN-OFF (Oct 1 only)

| Role | Approval | Date |
|------|----------|------|
| Ops (Prince) | Ready / Defer | ____ |
| Tech (Claude) | Ready / Defer | ____ |
| Finance (Sachin) | Ready / Defer | ____ |

**Decision:** RazorpayX Automation GO-LIVE Oct 1 or DEFER to Oct 15 (reason: ____________)

---

*RazorpayX Automation Guide — Version 1 (August 17, 2026)*  
*StayBid Circle Model 1 — Phase 2 Payout Orchestration*
