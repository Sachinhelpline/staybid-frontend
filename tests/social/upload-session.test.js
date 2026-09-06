#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1B / P1F-1 — hermetic upload-session source-contract test.
//   Run: node tests/social/upload-session.test.js
// ZERO live network / Supabase / Storage. Compiles the REAL
// lib/social/upload-session.ts + upload-session-store.ts + lib/auth/customer-verify.ts
// with the lockfile tsc into an OS TEMP dir. Drives handleUploadSession with fakes,
// proves the REAL cryptographic auth boundary, and EXECUTES the real store against
// an INJECTED Supabase-like double (bucket suitability + CAS transitions + provider
// path + the P1F-1 atomic reservation RPC). Static-audits all four files. Exit code
// set AFTER cleanup.
//
// SEC-00B-P1F-1: the former non-atomic countRecentSessions → countActiveSessions →
// insertCreated trio is replaced by ONE atomic reserveNewSession RPC boundary. The
// handler supplies NO limit / window / TTL / clock; the reserved-row invariant is
// verified before any provider mint. Per-owner quota/insert concurrency is proven
// separately against real Postgres in tests/concurrency/media-upload-reservation.pg.test.js.
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

// SEC-00B-P1F-1 — a canonical CREATED row echoing the server-owned reservation
// input (what a `reserved` RPC returns).
const reservedRow = (i) => ({
  id: i.id, owner_user_id: i.owner_user_id, media_class: i.media_class,
  content_type: i.content_type, declared_byte_size: i.declared_byte_size,
  object_key: i.object_key, status: "created",
});

