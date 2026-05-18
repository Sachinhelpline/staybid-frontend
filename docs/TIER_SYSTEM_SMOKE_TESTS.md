# Tier System — Manual Smoke Test Checklist

> **Purpose:** Step-by-step verification of every flow the 2-Tier System ships. Run this before flipping any user-visible feature live on production. Mostly clickable on `staybids.in` (Vercel preview); some checkpoints need browser DevTools or admin panel access.
>
> **Coverage:** PUBLIC upload gate · Verified Guest path · Hotel partner moderation · Admin escalation queue · Cron triggers · Wallet credits · Auto-creator-promote · Existing-flow regression checks.
>
> **Time:** ~30 minutes for the full suite. ~10 minutes for the abridged "smoke" pass (skip ✱ items).

---

## Test prerequisites

- [ ] You have **3 accounts ready**:
  - **PUBLIC user** — signed in, no completed bookings, no creator/hotel role
  - **PUBLIC user WITH a completed booking** — `bookings.status='CHECKED_OUT'` for `checkOut < NOW() AND checkOut > NOW() - 90 days`
  - **HOTEL PARTNER** — owns at least one hotel (the same one the booking is for)
  - **ADMIN** — `users.role='admin'`
- [ ] Browser DevTools open (Network tab) so you can see API responses
- [ ] PR #38 deployment is `READY` on Vercel (latest commit green)

---

## Section 1 — PUBLIC user gate

### 1.1 PUBLIC with NO eligibility — upgrade choice shows

- [ ] Sign in as PUBLIC user with no completed bookings
- [ ] Navigate to `/discover`
- [ ] Tap the **+ FAB** (bottom-right)
- [ ] **Expect:** `<UpgradeChoiceSheet>` opens (NOT the CreateSheet kind-chooser)
- [ ] DevTools Network: `GET /api/me/tier` returned `{ tier: "PUBLIC", canUpload: false, reason: "needs_booking_only" }`
- [ ] **Expect:** "Verified Guest" card is **disabled** (says "0 stays" or similar) — user has no eligible bookings
- [ ] **Expect:** "Verified Local" card shows **"Coming Soon"** pill in disabled state (Phase 3 Option A flag default OFF)
- [ ] Tap "Not now" → sheet closes cleanly

### 1.2 PUBLIC WITH eligibility — Verified Guest flow

- [ ] Sign in as PUBLIC user with at least one completed booking
- [ ] `/discover` → tap **+ FAB**
- [ ] **Expect:** UpgradeChoiceSheet opens
- [ ] DevTools: `/api/me/tier` returned `{ canUpload: true, reason: "verified_guest_eligible", eligibleBookingsCount: N }`
- [ ] **Expect:** "Verified Guest" card is **active** with green "N stays ✓" pill
- [ ] Tap "Verified Guest" card
- [ ] **Expect:** BookingPicker step opens, listing the booking(s)
- [ ] Network: `GET /api/me/eligible-bookings` returned the booking
- [ ] Tap a booking
- [ ] **Expect:** Composer opens directly (skipping the CreateSheet kind-chooser) with kind = "reel"
- [ ] Pick a media file (any image / video)
- [ ] Add a caption, optionally tag mood/audio
- [ ] Tap "Post"
- [ ] **Network:** `POST /api/social/posts/verified-guest` (NOT /api/social/posts) with `{bookingId, hotelId, mediaType, mediaUrl, clientPostId, ...}`
- [ ] **Response 200:** `{ post: {...}, created: true, tier_promoted: true, new_tier: "VERIFIED_GUEST" }`
- [ ] **DB check** (Supabase SQL editor):
   ```sql
   SELECT id, moderation_status, verification_method, booking_id
   FROM social_posts WHERE author_id = '<your_profile_id>'
   ORDER BY created_at DESC LIMIT 1;
   ```
   Expect: `moderation_status='PENDING_HOTEL_APPROVAL'`, `verification_method='booking'`, `booking_id` populated
