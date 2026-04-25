import { NextResponse } from "next/server";
import { sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { sha256, hashPassword } from "@/lib/onboard/password";
import { signOnboardToken } from "@/lib/onboard/jwt";

// POST /api/onboard/auth/verify-otp
// Body: { identifier, code, password? }
// On success: marks identifier verified, optionally sets password,
// returns onboarding JWT + user.
//
// Two ways to call:
//   1) verify only        — returns { verified: true, needsPassword: true }
//   2) verify + setPassword — returns { token, user } (one-shot signup finish)
export async function POST(req: Request) {
  try {
    const { identifier, code, password } = await req.json();
    if (!identifier || !code) {
      return NextResponse.json({ error: "identifier + code required" }, { status: 400 });
    }
    const code_hash = sha256(String(code).trim());

    // Pull most recent unconsumed OTP for this identifier
    const rows = await sbSelect<any>(
      "otp_codes",
      `identifier=eq.${encodeURIComponent(identifier)}&consumed=eq.false&order=created_at.desc&limit=1`
    );
    const otp = rows[0];
    if (!otp) return NextResponse.json({ error: "No OTP found. Please request again." }, { status: 400 });
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "OTP expired. Request a new one." }, { status: 400 });
    }
    if (otp.attempts >= 5) {
      return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
    }
    if (otp.code_hash !== code_hash) {
      await sbUpdate("otp_codes", `id=eq.${otp.id}`, { attempts: otp.attempts + 1 });
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    await sbUpdate("otp_codes", `id=eq.${otp.id}`, { consumed: true });

    // Find user by this identifier
    const isEmail = identifier.includes("@");
    const userQ = isEmail
      ? `email=eq.${encodeURIComponent(identifier)}`
      : `phone=eq.${encodeURIComponent(identifier)}`;
    const users = await sbSelect<any>("onboarding_users", `${userQ}&limit=1`);
    const user = users[0];
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const patch: any = isEmail ? { email_verified: true } : { phone_verified: true };
    if (password && password.length >= 6) {
      patch.password_hash = await hashPassword(password);
    }
    const updated = await sbUpdate("onboarding_users", `id=eq.${user.id}`, patch);
    const u = Array.isArray(updated) ? updated[0] : updated;

    if (!password) {
      return NextResponse.json({
        verified: true,
        needsPassword: !u.password_hash,
        userId: u.id,
      });
    }

    const token = signOnboardToken({
      sub: u.id,
      email: u.email,
      phone: u.phone,
      role: u.role,
      emailVerified: !!u.email_verified,
      phoneVerified: !!u.phone_verified,
    });

    return NextResponse.json({
      token,
      user: publicUser(u),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "verify failed" }, { status: 500 });
  }
}

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    name: u.name,
    role: u.role,
    emailVerified: !!u.email_verified,
    phoneVerified: !!u.phone_verified,
  };
}
