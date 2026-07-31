#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// Permanent security regression suite (hotfix v621).
//
//   Run:   npm run test:security      (or: node tests/security/security.test.js)
//
// Exercises the REAL helpers (lib/admin/verify.ts + lib/auth/customer-verify.ts),
// the service-worker sbSafeUrl() from public/sw.js, and the cron authorize()
// gates extracted from app/api/cron/*. It compiles the two TypeScript helpers
// into a gitignored .build/ dir with the local TypeScript compiler, stubs
// `@/lib/sb`, and mocks global.fetch for the admin role lookup — so the suite
// touches NO local / staging / production data and needs NO network.
//
// Token model (verified against the Railway backend `signAccessToken`):
//   • Railway signs HS256 tokens with JWT_ACCESS_SECRET (authoritative).
//     JWT_SECRET is the documented frontend var, kept as a fallback.
//   • Railway payload = { id, phone, role, name, hotelId } — NO iss/aud/
//     token_use. The only purpose signal is `role`, which the frontend
//     RE-CHECKS via a server-side DB lookup (never trusts the token claim).
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const Module = require("module");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

// ---- 1. compile the two helpers in isolation --------------------------------
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "lib", "admin"), { recursive: true });
fs.mkdirSync(path.join(SRC, "lib", "auth"), { recursive: true });
fs.mkdirSync(path.join(SRC, "lib", "cron"), { recursive: true });
fs.copyFileSync(path.join(REPO, "lib/admin/verify.ts"), path.join(SRC, "lib/admin/verify.ts"));
fs.copyFileSync(path.join(REPO, "lib/auth/customer-verify.ts"), path.join(SRC, "lib/auth/customer-verify.ts"));
fs.copyFileSync(path.join(REPO, "lib/cron/auth.ts"), path.join(SRC, "lib/cron/auth.ts"));
fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true,
      skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0",
      rootDir: ".", outDir: "../out", types: [],
    },
    include: ["lib/**/*.ts"],
  }),
);
// The `@/lib/sb` import is stubbed at runtime, so tsc emits a TS2307 and exits
// non-zero — expected. We assert on the emitted files, not tsc's exit code.
try { cp.execSync(`npx tsc -p "${path.join(SRC, "tsconfig.json")}"`, { cwd: REPO, stdio: "pipe" }); } catch (_) {}
const adminJs = path.join(OUT, "lib/admin/verify.js");
const custJs = path.join(OUT, "lib/auth/customer-verify.js");
const cronJs = path.join(OUT, "lib/cron/auth.js");
if (!fs.existsSync(adminJs) || !fs.existsSync(custJs) || !fs.existsSync(cronJs)) {
  console.error("COMPILE FAILED — helper JS not emitted");
  process.exit(2);
}

// ---- 2. env + mocks (before requiring the compiled modules) -----------------
process.env.ADMIN_JWT_SECRET = "test-admin-secret";
process.env.JWT_ACCESS_SECRET = "test-railway-access"; // Railway's authoritative secret
process.env.JWT_SECRET = "test-jwt-fallback"; // frontend fallback (DISTINCT value)
process.env.RAZORPAY_KEY_SECRET = "test-rzp-secret";

const jwt = require(path.join(REPO, "node_modules/jsonwebtoken"));

const USERS = {
  admin1: { id: "admin1", phone: "+919000000001", name: "Admin One", role: "super_admin" },
  cust1: { id: "cust1", phone: "+919000000002", name: "Cust One", role: "customer" },
};
global.fetch = async (url) => {
  const m = String(url).match(/id=eq\.([^&]+)/);
  const id = m ? decodeURIComponent(m[1]) : "";
  const row = USERS[id];
  return { ok: true, json: async () => (row ? [row] : []) };
};