- [ ] **DB check:** `SELECT user_type, tier_promoted_at FROM social_profiles WHERE user_id='<your_user_id>'` — expect `VERIFIED_GUEST` + recent timestamp
- [ ] **DB check:** `SELECT * FROM notification_queue WHERE template='content_pending_approval' ORDER BY created_at DESC LIMIT 1` — hotel partner gets queued notif

### 1.3 ✱ PUBLIC creator/hotel user — existing flow untouched

- [ ] Sign in as an existing CREATOR or HOTEL user
- [ ] `/discover` → tap + FAB
- [ ] **Expect:** Default CreateSheet (Reel / Photo / Story chooser) opens — NOT UpgradeChoiceSheet
- [ ] DevTools: `/api/me/tier` returned `{ canUpload: true, tier: "CREATOR" }` (or "HOTEL")
- [ ] Pick Reel, compose, post
- [ ] **Network:** `POST /api/social/posts` (the LEGACY endpoint, not verified-guest)
- [ ] **DB check:** new social_posts row has `moderation_status='APPROVED'` (default), NO verification_method, NO booking_id
- [ ] **Regression confirmed:** existing creator/hotel UX is bit-identical to pre-Phase-4

---

## Section 2 — Hotel partner moderation

### 2.1 Pending Reviews tab shows queued content

- [ ] Sign in as the HOTEL PARTNER who owns the hotel from Section 1.2
- [ ] Navigate to `/partner/dashboard`
- [ ] Tap **"🖼️ Content Reviews"** tab in the tab strip
- [ ] **Expect:** the post you uploaded in 1.2 appears in the queue
- [ ] **Expect:** Author row shows their @handle + green "✓ Verified Guest" TierBadge
- [ ] **Expect:** Verification label reads "🎫 Verified Guest (booking)"
- [ ] **Network:** `GET /api/partner/content/pending` returns the row

### 2.2 Approve flow

- [ ] On the pending post, tap **"✓ Approve"**
- [ ] **Network:** `POST /api/partner/content/<id>` with `{ action: "approve" }`
- [ ] **Response 200**
- [ ] **Expect:** post disappears from queue (optimistic)
- [ ] **DB check:** `SELECT moderation_status, approved_at, approved_by FROM social_posts WHERE id='<post_id>'` — expect `APPROVED` + timestamp + partner user id
- [ ] **DB check:** `SELECT template, payload FROM notification_queue WHERE template='content_approved' ORDER BY created_at DESC LIMIT 1` — author gets queued notif
- [ ] **Customer side:** Open `/discover` as the post author → post is now visible in the public feed

### 2.3 Reject flow (use a 2nd test post)

- [ ] Repeat 1.2 with a different file to land another pending post
- [ ] As HOTEL PARTNER → Content Reviews tab → tap **"✕ Reject"**
- [ ] **Modal opens** asking for reason
- [ ] Try clicking "Reject" with empty reason → button should be disabled
- [ ] Enter "Test rejection — automated smoke test"
- [ ] Tap "Reject"
- [ ] **Response 200**
- [ ] **DB check:** `moderation_status='REJECTED'`, `rejection_reason` matches, `rejected_at/by` populated
- [ ] Author receives `content_rejected` notification

### 2.4 ⭐ Escalate-to-admin flow (KEY new feature per Sachin's suggestion)

- [ ] Upload a 3rd test post via 1.2 path
- [ ] HOTEL PARTNER → Content Reviews tab → tap **"⚠ Escalate to Admin"**
- [ ] Modal asks for optional notes. Add: "Smoke test — please approve from admin"
- [ ] Tap "Escalate"
- [ ] **Response 200**
- [ ] **DB check:** `moderation_status='PENDING_ADMIN_REVIEW'`, `escalated_to_admin_at` populated, `escalated_by=<partner_user_id>`
- [ ] **Notification queue:** `template='content_escalated_to_admin'`, `user_id='ADMIN'` (sentinel)

