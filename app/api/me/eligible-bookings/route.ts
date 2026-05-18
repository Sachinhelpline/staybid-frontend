// GET /api/me/eligible-bookings
// Returns the customer's bookings that qualify them for a Verified Guest
// content upload (CHECKED_OUT in last 90 days). Used by the Phase 4
// upgrade-choice screen's "Pick a booking" picker.
//
// Auth: any signed-in customer.
import { NextResponse } from "next/server";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { listEligibleBookings } from "@/lib/tier/eligibility";

export async function GET(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await listEligibleBookings(user.id, user.phone);
  return NextResponse.json({ bookings: rows });
}
