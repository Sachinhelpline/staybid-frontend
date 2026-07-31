// Resolve "is this caller authorized to act as a support agent?"
//
// Allowed roles: admin, super_admin, support_agent.
//
// hotfix v621: this helper NO LONGER independently converts unverified headers
// or opaque strings into an identity. The legacy `adm_`-presence and header-only
// `x-admin-id` trust paths, and the decode-only JWT path, are REMOVED. Identity
// is derived ONLY from cryptographically verified tokens:
//   1. `requireVerifiedAdmin` (signature-verified Railway HS256 token +
//      server-side role lookup) → admin / super_admin.
//   2. A signature-verified customer-family HS256 token whose server-side DB
//      role is `support_agent`.

import { SB_URL, SB_H } from "@/lib/sb-server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { verifiedCustomerFromReq } from "@/lib/auth/customer-verify";
import type { AgentIdentity } from "./types";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "support_agent"]);

export async function agentFromReq(req: Request): Promise<AgentIdentity | null> {
  // 1. Verified admin / super_admin.
  const admin = await requireVerifiedAdmin(req);
  if (admin) {
    return {
      id: admin.id,
      role: admin.role as AgentIdentity["role"],
      name: admin.name,
      phone: admin.phone,
    };
  }

  // 2. Verified (HS256) token whose DB role is an allowed support role.
  const caller = verifiedCustomerFromReq(req);
  if (caller) {
    const dbRole = await fetchUserRole(caller.id);
    if (ALLOWED_ROLES.has(dbRole)) {
      return {
        id: caller.id,
        role: dbRole as AgentIdentity["role"],
        name: null,
        phone: caller.phone ?? null,
      };
    }
  }

  return null;
}

async function fetchUserRole(userId: string): Promise<string> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=role`,
      { headers: SB_H }
    );
    if (!r.ok) return "";
    const rows = await r.json();
    return String(rows?.[0]?.role || "").toLowerCase();
  } catch {
    return "";
  }
}