---

## Section 3 — Admin moderation

### 3.1 Pending Admin Review queue

- [ ] Sign in as ADMIN
- [ ] Navigate to `/admin/content` (sidebar: 🖼️ Content Reviews)
- [ ] **Expect:** the escalated post from 2.4 appears
- [ ] Each row shows: media thumbnail · author @handle + user_type badge · hotel name · verification method · "⚠ Escalated X min ago by hotel partner"

### 3.2 Admin approve

- [ ] Tap **"✓ Approve"** on the escalated post
- [ ] **Network:** `POST /api/admin/content/<id>` with `{ action: "approve" }`
- [ ] **Response 200**
- [ ] **DB check:** `admin_reviewed_at`, `admin_reviewed_by`, `admin_review_decision='approve'`
- [ ] **DB check:** `moderation_status='APPROVED'`
- [ ] **Audit log:** `SELECT * FROM admin_audit_log WHERE action='content.approve' ORDER BY created_at DESC LIMIT 1` — admin id + post id captured

### 3.3 ✱ Admin reject / flag / delete (use additional escalated posts)

For each action, repeat the escalation flow then test the admin action:
- [ ] **Reject** — requires reason → moderation_status='REJECTED', author notified
- [ ] **Flag** — moderation_status='FLAGGED' (visible only to admin)
- [ ] **Delete** — moderation_status='DELETED' (soft delete, post hidden from feeds)

All actions write to `admin_audit_log` with `admin_review_decision` + `admin_review_notes`.

---

## Section 4 — Cron triggers (manual, with x-admin-token)

For each cron, use the **manual admin trigger** path (matches /admin/holds page pattern):

```bash
# Get your admin token from localStorage in DevTools console:
# > localStorage.sb_admin_token

ADMIN_TOK="adm_<your_hex_token>"
BASE="https://staybids.in"   # or your Vercel preview URL

# 4.1 Auto-approve content (1h threshold by default; bump down via env temporarily for testing)
curl -X POST -H "x-admin-token: $ADMIN_TOK" \
  "$BASE/api/cron/auto-approve-content?token=staybid-cron-dev"

# 4.2 Post-stay nudge
curl -X POST -H "x-admin-token: $ADMIN_TOK" \
  "$BASE/api/cron/post-stay-nudge?token=staybid-cron-dev"

# 4.3 View-milestone rewards
curl -X POST -H "x-admin-token: $ADMIN_TOK" \
  "$BASE/api/cron/view-milestone-rewards?token=staybid-cron-dev"

# 4.4 Creator upgrade eval
curl -X POST -H "x-admin-token: $ADMIN_TOK" \
  "$BASE/api/cron/creator-upgrade-eval?token=staybid-cron-dev"
```

For each, expect a 200 JSON response with `{ ok: true, duration_ms, ...stats }`.

### 4.1 Auto-approve cron behavior

- [ ] Run with PENDING_HOTEL_APPROVAL post older than 24h
- [ ] Response: `{ scanned: N, approved: N, errors: [] }`
- [ ] DB: posts flipped to `moderation_status='AUTO_APPROVED'`, `auto_approved_at` populated
- [ ] Author receives `content_approved` notif with `auto: true`

### 4.2 Post-stay nudge behavior

- [ ] Have a booking with `status='CHECKED_OUT'` AND `checkOut` between 48h and 24h ago
- [ ] Run cron
- [ ] Response: `{ scanned_bookings, scanned_bids, nudged, skipped_dupes, errors: [] }`
- [ ] DB: new `inspiration_nudges` row with `nudge_type='post_stay_share'`, `status='SENT'`
- [ ] Customer receives `post_stay_nudge` in-app notification
- [ ] **Re-run cron** → response shows `skipped_dupes: 1` (uniq_insp_user_booking_type unique index)

