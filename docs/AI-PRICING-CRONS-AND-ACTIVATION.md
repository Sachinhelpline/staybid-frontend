# AI Pricing — Cron Setup + Activation Runbook (v249.1 → v249.4)

This is the operator runbook for the 4-phase AI pricing engine. It covers
(a) which crons must run, (b) how to schedule the missing one, and (c) the
exact 2-step activation once real bid data has accumulated.

**Nothing here is live-behavior-changing until you flip the two env flags in
Step C.** The whole engine ships default-OFF.

---

## A. The engine in one picture

```
                 ┌─────────────────── room_date_price (the "spine") ───────────────────┐
  /api/cron/      │  every room × next 75 days:  baseRate · livePrice · bidFloor ·       │
  price-spine ───▶│  flashPrice · vacancy · competitor_min                               │
  (hourly)        └──────────────────────────────────────────────────────────────────────┘
                         │ consumed by EVERY customer surface:
                         ├── /hotels/[id]  → livePrice (dynamic room rate)
                         ├── /bid          → bidFloor  (reverse-auction floor)
                         └── /flash/near   → flashPrice

  Phase 1: every bid/booking → pricing_decisions   (context snapshot, fires in /api/bids/place)
  Phase 2: accept-probability model (baseline curve + Bayesian shrinkage on observed)
  Phase 3: optimizer  → picks price×P(accept) argmax, modifies spine livePrice   [FLAG: PRICING_OPTIMIZER_ENABLED]
  Phase 4: /api/cron/pricing-model-train → learns accept-rates nightly into pricing_model_params   [FLAG: PRICING_MODEL_LEARNED]
```

**Scope:** the spine is the COMPLETE platform price (hotel page + bid + flash).
The optimizer (Phase 3), when ON, modulates the platform-wide `livePrice`
(flash derives from it). The LEARNING signal (Phase 1/2/4) comes from bid
accept/reject outcomes — the only place the platform gets a yes/no on a price.

---

## B. Cron jobs — what runs where

Vercel Hobby has a 2-cron cap, already used by `pricing` + `lifecycle`
(`vercel.json`). Everything else runs on **cron-job.org**.

| Cron | Schedule | Where | Status (2026-05-31) |
|---|---|---|---|
| `/api/cron/pricing` | daily 04:00 | Vercel | ✅ scheduled |
| `/api/cron/lifecycle` | daily 04:05 | Vercel | ✅ scheduled |
| `/api/cron/price-spine` | hourly | cron-job.org | ✅ running (room_date_price fresh) |
| **`/api/cron/pricing-model-train`** | **weekly** | **cron-job.org** | ❌ **ADD THIS (Step B.1)** |
| `expire-holds` / `flash-drop` / `feedback-lifecycle` / `auto-approve-content` / `post-stay-nudge` / `view-milestone-rewards` / `creator-upgrade-eval` / `support-auto-resolve` | various | cron-job.org | (pre-existing) |

### B.1 — Add the Phase-4 trainer on cron-job.org

Create one new cron-job.org job:

- **URL:**
  ```
  https://www.staybids.in/api/cron/pricing-model-train?token=<CRON_SECRET>
  ```
  Replace `<CRON_SECRET>` with the project's real `CRON_SECRET` env value.
  If `CRON_SECRET` was never set in Vercel, the route falls back to the dev
  default `staybid-cron-dev` (that's the literal token the existing Vercel
  crons use in `vercel.json`) — but setting a real secret is recommended.
- **Method:** GET
- **Schedule:** weekly (e.g. Sundays 04:00 IST = `0 22 * * 0` UTC). Daily is
  also safe — the upsert is idempotent (re-running overwrites the same
  `(scope, scope_id, ratio_band)` rows in place).
- **Request timeout:** raise to 60s if the cron-job.org job offers it (the
  route's `maxDuration` is 60).

Optional query: `&days=180` controls the look-back window (default 180).

**Verify it ran:** after the first execution,
```sql
SELECT * FROM pricing_model_runs ORDER BY created_at DESC LIMIT 3;
```
should show a row with `ok=true` and a non-zero `params_written` (once there
is bid data — see Step C.1).

---

## C. Activation — the 2 flags (do this LATER, after data accumulates)

The optimizer + learned model are **default OFF**. Today `pricing_decisions`
is empty (Phase 1 merged 2026-05-31; no bids have flowed through
`/api/bids/place` since). Until real accept/reject outcomes accumulate, there
is nothing to learn from — so leave both flags OFF for now.

### C.1 — Wait for data
Let customers place bids for a few weeks. Watch it fill:
```sql
SELECT count(*) FROM pricing_decisions WHERE bid_id IS NOT NULL;        -- decisions logged
SELECT scope, count(*) FROM pricing_model_params GROUP BY scope;        -- learned rows (after trainer runs)
```
Rule of thumb: don't flip the flags until each ratio-band you care about has
~20+ observed bids (the Bayesian prior strength `K=20` means below that the
baseline curve still dominates anyway — so flipping early is harmless, just
not yet impactful).

### C.2 — Shadow-compare before flipping (read-only, safe)
```
GET https://www.staybids.in/api/pricing/optimize?roomId=<id>&date=YYYY-MM-DD&hotelId=<id>
```
Returns `result.optimizedLive` vs `result.ruleLive` + `revenueLiftPct`. If the
lift is real and sane (within the ±12% guard band), proceed.

### C.3 — Flip the flags (Vercel → Settings → Environment Variables)
```
PRICING_OPTIMIZER_ENABLED = 1     # Phase 3: optimizer modifies the live price
PRICING_MODEL_LEARNED     = 1     # Phase 4: optimizer + accept-estimate read the learned table
```
Redeploy (or wait for the next deploy). Order doesn't matter; the learned
model only takes effect when the optimizer is also on.

**To roll back instantly:** delete the two env vars (or set to `0`) +
redeploy. Pricing reverts to the rule-engine spine — byte-identical to
pre-activation. No data is lost; the trainer keeps filling the table.

---

## D. Guardrails baked in (why this can't blow up the price)

- Optimizer is bounded to **±12% of the rule price** (`OPT_MAX_DELTA`), never
  below floor, never above the competitor-undercut cap, snapped to ₹100.
- Bayesian shrinkage (`K=20`) means thin samples can't swing the estimate.
- The trainer only WRITES the 2 new tables (`pricing_model_params` +
  `pricing_model_runs`) — it cannot touch any user-facing row.
- Every read path falls back to the Phase-2 baseline curve when there's no
  learned/observed data, and the spine itself falls back to on-the-fly compute
  if `room_date_price` is stale.

---

## E. Things to avoid

- **Never** flip `PRICING_MODEL_LEARNED=1` without `PRICING_OPTIMIZER_ENABLED=1`
  — the learned table feeds the optimizer; alone it does nothing visible.
- **Never** schedule `pricing-model-train` on Vercel cron — the 2-slot Hobby
  cap is full (`pricing` + `lifecycle`). It belongs on cron-job.org.
- **Never** point `pricing-model-train` at a sub-hourly cadence expecting
  faster learning — accept-rates move on a daily/weekly scale; weekly is the
  intended cadence (daily max).
- **Never** unschedule `price-spine` — it keeps `room_date_price` fresh; if it
  stops, surfaces fall back to on-the-fly compute (correct, just not cached).
