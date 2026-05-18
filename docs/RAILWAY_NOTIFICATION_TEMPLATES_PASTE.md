# Railway — Notification drainer templates paste-ready code

> **Repo:** `Sachinhelpline/staybid-Live` → wherever your `notification_queue` drainer worker lives
> **Phase:** Phase 6 of the 2-Tier System.
> **Status:** Frontend Phase 2 + Phase 6 already INSERT rows into `notification_queue` with 7 new `template` strings. Until you paste these handlers + redeploy Railway, those rows queue successfully but the SMS / WhatsApp / email channels never fire. The `in_app` channel works as soon as the row lands (the customer-side notification toast picks it up directly from Supabase).

---

## Background — what already works without your paste

The 7 new templates are dispatched by:
- `/api/social/posts/verified-guest` → queues `content_pending_approval` to hotel partner + `tier_promoted` to author (when promoted PUBLIC→VERIFIED_GUEST)
- `/api/social/posts/community` → same shape
- `/api/partner/content/[id]` (Phase 2) → `content_approved` / `content_rejected` / `content_escalated_to_admin`
- `/api/admin/content/[id]` (Phase 2) → `content_approved` / `content_rejected` / `content_flagged` / `content_deleted`
- `/api/cron/auto-approve-content` (Phase 6) → `content_approved` (with `auto:true`)
- `/api/cron/post-stay-nudge` (Phase 6) → `post_stay_nudge`
- `/api/cron/view-milestone-rewards` (Phase 6) → `view_milestone_reward`

The frontend's existing `<NotificationToast />` (mounted in `app/layout.tsx`) listens to in-app notifications and fires Hinglish/English toast UI. So the user-visible nudge IS happening today via in-app channel. SMS / WhatsApp / email are the missing channels.

---

## The 7 new `template` strings + their payloads

| Template name | Audience | Payload fields | Suggested message |
|---|---|---|---|
| `tier_promoted` | User who just got promoted PUBLIC → tier | `{ tier: "VERIFIED_GUEST" \| "COMMUNITY_CONTRIBUTOR" \| "CREATOR" }` | "Aap ab {{tier_label}} ho! StayBid pe apne stays ke reels & photos share kar sakte ho. 🎉" |
| `content_pending_approval` | Hotel partner | `{ post_id, hotel_name }` | "{{hotel_name}}: ek naya guest reel review ke liye aaya hai. Dashboard me dekhein → Content Reviews tab." |
| `content_approved` | Post author | `{ post_id, hotel_name?, auto?: boolean, reason? }` | (Manual) "Aapka {{hotel_name}} ka reel approve ho gaya — public feed pe live hai 🎉"  (Auto) "Aapka reel auto-approved ho gaya 24h ke baad. Live on the feed." |
| `content_rejected` | Post author | `{ post_id, reason }` | "Aapka reel reject ho gaya. Reason: {{reason}}. You can edit and re-upload." |
| `content_flagged` | Post author | `{ post_id, reason? }` | "Aapka reel admin moderation me hai. Hum review karke jaldi reply karenge." |
| `content_deleted` | Post author | `{ post_id }` | "Aapka reel hata diya gaya admin review ke baad." |
| `post_stay_nudge` | Customer who just finished a stay | `{ booking_id, hotel_id, hotel_name }` | "{{hotel_name}} ka stay kaisa raha? Reel ya photo share karke StayPoints earn karein ✨" |
| `view_milestone_reward` | Post author | `{ post_id, threshold, reward_inr }` | "🎉 Aapke reel ko {{threshold}} views mile! ₹{{reward_inr}} wallet me credit ho gaye." |

Plus `content_escalated_to_admin` (sentinel user_id='ADMIN' — drains to admin team WhatsApp group, not a single user) — you can map that to your existing admin alert channel.

---

## Step 1 — Paste this in your notification drainer worker

Wherever your existing template registry lives (TypeScript switch / function map / config object), add these 8 entries:

