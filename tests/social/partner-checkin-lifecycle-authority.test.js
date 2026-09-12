#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — PARTNER CHECK-IN + CHECK-OUT lifecycle precondition (bid pre-state
// gate + protected-evidence transition authority).
//   Run: node tests/social/partner-checkin-lifecycle-authority.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL
// app/api/partner/checkin/[bidId]/route.ts AND app/api/partner/checkout/[bidId]/
// route.ts together with their real deps (verified-partner-authority(+factory) ·
// verified-partner-hotel-scope · verified-stay-evidence · onboard/supabase-admin ·
// sb-server) using the lockfile tsc, then drives the real POST handlers against a
// fake Supabase to prove the lifecycle preconditions:
//   • CHECK-IN mints trusted checked_in evidence ONLY from an ACCEPTED bid with no
//     pre-existing evidence (the smallest correct pre-state — the live bids schema
//     has no CONFIRMED and a paid bid stays ACCEPTED with FORGEABLE markers);
//     PENDING / COUNTER / REJECTED / EXPIRED / CANCELLED / DECLINED / unknown /
//     null → 409, ZERO write.
//   • CHECK-OUT mints trusted checked_out evidence ONLY when the bid is genuinely
//     CHECKED_IN AND a bound checked_in protected row exists; every other pre-state
//     (incl. a forged-marker PENDING, and a CHECKED_IN bid with no/mismatched
//     evidence) → 409, ZERO write — CHECKED_OUT is a trusted state, so this closes
//     the alternate-bypass hole.
//   • forgeable payment markers (bids.message "Razorpay:" / bid_paid_amounts) can
//     NEVER bypass either gate;
//   • replay is idempotent with ZERO rewrite (checked_in for check-in, checked_out
//     for checkout) ONLY on a fully-bound matching row; a row whose COMPLETE
//     immutable binding (id + source_type + source_id + customer_id + hotel_id)
//     mismatches is a 409 and is NEVER minted over; an existing checked_out row is
//     never downgraded to checked_in;
//   • the protected evidence read is TRI-STATE — a read FAILURE fails closed (503)
//     and is NEVER conflated with "no evidence" (so the merge-upsert can never
//     silently overwrite a real row);
//   • the pre-existing authority is preserved on both routes: forged/unsigned/
//     wrong-secret/id-only token → 401; wrong-hotel partner → 403; service-role
//     unavailable → fail-closed (zero write); missing bid → 404.
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
  "checkin-route.ts": "app/api/partner/checkin/[bidId]/route.ts",
  "checkout-route.ts": "app/api/partner/checkout/[bidId]/route.ts",
  "supabase-admin.ts": "lib/onboard/supabase-admin.ts",
  "verified-partner-authority.ts": "lib/auth/verified-partner-authority.ts",
  "verified-partner-authority-factory.ts": "lib/auth/verified-partner-authority-factory.ts",
  "verified-partner-hotel-scope.ts": "lib/auth/verified-partner-hotel-scope.ts",
  "verified-stay-evidence.ts": "lib/stay/verified-stay-evidence.ts",
  "sb-server.ts": "lib/sb-server.ts",
};
const ALIAS = {
  "next/server": "next-server",
  "@/lib/onboard/supabase-admin": "supabase-admin",
  "@/lib/auth/verified-partner-authority": "verified-partner-authority",
  "@/lib/auth/verified-partner-authority-factory": "verified-partner-authority-factory",
  "@/lib/auth/verified-partner-hotel-scope": "verified-partner-hotel-scope",
  "@/lib/stay/verified-stay-evidence": "verified-stay-evidence",
  "@/lib/sb-server": "sb-server",
};

// Minimal next/server stub so the compiled route's NextResponse.json returns an
// inspectable { status, body } object (no real Next runtime pulled in).
const NEXT_SERVER_STUB = `export const NextResponse = {
  json(data: any, init?: { status?: number }) {
    return { status: (init && init.status) || 200, body: data } as any;
  },
};
`;

