/**
 * MY-BOOKINGS-LIFECYCLE-PROJECTION-01 — customer My-Bookings read/projection.
 *
 * Hermetic (no network, no DB). Two layers:
 *   • EXECUTABLE — transpiles the REAL pure helpers (lib/stay/confirmed-stay.ts,
 *     which imports lib/bid-expiry.ts) in-memory with the project's own
 *     TypeScript and drives them, so the candidate-status contract + the
 *     truthful projection contract + the display filter are PROVEN, not just
 *     string-matched. It also replays the EXACT projection object GET
 *     /api/bookings/my builds, to prove `status` is truthful and `_bidStatus`
 *     preserves the raw lifecycle.
 *   • WIRING scans — prove the route actually consumes those helpers (widened
 *     candidate read, no legacy eq.ACCEPTED, truthful projection, `_bidStatus`
 *     preserved), that the protected `_shareEligible` evidence logic is
 *     unchanged + fail-closed, that direct-bookings + dedup semantics are
 *     untouched, and that the completed/rating view keys on CHECKED_OUT.
 *
 * Covers the 16 required checks (see labels below). Requirement 16 (existing
 * Verified-Guest authority suites stay green) is proven by RUNNING those suites
 * (npm run test:sec00b + the three named node commands), not by this file; the
 * scans here additionally prove this diff does not touch that authority.
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

// Load a pure TS lib module by transpiling it in-memory, resolving the few
// "@/lib/..." aliases it needs to their transpiled siblings (no bundler).
const ts = require("typescript");
const _cache = {};
const ALIAS = {
  "@/lib/bid-expiry": "lib/bid-expiry.ts",
  "@/lib/stay/confirmed-stay": "lib/stay/confirmed-stay.ts",
};
function loadTs(relPath) {
  if (_cache[relPath]) return _cache[relPath].exports;
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  const mod = { exports: {} };
  _cache[relPath] = mod;
  const localRequire = (spec) => (ALIAS[spec] ? loadTs(ALIAS[spec]) : require(spec));
  new Function("exports", "require", "module", js)(mod.exports, localRequire, mod);
  return mod.exports;
}

// ── files under test ──────────────────────────────────────────────────────────
const ROUTE    = read("app/api/bookings/my/route.ts");
const BOOKINGS = read("app/bookings/page.tsx");

const stay = loadTs("lib/stay/confirmed-stay.ts");
const {
  MY_BOOKINGS_CANDIDATE_BID_STATUSES,
  myBookingsCandidateBidStatusFilter,
  projectedBidBookingStatus,
  isBidConfirmedStayForDisplay,
} = stay;

// ════════════════════════════════════════════════════════════════
// EXECUTABLE — candidate-status read contract
// ════════════════════════════════════════════════════════════════
{
  const set = MY_BOOKINGS_CANDIDATE_BID_STATUSES;
  const filter = myBookingsCandidateBidStatusFilter();

  // 1/2/3 — candidate read INCLUDES ACCEPTED, CHECKED_IN, CHECKED_OUT
  ok(set.includes("ACCEPTED")    && /(?:^|[,(])ACCEPTED(?:[,)]|$)/.test(filter),
    "1. candidate bid read includes ACCEPTED");
  ok(set.includes("CHECKED_IN")  && /CHECKED_IN/.test(filter),
    "2. candidate bid read includes CHECKED_IN");
  ok(set.includes("CHECKED_OUT") && /CHECKED_OUT/.test(filter),
    "3. candidate bid read includes CHECKED_OUT");

  // 4/5/6 — candidate read EXCLUDES PENDING / COUNTER / terminal
  ok(!set.includes("PENDING") && !/PENDING/.test(filter),
    "4. candidate bid read does NOT include PENDING");
  ok(!set.includes("COUNTER") && !/COUNTER/.test(filter),
    "5. candidate bid read does NOT include COUNTER");
  ["REJECTED", "DECLINED", "CANCELLED", "EXPIRED"].forEach((st) => {
    ok(!set.includes(st) && !new RegExp(st).test(filter),
      `6. candidate bid read does NOT include terminal '${st}'`);
  });

  // deterministic exact fragment (query == constant, no drift)
  ok(filter === "status=in.(ACCEPTED,CHECKED_IN,CHECKED_OUT)",
    "6b. candidate filter is the exact deterministic in.(...) fragment");
}

// ════════════════════════════════════════════════════════════════
// EXECUTABLE — canonical display filter (unchanged decision)
// ════════════════════════════════════════════════════════════════
{
  // 7 — bare/unpaid ACCEPTED is still filtered OUT
  ok(isBidConfirmedStayForDisplay({ status: "ACCEPTED" }) === false,
    "7. bare/unpaid ACCEPTED is filtered out (not shown)");
  ok(isBidConfirmedStayForDisplay({ status: "ACCEPTED", message: "" }) === false,
    "7b. empty-message ACCEPTED is filtered out");

  // display-paid ACCEPTED shows
  ok(isBidConfirmedStayForDisplay({ status: "ACCEPTED", message: "Razorpay: pay_x" }) === true,
    "8-pre. display-paid ACCEPTED passes the display filter");
  // CHECKED_IN / CHECKED_OUT always show; PENDING/COUNTER/terminal never
  ok(isBidConfirmedStayForDisplay({ status: "CHECKED_IN" }) === true,
    "8-pre2. CHECKED_IN passes the display filter");
  ok(isBidConfirmedStayForDisplay({ status: "CHECKED_OUT" }) === true,
    "8-pre3. CHECKED_OUT passes the display filter");
  ["PENDING", "COUNTER", "REJECTED", "CANCELLED", "EXPIRED", "DECLINED", "", null, undefined]
    .forEach((st) => ok(isBidConfirmedStayForDisplay({ status: st }) === false,
      `8-pre4. status '${String(st)}' does NOT pass the display filter`));
}

// ════════════════════════════════════════════════════════════════
// EXECUTABLE — truthful projection status
// ════════════════════════════════════════════════════════════════
{
  // 8 — display-paid ACCEPTED projects to CONFIRMED (existing behaviour)
  ok(projectedBidBookingStatus({ status: "ACCEPTED", message: "Razorpay: pay_x" }) === "CONFIRMED",
    "8. display-paid ACCEPTED projects as CONFIRMED");
  // 9 — CHECKED_IN stays truthful
  ok(projectedBidBookingStatus({ status: "CHECKED_IN" }) === "CHECKED_IN",
    "9. CHECKED_IN projects truthfully (never flattened to CONFIRMED)");
  // 10 — CHECKED_OUT stays truthful
  ok(projectedBidBookingStatus({ status: "CHECKED_OUT" }) === "CHECKED_OUT",
    "10. CHECKED_OUT projects truthfully (never flattened to CONFIRMED)");
  // case-insensitive input still resolves truthfully
  ok(projectedBidBookingStatus({ status: "checked_out" }) === "CHECKED_OUT",
    "10b. projection is case-insensitive");
}

// ════════════════════════════════════════════════════════════════
// EXECUTABLE — replay the EXACT route projection object
//   (mirrors app/api/bookings/my/route.ts bidEnriched.map)
// ════════════════════════════════════════════════════════════════
function projectRow(b) {
  return {
    id: b.id,
    _source: "bid",
    _projectedFromBid: true,
    _bidStatus: b.status,                       // raw lifecycle preserved
    status: projectedBidBookingStatus(b),       // truthful display status
  };
}
{
  const ci = projectRow({ id: "bid_ci", status: "CHECKED_IN" });
  const co = projectRow({ id: "bid_co", status: "CHECKED_OUT" });
  const ac = projectRow({ id: "bid_ac", status: "ACCEPTED", message: "Razorpay: pay_x" });

  // 11 — _bidStatus ALWAYS preserves the real underlying bid status
  ok(ci._bidStatus === "CHECKED_IN" && co._bidStatus === "CHECKED_OUT" && ac._bidStatus === "ACCEPTED",
    "11. _bidStatus preserves the raw bid lifecycle status in the projection");
  ok(ci.status === "CHECKED_IN" && co.status === "CHECKED_OUT" && ac.status === "CONFIRMED",
    "11b. projected display status is truthful per lifecycle");

  // 12 — a CHECKED_OUT projection can still drive completed/rating semantics,
  //      which the bookings page keys on `b.status === "CHECKED_OUT"`.
  ok(co.status === "CHECKED_OUT",
    "12. CHECKED_OUT projection can drive the completed/rating view");
  inc(BOOKINGS, 'b.status === "CHECKED_OUT"',
    "12b. bookings page completed/rating semantics key on status === CHECKED_OUT");
}

// ════════════════════════════════════════════════════════════════
// WIRING — the route actually consumes the shared helpers
// ════════════════════════════════════════════════════════════════
inc(ROUTE, 'myBookingsCandidateBidStatusFilter', "W1. route imports/uses the shared candidate-status filter");
inc(ROUTE, '${myBookingsCandidateBidStatusFilter()}', "W2. bid read uses the widened lifecycle filter");
nin(ROUTE, 'status=eq.ACCEPTED', "W3. no legacy status=eq.ACCEPTED bid read remains");
inc(ROUTE, 'isBidConfirmedStayForDisplay(b)', "W4. candidates still pass through the canonical display filter");
inc(ROUTE, 'status: projectedBidBookingStatus(b)', "W5. projection uses the truthful lifecycle status helper");
nin(ROUTE, 'status: "CONFIRMED"', "W6. the hard-coded CONFIRMED projection is gone");
inc(ROUTE, '_bidStatus: b.status', "W7. the raw bid status is preserved on _bidStatus");

// 13 — protected _shareEligible evidence logic unchanged + fail-closed
inc(ROUTE, 'readVerifiedStayEvidenceForCustomers(customerIds)', "13. _shareEligible reads protected verified-stay evidence");
inc(ROUTE, '`${String(e.hotel_id)}|${String(e.source_id)}`', "13b. evidence keyed by hotel_id|source_id (unchanged)");
inc(ROUTE, 'row._shareEligible = evKeys.has(`${String(row.hotelId)}|${String(row.id)}`)', "13c. _shareEligible match unchanged");
inc(ROUTE, '/* fail closed', "13d. _shareEligible fails closed on evidence error");

// 14 — direct bookings-table rows unaffected
inc(ROUTE, 'bookings?customerId=in.(${inList})&select=*', "14. direct bookings read unchanged");
inc(ROUTE, '_source: "booking"', "14b. direct bookings still enriched as _source booking");

// 15 — dedup semantics unchanged
inc(ROUTE, 'const realKeys = new Set(realEnriched.map((b: any) => `${b.hotelId}|${b.roomId}`))', "15. dedup realKeys set unchanged");
inc(ROUTE, 'const mergedBids = bidEnriched.filter((b: any) => !realKeys.has(`${b.hotelId}|${b.roomId}`))', "15b. dedup filter unchanged");

// 16 — this diff does NOT touch the Verified-Guest / SEC-00B authority surface
nin(ROUTE, '@/lib/tier/eligibility', "16. route does not import the Verified-Guest eligibility authority");
nin(ROUTE, 'isBidVerifiedStay(', "16b. route does not CALL the STRONG verified-stay decision (display surface only)");

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\nmy-bookings-lifecycle-projection: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
