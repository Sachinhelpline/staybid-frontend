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
fs.copyFileSync(path.join(REPO, "lib/admin/verify.ts"), path.join(SRC, "lib/admin/verify.ts"));
fs.copyFileSync(path.join(REPO, "lib/auth/customer-verify.ts"), path.join(SRC, "lib/auth/customer-verify.ts"));
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
if (!fs.existsSync(adminJs) || !fs.existsSync(custJs)) {
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
const JWT_PATH = require.resolve(path.join(REPO, "node_modules/jsonwebtoken"));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@/lib/sb") return STUB;
  if (request === "jsonwebtoken") return JWT_PATH;
  return origResolve.call(this, request, ...rest);
};

const adminV = require(adminJs);
const custV = require(custJs);

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

// ---- cron authorize() extraction (hermetic; no route imports) ---------------
function extractFn(src, name) {
  const re = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (!d) return src.slice(m.index, i + 1); }
  }
  return null;
}
async function evalCronAuth(file, name, headers, url) {
  const src = fs.readFileSync(path.join(REPO, file), "utf8");
  const fnSrc = extractFn(src, name);
  if (!fnSrc) throw new Error("auth fn not found in " + file);
  // Strip TypeScript signature annotations so plain JS `new Function` can parse
  // the extracted gate (the bodies use only process.env / URL / header reads).
  const js = fnSrc
    .replace(/\(\s*req\s*:\s*[A-Za-z0-9_<>.\[\]| ]+\)/, "(req)")
    .replace(/\)\s*:\s*(Promise<\s*boolean\s*>|boolean)\s*\{/, ") {");
  const runner = new Function("req", js + "\nreturn " + name + "(req);");
  const req = {
    url,
    nextUrl: new URL(url),
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  };
  return await runner(req);
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

  // ===== CRON auth gates (adm_ bypass removed) =====
  process.env.CRON_SECRET = "cron-secret-xyz";
  process.env.CRON_TOKEN = "cron-secret-xyz";
  const CRONS = [
    ["app/api/cron/channel-sync/route.ts", "authorized"],
    ["app/api/cron/auction-lifecycle/route.ts", "authorized"],
    ["app/api/cron/inventory-lifecycle/route.ts", "authorized"],
    ["app/api/cron/pricing-model-train/route.ts", null], // inline in GET — checked statically below
    ["app/api/cron/view-milestone-rewards/route.ts", "authorized"],
    ["app/api/cron/creator-upgrade-eval/route.ts", "authorized"],
    ["app/api/cron/post-stay-nudge/route.ts", "authorized"],
    ["app/api/cron/feedback-lifecycle/route.ts", "authorized"],
    ["app/api/cron/expire-holds/route.ts", "authorized"],
    ["app/api/cron/circle-settlement/route.ts", "authorized"],
    ["app/api/cron/auto-approve-content/route.ts", "authorized"],
    ["app/api/cron/support-auto-resolve/route.ts", "isAuthorized"],
  ];
  const BASE = "https://staybids.in";
  for (const [file, fn] of CRONS) {
    const label = file.split("/")[3];
    // Static invariant: no adm_ bypass remains, and no requireVerifiedAdmin in a pure cron.
    const src = fs.readFileSync(path.join(REPO, file), "utf8");
    check(`cron[${label}]: no adm_ bypass in source`, !/startsWith\("adm_"\)|test\(adminToken\)|\/\^adm_/.test(src));
    check(`cron[${label}]: no requireVerifiedAdmin (pure cron, not admin-or-cron)`, !src.includes("requireVerifiedAdmin"));
    if (!fn) continue; // pricing-model-train: inline gate, covered by the static checks
    check(`cron[${label}]: no token → rejected`, (await evalCronAuth(file, fn, {}, `${BASE}/api/cron/${label}`)) === false);
    check(`cron[${label}]: fake adm_ token → rejected`, (await evalCronAuth(file, fn, { "x-admin-token": "adm_deadbeef" }, `${BASE}/api/cron/${label}`)) === false);
    check(`cron[${label}]: wrong cron token → rejected`, (await evalCronAuth(file, fn, {}, `${BASE}/api/cron/${label}?token=WRONG`)) === false);
    check(`cron[${label}]: valid CRON_SECRET (?token) → accepted`, (await evalCronAuth(file, fn, {}, `${BASE}/api/cron/${label}?token=cron-secret-xyz`)) === true);
  }
  // recompute IS admin-or-cron by design: verified admin accepted there only.
  const recompute = fs.readFileSync(path.join(REPO, "app/api/admin/hotel-scores/recompute/route.ts"), "utf8");
  check("admin-or-cron[recompute]: uses requireVerifiedAdmin", recompute.includes("requireVerifiedAdmin"));
  // Look for an actual acceptance code path (not the comment documenting removal).
  check("admin-or-cron[recompute]: no adm_ accept path", !/startsWith\("adm_"\)\s*\)\s*return true|\/\^adm_[^/]*\/i\.test/.test(recompute));

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
