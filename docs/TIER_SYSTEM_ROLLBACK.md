# Tier System — Rollback Recipes

> **Purpose:** Per-phase recipes to revert any tier-system phase if production reveals an issue. Every recipe is **non-destructive of pre-tier-system data** — existing users, posts, hotels, bookings stay intact.
>
> **Order matters:** roll back top-down (Phase 8 → Phase 7 → ... → Phase 1). Don't skip phases. The schema migration (Phase 1) is intentionally forward-only per master prompt — documented for awareness, not as an active step.
>
> **Decision matrix:** before rolling back, check whether a TARGETED disable is enough (env flag, cron pause, sidebar tab hide) before reaching for a full code revert. Most issues are fixable with config flips.

---

## Quick disable matrix (no code revert needed)

| Issue | Fastest fix |
|---|---|
| Verified Local card shouldn't show "Coming Soon" — hide it entirely | `NEXT_PUBLIC_ENABLE_LOCATION_OTP` is already `0` (default). Don't set it to `1`. UpgradeChoiceSheet already disables the card. |
| Location OTP routes returning 503 | Already happening by design (Phase 3 Option A). Set env var `NEXT_PUBLIC_ENABLE_LOCATION_OTP=1` only when Railway dispatcher is pasted. |
| Don't want any cron to run yet | Don't add the URLs to cron-job.org. No Vercel cron entries were added (Vercel 2-slot stayed pricing+lifecycle). Crons exist in code but only fire when scheduled. |
| Auto-promote criteria too lenient | Bump env vars in Vercel: `CREATOR_AUTO_MIN_POSTS=15`, `CREATOR_AUTO_MIN_VIEWS=20000`. Cron picks up changes on next run, no redeploy. |
| Wallet credits paying too much | Edit `MILESTONES` array in `app/api/cron/view-milestone-rewards/route.ts` — drop `view_milestone_10k` row, or shrink `reward_inr`. Idempotency unique index ensures prior credits stay valid. |
| UpgradeChoiceSheet causing UX confusion | Comment out the `onFabClick` prop on `<CreateFlow>` in `InstagramHotelFeed.tsx`. PUBLIC users go straight to CreateSheet as today. The route + components still exist; just bypassed. |

---

## Phase 8 — Documentation rollback

Phase 8 added 3 docs (smoke tests, rollback, soft launch). To remove:

```bash
git rm docs/TIER_SYSTEM_SMOKE_TESTS.md
git rm docs/TIER_SYSTEM_ROLLBACK.md
git rm docs/TIER_SYSTEM_SOFT_LAUNCH.md
```

No production impact. Docs only.

---

## Phase 7 — Creator auto-promote + admin-review eval rollback

### Step 1 — Stop the cron from running
Delete the `creator-upgrade-eval` entry from cron-job.org. The endpoint still exists at the URL but won't fire on a schedule.

### Step 2 — (Optional) Disable the route
If the cron URL was somehow being hit manually (or via Vercel admin tokens):

```ts
// app/api/cron/creator-upgrade-eval/route.ts — top of handler
export async function GET(req: NextRequest) {
  return NextResponse.json({ disabled: true }, { status: 503 });
}
```

### Step 3 — Manually revert any auto-promoted users (if accidental)

```sql
-- Find users auto-promoted by Phase 7 cron
SELECT i.user_id, i.application_source, i.created_at, p.user_type
FROM influencers i
LEFT JOIN social_profiles p ON p.user_id = i.user_id
WHERE i.application_source = 'auto_promote';

-- To roll back a specific user:
-- 1. Delete the cron-created influencers row
DELETE FROM influencers
WHERE user_id = '<user_id>' AND application_source = 'auto_promote';

-- 2. Revert their social_profile back to VERIFIED_GUEST
UPDATE social_profiles
SET user_type = 'VERIFIED_GUEST', is_creator = false, tier_promoted_at = NULL
WHERE user_id = '<user_id>';
```

### Step 4 — Schema rollback (only if forced)
Phase 7 added 2 columns + 1 index. They're harmless when empty. To remove entirely (Postgres-supported even with existing data):

```sql
DROP INDEX IF EXISTS idx_influencers_application_source;
ALTER TABLE influencers DROP CONSTRAINT IF EXISTS influencers_application_source_check;
ALTER TABLE influencers DROP COLUMN IF EXISTS application_source;
ALTER TABLE influencers DROP COLUMN IF EXISTS auto_eval_data;
```

⚠ **WARNING:** `DROP COLUMN` is forward-only-violating per master prompt. Only do this if absolutely necessary. Better to leave the columns + just set `application_source='form'` for everyone if you want to consolidate.

### Step 5 — Code revert (clean removal)

```bash
git revert 92c3026  # Phase 7 commit
```

This reverts:
- `app/api/cron/creator-upgrade-eval/route.ts` deleted
- `lib/tier/promote.ts` loses `autoPromoteToCreator` + `flagForCreatorAdminReview` helpers
- `app/admin/creators/page.tsx` loses the badge + metrics grid (form-applicants unchanged)
- `app/api/admin/creators/route.ts` loses the application_source/auto_eval_data select

