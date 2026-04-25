// SMS / WhatsApp OTP provider.
// Default: proxies to existing Railway WhatsApp OTP endpoint (already wired
// for customer + partner). Can switch to Twilio / MSG91 by setting SMS_PROVIDER.

const PROVIDER =
  process.env.SMS_PROVIDER ||
  (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "railway-whatsapp");

const RAILWAY_API =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://staybid-live-production.up.railway.app";

async function sendViaRailway(phone: string, code: string) {
  // The existing Railway endpoint generates+sends its own OTP. For onboarding
  // we manage the OTP ourselves so we just deliver our code via a generic
  // notification endpoint when available; otherwise we log to console (mock).
  try {
    const r = await fetch(`${RAILWAY_API}/api/auth/send-otp-custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code, brand: "StayBid Partner" }),
    });
    if (r.ok) return;
  } catch {}
  // eslint-disable-next-line no-console
  console.log("[sms:fallback]", phone, "code=", code);
}

async function sendViaTwilio(phone: string, code: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const tok = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM!;
  const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: `Your StayBid verification code is ${code}. Valid for 10 minutes.`,
  });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

export async function sendSms(phone: string, code: string): Promise<{ provider: string }> {
  switch (PROVIDER) {
    case "twilio":
      await sendViaTwilio(phone, code);
      return { provider: "twilio" };
    case "mock":
      // eslint-disable-next-line no-console
      console.log("[sms:mock]", phone, "code=", code);
      return { provider: "mock" };
    default:
      await sendViaRailway(phone, code);
      return { provider: "railway-whatsapp" };
  }
}

export const SMS_PROVIDER = PROVIDER;