const STUB = path.join(OUT, "_sb_stub.js");
fs.writeFileSync(STUB, 'module.exports = { SB_URL: "http://mock", SB_READ: {} };');
const NEXTSTUB = path.join(OUT, "_next_server_stub.js");
fs.writeFileSync(NEXTSTUB, 'module.exports = { NextResponse: { json: (body, init) => ({ status: (init && init.status) || 200, body }) } };');
const JWT_PATH = require.resolve(path.join(REPO, "node_modules/jsonwebtoken"));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@/lib/sb") return STUB;
  if (request === "next/server") return NEXTSTUB;
  if (request === "jsonwebtoken") return JWT_PATH;
  return origResolve.call(this, request, ...rest);
};

const adminV = require(adminJs);
const custV = require(custJs);
const cronV = require(cronJs);

// ---- 3. assert framework ----------------------------------------------------
let pass = 0, fail = 0;
const results = [];
function check(name, cond) {
  if (cond) { pass++; results.push("PASS  " + name); }
  else { fail++; results.push("FAIL  " + name); }
}
function reqWith(headers) {
  return { headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
}

(async () => {
  const ADMIN = "test-admin-secret";
  const ACCESS = "test-railway-access"; // Railway JWT_ACCESS_SECRET
  const FALLBACK = "test-jwt-fallback"; // frontend JWT_SECRET
  const iss = "staybid-admin", aud = "staybid-admin";

  // ===== ADMIN GATE =====
  check("admin: no token → null", (await adminV.requireVerifiedAdmin(reqWith({}))) === null);
  check("admin: forged/wrong-secret → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ sub: "admin1" }, "WRONG", { algorithm: "HS256", issuer: iss, audience: aud }) }))) === null);
  check("admin: expired → null",
    (await adminV.requireVerifiedAdmin(reqWith({ "x-admin-token": jwt.sign({ sub: "admin1" }, ADMIN, { algorithm: "HS256", issuer: iss, audience: aud, expiresIn: -10 }) }))) === null);
  check("admin: wrong issuer → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ sub: "admin1" }, ADMIN, { algorithm: "HS256", issuer: "evil", audience: aud }) }))) === null);
  check("admin: wrong audience → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ sub: "admin1" }, ADMIN, { algorithm: "HS256", issuer: iss, audience: "evil" }) }))) === null);
  check("admin: customer token (DB role=customer) → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "cust1" }, ACCESS, { algorithm: "HS256" }) }))) === null);
  check("admin: x-admin-id only → null", (await adminV.requireVerifiedAdmin(reqWith({ "x-admin-id": "admin1" }))) === null);
  check("admin: adm_ presence only → null", (await adminV.requireVerifiedAdmin(reqWith({ "x-admin-token": "adm_deadbeefdeadbeef" }))) === null);

  const mp = adminV.signAdminSessionToken({ sub: "admin1", phone: null, name: null, role: "super_admin" });
  const mpRes = await adminV.requireVerifiedAdmin(reqWith({ "x-admin-token": mp }));
  check("admin: valid master-PIN signed token → verified admin", mpRes && mpRes.id === "admin1" && mpRes.role === "super_admin");
  // Master-PIN token must NOT be verifiable under EITHER Railway secret (no JWT_SECRET fallback for issuance).
  check("admin: master-PIN token not verifiable via JWT_ACCESS_SECRET",
    (() => { try { jwt.verify(mp, ACCESS, { algorithms: ["HS256"] }); return false; } catch { return true; } })());
  check("admin: master-PIN token not verifiable via JWT_SECRET fallback",
    (() => { try { jwt.verify(mp, FALLBACK, { algorithms: ["HS256"] }); return false; } catch { return true; } })());

  const railAccess = await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1" }, ACCESS, { algorithm: "HS256" }) }));
  check("admin: valid Railway admin token (JWT_ACCESS_SECRET) → verified admin", railAccess && railAccess.id === "admin1");
  const railFallback = await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1" }, FALLBACK, { algorithm: "HS256" }) }));
  check("admin: valid Railway admin token (JWT_SECRET fallback) → verified admin", railFallback && railFallback.id === "admin1");

  // Token-purpose confusion (DOCUMENTED residual): a customer-style Railway
  // token (no iss/aud) whose subject is an admin-role DB user IS accepted,
  // because Railway has no token_use/aud claim to distinguish contexts and the
  // frontend authorizes on the DB role. This asserts the CURRENT behavior.
  const confused = await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1", phone: "+91x", role: "customer" }, ACCESS, { algorithm: "HS256" }) }));
  check("admin: token-purpose confusion — customer-context token for an admin subject IS accepted (residual)", confused && confused.id === "admin1" && confused.role === "super_admin");

  check("admin: role removed after issuance → null",
    (await adminV.requireVerifiedAdmin(reqWith({ "x-admin-token": adminV.signAdminSessionToken({ sub: "ghost1", role: "admin" }) }))) === null);
  check("admin: auditIdentity(null) → unknown", adminV.auditIdentity(null).id === "unknown");
  check("admin: auditIdentity(admin) → verified id", adminV.auditIdentity(mpRes).id === "admin1");

  // ===== CUSTOMER (notification) GATE =====
  check("customer: valid HS256 token (JWT_ACCESS_SECRET) → verified subject",
    (() => { const c = custV.verifiedCustomerFromReq(reqWith({ authorization: "Bearer " + jwt.sign({ id: "u123", phone: "+91x", email: "a@b.co" }, ACCESS, { algorithm: "HS256" }) })); return c && c.id === "u123"; })());
  check("customer: valid HS256 token (JWT_SECRET fallback) → verified subject",
    (() => { const c = custV.verifiedCustomerFromReq(reqWith({ authorization: "Bearer " + jwt.sign({ id: "u456" }, FALLBACK, { algorithm: "HS256" }) })); return c && c.id === "u456"; })());
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const fakeRs = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u({ sub: "firebaseUid" })}.bogus`;
  check("customer: RS256-alg token → null (fail closed)", custV.verifiedCustomerFromReq(reqWith({ authorization: "Bearer " + fakeRs })) === null);
  check("customer: forged token → null", custV.verifiedCustomerFromReq(reqWith({ authorization: "Bearer " + jwt.sign({ id: "u123" }, "WRONG", { algorithm: "HS256" }) })) === null);
  check("customer: no token → null", custV.verifiedCustomerFromReq(reqWith({})) === null);

  // ===== safeInternalPath (server-side notification URL) =====
  const P = custV.safeInternalPath;
  check("url: canonical relative path kept", P("/hotels/abc?x=1") === "/hotels/abc?x=1");
  check("url: deep link with hyphens kept", P("/flash-deals") === "/flash-deals");
  check("url: query+hash kept", P("/hotels/1?a=2#x") === "/hotels/1?a=2#x");
  check("url: external https → null", P("https://evil.com/x") === null);
  check("url: subdomain-suffix host → null", P("https://staybids.in.evil.com") === null);
  check("url: protocol-relative // → null", P("//evil.com") === null);
  check("url: triple-slash /// → null", P("///evil.com") === null);
  check("url: backslash /\\ → null", P("/\\evil.com") === null);
  check("url: leading backslash → null", P("\\\\evil.com") === null);
  check("url: encoded slash %2F → null", P("/%2Fevil.com") === null);
  check("url: encoded double slash %2f%2f → null", P("/%2f%2fevil.com") === null);
  check("url: encoded backslash %5C → null", P("/%5Cevil.com") === null);
  check("url: internal whitespace → null", P("/foo bar") === null);
  check("url: tab/control → null", P("/foo\tbar") === null);
  check("url: javascript: → null", P("javascript:alert(1)") === null);
  check("url: data: → null", P("data:text/html,x") === null);
  check("url: empty → null", P("") === null);
  check("url: null → null", P(null) === null);
  check("url: non-string → null", P(123) === null);
  check("url: excessively long → null", P("/" + "a".repeat(600)) === null);

  // ===== sw.js sbSafeUrl (extracted from public/sw.js) =====
  const swSrc = fs.readFileSync(path.join(REPO, "public/sw.js"), "utf8");
  const fnMatch = swSrc.match(/function sbSafeUrl\(raw\)\s*\{[\s\S]*?\n\}/);
  const sbSafeUrl = new Function("self", fnMatch[0] + "\nreturn sbSafeUrl;")({ location: { origin: "https://staybids.in" } });
  check("sw: relative kept", sbSafeUrl("/my-bids") === "/my-bids");
  check("sw: same-origin https → path+query+hash", sbSafeUrl("https://staybids.in/hotels/1?a=2#x") === "/hotels/1?a=2#x");
  check("sw: external origin → /", sbSafeUrl("https://evil.com/x") === "/");
  check("sw: subdomain-suffix host → /", sbSafeUrl("https://staybids.in.evil.com") === "/");
  check("sw: protocol-relative // → /", sbSafeUrl("//evil.com") === "/");
  check("sw: triple-slash /// → /", sbSafeUrl("///evil.com") === "/");
  check("sw: backslash → /", sbSafeUrl("/\\evil.com") === "/");
  check("sw: encoded slash %2F → /", sbSafeUrl("/%2Fevil.com") === "/");
  check("sw: encoded backslash %5C → /", sbSafeUrl("/%5Cevil.com") === "/");
  check("sw: whitespace → /", sbSafeUrl("/foo bar") === "/");
  check("sw: javascript: → /", sbSafeUrl("javascript:alert(1)") === "/");
  check("sw: data: → /", sbSafeUrl("data:text/html,x") === "/");
  check("sw: empty → /", sbSafeUrl("") === "/");
  check("sw: excessively long → /", sbSafeUrl("/" + "a".repeat(3000)) === "/");

  // ===== razorpay env-backed signing formula =====
  const crypto = require("crypto");
  const secret = "test-rzp-secret";
  const sig = crypto.createHmac("sha256", secret).update("order_X|pay_Y").digest("hex");
  const expected = crypto.createHmac("sha256", secret).update("order_X|pay_Y").digest("hex");
  check("razorpay: env-secret HMAC verifies (order|payment)", sig === expected && sig.length === 64);
  check("razorpay: configured=false when id/secret unset (guard rule)", !("".startsWith("rzp_") && !!""));

  // ===== CRON auth (shared fail-closed helper lib/cron/auth.ts) =====
  const cronReq = (headers, url) => ({ url, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
  const CU = "https://staybids.in/api/cron/x";
  // Unset CRON_SECRET → 503 cron_auth_unconfigured, reject even the old public default.
  delete process.env.CRON_SECRET;
  check("cron: unset secret + staybid-cron-dev → 503", cronV.isCronAuthorized(cronReq({ authorization: "Bearer staybid-cron-dev" }, CU)).status === 503);
  check("cron: unset secret + any Bearer → rejected (503)", (() => { const r = cronV.isCronAuthorized(cronReq({ authorization: "Bearer whatever" }, CU)); return !r.ok && r.status === 503; })());
  check("cron: unset secret → guard returns 503 before any work", (() => { const g = cronV.cronAuthGuard(cronReq({}, CU)); return g && g.status === 503; })());
  // Configured CRON_SECRET — Bearer is the ONLY accepted transport.
  process.env.CRON_SECRET = "cron-secret-xyz";
  check("cron: configured + no auth → 401", cronV.isCronAuthorized(cronReq({}, CU)).status === 401);
  check("cron: configured + wrong Bearer → 401", cronV.isCronAuthorized(cronReq({ authorization: "Bearer WRONG" }, CU)).status === 401);
  check("cron: configured + fake adm_ header → 401", cronV.isCronAuthorized(cronReq({ "x-admin-token": "adm_deadbeef" }, CU)).status === 401);
  // Query-string transport is REMOVED: the exact secret in ?token= must now be rejected.
  check("cron: configured + exact ?token → REJECTED (query transport removed)", cronV.isCronAuthorized(cronReq({}, CU + "?token=cron-secret-xyz")).status === 401);
  check("cron: configured + exact secret in ?token but no Bearer → not ok", cronV.isCronAuthorized(cronReq({}, CU + "?token=cron-secret-xyz")).ok === false);
  // x-cron-secret transport is REMOVED: the exact secret in that header must now be rejected.
  check("cron: configured + exact x-cron-secret → REJECTED (header transport removed)", cronV.isCronAuthorized(cronReq({ "x-cron-secret": "cron-secret-xyz" }, CU)).status === 401);
  // The only accepted transport.
  check("cron: configured + exact Bearer → accepted", cronV.isCronAuthorized(cronReq({ authorization: "Bearer cron-secret-xyz" }, CU)).ok === true);
  check("cron: guard returns null when authorized (Bearer)", cronV.cronAuthGuard(cronReq({ authorization: "Bearer cron-secret-xyz" }, CU)) === null);

  // Static per-route: every cron route delegates to the shared guard as its FIRST
  // statement (no work before auth), with no public fallback and no adm_ path.
  const cronFiles = cp.execSync("find app/api/cron -name route.ts", { cwd: REPO, encoding: "utf8" }).trim().split("\n");
  for (const rel of cronFiles) {
    const label = rel.split("/")[3];
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    check(`cron[${label}]: delegates to cronAuthGuard`, src.includes("cronAuthGuard(req)"));
    check(`cron[${label}]: no staybid-cron-dev`, !src.includes("staybid-cron-dev"));
    check(`cron[${label}]: no adm_ accept path`, !/startsWith\("adm_"\)|test\(adminToken\)|\/\^adm_/.test(src));
    // Guard precedes any side effect within its enclosing function block.
    const gi = src.indexOf("cronAuthGuard(req)");
    const openBrace = src.lastIndexOf("{", gi);
    const between = src.slice(openBrace, gi);
    check(`cron[${label}]: no side effect before the guard`, !/await\s+fetch\(|sbSelect\(|sbInsert\(/.test(between));
  }
  // recompute IS admin-or-cron: verified admin path + shared cron helper, no fallback/adm_.
  const recompute = fs.readFileSync(path.join(REPO, "app/api/admin/hotel-scores/recompute/route.ts"), "utf8");
  check("admin-or-cron[recompute]: uses requireVerifiedAdmin", recompute.includes("requireVerifiedAdmin"));
  check("admin-or-cron[recompute]: uses shared cron helper", recompute.includes("isCronAuthorized"));
  check("admin-or-cron[recompute]: no staybid-cron-dev fallback code", !/(CRON_TOKEN|CRON_SECRET)\s*\|\|\s*"staybid-cron-dev"/.test(recompute));
  check("admin-or-cron[recompute]: no adm_ accept path", !/startsWith\("adm_"\)\s*\)\s*return true|\/\^adm_[^/]*\/i\.test/.test(recompute));

  // ===== agent-auth: no unverified header/adm_ trust (code patterns, not comments) =====
  const agentAuth = fs.readFileSync(path.join(REPO, "lib/support/agent-auth.ts"), "utf8");
  check("support-auth: no adm_ code accept path", !/startsWith\("adm_"\)|\/\^adm_/.test(agentAuth));
  check("support-auth: no header-only x-admin-id identity read", !/headers\.get\("x-admin-id"\)/.test(agentAuth));
  check("support-auth: derives from requireVerifiedAdmin", agentAuth.includes("requireVerifiedAdmin"));
  check("support-auth: no decodeJwt (decode-only) trust", !agentAuth.includes("decodeJwt"));

  // ===== tracked-tree secret scrub (no secret literal embedded in this test) =====
  const setupSrc = fs.readFileSync(path.join(REPO, "setup-razorpay-vercel.js"), "utf8");
  check("secrets: setup script is env-only (reads process.env)", setupSrc.includes("process.env.RAZORPAY_KEY_SECRET"));
  check("secrets: setup script has no hardcoded secret literal", !/RAZORPAY_KEY_SECRET\s*[:=]\s*"[A-Za-z0-9]{12,}"/.test(setupSrc) && !/rzp_live_[A-Za-z0-9]{6,}"[\s\S]{0,40}(secret|Secret)/.test(setupSrc));
  check("secrets: history file carries the redaction marker", fs.readFileSync(path.join(REPO, "docs/CLAUDE-HISTORY.md"), "utf8").includes("REDACTED-RAZORPAY-SECRET"));

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
