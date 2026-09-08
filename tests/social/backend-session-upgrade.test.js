#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// SEC-00B — canonical CUSTOMER session upgrade + SESSION-SWITCH RACE — behavioral.
//   Run: node tests/social/backend-session-upgrade.test.js
// ZERO live network. Compiles the REAL lib/auth/ensure-backend-session.ts with
// the lockfile tsc into an OS TEMP dir, then drives ensureBackendSessionToken()
// with a GATED fake fetch + fake localStorage + fake window so the session can be
// mutated WHILE an exchange is in flight. Proves the Firebase-fallback → backend
// upgrade AND that a logout / account-switch during the async exchange can never
// resurrect the old session or overwrite the new/current one, and that a different
// token never joins another session's single-flight.
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }

const FB_A = "firebaseA.rs256.tokenAAAA";
const FB_B = "firebaseB.rs256.tokenBBBB";
const BACKEND_A = "backendA.hs256.tokenAAAA";
const BACKEND_B = "backendB.hs256.tokenBBBB";
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
// Fetch that records calls and returns immediately.
function makeFetch(respond) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return respond(url, opts, calls.length - 1); };
  fn.calls = calls;
  return fn;
}
// Fetch whose responses are HELD until release() — lets us mutate the session
// while the exchange is in flight.
function makeGatedFetch(respond) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    await gate;
    return respond(url, opts, calls.length - 1);
  };
  fn.calls = calls;
  fn.release = () => release();
  return fn;
}
const jsonRes = (okFlag, body) => ({ ok: okFlag, json: async () => body });
const idTokenOf = (call) => JSON.parse(call.opts.body).idToken;
async function threw(fn) { try { await fn(); return null; } catch (e) { return e; } }

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

    global.window = { dispatchEvent: () => true };
    if (typeof global.Event === "undefined") global.Event = class { constructor(t) { this.type = t; } };
    const M = require(path.join(OUT, "ensure-backend-session.js"));
    const ensure = M.ensureBackendSessionToken;

    // ── A. same Firebase session → exchange succeeds → backend committed ────────
    section("A. same Firebase session → exchange → backend session committed");
    { const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase", sb_user: JSON.stringify({ id: "fbA" }) });
      global.localStorage = ls;
      global.fetch = makeFetch((u, o) => { ok(u === SOCIAL_LOGIN_PATH && idTokenOf({ opts: o }) === FB_A, "A0 canonical exchange with { idToken: FB_A }"); return jsonRes(true, { token: BACKEND_A, user: { id: "custA" } }); });
      const t = await ensure();
      ok(t === BACKEND_A, "A1 returns the backend token (CURRENT request)");
      ok(ls._store.sb_token === BACKEND_A && ls._store.sb_token_type === "backend", "A2 session upgraded to backend");
      ok(ls._store.sb_user === JSON.stringify({ id: "custA" }), "A3 sb_user replaced with backend user");
      ok(t === ls._store.sb_token, "A4 returned token === stored token"); }

    // ── B. backend session → no exchange ───────────────────────────────────────
    section("B. backend session → no exchange");
    { const ls = makeLocalStorage({ sb_token: BACKEND_A, sb_token_type: "backend" });
      global.localStorage = ls; global.fetch = makeFetch(() => jsonRes(true, { token: "NOPE" }));
      const t = await ensure();
      ok(t === BACKEND_A && global.fetch.calls.length === 0, "B1 backend token returned, zero exchange"); }

    // ── C. two concurrent calls SAME token → one exchange ──────────────────────
    section("C. concurrent SAME Firebase token → ONE exchange (single-flight)");
    { const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase" });
      global.localStorage = ls;
      const gf = makeGatedFetch(() => jsonRes(true, { token: BACKEND_A, user: { id: "custA" } }));
      global.fetch = gf;
      const p1 = ensure(); const p2 = ensure();
      gf.release();
      const [t1, t2] = await Promise.all([p1, p2]);
      ok(t1 === BACKEND_A && t2 === BACKEND_A, "C1 both callers get the backend token");
      ok(gf.calls.length === 1, "C2 exactly ONE exchange for two concurrent same-token callers"); }

    // ── D. logout DURING exchange → old result NOT written ─────────────────────
    section("D. Firebase A in flight → logout before response → A result NOT written");
    { const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase", sb_user: JSON.stringify({ id: "fbA" }) });
      global.localStorage = ls;
      const gf = makeGatedFetch(() => jsonRes(true, { token: BACKEND_A, user: { id: "custA" } }));
      global.fetch = gf;
      const pA = ensure();                       // exchange in flight (gated)
      ls.removeItem("sb_token"); ls.removeItem("sb_token_type"); ls.removeItem("sb_user"); // user logs out
      gf.release();
      const err = await threw(() => pA);
      ok(err && err.code === "session_changed", "D1 aborts with session_changed");
      ok(ls.getItem("sb_token") === null && ls.getItem("sb_token_type") === null, "D2 logged-out session NOT resurrected (no backend token written)"); }

    // ── E. account switch DURING exchange → old result NOT written; B untouched ─
    section("E. Firebase A in flight → User B logs in before response → A NOT written; B untouched");
    { const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase" });
      global.localStorage = ls;
      const gf = makeGatedFetch(() => jsonRes(true, { token: BACKEND_A, user: { id: "custA" } }));
      global.fetch = gf;
      const pA = ensure();
      // User B signs in with a full backend session while A's exchange is in flight.
      ls.setItem("sb_token", BACKEND_B); ls.setItem("sb_token_type", "backend"); ls.setItem("sb_user", JSON.stringify({ id: "custB" }));
      gf.release();
      const err = await threw(() => pA);
      ok(err && err.code === "session_changed", "E1 A aborts with session_changed");
      ok(ls._store.sb_token === BACKEND_B && ls._store.sb_token_type === "backend", "E2 User B's session NOT overwritten by A's backend token");
      ok(ls._store.sb_user === JSON.stringify({ id: "custB" }), "E3 User B's sb_user intact"); }

    // ── F. different Firebase token must NOT join A's in-flight promise ─────────
    section("F. Firebase A in flight → Firebase B calls → B does NOT join A (own exchange)");
    { const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase" });
      global.localStorage = ls;
      const gf = makeGatedFetch((u, o) => {
        const t = JSON.parse(o.body).idToken;
        return jsonRes(true, t === FB_A ? { token: BACKEND_A, user: { id: "A" } } : { token: BACKEND_B, user: { id: "B" } });
      });
      global.fetch = gf;
      const pA = ensure();                       // A's exchange in flight (call 0)
      ls.setItem("sb_token", FB_B); ls.setItem("sb_token_type", "firebase"); // Firebase B is now the session
      const pB = ensure();                       // must start its OWN exchange (call 1)
      ok(gf.calls.length === 2, "F1 a SEPARATE exchange was started for B (not joined to A)");
      ok(idTokenOf(gf.calls[0]) === FB_A && idTokenOf(gf.calls[1]) === FB_B, "F2 the two exchanges carry the two distinct Firebase tokens");
      gf.release();
      const tB = await pB;
      const errA = await threw(() => pA);
      ok(tB === BACKEND_B, "F3 B receives B's OWN backend token (never A's)");
      ok(errA && errA.code === "session_changed", "F4 A aborts (session is now B) — A never wins");
      ok(ls._store.sb_token === BACKEND_B && ls._store.sb_token_type === "backend", "F5 final session is B's backend session"); }

    // ── G. exchange failure → fail closed ──────────────────────────────────────
    section("G. exchange failure → fail closed (no downgrade, actionable error)");
    async function failCase(label, respond) {
      const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase" });
      global.localStorage = ls; global.fetch = makeFetch(respond);
      const err = await threw(() => ensure());
      ok(err && err.name === "SessionUpgradeError" && err.code === "exchange_failed", `${label} → exchange_failed`);
      ok(ls._store.sb_token === FB_A && ls._store.sb_token_type === "firebase", `${label} → session NOT downgraded`);
      ok(!!(err && err.message && /sign|refresh|again/i.test(err.message)), `${label} → actionable message`);
    }
    await failCase("G1 non-2xx (forged/invalid)", () => jsonRes(false, { error: "invalid_id_token" }));
    await failCase("G2 network throw", () => { throw new Error("net"); });
    await failCase("G3 2xx no token", () => jsonRes(true, { user: { id: "x" } }));
    await failCase("G4 echo backend===firebase", () => jsonRes(true, { token: FB_A }));

    // ── H. no infinite retry / exchange loop ───────────────────────────────────
    section("H. no infinite retry/exchange loop");
    { // no session → needs_reauth, no exchange
      global.localStorage = makeLocalStorage({});
      let fetched = false; global.fetch = makeFetch(() => { fetched = true; return jsonRes(true, { token: BACKEND_A }); });
      const err = await threw(() => ensure());
      ok(err && err.code === "needs_reauth" && !fetched, "H1 no session → needs_reauth, no exchange");
    }
    { // after a failed exchange, a SECOND call does exactly ONE more exchange (bounded, not a loop)
      const ls = makeLocalStorage({ sb_token: FB_A, sb_token_type: "firebase" });
      global.localStorage = ls;
      let n = 0; global.fetch = makeFetch(() => { n += 1; return n === 1 ? jsonRes(false, {}) : jsonRes(true, { token: BACKEND_A, user: { id: "A" } }); });
      const e1 = await threw(() => ensure());
      ok(e1 && e1.code === "exchange_failed", "H2 first attempt fails closed");
      const t2 = await ensure();
      ok(t2 === BACKEND_A && n === 2, "H3 second attempt runs exactly ONE more exchange then succeeds (no loop)");
      const t3 = await ensure();
      ok(t3 === BACKEND_A && n === 2, "H4 once backend, further calls do ZERO exchange"); }
  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
