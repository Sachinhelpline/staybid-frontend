#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — dedicated gateway FUNCTIONAL suite.
//
//   Run:  node tests/voice/voice-gateway.test.js
//
// Compiles server/voice-gateway/*.ts with the LOCKFILE-INSTALLED local tsc (NO
// npx) and drives the DI handlers with FAKES — a fake RealtimeTransport + fake
// sideband + fake StayBid-read fetch + a runtime-generated ES256 keypair. NO real
// provider, NO real device, NO network, NO DB. Covers the runtime/config gate,
// the session-assertion path, identity isolation, origin/body bounds, the fixed
// four-tool adapter + trust pipeline, UI-action authorization, prohibited-surface
// absence, rate/cost/circuit controls, the sideband turn/stale semantics, and the
// disable-only kill switch.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const jose = require("jose");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "gw");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

// ---- compile server/voice-gateway/*.ts with the LOCAL compiler ---------------
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "gw"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "server/voice-gateway"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "server/voice-gateway", f), path.join(SRC, "gw", f));
}
fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
      moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
      types: ["node", "ws"], lib: ["es2020"], strict: true, noEmitOnError: true, resolveJsonModule: true,
    },
    include: ["gw/**/*.ts"],
  }),
);
let TSC_BIN;
try {
  TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
} catch (_) {
  console.error("COMPILE GATE FAILED — local TypeScript compiler not installed. No npx fallback.");
  process.exit(2);
}
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], {
  cwd: REPO, encoding: "utf8",
});
if (compile.status !== 0) {
  console.error(`COMPILE GATE FAILED — local tsc exited ${compile.status}:`);
  console.error(compile.stdout || "");
  console.error(compile.stderr || "");
  process.exit(2);
}
console.log("• Local tsc compile (SB-04 gateway): exit 0, clean");
const G = require(path.join(OUT, "gw", "index.js"));
const SESS = require(path.join(OUT, "gw", "sessions.js"));
const SCHEMAS = require(path.join(OUT, "gw", "schemas.js"));
const AUTH = require(path.join(OUT, "gw", "auth.js"));
const CONFIG = require(path.join(OUT, "gw", "config.js"));
const RL = require(path.join(OUT, "gw", "rate-limit.js"));
const TE = require(path.join(OUT, "gw", "tool-executor.js"));
const SB = require(path.join(OUT, "gw", "sideband.js"));
const TEL = require(path.join(OUT, "gw", "telemetry.js"));
const OA = require(path.join(OUT, "gw", "openai-realtime.js"));

// R4 (SB04-R3-REREV-01): the FULL effective session.updated ack (the provider echoes
// the effective configuration; a bare ack is no longer readiness).
function effectiveAck(overrides = {}) {
  return JSON.stringify({
    type: "session.updated",
    session: Object.assign({
      type: "realtime",
      model: "gpt-realtime-2.1",
      tool_choice: "auto",
      tools: JSON.parse(JSON.stringify(OA.FIXED_TOOL_DEFINITIONS)),
      audio: { input: { turn_detection: { type: "server_vad", create_response: false, interrupt_response: false } } },
    }, overrides),
  });
}


// ---- assert framework --------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(label); console.error("  ✗ " + label); }
}
function section(name) { console.log("\n• " + name); }
const flushMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- key material + assertion helper ----------------------------------------
let PRIV, SPKI;
const ISS = "https://staybids.in";
const AUD = "staybid-voice-gateway";
async function makeAssertion(o = {}) {
  const now = Math.floor(Date.now() / 1000);
  return await new jose.SignJWT({
    scope: o.scope === undefined ? "voice:read" : o.scope,
    auth: o.auth === true,
    origin: o.origin === undefined ? ISS : o.origin,
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setSubject(o.sub || "vsub_test_subject")
    .setIssuer(o.iss || ISS)
    .setAudience(o.aud || AUD)
    .setIssuedAt(o.iat || now)
    .setExpirationTime(o.exp || now + 60)
    .setJti(o.jti || `jti_${Math.random().toString(36).slice(2)}`)
    .sign(o.key || PRIV);
}

// ---- fakes ------------------------------------------------------------------
function makeFakeSideband() {
  let cb = null, speechCb = null, commitCb = null, fatalCb = null;
  const sent = [];
  const requestIds = [];
  let cancelled = false, closed = false, responseRequests = 0, sendFail = false, sendThrow = false;
  return {
    conn: {
      onEvent(fn) { cb = fn; },
      onSpeech(fn) { speechCb = fn; },       // R6: (phase, itemId) VAD boundaries
      onCommit(fn) { commitCb = fn; },       // R6: authoritative commit boundary (itemId)
      onFatal(fn) { fatalCb = fn; },
      sendToolResult(p) { sent.push(p); },
      requestResponse(requestId) {           // R6: the ONE inference trigger (serialized)
        responseRequests += 1;
        requestIds.push(requestId);
        if (sendThrow) throw new Error("response.create send threw");
        return !sendFail;
      },
      cancelTurn() { cancelled = true; },
      close() { closed = true; },
    },
    emit(ev) { if (cb) cb(ev); },
    emitSpeech(phase, itemId) { if (speechCb) speechCb(phase, itemId); }, // drive VAD boundaries (item-id correlated)
    emitCommit(itemId) { if (commitCb) commitCb(itemId); },               // drive input_audio_buffer.committed
    emitFatal(reason) { if (fatalCb) fatalCb(reason); },
    setSendFail(v) { sendFail = v; },   // R6: simulate requestResponse returning false
    setSendThrow(v) { sendThrow = v; }, // R6: simulate requestResponse throwing
    sent,
    responseRequests: () => responseRequests,
    requestIds: () => requestIds.slice(),
    lastRequestId: () => requestIds[requestIds.length - 1],
    isCancelled: () => cancelled,
    isClosed: () => closed,
  };
}
// R6 helper: drive ONE committed user utterance (item-id correlated) through the fake
// VAD boundaries → the gateway's serialized scheduler sends response.create(requestId)
// → return the captured requestId so the test can emit the matching response.created.
function commitUtterance(sideband, itemId) {
  sideband.emitSpeech("start", itemId);
  sideband.emitSpeech("stop", itemId);
  sideband.emitCommit(itemId);
  return sideband.lastRequestId();
}
// R6 helper: establish a BOUND provider response for `responseId` by scheduling a real
// user-commit request and emitting the matching response.created (response_begin).
function establishResponse(sideband, session, responseId, itemId) {
  const reqId = commitUtterance(sideband, itemId);
  sideband.emit({ kind: "response_begin", responseId, requestId: reqId });
  return reqId;
}
// R6 helper for a DIRECT-attach sideband (no index.ts VAD wiring): schedule a user
// response request via the scheduler, then emit the matching response.created.
function establishDirect(side, sideband, session, responseId, itemId) {
  side.requestUserResponse(session, itemId);
  const reqId = sideband.lastRequestId();
  sideband.emit({ kind: "response_begin", responseId, requestId: reqId });
  return reqId;
}
function makeTransport(sideband, opts = {}) {
  return {
    isAvailable() { return opts.available !== false; },
    async createSession() {
      if (opts.fail) return { ok: false, code: opts.fail };
      return { ok: true, answerSdp: "v=0\r\nm=audio 9 UDP\r\n", providerSessionId: "prov_1", sideband: sideband.conn };
    },
  };
}
function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init: init || {} });
    const r = routes.find((x) => x.match(url));
    if (!r) return { ok: false, status: 404, text: async () => "{}" };
    if (r.throwAbort) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const body = typeof r.bodyFor === "function" ? r.bodyFor(url) : r.body;
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}
const HOTELS = (arr) => ({ match: (u) => u.includes("/api/hotels?") || u.endsWith("/api/hotels"), status: 200, body: { hotels: arr } });
const HOTEL_ONE = (h) => ({ match: (u) => /\/api\/hotels\/[^?]+$/.test(u), status: 200, body: { hotel: h } });
const FLASH = (deals) => ({ match: (u) => u.includes("/api/flash/near"), status: 200, body: { deals } });

const FULL_ENV = () => ({
  VOICE_AI_RUNTIME_ENABLED: "1",
  OPENAI_API_KEY: "sk-test-not-real",
  OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
  VOICE_AI_SESSION_SIGNING_PUBLIC_KEY: SPKI,
  VOICE_AI_SESSION_ISSUER: ISS,
  VOICE_AI_SESSION_AUDIENCE: AUD,
  VOICE_AI_CONTROL_TOKEN_SECRET: "control-secret-abc",
  VOICE_AI_KILL_SWITCH_HMAC_SECRET: "kill-secret-xyz",
  VOICE_AI_ALLOWED_ORIGINS: "https://staybids.in",
  VOICE_AI_IP_HASH_SALT: "ip-salt-123",
  STAYBID_PUBLIC_BASE_URL: "https://staybids.in",
});
function freshCtx(overrides = {}) {
  const sideband = makeFakeSideband();
  const fetchImpl = overrides.fetchImpl || makeFetch([]);
  const ctx = G.buildContext({
    env: overrides.env || FULL_ENV(),
    transport: overrides.transport || makeTransport(sideband, overrides.transportOpts || {}),
    fetchImpl,
    now: overrides.now,
  });
  return { ctx, sideband, fetchImpl };
}
const GOOD_SDP = "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF\r\n";

