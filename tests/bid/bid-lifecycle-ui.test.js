/**
 * BID-LIFECYCLE-UI-01 — partner + customer lifecycle-display consistency tests.
 *
 * Hermetic (no network, no DB). Two layers:
 *   • EXECUTABLE — transpiles the REAL pure helpers (lib/bid-expiry.ts +
 *     lib/bid-lifecycle-display.ts) in-memory with the project's own TypeScript
 *     and drives them, so the runtime lifecycle contract is proven, not just
 *     asserted by string match.
 *   • WIRING scans — prove the read model / partner UI / customer card actually
 *     consume those helpers (and that the hardened check-in/out authority is
 *     untouched).
 *
 * Covers the 13 required checks (see labels below).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL " + name); }
}
function inc(hay, needle, name) { ok(hay.includes(needle), name + `  (missing: ${needle})`); }
function nin(hay, needle, name) { ok(!hay.includes(needle), name + `  (unexpected: ${needle})`); }

// Load a pure TS lib module by transpiling it in-memory (no import resolution).
function loadTsModule(relPath) {
  const ts = require("typescript");
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", js)(mod.exports, require, mod);
  return mod.exports;
}

// ── files under test ──────────────────────────────────────────────────────────
const ROUTE   = read("app/api/partner/hotel/route.ts");
const DASH    = read("app/partner/dashboard/page.tsx");
const MYBIDS  = read("app/my-bids/page.tsx");
const CHECKIN  = read("app/api/partner/checkin/[bidId]/route.ts");
const CHECKOUT = read("app/api/partner/checkout/[bidId]/route.ts");

const expiry  = loadTsModule("lib/bid-expiry.ts");
const display = loadTsModule("lib/bid-lifecycle-display.ts");

// ════════════════════════════════════════════════════════════════
// EXECUTABLE — partner read-model lifecycle set + action gating
// ════════════════════════════════════════════════════════════════
{
  const { PARTNER_BOOKING_STATUSES, partnerBookingStatusInFilter, canPartnerCheckIn, canPartnerCheckOut } = expiry;
  const filter = partnerBookingStatusInFilter();

  // 1. read model includes CHECKED_IN
  ok(PARTNER_BOOKING_STATUSES.includes("CHECKED_IN") && /CHECKED_IN/.test(filter),
    "1. partner Bookings read model includes CHECKED_IN");
  // 2. read model includes CHECKED_OUT
  ok(PARTNER_BOOKING_STATUSES.includes("CHECKED_OUT") && /CHECKED_OUT/.test(filter),
    "2. partner Bookings read model includes CHECKED_OUT");
  // 3. existing ACCEPTED behaviour remains supported (+ CONFIRMED)
  ok(PARTNER_BOOKING_STATUSES.includes("ACCEPTED") && PARTNER_BOOKING_STATUSES.includes("CONFIRMED"),
    "3. read model still supports ACCEPTED (and CONFIRMED)");
  ok(filter === "status=in.(ACCEPTED,CONFIRMED,CHECKED_IN,CHECKED_OUT)",
    "3b. filter is the exact deterministic lifecycle in.(...) set");

  // 5. CHECKED_IN → Check-out available
  ok(canPartnerCheckOut("CHECKED_IN") === true,
    "5. partner CHECKED_IN row offers Check-out");
  // 6. CHECKED_IN → NO Check-in
  ok(canPartnerCheckIn("CHECKED_IN") === false,
    "6. partner CHECKED_IN row does NOT offer Check-in");
  // 7. CHECKED_OUT → neither
  ok(canPartnerCheckIn("CHECKED_OUT") === false && canPartnerCheckOut("CHECKED_OUT") === false,
    "7. partner CHECKED_OUT row offers neither Check-in nor Check-out");
  // (supporting) ACCEPTED/CONFIRMED → Check-in yes, Check-out no
  ok(canPartnerCheckIn("ACCEPTED") === true && canPartnerCheckOut("ACCEPTED") === false,
    "7b. ACCEPTED offers Check-in only");
  ok(canPartnerCheckIn("CONFIRMED") === true && canPartnerCheckOut("CONFIRMED") === false,
    "7c. CONFIRMED offers Check-in only");
}

// ════════════════════════════════════════════════════════════════
// EXECUTABLE — customer status display (never a false Pending)
// ════════════════════════════════════════════════════════════════
{
  const { resolveBidStatusMeta, bidStatusLabel, BID_STATUS_META } = display;

  // 8. CHECKED_IN → "Checked in", NOT "Pending"
  ok(resolveBidStatusMeta("CHECKED_IN").label === "Checked in", "8. customer CHECKED_IN renders 'Checked in'");
  ok(resolveBidStatusMeta("CHECKED_IN").label !== "Pending", "8b. customer CHECKED_IN is NOT 'Pending'");
  // 9. CHECKED_OUT → "Checked out"
  ok(resolveBidStatusMeta("CHECKED_OUT").label === "Checked out", "9. customer CHECKED_OUT renders 'Checked out'");
  // 10. CONFIRMED → "Confirmed"
  ok(resolveBidStatusMeta("CONFIRMED").label === "Confirmed", "10. customer CONFIRMED renders 'Confirmed'");

  // 11. unknown/future status NEVER resolves to Pending
  ok(resolveBidStatusMeta("SOMETHING_NEW").label !== "Pending", "11. unknown status is NOT 'Pending'");
  ok(resolveBidStatusMeta("SOMETHING_NEW").label === "Something new", "11b. unknown status is humanized, not faked");
  ok(resolveBidStatusMeta("").label !== "Pending" && resolveBidStatusMeta(null).label !== "Pending" &&
     resolveBidStatusMeta(undefined).label !== "Pending",
    "11c. empty/null/undefined status is NOT 'Pending' (neutral fallback)");
  ok(resolveBidStatusMeta("zzz_unknown").color !== BID_STATUS_META.PENDING.color,
    "11d. unknown status does not even borrow the PENDING colour");

  // 12. existing display does not regress
  ok(resolveBidStatusMeta("PENDING").label === "Pending", "12a. PENDING still 'Pending'");
  ok(resolveBidStatusMeta("COUNTER").label === "Countered", "12b. COUNTER still 'Countered'");
  ok(resolveBidStatusMeta("ACCEPTED").label === "Accepted", "12c. ACCEPTED still 'Accepted'");
  ok(resolveBidStatusMeta("REJECTED").label === "Declined", "12d. REJECTED still 'Declined'");
  ok(resolveBidStatusMeta("CANCELLED").label === "Cancelled" && resolveBidStatusMeta("EXPIRED").label === "Expired",
    "12e. CANCELLED/EXPIRED unchanged");
  ok(bidStatusLabel("checked_in") === "Checked in",
    "12f. resolver is case-insensitive (lowercase input still maps)");
}

// ════════════════════════════════════════════════════════════════
// WIRING — the surfaces actually consume the shared helpers
// ════════════════════════════════════════════════════════════════
// Read model (route) uses the shared filter, in BOTH branches, and no eq.ACCEPTED remains.
inc(ROUTE, 'import { partnerBookingStatusInFilter } from "@/lib/bid-expiry"',
  "W1. partner route imports the shared lifecycle filter");
ok((ROUTE.match(/\$\{partnerBookingStatusInFilter\(\)\}/g) || []).length >= 2,
  "W2. both classic + operator branches use the widened lifecycle filter");
nin(ROUTE, "status=eq.ACCEPTED", "W3. no legacy status=eq.ACCEPTED read remains in the route");

// 4. operator owned-unit isolation preserved (unchanged filter AFTER the widen).
inc(ROUTE, "b.assignedUnitId && ownedUnitIdSet.has(String(b.assignedUnitId))",
  "4. operator owned-unit isolation still applied after widening lifecycle statuses");

// Partner UI uses the shared gating helpers + neutral copy.
inc(DASH, "canPartnerCheckIn, canPartnerCheckOut", "W4. dashboard imports the gating helpers");
inc(DASH, "canPartnerCheckIn(b.status)", "W5. Mark Check-in gated by canPartnerCheckIn");
inc(DASH, "canPartnerCheckOut(b.status)", "W6. Mark Check-out gated by canPartnerCheckOut");
ok(/text-xl mb-5">Bookings</.test(DASH), "W7. Bookings heading copy simplified (not 'Confirmed Bookings')");
inc(DASH, "No bookings yet", "W8. empty-state copy simplified to 'No bookings yet'");

// Customer card uses the shared resolver, and the false-Pending fallback is gone.
inc(MYBIDS, 'import { BID_STATUS_META as STATUS_META, resolveBidStatusMeta } from "@/lib/bid-lifecycle-display"',
  "W9. my-bids imports the shared status registry + resolver");
inc(MYBIDS, "const meta  = resolveBidStatusMeta(b.status);", "W10. card meta uses resolveBidStatusMeta");
nin(MYBIDS, "STATUS_META[b.status] || STATUS_META.PENDING", "W11. the false-Pending fallback is removed");
nin(MYBIDS, "const STATUS_META: Record<string,", "W12. the local STATUS_META literal is removed (single registry)");

// 13. hardened check-in / check-out authority is UNTOUCHED (still gated on protected evidence).
inc(CHECKIN, "readVerifiedStayEvidenceForSource", "13a. check-in route still reads the protected verified-stay evidence");
inc(CHECKIN, "evidenceBindingMatches", "13b. check-in route still validates the evidence binding");
inc(CHECKOUT, "readVerifiedStayEvidenceForSource", "13c. check-out route still reads the protected verified-stay evidence");
ok(/status\s*!==\s*"ACCEPTED"|=== "ACCEPTED"/.test(CHECKIN), "13d. check-in route still enforces its ACCEPTED pre-state");

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\nbid-lifecycle-ui: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
