# Tier System — Soft Launch Checklist

> **Purpose:** A pre-launch checklist for Sachin to tick before flipping the tier-system live for real users. The system is technically complete after Phase 8, but **the user-visible gate is OFF by default** through environmental safety checks. Run through this list when you want to enable.

---

## Pre-launch — What's currently live vs hidden

### ✅ Already live in code (after Phase 7 merged + Vercel green)

- 14 new commits on `claude/staybid-tier-discovery-rhoRK` branch → PR #38 ready to merge into `main`
- Schema additions on production Supabase (Phase 1 + Phase 7 migrations applied)
- All 11 API endpoints + 4 cron routes deployed
- Phase 4 frontend gate code present in `InstagramHotelFeed.tsx`
- Phase 5 partner Content Reviews tab + admin /admin/content page deployed
- 33 existing posts auto-defaulted to `moderation_status='APPROVED'` — visible exactly as today

### 🟡 Live but invisible / unfired (intentional safety)

- **Phase 3 Location OTP routes** — `NEXT_PUBLIC_ENABLE_LOCATION_OTP=0` default. Routes return 503 cleanly. UI shows "Coming Soon" pill on Verified Local card.
- **Phase 6 + 7 crons** — endpoints exist but **no cron-job.org schedules registered yet**. Won't run until Sachin adds them.
- **Phase 6 Railway notification templates** — paste-pending. In-app channel works today; SMS/WhatsApp/email queue but don't deliver.
- **The FAB tier gate itself** — IS active. PUBLIC users with no eligibility WILL see UpgradeChoiceSheet when this branch lands on main + Vercel deploys.

---

## Decision: when to flip the FAB gate live

The gate is technically **live the moment PR #38 merges**. There's no "off switch" beyond reverting the Phase 4 commit (per `docs/TIER_SYSTEM_ROLLBACK.md` Phase 4 step 1).

Sachin's choice:
1. **Merge PR #38 now** — PUBLIC users with no bookings immediately see the new flow on `/discover`. ⚠ Recommended ONLY after all checks below pass.
2. **Merge but bypass the gate temporarily** — comment out `onFabClick` per Rollback Phase 4 Step 1. Lets you merge the schema + endpoints + admin queue without changing customer UX.
3. **Keep PR #38 in draft until full readiness** — safest. Merge only when the soft-launch checklist below is complete.

---

## Soft-launch checklist

Tick each item before merging PR #38 into `main` (which triggers production deploy):

### Schema + endpoint sanity

- [ ] Vercel latest deployment from `claude/staybid-tier-discovery-rhoRK` branch is **READY** (not ERROR). Check the deployments dashboard.
- [ ] `staybid-customer-frontend` is the correct target Vercel project (not the legacy `staybid-frontend` or `staybid-admin` — per CLAUDE.md Section 2.1 deployment notes)
- [ ] `npx tsc --noEmit --skipLibCheck false` on the branch returns exit 0
- [ ] Supabase advisors: 3 new warnings expected (RLS permissive + function search_path) — accept as matching existing codebase patterns per CLAUDE.md Section 4.4

### Smoke tests passed

- [ ] Run through `docs/TIER_SYSTEM_SMOKE_TESTS.md` Section 1.1 (PUBLIC + no eligibility → upgrade sheet opens)
- [ ] Run Section 1.2 (Verified Guest upload + tier promotion)
- [ ] Run Section 1.3 (existing creator/hotel users untouched)
- [ ] Run Section 2.1-2.4 (partner moderation incl. escalate)
- [ ] Run Section 3.1-3.2 (admin sees + approves)
- [ ] Run Section 4.3 (view-milestone idempotency)
- [ ] Run Section 6.1-6.5 (regression — existing flows still work)

### Sachin's two Railway paste-pending items — decision points

#### Phase 3 — Location OTP dispatcher

- [ ] **DECIDE:** Will you paste the Railway dispatcher (`docs/RAILWAY_LOCATION_OTP_PASTE.md`) now, or keep Verified Local "Coming Soon" indefinitely?
- [ ] If pasting now:
  - [ ] Confirm you have active OTP delivery (MSG91 / WhatsApp Business)
  - [ ] Paste the Railway handler per the doc Step 1
  - [ ] Test with `curl -X POST .../api/auth/send-location-otp -H "Content-Type: application/json" -d '{"phone":"+91XXX","otp":"123456","hotelName":"Test"}'` → expect `{"ok": true}` + WhatsApp arrives
  - [ ] Set Vercel env var `NEXT_PUBLIC_ENABLE_LOCATION_OTP=1` on `staybid-customer-frontend`
  - [ ] Redeploy Vercel project for env var to take effect
- [ ] If keeping disabled: nothing to do. UpgradeChoiceSheet keeps showing "Coming Soon" pill.

#### Phase 6 — Railway notification templates

- [ ] **DECIDE:** Will you paste the Phase 6 templates now, or keep WhatsApp/SMS notifications silent (in-app only)?
- [ ] If pasting now:
  - [ ] Open the Railway notification drainer file (wherever your existing template registry lives)
  - [ ] Paste the 8 template handlers from `docs/RAILWAY_NOTIFICATION_TEMPLATES_PASTE.md` Step 1
  - [ ] Test by inserting a manual `notification_queue` row per Step 3 → confirm WhatsApp arrives
