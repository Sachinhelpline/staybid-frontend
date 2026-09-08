#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1H-2 — hermetic test for the dormant upload-completion gate.
//   Run: node tests/social/media-upload-completion.test.js
//
// ZERO live network / Supabase / Storage. Compiles the REAL
// lib/social/upload-completion.ts + upload-observation-store.ts with the lockfile
// tsc into an OS TEMP dir, then drives:
//   • runUploadCompletion(req, deps) — the pure handler — with INJECTED fakes
//     (verify + store), proving the strict order (auth → flag → validate →
//     configured → owner preflight → Storage observe → P1H-1 confirm) and the
//     bounded public response;
//   • interpretListV2Result / interpretConfirmOutcome / parseCompletionBody — the
//     pure interpreters — with fake provider payloads (exact identity, sibling,
//     ambiguous, missing/invalid metadata, size/contentLength disagreement, strict
//     RPC outcome parsing);
//   • the REAL createUploadObservationStore against an INJECTED Supabase-like
//     double (owner-bound preflight SELECT, the ONE listV2 call on the server
//     constant bucket + exact derived prefix, and the six-param confirmation RPC).
// C1–C30. Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eqv(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

const SESSION_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"; // canonical lowercase uuid v4 (has hex letters)
const OWNER = "user_owner_1";
const QB = "social-media-quarantine";
const CEILING = 104857600;
const KEY = "sessions/" + SESSION_ID + "/raw";
const PREFIX = "sessions/" + SESSION_ID + "/";
const OKBODY = { sessionId: SESSION_ID };
const OBS = { byteSize: 1024, contentType: "image/jpeg", storageObjectId: "objid_1", storageEtag: '"etag-abc"' };

function mkReq(authHeader, bodyObj) {
  return {
    headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? authHeader : null) },
    json: async () => { if (bodyObj === "__throw__") throw new Error("bad json"); return bodyObj; },
  };
}
function baseTarget(over = {}) {
  return { id: SESSION_ID, ownerUserId: OWNER, status: "upload_authorized", quarantineBucket: QB, objectKey: KEY, ...over };
}
// Instrumented fake store — records every method call so "no store/Storage work"
// invariants are provable.
function instrStore(over = {}) {
  const calls = { configured: 0, findTarget: 0, observe: 0, confirm: 0, confirmArgs: null };
  const impl = {
    configured: () => true,
    findOwnedSessionTarget: async () => baseTarget(),
    observeExactObject: async () => ({ kind: "observed", observation: { ...OBS } }),
    confirmObservation: async () => "applied",
    ...over,
  };
  // Wrap the (possibly overridden) impls with counters so "ZERO store ops" and
  // "attempted once" invariants hold even for overridden/throwing methods.
  const store = {
    configured: () => { calls.configured++; return impl.configured(); },
    findOwnedSessionTarget: async (...a) => { calls.findTarget++; return impl.findOwnedSessionTarget(...a); },
    observeExactObject: async (...a) => { calls.observe++; return impl.observeExactObject(...a); },
    confirmObservation: async (ownerId, sessionId, observation) => { calls.confirm++; calls.confirmArgs = { ownerId, sessionId, observation }; return impl.confirmObservation(ownerId, sessionId, observation); },
  };
  return { store, calls };
}
function baseDeps(over = {}) {
  const { store } = instrStore();
  return { verify: async () => ({ id: OWNER }), store, env: { MEDIA_UPLOAD_OBSERVATION_ENABLED: "true" }, ...over };
}
async function readJson(res) { return await res.json(); }
function keysOf(o) { return Object.keys(o).sort(); }

