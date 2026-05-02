import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

// Default master PIN — override by setting ADMIN_MASTER_PIN env var on Vercel.
const DEFAULT_MASTER_PIN = "StayBidAdmin@2026";

// POST { phone, pin? }
//
// MODE 1 (master-PIN login — preferred, OTP-free):
//   If `pin` is provided AND matches ADMIN_MASTER_PIN env var (or the
//   hardcoded default "StayBidAdmin@2026"), AND the phone resolves to a
//   user in Supabase with role admin/super_admin → returns ok + a session
//   token. No WhatsApp / Railway OTP needed.
//
// MODE 2 (role check only — used by old OTP flow as a guard):
//   If `pin` is omitted, just verifies that the phone matches an admin
//   in Supabase. Use this AFTER another auth step has already succeeded.
export async function POST(req: NextRequest) {
  try {
    const { phone, pin } = await req.json();
    if (!phone) {
      return NextResponse.json({ ok: false, error: "Phone number is required" }, { status: 400 });
    }

    // Phone normalization — support both with and without +91
    const norm = String(phone).replace(/\D/g, "").slice(-10);
    if (norm.length !== 10) {
      return NextResponse.json({ ok: false, error: "Enter a valid 10-digit phone number" }, { status: 400 });
    }
    const variants = [`+91${norm}`, norm];
    const inList = variants.map((v) => `"${v}"`).join(",");

    // 1. Look up user in Supabase
    const url = `${SB_URL}/rest/v1/users?select=id,phone,name,email,role&phone=in.(${encodeURIComponent(inList)})`;
    const sbRes = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const rows = (await sbRes.json().catch(() => [])) as any[];

    // Pick the row with the highest role
    const order: Record<string, number> = { super_admin: 3, admin: 2, agent: 1, customer: 0 };
    const best = (Array.isArray(rows) ? rows : []).sort(
      (a, b) => (order[b?.role] ?? -1) - (order[a?.role] ?? -1)
    )[0];

    if (!best) {
      return NextResponse.json({
        ok: false,
        error: `No user found in Supabase for +91${norm}. Are you sure the phone is correct?`,
      });
    }

    const isAdmin = best.role === "admin" || best.role === "super_admin";
    if (!isAdmin) {
      return NextResponse.json({
        ok: false,
        error: `Access denied. Your role is "${best.role || "customer"}". Run in Supabase: UPDATE users SET role='super_admin' WHERE phone='${best.phone}';`,
      });
    }

    // 2. If MODE 1 (master PIN supplied), verify it
    if (pin !== undefined) {
      const expected = process.env.ADMIN_MASTER_PIN || DEFAULT_MASTER_PIN;
      if (String(pin) !== expected) {
        return NextResponse.json({
          ok: false,
          error: "Wrong master PIN. Contact platform owner.",
        });
      }
      // Issue an opaque admin session token (random nonce — admin API
      // routes query Supabase directly, so they don't need a verifiable JWT)
      const token = `adm_${crypto.randomBytes(24).toString("hex")}`;
      return NextResponse.json({
        ok: true,
        role: best.role,
        user: best,
        token,
      });
    }

    // MODE 2 — role check only (no token issued, used as guard after OTP)
    return NextResponse.json({
      ok: true,
      role: best.role,
      user: best,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
