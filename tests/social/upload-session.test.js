#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1B — hermetic upload-session source-contract test (remediated).
//   Run: node tests/social/upload-session.test.js
// ZERO live network / Supabase / Storage. Compiles the REAL
// lib/social/upload-session.ts + upload-session-store.ts + lib/auth/customer-verify.ts
// with the lockfile tsc into an OS TEMP dir. Drives handleUploadSession with fakes,
// proves the REAL cryptographic auth boundary, and EXECUTES the real store against
// an INJECTED Supabase-like double (bucket suitability + CAS transitions + provider
// path). Static-audits all four files. Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process"), crypto = require("crypto");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eqv(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const TEST_SECRET = "sec00b_p1b_test_hs256_secret_value";
const QB = "social-media-quarantine";
const MAXB = 104857600;

function mkReq(authHeader, bodyObj) {
  return {
    headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? authHeader : null) },
    json: async () => { if (bodyObj === "__throw__") throw new Error("bad json"); return bodyObj; },
  };
}
const OKBODY = { mediaClass: "photo", contentType: "image/jpeg", byteSize: 1024, idempotencyKey: "abcdefgh1234" };

function baseStore() {
  return {
    configured: () => true,
    bucketReady: async () => true,
    findByOwnerIdem: async () => null,
    countRecentSessions: async () => 0,
    countActiveSessions: async (_ownerId, _nowIso) => 0,
    insertCreated: async () => "ok",
    mintSignedUpload: async (k) => ({ token: "tkn-xyz", path: k }),
    authorizeCreated: async () => true,
    refreshAuthorized: async () => true,
    rejectCreated: async () => true,
  };
}
function baseDeps(over = {}) {
  return {
    verify: () => ({ id: "user_1" }),
    store: baseStore(),
    env: { MEDIA_UPLOAD_SESSION_ENABLED: "true" },
    now: () => new Date("2026-09-05T13:00:00.000Z"),
    genId: () => "sess-fixed",
    ...over,
  };
}
const existingRow = (over = {}) => ({ id: "S1", owner_user_id: "user_1", media_class: "photo", content_type: "image/jpeg", declared_byte_size: 1024, object_key: "sessions/S1/raw", status: "created", ...over });

