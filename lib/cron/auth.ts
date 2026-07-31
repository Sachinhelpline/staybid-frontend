// ─────────────────────────────────────────────────────────────────────────
// Shared cron authorization (hotfix v621 — fail closed).
//
// Every app/api/cron/* route authorizes ONLY with the exact configured
// CRON_SECRET, supplied as `?token=<CRON_SECRET>` or `Authorization: Bearer
// <CRON_SECRET>`. The previous public "staybid-cron-dev" fallback and the
// unset CRON_TOKEN default are REMOVED — there is no default credential.
//
//   • CRON_SECRET missing   → 503 cron_auth_unconfigured (reject before any work)
//   • wrong / absent / fake  → 401 unauthorized
//   • exact CRON_SECRET      → authorized
//
// The `adm_` x-admin-token bypass is gone (never re-add it here).
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function isCronAuthorized(req: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 503, error: "cron_auth_unconfigured" };
  const url = new URL(req.url);
  const qToken = url.searchParams.get("token") || "";
  const bearer = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  if (qToken === secret || bearer === secret || headerSecret === secret) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

// Returns a short-circuit NextResponse when NOT authorized (call at the very
// top of every cron handler, before any side effect), or null when authorized.
export function cronAuthGuard(req: Request): NextResponse | null {
  const r = isCronAuthorized(req);
  if (r.ok) return null;
  return NextResponse.json({ error: r.error }, { status: r.status });
}
