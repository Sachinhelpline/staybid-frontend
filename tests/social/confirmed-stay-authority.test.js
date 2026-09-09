#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — Canonical CONFIRMED-STAY authority behavioral proof.
//   Run: node tests/social/confirmed-stay-authority.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL
// lib/stay/confirmed-stay.ts + lib/stay/share-eligibility.ts + lib/bid-expiry.ts
// + the REAL lib/tier/eligibility.ts (Verified-Guest picker + upload gate) with
// the lockfile tsc into an OS temp dir, then drives them:
//   • Part 1 — the pure authority: a bare / stale / expired UNPAID ACCEPTED bid
//     is NEVER a confirmed stay; a PAID (message OR bid_paid_amounts) ACCEPTED
//     is; CHECKED_IN/OUT is; terminal EXPIRED/CANCELLED/DECLINED/REJECTED and
//     PENDING/COUNTER never are; bookings gate on CONFIRMED/CHECKED_IN/OUT.
//   • Part 2 — the truthful Share UX resolver (eligible/future/closed/none +
//     the 0/1/many banner reduction).
//   • Part 3 — the REAL listEligibleBookings + hasEligibleBookingForHotel
//     against an injected fetch stub: an UNPAID ACCEPTED bid grants NO
//     Verified-Guest proof (picker AND upload gate), a paid one does.
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"),
  fs = require("fs"),
  os = require("os"),
  cp = require("child_process"),
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