function baseStore() {
  return {
    configured: () => true,
    bucketReady: async () => true,
    findByOwnerIdem: async () => null,
    // P1F-1 atomic reservation — default returns a matching `reserved` row.
    reserveNewSession: async (i) => ({ outcome: "reserved", row: reservedRow(i) }),
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
    // SEC-00B-P1F-1 — the single atomic reservation RPC surface.
    rpc: async (fn, params) => { cap.rpcName = fn; cap.rpcArgs = params; return plan.rpc || { data: null, error: null }; },
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
      ["bucketReady", "findByOwnerIdem", "reserveNewSession", "mintSignedUpload"].forEach((m) => { const o = store[m]; store[m] = async (...a) => { touched = true; return o(...a); }; });
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
    { let owner = null; const store = baseStore(); store.reserveNewSession = async (i) => { owner = i.owner_user_id; return { outcome: "reserved", row: reservedRow(i) }; };
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
      store.reserveNewSession = async (i) => { insId = i.id; return { outcome: "reserved", row: reservedRow(i) }; };
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
    // new-session handler: unsafe bucket -> 503 + no reserve/mint
    { let reserved = false, minted = false; const store = baseStore(); store.bucketReady = async () => false; store.reserveNewSession = async (i) => { reserved = true; return { outcome: "reserved", row: reservedRow(i) }; }; store.mintSignedUpload = async (k) => { minted = true; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "new + unsafe bucket -> 503"); eqv((await r.json()).error, "quarantine_unavailable", "quarantine code"); ok(!reserved && !minted, "no reserve, no mint when bucket unsafe"); }

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
    section("R3 idempotency before the atomic reservation");
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow(); store.reserveNewSession = async () => { throw new Error("should-not-run"); };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 200, "existing retry does NOT run the reservation RPC"); }
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow({ declared_byte_size: 999 }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 409, "existing + different facts -> 409"); eqv((await r.json()).error, "idempotency_conflict", "idempotency_conflict"); }
    for (const stt of ["uploading", "quarantined", "validating", "file_safety", "media_processing", "ready", "rejected", "expired"]) { const store = baseStore(); store.findByOwnerIdem = async () => existingRow({ status: stt }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 409, `existing ${stt} -> 409`); eqv((await r.json()).error, "session_state_conflict", `${stt} conflict`); }
    { const store = baseStore(); store.findByOwnerIdem = async () => existingRow(); store.bucketReady = async () => false; const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "existing created + unsafe bucket -> 503"); eqv((await r.json()).error, "quarantine_unavailable", "existing needs bucket"); }

    // ── P1F-1 ATOMIC RESERVATION (handler) ──────────────────────────────
    section("P1F-1 atomic reservation — outcome mapping + fail-closed + provider order");
    // (2) auth failure -> ZERO reserve RPC work
    { let reserved = false; const store = baseStore(); store.reserveNewSession = async (i) => { reserved = true; return { outcome: "reserved", row: reservedRow(i) }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, verify: () => null })); eqv(r.status, 401, "auth fail -> 401"); ok(!reserved, "auth fail -> ZERO reserve RPC work"); }
    // (3) invalid request -> ZERO reserve RPC work
    { let reserved = false; const store = baseStore(); store.reserveNewSession = async (i) => { reserved = true; return { outcome: "reserved", row: reservedRow(i) }; };
      const r = await P.handleUploadSession(mkReq(null, { mediaClass: "photo", contentType: "nope", byteSize: 1, idempotencyKey: "abcdefgh12" }), baseDeps({ store })); eqv(r.status, 400, "invalid -> 400"); ok(!reserved, "invalid request -> ZERO reserve RPC work"); }
    // (4) unconfigured store -> ZERO reserve RPC work
    { let reserved = false; const store = baseStore(); store.configured = () => false; store.reserveNewSession = async (i) => { reserved = true; return { outcome: "reserved", row: reservedRow(i) }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "unconfigured -> 503"); eqv((await r.json()).error, "upload_session_service_unavailable", "unconfigured code"); ok(!reserved, "unconfigured store -> ZERO reserve RPC work"); }
    // (5) idempotent pre-check hit -> reserveNewSession MUST NOT run (covered above; assert explicitly)
    { let reserved = false; const store = baseStore(); store.findByOwnerIdem = async () => existingRow(); store.reserveNewSession = async (i) => { reserved = true; return { outcome: "reserved", row: reservedRow(i) }; };
      await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); ok(!reserved, "idempotent pre-check hit -> reserveNewSession NOT called"); }
    // (6) bucket unavailable -> reserveNewSession MUST NOT run
    { let reserved = false; const store = baseStore(); store.bucketReady = async () => false; store.reserveNewSession = async (i) => { reserved = true; return { outcome: "reserved", row: reservedRow(i) }; };
      await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); ok(!reserved, "bucket unavailable -> reserveNewSession NOT called"); }
    // (7) rate_limited -> 429, no mint
    { let minted = false; const store = baseStore(); store.reserveNewSession = async () => ({ outcome: "rate_limited" }); store.mintSignedUpload = async (k) => { minted = true; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 429, "rate_limited -> 429"); eqv((await r.json()).error, "upload_session_rate_limited", "rate code"); ok(!minted, "rate_limited -> no mint"); }
    // (8) concurrency_limited -> 429, no mint
    { let minted = false; const store = baseStore(); store.reserveNewSession = async () => ({ outcome: "concurrency_limited" }); store.mintSignedUpload = async (k) => { minted = true; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 429, "concurrency_limited -> 429"); eqv((await r.json()).error, "upload_session_concurrency_limited", "concurrency code"); ok(!minted, "concurrency_limited -> no mint"); }
    // (9) reserved -> provider mint occurs ONLY after reserveNewSession resolves
    { const order = []; const store = baseStore(); store.reserveNewSession = async (i) => { order.push("reserve"); return { outcome: "reserved", row: reservedRow(i) }; }; store.mintSignedUpload = async (k) => { order.push("mint"); return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 200, "reserved -> 200"); eqv(order.join(">"), "reserve>mint", "DB reservation commits BEFORE provider mint"); }
    // (10) reserved canonical row mismatch -> 503, zero mint
    for (const [l, mut] of [
      ["id mismatch", (r) => ({ ...r, id: "OTHER" })],
      ["owner mismatch", (r) => ({ ...r, owner_user_id: "OTHER" })],
      ["object_key mismatch", (r) => ({ ...r, object_key: "sessions/OTHER/raw" })],
      ["status not created", (r) => ({ ...r, status: "upload_authorized" })],
      ["facts mismatch", (r) => ({ ...r, declared_byte_size: 999 })],
    ]) { let minted = false; const store = baseStore(); store.reserveNewSession = async (i) => ({ outcome: "reserved", row: mut(reservedRow(i)) }); store.mintSignedUpload = async (k) => { minted = true; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 503, `reserved-row ${l} -> 503`); ok(!minted, `reserved-row ${l} -> zero mint`); }
    // (11) idempotent_existing -> routes through authorizeExisting (mint on the canonical row)
    { let mintKey = null; const store = baseStore(); store.reserveNewSession = async () => ({ outcome: "idempotent_existing", row: existingRow() }); store.mintSignedUpload = async (k) => { mintKey = k; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); const j = await r.json(); eqv(r.status, 200, "idempotent_existing -> 200"); eqv(j.sessionId, "S1", "idempotent_existing routes to authorizeExisting (canonical id)"); eqv(mintKey, "sessions/S1/raw", "mint on canonical object key"); }
    // (11b) idempotent_existing + different facts -> 409 (authorizeExisting factsMatch)
    { const store = baseStore(); store.reserveNewSession = async () => ({ outcome: "idempotent_existing", row: existingRow({ declared_byte_size: 999 }) }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 409, "idempotent_existing + different facts -> 409"); eqv((await r.json()).error, "idempotency_conflict", "idempotency_conflict"); }
    // (12) reserve RPC throws -> 503, zero mint
    { let minted = false; const store = baseStore(); store.reserveNewSession = async () => { throw new Error("provider down"); }; store.mintSignedUpload = async (k) => { minted = true; return { token: "T", path: k }; };
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store })); eqv(r.status, 503, "reserve throws -> 503"); eqv((await r.json()).error, "upload_session_service_unavailable", "reserve throw code"); ok(!minted, "reserve throws -> zero mint"); }
    // (14) provider mint failure after a successful reservation -> exactly ONE reserve call, no duplicate
    { let reserveCalls = 0; const store = baseStore(); store.reserveNewSession = async (i) => { reserveCalls += 1; return { outcome: "reserved", row: reservedRow(i) }; }; store.mintSignedUpload = async () => null;
      const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 503, "reserved + mint fail -> 503"); eqv(reserveCalls, 1, "mint failure does NOT re-reserve (exactly one reservation)"); }
    // (15) successful reserve -> EXACT server-generated facts passed to reserveNewSession
    // (16) rate/window/TTL/now are NOT passed as reservation parameters
    { let captured = null; const store = baseStore(); store.reserveNewSession = async (i) => { captured = i; return { outcome: "reserved", row: reservedRow(i) }; };
      await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, verify: () => ({ id: "cust_z" }), genId: () => "srv" }));
      ok(captured && captured.id === "srv", "reserve gets server-generated id");
      eqv(captured.owner_user_id, "cust_z", "reserve gets verified owner");
      eqv(captured.object_key, "sessions/srv/raw", "reserve gets server-derived object key");
      eqv(captured.media_class, "photo", "reserve gets validated media_class");
      eqv(captured.content_type, "image/jpeg", "reserve gets validated content_type");
      eqv(captured.declared_byte_size, 1024, "reserve gets validated byteSize");
      eqv(captured.idempotency_key, "abcdefgh1234", "reserve gets validated idempotency key");
      const keys = Object.keys(captured).sort();
      eqv(keys.join(","), "content_type,declared_byte_size,id,idempotency_key,media_class,object_key,owner_user_id", "reserve input has EXACTLY the trusted keys");
      ok(!keys.some((k) => /rate|window|ttl|now|since|expires|limit|active/i.test(k)), "no rate/window/TTL/now/limit passed to reservation"); }

    // ── R4 PROVIDER PATH INVARIANT (handler) ────────────────────────────
    section("R4 provider path invariant");
    { const store = baseStore(); store.mintSignedUpload = async () => ({ token: "T", path: "sessions/DIFFERENT/raw" }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); const j = await r.json(); eqv(r.status, 503, "mint path mismatch -> 503"); ok(!("token" in j), "no token on path mismatch"); }
    { const store = baseStore(); store.mintSignedUpload = async () => ({ token: "", path: "sessions/srv/raw" }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 503, "empty token -> 503"); }
    { const store = baseStore(); store.mintSignedUpload = async () => ({ token: "T" }); const r = await P.handleUploadSession(mkReq(null, OKBODY), baseDeps({ store, genId: () => "srv" })); eqv(r.status, 503, "missing path -> 503"); }
    // real store mint runtime
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ mint: { data: { token: "tok", path: "sessions/x/raw" }, error: null } }) }); const m = await s.mintSignedUpload("sessions/x/raw"); eqv(m.token, "tok", "real store mint token"); eqv(m.path, "sessions/x/raw", "real store mint path"); }
    { const plan = { mint: { data: { token: "tok" }, error: null } }; const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) }); await s.mintSignedUpload("sessions/x/raw"); eqv(plan.cap.mintOpts.upsert, false, "real store mint upsert:false"); }
    { const s = ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase({ mint: { data: null, error: { message: "x" } } }) }); ok((await s.mintSignedUpload("k")) === null, "real store mint error -> null"); }

    // ── P1F-1 REAL STORE reserveNewSession (rpc runtime) ────────────────
    section("P1F-1 real store reserveNewSession via injected .rpc()");
    const rsvStore = (rpc) => { const plan = { rpc }; return { store: ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) }), plan }; };
    const goodRow = { id: "s1", owner_user_id: "o1", media_class: "photo", content_type: "image/jpeg", declared_byte_size: 10, object_key: "sessions/s1/raw", status: "created" };
    const rsvInput = { id: "s1", owner_user_id: "o1", media_class: "photo", content_type: "image/jpeg", declared_byte_size: 10, object_key: "sessions/s1/raw", idempotency_key: "abcdefgh12" };
    // exact RPC name + trusted-only args (no limit/window/TTL/now)
    { const { store, plan } = rsvStore({ data: { outcome: "reserved", row: goodRow }, error: null });
      const res = await store.reserveNewSession(rsvInput);
      eqv(res.outcome, "reserved", "reserved parsed"); eqv(res.row.id, "s1", "reserved row shaped");
      eqv(plan.cap.rpcName, "reserve_media_upload_session", "exact RPC name");
      const ak = Object.keys(plan.cap.rpcArgs).sort();
      eqv(ak.join(","), "p_content_type,p_declared_byte_size,p_idempotency_key,p_media_class,p_object_key,p_owner_user_id,p_session_id", "rpc args are exactly the trusted reservation inputs");
      ok(!ak.some((k) => /limit|window|ttl|now|since|expires|rate|active/i.test(k)), "rpc args contain NO limit/window/TTL/now"); }
    // idempotent_existing parsed
    { const { store } = rsvStore({ data: { outcome: "idempotent_existing", row: goodRow }, error: null }); const res = await store.reserveNewSession(rsvInput); eqv(res.outcome, "idempotent_existing", "idempotent_existing parsed"); eqv(res.row.object_key, "sessions/s1/raw", "idempotent row shaped"); }
    // rate_limited / concurrency_limited parsed (row null)
    { const { store } = rsvStore({ data: { outcome: "rate_limited", row: null }, error: null }); const res = await store.reserveNewSession(rsvInput); eqv(res.outcome, "rate_limited", "rate_limited parsed"); ok(!("row" in res) || res.row === undefined, "rate_limited carries no row"); }
    { const { store } = rsvStore({ data: { outcome: "concurrency_limited", row: null }, error: null }); const res = await store.reserveNewSession(rsvInput); eqv(res.outcome, "concurrency_limited", "concurrency_limited parsed"); }
    // Supabase RPC error throws
    { const { store } = rsvStore({ data: null, error: { message: "boom" } }); let threw = false; try { await store.reserveNewSession(rsvInput); } catch { threw = true; } ok(threw, "rpc error -> throws (handler maps to 503)"); }
    // unknown outcome throws
    { const { store } = rsvStore({ data: { outcome: "weird", row: goodRow }, error: null }); let threw = false; try { await store.reserveNewSession(rsvInput); } catch { threw = true; } ok(threw, "unknown outcome -> throws (fail closed)"); }
    // null/non-object data throws
    { const { store } = rsvStore({ data: null, error: null }); let threw = false; try { await store.reserveNewSession(rsvInput); } catch { threw = true; } ok(threw, "null rpc data -> throws"); }
    // reserved with missing/malformed row throws
    for (const [l, row] of [["missing", undefined], ["blank id", { ...goodRow, id: "" }], ["no owner", { ...goodRow, owner_user_id: "" }], ["no object_key", { ...goodRow, object_key: "" }], ["no status", { ...goodRow, status: "" }]])
    { const { store } = rsvStore({ data: { outcome: "reserved", row }, error: null }); let threw = false; try { await store.reserveNewSession(rsvInput); } catch { threw = true; } ok(threw, `reserved + ${l} row -> throws`); }

    // ── REAL STORE: fail-closed config + find ───────────────────────────
    section("STORE fail-closed + runtime ops");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: undefined }).configured() === false, "missing key -> not configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "" }).configured() === false, "empty key -> not configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "   " }).configured() === false, "whitespace key -> not configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }).configured() === true, "present key -> configured");
    ok(ST.createUploadSessionStore({ SUPABASE_SERVICE_ROLE_KEY: undefined }, { client: fakeSupabase({}) }).configured() === true, "injected client -> configured");
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
    // SEC-00B-P1E-R1: the route now consumes the STRICT customer-domain media gate
    // (resolveVerifiedMediaCustomer / createMediaCustomerAuthority) instead of the
    // generic verifiedCustomerFromReq; decode-only helpers remain forbidden.
    ok(/resolveVerifiedMediaCustomer/.test(routeSrc) && /createMediaCustomerAuthority/.test(routeSrc) && !/socialUserFromReq|userFromReq|decodeJwt/.test(routeSrc), "route strict media customer-domain gate, no decode-only");
    ok(/runtime\s*=\s*["']nodejs["']/.test(routeSrc), "route nodejs runtime");
    const storeSrc = read("lib/social/upload-session-store.ts");
    const storeCode = storeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    ok(/SUPABASE_SERVICE_ROLE_KEY/.test(storeCode) && !/\b(SB_ADMIN_KEY|SB_H|SB_READ|SB_KEY)\b/.test(storeCode), "store service-role only, no anon fallback");
    ok(/createSignedUploadUrl\(/.test(storeCode) && /upsert:\s*false/.test(storeCode) && !/\bcreateResumableUpload\b|x-signature|\btus\b/i.test(storeCode), "standard signed upload, no TUS");
    ok(/typeof window/.test(storeCode), "store server-only guard");
    ok(/\.eq\("status",\s*"created"\)/.test(storeCode) && /\.eq\("status",\s*"upload_authorized"\)/.test(storeCode), "store uses CAS status guards");
    // P1F-1: the non-atomic count/insert trio is gone; reservation goes through the RPC.
    ok(!/\b(insertCreated|countRecentSessions|countActiveSessions)\b/.test(storeCode), "P1F-1 non-atomic count/insert trio removed from store code");
    ok(/\.rpc\("reserve_media_upload_session"/.test(storeCode), "P1F-1 store calls the atomic reservation RPC");
    ok(!/p_(rate|window|ttl|now|since|expires|limit|active)/i.test(storeCode), "P1F-1 store passes no rate/window/TTL/now RPC params");
    const wb = storeCode.match(/\.(insert|update)\(\{[\s\S]*?\}\)/g) || [];
    ok(wb.length >= 3 && wb.every((b) => !/token|signed|service_role|secret/i.test(b)), "no token/signed/secret persisted to DB (CAS updates only)");
    for (const p of ["lib/social/storage-upload.ts", "components/discover/CreateFlow.tsx", "components/circle/CircleOnboardForm.tsx"]) ok(!/upload-session/.test(read(p)), `no cutover: ${p}`);
    // Migration source presence + shape.
    const mig = read("migrations/2026-09-06-sec00b-p1f-1-media-upload-atomic-reservation.sql");
    ok(/CREATE OR REPLACE FUNCTION public\.reserve_media_upload_session/.test(mig), "migration creates reserve_media_upload_session");
    ok(/SECURITY INVOKER/.test(mig) && !/SECURITY DEFINER/.test(mig), "migration SECURITY INVOKER, never DEFINER");
    ok(/pg_advisory_xact_lock/.test(mig) && /hashtextextended\('sec00b:media_upload_reservation:'/.test(mig), "migration uses per-owner advisory xact lock");
    ok(/GRANT EXECUTE ON FUNCTION public\.reserve_media_upload_session[\s\S]*TO service_role/.test(mig) && /REVOKE ALL ON FUNCTION public\.reserve_media_upload_session[\s\S]*FROM PUBLIC/.test(mig), "migration REVOKEs PUBLIC + GRANTs service_role");
  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}

main();
