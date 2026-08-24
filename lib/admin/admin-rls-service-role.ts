// CP-01-PRE-TS-01 — Admin-RLS service-role fail-closed caller boundary.
//
// SERVER-ONLY. This helper is the ONLY authorization path the Admin-RLS
// route (`app/api/admin/rls/route.ts`) may use to invoke the six
// SECURITY DEFINER RPCs:
//   admin_list_rls · admin_set_rls · admin_add_permissive_policy ·
//   admin_lockdown_table · admin_apply_policy_template · admin_drop_policy
//
// Why this exists (fail-closed boundary):
//   The shared `SB_H` header set derives its `Authorization: Bearer` from
//   `SB_ADMIN_KEY = SERVICE_ROLE_KEY || SB_KEY` — i.e. it SILENTLY falls back
//   to the public anon key when `SUPABASE_SERVICE_ROLE_KEY` is missing (and a
//   whitespace-only value slips past the plain truthiness check). For the
//   Admin-RLS RPCs that fallback is unacceptable: a missing/empty/whitespace
//   service-role configuration must FAIL CLOSED, never degrade to an anon or
//   requester-supplied identity.
//
// Invariants enforced here:
//   • Missing / empty / whitespace-only service-role config → fail closed
//     BEFORE any outbound RPC fetch (no request is issued at all).
//   • The non-empty service-role value is the ONLY `Authorization: Bearer`
//     identity. The public/project key may sit in the `apikey` header
//     (PostgREST requires a public key there) but is NEVER placed into
//     `Authorization`.
//   • The requester's own Authorization header is never forwarded as the
//     Supabase RPC identity (this helper never receives the request).
//   • On an upstream rejection (e.g. 401/403) the single fetch result is
//     returned as-is: NO retry, NO anon/public fallback, NO alternate
//     authorization path.
//   • Secret values are never logged, exposed, or returned to any caller
//     response — only used inline to construct the outbound request headers.
//
// This module does NOT modify or depend on the generic `SB_H` behavior.

import { SB_URL, SB_KEY } from "@/lib/sb";

// Server-only guard: this module must never be pulled into a client bundle.
if (typeof window !== "undefined") {
  throw new Error("admin-rls-service-role is server-only");
}

// The exact set of Admin-RLS RPCs this boundary governs.
export const ADMIN_RLS_RPC_NAMES = [
  "admin_list_rls",
  "admin_set_rls",
  "admin_add_permissive_policy",
  "admin_lockdown_table",
  "admin_apply_policy_template",
  "admin_drop_policy",
] as const;

export type AdminRlsRpcName = (typeof ADMIN_RLS_RPC_NAMES)[number];

// Resolve the service-role key from the server environment, rejecting
// missing / empty / whitespace-only configuration. Returns the trimmed,
// non-empty value, or null when unconfigured. No prevalidation of whether a
// non-empty credential is actually accepted upstream is performed.
export function readServiceRoleKey(): string | null {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function serviceRoleConfigured(): boolean {
  return readServiceRoleKey() !== null;
}

// Deterministic, testable header construction from synthetic inputs.
//   • `serviceRoleKey` — the privileged Bearer identity. Missing / empty /
//     whitespace-only → throws (fail closed); it is NEVER defaulted to the
//     public key.
//   • `apiKey` — the PUBLIC apikey slot value (legacy anon / publishable).
//     Used ONLY for the `apikey` header, NEVER for `Authorization`.
export function buildAdminRlsHeaders(opts: {
  serviceRoleKey: string;
  apiKey: string;
}): Record<string, string> {
  const serviceRoleKey =
    typeof opts.serviceRoleKey === "string" ? opts.serviceRoleKey.trim() : "";
  if (!serviceRoleKey) {
    // Fail closed — no anon/public substitution into the privileged identity.
    throw new Error("admin_rls_service_role_unconfigured");
  }
  const apiKey = typeof opts.apiKey === "string" ? opts.apiKey : "";
  return {
    // PUBLIC key slot only (PostgREST validates a public key here).
    apikey: apiKey,
    // Privileged identity — the service-role value and nothing else.
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export type AdminRlsRpcResult = {
  ok: boolean;
  status: number;
  json: any;
  // Set only when the boundary fails closed BEFORE any outbound request.
  failClosed?: boolean;
};

// The single protected RPC sender the Admin-RLS route must use for every one
// of the six RPCs. Fails closed before any network activity when the
// service-role configuration is missing/empty/whitespace; otherwise issues
// exactly one fetch with the service-role Bearer identity and returns its
// result verbatim (no retry, no alternate credential).
export async function adminRlsRpc(
  name: string,
  args: Record<string, any>,
): Promise<AdminRlsRpcResult> {
  const serviceRoleKey = readServiceRoleKey();
  if (!serviceRoleKey) {
    // FAIL CLOSED: no outbound RPC request is made at all.
    return {
      ok: false,
      status: 503,
      failClosed: true,
      json: { error: "service_role_unconfigured" },
    };
  }
  const headers = buildAdminRlsHeaders({ serviceRoleKey, apiKey: SB_KEY });
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const json = await res.json().catch(() => ({}));
  // Single result returned as-is — an upstream 401/403 does NOT trigger a
  // retry or a fallback to any other credential.
  return { ok: res.ok, status: res.status, json };
}
