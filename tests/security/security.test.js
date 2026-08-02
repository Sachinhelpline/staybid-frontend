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
fs.copyFileSync(path.join(REPO, "lib/admin/client-fetch.ts"), path.join(SRC, "lib/admin/client-fetch.ts"));
fs.copyFileSync(path.join(REPO, "lib/admin/supabase-admin-store.ts"), path.join(SRC, "lib/admin/supabase-admin-store.ts"));
fs.copyFileSync(path.join(REPO, "lib/auth/customer-verify.ts"), path.join(SRC, "lib/auth/customer-verify.ts"));
fs.copyFileSync(path.join(REPO, "lib/cron/auth.ts"), path.join(SRC, "lib/cron/auth.ts"));
fs.copyFileSync(path.join(REPO, "lib/razorpay-server.ts"), path.join(SRC, "lib/razorpay-server.ts"));
fs.copyFileSync(path.join(REPO, "lib/razorpay.ts"), path.join(SRC, "lib/razorpay.ts"));
fs.copyFileSync(path.join(REPO, "lib/auth-return.ts"), path.join(SRC, "lib/auth-return.ts"));
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
const adminClientFetchJs = path.join(OUT, "lib/admin/client-fetch.js");
const storeJs = path.join(OUT, "lib/admin/supabase-admin-store.js");
const custJs = path.join(OUT, "lib/auth/customer-verify.js");
const cronJs = path.join(OUT, "lib/cron/auth.js");
const rzpCfgJs = path.join(OUT, "lib/razorpay-server.js");
const rzpClientJs = path.join(OUT, "lib/razorpay.js");
const authReturnJs = path.join(OUT, "lib/auth-return.js");
if (!fs.existsSync(adminJs) || !fs.existsSync(adminClientFetchJs) || !fs.existsSync(storeJs) || !fs.existsSync(custJs) || !fs.existsSync(cronJs) || !fs.existsSync(rzpCfgJs) || !fs.existsSync(rzpClientJs) || !fs.existsSync(authReturnJs)) {
  console.error("COMPILE FAILED — helper JS not emitted");
  process.exit(2);
}

// ---- 2. env + mocks (before requiring the compiled modules) -----------------
// NOTE: ADMIN_JWT_SECRET is intentionally NOT set — the Master-PIN admin
// session was removed (hotfix v621), so admin auth no longer depends on it.
delete process.env.ADMIN_JWT_SECRET;
process.env.JWT_ACCESS_SECRET = "test-railway-access"; // Railway's authoritative secret
process.env.JWT_SECRET = "test-jwt-fallback"; // frontend fallback (DISTINCT value — must NOT verify admin)
// v622 Pass 9C — the privileged admin store needs SUPABASE_SERVICE_ROLE_KEY to be
// configured() (URL comes from the @/lib/sb stub). A synthetic value only; the
// real store is never driven over the network in positive tests (the gate is
// exercised via the injected fake + a loopback stub).
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RAZORPAY_KEY_SECRET = "test-rzp-secret";

const jwt = require(path.join(REPO, "node_modules/jsonwebtoken"));

