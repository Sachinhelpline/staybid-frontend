#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — VERIFIED-STAY EVIDENCE authority + PUBLIC-TABLE FORGERY fail-closed.
//   Run: node tests/social/verified-stay-evidence-authority.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL
// lib/auth/verified-partner-authority.ts + lib/stay/verified-stay-evidence.ts +
// lib/tier/eligibility.ts (+ deps) with the lockfile tsc, then proves:
//   • The Verified-Guest picker + upload gate read ONLY the protected
//     verified_stay_evidence table — a forged bids CHECKED_IN status / a
//     fabricated bookings row / a fabricated checkin_checkout_logs row grants NO
//     authority (those tables are NEVER queried; payment markers never read).
//   • Evidence is written ONLY with the service-role key (fail closed otherwise)
//     and is idempotent per (source_type, source_id).
//   • The partner authority is CRYPTOGRAPHIC: a decode-only / forged / expired /
//     wrong-secret / RS256 token is rejected; a partner for Hotel A cannot verify
//     a Hotel B stay; a real customer (no hotel scope) cannot verify their stay.
//   • Other-customer / forged-deep-link booking ids are rejected; picker + gate
//     agree.
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
  "verified-stay-evidence.ts": "lib/stay/verified-stay-evidence.ts",
  "verified-partner-authority.ts": "lib/auth/verified-partner-authority.ts",
  "sb.ts": "lib/sb.ts",
  "sb-server.ts": "lib/sb-server.ts",
  "eligibility.ts": "lib/tier/eligibility.ts",
};
const ALIAS = {
  "@/lib/bid-expiry": "bid-expiry",
  "@/lib/stay/confirmed-stay": "confirmed-stay",
  "@/lib/stay/verified-stay-evidence": "verified-stay-evidence",
  "@/lib/auth/verified-partner-authority": "verified-partner-authority",
  "@/lib/sb": "sb",
  "@/lib/sb-server": "sb-server",
  "@/lib/tier/eligibility": "eligibility",
};

