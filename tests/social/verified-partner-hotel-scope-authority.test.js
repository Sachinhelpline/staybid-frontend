#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — PARTNER↔HOTEL authority (protected scope) + public-ownership forgery
// fail-closed + google-login server-verified identity.
//   Run: node tests/social/verified-partner-hotel-scope-authority.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL
// lib/auth/verified-partner-hotel-scope.ts + verified-partner-authority.ts +
// verified-partner-authority-factory.ts with the lockfile tsc, then proves:
//   • A validly-signed CUSTOMER token is NOT a partner authority (no active
//     binding → empty scope → rejected).
//   • Partner-hotel scope is resolved ONLY from the protected
//     verified_partner_hotel_scope table — a forged public hotels.ownerId /
//     hotel_room_units.owner_user_id / users row is NEVER read, so it grants no
//     scope.
//   • Only ACTIVE bindings count (status=eq.active), so a revoked/disabled
//     binding grants nothing.
//   • Hotel A partner cannot verify a Hotel B stay.
//   • The protected store is service-role only + fails closed when unconfigured;
//     the writer is idempotent (on_conflict=id) and never anon.
//   • google-login requires a Firebase idToken it verifies SERVER-SIDE (canonical
//     Railway exchange) and NEVER mints an unsigned stub from a claimed email.
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
  "sb.ts": "lib/sb.ts",
  "sb-server.ts": "lib/sb-server.ts",
  "verified-partner-hotel-scope.ts": "lib/auth/verified-partner-hotel-scope.ts",
  "verified-partner-authority.ts": "lib/auth/verified-partner-authority.ts",
  "verified-partner-authority-factory.ts": "lib/auth/verified-partner-authority-factory.ts",
};
const ALIAS = {
  "@/lib/sb": "sb",
  "@/lib/sb-server": "sb-server",
  "@/lib/auth/verified-partner-hotel-scope": "verified-partner-hotel-scope",
  "@/lib/auth/verified-partner-authority": "verified-partner-authority",
  "@/lib/auth/verified-partner-authority-factory": "verified-partner-authority-factory",
};

