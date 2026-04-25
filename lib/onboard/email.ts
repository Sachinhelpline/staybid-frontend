// Email provider abstraction.
// Auto-switches between SendGrid (when SENDGRID_API_KEY is set) and a
// console-mock provider for local/dev. Adding a new provider (Resend, SES,
// Postmark) only requires writing one more `case` in `send()`.

type SendArgs = { to: string; subject: string; html: string; text?: string };

const PROVIDER =
  process.env.EMAIL_PROVIDER ||
  (process.env.SENDGRID_API_KEY ? "sendgrid" : "mock");

const FROM =
  process.env.EMAIL_FROM ||
  process.env.SENDGRID_FROM ||
  "StayBid <noreply@staybids.in>";

async function sendViaSendGrid({ to, subject, html, text }: SendArgs) {
  const sg = (await import("@sendgrid/mail")).default;
  sg.setApiKey(process.env.SENDGRID_API_KEY!);
  const fromMatch = FROM.match(/^(.*?)\s*<(.+)>$/);
  const from = fromMatch ? { name: fromMatch[1].trim(), email: fromMatch[2] } : FROM;
  await sg.send({ to, from: from as any, subject, html, text: text || html.replace(/<[^>]+>/g, " ") });
}

function sendViaMock({ to, subject, html }: SendArgs) {
  // eslint-disable-next-line no-console
  console.log("[email:mock]", { to, subject });
  // eslint-disable-next-line no-console
  console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400));
}

export async function sendEmail(args: SendArgs): Promise<{ provider: string }> {
  switch (PROVIDER) {
    case "sendgrid":
      await sendViaSendGrid(args);
      return { provider: "sendgrid" };
    default:
      sendViaMock(args);
      return { provider: "mock" };
  }
}

export function otpEmail(code: string, name?: string) {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const html = `<!doctype html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#faf7f2;padding:32px">
<div style="max-width:480px;margin:0 auto;background:white;border:1px solid #efe4d2;border-radius:24px;padding:32px;box-shadow:0 8px 24px rgba(201,145,26,0.08)">
  <div style="font-family:'Cormorant Garamond',serif;font-size:28px;color:#8a6914;font-weight:600">StayBid</div>
  <p style="color:#5a4a2c;line-height:1.6;margin-top:16px">${greeting}</p>
  <p style="color:#5a4a2c;line-height:1.6">Use this one-time code to verify your email and finish creating your StayBid Partner account.</p>
  <div style="background:linear-gradient(135deg,#f0b429,#c9911a);color:white;font-size:32px;letter-spacing:8px;text-align:center;padding:18px;border-radius:16px;font-weight:700;margin:24px 0">${code}</div>
  <p style="color:#8a7355;font-size:13px;line-height:1.6">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #efe4d2;margin:24px 0"/>
  <p style="color:#a8916b;font-size:12px">StayBid — Luxury reverse-auction platform for hotels.</p>
</div>
</body></html>`;
  return { subject: `Your StayBid verification code: ${code}`, html };
}

export const EMAIL_PROVIDER = PROVIDER;
