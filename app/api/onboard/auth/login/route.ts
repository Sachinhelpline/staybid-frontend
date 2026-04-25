import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { verifyPassword } from "@/lib/onboard/password";
import { signOnboardToken } from "@/lib/onboard/jwt";

// POST /api/onboard/auth/login
// Body: { identifier, password }
export async function POST(req: Request) {
  try {
    const { identifier, password } = await req.json();
    if (!identifier || !password) {
      return NextResponse.json({ error: "Identifier + password required" }, { status: 400 });
    }
    const isEmail = String(identifier).includes("@");
    const id = isEmail
      ? String(identifier).trim().toLowerCase()
      : normalizePhone(String(identifier));
    const q = isEmail
      ? `email=eq.${encodeURIComponent(id!)}`
      : `phone=eq.${encodeURIComponent(id!)}`;
    const rows = await sbSelect<any>("onboarding_users", `${q}&limit=1`);
    const u = rows[0];
    if (!u || !u.password_hash) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

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
      user: {
        id: u.id, email: u.email, phone: u.phone, name: u.name, role: u.role,
        emailVerified: !!u.email_verified, phoneVerified: !!u.phone_verified,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "login failed" }, { status: 500 });
  }
}

function normalizePhone(p: string): string {
  const d = p.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return d;
}