const PARTNER_SECRET = "sec00b_partner_access_secret_value";
const SVC_KEY = "sec00b_test_service_role_key";

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-vphs-authz-"));
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
    console.log("• Local tsc compile: exit 0, clean (strict) — partner-hotel scope + authority + factory");

    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request))
        return path.join(OUT, ALIAS[request] + ".js");
      return origResolve.call(this, request, ...rest);
    };

    const PA = require(path.join(OUT, "verified-partner-authority.js"));
    const VPHS = require(path.join(OUT, "verified-partner-hotel-scope.js"));
    const FACTORY = require(path.join(OUT, "verified-partner-authority-factory.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    const mkReq = (auth) => ({ headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? auth : null) } });
    const signP = (claims, opts = {}) => jwt.sign(claims, PARTNER_SECRET, { algorithm: "HS256", ...opts });
    const savedFetch = global.fetch;
    const jsonRes = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } });

    // ── Part 1 — cryptographic partner IDENTITY layer (unchanged) ────────────
    section("1. verifyPartnerToken — reject decode-only / forged / expired / RS256; accept a real signed token");
    ok(!!PA.verifyPartnerToken(signP({ sub: "partnerA", id: "partnerA" }), [PARTNER_SECRET]), "1.1 valid HS256 partner token → verified");
    eqv(PA.verifyPartnerToken("not.a.jwt", [PARTNER_SECRET]), null, "1.2 malformed → null");
    eqv(PA.verifyPartnerToken(jwt.sign({ sub: "attacker" }, "WRONGSECRET", { algorithm: "HS256" }), [PARTNER_SECRET]), null, "1.3 wrong-secret forge → null");
    eqv(PA.verifyPartnerToken(signP({ sub: "partnerA" }, { expiresIn: -3600 }), [PARTNER_SECRET]), null, "1.4 expired → null");
    { const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      eqv(PA.verifyPartnerToken(jwt.sign({ sub: "partnerA" }, privateKey, { algorithm: "RS256", expiresIn: "1h" }), [PARTNER_SECRET]), null, "1.5 RS256/Firebase-shaped → null"); }
    eqv(PA.verifyPartnerToken(signP({ sub: "partnerA", id: "partnerB" }), [PARTNER_SECRET]), null, "1.6 id!==sub → null");

    // ── Part 2 — REAL factory resolves scope ONLY from the protected table ───
    section("2. protected partner↔hotel scope — customer rejected, cross-hotel blocked, NO public-table read");
    process.env.SUPABASE_SERVICE_ROLE_KEY = SVC_KEY;
    process.env.JWT_ACCESS_SECRET = PARTNER_SECRET;
    const deps = FACTORY.createPartnerAuthorityDeps({ JWT_ACCESS_SECRET: PARTNER_SECRET });
    let scopeUrl = "", scopeAuth = "", forbiddenRead = "";
    global.fetch = async (url, opts) => {
      const u = String(url);
      // The protected authority table — the ONLY source of scope.
      if (u.includes("/rest/v1/verified_partner_hotel_scope")) {
        scopeUrl = u; scopeAuth = (opts && opts.headers && opts.headers.Authorization) || "";
        // partnerA has an ACTIVE binding to hotelA; nobody else has any.
        if (/partner_subject=in\.\(partnerA\)/.test(u) || /partner_subject=eq\.partnerA/.test(u)) return jsonRes([{ hotel_id: "hotelA" }]);
        return jsonRes([]);
      }
      // Any of these being queried on the authz path is a forgery vector.
      if (/\/rest\/v1\/(hotels|hotel_room_units|users|onboarding_users)\b/.test(u)) { forbiddenRead = u; return jsonRes([{ id: "x", hotelId: "hotelB", ownerId: "attacker", owner_user_id: "attacker" }]); }
      return jsonRes([]);
    };
    try {
      const reqA = mkReq("Bearer " + signP({ sub: "partnerA", id: "partnerA" }));
      const rA = await PA.partnerAuthorizedForHotel(reqA, deps, "hotelA");
      ok(rA.ok === true && rA.subject === "partnerA", "2.1 partner WITH an active binding → authorized for hotelA");
      const rB = await PA.partnerAuthorizedForHotel(reqA, deps, "hotelB");
      ok(rB.ok === false, "2.2 same partner → NOT authorized for hotelB (cross-hotel forgery blocked)");
      // A validly-signed CUSTOMER token with NO binding.
      const reqCust = mkReq("Bearer " + signP({ sub: "cust_self", id: "cust_self" }));
      const rC = await PA.partnerAuthorizedForHotel(reqCust, deps, "hotelA");
      ok(rC.ok === false, "2.3 a validly-signed CUSTOMER token (no binding) is NOT a partner authority");
      ok(forbiddenRead === "", "2.4 authz path NEVER reads public hotels / hotel_room_units / users (forgery ignored)" + (forbiddenRead ? " — read " + forbiddenRead : ""));
      ok(/status=eq\.active/.test(scopeUrl), "2.5 scope query requires status=eq.active (revoked/disabled binding grants nothing)");
      ok(scopeAuth.includes(SVC_KEY), "2.6 scope read authorizes with the service-role key (not anon)");
    } finally { global.fetch = savedFetch; }

    // ── Part 3 — protected store fails closed when unconfigured ──────────────
    section("3. protected scope store — fails closed with NO service-role key (zero network)");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    ok(VPHS.partnerScopeConfigured() === false, "3.1 partnerScopeConfigured false without the service-role key");
    let netTouched = false;
    global.fetch = async () => { netTouched = true; return jsonRes([]); };
    try {
      const ids = await VPHS.readActivePartnerHotelIds(["partnerA"]);
      ok(Array.isArray(ids) && ids.length === 0, "3.2 readActivePartnerHotelIds → [] (fail closed)");
      const act = await VPHS.isPartnerActiveForHotel("partnerA", "hotelA");
      ok(act === false, "3.3 isPartnerActiveForHotel → false (fail closed)");
      const w = await VPHS.writePartnerHotelScope({ subject: "partnerA", hotelId: "hotelA" });
      ok(w.ok === false && w.reason === "service_role_unconfigured", "3.4 write FAILS CLOSED without service-role key");
      ok(netTouched === false, "3.5 ZERO network when unconfigured");
    } finally { global.fetch = savedFetch; }

    // ── Part 4 — protected writer is service-role + idempotent (replay-safe) ─
    section("4. protected scope writer — deterministic/idempotent, service-role (ops path)");
    eqv(VPHS.partnerScopeId("partnerA", "hotelA"), "vphs_partnerA_hotelA", "4.1 deterministic binding id (idempotent per subject+hotel)");
    process.env.SUPABASE_SERVICE_ROLE_KEY = SVC_KEY;
    let wUrl = "", wPrefer = "", wAuth = "";
    global.fetch = async (url, opts) => {
      wUrl = String(url); wPrefer = (opts && opts.headers && opts.headers.Prefer) || ""; wAuth = (opts && opts.headers && opts.headers.Authorization) || "";
      return { ok: true, status: 201, json: async () => [], text: async () => "", headers: { get: () => null } };
    };
    try {
      const w = await VPHS.writePartnerHotelScope({ subject: "partnerA", hotelId: "hotelA", grantedBy: "ops1" });
      ok(w.ok === true, "4.2 write succeeds with the service-role key");
      ok(/verified_partner_hotel_scope/.test(wUrl), "4.3 write targets the protected verified_partner_hotel_scope table");
      ok(/on_conflict=id/.test(wUrl), "4.4 write upserts on the deterministic id (idempotent replay)");
      ok(/merge-duplicates/.test(wPrefer), "4.5 write uses resolution=merge-duplicates (idempotent)");
      ok(wAuth.includes(SVC_KEY), "4.6 write authorizes with the service-role key (not anon)");
    } finally { global.fetch = savedFetch; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.JWT_ACCESS_SECRET; }

    Module._resolveFilename = origResolve;

    // ── Part 5 — google-login: server-verified idToken, NO claimed-email stub ─
    section("5. /api/partner/google-login — server-verified identity, never mints a stub from a claimed email");
    const gl = fs.readFileSync(path.join(REPO, "app/api/partner/google-login/route.ts"), "utf8");
    ok(/body\?\.idToken/.test(gl) && /idToken/.test(gl), "5.1 google-login REQUIRES a Firebase idToken");
    ok(/if \(!idToken\)/.test(gl) && /status: 401/.test(gl), "5.2 missing idToken → 401 (fail closed)");
    ok(/\/api\/auth\/social-login/.test(gl), "5.3 verifies the credential via the canonical Railway social-login exchange (server-side)");
    ok(!/makeStubJwt/.test(gl) && !/alg:\s*["']none["']/.test(gl) && !/staybid_partner_gmail/.test(gl), "5.4 NO unsigned alg:none stub token is minted");
    ok(!/const\s*\{\s*email\s*,\s*name\s*\}\s*=\s*await req\.json\(\)/.test(gl), "5.5 the old claimed-email {email,name} trust is removed");
    ok(/verified\.email/.test(gl) && /verifiedEmail/.test(gl), "5.6 identity is taken from the VERIFIED exchange, not the client body");
    ok(/return\s+String\(d\.token/.test(gl) || /d\.token \|\| d\.accessToken/.test(gl), "5.7 the returned partner token is the REAL signed token from the verified exchange");
    // The client sends the idToken (not a claimed email/name).
    const clientPage = fs.readFileSync(path.join(REPO, "app/partner/page.tsx"), "utf8");
    ok(/getIdToken\(\)/.test(clientPage) && /JSON\.stringify\(\{\s*idToken\s*\}\)/.test(clientPage), "5.8 the partner login client sends the Firebase idToken (no claimed email/name)");

    // ── Part 6 — factory reads ONLY the protected table (static import proof) ─
    section("6. factory security path imports ONLY the protected scope reader");
    const factorySrc = fs.readFileSync(path.join(REPO, "lib/auth/verified-partner-authority-factory.ts"), "utf8");
    // Strip comments so the "no longer reads X" doc lines (which legitimately
    // name the retired tables) don't trip the CODE-only assertions below.
    const factoryCode = factorySrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    ok(/verified-partner-hotel-scope/.test(factorySrc) && /readActivePartnerHotelIds/.test(factoryCode), "6.1 factory resolves scope via the protected readActivePartnerHotelIds");
    ok(!/resolveOwnerIdsCrossPool/.test(factoryCode) && !/resolveOperatedHotelIds/.test(factoryCode), "6.2 factory NO LONGER reads the client-writable owner-ids / operated-hotels resolvers");
    ok(!/hotels\?ownerId/.test(factoryCode) && !/hotel_room_units/.test(factoryCode), "6.3 factory NO LONGER queries hotels.ownerId / hotel_room_units on the authz path");
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
