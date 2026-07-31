// ─────────────────────────────────────────────────────────────────────────
// Shared cron authorization (hotfix v621 — fail closed, Bearer-only).
//
// Every app/api/cron/* route authorizes ONLY with the exact configured
// CRON_SECRET, supplied in the `Authorization: Bearer <CRON_SECRET>` header.
// A secret must NEVER travel in a URL: query-string (`?token=`) authorization
// is REMOVED — request URLs are logged by proxies, the Vercel/CDN edge, and
// browser history, so a token in the query is a credential leak. The
// `x-cron-secret` header transport is also removed (no internal caller sent
// it). Vercel-managed crons authenticate automatically by sending
// `Authorization: Bearer <CRON_SECRET>`; external schedulers (cron-job.org)
// must be configured with a custom `Authorization: Bearer <CRON_SECRET>`
// header. The previous public "staybid-cron-dev" fallback and the unset
// CRON_TOKEN default are REMOVED — there is no default credential.
//
//   • CRON_SECRET missing        → 503 cron_auth_unconfigured (reject before any work)
//   • wrong / absent / fake      → 401 unauthorized
//   • token only in the URL      → 401 unauthorized (query transport is gone)
//   • exact Bearer <CRON_SECRET> → authorized
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
  const bearer = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (bearer === secret) return { ok: true };
  return { ok: false, status: 401, error: "unauthorized" };
}

// Returns a short-circuit NextResponse when NOT authorized (call at the very
// top of every cron handler, before any side effect), or null when authorized.
export function cronAuthGuard(req: Request): NextResponse | null {
  const r = isCronAuthorized(req);
  if (r.ok) return null;
  return NextResponse.json({ error: r.error }, { status: r.status });
}