- [ ] If keeping silent: nothing to do. `notification_queue` rows accumulate with `status='pending'` for these templates. The customer-side `<NotificationToast />` for `in_app` channel works today regardless.

### Cron schedules

- [ ] **DECIDE:** Set up cron-job.org schedules for the 4 new crons now, or wait for first real user data?

If setting up now, add these to cron-job.org dashboard:

| Endpoint | Frequency | Suggested time |
|---|---|---|
| `https://staybids.in/api/cron/auto-approve-content?token=staybid-cron-dev` | every 1 hour | (cron-job.org "every hour") |
| `https://staybids.in/api/cron/post-stay-nudge?token=staybid-cron-dev` | daily | `10:00 IST` |
| `https://staybids.in/api/cron/view-milestone-rewards?token=staybid-cron-dev` | daily | `04:30 IST` |
| `https://staybids.in/api/cron/creator-upgrade-eval?token=staybid-cron-dev` | weekly | Sundays `04:00 IST` |

- [ ] All 4 entries created
- [ ] Test each by hitting the URL once via curl/browser → expect 200 JSON `{ ok: true, ... }`

If waiting: nothing to do. Endpoints exist; just don't fire automatically.

### Customer communication (suggested but optional)

- [ ] Decide if you want to announce the tier-system to existing users
- [ ] Sample WhatsApp / email blast template:
  > "🎉 StayBid update — Verified guests can now share their trip reels & photos to earn StayPoints! Open the app + book a stay → after check-out, share your experience. https://staybids.in/discover"
- [ ] OR: ship silently. The in-app InspirationBanner on /bookings will nudge them naturally.

---

## Day 1 post-launch monitoring

After merging PR #38 to main + Vercel deploy goes READY:

### Hour 1 — sanity check

- [ ] Visit `https://staybids.in/discover` as a PUBLIC user → tap + FAB → confirm UpgradeChoiceSheet flow works
- [ ] Visit `https://staybids.in/partner/dashboard` as a hotel partner → confirm Content Reviews tab exists
- [ ] Visit `https://staybids.in/admin/content` as admin → confirm page loads (empty queue is normal)
- [ ] Check Vercel function logs — no 500 errors on `/api/me/tier`, `/api/social/posts/verified-guest`

### Day 1 — first uploads

Watch Supabase queries:
```sql
-- Count tier-system uploads
SELECT moderation_status, verification_method, COUNT(*)
FROM social_posts
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2;

-- Count tier promotions
SELECT user_type, COUNT(*)
FROM social_profiles
WHERE tier_promoted_at > NOW() - INTERVAL '24 hours'
GROUP BY 1;

-- Pending hotel reviews
SELECT COUNT(*) FROM social_posts
WHERE moderation_status = 'PENDING_HOTEL_APPROVAL';
```

### Day 2-7 — first admin actions

- [ ] Watch `/admin/content` for escalations — confirm hotel partners are actually using the Escalate button
- [ ] Watch `admin_audit_log` for content.approve / content.reject / content.flag rows
- [ ] If auto-approve cron is on: verify 24h threshold is the right number — too long, lower it; too short, raise it

### Day 7-30 — first auto-promotes

- [ ] Watch for `influencers` rows with `application_source='auto_promote'`
- [ ] Watch admin queue (`/admin/creators`) for `application_source='auto_eval'` (Type B)
- [ ] Adjust criteria via env vars if too lenient/strict (see `docs/TIER_SYSTEM_ROLLBACK.md` quick-disable matrix)

---

## Definition of "soft launch successful"

After 7 days post-merge:
- [ ] Zero unrecovered 500 errors on tier endpoints in Vercel logs
- [ ] At least 1 Verified Guest upload completed end-to-end (PUBLIC → upload → hotel approve → visible in feed)
- [ ] At least 1 hotel partner used the Content Reviews tab (approval, rejection, OR escalation)
- [ ] If admin escalation happened: admin used `/admin/content` to resolve it
- [ ] No customer support tickets about "+ button broken" or "can't upload"
- [ ] Existing flows (form-applicant /upgrade, creator/hotel posting, customer browsing) showed zero regression

If all 6 → tier system is **launched**.

---

## Hard launch (full WhatsApp + SMS notifications + location OTP)

Only after soft launch is stable for 7+ days:

- [ ] Phase 3 Railway location-OTP dispatcher pasted + `NEXT_PUBLIC_ENABLE_LOCATION_OTP=1` flipped → Verified Local card becomes active
- [ ] Phase 6 Railway notification templates pasted → WhatsApp / SMS / email channels start delivering
- [ ] Customer announcement (optional)

At this point, the full tier-system as designed in the master prompt is live.

---

## What to do if something breaks

→ See `docs/TIER_SYSTEM_ROLLBACK.md` for per-phase rollback recipes.

Most issues are fixable with config flips (env vars, cron-job.org pauses, comment-out an `onFabClick` prop) without needing a code revert.

**Schema additions are forward-only.** If you must roll back the schema, you're choosing destructive operations on a database that has live state. Always backup first.
