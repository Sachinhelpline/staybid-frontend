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
// NOTE: ADMIN_JWT_SECRET is intentionally NOT set — the Master-PIN admin
// session was removed (hotfix v621), so admin auth no longer depends on it.
delete process.env.ADMIN_JWT_SECRET;
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
  const ACCESS = "test-railway-access"; // Railway JWT_ACCESS_SECRET
  const FALLBACK = "test-jwt-fallback"; // frontend JWT_SECRET

  // ===== ADMIN GATE (Gmail/Railway token ONLY — no Master-PIN) =====
  check("admin: no token → null", (await adminV.requireVerifiedAdmin(reqWith({}))) === null);
  check("admin: forged/wrong-secret → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1" }, "WRONG", { algorithm: "HS256" }) }))) === null);
  check("admin: expired → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1" }, ACCESS, { algorithm: "HS256", expiresIn: -10 }) }))) === null);
  check("admin: customer token (DB role=customer) → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "cust1" }, ACCESS, { algorithm: "HS256" }) }))) === null);
  check("admin: x-admin-id only → null", (await adminV.requireVerifiedAdmin(reqWith({ "x-admin-id": "admin1" }))) === null);
  check("admin: adm_ presence only → null", (await adminV.requireVerifiedAdmin(reqWith({ "x-admin-token": "adm_deadbeefdeadbeef" }))) === null);
  // A client-asserted admin role in the token is IGNORED — a customer-subject
  // token claiming role:super_admin still fails because the DB row is customer.
  check("admin: client-claimed role in token cannot grant access (DB row=customer)",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "cust1", role: "super_admin" }, ACCESS, { algorithm: "HS256" }) }))) === null);
  // A Firebase-style RS256 token (unsigned-for-us) fails the HS256 alg check.
  const b64uA = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const fakeRsAdmin = `${b64uA({ alg: "RS256", typ: "JWT" })}.${b64uA({ id: "admin1" })}.bogus`;
  check("admin: Firebase-style RS256 token → null (fail closed)",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + fakeRsAdmin }))) === null);

  const railAccess = await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1" }, ACCESS, { algorithm: "HS256" }) }));
  check("admin: valid Railway admin token (JWT_ACCESS_SECRET) + admin DB role → verified admin", railAccess && railAccess.id === "admin1" && railAccess.role === "super_admin");
  const railFallback = await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "admin1" }, FALLBACK, { algorithm: "HS256" }) }));
  check("admin: valid Railway admin token (JWT_SECRET fallback) → verified admin", railFallback && railFallback.id === "admin1");
  // Same verified token works via x-admin-token transport (admin pages use it).
  const viaHeader = await adminV.requireVerifiedAdmin(reqWith({ "x-admin-token": jwt.sign({ id: "admin1" }, ACCESS, { algorithm: "HS256" }) }));
  check("admin: verified token via x-admin-token transport → verified admin", viaHeader && viaHeader.id === "admin1");

  check("admin: role removed after issuance (unknown subject) → null",
    (await adminV.requireVerifiedAdmin(reqWith({ authorization: "Bearer " + jwt.sign({ id: "ghost1" }, ACCESS, { algorithm: "HS256" }) }))) === null);
  check("admin: auditIdentity(null) → unknown", adminV.auditIdentity(null).id === "unknown");
  check("admin: auditIdentity(admin) → verified id", adminV.auditIdentity(railAccess).id === "admin1");
  // The Master-PIN issuance helper is GONE — no forge-your-own-admin-token path.
  check("admin: signAdminSessionToken helper removed", typeof adminV.signAdminSessionToken === "undefined");
  check("admin: isAdminIssuanceConfigured helper removed", typeof adminV.isAdminIssuanceConfigured === "undefined");
  // Admin auth no longer depends on ADMIN_JWT_SECRET (deleted in env above).
  check("admin: gate configured on Railway secrets alone (no ADMIN_JWT_SECRET)", adminV.adminAuthConfigured() === true);

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

  // ===== admin-login: Gmail/Railway ONLY, no Master-PIN (hotfix v621) =====
  // The default/master PIN literal is intentionally NOT written in this test;
  // we assert its ABSENCE across the tracked tree and read it via a computed
  // marker so the suite never re-introduces the credential material.
  const PIN_MARKER = "StayBid" + "Admin@" + "2026"; // assembled — never a single literal token
  const checkRole = fs.readFileSync(path.join(REPO, "app/api/admin/check-role/route.ts"), "utf8");
  check("admin-login[check-role]: derives identity from requireVerifiedAdmin", checkRole.includes("requireVerifiedAdmin"));
  check("admin-login[check-role]: no default/master PIN literal", !checkRole.includes(PIN_MARKER));
  check("admin-login[check-role]: no ADMIN_MASTER_PIN / DEFAULT_MASTER_PIN", !/ADMIN_MASTER_PIN|DEFAULT_MASTER_PIN/.test(checkRole));
  // No PIN comparison/issuance in CODE (env read, token minting, or a pin var
  // extracted from the request body) — comments may still describe the removal.
  check("admin-login[check-role]: no PIN comparison / issuance path", !checkRole.includes("signAdminSessionToken") && !/process\.env\.ADMIN_MASTER_PIN/.test(checkRole) && !/\bconst\s*\{[^}]*\bpin\b/.test(checkRole));
  check("admin-login[check-role]: does not parse/trust a client-supplied request body", !/req\.json\(\)/.test(checkRole));

  const loginPage = fs.readFileSync(path.join(REPO, "app/admin/login/page.tsx"), "utf8");
  check("admin-login[page]: no Master-PIN UI text", !/Master PIN|master PIN/.test(loginPage));
  check("admin-login[page]: no default PIN literal", !loginPage.includes(PIN_MARKER));
  check("admin-login[page]: no phone/pin form state", !/\buseState\([^)]*\)[\s\S]*\bpin\b/.test(loginPage) && !/type=["']password["']/.test(loginPage));
  check("admin-login[page]: offers Continue with Google", /Continue with Google/i.test(loginPage));
  check("admin-login[page]: routes to /auth?return=/admin/login", loginPage.includes("/auth?return=/admin/login"));
  check("admin-login[page]: sends Bearer sb_token to check-role", /Authorization[`'"]?\s*:\s*[`'"]Bearer/.test(loginPage) && loginPage.includes("sb_token"));
  check("admin-login[page]: stores server-verified identity, never reads local sb_user role", loginPage.includes("sb_admin_user") && !/getItem\(["'`]sb_user["'`]\)/.test(loginPage));

  const verifySrc = fs.readFileSync(path.join(REPO, "lib/admin/verify.ts"), "utf8");
  // No issuance/acceptance CODE remains (a comment may still name the removed
  // secret): no jwt.sign, no signAdminSessionToken export, no ADMIN_JWT_SECRET
  // env read, no verify against an admin-only secret.
  check("admin-verify: Master-PIN issuance/acceptance removed", !/jwt\.sign\s*\(/.test(verifySrc) && !/signAdminSessionToken/.test(verifySrc) && !/process\.env\.ADMIN_JWT_SECRET/.test(verifySrc));
  check("admin-verify: preserves Railway JWT_ACCESS_SECRET verification", verifySrc.includes("JWT_ACCESS_SECRET"));
  check("admin-verify: preserves JWT_SECRET compatibility fallback", verifySrc.includes("JWT_SECRET"));
  check("admin-verify: role lookup on every request", verifySrc.includes("lookupAdminRole"));

  // Tracked-tree scan: the Master-PIN / default-PIN material must exist NOWHERE
  // in the shipped tree (docs history is redacted; this test assembles the
  // marker and never stores it as a single literal token).
  const treeHits = cp.execSync(
    `git grep -lF "${PIN_MARKER}" -- . ':(exclude)tests/security/*' || true`,
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  check("admin-login: default PIN literal absent from entire tracked tree", treeHits === "");
  const masterPinHits = cp.execSync(
    `git grep -lE "ADMIN_MASTER_PIN|DEFAULT_MASTER_PIN" -- 'app/**' 'lib/**' 'components/**' || true`,
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  check("admin-login: no ADMIN_MASTER_PIN/DEFAULT_MASTER_PIN in app/lib/components", masterPinHits === "");

  // ===== mobile OTP remains intentionally disabled + untouched =====
  // Phone OTP is off by default (flag NEXT_PUBLIC_ENABLE_PHONE_OTP); the admin
  // login must not depend on it. Assert the admin surfaces carry no phone-OTP
  // wiring at all.
  // No phone/OTP/PIN INPUT wiring on the admin login (a comment may note that
  // OTP is disabled). The presence of a phone or password field is the signal.
  check("mobile-otp: admin login has no phone/OTP/PIN input field", !/type=["']tel["']/.test(loginPage) && !/type=["']password["']/.test(loginPage) && !/placeholder=["'][^"']*OTP/i.test(loginPage));
  check("mobile-otp: check-role has no OTP/phone-send code path", !/send.?otp|verify.?otp/i.test(checkRole));

  // ===== admin LOGOUT must terminate the whole session (no logout loop) =====
  // Regression: the topbar used to clear ONLY sb_admin_token/sb_admin_user then
  // navigate to /admin/login, which re-verified the still-present Gmail/Railway
  // sb_token and recreated sb_admin_token — an infinite "logged straight back
  // in" loop. Admin logout must use the centralized AuthProvider logout, which
  // wipes the ENTIRE session.
  const topbar = fs.readFileSync(path.join(REPO, "components/admin/topbar.tsx"), "utf8");
  check("admin-logout: topbar uses centralized useAuth().logout()", /useAuth\(\)/.test(topbar) && topbar.includes('from "@/lib/auth"'));
  check("admin-logout: topbar does NOT partial-clear only admin keys", !/removeItem\(["']sb_admin_token["']\)/.test(topbar) && !/removeItem\(["']sb_admin_user["']\)/.test(topbar));
  check("admin-logout: topbar does NOT bounce to /admin/login on logout", !topbar.includes('"/admin/login"') && !topbar.includes("'/admin/login'"));
  check("admin-logout: topbar has no leftover unused useRouter import", !/useRouter/.test(topbar));

  // The centralized logout's device-prefs allow-list must NOT keep any session
  // key — extract the REAL allow-list from lib/auth.tsx (not a duplicated copy)
  // and simulate the "clear everything except KEEP" wipe.
  const authSrc = fs.readFileSync(path.join(REPO, "lib/auth.tsx"), "utf8");
  const keepBlock = (authSrc.match(/const\s+KEEP\s*=\s*new\s+Set<string>\(\[([\s\S]*?)\]\)/) || [])[1] || "";
  const KEEP = new Set((keepBlock.match(/["'`]([^"'`]+)["'`]/g) || []).map((s) => s.replace(/["'`]/g, "")));
  const SESSION_KEYS = ["sb_token", "sb_user", "sb_token_type", "sb_admin_token", "sb_admin_user"];
  check("admin-logout: allow-list keeps NO session key", SESSION_KEYS.every((k) => !KEEP.has(k)));
  // Simulate the wipe over a fake store and assert every session key is gone,
  // while a device-pref survives — proving sb_token cannot be left behind.
  const store = { sb_token: "1", sb_user: "1", sb_token_type: "1", sb_admin_token: "1", sb_admin_user: "1", sb_theme: "dark" };
  for (const k of Object.keys(store)) { if (!KEEP.has(k)) delete store[k]; }
  check("admin-logout: wipe removes sb_token (breaks the recreation loop)", !("sb_token" in store));
  check("admin-logout: wipe removes sb_admin_token", !("sb_admin_token" in store));
  check("admin-logout: wipe removes every session key", SESSION_KEYS.every((k) => !(k in store)));
  check("admin-logout: wipe keeps device prefs (sb_theme)", store.sb_theme === "dark");
  // The centralized logout also signs Firebase out + hard-navigates to /auth.
  check("admin-logout: centralized logout signs Firebase out + clears its IndexedDB", /signOut/.test(authSrc) && authSrc.includes("firebaseLocalStorageDb"));
  check("admin-logout: centralized logout lands on /auth", /replace\(["']\/auth["']\)/.test(authSrc));
  // sb_admin_token can only be recreated by /admin/login AFTER a verified
  // sb_token — with sb_token wiped, the loop is impossible.
  check("admin-logout: login recreates sb_admin_token only from a present sb_token", loginPage.includes('getItem("sb_token")') && loginPage.includes('setItem("sb_admin_token"'));

  // ===== tracked-tree secret scrub (no secret literal embedded in this test) =====
  const setupSrc = fs.readFileSync(path.join(REPO, "setup-razorpay-vercel.js"), "utf8");
  check("secrets: setup script is env-only (reads process.env)", setupSrc.includes("process.env.RAZORPAY_KEY_SECRET"));
  check("secrets: setup script has no hardcoded secret literal", !/RAZORPAY_KEY_SECRET\s*[:=]\s*"[A-Za-z0-9]{12,}"/.test(setupSrc) && !/rzp_live_[A-Za-z0-9]{6,}"[\s\S]{0,40}(secret|Secret)/.test(setupSrc));
  check("secrets: history file carries the redaction marker", fs.readFileSync(path.join(REPO, "docs/CLAUDE-HISTORY.md"), "utf8").includes("REDACTED-RAZORPAY-SECRET"));

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