// Files to compile flat, and the `@/` specifiers each import maps to.
const FILES = {
  "bid-expiry.ts": "lib/bid-expiry.ts",
  "confirmed-stay.ts": "lib/stay/confirmed-stay.ts",
  "share-eligibility.ts": "lib/stay/share-eligibility.ts",
  "sb.ts": "lib/sb.ts",
  "sb-server.ts": "lib/sb-server.ts",
  "eligibility.ts": "lib/tier/eligibility.ts",
};
const ALIAS = {
  "@/lib/bid-expiry": "bid-expiry",
  "@/lib/stay/confirmed-stay": "confirmed-stay",
  "@/lib/stay/share-eligibility": "share-eligibility",
  "@/lib/sb": "sb",
  "@/lib/sb-server": "sb-server",
  "@/lib/tier/eligibility": "eligibility",
};

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-confirmed-stay-"));
  try {
    const SRC = path.join(tempRoot, "src"),
      OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    for (const [dst, src] of Object.entries(FILES)) {
      fs.copyFileSync(path.join(REPO, src), path.join(SRC, dst));
    }
    // Compile-time path map so `@/…` specifiers resolve to the flat copies.
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
    console.log("• Local tsc compile: exit 0, clean (strict) — confirmed-stay + share + eligibility");

    // Runtime `@/…` resolver → the compiled OUT files.
    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request))
        return path.join(OUT, ALIAS[request] + ".js");
      return origResolve.call(this, request, ...rest);
    };

    const CS = require(path.join(OUT, "confirmed-stay.js"));
    const SH = require(path.join(OUT, "share-eligibility.js"));

    const NOW = Date.now();
    const iso = (deltaDays) => new Date(NOW + deltaDays * 86_400_000).toISOString();
    const RZP = "Paid via Razorpay: pay_ABC123";

    // ── Part 1 — the pure confirmed-stay authority ──────────────────────────
    section("1. isBidConfirmedStay — UNPAID ACCEPTED is NEVER a confirmed stay");
    ok(
      CS.isBidConfirmedStay({ status: "ACCEPTED", message: "Guest bid" }, null) === false,
      "1.1 bare unpaid ACCEPTED → NOT confirmed (UNPAID_ACCEPTED_AS_CONFIRMED closed)"
    );
    ok(
      CS.isBidConfirmedStay({ status: "ACCEPTED", message: "Guest bid · negotiate" }, 0) === false,
      "1.2 unpaid ACCEPTED + paid_total 0 → NOT confirmed"
    );
    ok(
      CS.isBidConfirmedStay({ status: "ACCEPTED", message: RZP }, null) === true,
      "1.3 ACCEPTED + Razorpay message marker → confirmed"
    );
    ok(
      CS.isBidConfirmedStay({ status: "ACCEPTED", message: "razorpay_payment_id=pay_9" }, null) === true,
      "1.4 ACCEPTED + razorpay_payment_id marker → confirmed"
    );
    ok(
      CS.isBidConfirmedStay({ status: "ACCEPTED", message: "Guest bid" }, 5000) === true,
      "1.5 ACCEPTED + bid_paid_amounts paid_total>0 (no message) → confirmed (ledger union)"
    );
    ok(
      CS.isBidConfirmedStay({ status: "ACCEPTED", message: "Guest bid" }, -1) === false,
      "1.6 ACCEPTED + negative/NaN paid_total → NOT confirmed"
    );
    ok(
      CS.isBidConfirmedStay({ status: "CHECKED_IN", message: "" }, null) === true,
      "1.7 CHECKED_IN (even no marker) → confirmed (guest physically stayed)"
    );
    ok(
      CS.isBidConfirmedStay({ status: "CHECKED_OUT", message: null }, null) === true,
      "1.8 CHECKED_OUT → confirmed"
    );
    section("1b. terminal + non-reservation statuses never confirm (even with a paid marker)");
    for (const st of ["EXPIRED", "CANCELLED", "DECLINED", "REJECTED"]) {
      ok(
        CS.isBidConfirmedStay({ status: st, message: RZP }, 9999) === false,
        `1b terminal ${st} + paid marker → NOT confirmed (STALE_ACCEPTED_VERIFIED_GUEST closed)`
      );
    }
    for (const st of ["PENDING", "COUNTER", "", null, undefined]) {
      ok(
        CS.isBidConfirmedStay({ status: st, message: RZP }, 9999) === false,
        `1b non-reservation ${JSON.stringify(st)} → NOT confirmed`
      );
    }
    section("1c. isBookingConfirmedStay");
    for (const st of ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "confirmed"]) {
      ok(CS.isBookingConfirmedStay({ status: st }) === true, `1c booking ${st} → confirmed`);
    }
    for (const st of ["CANCELLED", "PENDING", "", null]) {
      ok(CS.isBookingConfirmedStay({ status: st }) === false, `1c booking ${JSON.stringify(st)} → NOT confirmed`);
    }

    // ── Part 2 — the truthful Share UX resolver ─────────────────────────────
    section("2. resolveShareState — eligible / future / window_closed / not_confirmed");
    {
      const eligible = SH.resolveShareState({
        _source: "bid",
        id: "b1",
        status: "ACCEPTED",
        message: RZP,
        checkIn: iso(-2),
        checkOut: iso(2),
        hotelId: "h1",
        hotel: { name: "Cedar Lodge" },
      });
      eqv(eligible.state, "eligible", "2.1 started paid bid → eligible");
      ok(eligible.state === "eligible" && eligible.bookingId === "b1" && eligible.hotelId === "h1", "2.1b carries booking + hotel binding");
    }
    {
      const notYet = SH.resolveShareState({
        _source: "bid",
        id: "b2",
        status: "ACCEPTED",
        message: RZP,
        checkIn: iso(3),
        checkOut: iso(6),
        hotelId: "h2",
      });
      eqv(notYet.state, "future", "2.2 confirmed but check-in in the future → future");
      ok(notYet.state === "future" && !!notYet.availableFrom, "2.2b carries availableFrom");
    }
    {
      const closed = SH.resolveShareState({
        _source: "booking",
        id: "bk1",
        status: "CHECKED_OUT",
        checkIn: iso(-200),
        checkOut: iso(-197),
        hotelId: "h3",
      });
      eqv(closed.state, "window_closed", "2.3 confirmed but >90 days past → window_closed");
    }
    {
      const unpaid = SH.resolveShareState({
        _source: "bid",
        id: "b3",
        status: "ACCEPTED",
        message: "Guest bid",
        checkIn: iso(-2),
        checkOut: iso(2),
        hotelId: "h4",
      });
      eqv(unpaid.state, "not_confirmed", "2.4 UNPAID accepted bid → not_confirmed (no Share CTA)");
    }
    {
      const cancelled = SH.resolveShareState({
        _source: "booking",
        id: "bk2",
        status: "CANCELLED",
        checkIn: iso(-2),
        checkOut: iso(2),
        hotelId: "h5",
      });
      eqv(cancelled.state, "not_confirmed", "2.5 cancelled booking → not_confirmed");
    }
    {
      const bookingOk = SH.resolveShareState({
        _source: "booking",
        id: "bk3",
        status: "CONFIRMED",
        checkIn: iso(-1),
        checkOut: iso(1),
        hotelId: "h6",
        hotel: { name: "Ridge View" },
      });
      eqv(bookingOk.state, "eligible", "2.6 started CONFIRMED booking → eligible");
    }

    section("3. resolveBannerShareState — 0 / 1 / many + future reduction (GLOBAL_CREATE_0_1_MANY_FLOW)");
    eqv(SH.resolveBannerShareState([]).kind, "none", "3.1 empty → none");
    {
      const one = SH.resolveBannerShareState([
        { _source: "bid", id: "b1", status: "ACCEPTED", message: RZP, checkIn: iso(-2), checkOut: iso(2), hotelId: "h1", hotel: { name: "A" } },
        { _source: "bid", id: "bx", status: "ACCEPTED", message: "Guest bid", checkIn: iso(-2), checkOut: iso(2), hotelId: "h9" }, // unpaid → ignored
      ]);
      ok(one.kind === "eligible" && one.bookingId === "b1" && one.hotelId === "h1", "3.2 exactly 1 eligible → auto-bind that stay");
    }
    {
      const many = SH.resolveBannerShareState([
        { _source: "bid", id: "b1", status: "ACCEPTED", message: RZP, checkIn: iso(-2), checkOut: iso(2), hotelId: "h1" },
        { _source: "booking", id: "bk3", status: "CHECKED_OUT", checkIn: iso(-3), checkOut: iso(-1), hotelId: "h2" },
      ]);
      eqv(many.kind, "eligible_many", "3.3 more than one eligible → picker");
    }
    {
      const fut = SH.resolveBannerShareState([
        { _source: "bid", id: "b1", status: "ACCEPTED", message: RZP, checkIn: iso(9), checkOut: iso(12), hotelId: "h1" },
        { _source: "bid", id: "b2", status: "ACCEPTED", message: RZP, checkIn: iso(4), checkOut: iso(7), hotelId: "h2" },
      ]);
      ok(fut.kind === "future" && fut.availableFrom, "3.4 only future confirmed → future (earliest check-in)");
    }
    eqv(
      SH.resolveBannerShareState([{ _source: "bid", id: "b3", status: "ACCEPTED", message: "Guest bid", checkIn: iso(-2), checkOut: iso(2), hotelId: "h4" }]).kind,
      "none",
      "3.5 only unpaid accepted → none (no false Share now)"
    );

    // ── Part 3 — the REAL eligibility route (picker + upload gate) ───────────
    section("4. listEligibleBookings + hasEligibleBookingForHotel reject UNPAID ACCEPTED (picker + upload gate)");
    const CUST = "cust_primary";
    // Synthetic bids the caller owns.
    const BIDS = [
      { id: "b_unpaid", customerId: CUST, status: "ACCEPTED", message: "Guest bid", requestId: "r1", hotelId: "h1", roomId: "rm1" },
      { id: "b_paidmsg", customerId: CUST, status: "ACCEPTED", message: RZP, requestId: "r2", hotelId: "h1", roomId: "rm2" },
      { id: "b_paidledger", customerId: CUST, status: "ACCEPTED", message: "Guest bid", requestId: "r3", hotelId: "h2", roomId: "rm3" },
      { id: "b_checkout", customerId: CUST, status: "CHECKED_OUT", message: "", requestId: "r4", hotelId: "h2", roomId: "rm4" },
      { id: "b_future", customerId: CUST, status: "ACCEPTED", message: RZP, requestId: "r5", hotelId: "h3", roomId: "rm5" },
    ];
    const PAID = [{ bid_id: "b_paidledger", paid_total: 5000 }];
    const REQS = [
      { id: "r1", checkIn: iso(-2), checkOut: iso(2) },
      { id: "r2", checkIn: iso(-2), checkOut: iso(2) },
      { id: "r3", checkIn: iso(-2), checkOut: iso(2) },
      { id: "r4", checkIn: iso(-3), checkOut: iso(-1) },
      { id: "r5", checkIn: iso(3), checkOut: iso(6) }, // future check-in → excluded by the date window
    ];
    const HOTELS = [
      { id: "h1", name: "Hotel One", city: "Dehradun" },
      { id: "h2", name: "Hotel Two", city: "Manali" },
      { id: "h3", name: "Hotel Three", city: "Shimla" },
    ];
    const jsonRes = (data) => ({
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: { get: () => null },
    });
    const savedFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/rest/v1/users")) return jsonRes([]); // no identity twins
      if (u.includes("/rest/v1/bookings")) return jsonRes([]); // no booking-table rows
      if (u.includes("/rest/v1/bid_paid_amounts")) return jsonRes(PAID);
      if (u.includes("/rest/v1/bid_requests")) return jsonRes(REQS);
      if (u.includes("/rest/v1/hotels")) return jsonRes(HOTELS);
      if (u.includes("/rest/v1/bids")) return jsonRes(BIDS);
      return jsonRes([]);
    };
    try {
      const EL = require(path.join(OUT, "eligibility.js"));
      const rows = await EL.listEligibleBookings(CUST, null, null);
      const ids = new Set(rows.map((r) => r.id));
      ok(!ids.has("b_unpaid"), "4.1 UNPAID ACCEPTED bid is NOT eligible (picker excludes it)");
      ok(ids.has("b_paidmsg"), "4.2 PAID (message) ACCEPTED bid IS eligible");
      ok(ids.has("b_paidledger"), "4.3 PAID (bid_paid_amounts ledger) ACCEPTED bid IS eligible");
      ok(ids.has("b_checkout"), "4.4 CHECKED_OUT bid IS eligible");
      ok(!ids.has("b_future"), "4.5 PAID but future-check-in bid is NOT yet eligible (date window holds)");

      const gateUnpaid = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "b_unpaid", null);
      ok(gateUnpaid.ok === false, "4.6 upload gate REJECTS the unpaid ACCEPTED booking id");
      const gatePaid = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "b_paidmsg", null);
      ok(gatePaid.ok === true, "4.7 upload gate ACCEPTS the paid booking id (same hotel)");
      const gateCheckout = await EL.hasEligibleBookingForHotel(CUST, null, "h2", "b_checkout", null);
      ok(gateCheckout.ok === true, "4.8 upload gate ACCEPTS the checked-out booking id");
      const gateWrongHotel = await EL.hasEligibleBookingForHotel(CUST, null, "h2", "b_paidmsg", null);
      ok(gateWrongHotel.ok === false, "4.9 upload gate REJECTS a paid booking claimed against the WRONG hotel");
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
