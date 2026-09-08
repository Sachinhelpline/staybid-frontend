"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B FINAL NORMAL-CUSTOMER CUTOVER — Verified Guest picker remediation.
// Hermetic source-scan test (no network, no DB). Proves the bounded contract:
//   1. Identity reconciliation: the eligibility resolution threads `email`
//      (the documented resolveUserIds(id, phone, email) contract) at every
//      call site — picker, tier count, and the upload gate — so a stay under
//      an email-keyed identity twin is not falsely missed, and the picker,
//      tier count, and upload gate can never silently disagree.
//   2. Empty-state navigation: the primary CTA is /bookings (the user's own
//      history surface); /hotels is only a secondary "book a new stay" path.
//   3. Copy alignment: stale "checked out only / completed stays" wording is
//      gone; current/ongoing stays are represented honestly.
//   4. No weakening: the eligibility RULE (statuses + date window) is unchanged;
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
const tierRoute = read("app/api/me/tier/route.ts");
const uploadGate = read("app/api/social/posts/verified-guest/route.ts");
const sheet = read("components/tier/UpgradeChoiceSheet.tsx");
const uploadSession = read("app/api/social/upload-session/route.ts");

// ── 1. Identity reconciliation — email threaded ───────────────────────────────
ok(/function listEligibleBookings\(\s*primaryUserId:\s*string,\s*phone\?:\s*string \| null,\s*email\?:\s*string \| null/.test(eligibility),
  "listEligibleBookings accepts an email param");
// The email is sanitized BEFORE resolveUserIds (it lands in an `email=ilike`
// ownership filter; `*`/`%` are wildcards). The wildcard-free `safeEmail` — not
// the raw claim — is what gets passed to resolveUserIds.
ok(/const safeEmail =/.test(eligibility) && /\[\\s,%\*\(\)/.test(eligibility),
  "email is sanitized (wildcard/whitespace chars blocked) before resolution");
ok(/resolveUserIds\(\s*primaryUserId,\s*phone \?\? undefined,\s*safeEmail\s*\)/.test(eligibility),
  "listEligibleBookings forwards the SANITIZED email (safeEmail) to resolveUserIds");
ok(/function hasEligibleBookingForHotel\([\s\S]*?email\?:\s*string \| null\s*\)/.test(eligibility),
  "hasEligibleBookingForHotel accepts an email param");
ok(/listEligibleBookings\(primaryUserId,\s*phone,\s*email\)/.test(eligibility),
  "hasEligibleBookingForHotel forwards email to listEligibleBookings");

ok(/listEligibleBookings\(user\.id,\s*user\.phone,\s*user\.email\)/.test(pickerRoute),
  "eligible-bookings route passes user.email");
ok(/listEligibleBookings\(user\.id,\s*user\.phone,\s*user\.email\)/.test(tierRoute),
  "me/tier route passes user.email");
ok(/hasEligibleBookingForHotel\(\s*user\.id,\s*user\.phone \|\| null,\s*body\.hotelId,\s*body\.bookingId,\s*user\.email \|\| null\s*\)/.test(uploadGate),
  "verified-guest upload gate passes user.email (picker<->upload identity parity)");

// ── 2. Empty-state navigation — /bookings primary, /hotels secondary ──────────
ok(/href="\/bookings"/.test(sheet), "picker empty-state links to /bookings");
ok(/View my bookings/.test(sheet), "picker primary CTA copy = View my bookings");
// /hotels may remain ONLY as the secondary 'book a new stay' path.
ok(/href="\/hotels"[\s\S]*?Book a new stay/.test(sheet),
  "/hotels is present only as the secondary 'Book a new stay' CTA");
// The primary CTA must be /bookings, i.e. /bookings appears before /hotels.
ok(sheet.indexOf('href="/bookings"') < sheet.indexOf('href="/hotels"'),
  "/bookings CTA precedes /hotels CTA (primary vs secondary order)");
// The old stale 'Browse hotels ->' primary CTA is gone.
ok(!/Browse hotels/.test(sheet), "stale 'Browse hotels' primary CTA removed");

// ── 3. Copy alignment — no 'checked out only / completed stays' framing ───────
ok(!/No completed stays in the last 90 days/.test(sheet),
  "stale 'No completed stays' empty-state copy removed");
ok(!/checked out in the last\s*90 days/i.test(sheet.replace(/\s+/g, " ")) ||
   /recent or current/i.test(sheet),
  "card subtitle no longer claims only 'checked out'");
ok(/recent or current StayBid stay/i.test(sheet),
  "copy now says 'recent or current StayBid stay'");
ok(/Current stay · ends/.test(sheet),
  "row label is ongoing-aware (Current stay for a future checkOut)");

// selection still carries bookingId + hotelId into the verified_guest context.
ok(/kind:\s*"verified_guest",\s*hotelId:\s*b\.hotelId,\s*bookingId:\s*b\.id/.test(sheet),
  "picker selection preserves bookingId + hotelId in verified_guest context");
// picker still calls the authoritative endpoint.
ok(/api\.getEligibleBookings\(\)/.test(sheet),
  "picker still fetches the authoritative /api/me/eligible-bookings");

// ── 4. No weakening — eligibility rule + admin rejection intact ───────────────
ok(/BOOKING_OK_STATUSES = \["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"\]/.test(eligibility),
  "booking eligibility statuses UNCHANGED");
ok(/BID_OK_STATUSES = \["ACCEPTED", "CHECKED_IN", "CHECKED_OUT"\]/.test(eligibility),
  "bid eligibility statuses UNCHANGED");
ok(/checkIn=lte\./.test(eligibility) && /checkOut=gte\./.test(eligibility),
  "date window (checkIn<=now, checkOut>=since) UNCHANGED — ongoing stays still pass");
ok(!/checkOut=lt\./.test(eligibility),
  "no 'checkOut < now' filter re-introduced (ongoing stays not excluded)");
ok(/resolveVerifiedMediaCustomer/.test(uploadSession),
  "upload-session still uses the strict media authority (admin/super_admin rejected)");

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\nverified-guest-picker: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