const PARTNER_SECRET = "sec00b_partner_access_secret_value";

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-vse-authz-"));
  try {
    const SRC = path.join(tempRoot, "src"),
      OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    for (const [dst, src] of Object.entries(FILES)) {
      fs.copyFileSync(path.join(REPO, src), path.join(SRC, dst));
    }
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
    console.log("• Local tsc compile: exit 0, clean (strict) — partner authority + evidence + eligibility");

    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request))
        return path.join(OUT, ALIAS[request] + ".js");
      return origResolve.call(this, request, ...rest);
    };

    const PA = require(path.join(OUT, "verified-partner-authority.js"));
    const VSE = require(path.join(OUT, "verified-stay-evidence.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    const NOW = Date.now();
    const iso = (d) => new Date(NOW + d * 86_400_000).toISOString();
    const mkReq = (auth) => ({ headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? auth : null) } });
    const signP = (claims, opts = {}) => jwt.sign(claims, PARTNER_SECRET, { algorithm: "HS256", ...opts });

    // ── Part 1 — cryptographic partner authority ────────────────────────────
    section("1. verifyPartnerToken — reject decode-only / forged / expired; accept a real signed token");
    ok(!!PA.verifyPartnerToken(signP({ sub: "partnerA", id: "partnerA" }), [PARTNER_SECRET]), "1.1 valid HS256 partner token → verified");
    eqv(PA.verifyPartnerToken(signP({ sub: "partnerA", id: "partnerA" }), [PARTNER_SECRET]).subject, "partnerA", "1.1b subject = verified sub");
    eqv(PA.verifyPartnerToken("not.a.jwt", [PARTNER_SECRET]), null, "1.2 malformed → null");
    eqv(PA.verifyPartnerToken(jwt.sign({ sub: "attacker" }, "WRONGSECRET", { algorithm: "HS256" }), [PARTNER_SECRET]), null, "1.3 wrong-secret (decode-only forge) → null");
    eqv(PA.verifyPartnerToken(signP({ sub: "partnerA" }, { expiresIn: -3600 }), [PARTNER_SECRET]), null, "1.4 expired → null");
    eqv(PA.verifyPartnerToken(signP({ id: "partnerA" }), [undefined]), null, "1.5 no configured secret → null (fail closed)");
    { const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      eqv(PA.verifyPartnerToken(jwt.sign({ sub: "partnerA" }, privateKey, { algorithm: "RS256", expiresIn: "1h" }), [PARTNER_SECRET]), null, "1.6 RS256/Firebase-shaped → null"); }
    eqv(PA.verifyPartnerToken(signP({ sub: "partnerA", id: "partnerB" }), [PARTNER_SECRET]), null, "1.7 id!==sub → null");

    section("2. partnerAuthorizedForHotel — a partner can verify ONLY their own hotel");
    const depsA = { secrets: [PARTNER_SECRET], resolveHotelIds: async () => ["hotelA"] };
    const reqA = mkReq("Bearer " + signP({ sub: "partnerA", id: "partnerA" }));
    { const r = await PA.partnerAuthorizedForHotel(reqA, depsA, "hotelA"); ok(r.ok === true && r.subject === "partnerA", "2.1 partner A → authorized for hotelA"); }
    { const r = await PA.partnerAuthorizedForHotel(reqA, depsA, "hotelB"); ok(r.ok === false, "2.2 partner A → NOT authorized for hotelB (cross-hotel forgery blocked)"); }
    { // a real customer whose subject owns/operates NO hotel
      const depsCustomer = { secrets: [PARTNER_SECRET], resolveHotelIds: async () => [] };
      const reqCust = mkReq("Bearer " + signP({ sub: "cust_self", id: "cust_self" }));
      const r = await PA.partnerAuthorizedForHotel(reqCust, depsCustomer, "hotelA");
      ok(r.ok === false, "2.3 a real customer (no hotel scope) CANNOT verify their own stay"); }
    { const r = await PA.partnerAuthorizedForHotel(mkReq("Bearer not.a.jwt"), depsA, "hotelA"); ok(r.ok === false, "2.4 decode-only / unsigned token → not authorized"); }
    { const r = await PA.partnerAuthorizedForHotel(mkReq(null), depsA, "hotelA"); ok(r.ok === false, "2.5 no token → not authorized"); }
    { const bad = { secrets: [PARTNER_SECRET], resolveHotelIds: async () => { throw new Error("db down"); } };
      const r = await PA.partnerAuthorizedForHotel(reqA, bad, "hotelA"); ok(r.ok === false, "2.6 scope resolver failure → fail closed"); }

    // ── Part 3 — evidence store: service-role only, idempotent, fail closed ──
    section("3. verified-stay-evidence — service-role only, deterministic/idempotent, fail closed");
    eqv(VSE.evidenceId("bid", "b1"), "vse_bid_b1", "3.1 deterministic evidence id (idempotent per source)");
    eqv(VSE.evidenceId("bid", "b1"), VSE.evidenceId("bid", "b1"), "3.2 same source → same id (replay-safe)");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    ok(VSE.evidenceConfigured() === false, "3.3 evidenceConfigured false without service-role key");
    { const w = await VSE.writeVerifiedStayEvidence({ customerId: "c", hotelId: "h", sourceType: "bid", sourceId: "b1", proofState: "checked_in", verifierType: "partner", verifierId: "p" });
      ok(w.ok === false && w.reason === "service_role_unconfigured", "3.4 write FAILS CLOSED without service-role key"); }
    { const rows = await VSE.readVerifiedStayEvidenceForCustomers(["c"]); ok(Array.isArray(rows) && rows.length === 0, "3.5 read FAILS CLOSED ([]) without service-role key"); }

    // With the service-role key set, the write hits the evidence table (stub).
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sec00b_test_service_role_key";
    ok(VSE.evidenceConfigured() === true, "3.6 evidenceConfigured true with service-role key");
    let writeUrl = "", writePrefer = "", writeAuth = "";
    const savedFetch = global.fetch;
    global.fetch = async (url, opts) => {
      writeUrl = String(url); writePrefer = (opts && opts.headers && opts.headers.Prefer) || ""; writeAuth = (opts && opts.headers && opts.headers.Authorization) || "";
      return { ok: true, status: 201, json: async () => [], text: async () => "", headers: { get: () => null } };
    };
    try {
      const w = await VSE.writeVerifiedStayEvidence({ customerId: "c", hotelId: "h", sourceType: "bid", sourceId: "b1", proofState: "checked_in", verifierType: "partner", verifierId: "partnerA" });
      ok(w.ok === true, "3.7 write succeeds with service-role key");
      ok(/on_conflict=id/.test(writeUrl), "3.8 write upserts on the deterministic id (idempotent replay)");
      ok(/merge-duplicates/.test(writePrefer), "3.9 write uses resolution=merge-duplicates (idempotent)");
      ok(/verified_stay_evidence/.test(writeUrl), "3.10 write targets the protected verified_stay_evidence table");
      ok(writeAuth.includes("sec00b_test_service_role_key"), "3.11 write authorizes with the service-role key (not anon)");
    } finally { global.fetch = savedFetch; }

    // ── Part 4 — the REAL eligibility reads ONLY the protected evidence ──────
    section("4. listEligibleBookings + hasEligibleBookingForHotel — public-table forgery grants NO authority");
    const CUST = "cust_primary";
    // Protected evidence (the ONLY authority). b_checkin@h1, b_checkout@h2.
    const EVIDENCE = [
      { id: "vse_bid_b_checkin", customer_id: CUST, hotel_id: "h1", source_type: "bid", source_id: "b_checkin", proof_state: "checked_in", check_in_at: iso(-1), check_out_at: null, verified_at: iso(-1), verifier_type: "partner", verifier_id: "partnerA" },
      { id: "vse_bid_b_checkout", customer_id: CUST, hotel_id: "h2", source_type: "bid", source_id: "b_checkout", proof_state: "checked_out", check_in_at: iso(-3), check_out_at: iso(-1), verified_at: iso(-1), verifier_type: "partner", verifier_id: "partnerA" },
    ];
    const HOTELS = [ { id: "h1", name: "Hotel One", city: "Dehradun" }, { id: "h2", name: "Hotel Two", city: "Manali" } ];
    const jsonRes = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } });
    // Track any read of a FORGEABLE public table — the authority must never touch them.
    let forbiddenRead = "";
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/rest/v1/users")) return jsonRes([]);
      if (u.includes("/rest/v1/verified_stay_evidence")) return jsonRes(EVIDENCE);
      if (u.includes("/rest/v1/hotels")) return jsonRes(HOTELS);
      if (/\/rest\/v1\/(bids|bookings|checkin_checkout_logs|bid_paid_amounts|bid_requests)\b/.test(u)) {
        forbiddenRead = u; // a public/forgeable table was queried — must NOT happen
        return jsonRes([{ id: "b_forged", status: "CHECKED_IN", customerId: CUST, hotelId: "h1", paid_total: 999999 }]);
      }
      return jsonRes([]);
    };
    try {
      const EL = require(path.join(OUT, "eligibility.js"));
      const rows = await EL.listEligibleBookings(CUST, null, null);
      const ids = new Set(rows.map((r) => r.id));
      ok(forbiddenRead === "", "4.1 eligibility NEVER reads bids/bookings/checkin_checkout_logs/bid_paid_amounts (public forgery ignored)" + (forbiddenRead ? " — read " + forbiddenRead : ""));
      ok(ids.has("b_checkin") && ids.has("b_checkout"), "4.2 evidence-backed stays ARE eligible");
      ok(!ids.has("b_forged"), "4.3 a forged public bids CHECKED_IN row grants NO eligibility");
      eqv(rows.length, 2, "4.4 exactly the two evidence-backed stays (nothing forged leaks in)");

      const gCheckin = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "b_checkin", null);
      ok(gCheckin.ok === true, "4.5 upload gate ACCEPTS the evidence-backed checked-in stay");
      const gForged = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "b_forged", null);
      ok(gForged.ok === false, "4.6 upload gate REJECTS a forged public bids id (no evidence)");
      const gWrongHotel = await EL.hasEligibleBookingForHotel(CUST, null, "h2", "b_checkin", null);
      ok(gWrongHotel.ok === false, "4.7 upload gate REJECTS the stay claimed against the WRONG hotel");
      const gOther = await EL.hasEligibleBookingForHotel(CUST, null, "h1", "someone_elses_bid", null);
      ok(gOther.ok === false, "4.8 upload gate REJECTS a forged deep-link / non-owned booking id");
      // picker ⇄ gate agree: every id the gate accepts is in the picker, and nothing else.
      const pickerIds = new Set(rows.map((r) => `${r.hotelId}|${r.id}`));
      ok(pickerIds.has("h1|b_checkin") && !pickerIds.has("h1|b_forged"), "4.9 picker ⇄ upload gate agree (same evidence authority)");
    } finally {
      global.fetch = savedFetch;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }

    // ── Part 5 — eligibility fails closed when evidence is unconfigured ──────
    section("5. eligibility fails closed when the evidence store is unconfigured");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let touched = false;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/rest/v1/users")) return jsonRes([]);
      if (/\/rest\/v1\/(bids|bookings|checkin_checkout_logs)\b/.test(u)) { touched = true; }
      return jsonRes([]);
    };
    try {
      const EL = require(path.join(OUT, "eligibility.js"));
      const rows = await EL.listEligibleBookings(CUST, null, null);
      ok(Array.isArray(rows) && rows.length === 0, "5.1 no service-role key → NO eligibility (fail closed)");
      ok(touched === false, "5.2 still never falls back to the forgeable public tables");
    } finally { global.fetch = savedFetch; }

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
