"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — Verified Guest picker + AUTHORITY-BOUNDARY remediation.
// Source-scan regression test (no network, no DB). It guards the PRODUCT/UX
// contract + the shape of the authority wiring. The CRYPTO authority proof is
// behavioral (tests/social/verified-guest-authority.test.js).
//
// Contract guarded here:
//   1. Authority binding: the Verified Guest upload gate AND the eligible-bookings
//      picker resolve identity from the STRICT, cryptographically-verified media
//      authority (resolveVerifiedMediaCustomer) — never socialUserFromReq /
//      decode-only claims / x-email hint headers. Ownership resolves from the
//      VERIFIED id (+ verified email/phone twins). Picker ⇄ upload gate therefore
//      use equivalent verified identity.
//   2. Wildcard containment: resolveUserIds escapes the email ilike axis
//      (escapeLikeLiteral) so `_` / `%` / `*` cannot widen ownership.
//   3. Empty-state navigation: primary CTA is /bookings; /hotels is only a
//      secondary "book a new stay" path.
//   4. Copy alignment: no stale "checked out only / completed stays" framing;
//      current/ongoing stays represented honestly.
//   5. No weakening: the eligibility RULE (statuses + date window) is unchanged;
//      the strict media authority still rejects admin/super_admin.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL " + name); }
}

// ── files under test ──────────────────────────────────────────────────────────
const eligibility = read("lib/tier/eligibility.ts");
const pickerRoute = read("app/api/me/eligible-bookings/route.ts");
const uploadGate = read("app/api/social/posts/verified-guest/route.ts");
const sheet = read("components/tier/UpgradeChoiceSheet.tsx");
const uploadSession = read("app/api/social/upload-session/route.ts");
const sbServer = read("lib/sb-server.ts");
const mediaAuth = read("lib/auth/media-customer-authority.ts");

// ── 1. Authority binding — verified, not decode-only ──────────────────────────
// The upload gate no longer trusts socialUserFromReq for ownership.
ok(!/socialUserFromReq/.test(uploadGate),
  "verified-guest upload gate no longer uses decode-only socialUserFromReq");
ok(/resolveVerifiedMediaCustomer/.test(uploadGate),
  "verified-guest upload gate uses the strict resolveVerifiedMediaCustomer authority");
ok(/hasEligibleBookingForHotel\(\s*verified\.id,\s*vPhone,\s*body\.hotelId,\s*body\.bookingId,\s*vEmail\s*\)/.test(uploadGate),
  "upload gate resolves ownership from the VERIFIED id + verified email/phone twins");
ok(/resolveVerifiedMediaIdentity\(req,\s*mediaAuthority\.secret\)/.test(uploadGate),
  "upload gate takes email/phone twins from the SAME verified token (resolveVerifiedMediaIdentity)");

// The picker no longer trusts socialUserFromReq / x-email; it uses the SAME authority.
ok(!/socialUserFromReq/.test(pickerRoute),
  "eligible-bookings picker no longer uses decode-only socialUserFromReq");
ok(/resolveVerifiedMediaCustomer/.test(pickerRoute),
  "eligible-bookings picker uses the strict resolveVerifiedMediaCustomer authority (picker⇄gate parity)");
ok(/listEligibleBookings\(\s*verified\.id,\s*identity\?\.phone \?\? null,\s*identity\?\.email \?\? null\s*\)/.test(pickerRoute),
  "picker resolves from the VERIFIED id + verified email/phone twins");
