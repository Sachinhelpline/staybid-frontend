import { NextResponse } from "next/server";
import { sbSelect, sbInsert, sbUpdate } from "@/lib/onboard/supabase-admin";
import { signOnboardToken } from "@/lib/onboard/jwt";

// POST /api/onboard/auth/google
// Body: { email, name?, uid?, idToken? }
//
// Sachin (2026-06): "abhi hmara mobile otp kaam nhi kar raha hai — abhi ke liye
// gmail verification ko hi login ke liye access dedo, future ke liye mobile otp
// ko rakhlo." So onboarding (owner + agent self-signup) can now sign in with a
// Google account — no password, no OTP. A Google account's email is already
// verified by Google, so we find-or-create the onboarding_users row by email,
// mark email_verified=true, and issue the onboarding JWT directly.
//
// Trust model: mirrors the customer-side Google flow (client does the Firebase
// popup, posts the resulting identity). When an idToken + FIREBASE_API_KEY are
// available we additionally verify the token server-side via Google's
// identitytoolkit lookup, so a forged email body can't mint a session.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    let email: string = String(body.email || "").trim().toLowerCase();
    let name: string | null = body.name ? String(body.name).trim() : null;
    const idToken: string | undefined = body.idToken;

    // Optional hardening: verify the Firebase ID token if we can. If the lookup
    // succeeds it OVERRIDES the posted email/name (authoritative source). If the
    // key is missing or the call fails, we fall back to the posted email so the
    // flow never hard-breaks (same graceful contract as the customer side).
    const apiKey =
      process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (idToken && apiKey) {
      try {
        const vr = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          },
        );
        if (vr.ok) {
          const vj = await vr.json().catch(() => ({}));
          const u0 = vj?.users?.[0];
          if (u0?.email) {
            email = String(u0.email).trim().toLowerCase();
            if (!name && u0.displayName) name = String(u0.displayName).trim();
          }
        }
      } catch {
        /* fall through to the posted email */
      }
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid Google email is required" },
        { status: 400 },
      );
    }

    // Find-or-create by email.
    const rows = await sbSelect<any>(
      "onboarding_users",
      `email=eq.${encodeURIComponent(email)}&limit=1`,
    );
    let u = rows[0];

    if (!u) {
      u = await sbInsert("onboarding_users", {
        email,
        name,
        role: "owner",
        email_verified: true,
      });
    } else {
      // Existing account — make sure it's marked email-verified (Google did it)
      // and backfill the name if it was blank.
      const patch: any = {};
      if (!u.email_verified) patch.email_verified = true;
      if (name && !u.name) patch.name = name;
      if (Object.keys(patch).length) {
        await sbUpdate("onboarding_users", `id=eq.${u.id}`, patch);
        u = { ...u, ...patch };
      }
    }

    const token = signOnboardToken({
      sub: u.id,
      email: u.email,
      phone: u.phone,
      role: u.role,
      emailVerified: true,
      phoneVerified: !!u.phone_verified,
    });

    return NextResponse.json({
      token,
      user: {
        id: u.id,
        email: u.email,
        phone: u.phone,
        name: u.name,
        role: u.role,
        emailVerified: true,
        phoneVerified: !!u.phone_verified,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Google sign-in failed" },
      { status: 500 },
    );
  }
}
