#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — Verified Guest AUTHORITY-BOUNDARY behavioral proof.
//   Run: node tests/social/verified-guest-authority.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL
// lib/auth/media-customer-authority.ts + lib/sb-server.ts with the lockfile tsc
// into an OS TEMP dir, then drives them with locally-signed HS256 / RS256 /
// tampered tokens + an INJECTED fresh-customer proof. Proves that ownership
// identity for the Verified Guest chain is bound to a cryptographically verified
// customer — a decode-only / forged / admin token can choose NO id/email/phone —
// and that the email ownership axis can never be widened by an ILIKE wildcard.
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process"), crypto = require("crypto");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eqv(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

const ACCESS = "sec00b_authority_ACCESS_secret_value";      // stands in for JWT_ACCESS_SECRET
const JWTSECRET = "sec00b_authority_JWT_SECRET_compat_value"; // the compat fallback — must be REJECTED

function mkReq(authHeader) {
  return { headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? authHeader : null) } };
}
const freshOk = (sub) => async () => ({ id: sub, role: "customer", isBlocked: false });

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-vg-authz-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    fs.copyFileSync(path.join(REPO, "lib/auth/media-customer-authority.ts"), path.join(SRC, "media-customer-authority.ts"));
    fs.copyFileSync(path.join(REPO, "lib/sb-server.ts"), path.join(SRC, "sb-server.ts"));
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
    console.log("• Local tsc compile: exit 0, clean (strict) — media authority + sb-server");

    process.env.NODE_PATH = REPO_NM; require("module").Module._initPaths();
    const M = require(path.join(OUT, "media-customer-authority.js"));
    const S = require(path.join(OUT, "sb-server.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    const deps = (over = {}) => ({ secret: ACCESS, fetchCustomer: freshOk("cust_1"), ...over });
    const bearer = (tok) => mkReq("Bearer " + tok);
    const signA = (claims, opts = {}) => jwt.sign(claims, ACCESS, { algorithm: "HS256", ...opts });

    // ── A. verifyMediaCustomerIdentity — verified subject + verified email/phone/name ──
    section("A. verifyMediaCustomerIdentity returns VERIFIED claims (id/email/phone only from a signed token)");
    { const tok = signA({ sub: "cust_1", id: "cust_1", role: "customer", email: "Twin@Example.test", phone: "+919812345678", name: "Aria" }, { expiresIn: "1h" });
      const idn = M.verifyMediaCustomerIdentity(tok, ACCESS);
      ok(!!idn, "A1 valid HS256 → identity object");
      eqv(idn && idn.sub, "cust_1", "A1 sub = verified subject");
      eqv(idn && idn.email, "Twin@Example.test", "A1 email = verified claim");
      eqv(idn && idn.phone, "+919812345678", "A1 phone = verified claim");
      eqv(idn && idn.name, "Aria", "A1 name = verified claim"); }
    { const idn = M.verifyMediaCustomerIdentity(signA({ sub: "cust_2", id: "cust_2", role: "customer" }), ACCESS);
      ok(idn && idn.sub === "cust_2" && idn.email === null && idn.phone === null && idn.name === null,
        "A2 token without email/phone → sub only, twins null (no fabrication)"); }

    section("B. verifyMediaCustomerIdentity fails closed — no id/email/phone from a bad token");
    eqv(M.verifyMediaCustomerIdentity("not.a.jwt", ACCESS), null, "B1 malformed → null");
    eqv(M.verifyMediaCustomerIdentity(jwt.sign({ sub: "x", id: "x", email: "a@b.test" }, "WRONGSECRET", { algorithm: "HS256" }), ACCESS), null, "B2 wrong signature → null");
    { const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      eqv(M.verifyMediaCustomerIdentity(jwt.sign({ sub: "x", id: "x", email: "a@b.test" }, privateKey, { algorithm: "RS256", expiresIn: "1h" }), ACCESS), null, "B3 RS256/Firebase-shaped → null"); }
    eqv(M.verifyMediaCustomerIdentity(jwt.sign({ sub: "cust_1", id: "cust_1", email: "a@b.test" }, JWTSECRET, { algorithm: "HS256" }), ACCESS), null, "B4 signed with JWT_SECRET compat → null (JWT_ACCESS_SECRET only)");
    eqv(M.verifyMediaCustomerIdentity(signA({ id: "cust_1", email: "a@b.test" }), ACCESS), null, "B5 missing sub → null");
    eqv(M.verifyMediaCustomerIdentity(signA({ sub: "cust_1", id: "cust_2", email: "a@b.test" }), ACCESS), null, "B6 id!==sub → null");
    eqv(M.verifyMediaCustomerIdentity(signA({ sub: "cust_1", id: "cust_1", role: "admin", email: "a@b.test" }), ACCESS), null, "B7 admin role claim → null (never a media customer)");
    eqv(M.verifyMediaCustomerIdentity(signA({ sub: "cust_1", id: "cust_1", role: "super_admin" }), ACCESS), null, "B8 super_admin role claim → null");
    eqv(M.verifyMediaCustomerIdentity(signA({ sub: "cust_1", id: "cust_1", email: "a@b.test" }), undefined), null, "B9 missing secret → null (fail closed)");
    // tampered payload (flip a byte in the claims segment) must fail signature.
    { const tok = signA({ sub: "cust_1", id: "cust_1", email: "a@b.test" }); const parts = tok.split(".");
      const seg = Buffer.from(parts[1], "base64url").toString(); const tampered = seg.replace("cust_1", "cust_9");
      parts[1] = Buffer.from(tampered).toString("base64url"); const bad = parts.join(".");
      eqv(M.verifyMediaCustomerIdentity(bad, ACCESS), null, "B10 tampered payload → null (signature check)"); }

    // ── C. Picker ⇄ upload gate use EQUIVALENT verified identity ────────────────
    section("C. resolveVerifiedMediaCustomer and verifyMediaCustomerIdentity agree on the SAME token");
    { const tok = signA({ sub: "cust_7", id: "cust_7", role: "customer", email: "g@h.test" });
      const authz = await M.resolveVerifiedMediaCustomer(bearer(tok), deps({ fetchCustomer: freshOk("cust_7") }));
      const idn = M.resolveVerifiedMediaIdentity(bearer(tok), ACCESS);
      ok(authz && authz.id === "cust_7", "C1 authority id = verified sub");
      ok(idn && idn.sub === "cust_7", "C2 identity sub = verified sub");
      ok(authz && idn && authz.id === idn.sub, "C3 upload gate id === picker id (equivalent verified identity)"); }
    { // a forged token grants NEITHER authority NOR twin attributes
      const forged = jwt.sign({ sub: "victim", id: "victim", email: "victim@x.test" }, "WRONGSECRET", { algorithm: "HS256" });
      const authz = await M.resolveVerifiedMediaCustomer(bearer(forged), deps({ fetchCustomer: freshOk("victim") }));
      const idn = M.resolveVerifiedMediaIdentity(bearer(forged), ACCESS);
      ok(authz === null && idn === null, "C4 forged token → no authority id AND no twin email/phone"); }
    { // client cannot inject an owner id via a hint header — only Authorization is read
      const tok = signA({ sub: "cust_7", id: "cust_7", role: "customer" });
      const req = { headers: { get: (k) => { const kk = String(k).toLowerCase(); if (kk === "authorization") return "Bearer " + tok; if (kk === "x-email") return "*@*"; return null; } } };
      const idn = M.resolveVerifiedMediaIdentity(req, ACCESS);
      ok(idn && idn.sub === "cust_7" && idn.email === null, "C5 x-email hint header has ZERO authority (identity from token only)"); }

    // ── D. escapeLikeLiteral — the email ilike axis can never widen ─────────────
    section("D. escapeLikeLiteral neutralizes ILIKE wildcards (no `_` / `%` / `*` widening)");
    eqv(S.escapeLikeLiteral("john@gmail.com"), "john@gmail.com", "D1 plain email → unchanged (literal match)");
    eqv(S.escapeLikeLiteral("first_last@x.com"), "first\\_last@x.com", "D2 underscore ESCAPED (legit twin still resolves, no single-char widening)");
    eqv(S.escapeLikeLiteral("a%b@x.com"), "a\\%b@x.com", "D3 percent ESCAPED (no multi-char widening)");
    eqv(S.escapeLikeLiteral("a\\b@x.com"), "a\\\\b@x.com", "D4 backslash ESCAPED");
    eqv(S.escapeLikeLiteral("%@%"), "\\%@\\%", "D5 `%@%` mass-match attempt → escaped literal (matches nothing real)");
    eqv(S.escapeLikeLiteral("*@*"), null, "D6 `*@*` PostgREST wildcard → dropped");
    eqv(S.escapeLikeLiteral("a*b@x.com"), null, "D7 any `*` → dropped");
    eqv(S.escapeLikeLiteral(""), null, "D8 empty → null");
    // Invariant: a non-null result has no BARE (unescaped) `%` / `_` and no `*`.
    { const attacks = ["%@%", "_@_", "a_b@c.com", "x%@y.com", "*@*", "john@doe.com", "a\\_b@x.com"];
      let bare = false;
      for (const a of attacks) {
        const out = S.escapeLikeLiteral(a);
        if (out === null) continue;
        if (out.includes("*")) bare = true;
        // strip escaped pairs, then any remaining % or _ is an un-neutralized wildcard
        const stripped = out.replace(/\\./g, "");
        if (/[%_]/.test(stripped)) bare = true;
      }
      ok(!bare, "D9 invariant: no escapeLikeLiteral output leaves a bare `%` / `_` / `*` wildcard"); }

    // ── E. Non-regression: the accepted authority gate still behaves ────────────
    section("E. resolveVerifiedMediaCustomer non-regression (admin/blocked/forged rejected; valid → id)");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_1", role: "customer" })), deps())) &&
       true, "E1 valid customer → authority");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_1", role: "admin" })), deps())) === null, "E2 admin claim → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_1", role: "customer" })), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "super_admin", isBlocked: false }) }))) === null, "E3 fresh row super_admin → REJECT");
    ok((await M.resolveVerifiedMediaCustomer(bearer(signA({ sub: "cust_1", id: "cust_1", role: "customer" })), deps({ fetchCustomer: async () => ({ id: "cust_1", role: "customer", isBlocked: true }) }))) === null, "E4 fresh blocked → REJECT");
  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
