#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1E-R1 — hermetic STRICT customer-domain MEDIA authority test.
//   Run: node tests/social/media-customer-authority.test.js
// ZERO live network / Railway / Supabase / Storage. Compiles the REAL
// lib/auth/media-customer-authority.ts + lib/auth/customer-verify.ts +
// lib/social/upload-session.ts with the lockfile tsc into an OS TEMP dir, then
// drives the gate with locally-signed HS256/RS256 tokens + an INJECTED fresh
// customer lookup. Proves the P1E media authority contract end to end.
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process"), crypto = require("crypto");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eqv(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const ACCESS = "sec00b_p1e_r1_ACCESS_secret_value";     // stands in for JWT_ACCESS_SECRET
const JWTSECRET = "sec00b_p1e_r1_JWT_SECRET_compat_value"; // the compat fallback — must be REJECTED

function mkReq(authHeader, bodyObj) {
  return {
    headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? authHeader : null) },
    json: async () => bodyObj,
  };
}
const OKBODY = { mediaClass: "photo", contentType: "image/jpeg", byteSize: 1024, idempotencyKey: "abcdefgh1234" };

// A fresh-customer lookup that returns a canonical customer for `sub`.
const freshOk = (sub) => async () => ({ id: sub, role: "customer", isBlocked: false });

