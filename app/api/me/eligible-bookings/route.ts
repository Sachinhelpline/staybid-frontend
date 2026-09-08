// GET /api/me/eligible-bookings
// Returns the customer's bookings that qualify them for a Verified Guest
// content upload (recent or current stay in the last 90 days). Used by the
// Phase 4 upgrade-choice screen's "Pick a booking" picker.
//
// Auth (SEC-00B authority-boundary remediation): this endpoint DISCLOSES which
// bookings a caller owns, so it resolves identity from the SAME strict,
// cryptographically-verified media authority as the Verified Guest upload gate
// (`resolveVerifiedMediaCustomer`). The picker and the upload gate therefore use
// EQUIVALENT verified identity — a forged / unsigned / tampered token can never
// choose an id/email/phone to enumerate another customer's bookings, and the
// picker can never show a stay the upload gate would then reject. Email / phone
// twins come from the SAME verified token (never a decode-only claim or an
// x-email / x-phone hint header).
import { NextResponse } from "next/server";
import {
  resolveVerifiedMediaCustomer,
  resolveVerifiedMediaIdentity,
  createMediaCustomerAuthority,
} from "@/lib/auth/media-customer-authority";
import { listEligibleBookings } from "@/lib/tier/eligibility";

export const runtime = "nodejs"; // JWT verify (jsonwebtoken) is server-only; never edge
export const dynamic = "force-dynamic";

// Built once per server instance; reads JWT_ACCESS_SECRET + the backend base.
const mediaAuthority = createMediaCustomerAuthority();

export async function GET(req: Request) {
  const verified = await resolveVerifiedMediaCustomer(req, mediaAuthority);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const identity = resolveVerifiedMediaIdentity(req, mediaAuthority.secret);
  const rows = await listEligibleBookings(
    verified.id,
    identity?.phone ?? null,
    identity?.email ?? null
  );
  return NextResponse.json({ bookings: rows });
}
