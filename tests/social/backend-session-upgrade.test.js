#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — canonical CUSTOMER session upgrade — behavioral proof.
//   Run: node tests/social/backend-session-upgrade.test.js
// ZERO live network. Compiles the REAL lib/auth/ensure-backend-session.ts with
// the lockfile tsc into an OS TEMP dir, then drives ensureBackendSessionToken()
// with a fake fetch + fake localStorage + fake window. Proves the Firebase-
// fallback → backend upgrade for the picker + secure writer: backend sessions
// pass through, a Firebase session exchanges once (single-flight, no loop), the
// refreshed token is used by the CURRENT request, and every failure FAILS CLOSED
// without downgrading the session or leaking a decode-only token.
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }

const FIREBASE_TOKEN = "firebase.rs256.looking.token";
const BACKEND_TOKEN = "backend.hs256.looking.token";
const SOCIAL_LOGIN_PATH = "/api/proxy/api/auth/social-login";

function makeLocalStorage(initial) {
  const store = Object.assign(Object.create(null), initial || {});
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store,
  };
}
// Fake fetch that records calls and returns a scripted response.
function makeFetch(respond) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return respond(url, opts); };
  fn.calls = calls;
  return fn;
}
const jsonRes = (okFlag, body) => ({ ok: okFlag, json: async () => body });

async function threw(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-sess-upgrade-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    fs.copyFileSync(path.join(REPO, "lib/auth/ensure-backend-session.ts"), path.join(SRC, "ensure-backend-session.ts"));
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
    console.log("• Local tsc compile: exit 0, clean (strict) — ensure-backend-session");

    // Minimal DOM-ish globals the module reads at call time.
    global.window = { dispatchEvent: () => true };
    if (typeof global.Event === "undefined") global.Event = class { constructor(t) { this.type = t; } };
    const M = require(path.join(OUT, "ensure-backend-session.js"));
    const ensure = M.ensureBackendSessionToken;

    // ── A. Backend session → NO exchange ────────────────────────────────────────
    section("A. backend-token customer: no unnecessary exchange");
    { global.localStorage = makeLocalStorage({ sb_token: BACKEND_TOKEN, sb_token_type: "backend" });
      global.fetch = makeFetch(() => jsonRes(true, { token: "SHOULD_NOT_BE_USED" }));
      const t = await ensure();
      ok(t === BACKEND_TOKEN, "A1 backend session returns the existing token");
      ok(global.fetch.calls.length === 0, "A2 no exchange call for a backend session");
      ok(global.localStorage._store.sb_token === BACKEND_TOKEN, "A3 session unchanged"); }

    // ── B. Firebase session → canonical exchange succeeds ───────────────────────
    section("B. Firebase-fallback customer: canonical exchange → backend session");
    { const ls = makeLocalStorage({ sb_token: FIREBASE_TOKEN, sb_token_type: "firebase", sb_user: JSON.stringify({ id: "fb_u" }) });
      global.localStorage = ls;
      global.fetch = makeFetch((url, opts) => {
        ok(url === SOCIAL_LOGIN_PATH, "B1 exchange hits the canonical same-origin endpoint");
        const body = JSON.parse(opts.body);
        ok(body.idToken === FIREBASE_TOKEN && Object.keys(body).length === 1, "B2 body is { idToken } only (Firebase token)");
        return jsonRes(true, { token: BACKEND_TOKEN, user: { id: "cust_backend" } });
      });
      const t = await ensure();
      ok(t === BACKEND_TOKEN, "B3 returns the backend token (used by the CURRENT request)");
      ok(global.fetch.calls.length === 1, "B4 exactly one exchange");
      ok(ls._store.sb_token === BACKEND_TOKEN, "B5 sb_token atomically upgraded to backend token");
      ok(ls._store.sb_token_type === "backend", "B6 sb_token_type flipped to backend");
      ok(ls._store.sb_user === JSON.stringify({ id: "cust_backend" }), "B7 sb_user replaced with backend user");
      ok(t === ls._store.sb_token, "B8 returned token === stored token (current-request parity)");
      // subsequent call on the SAME (now-backend) session → NO further exchange (no loop)
      const t2 = await ensure();
      ok(t2 === BACKEND_TOKEN && global.fetch.calls.length === 1, "B9 subsequent call does NOT re-exchange (no loop)"); }

    // ── C. Exchange failures FAIL CLOSED (session never downgraded) ─────────────
    section("C. exchange failure → fail closed, no decode-only Firebase ownership");
    async function failCase(label, respond) {
      const ls = makeLocalStorage({ sb_token: FIREBASE_TOKEN, sb_token_type: "firebase" });
      global.localStorage = ls;
      global.fetch = makeFetch(respond);
      const err = await threw(() => ensure());
      ok(err && err.name === "SessionUpgradeError" && err.code === "exchange_failed", `${label} → SessionUpgradeError(exchange_failed)`);
      ok(ls._store.sb_token === FIREBASE_TOKEN && ls._store.sb_token_type === "firebase", `${label} → session NOT downgraded (no backend token written)`);
      ok(!!(err && err.message && /sign|refresh/i.test(err.message)), `${label} → actionable re-login/refresh message`);
    }
    await failCase("C1 non-2xx (forged/invalid Firebase token)", () => jsonRes(false, { error: "invalid_id_token" }));
    await failCase("C2 network throw", () => { throw new Error("network"); });
    await failCase("C3 2xx but no token", () => jsonRes(true, { user: { id: "x" } }));
    await failCase("C4 echo (backend token === firebase token)", () => jsonRes(true, { token: FIREBASE_TOKEN }));

    // ── D. No session → needs_reauth (no exchange) ──────────────────────────────
    section("D. no session → needs_reauth");
    { global.localStorage = makeLocalStorage({});
      let fetched = false; global.fetch = makeFetch(() => { fetched = true; return jsonRes(true, { token: BACKEND_TOKEN }); });
      const err = await threw(() => ensure());
      ok(err && err.name === "SessionUpgradeError" && err.code === "needs_reauth", "D1 no sb_token → needs_reauth");
      ok(!fetched, "D2 no exchange attempted without a session"); }

    // ── E. Concurrent picker + upload → single-flight (one exchange) ────────────
    section("E. concurrent callers share ONE exchange (no double-exchange / no corruption)");
    { const ls = makeLocalStorage({ sb_token: FIREBASE_TOKEN, sb_token_type: "firebase" });
      global.localStorage = ls;
      let resolveExchange; const gate = new Promise((r) => { resolveExchange = r; });
      global.fetch = makeFetch(async () => { await gate; return jsonRes(true, { token: BACKEND_TOKEN, user: { id: "c" } }); });
      const p1 = ensure(); const p2 = ensure(); // fire both before the exchange resolves
      resolveExchange();
      const [t1, t2] = await Promise.all([p1, p2]);
      ok(t1 === BACKEND_TOKEN && t2 === BACKEND_TOKEN, "E1 both concurrent callers get the backend token");
      ok(global.fetch.calls.length === 1, "E2 exactly ONE exchange for two concurrent callers (single-flight)");
      ok(ls._store.sb_token === BACKEND_TOKEN && ls._store.sb_token_type === "backend", "E3 localStorage upgraded exactly once, consistent"); }
  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