// Minimal upload-session store fake (for handler wiring T21/T22).
// SEC-00B-P1F-1 — the non-atomic count/insert trio is replaced by the single
// atomic reserveNewSession; the fake returns a matching canonical row so the
// reserved-row invariant passes and the enabled+valid path reaches 200.
function baseStore() {
  return {
    configured: () => true, bucketReady: async () => true, findByOwnerIdem: async () => null,
    reserveNewSession: async (i) => ({
      outcome: "reserved",
      row: {
        id: i.id, owner_user_id: i.owner_user_id, media_class: i.media_class,
        content_type: i.content_type, declared_byte_size: i.declared_byte_size,
        object_key: i.object_key, status: "created",
      },
    }),
    mintSignedUpload: async (k) => ({ token: "tkn", path: k }), authorizeCreated: async () => true,
    refreshAuthorized: async () => true, rejectCreated: async () => true,
  };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-p1e-r1-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    fs.copyFileSync(path.join(REPO, "lib/auth/media-customer-authority.ts"), path.join(SRC, "media-customer-authority.ts"));
    fs.copyFileSync(path.join(REPO, "lib/auth/customer-verify.ts"), path.join(SRC, "customer-verify.ts"));
    fs.copyFileSync(path.join(REPO, "lib/social/upload-session.ts"), path.join(SRC, "upload-session.ts"));
    fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        module: "commonjs", target: "es2020", lib: ["es2020", "dom"], moduleResolution: "node",
        strict: true, esModuleInterop: true, skipLibCheck: true, ignoreDeprecations: "6.0",
        baseUrl: REPO, typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"],
        paths: { "*": ["node_modules/*"] }, rootDir: ".", outDir: "../out", noEmitOnError: true,
      },
      include: ["*.ts"],
    }));
    let TSC; try { TSC = require.resolve("typescript/bin/tsc", { paths: [REPO] }); } catch { throw new Error("COMPILE GATE FAILED — local tsc not installed."); }
    const compile = cp.spawnSync(process.execPath, [TSC, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
    if (compile.status !== 0) throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || ""));
    console.log("• Local tsc compile: exit 0, clean (strict) — media gate + verifier + handler");

    process.env.NODE_PATH = REPO_NM; require("module").Module._initPaths();
    const M = require(path.join(OUT, "media-customer-authority.js"));
    const P = require(path.join(OUT, "upload-session.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    const deps = (over = {}) => ({ secret: ACCESS, fetchCustomer: freshOk("cust_1"), ...over });
    const bearer = (tok) => mkReq("Bearer " + tok);
    const signA = (claims, opts = {}) => jwt.sign(claims, ACCESS, { algorithm: "HS256", ...opts });

    // ── STAGE 1 CRYPTO + STAGE 2 FRESH PROOF ───────────────────────────
    section("T1 valid customer → PASS with canonical id=sub");
    { const tok = signA({ sub: "cust_1", id: "cust_1", role: "customer" }, { expiresIn: "1h" });
      const r = await M.resolveVerifiedMediaCustomer(bearer(tok), deps());
      ok(r && r.id === "cust_1" && r.authorityDomain === "customer", "T1 valid → {id:cust_1, customer}"); }

    section("T2–T12 crypto rejects");
    ok((await M.resolveVerifiedMediaCustomer(mkReq(null), deps())) === null, "T2 missing Authorization → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer("not.a.jwt"), deps())) === null, "T3 malformed → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(jwt.sign({ sub: "x", id: "x" }, "WRONGSECRET", { algorithm: "HS256" })), deps())) === null, "T4 wrong signature → REJECT");
    { const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      ok((await M.resolveVerifiedMediaCustomer(bearer(jwt.sign({ sub: "x", id: "x" }, privateKey, { algorithm: "RS256", expiresIn: "1h" })), deps())) === null, "T5 RS256/Firebase-shaped → REJECT"); }
    ok((await M.resolveVerifiedMediaCustomer(bearer(jwt.sign({ sub: "cust_1", id: "cust_1", role: "customer" }, JWTSECRET, { algorithm: "HS256" })), deps())) === null, "T6 signed with JWT_SECRET compat → REJECT (JWT_ACCESS_SECRET only)");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ id: "cust_1", role: "customer" })), deps())) === null, "T7 missing sub, valid id → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ id: "cust_1" })), deps())) === null, "T8 id-only legacy HS256 → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_2" })), deps())) === null, "T9 sub present + id!==sub → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ user_id: "cust_1" })), deps())) === null, "T10 user_id only → REJECT (never authority)");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_1", role: "admin" })), deps())) === null, "T11 admin role claim → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_1", role: "super_admin" })), deps())) === null, "T12 super_admin role claim → REJECT");

    section("T13–T18 fresh Railway proof + fail-closed");
    { const tok = signA({ sub: "cust_1", id: "cust_1", role: "customer" });
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => null }))) === null, "T13 fresh row missing → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "other", role: "customer", isBlocked: false }) }))) === null, "T14 row id mismatch → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "customer", isBlocked: true }) }))) === null, "T15 blocked customer → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "super_admin", isBlocked: false }) }))) === null, "T16 fresh resolves admin → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => { throw new Error("net"); } }))) === null, "T17 lookup/network failure → FAIL CLOSED");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ secret: undefined }))) === null, "T18 missing verification secret → FAIL CLOSED"); }

    section("T19/T20 canonical owner = verified sub; client cannot override");
    { const tok = signA({ sub: "cust_9", id: "cust_9", role: "customer" });
      const r = await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: freshOk("cust_9") }));
      eqv(r && r.id, "cust_9", "T19 returned id exactly equals verified sub");
      // client attempts to inject another owner id via body/query — gate reads ONLY the Authorization header
      const req2 = mkReq("Bearer " + tok, { ownerUserId: "attacker", owner_user_id: "attacker", id: "attacker" });
      const r2 = await M.resolveVerifiedMediaCustomer(req2, deps({ fetchCustomer: freshOk("cust_9") }));
      eqv(r2 && r2.id, "cust_9", "T20 client-supplied owner id has ZERO authority (id still = sub)"); }

    // ── HANDLER WIRING (route consumes the gate) ────────────────────────
    section("T21 disabled flag → ZERO authority network work; T22 auth reject → ZERO media mutation");
    { let fetched = false; const gate = (r) => M.resolveVerifiedMediaCustomer(r, { secret: ACCESS, fetchCustomer: async (...a) => { fetched = true; return freshOk("cust_1")(...a); } });
      const store = baseStore(); let inserted = false, minted = false;
      store.insertCreated = async () => { inserted = true; return "ok"; };
      store.mintSignedUpload = async (k) => { minted = true; return { token: "t", path: k }; };
      const tok = signA({ sub: "cust_1", id: "cust_1", role: "customer" });
      const disabled = await P.handleUploadSession(mkReq("Bearer " + tok, OKBODY), { verify: gate, store, env: {}, now: () => new Date("2026-09-06T00:00:00Z"), genId: () => "s" });
      eqv(disabled.status, 503, "T21 disabled flag → 503");
      eqv((await disabled.json()).error, "media_upload_sessions_disabled", "T21 disabled code");
      ok(!fetched, "T21 disabled → ZERO fresh-customer network work");
      ok(!inserted && !minted, "T21 disabled → ZERO store work");
      // enabled + invalid auth (bad token) → 401, no mutation
      const badGate = (r) => M.resolveVerifiedMediaCustomer(r, { secret: ACCESS, fetchCustomer: freshOk("cust_1") });
      const rej = await P.handleUploadSession(mkReq("Bearer not.a.jwt", OKBODY), { verify: badGate, store, env: { MEDIA_UPLOAD_SESSION_ENABLED: "true" }, now: () => new Date("2026-09-06T00:00:00Z"), genId: () => "s" });
      eqv(rej.status, 401, "T22 invalid auth → 401");
      ok(!inserted && !minted, "T22 auth reject → ZERO insert / ZERO mint");
      // enabled + valid customer → 200 (proves the gate wires through end to end)
      const good = await P.handleUploadSession(mkReq("Bearer " + tok, OKBODY), { verify: gate, store, env: { MEDIA_UPLOAD_SESSION_ENABLED: "true" }, now: () => new Date("2026-09-06T00:00:00Z"), genId: () => "s" });
      eqv(good.status, 200, "T21/T22 enabled + valid customer → 200");
      ok(fetched, "enabled valid path DID perform the fresh-customer proof"); }

    // ── PRODUCTION TRANSPORT PARSER (strict fail-closed schema) F1–F19 ──
    section("F1–F19 production fresh-proof parser fails closed (no security-field defaulting)");
    const parse = (status, body) => M.parseFreshCustomerProof(status, body);
    const threw = (fn) => { try { fn(); return false; } catch { return true; } };
    { const r = parse(200, { id: "cust_1", role: "CUSTOMER", isBlocked: false });
      ok(r && r.id === "cust_1" && r.role === "CUSTOMER" && r.isBlocked === false, "F1 complete proof → PASS"); }
    ok(threw(() => parse(200, { id: "cust_1" })), "F2 {id} only → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: "CUSTOMER" })), "F3 missing isBlocked → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", isBlocked: false })), "F4 missing role → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: null, isBlocked: false })), "F5 role=null → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: 7, isBlocked: false })) && threw(() => parse(200, { id: "cust_1", role: {}, isBlocked: false })) && threw(() => parse(200, { id: "cust_1", role: ["x"], isBlocked: false })), "F6 role number/object/array → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: "", isBlocked: false })), "F7 role blank → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: "customer", isBlocked: null })), "F8 isBlocked=null → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: "customer", isBlocked: "false" })), "F9 isBlocked='false' → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: "customer", isBlocked: 0 })), "F10 isBlocked=0 → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "cust_1", role: "customer", isBlocked: {} })), "F11 isBlocked={} → FAIL CLOSED");
    ok(threw(() => parse(200, { id: "", role: "customer", isBlocked: false })), "F12 id blank → FAIL CLOSED");
    ok(threw(() => parse(200, { id: 123, role: "customer", isBlocked: false })), "F13 id non-string → FAIL CLOSED");
    ok(threw(() => parse(200, null)) && threw(() => parse(200, "not-json")) && threw(() => parse(200, 42)), "F14 malformed/non-object body → FAIL CLOSED");
    ok(threw(() => parse(401, { id: "cust_1", role: "customer", isBlocked: false })) && threw(() => parse(403, {})) && threw(() => parse(500, {})), "F15 non-2xx → FAIL CLOSED");
    eqv(parse(404, null), null, "F15b 404 → null (canonical customer missing)");
    // F16–F19 semantic checks in resolveVerifiedMediaCustomer (injected fetch)
    { const tok = signA({ sub: "cust_1", id: "cust_1", role: "customer" });
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "other", role: "customer", isBlocked: false }) }))) === null, "F16 fresh id != verified sub → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "customer", isBlocked: true }) }))) === null, "F17 fresh blocked=true → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "admin", isBlocked: false }) }))) === null, "F18 fresh admin role → REJECT");
      ok((await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "SUPER_ADMIN", isBlocked: false }) }))) === null, "F19 fresh super_admin (any case) → REJECT"); }

    // ── T24 + non-regression of the generic verifier / admin gate ───────
    section("T24 generic verifier + strong admin gate untouched");
    const cv = read("lib/auth/customer-verify.ts");
    ok(/verifiedCustomerFromReq/.test(cv) && /JWT_ACCESS_SECRET/.test(cv) && /JWT_SECRET/.test(cv), "generic verifiedCustomerFromReq LEFT INTACT (still two-secret compat)");
    const mc = read("lib/auth/media-customer-authority.ts");
    // Strip comments so the scans check EXECUTABLE code only (the doc comments
    // deliberately mention JWT_SECRET / RS256 to describe what the gate rejects).
    const mcCode = mc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    ok(!/JWT_SECRET\b/.test(mcCode.replace(/JWT_ACCESS_SECRET/g, "")), "media gate code references NO JWT_SECRET fallback");
    ok(/algorithms:\s*\["HS256"\]/.test(mcCode) && !/RS256/.test(mcCode), "media gate code HS256-only, no RS256");
    ok(/makeRequireVerifiedAdmin/.test(read("lib/admin/verify.ts")), "strong admin gate (lib/admin/verify.ts) present + untouched by this packet");
    ok(!/admin\/verify|requireVerifiedAdmin/.test(mcCode), "media gate does not touch the admin gate");
  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