// ── Injected Supabase-like double for the REAL store ────────────────────────
function fakeSupabase(plan) {
  const calls = { fromTable: null, select: null, eqs: [], maybeSingle: 0, storageBucket: null, listV2Args: null, listV2Count: 0, rpcFn: null, rpcParams: null, rpcCount: 0 };
  const client = {
    from(table) {
      calls.fromTable = table;
      const b = {
        select(cols) { calls.select = cols; return b; },
        eq(k, v) { calls.eqs.push([k, v]); return b; },
        async maybeSingle() { calls.maybeSingle++; if (plan.dbError) return { data: null, error: new Error("db") }; return { data: plan.row ?? null, error: null }; },
      };
      return b;
    },
    storage: {
      from(bucket) {
        calls.storageBucket = bucket;
        return {
          async listV2(opts) {
            calls.listV2Count++; calls.listV2Args = opts;
            if (plan.listThrow) throw new Error("boom");
            if (plan.listError) return { data: null, error: new Error("list") };
            return { data: plan.listData ?? v2([]), error: null };
          },
        };
      },
    },
    async rpc(fn, params) { calls.rpcCount++; calls.rpcFn = fn; calls.rpcParams = params; if (plan.rpcError) return { data: null, error: new Error("rpc") }; return { data: plan.rpcData, error: null }; },
  };
  return { client, calls };
}
// A listV2 object entry for the exact expected object (valid metadata).
function exactObject(over = {}) {
  return { key: KEY, id: "objid_1", updated_at: "t", created_at: "t", last_accessed_at: "t", metadata: { eTag: '"etag-abc"', size: 1024, mimetype: "image/jpeg", cacheControl: "max-age=3600", lastModified: "t", contentLength: 1024, httpStatusCode: 200 }, ...over };
}
// A realistic complete SearchV2Result (the R1 contract: objects + folders array +
// exact boolean hasNext). `over` can inject hasNext/folders for the R1 cases.
function v2(objects, over = {}) {
  return { objects, folders: [], hasNext: false, ...over };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-p1h2-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    fs.copyFileSync(path.join(REPO, "lib/social/upload-completion.ts"), path.join(SRC, "upload-completion.ts"));
    fs.copyFileSync(path.join(REPO, "lib/social/upload-observation-store.ts"), path.join(SRC, "upload-observation-store.ts"));
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
    console.log("• Local tsc compile: exit 0, clean (strict) — orchestrator + STORE");

    process.env.NODE_PATH = REPO_NM;
    require("module").Module._initPaths();

    const P = require(path.join(OUT, "upload-completion.js"));
    const ST = require(path.join(OUT, "upload-observation-store.js"));

    // ── C1 — unauthenticated: no store / Storage work ─────────────────────
    section("C1 unauthenticated");
    for (const v of [async () => null, async () => ({}), async () => ({ id: "" }), async () => { throw new Error("x"); }]) {
      const { store, calls } = instrStore();
      const res = await P.runUploadCompletion(mkReq(null, OKBODY), baseDeps({ verify: v, store }));
      eqv(res.status, 401, "unauth -> 401");
      eqv((await readJson(res)).error, "unauthorized", "unauth code");
      ok(calls.findTarget === 0 && calls.observe === 0 && calls.confirm === 0 && calls.configured === 0, "unauth -> ZERO store ops");
    }

    // ── C2 — disabled flag: no DB/Storage work after auth ─────────────────
    section("C2 disabled flag");
    for (const flag of [undefined, "", "false", "1", "yes", "TRUE ", " true"]) {
      const { store, calls } = instrStore();
      const env = flag === undefined ? {} : { MEDIA_UPLOAD_OBSERVATION_ENABLED: flag };
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store, env }));
      if (String(flag).trim().toLowerCase() === "true") {
        // " true"/"TRUE " normalize to enabled — this is the enabled path, skip.
        continue;
      }
      eqv(res.status, 404, `flag=${JSON.stringify(flag)} -> 404`);
      eqv((await readJson(res)).error, "media_upload_observation_disabled", "disabled code");
      ok(calls.findTarget === 0 && calls.observe === 0 && calls.confirm === 0 && calls.configured === 0, `flag=${JSON.stringify(flag)} -> ZERO store ops`);
    }
    // exact normalized "true" required
    {
      const { store, calls } = instrStore();
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store, env: { MEDIA_UPLOAD_OBSERVATION_ENABLED: " true " } }));
      eqv(res.status, 200, "normalized 'true' enables");
      ok(calls.confirm === 1, "enabled path reaches confirm");
    }

    // ── C3 — malformed/uppercase/wrong-version UUID / bad body ────────────
    section("C3 malformed request body");
    const badBodies = [
      ["uppercase uuid", { sessionId: SESSION_ID.toUpperCase() }],
      ["v1 uuid", { sessionId: "11111111-1111-1111-8111-111111111111" }],
      ["bad variant", { sessionId: "11111111-1111-4111-c111-111111111111" }],
      ["no dashes", { sessionId: SESSION_ID.replace(/-/g, "") }],
      ["non-string", { sessionId: 12345 }],
      ["missing sessionId", { foo: "bar" }],
      ["extra key", { sessionId: SESSION_ID, owner: "x" }],
      ["array", [SESSION_ID]],
      ["null body", null],
      ["json throws", "__throw__"],
    ];
    for (const [label, body] of badBodies) {
      const { store, calls } = instrStore();
      const res = await P.runUploadCompletion(mkReq("Bearer x", body), baseDeps({ store }));
      eqv(res.status, 400, `${label} -> 400`);
      eqv((await readJson(res)).error, "invalid_request", `${label} code`);
      ok(calls.findTarget === 0 && calls.observe === 0 && calls.confirm === 0, `${label} -> ZERO store ops`);
    }

    // ── C4 — wrong-owner / unknown preflight: no Storage read ─────────────
    section("C4 wrong-owner / unknown preflight");
    {
      const { store, calls } = instrStore({ findOwnedSessionTarget: async () => null });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "unknown/wrong-owner -> 409");
      eqv((await readJson(res)).error, "upload_session_not_available", "code");
      ok(calls.observe === 0 && calls.confirm === 0, "no Storage read / no confirm");
    }

    // ── C5 — DB target wrong bucket: no Storage read ──────────────────────
    section("C5 DB target wrong bucket");
    {
      const { store, calls } = instrStore({ findOwnedSessionTarget: async () => baseTarget({ quarantineBucket: "evil-bucket" }) });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "wrong bucket -> 409");
      eqv((await readJson(res)).error, "upload_session_not_available", "code");
      ok(calls.observe === 0, "no Storage read");
    }

    // ── C6 — DB target wrong key: no Storage read ─────────────────────────
    section("C6 DB target wrong key");
    {
      const { store, calls } = instrStore({ findOwnedSessionTarget: async () => baseTarget({ objectKey: "sessions/someone-else/raw" }) });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "wrong key -> 409");
      eqv((await readJson(res)).error, "upload_session_not_available", "code");
      ok(calls.observe === 0, "no Storage read");
    }

    // ── C7 — created/uploading/rejected/expired: no read / no confirm ─────
    section("C7 pre-observation non-acceptable states");
    for (const s of ["created", "uploading", "rejected", "expired"]) {
      const { store, calls } = instrStore({ findOwnedSessionTarget: async () => baseTarget({ status: s }) });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, `${s} -> 409`);
      eqv((await readJson(res)).error, "upload_session_not_available", `${s} code`);
      ok(calls.observe === 0 && calls.confirm === 0, `${s} -> no Storage read / no confirm`);
    }

    // ── C8 — already quarantined: accepted, no Storage reread ─────────────
    section("C8 already quarantined");
    {
      const { store, calls } = instrStore({ findOwnedSessionTarget: async () => baseTarget({ status: "quarantined" }) });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 200, "quarantined -> accepted");
      eqv((await readJson(res)).status, "accepted", "accepted status");
      ok(calls.observe === 0 && calls.confirm === 0, "no Storage reread / no confirm");
    }

    // ── C9 — validating/file_safety/media_processing/ready: accepted ──────
    section("C9 post-observation states");
    for (const s of ["validating", "file_safety", "media_processing", "ready"]) {
      const { store, calls } = instrStore({ findOwnedSessionTarget: async () => baseTarget({ status: s }) });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 200, `${s} -> accepted`);
      eqv((await readJson(res)).status, "accepted", `${s} accepted`);
      ok(calls.observe === 0 && calls.confirm === 0, `${s} -> no Storage reread`);
    }

    // ── C10 — valid upload_authorized + exact metadata: one observe, exact RPC ─
    section("C10 valid completion");
    {
      const { store, calls } = instrStore();
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 200, "valid -> 200 accepted");
      eqv((await readJson(res)).status, "accepted", "accepted");
      eqv(calls.observe, 1, "exactly ONE observeExactObject call");
      eqv(calls.confirm, 1, "exactly ONE confirmObservation call");
      const a = calls.confirmArgs;
      eqv(a.ownerId, OWNER, "confirm ownerId = verified owner (not client)");
      eqv(a.sessionId, SESSION_ID, "confirm sessionId");
      ok(a.observation.byteSize === 1024 && a.observation.contentType === "image/jpeg" && a.observation.storageObjectId === "objid_1" && a.observation.storageEtag === '"etag-abc"', "confirm carries exact server-observed values");
    }

    // ── C11 — missing object: retryable/not-observed, ZERO confirm RPC ────
    section("C11 missing object");
    {
      const { store, calls } = instrStore({ observeExactObject: async () => ({ kind: "not_observed" }) });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "not observed -> 409");
      eqv((await readJson(res)).error, "upload_not_observed_yet", "code");
      eqv(calls.confirm, 0, "ZERO confirm RPC");
    }

    // ── C12 — provider metadata error: 503-style, ZERO confirm RPC ────────
    section("C12 provider metadata error");
    for (const obs of [async () => ({ kind: "error" }), async () => { throw new Error("x"); }]) {
      const { store, calls } = instrStore({ observeExactObject: obs });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 503, "provider error -> 503");
      eqv((await readJson(res)).error, "upload_observation_service_unavailable", "code");
      eqv(calls.confirm, 0, "ZERO confirm RPC");
    }

    // ── C13-C20 — interpretListV2Result exact identity + metadata ─────────
    // (all valid-shape fixtures carry the realistic SearchV2Result: folders:[], hasNext:false)
    const II = (objs, over) => P.interpretListV2Result(v2(objs, over), { sessionId: SESSION_ID });
    section("C13 prefix sibling / relative-name reconstruction");
    ok(II([exactObject({ key: KEY + "-sibling" })]).kind === "not_observed", "prefix-only sibling (key) -> not_observed");
    ok(II([exactObject({ key: undefined, name: "raw-sibling" })]).kind === "not_observed", "relative sibling name -> not_observed");
    ok(II([exactObject({ key: KEY })]).kind === "observed", "exact key -> observed");
    ok(II([exactObject({ key: undefined, name: "raw" })]).kind === "observed", "relative name 'raw' -> observed");
    ok(II([exactObject({ key: undefined, name: KEY })]).kind === "observed", "full key as name -> observed");
    {
      const r = II([exactObject()]);
      ok(r.kind === "observed" && r.observation.byteSize === 1024 && r.observation.contentType === "image/jpeg" && r.observation.storageObjectId === "objid_1" && r.observation.storageEtag === '"etag-abc"', "observed carries exact metadata");
    }

    section("C14 ambiguous / malformed");
    ok(II([exactObject(), exactObject({ id: "obj2" })]).kind === "ambiguous", "two objects -> ambiguous");
    ok(II([]).kind === "not_observed", "empty -> not_observed");
    ok(P.interpretListV2Result({}, { sessionId: SESSION_ID }).kind === "error", "no objects array -> error");
    ok(P.interpretListV2Result(null, { sessionId: SESSION_ID }).kind === "error", "null -> error");
    ok(P.interpretListV2Result({ objects: "nope", folders: [], hasNext: false }, { sessionId: SESSION_ID }).kind === "error", "objects not array -> error");

    section("C15 missing/blank object id");
    for (const bad of [undefined, "", "   ", 123, null, "x".repeat(257)]) {
      ok(II([exactObject({ id: bad })]).kind === "invalid_metadata", "objectId=" + JSON.stringify(bad) + " -> invalid_metadata");
    }

    section("C16 missing/invalid actual size");
    for (const bad of [undefined, null, 0, -5, 1.5, "1024", NaN]) {
      ok(II([exactObject({ metadata: { ...exactObject().metadata, size: bad, contentLength: undefined } })]).kind === "invalid_metadata", "size=" + JSON.stringify(bad) + " -> invalid_metadata");
    }
    ok(II([exactObject({ metadata: null })]).kind === "invalid_metadata", "null metadata -> invalid_metadata");

    section("C17 >100 MiB actual size");
    ok(II([exactObject({ metadata: { ...exactObject().metadata, size: CEILING + 1, contentLength: undefined } })]).kind === "invalid_metadata", "size>ceiling -> invalid_metadata");
    ok(II([exactObject({ metadata: { ...exactObject().metadata, size: CEILING, contentLength: CEILING } })]).kind === "observed", "size==ceiling -> observed");

    section("C18 missing/blank MIME");
    for (const bad of [undefined, "", "   ", 123, null, "x".repeat(129)]) {
      ok(II([exactObject({ metadata: { ...exactObject().metadata, mimetype: bad } })]).kind === "invalid_metadata", "mime=" + JSON.stringify(bad) + " -> invalid_metadata");
    }

    section("C19 missing/blank ETag");
    for (const bad of [undefined, "", "   ", 123, null, "x".repeat(513)]) {
      ok(II([exactObject({ metadata: { ...exactObject().metadata, eTag: bad } })]).kind === "invalid_metadata", "etag=" + JSON.stringify(bad) + " -> invalid_metadata");
    }

    section("C20 size/contentLength disagreement");
    ok(II([exactObject({ metadata: { ...exactObject().metadata, size: 1024, contentLength: 2048 } })]).kind === "invalid_metadata", "size!=contentLength -> invalid_metadata");
    ok(II([exactObject({ metadata: { ...exactObject().metadata, size: 1024, contentLength: 1024 } })]).kind === "observed", "size==contentLength -> observed");
    ok(II([exactObject({ metadata: { ...exactObject().metadata, size: 1024, contentLength: undefined } })]).kind === "observed", "no contentLength -> observed");
    ok(II([exactObject({ metadata: { ...exactObject().metadata, size: 1024, contentLength: "1024" } })]).kind === "invalid_metadata", "non-number contentLength -> invalid_metadata");

    // ── R1 — listV2 pagination / response-shape fail-closed ───────────────
    section("R1 pagination / SearchV2Result shape fail-closed");
    // R1-1 one exact valid object, folders=[], hasNext=false -> observed
    ok(P.interpretListV2Result(v2([exactObject()]), { sessionId: SESSION_ID }).kind === "observed", "R1-1 complete single-object result -> observed");
    // R1-2 one exact valid object, hasNext=true -> ambiguous
    ok(P.interpretListV2Result(v2([exactObject()], { hasNext: true }), { sessionId: SESSION_ID }).kind === "ambiguous", "R1-2 hasNext=true (with exact object) -> ambiguous");
    // R1-3 zero objects, hasNext=true -> ambiguous (NOT not_observed)
    ok(P.interpretListV2Result(v2([], { hasNext: true }), { sessionId: SESSION_ID }).kind === "ambiguous", "R1-3 hasNext=true (zero objects) -> ambiguous, not not_observed");
    // R1-4 multiple objects, folders=[], hasNext=false -> ambiguous
    ok(P.interpretListV2Result(v2([exactObject(), exactObject({ id: "obj2" })]), { sessionId: SESSION_ID }).kind === "ambiguous", "R1-4 multiple objects -> ambiguous");
    // R1-5 one exact object, folders non-empty, hasNext=false -> ambiguous
    ok(P.interpretListV2Result(v2([exactObject()], { folders: [{ name: "sub/" }] }), { sessionId: SESSION_ID }).kind === "ambiguous", "R1-5 non-empty folders -> ambiguous");
    // R1-6/7/8 folders missing / null / non-array -> error
    ok(P.interpretListV2Result({ objects: [exactObject()], hasNext: false }, { sessionId: SESSION_ID }).kind === "error", "R1-6 folders missing -> error");
    ok(P.interpretListV2Result({ objects: [exactObject()], folders: null, hasNext: false }, { sessionId: SESSION_ID }).kind === "error", "R1-7 folders null -> error");
    ok(P.interpretListV2Result({ objects: [exactObject()], folders: "nope", hasNext: false }, { sessionId: SESSION_ID }).kind === "error", "R1-8 folders non-array -> error");
    // R1-9/10/11/12 hasNext missing / null / string / number -> error (exact boolean only)
    ok(P.interpretListV2Result({ objects: [exactObject()], folders: [] }, { sessionId: SESSION_ID }).kind === "error", "R1-9 hasNext missing -> error");
    ok(P.interpretListV2Result({ objects: [exactObject()], folders: [], hasNext: null }, { sessionId: SESSION_ID }).kind === "error", "R1-10 hasNext null -> error");
    ok(P.interpretListV2Result({ objects: [exactObject()], folders: [], hasNext: "false" }, { sessionId: SESSION_ID }).kind === "error", "R1-11 hasNext string 'false' -> error");
    ok(P.interpretListV2Result({ objects: [exactObject()], folders: [], hasNext: 0 }, { sessionId: SESSION_ID }).kind === "error", "R1-12 hasNext number 0 -> error");
    // R1-13 valid shape + exact prefix sibling -> not_observed
    ok(P.interpretListV2Result(v2([exactObject({ key: KEY + "-sibling" })]), { sessionId: SESSION_ID }).kind === "not_observed", "R1-13 prefix sibling in complete result -> not_observed");
    // R1-14 valid shape + malformed metadata -> invalid_metadata preserved
    ok(P.interpretListV2Result(v2([exactObject({ metadata: null })]), { sessionId: SESSION_ID }).kind === "invalid_metadata", "R1-14 malformed metadata -> invalid_metadata preserved");
    // R1-15 hasNext=true -> ZERO confirmObservation at worker level
    {
      const { client, calls } = fakeSupabase({ listData: v2([exactObject()], { hasNext: true }) });
      const store = ST.createUploadObservationStore({}, { client });
      const r = await store.observeExactObject(baseTarget());
      ok(r.kind === "ambiguous", "R1-15 store observe hasNext=true -> ambiguous");
      eqv(calls.rpcCount, 0, "R1-15 ZERO confirmation RPC on hasNext ambiguity");
      // full handler: hasNext=true -> 503, ZERO confirm
      const hstore = { configured: () => true, findOwnedSessionTarget: async () => baseTarget(), observeExactObject: async () => store.observeExactObject(baseTarget()), confirmObservation: async () => "applied" };
      let confirmed = 0; const hstore2 = { ...hstore, confirmObservation: async () => { confirmed++; return "applied"; } };
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), { verify: async () => ({ id: OWNER }), store: hstore2, env: { MEDIA_UPLOAD_OBSERVATION_ENABLED: "true" } });
      eqv(res.status, 503, "R1-15 handler hasNext=true -> 503");
      eqv(confirmed, 0, "R1-15 handler ZERO confirm on hasNext ambiguity");
    }
    // R1-16 folders non-empty -> ZERO confirmObservation at worker level; ZERO second listV2
    {
      const { client, calls } = fakeSupabase({ listData: v2([exactObject()], { folders: [{ name: "x/" }] }) });
      const store = ST.createUploadObservationStore({}, { client });
      const r = await store.observeExactObject(baseTarget());
      ok(r.kind === "ambiguous", "R1-16 store observe non-empty folders -> ambiguous");
      eqv(calls.rpcCount, 0, "R1-16 ZERO confirmation RPC on folders ambiguity");
      eqv(calls.listV2Count, 1, "R1-16 exactly ONE listV2 call (no second Storage read)");
    }

    // ── C21 / C22 — P1H-1 applied / idempotent + quarantined -> accepted ──
    section("C21/C22 applied / idempotent accepted");
    for (const oc of ["applied", "idempotent_existing"]) {
      const { store } = instrStore({ confirmObservation: async () => oc });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 200, `${oc} -> 200`);
      eqv((await readJson(res)).status, "accepted", `${oc} accepted`);
    }

    // ── C23 — applied/idempotent with wrong/missing status: fail closed ───
    section("C23 wrong/missing RPC status (interpretConfirmOutcome + store throw)");
    eqv(P.interpretConfirmOutcome({ outcome: "applied", status: "quarantined" }), "applied", "applied+quarantined ok");
    eqv(P.interpretConfirmOutcome({ outcome: "idempotent_existing", status: "quarantined" }), "idempotent_existing", "idempotent+quarantined ok");
    eqv(P.interpretConfirmOutcome({ outcome: "applied", status: "ready" }), "malformed", "applied+wrong status -> malformed");
    eqv(P.interpretConfirmOutcome({ outcome: "applied" }), "malformed", "applied+missing status -> malformed");
    eqv(P.interpretConfirmOutcome({ outcome: "applied", status: 5 }), "malformed", "applied+non-string status -> malformed");
    {
      // store-level: rpc returns applied+wrong status -> confirmObservation throws -> handler 503
      const { client } = fakeSupabase({ rpcData: { outcome: "applied", status: "ready" } });
      const store = ST.createUploadObservationStore({}, { client });
      let threw = false; try { await store.confirmObservation(OWNER, SESSION_ID, OBS); } catch { threw = true; }
      ok(threw, "store.confirmObservation throws on wrong status");
    }

    // ── C24 — expired -> bounded non-accepted ─────────────────────────────
    section("C24 expired");
    {
      const { store } = instrStore({ confirmObservation: async () => "expired" });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "expired -> 409");
      eqv((await readJson(res)).error, "upload_session_not_available", "code");
    }

    // ── C25 — observation_mismatch -> bounded mismatch ────────────────────
    section("C25 observation_mismatch");
    {
      const { store } = instrStore({ confirmObservation: async () => "observation_mismatch" });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "mismatch -> 409");
      eqv((await readJson(res)).error, "upload_observation_mismatch", "code");
    }

    // ── C26 — state_conflict -> bounded conflict ──────────────────────────
    section("C26 state_conflict");
    {
      const { store } = instrStore({ confirmObservation: async () => "state_conflict" });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 409, "state_conflict -> 409");
      eqv((await readJson(res)).error, "upload_session_not_available", "code");
    }

    // ── C27 — unknown/malformed RPC response -> generic service failure ───
    section("C27 unknown/malformed RPC");
    eqv(P.interpretConfirmOutcome({ outcome: "weird" }), "malformed", "unknown outcome -> malformed");
    eqv(P.interpretConfirmOutcome(null), "malformed", "null -> malformed");
    eqv(P.interpretConfirmOutcome("nope"), "malformed", "string -> malformed");
    {
      const { client } = fakeSupabase({ rpcData: { outcome: "weird" } });
      const store = ST.createUploadObservationStore({}, { client });
      let threw = false; try { await store.confirmObservation(OWNER, SESSION_ID, OBS); } catch { threw = true; }
      ok(threw, "store throws on malformed outcome");
      // and rpc provider error also throws
      const { client: c2 } = fakeSupabase({ rpcError: true });
      const s2 = ST.createUploadObservationStore({}, { client: c2 });
      let threw2 = false; try { await s2.confirmObservation(OWNER, SESSION_ID, OBS); } catch { threw2 = true; }
      ok(threw2, "store throws on rpc provider error");
    }
    {
      // handler maps a confirm throw to 503
      const { store, calls } = instrStore({ confirmObservation: async () => { throw new Error("x"); } });
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store }));
      eqv(res.status, 503, "confirm throw -> 503");
      eqv((await readJson(res)).error, "upload_observation_service_unavailable", "code");
      eqv(calls.confirm, 1, "confirm attempted once");
    }

    // ── C28 — public response never includes object metadata/provider details ─
    section("C28 public response hides metadata");
    {
      const forbidden = ["byteSize", "contentType", "storageObjectId", "storageEtag", "objectId", "etag", "bucket", "objectKey", "ownerId", "owner_user_id", "size", "mimetype", "metadata"];
      // accepted body
      const okRes = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps());
      const okBody = await readJson(okRes);
      ok(JSON.stringify(keysOf(okBody)) === JSON.stringify(["ok", "status"]), "accepted body keys exactly {ok,status}");
      // a mismatch failure body
      const mmRes = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), baseDeps({ store: instrStore({ confirmObservation: async () => "observation_mismatch" }).store }));
      const mmBody = await readJson(mmRes);
      ok(JSON.stringify(keysOf(mmBody)) === JSON.stringify(["error", "ok"]), "failure body keys exactly {ok,error}");
      for (const b of [okBody, mmBody]) {
        const s = JSON.stringify(b);
        for (const f of forbidden) ok(!s.includes(f), "response omits '" + f + "'");
      }
    }

    // ── C29 — customer body cannot choose owner/bucket/path/size/MIME/etag ─
    section("C29 body authority is sessionId-only");
    for (const extra of [{ owner: "x" }, { bucket: "b" }, { objectKey: "k" }, { byteSize: 5 }, { contentType: "c" }, { objectId: "o" }, { etag: "e" }, { status: "ready" }, { ownerUserId: "z" }]) {
      const body = { sessionId: SESSION_ID, ...extra };
      const { store } = instrStore();
      const res = await P.runUploadCompletion(mkReq("Bearer x", body), baseDeps({ store }));
      eqv(res.status, 400, "extra field " + Object.keys(extra)[0] + " -> 400 (rejected, not ignored)");
      eqv((await readJson(res)).error, "invalid_request", "code");
    }

    // ── C30 — Storage read: server constant bucket + exact derived target only ─
    section("C30 store observeExactObject targeting + one call");
    {
      // A malicious DB row cannot redirect the Storage read: bucket/key are ignored.
      const evilTarget = { id: SESSION_ID, ownerUserId: OWNER, status: "upload_authorized", quarantineBucket: "EVIL-BUCKET", objectKey: "EVIL/KEY" };
      const { client, calls } = fakeSupabase({ listData: v2([exactObject()]) });
      const store = ST.createUploadObservationStore({}, { client });
      const r = await store.observeExactObject(evilTarget);
      ok(r.kind === "observed", "observeExactObject -> observed");
      eqv(calls.storageBucket, QB, "Storage read uses the SERVER CONSTANT bucket (never the DB bucket)");
      eqv(calls.listV2Count, 1, "exactly ONE listV2 call");
      eqv(calls.listV2Args.prefix, PREFIX, "exact server-derived prefix");
      eqv(calls.listV2Args.limit, 2, "tiny fixed limit 2");
      eqv(calls.listV2Args.with_delimiter, false, "flat listing (with_delimiter false)");
      // missing object -> not_observed (retryable), no confirm
      const { client: c2, calls: k2 } = fakeSupabase({ listData: v2([]) });
      const s2 = ST.createUploadObservationStore({}, { client: c2 });
      ok((await s2.observeExactObject(evilTarget)).kind === "not_observed", "empty listing -> not_observed");
      eqv(k2.rpcCount, 0, "observe never calls the RPC");
      // provider list error / throw -> error
      const { client: c3 } = fakeSupabase({ listError: true });
      ok((await ST.createUploadObservationStore({}, { client: c3 }).observeExactObject(evilTarget)).kind === "error", "list error -> error");
      const { client: c4 } = fakeSupabase({ listThrow: true });
      ok((await ST.createUploadObservationStore({}, { client: c4 }).observeExactObject(evilTarget)).kind === "error", "list throw -> error");
    }

    // ── store: findOwnedSessionTarget is owner-bound + minimal + no mutation ─
    section("store findOwnedSessionTarget owner-bound read");
    {
      const { client, calls } = fakeSupabase({ row: { id: SESSION_ID, owner_user_id: OWNER, status: "upload_authorized", quarantine_bucket: QB, object_key: KEY } });
      const store = ST.createUploadObservationStore({}, { client });
      const t = await store.findOwnedSessionTarget(OWNER, SESSION_ID);
      eqv(calls.fromTable, "media_upload_sessions", "reads media_upload_sessions");
      ok(!/\*/.test(calls.select) && /id/.test(calls.select) && /owner_user_id/.test(calls.select) && /status/.test(calls.select) && /quarantine_bucket/.test(calls.select) && /object_key/.test(calls.select), "minimal explicit select (no *)");
      ok(calls.eqs.some(([k, v]) => k === "id" && v === SESSION_ID) && calls.eqs.some(([k, v]) => k === "owner_user_id" && v === OWNER), "bound by id AND owner_user_id");
      ok(t && t.id === SESSION_ID && t.ownerUserId === OWNER && t.quarantineBucket === QB && t.objectKey === KEY, "shaped target");
      // null row -> null; db error -> throw
      const { client: c2 } = fakeSupabase({ row: null });
      ok((await ST.createUploadObservationStore({}, { client: c2 }).findOwnedSessionTarget(OWNER, SESSION_ID)) === null, "no row -> null");
      const { client: c3 } = fakeSupabase({ dbError: true });
      let threw = false; try { await ST.createUploadObservationStore({}, { client: c3 }).findOwnedSessionTarget(OWNER, SESSION_ID); } catch { threw = true; }
      ok(threw, "db error -> throws (handler maps to 503)");
    }

    // ── store: confirmObservation sends exactly the six P1H-1 params ──────
    section("store confirmObservation six-param RPC");
    {
      const { client, calls } = fakeSupabase({ rpcData: { outcome: "applied", status: "quarantined" } });
      const store = ST.createUploadObservationStore({}, { client });
      const oc = await store.confirmObservation(OWNER, SESSION_ID, OBS);
      eqv(oc, "applied", "returns parsed outcome");
      eqv(calls.rpcFn, "confirm_media_upload_quarantine_observation", "calls the P1H-1 RPC");
      eqv(JSON.stringify(keysOf(calls.rpcParams)), JSON.stringify(["p_observed_byte_size", "p_observed_content_type", "p_owner_user_id", "p_session_id", "p_storage_etag", "p_storage_object_id"]), "exactly the six P1H-1 params");
      eqv(calls.rpcParams.p_session_id, SESSION_ID, "p_session_id");
      eqv(calls.rpcParams.p_owner_user_id, OWNER, "p_owner_user_id (verified owner)");
      eqv(calls.rpcParams.p_observed_byte_size, 1024, "p_observed_byte_size");
      eqv(calls.rpcParams.p_observed_content_type, "image/jpeg", "p_observed_content_type (exact, no normalization)");
      eqv(calls.rpcParams.p_storage_object_id, "objid_1", "p_storage_object_id");
      eqv(calls.rpcParams.p_storage_etag, '"etag-abc"', "p_storage_etag");
    }

    // ── store: configured() fails closed without the service-role key / trusted url ─
    section("store configured() fail-closed");
    ok(ST.createUploadObservationStore({}, {}).configured() === false, "no key -> configured false");
    ok(ST.createUploadObservationStore({ SUPABASE_SERVICE_ROLE_KEY: "  " }, {}).configured() === false, "blank key -> configured false");
    ok(ST.createUploadObservationStore({ SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_URL: "https://evil.example.com" }, {}).configured() === false, "untrusted url -> configured false");
    ok(ST.createUploadObservationStore({ SUPABASE_SERVICE_ROLE_KEY: "k" }, {}).configured() === true, "key + default pinned origin -> configured true");
    ok(ST.createUploadObservationStore({}, { client: fakeSupabase({}).client }).configured() === true, "injected client -> configured true");

    // ── handler: store not configured -> 503, no preflight ────────────────
    section("handler store-unconfigured -> 503");
    {
      const { calls } = instrStore();
      const store = { configured: () => false, findOwnedSessionTarget: async () => { calls.findTarget++; return null; }, observeExactObject: async () => ({ kind: "error" }), confirmObservation: async () => "applied" };
      const res = await P.runUploadCompletion(mkReq("Bearer x", OKBODY), { verify: async () => ({ id: OWNER }), store, env: { MEDIA_UPLOAD_OBSERVATION_ENABLED: "true" } });
      eqv(res.status, 503, "unconfigured -> 503");
      eqv((await readJson(res)).error, "upload_observation_service_unavailable", "code");
      eqv(calls.findTarget, 0, "no preflight when unconfigured");
    }
  } catch (e) {
    fatal = e;
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }

  console.log("");
  section("RESULT");
  if (fatal) { console.error("FATAL: " + (fatal && fatal.stack ? fatal.stack : String(fatal))); process.exitCode = 1; return; }
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}

main().catch((e) => { console.error("FATAL: " + (e && e.stack ? e.stack : String(e))); process.exitCode = 1; });
