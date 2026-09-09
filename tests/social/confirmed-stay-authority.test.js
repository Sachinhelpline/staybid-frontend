#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — CONFIRMED-STAY authority + FORGEABLE-PAYMENT fail-closed proof.
//   Run: node tests/social/confirmed-stay-authority.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL
// lib/stay/confirmed-stay.ts + lib/stay/share-eligibility.ts + lib/bid-expiry.ts
// + lib/tier/eligibility.ts + app/api/razorpay/verify/route.ts with the lockfile
// tsc into an OS temp dir, then drives them:
//   • Part 1 — the SECURITY authority isBidVerifiedStay (CHECKED_IN/CHECKED_OUT
//     ONLY) vs the DISPLAY-only helpers (which read the FORGEABLE paid markers).
//   • Part 2 — the REAL /api/razorpay/verify HMAC boundary (forged/malformed
//     fail; a correct signature passes) — documented as NOT wired to bid
//     authority under fail-closed.
//   • Part 3 — the Share-UX resolver: a forgeable "paid" bid is NEVER
//     share-eligible; only CHECKED_IN/CHECKED_OUT bids + real direct bookings are.
//   • Part 4 — the REAL listEligibleBookings + hasEligibleBookingForHotel:
//     an arbitrary fake razorpay_payment_id / an unauthenticated paidTotal write
//     / a message-marker edit CANNOT create Verified-Guest authority (the route
//     never even reads the forgeable ledger and its bid query excludes ACCEPTED);
//     CHECKED_IN/CHECKED_OUT + a legitimate direct booking DO; wrong-hotel/other
//     user rejected.
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"),
  fs = require("fs"),
  os = require("os"),
  cp = require("child_process"),
  crypto = require("crypto"),
  Module = require("module");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0,
  fail = 0,
  fatal = null;