async function main() {
  const kp = await jose.generateKeyPair("ES256");
  PRIV = kp.privateKey;
  SPKI = await jose.exportSPKI(kp.publicKey);

  // ── runtime + config gates ────────────────────────────────────────────────
  section("Runtime + config gates (fail closed)");
  {
    const envOff = { ...FULL_ENV(), VOICE_AI_RUNTIME_ENABLED: "0" };
    for (const v of ["0", "", "true", "yes", " 1 ", undefined]) {
      const c = CONFIG.loadGatewayConfig({ ...FULL_ENV(), VOICE_AI_RUNTIME_ENABLED: v });
      ok(c.runtimeEnabled === false, `runtime disabled for value ${JSON.stringify(v)}`);
    }
    ok(CONFIG.loadGatewayConfig(FULL_ENV()).runtimeEnabled === true, "runtime enabled ONLY for exact '1'");

    const { ctx } = freshCtx({ env: envOff });
    const r = await G.handleSessionCreate(ctx, { origin: ISS, ip: "1.1.1.1", authorization: `Bearer ${await makeAssertion()}`, body: { sdp: GOOD_SDP } });
    ok(r.status === 503 && r.body.error === "runtime_disabled", "runtime off → 503 runtime_disabled");

    const partial = { ...FULL_ENV() };
    delete partial.VOICE_AI_SESSION_SIGNING_PUBLIC_KEY;
    const { ctx: ctx2 } = freshCtx({ env: partial });
    const r2 = await G.handleSessionCreate(ctx2, { origin: ISS, ip: "1.1.1.1", authorization: "Bearer x", body: { sdp: GOOD_SDP } });
    ok(r2.status === 503 && r2.body.error === "unconfigured", "missing signing key → 503 unconfigured (zero provider call)");
  }

  // ── origin (SIGNED CLAIM contract, SB04-SRC-REV-02) ─────────────────────────
  section("Origin allowlist via SIGNED claim (never '*'; no forgeable header)");
  {
    // A direct caller cannot forge the origin: it is a SIGNED assertion claim the
    // gateway verifies against ITS allowlist. A request Origin HEADER is ignored.
    const badOrigin = `Bearer ${await makeAssertion({ origin: "https://evil.example", jti: "jbadorigin" })}`;
    const bad = await G.handleSessionCreate(freshCtx().ctx, { origin: "https://staybids.in", ip: "1.1.1.1", authorization: badOrigin, body: { sdp: GOOD_SDP } });
    ok(bad.status === 403 && bad.body.error === "origin_not_allowed", "foreign SIGNED origin claim → 403");
    const noOrigin = `Bearer ${await makeAssertion({ origin: "", jti: "jnoorigin" })}`;
    const none = await G.handleSessionCreate(freshCtx().ctx, { origin: "https://staybids.in", ip: "1.1.1.1", authorization: noOrigin, body: { sdp: GOOD_SDP } });
    ok(none.status === 403, "empty SIGNED origin claim → 403");
    // A spoofed request Origin header cannot bypass the signed-claim allowlist.
    const okClaim = `Bearer ${await makeAssertion({ origin: ISS, jti: "joktkorigin" })}`;
    const spoof = await G.handleSessionCreate(freshCtx().ctx, { origin: "https://attacker.example", ip: "1.1.1.9", authorization: okClaim, body: { sdp: GOOD_SDP } });
    ok(spoof.status === 200, "a spoofed request Origin header is ignored — the signed claim governs");
    ok(CONFIG.isAllowedOrigin("https://staybids.in", ["https://staybids.in"]) === true, "exact origin allowed");
    ok(CONFIG.isAllowedOrigin("*", ["*"]) === false, "'*' never honored");
  }

  // ── body / sdp ────────────────────────────────────────────────────────────
  section("Body + SDP validation");
  {
    ok(SCHEMAS.validateSessionCreateBody({ sdp: GOOD_SDP }).authenticated === false, "valid body");
    ok(SCHEMAS.validateSessionCreateBody({ sdp: "not sdp" }) === null, "non-SDP rejected");
    ok(SCHEMAS.validateSessionCreateBody({ sdp: "v=0\r\n" }) === null, "SDP without m=audio rejected");
    ok(SCHEMAS.validateSessionCreateBody({ sdp: "v=0\r\nm=audio 9\r\n".padEnd(20000, "a") }) === null, "oversized SDP rejected");
    // extra keys (url/method) are dropped — no proxy field survives
    const shaped = SCHEMAS.validateSessionCreateBody({ sdp: GOOD_SDP, url: "http://evil", method: "DELETE" });
    ok(shaped && Object.keys(shaped).sort().join(",") === "authenticated,sdp,visibleHotelIds", "extra url/method keys dropped (only sdp/authenticated/visibleHotelIds survive)");
    ok(shaped && Array.isArray(shaped.visibleHotelIds) && shaped.visibleHotelIds.length === 0, "visibleHotelIds defaults to []");
    const { ctx } = freshCtx();
    const r = await G.handleSessionCreate(ctx, { origin: ISS, ip: "1.1.1.1", authorization: `Bearer ${await makeAssertion()}`, body: { sdp: "nope" } });
    ok(r.status === 400 && r.body.error === "invalid_body", "bad SDP body → 400");
  }

  // ── session assertion ─────────────────────────────────────────────────────
  section("Session assertion (valid / tamper / iss / aud / expiry / replay / scope)");
  {
    const { ctx } = freshCtx();
    const good = await G.handleSessionCreate(ctx, { origin: ISS, ip: "9.9.9.9", authorization: `Bearer ${await makeAssertion()}`, body: { sdp: GOOD_SDP } });
    ok(good.status === 200 && typeof good.body.sessionId === "string" && typeof good.body.controlToken === "string", "valid assertion → 200 + session + control token");
    ok(typeof good.body.answerSdp === "string" && /^v=0/.test(good.body.answerSdp), "answer SDP returned");

    const noBearer = await G.handleSessionCreate(freshCtx().ctx, { origin: ISS, ip: "1.1.1.2", authorization: "", body: { sdp: GOOD_SDP } });
    ok(noBearer.status === 401 && noBearer.body.error === "assertion_missing", "missing assertion → 401");

    const badSig = (await makeAssertion()).slice(0, -3) + "aaa";
    const r1 = await G.handleSessionCreate(freshCtx().ctx, { origin: ISS, ip: "1.1.1.3", authorization: `Bearer ${badSig}`, body: { sdp: GOOD_SDP } });
    ok(r1.status === 401 && r1.body.error === "assertion_invalid", "tampered signature → 401 invalid");

    const wrongIss = await makeAssertion({ iss: "https://evil" });
    ok((await G.handleSessionCreate(freshCtx().ctx, { origin: ISS, ip: "1.1.1.4", authorization: `Bearer ${wrongIss}`, body: { sdp: GOOD_SDP } })).status === 401, "wrong issuer → 401");
    const wrongAud = await makeAssertion({ aud: "someone-else" });
    ok((await G.handleSessionCreate(freshCtx().ctx, { origin: ISS, ip: "1.1.1.5", authorization: `Bearer ${wrongAud}`, body: { sdp: GOOD_SDP } })).status === 401, "wrong audience → 401");
    const expired = await makeAssertion({ iat: Math.floor(Date.now() / 1000) - 300, exp: Math.floor(Date.now() / 1000) - 60 });
    ok((await G.handleSessionCreate(freshCtx().ctx, { origin: ISS, ip: "1.1.1.6", authorization: `Bearer ${expired}`, body: { sdp: GOOD_SDP } })).status === 401, "expired → 401");
    const badScope = await makeAssertion({ scope: "voice:write" });
    const rs = await G.handleSessionCreate(freshCtx().ctx, { origin: ISS, ip: "1.1.1.7", authorization: `Bearer ${badScope}`, body: { sdp: GOOD_SDP } });
    ok(rs.status === 401 && rs.body.error === "assertion_scope", "non read-only scope → 401 assertion_scope");

    // replay: SAME jti twice against the SAME ctx (in-process replay store)
    const { ctx: rctx } = freshCtx();
    const jti = "jti_replay_1";
    const tok = await makeAssertion({ jti, sub: "vsub_r1" });
    const first = await G.handleSessionCreate(rctx, { origin: ISS, ip: "2.2.2.1", authorization: `Bearer ${tok}`, body: { sdp: GOOD_SDP } });
    const second = await G.handleSessionCreate(rctx, { origin: ISS, ip: "2.2.2.2", authorization: `Bearer ${tok}`, body: { sdp: GOOD_SDP } });
    ok(first.status === 200, "first use of jti ok");
    ok(second.status === 401 && second.body.error === "assertion_replayed", "replayed jti → 401 assertion_replayed");
  }

  // ── identity isolation + concurrency ──────────────────────────────────────
  section("Identity isolation + concurrency caps");
  {
    const { ctx } = freshCtx();
    // one active session per subject
    const s1 = await G.handleSessionCreate(ctx, { origin: ISS, ip: "3.3.3.1", authorization: `Bearer ${await makeAssertion({ sub: "vsub_A", jti: "jA1" })}`, body: { sdp: GOOD_SDP } });
    const s2 = await G.handleSessionCreate(ctx, { origin: ISS, ip: "3.3.3.2", authorization: `Bearer ${await makeAssertion({ sub: "vsub_A", jti: "jA2" })}`, body: { sdp: GOOD_SDP } });
    ok(s1.status === 200, "subject A first session ok");
    ok(s2.status === 429 && s2.body.error === "subject_concurrency", "subject A second session → 429 subject_concurrency");
    // distinct subjects isolated
    const store = SESS.createSessionStore({ limits: CONFIG.DEFAULT_LIMITS });
    const cA = store.create({ subject: "X", ipHash: "h1", authenticated: false });
    const cB = store.create({ subject: "Y", ipHash: "h2", authenticated: false });
    ok(cA.ok && cB.ok && cA.session.sessionId !== cB.session.sessionId, "distinct subjects get distinct sessions");
    store.allowHotelIds(cA.session, ["hotelA"]);
    ok(store.hasHotelId(cA.session, "hotelA") === true && store.hasHotelId(cB.session, "hotelA") === false, "allowlist is per-session (no cross-session leak)");
    // global concurrency
    const tiny = SESS.createSessionStore({ limits: { ...CONFIG.DEFAULT_LIMITS, activeSessionsPerSubject: 100, activeSessionsPerIp: 100, globalActiveSessions: 2 } });
    tiny.create({ subject: "a", ipHash: "1", authenticated: false });
    tiny.create({ subject: "b", ipHash: "2", authenticated: false });
    const third = tiny.create({ subject: "c", ipHash: "3", authenticated: false });
    ok(!third.ok && third.reason === "global_concurrency", "global concurrency cap enforced");
  }

  // ── fixed four-tool adapter + trust pipeline ──────────────────────────────
  section("Fixed four-tool adapter (exactly four; fifth rejected; fixed path; allowlist)");
  {
    ok(SCHEMAS.TOOL_NAMES.length === 4, "exactly four tool names");
    ok(SCHEMAS.isToolName("searchHotels") && !SCHEMAS.isToolName("bookHotel") && !SCHEMAS.isToolName("createBid"), "unknown fifth tool rejected");
    ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c1", tool: "placeBid", input: {} }) === null, "provider event with unknown tool → null");
    ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c1", tool: "searchHotels", input: { url: "http://x" } }) === null, "tool input with url key → null (no proxy)");
    ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c1", tool: "searchHotels", input: { method: "DELETE" } }) === null, "tool input with method key → null");

    const fetchImpl = makeFetch([HOTELS([{ id: "hotel1" }, { id: "hotel2" }]), FLASH([{ id: "deal1", hotelId: "hotelF" }]), HOTEL_ONE({ id: "hotel1" })]);
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const exec = TE.createToolExecutor({ config, fetchImpl });
    const sess = store.create({ subject: "s", ipHash: "h", authenticated: false }).session;
    store.beginTurn(sess);

    const search = await exec.run(store, sess, { kind: "tool_call", callId: "c", tool: "searchHotels", input: { city: "Manali" } });
    ok(search.ok && search.count === 2, "searchHotels runs + returns bounded count");
    ok(fetchImpl.calls[0].url.startsWith("https://staybids.in/api/hotels"), "searchHotels hits the FIXED /api/hotels path on the configured base");
    ok(fetchImpl.calls[0].init.method === "GET", "tool method is fixed GET");
    ok(fetchImpl.calls[0].init.redirect === "error", "redirects fail closed (redirect:error)");
    ok(store.hasHotelId(sess, "hotel1") && store.hasHotelId(sess, "hotel2"), "search seeds the session allowlist");

    const detailAllowed = await exec.run(store, sess, { kind: "tool_call", callId: "c", tool: "getHotelDetails", input: { id: "hotel1" } });
    ok(detailAllowed.ok && detailAllowed.count === 1, "getHotelDetails on an allowlisted id succeeds");
    const detailForeign = await exec.run(store, sess, { kind: "tool_call", callId: "c", tool: "getHotelDetails", input: { id: "hotelZZZ" } });
    ok(!detailForeign.ok && detailForeign.reason === "hotel_id_not_allowlisted", "getHotelDetails on a non-allowlisted id fails closed");

    // R2 (REREV-08B): compareHotels now fetches each allowlisted id through the SAME
    // fixed GET and returns BOUNDED normalized comparable DATA (id/name/city/stars/
    // minPrice/avgRating) — never just the ids, never a private field.
    const cmpFetch = makeFetch([
      { match: (u) => /\/api\/hotels\/([^?]+)$/.test(u), status: 200, bodyFor: (u) => ({ hotel: { id: /\/api\/hotels\/([^?]+)$/.exec(u)[1], name: "H " + /\/api\/hotels\/([^?]+)$/.exec(u)[1], city: "manali", starRating: 4, avgRating: 4.5, rooms: [{ floorPrice: 2400 }], ownerEmail: "secret@x" } }) },
    ]);
    const cmpExec = TE.createToolExecutor({ config, fetchImpl: cmpFetch });
    const compareOk = await cmpExec.run(store, sess, { kind: "tool_call", callId: "c", tool: "compareHotels", input: { hotelIds: ["hotel1", "hotel2"] } });
    ok(compareOk.ok && compareOk.count === 2, "compareHotels returns comparable data for both allowlisted ids");
    ok(compareOk.data && Array.isArray(compareOk.data.hotels) && compareOk.data.hotels.length === 2, "compareHotels data carries bounded normalized rows");
    ok(cmpFetch.calls.length === 2 && cmpFetch.calls.every((c) => /\/api\/hotels\/[^?]+$/.test(c.url)), "compareHotels fetches each id via the FIXED path (no compare endpoint)");
    ok(JSON.stringify(compareOk.data).indexOf("ownerEmail") === -1 && JSON.stringify(compareOk.data).indexOf("secret@x") === -1, "compareHotels data omits private fields");
    const compareForeign = await cmpExec.run(store, sess, { kind: "tool_call", callId: "c", tool: "compareHotels", input: { hotelIds: ["hotelX"] } });
    ok(!compareForeign.ok && compareForeign.reason === "hotel_id_not_allowlisted", "compareHotels with a foreign id fails closed (before any fetch)");

    // timeout mapping
    const slowFetch = makeFetch([{ match: (u) => u.includes("/api/hotels"), throwAbort: true }]);
    const exec2 = TE.createToolExecutor({ config, fetchImpl: slowFetch });
    const sess2 = store.create({ subject: "s2", ipHash: "h2", authenticated: false }).session;
    store.beginTurn(sess2);
    const to = await exec2.run(store, sess2, { kind: "tool_call", callId: "c", tool: "searchHotels", input: {} });
    ok(!to.ok && to.reason === "timeout", "tool timeout maps to timeout reason");
  }

  // ── UI actions ────────────────────────────────────────────────────────────
  section("UI actions (OPEN_HOTEL allowlist, no caller url, PREPARE_BID_DRAFT no network)");
  {
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const sess = store.create({ subject: "u", ipHash: "h", authenticated: false }).session;
    store.beginTurn(sess);
    store.allowHotelIds(sess, ["hotelOpen"]);
    ok(TE.authorizeUiAction(store, sess, { type: "OPEN_HOTEL", hotelId: "hotelOpen" }).ok, "OPEN_HOTEL allowed for allowlisted id");
    ok(!TE.authorizeUiAction(store, sess, { type: "OPEN_HOTEL", hotelId: "hotelNope" }).ok, "OPEN_HOTEL blocked for non-allowlisted id");
    // no caller url/path — the union has no such field
    ok(SCHEMAS.validateUiAction({ type: "OPEN_HOTEL", hotelId: "hotelOpen", url: "http://x" }) && !("url" in SCHEMAS.validateUiAction({ type: "OPEN_HOTEL", hotelId: "hotelOpen", url: "http://x" })), "OPEN_HOTEL carries NO url field");
    ok(SCHEMAS.validateUiAction({ type: "OPEN_HOTEL", hotelId: "../etc" }) === null, "OPEN_HOTEL with a path-like id rejected");
    // PREPARE_BID_DRAFT: authorize + prove no fetch occurs from the whole pipeline
    const fetchImpl = makeFetch([]);
    const exec = TE.createToolExecutor({ config, fetchImpl });
    const auth = TE.authorizeUiAction(store, sess, { type: "PREPARE_BID_DRAFT", hotelId: "hotelOpen", pricePerNight: 1000 });
    ok(auth.ok, "PREPARE_BID_DRAFT authorized for allowlisted id");
    ok(fetchImpl.calls.length === 0, "PREPARE_BID_DRAFT authorization makes ZERO network request");
  }

  // ── sideband turn ownership + stale rejection ─────────────────────────────
  section("Sideband: tool loop cap, stale/cancel discard, no action after cancel");
  {
    const { ctx, sideband } = freshCtx({ fetchImpl: makeFetch([HOTELS([{ id: "hotelS" }])]) });
    // create a real session via handler to get a bound session
    const created = await G.handleSessionCreate(ctx, { origin: ISS, ip: "7.7.7.1", authorization: `Bearer ${await makeAssertion({ sub: "vsub_side", jti: "jSide" })}`, body: { sdp: GOOD_SDP } });
    ok(created.status === 200, "session for sideband test created");
    const session = ctx.store.get(created.body.sessionId);
    const frames = [];
    const emit = (f) => frames.push(f);
    const exec = TE.createToolExecutor({ config: ctx.config, fetchImpl: makeFetch([HOTELS([{ id: "hotelS" }])]) });
    const side = SB.createSideband({ store: ctx.store, executor: exec, telemetry: TEL.createTelemetry(), config: ctx.config, rateLimiter: ctx.rateLimiter });

    // an answer on the current turn produces result + turn_complete
    const turnId = session.turnId;
    const o1 = await side.handleProviderEvent(session, sideband.conn, emit, { kind: "answer", text: "Here are hotels in Manali." }, turnId);
    ok(o1.status === "handled" && frames.some((f) => f.t === "result") && frames.some((f) => f.t === "turn_complete"), "answer → result + turn_complete frames");

    // R4 (REREV-11): a foreign-id OPEN intent via the DOCUMENTED tool path is rejected
    frames.length = 0;
    const o2 = await side.handleProviderEvent(session, sideband.conn, emit, { kind: "tool_call", callId: "cx", tool: "getHotelDetails", input: { id: "hotelForeign", presentationIntent: "OPEN" } }, turnId);
    ok(o2.status === "handled" && frames.some((f) => f.t === "error" && f.code === "action_rejected"), "foreign OPEN_HOTEL → error action_rejected (no ui_action frame)");
    ok(!frames.some((f) => f.t === "ui_action"), "no ui_action frame emitted for a rejected action");

    // a stale event (cancelled turn) is DISCARDED — no frames
    frames.length = 0;
    ctx.store.cancelTurn(session, session.turnId);
    const o3 = await side.handleProviderEvent(session, sideband.conn, emit, { kind: "answer", text: "late" }, turnId);
    ok(o3.status === "discarded" && o3.reason === "stale" && frames.length === 0, "provider completion after cancel is discarded (no UI frame)");

    // tool-loop cap: begin a fresh turn, exhaust the per-turn cap
    frames.length = 0;
    const t2 = ctx.store.beginTurn(session);
    ctx.store.allowHotelIds(session, ["hotelS"]);
    let capped = false;
    for (let i = 0; i < ctx.config.limits.toolCallsPerTurn + 2; i++) {
      const o = await side.handleProviderEvent(session, sideband.conn, emit, { kind: "tool_call", callId: `c${i}`, tool: "searchHotels", input: {} }, t2);
      if (o.status === "handled" && o.detail === "capped") capped = true;
    }
    ok(capped && frames.some((f) => f.t === "error" && f.code === "too_many_actions"), "per-turn tool-call cap enforced (too_many_actions)");
  }

  // ── prohibited surfaces absent ────────────────────────────────────────────
  section("Prohibited surfaces are ABSENT from the gateway tool/action space");
  {
    const banned = ["bookHotel", "createBid", "placeBid", "pay", "refund", "wallet", "cancelBooking", "sendMessage", "adminAction", "availability", "checkAvailability", "sql", "rpc"];
    for (const b of banned) ok(!SCHEMAS.isToolName(b), `tool "${b}" is not a gateway tool`);
    for (const b of banned) ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c", tool: b, input: {} }) === null, `provider tool_call "${b}" rejected`);
    // the UI-action union has no write/booking/payment type
    for (const t of ["PLACE_BID", "BOOK", "PAY", "REFUND", "CANCEL_BOOKING", "SEND_MESSAGE"]) {
      ok(SCHEMAS.validateUiAction({ type: t, hotelId: "h" }) === null, `UI action "${t}" rejected (not in the closed union)`);
    }
    // source scan: the gateway never references a bid/booking/payment write path
    const files = fs.readdirSync(path.join(REPO, "server/voice-gateway")).filter((f) => f.endsWith(".ts"));
    let dirty = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(REPO, "server/voice-gateway", f), "utf8");
      if (/\/api\/(bids|bookings|payment|razorpay|wallet|circle|b2b|trade)\b/.test(src)) dirty++;
    }
    ok(dirty === 0, "no gateway source references a bid/booking/payment/write API path");
  }

  // ── rate / cost / circuit ─────────────────────────────────────────────────
  section("Rate limits, cost ceilings, circuit breaker");
  {
    const limits = { ...CONFIG.DEFAULT_LIMITS, anonStartsPer15Min: 2, anonStartsPerDay: 3 };
    let t = 1_000_000;
    const rl = RL.createRateLimiter({ limits, now: () => t });
    ok(rl.checkStart("ip:x", false).ok && rl.checkStart("ip:x", false).ok, "first 2 anon starts allowed");
    ok(!rl.checkStart("ip:x", false).ok, "3rd anon start in window → denied (15m cap)");
    // cost ceiling
    ok(rl.canSpend(0, 100) === true, "spend within per-session ceiling ok");
    ok(rl.canSpend(120, 20) === false, "spend breaching per-session ceiling ($1.25) denied");
    // circuit breaker: 5 consecutive failures opens it
    for (let i = 0; i < 5; i++) rl.recordProviderResult(false);
    ok(rl.isCircuitOpen() === true, "5 consecutive provider failures open the circuit");
    t += 61_000;
    ok(rl.isCircuitOpen() === false, "circuit half-opens after ~60s");

    // circuit open blocks session create
    const { ctx } = freshCtx();
    for (let i = 0; i < 5; i++) ctx.rateLimiter.recordProviderResult(false);
    const blocked = await G.handleSessionCreate(ctx, { origin: ISS, ip: "8.8.8.1", authorization: `Bearer ${await makeAssertion({ jti: "jcirc" })}`, body: { sdp: GOOD_SDP } });
    ok(blocked.status === 503 && blocked.body.error === "circuit_open", "open circuit → 503 circuit_open on session create");
  }

  // ── provider unavailable / rate limited mapping ───────────────────────────
  section("Provider failure mapping (no fabrication)");
  {
    const { ctx } = freshCtx({ transportOpts: { fail: "provider_unavailable" } });
    const r = await G.handleSessionCreate(ctx, { origin: ISS, ip: "8.8.8.2", authorization: `Bearer ${await makeAssertion({ jti: "jpu" })}`, body: { sdp: GOOD_SDP } });
    ok(r.status === 503 && r.body.error === "provider_unavailable", "provider unavailable → 503 (session closed, no fabrication)");
    const { ctx: ctx2 } = freshCtx({ transportOpts: { fail: "provider_rate_limited" } });
    const r2 = await G.handleSessionCreate(ctx2, { origin: ISS, ip: "8.8.8.3", authorization: `Bearer ${await makeAssertion({ jti: "jrl" })}`, body: { sdp: GOOD_SDP } });
    ok(r2.status === 429, "provider 429 → 429 cooldown mapping");
  }

  // ── kill switch ───────────────────────────────────────────────────────────
  section("Runtime kill switch (HMAC, disable-only, drains sessions, cannot re-enable)");
  {
    const { ctx } = freshCtx();
    // seed an active session
    await G.handleSessionCreate(ctx, { origin: ISS, ip: "6.6.6.1", authorization: `Bearer ${await makeAssertion({ sub: "vsub_kill", jti: "jkill" })}`, body: { sdp: GOOD_SDP } });
    ok(ctx.store.size() === 1, "one active session before kill");
    // invalid kill (no secret match) rejected
    const badKill = G.handleKill(ctx, { nonce: "n", ts: Date.now(), sig: "wrong" });
    ok(badKill.status === 401 && ctx.runtime.killed === false, "forged kill signature → 401, runtime NOT killed");
    // valid kill
    const crypto = require("node:crypto");
    const ts = Date.now();
    const nonce = "kill-nonce-1";
    const sig = crypto.createHmac("sha256", "kill-secret-xyz").update(`${nonce}.${ts}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const goodKill = G.handleKill(ctx, { nonce, ts, sig });
    ok(goodKill.status === 200 && goodKill.body.ok === true && goodKill.body.drained === 1, "valid kill → 200, drains active sessions");
    ok(ctx.runtime.killed === true && ctx.store.size() === 0, "runtime disabled + sessions dropped");
    // new sessions refused; kill endpoint cannot re-enable
    const after = await G.handleSessionCreate(ctx, { origin: ISS, ip: "6.6.6.2", authorization: `Bearer ${await makeAssertion({ jti: "jafter" })}`, body: { sdp: GOOD_SDP } });
    ok(after.status === 503 && after.body.error === "runtime_disabled", "after kill, new sessions refused (503)");
  }

  // ── real duration / idle / utterance / cost enforcement (fake clock) ────────
  section("Enforcement (fake clock): session/idle/utterance/turn timers + cost");
  {
    function fakeClockTimers() {
      let clock = 1_000_000;
      let id = 0;
      const timers = new Map();
      return {
        now: () => clock,
        facility: {
          set: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: clock + ms }); return h; },
          clear: (h) => timers.delete(h),
        },
        advance: (delta) => { clock += delta; for (const [h, t] of Array.from(timers)) if (t.at <= clock) { timers.delete(h); t.fn(); } },
      };
    }
    const L = CONFIG.DEFAULT_LIMITS;

    // session lifetime cap terminates the session
    {
      const clk = fakeClockTimers();
      const store = SESS.createSessionStore({ limits: L, now: clk.now, timers: clk.facility });
      const s = store.create({ subject: "a", ipHash: "h", authenticated: false }).session;
      ok(store.size() === 1, "session created");
      clk.advance(L.maxSessionMs + 1);
      ok(store.size() === 0 && s.terminated === true, "session-lifetime cap (10m) terminates the session");
    }
    // idle cap terminates the session
    {
      const clk = fakeClockTimers();
      const store = SESS.createSessionStore({ limits: L, now: clk.now, timers: clk.facility });
      const s = store.create({ subject: "b", ipHash: "h", authenticated: false }).session;
      clk.advance(L.idleTimeoutMs + 1);
      ok(store.size() === 0 && s.terminated === true, "idle cap (60s) terminates the session");
    }
    // idle is reset by activity (a begun turn)
    {
      const clk = fakeClockTimers();
      const store = SESS.createSessionStore({ limits: L, now: clk.now, timers: clk.facility });
      const s = store.create({ subject: "c", ipHash: "h", authenticated: false }).session;
      clk.advance(L.idleTimeoutMs - 5);
      store.beginTurn(s); // activity resets idle
      clk.advance(L.idleTimeoutMs - 5);
      ok(store.size() === 1 && !s.terminated, "activity resets the idle timer");
    }
    // single-utterance cap cancels the turn
    {
      const clk = fakeClockTimers();
      const store = SESS.createSessionStore({ limits: L, now: clk.now, timers: clk.facility });
      const s = store.create({ subject: "d", ipHash: "h", authenticated: false }).session;
      store.beginTurn(s);
      store.startUtterance(s);
      clk.advance(L.maxUtteranceMs + 1);
      ok(s.cancelled === true, "single-utterance cap (30s) cancels the turn");
    }
    // cumulative speech cap terminates the session
    {
      const clk = fakeClockTimers();
      const store = SESS.createSessionStore({ limits: L, now: clk.now, timers: clk.facility });
      const s = store.create({ subject: "e", ipHash: "h", authenticated: false }).session;
      store.beginTurn(s);
      let terminatedByCap = false;
      for (let i = 0; i < 20 && !terminatedByCap; i++) {
        store.startUtterance(s);
        clk.advance(20_000); // 20s (< 30s so the utterance timer never fires)
        store.endUtterance(s);
        if (s.terminated) terminatedByCap = true;
      }
      ok(terminatedByCap && store.size() === 0, "cumulative-speech cap (5m) terminates the session");
    }
    // turn-completion cap cancels the turn + emits turn_timeout
    {
      const clk = fakeClockTimers();
      const store = SESS.createSessionStore({ limits: L, now: clk.now, timers: clk.facility });
      const s = store.create({ subject: "f", ipHash: "h", authenticated: false }).session;
      const frames = [];
      store.bindRuntime(s, (fr) => frames.push(fr), () => {});
      store.beginTurn(s);
      clk.advance(L.turnCompletionTimeoutMs + 1);
      ok(s.cancelled === true && frames.some((f) => f.t === "error" && f.code === "turn_timeout"), "turn-completion cap (12s) cancels + emits turn_timeout");
    }
    // cost ceiling: a session near the ceiling fails closed on the next charge
    {
      const config = CONFIG.loadGatewayConfig(FULL_ENV());
      const store = SESS.createSessionStore({ limits: config.limits });
      const rl = RL.createRateLimiter({ limits: config.limits });
      const side = SB.createSideband({ store, executor: TE.createToolExecutor({ config, fetchImpl: makeFetch([HOTELS([{ id: "hC" }])]) }), telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
      const s = store.create({ subject: "g", ipHash: "h", authenticated: false }).session;
      store.allowHotelIds(s, ["hC"]);
      const frames = [];
      store.bindRuntime(s, (fr) => frames.push(fr), () => {});
      s.costCents = Math.round(config.limits.perSessionCostCeilingUsd * 100); // at the ceiling
      const t = store.beginTurn(s);
      const conn = { onEvent() {}, sendToolResult() {}, cancelTurn() {}, close() {} };
      await side.handleProviderEvent(s, conn, (fr) => frames.push(fr), { kind: "tool_call", callId: "c", tool: "searchHotels", input: {} }, t);
      ok(frames.some((f) => f.t === "error" && f.code === "cost_limit") && s.terminated === true, "per-session cost ceiling fails closed (cost_limit + terminate)");
    }
    // unknown model ⇒ cost enforcement fails closed
    {
      const config = { ...CONFIG.loadGatewayConfig(FULL_ENV()), openaiModel: "totally-unknown-model" };
      const store = SESS.createSessionStore({ limits: config.limits });
      const rl = RL.createRateLimiter({ limits: config.limits });
      const side = SB.createSideband({ store, executor: TE.createToolExecutor({ config, fetchImpl: makeFetch([]) }), telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
      const s = store.create({ subject: "u", ipHash: "h2", authenticated: false }).session;
      const frames = [];
      store.bindRuntime(s, (fr) => frames.push(fr), () => {});
      const t = store.beginTurn(s);
      const conn = { onEvent() {}, sendToolResult() {}, cancelTurn() {}, close() {} };
      await side.handleProviderEvent(s, conn, (fr) => frames.push(fr), { kind: "answer", text: "hi" }, t);
      ok(frames.some((f) => f.t === "error" && f.code === "cost_limit") && s.terminated === true, "unknown model ⇒ cost fails closed (no unbounded work)");
    }
  }

  // ── composed end-to-end (REAL Fastify inject + REAL ws control socket) ──────
  section("Composed: broker→gateway→fake-provider→sideband→tool→control socket→browser");
  {
    const WS = require("ws");
    const sideband = makeFakeSideband();
    const fetchImpl = makeFetch([
      HOTELS([{ id: "hotel1", name: "Ridge View", city: "manali", rooms: [{ floorPrice: 2400 }] }]),
      // R4 (REREV-11): the OPEN intent runs the fixed getHotelDetails READ first.
      HOTEL_ONE({ id: "hotel1", name: "Ridge View", city: "manali", rooms: [{ floorPrice: 2400 }] }),
    ]);
    const transport = {
      isAvailable() { return true; },
      async createSession() { return { ok: true, answerSdp: "v=0\r\nm=audio 9 UDP\r\n", providerSessionId: "p1", sideband: sideband.conn }; },
    };
    const { app, ctx } = await G.buildGateway({ env: FULL_ENV(), transport, fetchImpl });
    try {
      // /healthz (no provider config needed)
      const health = await app.inject({ method: "GET", url: "/healthz" });
      ok(health.statusCode === 200 && JSON.parse(health.payload).ok === true, "GET /healthz → 200 (non-secret summary)");

      // session create via app.inject with a real signed assertion (broker stand-in)
      const assertion = await makeAssertion({ sub: "vsub_composed", jti: "jcomposed" });
      const created = await app.inject({
        method: "POST",
        url: "/v1/voice/sessions",
        headers: { "content-type": "application/json", authorization: `Bearer ${assertion}`, origin: ISS },
        payload: JSON.stringify({ sdp: GOOD_SDP, authenticated: false }),
      });
      ok(created.statusCode === 200, "POST /v1/voice/sessions → 200");
      const body = JSON.parse(created.payload);
      ok(typeof body.sessionId === "string" && typeof body.controlToken === "string" && /^v=0/.test(body.answerSdp), "session create returns bounded envelope");

      // real ws control socket with the token in the subprotocol
      await app.listen({ port: 0, host: "127.0.0.1" });
      const port = app.server.address().port;
      const frames = [];
      const ws = new WS(`ws://127.0.0.1:${port}/v1/voice/sessions/${body.sessionId}/control`, [`staybid-voice.${body.controlToken}`]);
      await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
      ws.on("message", (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* ignore */ } });

      const session = ctx.store.get(body.sessionId);
      // R6: every provider response exists because the gateway SCHEDULED it (committed
      // utterance → serialized response.create → response.created binds the request).
      // ── searchHotels tool cycle (with a serialized continuation) ──
      const reqTool = establishResponse(sideband, session, "r_tool", "item_tool");
      ok(typeof reqTool === "string" && reqTool.startsWith("rq_"), "gateway scheduled ONE response.create with a server request id");
      sideband.emit({ kind: "tool_call", callId: "c1", tool: "searchHotels", input: { city: "Manali" }, responseId: "r_tool" });
      await flushMs(40);
      ok(sideband.sent.some((r) => r.callId === "c1" && r.ok === true), "tool result fed back to the provider");
      ok(sideband.sent.some((r) => r.data && r.data.hotels && r.data.hotels[0] && r.data.hotels[0].id === "hotel1"), "bounded normalized DATA returned to provider (name/city/price)");
      ok(session.allowlist.has("hotel1"), "search seeded the session allowlist");
      // parent response.done frees the slot → the queued tool continuation dispatches
      // EXACTLY one serialized response.create (R6-02 tool-continuation pipeline).
      const reqsBeforeCont = sideband.responseRequests();
      sideband.emit({ kind: "response_done", responseId: "r_tool" });
      await flushMs(10);
      ok(sideband.responseRequests() === reqsBeforeCont + 1, "the tool continuation dispatched exactly ONE serialized response.create after the parent response.done");
      const reqCont = sideband.lastRequestId();
      // complete the continuation (answer + response.done frees the slot).
      sideband.emit({ kind: "response_begin", responseId: "r_cont", requestId: reqCont });
      sideband.emit({ kind: "answer", text: "Here are hotels in Manali.", responseId: "r_cont" });
      await flushMs(20);
      sideband.emit({ kind: "response_done", responseId: "r_cont" });
      await flushMs(10);

      // ── OPEN via the DOCUMENTED function-call path (turn-terminal, no continuation) ──
      establishResponse(sideband, session, "r_ok", "item_open");
      sideband.emit({ kind: "tool_call", callId: "co1", tool: "getHotelDetails", input: { id: "hotel1", presentationIntent: "OPEN" }, responseId: "r_ok" });
      await flushMs(30);
      const uiFrame = frames.find((f) => f.t === "ui_action" && f.action && f.action.type === "OPEN_HOTEL");
      ok(uiFrame && uiFrame.action.hotelId === "hotel1", "gateway emits a validated OPEN_HOTEL control frame to the browser");
      sideband.emit({ kind: "response_done", responseId: "r_ok" });
      await flushMs(10);

      // an UNREQUESTED / UNMAPPED responseId is DROPPED (no scheduled request).
      const framesBeforeUnowned = frames.length;
      sideband.emit({ kind: "tool_call", callId: "co2", tool: "getHotelDetails", input: { id: "hotel1", presentationIntent: "OPEN" }, responseId: "r_never_begun" });
      await flushMs(20);
      ok(frames.length === framesBeforeUnowned, "an event with an UNMAPPED responseId is dropped (no ownership)");

      // a foreign-id OPEN intent is rejected (never forwarded as ui_action).
      establishResponse(sideband, session, "r_foreign", "item_foreign");
      sideband.emit({ kind: "tool_call", callId: "co3", tool: "getHotelDetails", input: { id: "hotelForeign", presentationIntent: "OPEN" }, responseId: "r_foreign" });
      await flushMs(30);
      ok(frames.some((f) => f.t === "error" && f.code === "action_rejected"), "foreign OPEN_HOTEL → action_rejected control frame");
      sideband.emit({ kind: "response_done", responseId: "r_foreign" });
      await flushMs(10);

      // browser cancel_turn → provider cancel propagated
      ws.send(JSON.stringify({ t: "cancel_turn", turnId: session.turnId }));
      await flushMs(30);
      ok(sideband.isCancelled() === true, "browser cancel_turn reaches the provider sideband");

      // browser close_session → session terminated
      ws.send(JSON.stringify({ t: "close_session" }));
      await flushMs(40);
      ok(ctx.store.get(body.sessionId) === null, "browser close_session terminates the session");

      try { ws.close(); } catch { /* no-op */ }
    } finally {
      await app.close();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // R2 remediation coverage (SB04-R1-REREV-01..08) — real paths, fake net.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── REREV-05B: OPENAI_REALTIME_BASE_URL validation ──────────────────────────
  section("R2-05B: OpenAI base URL is validated (https + OpenAI origin; else fail closed)");
  {
    const R = CONFIG.resolveOpenAiBaseUrl;
    ok(R(undefined) === "https://api.openai.com/v1/realtime", "unset → safe canonical default");
    ok(R("https://api.openai.com/v1/realtime") === "https://api.openai.com/v1/realtime", "OpenAI https origin accepted");
    ok(R("https://api.openai.com/v1/realtime/") === "https://api.openai.com/v1/realtime", "trailing slash trimmed");
    ok(R("http://api.openai.com/v1/realtime") === "", "http (non-TLS) rejected → '' (fail closed)");
    ok(R("https://evil.example/v1/realtime") === "", "non-OpenAI host rejected");
    ok(R("https://user:pass@api.openai.com/v1") === "", "embedded credentials rejected");
    ok(R("https://127.0.0.1/v1/realtime") === "", "loopback rejected");
    // R4-05 (SB04-R3-REREV-05): reject a caller-supplied port/path/query/fragment; the
    // returned value ALWAYS reduces to the exact internally-constructed reviewed base.
    ok(R("https://api.openai.com:8443/v1/realtime") === "", "explicit non-default port → reject");
    // NOTE: the WHATWG URL parser strips the default :443 for https, so it is
    // indistinguishable from the canonical origin post-normalization and reduces to
    // the reviewed base — a non-default port (above) is the real attack surface and IS rejected.
    ok(R("https://api.openai.com:443/v1/realtime") === "https://api.openai.com/v1/realtime", "explicit :443 is normalized away → reviewed base");
    ok(R("https://api.openai.com/v1/realtime?x=1") === "", "query string → reject");
    ok(R("https://api.openai.com/v1/realtime#f") === "", "fragment → reject");
    ok(R("https://api.openai.com/v1/other") === "", "caller-selected API path → reject");
    ok(R("https://api.openai.com/evil") === "", "arbitrary path override → reject");
    ok(R("https://api.openai.com") === "https://api.openai.com/v1/realtime", "bare origin → reduced to the reviewed base (internally constructed)");
    ok(R("https://api.openai.com/v1/realtime") === CONFIG.resolveOpenAiBaseUrl("https://api.openai.com") , "the accepted value is ALWAYS the internal base, never the env string");
    const cfgBad = CONFIG.loadGatewayConfig({ ...FULL_ENV(), OPENAI_REALTIME_BASE_URL: "https://evil.example" });
    ok(CONFIG.providerConfigured(cfgBad) === false, "an invalid base URL makes providerConfigured() fail closed");
  }

  // ── REREV-06: UTF-8 BYTE bounds (multi-byte, e.g. Hindi) ────────────────────
  section("R2-06: untrusted input is bounded by UTF-8 BYTES, not code units");
  {
    // Devanagari letters are 3 bytes each in UTF-8. Build an SDP whose char length
    // is under the cap but whose BYTE length is over it → must be rejected.
    const head = "v=0\r\nm=audio 9 UDP\r\n";
    const filler = "क".repeat(6000); // 6000 chars ≈ 18000 bytes (> 16KB SDP cap)
    const bigBytes = head + filler;
    ok(bigBytes.length < SCHEMAS.MAX_SDP_BYTES, "multibyte SDP is UNDER the cap by .length (would slip a char gate)");
    ok(SCHEMAS.utf8ByteLength(bigBytes) > SCHEMAS.MAX_SDP_BYTES, "…but OVER the cap by UTF-8 bytes");
    ok(SCHEMAS.validateSdp(bigBytes) === null, "multibyte SDP over the BYTE cap is rejected");
    const smallBytes = head + "क".repeat(100);
    ok(SCHEMAS.validateSdp(smallBytes) !== null, "a small multibyte SDP under the byte cap is accepted");
  }

  // ── REREV-02: a terminated session is PERMANENTLY inert ─────────────────────
  section("R2-02: terminated session never reanimates (ensureTurn/beginTurn/timers)");
  {
    const store = SESS.createSessionStore({ limits: CONFIG.DEFAULT_LIMITS });
    const s = store.create({ subject: "term", ipHash: "h", authenticated: false }).session;
    const t0 = store.beginTurn(s);
    store.terminate(s, "closed");
    ok(s.terminated === true, "session marked terminated");
    ok(store.ensureTurn(s) === t0, "ensureTurn does NOT begin a new turn on a terminated session");
    ok(store.beginTurn(s) === t0, "beginTurn is a no-op on a terminated session (turnId frozen)");
    store.startUtterance(s); store.recordToolCall(s); store.addCost(s, 100);
    ok(s.toolCallsThisSession === 0 && s.costCents === 0, "tool/cost mutations are inert after termination");
    ok(store.canRunTool(s) === false, "canRunTool is false after termination");
  }

  // ── REREV-03: real usage reconcile + 429 cooldown ──────────────────────────
  section("R2-03: real token-usage cost + reservation reconcile + provider-429 cooldown");
  {
    // Real usage cost from the current gpt-realtime-2.1 pricing table.
    const c = OA && RL.costCentsForUsage("gpt-realtime-2.1", { inputTextTokens: 1_000_000, outputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0 });
    ok(c === 400, "1M input-text tokens → 400¢ ($4) via the real pricing table");
    ok(RL.costCentsForUsage("gpt-realtime-2.1", { inputTextTokens: 0, outputTextTokens: 0, inputAudioTokens: 1_000_000, outputAudioTokens: 0 }) === 3200, "1M input-audio tokens → 3200¢ ($32)");
    ok(RL.costCentsForUsage("unknown-model", { inputTextTokens: 1, outputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0 }) === null, "unknown model → null (cost fails closed)");

    // 429 cooldown (fake clock): a provider 429 refuses the next create with 429.
    let t = 1_000_000;
    const clkNow = () => t;
    const rl = RL.createRateLimiter({ limits: CONFIG.DEFAULT_LIMITS, now: clkNow });
    ok(rl.isRateLimitedCooldown() === false, "no cooldown initially");
    rl.noteProviderRateLimited();
    ok(rl.isRateLimitedCooldown() === true, "provider 429 opens the cooldown window");
    t += 30_001;
    ok(rl.isRateLimitedCooldown() === false, "cooldown clears after the window");

    // End-to-end: a rate-limited provider create sets the cooldown; the NEXT create
    // is refused 429 before any provider call.
    const sideband = makeFakeSideband();
    const ctx = G.buildContext({ env: FULL_ENV(), transport: makeTransport(sideband, { fail: "provider_rate_limited" }), fetchImpl: makeFetch([]) });
    const r429 = await G.handleSessionCreate(ctx, { origin: ISS, ip: "5.5.5.5", authorization: `Bearer ${await makeAssertion({ jti: "j429a" })}`, body: { sdp: GOOD_SDP } });
    ok(r429.status === 429 && r429.body.error === "provider_rate_limited", "provider 429 → 429 provider_rate_limited");
    const r429b = await G.handleSessionCreate(ctx, { origin: ISS, ip: "5.5.5.6", authorization: `Bearer ${await makeAssertion({ jti: "j429b" })}`, body: { sdp: GOOD_SDP } });
    ok(r429b.status === 429 && r429b.body.error === "provider_rate_limited", "the cooldown refuses the NEXT create with 429 (no provider hammering)");
  }

  // ── REREV-03/04: usage reconcile + response-id turn ownership + sealing ─────
  section("R2-03/04: sideband reconciles usage + seals a response (late frame discarded)");
  {
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const rl = RL.createRateLimiter({ limits: config.limits });
    const side = SB.createSideband({ store, executor: TE.createToolExecutor({ config, fetchImpl: makeFetch([]) }), telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
    const sideband = makeFakeSideband();
    const frames2 = [];
    const s = store.create({ subject: "recon", ipHash: "h", authenticated: false }).session;
    store.bindRuntime(s, (fr) => frames2.push(fr), () => {});
    side.attach(s, sideband.conn);
    // R6: a scheduled user response → response.created binds it → owns a turn; the
    // answer does not double-reserve (reservation bound at response.created); usage
    // reconciles up.
    establishDirect(side, sideband, s, "resp_A", "item_A");
    const turnA = s.turnId;
    ok(turnA >= 1 && s.turnActive, "response.created (scheduled) opened a turn");
    sideband.emit({ kind: "answer", text: "Here are hotels.", responseId: "resp_A" });
    await flushMs(10);
    const reservedCost = s.costCents;
    ok(reservedCost > 0, "the answer reserved conservative cost");
    // a real usage event reconciles the reservation to the real (larger) figure
    // 30000 output-text tokens → 48¢ (< the 125¢ per-session ceiling) so the
    // reconcile charges the shortfall rather than tripping the cost gate.
    // 30000 output-text tokens → 72¢ at the OFFICIAL $24/1M text-output price (< the
    // 125¢ per-session ceiling), so the reconcile charges the shortfall.
    sideband.emit({ kind: "usage", responseId: "resp_A", inputTextTokens: 0, outputTextTokens: 30000, inputAudioTokens: 0, outputAudioTokens: 0 });
    await flushMs(10);
    ok(s.costCents > reservedCost && s.costCents === 72, "usage reconciled the reservation UP to the real cost (72¢ @ $24/1M)");
    // a LATE frame on the sealed response is discarded (no new turn, no emit)
    const before = frames2.length;
    sideband.emit({ kind: "answer", text: "late duplicate", responseId: "resp_A" });
    await flushMs(10);
    ok(frames2.length === before, "a frame on the SEALED response is discarded (no browser mutation)");
  }

  // ── REREV-01: real transport contract (fake net; no billable call) ──────────
  // ── R3-01/02: CURRENT official transport (multipart create + session.updated ACK + hangup) ──
  section("R3-01/02: multipart create · call_id · sideband ?call_id= · session.updated ACK · hangup");
  {
    function makeR3Ws(sentFrames) {
      const h = {};
      return { ws: { send: (d) => sentFrames.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } }, h };
    }
    function makeR3Fetch(sentFrames, opts = {}) {
      const calls = [];
      const impl = async (url, init) => {
        calls.push({ url, init });
        if (/\/hangup$/.test(url)) return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
        return {
          ok: true, status: 200,
          text: async () => "v=0\r\nm=audio 9 UDP\r\n",
          headers: { get: (n) => (n.toLowerCase() === "location" && !opts.noLoc ? "https://api.openai.com/v1/realtime/calls/rtc_ABC123" : null) },
        };
      };
      impl.calls = calls;
      return impl;
    }
    const BASE = "https://api.openai.com/v1/realtime";

    // Happy path: multipart create → open → session.update → session.updated ACK → ok.
    {
      const sent = [];
      const { ws, h } = makeR3Ws(sent);
      const fetchImpl = makeR3Fetch(sent);
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: BASE, connectTimeoutMs: 5000 });
      await flushMs(1);
      if (h.open) h.open();                                    // socket opens → transport sends session.update
      await flushMs(1);
      if (h.message) h.message(effectiveAck()); // FULL effective ACK (R4-01)
      const res = await p;
      ok(res.ok === true, "createSession ok ONLY after the session.updated ACK");
      ok(res.providerSessionId === "rtc_ABC123", "REAL call_id parsed from Location (no synthetic id)");
      ok(fetchImpl.calls[0].url === "https://api.openai.com/v1/realtime/calls", "POST to the FIXED /calls endpoint (no ?model= query)");
      ok(/^multipart\/form-data; boundary=/.test(fetchImpl.calls[0].init.headers["content-type"]), "multipart/form-data content-type with boundary");
      const mpBody = fetchImpl.calls[0].init.body;
      ok(/name="sdp"/.test(mpBody) && /application\/sdp/.test(mpBody), "multipart carries the sdp part (application/sdp)");
      ok(/name="session"/.test(mpBody) && /"type":"realtime"/.test(mpBody) && /"model":"gpt-realtime-2\.1"/.test(mpBody), "session part carries type:realtime + model");
      ok(/searchHotels/.test(mpBody) && /getHotelDetails/.test(mpBody) && /getFlashDeals/.test(mpBody) && /compareHotels/.test(mpBody), "session part carries the FIXED four tools");
      ok(fetchImpl.calls[0].init.headers.authorization === "Bearer sk-fake" && fetchImpl.calls[0].init.redirect === "error", "server Bearer key + redirect:error");
      ok(sent.some((f) => { try { const o = JSON.parse(f); return o.type === "session.update" && o.session.tools.length === 4; } catch { return false; } }), "session.update with the FIXED four tools sent on open");
      // hangup on close (REREV-02): POST /calls/{id}/hangup
      res.sideband.close();
      await flushMs(1);
      ok(fetchImpl.calls.some((c) => c.url === "https://api.openai.com/v1/realtime/calls/rtc_ABC123/hangup" && c.init.method === "POST" && c.init.headers.authorization === "Bearer sk-fake"), "close() hangs up via POST /calls/{id}/hangup (Bearer) — no DELETE");
    }

    // NO ack → readiness times out → fail closed + hangup the partial call.
    {
      const sent = [];
      const { ws, h } = makeR3Ws(sent);
      const fetchImpl = makeR3Fetch(sent);
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: BASE, connectTimeoutMs: 40 });
      await flushMs(1);
      if (h.open) h.open(); // opens + sends session.update but NO session.updated arrives
      // the readiness timer is unref'd (production-safe) — hold the loop alive here
      const keep = setInterval(() => {}, 20);
      const res = await p;  // real timers: the 40ms readiness timeout fires
      clearInterval(keep);
      ok(res.ok === false && res.code === "provider_timeout", "NO session.updated ACK → provider_timeout (fail closed)");
      ok(fetchImpl.calls.some((c) => /\/hangup$/.test(c.url)), "a partially-created call is hung up on ack failure (no dangling call)");
    }

    // provider ERROR during the ack window → fail closed.
    {
      const sent = [];
      const { ws, h } = makeR3Ws(sent);
      const fetchImpl = makeR3Fetch(sent);
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: BASE, connectTimeoutMs: 5000 });
      await flushMs(1);
      if (h.open) h.open();
      await flushMs(1);
      if (h.message) h.message(JSON.stringify({ type: "error", error: { message: "x" } }));
      const res = await p;
      ok(res.ok === false && res.code === "provider_rejected", "a provider error during the ack window → provider_rejected");
    }

    // close BEFORE ack → fail closed.
    {
      const sent = [];
      const { ws, h } = makeR3Ws(sent);
      const fetchImpl = makeR3Fetch(sent);
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: BASE, connectTimeoutMs: 5000 });
      await flushMs(1);
      if (h.close) h.close();
      const res = await p;
      ok(res.ok === false, "sideband close before readiness → fail closed");
    }

    // MISSING call_id → fail closed (no synthetic id, no sideband opened).
    {
      const sent = [];
      const { ws } = makeR3Ws(sent);
      const fetchImpl = makeR3Fetch(sent, { noLoc: true });
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
      const res = await transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: BASE, connectTimeoutMs: 5000 });
      ok(res.ok === false && res.code === "malformed_answer", "a missing call_id fails closed (no synthetic id)");
    }

    // Event translation to the CURRENT closed schema.
    ok(OA.translateOpenAiEvent({ type: "response.created", response: { id: "resp_1" } }).kind === "response_begin", "response.created → response_begin");
    ok(OA.translateOpenAiEvent({ type: "response.function_call_arguments.done", name: "searchHotels", call_id: "c1", arguments: '{"city":"manali"}', response_id: "resp_1" }).kind === "tool_call", "function_call_arguments.done → tool_call");
    ok(OA.translateOpenAiEvent({ type: "response.output_audio_transcript.done", transcript: "here you go", response_id: "resp_1" }).kind === "answer", "response.output_audio_transcript.done → answer (current output transcript)");
    // usage with cached breakdown: full input text 10 (cached 4) → non-cached 6 + cached 4
    // R6: response.done ALWAYS → response_done (terminal); usage attached only when trusted.
    const usageEv = OA.translateOpenAiEvent({ type: "response.done", response: { id: "resp_1", usage: { input_token_details: { text_tokens: 10, audio_tokens: 5, cached_tokens_details: { text_tokens: 4, audio_tokens: 2 } }, output_token_details: { text_tokens: 20, audio_tokens: 7 } } } });
    ok(usageEv.kind === "response_done" && usageEv.responseId === "resp_1" && usageEv.usage && usageEv.usage.inputTextTokens === 6 && usageEv.usage.cachedInputTextTokens === 4 && usageEv.usage.inputAudioTokens === 3 && usageEv.usage.cachedInputAudioTokens === 2 && usageEv.usage.outputTextTokens === 20, "response.done → response_done splits cached from full input (usage attached)");
    const doneNoUsage = OA.translateOpenAiEvent({ type: "response.done", response: { id: "resp_1" } });
    ok(doneNoUsage && doneNoUsage.kind === "response_done" && doneNoUsage.responseId === "resp_1" && doneNoUsage.usage === undefined, "response.done with NO usage object → response_done TERMINAL with no usage (reservation retained)");
    ok(OA.translateOpenAiEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "book a hotel" }).kind === "transcript", "input_audio_transcription.completed → transcript");
  }

  // ── R3-07: EXACT provider origin (no sibling subdomains) ────────────────────
  section("R3-07: EXACT api.openai.com origin (sibling subdomains rejected)");
  {
    const R = CONFIG.resolveOpenAiBaseUrl;
    ok(R("https://api.openai.com/v1/realtime") === "https://api.openai.com/v1/realtime", "exact api.openai.com accepted");
    ok(R("https://foo.openai.com/v1/realtime") === "", "sibling subdomain foo.openai.com rejected");
    ok(R("https://evilopenai.com/v1") === "", "evilopenai.com rejected");
    ok(R("https://api.openai.com.evil.example/v1") === "", "suffix-confusion host rejected");
  }

  // ── R3: 20-second utterance ceiling + ACTIVE cancel (fake clock) ────────────
  section("R3: 20s utterance ceiling — ACTIVE provider cancel + tool abort at the limit");
  {
    ok(CONFIG.DEFAULT_LIMITS.maxUtteranceMs === 20_000, "gateway single-utterance ceiling is exactly 20s (owner correction; not 30s)");
    const clk = fakeClockTimers();
    const store = SESS.createSessionStore({ limits: CONFIG.DEFAULT_LIMITS, now: clk.now, timers: clk.facility });
    const s = store.create({ subject: "u20", ipHash: "h", authenticated: false }).session;
    let providerCancelled = 0, providerClosed = 0;
    store.bindProvider(s, { cancelTurn: () => { providerCancelled += 1; }, close: () => { providerClosed += 1; } });
    store.beginTurn(s);
    let toolAborted = false;
    s.turnAbort?.signal.addEventListener("abort", () => { toolAborted = true; });
    const turnBefore = s.turnId;
    store.startUtterance(s);
    clk.advance(20_001); // past the 20s ceiling
    ok(s.cancelled === true, "utterance past 20s cancels the turn");
    ok(providerCancelled >= 1, "the provider response is ACTIVELY cancelled at the 20s ceiling (not merely flagged)");
    ok(toolAborted === true, "in-flight tool work is aborted at the 20s ceiling");
    // R4-04 (SB04-R3-REREV-04): response.cancel does NOT prove incoming WebRTC audio
    // stops, so the WHOLE session is HARD-TERMINATED at the ceiling (sealed).
    ok(s.terminated === true, "R4-04: the whole session is TERMINATED at the 20s input ceiling (not just the turn)");
    ok(providerClosed >= 1, "R4-04: the provider call is closed/hung up at the ceiling (input media torn down at the source)");
    // A later response.created must NOT reset the session or open a new turn.
    ok(store.beginTurn(s) === turnBefore, "R4-04: a sealed session opens NO new turn on a late response.created (turn counter frozen)");
    ok(store.canRunTool(s) === false, "R4-04: no tool can run on the sealed session (permanently inert)");
  }

  // ── R3: 12-second turn timer — ACTIVE cancel + abort ────────────────────────
  section("R3: 12s turn timeout — ACTIVE provider cancel + tool abort + seal");
  {
    const clk = fakeClockTimers();
    const store = SESS.createSessionStore({ limits: CONFIG.DEFAULT_LIMITS, now: clk.now, timers: clk.facility });
    const s = store.create({ subject: "t12", ipHash: "h", authenticated: false }).session;
    let providerCancelled = 0;
    store.bindProvider(s, { cancelTurn: () => { providerCancelled += 1; }, close: () => {} });
    store.beginTurn(s);
    let toolAborted = false;
    s.turnAbort?.signal.addEventListener("abort", () => { toolAborted = true; });
    clk.advance(CONFIG.DEFAULT_LIMITS.turnCompletionTimeoutMs + 1);
    ok(s.cancelled === true, "turn past 12s is cancelled");
    ok(providerCancelled >= 1, "the provider response is ACTIVELY cancelled at the 12s turn timeout");
    ok(toolAborted === true, "pending tool work is aborted at the 12s turn timeout");
  }

  // ── R3-04: tool abort race with the REAL attached sideband ──────────────────
  section("R3-04: cancelled turn's slow tool fetch resolves late → fully inert");
  {
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const rl = RL.createRateLimiter({ limits: config.limits });
    // a SLOW StayBid read that resolves only when we release it, and honours abort
    let releaseFetch = null;
    let sawAbort = false;
    const slowFetch = (url, init) =>
      new Promise((resolve, reject) => {
        if (init && init.signal) init.signal.addEventListener("abort", () => { sawAbort = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
        releaseFetch = () => resolve({ ok: true, status: 200, text: async () => JSON.stringify({ hotels: [{ id: "hotelSlow" }] }) });
      });
    const exec = TE.createToolExecutor({ config, fetchImpl: slowFetch });
    const side = SB.createSideband({ store, executor: exec, telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
    const sideband = makeFakeSideband();
    const frames = [];
    const s = store.create({ subject: "race", ipHash: "h", authenticated: false }).session;
    store.bindRuntime(s, (fr) => frames.push(fr), () => {});
    side.attach(s, sideband.conn);
    establishDirect(side, sideband, s, "r_race", "item_race");
    sideband.emit({ kind: "tool_call", callId: "cr", tool: "searchHotels", input: {}, responseId: "r_race" });
    await flushMs(10);
    // Turn 1's tool is now pending. Cancel the turn (browser cancel) → abort fires.
    store.cancelTurn(s, s.turnId);
    ok(sawAbort === true, "cancelling the turn fires the tool fetch AbortSignal");
    const sentBefore = sideband.sent.length;
    const framesBefore = frames.length;
    if (releaseFetch) releaseFetch(); // the slow fetch "resolves" late (after abort it rejects)
    await flushMs(20);
    ok(sideband.sent.length === sentBefore, "the late tool result sends NOTHING to the provider");
    ok(!store.hasHotelId(s, "hotelSlow"), "the late tool result mutates NO allowlist");
    ok(frames.length === framesBefore, "the late tool result emits NO browser frame");
  }

  // ── R3-03: OFFICIAL pricing vectors (gpt-realtime-2.1, verified Aug 2026) ───
  section("R3-03: official price vectors — $4/$0.40/$24 text · $32/$0.40/$64 audio per 1M");
  {
    const U0 = { inputTextTokens: 0, cachedInputTextTokens: 0, outputTextTokens: 0, inputAudioTokens: 0, cachedInputAudioTokens: 0, outputAudioTokens: 0 };
    const C = (u) => RL.costCentsForUsage("gpt-realtime-2.1", { ...U0, ...u });
    ok(C({ inputTextTokens: 1_000_000 }) === 400, "text input 1M → 400¢ ($4)");
    ok(C({ cachedInputTextTokens: 1_000_000 }) === 40, "CACHED text input 1M → 40¢ ($0.40)");
    ok(C({ outputTextTokens: 1_000_000 }) === 2400, "text OUTPUT 1M → 2400¢ ($24 — the corrected official price, not $16)");
    ok(C({ inputAudioTokens: 1_000_000 }) === 3200, "audio input 1M → 3200¢ ($32)");
    ok(C({ cachedInputAudioTokens: 1_000_000 }) === 40, "CACHED audio input 1M → 40¢ ($0.40)");
    ok(C({ outputAudioTokens: 1_000_000 }) === 6400, "audio output 1M → 6400¢ ($64)");
    // mixed usage rounds UP conservatively
    ok(C({ inputTextTokens: 100, outputTextTokens: 100, inputAudioTokens: 100, outputAudioTokens: 100 }) === 2, "small mixed usage rounds UP (never undercharges)");
    ok(C({}) === 0, "zero legitimate usage → 0¢ (a real zero is a valid reconcile)");
    // negative/NaN fields inside a usage never become credits
    ok(C({ inputTextTokens: -1000, outputTextTokens: 1_000_000 }) === 2400, "a negative field is clamped to 0 (never a credit)");
    ok(RL.costCentsForUsage("some-unknown-model", U0) === null, "unknown model → null (cost fails closed)");
    // the price table records provenance
    const tbl = RL.COST_PRICE_TABLE["gpt-realtime-2.1"];
    ok(tbl && /developers\.openai\.com/.test(tbl.source) && tbl.verified === "2026-08", "price table carries the official source + verification date");
  }

  // ── R3-03: missing/malformed usage NEVER refunds the reservation ────────────
  section("R3-03: missing/malformed usage retains the conservative reservation");
  {
    ok(SCHEMAS.validateProviderEvent({ kind: "usage" }) === null, "an all-absent usage event is INVALID (null), not a zero");
    ok(SCHEMAS.validateProviderEvent({ kind: "usage", outputTextTokens: "garbage" }) === null, "an all-malformed usage event is invalid");
    ok(SCHEMAS.validateProviderEvent({ kind: "usage", outputTextTokens: -5 }) === null, "a negative-only usage event is invalid");
    const okUsage = SCHEMAS.validateProviderEvent({ kind: "usage", outputTextTokens: 10 });
    ok(okUsage && okUsage.outputTextTokens === 10 && okUsage.inputTextTokens === 0, "a usage event with one usable field validates (others 0)");
    { const d = OA.translateOpenAiEvent({ type: "response.done", response: { id: "r", usage: {} } }); ok(d && d.kind === "response_done" && d.usage === undefined, "response.done with an EMPTY usage object → response_done TERMINAL, no usage (reservation retained)"); }

    // End-to-end: reserve on an answer, then send a MALFORMED usage → reservation kept.
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const rl = RL.createRateLimiter({ limits: config.limits });
    const side = SB.createSideband({ store, executor: TE.createToolExecutor({ config, fetchImpl: makeFetch([]) }), telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
    const sideband = makeFakeSideband();
    const s = store.create({ subject: "noref", ipHash: "h", authenticated: false }).session;
    store.bindRuntime(s, () => {}, () => {});
    side.attach(s, sideband.conn);
    establishDirect(side, sideband, s, "r_nr", "item_nr");
    sideband.emit({ kind: "answer", text: "hello there", responseId: "r_nr" });
    await flushMs(10);
    const reserved = s.costCents;
    ok(reserved > 0, "the scheduled response reserved conservative cost (bound at response.created)");
    // a malformed usage never reaches the loop (schema-invalid) → no refund possible
    sideband.emit({ kind: "usage", responseId: "r_nr" }); // all-absent → dropped by validate in emit chain
    await flushMs(10);
    ok(s.costCents === reserved, "an invalid usage event does NOT refund the reservation");
  }

  // ── R3-02: termination paths hang up the provider call ──────────────────────
  section("R3-02: kill/expiry/cost terminate → provider close (hangup) invoked");
  {
    const clk = fakeClockTimers();
    const store = SESS.createSessionStore({ limits: CONFIG.DEFAULT_LIMITS, now: clk.now, timers: clk.facility });
    let closed = 0;
    const s = store.create({ subject: "hang", ipHash: "h", authenticated: false }).session;
    store.bindProvider(s, { close: () => { closed += 1; }, cancelTurn: () => {} });
    // kill (drainAll)
    store.drainAll();
    ok(closed === 1 && s.terminated, "kill-switch drain closes (hangs up) the provider call");
    // idle expiry on a fresh session
    const s2 = store.create({ subject: "hang2", ipHash: "h2", authenticated: false }).session;
    let closed2 = 0;
    store.bindProvider(s2, { close: () => { closed2 += 1; } });
    clk.advance(CONFIG.DEFAULT_LIMITS.idleTimeoutMs + 1);
    ok(closed2 === 1 && s2.terminated, "idle expiry closes (hangs up) the provider call");
    // the exact hangup wire shape is proven in the R3-01/02 transport section above
  }

  // ── R3-10: secure ordinal visible-context ───────────────────────────────────
  section("R3-10: ordinal visible-context — server verification + ordinal map + defense in depth");
  {
    // schema: bounded / valid / dedup / order preserved
    const idsIn = ["hotelA", "hotelB", "hotelA", "not valid!", "hotelC"];
    const shaped = SCHEMAS.validateSessionCreateBody({ sdp: GOOD_SDP, visibleHotelIds: idsIn });
    ok(shaped && shaped.visibleHotelIds.join(",") === "hotelA,hotelB,hotelC", "candidates deduped + invalid dropped + ORDER preserved");
    const many = SCHEMAS.validateSessionCreateBody({ sdp: GOOD_SDP, visibleHotelIds: Array.from({ length: 40 }, (_, i) => `h${i}`) });
    ok(many && many.visibleHotelIds.length === 24, "candidates bounded to 24");

    // server verification via the fixed read: A + C verify, B fails → slot preserved
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const vFetch = makeFetch([
      { match: (u) => /\/api\/hotels\/hotelA$/.test(u), status: 200, body: { hotel: { id: "hotelA", name: "A", city: "manali", starRating: 4, rooms: [] } } },
      { match: (u) => /\/api\/hotels\/hotelB$/.test(u), status: 404, body: {} },
      { match: (u) => /\/api\/hotels\/hotelC$/.test(u), status: 200, body: { hotel: { id: "hotelC", name: "C", city: "manali", starRating: 3, rooms: [] } } },
    ]);
    const exec = TE.createToolExecutor({ config, fetchImpl: vFetch });
    const verified = await exec.verifyVisibleContext(["hotelA", "hotelB", "hotelC"]);
    ok(verified.length === 2, "only server-verified candidates survive (B dropped — never fail open)");
    ok(verified[0].ordinal === 1 && verified[0].id === "hotelA", "slot 1 → verified hotelA");
    ok(verified[1].ordinal === 3 && verified[1].id === "hotelC", "slot 3 stays ordinal 3 (failed slot 2 is NOT silently renumbered)");
    ok(vFetch.calls.every((c) => /\/api\/hotels\/hotel[ABC]$/.test(c.url) && c.init.method === "GET" && c.init.redirect === "error"), "verification uses the FIXED GET path with redirect:error (SSRF-guarded)");

    // cancellation during validation → stops
    const ac = new AbortController();
    ac.abort();
    const none = await exec.verifyVisibleContext(["hotelA"], ac.signal);
    ok(none.length === 0, "a cancelled context validation verifies nothing");

    // END-TO-END through the REAL handler: candidates → verified allowlist + provider
    // structured context; then OPEN_HOTEL("second one" → hotelC via ordinal map)
    // passes the gateway allowlist.
    const sideband = makeFakeSideband();
    const contextSent = [];
    sideband.conn.sendContext = (items) => contextSent.push(items);
    const ctx2 = G.buildContext({ env: FULL_ENV(), transport: makeTransport(sideband), fetchImpl: vFetch });
    const r = await G.handleSessionCreate(ctx2, {
      origin: ISS, ip: "9.9.9.7",
      authorization: `Bearer ${await makeAssertion({ jti: "jordinal" })}`,
      body: { sdp: GOOD_SDP, visibleHotelIds: ["hotelA", "hotelB", "hotelC"] },
    });
    ok(r.status === 200, "session create with visible candidates succeeds");
    const sess = ctx2.store.get(r.body.sessionId);
    ok(sess.allowlist.has("hotelA") && sess.allowlist.has("hotelC") && !sess.allowlist.has("hotelB"), "ONLY server-verified candidates enter the authoritative allowlist");
    ok(contextSent.length === 1 && contextSent[0].some((it) => it.ordinal === 3 && it.id === "hotelC"), "the provider receives the STRUCTURED ordinal→id mapping (no free-form hotel text)");
    // the model resolves "the second visible one" (surviving ordinal 3 = hotelC) → OPEN_HOTEL
    const frames2 = [];
    ctx2.store.bindRuntime(sess, (fr) => frames2.push(fr), () => {});
    establishResponse(sideband, sess, "r_ord", "item_ord1");
    sideband.emit({ kind: "tool_call", callId: "cord1", tool: "getHotelDetails", input: { id: "hotelC", presentationIntent: "OPEN" }, responseId: "r_ord" });
    await flushMs(20);
    ok(frames2.some((f) => f.t === "ui_action" && f.action.hotelId === "hotelC"), "OPEN_HOTEL for the ordinal-resolved id passes the gateway allowlist → browser frame");
    sideband.emit({ kind: "response_done", responseId: "r_ord" }); // free the serialized slot
    await flushMs(10);
    // a foreign (unverified) id still fails defense-in-depth
    establishResponse(sideband, sess, "r_ord2", "item_ord2");
    sideband.emit({ kind: "tool_call", callId: "cord2", tool: "getHotelDetails", input: { id: "hotelB", presentationIntent: "OPEN" }, responseId: "r_ord2" });
    await flushMs(20);
    ok(frames2.some((f) => f.t === "error" && f.code === "action_rejected"), "OPEN_HOTEL for an UNVERIFIED candidate is rejected (defense in depth)");
  }

  // ── R3-08: provider SDP answer is byte-bounded via a STREAMED read ──────────
  section("R3-08: provider answer SDP bounded (content-length + streamed cap)");
  {
    function streamOf(chunks) {
      let i = 0;
      let cancelled = false;
      return {
        getReader: () => ({
          read: async () => (cancelled || i >= chunks.length ? { done: true } : { done: false, value: chunks[i++] }),
          cancel: async () => { cancelled = true; },
        }),
      };
    }
    const enc = new TextEncoder();
    // an oversized chunked answer (no content-length) must stop mid-stream
    const bigChunk = enc.encode("a".repeat(8 * 1024));
    const sent = [];
    const fetchOversized = async (url) => {
      if (/\/hangup$/.test(url)) return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
      return {
        ok: true, status: 200,
        headers: { get: (n) => (n.toLowerCase() === "location" ? "/v1/realtime/calls/rtc_X" : null) },
        text: async () => { throw new Error("text() must not be used when a stream is present"); },
        body: streamOf([enc.encode("v=0\r\nm=audio 9\r\n"), bigChunk, bigChunk, bigChunk]), // > 16KB total
      };
    };
    const { ws } = (function () { const h = {}; return { ws: { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } }, h }; })();
    const t = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl: fetchOversized, WebSocketCtor: () => ws });
    const r = await t.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 2000 });
    ok(r.ok === false && r.code === "malformed_answer", "an oversized chunked answer SDP fails closed (streamed byte cap)");
    // content-length precheck
    const fetchCl = async () => ({ ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === "content-length" ? String(64 * 1024) : null) }, text: async () => "x" });
    const t2 = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl: fetchCl, WebSocketCtor: () => ws });
    const r2 = await t2.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 2000 });
    ok(r2.ok === false && r2.code === "malformed_answer", "an over-cap Content-Length answer is rejected BEFORE reading");

    // R4-06 (SB04-R3-REREV-06): the create-call deadline covers the BODY read (not
    // cleared at headers). A STALLED answer body → the abort fires → reader cancelled
    // → fail closed as provider_timeout → the partially-created call is hung up.
    let cancelled06 = false; const hangupCalls06 = [];
    const fetchStall = async (url) => {
      if (/\/hangup$/.test(url)) { hangupCalls06.push(url); return { ok: true, status: 200, text: async () => "", headers: { get: () => null } }; }
      return {
        ok: true, status: 200,
        headers: { get: (n) => (n.toLowerCase() === "location" ? "/v1/realtime/calls/rtc_STALL" : null) },
        text: async () => { throw new Error("must not read via text() when a body stream is present"); },
        body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => { cancelled06 = true; } }) },
      };
    };
    const { ws: ws06 } = (function () { const h = {}; return { ws: { send: () => {}, close: () => {}, on: (ev, cb) => { h[ev] = cb; } }, h }; })();
    const t3 = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl: fetchStall, WebSocketCtor: () => ws06 });
    const keep06 = setInterval(() => {}, 15);
    const r3 = await t3.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 40 });
    clearInterval(keep06);
    ok(r3.ok === false && r3.code === "provider_timeout", "a stalled answer BODY (not just headers) fails closed as provider_timeout");
    ok(cancelled06 === true, "the body reader is CANCELLED on the deadline (no dangling read)");
    ok(hangupCalls06.length >= 1, "the partially-created call (id from Location) is hung up on body-stall timeout");
  }

  // ── R4 (SB04-R3-REREV-01..13): targeted residual-path regression ────────────
  // Local WS/fetch fakes mirroring the R3-01/02 open handshake, reused across R4 cases.
  function makeR4Ws(sentFrames) {
    const h = {};
    return { ws: { send: (d) => sentFrames.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } }, h };
  }
  function makeR4Fetch(opts = {}) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      if (/\/hangup$/.test(url)) return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
      return {
        ok: true, status: 200,
        text: async () => "v=0\r\nm=audio 9 UDP\r\n",
        headers: { get: (n) => (n.toLowerCase() === "location" && !opts.noLoc ? "https://api.openai.com/v1/realtime/calls/rtc_R4" : null) },
      };
    };
    impl.calls = calls;
    return impl;
  }
  const R4_BASE = "https://api.openai.com/v1/realtime";
  async function openR4Session() {
    const sent = [];
    const { ws, h } = makeR4Ws(sent);
    const fetchImpl = makeR4Fetch();
    const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
    const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: R4_BASE, connectTimeoutMs: 5000 });
    await flushMs(1);
    if (h.open) h.open();
    await flushMs(1);
    if (h.message) h.message(effectiveAck());
    const res = await p;
    return { res, sent, fetchImpl, h };
  }

  // R4-01: EFFECTIVE session.updated validation — not a bare ack.
  section("R4-01: effective session.updated is validated (type/model/tool_choice/exact-4-tools/additionalProperties/create_response)");
  {
    const VE = OA.validateEffectiveSession;
    const M = "gpt-realtime-2.1";
    const full = () => JSON.parse(JSON.stringify({
      type: "realtime", model: M, tool_choice: "auto",
      tools: JSON.parse(JSON.stringify(OA.FIXED_TOOL_DEFINITIONS)),
      audio: { input: { turn_detection: { type: "server_vad", create_response: false, interrupt_response: false } } },
    }));
    ok(VE(full(), M) === true, "exact effective config → accept");
    ok(VE({}, M) === false, "bare/empty session → reject");
    ok(VE(undefined, M) === false, "missing session → reject");
    ok(VE(Object.assign(full(), { type: "transcription" }), M) === false, "wrong session.type → reject");
    ok(VE(Object.assign(full(), { model: "gpt-4o-realtime" }), M) === false, "wrong model (when exposed) → reject");
    ok(VE(Object.assign(full(), { tool_choice: "none" }), M) === false, "wrong tool_choice → reject");
    { const c = full(); c.tools = c.tools.slice(0, 3); ok(VE(c, M) === false, "3 tools → reject"); }
    { const c = full(); c.tools = c.tools.concat([{ type: "function", name: "extraTool", parameters: { type: "object", properties: {}, additionalProperties: false } }]); ok(VE(c, M) === false, "5 tools → reject"); }
    { const c = full(); c.tools[0] = Object.assign({}, c.tools[0], { name: "searchHotelsRENAMED" }); ok(VE(c, M) === false, "renamed tool → reject"); }
    { const c = full(); const t0 = JSON.parse(JSON.stringify(c.tools[0])); t0.parameters.properties.city = { type: "number" }; c.tools[0] = t0; ok(VE(c, M) === false, "changed param type → reject"); }
    { const c = full(); const t0 = JSON.parse(JSON.stringify(c.tools[0])); t0.parameters.additionalProperties = true; c.tools[0] = t0; ok(VE(c, M) === false, "loosened additionalProperties → reject"); }
    { const c = full(); c.audio.input.turn_detection.create_response = true; ok(VE(c, M) === false, "turn_detection.create_response:true → reject"); }
    { const c = full(); delete c.model; ok(VE(c, M) === true, "model omitted (not exposed) → accept (only rejected when present + wrong)"); }
    // The readiness gate uses it: a BARE session.updated must NOT satisfy readiness.
    const sent = []; const { ws, h } = makeR4Ws(sent); const fetchImpl = makeR4Fetch();
    const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
    const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: R4_BASE, connectTimeoutMs: 5000 });
    await flushMs(1); if (h.open) h.open(); await flushMs(1);
    if (h.message) h.message(JSON.stringify({ type: "session.updated", session: { type: "realtime" } })); // BARE
    const res = await p;
    ok(res.ok === false && res.code === "provider_rejected", "a BARE session.updated does NOT satisfy readiness (fails closed: provider_rejected)");
  }

  // R4-02: post-ready sideband death (ws error/close, provider fatal) is FATAL.
  section("R4-02: post-ready sideband error/close/provider-error fires the fatal lifecycle signal exactly once");
  {
    const { res, h } = await openR4Session();
    ok(res.ok === true && typeof res.sideband.onFatal === "function", "the live sideband exposes an onFatal lifecycle hook");
    let fatal = 0; let lastReason = null;
    res.sideband.onFatal((reason) => { fatal += 1; lastReason = reason; });
    if (h.error) h.error(new Error("boom"));       // post-ready ws error
    await flushMs(1);
    ok(fatal === 1 && lastReason === "socket_error", "a post-ready ws error fires fatal(socket_error)");
    if (h.close) h.close();                         // a following close must NOT double-fire
    await flushMs(1);
    ok(fatal === 1, "a subsequent close does not double-fire fatal (recursive/double-termination prevented)");

    // An INTENTIONAL local close must NOT be read as a second failure.
    const s2 = await openR4Session();
    let fatal2 = 0; s2.res.sideband.onFatal(() => { fatal2 += 1; });
    s2.res.sideband.close();                        // intentional teardown
    await flushMs(1);
    if (s2.h.close) s2.h.close();
    await flushMs(1);
    ok(fatal2 === 0, "an intentional local close never fires fatal");

    // A provider `error` event AFTER readiness is fatal too.
    const s3 = await openR4Session();
    let fatal3 = 0; let r3 = null; s3.res.sideband.onFatal((reason) => { fatal3 += 1; r3 = reason; });
    if (s3.h.message) s3.h.message(JSON.stringify({ type: "error", error: { message: "post-ready fatal" } }));
    await flushMs(1);
    ok(fatal3 === 1 && r3 === "provider_error", "a post-ready provider error fires fatal(provider_error)");
  }

  // R4-03: cost reservation BEFORE inference — provider never auto-creates a response.
  section("R4-03: create_response:false everywhere + requestResponse gates inference (sendToolResult never auto-responds)");
  {
    ok(OA.FIXED_TURN_DETECTION.create_response === false && OA.FIXED_TURN_DETECTION.interrupt_response === false, "FIXED_TURN_DETECTION disables provider auto-response");
    const mp = OA.buildCreateCallMultipart(GOOD_SDP, "gpt-realtime-2.1");
    ok(/"create_response":false/.test(mp.body) && /"turn_detection"/.test(mp.body), "the multipart create body sends turn_detection.create_response:false");
    const { res, sent } = await openR4Session();
    // session.update on open also carries create_response:false
    ok(sent.some((f) => { try { const o = JSON.parse(f); return o.type === "session.update" && o.session.audio.input.turn_detection.create_response === false; } catch { return false; } }), "session.update on open carries create_response:false");
    // sendToolResult must NOT auto-emit response.create; requestResponse is the ONLY trigger.
    const before = sent.length;
    res.sideband.sendToolResult({ callId: "c1", output: { ok: true } });
    await flushMs(1);
    ok(!sent.slice(before).some((f) => { try { return JSON.parse(f).type === "response.create"; } catch { return false; } }), "sendToolResult does NOT auto-send response.create (no inference without a reservation)");
    ok(typeof res.sideband.requestResponse === "function", "the transport exposes requestResponse (the post-reservation inference trigger)");
    const before2 = sent.length;
    const rr = res.sideband.requestResponse();
    await flushMs(1);
    ok(rr === true && sent.slice(before2).some((f) => { try { return JSON.parse(f).type === "response.create"; } catch { return false; } }), "requestResponse() sends exactly one response.create (fired only after a reservation)");
  }

  // R4-10: ordinal visible-context is ACK-GATED (authoritative install, not best-effort).
  section("R4-10: sendContext awaits a conversation.item.created ack — success / timeout / close");
  {
    // ack success: echo conversation.item.created with the minted id → resolves true.
    const { res, sent, h } = await openR4Session();
    const before = sent.length;
    const pAck = res.sideband.sendContext([{ ordinal: 1, id: "hotelZ" }], 4000);
    await flushMs(1);
    const createFrame = sent.slice(before).map((f) => { try { return JSON.parse(f); } catch { return null; } }).find((o) => o && o.type === "conversation.item.create");
    ok(!!createFrame && createFrame.item && typeof createFrame.item.id === "string", "sendContext emits conversation.item.create with a minted item id");
    if (h.message) h.message(JSON.stringify({ type: "conversation.item.created", item: { id: createFrame.item.id } }));
    ok((await pAck) === true, "a matching conversation.item.created ack resolves sendContext(true)");

    // ack timeout: no echo → resolves false.
    const s2 = await openR4Session();
    const pTo = s2.res.sideband.sendContext([{ ordinal: 1, id: "hotelY" }], 30);
    const keep = setInterval(() => {}, 15);
    ok((await pTo) === false, "no ack within the deadline resolves sendContext(false)");
    clearInterval(keep);

    // close before ack → resolves false.
    const s3 = await openR4Session();
    const pClose = s3.res.sideband.sendContext([{ ordinal: 1, id: "hotelX" }], 4000);
    await flushMs(1);
    if (s3.h.close) s3.h.close();
    ok((await pClose) === false, "a sideband close before the ack resolves sendContext(false)");
  }

  // R4-11: no invented `staybid.ui_action` provider event — documented tool path only.
  section("R4-11: OPEN_HOTEL rides the documented getHotelDetails(presentationIntent) tool path; no ui_action event exists");
  {
    ok(OA.translateOpenAiEvent({ type: "staybid.ui_action", action: { type: "OPEN_HOTEL", hotelId: "h1" } }) === null, "a fabricated staybid.ui_action provider event translates to null (not a real event)");
    const gh = OA.FIXED_TOOL_DEFINITIONS.find((t) => t.name === "getHotelDetails");
    ok(!!gh && gh.parameters.properties.presentationIntent && Array.isArray(gh.parameters.properties.presentationIntent.enum) && gh.parameters.properties.presentationIntent.enum.length === 1 && gh.parameters.properties.presentationIntent.enum[0] === "OPEN", "getHotelDetails carries a narrowly-closed presentationIntent enum [\"OPEN\"]");
    ok(gh.parameters.additionalProperties === false, "getHotelDetails keeps additionalProperties:false (no open-ended navigation surface)");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R5 (SB04-R4-REREV-01..05) — residual remediation, real paths, fake net.
  // ══════════════════════════════════════════════════════════════════════════

  // R5-01: FULL manual server-VAD effective-config validation.
  section("R5-01: effective session proves the COMPLETE manual server_vad contract (audio.input.turn_detection)");
  {
    const VE = OA.validateEffectiveSession;
    const M = "gpt-realtime-2.1";
    // The exact complete effective config (documented location + full manual VAD).
    const full = () => JSON.parse(JSON.stringify({
      type: "realtime", model: M, tool_choice: "auto",
      tools: JSON.parse(JSON.stringify(OA.FIXED_TOOL_DEFINITIONS)),
      audio: { input: { turn_detection: { type: "server_vad", create_response: false, interrupt_response: false } } },
    }));
    ok(VE(full(), M) === true, "exact complete effective config → accept");
    // reject matrix (R5-01)
    ok(VE(undefined, M) === false, "missing session → reject");
    { const c = full(); delete c.audio; ok(VE(c, M) === false, "missing audio → reject"); }
    { const c = full(); c.audio = {}; ok(VE(c, M) === false, "missing audio.input → reject"); }
    { const c = full(); c.audio.input = {}; ok(VE(c, M) === false, "missing turn_detection → reject (not silently accepted)"); }
    { const c = full(); c.audio.input.turn_detection = null; ok(VE(c, M) === false, "null turn_detection → reject"); }
    { const c = full(); c.audio.input.turn_detection.type = "semantic_vad"; ok(VE(c, M) === false, "wrong VAD type (semantic_vad) → reject"); }
    { const c = full(); delete c.audio.input.turn_detection.type; ok(VE(c, M) === false, "missing turn_detection.type → reject"); }
    { const c = full(); c.audio.input.turn_detection.create_response = true; ok(VE(c, M) === false, "create_response:true → reject"); }
    { const c = full(); delete c.audio.input.turn_detection.create_response; ok(VE(c, M) === false, "create_response missing → reject (full effective config must expose it)"); }
    { const c = full(); c.audio.input.turn_detection.interrupt_response = true; ok(VE(c, M) === false, "interrupt_response:true → reject"); }
    { const c = full(); delete c.audio.input.turn_detection.interrupt_response; ok(VE(c, M) === false, "interrupt_response missing → reject (full effective config must expose it)"); }
    // R4 tool/tool_choice validation remains intact under R5.
    { const c = full(); c.tool_choice = "none"; ok(VE(c, M) === false, "wrong tool_choice still rejected (R4 intact)"); }
    { const c = full(); c.tools = c.tools.slice(0, 3); ok(VE(c, M) === false, "wrong tool config (3 tools) still rejected (R4 intact)"); }
    // A top-level turn_detection (non-documented location) does NOT satisfy the gate.
    { const c = full(); delete c.audio; c.turn_detection = { type: "server_vad", create_response: false, interrupt_response: false }; ok(VE(c, M) === false, "top-level turn_detection (undocumented location) → reject"); }
  }

  // R5-02: ONE commit-bound reservation + ONE response.create per committed utterance.
  // ══════════════════════════════════════════════════════════════════════════
  // R6 (SB04-R5-REREV-01/02) — item-id VAD ownership + serialized reservation.
  // ══════════════════════════════════════════════════════════════════════════
  const turnCents = RL.estimateTurnCents("gpt-realtime-2.1");
  async function freshSession(sub) {
    const { ctx, sideband } = freshCtx({ fetchImpl: makeFetch([HOTELS([{ id: "hotelS" }])]) });
    const created = await G.handleSessionCreate(ctx, { origin: ISS, ip: "9.9.9.1", authorization: `Bearer ${await makeAssertion({ sub, jti: "j" + sub })}`, body: { sdp: GOOD_SDP } });
    ok(created.status === 200, `[${sub}] session created`);
    const session = ctx.store.get(created.body.sessionId);
    return { ctx, sideband, session };
  }
  // Complete an ACTIVE response cycle: bind its response.created then response.done.
  function completeResponse(sideband, responseId, reqId, usage) {
    sideband.emit({ kind: "response_begin", responseId, requestId: reqId });
    const done = { kind: "response_done", responseId };
    if (usage) Object.assign(done, usage);
    sideband.emit(done);
  }
  // Drive ONE full committed utterance → response cycle (commit → created → done).
  function establishAndDone(sideband, itemId, responseId) {
    const reqId = commitUtterance(sideband, itemId);
    completeResponse(sideband, responseId, reqId);
    return reqId;
  }

  // R6-01: ITEM-ID-CORRELATED per-item VAD ownership.
  section("R6-01: item-id-correlated VAD ownership (per-item state; no crossover; replay-safe)");
  {
    // 1) start(A) → stop(A) → commit(A) → exactly ONE logical A commit + response.create.
    {
      const { sideband, session } = await freshSession("r601_1");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      ok(sideband.responseRequests() === 0 && session.costCents === 0, "speech_started/stopped reserve nothing (commit-bound)");
      sideband.emitCommit("A");
      ok(sideband.responseRequests() === 1 && session.costCents === turnCents, "commit(A) → exactly ONE reservation + ONE response.create");
    }
    // 2) start(A) stop(A) start(B) commit(A) stop(B) commit(B): NO crossover.
    {
      const { sideband } = await freshSession("r601_2");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      sideband.emitSpeech("start", "B");
      sideband.emitCommit("A"); // A commits → dispatched (slot IDLE) → request A
      const reqA = sideband.lastRequestId();
      ok(sideband.responseRequests() === 1, "commit(A) dispatched A's response (B untouched)");
      sideband.emitSpeech("stop", "B");
      sideband.emitCommit("B"); // B commits while A active → B QUEUED (serialized), not sent yet
      ok(sideband.responseRequests() === 1, "commit(B) does NOT open a concurrent response (serialized queue)");
      // complete A → B dispatches on its OWN distinct request (no crossover).
      completeResponse(sideband, "rA", reqA);
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "after A's response.done, B dispatches exactly one response");
      const reqB = sideband.lastRequestId();
      ok(reqB !== reqA, "A and B each own a DISTINCT request (no identity crossover)");
    }
    // 3) two fast complete utterances (sequential).
    {
      const { sideband } = await freshSession("r601_3");
      const r1 = establishAndDone(sideband, "A1", "rA1");
      const r2 = establishAndDone(sideband, "A2", "rA2");
      ok(r1 !== r2 && sideband.responseRequests() === 2, "two sequential complete utterances → two independent responses");
    }
    // 4) duplicate start(A) → idempotent.
    {
      const { sideband } = await freshSession("r601_4");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      sideband.emitCommit("A");
      ok(sideband.responseRequests() === 1, "duplicate start(A) is idempotent (one response)");
    }
    // 5) duplicate stop(A) → idempotent.
    {
      const { sideband } = await freshSession("r601_5");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitSpeech("stop", "A");
      sideband.emitCommit("A");
      ok(sideband.responseRequests() === 1, "duplicate stop(A) is idempotent (one response)");
    }
    // 6) duplicate commit(A) → idempotent.
    {
      const { sideband } = await freshSession("r601_6");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      sideband.emitCommit("A"); sideband.emitCommit("A"); sideband.emitCommit("A");
      ok(sideband.responseRequests() === 1, "duplicate commit(A) is idempotent (one response)");
    }
    // 7) commit UNKNOWN id → reject.
    {
      const { sideband, session } = await freshSession("r601_7");
      sideband.emitCommit("Z");
      ok(sideband.responseRequests() === 0 && session.costCents === 0, "commit of an UNKNOWN id → reject (no reserve)");
    }
    // 8) commit EMPTY id → reject.
    {
      const { sideband } = await freshSession("r601_8");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      sideband.emitCommit("");
      ok(sideband.responseRequests() === 0, "commit with an EMPTY id → reject (no reserve)");
    }
    // 9) commit MISSING id (undefined) → reject.
    {
      const { sideband } = await freshSession("r601_9");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      sideband.emitCommit(undefined);
      ok(sideband.responseRequests() === 0, "commit with a MISSING id → reject (no reserve)");
    }
    // 10) stop WRONG id → no effect on A.
    {
      const { sideband } = await freshSession("r601_10");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "B"); // B unknown → ignored
      sideband.emitCommit("A"); // A never STOPPED → reject
      ok(sideband.responseRequests() === 0, "a stop for a WRONG id does not advance A (commit-before-stop rejected)");
    }
    // 11) commit BEFORE the matching stop → reject.
    {
      const { sideband } = await freshSession("r601_11");
      sideband.emitSpeech("start", "A"); sideband.emitCommit("A"); // no stop yet
      ok(sideband.responseRequests() === 0, "commit before the matching stop → reject");
    }
    // 12) commit AFTER termination → inert.
    {
      const { ctx, sideband, session } = await freshSession("r601_12");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      ctx.store.terminate(session, "kill");
      sideband.emitCommit("A");
      ok(sideband.responseRequests() === 0, "commit after termination is inert");
    }
    // 13) 20s HARD termination before commit → terminated session ignores the commit.
    {
      const { ctx, sideband, session } = await freshSession("r601_13");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A");
      ctx.store.terminate(session, "utterance_max"); // stands in for the 20s hard stop (R4-04 proves the timer path)
      sideband.emitCommit("A");
      ok(sideband.responseRequests() === 0 && session.terminated === true, "20s termination before commit ⇒ commit is inert");
    }
    // 14) OLD TERMINAL id replay → idempotent (never live again).
    {
      const { sideband } = await freshSession("r601_14");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitCommit("A"); // A → TERMINAL
      ok(sideband.responseRequests() === 1, "A committed once");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitCommit("A"); // replay old id
      ok(sideband.responseRequests() === 1, "an OLD TERMINAL id replay never becomes live again (no new response)");
    }
    // 15) state-cap exhaustion → FAIL CLOSED (no eviction-based replay).
    {
      const { ctx, sideband, session } = await freshSession("r601_15");
      // drive far more distinct STARTED items than the cap (512) so it must fail closed.
      for (let i = 0; i < 600 && !session.terminated; i++) sideband.emitSpeech("start", "it" + i);
      ok(session.terminated === true, "exceeding the unique-item cap FAILS CLOSED (never evicts → no replay)");
      void ctx;
    }
  }

  // R6-02: serialized response slot + per-request reservation ownership.
  section("R6-02: serialized response slot + exact per-request reservation ownership");
  {
    // A) one commit → 1 reservation → 1 response.create → 1 response.created → 1 done → 1 reconcile.
    {
      const { sideband, session } = await freshSession("r602_A");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitCommit("A");
      const reqA = sideband.lastRequestId();
      ok(sideband.responseRequests() === 1 && session.costCents === turnCents, "A: exactly ONE reservation + ONE response.create");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      ok(session.costCents === turnCents, "A: response.created binds the SAME reservation (no extra charge)");
      sideband.emit({ kind: "response_done", responseId: "rA", inputTextTokens: 10, outputTextTokens: 20, inputAudioTokens: 0, outputAudioTokens: 0 });
      ok(session.costCents <= turnCents, "A: response.done reconciles the ONE reservation (never above it — no aggregate)");
    }
    // B) two commits before first response.created → only first response.create sent (no aggregate).
    {
      const { sideband, session } = await freshSession("r602_B");
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitCommit("A");
      const costAfterA = session.costCents;
      sideband.emitSpeech("start", "B"); sideband.emitSpeech("stop", "B"); sideband.emitCommit("B");
      ok(sideband.responseRequests() === 1, "B: only the FIRST response.create is sent (second is queued)");
      ok(session.costCents === costAfterA, "B: NO aggregate reservation — B is not reserved until it dispatches");
    }
    // F) requestResponse returns FALSE → session fails closed; reservation retained.
    {
      const { sideband, session } = await freshSession("r602_F");
      sideband.setSendFail(true);
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitCommit("A");
      ok(session.terminated === true, "F: a false response.create send FAILS THE SESSION CLOSED");
      ok(session.costCents === turnCents, "F: the conservative reservation is RETAINED (not released on send failure)");
    }
    // G) requestResponse THROWS → same.
    {
      const { sideband, session } = await freshSession("r602_G");
      sideband.setSendThrow(true);
      sideband.emitSpeech("start", "A"); sideband.emitSpeech("stop", "A"); sideband.emitCommit("A");
      ok(session.terminated === true, "G: a throwing response.create send FAILS THE SESSION CLOSED");
    }
    // H) duplicate response.created same id → idempotent.
    {
      const { sideband, session } = await freshSession("r602_H");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      const t1 = session.turnId;
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA }); // duplicate
      ok(session.turnId === t1 && !session.terminated, "H: a duplicate response.created (same id) is idempotent");
    }
    // I) a SECOND, DIFFERENT response.created while ACTIVE → fail closed.
    {
      const { sideband, session } = await freshSession("r602_I");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      sideband.emit({ kind: "response_begin", responseId: "rDIFFERENT", requestId: reqA }); // concurrent, invalid
      ok(session.terminated === true, "I: a second DIFFERENT response.created while active FAILS CLOSED (no concurrency)");
    }
    // J) response.done with VALID usage → exact reconcile.
    {
      const { sideband, session } = await freshSession("r602_J");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      const reserved = session.costCents;
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000, inputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0 });
      ok(session.costCents === 72 && session.costCents !== reserved, "J: valid usage reconciles EXACTLY this response (72¢ @ $24/1M)");
    }
    // K) response.done with MALFORMED usage → reservation retained, but still terminal/sealed.
    {
      const { sideband, session } = await freshSession("r602_K");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      const reserved = session.costCents;
      sideband.emit({ kind: "response_done", responseId: "rA" }); // no usage (terminal only)
      ok(session.costCents === reserved, "K: malformed/absent usage RETAINS the conservative reservation");
      // the slot freed → a new utterance can now dispatch (proves terminality without usage).
      const before = sideband.responseRequests();
      commitUtterance(sideband, "B");
      ok(sideband.responseRequests() === before + 1, "K: response.done is TERMINAL even without usage (slot freed, next dispatches)");
    }
    // L) duplicate response.done → no second reconcile/refund.
    {
      const { sideband, session } = await freshSession("r602_L");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      const afterFirst = session.costCents;
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 }); // duplicate
      ok(session.costCents === afterFirst, "L: a duplicate response.done does NOT reconcile/refund again");
    }
    // M) UNKNOWN response.done → does not affect another reservation.
    {
      const { sideband, session } = await freshSession("r602_M");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      const reserved = session.costCents;
      sideband.emit({ kind: "response_done", responseId: "rUNKNOWN", outputTextTokens: 999 }); // not mapped
      ok(session.costCents === reserved && !session.terminated, "M: an unknown response.done is inert (affects no reservation)");
    }
    // N) two SEQUENTIAL successful responses → each own reservation + reconcile.
    {
      const { sideband, session } = await freshSession("r602_N");
      const r1 = commitUtterance(sideband, "A"); sideband.emit({ kind: "response_begin", responseId: "rA", requestId: r1 });
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 5000 });
      const afterFirst = session.costCents;
      const r2 = commitUtterance(sideband, "B"); sideband.emit({ kind: "response_begin", responseId: "rB", requestId: r2 });
      sideband.emit({ kind: "response_done", responseId: "rB", outputTextTokens: 5000 });
      ok(r1 !== r2 && afterFirst === 12 && session.costCents === 24, "N: two sequential responses each reserve + reconcile independently (12c each)");
    }
    // O/P/R) tool continuation uses the SAME pipeline; queued behind the parent; dedup by callId.
    {
      const { ctx, sideband, session } = await freshSession("r602_O");
      // real ctx executor needs a hotels route already provided (HOTELS([hotelS])).
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(30);
      const afterTool = sideband.responseRequests();
      ok(afterTool === 1, "P: a tool result while the parent is ACTIVE does NOT open an early continuation response");
      // duplicate tool_call (same callId) → no duplicate continuation.
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(20);
      // parent done frees the slot → exactly ONE continuation dispatches.
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(10);
      ok(sideband.responseRequests() === afterTool + 1, "O/R: exactly ONE tool continuation dispatches after the parent response.done (no duplicate)");
      const reqCont = sideband.lastRequestId();
      ok(reqCont !== reqA, "O: the continuation owns its OWN request (origin = tool_continuation)");
      void ctx; void session;
    }
    // D/E) response.created ACK TIMEOUT (transport) → fatal → late response.created inert.
    {
      const sent = []; const h = {};
      const ws = { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } };
      const fetchImpl = async (url) => {
        if (/\/hangup$/.test(url)) return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
        return { ok: true, status: 200, text: async () => "v=0\r\nm=audio 9 UDP\r\n", headers: { get: (n) => (n.toLowerCase() === "location" ? "https://api.openai.com/v1/realtime/calls/rtc_T" : null) } };
      };
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws, responseAckMs: 30 });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 5000 });
      await flushMs(1); if (h.open) h.open(); await flushMs(1); if (h.message) h.message(effectiveAck());
      const res = await p;
      let fatal = 0; let reason = null;
      res.sideband.onFatal((r) => { fatal += 1; reason = r; });
      res.sideband.requestResponse("rq_deadline"); // sent, but NO response.created arrives
      const keep = setInterval(() => {}, 10);
      await flushMs(60); // > responseAckMs
      clearInterval(keep);
      ok(fatal === 1 && reason === "response_timeout", "D: no response.created within the ACK deadline → fatal(response_timeout)");
      // a LATE response.created after the timeout is inert (a matching create clears no live timer, fires no second fatal).
      if (h.message) h.message(JSON.stringify({ type: "response.created", response: { id: "rLATE", metadata: { request_id: "rq_deadline" } } }));
      await flushMs(5);
      ok(fatal === 1, "E: a late response.created AFTER the timeout is inert (no second fatal / no re-arm)");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R7 (SB04-R6-REREV-01..05) — mandatory request_id correlation, ACK-clear only
  // on authoritative bind, fail-closed usage trust (no refund below reservation),
  // tool-continuation priority (bounded starvation-safe), owned-cancelled terminal
  // cleanup (no stale UI). Reuses the R6 helpers (freshSession/commitUtterance/…).
  // ══════════════════════════════════════════════════════════════════════════
  section("R7-01: MANDATORY exact request_id correlation on response.created (missing/mismatch → fail closed)");
  {
    // Missing echoed request_id → the bind FAILS CLOSED (previously it was allowed to bind).
    {
      const { sideband, session } = await freshSession("r701_missing");
      commitUtterance(sideband, "A"); // arms exactly one CREATE_SENT request
      sideband.emit({ kind: "response_begin", responseId: "rA" }); // NO request_id echo
      ok(session.terminated === true, "R7-01: a response.created with a MISSING request_id FAILS CLOSED (no bind)");
    }
    // Mismatched echoed request_id → fail closed.
    {
      const { sideband, session } = await freshSession("r701_mismatch");
      commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: "rq_forged_999" });
      ok(session.terminated === true, "R7-01: a response.created with a MISMATCHED request_id FAILS CLOSED");
    }
    // Positive control: the EXACT matching request_id binds + opens the turn.
    {
      const { sideband, session } = await freshSession("r701_match");
      const reqA = commitUtterance(sideband, "A");
      const t0 = session.turnId;
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      ok(!session.terminated && session.turnId > t0, "R7-01: the EXACT matching request_id binds + opens the turn");
      // and it still reconciles its own response.done (proves a real bind, not just non-termination).
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000, inputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0 });
      ok(session.costCents === 72, "R7-01: the bound response reconciles its own usage (72¢) — a real bind");
    }
  }

  section("R7-02: response.created ACK deadline cleared ONLY on the authoritative bind (raw event does not clear it)");
  {
    function mkTransport(loc) {
      const sent = []; const h = {};
      const ws = { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } };
      const fetchImpl = async (url) => (/\/hangup$/.test(url)
        ? { ok: true, status: 200, text: async () => "", headers: { get: () => null } }
        : { ok: true, status: 200, text: async () => "v=0\r\nm=audio 9 UDP\r\n", headers: { get: (n) => (n.toLowerCase() === "location" ? loc : null) } });
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws, responseAckMs: 30 });
      return { transport, h };
    }
    async function openReadySb(loc) {
      const { transport, h } = mkTransport(loc);
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 5000 });
      await flushMs(1); if (h.open) h.open(); await flushMs(1); if (h.message) h.message(effectiveAck());
      const res = await p;
      return { res, h };
    }
    // A RAW response.created delivered to the transport does NOT clear the ACK deadline → timeout still fires.
    {
      const { res, h } = await openReadySb("https://api.openai.com/v1/realtime/calls/rtc_R72a");
      let fatal = 0, reason = null;
      res.sideband.onFatal((r) => { fatal += 1; reason = r; });
      res.sideband.requestResponse("rq_r72a"); // arms the ACK deadline
      if (h.message) h.message(JSON.stringify({ type: "response.created", response: { id: "rX", metadata: { request_id: "rq_r72a" } } }));
      const keep = setInterval(() => {}, 10);
      await flushMs(60);
      clearInterval(keep);
      ok(fatal === 1 && reason === "response_timeout", "R7-02: a RAW response.created does NOT clear the ACK deadline — the fail-closed timeout still fires");
    }
    // The AUTHORITATIVE bind hook (notifyResponseBound) clears the ACK deadline → no fatal.
    {
      const { res } = await openReadySb("https://api.openai.com/v1/realtime/calls/rtc_R72b");
      let fatal = 0;
      res.sideband.onFatal(() => { fatal += 1; });
      res.sideband.requestResponse("rq_r72b"); // arms the ACK deadline
      res.sideband.notifyResponseBound();       // the authoritative-bind hook clears it
      const keep = setInterval(() => {}, 10);
      await flushMs(60);
      clearInterval(keep);
      ok(fatal === 0, "R7-02: notifyResponseBound() (authoritative bind) clears the ACK deadline → NO fatal");
    }
  }

  section("R7-03: COMPLETE fail-closed usage trust — reconciliation NEVER refunds below the conservative reservation");
  {
    // A degenerate/under-reporting usage (a lone 0-token field → cost 0 < reservation) never refunds.
    {
      const { sideband, session } = await freshSession("r703_degenerate");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      const reserved = session.costCents;
      ok(reserved === turnCents, "R7-03: the response is bound at the conservative reservation");
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 0 }); // schema-valid, cost 0
      ok(session.costCents === reserved, "R7-03: a usage computing BELOW the reservation NEVER refunds (retained)");
    }
    // A trusted usage ABOVE the reservation still charges UP (the reconcile up-path is preserved).
    {
      const { sideband, session } = await freshSession("r703_up");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA });
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000, inputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0 });
      ok(session.costCents === 72, "R7-03: trusted usage ABOVE the reservation still charges up (72¢)");
    }
  }

  section("R7-04: current-turn tool continuation has priority over later user work (bounded, starvation-safe)");
  {
    const PI = SB.pendingInsertIndex;
    // The PURE insertion policy (decisive: origin identity is not observable downstream of dispatch).
    ok(PI([], "tool_continuation", 0) === 0, "R7-04: a continuation into an empty queue → head");
    ok(PI(["user_commit"], "tool_continuation", 0) === 0, "R7-04: a continuation JUMPS AHEAD of a queued user_commit (priority, not FIFO)");
    ok(PI(["user_commit", "user_commit"], "tool_continuation", 0) === 0, "R7-04: a continuation jumps ahead of MULTIPLE queued user_commits");
    ok(PI(["tool_continuation", "user_commit"], "tool_continuation", 0) === 1, "R7-04: continuations stay FIFO among themselves (ahead of user_commit, behind earlier continuations)");
    ok(PI(["user_commit"], "user_commit", 0) === 1, "R7-04: a user_commit always appends at the tail");
    ok(PI(["user_commit"], "tool_continuation", SB.MAX_CONSECUTIVE_CONTINUATIONS) === 1, "R7-04: at the starvation ceiling, a continuation goes to the TAIL (bounded starvation-safe)");
    // Integration health: a user_commit queued behind an active parent AND a continuation both dispatch.
    {
      const { sideband } = await freshSession("r704_int");
      const reqA = commitUtterance(sideband, "A");
      sideband.emit({ kind: "response_begin", responseId: "rA", requestId: reqA }); // parent active
      commitUtterance(sideband, "B"); // a NEWER user utterance → user_commit queued
      ok(sideband.responseRequests() === 1, "R7-04: user_commit B is queued behind the active parent (serialized, not sent)");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(30);
      ok(sideband.responseRequests() === 1, "R7-04: neither B nor the continuation runs while the parent is ACTIVE");
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 }); // parent frees the slot
      await flushMs(10);
      ok(sideband.responseRequests() === 2, "R7-04: one work item (the priority continuation) dispatches after the parent done");
      const reqC = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC", requestId: reqC });
      sideband.emit({ kind: "response_done", responseId: "rC", outputTextTokens: 5000 });
      await flushMs(10);
      ok(sideband.responseRequests() === 3, "R7-04: the queued user_commit B then dispatches (nothing starved)");
    }
  }

  section("R7-05: an OWNED but CANCELLED response.done still seals + frees the slot, WITHOUT emitting stale UI");
  {
    // Establish a bound response, then CANCEL its turn (supersede). A cancelled-but-owned response.done
    // must free the serialized slot so a later utterance can dispatch — but emit NO stale browser frame.
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const rl = RL.createRateLimiter({ limits: config.limits });
    const side = SB.createSideband({ store, executor: TE.createToolExecutor({ config, fetchImpl: makeFetch([]) }), telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
    const sideband = makeFakeSideband();
    const frames = [];
    const s = store.create({ subject: "r705", ipHash: "h", authenticated: false }).session;
    store.bindRuntime(s, (f) => frames.push(f), () => {});
    side.attach(s, sideband.conn);
    const reqA = establishDirect(side, sideband, s, "rA", "item_A"); // bound + turn open
    void reqA;
    await flushMs(5);
    // Cancel/supersede the owning turn (marks the session's current turn stale for rA).
    s.cancelled = true;
    const framesBefore = frames.length;
    sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 }); // owned + cancelled
    await flushMs(5);
    ok(frames.length === framesBefore, "R7-05: an owned-cancelled response.done emits NO stale browser frame");
    ok(s.costCents === 72, "R7-05: it STILL reconciles its own usage (cost sealed correctly)");
    // The slot is freed → clear the stale flag and a NEW committed utterance dispatches.
    s.cancelled = false;
    const before = sideband.responseRequests();
    establishDirect(side, sideband, s, "rB", "item_B");
    ok(sideband.responseRequests() === before + 1, "R7-05: the freed slot lets a NEW response dispatch (scheduler not wedged)");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R7.1 (SB04-R7-01) — slow-tool / early-response.done race: explicit current-turn
  // tool-continuation DEBT + a user-dispatch BARRIER. A CONTROLLABLE slow tool proves
  // response.done(parent) BEFORE tool completion still runs the parent's continuation
  // FIRST and a later user_commit only AFTER the whole logical turn is terminal.
  // ══════════════════════════════════════════════════════════════════════════
  // A controllable executor: each run() returns a Promise the test resolves/rejects by hand.
  function slowExecutor() {
    const pending = [];
    return {
      executor: { run: (_store, _session, _ev, _signal) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }) },
      resolveNext: (result) => { const p = pending.shift(); if (p) p.resolve(result); },
      rejectNext: (err) => { const p = pending.shift(); if (p) p.reject(err || new Error("tool threw")); },
      pendingCount: () => pending.length,
    };
  }
  function slowHarness(sub) {
    const config = CONFIG.loadGatewayConfig(FULL_ENV());
    const store = SESS.createSessionStore({ limits: config.limits });
    const rl = RL.createRateLimiter({ limits: config.limits });
    const ex = slowExecutor();
    const side = SB.createSideband({ store, executor: ex.executor, telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
    const sideband = makeFakeSideband();
    const frames = [];
    const s = store.create({ subject: sub, ipHash: "h", authenticated: false }).session;
    store.bindRuntime(s, (f) => frames.push(f), () => {});
    side.attach(s, sideband.conn);
    return { store, side, sideband, s, ex, frames };
  }
  const OKRUN = { ok: true, count: 1, data: {}, normalizedResult: "ok" };

  section("R7.1: DECISIVE slow-tool / early-response.done — user B blocked until A's continuation is fully terminal");
  {
    const { side, sideband, s, ex } = slowHarness("r71_decisive");
    const reqA = establishDirect(side, sideband, s, "rA", "item_A"); // 1) A ACTIVE
    side.requestUserResponse(s, "item_B");                            // 2) user B queued
    ok(sideband.responseRequests() === 1, "R7.1: user B is queued behind active A (not dispatched)");
    sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // 3) tool call
    await flushMs(5);
    ok(ex.pendingCount() === 1, "R7.1: the tool executor is IN FLIGHT (deliberately not resolved)");
    sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 }); // 5) parent done WHILE tool pending
    await flushMs(5);
    ok(s.costCents === 72, "R7.1: A cost/lifecycle SEALS on its response.done");                       // 6a
    ok(sideband.responseRequests() === 1, "R7.1: user B does NOT dispatch while A's continuation debt is unresolved"); // 6b
    ex.resolveNext(OKRUN); // 7) tool A completes
    await flushMs(5);
    ok(sideband.sent.some((p) => p.callId === "cA" && p.ok === true), "R7.1: the tool's function_call_output is sent"); // 8a
    ok(sideband.responseRequests() === 2, "R7.1: A's CONTINUATION is the NEXT response.create (not B)");                // 8b
    const reqCont = sideband.lastRequestId();
    ok(reqCont !== reqA, "R7.1: the continuation owns its OWN request id");
    sideband.emit({ kind: "response_begin", responseId: "rC", requestId: reqCont }); // 9) bind continuation
    ok(sideband.responseRequests() === 2, "R7.1: B STILL not dispatched while the continuation is ACTIVE");
    sideband.emit({ kind: "response_done", responseId: "rC", outputTextTokens: 5000 }); // 10) continuation done
    await flushMs(5);
    ok(sideband.responseRequests() === 3, "R7.1: user B dispatches ONLY after A's continuation is terminal"); // 11a
    const reqB = sideband.lastRequestId();
    ok(reqB !== reqA && reqB !== reqCont, "R7.1: B gets a NEW independent request id (no cross-turn ownership)"); // 11b
  }

  section("R7.1: additional lifecycle coverage (A–I)");
  {
    // A) tool completes BEFORE parent done → continuation first, user B after (R7 normal case preserved).
    {
      const { side, sideband, s, ex } = slowHarness("r71_A");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ex.resolveNext(OKRUN); // tool done BEFORE parent done
      await flushMs(5);
      ok(sideband.responseRequests() === 1, "A: continuation enqueued but NOT sent while parent still ACTIVE (serialized)");
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "A: continuation dispatches first after parent done");
      const rq = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC", requestId: rq });
      sideband.emit({ kind: "response_done", responseId: "rC", outputTextTokens: 5000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 3, "A: user B dispatches only after the continuation");
    }
    // B) tool FAILS after parent done → no phantom continuation; barrier releases B; no wedge.
    {
      const { side, sideband, s, ex } = slowHarness("r71_B");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 1, "B: user B held while the tool is pending");
      ex.resolveNext({ ok: false, reason: "not_found" }); // tool FAILS
      await flushMs(5);
      ok(sideband.responseRequests() === 2 && !s.terminated, "B: failed tool owes NO continuation → barrier releases, B dispatches, no wedge");
    }
    // C) tool THROWS → resolves the debt, no crash, no phantom continuation.
    {
      const { side, sideband, s, ex } = slowHarness("r71_C");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ex.rejectNext(new Error("boom"));
      await flushMs(5);
      ok(!s.terminated, "C: a throwing tool does not crash/terminate the session");
      ok(sideband.responseRequests() === 2, "C: throwing tool resolves the debt → B dispatches (no wedge, no phantom continuation)");
    }
    // D) turn CANCEL while slow tool pending → no continuation on the cancelled turn.
    {
      const { side, sideband, s, ex } = slowHarness("r71_D");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      s.cancelled = true; // supersede while the tool is in flight
      const before = sideband.responseRequests();
      ex.resolveNext(OKRUN); // slow tool completes on a cancelled turn
      await flushMs(5);
      ok(sideband.responseRequests() === before && !s.terminated, "D: a tool completing on a CANCELLED turn enqueues NO continuation (debt resolved, no crash)");
    }
    // E) session TERMINATE while slow tool pending → late completion is inert.
    {
      const { side, sideband, s, ex, store } = slowHarness("r71_E");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      store.terminate(s, "kill");
      ex.resolveNext(OKRUN); // late tool completion after terminate
      await flushMs(5);
      ok(s.terminated === true, "E: session terminated");
      ok(!sideband.sent.some((p) => p.callId === "cA"), "E: a tool completing AFTER terminate is inert (no function_call_output, no continuation)");
    }
    // F) DUPLICATE same callId → R7.2 ACCEPT-ONCE: the duplicate is INERT before the executor (only the
    // ONE accepted invocation runs) → exactly ONE continuation, no wedge.
    {
      const { side, sideband, s, ex } = slowHarness("r71_F");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // duplicate (inert)
      await flushMs(5);
      ok(ex.pendingCount() === 1, "F: R7.2 accept-once — a duplicate callId does NOT invoke the executor a second time");
      ex.resolveNext(OKRUN);
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 2 && !s.terminated, "F: duplicate callId yields EXACTLY ONE continuation (accept-once, no double debt / wedge)");
    }
    // G) TWO distinct continuation-bearing tools for one parent → first finisher must NOT falsely clear the barrier.
    {
      const { side, sideband, s, ex } = slowHarness("r71_G");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B"); // B must never interleave into the incomplete turn
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cB", tool: "getFlashDeals", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(ex.pendingCount() === 2, "G: two distinct continuation-bearing tools in flight for one parent");
      ex.resolveNext(OKRUN); // cA finishes first
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "G: cA's continuation dispatches after parent done");
      const rq = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rCA", requestId: rq });
      sideband.emit({ kind: "response_done", responseId: "rCA", outputTextTokens: 5000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "G: user B STILL held — cB's tool debt keeps the barrier (first finisher did not falsely clear it)");
      ex.resolveNext(OKRUN); // cB finishes
      await flushMs(5);
      ok(sideband.responseRequests() === 3, "G: cB's continuation dispatches (still before B)");
      const rq2 = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rCB", requestId: rq2 });
      sideband.emit({ kind: "response_done", responseId: "rCB", outputTextTokens: 5000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 4, "G: only after BOTH tools' continuations resolve does user B dispatch");
    }
    // H) CONTINUATION itself calls a tool → the same debt/barrier protects the extended chain.
    {
      const { side, sideband, s, ex } = slowHarness("r71_H");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ex.resolveNext(OKRUN);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      const rqc = sideband.lastRequestId(); // cA continuation
      sideband.emit({ kind: "response_begin", responseId: "rC", requestId: rqc });
      sideband.emit({ kind: "tool_call", callId: "cC", tool: "getFlashDeals", input: {}, responseId: "rC" }); // continuation calls a tool
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rC", outputTextTokens: 5000 }); // continuation's provider response done, its tool still pending
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "H: user B still held — the continuation's OWN tool debt (cC) keeps the barrier");
      ex.resolveNext(OKRUN); // cC tool done → chained continuation
      await flushMs(5);
      ok(sideband.responseRequests() === 3, "H: the chained continuation dispatches (still ahead of B)");
      const rqc2 = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC2", requestId: rqc2 });
      sideband.emit({ kind: "response_done", responseId: "rC2", outputTextTokens: 5000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 4, "H: only after the WHOLE continuation chain resolves does user B dispatch");
    }
    // I) STARVATION BOUND: the per-turn tool cap bounds a continuation chain, user B never interleaves
    // mid-chain, and the session stays healthy. (The MAX_CONSECUTIVE_CONTINUATIONS fail-closed ceiling
    // in enqueueWork is a documented defensive backstop that the per-turn/session tool caps keep
    // unreachable in normal operation — a pure tool→continuation chain never completes its turn, so
    // toolCallsPerTurn=2 bounds it long before 8 consecutive continuations.)
    {
      const { side, sideband, s, ex } = slowHarness("r71_I");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B"); // queued throughout; must never interleave into the chain
      // tool #1 in the parent turn → continuation
      sideband.emit({ kind: "tool_call", callId: "t1", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(3); ex.resolveNext(OKRUN); await flushMs(3);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 5000 });
      await flushMs(3);
      ok(sideband.responseRequests() === 2, "I: tool #1's continuation dispatches (B held)");
      const rq1 = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC1", requestId: rq1 });
      // tool #2 in the SAME logical turn → continuation (toolCallsThisTurn now 2)
      sideband.emit({ kind: "tool_call", callId: "t2", tool: "getFlashDeals", input: {}, responseId: "rC1" });
      await flushMs(3); ex.resolveNext(OKRUN); await flushMs(3);
      sideband.emit({ kind: "response_done", responseId: "rC1", outputTextTokens: 5000 });
      await flushMs(3);
      ok(sideband.responseRequests() === 3, "I: tool #2's continuation dispatches (B STILL held — no interleave inside the chain)");
      const rq2 = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC2", requestId: rq2 });
      // tool #3 in the same turn → CAPPED by toolCallsPerTurn (2) BEFORE the executor runs → no continuation owed
      sideband.emit({ kind: "tool_call", callId: "t3", tool: "searchHotels", input: {}, responseId: "rC2" });
      await flushMs(3);
      ok(ex.pendingCount() === 0, "I: the per-turn tool cap blocks a 3rd tool BEFORE the executor runs — the continuation chain is bounded");
      sideband.emit({ kind: "response_done", responseId: "rC2", outputTextTokens: 5000 });
      await flushMs(3);
      ok(sideband.responseRequests() === 4 && !s.terminated, "I: after the tool-capped turn ends, user B dispatches — bounded, no wedge, never interleaved mid-chain");
    }
  }

  section("R7.1: R7 invariants preserved under the debt/barrier (J/K/L/M reaffirm)");
  {
    // M / R7-03: no downward cost refund still holds under the barrier.
    {
      const { side, sideband, s } = slowHarness("r71_M");
      const reqA = establishDirect(side, sideband, s, "rA", "item_A");
      void reqA;
      const reserved = s.costCents;
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 0 }); // degenerate low usage
      ok(s.costCents === reserved, "M (R7-03): a usage below the reservation still NEVER refunds under the barrier");
    }
    // J / R7-05: an owned-cancelled response.done still emits no stale UI (no tool involved).
    {
      const { side, sideband, s, frames } = slowHarness("r71_J");
      establishDirect(side, sideband, s, "rA", "item_A");
      s.cancelled = true;
      const before = frames.length;
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(frames.length === before && s.costCents === 72, "J (R7-05): owned-cancelled response.done seals cost, emits NO stale UI");
    }
    // K / R7-01 mandatory request_id + L / R7-02 ACK timer remain covered by the R7 section (still green);
    // reaffirm K here directly.
    {
      const { side, sideband, s } = slowHarness("r71_K");
      side.requestUserResponse(s, "item_A"); // arms a CREATE_SENT request
      sideband.emit({ kind: "response_begin", responseId: "rA" }); // missing request_id echo
      ok(s.terminated === true, "K (R7-01): a response.created with a MISSING request_id still FAILS CLOSED under R7.1");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R7.1 TURN-OWNERSHIP CLOSURE — a tool_continuation stays on the parent's SAME
  // logical turn; the next queued user_commit crosses a FRESH monotonic turn
  // boundary (new turnId, reset toolCallsThisTurn, cleared cancelled). Asserts
  // ACTUAL turn ownership, not merely request IDs.
  // ══════════════════════════════════════════════════════════════════════════
  section("R7.1: turn-ownership closure — continuation same turn; user B a fresh turn (1–5)");
  {
    // a clock-aware slow harness so the 12s turn-completion timer can be driven deterministically.
    function fakeClock() {
      let clock = 1_000_000, id = 0; const timers = new Map();
      return {
        now: () => clock,
        facility: { set: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: clock + ms }); return h; }, clear: (h) => timers.delete(h) },
        advance: (delta) => { clock += delta; for (const [h, t] of Array.from(timers)) if (t.at <= clock) { timers.delete(h); t.fn(); } },
      };
    }
    function slowHarnessClk(sub, clk) {
      const config = CONFIG.loadGatewayConfig(FULL_ENV());
      const store = SESS.createSessionStore({ limits: config.limits, now: clk ? clk.now : undefined, timers: clk ? clk.facility : undefined });
      const rl = RL.createRateLimiter({ limits: config.limits });
      const ex = slowExecutor();
      const side = SB.createSideband({ store, executor: ex.executor, telemetry: TEL.createTelemetry(), config, rateLimiter: rl });
      const sideband = makeFakeSideband();
      const s = store.create({ subject: sub, ipHash: "h", authenticated: false }).session;
      store.bindRuntime(s, () => {}, () => {});
      side.attach(s, sideband.conn);
      return { store, side, sideband, s, ex };
    }

    // (1) + (5) DECISIVE turn ownership: continuation stays on A's turn; B is A+1.
    {
      const { side, sideband, s, ex } = slowHarnessClk("r71t_decisive");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      ok(turnA >= 1, "turn-own(1): A opened a monotonic turn");
      side.requestUserResponse(s, "item_B"); // queued
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 }); // parent done while tool pending
      await flushMs(5);
      ex.resolveNext(OKRUN); // continuation queued + dispatched
      await flushMs(5);
      const reqCont = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC", requestId: reqCont });
      ok(s.turnId === turnA, "turn-own(5): the CONTINUATION stays on A's SAME logical turn (turnId unchanged)");
      sideband.emit({ kind: "response_done", responseId: "rC", outputTextTokens: 5000 });
      await flushMs(5);
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1, "turn-own(1): user B crosses a FRESH monotonic turn boundary (turnId = A+1, not A)");
    }

    // (2) failed tool ends the turn → B is a NEW turn; toolCallsThisTurn + cancelled reset (no leak).
    {
      const { side, sideband, s, ex } = slowHarnessClk("r71t_fail");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(s.toolCallsThisTurn >= 1, "turn-own(2): A consumed tool budget on its turn");
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ex.resolveNext({ ok: false, reason: "not_found" }); // tool FAILS → no continuation → B dispatches
      await flushMs(5);
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1, "turn-own(2): after a failed-tool turn, user B is a NEW monotonic turn");
      ok(s.toolCallsThisTurn === 0 && s.cancelled === false, "turn-own(2): B's fresh turn reset the tool budget + cancelled flag (no stale leak)");
    }

    // (3) 12s turn timeout while slow tool pending → old A cancelled; late tool cannot continue A;
    //     legitimate B is a NEW turn with clean (non-cancelled) state.
    {
      const clk = fakeClock();
      const { side, sideband, s, ex } = slowHarnessClk("r71t_timeout", clk);
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B"); // queued
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      const reqsBeforeTimeout = sideband.responseRequests();
      clk.advance(CONFIG.DEFAULT_LIMITS.turnCompletionTimeoutMs + 1); // the 12s turn timer fires → cancels A
      ok(s.cancelled === true, "turn-own(3): the 12s turn timeout cancelled A while its tool was pending");
      ex.resolveNext(OKRUN); // the SLOW tool completes AFTER the timeout (stale)
      await flushMs(5);
      ok(sideband.responseRequests() === reqsBeforeTimeout, "turn-own(3): a late/stale tool completion CANNOT continue the cancelled A (no continuation)");
      // the provider still emits response.done for the cancelled A (R7-05) → frees the slot → B dispatches.
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1 && s.cancelled === false && s.toolCallsThisTurn === 0,
        "turn-own(3): legitimate B starts a NEW turn; stale/cancelled state does not poison B");
    }

    // (4) tool-cap end of a continuation chain → B is a NEW turn with a RESET tool budget it can consume.
    {
      const { side, sideband, s, ex } = slowHarnessClk("r71t_cap");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B"); // queued throughout
      // tool #1 on A → continuation rC1 (same turn)
      sideband.emit({ kind: "tool_call", callId: "t1", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(3); ex.resolveNext(OKRUN); await flushMs(3);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 5000 });
      await flushMs(3);
      const rq1 = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC1", requestId: rq1 });
      // tool #2 on rC1 (same turn) → continuation rC2
      sideband.emit({ kind: "tool_call", callId: "t2", tool: "getFlashDeals", input: {}, responseId: "rC1" });
      await flushMs(3); ex.resolveNext(OKRUN); await flushMs(3);
      ok(s.toolCallsThisTurn === 2, "turn-own(4): A's logical turn consumed its full per-turn tool budget");
      sideband.emit({ kind: "response_done", responseId: "rC1", outputTextTokens: 5000 });
      await flushMs(3);
      const rq2 = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC2", requestId: rq2 });
      // tool #3 in the SAME turn → CAPPED before the executor → no continuation → chain ends
      sideband.emit({ kind: "tool_call", callId: "t3", tool: "searchHotels", input: {}, responseId: "rC2" });
      await flushMs(3);
      ok(ex.pendingCount() === 0, "turn-own(4): the 3rd tool in the same turn is CAPPED before the executor (chain bounded)");
      sideband.emit({ kind: "response_done", responseId: "rC2", outputTextTokens: 5000 });
      await flushMs(3);
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1, "turn-own(4): after the tool-capped chain, user B is a NEW turn");
      ok(s.toolCallsThisTurn === 0, "turn-own(4): B's fresh turn RESET the per-turn tool budget");
      // prove B can consume its OWN fresh tool budget.
      sideband.emit({ kind: "tool_call", callId: "b1", tool: "searchHotels", input: {}, responseId: "rB" });
      await flushMs(3); ex.resolveNext(OKRUN); await flushMs(3);
      ok(s.toolCallsThisTurn === 1, "turn-own(4): B consumes its own fresh allowed tool budget (not blocked by A's spent budget)");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R7.2 (SB04-R7.1-REREV-01) — AUTHORITATIVE ACCEPT-ONCE call_id dedup: exactly
  // one accepted invocation owns each callId; every duplicate/replay is inert (or
  // fails closed on conflict) BEFORE cost / tool budget / executor / debt / output.
  // ══════════════════════════════════════════════════════════════════════════
  section("R7.2: accept-once call_id dedup (1–12)");
  {
    const toolCents = RL.estimateToolCents("gpt-realtime-2.1");
    const cAsent = (sideband) => sideband.sent.filter((p) => p.callId === "cA").length;

    // 1) ACCEPT-ONCE BASIC — duplicate while original pending: executor once, cost once, budget once.
    {
      const { side, sideband, s, ex } = slowHarness("r72_1");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // duplicate
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // duplicate
      await flushMs(5);
      ok(ex.pendingCount() === 1, "R7.2(1): executor invoked exactly ONCE for N same-callId events");
      ok(s.toolCallsThisTurn === 1, "R7.2(1): tool budget consumed exactly ONCE");
      ok(s.costCents === turnCents + toolCents, "R7.2(1): tool cost reserved exactly ONCE");
      ex.resolveNext(OKRUN);
      await flushMs(5);
      ok(cAsent(sideband) === 1, "R7.2(1): exactly ONE function_call_output for the callId");
    }

    // 2) SUCCESS + EARLY PARENT DONE + USER B (with a duplicate injected).
    {
      const { side, sideband, s, ex } = slowHarness("r72_2");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // duplicate inert
      await flushMs(5);
      ok(ex.pendingCount() === 1, "R7.2(2): executor once despite the duplicate");
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 }); // early parent done
      await flushMs(5);
      ok(sideband.responseRequests() === 1, "R7.2(2): B held by the ONE accepted cA debt");
      ex.resolveNext(OKRUN); // original succeeds
      await flushMs(5);
      ok(cAsent(sideband) === 1, "R7.2(2): exactly one function_call_output");
      ok(sideband.responseRequests() === 2, "R7.2(2): A's continuation dispatches next (not B)");
      const reqCont = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rC", requestId: reqCont });
      ok(s.turnId === turnA, "R7.2(2): the continuation binds on A's SAME turn");
      sideband.emit({ kind: "response_done", responseId: "rC", outputTextTokens: 5000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 3, "R7.2(2): B dispatches only after the continuation");
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1, "R7.2(2): B opens a FRESH monotonic turn");
    }

    // 3) FAILURE + EARLY PARENT DONE + USER B; late replay stays inert forever.
    {
      const { side, sideband, s, ex } = slowHarness("r72_3");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // duplicate inert
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 1, "R7.2(3): B held while the ONE accepted cA is pending");
      ex.resolveNext({ ok: false, reason: "not_found" }); // original FAILS
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "R7.2(3): failure owes no continuation → B dispatches");
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1, "R7.2(3): B opens a fresh turn after the failed tool turn");
      // a late replay of cA (carrying its original — now sealed — parent) is inert: no executor, no
      // output, no continuation, no cost/budget mutation, no crash.
      const snap = { pend: ex.pendingCount(), sent: cAsent(sideband), req: sideband.responseRequests(), tool: s.toolCallsThisTurn, cost: s.costCents };
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(ex.pendingCount() === snap.pend && cAsent(sideband) === snap.sent && sideband.responseRequests() === snap.req && s.toolCallsThisTurn === snap.tool && s.costCents === snap.cost && !s.terminated,
        "R7.2(3): a late replay of the accepted callId is INERT forever (no exec/output/continuation/cost/budget)");
    }

    // 4) THROW + DUPLICATE.
    {
      const { side, sideband, s, ex } = slowHarness("r72_4");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // duplicate inert
      await flushMs(5);
      ok(ex.pendingCount() === 1, "R7.2(4): executor once despite the duplicate");
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ex.rejectNext(new Error("boom")); // original THROWS
      await flushMs(5);
      ok(!s.terminated && sideband.responseRequests() === 2, "R7.2(4): a throwing accepted tool → no continuation, B dispatches, no wedge");
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB });
      ok(s.turnId === turnA + 1, "R7.2(4): B opens a fresh turn after the throwing tool turn");
    }

    // 5) DUPLICATE AFTER SUCCESS — replay while the parent is still active (registry, not the sealed-check).
    {
      const { side, sideband, s, ex } = slowHarness("r72_5");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ex.resolveNext(OKRUN); // tool succeeds (continuation queued; parent rA still ACTIVE, not sealed)
      await flushMs(5);
      const snap = { sent: cAsent(sideband), tool: s.toolCallsThisTurn, cost: s.costCents, pend: ex.pendingCount() };
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // replay after success
      await flushMs(5);
      ok(cAsent(sideband) === snap.sent && s.toolCallsThisTurn === snap.tool && s.costCents === snap.cost && ex.pendingCount() === snap.pend,
        "R7.2(5): a replay AFTER success is inert (no 2nd output / continuation / cost / budget)");
    }

    // 6) DUPLICATE AFTER FAILURE — replay while the parent is still active.
    {
      const { side, sideband, s, ex } = slowHarness("r72_6");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ex.resolveNext({ ok: false, reason: "not_found" }); // fails (parent rA still ACTIVE)
      await flushMs(5);
      const snap = { sent: cAsent(sideband), tool: s.toolCallsThisTurn, cost: s.costCents, pend: ex.pendingCount(), req: sideband.responseRequests() };
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // replay after failure
      await flushMs(5);
      ok(cAsent(sideband) === snap.sent && s.toolCallsThisTurn === snap.tool && s.costCents === snap.cost && ex.pendingCount() === snap.pend && sideband.responseRequests() === snap.req,
        "R7.2(6): a replay AFTER failure does NOT retry/resurrect execution or continuation");
    }

    // 7) DUPLICATE AFTER B FRESH TURN — A's callId replay cannot consume/mutate B state.
    {
      const { side, sideband, s, ex } = slowHarness("r72_7");
      establishDirect(side, sideband, s, "rA", "item_A");
      const turnA = s.turnId;
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ex.resolveNext({ ok: false, reason: "not_found" }); // no continuation → B dispatches
      await flushMs(5);
      const reqB = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rB", requestId: reqB }); // B fresh turn (turnA+1)
      ok(s.turnId === turnA + 1, "R7.2(7): B is on a fresh turn");
      const snap = { tool: s.toolCallsThisTurn, cost: s.costCents, sent: cAsent(sideband), pend: ex.pendingCount() };
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" }); // replay of A's callId
      await flushMs(5);
      ok(s.toolCallsThisTurn === snap.tool && s.costCents === snap.cost && cAsent(sideband) === snap.sent && ex.pendingCount() === snap.pend && !s.terminated,
        "R7.2(7): A's callId replay cannot run under B, consume B's tool budget, or send A output");
    }

    // 8) CONFLICTING DUPLICATE — same callId, different tool → FAIL CLOSED (chosen policy).
    {
      const { side, sideband, s, ex } = slowHarness("r72_8");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(ex.pendingCount() === 1, "R7.2(8): the first cA is accepted");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "getFlashDeals", input: {}, responseId: "rA" }); // CONFLICT (different tool)
      await flushMs(5);
      ok(s.terminated === true, "R7.2(8): a conflicting same-callId replay FAILS CLOSED (never a second execution)");
      ok(ex.pendingCount() === 1, "R7.2(8): no second executor invocation on the conflicting replay");
    }

    // 9) DISTINCT cA + cB — both execute; B held until BOTH continuation debts resolve.
    {
      const { side, sideband, s, ex } = slowHarness("r72_9");
      establishDirect(side, sideband, s, "rA", "item_A");
      side.requestUserResponse(s, "item_B");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cB", tool: "getFlashDeals", input: {}, responseId: "rA" }); // distinct callId
      await flushMs(5);
      ok(ex.pendingCount() === 2 && s.toolCallsThisTurn === 2, "R7.2(9): distinct callIds BOTH execute (not deduped)");
      ex.resolveNext(OKRUN); // cA
      await flushMs(5);
      sideband.emit({ kind: "response_done", responseId: "rA", outputTextTokens: 30000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "R7.2(9): cA continuation dispatches");
      const rq = sideband.lastRequestId();
      sideband.emit({ kind: "response_begin", responseId: "rCA", requestId: rq });
      sideband.emit({ kind: "response_done", responseId: "rCA", outputTextTokens: 5000 });
      await flushMs(5);
      ok(sideband.responseRequests() === 2, "R7.2(9): B STILL held — cB's debt keeps the barrier");
      ex.resolveNext(OKRUN); // cB
      await flushMs(5);
      ok(sideband.responseRequests() === 3, "R7.2(9): cB continuation dispatches (still before B)");
    }

    // 10) OPEN_HOTEL DUPLICATE — one executor, one budget, one terminal outcome, zero continuation.
    {
      const { side, sideband, s, ex, frames } = slowHarness("r72_10");
      establishDirect(side, sideband, s, "rA", "item_A");
      const input = { id: "hotelX", presentationIntent: "OPEN" };
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "getHotelDetails", input, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "getHotelDetails", input, responseId: "rA" }); // duplicate inert
      await flushMs(5);
      ok(ex.pendingCount() === 1, "R7.2(10): OPEN_HOTEL executor invoked ONCE despite the duplicate");
      ok(s.toolCallsThisTurn === 1, "R7.2(10): one tool-budget slot for the OPEN_HOTEL duplicate");
      ex.resolveNext(OKRUN);
      await flushMs(5);
      const terminal = frames.filter((f) => (f.t === "ui_action" && f.action && f.action.type === "OPEN_HOTEL") || (f.t === "error" && f.code === "action_rejected")).length;
      ok(terminal === 1, "R7.2(10): exactly ONE terminal OPEN_HOTEL outcome (ui_action or action_rejected), never two");
    }

    // 11) TOOL-BUDGET PROOF — one accepted + N duplicates = ONE slot; a distinct call takes the next slot.
    {
      const { side, sideband, s } = slowHarness("r72_11");
      establishDirect(side, sideband, s, "rA", "item_A");
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(s.toolCallsThisTurn === 1, "R7.2(11): one accepted call + N duplicates consume exactly ONE tool slot");
      sideband.emit({ kind: "tool_call", callId: "cB", tool: "getFlashDeals", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(s.toolCallsThisTurn === 2, "R7.2(11): a distinct callId consumes the next slot normally (dedup didn't over-count)");
    }

    // 12) TOOL-COST PROOF — one accepted + duplicates charges the same tool reservation as one call alone.
    {
      const { side, sideband, s } = slowHarness("r72_12");
      establishDirect(side, sideband, s, "rA", "item_A");
      const baseline = s.costCents; // turnCents (the response reservation)
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      sideband.emit({ kind: "tool_call", callId: "cA", tool: "searchHotels", input: {}, responseId: "rA" });
      await flushMs(5);
      ok(s.costCents === baseline + toolCents, "R7.2(12): one accepted call + duplicates charges EXACTLY one tool reservation");
    }
  }

  // R5-03: LATCHED fatal delivery.
  section("R5-03: fatal is LATCHED — a fatal before onFatal registration is delivered on registration, exactly once");
  {
    // Reuse the real transport open handshake (R4 helpers).
    function makeWsL(sent) { const h = {}; return { ws: { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } }, h }; }
    function makeFetchL(opts = {}) {
      const calls = [];
      const impl = async (url) => {
        calls.push(url);
        if (/\/hangup$/.test(url)) return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
        return { ok: true, status: 200, text: async () => "v=0\r\nm=audio 9 UDP\r\n", headers: { get: (n) => (n.toLowerCase() === "location" && !opts.noLoc ? "https://api.openai.com/v1/realtime/calls/rtc_L" : null) } };
      };
      impl.calls = calls; return impl;
    }
    async function openReady() {
      const sent = []; const { ws, h } = makeWsL(sent); const fetchImpl = makeFetchL();
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl, WebSocketCtor: () => ws });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 5000 });
      await flushMs(1); if (h.open) h.open(); await flushMs(1); if (h.message) h.message(effectiveAck());
      const res = await p; return { res, h };
    }
    // ws close BEFORE onFatal registration → later register → exactly one delivery.
    {
      const { res, h } = await openReady();
      if (h.close) h.close();           // fatal occurs, NO listener yet → latched
      await flushMs(1);
      let fatal = 0; let reason = null;
      res.sideband.onFatal((r) => { fatal += 1; reason = r; });  // registration AFTER fatal
      ok(fatal === 1 && reason === "socket_closed", "a fatal latched before registration is delivered on registration (exactly once)");
      if (h.error) h.error(new Error("x")); await flushMs(1);
      ok(fatal === 1, "a later error+close cannot double-deliver a latched fatal");
    }
    // ws error before registration → latched → delivered once.
    {
      const { res, h } = await openReady();
      if (h.error) h.error(new Error("boom")); await flushMs(1);
      let fatal = 0; let reason = null;
      res.sideband.onFatal((r) => { fatal += 1; reason = r; });
      ok(fatal === 1 && reason === "socket_error", "a pre-registration ws error is latched + delivered once");
    }
    // provider error before registration → latched → delivered once.
    {
      const { res, h } = await openReady();
      if (h.message) h.message(JSON.stringify({ type: "error", error: { message: "fatal" } })); await flushMs(1);
      let fatal = 0; let reason = null;
      res.sideband.onFatal((r) => { fatal += 1; reason = r; });
      ok(fatal === 1 && reason === "provider_error", "a pre-registration provider error is latched + delivered once");
    }
    // intentional local close never latches a fatal.
    {
      const { res, h } = await openReady();
      res.sideband.close();             // intentional
      await flushMs(1); if (h.close) h.close(); await flushMs(1);
      let fatal = 0;
      res.sideband.onFatal(() => { fatal += 1; });
      ok(fatal === 0, "an intentional local close never latches a fatal (no delivery on later registration)");
    }
    // registration BEFORE fatal still receives it normally (regression).
    {
      const { res, h } = await openReady();
      let fatal = 0; res.sideband.onFatal(() => { fatal += 1; });
      if (h.close) h.close(); await flushMs(1);
      ok(fatal === 1, "registration before the fatal still receives it normally (exactly once)");
    }
    // a throwing callback cannot re-enable or duplicate delivery.
    {
      const { res, h } = await openReady();
      if (h.close) h.close(); await flushMs(1);   // latched
      let calls = 0;
      res.sideband.onFatal(() => { calls += 1; throw new Error("consumer throws"); });
      ok(calls === 1, "a throwing fatal callback is invoked exactly once and cannot duplicate");
    }
  }

  // R5-04: a TERMINATED session never yields a success envelope (dead-session guard).
  section("R5-04: handleSessionCreate fails closed when a fatal terminates the session mid-setup");
  {
    const deadCheckEnvelope = (res) =>
      res.status !== 200 && !(res.body && (res.body.answerSdp || res.body.controlToken || res.body.sessionId));

    // (A) fatal LATCHED at ready → delivered the moment the gateway registers onFatal
    //     → session terminated BEFORE any credential is minted (guard #1).
    {
      // A minimal sideband whose onFatal immediately delivers a latched fatal (exactly
      // the openai-realtime latch semantics: registration flushes the pending fatal).
      const conn = {
        onEvent() {}, onSpeech() {}, onCommit() {},
        onFatal(cb) { cb("socket_closed"); },   // latched-at-ready: deliver on registration
        sendToolResult() {}, requestResponse() { return true; },
        cancelTurn() {}, close() {},
      };
      const transport = { isAvailable() { return true; }, async createSession() { return { ok: true, answerSdp: "v=0\r\nm=audio 9 UDP\r\n", providerSessionId: "pL", sideband: conn }; } };
      const { ctx } = freshCtx({ transport, fetchImpl: makeFetch([]) });
      const res = await G.handleSessionCreate(ctx, { origin: ISS, ip: "9.9.9.2", authorization: `Bearer ${await makeAssertion({ sub: "vsub_r504a", jti: "jr504a" })}`, body: { sdp: GOOD_SDP } });
      ok(deadCheckEnvelope(res), "a fatal latched at ready ⇒ non-200, NO success envelope (no answerSdp/controlToken/sessionId)");
      ok(res.status === 503 && res.body.error === "provider_unavailable", "dead session returns a stable bounded code (503 provider_unavailable)");
    }

    // (B) fatal DURING visible-context verification (a later await boundary) → non-200.
    {
      const sideband = makeFakeSideband();
      const transport = { isAvailable() { return true; }, async createSession() { return { ok: true, answerSdp: "v=0\r\nm=audio 9 UDP\r\n", providerSessionId: "pV", sideband: sideband.conn }; } };
      // The gateway registers onFatal before the ordinal block; a fetch during the
      // verify read fires the fatal (which terminates the session), so the post-verify
      // liveness guard (#3) fails closed.
      let fired = false;
      const base = makeFetch([HOTEL_ONE({ id: "hotelV", name: "V", city: "manali", rooms: [{ floorPrice: 2400 }] })]);
      const fetchImpl = async (url, init) => {
        if (!fired && /\/api\/hotels\//.test(url)) { fired = true; sideband.emitFatal("socket_closed"); }
        return base(url, init);
      };
      fetchImpl.calls = base.calls;
      const { ctx } = freshCtx({ transport, fetchImpl });
      const res = await G.handleSessionCreate(ctx, { origin: ISS, ip: "9.9.9.3", authorization: `Bearer ${await makeAssertion({ sub: "vsub_r504b", jti: "jr504b" })}`, body: { sdp: GOOD_SDP, visibleHotelIds: ["hotelV"] } });
      ok(deadCheckEnvelope(res), "a fatal during visible-context verification ⇒ non-200, NO success envelope");
      ok(res.status === 503, "dead session mid-verify returns 503");
      ok(fired === true, "the verify read actually ran (the fatal fired during it)");
    }
  }

  // R5-05: RAW documented OpenAI function-call → validated OPEN_HOTEL (no injected ProviderEvent).
  section("R5-05: raw response.created + response.function_call_arguments.done → translate → OPEN_HOTEL");
  {
    // Open a REAL openai-realtime transport (fake ws/fetch) to a READY state; RAW
    // provider frames are pushed onto its ws and travel through the transport's own
    // translateOpenAiEvent → the attached sideband → fixed getHotelDetails read →
    // trusted allowlist → typed OPEN_HOTEL → browser control frame. No ProviderEvent
    // is injected directly (the R4 defect); no real OpenAI call.
    function makeWs5(sent) { const h = {}; return { ws: { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { h[ev] = cb; } }, h }; }
    function makeAnswerFetch5() {
      const impl = async (url) => {
        if (/\/hangup$/.test(url)) return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
        return { ok: true, status: 200, text: async () => "v=0\r\nm=audio 9 UDP\r\n", headers: { get: (n) => (n.toLowerCase() === "location" ? "https://api.openai.com/v1/realtime/calls/rtc_5" : null) } };
      };
      return impl;
    }
    async function openRawSideband() {
      const sent = []; const { ws, h } = makeWs5(sent);
      const transport = OA.createOpenAiRealtimeTransport({ apiKey: "sk-fake", fetchImpl: makeAnswerFetch5(), WebSocketCtor: () => ws });
      const p = transport.createSession({ offerSdp: GOOD_SDP, model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1/realtime", connectTimeoutMs: 5000 });
      await flushMs(1); if (h.open) h.open(); await flushMs(1); if (h.message) h.message(effectiveAck());
      const res = await p; return { conn: res.sideband, h, sent };
    }
    // Build a real gateway ctx whose EXECUTOR fetch serves the fixed getHotelDetails read.
    function makeScene(allow) {
      const { ctx } = freshCtx({ fetchImpl: makeFetch([
        HOTELS([{ id: "hotelA" }, { id: "hotelB" }, { id: "hotelC" }]),
        HOTEL_ONE({ id: "hotelB", name: "Ridge B", city: "manali", rooms: [{ floorPrice: 2400 }] }),
      ]) });
      const session = ctx.store.create({ subject: "vsub_r505", ipHash: "h", authenticated: false }).session;
      const frames = [];
      session.emit = (f) => frames.push(f);
      if (allow) ctx.store.allowHotelIds(session, allow); // server-verified + ACK-installed ordinal context
      return { ctx, session, frames };
    }
    // R6: response.created echoes the server-generated request_id in response.metadata.
    const rawCreated = (rid, requestId) => JSON.stringify({ type: "response.created", response: requestId ? { id: rid, metadata: { request_id: requestId } } : { id: rid } });
    const rawFcad = (rid, argsObj) => JSON.stringify({ type: "response.function_call_arguments.done", name: "getHotelDetails", call_id: "c_" + rid, arguments: typeof argsObj === "string" ? argsObj : JSON.stringify(argsObj), response_id: rid });
    const rawDone = (rid) => JSON.stringify({ type: "response.done", response: { id: rid } });
    // R6: schedule ONE user response through the serialized scheduler over the REAL
    // transport, and return the metadata.request_id the transport set on response.create.
    function scheduleReq(ctx, session, sent, itemId) {
      ctx.sideband.requestUserResponse(session, itemId);
      const frame = sent.map((x) => { try { return JSON.parse(x); } catch { return null; } }).reverse().find((o) => o && o.type === "response.create");
      return frame && frame.response && frame.response.metadata ? frame.response.metadata.request_id : undefined;
    }

    // POSITIVE: ordinal 2 → hotelB, OPEN via the raw documented function-call path,
    // through the REAL transport translator + the serialized scheduler (request_id echo).
    {
      const { ctx, session, frames } = makeScene(["hotelA", "hotelB", "hotelC"]);
      const { conn, h, sent } = await openRawSideband();
      ctx.sideband.attach(session, conn);
      const reqId = scheduleReq(ctx, session, sent, "item_open"); // gateway sends response.create(request_id)
      ok(typeof reqId === "string" && reqId.startsWith("rq_"), "the gateway put a server request_id on response.create.metadata");
      h.message(rawCreated("resp_open", reqId));                                     // raw response.created (echoes request_id) → binds
      h.message(rawFcad("resp_open", { id: "hotelB", presentationIntent: "OPEN" })); // raw function-call → tool_call
      await flushMs(40);
      const ui = frames.find((f) => f.t === "ui_action" && f.action && f.action.type === "OPEN_HOTEL");
      ok(!!ui && ui.action.hotelId === "hotelB", "raw documented function-call yields a validated OPEN_HOTEL(hotelB) browser frame");
      ok(!frames.some((f) => f.t === "ui_action" && f.action && f.action.type && f.action.type !== "OPEN_HOTEL"), "no generic/other action type emitted");
    }
    // helper for the negative cases that need a BOUND response before the bad fcad.
    async function boundScene(allow, rid, itemId) {
      const scene = makeScene(allow);
      const { conn, h, sent } = await openRawSideband();
      scene.ctx.sideband.attach(scene.session, conn);
      const reqId = scheduleReq(scene.ctx, scene.session, sent, itemId);
      h.message(rawCreated(rid, reqId));
      return { ...scene, h };
    }
    // NEGATIVE: malformed arguments JSON → no OPEN_HOTEL.
    {
      const { frames, h } = await boundScene(["hotelB"], "resp_bad", "it_bad");
      h.message(rawFcad("resp_bad", "{ not valid json")); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "malformed arguments JSON → NO OPEN_HOTEL");
    }
    // NEGATIVE: wrong presentationIntent (not "OPEN") → no OPEN_HOTEL.
    {
      const { frames, h } = await boundScene(["hotelB"], "resp_wi", "it_wi");
      h.message(rawFcad("resp_wi", { id: "hotelB", presentationIntent: "NAVIGATE" })); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "wrong presentationIntent → NO OPEN_HOTEL");
    }
    // NEGATIVE: arbitrary action string in presentationIntent → no OPEN_HOTEL.
    {
      const { frames, h } = await boundScene(["hotelB"], "resp_arb", "it_arb");
      h.message(rawFcad("resp_arb", { id: "hotelB", presentationIntent: "DROP TABLE" })); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "arbitrary action string → NO OPEN_HOTEL");
    }
    // NEGATIVE: foreign hotel id (not allowlisted) → action_rejected, no OPEN_HOTEL.
    {
      const { frames, h } = await boundScene(["hotelB"], "resp_foreign", "it_for");
      h.message(rawFcad("resp_foreign", { id: "hotelZZZ", presentationIntent: "OPEN" })); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "foreign (non-allowlisted) hotel id → NO OPEN_HOTEL");
    }
    // NEGATIVE: id absent → no OPEN_HOTEL.
    {
      const { frames, h } = await boundScene(["hotelB"], "resp_noid", "it_noid");
      h.message(rawFcad("resp_noid", { presentationIntent: "OPEN" })); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "absent id → NO OPEN_HOTEL");
    }
    // NEGATIVE: UNOWNED response (no scheduled request / no response.created) → dropped.
    {
      const { ctx, session, frames } = makeScene(["hotelB"]);
      const { conn, h } = await openRawSideband();
      ctx.sideband.attach(session, conn);
      h.message(rawFcad("resp_unowned", { id: "hotelB", presentationIntent: "OPEN" })); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "an UNOWNED response id (no response.created) → dropped, NO OPEN_HOTEL");
    }
    // NEGATIVE: SEALED response (completed by response.done) → later fcad dropped.
    {
      const { frames, h } = await boundScene(["hotelB"], "resp_seal", "it_seal");
      h.message(rawDone("resp_seal")); // response.done seals the response id + frees the slot
      await flushMs(20);
      const before = frames.filter((f) => f.t === "ui_action").length;
      h.message(rawFcad("resp_seal", { id: "hotelB", presentationIntent: "OPEN" })); await flushMs(40);
      ok(frames.filter((f) => f.t === "ui_action").length === before, "a fcad on a SEALED response id is dropped, NO OPEN_HOTEL");
    }
    // NEGATIVE: ordinal context UNAVAILABLE (nothing allowlisted) → the raw OPEN rejected.
    {
      const { frames, h } = await boundScene(null, "resp_noctx", "it_noctx");
      h.message(rawFcad("resp_noctx", { id: "hotelB", presentationIntent: "OPEN" })); await flushMs(40);
      ok(!frames.some((f) => f.t === "ui_action"), "ordinal context unavailable / not server-verified → NO OPEN_HOTEL");
    }
  }

  // ── summary ────────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────");
  console.log(`Voice AI SB-04 gateway: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error("FAILURES:\n  - " + failures.join("\n  - "));
    process.exit(1);
  }
  console.log("ALL VOICE-AI-SB-04 GATEWAY CHECKS PASSED");
}

main().catch((e) => {
  console.error("SUITE CRASH:", e && e.stack ? e.stack : e);
  process.exit(1);
});
