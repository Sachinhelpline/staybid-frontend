// POST /api/social/upload-session — SEC-00B-P1B DORMANT upload-session authority.
//
// Authorizes CREATED -> UPLOAD_AUTHORIZED for the server-owned media ingest and
// returns a STANDARD Supabase signed-upload token for a server-chosen private
// quarantine object key. DORMANT: fail-closed behind MEDIA_UPLOAD_SESSION_ENABLED,
// no production writer calls it, no file bytes pass through Next/Railway.
//
// Auth authority = the CRYPTOGRAPHIC HS256 verifier `verifiedCustomerFromReq`
// (NOT the decode-only social/customer helpers). A Firebase RS256 token fails
// closed here (401) until a separately-reviewed Firebase compatibility boundary
// lands — so NO production writer may be cut over yet.
import { randomUUID } from "node:crypto";
import { verifiedCustomerFromReq } from "@/lib/auth/customer-verify";
import { handleUploadSession } from "@/lib/social/upload-session";
import { createUploadSessionStore } from "@/lib/social/upload-session-store";

export const runtime = "nodejs"; // service-role key is server-only; never edge
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleUploadSession(req, {
    verify: (r) => verifiedCustomerFromReq(r),
    store: createUploadSessionStore(),
    env: process.env,
    now: () => new Date(),
    genId: () => randomUUID(),
  });
}
