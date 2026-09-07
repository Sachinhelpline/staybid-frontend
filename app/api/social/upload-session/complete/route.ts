// POST /api/social/upload-session/complete — SEC-00B-P1H-2 DORMANT completion gate.
//
// A customer signals "my upload finished". The server INDEPENDENTLY observes the
// exact private quarantine object's metadata and passes ONLY those trusted
// server-observed values into the already-accepted P1H-1 DB observation gate
// (public.confirm_media_upload_quarantine_observation). DORMANT: fail-closed behind
// MEDIA_UPLOAD_OBSERVATION_ENABLED; no production writer calls it; NO file bytes,
// NO download, NO magic-byte sniff, NO malware scan, NO READY.
//
// Auth authority is the SAME strict customer-domain MEDIA gate the upload-session
// route uses — `resolveVerifiedMediaCustomer` (lib/auth/media-customer-authority.ts):
// HS256 + EXACT JWT_ACCESS_SECRET only, mandatory `sub`, id===sub when present, no
// user_id/JWT_SECRET/Firebase fallback, admin/super_admin rejected, PLUS a fresh
// Railway customer proof. The customer NEVER sends the owner id — it comes only from
// the verified authority. The request body is sessionId-only.
import {
  resolveVerifiedMediaCustomer,
  createMediaCustomerAuthority,
} from "@/lib/auth/media-customer-authority";
import { runUploadCompletion } from "@/lib/social/upload-completion";
import { createUploadObservationStore } from "@/lib/social/upload-observation-store";

export const runtime = "nodejs"; // service-role key + JWT secret are server-only; never edge
export const dynamic = "force-dynamic";

// Built once per server instance; reads JWT_ACCESS_SECRET + the backend base.
const mediaAuthority = createMediaCustomerAuthority();

export async function POST(req: Request): Promise<Response> {
  return runUploadCompletion(req, {
    verify: (r) => resolveVerifiedMediaCustomer(r, mediaAuthority),
    store: createUploadObservationStore(),
    env: process.env,
  });
}