### 4.3 ⭐ View-milestone reward (₹50 / ₹200) — idempotency critical

- [ ] Manually bump a Verified Guest post's `view_count` to 1500:
   ```sql
   UPDATE social_posts SET view_count = 1500
   WHERE id = '<verified_guest_post_id>' AND verification_method = 'booking';
   ```
- [ ] Run cron
- [ ] Response: `{ rewards_credited: 1, total_credited_inr: 50, ... }`
- [ ] DB: `SELECT * FROM wallet_credit_history WHERE source_type='view_milestone' AND user_id='<author_user_id>' ORDER BY created_at DESC LIMIT 1` — row with `delta_inr=50`, `source_id='<post_id>:view_milestone_1k'`
- [ ] DB: `SELECT balance_inr FROM wallet_credits WHERE user_id='<author_user_id>'` — incremented by ₹50
- [ ] **Re-run cron** → response shows `skipped_already_credited: 1`, `rewards_credited: 0` (idempotency unique index does its job)
- [ ] **Bump view_count to 10500** and re-run → +₹200 credit (10k milestone)
- [ ] **Re-run after both milestones** → `skipped_already_credited: 2`, no new credits

### 4.4 Creator upgrade eval (Type A + Type B)

**Type A test (auto-promote):**
- [ ] Author of 5+ APPROVED posts + 0 REJECTED + 5k+ total_views from the booking path
- [ ] Run cron
- [ ] Response includes `auto_promoted: 1`
- [ ] DB: `SELECT * FROM influencers WHERE user_id='<author_user_id>'` — new row with `status='active'`, `application_source='auto_promote'`, `auto_eval_data` populated
- [ ] DB: `SELECT user_type FROM social_profiles WHERE user_id='<author_user_id>'` — flipped to `CREATOR`
- [ ] Author receives `tier_promoted` notification

**Type B test (admin review):**
- [ ] Author with ≥10 posts but at least one rejection
- [ ] Run cron
- [ ] Response includes `flagged_for_admin: 1`
- [ ] DB: influencers row with `status='pending'`, `application_source='auto_eval'`
- [ ] Open `/admin/creators` → expect the candidate with amber "⚠ Flagged by cron — admin review" badge + metrics grid
- [ ] Admin approves manually → status flips to 'active'

**Re-run safety:**
- [ ] Run the cron again
- [ ] Response: `skipped_already_in_influencers` count went up
- [ ] No duplicate influencers rows

---

## Section 5 — Wallet & inspiration banner

### 5.1 Wallet balance reflects view-milestone credits

- [ ] As the author from 4.3 → navigate to `/wallet`
- [ ] **Expect:** Balance shows ₹50 (or ₹250 if both milestones hit)
- [ ] **Expect:** Transactions list includes the milestone credit with description like "1,000 views earned a StayBid reward"

### 5.2 ✱ InspirationBanner on /bookings

- [ ] As a customer with at least one booking
- [ ] Navigate to `/bookings`
- [ ] **Expect:** Premium cream banner above the list: "Share your StayBid moments"
- [ ] Tap "Share now →"
- [ ] **Expect:** Routes to `/discover#create` (FAB-attention surface)
- [ ] Go back to `/bookings`, tap **× dismiss**
- [ ] Reload `/bookings`
- [ ] **Expect:** Banner stays dismissed (localStorage persistence)

### 5.3 ✱ InspirationBanner in booking-confirmed success modal

- [ ] As a customer, complete a Book Now or Negotiate flow on `/hotels/[id]`
- [ ] After Razorpay payment → success modal opens
- [ ] **Expect:** Inline cream banner inside the modal: "Share your stay" with the hotel name
- [ ] Tap "Share now →" → routes into create flow with hotel context

---

## Section 6 — Regression checks (existing flows MUST still work)

### 6.1 Existing /upgrade form

