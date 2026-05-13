// v104.4 — admin-only diagnostic for SUPABASE_SERVICE_ROLE_KEY env var.
//
// Returns a MASKED view of what Vercel actually injected at module load,
// plus a fingerprint of the headers our SB_H helper composes for outbound
// PostgREST calls. Lets us diagnose env-var typos / wrong key / mid-build
// caching without ever leaking the full secret.
//
// Auth: same admin gate as /api/admin/rls. Anon callers get 401.
import { NextResponse } from "next/server";
import { SB_KEY, SB_ADMIN_KEY, SB_H, hasServiceRole } from "@/lib/sb";
import { adminFromReq } from "@/lib/admin/audit";

function mask(s: string | null | undefined): { len: number; prefix: string; suffix: string; isJwt: boolean } {
  if (!s) return { len: 0, prefix: "", suffix: "", isJwt: false };
  const str = String(s);
  return {
    len: str.length,
    prefix: str.slice(0, 12),
    suffix: str.slice(-6),
    isJwt: str.startsWith("eyJ") && str.split(".").length === 3,
  };
}

export async function GET(req: Request) {
  const admin = adminFromReq(req);
  if (!admin?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    envVarPresent:   hasServiceRole(),
    envVarMasked:    mask(process.env.SUPABASE_SERVICE_ROLE_KEY || null),
    sbKeyMasked:     mask(SB_KEY),                      // should always be legacy anon JWT
    sbAdminKeyMasked: mask(SB_ADMIN_KEY),               // env-var-driven
    headersSentToSupabase: {
      apikey:        mask(SB_H.apikey),
      authorization: mask((SB_H.Authorization || "").replace(/^Bearer\s+/i, "")),
    },
  });
}