const failures = [];
function ok(c, l) {
  if (c) pass += 1;
  else {
    fail += 1;
    failures.push(l);
    console.error("  ✗ " + l);
  }
}
function eqv(a, b, l) {
  ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function section(n) {
  console.log("\n• " + n);
}

const FILES = {
  "bid-expiry.ts": "lib/bid-expiry.ts",
  "confirmed-stay.ts": "lib/stay/confirmed-stay.ts",
  "share-eligibility.ts": "lib/stay/share-eligibility.ts",
  "sb.ts": "lib/sb.ts",
  "sb-server.ts": "lib/sb-server.ts",
  "eligibility.ts": "lib/tier/eligibility.ts",
  "razorpay-verify.ts": "app/api/razorpay/verify/route.ts",
};
const ALIAS = {
  "@/lib/bid-expiry": "bid-expiry",
  "@/lib/stay/confirmed-stay": "confirmed-stay",
  "@/lib/stay/share-eligibility": "share-eligibility",
  "@/lib/sb": "sb",
  "@/lib/sb-server": "sb-server",
  "@/lib/tier/eligibility": "eligibility",
};

const RZP_SECRET = "sec00b_test_rzp_secret_value";

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-confirmed-stay-"));
  try {
    const SRC = path.join(tempRoot, "src"),
      OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    for (const [dst, src] of Object.entries(FILES)) {
      fs.copyFileSync(path.join(REPO, src), path.join(SRC, dst));
    }
    // A tiny runtime stand-in for next/server so the compiled route can run.
    const FAKE_NEXT = path.join(tempRoot, "fake-next-server.js");
    fs.writeFileSync(
      FAKE_NEXT,
      "module.exports = { NextResponse: { json: (body, init) => ({ _json: body, status: (init && init.status) || 200 }) } };"
    );

    const paths = { "*": [path.join(REPO, "node_modules/*")] };
    for (const [spec, base] of Object.entries(ALIAS)) paths[spec] = ["./" + base];
    fs.writeFileSync(
      path.join(SRC, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "commonjs",
          target: "es2020",
          lib: ["es2020", "dom"],
          moduleResolution: "node",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          ignoreDeprecations: "6.0",
          baseUrl: ".",
          typeRoots: [path.join(REPO, "node_modules/@types")],
          types: ["node"],
          paths,
          rootDir: ".",
          outDir: "../out",
          noEmitOnError: true,
        },
        include: ["*.ts"],
      })
    );
    let TSC;
    try {
      TSC = require.resolve("typescript/bin/tsc", { paths: [REPO] });
    } catch {
      throw new Error("COMPILE GATE FAILED — local tsc not installed.");
    }
    const compile = cp.spawnSync(process.execPath, [TSC, "-p", path.join(SRC, "tsconfig.json")], {
      cwd: REPO,
      encoding: "utf8",
    });
    if (compile.status !== 0)
      throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || ""));
    console.log("• Local tsc compile: exit 0, clean (strict) — authority + share + eligibility + razorpay verify");

    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request))
        return path.join(OUT, ALIAS[request] + ".js");
      if (request === "next/server") return FAKE_NEXT;
      return origResolve.call(this, request, ...rest);
    };

    const CS = require(path.join(OUT, "confirmed-stay.js"));
    const SH = require(path.join(OUT, "share-eligibility.js"));

    const NOW = Date.now();
    const iso = (d) => new Date(NOW + d * 86_400_000).toISOString();
    const FORGED = "Paid via Razorpay: pay_FAKE_forged_by_client";

    // ── Part 1 — SECURITY vs DISPLAY authority ──────────────────────────────
    section("1. isBidVerifiedStay — the SECURITY authority: CHECKED_IN/CHECKED_OUT ONLY");
    ok(CS.isBidVerifiedStay({ status: "CHECKED_IN" }) === true, "1.1 CHECKED_IN → verified stay");
    ok(CS.isBidVerifiedStay({ status: "CHECKED_OUT" }) === true, "1.2 CHECKED_OUT → verified stay");
    ok(
      CS.isBidVerifiedStay({ status: "ACCEPTED", message: FORGED }) === false,
      "1.3 ACCEPTED + FORGED Razorpay message → NOT a verified stay (fail closed)"
    );
    for (const st of ["ACCEPTED", "PENDING", "COUNTER", "EXPIRED", "CANCELLED", "DECLINED", "REJECTED", "", null]) {
      ok(CS.isBidVerifiedStay({ status: st }) === false, `1.3b ${JSON.stringify(st)} → NOT a verified stay`);
    }
    section("1b. isBidLooselyPaidForDisplay — FORGEABLE, display-only (never authority)");
    ok(CS.isBidLooselyPaidForDisplay({ message: FORGED }, null) === true, "1b.1 forged message marker reads as 'paid' (display only)");
    ok(CS.isBidLooselyPaidForDisplay({ message: "Guest bid" }, 999999) === true, "1b.2 forged ledger paid_total reads as 'paid' (display only)");
    ok(CS.isBidLooselyPaidForDisplay({ message: "Guest bid" }, null) === false, "1b.3 no marker + no ledger → not paid");
    ok(CS.isBidLooselyPaidForDisplay({ message: "Guest bid" }, -5) === false, "1b.4 negative ledger → not paid");
    section("1c. isBidConfirmedStayForDisplay — display projection (shows paid bids, hides unpaid)");
    ok(CS.isBidConfirmedStayForDisplay({ status: "ACCEPTED", message: FORGED }, null) === true, "1c.1 ACCEPTED + marker → shown in My Bookings (display)");
    ok(CS.isBidConfirmedStayForDisplay({ status: "ACCEPTED", message: "Guest bid" }, null) === false, "1c.2 unpaid ACCEPTED → hidden (pre-SEC-00B display bug closed)");
    ok(CS.isBidConfirmedStayForDisplay({ status: "CHECKED_OUT" }, null) === true, "1c.3 CHECKED_OUT → shown");
    for (const st of ["EXPIRED", "CANCELLED", "DECLINED", "REJECTED", "PENDING", "COUNTER"]) {
      ok(CS.isBidConfirmedStayForDisplay({ status: st, message: FORGED }, 9999) === false, `1c.4 ${st} → hidden even with a marker`);
    }
    section("1d. isBookingConfirmedStay — trustworthy direct-booking authority");
    for (const st of ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "confirmed"]) {
      ok(CS.isBookingConfirmedStay({ status: st }) === true, `1d booking ${st} → confirmed`);
    }
    for (const st of ["CANCELLED", "PENDING", "", null]) {
      ok(CS.isBookingConfirmedStay({ status: st }) === false, `1d booking ${JSON.stringify(st)} → NOT confirmed`);
    }

    // ── Part 2 — the REAL /api/razorpay/verify HMAC boundary ────────────────
    section("2. /api/razorpay/verify HMAC (real route) — forged/malformed fail, correct passes");
    process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;
    const VR = require(path.join(OUT, "razorpay-verify.js"));
    const post = (body) => VR.POST({ json: async () => body });
    const sign = (order, payment) =>
      crypto.createHmac("sha256", RZP_SECRET).update(`${order}|${payment}`).digest("hex");
    {
      const good = await post({ razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: sign("order_1", "pay_1") });
      ok(good._json && good._json.verified === true, "2.1 correct HMAC signature → verified:true");
    }
    {
      const bad = await post({ razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: sign("order_1", "pay_DIFFERENT") });
      ok(bad._json && bad._json.verified === false, "2.2 forged/mismatched signature → verified:false");
    }
    {
      const missing = await post({ razorpay_order_id: "order_1", razorpay_payment_id: "pay_1" });
      ok(missing._json && missing._json.verified === false && missing.status === 400, "2.3 missing signature → 400 verified:false");
    }
    {
      delete process.env.RAZORPAY_KEY_SECRET;
      const VR2path = path.join(OUT, "razorpay-verify.js");
      delete require.cache[VR2path];
      const VR2 = require(VR2path);
      const noSecret = await VR2.POST({ json: async () => ({ razorpay_order_id: "o", razorpay_payment_id: "p", razorpay_signature: "s" }) });
      ok(noSecret._json && noSecret._json.error === "payment_config_missing" && noSecret.status === 503, "2.4 secret absent → 503 payment_config_missing (fail closed)");
      process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;
    }
    console.log("  (note: /api/razorpay/verify is a pure HMAC boolean, bound to no bid/customer/amount, and is NOT used as bid authority under SEC-00B fail-closed.)");

    // ── Part 3 — Share-UX resolver (fail closed on forgeable markers) ────────
    section("3. resolveShareState — a forgeable 'paid' bid is NEVER share-eligible");
    eqv(
      SH.resolveShareState({ _source: "bid", id: "b1", status: "ACCEPTED", message: FORGED, checkIn: iso(-2), checkOut: iso(2), hotelId: "h1" }).state,
      "not_confirmed",
      "3.1 _source:bid ACCEPTED + forged marker → not_confirmed (no Share CTA)"
    );
    eqv(
      SH.resolveShareState({ _projectedFromBid: true, _bidStatus: "ACCEPTED", id: "b1p", status: "CONFIRMED", checkIn: iso(-2), checkOut: iso(2), hotelId: "h1" }).state,
      "not_confirmed",
      "3.2 server projection (real _bidStatus ACCEPTED, display 'CONFIRMED') → not_confirmed"
    );
    eqv(
      SH.resolveShareState({ _source: "bid", id: "b2", status: "CHECKED_OUT", checkIn: iso(-3), checkOut: iso(-1), hotelId: "h1", hotel: { name: "A" } }).state,
      "eligible",
      "3.3 CHECKED_OUT bid started within window → eligible"
    );
    eqv(
      SH.resolveShareState({ _source: "booking", id: "bk1", status: "CONFIRMED", checkIn: iso(-1), checkOut: iso(1), hotelId: "h2" }).state,
      "eligible",
      "3.4 real CONFIRMED direct booking started → eligible"
    );
    eqv(
      SH.resolveShareState({ _source: "booking", id: "bk2", status: "CANCELLED", checkIn: iso(-1), checkOut: iso(1), hotelId: "h2" }).state,
      "not_confirmed",
      "3.5 cancelled booking → not_confirmed"
    );
    eqv(
      SH.resolveShareState({ _source: "booking", id: "bk3", status: "CHECKED_OUT", checkIn: iso(3), checkOut: iso(6), hotelId: "h2" }).state,
      "future",
      "3.6 confirmed but future check-in → future"
    );
    section("3b. resolveBannerShareState reduction (0/1/many)");
    eqv(SH.resolveBannerShareState([]).kind, "none", "3b.1 empty → none");
    eqv(
      SH.resolveBannerShareState([{ _source: "bid", id: "x", status: "ACCEPTED", message: FORGED, checkIn: iso(-2), checkOut: iso(2), hotelId: "h1" }]).kind,
      "none",
      "3b.2 only a forgeable-paid ACCEPTED bid → none (no false Share now)"
    );
    {
      const one = SH.resolveBannerShareState([{ _source: "booking", id: "bk1", status: "CHECKED_OUT", checkIn: iso(-3), checkOut: iso(-1), hotelId: "h2", hotel: { name: "A" } }]);
      ok(one.kind === "eligible" && one.bookingId === "bk1", "3b.3 exactly 1 eligible (direct booking) → auto-bind");
    }

    // ── Part 4 — the REAL eligibility route (picker + upload gate) ───────────
    section("4. listEligibleBookings + hasEligibleBookingForHotel — forgeable markers grant NO authority");
    const CUST = "cust_primary";
    const BIDS = [
      // Forged: ACCEPTED with a fake Razorpay message. MUST be ineligible.
      { id: "b_forged", customerId: CUST, status: "ACCEPTED", message: FORGED, requestId: "r1", hotelId: "h1", roomId: "rm1" },
      { id: "b_checkin", customerId: CUST, status: "CHECKED_IN", requestId: "r2", hotelId: "h1", roomId: "rm2" },
      { id: "b_checkout", customerId: CUST, status: "CHECKED_OUT", requestId: "r3", hotelId: "h2", roomId: "rm3" },
    ];
    // A forged unauthenticated ledger write for the ACCEPTED bid — the route must
    // NEVER read this table (asserted via ledgerRead below).
    const PAID = [{ bid_id: "b_forged", paid_total: 999999 }];
    const REQS = [
      { id: "r1", checkIn: iso(-2), checkOut: iso(2) },
      { id: "r2", checkIn: iso(-2), checkOut: iso(2) },
      { id: "r3", checkIn: iso(-3), checkOut: iso(-1) },
      { id: "r4", checkIn: iso(-2), checkOut: iso(2) },
    ];
    const BOOKINGS = [
      { id: "bk_direct", customerId: CUST, status: "CONFIRMED", checkIn: iso(-1), checkOut: iso(2), hotelId: "h3", roomId: "rm9", requestId: "r4" },
      { id: "bk_cancel", customerId: CUST, status: "CANCELLED", checkIn: iso(-1), checkOut: iso(2), hotelId: "h3", roomId: "rm8", requestId: "r4" },
    ];
    const HOTELS = [
      { id: "h1", name: "Hotel One", city: "Dehradun" },
      { id: "h2", name: "Hotel Two", city: "Manali" },
      { id: "h3", name: "Hotel Three", city: "Shimla" },
    ];
    const jsonRes = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } });
    const statusSet = (u) => {
      const m = u.match(/status=in\.\(([^)]*)\)/);
      return m ? new Set(m[1].split(",").map((s) => decodeURIComponent(s).trim().toUpperCase())) : null;
    };
    let ledgerRead = false;
    let capturedBidsUrl = "";
    const savedFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/rest/v1/users")) return jsonRes([]);
      if (u.includes("/rest/v1/bid_paid_amounts")) {
        ledgerRead = true;
        return jsonRes(PAID);
      }
      if (u.includes("/rest/v1/bid_requests")) return jsonRes(REQS);
      if (u.includes("/rest/v1/hotels")) return jsonRes(HOTELS);
      if (u.includes("/rest/v1/bookings")) {
        const set = statusSet(u);
        return jsonRes(set ? BOOKINGS.filter((b) => set.has(String(b.status).toUpperCase())) : BOOKINGS);
      }
      if (u.includes("/rest/v1/bids")) {
        capturedBidsUrl = u;
        const set = statusSet(u);
        return jsonRes(set ? BIDS.filter((b) => set.has(String(b.status).toUpperCase())) : BIDS);
      }
      return jsonRes([]);
    };
    try {
      const EL = require(path.join(OUT, "eligibility.js"));
      const rows = await EL.listEligibleBookings(CUST, null, null);
      const ids = new Set(rows.map((r) => r.id));

      ok(!ids.has("b_forged"), "4.1 forged fake-payment-id ACCEPTED bid is NOT eligible (arbitrary payment_id grants no authority)");
      ok(ledgerRead === false, "4.2 the route NEVER reads bid_paid_amounts (unauthenticated paidTotal write grants no authority)");
      ok(/CHECKED_IN/.test(capturedBidsUrl) && /CHECKED_OUT/.test(capturedBidsUrl) && !/ACCEPTED/.test(capturedBidsUrl), "4.3 the bid query fails closed to CHECKED_IN/CHECKED_OUT (never ACCEPTED)");
      ok(ids.has("b_checkin"), "4.4 CHECKED_IN bid IS eligible (strong proof)");
      ok(ids.has("b_checkout"), "4.5 CHECKED_OUT bid IS eligible (strong proof)");
      ok(ids.has("bk_direct"), "4.6 legitimate CONFIRMED direct booking IS eligible (trustworthy direct-booking authority)");
      ok(!ids.has("bk_cancel"), "4.7 cancelled direct booking is NOT eligible");

      const gForged = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "b_forged", null);
      ok(gForged.ok === false, "4.8 upload gate REJECTS the forged-paid ACCEPTED bid id");
      const gCheckin = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "b_checkin", null);
      ok(gCheckin.ok === true, "4.9 upload gate ACCEPTS the CHECKED_IN bid id");
      const gDirect = await EL.hasEligibleBookingForHotel(CUST, null, "h3", "bk_direct", null);
      ok(gDirect.ok === true, "4.10 upload gate ACCEPTS the legitimate direct booking id");
      const gWrongHotel = await EL.hasEligibleBookingForHotel(CUST, null, "h2", "b_checkin", null);
      ok(gWrongHotel.ok === false, "4.11 upload gate REJECTS a valid stay claimed against the WRONG hotel");
      const gOtherId = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "someone_elses_bid", null);
      ok(gOtherId.ok === false, "4.12 upload gate REJECTS a booking id the customer does not own");
    } finally {
      global.fetch = savedFetch;
      Module._resolveFilename = origResolve;
    }
  } catch (err) {
    fatal = err;
    console.error("\n• FATAL: " + (err && err.message ? err.message : String(err)));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")");
  }
  section("RESULT");
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2;
  else if (fail > 0) process.exitCode = 1;
  else {
    console.log("• ALL PASS");
    process.exitCode = 0;
  }
}
main();