const PARTNER_SECRET = "sec00b_partner_access_secret_value";
const SVC_KEY = "sec00b_test_service_role_key";
// Mirror the production canary identifiers (hermetic strings only — no network).
const AUTHZ_SUBJECT = "cmnr4b8ol0001whjy8jc1xxxh";
const HOTEL = "202601";
const CUSTOMER = "fb_l3fo3x6WvSfKdifEcSNr6BcwgOL2";

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-checkin-life-"));
  try {
    const SRC = path.join(tempRoot, "src"),
      OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    for (const [dst, src] of Object.entries(FILES)) {
      fs.copyFileSync(path.join(REPO, src), path.join(SRC, dst));
    }
    fs.writeFileSync(path.join(SRC, "next-server.ts"), NEXT_SERVER_STUB);

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
    console.log("• Local tsc compile: exit 0, clean (strict) — checkin + checkout routes + deps");

    // Env MUST be set BEFORE requiring the route: it builds partnerAuthority at
    // module load (captures JWT_ACCESS_SECRET) and supabase-admin freezes its key.
    process.env.JWT_ACCESS_SECRET = PARTNER_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SVC_KEY;

    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request))
        return path.join(OUT, ALIAS[request] + ".js");
      return origResolve.call(this, request, ...rest);
    };

    const ROUTE = require(path.join(OUT, "checkin-route.js"));
    const CHECKOUT = require(path.join(OUT, "checkout-route.js"));
    const EV = require(path.join(OUT, "verified-stay-evidence.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    // ── Fake Supabase, driven by mutable BIDS / EVIDENCE maps ─────────────────
    let BIDS = {}; // bidId → row
    let EVIDENCE = {}; // evidence-id (vse_bid_<bidId>) → row
    let evidenceWrites = []; // authoritative POSTs to verified_stay_evidence
    let EVIDENCE_READ_FAIL = false; // inject a protected-evidence GET failure
    const evId = (bidId) => `vse_bid_${bidId}`;
    const jsonRes = (data, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: { get: () => null },
    });
    const savedFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || "GET";
      if (u.includes("/rest/v1/bids")) {
        if (method === "PATCH") return jsonRes([{}]); // legacy status side-effect
        const m = u.match(/id=eq\.([^&]+)/);
        const bidId = m ? decodeURIComponent(m[1]) : "";
        const row = BIDS[bidId];
        return jsonRes(row ? [row] : []);
      }
      if (u.includes("/rest/v1/verified_partner_hotel_scope")) {
        if (
          new RegExp(`partner_subject=in\\.\\(${AUTHZ_SUBJECT}\\)`).test(u) ||
          new RegExp(`partner_subject=eq\\.${AUTHZ_SUBJECT}`).test(u)
        )
          return jsonRes([{ hotel_id: HOTEL }]);
        return jsonRes([]);
      }
      if (u.includes("/rest/v1/verified_stay_evidence")) {
        if (method === "POST") {
          let body = {};
          try {
            body = opts && opts.body ? JSON.parse(opts.body) : {};
          } catch {}
          evidenceWrites.push(body);
          return jsonRes([], 201);
        }
        // Protected evidence GET. When injected, simulate an HTTP/read failure so
        // the route's TRI-STATE reader must fail closed (never "not found").
        if (EVIDENCE_READ_FAIL) return jsonRes({ message: "boom" }, 500);
        const m = u.match(/id=eq\.([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : "";
        const row = EVIDENCE[id];
        return jsonRes(row ? [row] : []);
      }
      if (u.includes("/rest/v1/checkin_checkout_logs")) {
        if (method === "POST") return jsonRes([{}]);
        return jsonRes([]); // GET → no existing log
      }
      return jsonRes([]);
    };

    const signP = (claims, opts = {}) =>
      jwt.sign(claims, PARTNER_SECRET, { algorithm: "HS256", ...opts });
    const mkReq = (auth) => ({
      headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? auth : null) },
    });
    const authToken = () => "Bearer " + signP({ sub: AUTHZ_SUBJECT, id: AUTHZ_SUBJECT });

    // Run the real POST; returns { status, body, writes } (writes = evidence
    // POSTs made DURING this call).
    async function call(bidId, auth) {
      evidenceWrites = [];
      const res = await ROUTE.POST(mkReq(auth), { params: Promise.resolve({ bidId }) });
      return { status: res.status, body: res.body, writes: evidenceWrites.slice() };
    }
    // Same, for the checkout route (proof_state='checked_out').
    async function callCheckout(bidId, auth) {
      evidenceWrites = [];
      const res = await CHECKOUT.POST(mkReq(auth), { params: Promise.resolve({ bidId }) });
      return { status: res.status, body: res.body, writes: evidenceWrites.slice() };
    }
    // Seed a bound checked_in protected evidence row for a bid (the state after a
    // legitimate check-in) — the precondition a real checkout builds on.
    const seedCheckedInEvidence = (bidId) => {
      EVIDENCE[evId(bidId)] = {
        id: evId(bidId), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid",
        source_id: bidId, proof_state: "checked_in", verifier_type: "partner",
        verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z",
        check_in_at: "2026-09-12T00:00:00Z", check_out_at: null,
      };
    };
    const seedBid = (bidId, status, extra = {}) => {
      BIDS[bidId] = { id: bidId, hotelId: HOTEL, customerId: CUSTOMER, status, ...extra };
    };

    // ── 1 — POSITIVE: ACCEPTED mints exactly one correct evidence row ─────────
    section("1. ACCEPTED + signed partner + active hotel scope + configured evidence → authoritative write");
    seedBid("bid_ok", "ACCEPTED");
    {
      const r = await call("bid_ok", authToken());
      eqv(r.status, 200, "1.1 ACCEPTED check-in → 200");
      ok(r.body && r.body.ok === true, "1.2 body.ok === true");
      eqv(r.writes.length, 1, "1.3 EXACTLY one authoritative evidence write");
      const w = r.writes[0] || {};
      eqv(w.id, evId("bid_ok"), "1.4 evidence id = deterministic vse_bid_<bidId>");
      eqv(w.customer_id, CUSTOMER, "1.5 evidence customer_id bound to the bid customer");
      eqv(w.hotel_id, HOTEL, "1.6 evidence hotel_id bound to the bid hotel");
      eqv(w.source_type, "bid", "1.7 evidence source_type = bid");
      eqv(w.source_id, "bid_ok", "1.8 evidence source_id = bidId");
      eqv(w.proof_state, "checked_in", "1.9 evidence proof_state = checked_in");
      eqv(w.verifier_type, "partner", "1.10 evidence verifier_type = partner");
      eqv(w.verifier_id, AUTHZ_SUBJECT, "1.11 evidence verifier_id = the VERIFIED partner subject");
      ok(typeof w.check_in_at === "string" && w.check_in_at.length > 0, "1.12 evidence check_in_at stamped");
    }

    // ── 2 — NEGATIVE pre-states: rejected 409, ZERO evidence write ────────────
    section("2. non-ACCEPTED pre-states → 409, ZERO evidence write");
    const NEG = ["PENDING", "COUNTER", "REJECTED", "EXPIRED", "CANCELLED", "DECLINED"];
    let ni = 0;
    for (const st of NEG) {
      ni += 1;
      const bidId = "bid_neg_" + st;
      seedBid(bidId, st);
      const r = await call(bidId, authToken());
      eqv(r.status, 409, `2.${ni} ${st} → 409 (rejected)`);
      eqv(r.writes.length, 0, `2.${ni}w ${st} → ZERO evidence write`);
      ok(r.body && r.body.error === "bid_not_accepted", `2.${ni}e ${st} → error bid_not_accepted`);
    }
    // Unknown + null/undefined status.
    seedBid("bid_unknown", "WEIRD_STATE");
    {
      const r = await call("bid_unknown", authToken());
      eqv(r.status, 409, "2.7 unknown status → 409");
      eqv(r.writes.length, 0, "2.7w unknown status → ZERO evidence write");
    }
    seedBid("bid_nullstatus", null);
    {
      const r = await call("bid_nullstatus", authToken());
      eqv(r.status, 409, "2.8 null status → 409");
      eqv(r.writes.length, 0, "2.8w null status → ZERO evidence write");
    }
    BIDS["bid_nostatus"] = { id: "bid_nostatus", hotelId: HOTEL, customerId: CUSTOMER }; // status undefined
    {
      const r = await call("bid_nostatus", authToken());
      eqv(r.status, 409, "2.9 missing status field → 409");
      eqv(r.writes.length, 0, "2.9w missing status → ZERO evidence write");
    }

    // ── 3 — forgeable payment marker can NEVER bypass the pre-state gate ──────
    section("3. forgeable payment marker on a PENDING bid → still 409, ZERO write (markers not consulted)");
    seedBid("bid_paid_pending", "PENDING", { message: "Razorpay: pay_forged_123 razorpay_payment_id" });
    {
      const r = await call("bid_paid_pending", authToken());
      eqv(r.status, 409, "3.1 PENDING + forged 'Razorpay:' marker → 409 (marker ignored)");
      eqv(r.writes.length, 0, "3.2 PENDING + forged marker → ZERO evidence write");
    }
    // Even an ACCEPTED bid is admitted on STATE alone, not on any paid marker —
    // and a PENDING bid with a marker never is. Prove the gate is state-only.

    // ── 4 — wrong-hotel partner → 403, ZERO write ────────────────────────────
    section("4. partner authorized for a DIFFERENT hotel → 403, ZERO write");
    BIDS["bid_otherhotel"] = { id: "bid_otherhotel", hotelId: "999999", customerId: CUSTOMER, status: "ACCEPTED" };
    {
      const r = await call("bid_otherhotel", authToken());
      eqv(r.status, 403, "4.1 partner not bound to this bid's hotel → 403");
      eqv(r.writes.length, 0, "4.2 wrong-hotel → ZERO evidence write");
    }

    // ── 5 — forged / unsigned / wrong-secret / id-only token → 401 ───────────
    section("5. non-verifiable partner token → 401 (crypto authority preserved)");
    seedBid("bid_auth", "ACCEPTED");
    {
      const wrong = "Bearer " + jwt.sign({ sub: AUTHZ_SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" });
      const r1 = await call("bid_auth", wrong);
      eqv(r1.status, 401, "5.1 wrong-secret forged token → 401");
      eqv(r1.writes.length, 0, "5.1w wrong-secret → ZERO write");

      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const none = `Bearer ${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: AUTHZ_SUBJECT })}.`;
      const r2 = await call("bid_auth", none);
      eqv(r2.status, 401, "5.2 alg:none unsigned token → 401");
      eqv(r2.writes.length, 0, "5.2w alg:none → ZERO write");

      const r3 = await call("bid_auth", "Bearer not.a.jwt");
      eqv(r3.status, 401, "5.3 malformed token → 401");

      const r4 = await call("bid_auth", "Bearer " + signP({ id: AUTHZ_SUBJECT })); // id-only, no sub
      eqv(r4.status, 401, "5.4 id-only token (no sub) → 401 (mandatory-sub preserved)");
      eqv(r4.writes.length, 0, "5.4w id-only → ZERO write");

      const r5 = await call("bid_auth", ""); // no token
      eqv(r5.status, 401, "5.5 missing token → 401");
    }

    // ── 6 — service-role unavailable → fail closed (403), ZERO write ─────────
    section("6. service-role/evidence unavailable → fail-closed, ZERO write");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    ok(EV.evidenceConfigured() === false, "6.1 evidenceConfigured() === false with no service-role key");
    seedBid("bid_unconf", "ACCEPTED");
    {
      const r = await call("bid_unconf", authToken());
      // scope read fails closed → [] → 403 (never reaches a write). Either way,
      // fail-closed = ZERO evidence write.
      ok(r.status === 403 || r.status === 503, "6.2 unconfigured → fail-closed (403/503)");
      eqv(r.writes.length, 0, "6.3 unconfigured → ZERO evidence write");
    }
    process.env.SUPABASE_SERVICE_ROLE_KEY = SVC_KEY;

    // ── 7 — CHECKED_OUT is NOT a new check-in → 409, ZERO write ──────────────
    section("7. CHECKED_OUT source → 409 (completed stay, not a new check-in), ZERO write");
    seedBid("bid_out", "CHECKED_OUT");
    EVIDENCE[evId("bid_out")] = {
      id: evId("bid_out"), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid",
      source_id: "bid_out", proof_state: "checked_out", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z",
      check_in_at: "2026-09-11T00:00:00Z", check_out_at: "2026-09-12T00:00:00Z",
    };
    {
      const r = await call("bid_out", authToken());
      eqv(r.status, 409, "7.1 CHECKED_OUT → 409");
      eqv(r.writes.length, 0, "7.2 CHECKED_OUT → ZERO evidence write");
      ok(r.body && r.body.error === "already_checked_out", "7.3 error already_checked_out");
    }

    // ── 8 — replay/idempotency: no duplicate trusted evidence ───────────────
    section("8. replay — repeated check-in never mints duplicate trusted evidence");
    seedBid("bid_replay", "ACCEPTED");
    {
      const first = await call("bid_replay", authToken());
      eqv(first.status, 200, "8.1 first ACCEPTED check-in → 200");
      eqv(first.writes.length, 1, "8.2 first → exactly one write");
      // Simulate the world after a successful check-in: evidence exists +
      // legacy bids.status advanced to CHECKED_IN.
      EVIDENCE[evId("bid_replay")] = {
        id: evId("bid_replay"), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid",
        source_id: "bid_replay", proof_state: "checked_in", verifier_type: "partner",
        verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z",
        check_in_at: "2026-09-12T00:00:00Z", check_out_at: null,
      };
      BIDS["bid_replay"].status = "CHECKED_IN";
      const second = await call("bid_replay", authToken());
      eqv(second.status, 200, "8.3 replay of a CHECKED_IN source with matching evidence → idempotent 200");
      ok(second.body && second.body.alreadyCheckedIn === true, "8.4 replay → alreadyCheckedIn:true");
      eqv(second.writes.length, 0, "8.5 replay → ZERO new write (no duplicate evidence)");
    }

    // ── 9 — mismatched / malformed pre-existing evidence NOT silently accepted ─
    section("9. mismatched pre-existing evidence → 409, never minted over");
    // (a) ACCEPTED bid but existing evidence bound to a DIFFERENT customer.
    seedBid("bid_mismatch", "ACCEPTED");
    EVIDENCE[evId("bid_mismatch")] = {
      id: evId("bid_mismatch"), customer_id: "ATTACKER_OTHER", hotel_id: HOTEL, source_type: "bid",
      source_id: "bid_mismatch", proof_state: "checked_in", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z", check_in_at: "2026-09-12T00:00:00Z",
      check_out_at: null,
    };
    {
      const r = await call("bid_mismatch", authToken());
      eqv(r.status, 409, "9.1 ACCEPTED + mismatched-customer evidence → 409");
      eqv(r.writes.length, 0, "9.2 mismatched evidence → ZERO write (never overwritten)");
      ok(r.body && r.body.error === "verified_stay_conflict", "9.3 error verified_stay_conflict");
    }
    // (b) CHECKED_IN bid but existing evidence bound to a DIFFERENT hotel.
    seedBid("bid_mismatch2", "CHECKED_IN");
    EVIDENCE[evId("bid_mismatch2")] = {
      id: evId("bid_mismatch2"), customer_id: CUSTOMER, hotel_id: "OTHER_HOTEL", source_type: "bid",
      source_id: "bid_mismatch2", proof_state: "checked_in", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z", check_in_at: "2026-09-12T00:00:00Z",
      check_out_at: null,
    };
    {
      const r = await call("bid_mismatch2", authToken());
      eqv(r.status, 409, "9.4 CHECKED_IN + mismatched-hotel evidence → 409");
      eqv(r.writes.length, 0, "9.5 mismatched evidence → ZERO write");
    }
    // (c) CHECKED_IN bid with NO evidence at all → non-mutating 409 (the mutable
    //     bids.status alone can never authorize a fresh mint).
    seedBid("bid_checkedin_noev", "CHECKED_IN"); // no EVIDENCE seeded
    {
      const r = await call("bid_checkedin_noev", authToken());
      eqv(r.status, 409, "9.6 CHECKED_IN with NO matching evidence → 409 (no fresh mint from bids.status)");
      eqv(r.writes.length, 0, "9.7 CHECKED_IN w/o evidence → ZERO write");
    }

    // ── 10 — missing bid → 404 ───────────────────────────────────────────────
    section("10. missing bid → 404, ZERO write");
    {
      const r = await call("bid_does_not_exist", authToken());
      eqv(r.status, 404, "10.1 unknown bid → 404");
      eqv(r.writes.length, 0, "10.2 unknown bid → ZERO write");
    }

    // ── 12 — CHECK-IN Finding B: full-binding validation + tri-state read ─────
    section("12. check-in — complete-binding validation + fail-closed tri-state read");
    // (a) ACCEPTED + existing checked_OUT evidence → never downgraded → 409.
    seedBid("bid_ci_out", "ACCEPTED");
    EVIDENCE[evId("bid_ci_out")] = {
      id: evId("bid_ci_out"), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid",
      source_id: "bid_ci_out", proof_state: "checked_out", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z",
      check_in_at: "2026-09-11T00:00:00Z", check_out_at: "2026-09-12T00:00:00Z",
    };
    {
      const r = await call("bid_ci_out", authToken());
      eqv(r.status, 409, "12.1 ACCEPTED + existing checked_out evidence → 409 (no downgrade)");
      eqv(r.writes.length, 0, "12.1w → ZERO write");
      ok(r.body && r.body.error === "already_checked_out", "12.1e error already_checked_out");
    }
    // (b) ACCEPTED + same customer/hotel but WRONG source_type → 409 conflict.
    seedBid("bid_ci_wst", "ACCEPTED");
    EVIDENCE[evId("bid_ci_wst")] = {
      id: evId("bid_ci_wst"), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "booking",
      source_id: "bid_ci_wst", proof_state: "checked_in", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z", check_in_at: "2026-09-12T00:00:00Z",
      check_out_at: null,
    };
    {
      const r = await call("bid_ci_wst", authToken());
      eqv(r.status, 409, "12.2 ACCEPTED + wrong source_type binding → 409");
      eqv(r.writes.length, 0, "12.2w → ZERO write (never overwritten)");
      ok(r.body && r.body.error === "verified_stay_conflict", "12.2e error verified_stay_conflict");
    }
    // (c) ACCEPTED + same customer/hotel but WRONG source_id → 409 conflict.
    seedBid("bid_ci_wsid", "ACCEPTED");
    EVIDENCE[evId("bid_ci_wsid")] = {
      id: evId("bid_ci_wsid"), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid",
      source_id: "SOME_OTHER_BID", proof_state: "checked_in", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z", check_in_at: "2026-09-12T00:00:00Z",
      check_out_at: null,
    };
    {
      const r = await call("bid_ci_wsid", authToken());
      eqv(r.status, 409, "12.3 ACCEPTED + wrong source_id binding → 409");
      eqv(r.writes.length, 0, "12.3w → ZERO write");
    }
    // (d) ACCEPTED + a VALID matching checked_in row → idempotent, ZERO rewrite.
    seedBid("bid_ci_valid", "ACCEPTED");
    seedCheckedInEvidence("bid_ci_valid");
    {
      const r = await call("bid_ci_valid", authToken());
      eqv(r.status, 200, "12.4 ACCEPTED + valid checked_in evidence → idempotent 200");
      ok(r.body && r.body.alreadyCheckedIn === true, "12.4b → alreadyCheckedIn:true");
      eqv(r.writes.length, 0, "12.4w → ZERO rewrite of the valid protected row");
    }
    // (e) protected-evidence GET failure → fail closed 503, ZERO write.
    seedBid("bid_ci_readfail", "ACCEPTED");
    EVIDENCE_READ_FAIL = true;
    {
      const r = await call("bid_ci_readfail", authToken());
      eqv(r.status, 503, "12.5 check-in evidence read FAILURE → 503 (fail closed, not 'not found')");
      eqv(r.writes.length, 0, "12.5w → ZERO write (never overwrites on a failed read)");
      ok(r.body && r.body.error === "verified_stay_unavailable", "12.5e error verified_stay_unavailable");
    }
    EVIDENCE_READ_FAIL = false;

    // ── 13 — CHECKOUT Finding A: no alternate CHECKED_OUT evidence bypass ─────
    section("13. checkout — mints checked_out ONLY from CHECKED_IN + valid checked_in evidence");
    // (a) POSITIVE: CHECKED_IN bid + matching checked_in evidence → checked_out.
    seedBid("bid_co_ok", "CHECKED_IN");
    seedCheckedInEvidence("bid_co_ok");
    {
      const r = await callCheckout("bid_co_ok", authToken());
      eqv(r.status, 200, "13.1 CHECKED_IN + valid checked_in evidence → 200");
      ok(r.body && r.body.ok === true, "13.1b body.ok === true");
      eqv(r.writes.length, 1, "13.1w EXACTLY one authoritative evidence write");
      const w = r.writes[0] || {};
      eqv(w.id, evId("bid_co_ok"), "13.1id evidence id = deterministic vse_bid_<bidId>");
      eqv(w.proof_state, "checked_out", "13.1ps proof_state = checked_out");
      eqv(w.customer_id, CUSTOMER, "13.1cu customer_id bound to the bid customer");
      eqv(w.hotel_id, HOTEL, "13.1ho hotel_id bound to the bid hotel");
      eqv(w.source_type, "bid", "13.1st source_type = bid");
      eqv(w.source_id, "bid_co_ok", "13.1si source_id = bidId");
      eqv(w.verifier_id, AUTHZ_SUBJECT, "13.1vi verifier_id = the VERIFIED partner subject");
    }
    // (b) every non-CHECKED_IN pre-state → 409, ZERO write (the alternate bypass).
    const CONEG = ["PENDING", "COUNTER", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED", "DECLINED"];
    let ci = 0;
    for (const st of CONEG) {
      ci += 1;
      const bidId = "bid_co_neg_" + st;
      seedBid(bidId, st); // NO protected evidence
      const r = await callCheckout(bidId, authToken());
      eqv(r.status, 409, `13.2.${ci} checkout on ${st} → 409 (no direct checked_out mint)`);
      eqv(r.writes.length, 0, `13.2.${ci}w ${st} → ZERO evidence write`);
      ok(r.body && r.body.error === "bid_not_checked_in", `13.2.${ci}e ${st} → error bid_not_checked_in`);
    }
    // unknown + null status → 409, zero write.
    seedBid("bid_co_unknown", "WEIRD_STATE");
    {
      const r = await callCheckout("bid_co_unknown", authToken());
      eqv(r.status, 409, "13.3 checkout on unknown status → 409");
      eqv(r.writes.length, 0, "13.3w → ZERO write");
    }
    seedBid("bid_co_null", null);
    {
      const r = await callCheckout("bid_co_null", authToken());
      eqv(r.status, 409, "13.4 checkout on null status → 409");
      eqv(r.writes.length, 0, "13.4w → ZERO write");
    }
    // (c) forged payment marker on a PENDING bid never bypasses checkout either.
    seedBid("bid_co_paid", "PENDING", { message: "Razorpay: pay_forged_777 razorpay_payment_id" });
    {
      const r = await callCheckout("bid_co_paid", authToken());
      eqv(r.status, 409, "13.5 checkout PENDING + forged 'Razorpay:' marker → 409 (marker ignored)");
      eqv(r.writes.length, 0, "13.5w → ZERO write");
    }
    // (d) CHECKED_IN bid but NO protected evidence → 409 (mutable status alone insufficient).
    seedBid("bid_co_noev", "CHECKED_IN"); // no EVIDENCE seeded
    {
      const r = await callCheckout("bid_co_noev", authToken());
      eqv(r.status, 409, "13.6 CHECKED_IN + NO checked_in evidence → 409");
      eqv(r.writes.length, 0, "13.6w → ZERO write (never mint checked_out from bids.status)");
      ok(r.body && r.body.error === "verified_stay_conflict", "13.6e error verified_stay_conflict");
    }
    // (e) CHECKED_IN bid + MISMATCHED evidence (different customer) → 409.
    seedBid("bid_co_mm", "CHECKED_IN");
    EVIDENCE[evId("bid_co_mm")] = {
      id: evId("bid_co_mm"), customer_id: "ATTACKER_OTHER", hotel_id: HOTEL, source_type: "bid",
      source_id: "bid_co_mm", proof_state: "checked_in", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z", check_in_at: "2026-09-12T00:00:00Z",
      check_out_at: null,
    };
    {
      const r = await callCheckout("bid_co_mm", authToken());
      eqv(r.status, 409, "13.7 CHECKED_IN + mismatched-customer evidence → 409");
      eqv(r.writes.length, 0, "13.7w → ZERO write (never overwritten)");
    }
    // (f) idempotent: matching checked_out evidence → success, ZERO rewrite.
    seedBid("bid_co_done", "CHECKED_OUT");
    EVIDENCE[evId("bid_co_done")] = {
      id: evId("bid_co_done"), customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid",
      source_id: "bid_co_done", proof_state: "checked_out", verifier_type: "partner",
      verifier_id: AUTHZ_SUBJECT, verified_at: "2026-09-12T00:00:00Z",
      check_in_at: "2026-09-11T00:00:00Z", check_out_at: "2026-09-12T00:00:00Z",
    };
    {
      const r = await callCheckout("bid_co_done", authToken());
      eqv(r.status, 200, "13.8 CHECKED_OUT + matching checked_out evidence → idempotent 200");
      ok(r.body && r.body.alreadyCheckedOut === true, "13.8b → alreadyCheckedOut:true");
      eqv(r.writes.length, 0, "13.8w → ZERO rewrite");
    }
    // (g) CHECKED_OUT bid but NO evidence → 409 (never mint checked_out).
    seedBid("bid_co_out_noev", "CHECKED_OUT"); // no EVIDENCE
    {
      const r = await callCheckout("bid_co_out_noev", authToken());
      eqv(r.status, 409, "13.9 CHECKED_OUT bid + NO evidence → 409 (never mint)");
      eqv(r.writes.length, 0, "13.9w → ZERO write");
    }
    // (h) checkout evidence-read FAILURE → fail closed 503, ZERO write.
    seedBid("bid_co_readfail", "CHECKED_IN");
    seedCheckedInEvidence("bid_co_readfail");
    EVIDENCE_READ_FAIL = true;
    {
      const r = await callCheckout("bid_co_readfail", authToken());
      eqv(r.status, 503, "13.10 checkout evidence read FAILURE → 503 (fail closed)");
      eqv(r.writes.length, 0, "13.10w → ZERO write");
      ok(r.body && r.body.error === "verified_stay_unavailable", "13.10e error verified_stay_unavailable");
    }
    EVIDENCE_READ_FAIL = false;
    // (i) checkout wrong-hotel partner → 403; forged token → 401 (authority intact).
    BIDS["bid_co_other"] = { id: "bid_co_other", hotelId: "999999", customerId: CUSTOMER, status: "CHECKED_IN" };
    seedCheckedInEvidence("bid_co_other");
    {
      const r = await callCheckout("bid_co_other", authToken());
      eqv(r.status, 403, "13.11 checkout wrong-hotel partner → 403");
      eqv(r.writes.length, 0, "13.11w → ZERO write");
    }
    seedBid("bid_co_forged", "CHECKED_IN");
    seedCheckedInEvidence("bid_co_forged");
    {
      const wrong = "Bearer " + jwt.sign({ sub: AUTHZ_SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" });
      const r = await callCheckout("bid_co_forged", wrong);
      eqv(r.status, 401, "13.12 checkout forged token → 401");
      eqv(r.writes.length, 0, "13.12w → ZERO write");
    }

    global.fetch = savedFetch;
    Module._resolveFilename = origResolve;

    // ── 14 — source scan: neither gate consults forgeable payment markers ────
    section("14. route source — both lifecycle gates read bids.status + protected evidence only");
    // Strip comments so the doc lines (which legitimately NAME the retired
    // markers) don't trip the CODE-only absence checks.
    const stripComments = (s) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const noMarkerRead = (code, tag) => {
      ok(!/bid_paid_amounts/.test(code), `${tag} CODE never reads bid_paid_amounts`);
      // The BID's forgeable marker fields (bid.message / bid?.message /
      // bid["message"] / bid.metadata) must never be read for authorization. (A
      // caught exception's own e?.message in the 500 handler is ordinary error
      // reporting, NOT a bid field — the check is scoped to the `bid` object.)
      ok(
        !/\bbid\s*\??\.\s*message\b/.test(code) &&
          !/\bbid\s*\[\s*["']message["']\s*\]/.test(code) &&
          !/\bbid\s*\??\.\s*metadata\b/.test(code),
        `${tag} CODE never reads the bid's message/metadata payment markers for authorization`
      );
      ok(!/migrations\//.test(code), `${tag} no new migration referenced (source-only remediation)`);
    };
    const checkinCode = stripComments(
      fs.readFileSync(path.join(REPO, "app/api/partner/checkin/[bidId]/route.ts"), "utf8")
    );
    const checkoutCode = stripComments(
      fs.readFileSync(path.join(REPO, "app/api/partner/checkout/[bidId]/route.ts"), "utf8")
    );
    noMarkerRead(checkinCode, "14.1 check-in");
    noMarkerRead(checkoutCode, "14.2 checkout");
    // Check-in admits ONLY an ACCEPTED bid as the NEW-mint pre-state; both routes
    // consult the protected evidence reader + the immutable-binding validator.
    ok(/status\s*!==\s*["']ACCEPTED["']/.test(checkinCode), "14.3 check-in admits ONLY ACCEPTED as the mint pre-state");
    ok(/readVerifiedStayEvidenceForSource/.test(checkinCode), "14.4 check-in reads protected evidence (tri-state)");
    ok(/evidenceBindingMatches/.test(checkinCode), "14.5 check-in validates the complete immutable binding");
    // Checkout requires BOTH a CHECKED_IN bid AND a valid checked_in evidence row.
    ok(/status\s*!==\s*["']CHECKED_IN["']/.test(checkoutCode), "14.6 checkout requires the bid to be CHECKED_IN");
    ok(/!==\s*["']checked_in["']/.test(checkoutCode), "14.7 checkout requires an existing checked_in protected row");
    ok(/readVerifiedStayEvidenceForSource/.test(checkoutCode), "14.8 checkout reads protected evidence (tri-state)");
    ok(/evidenceBindingMatches/.test(checkoutCode), "14.9 checkout validates the complete immutable binding");
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
