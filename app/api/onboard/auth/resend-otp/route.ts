import { NextResponse } from "next/server";
import { sbInsert, sbSelect } from "@/lib/onboard/supabase-admin";
import { generateOtp, sha256 } from "@/lib/onboard/password";
import { sendEmail, otpEmail, EMAIL_IS_MOCK } from "@/lib/onboard/email";
import { sendSms, SMS_IS_MOCK } from "@/lib/onboard/sms";

export async function POST(req: Request) {
  try {
    const { identifier } = await req.json();
    if (!identifier) return NextResponse.json({ error: "identifier required" }, { status: 400 });
    const isEmail = String(identifier).includes("@");
    const channel = isEmail ? "email" : "sms";

    // Soft rate-limit: max 1 OTP / 30 sec
    const recent = await sbSelect<any>(
      "otp_codes",
      `identifier=eq.${encodeURIComponent(identifier)}&order=created_at.desc&limit=1`
    );
    if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 30_000) {
      return NextResponse.json({ error: "Please wait before requesting again." }, { status: 429 });
    }

    const code = generateOtp(6);
    await sbInsert("otp_codes", {
      identifier,
      channel,
      code_hash: sha256(code),
      purpose: "signup",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    let isMock = false;
    if (isEmail) {
      const { subject, html } = otpEmail(code);
      await sendEmail({ to: identifier, subject, html });
      isMock = EMAIL_IS_MOCK;
    } else {
      await sendSms(identifier, code);
      isMock = SMS_IS_MOCK;
    }
    return NextResponse.json(isMock ? { ok: true, devOtp: code } : { ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "resend failed" }, { status: 500 });
  }
}