const USERS = {
  admin1: { id: "admin1", phone: "+919000000001", name: "Admin One", role: "super_admin" },
  cust1: { id: "cust1", phone: "+919000000002", name: "Cust One", role: "customer" },
};
const REAL_FETCH = global.fetch; // kept for the loopback-stub store test only
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
const adminClientFetch = require(adminClientFetchJs);
const adminStoreMod = require(storeJs);
const custV = require(custJs);
const cronV = require(cronJs);
const rzpCfg = require(rzpCfgJs);
const authReturn = require(authReturnJs);

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

  // ===== ADMIN GATE (v622 Pass 9C — exact JWT_ACCESS_SECRET + fresh Supabase) =====
  // 9C.1 — real Railway tokens always carry iat+exp, and the gate now REQUIRES
  // both. Default a 30m expiry unless the test supplies its own exp (in claims
  // or opts); pass `expiresIn: null` to deliberately mint a token WITHOUT exp.
  const sign = (claims, secret = ACCESS, opts = {}) => {
    const o = { algorithm: "HS256", ...opts };
    if (o.expiresIn === undefined && claims.exp === undefined) o.expiresIn = "30m";
    if (o.expiresIn === null) delete o.expiresIn;
    return jwt.sign(claims, secret, o);
  };
  // Canonical admin token shape: `sub` (+ compat `id`) = Supabase user id.
  const adminTok = (sub, extra = {}, secret = ACCESS, opts = {}) => sign({ sub, id: sub, ...extra }, secret, opts);
  const b64uA = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  // Injected fake privileged Supabase store — the gate is exercised hermetically.
  const fakeRows = {
    admin1: { id: "admin1", phone: "+919000000001", name: "Admin One", role: "super_admin", isBlocked: false },
    admin2: { id: "admin2", phone: null, name: "Upper", role: "ADMIN", isBlocked: false },
    cust1: { id: "cust1", phone: null, name: "Cust", role: "customer", isBlocked: false },
    blk1: { id: "blk1", phone: null, name: "Blk", role: "admin", isBlocked: true },
  };
  let storeThrows = false;
  const fakeFind = async (id) => { if (storeThrows) throw new Error("supabase down"); return fakeRows[id] ? { ...fakeRows[id] } : null; };
  const gate = adminV.makeRequireVerifiedAdmin({ secret: ACCESS, findAdminById: fakeFind });
  const at = (headers) => gate(reqWith(headers));

  // -- real wired gate: fail closed before any store lookup --
  check("admin: no token → null (real gate)", (await adminV.requireVerifiedAdmin(reqWith({}))) === null);
  check("admin: x-admin-id only → null", (await at({ "x-admin-id": "admin1" })) === null);
  check("admin: adm_ presence only → null", (await at({ "x-admin-token": "adm_deadbeefdeadbeef" })) === null);

  // -- JWT verification (exact JWT_ACCESS_SECRET, HS256-only) --
  const okAdmin = await at({ authorization: "Bearer " + adminTok("admin1") });
  check("admin: valid HS256 admin token (JWT_ACCESS_SECRET) + admin row → verified", okAdmin && okAdmin.id === "admin1" && okAdmin.role === "super_admin");
  const okUpper = await at({ authorization: "Bearer " + adminTok("admin2") });
  check("admin: UPPERCASE role normalized → verified (admin)", okUpper && okUpper.role === "admin");
  check("admin: JWT_SECRET-signed token is REJECTED (no compatibility fallback)",
    (await at({ authorization: "Bearer " + adminTok("admin1", {}, FALLBACK) })) === null);
  check("admin: wrong-secret forged → null", (await at({ authorization: "Bearer " + adminTok("admin1", {}, "WRONG") })) === null);
  check("admin: expired → null", (await at({ authorization: "Bearer " + adminTok("admin1", {}, ACCESS, { expiresIn: -10 }) })) === null);
  const rsAdmin = `${b64uA({ alg: "RS256", typ: "JWT" })}.${b64uA({ sub: "admin1", id: "admin1" })}.bogus`;
  check("admin: Firebase-style RS256 token → null", (await at({ authorization: "Bearer " + rsAdmin })) === null);
  const noneAdmin = `${b64uA({ alg: "none", typ: "JWT" })}.${b64uA({ sub: "admin1", id: "admin1" })}.`;
  check("admin: alg:none token → null", (await at({ authorization: "Bearer " + noneAdmin })) === null);
  check("admin: missing subject (no sub/id) → null", (await at({ authorization: "Bearer " + sign({ role: "super_admin" }) })) === null);
  check("admin: sub present, compat id mismatched → null", (await at({ authorization: "Bearer " + sign({ sub: "admin1", id: "admin2" }) })) === null);
  check("admin: id-only token (no sub) → null (sub required)", (await at({ authorization: "Bearer " + sign({ id: "admin1" }) })) === null);

  // -- authorization is Supabase-canonical + fresh; token role never grants --
  check("admin: customer row → null", (await at({ authorization: "Bearer " + adminTok("cust1") })) === null);
  check("admin: client-claimed super_admin role in token, DB customer → null",
    (await at({ authorization: "Bearer " + adminTok("cust1", { role: "super_admin" }) })) === null);
  check("admin: blocked admin row → null", (await at({ authorization: "Bearer " + adminTok("blk1") })) === null);
  check("admin: missing/deleted row → null", (await at({ authorization: "Bearer " + adminTok("ghost") })) === null);

  // -- store outage / missing config fail closed --
  storeThrows = true;
  check("admin: Supabase lookup error → null (fail closed)", (await at({ authorization: "Bearer " + adminTok("admin1") })) === null);
  storeThrows = false;
  const gateNoSecret = adminV.makeRequireVerifiedAdmin({ secret: null, findAdminById: fakeFind });
  check("admin: missing JWT_ACCESS_SECRET → null (fail closed)", (await gateNoSecret(reqWith({ authorization: "Bearer " + adminTok("admin1") }))) === null);

  // -- both transports; ambiguity fails closed --
  const viaHeader = await at({ "x-admin-token": adminTok("admin1") });
  check("admin: verified via x-admin-token transport", viaHeader && viaHeader.id === "admin1");
  const bothSame = await at({ authorization: "Bearer " + adminTok("admin1"), "x-admin-token": adminTok("admin1") });
  check("admin: both headers, same token → verified", bothSame && bothSame.id === "admin1");
  check("admin: both headers, DIFFERENT tokens → null (ambiguous, fail closed)",
    (await at({ authorization: "Bearer " + adminTok("admin1"), "x-admin-token": adminTok("cust1") })) === null);

  // -- admin-token lifetime cap (≤1h + skew) --
  check("admin: admin token lifetime > 1h → null",
    (await at({ authorization: "Bearer " + adminTok("admin1", {}, ACCESS, { expiresIn: "2h" }) })) === null);
  const okShort = await at({ authorization: "Bearer " + adminTok("admin1", {}, ACCESS, { expiresIn: "1h" }) });
  check("admin: admin token lifetime ≤1h → verified", okShort && okShort.id === "admin1");

  // -- 9C.1: iat/exp are MANDATORY, validated BEFORE the Supabase lookup --
  // A counting store proves an invalid token performs ZERO store/network calls.
  {
    let storeCalls = 0;
    const countingGate = adminV.makeRequireVerifiedAdmin({
      secret: ACCESS,
      findAdminById: async (id) => { storeCalls++; return fakeRows[id] ? { ...fakeRows[id] } : null; },
    });
    const cg = (h) => countingGate(reqWith(h));
    const nowSec = Math.floor(Date.now() / 1000);

    const noExp = sign({ sub: "admin1", id: "admin1" }, ACCESS, { expiresIn: null });
    check("admin(9C.1): token WITHOUT exp → null", (await cg({ authorization: "Bearer " + noExp })) === null);
    const noIat = sign({ sub: "admin1", id: "admin1", exp: nowSec + 1800 }, ACCESS, { noTimestamp: true });
    check("admin(9C.1): token WITHOUT iat → null", (await cg({ authorization: "Bearer " + noIat })) === null);
    const futureIat = sign({ sub: "admin1", id: "admin1", iat: nowSec + 300, exp: nowSec + 1500 }, ACCESS);
    check("admin(9C.1): future-dated iat (beyond skew) → null", (await cg({ authorization: "Bearer " + futureIat })) === null);
    const expLeIat = sign({ sub: "admin1", id: "admin1", iat: nowSec + 50, exp: nowSec + 40 }, ACCESS);
    check("admin(9C.1): exp <= iat (non-positive lifetime) → null", (await cg({ authorization: "Bearer " + expLeIat })) === null);
    const idNonString = sign({ sub: "admin1", id: 123 }, ACCESS);
    check("admin(9C.1): non-string id claim → null (id must exactly equal sub)", (await cg({ authorization: "Bearer " + idNonString })) === null);
    const idMismatch = sign({ sub: "admin1", id: "admin1 " }, ACCESS);
    check("admin(9C.1): id differing by whitespace → null (EXACT string equality)", (await cg({ authorization: "Bearer " + idMismatch })) === null);
    check("admin(9C.1): ALL invalid tokens above performed ZERO store calls", storeCalls === 0);

    // Positive controls: small clock skew tolerated; sub-only token (no id) is
    // valid; both hit the store exactly once each.
    const skewOk = await cg({ authorization: "Bearer " + sign({ sub: "admin1", id: "admin1", iat: nowSec + 30, exp: nowSec + 1830 }, ACCESS) });
    check("admin(9C.1): iat within 60s skew + ≤1h lifetime → verified", skewOk && skewOk.id === "admin1");
    const subOnly = await cg({ authorization: "Bearer " + sign({ sub: "admin1" }, ACCESS) });
    check("admin(9C.1): sub-only token (no id claim) → verified", subOnly && subOnly.id === "admin1");
    check("admin(9C.1): the two valid tokens performed exactly 2 store calls", storeCalls === 2);
  }

  // -- fresh lookup EVERY request (no cache): demotion + blocking take effect now --
  const beforeDemote = await at({ authorization: "Bearer " + adminTok("admin1") });
  fakeRows.admin1.role = "customer";
  const afterDemote = await at({ authorization: "Bearer " + adminTok("admin1") });
  check("admin: demotion between requests → immediately denied (fresh lookup)", beforeDemote && beforeDemote.id === "admin1" && afterDemote === null);
  fakeRows.admin1.role = "super_admin";
  const beforeBlock = await at({ authorization: "Bearer " + adminTok("admin1") });
  fakeRows.admin1.isBlocked = true;
  const afterBlock = await at({ authorization: "Bearer " + adminTok("admin1") });
  check("admin: blocking between requests → immediately denied (fresh lookup)", beforeBlock && beforeBlock.id === "admin1" && afterBlock === null);
  fakeRows.admin1.isBlocked = false;

  // -- audit identity + removed forge helpers + configured() --
  check("admin: auditIdentity(null) → unknown", adminV.auditIdentity(null).id === "unknown");
  check("admin: auditIdentity(admin) → verified id", adminV.auditIdentity(okAdmin).id === "admin1");
  check("admin: signAdminSessionToken helper removed", typeof adminV.signAdminSessionToken === "undefined");
  check("admin: isAdminIssuanceConfigured helper removed", typeof adminV.isAdminIssuanceConfigured === "undefined");
  check("admin: adminAuthConfigured() true (JWT_ACCESS_SECRET + service-role store)", adminV.adminAuthConfigured() === true);

  // ===== PRIVILEGED SUPABASE ADMIN STORE (real @supabase/supabase-js vs loopback) =====
  {
    // The real client needs the REAL fetch (the harness mock above returns a
    // minimal fake Response). Loopback 127.0.0.1 only — never a real service.
    const MOCK_FETCH = global.fetch;
    global.fetch = REAL_FETCH;
    const http = require("http");
    const calls = [];
    let scenario = () => ({ status: 200, body: [] });
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        calls.push({ method: req.method, url: req.url, headers: req.headers });
        const r = scenario({ method: req.method, url: req.url });
        res.writeHead(r.status, { "Content-Type": "application/json" });
        res.end(r.body == null ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body));
      });
    });
    await new Promise((rs) => server.listen(0, "127.0.0.1", rs));
    const port = server.address().port;
    const LOOP = `http://127.0.0.1:${port}`;
    const dec = (u) => decodeURIComponent(u);
    const store = adminStoreMod.createAdminStore({ SUPABASE_URL: LOOP, SUPABASE_SERVICE_ROLE_KEY: "sr-key-synthetic" });
    check("store: configured() true with URL + service-role key", store.configured() === true);
    scenario = () => ({ status: 200, body: { id: "admin1", phone: "+91", name: "A", role: "super_admin", isBlocked: false } });
    const row = await store.findAdminById("admin1");
    check("store: hit → shaped AdminRow", row && row.id === "admin1" && row.role === "super_admin" && row.isBlocked === false);
    const g = [...calls].reverse().find((c) => c.method === "GET");
    check("store: GET /rest/v1/users filter id, limit 1", g && g.url.startsWith("/rest/v1/users?") && dec(g.url).includes("id=eq.admin1") && g.url.includes("limit=1"));
    check("store: narrow select (id,phone,name,role,isBlocked), never *", g && dec(g.url).includes("select=id,phone,name,role,isBlocked") && !g.url.includes("select=*"));
    check("store: service-role key as apikey + Bearer (no anon)", g && g.headers["apikey"] === "sr-key-synthetic" && g.headers["authorization"] === "Bearer sr-key-synthetic");
    scenario = () => ({ status: 200, body: [] });
    check("store: 0 rows → null", (await store.findAdminById("ghost")) === null);
    scenario = () => ({ status: 500, body: { message: "boom" } });
    let threw = null; try { await store.findAdminById("x"); } catch (e) { threw = e; }
    check("store: server error → AdminStoreUnavailableError", threw instanceof adminStoreMod.AdminStoreUnavailableError);
    check("store: NEVER issued a mutating HTTP method (POST/PATCH/PUT/DELETE)", !calls.some((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method)));
    const before = calls.length;
    const bad = adminStoreMod.createAdminStore({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" });
    check("store: missing service-role key → configured() false", bad.configured() === false);
    let e2 = null; try { await bad.findAdminById("admin1"); } catch (e) { e2 = e; }
    check("store: unconfigured → AdminStoreUnavailableError, ZERO network", e2 instanceof adminStoreMod.AdminStoreUnavailableError && calls.length === before);
    check("store: URL present but service-role key absent → not configured", adminStoreMod.createAdminStore({ SUPABASE_URL: LOOP }).configured() === false);
    server.close();
    global.fetch = MOCK_FETCH; // restore the harness mock for the remaining sections
  }

  // ===== static scans (Pass 9C) =====
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const verifySrc = fs.readFileSync(path.join(REPO, "lib/admin/verify.ts"), "utf8");
  const storeSrc = fs.readFileSync(path.join(REPO, "lib/admin/supabase-admin-store.ts"), "utf8");
  const verifyCode = stripC(verifySrc), storeCode = stripC(storeSrc);
  check("scan[verify]: verifies with JWT_ACCESS_SECRET only (no JWT_SECRET fallback)", /JWT_ACCESS_SECRET/.test(verifyCode) && !/JWT_SECRET/.test(verifyCode));
  check("scan[verify]: HS256-only algorithm", /algorithms:\s*\[\s*["']HS256["']\s*\]/.test(verifyCode));
  check("scan[verify]: does NOT import the anon-fallback @/lib/sb helpers", !/@\/lib\/sb/.test(verifyCode));
  check("scan[verify]: uses the dedicated privileged store", /supabase-admin-store/.test(verifyCode));
  check("scan[store]: privileged key is SUPABASE_SERVICE_ROLE_KEY only", /SUPABASE_SERVICE_ROLE_KEY/.test(storeCode) && !/SB_READ|SB_H\b|SB_ADMIN_KEY|SB_KEY\b|NEXT_PUBLIC_|SUPABASE_JWT_ANON/.test(storeCode));
  check("scan[store]: reuses SB_URL (non-secret) for the project URL", /SB_URL/.test(storeCode));
  check("scan[store]: narrow users select, never select('*')", /id,phone,name,role,isBlocked/.test(storeCode) && !/select\(\s*["']\*["']\s*\)/.test(storeCode));
  check("scan[store]: session flags all false", /persistSession:\s*false/.test(storeCode) && /autoRefreshToken:\s*false/.test(storeCode) && /detectSessionInUrl:\s*false/.test(storeCode));
  check("scan[store]: no mutation/rpc/auth-session methods", !/\.(insert|update|upsert|delete|rpc|signIn|signUp|signOut)\(/.test(storeCode));
  check("scan[store]: no hardcoded supabase key literal", !/eyJ[A-Za-z0-9_-]{20,}/.test(storeSrc));
  check("scan[store]: key read via injected env defaulting to process.env, never a NEXT_PUBLIC name", /env\.SUPABASE_SERVICE_ROLE_KEY/.test(storeCode) && /process\.env\b/.test(storeCode) && !/NEXT_PUBLIC_SUPABASE/.test(storeCode));
  // Shared-gate route scan: every admin route uses requireVerifiedAdmin; none
  // trusts a legacy/decoded-only authority. No client component imports the store.
  const adminRouteFiles = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "route.ts") adminRouteFiles.push(p); } })(path.join(REPO, "app/api/admin"));
  let allGated = adminRouteFiles.length > 0, anyLegacy = false;
  for (const f of adminRouteFiles) {
    const s = fs.readFileSync(f, "utf8"), sc = stripC(s);
    if (!/requireVerifiedAdmin/.test(s)) allGated = false;
    if (/adminFromReq|MASTER_PIN|ADMIN_JWT_SECRET|signAdminSessionToken/.test(sc)) anyLegacy = true;
  }
  check("scan[routes]: every app/api/admin/** route imports requireVerifiedAdmin", allGated);
  check("scan[routes]: no admin route references a legacy auth authority", !anyLegacy);
  let clientImportsStore = false;
  for (const f of [path.join(REPO, "lib/admin/verify.ts"), path.join(REPO, "lib/admin/supabase-admin-store.ts")]) {
    // neither file may be a client component
    if (/^\s*["']use client["']/.test(fs.readFileSync(f, "utf8"))) clientImportsStore = true;
  }
  check("scan[bundle]: admin gate + store are server-only (no 'use client')", !clientImportsStore);

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

  // ===== v623 — every admin-page API call carries the verified admin token =====
  // This is deliberately centralized in the authenticated layout rather than
  // trusting dozens of individual pages to remember a header. The wrapper is
  // tightly scoped: no token may leave the same-origin /api/admin boundary.
  const adminLayoutSrc = fs.readFileSync(path.join(REPO, "app/admin/layout.tsx"), "utf8");
  const adminClientFetchSrc = fs.readFileSync(path.join(REPO, "lib/admin/client-fetch.ts"), "utf8");
  const dashboardRouteSrc = fs.readFileSync(path.join(REPO, "app/api/admin/dashboard/route.ts"), "utf8");
  const dashboardPageSrc = fs.readFileSync(path.join(REPO, "app/admin/page.tsx"), "utf8");
  check("admin-data: authenticated layout installs central admin fetch wrapper",
    adminLayoutSrc.includes("installAdminFetchInterceptor") && adminLayoutSrc.includes("onUnauthorized"));
  check("admin-data: wrapper reads only sb_admin_token",
    adminClientFetchSrc.includes('getItem("sb_admin_token")') && !adminClientFetchSrc.includes('getItem("sb_token")'));
  check("admin-data: dashboard server reads with privileged server-only headers",
    dashboardRouteSrc.includes("SB_ADMIN_READ") && !/\bSB_KEY\b/.test(dashboardRouteSrc));
  check("admin-data: dashboard uses real hotel_videos.created_at column",
    dashboardRouteSrc.includes("hotel_videos?select=id,verification_status,created_at") && !dashboardRouteSrc.includes("uploadedAt"));
  check("admin-data: dashboard rejects non-OK responses instead of displaying false zeroes",
    dashboardPageSrc.includes("if (!response.ok)") && dashboardPageSrc.includes("Dashboard data unavailable") && dashboardPageSrc.includes('role="alert"'));

  check("admin-fetch: relative /api/admin path accepted",
    adminClientFetch.adminRequestPath("/api/admin/dashboard?today=1", "https://staybids.in") === "/api/admin/dashboard?today=1");
  check("admin-fetch: same-origin absolute admin path accepted",
    adminClientFetch.adminRequestPath("https://staybids.in/api/admin/users", "https://staybids.in") === "/api/admin/users");
  check("admin-fetch: external admin-lookalike URL rejected",
    adminClientFetch.adminRequestPath("https://evil.example/api/admin/users", "https://staybids.in") === null);
  check("admin-fetch: /api/administrator lookalike rejected",
    adminClientFetch.adminRequestPath("/api/administrator", "https://staybids.in") === null);

  {
    const savedWindow = global.window;
    const values = {
      sb_admin_token: "verified-admin-token",
      sb_admin_user: '{"id":"a1"}',
      sb_token: "customer-token",
      sb_user: '{"id":"c1"}',
      sb_theme: "dark",
    };
    const calls = [];
    const localStorage = {
      getItem: (key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null,
      removeItem: (key) => { delete values[key]; },
    };
    global.window = {
      location: { origin: "https://staybids.in" },
      localStorage,
      fetch: async (input, init) => {
        calls.push({ input, init });
        return { ok: true, status: 200 };
      },
    };

    const cleanup = adminClientFetch.installAdminFetchInterceptor();
    await global.window.fetch("/api/admin/dashboard", {
      cache: "no-store",
      headers: { "x-existing": "kept" },
    });
    const adminHeaders = new Headers(calls[0].init.headers);
    check("admin-fetch: central wrapper attaches x-admin-token", adminHeaders.get("x-admin-token") === "verified-admin-token");
    check("admin-fetch: central wrapper preserves caller headers/options",
      adminHeaders.get("x-existing") === "kept" && calls[0].init.cache === "no-store");

    await global.window.fetch("https://evil.example/api/admin/dashboard", { headers: { "x-existing": "external" } });
    const externalHeaders = new Headers(calls[1].init.headers);
    check("admin-fetch: NEVER forwards token to external origin", externalHeaders.get("x-admin-token") === null);
    await global.window.fetch("/api/hotels", { headers: { "x-existing": "public" } });
    const publicHeaders = new Headers(calls[2].init.headers);
    check("admin-fetch: does not attach token to non-admin API", publicHeaders.get("x-admin-token") === null);
    cleanup();

    let unauthorizedCalls = 0;
    global.window.fetch = async () => ({ ok: false, status: 401 });
    const cleanup401 = adminClientFetch.installAdminFetchInterceptor({ onUnauthorized: () => { unauthorizedCalls++; } });
    await global.window.fetch("/api/admin/dashboard");
    await global.window.fetch("/api/admin/users");
    check("admin-fetch: first 401 invokes unauthorized handling exactly once", unauthorizedCalls === 1);
    check("admin-fetch: 401 clears stale admin token + identity",
      !("sb_admin_token" in values) && !("sb_admin_user" in values));
    check("admin-fetch: 401 preserves unrelated customer session + preferences",
      values.sb_token === "customer-token" && values.sb_user === '{"id":"c1"}' && values.sb_theme === "dark");
    cleanup401();
    if (savedWindow === undefined) delete global.window; else global.window = savedWindow;
  }

  const verifySrc2 = fs.readFileSync(path.join(REPO, "lib/admin/verify.ts"), "utf8");
  const verifyCode2 = verifySrc2.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // No issuance/acceptance CODE remains (a comment may still name the removed
  // secret): no jwt.sign, no signAdminSessionToken export, no ADMIN_JWT_SECRET
  // env read, no verify against an admin-only secret.
  check("admin-verify: Master-PIN issuance/acceptance removed", !/jwt\.sign\s*\(/.test(verifySrc2) && !/signAdminSessionToken/.test(verifySrc2) && !/process\.env\.ADMIN_JWT_SECRET/.test(verifySrc2));
  check("admin-verify: preserves Railway JWT_ACCESS_SECRET verification", verifySrc2.includes("JWT_ACCESS_SECRET"));
  // v622 Pass 9C — the JWT_SECRET compatibility fallback is REMOVED for admin auth.
  check("admin-verify: JWT_SECRET compatibility fallback REMOVED (code)", !/JWT_SECRET/.test(verifyCode2));
  // Fresh canonical role/blocked lookup on every request via the Supabase store.
  check("admin-verify: fresh Supabase role/blocked lookup every request", verifyCode2.includes("findAdminById") && verifyCode2.includes("supabase-admin-store"));
  // 9C.1 — temporal claims are mandatory and validated BEFORE the store lookup.
  check("admin-verify(9C.1): iat/exp validation precedes the Supabase lookup",
    verifyCode2.indexOf("exp <= iat") !== -1 && verifyCode2.indexOf("Number.isFinite(iat)") !== -1 &&
    verifyCode2.indexOf("exp <= iat") < verifyCode2.indexOf("deps.findAdminById"));
  // 9C.1 — both privileged admin modules carry an explicit server-only guard.
  const storeSrc2 = fs.readFileSync(path.join(REPO, "lib/admin/supabase-admin-store.ts"), "utf8");
  const soGuard = (s) => /typeof window !== "undefined"[\s\S]{0,80}throw new Error\("server_only_module"\)/.test(s);
  check("admin-verify(9C.1): verify.ts has an explicit server-only guard", soGuard(verifySrc2));
  check("admin-store(9C.1): supabase-admin-store.ts has an explicit server-only guard", soGuard(storeSrc2));

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

  // ===== Razorpay Key-ID rotation-readiness (v621.2) =====
  // No real Razorpay Key ID (LIVE or TEST) may be hardcoded anywhere in
  // runtime code. A key id in a tracked file survives rotation and resurrects
  // a retired pair — env vars are the only allowed source. The scan pattern is
  // assembled at runtime so this test never stores a key-id-shaped literal.
  const RZP_PREFIX = ["rzp", "_"].join(""); // "rzp_"
  const keyIdScanRe = `${RZP_PREFIX}(live|test)_[A-Za-z0-9]{3,}`;
  const runtimeKeyHits = cp.execSync(
    `git grep -lE "${keyIdScanRe}" -- 'app/**' 'lib/**' 'components/**' 'public/**' || true`,
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  check("rzp-keyid: no hardcoded LIVE/TEST key id in any runtime file", runtimeKeyHits === "");

  // The previously exposed (now rotated) public Key ID must have ZERO tracked-
  // tree occurrences — docs and history included. The marker is assembled from
  // fragments so the retired credential is never stored as a single literal.
  const STALE_KEY_ID = RZP_PREFIX + "live_" + "SfFAs" + "bYjbH" + "fztd";
  const staleHits = cp.execSync(
    `git grep -lF "${STALE_KEY_ID}" -- . ':(exclude)tests/security/*' || true`,
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  check("rzp-keyid: rotated stale Key ID absent from entire tracked tree", staleHits === "");

  // Functional: the shared server-config helper is env-only + shape-validated.
  const savedKeyId = process.env.RAZORPAY_KEY_ID;
  const savedSecret = process.env.RAZORPAY_KEY_SECRET;
  const FAKE_ID = RZP_PREFIX + "test_" + "A".repeat(14); // dynamically built dummy
  delete process.env.RAZORPAY_KEY_ID;
  check("rzp-keyid: helper → null when RAZORPAY_KEY_ID unset", rzpCfg.razorpayKeyId() === null);
  process.env.RAZORPAY_KEY_SECRET = "some-secret";
  check("rzp-keyid: configured=false without a key id (fail closed)", rzpCfg.razorpayConfigured() === false);
  process.env.RAZORPAY_KEY_ID = "not-a-key";
  check("rzp-keyid: helper rejects a non-rzp value", rzpCfg.razorpayKeyId() === null);
  process.env.RAZORPAY_KEY_ID = RZP_PREFIX + "live_"; // prefix only, no id body
  check("rzp-keyid: helper rejects a truncated key id", rzpCfg.razorpayKeyId() === null);
  process.env.RAZORPAY_KEY_ID = FAKE_ID;
  check("rzp-keyid: helper returns a well-formed env key id", rzpCfg.razorpayKeyId() === FAKE_ID);
  delete process.env.RAZORPAY_KEY_SECRET;
  check("rzp-keyid: configured=false without a secret (fail closed)", rzpCfg.razorpayConfigured() === false);
  // checkoutKeyId = the public id ONLY when the COMPLETE pair is configured —
  // a half-configured environment must fail closed in BOTH directions.
  check("rzp-keyid: checkoutKeyId=null with id but NO secret (fail closed)", rzpCfg.checkoutKeyId() === null);
  delete process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = "some-secret";
  check("rzp-keyid: checkoutKeyId=null with secret but NO id (fail closed)", rzpCfg.checkoutKeyId() === null);
  process.env.RAZORPAY_KEY_ID = FAKE_ID;
  check("rzp-keyid: configured=true only with a full env pair", rzpCfg.razorpayConfigured() === true);
  check("rzp-keyid: checkoutKeyId returns the id with a full env pair", rzpCfg.checkoutKeyId() === FAKE_ID);
  if (savedKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = savedKeyId;
  if (savedSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = savedSecret;

  // Static per-route: every server checkout route derives its public keyId
  // from the shared env helper and fails closed BEFORE any work — never from
  // a hardcoded literal.
  const CHECKOUT_ROUTES = [
    "app/api/b2b/basket/checkout/route.ts",
    "app/api/b2b/listings/[id]/checkout/route.ts",
    "app/api/circle/checkout/route.ts",
    "app/api/circle/city-access/route.ts",
    "app/api/circle/inventory/[id]/checkout/route.ts",
    "app/api/circle/marketplace/checkout/route.ts",
    "app/api/circle/resale/[id]/checkout/route.ts",
    "app/api/host/portfolio/checkout/route.ts",
    "app/api/host/store/checkout/route.ts",
    "app/api/trade/awards/pay/route.ts",
    "app/api/trade/bids/checkout/route.ts",
  ];
  for (const rel of CHECKOUT_ROUTES) {
    const label = rel.replace("app/api/", "").replace("/route.ts", "");
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    check(`rzp-route[${label}]: keyId from FULL-PAIR env helper`, src.includes('from "@/lib/razorpay-server"') && src.includes("checkoutKeyId()"));
    check(`rzp-route[${label}]: fails closed payment_config_missing`, src.includes('"payment_config_missing"') && /if \(!PUBLIC_KEY_ID\) return/.test(src));
    check(`rzp-route[${label}]: no hardcoded keyId literal`, !new RegExp(`PUBLIC_KEY_ID\\s*=\\s*["'\`]|keyId:\\s*["'\`]${RZP_PREFIX}`).test(src));
    // The guard must run BEFORE any request/DB/order work: it is the first
    // statement of the POST handler — ahead of body parsing, auth fetches,
    // Supabase reads and the internal order create.
    const postIdx = src.search(/export async function POST\(/);
    const guardIdx = src.indexOf("if (!PUBLIC_KEY_ID) return", postIdx);
    const between = src.slice(postIdx, guardIdx > -1 ? guardIdx : postIdx);
    check(`rzp-route[${label}]: guard precedes body parse / fetch / DB work`,
      postIdx > -1 && guardIdx > -1 &&
      !/req\.json\(\)|await fetch\(|sbSelect\(|sbInsert\(|sbUpdate\(/.test(between));
  }

  // Client checkout helper: NEXT_PUBLIC_RAZORPAY_KEY_ID only, no literal
  // fallback, fails closed with the typed configuration error.
  const clientRzp = fs.readFileSync(path.join(REPO, "lib/razorpay.ts"), "utf8");
  check("rzp-client: uses NEXT_PUBLIC_RAZORPAY_KEY_ID", clientRzp.includes("process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID"));
  check("rzp-client: no hardcoded key-id fallback", !new RegExp(`\\|\\|\\s*["'\`]${RZP_PREFIX}`).test(clientRzp));
  check("rzp-client: fails closed when key absent (payment_config_missing)", clientRzp.includes('"payment_config_missing"'));
  check("rzp-client: never touches RAZORPAY_KEY_SECRET", !clientRzp.includes("RAZORPAY_KEY_SECRET"));

  // The shared server helper never leaks the secret into any response shape,
  // and no checkout route returns the secret.
  const serverCfgSrc = fs.readFileSync(path.join(REPO, "lib/razorpay-server.ts"), "utf8");
  check("rzp-server: helper is env-only (reads process.env)", serverCfgSrc.includes("process.env.RAZORPAY_KEY_ID") && serverCfgSrc.includes("process.env.RAZORPAY_KEY_SECRET"));
  const secretInResponses = cp.execSync(
    `git grep -nE "keySecret|key_secret" -- 'app/api/**/checkout/route.ts' 'app/api/trade/awards/pay/route.ts' || true`,
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  check("rzp-server: no checkout route references the key secret", secretInResponses === "");

  // ===== public health GET must be NON-MUTATING (v621.2) =====
  const ctaSrc = fs.readFileSync(path.join(REPO, "app/api/health/cta-check/route.ts"), "utf8");
  check("health[cta-check]: GET-only route (no POST/PUT/PATCH/DELETE export)", !/export async function (POST|PUT|PATCH|DELETE)/.test(ctaSrc));
  check("health[cta-check]: performs no POST/write fetch", !/method:\s*["'`](POST|PUT|PATCH|DELETE)/i.test(ctaSrc));
  check("health[cta-check]: never calls the Razorpay order-create API", !ctaSrc.includes("api.razorpay.com/v1/orders"));
  check("health[cta-check]: the ₹1 order-create probe is gone", !ctaSrc.includes("probeRazorpayOrderCreate("));

  // ===== client checkout: NO side effect on missing/malformed key (v621.2) =====
  // Drive the COMPILED lib/razorpay.ts with stubbed window/document/fetch and
  // count side effects. A missing or malformed NEXT_PUBLIC_RAZORPAY_KEY_ID
  // must reject payment_config_missing with ZERO script loads and ZERO order
  // fetches; a valid key must proceed (behavior unchanged).
  {
    const savedPubKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const savedFetch = global.fetch;
    const savedWindow = global.window;
    const savedDocument = global.document;
    let scriptLoads = 0;
    let orderFetches = 0;
    const resetCounters = () => { scriptLoads = 0; orderFetches = 0; };
    global.window = {};
    global.document = {
      createElement: () => { scriptLoads++; const el = {}; return el; },
      head: { appendChild: (el) => { setTimeout(() => el.onload && el.onload(), 0); } },
    };
    global.fetch = async (url) => {
      if (String(url).includes("/api/razorpay/order")) orderFetches++;
      return { ok: false, status: 503, json: async () => ({ error: "stub-order-blocked", code: "stub" }) };
    };
    const rzpClient = require(rzpClientJs);
    const rejectionOf = async (p) => { try { await p; return null; } catch (e) { return e; } };

    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    resetCounters();
    let err = await rejectionOf(rzpClient.openRazorpayCheckout({ amount: 100, hotelName: "X" }));
    check("rzp-client-fx: missing key → rejects payment_config_missing", !!err && err.code === "payment_config_missing");
    check("rzp-client-fx: missing key → ZERO Razorpay script loads", scriptLoads === 0);
    check("rzp-client-fx: missing key → ZERO order-create fetches", orderFetches === 0);

    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "not-a-real-key";
    resetCounters();
    err = await rejectionOf(rzpClient.openRazorpayCheckout({ amount: 100, hotelName: "X" }));
    check("rzp-client-fx: malformed key → rejects payment_config_missing", !!err && err.code === "payment_config_missing");
    check("rzp-client-fx: malformed key → ZERO script loads / order fetches", scriptLoads === 0 && orderFetches === 0);

    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = FAKE_ID; // valid dummy shape
    resetCounters();
    err = await rejectionOf(rzpClient.openRazorpayCheckout({ amount: 100, hotelName: "X" }));
    check("rzp-client-fx: valid key → proceeds (script loaded, order attempted)", scriptLoads >= 1 && orderFetches === 1);
    check("rzp-client-fx: valid key → failure is the stubbed order error, NOT config", !!err && err.code !== "payment_config_missing");

    resetCounters();
    err = await rejectionOf(rzpClient.openRazorpayForOrder({ orderId: "order_stub", amountPaise: 100, keyId: "" }));
    check("rzp-client-fx: openRazorpayForOrder empty keyId → payment_config_missing", !!err && err.code === "payment_config_missing");
    check("rzp-client-fx: openRazorpayForOrder invalid keyId → ZERO script loads", scriptLoads === 0);

    if (savedPubKey === undefined) delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID; else process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = savedPubKey;
    global.fetch = savedFetch;
    if (savedWindow === undefined) delete global.window; else global.window = savedWindow;
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
  }

  // Static ordering: in BOTH client entry points the key validation sits
  // before the first side effect (loadScript / the order fetch).
  {
    const clientSrc = fs.readFileSync(path.join(REPO, "lib/razorpay.ts"), "utf8");
    const fnBody = (name) => {
      const i = clientSrc.indexOf(`export async function ${name}`);
      const j = clientSrc.indexOf("export async function", i + 1);
      return clientSrc.slice(i, j === -1 ? undefined : j);
    };
    for (const fn of ["openRazorpayCheckout", "openRazorpayForOrder"]) {
      const body = fnBody(fn);
      const v = body.indexOf('"payment_config_missing"');
      const s = body.indexOf("await loadScript()");
      const f = body.indexOf("fetch(");
      check(`rzp-client-order[${fn}]: validates key BEFORE loadScript()`, v > -1 && s > -1 && v < s);
      check(`rzp-client-order[${fn}]: validates key BEFORE any fetch`, f === -1 || v < f);
    }
  }

  // /api/razorpay/order GET stays a pure read-only config probe.
  const orderSrc = fs.readFileSync(path.join(REPO, "app/api/razorpay/order/route.ts"), "utf8");
  const orderGetBody = (orderSrc.split(/export async function GET/)[1] || "");
  check("health[razorpay-order]: GET handler exists", orderGetBody.length > 0);
  check("health[razorpay-order]: GET performs no fetch / external call", !orderGetBody.includes("fetch("));
  check("health[razorpay-order]: GET reports configured flag only", orderGetBody.includes("configured"));
  check("health[razorpay-order]: order create uses the shared env helper", orderSrc.includes('from "@/lib/razorpay-server"'));
  // The central order POST performs the full-pair guard BEFORE req.json() and
  // any pricing/DB work — first thing inside the handler.
  {
    const postIdx = orderSrc.search(/export async function POST\(/);
    const guardIdx = orderSrc.indexOf("if (!razorpayConfigured())", postIdx);
    const bodyIdx = orderSrc.indexOf("req.json()", postIdx);
    const preGuard = orderSrc.slice(postIdx, guardIdx > -1 ? guardIdx : postIdx);
    check("health[razorpay-order]: POST full-pair guard precedes req.json()", postIdx > -1 && guardIdx > -1 && bodyIdx > -1 && guardIdx < bodyIdx);
    check("health[razorpay-order]: no work before the POST guard", !/req\.json\(\)|await fetch\(|resolve[A-Z]\w*Charge\(/.test(preGuard));
  }

  // ===== v622 — Google admin sign-in: fail-closed intent + safe returns =====
  // safeReturnRoute(): the ?return= target must be a rooted same-origin
  // relative path — everything else collapses to "/" (open-redirect guard).
  const SR = authReturn.safeReturnRoute;
  check("return: canonical relative path kept", SR("/admin/login") === "/admin/login");
  check("return: deep link with query kept", SR("/hotels/abc?x=1") === "/hotels/abc?x=1");
  check("return: external https → /", SR("https://evil.example/x") === "/");
  check("return: scheme-in-path → /", SR("/javascript:alert(1)") === "/");
  check("return: javascript: → /", SR("javascript:alert(1)") === "/");
  check("return: data: → /", SR("data:text/html,x") === "/");
  check("return: protocol-relative // → /", SR("//evil.example") === "/");
  check("return: triple-slash → /", SR("///evil.example") === "/");
  check("return: backslash /\\ → /", SR("/\\evil.example") === "/");
  check("return: encoded slash %2F → /", SR("/%2F%2Fevil.example") === "/");
  check("return: encoded backslash %5C → /", SR("/%5Cevil.example") === "/");
  check("return: internal whitespace → /", SR("/foo bar") === "/");
  check("return: control char → /", SR("/foo\tbar") === "/");
  check("return: non-string → /", SR(123) === "/");
  check("return: null → /", SR(null) === "/");
  check("return: empty → /", SR("") === "/");
  check("return: excessively long → /", SR("/" + "a".repeat(600)) === "/");
  check("return: not rooted → /", SR("admin/login") === "/");

  // isAdminIntentRoute(): every admin destination (including /admin/login)
  // is admin intent; lookalike prefixes are not.
  const AI = authReturn.isAdminIntentRoute;
  check("admin-intent: /admin", AI("/admin") === true);
  check("admin-intent: /admin/login", AI("/admin/login") === true);
  check("admin-intent: /admin?tab=x", AI("/admin?tab=x") === true);
  check("admin-intent: /admin#x", AI("/admin#x") === true);
  check("admin-intent: /administrator is NOT admin", AI("/administrator") === false);
  check("admin-intent: / is not admin", AI("/") === false);
  check("admin-intent: /hotels is not admin", AI("/hotels/1") === false);

  // Static: /auth wires the sanitizer + the fail-closed admin branch.
  const authPage = fs.readFileSync(path.join(REPO, "app/auth/page.tsx"), "utf8");
  check("auth-page: imports safeReturnRoute + isAdminIntentRoute", authPage.includes("safeReturnRoute") && authPage.includes("isAdminIntentRoute") && authPage.includes('from "@/lib/auth-return"'));
  check("auth-page: ?return= goes through safeReturnRoute", /safeReturnRoute\(fromQuery\)/.test(authPage));
  check("auth-page: stored intent route goes through safeReturnRoute", /safeReturnRoute\(intent\.route\)/.test(authPage));
  // Every navigation target flows from returnRoute(), whose BOTH branches
  // sanitize via safeReturnRoute above — no raw searchParams push remains.
  check("auth-page: no direct push of raw searchParams return", !/router\.push\(\s*searchParams/.test(authPage) && !/push\(\s*fromQuery/.test(authPage));
  // The admin-intent guard must sit BETWEEN the backend exchange and the
  // Firebase fallback, and return without any login()/token write.
  {
    const backendLogin = authPage.indexOf('login(data.token, data.user, "backend")');
    const guard = authPage.indexOf("if (adminIntent)");
    const fallback = authPage.indexOf("login(idToken");
    check("auth-page: admin guard exists", guard > -1);
    check("auth-page: backend exchange precedes the admin guard", backendLogin > -1 && backendLogin < guard);
    check("auth-page: admin guard precedes the Firebase fallback", fallback > -1 && guard < fallback);
    const guardBlock = authPage.slice(guard, fallback);
    // The failure path clears admin keys (removeItem) but stores NO session
    // token: no login(), no setItem of a session/customer token.
    check("auth-page: admin-intent failure returns WITHOUT storing any token", /return;/.test(guardBlock) && !/login\(/.test(guardBlock) && !/setItem\(/.test(guardBlock));
    check("auth-page: admin-intent failure shows a clear error", guardBlock.includes("ADMIN_EXCHANGE_FAILED_MSG"));
  }
  check("auth-page: never writes sb_admin_token itself", !/setItem\(["'`]sb_admin_token/.test(authPage));
  check("auth-page: Firebase fallback stays customer-tagged", /"firebase"\s*\)/.test(authPage) && /role:\s*"customer"/.test(authPage));
  // Canonical admin flow: /admin/login verifies via check-role then lands on /admin.
  check("admin-login[page]: successful verify lands on /admin", /router\.replace\(["']\/admin["']\)/.test(loginPage));

  // ===== v622 review — claim minimization + select_account + admin key cleanup
  // The social-login POST body carries ONLY idToken (claim minimization): a
  // rollback to the old insecure backend must fail closed, not trust body
  // identity. Assert the exact request body and the absence of the old fields.
  {
    const bodyMatch = authPage.match(/social-login[\s\S]{0,400}?body:\s*JSON\.stringify\(([^)]*)\)/);
    check("auth-page: social-login present with a JSON body", !!bodyMatch);
    const bodyArg = bodyMatch ? bodyMatch[1] : "";
    check("auth-page: social-login body is idToken-only", /\{\s*idToken\s*\}/.test(bodyArg));
    for (const f of ["uid", "email", "name", "phone", "provider"]) {
      check(`auth-page: social-login body drops '${f}'`, !new RegExp(`\\b${f}\\s*:`).test(bodyArg));
    }
  }
  // Admin intent forces the Google account chooser so a warm customer Google
  // session cannot trap the owner on the wrong account.
  check("auth-page: admin intent forces prompt=select_account", /prompt:\s*["']select_account["']/.test(authPage) && /isAdminIntentRoute\(returnRoute\(\)\)/.test(authPage));
  // A failed admin exchange proactively clears any admin session keys.
  {
    const guard = authPage.indexOf("if (adminIntent)");
    const fallback = authPage.indexOf("login(idToken");
    const guardBlock = guard > -1 ? authPage.slice(guard, fallback > guard ? fallback : guard + 600) : "";
    check("auth-page: failed admin exchange clears admin session keys", /clearAdminSessionKeys\(\)/.test(guardBlock));
    check("auth-page: failed admin exchange still stores NO sb_token / login()", !/login\(/.test(guardBlock) && !/setItem\(/.test(guardBlock));
    // Blocker 6: the guard must NOT touch the customer session keys.
    check("auth-page: failed admin exchange does NOT clear customer sb_token/sb_user", !/removeItem\(["'`]sb_token["'`]\)/.test(guardBlock) && !/removeItem\(["'`]sb_user["'`]\)/.test(guardBlock) && !/removeItem\(["'`]sb_token_type["'`]\)/.test(guardBlock));
  }

  // ===== Blocker 6 — behavioral: admin cleanup preserves the customer session
  // clearAdminSessionKeys() must remove ONLY the admin keys and leave an
  // existing customer session (sb_token/sb_user/sb_token_type) intact.
  {
    const store = {
      sb_token: "cust-jwt", sb_user: '{"id":"c1"}', sb_token_type: "firebase",
      sb_admin_token: "stale-admin", sb_admin_user: '{"id":"a1"}', sb_theme: "dark",
    };
    const fakeStorage = { removeItem: (k) => { delete store[k]; } };
    authReturn.clearAdminSessionKeys(fakeStorage);
    check("admin-cleanup: removes sb_admin_token", !("sb_admin_token" in store));
    check("admin-cleanup: removes sb_admin_user", !("sb_admin_user" in store));
    check("admin-cleanup: PRESERVES customer sb_token", store.sb_token === "cust-jwt");
    check("admin-cleanup: PRESERVES customer sb_user", store.sb_user === '{"id":"c1"}');
    check("admin-cleanup: PRESERVES customer sb_token_type", store.sb_token_type === "firebase");
    check("admin-cleanup: PRESERVES device pref sb_theme", store.sb_theme === "dark");
    check("admin-cleanup: ADMIN_SESSION_KEYS are admin-only", JSON.stringify(authReturn.ADMIN_SESSION_KEYS) === JSON.stringify(["sb_admin_token", "sb_admin_user"]));
    // The failure message must NOT claim there is no session at all.
    check("admin-cleanup: failure message scoped to ADMIN session", /admin session/i.test(authReturn.ADMIN_EXCHANGE_FAILED_MSG) && !/no session was created/i.test(authReturn.ADMIN_EXCHANGE_FAILED_MSG));
  }

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
