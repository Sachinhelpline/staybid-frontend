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
  "razorpay-verify.ts": "app/api/razorpay/verify/route.ts",
};
const ALIAS = {
  "@/lib/bid-expiry": "bid-expiry",
  "@/lib/stay/confirmed-stay": "confirmed-stay",
  "@/lib/stay/share-eligibility": "share-eligibility",
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

    // ── Part 3 — Share-UX resolver (gated ONLY on server-computed _shareEligible)
    section("3. resolveShareState — 'Share now' ONLY from the evidence-backed _shareEligible flag");
    eqv(
      SH.resolveShareState({ _source: "bid", id: "b1", status: "ACCEPTED", message: FORGED, checkIn: iso(-2), checkOut: iso(2), hotelId: "h1" }).state,
      "not_confirmed",
      "3.1 ACCEPTED bid, no _shareEligible → not_confirmed (no Share CTA)"
    );
    eqv(
      SH.resolveShareState({ _source: "bid", id: "b2", status: "CHECKED_OUT", checkIn: iso(-3), checkOut: iso(-1), hotelId: "h1" }).state,
      "not_confirmed",
      "3.2 a FORGEABLE CHECKED_OUT status without evidence → NOT eligible (status is not authority)"
    );
    eqv(
      SH.resolveShareState({ _source: "bid", id: "b3", status: "ACCEPTED", _shareEligible: true, checkIn: iso(-2), checkOut: iso(2), hotelId: "h1", hotel: { name: "A" } }).state,
      "eligible",
      "3.3 _shareEligible:true (evidence-backed) → eligible"
    );
    eqv(
      SH.resolveShareState({ _source: "booking", id: "bk1", status: "CONFIRMED", _shareEligible: true, checkIn: iso(-1), checkOut: iso(1), hotelId: "h2" }).state,
      "eligible",
      "3.4 evidence-backed direct booking → eligible"
    );
    eqv(
      SH.resolveShareState({ _source: "booking", id: "bk2", status: "CANCELLED", checkIn: iso(3), checkOut: iso(6), hotelId: "h2" }).state,
      "not_confirmed",
      "3.5 cancelled booking (even future) → not_confirmed (no soft future hint)"
    );
    eqv(
      SH.resolveShareState({ _source: "booking", id: "bk3", status: "CONFIRMED", checkIn: iso(3), checkOut: iso(6), hotelId: "h2" }).state,
      "future",
      "3.6 confirmed but future check-in, no evidence yet → future (display-only hint)"
    );
    section("3b. resolveBannerShareState reduction (0/1/many, evidence-gated)");
    eqv(SH.resolveBannerShareState([]).kind, "none", "3b.1 empty → none");
    eqv(
      SH.resolveBannerShareState([{ _source: "bid", id: "x", status: "CHECKED_OUT", checkIn: iso(-2), checkOut: iso(2), hotelId: "h1" }]).kind,
      "none",
      "3b.2 forgeable CHECKED_OUT status without evidence → none (no false Share now)"
    );
    {
      const one = SH.resolveBannerShareState([{ _source: "booking", id: "bk1", status: "CONFIRMED", _shareEligible: true, checkIn: iso(-3), checkOut: iso(-1), hotelId: "h2", hotel: { name: "A" } }]);
      ok(one.kind === "eligible" && one.bookingId === "bk1", "3b.3 exactly 1 evidence-backed stay → auto-bind");
    }
    {
      const many = SH.resolveBannerShareState([
        { _source: "booking", id: "bk1", status: "CONFIRMED", _shareEligible: true, checkIn: iso(-3), checkOut: iso(-1), hotelId: "h1" },
        { _source: "bid", id: "b3", status: "ACCEPTED", _shareEligible: true, checkIn: iso(-2), checkOut: iso(1), hotelId: "h2" },
      ]);
      eqv(many.kind, "eligible_many", "3b.4 more than one evidence-backed stay → picker");
    }

    Module._resolveFilename = origResolve;
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