---

## Phase 6 — Cron jobs + reward credit rollback

### Step 1 — Delete cron-job.org entries

Remove these 3 from cron-job.org dashboard:
- `/api/cron/auto-approve-content`
- `/api/cron/post-stay-nudge`
- `/api/cron/view-milestone-rewards`

Endpoints remain in code but won't fire automatically.

### Step 2 — Disable individual crons (if needed)

```ts
// Add to top of any cron's GET handler:
return NextResponse.json({ disabled: true }, { status: 503 });
```

### Step 3 — Revert wallet credits (if any erroneously fired)

```sql
-- Find all Phase 6 view-milestone credits
SELECT user_id, delta_inr, source_id, created_at
FROM wallet_credit_history
WHERE source_type = 'view_milestone'
ORDER BY created_at DESC;

-- To revert a specific credit:
-- 1. Capture the user + amount
-- 2. DELETE the credit history row
DELETE FROM wallet_credit_history WHERE id = '<credit_id>';

-- 3. Decrement the aggregate wallet
UPDATE wallet_credits
SET balance_inr = balance_inr - <amount>,
    lifetime_credited = lifetime_credited - <amount>
WHERE user_id = '<user_id>';
```

⚠ **WARNING:** Wallet rollback should be the LAST resort. The idempotency unique index prevents accidental double-credits. If a credit was legitimate but you want to claw it back, treat it as a separate refund event with `source_type='admin_refund'` so it shows in the user's transaction history.

### Step 4 — Code revert

```bash
git revert e327a25  # Phase 6 commit
```

Removes the 3 cron route files + `docs/RAILWAY_NOTIFICATION_TEMPLATES_PASTE.md`.

---

## Phase 5 — Moderation dashboards rollback

### Step 1 — Hide the partner tab + admin sidebar entry (visual only)

In `app/partner/dashboard/page.tsx`:
```diff
- { id:"content", icon:"🖼️", label:"Content Reviews" },
+ // { id:"content", icon:"🖼️", label:"Content Reviews" },  // Phase 5 — temporarily hidden
```

In `components/admin/sidebar.tsx`:
```diff
- { href: "/admin/content", label: "Content Reviews", icon: "🖼️" },
+ // { href: "/admin/content", label: "Content Reviews", icon: "🖼️" },
```

The Phase 2 backend endpoints still exist + work. Just no UI surface to drive them.

### Step 2 — Code revert (full removal)

```bash
git revert fd1448d  # Phase 5 commit
```

Removes the partner tab component + admin page + 2 navigation edits.

---

## Phase 4 — Frontend Create-flow gate rollback

### Step 1 — Bypass the gate (1-line change)

In `components/discover/InstagramHotelFeed.tsx` find the `<CreateFlow>` usage:

```diff
  <CreateFlow
    sanitize={sanitizeComment}
-   onFabClick={async () => {
-     // ... tier probe logic ...
-     setUpgradeOpen(true);
-     return false;
-   }}
+   // onFabClick disabled — PUBLIC users go straight to CreateSheet as today
```

This single edit reverts the FAB tap to pre-Phase-4 behavior. UpgradeChoiceSheet stays in code but is never opened.

### Step 2 — Restore POST routing to /api/social/posts (only if Verified Guest uploads need to stop)

In `components/discover/CreateFlow.tsx` `runUpload`:
```diff
  let postEndpoint = "/api/social/posts";
  const extraBody: Record<string, any> = {};
- if (tierContext?.kind === "verified_guest") {
-   postEndpoint = "/api/social/posts/verified-guest";
-   // ...
- }
+ // Phase 4 tier-context routing disabled
```

### Step 3 — Hide InspirationBanner (cosmetic)

In `app/bookings/page.tsx` + `app/hotels/[id]/page.tsx`, comment out the `<InspirationBanner />` JSX. No data impact.

### Step 4 — Full revert

```bash
git revert 10c4121  # Phase 4 commit
```

Removes the 3 tier components + all wiring + InspirationBanner placements.

---

## Phase 3 — Location OTP rollback

The feature is already disabled by default (`NEXT_PUBLIC_ENABLE_LOCATION_OTP` env var off). No rollback needed unless someone flipped it to `"1"` accidentally.

To fully remove the routes:
```bash
git revert 560130b  # Phase 3 feature flag
git revert 1dce817  # Phase 3 frontend wiring
```

Note: the Railway dispatcher (paste-pending) was never deployed. Nothing on Railway needs reverting.

---

## Phase 2 — API endpoints rollback

### Step 1 — Disable the routes (cleaner than deletion)

For each Phase 2 route, add at the top of the handler:
```ts
export async function POST(req: Request) {
  return NextResponse.json({ disabled: true }, { status: 503 });
}
```

Routes affected:
- `/api/me/tier`
- `/api/me/eligible-bookings`
- `/api/social/posts/verified-guest`
- `/api/social/posts/community`
- `/api/verify/location/send-otp` (already gated)
- `/api/verify/location/verify-otp` (already gated)
- `/api/partner/content/pending`
- `/api/partner/content/[id]`
- `/api/admin/content/pending-review`
- `/api/admin/content/[id]`