// ── Injected Supabase-like double for the REAL store ────────────────────────
function fakeSupabase(plan) {
  const cap = (plan.cap = plan.cap || {});
  function builder() {
    const st = { updateObj: null, eqs: [], head: false, mode: null };
    const api = {
      select(sel, opts) { if (opts && opts.head) st.head = true; return api; },
      eq(c, v) { st.eqs.push([c, v]); return api; },
      gte(c, v) { st.eqs.push([c, v]); return api; },
      in(c, v) { st.eqs.push([c, v]); return api; },
      or(clause) { st.orClause = clause; return api; },
      maybeSingle() { return Promise.resolve(plan.find || { data: null, error: null }); },
      insert(v) { cap.insert = v; return { then: (res, rej) => Promise.resolve(plan.insert || { error: null }).then(res, rej) }; },
      update(v) { st.updateObj = v; st.mode = "update"; return api; },
      then(res, rej) { return settle().then(res, rej); },
    };
    function settle() {
      if (st.mode === "update") {
        cap.updateObj = st.updateObj; cap.updateEqs = st.eqs.slice();
        return Promise.resolve(plan.cas || { data: [{ id: "x" }], error: null });
      }
      if (st.head) {
        const isActive = st.eqs.some((e) => e[0] === "status");
        cap[isActive ? "activeEqs" : "recentEqs"] = st.eqs.slice();
        if (isActive) cap.activeOr = st.orClause;
        return Promise.resolve((isActive ? plan.activeCount : plan.recentCount) || { count: 0, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
    return api;
  }
  return {
    from() { return builder(); },
    storage: {
      getBucket: async (id) => { cap.getBucketId = id; return plan.bucket || { data: null, error: null }; },
      from: (b) => ({ createSignedUploadUrl: async (k, o) => { cap.mintKey = k; cap.mintOpts = o; return plan.mint || { data: null, error: null }; } }),
    },
  };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-p1b-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    fs.copyFileSync(path.join(REPO, "lib/social/upload-session.ts"), path.join(SRC, "upload-session.ts"));
    fs.copyFileSync(path.join(REPO, "lib/social/upload-session-store.ts"), path.join(SRC, "upload-session-store.ts"));
    fs.copyFileSync(path.join(REPO, "lib/auth/customer-verify.ts"), path.join(SRC, "customer-verify.ts"));
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
    console.log("• Local tsc compile: exit 0, clean (strict) — handler + STORE + verifier");

    process.env.NODE_PATH = REPO_NM;
    require("module").Module._initPaths();
    process.env.JWT_ACCESS_SECRET = TEST_SECRET;
    delete process.env.JWT_SECRET;

    const P = require(path.join(OUT, "upload-session.js"));
    const ST = require(path.join(OUT, "upload-session-store.js"));
    const CV = require(path.join(OUT, "customer-verify.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    // ── ACTIVATION ──────────────────────────────────────────────────────
    section("ACTIVATION (dormant by default)");
    for (const flag of [undefined, "", "false", "1", "yes"]) {
      const store = baseStore(); let touched = false;
      ["bucketReady", "findByOwnerIdem", "insertCreated", "mintSignedUpload"].forEach((m) => { const o = store[m]; store[m] = async (...a) => { touched = true; return o(...a); }; });
      const env = flag === undefined ? {} : { MEDIA_UPLOAD_SESSION_ENABLED: flag };
      const res = await P.handleUploadSession(mkReq("Bearer x", OKBODY), baseDeps({ store, env }));
      eqv(res.status, 503, `flag=${JSON.stringify(flag)} disabled -> 503`);
      eqv((await res.json()).error, "media_upload_sessions_disabled", `flag=${JSON.stringify(flag)} code`);
      ok(!touched, `flag=${JSON.stringify(flag)} made ZERO store operations`);
    }
    eqv((await P.handleUploadSession(mkReq("Bearer x", OKBODY), baseDeps())).status, 200, "flag=true enables (200)");

    // ── AUTH (handler + real verifier) ──────────────────────────────────
    section("AUTH");
    for (const b of [null, {}, { id: "" }, { id: 123 }]) eqv((await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ verify: () => b }))).status, 401, `verify ${JSON.stringify(b)} -> 401`);
    { let owner = null; const store = baseStore(); store.insertCreated = async (i) => { owner = i.owner_user_id; return "ok"; };
      await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ verify: () => ({ id: "owner_tok" }), store })); eqv(owner, "owner_tok", "owner from verified auth only"); }
    const hs = jwt.sign({ id: "cust_9" }, TEST_SECRET, { algorithm: "HS256", expiresIn: "1h" });
    ok(CV.verifiedCustomerFromReq(mkReq("Bearer " + hs))?.id === "cust_9", "real: valid HS256 accepted");
    ok(CV.verifiedCustomerFromReq(mkReq(null)) === null, "real: missing -> null");
    ok(CV.verifiedCustomerFromReq(mkReq("Bearer " + jwt.sign({ id: "x" }, "WRONG", { algorithm: "HS256" }))) === null, "real: forged -> null");
    ok(CV.verifiedCustomerFromReq(mkReq("Bearer " + jwt.sign({ id: "x" }, TEST_SECRET, { algorithm: "HS256", expiresIn: -10 }))) === null, "real: expired -> null");
    { const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      ok(CV.verifiedCustomerFromReq(mkReq("Bearer " + jwt.sign({ id: "x" }, privateKey, { algorithm: "RS256", expiresIn: "1h" }))) === null, "real: Firebase RS256 -> null (fail closed)"); }
    ok(CV.verifiedCustomerFromReq(mkReq("Bearer " + jwt.sign({ id: "x" }, "", { algorithm: "none" }))) === null, "real: alg:none -> null");

    // ── INPUT VALIDATION ────────────────────────────────────────────────
    section("INPUT VALIDATION");
    for (const mc of P.MEDIA_CLASSES) { const ct = mc === "reel" ? "video/mp4" : mc === "audio" ? "audio/mpeg" : "image/jpeg"; ok(P.validateInput({ mediaClass: mc, contentType: ct, byteSize: 10, idempotencyKey: "abcdefgh1234" }).ok, `class ${mc} accepted`); }
    for (const [l, b] of [
      ["invalid class", { mediaClass: "video", contentType: "video/mp4", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["reel+image", { mediaClass: "reel", contentType: "image/png", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["photo+video", { mediaClass: "photo", contentType: "video/mp4", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["audio+image", { mediaClass: "audio", contentType: "image/png", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["svg photo", { mediaClass: "photo", contentType: "image/svg+xml", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["svg story", { mediaClass: "story", contentType: "image/svg+xml", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["malformed mime", { mediaClass: "photo", contentType: "nope", byteSize: 1, idempotencyKey: "abcdefgh12" }],
      ["byte 0", { mediaClass: "photo", contentType: "image/jpeg", byteSize: 0, idempotencyKey: "abcdefgh12" }],
      ["byte frac", { mediaClass: "photo", contentType: "image/jpeg", byteSize: 1.5, idempotencyKey: "abcdefgh12" }],
      ["byte >100MiB", { mediaClass: "photo", contentType: "image/jpeg", byteSize: MAXB + 1, idempotencyKey: "abcdefgh12" }],
      ["idem short", { mediaClass: "photo", contentType: "image/jpeg", byteSize: 1, idempotencyKey: "abc" }],
      ["idem bad", { mediaClass: "photo", contentType: "image/jpeg", byteSize: 1, idempotencyKey: "ab cd/ef12" }],
    ]) ok(P.validateInput(b).ok === false, `reject ${l}`);
    ok(P.validateInput({ mediaClass: "photo", contentType: "image/jpeg", byteSize: MAXB, idempotencyKey: "abcdefgh12" }).ok, "exactly 100MiB accepted");
    { const r = await P.handleUploadSession(mkReq(null, { mediaClass: "photo", contentType: "image/svg+xml", byteSize: 1, idempotencyKey: "abcdefgh12" }), baseDeps()); eqv(r.status, 400, "svg -> 400"); eqv((await r.json()).error, "invalid_content_type", "svg code"); }
    eqv((await P.handleUploadSession(mkReq(null, "__throw__"), baseDeps())).status, 400, "unparseable -> 400");

    // ── AUTHORITY ───────────────────────────────────────────────────────
    section("AUTHORITY (server-owned id + key)");
    eqv(P.objectKeyForSession("SID"), "sessions/SID/raw", "object key shape");
    { let insId = null, mintKey = null, authId = null; const store = baseStore();
      store.insertCreated = async (i) => { insId = i.id; return "ok"; };
      store.mintSignedUpload = async (k) => { mintKey = k; return { token: "T", path: k }; };
      store.authorizeCreated = async (id) => { authId = id; return true; };
      const attempt = { ...OKBODY, ownerId: "evil", bucket: "evil", objectKey: "evil/x", path: "evil", sessionId: "evil" };
      const r = await P.handleUploadSession(mkReq(null, attempt), baseDeps({ store, genId: () => "srv" }));
      const j = await r.json();
      eqv(r.status, 200, "authorize 200"); eqv(insId, "srv", "server-generated id"); eqv(mintKey, "sessions/srv/raw", "server-derived key");
      eqv(authId, "srv", "CAS on server id"); eqv(j.path, "sessions/srv/raw", "response path server-owned"); eqv(j.token, "T", "token returned"); eqv(j.expiresAt, "2026-09-05T15:00:00.000Z", "expiry now+2h"); }

    // ── R1 BUCKET SUITABILITY (real store, injected client) ─────────────
    section("R1 bucket suitability (real store runtime)");
    const bstore = (bucket) => ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ bucket }) });
    ok((await bstore({ data: { id: QB, public: false, file_size_limit: MAXB }, error: null }).bucketReady()) === true, "exact private+100MiB -> ready");
    ok((await bstore({ data: null, error: null }).bucketReady()) === false, "missing bucket -> not ready");
    ok((await bstore({ data: null, error: { message: "x" } }).bucketReady()) === false, "lookup error -> not ready");
    ok((await bstore({ data: { id: QB, public: true, file_size_limit: MAXB }, error: null }).bucketReady()) === false, "public=true -> not ready");
    ok((await bstore({ data: { id: QB, public: false, file_size_limit: null }, error: null }).bucketReady()) === false, "file_size_limit null -> not ready");
    ok((await bstore({ data: { id: QB, public: false, file_size_limit: 999 }, error: null }).bucketReady()) === false, "wrong size limit -> not ready");
    ok((await bstore({ data: { id: "other", public: false, file_size_limit: MAXB }, error: null }).bucketReady()) === false, "wrong bucket id -> not ready");
    // new-session handler: unsafe bucket -> 503 + no insert/mint
    { let inserted = false, minted = false; const store = baseStore(); store.bucketReady = async () => false; store.insertCreated = async () => { inserted = true; return "ok"; }; store.mintSignedUpload = async (k) => { minted = true; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "new + unsafe bucket -> 503"); eqv((await r.json()).error, "quarantine_unavailable", "quarantine code"); ok(!inserted && !minted, "no insert, no mint when bucket unsafe"); }

    // ── R2 CAS TRANSITIONS (real store runtime) ─────────────────────────
    section("R2 CAS transitions (real store runtime)");
    const casStore = (cas) => { const plan = { cas }; return { store: ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) }), plan }; };
    { const { store, plan } = casStore({ data: [{ id: "S1" }], error: null }); ok((await store.authorizeCreated("S1", "e", "n")) === true, "authorizeCreated 1-row -> true");
      ok(plan.cap.updateEqs.some((e) => e[0] === "status" && e[1] === "created"), "authorizeCreated CAS guards status=created"); eqv(plan.cap.updateObj.status, "upload_authorized", "authorizeCreated sets upload_authorized"); }
    { const { store } = casStore({ data: [], error: null }); ok((await store.authorizeCreated("S1", "e", "n")) === false, "authorizeCreated 0-row -> false"); }
    { const { store } = casStore({ data: null, error: { message: "x" } }); ok((await store.authorizeCreated("S1", "e", "n")) === false, "authorizeCreated error -> false"); }
    { const { store, plan } = casStore({ data: [{ id: "S1" }], error: null }); ok((await store.refreshAuthorized("S1", "e", "n")) === true, "refreshAuthorized 1-row -> true");
      ok(plan.cap.updateEqs.some((e) => e[0] === "status" && e[1] === "upload_authorized"), "refreshAuthorized CAS guards status=upload_authorized"); ok(!("status" in plan.cap.updateObj), "refreshAuthorized does NOT change status"); }
    { const { store } = casStore({ data: [], error: null }); ok((await store.refreshAuthorized("S1", "e", "n")) === false, "refreshAuthorized 0-row -> false"); }
    { const { store, plan } = casStore({ data: [{ id: "S1" }], error: null }); ok((await store.rejectCreated("S1", "r", "n")) === true, "rejectCreated 1-row -> true");
      ok(plan.cap.updateEqs.some((e) => e[0] === "status" && e[1] === "created"), "rejectCreated CAS guards status=created"); eqv(plan.cap.updateObj.status, "rejected", "rejectCreated sets rejected"); }

    // handler-level CAS wiring
    section("R2 CAS wiring (handler)");
    { const store = baseStore(); store.authorizeCreated = async () => false; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); const j = await r.json(); eqv(r.status, 503, "created CAS 0-row -> 503"); ok(!("token" in j), "no token when created CAS fails (later-state race safe)"); }
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow({ status: "upload_authorized" }); store.refreshAuthorized = async () => false; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); const j = await r.json(); eqv(r.status, 503, "refresh CAS 0-row -> 503"); ok(!("token" in j), "no token when refresh CAS fails"); }
    { let rejectedCalled = false; const store = baseStore(); store.findByOwnerIdem = async () => existingRow({ status: "upload_authorized" }); store.mintSignedUpload = async () => null; store.rejectCreated = async () => { rejectedCalled = true; return true; }; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "existing authorized + mint fail -> 503"); ok(!rejectedCalled, "authorized-refresh mint failure does NOT reject the session"); }
    { let rejectedCalled = false; const store = baseStore(); store.mintSignedUpload = async () => null; store.rejectCreated = async (id, r2) => { rejectedCalled = true; ok(r2 === "upload_authorization_failed", "reject reason static"); return true; }; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "new + mint fail -> 503"); ok(rejectedCalled, "new-created mint failure marks rejected via CAS"); }

    // ── R3 IDEMPOTENCY ORDER ────────────────────────────────────────────
    section("R3 idempotency before new-session limits");
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow(); store.countActiveSessions = async () => { throw new Error("should-not-run"); }; store.countRecentSessions = async () => { throw new Error("should-not-run"); };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 200, "existing retry does NOT run new-session limits"); }
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow({ declared_byte_size: 999 }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 409, "existing + different facts -> 409"); eqv((await r.json()).error, "idempotency_conflict", "idempotency_conflict"); }
    for (const stt of ["uploading", "quarantined", "validating", "file_safety", "media_processing", "ready", "rejected", "expired"]) { const store = baseStore(); store.findByOwnerIdem = async () => existingRow({ status: stt }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 409, `existing ${stt} -> 409`); eqv((await r.json()).error, "session_state_conflict", `${stt} conflict`); }
    { const store = baseStore(); store.findByOwnerIdem = async () => null; store.countActiveSessions = async () => 6; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 429, "NEW + active=6 -> 429"); eqv((await r.json()).error, "upload_session_concurrency_limited", "concurrency code"); }
    { const store = baseStore(); store.findByOwnerIdem = async () => null; store.countRecentSessions = async () => 12; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 429, "NEW + recent=12 -> 429"); eqv((await r.json()).error, "upload_session_rate_limited", "rate code"); }
    { let reads = 0; const store = baseStore(); store.findByOwnerIdem = async () => { reads += 1; return reads === 1 ? null : existingRow(); }; store.insertCreated = async () => "conflict"; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 200, "insert race -> re-read canonical -> 200"); eqv((await r.json()).sessionId, "S1", "race resolves canonical"); }
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow(); store.bucketReady = async () => false; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "existing created + unsafe bucket -> 503"); eqv((await r.json()).error, "quarantine_unavailable", "existing needs bucket"); }

    // ── R4 PROVIDER PATH INVARIANT (handler) ────────────────────────────
    section("R4 provider path invariant");
    { const store = baseStore(); store.mintSignedUpload = async () => ({ token: "T", path: "sessions/DIFFERENT/raw" }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); const j = await r.json(); eqv(r.status, 503, "mint path mismatch -> 503"); ok(!("token" in j), "no token on path mismatch"); }
    { const store = baseStore(); store.mintSignedUpload = async () => ({ token: "", path: "sessions/srv/raw" }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 503, "empty token -> 503"); }
    { const store = baseStore(); store.mintSignedUpload = async () => ({ token: "T" }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 503, "missing path -> 503"); }
    // real store mint runtime
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ mint: { data: { token: "tok", path: "sessions/x/raw" }, error: null } }) }); const m = await s.mintSignedUpload("sessions/x/raw"); eqv(m.token, "tok", "real store mint token"); eqv(m.path, "sessions/x/raw", "real store mint path"); }
    { const plan = { mint: { data: { token: "tok" }, error: null } }; const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) }); await s.mintSignedUpload("sessions/x/raw"); eqv(plan.cap.mintOpts.upsert, false, "real store mint upsert:false"); }
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ mint: { data: null, error: { message: "x" } } }) }); ok((await s.mintSignedUpload("k")) === null, "real store mint error -> null"); }

    // ── REAL STORE: fail-closed config, insert, counts, find ────────────
    section("STORE fail-closed + runtime ops");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: undefined }).configured() === false, "missing key -> not configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "" }).configured() === false, "empty key -> not configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "   " }).configured() === false, "whitespace key -> not configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }).configured() === true, "present key -> configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: undefined }, { client: fakeSupabase({}) }).configured() === true, "injected client -> configured");
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ insert: { error: null } }) }); eqv(await s.insertCreated({ id: "i", owner_user_id: "o", media_class: "photo", content_type: "image/jpeg", declared_byte_size: 1, object_key: "sessions/i/raw", idempotency_key: "k", nowIso: "n" }), "ok", "insert ok"); }
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ insert: { error: { code: "23505" } } }) }); eqv(await s.insertCreated({ id: "i", owner_user_id: "o", media_class: "photo", content_type: "image/jpeg", declared_byte_size: 1, object_key: "sessions/i/raw", idempotency_key: "k", nowIso: "n" }), "conflict", "insert 23505 -> conflict"); }
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ recentCount: { count: 5, error: null } }) }); eqv(await s.countRecentSessions("o", "since"), 5, "countRecent"); }
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ activeCount: { count: 3, error: null } }) }); eqv(await s.countActiveSessions("o", "2026-09-05T13:00:00.000Z"), 3, "countActive"); }
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ find: { data: existingRow(), error: null } }) }); const row = await s.findByOwnerIdem("o", "k"); eqv(row.id, "S1", "find shapes row"); }
    { let threw = false; try { await ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ find: { data: null, error: { message: "x" } } }) }).findByOwnerIdem("o", "k"); } catch { threw = true; } ok(threw, "find error throws (handler maps to 503)"); }

    // ── F1 STRICT PROVIDER TOKEN/PATH (real store mint, no fallback) ────
    section("F1 strict mint: token+path fail-closed, no data.path||objectKey");
    const mintStore = (mint) => ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ mint }) });
    { const m = await mintStore({ data: { token: "tok", path: "sessions/x/raw" }, error: null }).mintSignedUpload("sessions/x/raw"); ok(m && m.token === "tok" && m.path === "sessions/x/raw", "F1 exact token+path -> ok"); }
    ok((await mintStore({ data: { path: "sessions/x/raw" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 missing token -> null");
    ok((await mintStore({ data: { token: "", path: "sessions/x/raw" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 empty token -> null");
    ok((await mintStore({ data: { token: "   ", path: "sessions/x/raw" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 whitespace token -> null");
    ok((await mintStore({ data: { token: 123, path: "sessions/x/raw" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 non-string token -> null");
    ok((await mintStore({ data: { token: "tok" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 missing path -> null (no objectKey fallback)");
    ok((await mintStore({ data: { token: "tok", path: "" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 empty path -> null (no objectKey fallback)");
    ok((await mintStore({ data: { token: "tok", path: "sessions/OTHER/raw" }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 mismatched path -> null");
    ok((await mintStore({ data: { token: "tok", path: 123 }, error: null }).mintSignedUpload("sessions/x/raw")) === null, "F1 non-string path -> null");
    ok((await mintStore({ data: null, error: { message: "x" } }).mintSignedUpload("sessions/x/raw")) === null, "F1 provider error -> null");
    { const m = await mintStore({ data: { token: "  tok  ", path: "sessions/x/raw" }, error: null }).mintSignedUpload("sessions/x/raw"); ok(m && m.token === "tok", "F1 token trimmed when non-blank"); }
    // static proof the fallback string is gone from executable code
    { const code = read("lib/social/upload-session-store.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1"); ok(!/data\.path\s*\|\|/.test(code), "F1 no `data.path || objectKey` fallback in code"); }

    // ── F2 ACTIVE-SESSION EXPIRY SEMANTICS ──────────────────────────────
    section("F2 active quota excludes expired rows; created row bounded");
    // real store: insertCreated persists expires_at
    { const plan = { insert: { error: null } }; const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) });
      await s.insertCreated({ id: "i", owner_user_id: "o", media_class: "photo", content_type: "image/jpeg", declared_byte_size: 1, object_key: "sessions/i/raw", idempotency_key: "k", nowIso: "2026-09-05T13:00:00.000Z", expiresAtIso: "2026-09-05T15:00:00.000Z" });
      eqv(plan.cap.insert.expires_at, "2026-09-05T15:00:00.000Z", "F2 insertCreated sets expires_at"); eqv(plan.cap.insert.status, "created", "F2 insert status=created"); }
    // real store: countActiveSessions issues the status-in + not-expired OR filter
    { const plan = { activeCount: { count: 2, error: null } }; const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) });
      const n = await s.countActiveSessions("o", "2026-09-05T13:00:00.000Z"); eqv(n, 2, "F2 countActive returns count");
      ok(plan.cap.activeEqs.some((e) => e[0] === "status"), "F2 countActive filters status IN active");
      eqv(plan.cap.activeOr, "expires_at.is.null,expires_at.gt.2026-09-05T13:00:00.000Z", "F2 countActive not-expired OR filter (null counts active, fail-closed)"); }
    // handler: passes server nowIso to countActiveSessions
    { let seenNow = null; const store = baseStore(); store.countActiveSessions = async (_o, nowIso) => { seenNow = nowIso; return 0; };
      await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(seenNow, "2026-09-05T13:00:00.000Z", "F2 handler passes server now to countActive"); }
    // handler: 6 active -> 429; store reporting 0 (all expired) -> proceeds
    { const store = baseStore(); store.findByOwnerIdem = async () => null; store.countActiveSessions = async () => 6; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 429, "F2 6 active -> 429"); }
    { const store = baseStore(); store.findByOwnerIdem = async () => null; store.countActiveSessions = async () => 0; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 200, "F2 expired rows not counted (0) -> proceeds"); }
    // handler: insertCreated receives a bounded server expiry (now+2h)
    { let exp = null; const store = baseStore(); store.insertCreated = async (i) => { exp = i.expiresAtIso; return "ok"; }; await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(exp, "2026-09-05T15:00:00.000Z", "F2 handler bounds created row expiry now+2h"); }

    // ── F3 SERVICE-ROLE ORIGIN PINNING ──────────────────────────────────
    section("F3 destination pinned to expected origin; configured needs key AND trusted URL");
    const ORIGIN = "https://uxxhbdqedazpmvbvaosh.supabase.co";
    const cfg = (over) => ST.createUploadSessionStore(Object.assign({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, over)).configured();
    ok(cfg({}) === true, "F3 no SUPABASE_URL + key -> configured (default origin)");
    ok(cfg({ SUPABASE_URL: ORIGIN }) === true, "F3 exact origin + key -> configured");
    ok(cfg({ SUPABASE_URL: ORIGIN + "/" }) === true, "F3 exact origin trailing slash -> configured (normalized)");
    ok(cfg({ SUPABASE_URL: "" }) === true, "F3 blank SUPABASE_URL -> falls back to default");
    ok(cfg({ SUPABASE_URL: "   " }) === true, "F3 whitespace SUPABASE_URL -> falls back to default");
    ok(cfg({ SUPABASE_URL: "https://evil.example.com" }) === false, "F3 different host -> fail closed");
    ok(cfg({ SUPABASE_URL: "https://uxxhbdqedazpmvbvaosh.supabase.co.evil.com" }) === false, "F3 suffix-host attack -> fail closed");
    ok(cfg({ SUPABASE_URL: "http://uxxhbdqedazpmvbvaosh.supabase.co" }) === false, "F3 http scheme -> fail closed");
    ok(cfg({ SUPABASE_URL: "https://uxxhbdqedazpmvbvaosh.supabase.co:8443" }) === false, "F3 non-default port -> fail closed");
    ok(cfg({ SUPABASE_URL: "https://user:pass@uxxhbdqedazpmvbvaosh.supabase.co" }) === false, "F3 embedded credentials -> fail closed");
    ok(cfg({ SUPABASE_URL: ORIGIN + "/evil/path" }) === false, "F3 non-root path -> fail closed");
    ok(cfg({ SUPABASE_URL: ORIGIN + "/?x=1" }) === false, "F3 query string -> fail closed");
    ok(cfg({ SUPABASE_URL: ORIGIN + "/#frag" }) === false, "F3 fragment -> fail closed");
    ok(cfg({ SUPABASE_URL: "not a url" }) === false, "F3 malformed -> fail closed");
    ok(cfg({ SUPABASE_URL: "//uxxhbdqedazpmvbvaosh.supabase.co" }) === false, "F3 protocol-relative -> fail closed");
    ok(ST.createUploadSessionStore({ SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_ROLE_KEY: undefined }).configured() === false, "F3 trusted URL but no key -> not configured (needs both)");
    ok(ST.createUploadSessionStore({ SUPABASE_URL: "https://evil.example.com", SUPABASE_SERVICE_ROLE_KEY: undefined }, { client: fakeSupabase({}) }).configured() === true, "F3 injected client bypasses (tests only)");
    // static proof the bare hardcoded fallback URL constant name is gone
    { const code = read("lib/social/upload-session-store.ts"); ok(/EXPECTED_SUPABASE_ORIGIN/.test(code) && !/DEFAULT_SUPABASE_URL/.test(code), "F3 origin pin constant present; old fallback constant removed"); }

    // ── STATIC AUDIT ────────────────────────────────────────────────────
    section("STATIC audit (4 files)");
    const pureSrc = read("lib/social/upload-session.ts");
    ok(!/from\s+["']@supabase/.test(pureSrc) && !/require\(/.test(pureSrc), "upload-session.ts dependency-free");
    ok(/no-store/.test(pureSrc), "responses set no-store");
    const routeSrc = read("app/api/social/upload-session/route.ts");
    ok(/verifiedCustomerFromReq/.test(routeSrc) && !/socialUserFromReq|userFromReq|decodeJwt/.test(routeSrc), "route cryptographic auth, no decode-only");
    ok(/runtime\s*=\s*["']nodejs["']/.test(routeSrc), "route nodejs runtime");
    const storeSrc = read("lib/social/upload-session-store.ts");
    const storeCode = storeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    ok(/SUPABASE_SERVICE_ROLE_KEY/.test(storeCode) && !/\b(SB_ADMIN_KEY|SB_H|SB_READ|SB_KEY)\b/.test(storeCode), "store service-role only, no anon fallback");
    ok(/createSignedUploadUrl\(/.test(storeCode) && /upsert:\s*false/.test(storeCode) && !/\bcreateResumableUpload\b|x-signature|\btus\b/i.test(storeCode), "standard signed upload, no TUS");
    ok(/typeof window/.test(storeCode), "store server-only guard");
    ok(/\.eq\("status",\s*"created"\)/.test(storeCode) && /\.eq\("status",\s*"upload_authorized"\)/.test(storeCode), "store uses CAS status guards");
    const wb = storeCode.match(/\.(insert|update)\(\{[\s\S]*?\}\)/g) || [];
    ok(wb.length >= 4 && wb.every((b) => !/token|signed|service_role|secret/i.test(b)), "no token/signed/secret persisted to DB");
    for (const p of ["lib/social/storage-upload.ts", "components/discover/CreateFlow.tsx", "components/circle/CircleOnboardForm.tsx"]) ok(!/upload-session/.test(read(p)), `no cutover: ${p}`);
  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}

main();
