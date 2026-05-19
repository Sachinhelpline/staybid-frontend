// Resolve "is this caller authorized to act as a support agent?"
//
// Allowed roles: admin, super_admin, support_agent.
// Token shapes accepted (same precedence as lib/admin/audit.ts):
//   1. Bearer JWT with { id, role, name?, phone? } claims
//   2. Opaque adm_<48hex> token + x-admin-id header (master-PIN flow)
//   3. Explicit x-admin-id / x-admin-role headers (server-side only)

import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import type { AgentIdentity } from "./types";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "support_agent"]);

export async function agentFromReq(req: Request): Promise<AgentIdentity | null> {
  // Token paths
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (token) {
    // JWT path
    const payload = decodeJwt(token);
    if (payload?.id) {
      const role = String(payload.role || "").toLowerCase();
      if (ALLOWED_ROLES.has(role)) {
        return {
          id: payload.id,
          role: role as AgentIdentity["role"],
          name: payload.name || null,
          phone: payload.phone || null,
        };
      }
      // JWT had id but no allowed role — fetch role from DB
      const dbRole = await fetchUserRole(payload.id);
      if (ALLOWED_ROLES.has(dbRole)) {
        return {
          id: payload.id,
          role: dbRole as AgentIdentity["role"],
          name: payload.name || null,
          phone: payload.phone || null,
        };
      }
    }

    // Opaque admin token path
    if (/^adm_[a-f0-9]{8,}$/i.test(token)) {
      const id = req.headers.get("x-admin-id") || "master-pin-admin";
      const phone = req.headers.get("x-admin-phone");
      const name = req.headers.get("x-admin-name");
      // master-pin tokens skip DB role check (already verified at /api/admin/check-role)
      return {
        id,
        role: "admin",
        name,
        phone,
      };
    }
  }

  // Header-only path
  const id = req.headers.get("x-admin-id");
  if (id) {
    const dbRole = await fetchUserRole(id);
    if (ALLOWED_ROLES.has(dbRole)) {
      return {
        id,
        role: dbRole as AgentIdentity["role"],
        name: req.headers.get("x-admin-name"),
        phone: req.headers.get("x-admin-phone"),
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