```ts
// ─── 2-Tier System templates (Phase 6) ───────────────────────────────────
// All templates accept (payload, user) and return { sms?, whatsapp?, email? }
// objects. Empty channels are skipped by the drainer.

const TIER_LABEL: Record<string, string> = {
  VERIFIED_GUEST:        "Verified Guest",
  COMMUNITY_CONTRIBUTOR: "Verified Local",
  CREATOR:               "StayBid Creator",
};

const TEMPLATES = {
  // ... your existing templates ...

  tier_promoted: (p: any, _u: any) => {
    const label = TIER_LABEL[p.tier] || p.tier;
    return {
      whatsapp: `🎉 Congrats! Aap ab ${label} ho! Apne hotel stays ke reels & photos share kar sakte ho on StayBid. Open: https://staybids.in/discover`,
    };
  },

  content_pending_approval: (p: any, _u: any) => ({
    whatsapp: `🏨 Naya guest reel review ke liye aaya hai for ${p.hotel_name || "your hotel"}. Open: https://staybids.in/partner/dashboard (Content Reviews tab)`,
  }),

  content_approved: (p: any, _u: any) => ({
    whatsapp: p.auto
      ? `✓ Aapka reel auto-approved ho gaya. Public feed pe live hai! https://staybids.in/me/posts`
      : `🎉 Aapka reel approve ho gaya. Live on the feed! https://staybids.in/me/posts`,
  }),

  content_rejected: (p: any, _u: any) => ({
    whatsapp: `Aapka reel reject ho gaya. Reason: ${p.reason || "Content violated guidelines"}. Aap edit karke re-upload kar sakte ho.`,
  }),

  content_flagged: (_p: any, _u: any) => ({
    whatsapp: `Aapka reel admin moderation me hai. Hum jaldi review karke reply karenge.`,
  }),

  content_deleted: (_p: any, _u: any) => ({
    whatsapp: `Aapka reel admin review ke baad hata diya gaya.`,
  }),

  post_stay_nudge: (p: any, _u: any) => ({
    whatsapp: `✨ ${p.hotel_name || "Your stay"} kaisa raha? Reel ya photo share karke StayPoints earn karein. Open: https://staybids.in/bookings`,
  }),

  view_milestone_reward: (p: any, _u: any) => ({
    whatsapp: `🎉 Wow! Aapke reel ko ${p.threshold.toLocaleString()} views mile! ₹${p.reward_inr} aapke wallet me credit ho gaye. Open: https://staybids.in/wallet`,
  }),

  // Admin escalation — fans out to admin team (special user_id='ADMIN'
  // sentinel — your drainer should route this to your admin Slack/WhatsApp group)
  content_escalated_to_admin: (p: any, _u: any) => ({
    whatsapp: `⚠ Hotel ${p.hotel_name || p.hotel_id} ne ek post escalate kiya. Admin dashboard: https://staybids.in/admin/content`,
  }),
};
```

If you use SMS instead of WhatsApp (or both), duplicate the `whatsapp:` strings to `sms:` — same content, just costs more per message. Email versions can be richer with HTML formatting but the WhatsApp text above already conveys all info.

---

## Step 2 — Hindi/English audience consideration

The user-base is bilingual. Default to Hinglish (Hindi-in-Latin-script) like the strings above. If you have a `user.locale` field, branch on it:

```ts
const isHindiPreferred = u.locale?.startsWith("hi") || u.phone?.startsWith("+91");
return {
  whatsapp: isHindiPreferred
    ? `🎉 ${label} ban gaye! Reels share kar sakte ho — https://staybids.in/discover`
    : `🎉 You're now a ${label}! Share reels & photos of your stays — https://staybids.in/discover`,
};
```

No user.locale field exists in this codebase yet; the `+91` phone-prefix heuristic is the cleanest available signal.

---

## Step 3 — Test path

After paste + redeploy Railway, the drainer should pick up rows from `notification_queue` where `status='pending'`. Confirm by:

1. Inserting a test row manually via Supabase SQL editor:
   ```sql
   INSERT INTO notification_queue (id, user_id, channel, template, payload, status, created_at)
   VALUES (
     gen_random_uuid()::text,
     'YOUR-TEST-USER-ID',
     'whatsapp',
     'tier_promoted',
     '{"tier":"VERIFIED_GUEST"}'::jsonb,
     'pending',
     now()
   );
   ```
2. Watching the drainer pick it up → `status` flips to `sent` + `sent_at` populated
3. Receiving the WhatsApp message on the test user's phone

---

## Step 4 — What happens before this paste

The 7 frontend code paths already INSERT into `notification_queue` with these template names. Rows accumulate with `status='pending'`. The customer-side in-app toast surface (`<NotificationToast />` from v67 era) DIRECTLY queries `notification_queue?user_id=eq.X&status=eq.pending&channel=eq.in_app` and renders the toast WITHOUT going through Railway. So in-app nudges work today; only SMS/WhatsApp/email are gated by your paste.

Same architecture as the v72 era MSG91 paste — frontend's responsibility ends at the INSERT. Railway is the drainage layer.

---

## Things to avoid for this paste

- **Don't change the template names.** The frontend hardcodes them. If you want to rename internally, do it server-side: receive the canonical name from the queue, alias to your internal handler.
- **Don't store reply state for the user on Railway.** The frontend's notification surface tracks read/unread via `notification_queue.read_at` (NULL = unread). Don't re-write that column from Railway.
- **Don't route in_app channel through Railway.** The customer's mounted `<NotificationToast />` already polls Supabase directly. Adding Railway as a middleman delays delivery.
- **Don't store the user's phone on Railway just for messaging.** Pull `users.phone` per-message from Supabase (or cache for 5 minutes max). Single source of truth for phone numbers stays in Supabase `users`.
- **Don't fail-open on missing template handler.** If a row comes in with an unknown `template` string, mark it `status='failed'` with a clear `error` message rather than silently skipping — keeps the queue auditable.
- **Don't drain the `user_id='ADMIN'` rows to a single user.** That's the sentinel for admin team — route to whichever channel your admin alerts already use (Slack, Telegram group, etc).

---

## Once Railway redeploys

No frontend change required. The next time:
- A user gets promoted to Verified Guest → `tier_promoted` notif → WhatsApp arrives
- A hotel partner gets a pending review → `content_pending_approval` → WhatsApp
- An admin escalates a post → author gets `content_approved` or `content_rejected` WhatsApp
- The view-milestone cron runs and finds a 1k-view post → author gets `view_milestone_reward` WhatsApp with the ₹50/₹200 amount

**Done.** Phase 6 is complete on both sides.
