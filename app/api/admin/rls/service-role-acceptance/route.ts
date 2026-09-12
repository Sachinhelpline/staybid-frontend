// CP-01-PRE-RA-01 — Exact Service-Role Acceptance Probe route.
//
// POST /api/admin/rls/service-role-acceptance
//
// Order of gates (fail-closed):
//   1. requireVerifiedAdmin(req) — verified admin FIRST. Non-admin /
//      unauthenticated callers never reach the probe sender.
//   2. readServiceRoleKey() local trusted-credential precheck — a missing /
//      empty / whitespace-only service-role config produces ZERO probe
//      requests and the generic unauthorized response.
//   3. Only then does the dedicated probe sender execute (exactly one
//      outbound RPC to the hard-coded probe function).
//
// This route does NOT use the CP-01-PRE-TS-01 adminRlsRpc() sender and NEVER
// invokes any of the six Admin-RLS RPCs. It reads no request body, writes no
// audit/business/application data, and echoes no secret/header/upstream body.
import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { readServiceRoleKey } from "@/lib/admin/admin-rls-service-role";
import { probeServiceRoleAcceptance } from "@/lib/admin/service-role-acceptance";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  // 1. Verified-admin gate first.
  const admin = await requireVerifiedAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  // 2. Local trusted-credential precheck (after admin gate). Missing / empty /
  //    whitespace-only service-role config → generic unauthorized, ZERO probe.
  //    Uses the same generic response as a failed admin gate so the failing
  //    internal condition is not revealed.
  if (!readServiceRoleKey()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  // 3. Both gates passed → run the single probe.
  const result = await probeServiceRoleAcceptance();
  const status = result === "accepted" ? 200 : result === "rejected" ? 403 : 503;
  return NextResponse.json({ status: result }, { status, headers: NO_STORE });
}
