import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { logAdminAction } from "@/lib/admin/audit";

// Admin session verification — Gmail/Railway ONLY (hotfix v621 security).
//
// Admins sign in with Google at /auth, which returns a Railway HS256 access
// JWT (sb_token). The admin-login page sends that token here as
// `Authorization: Bearer <sb_token>`; this route verifies the signature and
// re-checks the subject's role in the database via the shared
// requireVerifiedAdmin gate, allowing ONLY admin/super_admin, then returns the
// verified identity. On success the client stores the SAME verified token as
// sb_admin_token.
//
// The legacy phone + Master-PIN login is REMOVED. This route:
//   • trusts NO client-supplied phone, email, user id, or role;
//   • has NO PIN comparison and NO token-issuance path — supplying a phone/pin
//     (even the retired public value) can NEVER mint an admin token;
//   • fails closed for a missing / malformed / forged / expired / Firebase-only
//     (RS256) / customer / non-admin token → 401.
export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Admin access requires a verified Google admin session. Sign in with an admin Google account.",
      },
      { status: 401 },
    );
  }

  // Best-effort audit of the verified admin sign-in (never blocks the response).
  try {
    logAdminAction({
      admin: auditIdentity(admin),
      action: "admin.session.verify",
      targetType: "admin_session",
      targetId: admin.id,
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    role: admin.role,
    user: {
      id: admin.id,
      phone: admin.phone,
      name: admin.name,
      role: admin.role,
    },
  });
}