- [ ] Open `/upgrade` as a PUBLIC user
- [ ] Fill the existing creator application form
- [ ] Submit
- [ ] **DB:** new `influencers` row with `application_source='form'` (the default), `status='pending'`
- [ ] **No regression** — form path is unchanged

### 6.2 Existing /api/social/posts

- [ ] As a CREATOR or HOTEL user, upload via CreateSheet (not the Verified Guest path)
- [ ] **Network:** `POST /api/social/posts` (legacy endpoint)
- [ ] New post has `moderation_status='APPROVED'` (Phase 1 default — visible immediately)
- [ ] Reel-dedup chain (v131.8) still intact — `client_post_id` in body

### 6.3 Existing reel feed pre-Phase-1 posts

- [ ] DB: `SELECT COUNT(*) FROM social_posts WHERE moderation_status = 'APPROVED'` — confirm the 33+ pre-tier-system posts all show as APPROVED (Phase 1 default did the right thing)
- [ ] Open `/discover` — every existing post is visible exactly as today
- [ ] No "missing post" / "stuck in pending" regressions

### 6.4 Existing crons untouched

- [ ] Open Vercel deployment logs after `/api/cron/pricing` or `/api/cron/lifecycle` runs (their normal 4am IST schedule)
- [ ] No errors / no behavior changes

### 6.5 Existing /admin/* pages render correctly

- [ ] Visit /admin · /admin/users · /admin/creators · /admin/hotels · /admin/bookings · /admin/holds · /admin/analytics · /admin/messages
- [ ] All render as before. Sidebar has the new "🖼️ Content Reviews" entry (Phase 5 addition); no other changes.

---

## Section 7 — Browser console assertions (no errors)

Run these in DevTools Console after each section:

```js
// Get current tier snapshot
fetch('/api/me/tier', { headers: { Authorization: `Bearer ${localStorage.sb_token}` } })
  .then(r => r.json()).then(console.log);

// Get eligible bookings
fetch('/api/me/eligible-bookings', { headers: { Authorization: `Bearer ${localStorage.sb_token}` } })
  .then(r => r.json()).then(console.log);

// Verify location OTP is disabled (Option A default)
fetch('/api/verify/location/send-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.sb_token}` },
  body: JSON.stringify({ hotelId: 'X', deviceLat: 0, deviceLng: 0 }),
}).then(r => r.json()).then(console.log);
// Expect: { error: "Location verification is not yet available", code: "LOCATION_OTP_DISABLED" }
```

---

## Quick smoke pass (10 minutes)

If you're short on time, run only these ⭐ checkpoints:

- [ ] 1.1 — PUBLIC + no eligibility → UpgradeChoiceSheet opens
- [ ] 1.2 — Verified Guest upload → POSTs to /verified-guest endpoint, promotes user
- [ ] 2.1 + 2.2 — Hotel partner sees + approves
- [ ] 2.4 — Hotel partner escalates to admin
- [ ] 3.1 + 3.2 — Admin sees + approves
- [ ] 4.3 — View-milestone reward + idempotency re-run
- [ ] 6.2 — Existing creator path still works

If all 7 ⭐ pass → safe to ship. If any fail → investigate before flipping the gate live.

---

## What's deliberately NOT tested here

- **Location-OTP flow end-to-end** — Phase 3 Option A keeps it OFF. To test, you'd need to set `NEXT_PUBLIC_ENABLE_LOCATION_OTP=1` + paste Railway dispatcher + have a working OTP delivery plan. Out of scope for this smoke suite.
- **Real WhatsApp / SMS delivery** — Phase 6 Railway template paste pending. In-app notifications work today.
- **Cron-job.org scheduling** — Sachin sets these up manually post-deploy. Schedule listed in `docs/RAILWAY_NOTIFICATION_TEMPLATES_PASTE.md` Step 4 + CLAUDE.md Section 9.6.
- **Load / scale testing** — Phase 1-7 are MVP. Hard-caps at 200 rows per cron run; if traffic genuinely scales past that, revisit.
