// ═══════════════════════════════════════════════════════════════════════════
// Server-side notification fan-out — future-ready.
//
// Single place every server route queues a customer notification. It writes one
// `notification_queue` row per ENABLED channel. Channel enablement is env-driven:
//
//   • in_app   — ALWAYS on. The client <NotificationToast> polls
//                notification_queue directly, so these deliver today with no
//                external provider.
//   • sms      — OFF until SMS_NOTIFICATIONS_ENABLED=1
//   • whatsapp — OFF until WHATSAPP_NOTIFICATIONS_ENABLED=1
//   • email    — OFF until EMAIL_NOTIFICATIONS_ENABLED=1
//
// THE POINT (future-readiness): when the paid SMS/WhatsApp plan goes live, you
// flip ONE env flag on Vercel + redeploy, and every event that already calls
// queueNotification() starts fanning out to that channel automatically — zero
// code changes. The Railway drainer then sends the queued sms/whatsapp/email
// rows (see docs/NOTIFICATIONS-ACTIVATION.md + docs/RAILWAY_NOTIFICATION_TEMPLATES_PASTE.md).
//
// Until then the extra channels stay OFF so we never build a backlog of
// undeliverable rows while the plan is inactive.
// ═══════════════════════════════════════════════════════════════════════════
import { SB_URL, SB_H } from "@/lib/sb";

export type NotifChannel = "in_app" | "sms" | "whatsapp" | "email";

const FLAG = {
  sms:      "SMS_NOTIFICATIONS_ENABLED",
  whatsapp: "WHATSAPP_NOTIFICATIONS_ENABLED",
  email:    "EMAIL_NOTIFICATIONS_ENABLED",
} as const;

/** Per-channel on/off, read live from env. in_app is structurally always on. */
export function notificationChannelStatus(): Record<NotifChannel, boolean> {
  return {
    in_app:   true,
    sms:      process.env[FLAG.sms] === "1",
    whatsapp: process.env[FLAG.whatsapp] === "1",
    email:    process.env[FLAG.email] === "1",
  };
}

/** The channels that are currently active (always includes in_app). */
export function enabledChannels(): NotifChannel[] {
  const s = notificationChannelStatus();
  return (Object.keys(s) as NotifChannel[]).filter((c) => s[c]);
}

/**
 * Queue a customer notification across every enabled channel. Fire-and-forget:
 * notification failures must never break the calling flow, so this swallows all
 * errors. Pass `channels` to override (e.g. force in_app only for a noisy event).
 */
export async function queueNotification(opts: {
  userId: string;
  template: string;
  payload?: Record<string, unknown>;
  channels?: NotifChannel[];
}): Promise<void> {
  try {
    if (!opts.userId) return;
    const channels = opts.channels ?? enabledChannels();
    if (channels.length === 0) return;
    const rows = channels.map((channel) => ({
      user_id: opts.userId,
      channel,
      template: opts.template,
      payload: opts.payload ?? {},
      status: "pending",
    }));
    await fetch(`${SB_URL}/rest/v1/notification_queue`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch {
    /* swallow — a queue write must never break the caller */
  }
}
