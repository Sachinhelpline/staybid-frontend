import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { generateOtp, sha256 } from "@/lib/onboard/password";
import { sendEmail, otpEmail } from "@/lib/onboard/email";
import { sendSms } from "@/lib/onboard/sms";

// POST /api/onboard/auth/signup
// Body: { email, phone, name } — at least one of email/phone required.
// Creates a pending onboarding_user (if absent) and sends OTP(s).
// Idempotent: re-sending for the same identifier just resends a fresh OTP.
export async function POST(req: Request) {
  try {
    const { email, phone, name } = await req.json();
    const cleanEmail = (email || "").trim().toLowerCase() || null;
    const cleanPhone = normalizePhone(phone);

    if (!cleanEmail && !cleanPhone) {
      return NextResponse.json({ error: "Email or phone is required" }, { status: 400 });
    }

    // Find or create user
    let user = await findUser(cleanEmail, cleanPhone);
    if (!user) {
      user = await sbInsert("onboarding_users", {
        email: cleanEmail,
        phone: cleanPhone,
        name: name || null,
        role: "owner",
      });
    } else if (user.password_hash) {
      // Already has a password — they should sign in instead
      return NextResponse.json(
        { error: "Account already exists. Please sign in.", existing: true },
        { status: 409 }
      );
    } else if (name && !user.name) {
      await sbUpdate("onboarding_users", `id=eq.${user.id}`, { name });
    }

    // Send OTPs (email + sms in parallel where applicable)
    const tasks: Promise<any>[] = [];
    if (cleanEmail) tasks.push(issueOtp(cleanEmail, "email", name));
    if (cleanPhone) tasks.push(issueOtp(cleanPhone, "sms", name));
    await Promise.all(tasks);

    return NextResponse.json({
      ok: true,
      userId: user.id,
      sentTo: { email: !!cleanEmail, phone: !!cleanPhone },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "signup failed" }, { status: 500 });
  }
}

async function findUser(email: string | null, phone: string | null) {
  const filters: string[] = [];
  if (email) filters.push(`email.eq.${encodeURIComponent(email)}`);
  if (phone) filters.push(`phone.eq.${encodeURIComponent(phone)}`);
  const q = `or=(${filters.join(",")})&limit=1`;
  const rows = await sbSelect<any>("onboarding_users", q);
  return rows[0];
}

async function issueOtp(identifier: string, channel: "email" | "sms", name?: string) {
  const code = generateOtp(6);
  const code_hash = sha256(code);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sbInsert("otp_codes", {
    identifier,
    channel,
    code_hash,
    purpose: "signup",
    expires_at,
  });
  if (channel === "email") {
    const { subject, html } = otpEmail(code, name);
    await sendEmail({ to: identifier, subject, html });
  } else {
    await sendSms(identifier, code);
  }
}

function normalizePhone(p?: string): string | null {
  if (!p) return null;
  const digits = String(p).replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits;
}