ok(!/headers\.get\(\s*["']x-(email|phone)/i.test(pickerRoute) && !/req\.headers\.get\(["']x-/.test(pickerRoute),
  "picker does not READ x-email / x-phone hint headers as ownership input");

// The verified identity extractor exists in the locked media authority module.
ok(/export function verifyMediaCustomerIdentity\(/.test(mediaAuth),
  "media authority exports verifyMediaCustomerIdentity (verified email/phone claims)");
ok(/export function resolveVerifiedMediaIdentity\(/.test(mediaAuth),
  "media authority exports resolveVerifiedMediaIdentity (request-level verified claims)");
// It must stay HS256 + exact secret only (no RS256 / JWT_SECRET fallback added).
{
  const code = mediaAuth.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  ok(!/JWT_SECRET\b/.test(code.replace(/JWT_ACCESS_SECRET/g, "")),
    "media authority code references NO JWT_SECRET fallback");
  ok(!/RS256/.test(code), "media authority code has no RS256 path");
}

// ── 2. Wildcard containment — escapeLikeLiteral on the email ilike axis ───────
ok(/export function escapeLikeLiteral\(/.test(sbServer),
  "resolveUserIds exposes escapeLikeLiteral (email ilike wildcard neutralizer)");
ok(/const literal = escapeLikeLiteral\(email\);/.test(sbServer) &&
   /email=ilike\.\$\{encodeURIComponent\(literal\)\}/.test(sbServer),
  "resolveUserIds escapes the email BEFORE the ilike filter (no raw wildcard email)");
ok(/value\.includes\("\*"\)/.test(sbServer) && /replace\(\/\[\\\\%_\]\/g/.test(sbServer),
  "escapeLikeLiteral drops the PostgREST `*` wildcard and escapes SQL LIKE `\\ % _`");
// The eligibility caller still sanitizes (defence in depth) + threads the email.
ok(/const safeEmail =/.test(eligibility) &&
   /resolveUserIds\(\s*primaryUserId,\s*phone \?\? undefined,\s*safeEmail\s*\)/.test(eligibility),
  "eligibility still sanitizes + threads the email into resolveUserIds (defence in depth)");

// ── 3. Empty-state navigation — /bookings primary, /hotels secondary ──────────
ok(/href="\/bookings"/.test(sheet), "picker empty-state links to /bookings");
ok(/View my bookings/.test(sheet), "picker primary CTA copy = View my bookings");
ok(/href="\/hotels"[\s\S]*?Book a new stay/.test(sheet),
  "/hotels is present only as the secondary 'Book a new stay' CTA");
ok(sheet.indexOf('href="/bookings"') < sheet.indexOf('href="/hotels"'),
  "/bookings CTA precedes /hotels CTA (primary vs secondary order)");
ok(!/Browse hotels/.test(sheet), "stale 'Browse hotels' primary CTA removed");

// ── 4. Copy alignment — no 'checked out only / completed stays' framing ───────
ok(!/No completed stays in the last 90 days/.test(sheet),
  "stale 'No completed stays' empty-state copy removed");
ok(/recent or current StayBid stay/i.test(sheet),
  "copy now says 'recent or current StayBid stay'");
ok(/Current stay · ends/.test(sheet),
  "row label is ongoing-aware (Current stay for a future checkOut)");
ok(/kind:\s*"verified_guest",\s*hotelId:\s*b\.hotelId,\s*bookingId:\s*b\.id/.test(sheet),
  "picker selection preserves bookingId + hotelId in verified_guest context");
ok(/api\.getEligibleBookings\(\)/.test(sheet),
  "picker still fetches the authoritative /api/me/eligible-bookings");

// ── 5. No weakening — eligibility rule + admin rejection intact ───────────────
ok(/BOOKING_OK_STATUSES = \["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"\]/.test(eligibility),
  "booking eligibility statuses UNCHANGED (trustworthy direct-booking authority)");
// SEC-00B fail-closed (requirement F): a bid grants Verified-Guest proof ONLY
// via CHECKED_IN/CHECKED_OUT — the forgeable payment markers (client-stamped
// message / unauthenticated /api/bid/paid ledger) are no longer accepted, so
// ACCEPTED is intentionally REMOVED from the bid eligibility statuses.
ok(/BID_OK_STATUSES = \["CHECKED_IN", "CHECKED_OUT"\]/.test(eligibility),
  "bid eligibility fail-closed to CHECKED_IN/CHECKED_OUT (ACCEPTED removed — SEC-00B)");
ok(!/rest\/v1\/bid_paid_amounts/.test(eligibility),
  "eligibility never FETCHES the forgeable bid_paid_amounts ledger (comments explaining why may mention it)");
ok(/checkIn=lte\./.test(eligibility) && /checkOut=gte\./.test(eligibility),
  "date window (checkIn<=now, checkOut>=since) UNCHANGED — ongoing stays still pass");
ok(!/checkOut=lt\./.test(eligibility),
  "no 'checkOut < now' filter re-introduced (ongoing stays not excluded)");
ok(/resolveVerifiedMediaCustomer/.test(uploadSession),
  "upload-session still uses the strict media authority (admin/super_admin rejected)");

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\nverified-guest-picker: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
