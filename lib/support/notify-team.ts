// Team alert when a conversation escalates to human queue.
//
// Reads SUPPORT_ALERT_EMAILS env var (comma-separated). Silently no-ops
// when env var is missing, matching the AI-disabled graceful-degradation
// pattern used elsewhere in the support system.
//
// Uses the existing lib/onboard/email.ts sendEmail abstraction —
// auto-switches between SendGrid (when SENDGRID_API_KEY is set) and a
// console-mock provider for local/dev.

import { sendEmail } from "@/lib/onboard/email";
import type {
  SupportConversation,
  SupportEscalationReason,
} from "./types";

export async function notifyTeamOfEscalation(opts: {
  conversation: SupportConversation;
  reason: SupportEscalationReason;
  lastUserMessage: string;
  customerName?: string | null;
  customerPhone?: string | null;
}): Promise<void> {
  const recipients = (process.env.SUPPORT_ALERT_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length === 0) return;

  const { conversation, reason, lastUserMessage } = opts;
  const customerLabel =
    opts.customerName ||
    opts.customerPhone ||
    conversation.user_id ||
    conversation.anonymous_id ||
    "Anonymous";
  const reasonLabel = REASON_LABEL[reason] || reason;
  const adminUrl =
    process.env.ADMIN_BASE_URL ||
    "https://staybids.in/admin/support";

  const subject = `🎧 New support escalation — ${reasonLabel} — ${customerLabel.slice(0, 32)}`;

  const html = `<!doctype html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#0F1117;padding:24px;color:#E8EAF0">
  <div style="max-width:540px;margin:0 auto;background:#151820;border:1px solid rgba(212,175,55,0.25);border-radius:14px;padding:24px;box-shadow:0 8px 24px rgba(0,0,0,0.4)">
    <div style="font-family:'Syne',serif;font-size:20px;color:#D4AF37;font-weight:700">StayBid Support</div>
    <div style="color:#8A8FA8;font-size:12px;margin-bottom:18px;letter-spacing:0.05em;text-transform:uppercase">Escalation alert</div>

    <div style="background:rgba(255,71,87,0.12);border:1px solid rgba(255,71,87,0.4);border-radius:8px;padding:10px 14px;font-size:13px;color:#FF7878;margin-bottom:14px">
      ⚠ ${reasonLabel}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="color:#8A8FA8;padding:4px 0;width:120px">Customer</td><td style="color:#E8EAF0">${escapeHtml(customerLabel)}</td></tr>
      ${
        opts.customerPhone
          ? `<tr><td style="color:#8A8FA8;padding:4px 0">Phone</td><td style="color:#E8EAF0">${escapeHtml(opts.customerPhone)}</td></tr>`
          : ""
      }
      <tr><td style="color:#8A8FA8;padding:4px 0">Subject</td><td style="color:#E8EAF0">${escapeHtml(conversation.subject || "(no subject)")}</td></tr>
      <tr><td style="color:#8A8FA8;padding:4px 0">Started</td><td style="color:#E8EAF0">${new Date(conversation.created_at).toLocaleString()}</td></tr>
    </table>

    <div style="margin-top:16px;background:#0F1117;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;font-size:13px;color:#E8EAF0;font-style:italic;line-height:1.5">
      "${escapeHtml(lastUserMessage.slice(0, 400))}${lastUserMessage.length > 400 ? "…" : ""}"
    </div>

    <a href="${adminUrl}" style="display:inline-block;margin-top:18px;background:#D4AF37;color:#0F1117;padding:10px 22px;border-radius:8px;font-weight:700;text-decoration:none">Open Support Inbox →</a>

    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.07);margin:20px 0"/>
    <p style="color:#5E6273;font-size:11px;margin:0">You are receiving this because your email is in <code>SUPPORT_ALERT_EMAILS</code>. To stop, remove your address from that Vercel env var.</p>
  </div>
</body></html>`;

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html });
    } catch {
      // fire-and-forget — never block escalation flow on email failure
    }
  }
}

const REASON_LABEL: Record<SupportEscalationReason, string> = {
  user_request: "User asked for a human",
  low_confidence: "AI couldn't resolve",
  sentiment_negative: "Negative sentiment detected",
  specific_intent: "Refund / legal / financial intent",
  ai_disabled: "AI tier disabled — direct to queue",
  agent_manual: "Manually escalated by agent",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
