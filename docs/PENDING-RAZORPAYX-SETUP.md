# ⏳ PENDING (owner ops) — RazorpayX live payout setup

**Status:** NOT done. Deferred by owner (2026-07-27) — "baad mein karenge".
**Impact while pending:** Circle owner payouts stay INERT (safe — button hidden, no money
moves). Interim: `/admin/circle-inventory` → **"Mark paid (manual)"** to reconcile owed rows by hand.

## What this unlocks
Real money-OUT for Circle owners — the admin-triggered RazorpayX payout
(`payout_owner_batch`) built in v390/v391. Code is ready and idempotent; it only needs the
3 env vars below to go live.

## Key distinction (owner was confused here)
- `RAZORPAY_KEY_ID` (no X) = **payments / money IN** (guests pay). Already set + working
  (environment-only since hotfix v621 — the former hardcoded key-id fallbacks were removed; v621.2 scrubbed the stale rotated Key ID from all runtime code and docs).
- `RAZORPAYX_*` (with X) = **payouts / money OUT**. A SEPARATE Razorpay product (RazorpayX /
  Current Account). Requires banking KYC to go live. NOT set yet (confirmed via Vercel env
  screenshot — only `RAZORPAY_KEY_ID` / `RAZORPAY_WEBHOOK_SECRET` exist, no `RAZORPAYX_*`).

## The 3 env vars needed (exact names — code reads these in `lib/circle/razorpayx.ts`)
- `RAZORPAYX_KEY_ID`
- `RAZORPAYX_KEY_SECRET`
- `RAZORPAYX_ACCOUNT_NUMBER`   ← the RazorpayX source account number (the distinctive piece)
- (optional) `RAZORPAYX_PAYOUT_MODE` — default `IMPS`

Set them in Vercel → project **staybid-customer-frontend** → Settings → Environment Variables
(Production) → then **Redeploy** (env only applies after a redeploy).

## Recommended order (test first — matches the code's "verify one TEST payout" note)

### Phase 1 — TEST mode (no KYC, do this first)
1. Razorpay dashboard → **RazorpayX** section → toggle **Test** mode.
2. Get test **Key Id + Secret** (RazorpayX → Settings → API keys) and the test **account number**.
3. Add the 3 `RAZORPAYX_*` vars (test values) in Vercel → Redeploy.
4. `/circle/earnings` → 🏦 Payout account → save one for a Circle owner.
5. `/admin/circle-inventory` → **Payout batches** → "RazorpayX live" appears → **"Pay via
   RazorpayX"** → confirm rows flip `owed → paying → paid` with no error.

### Phase 2 — LIVE (needs KYC)
6. RazorpayX → switch to **Live** → complete banking KYC / business docs → Razorpay approves
   (can take days; may need Razorpay support).
7. Vercel → edit the same 3 vars to the **Live** values → Redeploy.
8. `/admin/circle-inventory` shows "RazorpayX live" → real payouts (admin-reviewed per owner;
   no unattended auto-transfer). Two-phase claim + idempotency key make double-pay impossible.

## Also still pending (owner ops, unrelated but nearby)
- Flash create-side launch price is Railway-owned (partner-typed `aiPrice`, not spine-derived
  at creation). Frontend display + charge are already correct (v525–v533); only the stored
  launch number is a Railway-side refinement.
