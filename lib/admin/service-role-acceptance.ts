// CP-01-PRE-RA-01 — Exact Service-Role Acceptance Probe (server helper).
//
// SERVER-ONLY. Confirms whether the configured SUPABASE_SERVICE_ROLE_KEY is
// actually accepted by Supabase AS the service_role, by calling exactly one
// isolated, side-effect-free probe function
// (`public.cp01_service_role_acceptance_probe`, migration source in
// staybid-Live). It:
//   • uses the trimmed SUPABASE_SERVICE_ROLE_KEY as the SOLE Authorization
//     Bearer identity (reusing the CP-01-PRE-TS-01 readServiceRoleKey());
//   • hard-codes the probe function name — never caller-controlled;
//   • issues exactly ONE outbound RPC, no retry, no alternate credential;
//   • is bounded by an ~5s timeout;
//   • returns ONLY a normalized result ("accepted" | "rejected" |
//     "inconclusive") — never the service-role key, the Authorization value,
//     the apikey, the role name, or the upstream response body.
//
// It does NOT modify or depend on the generic SB_H behavior, and does NOT use
// the CP-01-PRE-TS-01 adminRlsRpc() sender.

import { SB_URL, SB_KEY } from "@/lib/sb";
import { readServiceRoleKey } from "@/lib/admin/admin-rls-service-role";

// Server-only guard: never bundle into a client.
if (typeof window !== "undefined") {
  throw new Error("service-role-acceptance is server-only");
}

// Hard-coded probe function name. There is NO caller-controlled RPC/function
// name in this module.
const PROBE_FN = "cp01_service_role_acceptance_probe";

// Bounded timeout for the single probe request.
const PROBE_TIMEOUT_MS = 5000;

export type ServiceRoleAcceptance = "accepted" | "rejected" | "inconclusive";

// Performs the single service-role acceptance probe. Fails closed with ZERO
// outbound request when the service-role configuration is missing / empty /
// whitespace-only (defense-in-depth; the route also pre-checks this).
export async function probeServiceRoleAcceptance(): Promise<ServiceRoleAcceptance> {
  const serviceRoleKey = readServiceRoleKey();
  if (!serviceRoleKey) {
    // No trusted credential → make no request at all.
    return "inconclusive";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${SB_URL}/rest/v1/rpc/${PROBE_FN}`, {
      method: "POST",
      headers: {
        // Public gateway apikey ONLY — never the Authorization identity.
        apikey: typeof SB_KEY === "string" ? SB_KEY : "",
        // The service-role value is the SOLE Authorization identity.
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    // Timeout / abort / transport / network failure — no retry, no alternate
    // credential. Inconclusive (no upstream detail exposed).
    return "inconclusive";
  } finally {
    clearTimeout(timer);
  }

  // A clear upstream authentication/permission rejection.
  if (res.status === 401 || res.status === 403) return "rejected";
  // Function/schema not yet present (or schema cache) → cannot conclude.
  if (res.status === 404) return "inconclusive";
  // Upstream server error → cannot conclude.
  if (res.status >= 500) return "inconclusive";
  // Any other non-2xx (e.g. 400/406) → unexpected → cannot conclude.
  if (!res.ok) return "inconclusive";

  // 2xx: the scalar-returning probe yields a raw JSON boolean.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Malformed / unreadable body → cannot conclude.
    return "inconclusive";
  }
  if (body === true) return "accepted";
  if (body === false) return "rejected";
  // Unexpected shape → cannot conclude.
  return "inconclusive";
}
