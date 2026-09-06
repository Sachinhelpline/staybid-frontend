// POST /api/social/upload-session — SEC-00B-P1B DORMANT upload-session authority.
//
// Authorizes CREATED -> UPLOAD_AUTHORIZED for the server-owned media ingest and
// returns a STANDARD Supabase signed-upload token for a server-chosen private
// quarantine object key. DORMANT: fail-closed behind MEDIA_UPLOAD_SESSION_ENABLED,
// no production writer calls it, no file bytes pass through Next/Railway.
//
// SEC-00B-P1E-R1 — Auth authority is now the STRICT customer-domain MEDIA gate
// `resolveVerifiedMediaCustomer` (lib/auth/media-customer-authority.ts): HS256 +
// EXACT JWT_ACCESS_SECRET only, mandatory `sub`, id===sub when present, no
// user_id/JWT_SECRET/Firebase fallback, admin/super_admin rejected, PLUS a fresh
// Railway customer proof (exists / id===sub / not blocked / not admin). This
// REPLACES the generic `verifiedCustomerFromReq`, which stays intact for its other
// consumers but is too broad to be a media-ownership authority. No production
// writer may be cut over yet (still dormant + fresh-gate is a prerequisite).
import { randomUUID } from "node:crypto";
import {
  resolveVerifiedMediaCustomer,
  createMediaCustomerAuthority,
} from "@/lib/auth/media-customer-authority";
import { handleUploadSession } from "@/lib/social/upload-session";
import { createUploadSessionStore } from "@/lib/social/upload-session-store";

export const runtime = "nodejs"; // service-role key + JWT secret are server-only; never edge
export const dynamic = "force-dynamic";

// Built once per server instance; reads JWT_ACCESS_SECRET + the backend base.
const mediaAuthority = createMediaCustomerAuthority();

export async function POST(req: Request): Promise<Response> {
  return handleUploadSession(req, {
    verify: (r) => resolveVerifiedMediaCustomer(r, mediaAuthority),
    store: createUploadSessionStore(),
    env: process.env,
    now: () => new Date(),
    genId: () => randomUUID(),
  });
}
