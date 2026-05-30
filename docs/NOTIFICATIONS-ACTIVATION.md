# Notifications — activation runbook (when the paid SMS/WhatsApp plan goes live)

The notification system is **built and wired but channel-gated**. Today only the
`in_app` channel delivers (the client `<NotificationToast>` polls
`notification_queue` directly — no external provider needed). `sms`, `whatsapp`,
and `email` are **OFF by default** so we don't pile up undeliverable rows while
the paid plan is inactive.

When the paid plan is live, turning notifications ON is a **flag flip + one
Railway paste** — no app code changes.

## How it's wired

Every server-side customer notification goes through one helper:

```ts
import { queueNotification } from "@/lib/notify-server";
await queueNotification({ userId, template: "tier_promoted", payload: { … } });
```

`queueNotification` writes one `notification_queue` row **per enabled channel**.
Channel enablement is read live from env (`lib/notify-server.ts`):

| Channel  | Default | Env flag to enable            |
|----------|---------|-------------------------------|
| in_app   | **ON**  | — (always on)                 |
| sms      | off     | `SMS_NOTIFICATIONS_ENABLED=1` |
| whatsapp | off     | `WHATSAPP_NOTIFICATIONS_ENABLED=1` |
| email    | off     | `EMAIL_NOTIFICATIONS_ENABLED=1` |

Events already fanning out through the helper (more added over time):
- `tier_promoted` — user promoted to Verified Guest / Community Contributor / Creator (`lib/tier/promote.ts`)
- `content_approved` / `content_rejected` / `content_flagged` / `content_deleted` (`app/api/admin/content/[id]`)
- `post_stay_nudge` — "share your trip" 24–48h after checkout (`app/api/cron/post-stay-nudge`)
- `view_milestone_reward` — ₹50/₹200 wallet reward at 1k/10k views (`app/api/cron/view-milestone-rewards`)

## Activation steps (paid plan day)

1. **Confirm the delivery provider is live** — MSG91 (SMS, DLT template approved)
   and/or WhatsApp Business credentials on the Railway backend.

2. **Paste the Railway drainer + templates** (the piece that actually *sends*
   the queued rows): `docs/RAILWAY_NOTIFICATION_TEMPLATES_PASTE.md`. The drainer
   reads `notification_queue WHERE status='pending' AND channel IN (…)`, sends
   via MSG91/WhatsApp/SendGrid, then flips `status='sent'` (or `'failed'`).

3. **Flip the flag(s)** on Vercel (`staybid-customer-frontend` project →
   Settings → Environment Variables) and redeploy:
   ```
   SMS_NOTIFICATIONS_ENABLED=1          # SMS via MSG91
   WHATSAPP_NOTIFICATIONS_ENABLED=1     # WhatsApp Business
   EMAIL_NOTIFICATIONS_ENABLED=1        # SendGrid/Nodemailer
   ```
   Enable only the channels whose provider is actually live. From the next
   request onward, every `queueNotification` event fans out to those channels —
   the Railway drainer picks them up and sends.

4. **Verify** — trigger a known event (e.g. approve a pending post in
   `/admin/content`) and confirm a row appears in `notification_queue` with the
   new channel, then flips to `status='sent'` after the drainer runs.

## Rollback

Set the flag(s) back to `0` (or remove) + redeploy. New events stop queuing
those channels immediately; `in_app` keeps working. No code change.

## Notes

- **Don't** queue `sms`/`whatsapp` rows manually with the flag off — they'd sit
  `pending` forever with no drainer. Always go through `queueNotification`, which
  respects the flags.
- The admin sentinel notifications (`user_id='ADMIN'`) intentionally stay
  `in_app` — admins work from the dashboard, not SMS.
- More customer events (bid accepted / countered / payment confirmed) can be
  migrated to `queueNotification` as SMS priorities are decided — they'll
  inherit the same flag behaviour automatically.