Phase 4's UpgradeChoiceSheet will see `canUpload: false` + fail open gracefully.

### Step 2 — Full revert

```bash
git revert 9a27e1c  # Phase 2 commit (includes 10 routes + 4 lib files)
```

Note: `lib/tier/*` files removed via revert. Phase 4 + 5 + 6 + 7 commits depend on these — would need follow-up reverts in order.

---

## Phase 1 — Schema rollback (FORWARD-ONLY per master prompt)

Phase 1 added 5 new tables/columns:
- `social_profiles.tier_promoted_at`
- `social_posts.moderation_status` (+ 14 audit columns)
- `location_verifications` table
- `inspiration_nudges` table
- `wallet_credit_history` UNIQUE partial index

**This phase is intentionally forward-only.** Existing rows have meaningful state (33 social_posts with `moderation_status='APPROVED'`); ripping out the columns would be destructive.

### If you absolutely must roll back schema

```sql
-- ⚠ DESTRUCTIVE — only do this if the entire tier system is being deleted
-- and you have a database backup.

-- 1. Drop new tables
DROP TABLE IF EXISTS public.location_verifications CASCADE;
DROP TABLE IF EXISTS public.inspiration_nudges CASCADE;
DROP FUNCTION IF EXISTS public.fn_inspiration_nudges_touch_updated_at();

-- 2. Drop wallet_credit_history unique index
DROP INDEX IF EXISTS uniq_wch_idempotency;

-- 3. Drop social_posts columns (you'll lose moderation history!)
ALTER TABLE social_posts DROP COLUMN IF EXISTS moderation_status;
ALTER TABLE social_posts DROP COLUMN IF EXISTS booking_id;
ALTER TABLE social_posts DROP COLUMN IF EXISTS verification_method;
ALTER TABLE social_posts DROP COLUMN IF EXISTS approved_at;
ALTER TABLE social_posts DROP COLUMN IF EXISTS approved_by;
ALTER TABLE social_posts DROP COLUMN IF EXISTS rejected_at;
ALTER TABLE social_posts DROP COLUMN IF EXISTS rejected_by;
ALTER TABLE social_posts DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE social_posts DROP COLUMN IF EXISTS auto_approved_at;
ALTER TABLE social_posts DROP COLUMN IF EXISTS admin_reviewed_at;
ALTER TABLE social_posts DROP COLUMN IF EXISTS admin_reviewed_by;
ALTER TABLE social_posts DROP COLUMN IF EXISTS admin_review_decision;
ALTER TABLE social_posts DROP COLUMN IF EXISTS admin_review_notes;
ALTER TABLE social_posts DROP COLUMN IF EXISTS escalated_to_admin_at;
ALTER TABLE social_posts DROP COLUMN IF EXISTS escalated_by;

-- 4. Drop social_profiles column
ALTER TABLE social_profiles DROP COLUMN IF EXISTS tier_promoted_at;

-- 5. Postgres does NOT support DROP VALUE on enums.
-- To remove VERIFIED_GUEST / COMMUNITY_CONTRIBUTOR from social_user_type
-- you'd have to:
-- (a) Create a new enum without those values
-- (b) Migrate every existing user_type column
-- (c) Drop the old enum + rename
-- Way too risky. RECOMMEND: just leave the unused enum values; they
-- harm nothing.
```

**Better strategy:** instead of physical rollback, simply DISABLE all Phase 2-7 routes/UI. The schema additions are non-breaking; existing posts keep their default `'APPROVED'` value; existing creators are unaffected.

---

## What stays even after full rollback

Per the master prompt's "additive only" rule, even after rolling back every phase commit:
- ✅ Existing 33+ `social_posts` rows still render in the public feed (Phase 1 default = `'APPROVED'`)
- ✅ Existing 3 `influencers` rows still work for the existing /upgrade form path (default `application_source='form'`)
- ✅ All existing bookings / bids / hotels / users / customer flows untouched
- ✅ Reel-dedup v131.8 chain still intact (Phase 2-7 reads only didn't modify `client_post_id`)
- ✅ Existing commission engine still pays form-applicant creators

---

## Emergency contact paths

- **Schema integrity check:**
   ```sql
   SELECT 'social_user_type values', array_agg(enumlabel) FROM pg_enum
   JOIN pg_type ON pg_type.oid = enumtypid WHERE typname = 'social_user_type';
   -- Expect: {PUBLIC, VERIFIED_GUEST, COMMUNITY_CONTRIBUTOR, CREATOR, HOTEL}
   ```

- **Stuck PENDING posts** (in case rollback leaves orphans):
   ```sql
   -- Force everything back to visible
   UPDATE social_posts SET moderation_status = 'APPROVED'
   WHERE moderation_status IN ('PENDING_HOTEL_APPROVAL', 'PENDING_ADMIN_REVIEW');
   ```

- **Notification queue still draining:** `notification_queue` table is shared with the existing v98 audit notification system. Rolling back tier-system has zero impact on existing template handlers.
