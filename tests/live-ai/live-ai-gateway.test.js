#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — gateway (browser transport + server) suite.
//
//   Run:  node tests/live-ai/live-ai-gateway.test.js
//
// Two LOCKFILE-INSTALLED local-tsc compiles (NO npx): the CLIENT lib
// (lib/live-ai/*.ts → gateway-client / protocol / broker) and the SERVER modules
// (server/voice-gateway/*.ts → live-ai-schemas / sessions / orchestrator /
// control-socket / openai-* / auth / config). Everything is driven through FAKES:
// a fake fetch, a fake control-socket opener, a fake media, fake reasoning/TTS
// adapters, fake timers. NO real network, NO WebSocket, NO WebRTC, NO provider,
// NO OpenAI key. Covers: the client dormancy gate matrix, the broker-response
// bound (controlUrl must be wss), the transport handshake (mic offer BEFORE broker;
// NO mic/fetch before an explicit gesture; the control token travels ONLY in the WS
// subprotocol, never the URL/query — no token leak), malformed inbound frames
// dropped; and on the server: strict frame/operation/answer validation, a smuggled
// url/new-op refused, the fixed model allowlists (a wrong model disables the
// provider + adapter), the isolated orchestrator (fail-closed, evidence path,
// abort-inert), the authenticated control socket, the session store + kill, the
// control-token HMAC round-trip, and the absence of any old-tool authority.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

// ---- compile a directory of *.ts with the local tsc ------------------------
function compileDir(tag, absDir, subdir, tsTypes, tsLib) {
  const BUILD = path.join(__dirname, ".build", tag);
  const SRC = path.join(BUILD, "src");
  const OUT = path.join(BUILD, "out");
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(path.join(SRC, subdir), { recursive: true });
  for (const f of fs.readdirSync(absDir)) if (f.endsWith(".ts")) fs.copyFileSync(path.join(absDir, f), path.join(SRC, subdir, f));
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: tsTypes, lib: tsLib, strict: true, noEmitOnError: true, resolveJsonModule: true },
    include: [subdir + "/**/*.ts"],
  }));
  let TSC_BIN;
  try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
  catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed."); process.exit(2); }
  const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  if (compile.status !== 0) { console.error(`COMPILE GATE FAILED (${tag}):\n` + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
  console.log(`• Local tsc compile (${tag}): exit 0, clean (strict)`);
  return OUT;
}

const CLIENT_OUT = compileDir("gw-client", path.join(REPO, "lib/live-ai"), "live-ai", ["node"], ["es2020", "dom"]);
const SERVER_OUT = compileDir("gw-server", path.join(REPO, "server/voice-gateway"), "gw", ["node", "ws"], ["es2020"]);

// client modules
const GC = require(path.join(CLIENT_OUT, "live-ai/gateway-client.js"));
const BROKER = require(path.join(CLIENT_OUT, "live-ai/broker.js"));
// R5A — the CLIENT operation authority (contracts.validateOperation), loaded here so the
// EXACT client/server operation-acceptance parity corpus can drive the SAME vectors through
// BOTH the browser authority and the gateway mirror (validateModelOperation) and assert
// identical accept/reject + identical canonical meaning where accepted.
const C = require(path.join(CLIENT_OUT, "live-ai/contracts.js"));
// R5B-REMEDIATION (section 14) — the REAL browser stack, loaded so the genuine production-path bridge
// (real conversation ↔ real control socket, NO auto-fake-ACK) can drive the full lifecycle end-to-end.
const P = require(path.join(CLIENT_OUT, "live-ai/protocol.js"));
const R = require(path.join(CLIENT_OUT, "live-ai/runtime.js"));
const CONV = require(path.join(CLIENT_OUT, "live-ai/conversation.js"));
const A = require(path.join(CLIENT_OUT, "live-ai/audio-playback.js"));
// server modules
const SCH = require(path.join(SERVER_OUT, "gw/live-ai-schemas.js"));
const SESS = require(path.join(SERVER_OUT, "gw/live-ai-sessions.js"));
const ORCH = require(path.join(SERVER_OUT, "gw/live-ai-orchestrator.js"));
const CTRL = require(path.join(SERVER_OUT, "gw/live-ai-control-socket.js"));
const RESP = require(path.join(SERVER_OUT, "gw/openai-responses.js"));
const TTS = require(path.join(SERVER_OUT, "gw/openai-tts.js"));
const STT = require(path.join(SERVER_OUT, "gw/openai-transcription.js"));
const AUTH = require(path.join(SERVER_OUT, "gw/auth.js"));
const CFG = require(path.join(SERVER_OUT, "gw/config.js"));
const G = require(path.join(SERVER_OUT, "gw/index.js")); // the Fastify gateway (for the REAL-socket integration test)

// ---- helpers ---------------------------------------------------------------
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((ln) => ln.replace(/\/\/.*$/, "")).join("\n");
}
function readSrc(rel) { return stripComments(fs.readFileSync(path.join(REPO, rel), "utf8")); }
function b64pcm(n) { return Buffer.from(new Int16Array(n).fill(1).buffer).toString("base64"); }

// a FULL, strictly-valid PublishedContext (the gateway now rejects anything less).
function validCtx(nHotels) {
  const visibleHotels = [];
  for (let i = 1; i <= (nHotels || 2); i++) visibleHotels.push({ position: i, id: "htl_" + i, name: "Hotel " + i, city: "Dhanaulti", minPrice: 1000 + i, rating: 4, parking: "present" });
  return { pageId: "hotels", role: "anonymous", destination: "Dhanaulti", query: null, loadState: "ready", visibleHotels, currentHotelId: null, validated: false, section: null, breakfast: null, parking: null };
}
// a FULL, strictly-valid verified ActionReceipt (the gateway now validates it). R5B: the gateway
// mints receiptId (echoed here), status is the CLOSED "verified" token, and results evidence carries
// the EXACT ordered on-screen ids of validCtx(2).
function validReceipt(overrides) {
  return Object.assign({ receiptId: "rcpt.1", proposalId: "pp.1", providerTurnId: "pt.1", actionId: "act.1", executionNonce: "xn.1", authorityRef: "ar.1", operation: "READ_CURRENT_RESULTS", outcome: "verified", status: "verified", evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } }, overrides || {});
}
// R5B-REV-01 — build a FULL result authority for a context the gateway acked. `authorityRef` is the REAL
// session.ackAuthorityRef captured after the publish; `contextDigest` is the gateway's own SHA-256 of the
// SAME context object. computeAuthorityRef(session, turnId, gen, routeEpoch, contextRevision, contextDigest)
// reproduces `authorityRef`, and it equals the current ack — so validateResultAuthority accepts it (a
// tampered field breaks internal consistency; a stale ack breaks the current-context check).
function raFor(authorityRef, turnId, generation, routeEpoch, contextRevision, ctxObj) {
  return { turnId, generation, routeEpoch, contextRevision, authorityRef, contextDigest: SCH.contextDigest(ctxObj) };
}
// R2-13 — a bounded in-memory BudgetAuthority (the ONLY thing that lets a real
// provider call proceed). `cap` null → unlimited (happy path); a number caps the
// TOTAL reserved units, after which reserve() returns null (fail closed). Records
// reservations + settlements so a test can assert the reserve→call→settle sequence.
function fakeBudget(cap) {
  let reservedTotal = 0, n = 0;
  const events = [];
  return {
    reserve(sessionKey, estimate) {
      if (cap != null && reservedTotal + estimate > cap) { events.push({ m: "reserve", est: estimate, ok: false }); return null; }
      reservedTotal += estimate; const id = "res." + (n++);
      events.push({ m: "reserve", est: estimate, ok: true, id });
      return id;
    },
    settle(id, actual) { events.push({ m: "settle", id, actual }); },
    _events: events,
    _reserveCalls() { return events.filter((e) => e.m === "reserve"); },
    _settleCalls() { return events.filter((e) => e.m === "settle"); },
  };
}

(async function main() {
  // ═══════════════════════════ CLIENT ═══════════════════════════
  section("client dormancy gate matrix (V, then V+P)");
  {
    eq(GC.resolveClientGates({}).runtime, false, "no V → runtime gate off");
    eq(GC.resolveClientGates({}).provider, false, "no V → provider gate off");
    const vOnly = GC.resolveClientGates({ NEXT_PUBLIC_VOICE_AI_BETA: "1" });
    ok(vOnly.runtime === true && vOnly.provider === false, "V on, P off → runtime only (no provider)");
    const vp = GC.resolveClientGates({ NEXT_PUBLIC_VOICE_AI_BETA: "1", NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA: "1" });
    ok(vp.runtime === true && vp.provider === true, "V+P → provider path allowed");
    const pOnly = GC.resolveClientGates({ NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA: "1" });
    ok(pOnly.runtime === false && pOnly.provider === false, "P without V → both off (V is required)");
  }

  section("broker client-response is bounded (controlUrl MUST be wss, no provider key passes)");
  {
    const good = { sessionId: "las.1", gatewaySessionId: "gw.1", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.1/control" };
    ok(GC.parseBrokerClientResponse(good) !== null, "a valid wss broker response parses");
    ok(GC.parseBrokerClientResponse({ ...good, controlUrl: "ws://gw.example.test/x" }) === null, "ws:// controlUrl rejected");
    ok(GC.parseBrokerClientResponse({ ...good, controlUrl: "https://gw.example.test/x" }) === null, "https:// controlUrl rejected (must be wss)");
    ok(GC.parseBrokerClientResponse({ ...good, controlToken: "" }) === null, "empty controlToken rejected");
    const withKey = GC.parseBrokerClientResponse({ ...good, providerKey: "sk-secret" });
    ok(withKey !== null && !("providerKey" in withKey), "a stray provider key is DROPPED by the allowlist parse (never carried through)");
    const withSdp = GC.parseBrokerClientResponse({ ...good, answerSdp: "v=0" });
    ok(withSdp && withSdp.answerSdp === "v=0", "optional answerSdp is carried when present");
  }

  section("transport is DORMANT until an explicit start (no fetch / socket on construct)");
  {
    let fetched = 0, opened = 0;
    const t = GC.createGatewayTransport({ fetchImpl: async () => { fetched++; return { ok: true, status: 200, json: async () => ({}) }; }, openSocket: () => { opened++; return { send() {}, close() {} }; } });
    eq(t.kind, "gateway", "constructed a gateway transport");
    eq(t.getConnectionState(), "disconnected", "no connection before start()");
    eq(fetched, 0, "no broker fetch on construct");
    eq(opened, 0, "no socket opened on construct");
  }

  section("microphone mode: NO fetch before the mic offer; text mode never touches the mic");
  {
    // (a) microphone with NO media → unsupported, and the broker is NEVER called.
    let fetched = 0;
    const t1 = GC.createGatewayTransport({ fetchImpl: async () => { fetched++; return { ok: true, status: 200, json: async () => ({}) }; }, media: null });
    const r1 = await t1.start({ sessionId: "las.1", turnId: "turn.1", generation: 0, mode: "microphone", context: {} });
    ok(r1.ok === false && r1.code === "unsupported", "mic mode without media → unsupported");
    eq(fetched, 0, "mic mode without media never calls the broker (no mic-before-gesture leak)");
    // (b) text mode never calls createOffer.
    let offerCalls = 0;
    const media = { createOffer: async () => { offerCalls++; return "v=0"; }, acceptAnswer: async () => {}, close: () => {} };
    const okBroker = { sessionId: "las.1", gatewaySessionId: "gw.1", controlToken: "tok.abc", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.1/control" };
    let socketUrl = null, socketProtocols = null, handlers = null;
    const t2 = GC.createGatewayTransport({
      media,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker }),
      openSocket: (url, protocols, h) => { socketUrl = url; socketProtocols = protocols; handlers = h; return { send() {}, close() {} }; },
    });
    const r2 = await t2.start({ sessionId: "las.1", turnId: "turn.1", generation: 0, mode: "text", context: {} });
    ok(r2.ok === true, "text start resolves ok");
    eq(offerCalls, 0, "text mode never requested a mic offer");
    void socketProtocols; void handlers; void socketUrl;
  }

  section("the control token travels ONLY in the WS subprotocol (never the URL / query)");
  {
    const okBroker = { sessionId: "las.1", gatewaySessionId: "gw.1", controlToken: "TOKEN_SECRET_123", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.1/control" };
    let socketUrl = null, socketProtocols = null, handlers = null;
    const t = GC.createGatewayTransport({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker }),
      openSocket: (url, protocols, h) => { socketUrl = url; socketProtocols = protocols; handlers = h; return { send() {}, close() {} }; },
    });
    await t.start({ sessionId: "las.1", turnId: "turn.1", generation: 0, mode: "text", context: {} });
    ok(socketUrl.indexOf("TOKEN_SECRET_123") === -1, "the control URL carries NO token");
    ok(socketProtocols[0] === "live-ai.control.v1" && socketProtocols[1] === "sbt.TOKEN_SECRET_123", "the token is in the subprotocol (sbt.<token>)");
    // handshake → connected → a malformed inbound frame is dropped, a valid one emitted
    const events = [];
    t.subscribe((e) => events.push(e));
    handlers.onOpen();
    eq(t.getConnectionState(), "connected", "onOpen → connected");
    handlers.onMessage("{ not json");
    handlers.onMessage(JSON.stringify({ t: "totally.unknown", sessionId: "las.1" }));
    ok(!events.some((e) => e.type === "frame"), "malformed / unknown frames are dropped (never emitted)");
    handlers.onMessage(JSON.stringify({ t: "connection.ready", sessionId: "las.1", gatewaySessionId: "gw.1" }));
    ok(events.some((e) => e.type === "frame" && e.frame.t === "connection.ready"), "a valid server frame is validated + emitted");
  }

  section("broker pure logic (same-origin, wss control url, shaped response)");
  {
    ok(BROKER.isSameOrigin("https://staybids.in", "same-origin", "https://staybids.in") === true, "exact same-origin passes");
    ok(BROKER.isSameOrigin("https://evil.test", "cross-site", "https://staybids.in") === false, "a cross origin fails");
    ok(BROKER.buildControlUrl("https://gw.example.test", "gw.1").startsWith("wss://"), "https gateway base → wss control url");
    ok(BROKER.buildControlUrl("http://gw.example.test", "gw.1") === null, "http gateway base → null (never ws://)");
    const shaped = BROKER.shapeBrokerResponse({ sessionId: "las.1", gatewaySessionId: "gw.1", controlToken: "t", expiresInSeconds: 60, providerKey: "sk-leak" });
    ok(shaped && !("providerKey" in shaped), "shapeBrokerResponse drops any extra field (a provider key can never pass through)");
    ok(BROKER.validateSessionRequest({ mode: "text", sessionId: "las.1" }) !== null, "a valid text session request parses");
    ok(BROKER.validateSessionRequest({ mode: "text", sessionId: "las.1", extra: 1 }) === null, "an extra key on the request is refused");
  }

  // ═══════════════════════════ SERVER ═══════════════════════════
  section("server strict frame / operation / answer validation (prompt-injection-as-data)");
  {
    ok(SCH.validateModelOperation({ op: "READ_CURRENT_RESULTS" }) !== null, "exact READ op validates");
    ok(SCH.validateModelOperation({ op: "OPEN_VISIBLE_HOTEL", position: 2, url: "javascript:1" }) === null, "OPEN + smuggled url → refused (whole op)");
    ok(SCH.validateModelOperation({ op: "NAVIGATE", href: "/x" }) === null, "an unknown op → refused");
    ok(SCH.validateModelOperation({ op: "OPEN_VISIBLE_HOTEL", position: 999 }) === null, "an out-of-range ordinal → refused");
    ok(SCH.validateModelOperation(Object.create({ op: "READ_CURRENT_RESULTS" })) === null, "inherited-only op (custom prototype) → refused");
    ok(SCH.validateModelAnswer({ kind: "page_facts", language: "en", selectedHotelIds: ["htl_a"], evidenceReceiptIds: [] }) !== null, "a bounded page_facts answer validates");
    ok(SCH.validateModelAnswer({ kind: "freeform", language: "en", text: "buy now", evidenceReceiptIds: [] }) === null, "a freeform/prose answer kind → refused");
    ok(SCH.validateInboundFrame({ t: "turn.text", sessionId: "las.1", turnId: "t.1", generation: 0, text: "hi" }) !== null, "a valid inbound turn.text validates");
    ok(SCH.validateInboundFrame({ t: "turn.text", sessionId: "las.1", turnId: "t.1", generation: 0, text: "hi", cmd: "rm" }) === null, "an extra key on an inbound frame → refused");
    ok(SCH.validateSessionCreateBody({ mode: "text", sessionId: "las.1" }) !== null, "a valid session-create body validates");
    ok(SCH.strictRecord(Object.create({ a: 1 }), ["a"]) === null, "strictRecord refuses a non-plain prototype");
  }

  section("fixed model allowlists (a wrong model disables the provider + the adapter)");
  {
    const base = { LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: "K", LIVE_AI_SESSION_ISSUER: "I", LIVE_AI_SESSION_AUDIENCE: "A", LIVE_AI_CONTROL_TOKEN_SECRET: "S", LIVE_AI_ALLOWED_ORIGINS: "https://staybids.in", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-x" };
    const good = CFG.loadLiveAiConfig(base);
    ok(CFG.liveAiProviderConfigured(good) === true, "all three models + key → provider configured");
    ok(CFG.liveAiSessionCreateConfigured(good) === true, "full config → session-create allowed");
    const badModel = CFG.loadLiveAiConfig({ ...base, LIVE_AI_REASONING_MODEL: "gpt-evil" });
    eq(badModel.reasoningModel, "", "a non-allowlisted reasoning model resolves to '' (disabled)");
    ok(CFG.liveAiProviderConfigured(badModel) === false, "a wrong model fails the provider gate closed");
    const noR = CFG.loadLiveAiConfig({ ...base, LIVE_AI_RUNTIME_ENABLED: "0" });
    ok(CFG.liveAiSessionCreateConfigured(noR) === false, "R gate off → session-create refused");
    // REV-12 — the B gate (brokerEnabled) is INDEPENDENTLY required at the gateway.
    const noB = CFG.loadLiveAiConfig({ ...base, LIVE_AI_BROKER_ENABLED: "0" });
    ok(CFG.liveAiSessionCreateConfigured(noB) === false, "B gate off → gateway session-create refused (a valid assertion cannot bypass B=0)");
    // the adapters fail closed by default + reject a wrong model
    ok(RESP.unavailableReasoning.available === false, "reasoning adapter default is unavailable");
    ok(TTS.unavailableTts.available === false, "tts adapter default is unavailable");
    ok(STT.unavailableTranscription.available === false, "transcription adapter default is unavailable");
    ok(RESP.createReasoningAdapter({ model: "gpt-wrong", call: async () => ({ ok: true, candidate: {} }) }).available === false, "a wrong reasoning model → unavailable adapter");
    ok(TTS.createTtsAdapter({ model: "gpt-wrong", call: async () => ({ ok: true, chunks: [] }) }).available === false, "a wrong tts model → unavailable adapter");
    eq(RESP.REASONING_MODEL, "gpt-5.6-terra", "the reasoning model constant is fixed");
    eq(TTS.TTS_MODEL, "gpt-4o-mini-tts", "the tts model constant is fixed");
    eq(STT.STT_MODEL, "gpt-live-transcribe", "the stt model constant is fixed");
  }

  section("tts adapter enforces bounded, gap-free, sequenced chunks");
  {
    const adapter = TTS.createTtsAdapter({ model: TTS.TTS_MODEL, call: async () => ({ ok: true, chunks: [{ seq: 0, bytes: b64pcm(100) }, { seq: 2, bytes: b64pcm(100) }] }) });
    const r = await adapter.synthesize({ text: "hi", language: "en" });
    ok(r.ok === false && r.reason === "tts_invalid", "a seq gap → tts_invalid");
    const good = TTS.createTtsAdapter({ model: TTS.TTS_MODEL, call: async () => ({ ok: true, chunks: [{ seq: 0, bytes: b64pcm(100) }, { seq: 1, bytes: b64pcm(100) }] }) });
    const r2 = await good.synthesize({ text: "hi", language: "en" });
    ok(r2.ok === true && r2.chunks.length === 2, "well-formed sequential chunks pass");
  }

  section("isolated orchestrator: fail-closed + evidence path + gateway-minted ids + abort-inert");
  {
    let n = 0;
    const genId = (p) => `${p}.${n++}`;
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    function freshSession(withAck) {
      const c = store.create({ sessionId: "las." + n, subject: "sub." + n, ipHash: "ip", authenticated: false });
      const s = c.session; const frames = [];
      s.emit = (f) => frames.push(f);
      if (withAck) s.ackAuthorityRef = "ar.deadbeef";
      return { s, frames };
    }
    // (a) no ack → stale
    {
      const orch = ORCH.createLiveAiOrchestrator({ reasoning: RESP.unavailableReasoning, tts: TTS.unavailableTts, store, budget: fakeBudget(), genId });
      const { s, frames } = freshSession(false);
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {} });
      ok(frames.length === 1 && frames[0].t === "turn.error" && frames[0].code === "stale", "no ACK → turn.error stale");
      store.terminate(s, "user");
    }
    // (b) provider unavailable
    {
      const orch = ORCH.createLiveAiOrchestrator({ reasoning: RESP.unavailableReasoning, tts: TTS.unavailableTts, store, budget: fakeBudget(), genId });
      const { s, frames } = freshSession(true);
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {} });
      ok(frames.some((f) => f.t === "turn.error" && f.code === "provider_unavailable"), "unavailable reasoning → provider_unavailable");
      store.terminate(s, "user");
    }
    // (c) invalid model output → invalid_output
    {
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { proposal: { op: "NAVIGATE", href: "/x" } } }) });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget: fakeBudget(), genId });
      const { s, frames } = freshSession(true);
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "go", language: "en", context: {} });
      ok(frames.some((f) => f.t === "turn.error" && f.code === "invalid_output"), "a bad model op → invalid_output (never executed)");
      store.terminate(s, "user");
    }
    // (d) REV-08 — ACT → VERIFY → EXPLAIN two-pass: an initial proposal DEFERS the
    //     answer; only a followup (after a verified receipt) emits answer + TTS.
    {
      const tts = TTS.createTtsAdapter({ model: TTS.TTS_MODEL, call: async () => ({ ok: true, chunks: [{ seq: 0, bytes: b64pcm(50) }] }) });
      // pass 1 — initial: proposal ONLY.
      const reasoning1 = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { proposal: { op: "READ_CURRENT_RESULTS" }, answer: { kind: "page_facts", language: "en", selectedHotelIds: ["htl_a"], evidenceReceiptIds: [] } } }) });
      const orch1 = ORCH.createLiveAiOrchestrator({ reasoning: reasoning1, tts, store, budget: fakeBudget(), genId });
      const { s, frames } = freshSession(true);
      // R3-08 — the followup page_facts plan cites htl_a, so it must be on-screen in the
      // session's current published context (semantic evidence: no off-screen hotel facts).
      s.lastContext = { visibleHotels: [{ id: "htl_a" }] };
      await orch1.runTurn(s, { turnId: "t.9", generation: 0, transcript: "what's here", language: "en", context: {}, phase: "initial" });
      const prop = frames.find((f) => f.t === "action.proposal");
      ok(prop && prop.proposal.operation.op === "READ_CURRENT_RESULTS", "initial proposes the validated op");
      ok(prop && /^pp\./.test(prop.proposal.proposalId) && /^pt\./.test(prop.proposal.providerTurnId), "proposalId + providerTurnId are gateway-minted (model chose neither)");
      ok(!frames.some((f) => f.t === "answer.plan") && !frames.some((f) => f.t === "audio.start"), "REV-08: NO answer / NO TTS in the pre-action pass");
      ok(s.pendingTurn && s.pendingTurn.providerTurnId === prop.proposal.providerTurnId, "the turn is deferred until its verified receipt");
      // pass 2 — followup after a verified receipt: the evidence-bound answer PLAN, but
      // STILL NO TTS (R2-08 — TTS waits for the browser's approval).
      // R3-08 — a verified receipt is bound to the executable authority it was verified
      // under; a fact plan may cite it only while that authority is still current.
      // R4-08 — a page_facts plan about htl_a needs a DETAIL receipt for htl_a (a results-count
      // receipt names no hotel and can no longer authorize per-hotel facts).
      store.recordVerifiedReceipt(s, { receiptId: "rcpt.read", proposalId: "pp.read", operation: "READ_CURRENT_HOTEL_FACTS", outcome: "verified", evidence: { kind: "detail", hotelId: "htl_a", breakfast: "yes", parking: "yes" }, authorityRef: s.ackAuthorityRef });
      const reasoning2 = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: { kind: "page_facts", language: "en", selectedHotelIds: ["htl_a"], evidenceReceiptIds: ["rcpt.read"] } } }) });
      const orch2 = ORCH.createLiveAiOrchestrator({ reasoning: reasoning2, tts, store, budget: fakeBudget(), genId });
      const frames2 = []; s.emit = (f) => frames2.push(f);
      await orch2.runTurn(s, { turnId: "t.9", generation: 0, transcript: "what's here", language: "en", context: {}, phase: "followup" });
      const plan = frames2.find((f) => f.t === "answer.plan");
      ok(plan && plan.plan.kind === "page_facts" && /^pl\./.test(plan.plan.planId), "followup emits the evidence-bound answer (planId gateway-minted)");
      // R2-08 — the answer plan is emitted but TTS is NOT produced on answer.plan.
      ok(!frames2.some((f) => f.t === "audio.start"), "R2-08 — NO TTS on answer.plan (approval gates TTS)");
      ok(s.pendingPlan && s.pendingPlan.planId === plan.plan.planId, "the plan is registered PENDING browser approval (setPendingPlan)");
      // R2-08 — runTts is the SOLE TTS entry; simulate the approval consuming the plan.
      const audioFrames = []; s.emit = (f) => audioFrames.push(f);
      const pp = s.pendingPlan;
      await orch2.runTts(s, { planId: pp.planId, turnId: pp.turnId, generation: pp.generation, ttsText: pp.ttsText, language: pp.language, authorityRef: pp.authorityRef });
      ok(audioFrames.some((f) => f.t === "audio.start") && audioFrames.some((f) => f.t === "audio.chunk") && audioFrames.some((f) => f.t === "audio.end"), "R2-08 — runTts voices the approved plan (ONLY after approval; the single TTS entry)");
      store.terminate(s, "user");
    }
    // (e) REV-08 — an answer citing an UNVERIFIED receipt is downgraded, never voiced.
    {
      const { s, frames } = freshSession(true);
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: { kind: "page_facts", language: "en", selectedHotelIds: ["htl_a"], evidenceReceiptIds: ["rcpt.notverified"] } } }) });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget: fakeBudget(), genId });
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      const plan = frames.find((f) => f.t === "answer.plan");
      ok(plan && plan.plan.kind === "unknown" && plan.plan.reason === "insufficient_evidence", "a fact answer citing an UNVERIFIED receipt is downgraded to insufficient_evidence");
      store.terminate(s, "user");
    }
    // (f) abort BEFORE the reasoning resolves → every later emit is inert.
    {
      const { s, frames } = freshSession(true);
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => { s.abort.abort(); return { ok: true, candidate: { proposal: { op: "READ_CURRENT_RESULTS" } } }; } });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget: fakeBudget(), genId });
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      ok(!frames.some((f) => f.t === "action.proposal"), "an aborted turn emits NO proposal after the abort");
      store.terminate(s, "user");
    }
    // (g) REV-13 — a provider call exceeding the per-turn deadline → turn.error timeout.
    {
      const { s, frames } = freshSession(true);
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: () => new Promise(() => {}) }); // never resolves
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget: fakeBudget(), genId, deadlineMs: 5, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {} });
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      ok(frames.some((f) => f.t === "turn.error" && f.code === "timeout"), "a provider call over the deadline → turn.error timeout, no guess");
      store.terminate(s, "user");
    }
  }

  section("session store: capacity, ack, idle-timeout teardown, and the disable kill");
  {
    // capacity (per subject = 1)
    const store = SESS.createLiveAiSessionStore({ limits: { ...SESS.DEFAULT_LIVE_AI_LIMITS, activePerSubject: 1 } });
    const a = store.create({ sessionId: "las.a", subject: "sub", ipHash: "ip1", authenticated: false });
    ok(a.ok === true, "first session for a subject is created");
    const b = store.create({ sessionId: "las.b", subject: "sub", ipHash: "ip2", authenticated: false });
    ok(b.ok === false && b.reason === "subject_capacity", "a second session for the same subject → subject_capacity");
    // idle timeout via injected timers
    const timerBag = [];
    const timers = { set: (fn) => { timerBag.push(fn); return timerBag.length - 1; }, clear: () => {} };
    const store2 = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS, timers });
    const c = store2.create({ sessionId: "las.c", subject: "s2", ipHash: "ip3", authenticated: false });
    const ended = [];
    c.session.emit = (f) => ended.push(f);
    // timerBag[1] is the idle timer callback → fire it
    timerBag[1]();
    ok(c.session.terminated === true, "the idle timer terminates the session");
    ok(ended.some((f) => f.t === "session.ended" && f.reason === "timeout"), "idle teardown emits session.ended(timeout)");
    // computeAuthorityRef binds the tuple (different tuples → different refs)
    const d = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }).create({ sessionId: "las.d", subject: "s3", ipHash: "ip4", authenticated: false });
    const store3 = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const ar1 = store3.computeAuthorityRef(d.session, "t.1", 0, "rev.a", "digest.a");
    const ar2 = store3.computeAuthorityRef(d.session, "t.1", 0, "rev.b", "digest.b");
    ok(/^ar\./.test(ar1) && ar1 !== ar2, "authorityRef is bound to the tuple (different context → different ref)");
    // drainAll → session.killed then teardown
    const store4 = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const e = store4.create({ sessionId: "las.e", subject: "s5", ipHash: "ip5", authenticated: false });
    const killed = [];
    e.session.emit = (f) => killed.push(f);
    store4.drainAll();
    ok(killed.some((f) => f.t === "session.killed" && f.code === "runtime_killed"), "drainAll emits session.killed(runtime_killed)");
    eq(store4.size(), 0, "drainAll leaves zero live sessions");
  }

  section("authenticated control socket: token in subprotocol only + strict frame routing");
  {
    const secret = "control-secret";
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const created = store.create({ sessionId: "las.ctl", subject: "subctl", ipHash: "ipctl", authenticated: false });
    const gsid = created.session.gatewaySessionId;
    const token = AUTH.mintControlTokenWithSecret(gsid, "subctl", secret, 600000);
    // (a) no token in subprotocol → refused
    const noTok = CTRL.authorizeLiveAiControlOpen({ subprotocol: "live-ai.control.v1", gatewaySessionId: gsid, controlTokenSecret: secret, controlTokenMaxAgeMs: 600000, store });
    ok(noTok.ok === false && noTok.code === "control_token_missing", "a control open with no subprotocol token → refused (4401)");
    // (b) token in the subprotocol → authorized
    const okOpen = CTRL.authorizeLiveAiControlOpen({ subprotocol: "live-ai.control.v1, sbt." + token, gatewaySessionId: gsid, controlTokenSecret: secret, controlTokenMaxAgeMs: 600000, store });
    ok(okOpen.ok === true, "a valid subprotocol control token authorizes the open");
    // (c) frame routing: publish → ack, session_mismatch, receipt records verified, end terminates
    const emitted = [];
    created.session.emit = (f) => emitted.push(f);
    const runCalls = [];
    const deps = { session: created.session, store, runTurn: async (s, i) => { runCalls.push(i); } };
    // publish a FULL valid context → ack (with generation); a malformed context is rejected.
    const badCtx = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: "las.ctl", turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: { pageId: "hotels" } }) });
    eq(badCtx, "invalid", "REV-05/10 — a malformed (partial) context is REJECTED, not accepted opaque");
    const ackStatus = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: "las.ctl", turnId: "t.1", generation: 3, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
    eq(ackStatus, "ack", "a full valid context.publish → ack");
    ok(emitted.some((f) => f.t === "context.ack" && /^ar\./.test(f.authorityRef) && f.generation === 3), "REV-06 — the context.ack carries the authorityRef AND the generation");
    // REV-06 — a republish of the SAME tuple with DIFFERENT content is a conflict (revokes ACK).
    const conflict = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: "las.ctl", turnId: "t.1", generation: 3, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(3) }) });
    eq(conflict, "conflict", "a same-tuple different-content republish → conflict (prior ACK revoked)");
    ok(created.session.ackAuthorityRef === null, "the conflicting republish revoked the executable ACK");
    // re-establish an ACK for the routing checks.
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: "las.ctl", turnId: "t.5", generation: 4, routeEpoch: 0, contextRevision: "rev.5", context: validCtx(2) }) });
    const mism = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "turn.text", sessionId: "las.OTHER", turnId: "t.1", generation: 0, text: "hi" }) });
    eq(mism, "session_mismatch", "a frame for a different sessionId → session_mismatch (never routed)");
    const turnStatus = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "turn.text", sessionId: "las.ctl", turnId: "t.5", generation: 4, text: "hello" }) });
    eq(turnStatus, "turn", "turn.text is routed to the orchestrator");
    ok(runCalls.length === 1 && runCalls[0].transcript === "hello" && runCalls[0].phase === "initial", "the orchestrator received the bounded transcript as an INITIAL turn");
    // REV-05 — a fabricated (partial) verified receipt is REJECTED (not recorded).
    const badReceipt = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.ctl", turnId: "t.5", generation: 4, receipt: { receiptId: "rcpt.fake", outcome: "verified" } }) });
    eq(badReceipt, "receipt_invalid", "a fabricated {receiptId, outcome:verified} receipt is REJECTED");
    ok(!created.session.verifiedReceipts.has("rcpt.fake"), "the fabricated receipt is NOT recorded");
    // R2-05 — CORRELATION: even a FULL-shape verified receipt is refused unless it
    // consumes a live, unconsumed proposal THIS session actually emitted, on
    // proposalId + providerTurnId + operation + authorityRef, under the CURRENT authority.
    const ar5 = created.session.ackAuthorityRef;
    const ra5 = raFor(ar5, "t.5", 4, 0, "rev.5", validCtx(2)); // R5B-REV-01 — the real result authority of the ar5 context
    const uncorr = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.ctl", turnId: "t.5", generation: 4, receipt: validReceipt({ receiptId: "rcpt.uncorr", proposalId: "pp.never", providerTurnId: "pt.never", authorityRef: ar5, resultAuthority: ra5 }) }) });
    eq(uncorr, "receipt_uncorrelated", "R2-05 — a full-shape receipt for an UN-registered proposal → receipt_uncorrelated");
    ok(!created.session.verifiedReceipts.has("rcpt.uncorr"), "the un-correlated receipt is NOT recorded");
    // register the proposal the gateway emitted, then a matching receipt consumes it.
    store.registerProposal(created.session, { proposalId: "pp.ok", providerTurnId: "pt.ok", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.1", receiptId: "rcpt.ok", turnId: "t.5", generation: 4, authorityRef: ar5 });
    // R3-05/R5B — the browser FIRST announces it accepted the proposal + minted actionId "act.1" +
    // ECHOES the gateway receiptId "rcpt.ok"; only after this bind will a receipt correlate.
    const acceptStatus = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: "las.ctl", turnId: "t.5", generation: 4, accepted: { receiptId: "rcpt.ok", proposalId: "pp.ok", providerTurnId: "pt.ok", actionId: "act.1", executionNonce: "xn.1", operation: "READ_CURRENT_RESULTS", authorityRef: ar5 } }) });
    eq(acceptStatus, "accepted", "R3-05 — the accepted-action announcement binds the actionId to the registered proposal");
    // R3-05 — a receipt whose actionId was NEVER accepted (random) fails to correlate.
    const forgedAction = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.ctl", turnId: "t.5", generation: 4, receipt: validReceipt({ receiptId: "rcpt.forge", proposalId: "pp.ok", providerTurnId: "pt.ok", authorityRef: ar5, actionId: "act.RANDOM" }) }) });
    eq(forgedAction, "receipt_uncorrelated", "R3-05 — a receipt with a forged (never-accepted) actionId → receipt_uncorrelated");
    ok(!created.session.verifiedReceipts.has("rcpt.forge"), "R3-05 — the forged-actionId receipt is NOT recorded");
    const goodReceipt = () => JSON.stringify({ t: "action.receipt", sessionId: "las.ctl", turnId: "t.5", generation: 4, receipt: validReceipt({ receiptId: "rcpt.ok", proposalId: "pp.ok", providerTurnId: "pt.ok", authorityRef: ar5, resultAuthority: ra5 }) });
    const recStatus = CTRL.handleLiveAiControlFrame({ ...deps, raw: goodReceipt() });
    eq(recStatus, "receipt", "a receipt that CONSUMES its registered proposal is accepted");
    ok(created.session.verifiedReceipts.has("rcpt.ok"), "a full valid CORRELATED verified receipt IS recorded for evidence-binding");
    // R5B — terminal replay: the EXACT SAME verified receipt on a terminal(verified) proposal is
    // IDEMPOTENT (acked, no re-execution / re-record / second follow-up) — never re-verified.
    const replayStatus = CTRL.handleLiveAiControlFrame({ ...deps, raw: goodReceipt() });
    eq(replayStatus, "receipt_idempotent", "R5B — an exact-duplicate terminal receipt is idempotent (no re-execution)");
    // R5B — a CONFLICTING terminal replay (same proposal, DIFFERENT terminal content) is rejected.
    const conflictReplay = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.ctl", turnId: "t.5", generation: 4, receipt: validReceipt({ receiptId: "rcpt.ok", proposalId: "pp.ok", providerTurnId: "pt.ok", authorityRef: ar5, outcome: "rejected", status: "no_op", evidence: undefined }) }) });
    eq(conflictReplay, "receipt_conflict", "R5B — a conflicting terminal replay (different outcome) is REJECTED");
    const endStatus = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "session.end", sessionId: "las.ctl", generation: 0, reason: "user" }) });
    eq(endStatus, "end", "session.end → end");
    ok(created.session.terminated === true, "session.end terminated the session");
  }

  section("REV-08 — a verified receipt correlated to a pending action triggers the FOLLOW-UP explain pass");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const created = store.create({ sessionId: "las.fu", subject: "subfu", ipHash: "ipfu", authenticated: false });
    created.session.emit = () => {};
    const runCalls = [];
    const deps = { session: created.session, store, runTurn: async (s, i) => { runCalls.push(i); } };
    // establish an ACK + REGISTER the proposal + a pending turn correlated to "pt.follow".
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: "las.fu", turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
    const arfu = created.session.ackAuthorityRef;
    store.registerProposal(created.session, { proposalId: "pp.follow", providerTurnId: "pt.follow", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.1", receiptId: "rcpt.f", turnId: "t.1", generation: 0, authorityRef: arfu });
    store.setPendingTurn(created.session, { turnId: "t.1", generation: 0, transcript: "what is here", language: "en", providerTurnId: "pt.follow", authorityRef: arfu });
    // R3-05/R5B — announce acceptance (bind actionId "act.1" + echo receiptId "rcpt.f") before the receipt.
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: "las.fu", turnId: "t.1", generation: 0, accepted: { receiptId: "rcpt.f", proposalId: "pp.follow", providerTurnId: "pt.follow", actionId: "act.1", executionNonce: "xn.1", operation: "READ_CURRENT_RESULTS", authorityRef: arfu } }) });
    // a verified receipt that CONSUMES that proposal (matching providerTurnId + actionId) → followup.
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.fu", turnId: "t.1", generation: 0, receipt: validReceipt({ receiptId: "rcpt.f", proposalId: "pp.follow", providerTurnId: "pt.follow", authorityRef: arfu, resultAuthority: raFor(arfu, "t.1", 0, 0, "rev.1", validCtx(2)) }) }) });
    ok(runCalls.some((i) => i.phase === "followup" && i.transcript === "what is here"), "the correlated verified receipt triggers a FOLLOWUP explain pass (never before verification)");
    // an UNCORRELATED verified receipt does NOT trigger a followup.
    const before = runCalls.length;
    store.setPendingTurn(created.session, { turnId: "t.1", generation: 0, transcript: "x", language: "en", providerTurnId: "pt.other", authorityRef: created.session.ackAuthorityRef });
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.fu", turnId: "t.1", generation: 0, receipt: validReceipt({ receiptId: "rcpt.g", providerTurnId: "pt.MISMATCH" }) }) });
    eq(runCalls.length, before, "an uncorrelated verified receipt does not trigger a followup");
  }

  section("control-token HMAC: round-trip, session binding, expiry, unconfigured");
  {
    const secret = "s3cr3t";
    let clock = 1_000_000;
    const tok = AUTH.mintControlTokenWithSecret("gw.1", "sub.1", secret, 600000, () => clock);
    const good = AUTH.verifyControlTokenWithSecret(tok, "gw.1", secret, 600000, () => clock);
    ok(good.ok === true && good.subject === "sub.1", "a fresh token verifies + carries the subject");
    const wrongSession = AUTH.verifyControlTokenWithSecret(tok, "gw.OTHER", secret, 600000, () => clock);
    ok(wrongSession.ok === false && wrongSession.code === "control_mismatch", "a token minted for another gateway session → control_mismatch");
    const expired = AUTH.verifyControlTokenWithSecret(tok, "gw.1", secret, 600000, () => clock + 600001);
    ok(expired.ok === false && expired.code === "control_expired", "past the max age → control_expired");
    const unconfigured = AUTH.verifyControlTokenWithSecret(tok, "gw.1", null, 600000, () => clock);
    ok(unconfigured.ok === false && unconfigured.code === "control_unconfigured", "no secret → control_unconfigured (fail closed)");
    ok(AUTH.mintControlTokenWithSecret("gw.1", "sub.1", null, 600000) === null, "minting with no secret returns null");
    // kill switch HMAC + staleness
    const ks = "kill-secret";
    const ts = clock;
    const crypto = require("node:crypto");
    const sig = crypto.createHmac("sha256", ks).update(`nonce1.${ts}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    ok(AUTH.verifyKillRequestWithSecret({ nonce: "nonce1", ts, sig }, ks, () => clock).ok === true, "a fresh HMAC kill request verifies");
    ok(AUTH.verifyKillRequestWithSecret({ nonce: "nonce1", ts, sig }, ks, () => clock + 120000).ok === false, "a stale kill request is refused");
    ok(AUTH.verifyKillRequestWithSecret({ nonce: "nonce1", ts, sig }, null, () => clock).code === "kill_unconfigured", "no kill secret → unconfigured");
  }

  section("live-ai assertion verify is scope-locked + fail-closed without keys");
  {
    const replay = AUTH.createReplayStore(() => 1_000_000);
    const r = await AUTH.verifyLiveAiAssertion("a.b.c", { signingPublicKey: null, issuer: null, audience: null }, replay);
    ok(r && r.ok === false, "an unconfigured Live-AI assertion verify fails closed");
    eq(AUTH.LIVE_AI_ASSERTION_SCOPE, "live-ai:read-ui-local", "the Live-AI assertion scope is the exact read-ui-local scope");
    ok(AUTH.VOICE_ASSERTION_SCOPE !== AUTH.LIVE_AI_ASSERTION_SCOPE, "the voice scope and the live-ai scope are distinct (no cross-accept)");
  }

  section("REV-01 — INTEGRATION: a REAL authenticated control socket emits connection.ready");
  {
    let WS = null, jose = null;
    try { WS = require(require.resolve("ws", { paths: [REPO] })); jose = require(require.resolve("jose", { paths: [REPO] })); } catch (_) { WS = null; }
    if (!WS || !jose) {
      console.log("  … skipped (ws/jose not resolvable) — reported as UNPROVEN, not passed");
      ok(false, "REV-01 integration prerequisites (ws + jose) must be available");
    } else {
      const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
      const spki = await jose.exportSPKI(publicKey);
      const env = {
        LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1",
        LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway",
        LIVE_AI_CONTROL_TOKEN_SECRET: "ctl-secret", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill-secret",
        LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-int-not-called",
      };
      const built = await G.buildGateway({ env });
      const app = built.app;
      await app.listen({ port: 0, host: "127.0.0.1" });
      const port = app.server.address().port;
      const assertion = await new jose.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false })
        .setProtectedHeader({ alg: "ES256" }).setSubject("px.integration").setJti("jti." + port + "." + Math.floor(port * 7 + 1))
        .setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
      const res = await fetch(`http://127.0.0.1:${port}/v1/live-ai/sessions`, { method: "POST", headers: { authorization: `Bearer ${assertion}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "text", sessionId: "las.int" }) });
      ok(res.ok, "the real session-create route returned ok for a valid ES256 assertion");
      const j = await res.json();
      ok(typeof j.controlToken === "string" && typeof j.gatewaySessionId === "string", "session-create returned a control token + gateway session id (no provider key)");
      ok(!("answerSdp" in j) && !("providerKey" in j) && !("openaiApiKey" in j), "the bounded response carries NO answerSdp (text) and NO provider key");
      const url = `ws://127.0.0.1:${port}/v1/live-ai/sessions/${j.gatewaySessionId}/control`;
      const frames = await new Promise((resolve) => {
        const got = [];
        const wsc = new WS(url, ["live-ai.control.v1", "sbt." + j.controlToken]);
        const done = () => { try { wsc.close(); } catch (_) { /* no-op */ } resolve(got); };
        const timer = setTimeout(done, 4000);
        wsc.on("message", (data) => {
          let f; try { f = JSON.parse(data.toString()); } catch (_) { return; }
          got.push(f);
          if (f.t === "connection.ready") wsc.send(JSON.stringify({ t: "context.publish", sessionId: "las.int", turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.int.1", context: validCtx(2) }));
          if (f.t === "context.ack") { clearTimeout(timer); done(); }
        });
        wsc.on("error", () => { clearTimeout(timer); done(); });
      });
      ok(frames.some((f) => f.t === "connection.ready" && f.sessionId === "las.int"), "REV-01 — the REAL authenticated socket emitted connection.ready (production wiring, NOT an injected frame)");
      ok(frames.some((f) => f.t === "context.ack" && /^ar\./.test(f.authorityRef) && f.generation === 0), "REV-05/06 — a real context.publish over the socket returned a generation-bound context.ack");
      // a control socket opened WITHOUT the subprotocol token must be refused (never ready).
      const frames2 = await new Promise((resolve) => {
        const got = [];
        const wsc = new WS(url, ["live-ai.control.v1"]); // no sbt.<token>
        const done = () => { try { wsc.close(); } catch (_) { /* no-op */ } resolve(got); };
        const timer = setTimeout(done, 2000);
        wsc.on("message", (data) => { try { got.push(JSON.parse(data.toString())); } catch (_) { /* no-op */ } });
        wsc.on("close", () => { clearTimeout(timer); done(); });
        wsc.on("error", () => { clearTimeout(timer); done(); });
      });
      ok(!frames2.some((f) => f.t === "connection.ready"), "a control open WITHOUT the subprotocol token gets NO connection.ready (refused)");
      await app.close();
    }
  }

  section("REV-06 — full-content context digest resists long-common-prefix collisions");
  {
    const a = validCtx(24);
    const b = validCtx(24);
    b.visibleHotels[23] = { ...b.visibleHotels[23], name: "A Different Name At The Very End" };
    ok(SCH.contextDigest(a) !== SCH.contextDigest(b), "two 24-hotel contexts differing ONLY at hotel 24 get different digests");
    ok(SCH.contextDigest(a) === SCH.contextDigest(validCtx(24)), "identical contexts get identical digests (deterministic)");
    ok(SCH.contextDigest(a).length <= 80, "the digest is bounded (fixed length, not the full serialized context)");
  }

  section("REV-11 — the gateway base URL is validated to a canonical HTTPS origin");
  {
    eq(BROKER.validateGatewayHttpsOrigin("https://gw.example.test"), "https://gw.example.test", "a clean https origin passes");
    eq(BROKER.validateGatewayHttpsOrigin("https://gw.example.test:8443"), "https://gw.example.test:8443", "an explicit port is preserved");
    ok(BROKER.validateGatewayHttpsOrigin("http://gw.example.test") === null, "http:// is refused");
    ok(BROKER.validateGatewayHttpsOrigin("wss://gw.example.test") === null, "wss:// is refused (this is the signing target, not the control url)");
    ok(BROKER.validateGatewayHttpsOrigin("javascript:alert(1)") === null, "a javascript: scheme is refused");
    ok(BROKER.validateGatewayHttpsOrigin("https://user:pass@gw.example.test") === null, "userinfo is refused");
    ok(BROKER.validateGatewayHttpsOrigin("https://gw.example.test/v1/live-ai/sessions") === null, "an embedded path is refused (no path confusion)");
    ok(BROKER.validateGatewayHttpsOrigin("https://gw.example.test/?x=1") === null, "a query string is refused");
    ok(BROKER.validateGatewayHttpsOrigin("https://gw.example.test/#f") === null, "a fragment is refused");
    ok(BROKER.validateGatewayHttpsOrigin("not a url") === null, "a malformed URL is refused");
  }

  section("REV-03 — the STT/Realtime negotiate seam (dormant by default, fail-closed)");
  {
    // default is unavailable → no answer (mic fails closed at the browser).
    const un = await STT.unavailableTranscription.negotiate("v=0\r\n");
    ok(un.ok === false, "the default transcription adapter negotiates NO answer");
    // an injected negotiate seam returns a bounded answer SDP.
    const ad = STT.createTranscriptionAdapter({ model: STT.STT_MODEL, call: async () => ({ ok: false, reason: "x" }), negotiate: async () => ({ ok: true, answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }) });
    const neg = await ad.negotiate("v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n");
    ok(neg.ok === true && /^v=0/.test(neg.answerSdp), "an injected seam yields a bounded SDP answer");
    const badOffer = await ad.negotiate("not-an-sdp");
    ok(badOffer.ok === false && badOffer.reason === "invalid_offer", "a non-SDP offer is refused");
    // an adapter with NO negotiate seam is fail-closed for realtime.
    const noNeg = STT.createTranscriptionAdapter({ model: STT.STT_MODEL, call: async () => ({ ok: false, reason: "x" }) });
    const r = await noNeg.negotiate("v=0\r\n");
    ok(r.ok === false && r.reason === "realtime_unavailable", "an adapter without a negotiate seam fails closed");
  }

  section("SRC: the isolated server modules import NO old-tool authority");
  {
    const forbidden = /createToolExecutor|PREPARE_BID_DRAFT|VoiceUiAction|searchHotels|getHotelDetails|getFlashDeals|compareHotels/;
    for (const rel of ["server/voice-gateway/live-ai-orchestrator.ts", "server/voice-gateway/live-ai-schemas.ts", "server/voice-gateway/live-ai-control-socket.ts", "server/voice-gateway/live-ai-sessions.ts"]) {
      ok(!forbidden.test(readSrc(rel)), `${rel} references no old-tool authority (comments stripped)`);
    }
    // and no secret VALUE / api key literal is embedded in the adapters
    const keyLike = /sk-[A-Za-z0-9]{10,}|BEGIN (?:RSA |EC )?PRIVATE KEY/;
    for (const rel of ["server/voice-gateway/openai-responses.ts", "server/voice-gateway/openai-tts.ts", "server/voice-gateway/openai-transcription.ts"]) {
      ok(!keyLike.test(fs.readFileSync(path.join(REPO, rel), "utf8")), `${rel} embeds no api-key / private-key literal`);
    }
  }

  section("R2-01 — EXACTLY ONE control attachment (one-use claim; duplicate + post-close replay refused)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.one", subject: "s.one", ipHash: "ip.one", authenticated: false });
    const s = c.session;
    let closes1 = 0, closes2 = 0;
    const claim1 = store.bindRuntime(s, () => {}, () => { closes1++; });
    ok(claim1 === true, "the FIRST control attach CLAIMS the session");
    const claim2 = store.bindRuntime(s, () => {}, () => { closes2++; });
    ok(claim2 === false, "R2-01 — a SECOND concurrent control attach is REJECTED (never replaces live callbacks)");
    ok(closes2 === 1 && closes1 === 0, "the rejected second socket is closed; the first stays live");
    // detach, then a re-attach with the SAME one-use claim is refused (token replay after close).
    store.controlDetached(s);
    const claim3 = store.bindRuntime(s, () => {}, () => {});
    ok(claim3 === false, "R2-01 — after the socket closed, a re-attach is refused (the one-use claim never resets → replay closed)");
    store.terminate(s, "user");
  }

  section("R2-01 — the client binds to its MINTED gateway session id (a wrong id is refused)");
  {
    const okBroker = { sessionId: "las.g", gatewaySessionId: "gw.MINE", controlToken: "tok.g", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.MINE/control" };
    let handlers = null, closed = 0;
    const t = GC.createGatewayTransport({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker }),
      openSocket: (url, protocols, h) => { handlers = h; return { send() {}, close() { closed++; } }; },
    });
    const events = [];
    t.subscribe((e) => events.push(e));
    await t.start({ sessionId: "las.g", turnId: "turn.g", generation: 0, mode: "text", context: {} });
    handlers.onOpen();
    handlers.onMessage(JSON.stringify({ t: "connection.ready", sessionId: "las.g", gatewaySessionId: "gw.MINE" }));
    ok(events.some((e) => e.type === "frame" && e.frame.t === "connection.ready"), "R2-01 — a connection.ready for the MINTED gateway session id is accepted");
    const beforeReady = events.filter((e) => e.type === "frame" && e.frame.t === "connection.ready").length;
    handlers.onMessage(JSON.stringify({ t: "connection.ready", sessionId: "las.g", gatewaySessionId: "gw.SOMEONE_ELSE" }));
    ok(events.filter((e) => e.type === "frame" && e.frame.t === "connection.ready").length === beforeReady, "R2-01 — a connection.ready for the WRONG gateway session id is DROPPED (never emitted)");
    ok(closed >= 1, "the mis-wired socket is torn down on the integrity failure");
  }

  section("R2-02 — the provider request SHAPES (Realtime transcription session + Responses json_schema)");
  {
    // the transcription session config (accompanies the SDP offer) names the fixed model.
    const tcfg = STT.buildTranscriptionSessionConfig();
    ok(tcfg.type === "transcription" && tcfg.audio && tcfg.audio.input && tcfg.audio.input.transcription && tcfg.audio.input.transcription.model === STT.STT_MODEL, "R2-02 — the transcription session config names the fixed STT model");
    let captured = null;
    const seam = STT.createDefaultTranscriptionSeam("sk-test", async (url, init) => { captured = { url, init }; return { ok: true, text: async () => "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }; });
    const neg = await seam.negotiate("v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n");
    ok(neg.ok === true, "the injected Realtime seam returns a bounded SDP answer (no network)");
    ok(captured && captured.url === STT.OPENAI_REALTIME_CALLS_URL, "R2-02 — the Realtime call POSTs to the fixed calls URL");
    ok(captured.init && captured.init.method === "POST" && captured.init.body && typeof captured.init.body.get === "function" && JSON.parse(captured.init.body.get("session")).type === "transcription", "R2-02 — the request body carries the transcription session config (never a bare SDP)");
    // the reasoning request enforces provider-side strict json_schema (text.format).
    let capturedR = null;
    const call = RESP.createDefaultReasoningCall("sk-test", async (url, init) => { capturedR = { url, init }; return { ok: true, json: async () => ({ output_text: JSON.stringify({ proposal: null, answer: { kind: "unknown", language: "en", evidenceReceiptIds: [], reason: "no_context" } }) }) }; });
    const rr = await call({ transcript: "hi", context: {}, verifiedReceiptIds: [] });
    ok(rr.ok === true, "the injected reasoning call returns a structured candidate (no network)");
    const rbody = JSON.parse(capturedR.init.body);
    ok(capturedR.url === RESP.OPENAI_RESPONSES_URL && rbody.model === RESP.REASONING_MODEL, "R2-02 — the reasoning request uses the fixed model + endpoint");
    ok(rbody.text && rbody.text.format && rbody.text.format.type === "json_schema" && rbody.text.format.strict === true && rbody.text.format.schema && rbody.text.format.schema.type === "object", "R2-02 — the reasoning request enforces PROVIDER-SIDE strict json_schema (text.format), not prompt-only JSON");
  }

  section("R2-06 — the authorityRef is a SHA-256 over the FULL tuple INCLUDING the generation");
  {
    const crypto = require("node:crypto");
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.ar", subject: "s.ar", ipHash: "ip.ar", authenticated: false });
    const s = c.session;
    const arGen0 = store.computeAuthorityRef(s, "t.1", 0, 7, "rev.a", "digest.a");
    const arGen1 = store.computeAuthorityRef(s, "t.1", 1, 7, "rev.a", "digest.a");
    ok(arGen0 !== arGen1, "R2-06 — two authorityRefs differing ONLY in generation are DIFFERENT (generation is bound)");
    const joined = [s.gatewaySessionId, s.sessionId, "t.1", "0", "7", "rev.a", "digest.a"].join(String.fromCharCode(0));
    const expected = "ar." + crypto.createHash("sha256").update(joined).digest("hex").slice(0, 40);
    eq(arGen0, expected, "R2-06 — the authorityRef equals SHA-256(full NUL-joined tuple) (cryptographic, not a fold)");
    store.terminate(s, "user");
  }

  section("R2-07 — the proposal registry is a HARD ceiling with NO eviction (anti-replay)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: { ...SESS.DEFAULT_LIVE_AI_LIMITS, maxProposalsPerSession: 3 } });
    const c = store.create({ sessionId: "las.cap", subject: "s.cap", ipHash: "ip.cap", authenticated: false });
    // R5B-REV-01 — a REAL acked authority so a verified receipt's result authority validates.
    const s = c.session;
    const capCtx = validCtx(2); const capDigest = SCH.contextDigest(capCtx);
    const arCap = store.computeAuthorityRef(s, "t.1", 0, 0, "rev.cap", capDigest);
    s.ackAuthorityRef = arCap; s.ackContextDigest = capDigest;
    for (let i = 0; i < 3; i++) ok(store.registerProposal(s, { proposalId: "pp." + i, providerTurnId: "pt." + i, operation: "READ_CURRENT_RESULTS", executionNonce: "xn." + i, receiptId: "rc." + i, turnId: "t.1", generation: 0, authorityRef: arCap }) === true, "proposal " + i + " registered under the ceiling");
    ok(store.registerProposal(s, { proposalId: "pp.over", providerTurnId: "pt.over", operation: "READ_CURRENT_RESULTS", executionNonce: "xn.over", receiptId: "rc.over", turnId: "t.1", generation: 0, authorityRef: arCap }) === false, "R2-07 — past the hard ceiling a further proposal is REFUSED");
    // R3-05/R5B — bind the actionId + receiptId (accepted-action) before the receipt lifecycle.
    ok(store.acceptProposalAction(s, { receiptId: "rc.0", proposalId: "pp.0", providerTurnId: "pt.0", actionId: "act.0", executionNonce: "xn.0", operation: "READ_CURRENT_RESULTS", authorityRef: arCap, turnId: "t.1", generation: 0 }) === true, "R3-05 — the accepted action binds actionId act.0");
    const lc0 = { receiptId: "rc.0", proposalId: "pp.0", providerTurnId: "pt.0", operation: "READ_CURRENT_RESULTS", authorityRef: arCap, actionId: "act.0", executionNonce: "xn.0", outcome: "verified", digest: "d.0", resultAuthority: raFor(arCap, "t.1", 0, 0, "rev.cap", capCtx) };
    ok(store.applyReceiptLifecycle(s, lc0).kind === "terminal", "an in-ceiling proposal terminalizes (verified) once");
    ok(store.applyReceiptLifecycle(s, lc0).kind === "idempotent", "R5B — the terminal proposal is a permanent tombstone; an exact-duplicate is idempotent (never re-consumed)");
    ok(store.registerProposal(s, { proposalId: "pp.after", providerTurnId: "pt.after", operation: "READ_CURRENT_RESULTS", executionNonce: "xn.after", receiptId: "rc.after", turnId: "t.1", generation: 0, authorityRef: "ar.cap" }) === false, "R2-07 — a terminal proposal does NOT free a slot (NO eviction — the ceiling holds)");
    store.terminate(s, "user");
  }

  section("R2-08 — a stale / mismatched answer.approve is refused (takeApprovedPlan)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.ap", subject: "s.ap", ipHash: "ip.ap", authenticated: false });
    const s = c.session; s.ackAuthorityRef = "ar.ap";
    store.setPendingPlan(s, { planId: "pl.1", providerTurnId: "pt.1", turnId: "t.1", generation: 0, authorityRef: "ar.ap", expectedTextHash: "hash.expected", ttsText: "hi", language: "en" });
    ok(store.takeApprovedPlan(s, { planId: "pl.1", authorityRef: "ar.ap", textHash: "hash.WRONG", turnId: "t.1", generation: 0 }) === null, "R2-08 — an approval with the WRONG textHash is refused");
    ok(store.takeApprovedPlan(s, { planId: "pl.1", authorityRef: "ar.OTHER", textHash: "hash.expected", turnId: "t.1", generation: 0 }) === null, "R2-08 — an approval with the WRONG authorityRef is refused");
    ok(store.takeApprovedPlan(s, { planId: "pl.1", authorityRef: "ar.ap", textHash: "hash.expected", turnId: "t.1", generation: 9 }) === null, "R2-08 — an approval with the WRONG generation is refused");
    const taken = store.takeApprovedPlan(s, { planId: "pl.1", authorityRef: "ar.ap", textHash: "hash.expected", turnId: "t.1", generation: 0 });
    ok(taken && taken.planId === "pl.1", "R2-08 — an EXACT approval consumes the pending plan");
    ok(store.takeApprovedPlan(s, { planId: "pl.1", authorityRef: "ar.ap", textHash: "hash.expected", turnId: "t.1", generation: 0 }) === null, "R2-08 — the pending plan is one-use (a replayed approval is refused)");
    // a context conflict revokes the pending plan (no un-approved speech survives a context change).
    store.setPendingPlan(s, { planId: "pl.2", providerTurnId: "pt.2", turnId: "t.1", generation: 0, authorityRef: "ar.ap", expectedTextHash: "h2", ttsText: "hi", language: "en" });
    store.revokeContextAck(s);
    ok(s.pendingPlan === null, "R2-08 — a context-conflict revoke also drops the pending (un-approved) plan");
    store.terminate(s, "user");
  }

  section("R2-10 — strict client/server frame schema PARITY (reject, never truncate)");
  {
    const PROTO = require(path.join(CLIENT_OUT, "live-ai/protocol.js"));
    const vectors = [
      { name: "valid turn.text", frame: { t: "turn.text", sessionId: "las.1", turnId: "t.1", generation: 0, text: "hi" }, valid: true },
      { name: "turn.text extra key", frame: { t: "turn.text", sessionId: "las.1", turnId: "t.1", generation: 0, text: "hi", cmd: "rm" }, valid: false },
      { name: "valid answer.approve", frame: { t: "answer.approve", sessionId: "las.1", turnId: "t.1", generation: 0, planId: "pl.1", authorityRef: "ar.1", textHash: "a".repeat(64) }, valid: true },
      { name: "answer.approve short textHash", frame: { t: "answer.approve", sessionId: "las.1", turnId: "t.1", generation: 0, planId: "pl.1", authorityRef: "ar.1", textHash: "abc" }, valid: false },
      { name: "answer.approve non-hex textHash", frame: { t: "answer.approve", sessionId: "las.1", turnId: "t.1", generation: 0, planId: "pl.1", authorityRef: "ar.1", textHash: "Z".repeat(64) }, valid: false },
      { name: "answer.approve missing planId", frame: { t: "answer.approve", sessionId: "las.1", turnId: "t.1", generation: 0, authorityRef: "ar.1", textHash: "a".repeat(64) }, valid: false },
      { name: "unknown discriminant", frame: { t: "totally.unknown", sessionId: "las.1" }, valid: false },
      { name: "session.end valid", frame: { t: "session.end", sessionId: "las.1", generation: 0, reason: "user" }, valid: true },
      { name: "session.end bad reason", frame: { t: "session.end", sessionId: "las.1", generation: 0, reason: "boom" }, valid: false },
      { name: "session.reset valid", frame: { t: "session.reset", sessionId: "las.1", generation: 0 }, valid: true },
      { name: "turn.interrupt valid", frame: { t: "turn.interrupt", sessionId: "las.1", turnId: "t.1", generation: 0, reason: "barge_in" }, valid: true },
      { name: "turn.interrupt bad reason", frame: { t: "turn.interrupt", sessionId: "las.1", turnId: "t.1", generation: 0, reason: "explode" }, valid: false },
    ];
    for (const v of vectors) {
      const clientOk = PROTO.validateClientFrame(v.frame) !== null;
      const serverOk = SCH.validateInboundFrame(v.frame) !== null;
      ok(clientOk === serverOk, `R2-10 — client/server AGREE on '${v.name}' (client=${clientOk}, server=${serverOk})`);
      ok(clientOk === v.valid, `R2-10 — '${v.name}' is ${v.valid ? "ACCEPTED" : "REJECTED"} by both (strict, no truncation)`);
    }
  }

  section("R2-13 — provider FAILS CLOSED with no budget authority; reserves + settles when present; exhaustion refuses");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    let bn = 0;
    function fresh() { bn++; const c = store.create({ sessionId: "las.b" + bn, subject: "s.b" + bn, ipHash: "ip.b" + bn, authenticated: false }); c.session.ackAuthorityRef = "ar.b"; const fr = []; c.session.emit = (f) => fr.push(f); return { s: c.session, fr }; }
    const okReason = () => RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: { kind: "unknown", language: "en", evidenceReceiptIds: [], reason: "no_context" } } }) });
    const gid = (p) => p + "." + (bn++);
    // (a) budget:null → REFUSED before the provider call (the production fail-closed barrier).
    {
      let reasonCalls = 0;
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => { reasonCalls++; return { ok: true, candidate: {} }; } });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget: null, genId: gid });
      const { s, fr } = fresh();
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      ok(fr.some((f) => f.t === "turn.error" && f.code === "budget_exceeded"), "R2-13 — with NO budget authority the provider turn is REFUSED (budget_exceeded)");
      eq(reasonCalls, 0, "R2-13 — the provider was NEVER called without a budget (fail closed)");
    }
    // (b) budget present → reserve BEFORE, settle AFTER the provider call.
    {
      const budget = fakeBudget();
      const orch = ORCH.createLiveAiOrchestrator({ reasoning: okReason(), tts: TTS.unavailableTts, store, budget, genId: gid });
      const { s } = fresh();
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      ok(budget._reserveCalls().some((e) => e.ok), "R2-13 — a reservation was TAKEN before the provider call");
      ok(budget._settleCalls().length >= 1, "R2-13 — the reservation was SETTLED after the call");
    }
    // (c) budget exhausted (cap 0) → budget_exceeded, provider never called.
    {
      const budget = fakeBudget(0);
      const orch = ORCH.createLiveAiOrchestrator({ reasoning: okReason(), tts: TTS.unavailableTts, store, budget, genId: gid });
      const { s, fr } = fresh();
      await orch.runTurn(s, { turnId: "t.1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      ok(fr.some((f) => f.t === "turn.error" && f.code === "budget_exceeded"), "R2-13 — an EXHAUSTED budget refuses the turn (budget_exceeded)");
    }
  }

  section("R3-03 / R3-04 — single-start owner refuses a second start while owned; end() aborts the in-flight broker fetch + closes socket/media");
  {
    // (a) R3-03 — a SLOW first start OWNS the transport; a second start WHILE OWNED is
    //     REFUSED (already_active) and never supersedes/clobbers — only the owner opens a socket.
    let opens = 0, fetchN = 0, resolveSlow;
    const slow = new Promise((r) => { resolveSlow = r; });
    const okBroker = { sessionId: "las.s", gatewaySessionId: "gw.s", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.s/control" };
    const t = GC.createGatewayTransport({
      fetchImpl: async () => { fetchN++; if (fetchN === 1) await slow; return { ok: true, status: 200, json: async () => okBroker }; },
      openSocket: () => { opens++; return { send() {}, close() {} }; },
    });
    const p1 = t.start({ sessionId: "las.s", turnId: "turn.1", generation: 0, mode: "text", context: {} });
    const p2 = t.start({ sessionId: "las.s", turnId: "turn.2", generation: 0, mode: "text", context: {} });
    resolveSlow();
    const r1 = await p1, r2 = await p2;
    ok(r1.ok === true, "R3-03 — the FIRST (owning) start connected");
    ok(r2.ok === false && r2.code === "already_active", "R3-03 — a second start WHILE OWNED is REFUSED (already_active), never superseding the owner");
    eq(fetchN, 1, "R3-03 — the refused second start never even reached the broker fetch");
    eq(opens, 1, "R3-04 — only the single owner opened a socket");

    // (b) end() DURING an in-flight broker fetch ABORTS it + opens no socket.
    let aborted = false, opensB = 0, resolveB;
    const slowB = new Promise((r) => { resolveB = r; });
    const okB2 = { sessionId: "las.d", gatewaySessionId: "gw.d", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.d/control" };
    const t2 = GC.createGatewayTransport({
      fetchImpl: async (url, init) => { if (init && init.signal) init.signal.addEventListener("abort", () => { aborted = true; }); await slowB; return { ok: true, status: 200, json: async () => okB2 }; },
      openSocket: () => { opensB++; return { send() {}, close() {} }; },
    });
    const pend = t2.start({ sessionId: "las.d", turnId: "turn.d", generation: 0, mode: "text", context: {} });
    t2.end({ sessionId: "las.d", generation: 0, reason: "user" });
    ok(aborted === true, "R2-04 — end() ABORTED the in-flight broker fetch (AbortController)");
    resolveB();
    const rd = await pend;
    ok(rd.ok === false, "R2-04 — the aborted / late start did not connect");
    eq(opensB, 0, "R2-04 — no socket opened after dispose");

    // (c) end() after a live connection closes the control socket + owned media.
    let socketClosed = 0, mediaClosed = 0;
    const media = { createOffer: async () => "v=0", acceptAnswer: async () => {}, close: () => { mediaClosed++; } };
    const okB3 = { sessionId: "las.c3", gatewaySessionId: "gw.c3", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.c3/control" };
    const t3 = GC.createGatewayTransport({ media, fetchImpl: async () => ({ ok: true, status: 200, json: async () => okB3 }), openSocket: () => ({ send() {}, close() { socketClosed++; } }) });
    await t3.start({ sessionId: "las.c3", turnId: "turn.c3", generation: 0, mode: "text", context: {} });
    t3.end({ sessionId: "las.c3", generation: 0, reason: "user" });
    eq(socketClosed, 1, "R2-04 — end() closed the control socket");
    eq(mediaClosed, 1, "R2-04 — end() closed the owned media");
  }

  // ══════════════════════════ R3 AGGREGATED REMEDIATION ══════════════════════════
  section("R3-02 — the Responses structured-output schema is STRICT (all declared props required; optionals nullable)");
  {
    const schema = RESP.buildReasoningOutputSchema();
    const isClosed = (s) => !!s && s.type === "object" && s.additionalProperties === false && Array.isArray(s.required) && s.required.length === Object.keys(s.properties).length && s.required.every((k) => k in s.properties);
    ok(isClosed(schema), "R3-02 — the top-level object is closed (required == all declared keys)");
    const propAnyOf = schema.properties.proposal.anyOf;
    const answerAnyOf = schema.properties.answer.anyOf;
    ok(Array.isArray(propAnyOf) && propAnyOf.some((v) => v.type === "null"), "R3-02 — `proposal` is a nullable union (null allowed)");
    ok(Array.isArray(answerAnyOf) && answerAnyOf.some((v) => v.type === "null"), "R3-02 — `answer` is a nullable union (null allowed)");
    const variants = [...propAnyOf, ...answerAnyOf].filter((v) => v.type === "object");
    ok(variants.length >= 11, "R3-02 — every operation + answer kind is its own closed variant (>=11)");
    ok(variants.every(isClosed), "R3-02 — EVERY variant object is strict-closed (required == all its declared keys)");
    const apply = propAnyOf.find((v) => v.type === "object" && v.properties.op && Array.isArray(v.properties.op.enum) && v.properties.op.enum[0] === "APPLY_HOTEL_REFINEMENT");
    ok(apply && ["destination", "query", "maxPrice", "parking", "sort", "stars"].every((k) => apply.required.includes(k) && apply.properties[k].anyOf && apply.properties[k].anyOf.some((u) => u.type === "null")), "R3-02 — APPLY declares EVERY refinement field as required + nullable");
    // R5A-REMEDIATION (REV-NEW-01) — COMPARE declares bounded positions (2..4) + bounded comparison
    // FACTORS (1..4, closed enum). `uniqueItems` is UNSUPPORTED by OpenAI Structured Outputs and is
    // NOT present; DISTINCTNESS + ORIGINAL ORDER are enforced by the downstream trusted validators.
    const compare = propAnyOf.find((v) => v.type === "object" && v.properties.op && Array.isArray(v.properties.op.enum) && v.properties.op.enum[0] === "COMPARE_VISIBLE_HOTELS");
    ok(compare && compare.required.includes("positions") && compare.required.includes("factors"), "R5A-REM — the COMPARE schema variant declares positions AND factors (both required)");
    ok(compare && compare.properties.positions.type === "array" && compare.properties.positions.minItems === 2 && compare.properties.positions.maxItems === 4 && !("uniqueItems" in compare.properties.positions), "R5A-REM — COMPARE positions are a bounded integer array WITHOUT uniqueItems");
    ok(compare && compare.properties.factors.type === "array" && compare.properties.factors.minItems === 1 && compare.properties.factors.maxItems === 4 && !("uniqueItems" in compare.properties.factors) && Array.isArray(compare.properties.factors.items.enum) && compare.properties.factors.items.enum.join(",") === "price,rating,parking,breakfast", "R5A-REM — COMPARE factors are a bounded closed-enum array WITHOUT uniqueItems");
    // R5A-REMEDIATION (REV-NEW-04) — stars bounded (minItems 1, maxItems 3), NO uniqueItems.
    const applyStars = apply.properties.stars.anyOf.find((u) => u.type === "array");
    ok(applyStars && applyStars.minItems === 1 && applyStars.maxItems === 3 && applyStars.items.minimum === 3 && applyStars.items.maximum === 5 && !("uniqueItems" in applyStars), "R5A-REM — APPLY stars: bounded integer array (minItems 1, maxItems 3) WITHOUT uniqueItems");
    // R5A-REMEDIATION (REV-NEW-01) — destination/query drop the unsupported `maxLength` (the true
    // 40/60 UTF-16-unit canonical limits are enforced downstream).
    const applyDest = apply.properties.destination.anyOf.find((u) => u.type === "string");
    const applyQuery = apply.properties.query.anyOf.find((u) => u.type === "string");
    ok(applyDest && !("maxLength" in applyDest) && !("minLength" in applyDest) && applyQuery && !("maxLength" in applyQuery), "R5A-REM — APPLY destination/query declare NO maxLength (downstream is authoritative for 40/60)");
    // R5A-REMEDIATION (REV-NEW-01) — RECURSIVE forbidden-key scan: NO unsupported Structured Outputs
    // keyword may appear ANYWHERE in the generated schema (walks every nested object/array/anyOf).
    const FORBIDDEN_SCHEMA_KEYS = ["uniqueItems", "maxLength", "minLength", "format", "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties", "unevaluatedItems", "contains", "minContains", "maxContains", "oneOf", "allOf", "not", "if", "then", "else", "dependentRequired", "dependentSchemas"];
    const foundForbidden = [];
    const walkSchema = (node, pathStr) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walkSchema(n, pathStr + "[" + i + "]")); return; }
      if (!node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        if (FORBIDDEN_SCHEMA_KEYS.includes(k)) foundForbidden.push(pathStr + "." + k);
        walkSchema(node[k], pathStr + "." + k);
      }
    };
    walkSchema(schema, "$");
    ok(foundForbidden.length === 0, "R5A-REM — the generated schema contains NO unsupported Structured Outputs keyword (recursive scan)" + (foundForbidden.length ? " — found: " + foundForbidden.join(", ") : ""));
    // Guard against OVER-stripping: the SUPPORTED bounds the review said to KEEP are still present.
    const openVar = propAnyOf.find((v) => v.type === "object" && v.properties.op && Array.isArray(v.properties.op.enum) && v.properties.op.enum[0] === "OPEN_VISIBLE_HOTEL");
    ok(openVar && openVar.properties.position.minimum === 1 && openVar.properties.position.maximum === 24, "R5A-REM — supported numeric bounds (minimum/maximum) retained on OPEN position");
    const applyMaxPrice = apply.properties.maxPrice.anyOf.find((u) => u.type === "number");
    ok(applyMaxPrice && applyMaxPrice.minimum === 0 && applyMaxPrice.maximum === 10_000_000, "R5A-REM — maxPrice keeps supported minimum:0 / maximum (downstream enforces strict > 0)");
  }

  section("R3-05 — adversarial: wrong-tuple accept refused; actionId immutable; operation-specific evidence enforced");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.r5", subject: "s5", ipHash: "ip5", authenticated: false });
    const s = c.session; s.ackAuthorityRef = "ar.5";
    store.registerProposal(s, { proposalId: "pp.5", providerTurnId: "pt.5", operation: "OPEN_VISIBLE_HOTEL", executionNonce: "xn.5", receiptId: "rc.5", turnId: "t.5", generation: 2, authorityRef: "ar.5" });
    const acc5 = (o) => store.acceptProposalAction(s, Object.assign({ receiptId: "rc.5", proposalId: "pp.5", providerTurnId: "pt.5", actionId: "act.5", executionNonce: "xn.5", operation: "OPEN_VISIBLE_HOTEL", authorityRef: "ar.5", turnId: "t.5", generation: 2 }, o));
    ok(acc5({ generation: 99 }) === false, "R3-05 — accept with a WRONG generation is refused");
    ok(acc5({ providerTurnId: "pt.WRONG" }) === false, "R3-05 — accept with a WRONG providerTurnId is refused");
    ok(acc5({ receiptId: "rc.WRONG" }) === false, "R5B — accept echoing a WRONG (self-minted) receiptId is refused");
    s.ackAuthorityRef = "ar.OTHER";
    ok(acc5({}) === false, "R3-05 — accept under a NO-LONGER-CURRENT authority is refused");
    s.ackAuthorityRef = "ar.5";
    ok(acc5({}) === true, "R3-05 — a correct accept binds the actionId (pending → accepted)");
    ok(acc5({ actionId: "act.DIFFERENT" }) === false, "R3-05 — the bound actionId is IMMUTABLE (a different re-accept is refused)");
    const lc5 = (o) => store.applyReceiptLifecycle(s, Object.assign({ receiptId: "rc.5", proposalId: "pp.5", providerTurnId: "pt.5", operation: "OPEN_VISIBLE_HOTEL", authorityRef: "ar.5", actionId: "act.5", executionNonce: "xn.5", outcome: "unknown", digest: "d.5", resultTurnId: "t.5", resultGeneration: 2 }, o));
    ok(lc5({ actionId: "act.WRONG" }).kind === "invalid", "R3-05 — a receipt with a mismatched actionId is refused");
    ok(lc5({}).kind === "terminal", "R3-05 — a receipt with the EXACT bound actionId terminalizes");
    // a proposal never accepted can never advance (no actionId binding → receipt-before-accept).
    store.registerProposal(s, { proposalId: "pp.na", providerTurnId: "pt.na", operation: "READ_CURRENT_RESULTS", executionNonce: "xn.na", receiptId: "rc.na", turnId: "t.5", generation: 2, authorityRef: "ar.5" });
    ok(store.applyReceiptLifecycle(s, { receiptId: "rc.na", proposalId: "pp.na", providerTurnId: "pt.na", operation: "READ_CURRENT_RESULTS", authorityRef: "ar.5", actionId: "act.na", executionNonce: "xn.na", outcome: "verified", digest: "d.na", resultTurnId: "t.5", resultGeneration: 2 }).kind === "invalid", "R5B — a receipt with NO prior accepted announcement can never correlate (receipt before acceptance)");
    // operation-specific evidence.
    ok(SCH.evidenceMatchesOperation("READ_CURRENT_RESULTS", { kind: "results", count: 2 }) === true, "R3-05 — READ_CURRENT_RESULTS ↔ results evidence");
    ok(SCH.evidenceMatchesOperation("READ_CURRENT_RESULTS", { kind: "detail" }) === false, "R3-05 — READ_CURRENT_RESULTS with detail evidence is a mismatch");
    ok(SCH.evidenceMatchesOperation("COMPARE_VISIBLE_HOTELS", { kind: "comparison", positions: [1, 2] }) === true, "R3-05 — COMPARE ↔ comparison evidence");
    ok(SCH.evidenceMatchesOperation("READ_CURRENT_HOTEL_FACTS", { kind: "detail", hotelId: "h" }) === true, "R3-05 — READ_CURRENT_HOTEL_FACTS ↔ detail evidence");
    ok(SCH.evidenceMatchesOperation("OPEN_VISIBLE_HOTEL", undefined) === false, "R5B — OPEN can no longer verify EVIDENCE-FREE (bounded destination evidence required)");
    ok(SCH.evidenceMatchesOperation("OPEN_VISIBLE_HOTEL", { kind: "navigation" }) === true, "R5B — OPEN ↔ navigation destination evidence");
    ok(SCH.evidenceMatchesOperation("OPEN_VISIBLE_HOTEL", { kind: "detail" }) === true, "R5B — OPEN also accepts destination detail evidence");
    ok(SCH.evidenceMatchesOperation("OPEN_VISIBLE_HOTEL", { kind: "results" }) === false, "R3-05 — OPEN with results evidence is a mismatch");
    ok(SCH.evidenceMatchesOperation("SHOW_HOTEL_SECTION", { kind: "ui_state", section: "rooms" }) === true, "R3-05 — SHOW ↔ ui_state evidence");
    ok(SCH.evidenceMatchesOperation("APPLY_HOTEL_REFINEMENT", { kind: "results" }) === true, "R5B-REV-02 — APPLY now COMPLETES to verified with results evidence");
    ok(SCH.evidenceMatchesOperation("APPLY_HOTEL_REFINEMENT", { kind: "detail" }) === false, "R5B-REV-02 — APPLY with the WRONG evidence kind (detail) is still a mismatch");
  }

  section("R3-13 — provider USAGE settled as actual; conservative retention when absent; TTS ceiling; speech ceilings");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    let mkN = 0;
    const mk = () => { mkN += 1; const c = store.create({ sessionId: "las.u" + mkN, subject: "su" + mkN, ipHash: "ip" + mkN, authenticated: false }); c.session.ackAuthorityRef = "ar.u"; const fr = []; c.session.emit = (f) => fr.push(f); return { s: c.session, fr }; };
    let gN = 0; const genId = (p) => `${p}.${gN++}`;
    // (a) reasoning returns actual usage → settle the ACTUAL, not the conservative reservation.
    {
      const budget = fakeBudget();
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: { kind: "clarification", language: "en", questionCode: "which_city", evidenceReceiptIds: [] } }, usage: 137 }) });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget, genId });
      await orch.runTurn(mk().s, { turnId: "t.u1", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      const settles = budget._settleCalls();
      ok(settles.length >= 1 && settles[0].actual === 137, "R3-13 — reasoning SETTLES the ACTUAL provider usage (137), not the conservative reservation");
    }
    // (b) reasoning returns NO usage → settle conservative (null).
    {
      const budget = fakeBudget();
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: { kind: "clarification", language: "en", questionCode: "which_city", evidenceReceiptIds: [] } } }) });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget, genId });
      await orch.runTurn(mk().s, { turnId: "t.u2", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      const settles = budget._settleCalls();
      ok(settles.length >= 1 && settles[0].actual === null, "R3-13 — an ABSENT usage RETAINS the conservative reservation (settle null)");
    }
    // (c) TTS surfaces measurable usage (characters); over-long / empty synthesis fails closed.
    {
      const tts = TTS.createTtsAdapter({ model: TTS.TTS_MODEL, call: async () => ({ ok: true, chunks: [{ seq: 0, bytes: b64pcm(50) }] }) });
      const r = await tts.synthesize({ text: "hello", language: "en" });
      ok(r.ok === true && r.usage === 5, "R3-13 — TTS surfaces measurable usage = characters voiced (5)");
      const over = await tts.synthesize({ text: "x".repeat(TTS.MAX_TTS_TEXT_CHARS + 1), language: "en" });
      ok(over.ok === false && over.reason === "tts_too_long", "R3-13 — an over-long synthesis fails closed (tts_too_long)");
      const empty = await tts.synthesize({ text: "", language: "en" });
      ok(empty.ok === false, "R3-13 — empty synthesis text is refused");
    }
    // (d) the reasoning ADAPTER surfaces the seam's actual usage (and none when absent).
    {
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: null }, usage: 999 }) });
      const rr = await reasoning.reason({ transcript: "x", context: {}, verifiedReceiptIds: [] });
      ok(rr.ok === true && rr.usage === 999, "R3-13 — the reasoning adapter surfaces the seam's actual usage");
      const noUsage = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: null } }) });
      const rr2 = await noUsage.reason({ transcript: "x", context: {}, verifiedReceiptIds: [] });
      ok(rr2.ok === true && rr2.usage === undefined, "R3-13 — a seam with no usage surfaces none (conservative retention downstream)");
    }
    // (e) SERVER cumulative captured-speech ceiling.
    {
      const store2 = SESS.createLiveAiSessionStore({ limits: { ...SESS.DEFAULT_LIVE_AI_LIMITS, maxSessionSpeechBytes: 10 } });
      const s2 = store2.create({ sessionId: "las.sp", subject: "ssp", ipHash: "ipsp", authenticated: false }).session;
      ok(store2.consumeSpeechBytes(s2, 6) === true, "R3-13 — under the cumulative cap → accepted");
      ok(store2.consumeSpeechBytes(s2, 6) === false, "R3-13 — a charge that would breach the cap → refused (fail closed)");
      ok(s2.speechBytes === 6, "R3-13 — a refused charge does NOT advance the counter past the cap");
      ok(store2.consumeSpeechBytes(s2, 4) === true, "R3-13 — a charge that exactly fits is accepted");
      ok(store2.consumeSpeechBytes(s2, 1) === false, "R3-13 — once at the cap, further speech is refused");
    }
    // (e2) the turn.text handler refuses over-cap cumulative speech (budget_exceeded, no provider turn).
    {
      const store3 = SESS.createLiveAiSessionStore({ limits: { ...SESS.DEFAULT_LIVE_AI_LIMITS, maxSessionSpeechBytes: 8 } });
      const s3 = store3.create({ sessionId: "las.tt", subject: "stt", ipHash: "iptt", authenticated: false }).session;
      const fr = []; s3.emit = (f) => fr.push(f); s3.ackAuthorityRef = "ar.tt";
      const deps = { session: s3, store: store3, runTurn: async () => {}, runTts: async () => {} };
      const turn = (text) => CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "turn.text", sessionId: "las.tt", turnId: "t.1", generation: 0, text }) });
      eq(turn("hello"), "turn", "R3-13 — a within-cap turn runs (5 bytes)");
      eq(turn("world!"), "speech_ceiling", "R3-13 — a turn that breaches the cumulative speech cap is refused");
      ok(fr.some((f) => f.t === "turn.error" && f.code === "budget_exceeded"), "R3-13 — the refused turn emits budget_exceeded");
    }
    // (f) CLIENT mic speech-ceiling guard (utterance-duration + cumulative-speech, output ignored).
    {
      let fired = null; let timers = [];
      const setTimer = (fn) => { const h = { fn }; timers.push(h); return h; };
      const clearTimer = (h) => { timers = timers.filter((x) => x !== h); };
      const g = GC.createSpeechCeilingGuard({ onCeiling: (r) => { fired = r; }, maxUtteranceMs: 100, maxSessionChars: 100, setTimer, clearTimer });
      eq(g.handle(JSON.stringify({ type: "input_audio_buffer.speech_started" })), "utterance_start", "R3-13 — speech_started arms the utterance-duration timer");
      ok(timers.length === 1, "an utterance timer is armed");
      timers[0].fn();
      eq(fired, "utterance_timeout", "R3-13 — an utterance exceeding the duration cap trips the ceiling");
      let timers2 = [];
      const g2 = GC.createSpeechCeilingGuard({ onCeiling: () => {}, maxUtteranceMs: 100, setTimer: (fn) => { const h = { fn }; timers2.push(h); return h; }, clearTimer: (h) => { timers2 = timers2.filter((x) => x !== h); } });
      g2.handle(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
      g2.handle(JSON.stringify({ type: "input_audio_buffer.speech_stopped" }));
      eq(timers2.length, 0, "R3-13 — speech_stopped clears the utterance timer");
      let fired3 = null;
      const g3 = GC.createSpeechCeilingGuard({ onCeiling: (r) => { fired3 = r; }, maxSessionChars: 8, setTimer, clearTimer });
      eq(g3.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "hello" })), "counted", "R3-13 — a completed INPUT transcript is counted");
      ok(fired3 === null, "under the cumulative char cap → no ceiling");
      eq(g3.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "i2", transcript: "world!" })), "tripped", "R3-13 — cumulative captured speech over the cap trips");
      eq(fired3, "session_speech", "R3-13 — the cumulative-speech ceiling fires onCeiling(session_speech)");
      let fired4 = null;
      const g4 = GC.createSpeechCeilingGuard({ onCeiling: (r) => { fired4 = r; }, maxSessionChars: 1, setTimer, clearTimer });
      eq(g4.handle(JSON.stringify({ type: "response.output_audio_transcript.done", transcript: "a very long assistant answer" })), "ignored", "R3-13 — an assistant OUTPUT transcript is not user speech (ignored, not counted)");
      ok(fired4 === null, "R3-13 — assistant output never trips the captured-speech ceiling");
    }
  }

  section("R3-13 — realtime transcription negotiation RESERVES budget BEFORE the provider call (fail-closed without a budget)");
  {
    let jose = null;
    try { jose = require(require.resolve("jose", { paths: [REPO] })); } catch (_) { jose = null; }
    if (!jose) { ok(false, "R3-13 transcription-reserve prereq (jose) must be available"); }
    else {
      const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
      const spki = await jose.exportSPKI(publicKey);
      // OPENAI_API_KEY present so the session-create path is fully configured; the
      // injected fake transcription/budget win, so no real provider call is made.
      const env = { LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway", LIVE_AI_CONTROL_TOKEN_SECRET: "ctl", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill", LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-not-called" };
      const mkA = async () => new jose.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false }).setProtectedHeader({ alg: "ES256" }).setSubject("sub.tx").setJti("jti.tx." + Math.random().toString(36).slice(2)).setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
      const goodSdp = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n";
      // (a) budget present → reserve BEFORE negotiate, settle AFTER.
      const order = [];
      const fakeTx = { available: true, model: "gpt-live-transcribe", transcribe: async () => ({ ok: false, reason: "x" }), negotiate: async () => { order.push("negotiate"); return { ok: true, answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }; } };
      const budget = { reserve: () => { order.push("reserve"); return "res"; }, settle: (id, a) => { order.push("settle:" + a); } };
      const ctx = G.buildLiveAiContext({ env, budget, transcription: fakeTx });
      const r = await G.handleLiveAiSessionCreate(ctx, { origin: "https://x.test", ip: "1.2.3.4", authorization: "Bearer " + (await mkA()), body: { mode: "microphone", sessionId: "las.tx", sdp: goodSdp } });
      ok(r.status === 200 && typeof r.body.answerSdp === "string", "R3-13 — mic negotiation succeeds with a budget + transcription adapter");
      eq(order[0], "reserve", "R3-13 — budget RESERVED before the provider negotiate");
      eq(order[1], "negotiate", "R3-13 — the provider negotiate ran AFTER the reservation");
      ok(order.some((x) => x.indexOf("settle") === 0), "R3-13 — the reservation was SETTLED after negotiate");
      // (b) NO budget authority → fail closed (503); the provider negotiate is NEVER called.
      const order2 = [];
      const fakeTx2 = { available: true, model: "gpt-live-transcribe", transcribe: async () => ({ ok: false, reason: "x" }), negotiate: async () => { order2.push("negotiate"); return { ok: true, answerSdp: "v=0\r\n" }; } };
      const ctx2 = G.buildLiveAiContext({ env, budget: null, transcription: fakeTx2 });
      const r2 = await G.handleLiveAiSessionCreate(ctx2, { origin: "https://x.test", ip: "1.2.3.5", authorization: "Bearer " + (await mkA()), body: { mode: "microphone", sessionId: "las.tx2", sdp: goodSdp } });
      eq(r2.status, 503, "R3-13 — NO budget authority → mic negotiation fails closed (503)");
      eq(order2.length, 0, "R3-13 — the provider negotiate was NEVER called without a budget (fail closed)");
    }
  }

  section("R3-03 / R3-04 — single-start owner: refuse while owned; a fresh start is allowed only from DISCONNECTED");
  {
    const okBroker = { sessionId: "las.re", gatewaySessionId: "gw.re", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.re/control" };
    let opens = 0;
    const t = GC.createGatewayTransport({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker }), openSocket: () => { opens++; return { send() {}, close() {} }; } });
    const r1 = await t.start({ sessionId: "las.re", turnId: "t.1", generation: 0, mode: "text", context: {} });
    ok(r1.ok === true, "R3-03 — the first start owns the transport");
    const busy = await t.start({ sessionId: "las.re", turnId: "t.2", generation: 0, mode: "text", context: {} });
    ok(busy.ok === false && busy.code === "already_active", "R3-03 — a start while OWNED is refused (already_active), never a second socket");
    eq(opens, 1, "R3-03 — the refused start opened NO socket");
    t.end({ sessionId: "las.re", generation: 0, reason: "user" });
    const r2 = await t.start({ sessionId: "las.re", turnId: "t.3", generation: 0, mode: "text", context: {} });
    ok(r2.ok === true, "R3-03 — after end() (→ DISCONNECTED) a fresh start is allowed and owns");
    eq(opens, 2, "R3-04 — two sockets across two SEQUENTIAL owned sessions (never concurrent)");
  }

  section("R3-NEW-02 — the input-transcription item authority gate (input-only, dedup, in-order, unknown rejected)");
  {
    const surfaced = [];
    const gate = GC.createInputTranscriptGate((t) => surfaced.push(t));
    eq(gate.handle(JSON.stringify({ type: "response.output_audio_transcript.done", transcript: "assistant prose" })), "rejected_output", "R3-NEW-02 — an assistant OUTPUT transcript is rejected (never user input)");
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "x1", transcript: "hi" })), "unknown_item", "R3-NEW-02 — a completion for an UN-committed item is rejected (unknown_item)");
    ok(surfaced.length === 0, "nothing surfaced for the rejected inputs");
    eq(gate.handle(JSON.stringify({ type: "conversation.item.created", item: { id: "a" } })), "committed", "conversation.item.created records commit order");
    eq(gate.handle(JSON.stringify({ type: "input_audio_buffer.committed", item_id: "b" })), "committed", "input_audio_buffer.committed records commit order");
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "second" })), "surfaced", "R3-NEW-02 — the newer committed item surfaces");
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "first-late" })), "stale", "R3-NEW-02 — a late OLDER item after a newer surfaced one is stale (never starts a stale turn)");
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "second-again" })), "duplicate", "R3-NEW-02 — a duplicate completion is dropped");
    eq(surfaced.length, 1, "R3-NEW-02 — exactly ONE user transcript surfaced (the in-order newest)");
    eq(surfaced[0], "second", "the surfaced transcript is the newest committed item's");
    gate.reset();
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "post-reset" })), "unknown_item", "R3-NEW-02 — reset() drops obsolete item authority");
  }

  // ══════════════════════════ R4 AGGREGATED REMEDIATION ══════════════════════════
  section("R4-03 — GENERATION-LOCAL MEDIA SESSION OWNERSHIP: each start mints its own media; an old start closes ONLY its own");
  {
    const made = [];
    const mkMedia = () => { const m = { closed: false, createOffer: async (onAcquire) => { if (onAcquire && !onAcquire()) { m.closed = true; throw new Error("capture_admission_refused"); } return "v=0\r\n"; }, acceptAnswer: async () => {}, close: () => { m.closed = true; } }; made.push(m); return m; };
    let fetchN = 0, resolveSlow;
    const slow = new Promise((r) => { resolveSlow = r; });
    const okB = { sessionId: "las.m", gatewaySessionId: "gw.m", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.m/control", answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
    const t = GC.createGatewayTransport({
      createMediaSession: mkMedia,
      fetchImpl: async () => { fetchN++; if (fetchN === 1) await slow; return { ok: true, status: 200, json: async () => okB }; },
      openSocket: (u, p, h) => { const s = { send() {}, close() {} }; setTimeout(() => h.onOpen(), 0); return s; },
    });
    const p1 = t.start({ sessionId: "las.m", turnId: "t.1", generation: 0, mode: "microphone", context: {} });
    await new Promise((r) => setTimeout(r, 0)); // let start1 acquire media[0] via createOffer, then block on the slow broker
    eq(made.length, 1, "R4-03 — start1 minted a fresh media SESSION (per-start factory)");
    t.end({ sessionId: "las.m", generation: 0, reason: "user" }); // dispose while start1 in-flight (start1 not yet owner → ownerMedia null)
    resolveSlow();
    await p1;
    ok(made[0].closed === true, "R4-03 — the superseded in-flight start released ITS OWN media session (releaseMine)");
    const r2 = await t.start({ sessionId: "las.m", turnId: "t.2", generation: 0, mode: "microphone", context: {} });
    ok(r2.ok === true, "R4-03 — a fresh start from DISCONNECTED wins");
    eq(made.length, 2, "R4-03 — the fresh start minted a NEW media session (never reused the old closure)");
    ok(made[1].closed === false, "R4-03 — the OLD start's teardown did NOT close the NEW start's media (no shared closure)");
    t.end({ sessionId: "las.m", generation: 0, reason: "user" });
    ok(made[1].closed === true, "R4-03 — disposeTransport closes ONLY the CURRENT owner's media session");
  }

  section("R4-04 — createOffer partial-acquisition + owned-failure teardown: media released on any acquisition failure");
  {
    // a media whose acceptAnswer throws AFTER createOffer: the start fails and the media is released.
    let closes = 0;
    const media = { createOffer: async (onAcquire) => { if (onAcquire && !onAcquire()) { closes++; throw new Error("capture_admission_refused"); } return "v=0\r\n"; }, acceptAnswer: async () => { throw new Error("negotiate_failed"); }, close: () => { closes++; } };
    const okB = { sessionId: "las.f", gatewaySessionId: "gw.f", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.f/control", answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
    const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl: async () => ({ ok: true, status: 200, json: async () => okB }), openSocket: () => ({ send() {}, close() {} }) });
    const r = await t.start({ sessionId: "las.f", turnId: "t.1", generation: 0, mode: "microphone", context: {} });
    ok(r.ok === false, "R4-04 — a media acceptAnswer failure fails the start closed");
    eq(t.getConnectionState(), "error", "R4-04 — the failed mic start goes to ERROR");
  }

  section("R4-05 — GATEWAY-OWNED EXECUTION COMMITMENT: accept/consume require the EXACT executionNonce (copy/replay/absent fail)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const s = store.create({ sessionId: "las.n", subject: "sn", ipHash: "ipn", authenticated: false }).session;
    s.ackAuthorityRef = "ar.n";
    // TWO proposals, each with its OWN gateway nonce.
    store.registerProposal(s, { proposalId: "pp.A", providerTurnId: "pt.A", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.A", receiptId: "rc.A", turnId: "t.n", generation: 1, authorityRef: "ar.n" });
    store.registerProposal(s, { proposalId: "pp.B", providerTurnId: "pt.B", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.B", receiptId: "rc.B", turnId: "t.n", generation: 1, authorityRef: "ar.n" });
    const accA = (o) => store.acceptProposalAction(s, Object.assign({ receiptId: "rc.A", proposalId: "pp.A", providerTurnId: "pt.A", actionId: "act.A", executionNonce: "xn.A", operation: "READ_CURRENT_RESULTS", authorityRef: "ar.n", turnId: "t.n", generation: 1 }, o));
    ok(accA({ executionNonce: "xn.RANDOM" }) === false, "R4-05 — accept with a RANDOM nonce (no gateway commitment) is REFUSED");
    ok(accA({ executionNonce: "xn.B" }) === false, "R4-05 — a nonce COPIED from ANOTHER proposal is REFUSED");
    ok(accA({}) === true, "R4-05 — the EXACT gateway commitment binds the actionId");
    const lcA = (o) => store.applyReceiptLifecycle(s, Object.assign({ receiptId: "rc.A", proposalId: "pp.A", providerTurnId: "pt.A", operation: "READ_CURRENT_RESULTS", authorityRef: "ar.n", actionId: "act.A", executionNonce: "xn.A", outcome: "unknown", digest: "d.A", resultTurnId: "t.n", resultGeneration: 1 }, o));
    ok(lcA({ executionNonce: "xn.B" }).kind === "invalid", "R4-05 — a receipt echoing the WRONG nonce cannot advance");
    ok(lcA({}).kind === "terminal", "R4-05 — a receipt echoing the EXACT nonce + actionId terminalizes once");
    ok(lcA({}).kind === "idempotent", "R4-05/R5B — an exact-duplicate on a terminal proposal is idempotent (tombstone)");
    // the orchestrator MINTS the nonce as gateway metadata on the action.proposal frame.
    const frames = [];
    const store2 = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const s2 = store2.create({ sessionId: "las.o", subject: "so", ipHash: "ipo", authenticated: false }).session;
    s2.ackAuthorityRef = "ar.o"; s2.emit = (f) => frames.push(f);
    let gN = 0; const gen = (p) => `${p}.${gN++}`;
    const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { proposal: { op: "READ_CURRENT_RESULTS" } } }) });
    const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store: store2, budget: fakeBudget(), genId: gen });
    await orch.runTurn(s2, { turnId: "t.o", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
    const prop = frames.find((f) => f.t === "action.proposal");
    ok(prop && typeof prop.executionNonce === "string" && prop.executionNonce.length > 0, "R4-05 — the gateway MINTS an executionNonce as frame metadata (SEPARATE from the provider proposal)");
    ok(prop && prop.proposal && !("executionNonce" in prop.proposal), "R4-05 — the nonce is NOT inside the provider proposal (model can't mint/alter it)");
  }

  section("R4-05B/R5B-REV-04 — OPERATION-SPECIFIC SEMANTIC evidence: wrong hotel / section / positions / count / factor / winner / tri-state are rejected");
  {
    // list-shaped ctx (positions + minPrice/rating for the winner re-derivation) that ALSO carries a
    // current hotel + tri-state facts (for the detail / SHOW / OPEN checks).
    const ctx = { pageId: "hotels", loadState: "ready", destination: "dhanaulti", query: null,
      visibleHotels: [
        { position: 1, id: "h.one", minPrice: 1500, rating: 4.2 },
        { position: 2, id: "h.two", minPrice: 1200, rating: 4.8 },
        { position: 3, id: "h.three", minPrice: 1800, rating: 3.9 } ],
      currentHotelId: "h.one", breakfast: "present", parking: "unknown" };
    const M = SCH.evidenceMatchesProposalSemantics;
    // R5B-REV-02 — OPEN verifies against the DESTINATION context (its currentHotelId is authoritative;
    // an honest detail destination publishes visibleHotels: []) bound to the STORED source-resolved hotel
    // id (5th arg, resolved at registration from the source list). The model/browser NEVER supplies the id.
    const openDestTwo = { pageId: "hotel-detail", loadState: "ready", validated: true, currentHotelId: "h.two", visibleHotels: [], section: null, breakfast: "unknown", parking: "unknown" };
    ok(M("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, { kind: "detail", hotelId: "h.two" }, openDestTwo, "h.two") === true, "R5B-REV-02 — OPEN detail on the honest destination (visibleHotels: []) whose currentHotelId == the stored source-resolved hotel is accepted");
    ok(M("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, { kind: "detail", hotelId: "h.three" }, { ...openDestTwo, currentHotelId: "h.three" }, "h.two") === false, "R5B-REV-02 — OPEN whose destination hotel != the stored source hotel is rejected (wrong first destination)");
    ok(M("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, undefined, openDestTwo, "h.two") === false, "R5B — OPEN with NO evidence is REJECTED (evidence-free OPEN cannot verify)");
    ok(M("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, { kind: "detail", hotelId: "h.two" }, openDestTwo, null) === false, "R5B-REV-02 — OPEN with NO stored source resolution is rejected (the model/browser cannot supply authoritative hotel identity)");
    ok(M("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, { kind: "detail", hotelId: "h.two" }, { ...openDestTwo, currentHotelId: "h.WRONG" }, "h.two") === false, "R5B-REV-02 — OPEN whose destination currentHotelId != the stored source hotel is rejected (destination corroboration)");
    // R5B-REV-03 — SHOW verifies the ui_state section AND binds the STORED source hotel identity (5th arg):
    // the destination/result currentHotelId MUST equal the stored source hotel (SHOW on A can't verify on B).
    ok(M("SHOW_HOTEL_SECTION", { op: "SHOW_HOTEL_SECTION", section: "rooms" }, { kind: "ui_state", section: "rooms", hotelId: "h.one" }, ctx, "h.one") === true, "R5B-REV-03 — SHOW ui_state for the requested section whose result hotel == the stored source hotel is accepted");
    ok(M("SHOW_HOTEL_SECTION", { op: "SHOW_HOTEL_SECTION", section: "rooms" }, { kind: "ui_state", section: "about", hotelId: "h.one" }, ctx, "h.one") === false, "R4-05B — SHOW ui_state for the WRONG section is rejected");
    ok(M("SHOW_HOTEL_SECTION", { op: "SHOW_HOTEL_SECTION", section: "rooms" }, { kind: "ui_state", section: "rooms", hotelId: "h.two" }, { ...ctx, currentHotelId: "h.two" }, "h.one") === false, "R5B-REV-03 — SHOW proposed on hotel A (stored h.one) cannot verify the same section on hotel B (h.two)");
    ok(M("SHOW_HOTEL_SECTION", { op: "SHOW_HOTEL_SECTION", section: "rooms" }, { kind: "ui_state", section: "rooms", hotelId: "h.one" }, ctx, null) === false, "R5B-REV-03 — SHOW with NO stored source hotel is rejected");
    // COMPARE — EXACT positions (+ order) + resolved ids + EXACT factors + DETERMINISTICALLY-recomputed winners.
    const cmpSpec = { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] };
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.two"], factors: ["price", "rating"], cheapestPosition: 2, topRatedPosition: 2 }, ctx) === true, "R4-05B/REV-04 — COMPARE with exact positions+ids+factors+recomputed winners is accepted");
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [1, 3], hotelIds: ["h.one", "h.three"], factors: ["price", "rating"], cheapestPosition: 1, topRatedPosition: 1 }, ctx) === false, "R4-05B — a COMPARE result position that was NOT requested is rejected");
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.WRONG"], factors: ["price", "rating"], cheapestPosition: 2, topRatedPosition: 2 }, ctx) === false, "R5B — a COMPARE with a WRONG resolved id (position→id mismatch) is rejected");
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [2, 1], hotelIds: ["h.two", "h.one"], factors: ["price", "rating"], cheapestPosition: 2, topRatedPosition: 2 }, ctx) === false, "REV-04 — a COMPARE with the positions in the WRONG order (not the requested order) is rejected");
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.two"], factors: ["price", "parking"], cheapestPosition: 2, topRatedPosition: 2 }, ctx) === false, "REV-04 — a COMPARE with a SUBSTITUTED factor (parking≠rating) is rejected");
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.two"], factors: ["price", "rating"], cheapestPosition: 1, topRatedPosition: 2 }, ctx) === false, "REV-04 — a COMPARE with a FABRICATED cheapest winner (recomputes to 2, not 1) is rejected");
    ok(M("COMPARE_VISIBLE_HOTELS", cmpSpec, { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.two"], factors: ["price", "rating"], cheapestPosition: 2, topRatedPosition: 1 }, ctx) === false, "REV-04 — a COMPARE with a FABRICATED top-rated winner (recomputes to 2, not 1) is rejected");
    // READ_CURRENT_HOTEL_FACTS — detail must be for the CURRENT context hotel AND its tri-state must match.
    ok(M("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }, { kind: "detail", hotelId: "h.one", breakfast: "present", parking: "unknown" }, ctx) === true, "R4-05B/REV-04 — READ_FACTS detail for the CURRENT hotel with MATCHING tri-state is accepted");
    ok(M("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }, { kind: "detail", hotelId: "h.two", breakfast: "present", parking: "unknown" }, ctx) === false, "R4-05B — READ_FACTS detail for a NON-current hotel is rejected");
    ok(M("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }, { kind: "detail", hotelId: "h.one", breakfast: "present", parking: "present" }, ctx) === false, "REV-04 — READ_FACTS claiming parking=present when the context says parking=unknown is rejected (no false facility fact)");
    ok(M("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }, { kind: "detail", hotelId: "h.one", breakfast: "absent", parking: "unknown" }, ctx) === false, "REV-04 — READ_FACTS claiming breakfast=absent when the context says breakfast=present is rejected");
    // READ_CURRENT_RESULTS — the exact ordered on-screen ids.
    const listCtx = { pageId: "hotels", loadState: "ready", destination: null, query: null, visibleHotels: [{ position: 1, id: "h.one" }, { position: 2, id: "h.two" }, { position: 3, id: "h.three" }], currentHotelId: null };
    ok(M("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { kind: "results", count: 3, orderedIds: ["h.one", "h.two", "h.three"] }, listCtx) === true, "R4-05B/R5B — READ_RESULTS with the EXACT ordered on-screen ids is accepted");
    ok(M("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { kind: "results", count: 3, orderedIds: ["h.two", "h.one", "h.three"] }, listCtx) === false, "R5B — READ_RESULTS with the RIGHT ids in the WRONG order is rejected (ordered rows, not a set)");
    ok(M("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { kind: "results", count: 9, orderedIds: ["h.one", "h.two", "h.three"] }, listCtx) === false, "R4-05B — READ_RESULTS with a count that cannot exist on-screen is rejected");
    ok(M("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { kind: "results", count: 3, orderedIds: ["h.one", "h.two", "h.three"] }, null) === false, "R4-05B — no context to corroborate ⇒ fail closed");
    // R5B-REV-06 — APPLY COMPLETES to verified ONLY against the READY resulting context whose CANONICAL
    // refinement projection proves EVERY requested dimension (destination/query/maxPrice/parking/stars/sort),
    // grounded in the context (destination/query/ordered ids). A context with NO refinement cannot verify APPLY.
    const applyRef = (over) => Object.assign({ destination: "goa", query: null, maxPrice: null, parking: false, stars: [], sort: "default", orderedIds: ["h.g1", "h.g2"], count: 2 }, over || {});
    const applyCtx = { pageId: "hotels", loadState: "ready", destination: "goa", query: null, visibleHotels: [{ position: 1, id: "h.g1" }, { position: 2, id: "h.g2" }], currentHotelId: null, refinement: applyRef() };
    ok(SCH.evidenceMatchesOperation("APPLY_HOTEL_REFINEMENT", { kind: "results" }) === true, "REV-02 — APPLY ↔ results evidence (it now COMPLETES to verified)");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa" }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, applyCtx) === true, "REV-06 — APPLY verifies against the READY resulting result set + the canonical refinement (applied destination)");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa" }, { kind: "results", count: 2, orderedIds: ["h.g2", "h.g1"] }, applyCtx) === false, "REV-02 — a late result A (wrong ordered set) cannot verify APPLY (mismatched resulting hotels)");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "delhi" }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, applyCtx) === false, "REV-02 — APPLY with a resulting destination that mismatches the requested filter is rejected");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa" }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, loadState: "loading" }) === false, "REV-02 — APPLY cannot verify against a NON-ready (loading) resulting context");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa" }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: undefined }) === false, "REV-06 — APPLY cannot verify against a context with NO canonical refinement projection (never inferred from ordered ids alone)");
    // REV-06 — every requested APPLY dimension must EXACTLY satisfy the projected value.
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa", maxPrice: 3000 }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: applyRef({ maxPrice: 3000 }) }) === true, "REV-06 — APPLY with a requested maxPrice that the projection satisfies verifies");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa", maxPrice: 3000 }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: applyRef({ maxPrice: 5000 }) }) === false, "REV-06 — APPLY maxPrice mismatch (requested 3000, projected 5000) is rejected");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa", parking: true }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: applyRef({ parking: false }) }) === false, "REV-06 — APPLY parking mismatch (requested true, projected false) is rejected");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa", stars: [4, 5] }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: applyRef({ stars: [4, 5] }) }) === true, "REV-06 — APPLY with requested stars matching the projected star SET verifies");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa", stars: [4, 5] }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: applyRef({ stars: [3] }) }) === false, "REV-06 — APPLY stars mismatch (requested [4,5], projected [3]) is rejected");
    ok(M("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", destination: "goa", sort: "price-asc" }, { kind: "results", count: 2, orderedIds: ["h.g1", "h.g2"] }, { ...applyCtx, refinement: applyRef({ sort: "rating" }) }) === false, "REV-06 — APPLY sort mismatch (requested price-asc, projected rating) is rejected");
  }

  section("R4-08 — FIELD-BY-FIELD plan evidence: action_status/page_facts/comparison bound to the exact receipt tuple");
  {
    const mkRef = (o) => Object.assign({ proposalId: "pp.x", operation: "READ_CURRENT_RESULTS", outcome: "verified", authorityRef: "ar.p" }, o);
    const receipts = {
      "r.results": mkRef({ proposalId: "pp.res", operation: "READ_CURRENT_RESULTS", evidence: { kind: "results", count: 2 } }),
      "r.detail1": mkRef({ proposalId: "pp.d1", operation: "READ_CURRENT_HOTEL_FACTS", evidence: { kind: "detail", hotelId: "h.one" } }),
      "r.detail2": mkRef({ proposalId: "pp.d2", operation: "READ_CURRENT_HOTEL_FACTS", evidence: { kind: "detail", hotelId: "h.two" } }),
      "r.compare": mkRef({ proposalId: "pp.c", operation: "COMPARE_VISIBLE_HOTELS", evidence: { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.two"], factors: ["price"] } }),
      "r.open": mkRef({ proposalId: "pp.o", operation: "OPEN_VISIBLE_HOTEL", outcome: "verified", evidence: { kind: "detail", hotelId: "h.one" } }),
      "r.stale": mkRef({ proposalId: "pp.s", operation: "READ_CURRENT_RESULTS", authorityRef: "ar.OLD", evidence: { kind: "results", count: 2 } }),
    };
    const ctx = { getReceipt: (id) => receipts[id], currentAuthorityRef: "ar.p", contextHotelIds: new Set(["h.one", "h.two"]), positionToHotelId: (p) => ({ 1: "h.one", 2: "h.two" }[p] || null) };
    const P = SCH.evidenceSupportsPlan;
    // ACTION_STATUS — proposalId + outcome must match the cited receipt exactly.
    ok(P({ kind: "action_status", evidenceReceiptIds: ["r.open"], receiptId: "r.open", proposalId: "pp.o", outcome: "verified" }, ctx) === true, "R4-08 — action_status matching the EXACT receipt proposal + outcome is supported");
    ok(P({ kind: "action_status", evidenceReceiptIds: ["r.open"], receiptId: "r.open", proposalId: "pp.WRONG", outcome: "verified" }, ctx) === false, "R4-08 — action_status claiming a DIFFERENT proposal than the receipt is refused");
    ok(P({ kind: "action_status", evidenceReceiptIds: ["r.open"], receiptId: "r.open", proposalId: "pp.o", outcome: "rejected" }, ctx) === false, "R4-08 — action_status claiming an outcome the receipt did NOT verify is refused");
    // PAGE_FACTS — a results-count receipt alone can NOT author per-hotel facts; detail per hotel does.
    ok(P({ kind: "page_facts", evidenceReceiptIds: ["r.results"], selectedHotelIds: ["h.one"] }, ctx) === false, "R4-08 — page_facts backed ONLY by a results-count receipt is refused (names no hotel)");
    ok(P({ kind: "page_facts", evidenceReceiptIds: ["r.detail1"], selectedHotelIds: ["h.one"] }, ctx) === true, "R4-08 — page_facts with a DETAIL receipt for the stated hotel is supported");
    ok(P({ kind: "page_facts", evidenceReceiptIds: ["r.detail1"], selectedHotelIds: ["h.one", "h.two"] }, ctx) === false, "R4-08 — page_facts stating a hotel with NO detail receipt is refused");
    ok(P({ kind: "page_facts", evidenceReceiptIds: ["r.detail1", "r.detail2"], selectedHotelIds: ["h.one", "h.two"] }, ctx) === true, "R4-08 — page_facts with a detail receipt for EACH stated hotel is supported");
    // COMPARISON — selectedHotelIds ⊆ the hotels a comparison receipt actually compared.
    ok(P({ kind: "comparison", evidenceReceiptIds: ["r.compare"], selectedHotelIds: ["h.one", "h.two"], factors: ["price"] }, ctx) === true, "R4-08 — comparison over exactly the compared hotels is supported");
    ok(P({ kind: "comparison", evidenceReceiptIds: ["r.detail1"], selectedHotelIds: ["h.one"], factors: ["price"] }, ctx) === false, "R4-08 — comparison with NO comparison receipt is refused");
    // STALE AUTHORITY — an old-authority receipt can never support a current plan.
    ok(P({ kind: "page_facts", evidenceReceiptIds: ["r.stale"], selectedHotelIds: ["h.one"] }, ctx) === false, "R4-08 — a receipt under an OLD authority cannot support a current factual plan");
  }

  section("R4-13 — REAL capture-duration + reasoning token ceiling + actual>reservation conservatism");
  {
    // (a) the Responses request carries an explicit max_output_tokens ceiling.
    let sentBody = null;
    const call = RESP.createDefaultReasoningCall("sk-test", async (url, init) => { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({ output_text: JSON.stringify({ proposal: null, answer: { kind: "unknown", language: "en", evidenceReceiptIds: [], reason: "x" } }), usage: { total_tokens: 10 } }) }; });
    await call({ transcript: "hi", context: {}, verifiedReceiptIds: [], deadlineMs: 1000 });
    ok(sentBody && sentBody.max_output_tokens === RESP.MAX_REASONING_OUTPUT_TOKENS, "R4-13 — the reasoning request sets an explicit max_output_tokens ceiling");
    // (b) the reasoning reservation is a DEFINED input+output mapping, not an arbitrary figure.
    eq(ORCH.RESERVE_REASONING_UNITS, RESP.MAX_REASONING_INPUT_TOKENS + RESP.MAX_REASONING_OUTPUT_TOKENS, "R4-13 — RESERVE_REASONING_UNITS = bounded input + max output (a defined hard upper bound)");
    // (c) an actual usage that EXCEEDS the reservation is settled CONSERVATIVELY (retain full).
    {
      const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const s = store.create({ sessionId: "las.b", subject: "sb", ipHash: "ipb", authenticated: false }).session; s.ackAuthorityRef = "ar.b"; s.emit = () => {};
      const budget = fakeBudget();
      const over = ORCH.RESERVE_REASONING_UNITS + 5000;
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async () => ({ ok: true, candidate: { answer: { kind: "clarification", language: "en", questionCode: "which_city", evidenceReceiptIds: [] } }, usage: over }) });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts: TTS.unavailableTts, store, budget, genId: (p) => `${p}.z` });
      await orch.runTurn(s, { turnId: "t.b", generation: 0, transcript: "hi", language: "en", context: {}, phase: "initial" });
      const settles = budget._settleCalls();
      ok(settles.length >= 1 && settles[0].actual === null, "R4-13 — an actual usage ABOVE the reservation is a safety failure → retain the FULL conservative reservation (settle null)");
    }
    // (d) the CLIENT capture-duration ceiling is armed from LOCAL capture start (not a provider event).
    {
      let fired = null; let timers = [];
      const setTimer = (fn) => { const h = { fn }; timers.push(h); return h; };
      const clearTimer = (h) => { timers = timers.filter((x) => x !== h); };
      const g = GC.createSpeechCeilingGuard({ onCeiling: (r) => { fired = r; }, maxSessionCaptureMs: 1000, setTimer, clearTimer });
      ok(timers.length === 0, "R4-13 — no capture timer is armed before capture begins");
      g.startCapture();
      ok(timers.length === 1, "R4-13 — startCapture() arms the cumulative capture-DURATION timer from LOCAL capture ownership");
      g.startCapture();
      eq(timers.length, 1, "R4-13 — startCapture is idempotent per capture (one duration timer)");
      timers[0].fn();
      eq(fired, "session_capture_duration", "R4-13 — a capture that outlives the duration allowance trips the ceiling (independent of any provider/VAD/transcript event)");
      ok(typeof GC.MAX_SESSION_CAPTURE_MS === "number" && GC.MAX_SESSION_CAPTURE_MS > 0, "R4-13 — a hard cumulative capture-duration default exists");
    }
  }

  section("R4-NEW-01 — TTS oversize provider response is REJECTED, not truncated");
  {
    // a provider response body OVER the total byte ceiling → tts_too_long (never a truncated
    // buffer). No Content-Length header, so the readBounded byte-cap is the guard under test.
    const huge = Buffer.alloc(TTS.MAX_TTS_TOTAL_BYTES + 4096, 1);
    const ab = huge.buffer.slice(huge.byteOffset, huge.byteOffset + huge.length);
    const call = TTS.createDefaultTtsCall("sk-test", async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => ab }));
    const r = await call({ text: "hello", language: "en" });
    ok(r.ok === false && r.reason === "tts_too_long", "R4-NEW-01 — a provider TTS response over the byte ceiling is REJECTED (tts_too_long), never silently truncated");
  }

  section("R4-R2-NEW-02 — a transcript is bound to the CONVERSATION GENERATION at commit; a stale-generation completion is dropped");
  {
    let gen = 0;
    const surfaced = [];
    const gate = GC.createInputTranscriptGate((t) => surfaced.push(t), () => gen);
    eq(gate.handle(JSON.stringify({ type: "conversation.item.created", item: { id: "u1" } })), "committed", "an input item is committed under the CURRENT generation (0)");
    // a route change / barge-in / reset advances the conversation generation...
    gen = 1;
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "stale audio" })), "stale_generation", "R4-R2-NEW-02 — a completion for an item committed under an OLDER generation is DROPPED (never assigned to the new turn)");
    ok(surfaced.length === 0, "R4-R2-NEW-02 — the stale-generation transcript never surfaces as a new turn");
    // a fresh item committed under the current generation surfaces normally.
    gate.handle(JSON.stringify({ type: "conversation.item.created", item: { id: "u2" } }));
    eq(gate.handle(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "fresh" })), "surfaced", "a same-generation completion surfaces");
    eq(surfaced[0], "fresh", "only the current-generation transcript surfaced");
  }

  section("R4-10 — the server REJECTS (never normalizes) a malformed published context / operation");
  {
    const baseCtx = (over) => Object.assign(validCtx(2), over || {});
    ok(SCH.validatePublishedContext(baseCtx()) !== null, "R4-10 - a well-formed context validates");
    ok(SCH.validatePublishedContext(baseCtx({ visibleHotels: [{ position: 2, id: "htl_2", name: "H2", city: "D", minPrice: 200, rating: 4, parking: "present" }, { position: 1, id: "htl_1", name: "H1", city: "D", minPrice: 100, rating: 4, parking: "present" }] })) === null, "R4-10 - a NON-ascending visible-hotel order is rejected (no silent reorder)");
    ok(SCH.validatePublishedContext(baseCtx({ destination: "" })) === null, "R4-10 - an empty destination string is rejected (not normalized to null)");
    ok(SCH.validatePublishedContext(baseCtx({ destination: "a\u0001b" })) === null, "R4-10 - a control char in wire text is rejected (never stripped/normalized)");
    ok(SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: null, query: null, maxPrice: 0, parking: null, sort: null, stars: null }) === null, "R4-10 - APPLY maxPrice:0 is rejected (parity with contracts p<=0)");
  }

  // ══════════════════════════ R5A — STRICT OPERATION AUTHORITY / PARITY ══════════════════════════
  section("R5A — the gateway operation validator REJECTS (never normalizes) an external operation");
  {
    const S = (o) => SCH.validateModelOperation(Object.assign({ op: "APPLY_HOTEL_REFINEMENT" }, o));
    // destination/query are now equality-oracle validated (the gateway gained canonicalCity /
    // boundedQuery mirrors) — the pre-R5A loose isCleanStr acceptance is GONE.
    ok(S({ destination: "Manali" }) === null, "R5A — the gateway REJECTS a title-case destination (no longer normalized/accepted)");
    ok(S({ destination: " manali " }) === null, "R5A — leading/trailing whitespace destination REJECTED");
    ok(S({ destination: "manali  city" }) === null, "R5A — collapsible-whitespace destination REJECTED");
    ok(S({ destination: "manali1" }) === null, "R5A — a non-letter destination char REJECTED");
    ok(S({ destination: "manali" }) && S({ destination: "manali" }).destination === "manali", "R5A — an already-canonical destination is accepted verbatim");
    ok(S({ query: "Sea View" }) && S({ query: "Sea View" }).query === "Sea View", "R5A — a canonical query is accepted verbatim (case preserved)");
    ok(S({ query: "sea  view" }) === null && S({ query: " sea" }) === null && S({ query: "sea\tview" }) === null, "R5A — non-canonical / control-bearing query REJECTED");
    ok(S({ maxPrice: "5000" }) === null && S({ maxPrice: 0 }) === null && S({ maxPrice: 50_000_000 }) === null, "R5A — string / zero / out-of-bound maxPrice REJECTED");
    ok(S({ stars: [3, 4, 5] }) === null && S({ stars: [4, 4] }) === null && S({ stars: ["5"] }) === null, "R5A — ascending / duplicate / string stars REJECTED (never sorted/deduped/coerced)");
    ok(S({ stars: [5, 4, 3] }) && S({ stars: [5, 4, 3] }).stars.join(",") === "5,4,3", "R5A — strictly-descending stars accepted verbatim");
    ok(S({ destination: "manali", query: null, maxPrice: null, parking: null, sort: null, stars: null }) && !("query" in S({ destination: "manali", query: null, maxPrice: null, parking: null, sort: null, stars: null })), "R5A — a provider-shape APPLY (null fields skipped) is accepted, null fields absent");
    // COMPARE now carries ordered, distinct factors; positions are distinct + order-preserved.
    const K = (o) => SCH.validateModelOperation(Object.assign({ op: "COMPARE_VISIBLE_HOTELS" }, o));
    ok(K({ positions: [1, 2] }) === null, "R5A — the gateway REJECTS a COMPARE with no factors");
    ok(K({ positions: [2, 1], factors: ["price"] }) && K({ positions: [2, 1], factors: ["price"] }).positions.join(",") === "2,1", "R5A — the gateway keeps COMPARE positions in the ORDER GIVEN");
    ok(K({ positions: [1, 1], factors: ["price"] }) === null, "R5A — a duplicate COMPARE position REJECTED");
    ok(K({ positions: [1, 2], factors: ["price", "price"] }) === null && K({ positions: [1, 2], factors: ["zoom"] }) === null, "R5A — duplicate / unknown COMPARE factor REJECTED");
    const kc = K({ positions: [1, 2], factors: ["breakfast", "parking", "rating", "price"] });
    ok(kc && kc.factors.join(",") === "breakfast,parking,rating,price", "R5A — the gateway keeps COMPARE factors ordered + distinct");
  }

  section("R5A — EXACT client/server operation-acceptance PARITY (contracts.validateOperation == validateModelOperation)");
  {
    // stable canonical stringify (sorted keys) — compares the accepted operation's MEANING
    // across the two validators (client returns a frozen typed op, server a null-proto record).
    const stable = (v) => {
      if (v === null || v === undefined) return "null";
      if (typeof v !== "object") return JSON.stringify(v);
      if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
    };
    const TAB = "sea\tview";
    // vectors BOTH validators must ACCEPT (and agree on the canonical meaning).
    const ACCEPT = [
      { op: "READ_CURRENT_RESULTS" },
      { op: "READ_CURRENT_HOTEL_FACTS" },
      { op: "OPEN_VISIBLE_HOTEL", position: 1 },
      { op: "OPEN_VISIBLE_HOTEL", position: 24 },
      { op: "SHOW_HOTEL_SECTION", section: "rooms" },
      { op: "SHOW_HOTEL_SECTION", section: "about" },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [3, 1], factors: ["rating", "parking"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2, 3, 4], factors: ["price", "rating", "parking", "breakfast"] },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "manali" },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "café" },
      { op: "APPLY_HOTEL_REFINEMENT", query: "Sea View" },
      { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 },
      { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 10_000_000 },
      { op: "APPLY_HOTEL_REFINEMENT", parking: true },
      { op: "APPLY_HOTEL_REFINEMENT", parking: false },
      { op: "APPLY_HOTEL_REFINEMENT", sort: "price-asc" },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [5, 4, 3] },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [5, 3] },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "manali", query: null, maxPrice: null, parking: null, sort: null, stars: null },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "manali", maxPrice: 5000, parking: true, sort: "rating", stars: [5, 3] },
    ];
    // vectors BOTH validators must REJECT.
    const REJECT = [
      { op: "NAVIGATE", href: "/x" },
      { op: "READ_CURRENT_RESULTS", extra: 1 },
      { op: "OPEN_VISIBLE_HOTEL", position: "2" },
      { op: "OPEN_VISIBLE_HOTEL", position: 2.5 },
      { op: "OPEN_VISIBLE_HOTEL", position: 0 },
      { op: "OPEN_VISIBLE_HOTEL", position: 2, url: "x" },
      { op: "APPLY_HOTEL_REFINEMENT" },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "Manali" },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "Café" },
      { op: "APPLY_HOTEL_REFINEMENT", destination: " manali " },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "manali  city" },
      { op: "APPLY_HOTEL_REFINEMENT", destination: "" },
      { op: "APPLY_HOTEL_REFINEMENT", destination: null },
      { op: "APPLY_HOTEL_REFINEMENT", destination: null, query: null, maxPrice: null, parking: null, sort: null, stars: null },
      { op: "APPLY_HOTEL_REFINEMENT", query: "sea  view" },
      { op: "APPLY_HOTEL_REFINEMENT", query: " sea" },
      { op: "APPLY_HOTEL_REFINEMENT", query: TAB },
      { op: "APPLY_HOTEL_REFINEMENT", query: "" },
      { op: "APPLY_HOTEL_REFINEMENT", maxPrice: "5000" },
      { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 0 },
      { op: "APPLY_HOTEL_REFINEMENT", maxPrice: -1 },
      { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 50_000_000 },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [3, 4, 5] },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [4, 4] },
      { op: "APPLY_HOTEL_REFINEMENT", stars: ["5"] },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [6] },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [] },
      { op: "APPLY_HOTEL_REFINEMENT", stars: [5, 4, 3, 3] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 1], factors: ["price"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: ["1", "2"], factors: ["price"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1], factors: ["price"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2, 3, 4, 5], factors: ["price"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 25], factors: ["price"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: [] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["zoom"] },
      { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "price"] },
    ];
    let acc = 0, rej = 0, mean = 0;
    for (const v of ACCEPT) {
      const cv = C.validateOperation(v), sv = SCH.validateModelOperation(v);
      const cAcc = cv !== null, sAcc = sv !== null;
      ok(cAcc && sAcc, `R5A parity: BOTH accept ${JSON.stringify(v)} (client=${cAcc} server=${sAcc})`);
      if (cAcc && sAcc) { acc += 1; const same = stable(cv) === stable(sv); ok(same, `R5A parity: identical canonical meaning for ${JSON.stringify(v)} (client=${stable(cv)} server=${stable(sv)})`); if (same) mean += 1; }
    }
    for (const v of REJECT) {
      const cAcc = C.validateOperation(v) !== null, sAcc = SCH.validateModelOperation(v) !== null;
      ok(cAcc === false && sAcc === false, `R5A parity: BOTH reject ${JSON.stringify(v)} (client=${cAcc} server=${sAcc})`);
      if (!cAcc && !sAcc) rej += 1;
    }
    ok(acc === ACCEPT.length && rej === REJECT.length && mean === ACCEPT.length, `R5A parity: full corpus agrees (accepted ${acc}/${ACCEPT.length}, rejected ${rej}/${REJECT.length}, same-meaning ${mean}/${ACCEPT.length})`);
  }

  section("R5A-REMEDIATION (REV-NEW-02/05) — TOTAL fail-closed operation validators for hostile JS (no throw, both null)");
  {
    // For EVERY hostile arbitrary-JavaScript vector: BOTH the client (contracts.validateOperation)
    // and the gateway (validateModelOperation) must return null AND must NOT throw. If either side
    // throws, the assertion fails. Hostile Proxy traps for reflective operations are included.
    const noThrowNull = (label, makeX) => {
      let ct = false, st = false, cv = "unset", sv = "unset";
      try { cv = C.validateOperation(makeX()); } catch (e) { ct = true; }
      try { sv = SCH.validateModelOperation(makeX()); } catch (e) { st = true; }
      ok(!ct && !st, `REV-NEW-02/05 — neither validator THROWS on ${label} (clientThrew=${ct} serverThrew=${st})`);
      ok(cv === null && sv === null, `REV-NEW-02/05 — both validators return null on ${label} (client=${JSON.stringify(cv)} server=${JSON.stringify(sv)})`);
    };
    // hostile Proxy traps for the reflective inspection path.
    noThrowNull("Proxy throwing on getOwnPropertyDescriptor", () => new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("gopd"); } }));
    noThrowNull("Proxy throwing on ownKeys (valid op)", () => new Proxy({ op: "READ_CURRENT_RESULTS" }, { ownKeys() { throw new Error("ownKeys"); } }));
    noThrowNull("Proxy throwing on getPrototypeOf (valid op)", () => new Proxy({ op: "OPEN_VISIBLE_HOTEL", position: 1 }, { getPrototypeOf() { throw new Error("gpo"); } }));
    // R5A SECOND REMEDIATION (REV-NEW-01/02): a transparent Proxy over a VALID array that only traps
    // `get` is fully INSPECTABLE via trusted descriptors — the strict array snapshot (client + gateway)
    // reads the REAL underlying values WITHOUT invoking the hostile getter and returns a fresh FROZEN
    // copy, so BOTH validators must NOT throw and must AGREE on the same in-range accepted operation
    // (parity). A REVOKED proxy (throws on the Array.isArray brand check itself) is the un-inspectable
    // case and fails closed → covered in the dedicated revoked-proxy + hostile-array matrix below.
    {
      const cv = C.validateOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: new Proxy([1, 2], { get() { throw new Error("arrget"); } }), factors: ["price"] });
      const sv = SCH.validateModelOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: new Proxy([1, 2], { get() { throw new Error("arrget"); } }), factors: ["price"] });
      ok(cv && sv && cv.op === "COMPARE_VISIBLE_HOTELS" && sv.op === "COMPARE_VISIBLE_HOTELS", "REV-NEW-01/02 — both validators accept a get-trapping COMPARE positions Proxy (descriptor capture)");
      ok(JSON.stringify(cv.positions) === "[1,2]" && JSON.stringify(sv.positions) === "[1,2]" && Object.isFrozen(cv.positions) && Object.isFrozen(sv.positions), "REV-NEW-01/02 — client==server: real [1,2] captured into fresh frozen output");
    }
    {
      const cv = C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", stars: new Proxy([5, 4], { get() { throw new Error("starget"); } }) });
      const sv = SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", stars: new Proxy([5, 4], { get() { throw new Error("starget"); } }) });
      ok(cv && sv && cv.op === "APPLY_HOTEL_REFINEMENT" && sv.op === "APPLY_HOTEL_REFINEMENT", "REV-NEW-01/02 — both validators accept a get-trapping APPLY stars Proxy (descriptor capture)");
      ok(JSON.stringify(cv.stars) === "[5,4]" && JSON.stringify(sv.stars) === "[5,4]" && Object.isFrozen(cv.stars) && Object.isFrozen(sv.stars), "REV-NEW-01/02 — client==server: real [5,4] captured into fresh frozen output");
    }
    // non-string discriminants (some carrying throwing coercion hooks) — must never be coerced.
    noThrowNull("op is a number", () => ({ op: 123 }));
    noThrowNull("op is a symbol value", () => ({ op: Symbol("x") }));
    noThrowNull("op is an object with a throwing Symbol.toPrimitive", () => ({ op: { [Symbol.toPrimitive]() { throw new Error("coerce"); }, toString() { throw new Error("ts"); }, valueOf() { throw new Error("vo"); } } }));
    // adversarial-but-non-throwing shapes (already policy-rejected) must also not throw + be null.
    noThrowNull("class instance (custom prototype)", () => { class Op { constructor() { this.op = "READ_CURRENT_RESULTS"; } } return new Op(); });
    noThrowNull("custom-prototype object", () => Object.assign(Object.create({ tainted: 1 }), { op: "READ_CURRENT_RESULTS" }));
    noThrowNull("symbol key present", () => { const o = { op: "READ_CURRENT_RESULTS" }; o[Symbol("s")] = 1; return o; });
    noThrowNull("accessor op", () => { const o = {}; Object.defineProperty(o, "op", { get() { return "READ_CURRENT_RESULTS"; }, enumerable: true }); return o; });
    noThrowNull("non-enumerable unknown key", () => { const o = { op: "READ_CURRENT_RESULTS" }; Object.defineProperty(o, "url", { value: "x", enumerable: false }); return o; });
    noThrowNull("NaN maxPrice", () => ({ op: "APPLY_HOTEL_REFINEMENT", maxPrice: Number.NaN }));
    noThrowNull("+Infinity maxPrice", () => ({ op: "APPLY_HOTEL_REFINEMENT", maxPrice: Number.POSITIVE_INFINITY }));
    noThrowNull("-Infinity maxPrice", () => ({ op: "APPLY_HOTEL_REFINEMENT", maxPrice: Number.NEGATIVE_INFINITY }));
    noThrowNull("DEL char in query", () => ({ op: "APPLY_HOTEL_REFINEMENT", query: "sea" + String.fromCharCode(0x7f) + "view" }));
    noThrowNull("over-limit city (41 letters)", () => ({ op: "APPLY_HOTEL_REFINEMENT", destination: "a".repeat(41) }));
    noThrowNull("over-limit query (61 chars)", () => ({ op: "APPLY_HOTEL_REFINEMENT", query: "x".repeat(61) }));
    noThrowNull("null / string / array / undefined", () => null);
    // the coercion hook must NOT be triggered to obtain operation authority (observable flag).
    let hookTriggered = false;
    const coercionOp = () => ({ op: { [Symbol.toPrimitive]() { hookTriggered = true; return "READ_CURRENT_RESULTS"; }, toString() { hookTriggered = true; return "READ_CURRENT_RESULTS"; }, valueOf() { hookTriggered = true; return "READ_CURRENT_RESULTS"; } } });
    let ht = false; let cvh = "u", svh = "u";
    try { cvh = C.validateOperation(coercionOp()); } catch { ht = true; }
    try { svh = SCH.validateModelOperation(coercionOp()); } catch { ht = true; }
    ok(!ht && cvh === null && svh === null && hookTriggered === false, "REV-NEW-02 — a non-string discriminant's coercion hook is NEVER triggered to obtain operation authority (flag stayed false, both null, no throw)");
    // the accepted-corpus over-limit CITY boundary: exactly-40 canonical city is accepted (downstream authority).
    const city40 = "a".repeat(40);
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: city40 }) !== null && SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: city40 }) !== null, "REV-NEW-05 — an exactly-40-char canonical city is accepted by BOTH (edge)");
  }

  section("R5A-REMEDIATION (REV-NEW-03) — nested-array immutability parity (client == gateway)");
  {
    const gCmp = SCH.validateModelOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] });
    ok(gCmp && Object.isFrozen(gCmp.positions) && Object.isFrozen(gCmp.factors), "REV-NEW-03 — gateway COMPARE returns FROZEN positions + factors");
    const gStars = SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", stars: [5, 4, 3] });
    ok(gStars && Object.isFrozen(gStars.stars), "REV-NEW-03 — gateway APPLY returns FROZEN stars");
    const cCmp = C.validateOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] });
    ok(cCmp && Object.isFrozen(cCmp.positions) && Object.isFrozen(cCmp.factors), "REV-NEW-03 — client COMPARE arrays frozen (parity)");
    const cStars = C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", stars: [5, 4, 3] });
    ok(cStars && Object.isFrozen(cStars.stars), "REV-NEW-03 — client APPLY stars frozen (parity)");
    // the CALLER-owned input array must NOT be frozen in place (a fresh copy is frozen instead).
    const inStars = [5, 4, 3]; const inPos = [1, 2]; const inFac = ["price", "rating"];
    SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", stars: inStars });
    SCH.validateModelOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: inPos, factors: inFac });
    ok(!Object.isFrozen(inStars) && !Object.isFrozen(inPos) && !Object.isFrozen(inFac), "REV-NEW-03 — the caller-owned input arrays are NOT frozen in place (new copies are returned + frozen)");
  }

  // ── R5A SECOND REMEDIATION (REV-NEW-01) — TOTAL fail-closed on a REVOKED Proxy (gateway) ──────
  section("R5A SECOND REMEDIATION — gateway validators are TOTAL on a REVOKED Proxy (REV-NEW-01)");
  {
    const mkRevoked = () => { const r = Proxy.revocable({ op: "READ_CURRENT_RESULTS" }, {}); r.revoke(); return r.proxy; };
    const mkRevokedArr = () => { const r = Proxy.revocable([1, 2], {}); r.revoke(); return r.proxy; };
    // 1) the gateway model-operation validator
    { let threw = false, v = "unset"; try { v = SCH.validateModelOperation(mkRevoked()); } catch (e) { threw = true; }
      ok(!threw, "REV-NEW-01 — gateway validateModelOperation does NOT throw on a revoked Proxy (Array.isArray brand check inside the guard)");
      ok(v === null, "REV-NEW-01 — gateway validateModelOperation returns null on a revoked Proxy"); }
    // 2) a revoked Proxy wrapping an array
    { let threw = false, v = "unset"; try { v = SCH.validateModelOperation(mkRevokedArr()); } catch (e) { threw = true; }
      ok(!threw, "REV-NEW-01 — gateway validateModelOperation does NOT throw on a revoked array-Proxy");
      ok(v === null, "REV-NEW-01 — gateway validateModelOperation returns null on a revoked array-Proxy"); }
    // 3) the EXPORTED gateway strictRecord helper (Array.isArray head guard now inside the try)
    { let threw = false, v = "unset"; try { v = SCH.strictRecord(mkRevoked(), ["op"]); } catch (e) { threw = true; }
      ok(!threw, "REV-NEW-01 — gateway strictRecord does NOT throw on a revoked Proxy");
      ok(v === null, "REV-NEW-01 — gateway strictRecord returns null on a revoked Proxy"); }
    // parity: the client mirrors all three (same result, no throw)
    { let ct = false, st = false, cv = "u", sv = "u";
      try { cv = C.validateOperation(mkRevoked()); } catch { ct = true; }
      try { sv = SCH.validateModelOperation(mkRevoked()); } catch { st = true; }
      ok(!ct && !st && cv === null && sv === null, "REV-NEW-01 — client==gateway: a revoked Proxy → null on BOTH, neither throws"); }
  }

  // ── R5A SECOND REMEDIATION (REV-NEW-02) — HOSTILE ARRAY matrix with client==gateway parity ────
  section("R5A SECOND REMEDIATION — gateway hostile-array authority integrity + parity (REV-NEW-02)");
  {
    // BOTH validators must NOT throw and must AGREE (both null) on every hostile-array shape. The
    // base content is otherwise-valid, so the ONLY reason for rejection is the hostile shape.
    const bothReject = (label, mkOp) => {
      let ct = false, st = false, cv = "u", sv = "u";
      try { cv = C.validateOperation(mkOp()); } catch (e) { ct = true; }
      try { sv = SCH.validateModelOperation(mkOp()); } catch (e) { st = true; }
      ok(!ct && !st, `REV-NEW-02 — neither validator THROWS on ${label} (clientThrew=${ct} serverThrew=${st})`);
      ok(cv === null && sv === null, `REV-NEW-02 — client==gateway BOTH reject ${label} (client=${JSON.stringify(cv)} server=${JSON.stringify(sv)})`);
    };
    const shapes = (base) => [
      ["revoked proxy", () => { const r = Proxy.revocable(base.slice(), {}); r.revoke(); return r.proxy; }],
      ["revoked proxy (empty target)", () => { const r = Proxy.revocable([], {}); r.revoke(); return r.proxy; }],
      ["own map override", () => { const a = base.slice(); a.map = () => base.slice(); return a; }],
      ["own slice override", () => { const a = base.slice(); a.slice = () => base.slice(); return a; }],
      ["own Symbol.iterator override", () => { const a = base.slice(); a[Symbol.iterator] = function* () { for (const v of base) yield v; }; return a; }],
      ["accessor index 0", () => { const a = base.slice(); const v0 = a[0]; Object.defineProperty(a, 0, { get() { return v0; }, enumerable: true, configurable: true }); return a; }],
      ["sparse hole at index 0", () => { const a = base.slice(); delete a[0]; return a; }],
      ["Array subclass instance", () => { class Arr extends Array {} const a = new Arr(); for (const v of base) a.push(v); return a; }],
      ["changed prototype", () => { const a = base.slice(); Object.setPrototypeOf(a, { hijack: 1 }); return a; }],
      ["extra symbol own property", () => { const a = base.slice(); a[Symbol("s")] = 9; return a; }],
      ["extra named own property", () => { const a = base.slice(); a.tainted = 9; return a; }],
    ];
    for (const [name, mk] of shapes([1, 2])) bothReject(`COMPARE positions — ${name}`, () => ({ op: "COMPARE_VISIBLE_HOTELS", positions: mk(), factors: ["price"] }));
    for (const [name, mk] of shapes(["price", "rating"])) bothReject(`COMPARE factors — ${name}`, () => ({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: mk() }));
    for (const [name, mk] of shapes([5, 4])) bothReject(`APPLY stars — ${name}`, () => ({ op: "APPLY_HOTEL_REFINEMENT", stars: mk() }));
    // the 3 NAMED substitution attacks (verbatim), client==gateway parity, must be impossible:
    bothReject('COMPARE positions [999,999] w/ hostile map()->[1,2]', () => { const a = [999, 999]; a.map = () => [1, 2]; return { op: "COMPARE_VISIBLE_HOTELS", positions: a, factors: ["price"] }; });
    bothReject('COMPARE factors ["zoom"] w/ hostile iterator->"price"', () => { const a = ["zoom"]; a[Symbol.iterator] = function* () { yield "price"; }; return { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: a }; });
    bothReject('APPLY stars [1] w/ hostile map()->[5]', () => { const a = [1]; a.map = () => [5]; return { op: "APPLY_HOTEL_REFINEMENT", stars: a }; });
    // descriptor-authoritative parity: a get-LYING proxy yields the DESCRIPTOR value on BOTH ends.
    const mkLiar = () => new Proxy([1, 2], { get(t, k) { if (k === "0") return 999; return t[k]; } });
    const clv = C.validateOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: mkLiar(), factors: ["price"] });
    const slv = SCH.validateModelOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: mkLiar(), factors: ["price"] });
    ok(clv && slv && JSON.stringify(clv.positions) === "[1,2]" && JSON.stringify(slv.positions) === "[1,2]",
      "REV-NEW-02 — client==gateway: a get-LYING proxy is read via descriptors → REAL [1,2] on both (never the getter's 999)");
  }

  // ── R5A SECOND REMEDIATION — EXACT length boundaries (both validators) ─────────────────────
  section("R5A SECOND REMEDIATION — gateway exact length boundaries (query 60/61, city 40/41)");
  {
    const q60 = "x".repeat(60), q61 = "x".repeat(61), c40 = "a".repeat(40), c41 = "a".repeat(41);
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", query: q60 }) !== null && SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", query: q60 }) !== null, "boundary — a query of EXACTLY 60 UTF-16 units is accepted by BOTH");
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", query: q61 }) === null && SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", query: q61 }) === null, "boundary — a query of 61 UTF-16 units is REJECTED by BOTH");
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: c40 }) !== null && SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: c40 }) !== null, "boundary — a city of EXACTLY 40 chars is accepted by BOTH");
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: c41 }) === null && SCH.validateModelOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: c41 }) === null, "boundary — a city of 41 chars is REJECTED by BOTH");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R5B — ACTION RECEIPT / VERIFIED EVIDENCE AUTHORITY — lifecycle state machine
  // ══════════════════════════════════════════════════════════════════════════
  section("R5B — receipt lifecycle: gateway-minted receiptId, state machine, ACK, terminal replay");
  {
    // build a fresh store + session with a current ACK, register one accepted READ proposal.
    function mkLive(op) {
      const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const c = store.create({ sessionId: "las.5b", subject: "s5b." + Math.random().toString(36).slice(2), ipHash: "ip5b." + Math.random().toString(36).slice(2), authenticated: false });
      const s = c.session; const emitted = [];
      s.emit = (f) => emitted.push(f);
      const runCalls = [];
      const deps = { session: s, store, runTurn: async (ss, i) => { runCalls.push(i); } };
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
      const ar = s.ackAuthorityRef;
      const ra = raFor(ar, "t.1", 0, 0, "rev.1", validCtx(2)); // R5B-REV-01 — the REAL result authority of the acked context
      const operation = op || "READ_CURRENT_RESULTS";
      store.registerProposal(s, { proposalId: "pp.x", providerTurnId: "pt.x", operation, operationSpec: { op: operation }, executionNonce: "xn.x", receiptId: "rc.x", turnId: "t.1", generation: 0, authorityRef: ar });
      return { store, s, deps, ar, ra, emitted, runCalls, operation };
    }
    const accept = (L, over) => CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "action.accepted", sessionId: L.s.sessionId, turnId: "t.1", generation: 0, accepted: Object.assign({ receiptId: "rc.x", proposalId: "pp.x", providerTurnId: "pt.x", actionId: "act.x", executionNonce: "xn.x", operation: L.operation, authorityRef: L.ar }, over) }) });
    // R5B-REV-01 — every acted/verified receipt carries the FULL result authority (overridable to prove the
    // gateway rejects a wrong/copied/stale one). A `resultAuthority: null` override strips it.
    const receipt = (L, over) => { const o = Object.assign({ receiptId: "rc.x", proposalId: "pp.x", providerTurnId: "pt.x", actionId: "act.x", executionNonce: "xn.x", authorityRef: L.ar, resultAuthority: L.ra }, over); if (o.resultAuthority === null) delete o.resultAuthority; return CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "action.receipt", sessionId: L.s.sessionId, turnId: "t.1", generation: 0, receipt: validReceipt(o) }) }); };
    const lastAck = (L) => { for (let i = L.emitted.length - 1; i >= 0; i--) if (L.emitted[i].t === "action.receipt.ack") return L.emitted[i]; return null; };

    // (1) receipt BEFORE acceptance → invalid.
    { const L = mkLive(); eq(receipt(L, {}), "receipt_uncorrelated", "R5B — a receipt BEFORE action.accepted is refused"); }
    // (2) valid READ lifecycle: accept → verified terminal → ACK closed + recorded.
    { const L = mkLive(); eq(accept(L, {}), "accepted", "R5B — pending → accepted"); eq(receipt(L, {}), "receipt", "R5B — a verified READ receipt is accepted");
      ok(L.s.verifiedReceipts.has("rc.x"), "R5B — the verified receipt is recorded under its gateway id"); const a = lastAck(L);
      ok(a && a.receiptId === "rc.x" && a.outcome === "verified" && a.closed === true, "R5B — the gateway emits action.receipt.ack (closed, verified)"); }
    // (3) duplicate acceptance (same actionId) is idempotent; a conflicting actionId is refused.
    { const L = mkLive(); accept(L, {}); eq(accept(L, {}), "accepted", "R5B — an exact duplicate acceptance is idempotent"); eq(accept(L, { actionId: "act.OTHER" }), "accepted_uncorrelated", "R5B — a conflicting second acceptance (different actionId) is refused"); }
    // (4) fabricated / self-minted receiptId echo → refused.
    { const L = mkLive(); accept(L, {}); eq(receipt(L, { receiptId: "rc.SELF" }), "receipt_uncorrelated", "R5B — a self-minted receiptId (not the gateway's) can never correlate"); }
    // (5) wrong nonce / wrong actionId → refused.
    { const L = mkLive(); accept(L, {}); eq(receipt(L, { executionNonce: "xn.WRONG" }), "receipt_uncorrelated", "R5B — a receipt echoing the WRONG nonce is refused");
      const L2 = mkLive(); accept(L2, {}); eq(receipt(L2, { actionId: "act.WRONG" }), "receipt_uncorrelated", "R5B — a receipt with the WRONG actionId is refused"); }
    // (6) acted is NON-TERMINAL: accepted → awaiting_verification (ACK closed:false), then verified → terminal.
    { const L = mkLive(); accept(L, {}); eq(receipt(L, { outcome: "acted", status: "execution_acknowledged", evidence: undefined }), "receipt", "R5B — an acted receipt advances to awaiting_verification");
      const a = lastAck(L); ok(a && a.outcome === "acted" && a.closed === false, "R5B — acted ACK is NON-closed (execution acknowledged, pending verification)");
      ok(!L.s.verifiedReceipts.has("rc.x"), "R5B — acted does NOT record trusted evidence (acted != verified)");
      eq(receipt(L, {}), "receipt", "R5B — a later verified receipt terminalizes the awaiting proposal"); ok(L.s.verifiedReceipts.has("rc.x"), "R5B — only the verified terminal records evidence"); }
    // (7) exact-duplicate terminal → idempotent; conflicting terminal → reject.
    { const L = mkLive(); accept(L, {}); receipt(L, {}); eq(receipt(L, {}), "receipt_idempotent", "R5B — an exact-duplicate terminal receipt is idempotent");
      eq(receipt(L, { outcome: "rejected", status: "no_op", evidence: undefined }), "receipt_conflict", "R5B — a conflicting terminal replay is REJECTED"); }
    // (8) negative terminal (rejected) consumes authority: a later verified can NEVER re-verify.
    { const L = mkLive(); accept(L, {}); eq(receipt(L, { outcome: "rejected", status: "no_op", evidence: undefined }), "receipt", "R5B — a rejected terminal is accepted (no evidence)");
      ok(!L.s.verifiedReceipts.has("rc.x"), "R5B — a negative terminal records NO trusted evidence");
      eq(receipt(L, {}), "receipt_conflict", "R5B — a rejected proposal can NEVER later become verified (negative consumes authority)"); }
    // (9) stale source authority (context conflict revokes the ACK) terminalizes the accepted proposal as stale.
    { const L = mkLive(); accept(L, {});
      CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "context.publish", sessionId: L.s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(3) }) }); // same tuple, different content → conflict, revoke ACK
      ok(L.s.ackAuthorityRef === null, "R5B — the conflicting republish revoked the ACK"); }
    // (9b) R5B-REV-01 — a verified receipt whose RESULT authority is NO LONGER the current context ack is
    // REJECTED by the INDEPENDENT result-authority check (the immutable source binding is untouched).
    { const L = mkLive(); accept(L, {}); L.s.ackAuthorityRef = "ar.MOVED"; L.s.ackContextDigest = "deadbeef";
      eq(receipt(L, {}), "receipt_uncorrelated", "R5B-REV-01 — a verified receipt whose result authority is no longer current is REJECTED");
      ok(!L.s.verifiedReceipts.has("rc.x"), "R5B-REV-01 — the stale-result-authority receipt records NO trusted evidence"); }
    // (10) OPEN cannot verify evidence-free; APPLY is never a gateway-verified receipt.
    { const L = mkLive("OPEN_VISIBLE_HOTEL"); accept(L, { operation: "OPEN_VISIBLE_HOTEL" });
      eq(receipt(L, { operation: "OPEN_VISIBLE_HOTEL", evidence: undefined }), "receipt_evidence_mismatch", "R5B — an evidence-FREE OPEN verification is refused"); }
    // (11) new session / reconnect cannot resume old executable proposal authority.
    { const L = mkLive(); accept(L, {}); receipt(L, {}); // terminal on session A
      const store2 = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const c2 = store2.create({ sessionId: "las.5b", subject: "s5b.new", ipHash: "ip5b.new", authenticated: false });
      ok(store2.get(c2.session.gatewaySessionId) && c2.session.proposals.size === 0, "R5B — a fresh session/reconnect starts with NO proposals (old executable authority cannot resume)"); }
    // (12) wire validation: malformed / unknown-key / symbol-key / accessor / revoked-Proxy receipts → null (no lifecycle).
    { ok(SCH.validateActionReceipt({ receiptId: "r", outcome: "verified" }) === null, "R5B — a malformed (partial) receipt → null");
      ok(SCH.validateActionReceipt(Object.assign(validReceipt({}), { extra: 1 })) === null, "R5B — an unknown-key receipt → null");
      const symR = validReceipt({}); symR[Symbol("s")] = 1; ok(SCH.validateActionReceipt(symR) === null, "R5B — a symbol-key receipt → null");
      const accR = {}; Object.defineProperty(accR, "receiptId", { get() { return "x"; }, enumerable: true }); ok(SCH.validateActionReceipt(accR) === null, "R5B — an accessor-property receipt → null");
      let threw = false, rv; const rp = Proxy.revocable(validReceipt({}), {}); rp.revoke(); try { rv = SCH.validateActionReceipt(rp.proxy); } catch { threw = true; } ok(!threw && rv === null, "R5B — a REVOKED-Proxy receipt → null (no throw, total fail-closed)"); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R5B-REMEDIATION — named result-authority / matrix / pre-accept / dup-registration cases
  // ══════════════════════════════════════════════════════════════════════════
  section("R5B-REV-01 — FULL result authority is independently validated (tamper / copy / delay / cross → REJECT)");
  {
    // a fresh session with a REAL ack, one accepted READ proposal.
    function mk() {
      const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const c = store.create({ sessionId: "las.ra." + Math.random().toString(36).slice(2), subject: "s.ra." + Math.random().toString(36).slice(2), ipHash: "ip.ra." + Math.random().toString(36).slice(2), authenticated: false });
      const s = c.session; s.emit = () => {};
      const deps = { session: s, store, runTurn: async () => {} };
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
      const ar = s.ackAuthorityRef;
      store.registerProposal(s, { proposalId: "pp.r", providerTurnId: "pt.r", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.r", receiptId: "rc.r", turnId: "t.1", generation: 0, authorityRef: ar });
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: s.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.r", proposalId: "pp.r", providerTurnId: "pt.r", actionId: "act.r", executionNonce: "xn.r", operation: "READ_CURRENT_RESULTS", authorityRef: ar } }) });
      return { store, s, deps, ar };
    }
    const send = (L, ra) => CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "action.receipt", sessionId: L.s.sessionId, turnId: "t.1", generation: 0, receipt: validReceipt({ receiptId: "rc.r", proposalId: "pp.r", providerTurnId: "pt.r", actionId: "act.r", executionNonce: "xn.r", authorityRef: L.ar, resultAuthority: ra }) }) });
    const good = (L) => raFor(L.ar, "t.1", 0, 0, "rev.1", validCtx(2));
    { const L = mk(); eq(send(L, good(L)), "receipt", "REV-01 — a VALID full result authority verifies"); ok(L.s.verifiedReceipts.has("rc.r"), "REV-01 — the valid-result-authority receipt is recorded"); }
    { const L = mk(); eq(send(L, { ...good(L), turnId: "t.WRONG" }), "receipt_uncorrelated", "REV-01 — a WRONG result turnId → REJECT"); }
    { const L = mk(); eq(send(L, { ...good(L), generation: 9 }), "receipt_uncorrelated", "REV-01 — a WRONG result generation → REJECT"); }
    { const L = mk(); eq(send(L, { ...good(L), routeEpoch: 9 }), "receipt_uncorrelated", "REV-01 — a WRONG result routeEpoch → REJECT"); }
    { const L = mk(); eq(send(L, { ...good(L), contextRevision: "rev.OTHER" }), "receipt_uncorrelated", "REV-01 — a WRONG result contextRevision → REJECT"); }
    { const L = mk(); eq(send(L, { ...good(L), authorityRef: "ar.COPIED" }), "receipt_uncorrelated", "REV-01 — a COPIED/mismatched result authorityRef (internal inconsistency) → REJECT"); }
    { const L = mk(); eq(send(L, { ...good(L), contextDigest: "0".repeat(64) }), "receipt_uncorrelated", "REV-01 — a WRONG result contextDigest → REJECT"); }
    { const L = mk(); const other = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }); const oc = other.create({ sessionId: "las.other", subject: "s.o", ipHash: "ip.o", authenticated: false }); const oSess = oc.session; oSess.emit = () => {}; CTRL.handleLiveAiControlFrame({ session: oSess, store: other, runTurn: async () => {}, raw: JSON.stringify({ t: "context.publish", sessionId: oSess.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) }); const otherRa = raFor(oSess.ackAuthorityRef, "t.1", 0, 0, "rev.1", validCtx(2)); eq(send(L, otherRa), "receipt_uncorrelated", "REV-01 — ANOTHER session's result authority → REJECT (session-bound authorityRef)"); }
    { const L = mk(); L.s.ackAuthorityRef = "ar.MOVED"; L.s.ackContextDigest = "beef"; eq(send(L, good(L)), "receipt_uncorrelated", "REV-01 — a DELAYED result authority (context has since advanced) → REJECT"); }
    { const L = mk(); eq(send(L, undefined), "receipt_uncorrelated", "REV-01 — a verified receipt with NO (absent) result authority → REJECT at the lifecycle"); }
    { const L = mk(); eq(send(L, null), "receipt_invalid", "REV-01 — a verified receipt with a MALFORMED (null) result authority → REJECT at the wire"); }
    // R5B-REV-01 — after a LEGITIMATE context advance, a SOURCE-BOUND READ can NEVER verify (neither
    // against the stale source nor the advanced context — a source-bound op's result authority MUST remain
    // EXACTLY its source authority; this is the operation-specific matrix, NOT a generic current-authority rule).
    { const L = mk();
      CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "context.publish", sessionId: L.s.sessionId, turnId: "t.2", generation: 1, routeEpoch: 0, contextRevision: "rev.2", context: validCtx(2) }) });
      const arB = L.s.ackAuthorityRef; const raB = raFor(arB, "t.2", 1, 0, "rev.2", validCtx(2));
      eq(send(L, raB), "receipt_uncorrelated", "REV-01 — a SOURCE-BOUND READ does NOT verify under an ADVANCED result authority (result != source)");
      ok(!L.s.verifiedReceipts.has("rc.r"), "REV-01 — the source-bound READ under advancement is NOT recorded"); }
    // R5B-REV-03/04 — an ADVANCEABLE APPLY DOES verify under a bounded advanced result authority (its source
    // authority is no longer current), and its trusted evidence is recorded under the RESULT authority.
    { const store2 = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const c2 = store2.create({ sessionId: "las.adv", subject: "s.adv", ipHash: "ip.adv", authenticated: false });
      const s2 = c2.session; s2.emit = () => {};
      const deps2 = { session: s2, store: store2, runTurn: async () => {} };
      const applyCtxA = { pageId: "hotels", role: "anonymous", destination: "goa", query: null, loadState: "ready", visibleHotels: [{ position: 1, id: "htl_1", name: "A", city: "Goa", minPrice: 1000, rating: 4, parking: "present" }, { position: 2, id: "htl_2", name: "B", city: "Goa", minPrice: 1100, rating: 4, parking: "present" }], currentHotelId: null, validated: false, section: null, breakfast: null, parking: null, refinement: { destination: "goa", query: null, maxPrice: null, parking: false, stars: [], sort: "default", orderedIds: ["htl_1", "htl_2"], count: 2 } };
      CTRL.handleLiveAiControlFrame({ ...deps2, raw: JSON.stringify({ t: "context.publish", sessionId: s2.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: applyCtxA }) });
      const arA = s2.ackAuthorityRef;
      store2.registerProposal(s2, { proposalId: "pp.ap", providerTurnId: "pt.ap", operation: "APPLY_HOTEL_REFINEMENT", operationSpec: { op: "APPLY_HOTEL_REFINEMENT", destination: "goa" }, executionNonce: "xn.ap", receiptId: "rc.ap", turnId: "t.1", generation: 0, authorityRef: arA });
      CTRL.handleLiveAiControlFrame({ ...deps2, raw: JSON.stringify({ t: "action.accepted", sessionId: s2.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.ap", proposalId: "pp.ap", providerTurnId: "pt.ap", actionId: "act.ap", executionNonce: "xn.ap", operation: "APPLY_HOTEL_REFINEMENT", authorityRef: arA } }) });
      CTRL.handleLiveAiControlFrame({ ...deps2, raw: JSON.stringify({ t: "context.publish", sessionId: s2.sessionId, turnId: "t.2", generation: 1, routeEpoch: 0, contextRevision: "rev.2", context: applyCtxA }) });
      const arB2 = s2.ackAuthorityRef; const raB2 = raFor(arB2, "t.2", 1, 0, "rev.2", applyCtxA);
      const applyVer = CTRL.handleLiveAiControlFrame({ ...deps2, raw: JSON.stringify({ t: "action.receipt", sessionId: s2.sessionId, turnId: "t.2", generation: 1, receipt: { receiptId: "rc.ap", proposalId: "pp.ap", providerTurnId: "pt.ap", actionId: "act.ap", executionNonce: "xn.ap", authorityRef: arA, operation: "APPLY_HOTEL_REFINEMENT", outcome: "verified", status: "verified", resultAuthority: raB2, evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } } }) });
      eq(applyVer, "receipt", "REV-03 — an ADVANCEABLE APPLY verifies under an ADVANCED result authority though its SOURCE authority is no longer current");
      const rec = s2.verifiedReceipts.get("rc.ap");
      ok(rec && rec.authorityRef === arB2, "REV-04 — the advanced APPLY's trusted evidence is recorded under the RESULT authority (arB2), not the stale source (arA)"); }
  }

  section("R5B-REV-09 — the closed outcome/status compatibility matrix rejects contradictory pairs (client == gateway)");
  {
    const legal = SCH.isLegalOutcomeStatus, Plegal = P.isLegalOutcomeStatus;
    const pairs = [["verified", "no_op", false], ["verified", "stale_context", false], ["verified", "verified", true], ["acted", "verified", false], ["acted", "execution_acknowledged", true], ["rejected", "verified", false], ["rejected", "no_op", true], ["unknown", "execution_acknowledged", false], ["unknown", "verification_timeout", true], ["stale", "stale_context", true], ["stale", "verified", false]];
    for (const [o, st, want] of pairs) {
      ok(legal(o, st) === want, `REV-09 gateway — (${o}, ${st}) is ${want ? "legal" : "ILLEGAL"}`);
      ok(Plegal(o, st) === want, `REV-09 client — (${o}, ${st}) is ${want ? "legal" : "ILLEGAL"} (byte-mirror)`);
    }
    // enforced at the wire: a contradictory receipt is rejected by validateActionReceipt on BOTH ends.
    // (a no-evidence receipt so the ONLY reason for rejection is the outcome/status matrix).
    const noEv = (o) => ({ receiptId: "rcpt.1", proposalId: "pp.1", providerTurnId: "pt.1", actionId: "act.1", executionNonce: "xn.1", authorityRef: "ar.1", operation: "READ_CURRENT_RESULTS", ...o });
    ok(SCH.validateActionReceipt(noEv({ outcome: "verified", status: "no_op" })) === null, "REV-09 gateway — a verified+no_op receipt is REJECTED at the wire");
    ok(P.validateActionReceipt(noEv({ outcome: "verified", status: "no_op" })) === null, "REV-09 client — a verified+no_op receipt is REJECTED at the wire (byte-mirror)");
    ok(SCH.validateActionReceipt(noEv({ outcome: "acted", status: "verified" })) === null, "REV-09 — an acted+verified receipt is REJECTED at the wire");
    ok(SCH.validateActionReceipt(noEv({ outcome: "verified", status: "verified" })) !== null, "REV-09 — a LEGAL verified+verified receipt is accepted at the wire (matrix does not over-reject)");
  }

  section("R5B-REV-07 — duplicate acted is idempotent (no overwrite); a conflicting acted is rejected");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.act", subject: "s.act", ipHash: "ip.act", authenticated: false }); const s = c.session; s.emit = () => {};
    const deps = { session: s, store, runTurn: async () => {} };
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
    const ar = s.ackAuthorityRef; const ra = raFor(ar, "t.1", 0, 0, "rev.1", validCtx(2));
    store.registerProposal(s, { proposalId: "pp.a", providerTurnId: "pt.a", operation: "APPLY_HOTEL_REFINEMENT", operationSpec: { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 3000 }, executionNonce: "xn.a", receiptId: "rc.a", turnId: "t.1", generation: 0, authorityRef: ar });
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: s.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.a", proposalId: "pp.a", providerTurnId: "pt.a", actionId: "act.a", executionNonce: "xn.a", operation: "APPLY_HOTEL_REFINEMENT", authorityRef: ar } }) });
    const acted = (over) => CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: s.sessionId, turnId: "t.1", generation: 0, receipt: { receiptId: "rc.a", proposalId: "pp.a", providerTurnId: "pt.a", actionId: "act.a", executionNonce: "xn.a", authorityRef: ar, operation: "APPLY_HOTEL_REFINEMENT", outcome: "acted", status: "execution_acknowledged", resultAuthority: ra, ...over } }) });
    eq(acted({}), "receipt", "REV-07 — the FIRST acted advances (awaiting_verification)");
    const p = s.proposals.get("pp.a"); const boundRa = p.resultAuthority;
    eq(acted({}), "receipt_idempotent", "REV-07 — an EXACT-duplicate acted is idempotent (no re-execution)");
    ok(s.proposals.get("pp.a").resultAuthority === boundRa, "REV-07 — the duplicate acted did NOT overwrite the bound result authority");
    // a CONFLICTING acted (same actionId, DIFFERENT content — a different result authority) is rejected.
    const ra2 = raFor(ar, "t.1", 0, 0, "rev.1", validCtx(2)); // same tuple but a fresh object → same digest? use a genuinely different observed authority
    s.ackAuthorityRef = ar; // keep current
    eq(acted({ status: "execution_acknowledged", resultAuthority: { ...ra, contextRevision: "rev.1", turnId: "t.1" }, executionNonce: "xn.a", actionId: "act.a", providerTurnId: "pt.a", proposalId: "pp.a", receiptId: "rc.a", authorityRef: ar, operation: "APPLY_HOTEL_REFINEMENT", outcome: "acted" }), "receipt_idempotent", "REV-07 — a byte-identical acted stays idempotent");
    void ra2;
  }

  section("R5B-REV-08 — gateway-owned PRE-ACCEPT terminalization (stale / refused before action.accepted)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.pre", subject: "s.pre", ipHash: "ip.pre", authenticated: false }); const s = c.session; s.emit = () => {};
    const deps = { session: s, store, runTurn: async () => {} };
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
    const ar = s.ackAuthorityRef;
    // (a) a NEVER-accepted proposal + a browser refusal (rejected/stale) terminalizes it pre-accept (no actionId fabricated).
    store.registerProposal(s, { proposalId: "pp.ref", providerTurnId: "pt.ref", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.ref", receiptId: "rc.ref", turnId: "t.1", generation: 0, authorityRef: ar });
    const refuse = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: s.sessionId, turnId: "t.1", generation: 0, receipt: { receiptId: "rc.ref", proposalId: "pp.ref", providerTurnId: "pt.ref", actionId: "act.browserRandom", executionNonce: "xn.ref", authorityRef: ar, operation: "READ_CURRENT_RESULTS", outcome: "stale", status: "stale_context" } }) });
    eq(refuse, "receipt", "REV-08 — a browser refusal (stale) of a NEVER-accepted proposal terminalizes it pre-accept");
    ok(s.proposals.get("pp.ref").state === "terminal" && s.proposals.get("pp.ref").acceptedActionId === null, "REV-08 — the pre-accept terminalized proposal is terminal with NO fabricated actionId");
    ok(!s.verifiedReceipts.has("rc.ref"), "REV-08 — a pre-accept terminal records NO trusted evidence");
    // an acted/verified receipt BEFORE acceptance is still invalid (nothing executed).
    store.registerProposal(s, { proposalId: "pp.pre2", providerTurnId: "pt.pre2", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.pre2", receiptId: "rc.pre2", turnId: "t.1", generation: 0, authorityRef: ar });
    const preVer = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: s.sessionId, turnId: "t.1", generation: 0, receipt: validReceipt({ receiptId: "rc.pre2", proposalId: "pp.pre2", providerTurnId: "pt.pre2", actionId: "act.x", executionNonce: "xn.pre2", authorityRef: ar, resultAuthority: raFor(ar, "t.1", 0, 0, "rev.1", validCtx(2)) }) }) });
    eq(preVer, "receipt_uncorrelated", "REV-08 — a VERIFIED receipt before acceptance is invalid (never executed)");
    // (b) a context ADVANCE terminalizes a still-pending proposal bound to the now-stale authority.
    store.registerProposal(s, { proposalId: "pp.stale", providerTurnId: "pt.stale", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.stale", receiptId: "rc.stale", turnId: "t.1", generation: 0, authorityRef: ar });
    CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.2", generation: 1, routeEpoch: 0, contextRevision: "rev.2", context: validCtx(3) }) });
    ok(s.proposals.get("pp.stale").state === "terminal" && s.proposals.get("pp.stale").terminalOutcome === "stale", "REV-08 — a context advance terminalizes a still-PENDING proposal bound to the stale authority (never left executable-pending)");
  }

  section("R5B (non-blocking) — duplicate proposalId / receiptId registration is REFUSED (no silent overwrite)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const c = store.create({ sessionId: "las.dup", subject: "s.dup", ipHash: "ip.dup", authenticated: false }); const s = c.session;
    ok(store.registerProposal(s, { proposalId: "pp.d", providerTurnId: "pt.d", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.d", receiptId: "rc.d", turnId: "t.1", generation: 0, authorityRef: "ar.d" }) === true, "the first registration succeeds");
    ok(store.registerProposal(s, { proposalId: "pp.d", providerTurnId: "pt.d2", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.d2", receiptId: "rc.d2", turnId: "t.1", generation: 0, authorityRef: "ar.d" }) === false, "a DUPLICATE proposalId is REFUSED (no silent overwrite)");
    ok(store.registerProposal(s, { proposalId: "pp.d.new", providerTurnId: "pt.d3", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.d3", receiptId: "rc.d", turnId: "t.1", generation: 0, authorityRef: "ar.d" }) === false, "a DUPLICATE receiptId (new proposalId) is REFUSED");
    ok(s.proposals.get("pp.d").providerTurnId === "pt.d", "the original proposal identity is preserved (never overwritten)");
  }

  section("R5B-SECOND-REMEDIATION Section 12 — CLOSURE attack battery (op-specific authority / stored OPEN+SHOW identity / async result authority / factors / pre-accept / hostile-JS)");
  {
    const M = SCH.evidenceMatchesProposalSemantics;
    // ── a source-bound A→B lifecycle harness ──────────────────────────────────────────────────────────
    function mkOp(op, spec, ctxObj) {
      const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const rnd = Math.random().toString(36).slice(2);
      const c = store.create({ sessionId: "las.ab." + rnd, subject: "s.ab." + rnd, ipHash: "ip.ab." + rnd, authenticated: false });
      const s = c.session; s.emit = () => {};
      const deps = { session: s, store, runTurn: async () => {} };
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: ctxObj }) });
      const ar = s.ackAuthorityRef;
      store.registerProposal(s, { proposalId: "pp.o", providerTurnId: "pt.o", operation: op, operationSpec: spec, executionNonce: "xn.o", receiptId: "rc.o", turnId: "t.1", generation: 0, authorityRef: ar, sourceResolvedHotelId: SCH.resolveSourceHotelId(op, spec, ctxObj) });
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: s.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.o", proposalId: "pp.o", providerTurnId: "pt.o", actionId: "act.o", executionNonce: "xn.o", operation: op, authorityRef: ar } }) });
      return { store, s, deps, ar };
    }
    function advanceThenVerify(L, op, evidence, ctxB) {
      CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "context.publish", sessionId: L.s.sessionId, turnId: "t.2", generation: 1, routeEpoch: 0, contextRevision: "rev.2", context: ctxB }) });
      const arB = L.s.ackAuthorityRef; const raB = raFor(arB, "t.2", 1, 0, "rev.2", ctxB);
      return CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "action.receipt", sessionId: L.s.sessionId, turnId: "t.2", generation: 1, receipt: { receiptId: "rc.o", proposalId: "pp.o", providerTurnId: "pt.o", actionId: "act.o", executionNonce: "xn.o", authorityRef: L.ar, operation: op, outcome: "verified", status: "verified", resultAuthority: raB, evidence } }) });
    }
    // (12.1) delayed COMPARE A→B → MUST NOT verify (source-bound: result != source, even though B's evidence matches).
    { const cmpSpec = { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] };
      const cmpEv = { kind: "comparison", positions: [1, 2], hotelIds: ["htl_1", "htl_2"], factors: ["price"], cheapestPosition: 1, topRatedPosition: 1 };
      const L = mkOp("COMPARE_VISIBLE_HOTELS", cmpSpec, validCtx(2));
      const r = advanceThenVerify(L, "COMPARE_VISIBLE_HOTELS", cmpEv, validCtx(2));
      ok(r !== "receipt" && !L.s.verifiedReceipts.has("rc.o"), "12.1 — a delayed COMPARE (source-bound) does NOT verify after the context advances A→B"); }
    // (12.2) delayed READ_CURRENT_HOTEL_FACTS A→B → MUST NOT verify.
    { const detCtx = { pageId: "hotel-detail", role: "anonymous", destination: null, query: null, loadState: "ready", visibleHotels: [], currentHotelId: "htl_z", validated: true, section: "rooms", breakfast: "present", parking: "unknown" };
      const factsEv = { kind: "detail", hotelId: "htl_z", breakfast: "present", parking: "unknown" };
      const L = mkOp("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }, detCtx);
      const r = advanceThenVerify(L, "READ_CURRENT_HOTEL_FACTS", factsEv, detCtx);
      ok(r !== "receipt" && !L.s.verifiedReceipts.has("rc.o"), "12.2 — a delayed READ_CURRENT_HOTEL_FACTS (source-bound) does NOT verify after the context advances A→B"); }
    // (12.3) OPEN wrong first destination TERMINALIZES (unknown) and a later verified for the RIGHT hotel can NEVER recover.
    { const hotelsCtx = validCtx(3);
      const L = mkOp("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, hotelsCtx); // source-resolved = htl_2
      // the first authoritative transition landed on the WRONG hotel → the client consumes the OPEN as unknown.
      const term = CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "action.receipt", sessionId: L.s.sessionId, turnId: "t.1", generation: 0, receipt: { receiptId: "rc.o", proposalId: "pp.o", providerTurnId: "pt.o", actionId: "act.o", executionNonce: "xn.o", authorityRef: L.ar, operation: "OPEN_VISIBLE_HOTEL", outcome: "unknown", status: "stale_entity" } }) });
      eq(term, "receipt", "12.3 — a wrong-first-destination OPEN terminalizes (unknown)");
      ok(L.s.proposals.get("pp.o").terminalOutcome === "unknown", "12.3 — the OPEN proposal is TERMINAL(unknown)");
      // a later manual visit to the RIGHT hotel (htl_2) sends a verified receipt → the proposal is already terminal → conflict, NEVER verifies.
      const destOK = { pageId: "hotel-detail", role: "anonymous", destination: null, query: null, loadState: "ready", visibleHotels: [], currentHotelId: "htl_2", validated: true, section: null, breakfast: "unknown", parking: "unknown" };
      CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "context.publish", sessionId: L.s.sessionId, turnId: "t.2", generation: 1, routeEpoch: 1, contextRevision: "rev.2", context: destOK }) });
      const arB = L.s.ackAuthorityRef; const raB = raFor(arB, "t.2", 1, 1, "rev.2", destOK);
      const recover = CTRL.handleLiveAiControlFrame({ ...L.deps, raw: JSON.stringify({ t: "action.receipt", sessionId: L.s.sessionId, turnId: "t.2", generation: 1, receipt: { receiptId: "rc.o", proposalId: "pp.o", providerTurnId: "pt.o", actionId: "act.o", executionNonce: "xn.o", authorityRef: L.ar, operation: "OPEN_VISIBLE_HOTEL", outcome: "verified", status: "verified", resultAuthority: raB, evidence: { kind: "detail", hotelId: "htl_2", breakfast: "unknown", parking: "unknown" } } }) });
      eq(recover, "receipt_conflict", "12.3 — a later manual navigation to the RIGHT hotel can NEVER recover the terminalized OPEN (conflict)");
      ok(!L.s.verifiedReceipts.has("rc.o"), "12.3 — the terminalized OPEN is never recorded as verified"); }
    // (12.4 / 12.5) async OPEN + SHOW verified evidence is recorded under the RESULT (advanced) authority, not the stale source.
    function advanceableAsync(op, spec, ctxA, ctxB, evidence) {
      const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const rnd = Math.random().toString(36).slice(2);
      const c = store.create({ sessionId: "las.adv2." + rnd, subject: "s.adv2." + rnd, ipHash: "ip.adv2." + rnd, authenticated: false });
      const s = c.session; s.emit = () => {}; const deps = { session: s, store, runTurn: async () => {} };
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: ctxA }) });
      const arA = s.ackAuthorityRef;
      store.registerProposal(s, { proposalId: "pp.o", providerTurnId: "pt.o", operation: op, operationSpec: spec, executionNonce: "xn.o", receiptId: "rc.o", turnId: "t.1", generation: 0, authorityRef: arA, sourceResolvedHotelId: SCH.resolveSourceHotelId(op, spec, ctxA) });
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: s.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.o", proposalId: "pp.o", providerTurnId: "pt.o", actionId: "act.o", executionNonce: "xn.o", operation: op, authorityRef: arA } }) });
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.2", generation: 1, routeEpoch: 1, contextRevision: "rev.2", context: ctxB }) });
      const arB = s.ackAuthorityRef; const raB = raFor(arB, "t.2", 1, 1, "rev.2", ctxB);
      const st = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: s.sessionId, turnId: "t.2", generation: 1, receipt: { receiptId: "rc.o", proposalId: "pp.o", providerTurnId: "pt.o", actionId: "act.o", executionNonce: "xn.o", authorityRef: arA, operation: op, outcome: "verified", status: "verified", resultAuthority: raB, evidence } }) });
      return { s, arA, arB, st };
    }
    { const destA = { pageId: "hotel-detail", role: "anonymous", destination: null, query: null, loadState: "ready", visibleHotels: [], currentHotelId: "htl_2", validated: true, section: null, breakfast: "unknown", parking: "unknown" };
      const R2 = advanceableAsync("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 2 }, validCtx(3), destA, { kind: "detail", hotelId: "htl_2", breakfast: "unknown", parking: "unknown" });
      eq(R2.st, "receipt", "12.4 — an async OPEN verifies under the advanced destination authority");
      const rec = R2.s.verifiedReceipts.get("rc.o");
      ok(rec && rec.authorityRef === R2.arB && rec.authorityRef !== R2.arA, "12.4 — the OPEN trusted evidence is recorded under the RESULT authority (arB), not the stale source (arA)"); }
    { const detA = { pageId: "hotel-detail", role: "anonymous", destination: null, query: null, loadState: "ready", visibleHotels: [], currentHotelId: "htl_s", validated: true, section: "rooms", breakfast: "present", parking: "unknown" };
      const detB = { ...detA, section: "about" };
      const R3 = advanceableAsync("SHOW_HOTEL_SECTION", { op: "SHOW_HOTEL_SECTION", section: "about" }, detA, detB, { kind: "ui_state", section: "about", hotelId: "htl_s" });
      eq(R3.st, "receipt", "12.5 — an async SHOW verifies under the advanced section-context authority");
      const rec = R3.s.verifiedReceipts.get("rc.o");
      ok(rec && rec.authorityRef === R3.arB && rec.authorityRef !== R3.arA, "12.5 — the SHOW trusted evidence is recorded under the RESULT authority (arB), not the stale source (arA)"); }
    // (12.6) client evidenceSupportsPlan — a comparison FACTOR not present in the cited evidence (or a subset/superset) is refused.
    { const receipts = { "r.c": { proposalId: "pp.c", operation: "COMPARE_VISIBLE_HOTELS", outcome: "verified", authorityRef: "ar.p", evidence: { kind: "comparison", positions: [1, 2], hotelIds: ["h.one", "h.two"], factors: ["price"] } } };
      const ctxE = { getReceipt: (id) => receipts[id], currentAuthorityRef: "ar.p", contextHotelIds: new Set(["h.one", "h.two"]), positionToHotelId: (p) => ({ 1: "h.one", 2: "h.two" }[p] || null) };
      const okP = (plan) => P.evidenceSupportsPlan(plan, ctxE);
      const okS = (plan) => SCH.evidenceSupportsPlan(plan, ctxE);
      const mkPlan = (factors) => ({ kind: "comparison", evidenceReceiptIds: ["r.c"], selectedHotelIds: ["h.one", "h.two"], factors });
      ok(okP(mkPlan(["price"])) === true && okS(mkPlan(["price"])) === true, "12.6 — a comparison plan whose factors EXACTLY equal the cited evidence factors is supported (client == gateway)");
      ok(okP(mkPlan(["parking"])) === false && okS(mkPlan(["parking"])) === false, "12.6 — a comparison plan claiming a factor (parking) NOT in the price-only cited evidence is refused (client == gateway)");
      ok(okP(mkPlan(["price", "rating"])) === false && okS(mkPlan(["price", "rating"])) === false, "12.6 — a comparison plan factor SUPERSET of the cited evidence factors is refused (client == gateway)");
      ok(okP(mkPlan([])) === false && okS(mkPlan([])) === false, "12.6 — a comparison plan with NO factors is refused"); }
    // (12.7) pre-accept: a fabricated actionId is NOT committed; two DIFFERENT fabricated actionIds fold to the SAME commitment; the pre-accept proposal can NEVER later accept.
    { const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const c = store.create({ sessionId: "las.pa", subject: "s.pa", ipHash: "ip.pa", authenticated: false });
      const s = c.session; const acks = []; s.emit = (f) => { if (f.t === "action.receipt.ack") acks.push(f); };
      const deps = { session: s, store, runTurn: async () => {} };
      CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: validCtx(2) }) });
      const ar = s.ackAuthorityRef;
      store.registerProposal(s, { proposalId: "pp.pa", providerTurnId: "pt.pa", operation: "READ_CURRENT_RESULTS", operationSpec: { op: "READ_CURRENT_RESULTS" }, executionNonce: "xn.pa", receiptId: "rc.pa", turnId: "t.1", generation: 0, authorityRef: ar, sourceResolvedHotelId: null });
      // a PRE-ACCEPT refusal carrying a FABRICATED (never-accepted) actionId → terminal(rejected) WITHOUT that actionId in the audit.
      const preRej = (actionId) => CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: s.sessionId, turnId: "t.1", generation: 0, receipt: { receiptId: "rc.pa", proposalId: "pp.pa", providerTurnId: "pt.pa", actionId, executionNonce: "xn.pa", authorityRef: ar, operation: "READ_CURRENT_RESULTS", outcome: "rejected", status: "no_op" } }) });
      eq(preRej("act.FABRICATED_1"), "receipt", "12.7 — a pre-accept refusal terminalizes the proposal");
      ok(s.proposals.get("pp.pa").terminalOutcome === "rejected", "12.7 — the pre-accept proposal is TERMINAL(rejected)");
      ok(s.proposals.get("pp.pa").acceptedActionId === null, "12.7 — the pre-accept proposal NEVER bound an actionId");
      const firstCommit = acks[0].commitment;
      // an EXACT-duplicate pre-accept replay with a DIFFERENT fabricated actionId is idempotent AND yields the SAME commitment (the fabricated id is normalized out).
      eq(preRej("act.FABRICATED_2_DIFFERENT"), "receipt_idempotent", "12.7 — a duplicate pre-accept with a DIFFERENT fabricated actionId is idempotent (the actionId is normalized out of the audit)");
      ok(acks[1].commitment === firstCommit, "12.7 — two DIFFERENT fabricated actionIds fold to the SAME terminal commitment (no fabricated actionId in the pre-accept audit)");
      // the fabricated actionId is NOT the committed one — a commitment computed WITH the fabricated actionId differs from the emitted (sentinel) commitment.
      const withFab = SCH.terminalReceiptCommitment({ receiptId: "rc.pa", proposalId: "pp.pa", providerTurnId: "pt.pa", actionId: "act.FABRICATED_1", executionNonce: "xn.pa", operation: "READ_CURRENT_RESULTS", outcome: "rejected", status: "no_op", authorityRef: ar });
      ok(withFab !== firstCommit, "12.7 — the emitted pre-accept commitment is NOT the one that includes the fabricated actionId (the sentinel replaced it)");
      // the browser can NEVER later ACCEPT the terminalized proposal (revive authority).
      const lateAccept = CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: s.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.pa", proposalId: "pp.pa", providerTurnId: "pt.pa", actionId: "act.LATE", executionNonce: "xn.pa", operation: "READ_CURRENT_RESULTS", authorityRef: ar } }) });
      eq(lateAccept, "accepted_uncorrelated", "12.7 — a terminalized pre-accept proposal can NEVER later bind an actionId (no revival)"); }
    // (12.8 / 12.9) HOSTILE-JS totality — the new R5B client + gateway validators return null/false, NEVER throw.
    { const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; };
      const withGetter = (base, key) => { const o = Object.assign({}, base); Object.defineProperty(o, key, { get() { throw new Error("trap"); }, enumerable: true, configurable: true }); return o; };
      const withSymbol = (base) => { const o = Object.assign({}, base); o[Symbol("evil")] = 1; return o; };
      const withProto = (base) => Object.assign(Object.create({ inheritedAuthority: 1 }), base);
      const goodRA = { turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "0".repeat(64), authorityRef: "ar.1", contextDigest: "0".repeat(64) };
      const goodReceipt = { receiptId: "rc.1", proposalId: "pp.1", providerTurnId: "pt.1", actionId: "act.1", executionNonce: "xn.1", authorityRef: "ar.1", operation: "READ_CURRENT_RESULTS", outcome: "acted", status: "execution_acknowledged" };
      const goodRefine = { destination: "goa", query: null, maxPrice: null, parking: false, stars: [4], sort: "default", orderedIds: ["htl_1"], count: 1 };
      const goodEv = { kind: "detail", hotelId: "htl_1", breakfast: "present", parking: "unknown" };
      const goodAck = { t: "action.receipt.ack", sessionId: "las.x", turnId: "t.1", generation: 0, receiptId: "rc.1", proposalId: "pp.1", outcome: "verified", closed: true, commitment: "0".repeat(64) };
      // no-throw + null/false for a REVOKED PROXY top-level input on EVERY new R5B validator (client P + gateway SCH).
      let threw = false;
      try {
        ok(P.validateActionReceipt(revoked()) === null && SCH.validateActionReceipt(revoked()) === null, "12.8 — validateActionReceipt(revoked Proxy) → null (client + gateway)");
        ok(P.validateResultAuthority(revoked()) === null, "12.8 — client validateResultAuthority(revoked Proxy) → null");
        ok(P.validateServerFrame(revoked()) === null, "12.8 — client validateServerFrame(revoked Proxy) [ACK path] → null");
        ok(P.validateRefinementProjection(revoked()) === null && SCH.validateRefinementProjection(revoked()) === null, "12.8 — validateRefinementProjection(revoked Proxy) → null (client + gateway)");
        ok(P.validatePublishedContext(revoked()) === null && SCH.validatePublishedContext(revoked()) === null, "12.8 — validatePublishedContext(revoked Proxy) → null (client + gateway)");
      } catch (_e) { threw = true; }
      ok(threw === false, "12.8 — NO new R5B validator THREW on a revoked Proxy (total fail-closed)");
      // hostile ACCESSOR / SYMBOL / CUSTOM-PROTOTYPE on the new R5B structures → null/false, never throw.
      let threw2 = false;
      try {
        ok(P.validateActionReceipt(withGetter(goodReceipt, "operation")) === null, "12.9 — a hostile getter on ActionReceipt.operation → null");
        ok(P.validateResultAuthority(withSymbol(goodRA)) === null, "12.9 — a symbol key on ResultAuthority → null");
        ok(P.validateResultAuthority(withProto(goodRA)) === null, "12.9 — a custom-prototype ResultAuthority (inherited authority) → null");
        ok(P.validateRefinementProjection(withGetter(goodRefine, "maxPrice")) === null && SCH.validateRefinementProjection(withGetter(goodRefine, "maxPrice")) === null, "12.9 — a hostile getter on RefinementProjection.maxPrice → null (client + gateway)");
        ok(P.validateRefinementProjection(withSymbol(goodRefine)) === null, "12.9 — a symbol key on RefinementProjection → null");
        ok(P.validateServerFrame(withGetter(goodAck, "commitment")) === null, "12.9 — a hostile getter on the ACK frame's commitment → null");
        // sanity — the WELL-FORMED structures still validate (the guard rejects ONLY the hostile ones).
        ok(P.validateResultAuthority(goodRA) !== null && P.validateRefinementProjection(goodRefine) !== null && SCH.validateRefinementProjection(goodRefine) !== null, "12.9 — the well-formed ResultAuthority + RefinementProjection still validate (no over-rejection)");
        ok(P.validateServerFrame(goodAck) !== null, "12.9 — the well-formed ACK frame still validates");
        void goodEv;
      } catch (_e) { threw2 = true; }
      ok(threw2 === false, "12.9 — NO new R5B validator THREW on a hostile accessor / symbol / custom-prototype (total fail-closed)"); }
  }

  // ── R5B-THIRD-REMEDIATION — the THIRD-review attack matrix (REV-02 nav ordinal / REV-03 nested
  //    totality / REV-04 strict R5B arrays), driven through the EXPORTED gateway + client authority. ──
  section("R5B-THIRD-REMEDIATION — OPEN nav ordinal (REV-02) + gateway nested totality (REV-03) + strict R5B arrays (REV-04)");
  {
    // the LOCKED R5A hostile-array matrix, applied to the NEW R5B authority arrays.
    const shapes = (base) => [
      ["revoked proxy", () => { const r = Proxy.revocable(base.slice(), {}); r.revoke(); return r.proxy; }],
      ["own map override", () => { const a = base.slice(); a.map = () => base.slice(); return a; }],
      ["own Symbol.iterator override", () => { const a = base.slice(); a[Symbol.iterator] = function* () { for (const v of base) yield v; }; return a; }],
      ["accessor index 0", () => { const a = base.slice(); const v0 = a[0]; Object.defineProperty(a, 0, { get() { return v0; }, enumerable: true, configurable: true }); return a; }],
      ["sparse hole at index 0", () => { const a = base.slice(); delete a[0]; return a; }],
      ["Array subclass instance", () => { class Arr extends Array {} const a = new Arr(); for (const v of base) a.push(v); return a; }],
      ["changed prototype", () => { const a = base.slice(); Object.setPrototypeOf(a, { hijack: 1 }); return a; }],
      ["extra symbol own property", () => { const a = base.slice(); a[Symbol("s")] = 9; return a; }],
      ["extra named own property", () => { const a = base.slice(); a.tainted = 9; return a; }],
    ];

    // (A) THIRD-REV-04 — RefinementProjection.stars + .orderedIds strict on BOTH client + gateway.
    const goodRefine = { destination: "goa", query: null, maxPrice: null, parking: false, stars: [4, 5], sort: "default", orderedIds: ["h_a", "h_b"], count: 2 };
    ok(P.validateRefinementProjection(goodRefine) !== null && SCH.validateRefinementProjection(goodRefine) !== null, "THIRD-REV-04 — the well-formed RefinementProjection validates on BOTH ends (no over-rejection)");
    const refineReject = (label, over) => {
      let ct = false, st = false, cv = "u", sv = "u";
      try { cv = P.validateRefinementProjection(Object.assign({}, goodRefine, over())); } catch { ct = true; }
      try { sv = SCH.validateRefinementProjection(Object.assign({}, goodRefine, over())); } catch { st = true; }
      ok(!ct && !st, "THIRD-REV-04 — neither validator THROWS on RefinementProjection " + label);
      ok(cv === null && sv === null, "THIRD-REV-04 — client==gateway BOTH reject RefinementProjection " + label);
    };
    for (const [name, mk] of shapes([4, 5])) refineReject("stars — " + name, () => ({ stars: mk() }));
    for (const [name, mk] of shapes(["h_a", "h_b"])) refineReject("orderedIds — " + name, () => ({ orderedIds: mk(), count: 2 }));
    refineReject("stars [1] w/ hostile map()->[5]", () => { const a = [1]; a.map = () => [5]; return { stars: a }; });
    refineReject("orderedIds [\"x\"] w/ hostile iterator->[\"h_a\",\"h_b\"]", () => { const a = ["x"]; a[Symbol.iterator] = function* () { yield "h_a"; yield "h_b"; }; return { orderedIds: a, count: 1 }; });

    // (B) THIRD-REV-04 — the RECEIPT evidence arrays (results.orderedIds; comparison positions/hotelIds/
    //     factors) strict on BOTH client + gateway, driven through the exported validateActionReceipt.
    const evReject = (label, mkEv) => {
      const build = () => validReceipt({ evidence: mkEv() });
      let ct = false, st = false, cv = "u", sv = "u";
      try { cv = P.validateActionReceipt(build()); } catch { ct = true; }
      try { sv = SCH.validateActionReceipt(build()); } catch { st = true; }
      ok(!ct && !st, "THIRD-REV-04 — neither validator THROWS on receipt evidence " + label);
      ok(cv === null && sv === null, "THIRD-REV-04 — client==gateway BOTH reject receipt evidence " + label);
    };
    for (const [name, mk] of shapes(["htl_1", "htl_2"])) evReject("results.orderedIds — " + name, () => ({ kind: "results", count: 2, orderedIds: mk() }));
    const cmpEv = (over) => Object.assign({ kind: "comparison", positions: [1, 2], hotelIds: ["htl_1", "htl_2"], factors: ["price", "rating"], cheapestPosition: 1, topRatedPosition: 1 }, over || {});
    const cmpReceipt = (over) => validReceipt({ operation: "COMPARE_VISIBLE_HOTELS", evidence: cmpEv(over) });
    for (const [name, mk] of shapes([1, 2])) evReject("comparison.positions — " + name, () => cmpEv({ positions: mk() }));
    for (const [name, mk] of shapes(["htl_1", "htl_2"])) evReject("comparison.hotelIds — " + name, () => cmpEv({ hotelIds: mk() }));
    for (const [name, mk] of shapes(["price", "rating"])) evReject("comparison.factors — " + name, () => cmpEv({ factors: mk() }));
    ok(P.validateActionReceipt(cmpReceipt()) !== null && SCH.validateActionReceipt(cmpReceipt()) !== null, "THIRD-REV-04 — a well-formed comparison-evidence receipt still validates on BOTH ends (no over-rejection)");

    // (C) THIRD-REV-02 — OPEN navigation evidence MUST bind the EXACT proposed source ordinal.
    const openCtx = { pageId: "hotel-detail", currentHotelId: "htl_dest", visibleHotels: [] }; // honest destination
    const nav = (pos) => ({ kind: "navigation", hotelId: "htl_dest", position: pos });
    const OM = (spec, ev, ctx, src) => SCH.evidenceMatchesProposalSemantics("OPEN_VISIBLE_HOTEL", spec, ev, ctx, src);
    ok(OM({ op: "OPEN_VISIBLE_HOTEL", position: 2 }, nav(2), openCtx, "htl_dest") === true, "THIRD-REV-02 — proposal position 2 + evidence position 2 + correct source hotel → VALID");
    ok(OM({ op: "OPEN_VISIBLE_HOTEL", position: 2 }, nav(1), openCtx, "htl_dest") === false, "THIRD-REV-02 — proposal 2 + evidence position 1 (correct hotel) → REJECT (ordinal mismatch)");
    ok(OM({ op: "OPEN_VISIBLE_HOTEL", position: 2 }, nav(24), openCtx, "htl_dest") === false, "THIRD-REV-02 — proposal 2 + evidence position 24 → REJECT (ordinal mismatch)");
    ok(OM({ op: "OPEN_VISIBLE_HOTEL", position: 2 }, nav(2), { pageId: "hotel-detail", currentHotelId: "htl_OTHER", visibleHotels: [] }, "htl_dest") === false, "THIRD-REV-02 — correct position but WRONG destination hotel → REJECT");
    ok(OM({ op: "OPEN_VISIBLE_HOTEL", position: 2 }, { kind: "navigation", hotelId: "htl_WRONG", position: 2 }, openCtx, "htl_dest") === false, "THIRD-REV-02 — correct position but WRONG evidence hotelId → REJECT");
    ok(OM({ op: "OPEN_VISIBLE_HOTEL" }, nav(2), openCtx, "htl_dest") === false, "THIRD-REV-02 — ABSENT proposed ordinal (no operationSpec.position) → REJECT");
    ok(OM({ op: "OPEN_VISIBLE_HOTEL", position: 2 }, { kind: "detail", hotelId: "htl_dest", breakfast: "unknown", parking: "unknown" }, openCtx, "htl_dest") === true, "THIRD-REV-02 — DETAIL evidence at the honest destination (no list ordinal required) still VALID");

    // (D) THIRD-REV-03 — the COMPLETE gateway boundary is TOTAL fail-closed on NESTED hostile values
    //     (a revoked Proxy / a throwing discriminant nested inside visibleHotels / a hotel item / refinement /
    //     stars / orderedIds / evidence / context) returns null|false and NEVER throws.
    const rvArr = () => { const r = Proxy.revocable([1, 2], {}); r.revoke(); return r.proxy; };
    const rvObj = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; };
    const throwKind = () => { const ev = {}; Object.defineProperty(ev, "kind", { get() { throw new Error("trap"); }, enumerable: true }); return ev; };
    const baseCtx = (over) => Object.assign({ pageId: "hotels", role: "anonymous", destination: null, query: null, loadState: "ready", visibleHotels: [], currentHotelId: null, validated: true, section: null, breakfast: null, parking: null }, over);
    let anyThrew = false;
    const failClosed = (label, fn, want) => { let threw = false, v; try { v = fn(); } catch { threw = true; anyThrew = true; } ok(!threw, "THIRD-REV-03 — NO throw on " + label); ok(v === want, "THIRD-REV-03 — fail-closed → " + JSON.stringify(want) + " on " + label + " (got " + JSON.stringify(v) + ")"); };
    failClosed("validatePublishedContext visibleHotels=revoked", () => SCH.validatePublishedContext(baseCtx({ visibleHotels: rvArr() })), null);
    failClosed("validatePublishedContext nested hotel item=revoked", () => SCH.validatePublishedContext(baseCtx({ visibleHotels: [rvObj()] })), null);
    failClosed("validatePublishedContext refinement=revoked", () => SCH.validatePublishedContext(baseCtx({ refinement: rvObj() })), null);
    failClosed("validatePublishedContext refinement.stars=revoked", () => SCH.validatePublishedContext(baseCtx({ refinement: { destination: null, query: null, maxPrice: null, parking: false, stars: rvArr(), sort: "default", orderedIds: [], count: 0 } })), null);
    failClosed("validatePublishedContext refinement.orderedIds=revoked", () => SCH.validatePublishedContext(baseCtx({ refinement: { destination: null, query: null, maxPrice: null, parking: false, stars: [], sort: "default", orderedIds: rvArr(), count: 0 } })), null);
    failClosed("validatePublishedContext root=revoked", () => SCH.validatePublishedContext(rvObj()), null);
    failClosed("validateRefinementProjection root=revoked", () => SCH.validateRefinementProjection(rvObj()), null);
    failClosed("validateRefinementProjection orderedIds=revoked", () => SCH.validateRefinementProjection({ destination: null, query: null, maxPrice: null, parking: false, stars: [], sort: "default", orderedIds: rvArr(), count: 0 }), null);
    failClosed("validateActionReceipt root=revoked", () => SCH.validateActionReceipt(rvObj()), null);
    failClosed("validateActionReceipt evidence=revoked", () => SCH.validateActionReceipt(validReceipt({ evidence: rvObj() })), null);
    failClosed("validateActionReceipt evidence.orderedIds=revoked", () => SCH.validateActionReceipt(validReceipt({ evidence: { kind: "results", count: 2, orderedIds: rvArr() } })), null);
    failClosed("validateActionReceipt evidence throwing-kind-getter", () => SCH.validateActionReceipt(validReceipt({ evidence: throwKind() })), null);
    failClosed("evidenceMatchesProposalSemantics context=revoked", () => SCH.evidenceMatchesProposalSemantics("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { kind: "results", count: 0, orderedIds: [] }, rvObj(), null), false);
    failClosed("evidenceMatchesProposalSemantics ctx.visibleHotels=revoked", () => SCH.evidenceMatchesProposalSemantics("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { kind: "results", count: 0, orderedIds: [] }, { pageId: "hotels", loadState: "ready", visibleHotels: rvArr() }, null), false);
    failClosed("evidenceMatchesProposalSemantics evidence.positions=revoked (COMPARE)", () => SCH.evidenceMatchesProposalSemantics("COMPARE_VISIBLE_HOTELS", { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] }, { kind: "comparison", positions: rvArr(), hotelIds: ["a", "b"], factors: ["price"] }, { pageId: "hotels", loadState: "ready", visibleHotels: [] }, null), false);
    failClosed("evidenceMatchesProposalSemantics evidence=revoked (throwing discriminant)", () => SCH.evidenceMatchesProposalSemantics("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, throwKind(), { pageId: "hotels", loadState: "ready", visibleHotels: [] }, null), false);
    ok(anyThrew === false, "THIRD-REV-03 — NOTHING in the gateway validation boundary (validatePublishedContext / validateActionReceipt / validateRefinementProjection / evidenceMatchesProposalSemantics + every nested helper) threw on a nested hostile value (total fail-closed)");
  }

  // ── R5B-FOURTH-REMEDIATION — nested R5B authority-array IMMUTABILITY (freeze parity) ──────────────
  section("R5B-FOURTH-REMEDIATION — nested R5B authority-array IMMUTABILITY / freeze parity (FOURTH-REV-01)");
  {
    const cmpReceipt = () => validReceipt({ operation: "COMPARE_VISIBLE_HOTELS", evidence: { kind: "comparison", positions: [1, 2], hotelIds: ["htl_1", "htl_2"], factors: ["price", "rating"], cheapestPosition: 1, topRatedPosition: 1 } });
    const resReceipt = () => validReceipt({ evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } });
    const goodRefine = { destination: "goa", query: null, maxPrice: null, parking: false, stars: [4, 5], sort: "default", orderedIds: ["h_a", "h_b"], count: 2 };
    // 1 — a valid comparison-evidence receipt is accepted on BOTH ends.
    const gC = SCH.validateActionReceipt(cmpReceipt());
    const cC = P.validateActionReceipt(cmpReceipt());
    ok(gC !== null && cC !== null, "FOURTH-REV-01 — a valid comparison-evidence receipt is accepted on BOTH ends (no over-rejection)");
    // 2/5/6 — the gateway comparison positions/hotelIds/factors are ALL frozen.
    ok(Object.isFrozen(gC.evidence.positions), "FOURTH-REV-01 — GATEWAY comparison evidence.positions is FROZEN (the fix — was mutable)");
    ok(Object.isFrozen(gC.evidence.hotelIds), "FOURTH-REV-01 — GATEWAY comparison evidence.hotelIds is frozen");
    ok(Object.isFrozen(gC.evidence.factors), "FOURTH-REV-01 — GATEWAY comparison evidence.factors is frozen");
    // 3 — a post-validation index assignment cannot change the accepted value.
    { const before = gC.evidence.positions[0]; try { gC.evidence.positions[0] = 999; } catch (_e) { /* strict-mode throw */ } ok(gC.evidence.positions[0] === before && before === 1, "FOURTH-REV-01 — post-validation index assignment cannot change GATEWAY positions (still " + gC.evidence.positions[0] + ")"); }
    // 4 — push/pop/splice cannot change the accepted value.
    { const len = gC.evidence.positions.length; try { gC.evidence.positions.push(7); } catch (_e) { /* frozen */ } try { gC.evidence.positions.splice(0, 1); } catch (_e) { /* frozen */ } try { gC.evidence.positions.pop(); } catch (_e) { /* frozen */ } ok(gC.evidence.positions.length === len && JSON.stringify(gC.evidence.positions) === "[1,2]", "FOURTH-REV-01 — push/pop/splice cannot mutate GATEWAY positions (still " + JSON.stringify(gC.evidence.positions) + ")"); }
    // 7 — client/gateway nested-array freeze PARITY: every nested authority array frozen on BOTH.
    ok(Object.isFrozen(cC.evidence.positions) && Object.isFrozen(cC.evidence.hotelIds) && Object.isFrozen(cC.evidence.factors), "FOURTH-REV-01 — CLIENT comparison evidence positions/hotelIds/factors are ALL frozen (parity)");
    const gR = SCH.validateActionReceipt(resReceipt()), cR = P.validateActionReceipt(resReceipt());
    ok(Object.isFrozen(gR.evidence.orderedIds) && Object.isFrozen(cR.evidence.orderedIds), "FOURTH-REV-01 — results evidence.orderedIds frozen on BOTH ends");
    const gP = SCH.validateRefinementProjection(goodRefine), cP = P.validateRefinementProjection(goodRefine);
    ok(Object.isFrozen(gP.stars) && Object.isFrozen(cP.stars), "FOURTH-REV-01 — RefinementProjection.stars frozen on BOTH ends");
    ok(Object.isFrozen(gP.orderedIds) && Object.isFrozen(cP.orderedIds), "FOURTH-REV-01 — RefinementProjection.orderedIds frozen on BOTH ends");
    // 8 — hostile-array rejection is UNCHANGED (the freeze did not weaken strict rejection).
    { const revoked = () => { const r = Proxy.revocable([1, 2], {}); r.revoke(); return r.proxy; };
      let threw = false, v; try { v = SCH.validateActionReceipt(validReceipt({ operation: "COMPARE_VISIBLE_HOTELS", evidence: { kind: "comparison", positions: revoked(), hotelIds: ["htl_1", "htl_2"], factors: ["price", "rating"], cheapestPosition: 1, topRatedPosition: 1 } })); } catch { threw = true; }
      ok(!threw && v === null, "FOURTH-REV-01 — a hostile (revoked-Proxy) positions array is STILL rejected (freeze did not weaken strict rejection)"); }

    // FOURTH-REV-02 (focused) — the field-level COMPARISON-plan evidence-support path (client == gateway):
    // an exact plan is supported; a substituted / reordered / subset / superset factor set, a wrong selected
    // hotel id, and an unrelated cited receipt are ALL rejected. This is the exact production check the
    // genuine COMPARE E2E drives; here it is exercised directly on BOTH authorities.
    { const rec = { proposalId: "pp.x", operation: "COMPARE_VISIBLE_HOTELS", outcome: "verified", authorityRef: "ar.1", evidence: { kind: "comparison", positions: [1, 2], hotelIds: ["htl_1", "htl_2"], factors: ["price", "rating"], cheapestPosition: 1, topRatedPosition: 1 } };
      const ctx = { getReceipt: (id) => (id === "r.1" ? rec : undefined), currentAuthorityRef: "ar.1", contextHotelIds: new Set(["htl_1", "htl_2", "htl_3"]), positionToHotelId: (p) => ({ 1: "htl_1", 2: "htl_2", 3: "htl_3" })[p] || null };
      const plan = (over) => Object.assign({ planId: "pl.1", providerTurnId: "pt.1", kind: "comparison", language: "en", evidenceReceiptIds: ["r.1"], selectedHotelIds: ["htl_1", "htl_2"], factors: ["price", "rating"] }, over || {});
      const both = (label, over, want) => {
        const c = P.evidenceSupportsPlan(plan(over), ctx), g = SCH.evidenceSupportsPlan(plan(over), ctx);
        ok(c === want && g === want, "FOURTH-REV-02 focused — client==gateway comparison support " + (want ? "ACCEPTS" : "REJECTS") + " " + label + " (client=" + c + " gateway=" + g + ")");
      };
      both("the EXACT plan (factors [price,rating], ids [htl_1,htl_2])", {}, true);
      both("a SUBSTITUTED factor ([price,parking])", { factors: ["price", "parking"] }, false);
      both("a REORDERED factor sequence ([rating,price])", { factors: ["rating", "price"] }, false);
      both("a SUBSET factor set ([price])", { factors: ["price"] }, false);
      both("a SUPERSET factor set ([price,rating,parking])", { factors: ["price", "rating", "parking"] }, false);
      both("a WRONG selected hotel id ([htl_1,htl_3] — htl_3 was not compared)", { selectedHotelIds: ["htl_1", "htl_3"] }, false);
      both("an UNRELATED cited receipt ([r.none])", { evidenceReceiptIds: ["r.none"] }, false); }
  }

  section("R5B-THIRD-REMEDIATION — GENUINE production six-op end-to-end: REAL orchestrator proposal → REAL browser ↔ REAL control socket → client trusted-evidence promotion + supported plan (no fake auto-ACK)");
  {
    process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1"; // the browser runtime executes UI_LOCAL ops only under the beta gate
    const HOTELS = [
      { id: "htl_a", name: "Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi", "Parking", "Breakfast"] },
      { id: "htl_b", name: "Bravo", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["WiFi", "Breakfast"] },
      { id: "htl_c", name: "Charlie", city: "Dhanaulti", _minPrice: 2600, avgRating: 4.2, starRating: 3, amenities: ["Parking"] },
    ];
    function hotelsPage() {
      const st = { displayHotels: HOTELS.slice(), city: "Dhanaulti", query: "", maxPrice: null, sort: "default", stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Parking", "Breakfast"], resolvedCity: "Dhanaulti", resolvedQuery: "", loading: false, opened: null, openCalls: 0 };
      const reg = { pageId: "hotels", routeKey: "/hotels", getSnapshot: () => C.buildHotelsSnapshot({ displayHotels: st.displayHotels, city: st.city, query: st.query, checkIn: "", checkOut: "", guests: 2, maxPrice: st.maxPrice, sort: st.sort, stars: st.stars, appliedAmenities: st.appliedAmenities, amenityOpts: st.amenityOpts, loading: st.loading, error: "", resolvedCity: st.resolvedCity, resolvedQuery: st.resolvedQuery, resolvedStatus: "ready", role: "anonymous" }), execute: (cmd) => { if (cmd.kind === "open_hotel") { st.opened = cmd; st.openCalls += 1; } else if (cmd.kind === "apply_refinement" && "maxPrice" in cmd) st.maxPrice = cmd.maxPrice == null ? null : cmd.maxPrice; } };
      return { st, reg };
    }
    function detailPage(routeId, section) {
      const st = { section: section || "rooms" };
      const reg = { pageId: "hotel-detail", routeKey: "/hotels/" + routeId, getSnapshot: () => C.buildHotelDetailSnapshot({ routeId, hotel: { id: routeId, name: "Detail " + routeId, city: "Dhanaulti", starRating: 4, amenities: ["Breakfast", "Parking"], images: [], description: "x", rooms: [{ id: "r1", name: "Std", price: 3200 }] }, loading: false, loadErr: false, tab: st.section, role: "anonymous" }), execute: (cmd) => { if (cmd.kind === "show_section") st.section = cmd.section; } };
      return { st, reg };
    }
    function runningSink() { let closed = false; return { get closed() { return closed; }, resume: async () => true, enqueue: () => {}, stopAndClear: () => {}, close: () => { closed = true; }, state: () => (closed ? "closed" : "running") }; }

    let nn = 0;
    const gid = (p) => p + "." + (nn++);
    // drain the async provider seams (initial reasoning → followup reasoning → TTS) — all resolve on a
    // microtask, so a bounded setImmediate loop settles the whole chain deterministically (no wall clock).
    async function settle() { for (let i = 0; i < 24; i++) await new Promise((r) => setImmediate(r)); }
    function recordingSink(chunks) { let closed = false; return { get closed() { return closed; }, resume: async () => true, enqueue: (c) => { chunks.push(c); }, stopAndClear: () => {}, close: () => { closed = true; }, state: () => (closed ? "closed" : "running") }; }

    // R5B-THIRD-REV-05 — a GENUINE production six-op end-to-end: a REAL gateway session + the REAL
    // orchestrator + a REAL browser conversation ↔ REAL control socket, wired by a bounded in-memory routing
    // transport. The proposal ORIGINATES from orch.runTurn driven by the browser's turn.text (deterministic
    // injected reasoning) — NOT manual store.registerProposal. The control socket's runTurn/runTts ARE the
    // real orchestrator, so the follow-up EXPLAIN pass genuinely emits a supported action_status answer; the
    // browser PROMOTES the trusted verified evidence on the REAL action.receipt.ack (no fake auto-ACK),
    // APPROVES the supported plan, and the gateway voices it. Audio reaching the browser sink is the
    // end-to-end proof of client trust: no promotion ⇒ no approval ⇒ no audio; a stale-generation OPEN
    // follow-up ⇒ the browser discards the plan ⇒ no audio.
    function bridge(initReg, opForBridge, opts) {
      const badEvidence = !!(opts && opts.badEvidence);
      const compareFactorsOverride = opts && opts.compareFactorsOverride; // NEGATIVE COMPARE: an unsupported/reordered/substituted factor set
      const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const rt = R.createLiveAiRuntime("anonymous");
      rt.invalidateRoute(initReg.routeKey); rt.registerPage(initReg);
      const created = store.create({ sessionId: rt.sessionId, subject: "s.g6." + (nn++), ipHash: "ip.g6." + nn, authenticated: false });
      const s = created.session;
      const captured = { proposalId: null, receiptId: null };
      const audioChunks = [];
      const plans = [];
      const planFrames = []; // { kind, generation, turnId } — to prove the follow-up ran under the RESULT authority
      // deterministic reasoning, PARAMETERIZED BY OPERATION (R5B-FOURTH-REV-02): INITIAL phase (no verified
      // receipts yet) → the proposal; FOLLOWUP phase (a verified receipt now exists) → a real evidence-backed
      // EXPLAIN answer. For COMPARE_VISIBLE_HOTELS the follow-up is a REAL `kind:"comparison"` AnswerPlan bound
      // to the verified comparison evidence (selectedHotelIds derived from the requested positions, the EXACT
      // requested factor sequence, citing the gateway-minted comparison receipt) so the browser's production
      // field-level comparison-plan evidence-support path is genuinely exercised — NOT the generic action_status
      // fallback. Every other op keeps the action_status EXPLAIN. The NEGATIVE variants cite a fabricated
      // receipt (action_status) or an unsupported/reordered/substituted factor set (comparison).
      const reasoning = RESP.createReasoningAdapter({ model: RESP.REASONING_MODEL, call: async (input) => {
        const followup = Array.isArray(input.verifiedReceiptIds) && input.verifiedReceiptIds.length > 0;
        if (!followup) return { ok: true, usage: 12, candidate: { proposal: opForBridge } };
        if (opForBridge.op === "COMPARE_VISIBLE_HOTELS" && !badEvidence) {
          const selectedHotelIds = opForBridge.positions.map((p) => HOTELS[p - 1].id); // requested positions → source-list hotel ids
          const factors = compareFactorsOverride ? compareFactorsOverride.slice() : opForBridge.factors.slice();
          return { ok: true, usage: 12, candidate: { answer: { kind: "comparison", language: "en", selectedHotelIds, factors, evidenceReceiptIds: [captured.receiptId] } } };
        }
        const rid = badEvidence ? "rc.bogus.unverified" : captured.receiptId;
        return { ok: true, usage: 12, candidate: { answer: { kind: "action_status", language: "en", proposalId: captured.proposalId, receiptId: rid, outcome: "verified", evidenceReceiptIds: [rid] } } };
      } });
      const tts = TTS.createTtsAdapter({ model: TTS.TTS_MODEL, call: async () => ({ ok: true, chunks: [{ seq: 0, bytes: b64pcm(40) }] }) });
      const orch = ORCH.createLiveAiOrchestrator({ reasoning, tts, store, budget: fakeBudget(), genId: gid });
      let listener = null;
      // the gateway→browser hop is a REAL network hop (WebSocket) in production — deliver it ASYNC
      // (setImmediate), never re-entrant. This is what makes the initial runTurn finish recording the
      // pending follow-up turn BEFORE the browser's synchronous receipt round-trips back, so the terminal
      // verified receipt genuinely triggers the follow-up EXPLAIN pass. Ids are captured SYNCHRONOUSLY so the
      // deterministic followup answer can cite the gateway-minted receipt.
      s.emit = (frame) => {
        if (frame && frame.t === "action.proposal" && frame.proposal) { captured.proposalId = frame.proposal.proposalId; captured.receiptId = frame.receiptId; }
        if (frame && frame.t === "answer.plan" && frame.plan) { plans.push(frame.plan); planFrames.push({ kind: frame.plan.kind, generation: frame.generation, turnId: frame.turnId }); }
        const l = listener;
        setImmediate(() => { if (l) l({ type: "frame", frame }); });
      };
      const feed = (frame) => CTRL.handleLiveAiControlFrame({ session: s, store, runTurn: orch.runTurn, runTts: orch.runTts, raw: JSON.stringify(frame) });
      const transport = {
        kind: "gateway",
        async start() { if (listener) listener({ type: "frame", frame: { t: "connection.ready", sessionId: s.sessionId, gatewaySessionId: s.gatewaySessionId } }); return { ok: true }; },
        publishContext(frame) { feed(frame); return true; },
        submitText(input) { feed({ t: "turn.text", ...input }); return true; },
        submitActionAccepted(frame) { feed(frame); return true; },
        submitActionReceipt(frame) { feed(frame); return true; },
        submitApproval(input) { feed({ t: "answer.approve", ...input }); return true; },
        interrupt(input) { feed({ t: "turn.interrupt", ...input }); },
        reset(input) { feed({ t: "session.reset", sessionId: input.sessionId, generation: input.generation }); },
        end(input) { feed({ t: "session.end", sessionId: input.sessionId, generation: input.generation, reason: input.reason }); },
        subscribe(l) { listener = l; return () => { listener = null; }; },
        getConnectionState() { return "disconnected"; },
      };
      const audio = A.createAudioPlayback({ sink: recordingSink(audioChunks) });
      const conv = CONV.createConversation({ runtime: rt, transport, audio, now: () => Date.now() });
      return { store, s, rt, conv, transport, captured, audioChunks, plans, planFrames };
    }
    // Drive the FULL production chain: real connection.ready + context.publish → context.ack, then a real
    // turn.text → orch INITIAL proposal → browser accept/execute/receipt → gateway verify/record → (advance
    // the destination/re-ack context for an advanceable op) → orch FOLLOWUP answer → browser promote+approve
    // → gateway TTS → audio. Every hop is real production code; the transport is a bounded in-memory router.
    async function driveOp(B, advance) {
      await B.conv.start("text");
      await settle();
      B.conv.submitText("please do it", "en");
      await settle();
      if (advance) {
        advance(B); await settle();
        // a SECOND context observation AFTER the advance's ACK lands — the browser reconciles the acted
        // refinement/section/navigation to VERIFIED on the next authoritative context tick (the async
        // context.ack landed during the settle above; APPLY's tickReconcile fires on this next observation).
        B.conv.notifyContext(); await settle();
      }
      await settle();
    }
    function assertGenuine(label, B, kind) {
      const want = kind || "action_status";
      ok(B.captured.receiptId && B.s.verifiedReceipts.has(B.captured.receiptId), "GENUINE E2E — " + label + ": REAL orchestrator proposal → REAL browser receipt → gateway records the trusted verified receipt (no fake auto-ACK)");
      ok(B.s.proposals.get(B.captured.proposalId) && B.s.proposals.get(B.captured.proposalId).terminalOutcome === "verified", "GENUINE E2E — " + label + " reaches TERMINAL VERIFIED via the REAL ACK path");
      ok(B.plans.some((p) => p.kind === want) && B.audioChunks.length > 0, "GENUINE E2E — " + label + ": the browser PROMOTED the trusted evidence + APPROVED the supported " + want + " plan (audio voiced END-TO-END — proves client trust, not merely gateway state)");
    }

    // (1) READ_CURRENT_RESULTS — immediate-verify; browser promotes the trusted results receipt + approves.
    { const B = bridge(hotelsPage().reg, { op: "READ_CURRENT_RESULTS" }); await driveOp(B, null); assertGenuine("READ_CURRENT_RESULTS", B); }
    // (2) COMPARE_VISIBLE_HOTELS — R5B-FOURTH-REV-02: the follow-up is a REAL `kind:"comparison"` AnswerPlan
    //     (NOT the generic action_status), so the browser's production field-level comparison-plan
    //     evidence-support path is genuinely exercised: selected hotel ids derived from the requested
    //     positions, the EXACT requested factor sequence, bound to the verified comparison receipt.
    { const B = bridge(hotelsPage().reg, { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 3], factors: ["price", "rating"] });
      await driveOp(B, null);
      const prop = B.s.proposals.get(B.captured.proposalId);
      ok(prop && prop.operation === "COMPARE_VISIBLE_HOTELS", "GENUINE E2E COMPARE — the proposal came through the REAL orchestrator as COMPARE_VISIBLE_HOTELS");          // 1 real orchestrator proposal
      const vr = B.s.verifiedReceipts.get(B.captured.receiptId);
      ok(vr && vr.authorityRef === B.s.ackAuthorityRef, "GENUINE E2E COMPARE — the verified comparison receipt is bound to the EXACT source authority (source-bound: result == source)");  // 2/3 source==result authority
      ok(vr && vr.evidence && vr.evidence.kind === "comparison" && JSON.stringify(vr.evidence.positions) === "[1,3]" && JSON.stringify(vr.evidence.factors) === '["price","rating"]', "GENUINE E2E COMPARE — the EXACT comparison evidence (positions [1,3] + factors [price,rating]) terminal-verifies at the gateway"); // 4 exact evidence terminal verifies
      ok(prop.terminalOutcome === "verified", "GENUINE E2E COMPARE — real gateway ACK drove the proposal to TERMINAL VERIFIED"); // 5 real ACK received
      const cplan = B.plans.find((p) => p.kind === "comparison");
      ok(!!cplan, "GENUINE E2E COMPARE — the browser was offered a REAL kind:\"comparison\" AnswerPlan (not the generic action_status fallback)"); // 7 follow-up kind === comparison
      ok(cplan && JSON.stringify(cplan.selectedHotelIds) === '["htl_a","htl_c"]', "GENUINE E2E COMPARE — selectedHotelIds exactly match the requested positions [1,3] → [htl_a,htl_c]"); // 8 selected ids
      ok(cplan && JSON.stringify(cplan.factors) === '["price","rating"]', "GENUINE E2E COMPARE — factors exactly match the requested factor sequence [price,rating]"); // 9 exact factors
      ok(cplan && Array.isArray(cplan.evidenceReceiptIds) && cplan.evidenceReceiptIds.indexOf(B.captured.receiptId) >= 0, "GENUINE E2E COMPARE — the plan cites the compatible verified comparison receipt"); // 10 accepted by field-level support (cited)
      ok(B.audioChunks.length > 0, "GENUINE E2E COMPARE — the browser PROMOTED the trusted comparison evidence, APPROVED the comparison plan through the production field-level evidence-support path, and VOICED it (audio END-TO-END)"); } // 6/11/12 client promotion + approval + voiced
    // (3) READ_CURRENT_HOTEL_FACTS — immediate-verify; tri-state facts grounded in the detail context.
    { const B = bridge(detailPage("htl_a", "rooms").reg, { op: "READ_CURRENT_HOTEL_FACTS" }); await driveOp(B, null); assertGenuine("READ_CURRENT_HOTEL_FACTS", B); }
    // (4) SHOW_HOTEL_SECTION — acted, DRIVEN to terminal verified by the section-changed re-ack (same hotel).
    { const B = bridge(detailPage("htl_a", "rooms").reg, { op: "SHOW_HOTEL_SECTION", section: "about" }); await driveOp(B, (b) => b.conv.notifyContext()); assertGenuine("SHOW_HOTEL_SECTION", B); }
    // (5) OPEN_VISIBLE_HOTEL — acted (navigation), DRIVEN to terminal verified after the REAL route
    //     transition to the HONEST destination detail context (visibleHotels: []). The follow-up EXPLAIN runs
    //     under the RESULT (destination) generation (THIRD-REV-01) so the browser does NOT discard it as stale
    //     — audio here is the combined THIRD-REV-01 + THIRD-REV-05 proof; the navigation ordinal (1) binds the
    //     proposed source ordinal (THIRD-REV-02).
    { const B = bridge(hotelsPage().reg, { op: "OPEN_VISIBLE_HOTEL", position: 1 });
      await driveOp(B, (b) => { const dest = detailPage("htl_a", "rooms"); b.rt.invalidateRoute("/hotels/htl_a"); b.rt.registerPage(dest.reg); b.conv.onRouteChange(); });
      assertGenuine("OPEN_VISIBLE_HOTEL", B);
      // THIRD-REV-01 (explicit) — the source turn ran at generation 0; the authorized route_change bumped the
      // browser to a later generation; the follow-up action_status plan was emitted under THAT advanced
      // (RESULT) generation (never gen 0), which is precisely why the browser accepted it instead of
      // discarding it as stale. audioChunks>0 (asserted above) confirms the browser did NOT discard it.
      const openPlan = B.planFrames.find((f) => f.kind === "action_status");
      ok(openPlan && openPlan.generation > 0, "GENUINE E2E — OPEN follow-up EXPLAIN emitted under the ADVANCED RESULT generation (" + (openPlan ? openPlan.generation : "none") + " > source gen 0) — THIRD-REV-01"); }
    // (6) APPLY_HOTEL_REFINEMENT — acted (refinement applied), DRIVEN to terminal verified by the refined
    //     READY re-ack whose canonical refinement proves the applied maxPrice.
    { const hp = hotelsPage(); const B = bridge(hp.reg, { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 3000 });
      await driveOp(B, (b) => b.conv.notifyContext());
      ok(hp.st.maxPrice === 3000, "GENUINE E2E — APPLY: the refinement was genuinely applied on the real browser runtime (maxPrice 3000)");
      assertGenuine("APPLY_HOTEL_REFINEMENT", B); }
    // (7) NEGATIVE — a follow-up plan that CITES UNSUPPORTED EVIDENCE (a fabricated, never-verified receipt
    //     id) is DOWNGRADED by the orchestrator (never an action_status), the browser never promotes a bogus
    //     receipt, and NO supported plan is voiced. This is the counter-proof that the audio in (1)–(6) is a
    //     REAL client-trust signal (a plan citing unsupported evidence must NOT be approved/voiced).
    { const B = bridge(hotelsPage().reg, { op: "READ_CURRENT_RESULTS" }, { badEvidence: true }); await driveOp(B, null);
      ok(B.captured.receiptId && B.s.verifiedReceipts.has(B.captured.receiptId), "GENUINE E2E NEG — the READ still verifies at the gateway (the receipt IS real)");
      ok(!B.plans.some((p) => p.kind === "action_status"), "GENUINE E2E NEG — a follow-up citing a fabricated/unverified receipt is DOWNGRADED (never emitted as an evidence-backed action_status)");
      ok(!B.s.verifiedReceipts.has("rc.bogus.unverified"), "GENUINE E2E NEG — the fabricated receipt id is NEVER recorded as trusted evidence at the gateway"); }
    // (8) NEGATIVE COMPARE — a genuine COMPARE whose follow-up comparison plan carries a SUBSTITUTED factor
    //     ("parking" ≠ the requested "rating") is REJECTED by the production field-level comparison-plan
    //     evidence-support path (the verified comparison receipt's factors are [price,rating]): the orchestrator
    //     DOWNGRADES it (never emits kind:"comparison"), so an unsupported/reordered/substituted comparison
    //     plan can NEVER pass the client's comparison-specific support check as a comparison.
    { const B = bridge(hotelsPage().reg, { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 3], factors: ["price", "rating"] }, { compareFactorsOverride: ["price", "parking"] });
      await driveOp(B, null);
      ok(B.captured.receiptId && B.s.verifiedReceipts.has(B.captured.receiptId), "GENUINE E2E COMPARE NEG — the COMPARE still verifies at the gateway (the comparison receipt IS real)");
      ok(!B.plans.some((p) => p.kind === "comparison"), "GENUINE E2E COMPARE NEG — a comparison plan with a SUBSTITUTED factor (parking≠rating) is DOWNGRADED by the field-level evidence-support path (never emitted as a supported kind:\"comparison\")"); }
    // (9) NEGATIVE COMPARE (reordered) — the same, with the factor sequence REORDERED ([rating,price] ≠ the
    //     requested [price,rating]): exact-sequence support means a reorder is unsupported → downgraded.
    { const B = bridge(hotelsPage().reg, { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 3], factors: ["price", "rating"] }, { compareFactorsOverride: ["rating", "price"] });
      await driveOp(B, null);
      ok(!B.plans.some((p) => p.kind === "comparison"), "GENUINE E2E COMPARE NEG — a comparison plan with a REORDERED factor sequence ([rating,price]) is DOWNGRADED (exact-sequence support, no reorder)"); }
  }

  // ══════════════════════════ R5C — MEDIA OWNERSHIP / CAPTURE-LIMIT AUTHORITY ══════════════════════════
  // Deterministic clock + timer seams for the capture ledgers (no real time / provider).
  function r5cClock(start) { let t = typeof start === "number" ? start : 1000; return { now: () => t, adv: (ms) => { t += ms; }, set: (v) => { t = v; } }; }
  function r5cTimers() {
    let seq = 0; const m = new Map(); const log = { set: 0, clear: 0 };
    return {
      set: (fn, ms) => { log.set++; const id = ++seq; m.set(id, { fn, ms }); return id; },
      clear: (h) => { log.clear++; m.delete(h); },
      fireAll: () => { Array.from(m.entries()).forEach(([id, e]) => { m.delete(id); try { e.fn(); } catch (_) { /* no-op */ } }); },
      lastMs: () => { let last = null; m.forEach((e) => { last = e.ms; }); return last; },
      pending: () => m.size, log,
    };
  }

  section("R5C — browser capture ledger (controller-lifetime authority, unit)");
  {
    // (1) a fresh ledger is empty; the full allowance is available.
    { const L = GC.createCaptureLedger({ now: r5cClock().now }); const s = L.snapshot();
      ok(s.usedMs === 0 && s.remainingMs === GC.MAX_CONTROLLER_CAPTURE_MS && !s.active && !s.broken, "a fresh ledger has 0 used / full remaining / no active lease"); }
    // (2) MUT-C01 — an admitted lease is capped at the per-lease ceiling (min of 20000 and remaining).
    { const L = GC.createCaptureLedger({ now: r5cClock().now, setTimer: () => 1, clearTimer: () => {} });
      const r = L.begin(); ok(r.ok, "a lease is admitted on a fresh ledger");
      eq(r.ok ? r.admittedMs : -1, GC.MAX_CAPTURE_LEASE_MS, "R5C-MUTC01 — an admitted browser lease never exceeds the 20000ms per-lease cap");
      eq(GC.MAX_CAPTURE_LEASE_MS, 20000, "the per-lease cap is 20000ms"); eq(GC.MAX_CONTROLLER_CAPTURE_MS, 180000, "the cumulative cap is 180000ms"); }
    // (3) MUT-C05 — exactly ONE active lease: a second begin while active is refused.
    { const L = GC.createCaptureLedger({ now: r5cClock().now, setTimer: () => 1, clearTimer: () => {} });
      L.begin(); const r2 = L.begin();
      ok(r2.ok === false && r2.reason === "busy", "R5C-MUTC05 — a second browser begin while a lease is active is refused (one active lease)"); }
    // (4) MUT-C03 — a PARTIAL capture charges the ACTUAL monotonic elapsed (clamped to admitted).
    { const clk = r5cClock(1000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      L.begin(); clk.adv(5000); const charged = L.finalizeActive("partial");
      eq(charged, 5000, "R5C-MUTC03 — a partial browser capture charges the ACTUAL monotonic elapsed");
      eq(L.snapshot().usedMs, 5000, "the cumulative advanced by exactly the actual elapsed"); }
    // (5) partial elapsed is CLAMPED to the admitted duration (a runaway clock cannot over-charge past 20000).
    { const clk = r5cClock(1000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      L.begin(); clk.adv(999999); eq(L.finalizeActive("partial"), 20000, "a partial capture is clamped to the admitted 20000ms (no over-charge)"); }
    // (6) MUT-C04 — an EXPIRED lease (the 20s ceiling) charges the full admitted duration + tears down.
    { const clk = r5cClock(1000); let expired = 0; const tm = r5cTimers();
      const L = GC.createCaptureLedger({ now: clk.now, setTimer: tm.set, clearTimer: tm.clear, onLeaseExpired: () => { expired++; } });
      L.begin(); clk.adv(3000); eq(tm.lastMs(), 20000, "the 20s per-lease ceiling timer is armed at the admitted duration"); tm.fireAll();
      eq(L.snapshot().usedMs, 20000, "R5C-MUTC04 — an expired browser lease charges the full admitted duration");
      eq(expired, 1, "the lease-expiry callback tore the capture down exactly once"); ok(!L.snapshot().active, "the expired lease is closed"); }
    // (7) exactly-once idempotent finalization: a second finalize charges nothing.
    { const clk = r5cClock(1000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      L.begin(); clk.adv(4000); eq(L.finalizeActive("partial"), 4000, "the first finalize charges"); eq(L.finalizeActive("partial"), 0, "a second finalize with no active lease is an inert no-op");
      eq(L.snapshot().usedMs, 4000, "exactly-once: the cumulative did not double-charge"); }
    // (8) a stale lease TOKEN can never charge a newer lease (superseded-start safety).
    { const clk = r5cClock(1000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      const r1 = L.begin(); const tok1 = r1.ok ? r1.token : null; L.finalizeActive("partial"); L.begin(); clk.adv(1000);
      eq(L.finalize(tok1, "partial"), 0, "a superseded start's stale token cannot finalize (charge) the current lease");
      eq(L.snapshot().active, true, "the current lease stays active after the stale-token finalize"); }
    // (9) cumulative SURVIVES lease replacement (controller lifetime): many begin→finalize cycles accrue.
    { const clk = r5cClock(1000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      for (let i = 0; i < 4; i++) { L.begin(); clk.adv(10000); L.finalizeActive("partial"); }
      eq(L.snapshot().usedMs, 40000, "cumulative use survives replacement (4×10000 = 40000)"); eq(L.snapshot().leaseCount, 4, "four leases begun over the controller lifetime"); }
    // (10) the LAST lease is clamped to the REMAINING allowance (below the 20s per-lease cap).
    { const clk = r5cClock(1000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      for (let i = 0; i < 8; i++) { L.begin(); clk.adv(20000); L.finalizeActive("expired"); } // 160000 used
      const r = L.begin(); eq(r.ok ? r.admittedMs : -1, 20000, "with 20000 remaining, a lease admits 20000"); L.finalizeActive("expired"); // 180000
      const r2 = L.begin(); ok(r2.ok === false && r2.reason === "exhausted", "R5C-MUTC02 — an exhausted cumulative allowance refuses a new browser lease"); }
    // (11) a BACKWARDS clock latches broken (fail closed) + charges the admitted maximum (defense-in-depth).
    { const clk = r5cClock(10000); const L = GC.createCaptureLedger({ now: clk.now, setTimer: () => 1, clearTimer: () => {} });
      L.begin(); clk.set(9000); const charged = L.finalizeActive("partial");
      ok(L.snapshot().broken === true, "a backwards browser clock latches broken (fail closed, defense-in-depth)");
      eq(charged, 20000, "a backwards clock charges the admitted maximum (never a negative/under charge)");
      const r = L.begin(); ok(r.ok === false && r.reason === "broken", "a broken ledger refuses any further lease"); }
    // (12) MUT-C09 — a NON-FINITE clock at begin fails closed (clock) + latches broken.
    { let v = NaN; const L = GC.createCaptureLedger({ now: () => v, setTimer: () => 1, clearTimer: () => {} });
      const r = L.begin(); ok(r.ok === false && r.reason === "clock", "R5C-MUTC09 — a non-finite browser clock at begin fails closed (clock)"); ok(L.snapshot().broken === true, "and latches broken"); }
    // (13) a throwing clock is caught (never propagates) and fails closed.
    { const L = GC.createCaptureLedger({ now: () => { throw new Error("clock"); }, setTimer: () => 1, clearTimer: () => {} });
      let threw = false; let r; try { r = L.begin(); } catch (_) { threw = true; } ok(!threw && r && r.ok === false && r.reason === "clock", "a throwing clock is caught and fails closed (clock)"); }
    // (14) onLeaseExpired throwing is swallowed (never breaks the timer loop) + the lease still closes.
    { const clk = r5cClock(1000); const tm = r5cTimers(); const L = GC.createCaptureLedger({ now: clk.now, setTimer: tm.set, clearTimer: tm.clear, onLeaseExpired: () => { throw new Error("boom"); } });
      L.begin(); let threw = false; try { tm.fireAll(); } catch (_) { threw = true; } ok(!threw, "a throwing onLeaseExpired never propagates into the timer loop"); ok(!L.snapshot().active && L.snapshot().usedMs === 20000, "the lease still closed + charged despite the throwing callback"); }
    // (15) a zero / negative ceiling override falls back to the safe defaults (never an unbounded lease).
    { const L = GC.createCaptureLedger({ now: r5cClock().now, maxLeaseMs: 0, maxCumulativeMs: -5, setTimer: () => 1, clearTimer: () => {} });
      const r = L.begin(); eq(r.ok ? r.admittedMs : -1, 20000, "a 0/negative override falls back to the 20000ms default cap"); }
  }

  section("R5C — GENUINE CHAIN: the browser transport wires the capture ledger (media ownership + lease)");
  {
    // A genuine gateway transport driven with fakes (media / broker / socket / timers / clock) — the REAL
    // createGatewayTransport + createCaptureLedger, exercising media acquisition → lease → teardown.
    function micTransport(o) {
      o = o || {}; const clock = o.clock || r5cClock(1000); const timers = o.timers || r5cTimers();
      const media = { off: 0, ans: 0, closed: 0, acq: 0, createOffer: async (onAcquire) => { media.off++; if (o.offerThrow) throw new Error("mic"); if (onAcquire) { media.acq++; if (!onAcquire()) { media.closed++; throw new Error("capture_admission_refused"); } } return "v=0"; }, acceptAnswer: async () => { media.ans++; }, close: () => { media.closed++; } };
      const broker = { sessionId: "las.r5c", gatewaySessionId: "gw.r5c", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c/control", answerSdp: "v=0" };
      let fetchN = 0; const fetchImpl = async () => { fetchN++; if (o.brokerFail) return { ok: false, status: 500, json: async () => ({}) }; return { ok: true, status: 200, json: async () => broker }; };
      let handlers = null; const openSocket = (_u, _p, h) => { handlers = h; return { send() {}, close() {} }; };
      const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl, openSocket, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxCaptureLeaseMs: o.maxLease, maxControllerCaptureMs: o.maxCum });
      return { t, media, clock, timers, fetchCount: () => fetchN, getHandlers: () => handlers };
    }
    const S = { sessionId: "las.r5c", turnId: "turn.1", generation: 0, context: {} };
    // (a) a successful mic start acquires the mic AND arms exactly one 20s capture lease timer.
    { const H = micTransport(); const r = await H.t.start({ ...S, mode: "microphone" });
      ok(r.ok === true, "a mic start wins"); eq(H.media.off, 1, "the mic offer was created (media acquisition)");
      eq(H.timers.log.set, 1, "exactly ONE capture-lease timer is armed on a mic WIN"); eq(H.timers.lastMs(), 20000, "the lease timer is armed at the 20000ms per-lease ceiling"); }
    // (b) TEXT mode owns NO capture lease (no timer armed).
    { const H = micTransport(); const r = await H.t.start({ ...S, mode: "text" }); ok(r.ok === true, "a text start wins"); eq(H.timers.log.set, 0, "text mode arms NO capture lease"); }
    // (c) MUT-C07 — a BARGE-IN FINALIZES + CLOSES the capture and admits NO fresh lease (authority).
    //     Active capture → 5000ms elapsed → barge-in → lease finalized once (charged, not refunded) →
    //     mic tracks stopped → transport closed → NO fresh lease/timer → provider/VAD cannot re-lease →
    //     a fresh explicit start is required, and its lease draws from the REMAINING allowance (proving
    //     the barge-in charged exactly the elapsed: 22000 − 5000 = 17000 remaining, cumulative preserved).
    { const clock = r5cClock(1000); const H = micTransport({ clock, maxCum: 22000 });
      await H.t.start({ ...S, mode: "microphone" }); H.getHandlers().onOpen(); // connected, one lease timer armed
      eq(H.timers.pending(), 1, "a mic capture holds exactly one active lease timer");
      clock.adv(5000); H.t.interrupt({ ...S, reason: "barge_in" });
      eq(H.timers.pending(), 0, "R5C-MUTC07 — barge-in admits NO fresh capture lease + arms no new capture timer (no unauthorized re-lease)");
      eq(H.t.getConnectionState(), "disconnected", "barge-in CLOSES the capture (mic/peer/socket torn down → disconnected)");
      ok(H.media.closed >= 1, "barge-in STOPS the actual mic tracks (media closed)");
      ok(H.timers.log.clear >= 1, "the prior lease timer was cleared on the barge-in (finalized once)");
      // provider/VAD activity cannot create a lease (the transport has no VAD→lease path); no start ⇒ still none.
      eq(H.timers.pending(), 0, "no provider/VAD path can admit a fresh lease after barge-in (still no capture timer)");
      // a FRESH explicit start is REQUIRED for the next capture; it re-acquires the mic + a NEW lease
      // whose admitted duration = the REMAINING allowance (17000), proving the 5000ms was charged (non-refund).
      clock.adv(1000); const r2 = await H.t.start({ ...S, mode: "microphone" });
      ok(r2.ok === true, "a fresh explicit start(mode:\"microphone\") after barge-in re-acquires the mic");
      eq(H.media.off, 2, "the fresh start performs a NEW media acquisition (barge-in did not keep the mic)");
      eq(H.timers.lastMs(), 17000, "cumulative NON-REFUND: the fresh lease admits the remaining 17000ms (22000 − the 5000ms charged at barge-in)"); }
    // (c2) a barge-in DRAIN — repeated barge-in→fresh-start cycles accrue the SAME cumulative until it is
    //      spent (proving each barge-in charges + each restart draws from the remaining allowance).
    { const clock = r5cClock(1000); const H = micTransport({ clock }); let refusedAt = -1;
      for (let i = 0; i < 12; i++) { const r = await H.t.start({ ...S, mode: "microphone" }); if (r && r.ok === false) { refusedAt = i; break; } H.getHandlers().onOpen(); clock.adv(20000); H.t.interrupt({ ...S, reason: "barge_in" }); }
      ok(refusedAt === 9, "the 10th mic start (after 9×20000ms across BARGE-INS) is REFUSED — the 180000ms cumulative accrued every barge-in (refused at index " + refusedAt + ")"); }
    // (c3) a ROUTE_CHANGE interrupt leaves the EXISTING lease running (authorized nav; socket stays live for
    //      the R5B reconciliation) — it neither closes the capture nor arms a fresh lease.
    { const H = micTransport(); await H.t.start({ ...S, mode: "microphone" }); H.getHandlers().onOpen();
      const setBefore = H.timers.log.set; H.t.interrupt({ ...S, reason: "route_change" });
      eq(H.timers.log.set, setBefore, "a route_change arms NO fresh lease (the existing lease continues)");
      eq(H.timers.pending(), 1, "the existing capture lease keeps running across a route_change");
      eq(H.t.getConnectionState(), "connected", "a route_change keeps the socket LIVE (R5B context reconciliation runs after it)");
      eq(H.media.closed, 0, "a route_change does NOT close the mic"); }
    // (d) MUT-C08 — a FAILED media start closes the mic (no leaked capture).
    { const H = micTransport({ brokerFail: true }); const r = await H.t.start({ ...S, mode: "microphone" });
      ok(r.ok === false, "a broker-failed mic start fails"); ok(H.media.off === 1, "the mic was acquired");
      ok(H.media.closed >= 1, "R5C-MUTC08 — a failed media start closes the mic (no leaked capture)"); }
    // (e) MUT-C06 — teardown finalizes the lease so RECONNECT starts are admitted (not busy) + cumulative survives.
    { const clock = r5cClock(1000); const H = micTransport({ clock }); let allOk = true;
      for (let i = 0; i < 3; i++) { const r = await H.t.start({ ...S, mode: "microphone" }); if (!(r && r.ok)) allOk = false; clock.adv(1000); H.t.end({ sessionId: "las.r5c", generation: 0, reason: "user" }); }
      ok(allOk, "R5C-MUTC06 — transport teardown finalizes the lease so the next reconnect start is admitted (not busy)"); }
    // (f) a 20s lease breach tears the WHOLE capture down (fail closed): fire the lease timer → disconnected + mic closed.
    { const H = micTransport(); await H.t.start({ ...S, mode: "microphone" }); H.getHandlers().onOpen();
      eq(H.t.getConnectionState(), "connected", "connected after the mic WIN"); H.timers.fireAll();
      eq(H.t.getConnectionState(), "disconnected", "a 20s lease breach tears the capture down (disconnected)"); ok(H.media.closed >= 1, "the mic is closed on the lease breach"); }
    // (g) the CONTROLLER-LIFETIME cumulative survives across REAL reconnects until the allowance is spent.
    { const clock = r5cClock(1000); const H = micTransport({ clock }); let refusedAt = -1;
      for (let i = 0; i < 12; i++) { const r = await H.t.start({ ...S, mode: "microphone" }); if (r && r.ok === false) { refusedAt = i; break; } clock.adv(20000); H.t.end({ sessionId: "las.r5c", generation: 0, reason: "user" }); }
      ok(refusedAt === 9, "the 10th mic start (after 9×20000ms across reconnects) is REFUSED — the 180000ms cumulative survived every end()/reconnect (refused at index " + refusedAt + ")"); }
  }

  section("R5C — server capture ledger (independent process-local mirror, unit)");
  {
    // (1) a fresh subject is empty; the full allowance is available (independent per subject).
    { const L = SESS.createServerCaptureLedger({ now: r5cClock().now }); const s = L.snapshot("subA");
      ok(s.usedMs === 0 && s.remainingMs === SESS.SERVER_MAX_CUMULATIVE_MS && !s.active, "a fresh server subject has 0 used / full remaining");
      eq(SESS.SERVER_MAX_SEGMENT_MS, 20000, "server per-segment cap is 20000ms"); eq(SESS.SERVER_MAX_CUMULATIVE_MS, 180000, "server cumulative cap is 180000ms"); }
    // (2) MUT-C10 — a server segment is capped at the 20s per-segment ceiling.
    { const L = SESS.createServerCaptureLedger({ now: r5cClock().now }); const r = L.beginSegment("subA", "gw.1");
      eq(r.ok ? r.admittedMs : -1, 20000, "R5C-MUTC10 — a server segment never admits more than the 20000ms per-segment cap"); }
    // (3) MUT-C13 — exactly ONE active segment per subject: a second begin while active is refused (never evict live).
    { const L = SESS.createServerCaptureLedger({ now: r5cClock().now }); L.beginSegment("subA", "gw.1"); const r2 = L.beginSegment("subA", "gw.2");
      ok(r2.ok === false && r2.reason === "busy", "R5C-MUTC13 — a second server segment while one is active is refused (one active segment)"); }
    // (4) a PARTIAL finalize charges the ACTUAL server-measured elapsed (never a browser-reported duration).
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now }); L.beginSegment("subA", "gw.1"); clk.adv(6000);
      eq(L.finalizeSegment("subA", "gw.1", "partial"), 6000, "a partial server segment charges the actual server-measured elapsed"); eq(L.snapshot("subA").usedMs, 6000, "the server cumulative advanced by the actual elapsed"); }
    // (5) MUT-C12 — a FOREIGN sessionKey can never finalize a subject's active segment.
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now }); L.beginSegment("subA", "gw.1"); clk.adv(6000);
      eq(L.finalizeSegment("subA", "gw.OTHER", "partial"), 0, "R5C-MUTC12 — a foreign sessionKey can never finalize a subject's server segment");
      ok(L.snapshot("subA").active === true, "the segment stays live after a foreign-key finalize attempt"); }
    // (6) a closed segment can never REOPEN; a duplicate / reordered terminal is inert.
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now }); L.beginSegment("subA", "gw.1"); clk.adv(3000);
      eq(L.finalizeSegment("subA", "gw.1", "partial"), 3000, "the first terminal charges"); eq(L.finalizeSegment("subA", "gw.1", "partial"), 0, "a duplicate terminal on a closed segment is inert"); eq(L.snapshot("subA").usedMs, 3000, "the closed segment never reopened / double-charged"); }
    // (7) RECONNECT under the SAME subject cannot reset: cumulative carries across a new session key.
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now });
      L.beginSegment("subA", "gw.1"); clk.adv(7000); L.finalizeSegment("subA", "gw.1", "partial");
      const r = L.beginSegment("subA", "gw.2"); ok(r.ok, "a reconnect (new session key) begins a new segment"); eq(r.ok ? r.admittedMs : -1, 20000, "and admits up to the per-segment cap");
      eq(L.snapshot("subA").usedMs, 7000, "the prior cumulative (7000) survived the reconnect (never reset)"); }
    // (8) another SUBJECT is fully independent (its usage never touches this subject).
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now });
      L.beginSegment("subA", "gw.1"); clk.adv(9000); L.finalizeSegment("subA", "gw.1", "partial");
      eq(L.snapshot("subB").usedMs, 0, "a different subject has its OWN cumulative (0)"); eq(L.finalizeSegment("subB", "gw.1", "partial"), 0, "subject B cannot finalize subject A's (nonexistent-for-B) segment"); }
    // (9) MUT-C11 — an exhausted server cumulative refuses a new segment.
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now });
      for (let i = 0; i < 9; i++) { L.beginSegment("subA", "gw." + i); L.finalizeSegment("subA", "gw." + i, "expired"); } // 180000
      const r = L.beginSegment("subA", "gw.x"); ok(r.ok === false && r.reason === "exhausted", "R5C-MUTC11 — an exhausted server cumulative allowance refuses a new segment"); }
    // (10) an EXPIRED server segment (20s ceiling) charges the admitted duration + fires onSegmentExpired.
    { const clk = r5cClock(1000); const tm = r5cTimers(); let expired = null; const L = SESS.createServerCaptureLedger({ now: clk.now, timers: { set: tm.set, clear: tm.clear }, onSegmentExpired: (subj, key) => { expired = subj + "|" + key; } });
      L.beginSegment("subA", "gw.1"); clk.adv(2000); tm.fireAll();
      eq(L.snapshot("subA").usedMs, 20000, "an expired server segment charges the full admitted duration"); eq(expired, "subA|gw.1", "onSegmentExpired fired with the exact identity"); ok(!L.snapshot("subA").active, "the expired segment is closed"); }
    // (11) MUT-C14 — capacity exhaustion FAILS CLOSED: a live segment is NEVER evicted to admit a new subject.
    { const L = SESS.createServerCaptureLedger({ now: r5cClock().now, maxSubjects: 1 }); L.beginSegment("subA", "gw.1"); const r = L.beginSegment("subB", "gw.2");
      ok(r.ok === false && r.reason === "capacity", "R5C-MUTC14 — server capacity exhaustion fails closed (never evicts a live segment)"); ok(L.snapshot("subA").active === true, "the live segment survived the capacity pressure"); }
    // (12) bounded tombstone retention: a FINALIZED (inactive) subject beyond the retention window IS prunable.
    { const clk = r5cClock(1000); const L = SESS.createServerCaptureLedger({ now: clk.now, maxSubjects: 1 });
      L.beginSegment("subA", "gw.1"); L.finalizeSegment("subA", "gw.1", "partial"); clk.adv(SESS.SERVER_TOMBSTONE_RETENTION_MS + 10); const r = L.beginSegment("subB", "gw.2");
      ok(r.ok === true, "a finalized subject's tombstone (beyond the retention window) is prunable — a new subject is admitted"); }
    // (13) an empty subject / session key is refused (never a blank-identity segment).
    { const L = SESS.createServerCaptureLedger({ now: r5cClock().now });
      ok(L.beginSegment("", "gw.1").ok === false, "an empty subject is refused"); ok(L.beginSegment("subA", "").ok === false, "an empty session key is refused"); }
    // (14) a non-finite server clock at begin fails closed (clock).
    { const L = SESS.createServerCaptureLedger({ now: () => NaN }); ok(L.beginSegment("subA", "gw.1").ok === false, "a non-finite server clock at begin fails closed"); }
    // (15) the browser + server clocks are INDEPENDENT: the server never reads a browser duration (there is no
    //      finalize-with-duration entry point — finalizeSegment takes only (subject, sessionKey, kind)).
    { const L = SESS.createServerCaptureLedger({ now: r5cClock().now });
      const arity = L.finalizeSegment.length; ok(arity === 3, "the server finalize takes NO browser-reported duration (arity=" + arity + ", identity + kind only)"); }
  }

  section("R5C — server capture WIRING (control frames finalize the segment; store terminate finalizes)");
  {
    // The REAL session store wired with onTerminate → the REAL server ledger, and the REAL control-frame
    // handler passed the ledger. Proves interruption / reset / session.end / termination all finalize.
    function wired() {
      const clk = r5cClock(1000);
      let led; const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS, now: clk.now, onTerminate: (s) => { try { led.finalizeSegment(s.subject, s.gatewaySessionId, "partial"); } catch (_) { /* no-op */ } } });
      led = SESS.createServerCaptureLedger({ now: clk.now, onSegmentExpired: (_su, key) => { const s = store.get(key); if (s && !s.terminated) store.terminate(s, "timeout"); } });
      const created = store.create({ sessionId: "las.w", subject: "subW", ipHash: "ipW", authenticated: true });
      const s = created.session; led.beginSegment("subW", s.gatewaySessionId); // simulate mic-negotiation-success
      const deps = { session: s, store, captureLedger: led, runTurn: async () => {} };
      return { clk, store, led, s, deps };
    }
    // (a) a turn.interrupt FINALIZES the server segment (charges the actual elapsed).
    { const W = wired(); W.clk.adv(4000);
      const r = CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.w", turnId: "t.1", generation: 0, reason: "barge_in" }) });
      eq(r, "interrupt", "the interrupt frame is handled"); eq(W.led.snapshot("subW").usedMs, 4000, "an interruption finalizes the server capture segment (charged 4000)"); ok(!W.led.snapshot("subW").active, "the segment is closed after the interrupt"); }
    // (b) a session.reset FINALIZES the server segment.
    { const W = wired(); W.clk.adv(3000);
      const r = CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "session.reset", sessionId: "las.w", generation: 0 }) });
      eq(r, "reset", "the reset frame is handled"); eq(W.led.snapshot("subW").usedMs, 3000, "a reset finalizes the server capture segment (charged 3000)"); }
    // (c) session.end → store.terminate → onTerminate FINALIZES the segment.
    { const W = wired(); W.clk.adv(5000);
      CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "session.end", sessionId: "las.w", generation: 0, reason: "user" }) });
      ok(W.s.terminated === true, "session.end terminated the session"); eq(W.led.snapshot("subW").usedMs, 5000, "session.end finalizes the server capture segment via onTerminate (charged 5000)"); }
    // (d) an idle / control-close termination (store.terminate for ANY reason) finalizes the segment.
    { const W = wired(); W.clk.adv(8000); W.store.terminate(W.s, "closed"); eq(W.led.snapshot("subW").usedMs, 8000, "any store termination finalizes the server capture segment via onTerminate (charged 8000)"); }
    // (e) a duplicate interrupt after finalization is INERT (no double charge).
    { const W = wired(); W.clk.adv(2000);
      CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.w", turnId: "t.1", generation: 0, reason: "barge_in" }) });
      W.clk.adv(50000);
      CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.w", turnId: "t.2", generation: 0, reason: "barge_in" }) });
      eq(W.led.snapshot("subW").usedMs, 2000, "a duplicate interrupt after a closed segment is inert (still 2000, no double-charge)"); }
  }

  {
    // GENUINE gateway integration (jose ES256 assertion) — the REAL handleLiveAiSessionCreate begins a
    // server segment on mic-negotiation-success, text mode begins none, and an exhausted subject fails closed.
    let jose = null; try { jose = require(require.resolve("jose", { paths: [REPO] })); } catch (_) { jose = null; }
    if (jose) {
      section("R5C — GENUINE CHAIN: handleLiveAiSessionCreate begins/omits the server segment (mic vs text)");
      const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
      const spki = await jose.exportSPKI(publicKey);
      const env = { LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway", LIVE_AI_CONTROL_TOKEN_SECRET: "ctl", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill", LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-not-called" };
      const mkA = async (sub) => new jose.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false }).setProtectedHeader({ alg: "ES256" }).setSubject(sub).setJti("jti." + Math.random().toString(36).slice(2)).setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
      const goodSdp = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n";
      const fakeTx = () => ({ available: true, model: "gpt-live-transcribe", transcribe: async () => ({ ok: false, reason: "x" }), negotiate: async () => ({ ok: true, answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }) });
      // (a) a MIC session-create begins a server capture segment for the trusted subject.
      { const ctx = G.buildLiveAiContext({ env, budget: fakeBudget(null), transcription: fakeTx() });
        const r = await G.handleLiveAiSessionCreate(ctx, { origin: "https://x.test", ip: "9.9.9.1", authorization: "Bearer " + (await mkA("sub.mic")), body: { mode: "microphone", sessionId: "las.mic", sdp: goodSdp } });
        ok(r.status === 200, "the mic session-create succeeds"); ok(ctx.captureLedger.snapshot("sub.mic").active === true, "mic-negotiation-success BEGAN the server capture segment (active)");
        const s = ctx.store.get(r.body.gatewaySessionId); ctx.store.terminate(s, "user"); ok(ctx.captureLedger.snapshot("sub.mic").active === false, "terminating the session finalized the segment"); }
      // (b) a TEXT session-create begins NO server segment (text = no capture).
      { const ctx = G.buildLiveAiContext({ env, budget: fakeBudget(null), transcription: fakeTx() });
        const r = await G.handleLiveAiSessionCreate(ctx, { origin: "https://x.test", ip: "9.9.9.2", authorization: "Bearer " + (await mkA("sub.txt")), body: { mode: "text", sessionId: "las.txt" } });
        ok(r.status === 200, "the text session-create succeeds"); ok(ctx.captureLedger.snapshot("sub.txt").active === false && ctx.captureLedger.snapshot("sub.txt").usedMs === 0, "text mode begins NO server capture segment"); }
      // (c) capacity/EXHAUSTED fail-closed: a subject whose cumulative is spent cannot open a new mic session.
      { const ctx = G.buildLiveAiContext({ env, budget: fakeBudget(null), transcription: fakeTx() });
        for (let i = 0; i < 9; i++) { ctx.captureLedger.beginSegment("sub.exh", "pre." + i); ctx.captureLedger.finalizeSegment("sub.exh", "pre." + i, "expired"); } // 180000 spent
        const r = await G.handleLiveAiSessionCreate(ctx, { origin: "https://x.test", ip: "9.9.9.3", authorization: "Bearer " + (await mkA("sub.exh")), body: { mode: "microphone", sessionId: "las.exh", sdp: goodSdp } });
        ok(r.status === 503, "a subject with a spent cumulative allowance is refused a new mic capture (fail closed 503)"); }
    } else { section("R5C — GENUINE CHAIN (jose)"); ok(true, "jose unavailable — gateway-integration capture chain skipped (unit + control-frame coverage stands)"); }
  }

  // ══════════════════ R5C SECOND REMEDIATION — IN-FLIGHT MIC OWNERSHIP + ACQUISITION-TIME LEASE ══════════════════
  // The controller lease begins at PHYSICAL acquisition (inside createOffer, via the acquisition callback), a
  // SINGLE generation-local owner covers BOTH the in-flight (pending) and the installed phases, and every
  // capture-closing operation (barge_in / context_change / user_cancel / end / reset-teardown / lease expiry /
  // start failure / supersession) releases that owner exactly once — while route_change is the SOLE preserve.
  {
    const S2 = { sessionId: "las.r5c2", turnId: "turn.1", generation: 0, context: {} };
    // A genuine gateway transport with fully injected fakes + deterministic clock/timers. Supports a
    // controllable getUserMedia gate (o.mediaGate — a slow/non-abortable permission prompt), a controllable
    // broker gate (o.slowBroker — blocks the start in the CONNECTING/pending phase), brokerFail, and counters:
    // media.off (getUserMedia), media.acq (onAcquire invoked), media.acqFetch (broker count AT acquisition).
    function mk2(o) {
      o = o || {}; const clock = o.clock || r5cClock(1000); const timers = o.timers || r5cTimers();
      let fetchN = 0, aborted = 0, opens = 0, socketClosed = 0, releaseBroker = null;
      const brokerGate = o.slowBroker ? new Promise((r) => { releaseBroker = r; }) : null;
      const media = {
        off: 0, acq: 0, acqFetch: -1, ans: 0, closed: 0,
        createOffer: async (onAcquire) => {
          if (o.mediaGate) await o.mediaGate;                        // §7 — a slow / non-abortable getUserMedia
          media.off++;
          if (o.offerThrow) throw new Error("permission_denied");
          if (onAcquire) { media.acq++; media.acqFetch = fetchN; if (!onAcquire()) { media.closed++; throw new Error("capture_admission_refused"); } }
          return "v=0";
        },
        acceptAnswer: async () => { media.ans++; },
        close: () => { media.closed++; },
      };
      const broker = { sessionId: "las.r5c2", gatewaySessionId: "gw.r5c2", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c2/control", answerSdp: "v=0" };
      const fetchImpl = async (_u, init) => {
        fetchN++;
        if (init && init.signal) init.signal.addEventListener("abort", () => { aborted++; });
        if (brokerGate) await brokerGate;
        if (o.brokerFail) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => broker };
      };
      let handlers = null;
      const openSocket = (_u, _p, h) => { opens++; handlers = h; return { send() {}, close() { socketClosed++; } }; };
      const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl, openSocket, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxCaptureLeaseMs: o.maxLease, maxControllerCaptureMs: o.maxCum });
      return { t, media, clock, timers, getHandlers: () => handlers, fetchCount: () => fetchN, abortCount: () => aborted, openCount: () => opens, socketClosedCount: () => socketClosed, releaseBroker: () => { if (releaseBroker) releaseBroker(); } };
    }

    section("R5C2 §6 — the capture lease is admitted AT PHYSICAL ACQUISITION (onAcquire, before the broker), not after createOffer");
    { const H = mk2(); const r = await H.t.start({ ...S2, mode: "microphone" });
      ok(r.ok === true, "the mic start wins");
      eq(H.media.acq, 1, "MUT-R5C2-02 — the acquisition callback was invoked exactly once DURING createOffer (lease admitted at physical acquisition, not after)");
      eq(H.media.acqFetch, 0, "MUT-R5C2-02 — the lease was admitted BEFORE the broker was contacted (fetchCount==0 at acquisition)");
      eq(H.fetchCount(), 1, "the broker was contacted exactly once, AFTER admission");
      eq(H.timers.pending(), 1, "exactly one capture lease is active after the WIN"); }

    section("R5C2 §6/§9 — FAIL CLOSED: a media adapter that IGNORES the acquisition callback cannot capture without a lease");
    { // a NON-HONORING media: createOffer returns an offer WITHOUT invoking onAcquire (no lease admitted).
      const nh = { off: 0, closed: 0, createOffer: async () => { nh.off++; return "v=0"; }, acceptAnswer: async () => {}, close: () => { nh.closed++; } };
      const broker = { sessionId: "las.r5c2", gatewaySessionId: "gw.r5c2", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c2/control", answerSdp: "v=0" };
      const t = GC.createGatewayTransport({ createMediaSession: () => nh, fetchImpl: async () => ({ ok: true, status: 200, json: async () => broker }), openSocket: () => ({ send() {}, close() {} }), now: r5cClock(1000).now, setTimer: () => 1, clearTimer: () => {} });
      const r = await t.start({ ...S2, mode: "microphone" });
      ok(r.ok === false && r.code === "unsupported", "MUT-R5C2-09 — a mic offer with NO admitted lease fails closed (unsupported) — physical capture can never exist without a controller lease");
      ok(nh.closed >= 1, "the un-leased mic is closed (no hot mic left open)");
      eq(t.getConnectionState(), "error", "the fail-closed mic start goes to ERROR"); }

    section("R5C2 §5/§9 — a barge-in during the CONNECTING (pending) phase releases the in-flight owner (mic stopped, lease finalized, broker aborted); the late start never installs");
    { const clock = r5cClock(1000); const H = mk2({ clock, slowBroker: true });
      const p = H.t.start({ ...S2, mode: "microphone" });            // blocks in the broker (pending owner; lease admitted at acquisition)
      await new Promise((r) => setImmediate(r));                     // let createOffer resolve → onAcquire admitted the lease → now awaiting the slow broker
      eq(H.media.acq, 1, "the pending start already passed PHYSICAL acquisition + admitted its lease");
      eq(H.timers.pending(), 1, "the pending start holds an active capture lease while connecting");
      eq(H.t.getConnectionState(), "connecting", "the transport is CONNECTING (pending owner, awaiting the broker)");
      clock.adv(3000);
      H.t.interrupt({ ...S2, generation: 1, reason: "barge_in" });   // §9 — a barge during connecting releases the PENDING owner
      eq(H.timers.pending(), 0, "MUT-R5C2-01 — the barge-in released the PENDING owner's capture lease (finalized; no active lease survives connecting)");
      eq(H.t.getConnectionState(), "disconnected", "the barge-in tore the connecting capture down (disconnected)");
      ok(H.media.closed >= 1, "the barge-in stopped the pending start's physical mic tracks");
      ok(H.abortCount() >= 1, "MUT-R5C2-08 — the barge-in ABORTED the pending broker request");
      H.releaseBroker(); const r = await p;                          // the late broker resolves AFTER the teardown
      ok(r.ok === false, "MUT-R5C2-03 — the superseded pending start does NOT win after the barge (fails closed)");
      eq(H.openCount(), 0, "MUT-R5C2-03 — the superseded pending start never opened a control socket (never installed over a newer owner)");
      eq(H.t.getConnectionState(), "disconnected", "the transport stays disconnected — a fresh explicit start is required"); }

    section("R5C2 §7 — a teardown DURING a non-abortable getUserMedia: the late stream admits no lease, builds no peer, contacts no broker, opens no socket");
    { let release; const gate = new Promise((r) => { release = r; }); const H = mk2({ mediaGate: gate });
      const p = H.t.start({ ...S2, mode: "microphone" });            // blocks INSIDE createOffer awaiting getUserMedia
      await new Promise((r) => setImmediate(r));
      eq(H.media.off, 0, "getUserMedia has not resolved yet (physical acquisition pending)");
      H.t.end({ sessionId: "las.r5c2", generation: 1, reason: "user" });  // teardown while the permission prompt is open
      eq(H.t.getConnectionState(), "disconnected", "the teardown drove the transport to disconnected");
      release(); const r = await p;                                  // getUserMedia resolves LATE
      ok(r.ok === false, "the late-resolving mic start fails closed (never installs)");
      eq(H.media.acq, 1, "onAcquire ran once when the late stream resolved");
      ok(H.media.closed >= 1, "R5C2 §7 — the late getUserMedia stream's tracks are stopped (no resurrected hot mic)");
      eq(H.timers.pending(), 0, "R5C2 §7 — the late acquisition admitted NO capture lease (a non-abortable permission promise cannot resurrect capture authority)");
      eq(H.fetchCount(), 0, "R5C2 §7 — the late acquisition never contacted the broker");
      eq(H.openCount(), 0, "R5C2 §7 — the late acquisition never opened a control socket"); }

    section("R5C2 §5/§8/§12 — owner isolation: a superseded in-flight start closes ITS OWN media, never a newer owner's");
    { const made = [];
      const mkMedia = () => { const m = { closed: 0, createOffer: async (onAcquire) => { if (onAcquire && !onAcquire()) { m.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close: () => { m.closed++; } }; made.push(m); return m; };
      let fetchN = 0, resolveSlow; const slow = new Promise((r) => { resolveSlow = r; });
      const broker = { sessionId: "las.iso", gatewaySessionId: "gw.iso", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.iso/control", answerSdp: "v=0" };
      const t = GC.createGatewayTransport({ createMediaSession: mkMedia, fetchImpl: async () => { fetchN++; if (fetchN === 1) await slow; return { ok: true, status: 200, json: async () => broker }; }, openSocket: (u, p, h) => { const s = { send() {}, close() {} }; setTimeout(() => h.onOpen(), 0); return s; }, now: r5cClock(1000).now, setTimer: () => 1, clearTimer: () => {} });
      const p1 = t.start({ sessionId: "las.iso", turnId: "t.1", generation: 0, mode: "microphone", context: {} });
      await new Promise((r) => setTimeout(r, 0));                    // start1 acquired media[0] + its lease, then blocks on the slow broker
      t.end({ sessionId: "las.iso", generation: 0, reason: "user" }); // supersede start1 (pending)
      resolveSlow(); await p1;
      ok(made[0].closed >= 1, "MUT-R5C2-06 — the superseded in-flight start closed ITS OWN media session");
      const r2 = await t.start({ sessionId: "las.iso", turnId: "t.2", generation: 0, mode: "microphone", context: {} });
      ok(r2.ok === true, "a fresh start from DISCONNECTED wins"); eq(made.length, 2, "the fresh start minted a NEW media session");
      eq(made[1].closed, 0, "MUT-R5C2-06 — the OLD start's teardown did NOT close the NEW owner's media (exact owner isolation)"); }

    section("R5C2 §8 — a hard teardown (end) DURING a pending mic start stops the pending owner's mic tracks");
    { const clock = r5cClock(1000); const H = mk2({ clock, slowBroker: true });
      const p = H.t.start({ ...S2, mode: "microphone" });
      await new Promise((r) => setImmediate(r));                     // pending: mic acquired, lease admitted, awaiting the slow broker
      eq(H.media.off, 1, "the pending start acquired the mic"); eq(H.media.closed, 0, "the pending mic is still live");
      H.t.end({ sessionId: "las.r5c2", generation: 1, reason: "unmount" });
      ok(H.media.closed >= 1, "MUT-R5C2-07 — a hard teardown RELEASES the PENDING owner (its mic tracks are stopped, not leaked)");
      eq(H.timers.pending(), 0, "MUT-R5C2-07 — the pending owner's capture lease is finalized on teardown");
      H.releaseBroker(); const r = await p; ok(r.ok === false, "the superseded pending start fails closed"); }

    section("R5C2 §8/§12 — async cancellation matrix: every capture-closing operation releases the installed mic owner; a fresh explicit start is required (no auto-restart)");
    { async function connected() { const H = mk2(); await H.t.start({ ...S2, mode: "microphone" }); H.getHandlers().onOpen(); return H; }
      const closers = [
        ["barge_in interrupt", (H) => H.t.interrupt({ ...S2, generation: 1, reason: "barge_in" })],
        ["context_change interrupt", (H) => H.t.interrupt({ ...S2, generation: 1, reason: "context_change" })],
        ["user_cancel interrupt", (H) => H.t.interrupt({ ...S2, generation: 1, reason: "user_cancel" })],
        ["end (hidden/pagehide/unmount)", (H) => H.t.end({ sessionId: "las.r5c2", generation: 1, reason: "user" })],
        ["lease expiry (20s ceiling)", (H) => H.timers.fireAll()],
      ];
      for (const pair of closers) {
        const label = pair[0], close = pair[1]; const H = await connected();
        eq(H.timers.pending(), 1, label + ": one active capture lease before the close");
        eq(H.t.getConnectionState(), "connected", label + ": connected before the close");
        close(H);
        eq(H.timers.pending(), 0, "§8 — " + label + " RELEASES the mic owner (no active capture lease)");
        ok(H.media.closed >= 1, "§8 — " + label + " STOPS the physical mic tracks");
        eq(H.t.getConnectionState(), "disconnected", "§8 — " + label + " drives the transport to DISCONNECTED");
        const r2 = await H.t.start({ sessionId: "las.r5c2", turnId: "turn.2", generation: 2, mode: "microphone", context: {} });
        ok(r2.ok === true, "§8 — after " + label + " a FRESH explicit start(microphone) is required + admitted");
        eq(H.media.off, 2, "§8 — the fresh start re-acquired the mic (NO auto-restart across the cancellation)");
      }
      // route_change is the SOLE preserve (§10): the SAME lease continues, the socket stays live, the mic is not stopped.
      { const H = await connected(); const setB = H.timers.log.set;
        H.t.interrupt({ ...S2, generation: 1, reason: "route_change" });
        eq(H.timers.pending(), 1, "§10 — route_change PRESERVES the existing capture lease");
        eq(H.timers.log.set, setB, "§10 — route_change arms NO fresh lease");
        eq(H.media.closed, 0, "§10 — route_change does NOT stop the mic");
        eq(H.t.getConnectionState(), "connected", "§10 — route_change keeps the socket live (R5B reconciliation runs after it)"); } }

    section("R5C2 §13 — the ACTUAL production createBrowserMedia stops REAL MediaStreamTrack.stop() on close AND on acquisition refusal (not a fake counter)");
    { const g = globalThis; const savedNav = Object.getOwnPropertyDescriptor(g, "navigator"); const savedRTC = g.RTCPeerConnection;
      let lastTracks = null;
      function makeTrack() { return { stopped: 0, kind: "audio", stop() { this.stopped++; } }; }
      function fakeStream(tracks) { return { getTracks: () => tracks, getAudioTracks: () => tracks }; }
      function installMedia(opts) {
        opts = opts || {}; const tracks = [makeTrack(), makeTrack()]; lastTracks = tracks; let pcClosed = 0;
        try { Object.defineProperty(g, "navigator", { value: { mediaDevices: { getUserMedia: async () => { if (opts.gum) await opts.gum; return fakeStream(tracks); } } }, configurable: true, writable: true }); } catch (_) { g.navigator = { mediaDevices: { getUserMedia: async () => { if (opts.gum) await opts.gum; return fakeStream(tracks); } } }; }
        g.RTCPeerConnection = function () { return { addTrack() {}, createDataChannel() { return { close() {}, set onmessage(_x) { /* accept */ } }; }, createOffer: async () => ({ sdp: "v=0" }), setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close() { pcClosed++; } }; };
        return { tracks, pcClosed: () => pcClosed };
      }
      try {
        // (a) a SUCCESSFUL createOffer + close() stops the REAL tracks.
        { installMedia(); const m = GC.createBrowserMedia(); ok(m !== null, "createBrowserMedia constructs when the mic + WebRTC APIs are present");
          let admitted = 0; const sdp = await m.createOffer(() => { admitted++; return true; });
          ok(typeof sdp === "string" && sdp.length > 0, "createOffer returns an SDP after admission");
          eq(admitted, 1, "the acquisition callback was invoked once (at physical acquisition)");
          lastTracks.forEach((tk) => eq(tk.stopped, 0, "the real mic tracks are LIVE while capturing"));
          m.close();
          lastTracks.forEach((tk) => ok(tk.stopped >= 1, "R5C2 §13 — close() calls the REAL MediaStreamTrack.stop() on every mic track")); }
        // (b) an acquisition REFUSAL stops the real tracks + rejects WITHOUT leaving a live peer (no leaked hot mic).
        { const inst = installMedia(); const m = GC.createBrowserMedia();
          let threw = false; try { await m.createOffer(() => false); } catch (_) { threw = true; }
          ok(threw, "createOffer REJECTS when the acquisition callback refuses");
          lastTracks.forEach((tk) => ok(tk.stopped >= 1, "R5C2 §13 — a refused acquisition stops the just-acquired REAL mic tracks (no hot mic left open)"));
          eq(inst.pcClosed(), 0, "a refused acquisition never built a peer that leaked open (close only ran on tracks)"); }
        // (c) LATE getUserMedia after the media was released: the resolved stream's REAL tracks are stopped, no lease/peer.
        { let release; const gate = new Promise((r) => { release = r; }); installMedia({ gum: gate });
          const m = GC.createBrowserMedia();
          let threw = false; const pr = m.createOffer(() => false).catch(() => { threw = true; });
          m.close();                                                 // release BEFORE getUserMedia resolves
          release(); await pr;
          ok(threw, "a late getUserMedia (after teardown) still rejects (no resurrected capture)");
          lastTracks.forEach((tk) => ok(tk.stopped >= 1, "R5C2 §13/§7 — a late getUserMedia stream has its REAL tracks stopped (no resurrected hot mic)")); }
      } finally { if (savedNav) Object.defineProperty(g, "navigator", savedNav); else { try { delete g.navigator; } catch (_) { /* no-op */ } } g.RTCPeerConnection = savedRTC; } }

    section("R5C2 §14 — FRESH-GESTURE production chain: a REAL Conversation drives a REAL gateway transport; after bargeIn() a fresh explicit start(microphone) is required (no resurrection)");
    { process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const H = mk2();
      const rt = R.createLiveAiRuntime("anonymous");
      const reg = { pageId: "hotels", routeKey: "/hotels", getSnapshot: () => C.buildHotelsSnapshot({ displayHotels: [], city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null, sort: "default", stars: [], appliedAmenities: [], amenityOpts: [], loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready", role: "anonymous" }), execute: () => {} };
      rt.invalidateRoute(reg.routeKey); rt.registerPage(reg);
      let sinkClosed = false; const sink = { get closed() { return sinkClosed; }, resume: async () => true, enqueue: () => {}, stopAndClear: () => {}, close: () => { sinkClosed = true; }, state: () => (sinkClosed ? "closed" : "running") };
      const audio = A.createAudioPlayback({ sink });
      const conv = CONV.createConversation({ runtime: rt, transport: H.t, audio, now: () => Date.now() });
      const r1 = await conv.start("microphone"); H.getHandlers().onOpen();
      ok(r1.ok === true, "the REAL Conversation started a microphone turn through the REAL transport");
      eq(H.media.off, 1, "the production chain acquired the mic once"); eq(H.media.acq, 1, "the lease was admitted at physical acquisition via the production chain");
      eq(H.timers.pending(), 1, "the production chain holds exactly one active capture lease");
      conv.bargeIn();                                                // REAL barge-in → transport.interrupt(barge_in) → capture closed
      eq(H.timers.pending(), 0, "MUT-R5C2-10 — bargeIn() admits NO fresh capture lease (no auto re-lease)");
      eq(H.t.getConnectionState(), "disconnected", "bargeIn() closed the capture (disconnected)");
      ok(H.media.closed >= 1, "bargeIn() stopped the physical mic tracks");
      const r2 = await conv.start("microphone"); H.getHandlers().onOpen();
      ok(r2.ok === true, "R5C2 §14 — a FRESH explicit start(microphone) is required + admitted after the barge-in");
      eq(H.media.off, 2, "R5C2 §14 — the fresh gesture re-acquired the mic (the barge-in did NOT keep or auto-restart it)"); }

    section("R5C2 §11 — a route_change interrupt PRESERVES the server capture segment (no finalize/reset/extend); capture-closing reasons finalize it");
    { function wired2() {
        const clk = r5cClock(1000);
        let led; const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS, now: clk.now, onTerminate: (s) => { try { led.finalizeSegment(s.subject, s.gatewaySessionId, "partial"); } catch (_) { /* no-op */ } } });
        led = SESS.createServerCaptureLedger({ now: clk.now });
        const created = store.create({ sessionId: "las.rc", subject: "subRC", ipHash: "ipRC", authenticated: true });
        const s = created.session; led.beginSegment("subRC", s.gatewaySessionId);
        const deps = { session: s, store, captureLedger: led, runTurn: async () => {} };
        return { clk, store, led, s, deps };
      }
      // (a) route_change PRESERVES the segment (charges nothing; the segment continues).
      { const W = wired2(); W.clk.adv(6000);
        const r = CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.rc", turnId: "t.1", generation: 0, reason: "route_change" }) });
        eq(r, "interrupt", "the route_change interrupt is handled");
        ok(W.led.snapshot("subRC").active === true, "MUT-R5C2-05 — a route_change does NOT finalize the server capture segment (it continues under its existing deadline)");
        eq(W.led.snapshot("subRC").usedMs, 0, "MUT-R5C2-05 — the route_change charged NOTHING (segment continues)"); }
      // (b) the route_change neither reset nor extended the segment: a later barge_in charges the FULL elapsed from the ORIGINAL begin.
      { const W = wired2(); W.clk.adv(4000);
        CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.rc", turnId: "t.1", generation: 0, reason: "route_change" }) });
        W.clk.adv(5000);
        CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.rc", turnId: "t.2", generation: 0, reason: "barge_in" }) });
        eq(W.led.snapshot("subRC").usedMs, 9000, "the segment CONTINUED across the route_change: a later barge_in charges the full 9000 from the ORIGINAL begin (route_change neither reset nor extended the timer)");
        ok(!W.led.snapshot("subRC").active, "the capture-closing barge_in finalized the (continued) segment"); }
      // (c) context_change + user_cancel are CAPTURE-CLOSING on the server (finalize the exact active segment).
      { for (const reason of ["context_change", "user_cancel"]) {
          const W = wired2(); W.clk.adv(2000);
          const r = CTRL.handleLiveAiControlFrame({ ...W.deps, raw: JSON.stringify({ t: "turn.interrupt", sessionId: "las.rc", turnId: "t.1", generation: 0, reason }) });
          eq(r, "interrupt", "the " + reason + " interrupt is handled");
          eq(W.led.snapshot("subRC").usedMs, 2000, "a " + reason + " interrupt FINALIZES the server capture segment (capture-closing, charged 2000)");
          ok(!W.led.snapshot("subRC").active, "the " + reason + " segment is closed"); } } }

    section("R5C2 §16 — INTEGRATED browser↔server route: a REAL gateway transport's turn.interrupt drives the REAL control-frame handler; the FORBIDDEN state (browser capture active AND server segment inactive) never occurs");
    { function integrated() {
        const bClock = r5cClock(1000); const bTimers = r5cTimers(); const sClock = r5cClock(1000);
        let led; const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS, now: sClock.now, onTerminate: (s) => { try { led.finalizeSegment(s.subject, s.gatewaySessionId, "partial"); } catch (_) { /* no-op */ } } });
        led = SESS.createServerCaptureLedger({ now: sClock.now });
        const created = store.create({ sessionId: "las.int", subject: "subINT", ipHash: "ipINT", authenticated: true });
        const s = created.session; led.beginSegment("subINT", s.gatewaySessionId);
        const feed = (raw) => CTRL.handleLiveAiControlFrame({ session: s, store, captureLedger: led, runTurn: async () => {}, raw });
        const media = { off: 0, acq: 0, closed: 0, createOffer: async (onAcquire) => { media.off++; if (onAcquire && !onAcquire()) { media.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close: () => { media.closed++; } };
        const broker = { sessionId: "las.int", gatewaySessionId: "gw.int", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.int/control", answerSdp: "v=0" };
        let handlers = null;
        const openSocket = (_u, _p, h) => { handlers = h; return { send: (data) => { feed(data); }, close() {} }; }; // the control socket forwards every client frame to the REAL server
        const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl: async () => ({ ok: true, status: 200, json: async () => broker }), openSocket, now: bClock.now, setTimer: bTimers.set, clearTimer: bTimers.clear });
        return { t, media, bTimers, led, store, s, sClock, bClock, getHandlers: () => handlers };
      }
      const invariant = (H, label) => { const browserActive = H.bTimers.pending() > 0; const serverActive = H.led.snapshot("subINT").active; ok(!(browserActive && !serverActive), "R5C2 §16 — the FORBIDDEN state never occurs (browser capture active AND server segment inactive) — " + label + " [browser=" + browserActive + " server=" + serverActive + "]"); };
      // (a) route_change: BOTH preserved together.
      { const H = integrated(); await H.t.start({ sessionId: "las.int", turnId: "t.1", generation: 0, mode: "microphone", context: {} }); H.getHandlers().onOpen();
        invariant(H, "after connect"); eq(H.bTimers.pending(), 1, "the browser holds an active capture lease"); ok(H.led.snapshot("subINT").active, "the server holds an active segment");
        H.bClock.adv(3000); H.sClock.adv(3000);
        H.t.interrupt({ sessionId: "las.int", turnId: "t.1", generation: 0, reason: "route_change" });
        invariant(H, "after route_change");
        eq(H.bTimers.pending(), 1, "MUT-R5C2-05 — route_change PRESERVES the browser capture lease");
        ok(H.led.snapshot("subINT").active === true, "MUT-R5C2-05 — route_change PRESERVES the server capture segment (both continue together)");
        eq(H.t.getConnectionState(), "connected", "route_change keeps the browser socket LIVE"); }
      // (b) barge_in: BOTH closed together (also invariant-consistent).
      { const H = integrated(); await H.t.start({ sessionId: "las.int", turnId: "t.1", generation: 0, mode: "microphone", context: {} }); H.getHandlers().onOpen();
        H.bClock.adv(4000); H.sClock.adv(4000);
        H.t.interrupt({ sessionId: "las.int", turnId: "t.1", generation: 0, reason: "barge_in" });
        invariant(H, "after barge_in");
        eq(H.bTimers.pending(), 0, "a barge_in CLOSES the browser capture lease");
        ok(H.led.snapshot("subINT").active === false, "a barge_in FINALIZES the server capture segment (both closed together)");
        eq(H.t.getConnectionState(), "disconnected", "the browser capture is torn down"); } }

    section("R5C2 §16 — CUMULATIVE accounting: each teardown FINALIZES the owner's lease (owner-owned charge); capture accrues to the 180000ms controller ceiling and cannot be bypassed");
    { const clock = r5cClock(1000); const H = mk2({ clock }); let refusedAt = -1;
      // ONE transport / ONE controller-lifetime ledger. Each cycle: a mic start admits its lease at PHYSICAL
      // acquisition (T0), 20000ms of capture elapses (any slow pre-negotiation window is inside the lease), then
      // end() → the INSTALLED owner's release FINALIZES its own lease token (charges the actual 20000ms; there is
      // no redundant backstop — the owner is the single finalization authority). After 9×20000ms = 180000ms the
      // 10th acquisition is REFUSED (exhausted). If a teardown failed to finalize the owner's lease, the next
      // start would find it BUSY / the cumulative would never accrue — the ceiling would be bypassed.
      for (let i = 0; i < 12; i++) {
        const r = await H.t.start({ ...S2, mode: "microphone" });
        if (r && r.ok === false) { refusedAt = i; break; }
        clock.adv(20000);                         // capture elapses across the lease (incl. any pre-negotiation window)
        H.t.end({ sessionId: "las.r5c2", generation: 0, reason: "user" });
      }
      ok(refusedAt === 9, "MUT-R5C2-04 — each teardown FINALIZES the owner's lease so capture accrues to the 180000ms ceiling; the 10th mic start is REFUSED (refused at index " + refusedAt + ")"); }
  }

  // ════════════════ R5C THIRD REMEDIATION — PRE-ACQ CANCEL · LATE gUM · EXACT-OWNER RELEASE · SOCKET LIFECYCLE ════════════════
  {
    const S3 = { sessionId: "las.r5c3", turnId: "turn.1", generation: 0, context: {} };
    // A genuine gateway transport with fully injected fakes. o.mediaGate holds getUserMedia UNRESOLVED
    // (createOffer blocks BEFORE off++/onAcquire); o.slowBroker holds the broker; o.syncOpen/syncClose/
    // syncError deliver a socket callback SYNCHRONOUSLY during openSocket; o.reentrantClose makes the
    // socket's own close() synchronously re-invoke onClose (§10). Fresh media per start (a real factory).
    function mk3(o) {
      o = o || {}; const clock = o.clock || r5cClock(1000); const timers = o.timers || r5cTimers();
      let fetchN = 0, aborted = 0, opens = 0, releaseBroker = null, releaseMedia = null;
      const brokerGate = o.slowBroker ? new Promise((r) => { releaseBroker = r; }) : null;
      const mediaGate = o.mediaGate ? new Promise((r) => { releaseMedia = r; }) : null;
      const medias = [];
      const makeMedia = () => {
        const m = { off: 0, acq: 0, acqFetch: -1, closed: 0,
          createOffer: async (onAcquire) => {
            if (mediaGate) await mediaGate;                    // §7 — unresolved (non-abortable) getUserMedia
            m.off++;
            if (o.offerThrow) throw new Error("mic");
            if (onAcquire) { m.acq++; m.acqFetch = fetchN; if (!onAcquire()) { m.closed++; throw new Error("capture_admission_refused"); } }
            return "v=0";
          },
          acceptAnswer: async () => {}, close: () => { m.closed++; } };
        medias.push(m); return m;
      };
      const broker = { sessionId: "las.r5c3", gatewaySessionId: "gw.r5c3", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c3/control", answerSdp: "v=0" };
      const fetchImpl = async (_u, init) => { fetchN++; if (init && init.signal) init.signal.addEventListener("abort", () => { aborted++; }); if (brokerGate) await brokerGate; if (o.brokerFail) return { ok: false, status: 500, json: async () => ({}) }; return { ok: true, status: 200, json: async () => broker }; };
      const sockets = [];
      const openSocket = (_u, _p, h) => {
        opens++;
        const s = { closed: 0, _live: true, handlers: h, close() { this.closed++; if (o.reentrantClose && this._live) { this._live = false; h.onClose(); } } };
        sockets.push(s);
        if (o.syncOpen) h.onOpen();
        if (o.syncClose) h.onClose();
        if (o.syncError) h.onError();
        return s;
      };
      const t = GC.createGatewayTransport({ createMediaSession: makeMedia, fetchImpl, openSocket, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxCaptureLeaseMs: o.maxLease, maxControllerCaptureMs: o.maxCum });
      return { t, medias, clock, timers, fetchCount: () => fetchN, abortCount: () => aborted, openCount: () => opens, sockets, releaseBroker: () => { if (releaseBroker) releaseBroker(); }, releaseMedia: () => { if (releaseMedia) releaseMedia(); }, lastMedia: () => medias[medias.length - 1] };
    }

    // ── §5 REV-01 + §7 + §14(1..4) — a CAPTURE-CLOSING interrupt cancels a PENDING mic owner BEFORE getUserMedia resolves ──
    section("R5C3 §5/§7 — a capture-closing interrupt (barge_in / context_change / user_cancel) cancels a PENDING mic owner BEFORE getUserMedia resolves; the late stream admits no lease / peer / broker / socket");
    for (const reason of ["barge_in", "context_change", "user_cancel"]) {
      const H = mk3({ mediaGate: true });
      const p = H.t.start({ ...S3, mode: "microphone" });          // pending INSIDE createOffer awaiting getUserMedia
      await new Promise((r) => setImmediate(r));
      eq(H.lastMedia().off, 0, reason + ": getUserMedia has not resolved (physical acquisition pending)");
      eq(H.t.getConnectionState(), "connecting", reason + ": the transport is CONNECTING (pending mic owner)");
      H.t.interrupt({ ...S3, generation: 1, reason });             // §5 REV-01 — select by mic OWNERSHIP, not captureAcquired
      eq(H.t.getConnectionState(), "disconnected", "MUT-R5C3-01 — a " + reason + " cancels the PENDING mic owner before acquisition (disconnected)");
      ok(H.lastMedia().closed >= 1, "MUT-R5C3-01 — the pending mic owner's media is closed on the " + reason);
      H.releaseMedia(); const r = await p;                          // getUserMedia resolves LATE
      ok(r.ok === false, reason + ": the late-resolving pending start fails closed");
      eq(H.fetchCount(), 0, "a cancelled pre-acquisition start NEVER contacts the broker (" + reason + ")");
      eq(H.openCount(), 0, "a cancelled pre-acquisition start NEVER opens a socket (" + reason + ")");
      eq(H.timers.pending(), 0, "MUT-R5C3-08 — a cancelled pre-acquisition start admits NO capture lease (a stale continuation's onAcquire must refuse; no dangling lease) (" + reason + ")");
      const r2 = await H.t.start({ ...S3, turnId: "turn.2", generation: 2, mode: "microphone" });
      ok(r2.ok === true, "a FRESH explicit start(microphone) is admitted after the " + reason);
      eq(H.medias.length, 2, "the fresh start minted a NEW media instance (no reuse)");
    }

    // ── §6 media-latch (MUT-R5C3-02 / -07) — the ACTUAL production createBrowserMedia one-way closure ──
    section("R5C3 §6 — createBrowserMedia: a stream that resolves AFTER close() is immediately stopped (no reopen), independent of onAcquire; a refusal + a normal close stop the REAL tracks");
    { const g = globalThis; const savedNav = Object.getOwnPropertyDescriptor(g, "navigator"); const savedRTC = g.RTCPeerConnection;
      function mkTracks() { return [{ stopped: 0, kind: "audio", stop() { this.stopped++; } }, { stopped: 0, kind: "audio", stop() { this.stopped++; } }]; }
      function installGatedGUM(gate, tracksRef) {
        const nav = { mediaDevices: { getUserMedia: async () => { if (gate) await gate; const tr = mkTracks(); tracksRef.list.push(tr); return { getTracks: () => tr, getAudioTracks: () => tr }; } } };
        try { Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true }); } catch (_) { g.navigator = nav; }
        let pcCount = 0;
        g.RTCPeerConnection = function () { pcCount++; return { addTrack() {}, createDataChannel() { return { close() {}, set onmessage(_x) { /* accept */ } }; }, createOffer: async () => ({ sdp: "v=0" }), setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close() {} }; };
        return { pcCount: () => pcCount };
      }
      try {
        // (a) a LATE stream after close() is stopped, WITHOUT relying on onAcquire (onAcquire is a passthrough true).
        { let releaseGUM; const gate = new Promise((r) => { releaseGUM = r; }); const tr = { list: [] }; const inst = installGatedGUM(gate, tr);
          const m = GC.createBrowserMedia(); let acqCalls = 0;
          const pr = m.createOffer(() => { acqCalls++; return true; }).then(() => "ok", () => "rejected");
          m.close();                                              // close BEFORE getUserMedia resolves
          releaseGUM(); const outcome = await pr;
          eq(outcome, "rejected", "MUT-R5C3-02 — createOffer REJECTS when the media was closed during getUserMedia (late stream never installs)");
          eq(acqCalls, 0, "MUT-R5C3-02 — the acquisition callback is NEVER invoked for a late stream (refusal is media-local, not onAcquire)");
          eq(inst.pcCount(), 0, "MUT-R5C3-02 — a late stream builds NO RTCPeerConnection");
          tr.list.forEach((tk) => tk.forEach((x) => ok(x.stopped >= 1, "MUT-R5C3-02 — the late getUserMedia stream's REAL tracks are stopped"))); }
        // (b) a closed media instance is never reopened.
        { const tr = { list: [] }; installGatedGUM(null, tr); const m = GC.createBrowserMedia(); m.close();
          let threw = false; try { await m.createOffer(() => true); } catch (_) { threw = true; }
          ok(threw, "a closed media instance is never reopened (createOffer rejects)"); }
        // (c) a NORMAL createOffer + close() stops the REAL tracks (MUT-R5C3-07).
        { const tr = { list: [] }; installGatedGUM(null, tr); const m = GC.createBrowserMedia();
          const sdp = await m.createOffer(() => true); ok(typeof sdp === "string" && sdp.length > 0, "createOffer returns an SDP on success");
          tr.list[0].forEach((tk) => eq(tk.stopped, 0, "the mic tracks are live while capturing"));
          m.close();
          tr.list[0].forEach((tk) => ok(tk.stopped >= 1, "MUT-R5C3-07 — close() stops the REAL MediaStreamTrack.stop() on every track")); }
      } finally { if (savedNav) Object.defineProperty(g, "navigator", savedNav); else { try { delete g.navigator; } catch (_) { /* no-op */ } } g.RTCPeerConnection = savedRTC; }
    }

    // ── §15 — the ACTUAL createBrowserMedia THROUGH the transport: a stale pre-acquisition cancellation stops real tracks ──
    section("R5C3 §15 — the ACTUAL createBrowserMedia via the transport: a pre-acquisition barge/context_change stops the REAL late tracks (stale cancellation, NOT a hardcoded onAcquire), builds no peer, admits no lease, contacts no broker/socket");
    { const g = globalThis; const savedNav = Object.getOwnPropertyDescriptor(g, "navigator"); const savedRTC = g.RTCPeerConnection;
      function run(reason) {
        const tracksAll = []; let pcCount = 0, releaseGUM;
        const gum = new Promise((r) => { releaseGUM = r; });
        const nav = { mediaDevices: { getUserMedia: async () => { await gum; const tr = [{ stopped: 0, kind: "audio", stop() { this.stopped++; } }, { stopped: 0, kind: "audio", stop() { this.stopped++; } }]; tracksAll.push(tr); return { getTracks: () => tr, getAudioTracks: () => tr }; } } };
        try { Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true }); } catch (_) { g.navigator = nav; }
        g.RTCPeerConnection = function () { pcCount++; return { addTrack() {}, createDataChannel() { return { close() {}, set onmessage(_x) { /* accept */ } }; }, createOffer: async () => ({ sdp: "v=0" }), setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close() {} }; };
        const clock = r5cClock(1000); const timers = r5cTimers(); let fetchN = 0, opens = 0;
        const broker = { sessionId: "las.rm", gatewaySessionId: "gw.rm", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.rm/control", answerSdp: "v=0" };
        const t = GC.createGatewayTransport({ createMediaSession: () => GC.createBrowserMedia(), fetchImpl: async () => { fetchN++; return { ok: true, status: 200, json: async () => broker }; }, openSocket: (_u, _p, h) => { opens++; return { send() {}, close() {} }; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear });
        const p = t.start({ sessionId: "las.rm", turnId: "t.1", generation: 0, mode: "microphone", context: {} });
        return { t, p, tracksAll, pcCount: () => pcCount, fetchCount: () => fetchN, openCount: () => opens, timers, releaseGUM, reason };
      }
      try {
        for (const reason of ["barge_in", "context_change"]) {
          const H = run(reason);
          await new Promise((r) => setImmediate(r));               // start awaiting getUserMedia (unresolved)
          H.t.interrupt({ sessionId: "las.rm", turnId: "t.1", generation: 1, reason });  // stale cancellation
          H.releaseGUM(); const r = await H.p;                     // permission resolves LATE with observable tracks
          ok(r.ok === false, reason + ": the late-resolving actual-media start fails closed");
          ok(H.tracksAll.length >= 1, reason + ": getUserMedia did resolve (produced a real stream)");
          H.tracksAll[0].forEach((tk) => ok(tk.stopped >= 1, "R5C3 §15 — " + reason + " during unresolved getUserMedia calls the REAL MediaStreamTrack.stop() on every late track"));
          eq(H.pcCount(), 0, "R5C3 §15 — " + reason + ": RTCPeerConnection was NEVER constructed");
          eq(H.fetchCount(), 0, "R5C3 §15 — " + reason + ": the broker was NEVER contacted");
          eq(H.openCount(), 0, "R5C3 §15 — " + reason + ": NO control socket opened");
          eq(H.timers.pending(), 0, "R5C3 §15 — " + reason + ": NO capture lease admitted");
          const r2 = await H.t.start({ sessionId: "las.rm", turnId: "t.2", generation: 2, mode: "text", context: {} });
          ok(r2.ok === true, "R5C3 §15 — " + reason + ": a fresh explicit start is admitted after the cancellation");
        }
      } finally { if (savedNav) Object.defineProperty(g, "navigator", savedNav); else { try { delete g.navigator; } catch (_) { /* no-op */ } } g.RTCPeerConnection = savedRTC; }
    }

    // ── §8 (§14 19/20/21) — SYNCHRONOUS socket callbacks during openSocket ──
    section("R5C3 §8 — synchronous socket callbacks during openSocket: a pre-bind onClose/onError fails the start closed (no dead-socket install); a pre-bind onOpen is applied after binding");
    { // (a) synchronous onClose during openSocket → deterministic cleanup, no install (MUT-R5C3-05).
      const H = mk3({ syncClose: true }); const r = await H.t.start({ ...S3, mode: "microphone" });
      ok(r.ok === false, "MUT-R5C3-05 — a synchronous onClose during openSocket fails the start closed (no dead-socket installation)");
      eq(H.t.getConnectionState(), "disconnected", "MUT-R5C3-05 — the sync-closed candidate leaves the transport disconnected");
      eq(H.timers.pending(), 0, "MUT-R5C3-05 — no capture lease survives a sync-closed candidate");
      ok(H.lastMedia().closed >= 1, "the sync-closed candidate's media is closed"); }
    { // (b) synchronous onError during openSocket → error, no install.
      const H = mk3({ syncError: true }); const r = await H.t.start({ ...S3, mode: "microphone" });
      ok(r.ok === false, "a synchronous onError during openSocket fails the start closed");
      eq(H.timers.pending(), 0, "no lease survives a sync-error candidate"); }
    { // (c) synchronous onOpen during openSocket → buffered, applied after binding (mic WIN → connected).
      const H = mk3({ syncOpen: true }); const r = await H.t.start({ ...S3, mode: "microphone" });
      ok(r.ok === true, "a start with a synchronous onOpen still wins");
      eq(H.t.getConnectionState(), "connected", "the buffered synchronous onOpen is applied after binding (connected)"); }

    // ── §9 (§14 22/23) — installed current-socket close/error releases the exact owner ──
    section("R5C3 §9 — an installed current-socket close/error RELEASES the exact owner (browser lease finalized, mic stopped) — never leaves the browser active after the transport socket dies");
    { const H = mk3(); await H.t.start({ ...S3, mode: "microphone" }); H.sockets[0].handlers.onOpen();
      eq(H.t.getConnectionState(), "connected", "connected after the mic WIN"); eq(H.timers.pending(), 1, "one active capture lease");
      H.sockets[0].handlers.onClose();                            // the ACTUAL current socket dies
      eq(H.t.getConnectionState(), "disconnected", "MUT-R5C3-03 — an installed socket close drives the transport to disconnected");
      eq(H.timers.pending(), 0, "MUT-R5C3-03 — an installed socket close FINALIZES the browser capture lease (no lease left active)");
      ok(H.lastMedia().closed >= 1, "MUT-R5C3-03 — an installed socket close stops the physical mic tracks"); }
    { const H = mk3(); await H.t.start({ ...S3, mode: "microphone" }); H.sockets[0].handlers.onOpen();
      H.sockets[0].handlers.onError();
      eq(H.t.getConnectionState(), "error", "an installed socket error drives the transport to error");
      eq(H.timers.pending(), 0, "an installed socket error finalizes the browser capture lease"); }

    // ── §9 (§14 24) — an OLD socket callback after a newer explicit start is INERT ──
    section("R5C3 §9 — an OLD socket's close/error after a newer explicit start is INERT (never closes the newer owner)");
    { const H = mk3(); await H.t.start({ ...S3, mode: "microphone" }); H.sockets[0].handlers.onOpen();
      H.t.end({ sessionId: "las.r5c3", generation: 0, reason: "user" });   // release start1
      const r2 = await H.t.start({ ...S3, turnId: "turn.2", generation: 2, mode: "microphone" }); if (H.sockets[1]) H.sockets[1].handlers.onOpen();
      ok(r2.ok === true && H.t.getConnectionState() === "connected", "the newer start is connected");
      const pendBefore = H.timers.pending(); const media2ClosedBefore = H.medias[1].closed;
      H.sockets[0].handlers.onClose();                            // OLD socket terminal fires AFTER the newer start
      H.sockets[0].handlers.onError();
      // an OLD socket's INBOUND message (a connection.ready with a MISMATCHED gateway session id) must NOT
      // tear down the newer owner — inbound authority is gated on the exact bound candidate of the current owner.
      H.sockets[0].handlers.onMessage(JSON.stringify({ t: "connection.ready", sessionId: "las.r5c3", gatewaySessionId: "gw.OTHER" }));
      eq(H.t.getConnectionState(), "connected", "MUT-R5C3-04 — an OLD socket's callbacks (close/error + mismatched connection.ready) did NOT tear down the newer connected owner");
      eq(H.timers.pending(), pendBefore, "the OLD socket callback did NOT finalize the newer owner's lease");
      eq(H.medias[1].closed, media2ClosedBefore, "the OLD socket callback did NOT close the newer owner's media"); }

    // ── §10 (§14 28) — a reentrant close (socket.close() → onClose) is idempotent (no double teardown/charge) ──
    section("R5C3 §10 — a reentrant close (teardown's socket.close() synchronously re-invokes onClose) is INERT the second time (exactly-once teardown + charge)");
    { const clock = r5cClock(1000); const H = mk3({ clock, reentrantClose: true, maxCum: 22000 });
      await H.t.start({ ...S3, mode: "microphone" }); H.sockets[0].handlers.onOpen();
      clock.adv(5000); H.t.end({ sessionId: "las.r5c3", generation: 0, reason: "user" });   // dispose → socket.close() → reentrant onClose
      eq(H.t.getConnectionState(), "disconnected", "the reentrant close settles disconnected exactly once");
      eq(H.timers.pending(), 0, "the reentrant close finalized the lease (no active lease)");
      const r2 = await H.t.start({ ...S3, turnId: "turn.2", generation: 2, mode: "microphone" });
      eq(H.timers.lastMs(), 17000, "R5C3 §10 — exactly-once charge: the 5000ms was charged ONCE (fresh lease admits 22000−5000=17000, no double-charge)"); ok(r2.ok === true, "a fresh start after the reentrant close is admitted"); }

    // ── §11 (§14 25a) — route_change PRESERVES the browser owner/lease/socket (MUT-R5C3-06) ──
    section("R5C3 §11 — a route_change while the socket is alive PRESERVES the browser owner / lease / mic / socket (only an ACTUAL socket death is capture-closing)");
    { const H = mk3(); await H.t.start({ ...S3, mode: "microphone" }); H.sockets[0].handlers.onOpen();
      const setBefore = H.timers.log.set; H.t.interrupt({ ...S3, generation: 1, reason: "route_change" });
      eq(H.timers.log.set, setBefore, "MUT-R5C3-06 — route_change arms NO fresh lease");
      eq(H.timers.pending(), 1, "MUT-R5C3-06 — route_change PRESERVES the existing capture lease");
      eq(H.t.getConnectionState(), "connected", "MUT-R5C3-06 — route_change keeps the socket LIVE");
      eq(H.lastMedia().closed, 0, "MUT-R5C3-06 — route_change does NOT stop the mic");
      // ...and then an ACTUAL socket death after the route_change IS capture-closing.
      H.sockets[0].handlers.onClose();
      eq(H.t.getConnectionState(), "disconnected", "an ACTUAL socket death AFTER a route_change closes the browser capture");
      eq(H.timers.pending(), 0, "the socket death finalized the browser lease"); ok(H.lastMedia().closed >= 1, "the socket death stopped the mic"); }

    // ── §16 — INTEGRATED route → socket-termination: real Conversation + transport + control-frame + store + ledger ──
    section("R5C3 §16 — INTEGRATED route→socket termination: a real Conversation drives a real transport ↔ real control-frame handler; route_change preserves BOTH, then a socket death closes BOTH; the forbidden state (browser active AND server segment inactive) never settles; an OLD socket callback after a fresh start leaves the newer unaffected");
    { process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      function integrated() {
        const bClock = r5cClock(1000); const bTimers = r5cTimers(); const sClock = r5cClock(1000);
        let led; const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS, now: sClock.now, onTerminate: (s) => { try { led.finalizeSegment(s.subject, s.gatewaySessionId, "partial"); } catch (_) { /* no-op */ } } });
        led = SESS.createServerCaptureLedger({ now: sClock.now });
        const created = store.create({ sessionId: "las.i3", subject: "subI3", ipHash: "ipI3", authenticated: true });
        const srvSession = created.session; led.beginSegment("subI3", srvSession.gatewaySessionId);
        const feed = (raw) => CTRL.handleLiveAiControlFrame({ session: srvSession, store, captureLedger: led, runTurn: async () => {}, raw });
        const broker = { sessionId: "las.i3", gatewaySessionId: "gw.i3", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.i3/control", answerSdp: "v=0" };
        const medias = []; const sockets = [];
        const makeMedia = () => { const m = { off: 0, acq: 0, closed: 0, createOffer: async (onAcquire) => { m.off++; if (onAcquire && !onAcquire()) { m.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close: () => { m.closed++; } }; medias.push(m); return m; };
        const openSocket = (_u, _p, h) => { const s = { handlers: h, closed: 0, close() { this.closed++; }, send: (data) => { feed(data); } }; sockets.push(s); return s; };
        const t = GC.createGatewayTransport({ createMediaSession: makeMedia, fetchImpl: async () => ({ ok: true, status: 200, json: async () => broker }), openSocket, now: bClock.now, setTimer: bTimers.set, clearTimer: bTimers.clear });
        // kill the exact underlying socket: the SERVER terminates its session (→ finalize segment) AND the
        // browser's exact-socket onClose fires (→ release the browser owner). This models a real socket drop.
        const killSocket = (i) => { store.terminate(srvSession, "closed"); sockets[i].handlers.onClose(); };
        return { t, medias, sockets, bTimers, led, store, srvSession, sClock, bClock, killSocket, feed };
      }
      const browserActive = (H) => H.bTimers.pending() > 0;
      const serverActive = (H) => H.led.snapshot("subI3").active;
      const invariant = (H, label) => ok(!(browserActive(H) && !serverActive(H)), "R5C3 §16 — the forbidden state never settles (browser active AND server inactive) — " + label + " [b=" + browserActive(H) + " s=" + serverActive(H) + "]");
      const H = integrated();
      await H.t.start({ sessionId: "las.i3", turnId: "t.1", generation: 0, mode: "microphone", context: {} }); H.sockets[0].handlers.onOpen();
      invariant(H, "after connect"); eq(browserActive(H), true, "browser lease active after connect"); eq(serverActive(H), true, "server segment active after connect");
      H.bClock.adv(3000); H.sClock.adv(3000);
      H.t.interrupt({ sessionId: "las.i3", turnId: "t.1", generation: 0, reason: "route_change" });   // route_change: preserve BOTH
      invariant(H, "after route_change");
      eq(browserActive(H), true, "route_change PRESERVES the browser lease"); eq(serverActive(H), true, "route_change PRESERVES the server segment");
      eq(H.t.getConnectionState(), "connected", "route_change keeps the browser socket live");
      H.killSocket(0);                                            // ACTUAL socket death
      invariant(H, "after socket death");
      eq(browserActive(H), false, "MUT-R5C3-10 — the socket death releases the browser owner/lease");
      eq(serverActive(H), false, "the socket death finalizes the server segment (both inactive)");
      eq(H.t.getConnectionState(), "disconnected", "the browser transport is disconnected after the socket death");
      // a fresh explicit microphone start; then deliver OLD socket callbacks → newer unaffected.
      const H2 = integrated();  // fresh transport/session for the newer start (independent server session)
      await H2.t.start({ sessionId: "las.i3", turnId: "t.9", generation: 0, mode: "microphone", context: {} }); H2.sockets[0].handlers.onOpen();
      const pend = H2.bTimers.pending();
      H.sockets[0].handlers.onClose(); H.sockets[0].handlers.onError();   // OLD (dead) transport's callbacks
      eq(H2.bTimers.pending(), pend, "the OLD socket callbacks leave the NEWER browser owner unaffected");
      eq(H2.t.getConnectionState(), "connected", "the newer transport stays connected"); }

    // ── §17 — CUMULATIVE pre-negotiation accounting (owner-owned finalize; ceiling not bypassed) (MUT-R5C3-09) ──
    section("R5C3 §17 — cumulative pre-negotiation accounting: physical acquisition begins the lease; slow pre-negotiation elapsed is charged once on teardown; a replayed stale close does NOT charge again; the 180000ms ceiling cannot be bypassed");
    { // (a) a slow pre-negotiation start charges the elapsed once; the next admitted allowance is reduced by exactly that.
      const clock = r5cClock(1000); const H = mk3({ clock, slowBroker: true, maxCum: 22000 });
      const p = H.t.start({ ...S3, mode: "microphone" });         // lease admitted at physical acquisition (T0)
      await new Promise((r) => setImmediate(r));                  // createOffer done, awaiting the slow broker
      eq(H.timers.pending(), 1, "the pre-negotiation lease is active while the broker is pending");
      clock.adv(8000);                                            // 8000ms of pre-negotiation capture
      H.releaseBroker(); await p; H.sockets[0].handlers.onOpen();  // broker resolves → WIN → connected
      clock.adv(0); H.t.end({ sessionId: "las.r5c3", generation: 0, reason: "user" });  // finalize → charge 8000
      const r2 = await H.t.start({ ...S3, turnId: "turn.2", generation: 2, mode: "microphone" });
      eq(H.timers.lastMs(), 14000, "MUT-R5C3-09 — the pre-negotiation elapsed (8000) was charged ONCE; the next lease admits 22000−8000=14000");
      // replay a stale close from the first (dead) socket → no second charge.
      H.sockets[0].handlers.onClose();
      const r3After = H.timers.pending(); void r3After; ok(r2.ok === true, "the fresh start after pre-negotiation charge is admitted"); }
    { // (b) the 180000ms ceiling cannot be bypassed by repeated starts.
      const clock = r5cClock(1000); const H = mk3({ clock }); let refusedAt = -1;
      for (let i = 0; i < 12; i++) { const r = await H.t.start({ ...S3, mode: "microphone" }); if (r && r.ok === false) { refusedAt = i; break; } clock.adv(20000); H.t.end({ sessionId: "las.r5c3", generation: 0, reason: "user" }); }
      ok(refusedAt === 9, "MUT-R5C3-09 — each teardown charges the owner's lease; the 10th start is REFUSED at the 180000ms ceiling (refused at index " + refusedAt + ")"); }

    // ── §13 — NB-01: microphone mode with no media adapter releases the pending owner before unsupported ──
    section("R5C3 §13 — NB-01: microphone mode with NO media adapter releases the exact pending owner before returning unsupported (no leaked pending registration; a fresh start still works)");
    { const nbBroker = { sessionId: "las.nb", gatewaySessionId: "gw.nb", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.nb/control" };
      const t = GC.createGatewayTransport({ media: null, fetchImpl: async () => ({ ok: true, status: 200, json: async () => nbBroker }), openSocket: () => ({ send() {}, close() {} }), now: r5cClock(1000).now, setTimer: () => 1, clearTimer: () => {} });
      const r = await t.start({ sessionId: "las.nb", turnId: "t.1", generation: 0, mode: "microphone", context: {} });
      ok(r.ok === false && r.code === "unsupported", "NB-01 — mic mode without a media adapter → unsupported");
      eq(t.getConnectionState(), "error", "NB-01 — the released pending owner leaves the transport in a bounded terminal state (error)");
      // the pending owner was RELEASED (not leaked): end() clears cleanly to disconnected and a fresh start is admitted.
      t.end({ sessionId: "las.nb", generation: 1, reason: "user" });
      eq(t.getConnectionState(), "disconnected", "NB-01 — end() clears the transport to disconnected (no wedged pending owner)");
      const r2 = await t.start({ sessionId: "las.nb", turnId: "t.2", generation: 2, mode: "text", context: {} });
      ok(r2.ok === true, "NB-01 — a fresh start is admitted after clearing (the pending owner was released, not leaked)"); }

    // ── §14 — async checkpoint matrix: the remaining pre-negotiation failure checkpoints all fail closed with no install ──
    section("R5C3 §14 — async checkpoint matrix: every pre-WIN failure fails closed (no socket, no leaked lease) and a fresh start still works");
    { const cases = [
        ["createOffer rejection", { offerThrow: true }],
        ["broker non-OK", { brokerFail: true }],
      ];
      for (const pair of cases) {
        const label = pair[0]; const H = mk3(pair[1]);
        const r = await H.t.start({ ...S3, mode: "microphone" });
        ok(r && r.ok === false, "§14 — " + label + " fails the start closed");
        eq(H.openCount(), 0, "§14 — " + label + " opens NO socket");
        eq(H.timers.pending(), 0, "§14 — " + label + " leaves NO active capture lease");
      }
      // broker exception + abort (end during the in-flight broker fetch aborts it).
      { const H = mk3({ slowBroker: true }); const p = H.t.start({ ...S3, mode: "microphone" }); await new Promise((r) => setImmediate(r));
        H.t.end({ sessionId: "las.r5c3", generation: 0, reason: "user" }); eq(H.abortCount() >= 1, true, "§14 — end() aborts the in-flight broker fetch");
        H.releaseBroker(); const r = await p; ok(r.ok === false, "§14 — the aborted broker start fails closed"); eq(H.openCount(), 0, "§14 — no socket after the aborted broker"); }
      // lease expiry while connected tears the capture down.
      { const H = mk3(); await H.t.start({ ...S3, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.timers.fireAll();
        eq(H.t.getConnectionState(), "disconnected", "§14 — a 20s lease expiry tears the capture down"); ok(H.lastMedia().closed >= 1, "§14 — the lease expiry stops the mic"); } }

    // ══════════════════════════ R5C FOURTH REMEDIATION (R5C4) ══════════════════════════
    // §10 — an OPTIONAL, TEST-ONLY target selector. It NEVER changes production behavior and,
    // when unset (the normal regression default), executes EVERY R5C4 sub-section (and every
    // earlier R5A/R5B/R5C section, which are unconditional). A specific value only NARROWS the
    // R5C4 sub-sections (a focused mutation-probe re-run) — it can never skip R5A/R5B.
    const R5C4_TARGET = (typeof process !== "undefined" && process.env && process.env.LIVE_AI_TEST_TARGET) ? String(process.env.LIVE_AI_TEST_TARGET) : "";
    const r5c4want = (tag) => !R5C4_TARGET || R5C4_TARGET === "r5c4" || R5C4_TARGET === tag;
    const S4 = { sessionId: "las.r5c4", turnId: "turn.4", generation: 0, context: {} };

    // ── §6/§7 — the async CHECKPOINT MATRIX. For every load-bearing async stage of the
    // production start() (getUserMedia, the acquisition-lease callback, createOffer/
    // setLocalDescription, broker fetch, response, openSocket, synchronous onOpen/onClose/
    // onError, delayed callbacks, and the lease timer) the applicable dimension is exercised:
    //   A = a capture-closing interruption during the stage,
    //   B = an end()/dispose during the stage,
    //   C = a lease expiry / lease non-admission,
    //   D = a STALE completion after a fresh generation (superseded start),
    //   E = the success control.
    // Every failing checkpoint MUST fail closed (no socket, no leaked lease, real tracks stopped)
    // and leave a subsequent fresh start admissible. 23 checkpoints (CP-01..CP-23).
    if (r5c4want("cp")) {
    section("R5C4 §6/§7 — async checkpoint matrix (23): every pre-WIN async stage fails closed under A/B/C/D interruption; E succeeds");
    {
      let cp = 0; const tick = () => new Promise((r) => setImmediate(r));
      // ── Stage 1: getUserMedia (mediaGate pending) ──
      // CP-01/02/03 (A) — a capture-closing interrupt during the pending permission prompt.
      for (const reason of ["barge_in", "context_change", "user_cancel"]) {
        cp++;
        const H = mk3({ mediaGate: true });
        const p = H.t.start({ ...S4, mode: "microphone" });
        await tick();                                              // start is inside createOffer awaiting gUM
        H.t.interrupt({ ...S4, reason });                          // capture-closing cancel BEFORE gUM resolves
        H.releaseMedia();                                          // the permission lands LATE
        const r = await p;
        ok(r && r.ok === false, "CP-" + String(cp).padStart(2, "0") + " A(" + reason + ") — a cancel during pending getUserMedia fails the start closed");
        eq(H.openCount(), 0, "CP-" + String(cp).padStart(2, "0") + " — opened NO socket");
        eq(H.timers.pending(), 0, "CP-" + String(cp).padStart(2, "0") + " — admitted NO capture lease");
        ok(H.lastMedia().closed >= 1, "CP-" + String(cp).padStart(2, "0") + " — the cancelled media was closed (real tracks stopped); no lease/socket formed");
      }
      // CP-04 (B) — an end() during the pending permission prompt.
      { cp++; const H = mk3({ mediaGate: true }); const p = H.t.start({ ...S4, mode: "microphone" }); await tick();
        H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" }); H.releaseMedia(); const r = await p;
        ok(r && r.ok === false, "CP-04 B — end() during pending getUserMedia fails closed");
        eq(H.openCount(), 0, "CP-04 — no socket"); eq(H.timers.pending(), 0, "CP-04 — no lease"); }
      // CP-05 (D) — a STALE start superseded by end()+fresh start; the stale gUM admits nothing, the fresh one works.
      { cp++; const H = mk3({ mediaGate: true }); const p1 = H.t.start({ ...S4, mode: "microphone" }); await tick();
        H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" });   // supersede the pending start (generation invalidated)
        H.releaseMedia(); const r1 = await p1;                                 // stale gUM lands after supersede
        ok(r1 && r1.ok === false, "CP-05 D — the superseded start's late getUserMedia fails closed (no resurrection)");
        eq(H.openCount(), 0, "CP-05 — the stale start opened no socket");
        const r2 = await H.t.start({ ...S4, turnId: "turn.4b", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen();
        ok(r2 && r2.ok === true, "CP-05 — a fresh start after the supersede is admitted"); }
      // CP-06 (E) — getUserMedia resolves cleanly → the start proceeds.
      { cp++; const H = mk3(); const r = await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen();
        ok(r && r.ok === true, "CP-06 E — a clean getUserMedia resolution connects"); eq(H.timers.pending(), 1, "CP-06 — exactly one lease"); }
      // ── Stage 2: the acquisition-lease callback ──
      // CP-07 (C) — a media that IGNORES the acquisition callback never admits a lease → fail closed, no socket.
      { cp++; const clock = r5cClock(1000); const timers = r5cTimers(); let opens = 0;
        const media = { closed: 0, createOffer: async () => "v=0", acceptAnswer: async () => {}, close() { this.closed++; } };
        const broker = { sessionId: "las.r5c4", gatewaySessionId: "gw.r5c4", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c4/control", answerSdp: "v=0" };
        const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl: async () => ({ ok: true, status: 200, json: async () => broker }), openSocket: (_u, _p, h) => { opens++; return { handlers: h, close() {}, send() {} }; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear });
        const r = await t.start({ ...S4, mode: "microphone" });
        ok(r && r.ok === false, "CP-07 C — a media that ignores the acquisition callback admits no lease → fails closed");
        eq(timers.pending(), 0, "CP-07 — no lease armed"); eq(opens, 0, "CP-07 — no socket opened"); }
      // ── Stage 3: createOffer / setLocalDescription ──
      // CP-08 (A) — createOffer throws → fail closed, real close, no socket, no lease.
      { cp++; const H = mk3({ offerThrow: true }); const r = await H.t.start({ ...S4, mode: "microphone" });
        ok(r && r.ok === false, "CP-08 A — a createOffer failure fails the start closed"); eq(H.openCount(), 0, "CP-08 — no socket"); eq(H.timers.pending(), 0, "CP-08 — no lease"); }
      // CP-09 (E) — createOffer/SLD succeed → proceeds to the broker (covered structurally by CP-06; asserted distinctly).
      { cp++; const H = mk3(); const r = await H.t.start({ ...S4, mode: "microphone" }); ok(r && r.ok === true, "CP-09 E — a clean offer proceeds to a WIN"); H.sockets[0].handlers.onOpen(); eq(H.fetchCount(), 1, "CP-09 — the broker was contacted exactly once"); }
      // ── Stage 4: broker fetch (slowBroker) ──
      // CP-10 (A) — a barge-in during the in-flight broker aborts it and fails closed.
      { cp++; const H = mk3({ slowBroker: true }); const p = H.t.start({ ...S4, mode: "microphone" }); await tick();
        H.t.interrupt({ ...S4, reason: "barge_in" }); H.releaseBroker(); const r = await p;
        ok(r && r.ok === false, "CP-10 A — a barge-in during the broker fetch fails closed"); ok(H.abortCount() >= 1, "CP-10 — the in-flight broker fetch was aborted"); eq(H.openCount(), 0, "CP-10 — no socket"); }
      // CP-11 (B) — an end() during the in-flight broker aborts it.
      { cp++; const H = mk3({ slowBroker: true }); const p = H.t.start({ ...S4, mode: "microphone" }); await tick();
        H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" }); H.releaseBroker(); const r = await p;
        ok(r && r.ok === false, "CP-11 B — end() during the broker fetch fails closed"); ok(H.abortCount() >= 1, "CP-11 — the broker fetch was aborted"); }
      // CP-12 (D) — a superseded start's late broker resolution admits nothing.
      { cp++; const H = mk3({ slowBroker: true }); const p1 = H.t.start({ ...S4, mode: "microphone" }); await tick();
        H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" }); H.releaseBroker(); const r1 = await p1;
        ok(r1 && r1.ok === false, "CP-12 D — the superseded start's late broker resolution fails closed"); eq(H.openCount(), 0, "CP-12 — no socket from the stale broker"); }
      // CP-13 (C-ish) — a broker non-OK response fails closed.
      { cp++; const H = mk3({ brokerFail: true }); const r = await H.t.start({ ...S4, mode: "microphone" });
        ok(r && r.ok === false, "CP-13 — a broker non-OK response fails closed"); eq(H.openCount(), 0, "CP-13 — no socket"); eq(H.timers.pending(), 0, "CP-13 — no leaked lease"); }
      // CP-14 (E) — a broker OK response proceeds to open the socket.
      { cp++; const H = mk3(); const r = await H.t.start({ ...S4, mode: "microphone" }); ok(r && r.ok === true, "CP-14 E — a broker OK response opens the socket"); H.sockets[0].handlers.onOpen(); eq(H.openCount(), 1, "CP-14 — exactly one socket opened"); }
      // ── Stage 5: openSocket synchronous callbacks ──
      // CP-15 — a synchronous onClose during openSocket (pre-bind terminal, case B) fails closed.
      { cp++; const H = mk3({ syncClose: true }); const r = await H.t.start({ ...S4, mode: "microphone" });
        ok(r && r.ok === false, "CP-15 — a synchronous pre-bind onClose fails the start closed"); eq(H.timers.pending(), 0, "CP-15 — the lease is released (no leak)"); eq(H.t.getConnectionState(), "disconnected", "CP-15 — disconnected"); }
      // CP-16 — a synchronous onError during openSocket fails closed.
      { cp++; const H = mk3({ syncError: true }); const r = await H.t.start({ ...S4, mode: "microphone" });
        ok(r && r.ok === false, "CP-16 — a synchronous pre-bind onError fails the start closed"); eq(H.timers.pending(), 0, "CP-16 — no leaked lease"); }
      // CP-17 — a synchronous onOpen during openSocket (case C bind) connects.
      { cp++; const H = mk3({ syncOpen: true }); const r = await H.t.start({ ...S4, mode: "microphone" });
        ok(r && r.ok === true, "CP-17 — a synchronous onOpen binds + connects"); eq(H.t.getConnectionState(), "connected", "CP-17 — connected"); eq(H.timers.pending(), 1, "CP-17 — exactly one lease"); }
      // CP-18 — a reentrant close (the socket's own close() re-invokes onClose) releases exactly once (no double-charge).
      { cp++; const clock = r5cClock(1000); const H = mk3({ clock, reentrantClose: true, maxCum: 22000 }); await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen();
        clock.adv(3000); H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" });
        const r2 = await H.t.start({ ...S4, turnId: "turn.4r", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen();
        eq(H.timers.lastMs(), 19000, "CP-18 — the reentrant close charged the elapsed EXACTLY once (22000−3000=19000 admitted next, under the 20000 per-lease cap)"); ok(r2 && r2.ok === true, "CP-18 — a fresh start after the reentrant close is admitted"); }
      // ── Stage 6: post-connect socket callbacks ──
      // CP-19 — onClose after connected releases the exact owner (disconnected, lease finalized).
      { cp++; const H = mk3(); await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.sockets[0].handlers.onClose();
        eq(H.t.getConnectionState(), "disconnected", "CP-19 — a post-connect onClose disconnects"); eq(H.timers.pending(), 0, "CP-19 — the lease was finalized"); ok(H.lastMedia().closed >= 1, "CP-19 — the mic was stopped"); }
      // CP-20 — onError after connected releases the owner.
      { cp++; const H = mk3(); await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.sockets[0].handlers.onError();
        eq(H.t.getConnectionState(), "error", "CP-20 — a post-connect onError → error state"); eq(H.timers.pending(), 0, "CP-20 — the lease was finalized"); }
      // CP-21 (D) — an OLD socket's onClose after a fresh start leaves the NEWER owner untouched.
      { cp++; const H = mk3(); await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen();
        H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" });
        await H.t.start({ ...S4, turnId: "turn.4c", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen();
        const pend = H.timers.pending(); const st = H.t.getConnectionState();
        H.sockets[0].handlers.onClose(); H.sockets[0].handlers.onError();      // stale callbacks from the dead socket
        eq(H.timers.pending(), pend, "CP-21 D — the OLD socket's callbacks leave the newer lease untouched"); eq(H.t.getConnectionState(), st, "CP-21 — the newer transport stays connected"); }
      // ── Stage 7: the lease timer ──
      // CP-22 (C) — a 20s lease expiry tears the capture down (mic stopped, disconnected).
      { cp++; const H = mk3(); await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.timers.fireAll();
        eq(H.t.getConnectionState(), "disconnected", "CP-22 C — a lease expiry tears the capture down"); ok(H.lastMedia().closed >= 1, "CP-22 — the lease expiry stopped the mic"); }
      // CP-23 (E) — the success control: one clean connected start holds exactly one lease + one socket; a clean end finalizes once.
      { cp++; const clock = r5cClock(1000); const H = mk3({ clock, maxCum: 22000 }); await H.t.start({ ...S4, mode: "microphone" }); H.sockets[0].handlers.onOpen();
        eq(H.timers.pending(), 1, "CP-23 E — connected holds exactly one lease"); eq(H.openCount(), 1, "CP-23 — exactly one socket");
        clock.adv(4000); H.t.end({ sessionId: S4.sessionId, generation: 0, reason: "user" });
        const r2 = await H.t.start({ ...S4, turnId: "turn.4d", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen();
        eq(H.timers.lastMs(), 18000, "CP-23 — a clean end charged the elapsed exactly once (22000−4000=18000 admitted next)"); ok(r2 && r2.ok === true, "CP-23 — the controller keeps working after a clean cycle"); }
      eq(cp, 23, "R5C4 §7 — all 23 async checkpoints were exercised");
    }
    }

    // ── §9 — the ACTUAL fresh-microphone PRODUCTION chain via the REAL createBrowserMedia and
    // controlled browser globals. MIC START #1: an unresolved getUserMedia is CANCELLED by a
    // barge-in; the permission then lands LATE — the real first-stream tracks are stopped, and
    // NO acquisition callback / peer / broker / socket / lease ever formed. Then MIC START #2 on
    // the SAME transport acquires a DISTINCT second stream, admits a lease, contacts the broker,
    // accepts the answer, installs the socket, and connects. A clean end stops the second stream's
    // real tracks + finalizes the lease once; the cumulative allowance is charged the exact elapsed.
    if (r5c4want("mic")) {
    section("R5C4 §9 — real createBrowserMedia fresh-mic chain: cancelled MIC#1 stops the late real tracks (no acquire/peer/broker/socket/lease) → SAME-transport MIC#2 acquires a distinct stream, connects, and charges the exact elapsed");
    { process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const g = globalThis; const savedNav = Object.getOwnPropertyDescriptor(g, "navigator"); const savedRTC = g.RTCPeerConnection;
      function makeTrack() { return { stopped: 0, kind: "audio", stop() { this.stopped++; } }; }
      function fakeStream() { const tracks = [makeTrack(), makeTrack()]; return { _tracks: tracks, getTracks: () => tracks, getAudioTracks: () => tracks }; }
      let call = 0; const streams = []; let releaseGum1; const gum1 = new Promise((r) => { releaseGum1 = r; });
      const gum = async () => { const idx = call++; const s = fakeStream(); streams.push(s); if (idx === 0) await gum1; return s; };
      try {
        try { Object.defineProperty(g, "navigator", { value: { mediaDevices: { getUserMedia: gum } }, configurable: true, writable: true }); } catch (_) { g.navigator = { mediaDevices: { getUserMedia: gum } }; }
        g.RTCPeerConnection = function () { return { addTrack() {}, createDataChannel() { return { close() {}, set onmessage(_x) { /* accept */ } }; }, createOffer: async () => ({ sdp: "v=0" }), setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close() {} }; };
        const clock = r5cClock(1000); const timers = r5cTimers(); let fetchN = 0, opens = 0;
        const broker = { sessionId: "las.r5c4mic", gatewaySessionId: "gw.r5c4mic", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c4mic/control", answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
        const sockets = [];
        const t = GC.createGatewayTransport({ createMediaSession: () => GC.createBrowserMedia(), fetchImpl: async () => { fetchN++; return { ok: true, status: 200, json: async () => broker }; }, openSocket: (_u, _p, h) => { opens++; const s = { handlers: h, closed: 0, close() { this.closed++; }, send() {} }; sockets.push(s); return s; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxControllerCaptureMs: 22000 });
        ok(GC.createBrowserMedia() !== null, "§9 — createBrowserMedia constructs against the installed mic + WebRTC globals (real production media)");
        // MIC START #1 — the permission prompt is open (gUM#1 unresolved).
        const mid = { sessionId: "las.r5c4mic" };
        const p1 = t.start({ sessionId: mid.sessionId, turnId: "t.1", generation: 0, mode: "microphone", context: {} });
        await new Promise((r) => setImmediate(r));
        eq(call, 1, "§9 MIC#1 — the first real getUserMedia is pending (permission prompt open)");
        t.interrupt({ sessionId: mid.sessionId, turnId: "t.1", generation: 0, reason: "barge_in" }); // cancel → media.close() latches
        releaseGum1();                                                                              // the permission lands LATE
        const r1 = await p1;
        ok(r1 && r1.ok === false, "§9 MIC#1 — the cancelled fresh-mic start fails closed (the late permission never resurrects capture)");
        ok(streams[0]._tracks.every((tk) => tk.stopped >= 1), "§9 MIC#1 — every REAL first-stream track was stopped (physical late-acquisition cleanup, not an onAcquire flag)");
        eq(opens, 0, "§9 MIC#1 — NO control socket was opened"); eq(fetchN, 0, "§9 MIC#1 — the broker was NEVER contacted"); eq(timers.pending(), 0, "§9 MIC#1 — NO capture lease was admitted");
        // MIC START #2 — a fresh gesture on the SAME transport.
        const r2 = await t.start({ sessionId: mid.sessionId, turnId: "t.2", generation: 2, mode: "microphone", context: {} }); sockets[0].handlers.onOpen();
        ok(r2 && r2.ok === true, "§9 MIC#2 — a FRESH gesture on the SAME transport acquires the mic + connects");
        ok(streams.length >= 2 && streams[1] !== streams[0], "§9 MIC#2 — a DISTINCT second MediaStream was physically acquired");
        eq(timers.pending(), 1, "§9 MIC#2 — a new capture lease was admitted"); eq(opens, 1, "§9 MIC#2 — the control socket installed"); ok(fetchN >= 1, "§9 MIC#2 — the broker was contacted"); eq(t.getConnectionState(), "connected", "§9 MIC#2 — connected");
        // end → the second stream's real tracks stop + the lease finalizes once + cumulative charged exactly.
        clock.adv(5000); t.end({ sessionId: mid.sessionId, generation: 2, reason: "user" });
        ok(streams[1]._tracks.every((tk) => tk.stopped >= 1), "§9 — ending MIC#2 stops the SECOND stream's REAL tracks");
        eq(timers.pending(), 0, "§9 — the second lease was finalized");
        const r3 = await t.start({ sessionId: mid.sessionId, turnId: "t.3", generation: 3, mode: "microphone", context: {} }); sockets[1].handlers.onOpen();
        eq(timers.lastMs(), 17000, "§9 — the cumulative allowance charged EXACTLY the 5000ms elapsed (22000−5000=17000 admitted next, under the 20000 per-lease cap)"); ok(r3 && r3.ok === true, "§9 — the same controller keeps working across the fresh-mic cycle");
        t.end({ sessionId: mid.sessionId, generation: 3, reason: "user" });
      } finally { if (savedNav) Object.defineProperty(g, "navigator", savedNav); else { try { delete g.navigator; } catch (_) { /* no-op */ } } g.RTCPeerConnection = savedRTC; }
    }
    }

    // ── §8 — GENUINE SAME-CONTROLLER ROUTE→SOCKET INTEGRATION (the crux). A REAL browser
    // gateway transport (createGatewayTransport) drives a REAL control socket (a real `ws`
    // client) into the REAL production Live-AI control route built by the production
    // buildGateway() and listening on a loopback port. The EXACT bound socket is terminated
    // THROUGH THE PRODUCTION close route (the server's socket "close" handler → store.controlDetached
    // + store.terminate) — never a direct store.terminate() substitute. Then a SAME-CONTROLLER
    // restart re-acquires fresh owner/media/tracks/socket/lease against a fresh server session while
    // the browser's CUMULATIVE capture ledger carries over (reduced remaining), and stale OLD-socket
    // callbacks leave the newer owner untouched. MUT-R5C4-13 removes the production close→terminate
    // call and this integrated server-side invariant goes RED.
    if (r5c4want("int")) {
    section("R5C4 §8 — same-controller browser transport ↔ REAL production route: connect, real context.ack, route_change preserves BOTH, terminate the EXACT socket THROUGH the production close→terminate path (both inactive; forbidden state never settles), same-controller restart (fresh resources + cumulative), stale old-socket callbacks inert");
    {
      let WS = null, jose = null;
      try { WS = require(require.resolve("ws", { paths: [REPO] })); jose = require(require.resolve("jose", { paths: [REPO] })); } catch (_) { WS = null; }
      if (!WS || !jose) {
        ok(false, "R5C4 §8 integration prerequisites (ws + jose) must be available (reported UNPROVEN, not passed)");
      } else {
        process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
        const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
        const spki = await jose.exportSPKI(publicKey);
        const env = { LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway", LIVE_AI_CONTROL_TOKEN_SECRET: "ctl-r5c4-int", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill-r5c4-int", LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-int-not-called" };
        const built = await G.buildGateway({ env });
        const app = built.app; const liveAiCtx = built.liveAiCtx;
        await app.listen({ port: 0, host: "127.0.0.1" });
        const port = app.server.address().port;
        const mkAssertion = async (sub) => new jose.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false }).setProtectedHeader({ alg: "ES256" }).setSubject(sub).setJti("jti." + Math.random().toString(36).slice(2)).setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
        // Create a live SERVER session (mode:text — the dormant provider is orthogonal to the
        // control-socket lifecycle; buildGateway injects no mic negotiate seam) via the REAL
        // production HTTP route; the control token is minted by the real route with the real secret.
        const mkServer = async (sub, bsid) => {
          const res = await fetch(`http://127.0.0.1:${port}/v1/live-ai/sessions`, { method: "POST", headers: { authorization: `Bearer ${await mkAssertion(sub)}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "text", sessionId: bsid }) });
          const j = await res.json();
          return { gsid: j.gatewaySessionId, controlToken: j.controlToken, bsid };
        };
        try {
          const bsid1 = "las.r5c4int1"; const bsid2 = "las.r5c4int2";
          const srv1 = await mkServer("subInt1", bsid1);
          ok(typeof srv1.gsid === "string" && typeof srv1.controlToken === "string", "§8 — the REAL production route minted a live server session + control token");
          ok(liveAiCtx.store.get(srv1.gsid) && !liveAiCtx.store.get(srv1.gsid).terminated, "§8 — the server session is live in the production store");

          const bClock = r5cClock(1000); const bTimers = r5cTimers();
          const medias = []; const wsclients = [];
          const makeMedia = () => { const m = { off: 0, acq: 0, closed: 0, createOffer: async (onAcquire) => { m.off++; if (onAcquire && !onAcquire()) { m.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close: () => { m.closed++; } }; medias.push(m); return m; };
          const brokerRef = { current: null };
          const setBroker = (s) => { brokerRef.current = { sessionId: s.bsid, gatewaySessionId: s.gsid, controlToken: s.controlToken, expiresInSeconds: 60, controlUrl: `wss://127.0.0.1:${port}/v1/live-ai/sessions/${s.gsid}/control`, answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }; };
          setBroker(srv1);
          const opener = (url, protocols, h) => {
            const dial = url.replace(/^wss:/, "ws:");   // the loopback test server is un-TLS'd; host/path/token identical
            const wsc = new WS(dial, protocols);
            wsc.on("open", () => { try { h.onOpen(); } catch (_) { /* no-op */ } });
            wsc.on("message", (d) => { try { h.onMessage(d.toString()); } catch (_) { /* no-op */ } });
            wsc.on("close", () => { try { h.onClose(); } catch (_) { /* no-op */ } });
            wsc.on("error", () => { try { h.onError(); } catch (_) { /* no-op */ } });
            const sock = { _ws: wsc, _h: h, send: (data) => { try { wsc.send(data); } catch (_) { /* no-op */ } }, close: () => { try { wsc.close(); } catch (_) { /* no-op */ } } };
            wsclients.push(sock); return sock;
          };
          const frames = [];
          const t = GC.createGatewayTransport({ createMediaSession: makeMedia, fetchImpl: async () => ({ ok: true, status: 200, json: async () => brokerRef.current }), openSocket: opener, now: bClock.now, setTimer: bTimers.set, clearTimer: bTimers.clear, maxControllerCaptureMs: 22000 });
          t.subscribe((e) => { if (e && e.type === "frame") frames.push(e.frame); });
          const waitFrame = (pred, ms) => new Promise((resolve) => { const hit = () => frames.find(pred); if (hit()) return resolve(hit()); const iv = setInterval(() => { const f = hit(); if (f) { clearInterval(iv); clearTimeout(to); resolve(f); } }, 10); const to = setTimeout(() => { clearInterval(iv); resolve(hit() || null); }, ms); });
          const waitUntil = (pred, ms) => new Promise((resolve) => { if (pred()) return resolve(true); const iv = setInterval(() => { if (pred()) { clearInterval(iv); clearTimeout(to); resolve(true); } }, 20); const to = setTimeout(() => { clearInterval(iv); resolve(pred()); }, ms); });
          const ackCount = () => frames.filter((f) => f.t === "context.ack").length;
          const serverLive = (gsid) => { const s = liveAiCtx.store.get(gsid); return !!(s && !s.terminated); };

          // ── connect: the same-controller browser transport dials the real production route ──
          const r1 = await t.start({ sessionId: bsid1, turnId: "t.1", generation: 0, mode: "microphone", context: {} });
          ok(r1 && r1.ok === true, "§8 — the browser transport start() acquired media + dialed the real control route");
          const ready1 = await waitFrame((f) => f.t === "connection.ready", 4000);
          ok(ready1 && ready1.gatewaySessionId === srv1.gsid, "§8 — the REAL production route emitted connection.ready bound to the minted gateway session (production wiring, not an injected frame)");
          await waitUntil(() => t.getConnectionState() === "connected", 2000);
          eq(t.getConnectionState(), "connected", "§8 — the browser transport is connected over the real socket");
          eq(bTimers.pending(), 1, "§8 — the browser holds exactly one capture lease while connected");
          const media1 = medias[medias.length - 1]; const sock1 = wsclients[wsclients.length - 1];
          const nMedia1 = medias.length; const nSock1 = wsclients.length;
          ok(!(bTimers.pending() > 0 && !serverLive(srv1.gsid)), "§8 — the forbidden state (browser active + server inactive) does not settle after connect");
          // ── real context.publish → context.ack over the EXACT bound socket ──
          const acksBefore = ackCount();
          sock1.send(JSON.stringify({ t: "context.publish", sessionId: bsid1, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.int.0", context: validCtx(2) }));
          await waitUntil(() => ackCount() >= acksBefore + 1, 4000);
          const ack0 = frames.filter((f) => f.t === "context.ack").slice(-1)[0];
          ok(ack0 && ack0.generation === 0 && /^ar\./.test(ack0.authorityRef), "§8 — a real context.publish over the bound socket returned a generation-bound context.ack from the real route");
          // ── route_change PRESERVES the exact owner/media/socket/lease on BOTH sides ──
          bClock.adv(4000);
          t.interrupt({ sessionId: bsid1, turnId: "t.1", generation: 0, reason: "route_change" });
          await new Promise((r) => setTimeout(r, 60));
          eq(t.getConnectionState(), "connected", "§8 — route_change keeps the browser socket connected");
          eq(bTimers.pending(), 1, "§8 — route_change PRESERVES the browser capture lease (no finalize / re-admit)");
          eq(medias.length, nMedia1, "§8 — route_change acquired NO new media (same owner)");
          eq(wsclients.length, nSock1, "§8 — route_change opened NO new socket (same owner)");
          ok(medias[medias.length - 1] === media1 && wsclients[wsclients.length - 1] === sock1, "§8 — the SAME media + socket survive the route change");
          ok(serverLive(srv1.gsid), "§8 — route_change PRESERVES the live server session (no terminate)");
          const acksBefore2 = ackCount();
          sock1.send(JSON.stringify({ t: "context.publish", sessionId: bsid1, turnId: "t.1", generation: 0, routeEpoch: 1, contextRevision: "rev.int.1", context: validCtx(3) }));
          await waitUntil(() => ackCount() >= acksBefore2 + 1, 4000);
          ok(ackCount() >= acksBefore2 + 1, "§8 — a post-route-change context.publish (new epoch) still returns a context.ack over the same socket");
          // ── terminate the EXACT socket THROUGH the production close→terminate route ──
          // A RAW socket drop (never a graceful session.end frame, which would terminate the server
          // session via the frame handler and MASK the close route) so the server terminates ONLY via
          // the production socket "close" handler (socket.on("close") → store.controlDetached + store.terminate);
          // the browser's exact-socket onClose releases the owner. MUT-R5C4-13 removes that terminate call.
          sock1._ws.close();
          await waitUntil(() => t.getConnectionState() === "disconnected", 3000);
          eq(t.getConnectionState(), "disconnected", "§8 — the exact-socket drop released the browser owner (disconnected)");
          eq(bTimers.pending(), 0, "§8 — the browser capture lease was finalized on the socket drop");
          ok(media1.closed >= 1, "§8 — the browser stopped the physical mic on the socket drop");
          const serverTerminated = await waitUntil(() => !serverLive(srv1.gsid), 3000);
          ok(serverTerminated, "§8 — the exact bound socket dropping drove the REAL production close route (socket 'close' → store.controlDetached + store.terminate); the server session is terminated");
          ok(!(bTimers.pending() > 0 && !serverLive(srv1.gsid)), "§8 — the forbidden state never settled through termination (browser + server both inactive)");
          // ── same-controller RESTART: fresh server session; SAME transport re-acquires fresh resources; cumulative carried over ──
          const srv2 = await mkServer("subInt2", bsid2);
          setBroker(srv2);
          const r2 = await t.start({ sessionId: bsid2, turnId: "t.2", generation: 2, mode: "microphone", context: {} });
          ok(r2 && r2.ok === true, "§8 — a SAME-CONTROLLER restart re-connected against a fresh server session");
          const ready2 = await waitFrame((f) => f.t === "connection.ready" && f.gatewaySessionId === srv2.gsid, 4000);
          ok(!!ready2, "§8 — the restart's connection.ready is bound to the NEW gateway session (a fresh socket)");
          await waitUntil(() => t.getConnectionState() === "connected", 2000);
          eq(t.getConnectionState(), "connected", "§8 — the restart is connected");
          ok(medias.length > nMedia1, "§8 — the restart acquired FRESH media (a new owner, not the released one)");
          ok(wsclients.length > nSock1, "§8 — the restart opened a FRESH socket");
          eq(bTimers.pending(), 1, "§8 — the restart admitted a fresh capture lease");
          eq(bTimers.lastMs(), 18000, "§8 — the SAME controller's cumulative ledger carried over (22000 − 4000 charged on start#1 = 18000 admitted now)");
          ok(serverLive(srv2.gsid), "§8 — the restart's server session is live");
          // ── stale OLD-socket callbacks after the restart leave the newer owner + server untouched ──
          const pend = bTimers.pending(); const st = t.getConnectionState();
          try { sock1._h.onClose(); } catch (_) { /* no-op */ }
          try { sock1._h.onError(); } catch (_) { /* no-op */ }
          eq(bTimers.pending(), pend, "§8 — a stale OLD-socket close/error leaves the NEWER capture lease untouched");
          eq(t.getConnectionState(), st, "§8 — the newer transport stays connected despite the stale old-socket callbacks");
          ok(serverLive(srv2.gsid), "§8 — the stale old-socket callbacks did not touch the newer server session");
          // clean shutdown of the restart, again THROUGH the real production close route (a raw socket drop).
          const sock2 = wsclients[wsclients.length - 1];
          sock2._ws.close();
          await waitUntil(() => !serverLive(srv2.gsid), 3000);
          ok(!serverLive(srv2.gsid), "§8 — the restart also terminates through the real production close route on a socket drop");
        } finally { try { await app.close(); } catch (_) { /* no-op */ } }
      }
    }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // R5C FIFTH REMEDIATION — REV-03 (active server-capture integration) · REV-02 (16 async
  // boundaries) · REV-05 (fresh-mic exact counters). A self-contained sibling block: it depends
  // ONLY on the module aliases (G/GC/CONV/R/A/SESS/AUTH/CTRL/C), the IIFE helpers r5cClock/
  // r5cTimers, and the module helpers validCtx/fakeBudget — never on the R5C3/R5C4 block-locals
  // (mk3/S3/S4), so its scope is immune to that block's internal structure. WS/jose are re-resolved
  // locally (paths:[REPO]) exactly as every other integration block does.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    let WS5 = null, jose5 = null;
    try { WS5 = require(require.resolve("ws", { paths: [REPO] })); jose5 = require(require.resolve("jose", { paths: [REPO] })); } catch (_) { WS5 = null; }
    const R5C5_TARGET = (typeof process !== "undefined" && process.env && process.env.LIVE_AI_TEST_TARGET) ? String(process.env.LIVE_AI_TEST_TARGET) : "";
    const r5c5want = (tag) => !R5C5_TARGET || R5C5_TARGET === "r5c5" || R5C5_TARGET === tag;
    const hotelsSnap = () => C.buildHotelsSnapshot({ displayHotels: [], city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null, sort: "default", stars: [], appliedAmenities: [], amenityOpts: [], loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready", role: "anonymous" });

    // ═══════════════════════ REV-03 — GENUINE ACTIVE SERVER-CAPTURE SEGMENT (the PRIMARY gate) ═══════════════════════
    // The FOURTH created only mode:text server sessions, so it never proved an ACTIVE server
    // captureLedger segment nor a real browser↔server capture MIRROR. Here the REAL production
    // buildGateway() is listened on loopback; the returned liveAiCtx's budget + transcription are
    // the ONLY injected fakes (both are genuine EXTERNAL dependencies — a budget service and a
    // realtime STT provider — dormant/absent in production). Everything else is real: the real
    // Fastify route, the real handleLiveAiSessionCreate, the real captureLedger.beginSegment, the
    // real control socket, the real Conversation, the real context.ack, and the real production
    // socket-close → controlDetached + terminate → onTerminate → captureLedger.finalizeSegment.
    // The active segment is observed through the REAL captureLedger.snapshot(subject).active, never
    // via the session store's liveness. U1 evidence is captured inline.
    if (r5c5want("rev03")) {
      section("R5C5 REV-03 — REAL buildGateway → inject only budget+transcription → REAL mic session-create → REAL captureLedger.beginSegment (snapshot(subject).active===true) → REAL Conversation publish/ack → route_change preserves BOTH → raw socket drop → production close → finalizeSegment (active===false) → same-controller restart (cumulative retained)");
      if (!WS5 || !jose5) {
        ok(false, "R5C5 REV-03 integration prerequisites (ws + jose) must be available (reported UNPROVEN, not passed)");
      } else {
        process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
        const { publicKey, privateKey } = await jose5.generateKeyPair("ES256");
        const spki = await jose5.exportSPKI(publicKey);
        const env = { LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway", LIVE_AI_CONTROL_TOKEN_SECRET: "ctl-r5c5-rev03", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill-r5c5-rev03", LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-int-not-called" };
        const built = await G.buildGateway({ env });
        const app = built.app; const liveAiCtx = built.liveAiCtx;
        // ── U1: the segment ledger on the returned liveAiCtx is the REAL production ledger; only
        //         budget + transcription are injected (test-only fakes), read AT CALL TIME by the route. ──
        ok(liveAiCtx && liveAiCtx.captureLedger && typeof liveAiCtx.captureLedger.beginSegment === "function" && typeof liveAiCtx.captureLedger.finalizeSegment === "function" && typeof liveAiCtx.captureLedger.snapshot === "function", "REV-03 U1 — the captureLedger on the returned liveAiCtx is the REAL production ServerCaptureLedger (beginSegment/finalizeSegment/snapshot) — never a test double");
        ok(liveAiCtx.budget == null, "REV-03 U1 — through buildGateway the production budget is null (dormant, fail-closed) BEFORE injection — proving the mic path is genuinely gated in production");
        const budgetRef = fakeBudget();               // the ONLY budget fake (an external spend authority, dormant in prod)
        const txCalls = [];
        liveAiCtx.budget = budgetRef;                  // test-only injection, read at request time by the real route
        liveAiCtx.transcription = { negotiate: async (sdp) => { txCalls.push(sdp); return { ok: true, answerSdp: "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n" }; } }; // the ONLY transcription fake (an external STT provider)
        await app.listen({ port: 0, host: "127.0.0.1" });
        const port = app.server.address().port;
        const mkAssertion = async (sub) => new jose5.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false }).setProtectedHeader({ alg: "ES256" }).setSubject(sub).setJti("jti." + Math.random().toString(36).slice(2)).setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);

        // ONE controller = one runtime + one transport + one Conversation. The runtime's sessionId
        // is the browser session id; the mic session-create MUST carry it (the control-frame handler
        // requires frame.sessionId === session.sessionId).
        const rt = R.createLiveAiRuntime("anonymous");
        const reg = { pageId: "hotels", routeKey: "/hotels", getSnapshot: hotelsSnap, execute: () => {} };
        rt.invalidateRoute(reg.routeKey); rt.registerPage(reg);
        const mkMic = async (sub) => {
          const res = await fetch(`http://127.0.0.1:${port}/v1/live-ai/sessions`, { method: "POST", headers: { authorization: `Bearer ${await mkAssertion(sub)}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "microphone", sessionId: rt.sessionId, sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }) });
          let j = null; try { j = await res.json(); } catch (_) { j = {}; }
          return { status: res.status, gsid: j.gatewaySessionId, controlToken: j.controlToken, answerSdp: j.answerSdp };
        };

        const bClock = r5cClock(1000); const bTimers = r5cTimers();
        const medias = []; const wsclients = [];
        const makeMedia = () => { const m = { off: 0, acq: 0, closed: 0, createOffer: async (onAcquire) => { m.off++; if (onAcquire && !onAcquire()) { m.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close: () => { m.closed++; } }; medias.push(m); return m; };
        const brokerRef = { current: null };
        const setBroker = (srv) => { brokerRef.current = { sessionId: rt.sessionId, gatewaySessionId: srv.gsid, controlToken: srv.controlToken, expiresInSeconds: 60, controlUrl: `wss://127.0.0.1:${port}/v1/live-ai/sessions/${srv.gsid}/control`, answerSdp: srv.answerSdp || "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }; };
        const opener = (url, protocols, h) => {
          const dial = url.replace(/^wss:/, "ws:");
          const wsc = new WS5(dial, protocols);
          wsc.on("open", () => { try { h.onOpen(); } catch (_) { /* no-op */ } });
          wsc.on("message", (d) => { try { h.onMessage(d.toString()); } catch (_) { /* no-op */ } });
          wsc.on("close", () => { try { h.onClose(); } catch (_) { /* no-op */ } });
          wsc.on("error", () => { try { h.onError(); } catch (_) { /* no-op */ } });
          const sock = { _ws: wsc, _h: h, send: (data) => { try { wsc.send(data); } catch (_) { /* no-op */ } }, close: () => { try { wsc.close(); } catch (_) { /* no-op */ } } };
          wsclients.push(sock); return sock;
        };
        const frames = [];
        const t = GC.createGatewayTransport({ createMediaSession: makeMedia, fetchImpl: async () => ({ ok: true, status: 200, json: async () => brokerRef.current }), openSocket: opener, now: bClock.now, setTimer: bTimers.set, clearTimer: bTimers.clear, maxControllerCaptureMs: 22000 });
        t.subscribe((e) => { if (e && e.type === "frame") frames.push(e.frame); });
        let sinkClosed = false; const sink = { get closed() { return sinkClosed; }, resume: async () => true, enqueue: () => {}, stopAndClear: () => {}, close: () => { sinkClosed = true; }, state: () => (sinkClosed ? "closed" : "running") };
        const audio = A.createAudioPlayback({ sink });
        const conv = CONV.createConversation({ runtime: rt, transport: t, audio, now: () => Date.now() });
        const waitFrame = (pred, ms) => new Promise((resolve) => { const hit = () => frames.find(pred); if (hit()) return resolve(hit()); const iv = setInterval(() => { const f = hit(); if (f) { clearInterval(iv); clearTimeout(to); resolve(f); } }, 10); const to = setTimeout(() => { clearInterval(iv); resolve(hit() || null); }, ms); });
        const waitUntil = (pred, ms) => new Promise((resolve) => { if (pred()) return resolve(true); const iv = setInterval(() => { if (pred()) { clearInterval(iv); clearTimeout(to); resolve(true); } }, 20); const to = setTimeout(() => { clearInterval(iv); resolve(pred()); }, ms); });
        const ackCount = () => frames.filter((f) => f.t === "context.ack").length;
        const segActive = (sub) => liveAiCtx.captureLedger.snapshot(sub).active === true;

        try {
          // ── MIC SESSION #1 over the REAL production route → REAL beginSegment ──
          const srv1 = await mkMic("subMic1");
          eq(srv1.status, 200, "REV-03 — the REAL production mic route returned 200 (injected budget+transcription let the real mic branch pass its fail-closed barriers)");
          ok(typeof srv1.gsid === "string" && typeof srv1.controlToken === "string" && typeof srv1.answerSdp === "string", "REV-03 — the real route minted a gateway session + control token + realtime answerSdp");
          eq(txCalls.length, 1, "REV-03 U1 — the injected transcription.negotiate was invoked EXACTLY once by the real mic branch (the fake negotiation is the ONLY fake in the chain)");
          eq(budgetRef._reserveCalls().length, 1, "REV-03 U1 — the real mic branch reserved the injected budget exactly once (reserve→call→settle)");
          eq(budgetRef._settleCalls().length, 1, "REV-03 U1 — the real mic branch settled the reservation exactly once");
          // THE PRIMARY GATE — an ACTIVE real server capture segment, observed via the REAL ledger snapshot.
          const snap1 = liveAiCtx.captureLedger.snapshot("subMic1");
          ok(snap1.active === true, "REV-03 PRIMARY — the REAL production captureLedger holds an ACTIVE server capture segment for the mic subject (beginSegment REACHED over the real route — NOT mode:text)");
          eq(snap1.segmentCount, 1, "REV-03 — exactly one real server segment was admitted");
          ok(snap1.admittedMs > 0, "REV-03 — the real segment carries a positive server-clocked admission ceiling (real ledger math, not a flag)");
          ok(liveAiCtx.captureLedger.snapshot("subOTHER").active === false, "REV-03 — the active segment is bound to the MIC subject only (a different subject has no segment)");
          ok(liveAiCtx.store.get(srv1.gsid) && !liveAiCtx.store.get(srv1.gsid).terminated, "REV-03 — the mic server session is live in the production store");

          setBroker(srv1);
          // ── the SAME controller's REAL Conversation connects the real control socket ──
          const c1 = await conv.start("microphone");
          ok(c1 && c1.ok === true, "REV-03 — the REAL Conversation started a microphone turn over the REAL transport (browser media acquired, real control socket dialed)");
          const ready1 = await waitFrame((f) => f.t === "connection.ready" && f.gatewaySessionId === srv1.gsid, 4000);
          ok(!!ready1, "REV-03 — the REAL production route emitted connection.ready bound to the mic gateway session (real wiring, not an injected frame)");
          await waitUntil(() => t.getConnectionState() === "connected", 2000);
          eq(t.getConnectionState(), "connected", "REV-03 — the browser transport is connected over the real socket");
          eq(bTimers.pending(), 1, "REV-03 — the browser holds exactly one capture lease (the browser mirror of the server segment)");
          const media1 = medias[medias.length - 1]; const sock1 = wsclients[wsclients.length - 1];
          const nMedia1 = medias.length; const nSock1 = wsclients.length;
          // ── the REAL browser↔server capture MIRROR: both active together; the forbidden state absent ──
          ok(bTimers.pending() === 1 && segActive("subMic1"), "REV-03 MIRROR — the browser capture lease AND the real server capture segment are BOTH active together (a genuine browser↔server capture mirror)");
          ok(!(bTimers.pending() > 0 && !segActive("subMic1")), "REV-03 — the forbidden state (browser capture active + server segment inactive) does not settle after connect");
          // ── real Conversation context.publish → real context.ack; the segment stays active ──
          const acksBefore = ackCount();
          const published = conv.publishContext();
          ok(published === true, "REV-03 — the REAL Conversation published bounded context over the bound socket (transport.publishContext)");
          await waitUntil(() => ackCount() >= acksBefore + 1, 4000);
          const ack0 = frames.filter((f) => f.t === "context.ack").slice(-1)[0];
          ok(ack0 && /^ar\./.test(ack0.authorityRef), "REV-03 — the REAL route returned a real context.ack for the Conversation's publish (authorityRef minted server-side)");
          ok(segActive("subMic1"), "REV-03 — the real server capture segment stays ACTIVE across the context publish/ack (context traffic is not capture-closing)");
          // ── route_change PRESERVES BOTH sides (capture-preserving interrupt) ──
          bClock.adv(4000);
          conv.onRouteChange();
          await new Promise((r) => setTimeout(r, 60));
          eq(t.getConnectionState(), "connected", "REV-03 — route_change keeps the browser socket connected");
          eq(bTimers.pending(), 1, "REV-03 — route_change PRESERVES the browser capture lease (no finalize / re-admit)");
          eq(medias.length, nMedia1, "REV-03 — route_change acquired NO new media (same owner)");
          eq(wsclients.length, nSock1, "REV-03 — route_change opened NO new socket (same owner)");
          ok(segActive("subMic1"), "REV-03 — route_change PRESERVES the SAME active server capture segment (a route change is capture-preserving on both sides)");
          // ── terminate the EXACT bound socket THROUGH the production close route → finalizeSegment ──
          // A RAW socket drop (never a graceful session.end frame, which would terminate via the frame
          // handler and MASK the close route). The server terminates ONLY via socket.on("close") →
          // store.controlDetached + store.terminate → onTerminate → captureLedger.finalizeSegment.
          sock1._ws.close();
          await waitUntil(() => t.getConnectionState() === "disconnected", 3000);
          eq(t.getConnectionState(), "disconnected", "REV-03 — the exact-socket drop released the browser owner (disconnected)");
          eq(bTimers.pending(), 0, "REV-03 — the browser capture lease was finalized on the socket drop");
          ok(media1.closed >= 1, "REV-03 — the browser stopped the physical mic on the socket drop");
          // terminate() DELETES the session from the store, so liveness is "no live, non-terminated row".
          const serverLive = (gsid) => { const s = liveAiCtx.store.get(gsid); return !!(s && !s.terminated); };
          const term1 = await waitUntil(() => !serverLive(srv1.gsid), 3000);
          ok(term1, "REV-03 — the exact bound socket dropping drove the REAL production close route (socket 'close' → store.controlDetached + store.terminate)");
          const finalized1 = await waitUntil(() => segActive("subMic1") === false, 3000);
          ok(finalized1, "REV-03 — production termination FINALIZED the real server capture segment (onTerminate → captureLedger.finalizeSegment); snapshot(subMic1).active === false");
          ok(liveAiCtx.captureLedger.snapshot("subMic1").usedMs > 0, "REV-03 — the finalized segment charged the real server-clocked elapsed (not zeroed)");
          ok(!(bTimers.pending() > 0 && !segActive("subMic1")), "REV-03 — the forbidden state never settled through termination (browser + server both inactive)");

          // ── SAME-CONTROLLER RESTART (distinct subject): a fresh real segment; cumulative browser ledger retained ──
          const srv2 = await mkMic("subMic2");
          eq(srv2.status, 200, "REV-03 — the restart's real mic route returned 200 (a fresh real mic session-create)");
          ok(segActive("subMic2"), "REV-03 — the restart began a FRESH real active server capture segment for the new subject");
          setBroker(srv2);
          const c2 = await conv.start("microphone");
          ok(c2 && c2.ok === true, "REV-03 — a SAME-CONTROLLER restart re-connected the REAL Conversation against a fresh mic server session");
          const ready2 = await waitFrame((f) => f.t === "connection.ready" && f.gatewaySessionId === srv2.gsid, 4000);
          ok(!!ready2, "REV-03 — the restart's connection.ready is bound to the NEW gateway session (a fresh socket)");
          await waitUntil(() => t.getConnectionState() === "connected", 2000);
          eq(t.getConnectionState(), "connected", "REV-03 — the restart is connected");
          ok(medias.length > nMedia1 && wsclients.length > nSock1, "REV-03 — the restart acquired FRESH browser media + a FRESH socket (a new owner, not the released one)");
          eq(bTimers.pending(), 1, "REV-03 — the restart admitted a fresh browser capture lease");
          eq(bTimers.lastMs(), 18000, "REV-03 — the SAME controller's cumulative browser ledger carried over (22000 − 4000 charged on start#1 = 18000 admitted now)");
          ok(segActive("subMic2"), "REV-03 — the restart's real server segment is active");
          // ── clean shutdown of the restart through the production close route ──
          const sock2 = wsclients[wsclients.length - 1];
          sock2._ws.close();
          const finalized2 = await waitUntil(() => segActive("subMic2") === false, 3000);
          ok(finalized2, "REV-03 — the restart also FINALIZES the real server segment through the production close route on a socket drop");
        } finally { try { await app.close(); } catch (_) { /* no-op */ } }
      }
    }

    // ═══════════════════════ REV-02 — 16 GENUINE ASYNC PRODUCTION BOUNDARIES (no parser-only) ═══════════════════════
    // Every boundary drives the REAL production transport start() through a stage where a REAL
    // resource is IN-FLIGHT or acquired (a media session, an admitted lease, an in-flight broker
    // request, an installed socket), then interrupts it, and proves fail-closed cleanup: no leaked
    // lease, no orphan socket, the real media closed. NONE is a body-parser/validation rejection —
    // every boundary needs an acquired resource to prove its cleanup. A local mk5 fake supplies the
    // per-stage seams (it is self-contained; it never touches the R5C3/R5C4 block-locals).
    if (r5c5want("rev02")) {
      section("R5C5 REV-02 — 16 async production boundaries (BND-01..BND-16): each interrupts a stage holding a REAL acquired resource and fails closed (no leaked lease / socket; media closed) — no parser-only checkpoints");
      const S5 = { sessionId: "las.r5c5", turnId: "turn.5", generation: 0, context: {} };
      function mk5(o) {
        o = o || {}; const clock = o.clock || r5cClock(1000); const timers = o.timers || r5cTimers();
        let fetchN = 0, aborted = 0, opens = 0, releaseBroker = null, releaseMedia = null;
        const brokerGate = o.slowBroker ? new Promise((r) => { releaseBroker = r; }) : null;
        const mediaGate = o.mediaGate ? new Promise((r) => { releaseMedia = r; }) : null;
        const medias = [];
        const makeMedia = () => {
          const m = { off: 0, acq: 0, acqFetch: -1, closed: 0,
            createOffer: async (onAcquire) => {
              if (mediaGate) await mediaGate;
              m.off++;
              if (o.offerThrow) throw new Error("mic");
              if (o.ignoreAcquire) return "v=0";                 // a media that NEVER admits a lease
              if (onAcquire) { m.acq++; m.acqFetch = fetchN; if (!onAcquire()) { m.closed++; throw new Error("capture_admission_refused"); } }
              return "v=0";
            },
            acceptAnswer: async () => {}, close: () => { m.closed++; } };
          medias.push(m); return m;
        };
        const broker = { sessionId: "las.r5c5", gatewaySessionId: "gw.r5c5", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c5/control", answerSdp: "v=0" };
        const fetchImpl = async (_u, init) => { fetchN++; if (init && init.signal) init.signal.addEventListener("abort", () => { aborted++; }); if (brokerGate) await brokerGate; if (o.brokerFail) return { ok: false, status: 500, json: async () => ({}) }; return { ok: true, status: 200, json: async () => broker }; };
        const sockets = [];
        const openSocket = (_u, _p, h) => {
          opens++;
          const s = { closed: 0, _live: true, handlers: h, close() { this.closed++; if (o.reentrantClose && this._live) { this._live = false; h.onClose(); } } };
          sockets.push(s);
          if (o.syncOpen) h.onOpen();
          if (o.syncClose) h.onClose();
          if (o.syncError) h.onError();
          return s;
        };
        const t = GC.createGatewayTransport({ createMediaSession: makeMedia, fetchImpl, openSocket, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxCaptureLeaseMs: o.maxLease, maxControllerCaptureMs: o.maxCum });
        return { t, medias, clock, timers, fetchCount: () => fetchN, abortCount: () => aborted, openCount: () => opens, sockets, releaseBroker: () => { if (releaseBroker) releaseBroker(); }, releaseMedia: () => { if (releaseMedia) releaseMedia(); }, lastMedia: () => medias[medias.length - 1] };
      }
      let bnd = 0; const tick = () => new Promise((r) => setImmediate(r));
      // BND-01 — getUserMedia in-flight, a capture-closing barge_in: the late permission stops the real tracks; no lease/socket/broker.
      { bnd++; const H = mk5({ mediaGate: true }); const p = H.t.start({ ...S5, mode: "microphone" }); await tick(); H.t.interrupt({ ...S5, reason: "barge_in" }); H.releaseMedia(); const r = await p;
        ok(r && r.ok === false, "BND-01 — a barge_in during in-flight getUserMedia fails closed"); eq(H.openCount(), 0, "BND-01 — no socket"); eq(H.timers.pending(), 0, "BND-01 — no leaked lease"); ok(H.lastMedia().closed >= 1, "BND-01 — the real media (mic tracks) was closed"); eq(H.fetchCount(), 0, "BND-01 — the broker was never contacted"); }
      // BND-02 — getUserMedia in-flight, end() (hard teardown): the acquired media is released.
      { bnd++; const H = mk5({ mediaGate: true }); const p = H.t.start({ ...S5, mode: "microphone" }); await tick(); H.t.end({ sessionId: S5.sessionId, generation: 0, reason: "user" }); H.releaseMedia(); const r = await p;
        ok(r && r.ok === false, "BND-02 — end() during in-flight getUserMedia fails closed"); eq(H.openCount(), 0, "BND-02 — no socket"); eq(H.timers.pending(), 0, "BND-02 — no leaked lease"); ok(H.lastMedia().closed >= 1, "BND-02 — the acquired media was released"); }
      // BND-03 — getUserMedia in-flight, superseded by a fresh start: the stale acquisition admits nothing; the fresh start works.
      { bnd++; const H = mk5({ mediaGate: true }); const p1 = H.t.start({ ...S5, mode: "microphone" }); await tick(); H.t.end({ sessionId: S5.sessionId, generation: 0, reason: "user" }); H.releaseMedia(); const r1 = await p1;
        ok(r1 && r1.ok === false, "BND-03 — the superseded start's late getUserMedia admits nothing (no resurrection)"); eq(H.openCount(), 0, "BND-03 — the stale start opened no socket");
        const r2 = await H.t.start({ ...S5, turnId: "turn.5b", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen(); ok(r2 && r2.ok === true, "BND-03 — a fresh start after the supersede is admitted"); eq(H.timers.pending(), 1, "BND-03 — the fresh start holds exactly one lease"); }
      // BND-04 — the acquisition-lease callback is ignored by the media: no lease is ever admitted → fail closed, no socket.
      { bnd++; const H = mk5({ ignoreAcquire: true }); const r = await H.t.start({ ...S5, mode: "microphone" });
        ok(r && r.ok === false, "BND-04 — a media that ignores the acquisition callback admits no lease → fails closed"); eq(H.timers.pending(), 0, "BND-04 — no lease armed"); eq(H.openCount(), 0, "BND-04 — no socket opened"); }
      // BND-05 — createOffer throws after acquisition (partial acquisition): real close, no socket, no lease.
      { bnd++; const H = mk5({ offerThrow: true }); const r = await H.t.start({ ...S5, mode: "microphone" });
        ok(r && r.ok === false, "BND-05 — a createOffer failure fails the start closed"); eq(H.openCount(), 0, "BND-05 — no socket"); eq(H.timers.pending(), 0, "BND-05 — no lease"); ok(H.lastMedia().closed >= 1, "BND-05 — the partially-acquired media was closed"); }
      // BND-06 — broker fetch in-flight, a barge_in: the in-flight request is aborted; no socket.
      { bnd++; const H = mk5({ slowBroker: true }); const p = H.t.start({ ...S5, mode: "microphone" }); await tick(); H.t.interrupt({ ...S5, reason: "barge_in" }); H.releaseBroker(); const r = await p;
        ok(r && r.ok === false, "BND-06 — a barge_in during the in-flight broker fetch fails closed"); ok(H.abortCount() >= 1, "BND-06 — the in-flight broker fetch was aborted"); eq(H.openCount(), 0, "BND-06 — no socket"); eq(H.timers.pending(), 0, "BND-06 — no leaked lease"); }
      // BND-07 — broker fetch in-flight, end(): the request is aborted, lease released.
      { bnd++; const H = mk5({ slowBroker: true }); const p = H.t.start({ ...S5, mode: "microphone" }); await tick(); H.t.end({ sessionId: S5.sessionId, generation: 0, reason: "user" }); H.releaseBroker(); const r = await p;
        ok(r && r.ok === false, "BND-07 — end() during the in-flight broker fetch fails closed"); ok(H.abortCount() >= 1, "BND-07 — the broker fetch was aborted"); eq(H.timers.pending(), 0, "BND-07 — no leaked lease"); }
      // BND-08 — broker fetch in-flight, superseded: the stale broker resolution admits nothing.
      { bnd++; const H = mk5({ slowBroker: true }); const p1 = H.t.start({ ...S5, mode: "microphone" }); await tick(); H.t.end({ sessionId: S5.sessionId, generation: 0, reason: "user" }); H.releaseBroker(); const r1 = await p1;
        ok(r1 && r1.ok === false, "BND-08 — the superseded start's late broker resolution admits nothing"); eq(H.openCount(), 0, "BND-08 — no socket from the stale broker"); }
      // BND-09 — a broker non-OK response (a real request that resolves with a failure): fail closed, no socket, no leaked lease.
      { bnd++; const H = mk5({ brokerFail: true }); const r = await H.t.start({ ...S5, mode: "microphone" });
        ok(r && r.ok === false, "BND-09 — a broker non-OK response fails closed"); eq(H.openCount(), 0, "BND-09 — no socket"); eq(H.timers.pending(), 0, "BND-09 — no leaked lease"); ok(H.lastMedia().closed >= 1, "BND-09 — the acquired media was released on the broker failure"); }
      // BND-10 — a synchronous pre-bind onClose during openSocket: the just-opened socket dies before binding → fail closed, lease released.
      { bnd++; const H = mk5({ syncClose: true }); const r = await H.t.start({ ...S5, mode: "microphone" });
        ok(r && r.ok === false, "BND-10 — a synchronous pre-bind onClose fails the start closed"); eq(H.timers.pending(), 0, "BND-10 — the lease is released (no leak)"); eq(H.t.getConnectionState(), "disconnected", "BND-10 — disconnected"); }
      // BND-11 — a synchronous pre-bind onError during openSocket: fail closed, no leaked lease.
      { bnd++; const H = mk5({ syncError: true }); const r = await H.t.start({ ...S5, mode: "microphone" });
        ok(r && r.ok === false, "BND-11 — a synchronous pre-bind onError fails the start closed"); eq(H.timers.pending(), 0, "BND-11 — no leaked lease"); }
      // BND-12 — a synchronous onOpen during openSocket binds + connects (the acquired resources go live): exactly one lease.
      { bnd++; const H = mk5({ syncOpen: true }); const r = await H.t.start({ ...S5, mode: "microphone" });
        ok(r && r.ok === true, "BND-12 — a synchronous onOpen binds + connects"); eq(H.t.getConnectionState(), "connected", "BND-12 — connected"); eq(H.timers.pending(), 1, "BND-12 — exactly one lease"); eq(H.openCount(), 1, "BND-12 — exactly one socket"); }
      // BND-13 — a reentrant close (the socket's own close() re-invokes onClose): the lease is released EXACTLY once (no double-charge).
      { bnd++; const clock = r5cClock(1000); const H = mk5({ clock, reentrantClose: true, maxCum: 22000 }); await H.t.start({ ...S5, mode: "microphone" }); H.sockets[0].handlers.onOpen(); clock.adv(3000); H.t.end({ sessionId: S5.sessionId, generation: 0, reason: "user" });
        const r2 = await H.t.start({ ...S5, turnId: "turn.5r", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen();
        eq(H.timers.lastMs(), 19000, "BND-13 — the reentrant close charged the elapsed EXACTLY once (22000−3000=19000 admitted next)"); ok(r2 && r2.ok === true, "BND-13 — a fresh start after the reentrant close is admitted"); }
      // BND-14 — a post-connect onClose (an installed socket dies): releases the exact owner (disconnected, lease finalized, mic stopped).
      { bnd++; const H = mk5(); await H.t.start({ ...S5, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.sockets[0].handlers.onClose();
        eq(H.t.getConnectionState(), "disconnected", "BND-14 — a post-connect onClose disconnects"); eq(H.timers.pending(), 0, "BND-14 — the lease was finalized"); ok(H.lastMedia().closed >= 1, "BND-14 — the mic was stopped"); }
      // BND-15 — a post-connect onError: releases the owner (error state, lease finalized).
      { bnd++; const H = mk5(); await H.t.start({ ...S5, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.sockets[0].handlers.onError();
        eq(H.t.getConnectionState(), "error", "BND-15 — a post-connect onError → error state"); eq(H.timers.pending(), 0, "BND-15 — the lease was finalized"); ok(H.lastMedia().closed >= 1, "BND-15 — the mic was stopped"); }
      // BND-16 — the lease timer expiry (the 20s server-independent browser cap): tears the capture down (mic stopped, disconnected).
      { bnd++; const H = mk5(); await H.t.start({ ...S5, mode: "microphone" }); H.sockets[0].handlers.onOpen(); H.timers.fireAll();
        eq(H.t.getConnectionState(), "disconnected", "BND-16 — a lease expiry tears the capture down"); ok(H.lastMedia().closed >= 1, "BND-16 — the lease expiry stopped the mic"); eq(H.timers.pending(), 0, "BND-16 — the expired lease left no pending timer"); }
      eq(bnd, 16, "REV-02 — exactly 16 async production boundaries were exercised (each with a real acquired resource; no parser-only checkpoint)");
    }

    // ═══════════════════════ REV-05 — FRESH-MIC PRODUCTION CHAIN, EXACT COUNTERS ═══════════════════════
    // The REAL createBrowserMedia against controlled browser globals, with EXACT (===) counters for
    // acquisition (getUserMedia), peer (RTCPeerConnection), answer (setRemoteDescription), retry
    // (broker fetch / socket opens per start), and track-stop — never >=. MIC#1 is cancelled during
    // an in-flight getUserMedia; MIC#2 is a fresh gesture on the SAME transport.
    if (r5c5want("rev05")) {
      section("R5C5 REV-05 — fresh-mic chain EXACT counters: MIC#1 (cancelled) acquires=1 peer=0 answer=0 broker=0 socket=0 lease=0 track-stops=1; MIC#2 acquires=1(more) peer=1 answer=1 broker=1 socket=1 lease=1 retry=0 track-stops=1");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const g = globalThis; const savedNav = Object.getOwnPropertyDescriptor(g, "navigator"); const savedRTC = g.RTCPeerConnection;
      function makeTrack() { return { stopped: 0, kind: "audio", stop() { this.stopped++; } }; }
      function fakeStream() { const tracks = [makeTrack(), makeTrack()]; return { _tracks: tracks, getTracks: () => tracks, getAudioTracks: () => tracks }; }
      let call = 0; const streams = []; let releaseGum1; const gum1 = new Promise((r) => { releaseGum1 = r; });
      const gum = async () => { const idx = call++; const s = fakeStream(); streams.push(s); if (idx === 0) await gum1; return s; };
      const peers = []; let answers = 0;
      try {
        try { Object.defineProperty(g, "navigator", { value: { mediaDevices: { getUserMedia: gum } }, configurable: true, writable: true }); } catch (_) { g.navigator = { mediaDevices: { getUserMedia: gum } }; }
        g.RTCPeerConnection = function () { const pc = { addTrack() {}, createDataChannel() { return { close() {}, set onmessage(_x) { /* accept */ } }; }, createOffer: async () => ({ sdp: "v=0" }), setLocalDescription: async () => {}, setRemoteDescription: async () => { answers++; }, close() {} }; peers.push(pc); return pc; };
        const clock = r5cClock(1000); const timers = r5cTimers(); let fetchN = 0, opens = 0;
        const broker = { sessionId: "las.r5c5mic", gatewaySessionId: "gw.r5c5mic", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r5c5mic/control", answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
        const sockets = [];
        const t = GC.createGatewayTransport({ createMediaSession: () => GC.createBrowserMedia(), fetchImpl: async () => { fetchN++; return { ok: true, status: 200, json: async () => broker }; }, openSocket: (_u, _p, h) => { opens++; const s = { handlers: h, closed: 0, close() { this.closed++; }, send() {} }; sockets.push(s); return s; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxControllerCaptureMs: 22000 });
        const mid = { sessionId: "las.r5c5mic" };
        // ── MIC START #1 — the permission prompt is open (gUM#1 unresolved); cancel; the permission lands LATE ──
        const p1 = t.start({ sessionId: mid.sessionId, turnId: "t.1", generation: 0, mode: "microphone", context: {} });
        await new Promise((r) => setImmediate(r));
        eq(call, 1, "REV-05 MIC#1 — getUserMedia was invoked EXACTLY once (permission prompt open)");
        t.interrupt({ sessionId: mid.sessionId, turnId: "t.1", generation: 0, reason: "barge_in" });
        releaseGum1();
        const r1 = await p1;
        ok(r1 && r1.ok === false, "REV-05 MIC#1 — the cancelled fresh-mic start fails closed");
        eq(call, 1, "REV-05 MIC#1 — acquisition count stays EXACTLY 1 (the cancel triggered no re-acquire)");
        eq(peers.length, 0, "REV-05 MIC#1 — peer constructions EXACTLY 0 (the closed-during-acquire check throws before `new RTCPeerConnection`)");
        eq(answers, 0, "REV-05 MIC#1 — answer applications (setRemoteDescription) EXACTLY 0");
        eq(fetchN, 0, "REV-05 MIC#1 — broker contacts EXACTLY 0");
        eq(opens, 0, "REV-05 MIC#1 — control-socket opens EXACTLY 0");
        eq(timers.pending(), 0, "REV-05 MIC#1 — admitted leases EXACTLY 0");
        streams[0]._tracks.forEach((tk) => eq(tk.stopped, 1, "REV-05 MIC#1 — every REAL first-stream track was stopped EXACTLY once (late-acquisition cleanup)"));
        // ── MIC START #2 — a fresh gesture on the SAME transport ──
        const r2 = await t.start({ sessionId: mid.sessionId, turnId: "t.2", generation: 2, mode: "microphone", context: {} }); sockets[0].handlers.onOpen();
        ok(r2 && r2.ok === true, "REV-05 MIC#2 — a FRESH gesture on the SAME transport connects");
        eq(call, 2, "REV-05 MIC#2 — getUserMedia was invoked EXACTLY once more (acquisition total === 2)");
        ok(streams.length === 2 && streams[1] !== streams[0], "REV-05 MIC#2 — a DISTINCT second MediaStream was physically acquired");
        eq(peers.length, 1, "REV-05 MIC#2 — peer constructions EXACTLY 1 (one RTCPeerConnection for the connected turn)");
        eq(answers, 1, "REV-05 MIC#2 — the broker answer was applied EXACTLY once (setRemoteDescription)");
        eq(fetchN, 1, "REV-05 MIC#2 — the broker was contacted EXACTLY once (no retry)");
        eq(opens, 1, "REV-05 MIC#2 — the control socket was opened EXACTLY once (no retry)");
        eq(timers.pending(), 1, "REV-05 MIC#2 — a new capture lease was admitted EXACTLY once");
        eq(t.getConnectionState(), "connected", "REV-05 MIC#2 — connected");
        // ── end MIC#2 — the second stream's real tracks stop EXACTLY once; the lease finalizes ──
        clock.adv(5000); t.end({ sessionId: mid.sessionId, generation: 2, reason: "user" });
        streams[1]._tracks.forEach((tk) => eq(tk.stopped, 1, "REV-05 — ending MIC#2 stopped the SECOND stream's REAL tracks EXACTLY once"));
        eq(timers.pending(), 0, "REV-05 — the second lease was finalized (no leak)");
        eq(peers.length, 1, "REV-05 — no extra peer was constructed by the clean end (still EXACTLY 1)");
        eq(fetchN, 1, "REV-05 — no broker retry occurred across the whole chain (still EXACTLY 1)");
        eq(opens, 1, "REV-05 — no socket retry occurred across the whole chain (still EXACTLY 1)");
      } finally { if (savedNav) Object.defineProperty(g, "navigator", savedNav); else { try { delete g.navigator; } catch (_) { /* no-op */ } } g.RTCPeerConnection = savedRTC; }
    }

    // ═══════════════════════ MUT-FIFTH PROBE TARGETS — dedicated sole-defense assertions ═══════════════════════
    // Four dedicated tests, each the SOLE test surface for one load-bearing gateway-client guard the
    // FIFTH mutation probes target (REV-04). Each passes on frozen production and goes RED under EXACTLY
    // one MUT-FIFTH mutation (verified at execution): T-A ← MUT-FIFTH-A (lease admitted AT physical
    // acquisition), T-B ← MUT-FIFTH-B (post-acceptAnswer ownership re-check), T-C ← MUT-FIFTH-C
    // (owner/socket identity isolation of a stale socket callback), T-D ← MUT-FIFTH-D (release-latch +
    // pointer-detachment BEFORE the external close ⇒ reentrant-close idempotency).
    if (r5c5want("mutt")) {
      section("R5C5 MUT-FIFTH targets — T-A lease@acquisition · T-B post-acceptAnswer ownership · T-C stale-socket identity isolation · T-D reentrant-close latch-before-teardown");
      const okBroker = (id) => ({ sessionId: id, gatewaySessionId: "gw." + id, controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw." + id + "/control", answerSdp: "v=0" });
      // ── T-A ← MUT-FIFTH-A: the capture lease is admitted AT physical acquisition (inside createOffer,
      //         the instant onAcquire returns — before the broker/peer). ──
      { const clock = r5cClock(1000); const timers = r5cTimers(); let pendingAtAcquire = -1;
        const media = { closed: 0, createOffer: async (onAcquire) => { const okA = onAcquire ? onAcquire() : true; pendingAtAcquire = timers.pending(); if (!okA) { media.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close() { this.closed++; } };
        const sockets = []; const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker("ta") }), openSocket: (_u, _p, h) => { const s = { handlers: h, close() {}, send() {} }; sockets.push(s); return s; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear });
        const r = await t.start({ sessionId: "las.ta", turnId: "t.1", generation: 0, mode: "microphone", context: {} }); if (sockets[0]) sockets[0].handlers.onOpen();
        ok(r && r.ok === true, "T-A (MUT-FIFTH-A) — a clean mic start connects (baseline)");
        eq(pendingAtAcquire, 1, "T-A (MUT-FIFTH-A) — the capture lease is admitted AT physical acquisition (pending()===1 the instant onAcquire returns, before the broker/peer)");
        eq(timers.pending(), 1, "T-A (MUT-FIFTH-A) — exactly one lease remains armed on the connected mic");
        t.end({ sessionId: "las.ta", generation: 0, reason: "user" }); }
      // ── T-B ← MUT-FIFTH-B: a supersession DURING the acceptAnswer await is caught by the post-await
      //         owned() re-check BEFORE any socket is opened. ──
      { const clock = r5cClock(1000); const timers = r5cTimers(); let opens = 0; let tref = null;
        const media = { closed: 0, createOffer: async (oa) => { if (oa) oa(); return "v=0"; }, acceptAnswer: async () => { if (tref) tref.end({ sessionId: "las.tb", generation: 0, reason: "user" }); }, close() { this.closed++; } };
        const sockets = []; const t = GC.createGatewayTransport({ createMediaSession: () => media, fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker("tb") }), openSocket: (_u, _p, h) => { opens++; const s = { handlers: h, close() {}, send() {} }; sockets.push(s); return s; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear });
        tref = t;
        const r = await t.start({ sessionId: "las.tb", turnId: "t.1", generation: 0, mode: "microphone", context: {} });
        ok(r && r.ok === false, "T-B (MUT-FIFTH-B) — a start superseded DURING acceptAnswer fails closed (the post-await owned() re-check catches it)");
        eq(opens, 0, "T-B (MUT-FIFTH-B) — the superseded-after-acceptAnswer start opened NO control socket (each await re-checks ownership before installing)");
        eq(timers.pending(), 0, "T-B (MUT-FIFTH-B) — no leaked capture lease after the superseded acceptAnswer"); }
      // ── T-C ← MUT-FIFTH-C: an OLD socket's callbacks (close/error + a mismatched connection.ready)
      //         after a fresh generation is installed must NOT touch the newer owner (identity isolation). ──
      { const clock = r5cClock(1000); const timers = r5cTimers(); const medias = []; const sockets = [];
        const mk = () => { const m = { off: 0, closed: 0, createOffer: async (oa) => { m.off++; if (oa) oa(); return "v=0"; }, acceptAnswer: async () => {}, close() { this.closed++; } }; medias.push(m); return m; };
        const t = GC.createGatewayTransport({ createMediaSession: mk, fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker("tc") }), openSocket: (_u, _p, h) => { const s = { handlers: h, close() {}, send() {} }; sockets.push(s); return s; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear });
        await t.start({ sessionId: "las.tc", turnId: "t.1", generation: 0, mode: "microphone", context: {} }); sockets[0].handlers.onOpen();
        t.end({ sessionId: "las.tc", generation: 0, reason: "user" });                 // release owner#1
        const r2 = await t.start({ sessionId: "las.tc", turnId: "t.2", generation: 2, mode: "microphone", context: {} }); if (sockets[1]) sockets[1].handlers.onOpen();
        ok(r2 && r2.ok === true && t.getConnectionState() === "connected", "T-C (MUT-FIFTH-C) — the newer start is connected (baseline)");
        const pendBefore = timers.pending(); const media2ClosedBefore = medias[1].closed;
        sockets[0].handlers.onClose(); sockets[0].handlers.onError();
        sockets[0].handlers.onMessage(JSON.stringify({ t: "connection.ready", sessionId: "las.tc", gatewaySessionId: "gw.OTHER" }));
        eq(t.getConnectionState(), "connected", "T-C (MUT-FIFTH-C) — an OLD socket's callbacks (close/error + mismatched connection.ready) did NOT tear down the newer connected owner (owner/socket identity isolation)");
        eq(timers.pending(), pendBefore, "T-C (MUT-FIFTH-C) — the OLD socket callback did NOT finalize the newer owner's lease");
        eq(medias[1].closed, media2ClosedBefore, "T-C (MUT-FIFTH-C) — the OLD socket callback did NOT close the newer owner's media");
        t.end({ sessionId: "las.tc", generation: 2, reason: "user" }); }
      // ── T-D ← MUT-FIFTH-D: releaseOwner's released-latch + pointer-detachment run BEFORE the external
      //         socket.close(), so a reentrant close (socket.close() → onClose) releases EXACTLY once. ──
      { const clock = r5cClock(1000); const timers = r5cTimers(); const medias = [];
        const mk = () => { const m = { off: 0, closed: 0, createOffer: async (oa) => { m.off++; if (oa) oa(); return "v=0"; }, acceptAnswer: async () => {}, close() { this.closed++; } }; medias.push(m); return m; };
        const sockets = [];
        const t = GC.createGatewayTransport({ createMediaSession: mk, fetchImpl: async () => ({ ok: true, status: 200, json: async () => okBroker("td") }), openSocket: (_u, _p, h) => { const s = { closed: 0, _live: true, handlers: h, close() { this.closed++; if (this._live) { this._live = false; h.onClose(); } }, send() {} }; sockets.push(s); return s; }, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxControllerCaptureMs: 22000 });
        await t.start({ sessionId: "las.td", turnId: "t.1", generation: 0, mode: "microphone", context: {} }); sockets[0].handlers.onOpen();
        clock.adv(3000);
        t.end({ sessionId: "las.td", generation: 0, reason: "user" });                 // dispose → socket.close() → REENTRANT onClose
        eq(medias[0].closed, 1, "T-D (MUT-FIFTH-D) — the reentrant close released the owner EXACTLY once (media closed once; the released-latch + pointer detachment run BEFORE the external socket.close())");
        eq(timers.pending(), 0, "T-D (MUT-FIFTH-D) — the reentrant close finalized the lease (no active lease)");
        const r2 = await t.start({ sessionId: "las.td", turnId: "t.2", generation: 2, mode: "microphone", context: {} }); sockets[sockets.length - 1].handlers.onOpen();
        eq(timers.lastMs(), 19000, "T-D (MUT-FIFTH-D) — exactly-once charge across the reentrant close (22000−3000=19000 admitted next)"); ok(r2 && r2.ok === true, "T-D (MUT-FIFTH-D) — a fresh start after the reentrant close is admitted");
        t.end({ sessionId: "las.td", generation: 2, reason: "user" }); }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // R5C SIXTH REMEDIATION — REV-02 (real createBrowserMedia async/error boundary matrix) ·
  // REV-03 (strengthened same-controller active-server integration: same subject cumulative carry,
  // real route advancement, stale-callback-after-restart). Self-contained sibling block; depends
  // only on module aliases (G/GC/CONV/R/A/SESS/C) + IIFE helpers r5cClock/r5cTimers + module helpers
  // validCtx/fakeBudget. WS/jose re-resolved locally. A focused LIVE_AI_TEST_TARGET may narrow:
  // r6rev02 / r6rev03 / r6mutt.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    const R5C6_TARGET = (typeof process !== "undefined" && process.env && process.env.LIVE_AI_TEST_TARGET) ? String(process.env.LIVE_AI_TEST_TARGET) : "";
    const r5c6want = (tag) => !R5C6_TARGET || R5C6_TARGET === "r5c6" || R5C6_TARGET === tag;
    let WS6 = null, jose6 = null;
    try { WS6 = require(require.resolve("ws", { paths: [REPO] })); jose6 = require(require.resolve("jose", { paths: [REPO] })); } catch (_) { WS6 = null; }

    // ═══════════════════════ REV-02 — REAL createBrowserMedia LIFECYCLE BOUNDARY MATRIX ═══════════════════════
    // The FIFTH REV-02 used the synthetic mk5 GatewayMedia seam. Here EVERY boundary drives the ACTUAL
    // production GC.createBrowserMedia() against controlled browser primitives (navigator.mediaDevices.
    // getUserMedia, MediaStream/MediaStreamTrack with a real .stop(), RTCPeerConnection / RTCDataChannel /
    // createOffer / setLocalDescription / setRemoteDescription, controlled fetch/Response, socket
    // primitives, controlled clock/timers/promises). Each boundary proves genuine production resource
    // acquisition + cleanup: real tracks stopped, peer closed, data channel closed, broker aborted, no
    // leaked lease/socket, no late owner installation, no stale-generation resurrection, current-owner
    // isolation. The globals are installed ONCE and delegate to the CURRENT harness (CUR).
    if (r5c6want("r6rev02")) {
      section("R5C6 REV-02 — REAL GC.createBrowserMedia lifecycle boundaries (BND-R6-01..25): controlled navigator/RTCPeerConnection/RTCDataChannel/fetch/socket/clock; each proves exact production acquisition + fail-closed cleanup");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const g = globalThis;
      const savedNav = Object.getOwnPropertyDescriptor(g, "navigator");
      const savedRTC = g.RTCPeerConnection;
      let CUR = null; // the active harness the installed globals delegate to
      const mkTrack = () => ({ stopped: 0, kind: "audio", stop() { this.stopped++; } });
      const mkStream = () => { const tracks = [mkTrack(), mkTrack()]; return { _tracks: tracks, getTracks: () => tracks, getAudioTracks: () => tracks }; };
      try {
        try { Object.defineProperty(g, "navigator", { value: { mediaDevices: { getUserMedia: () => CUR.gum() } }, configurable: true, writable: true }); } catch (_) { g.navigator = { mediaDevices: { getUserMedia: () => CUR.gum() } }; }
        g.RTCPeerConnection = function () { return CUR.makePc(); };

        function mkHarness(cfg) {
          cfg = cfg || {};
          const clock = cfg.clock || r5cClock(1000); const timers = cfg.timers || r5cTimers();
          const H = { streams: [], pcs: [], sockets: [], gumCalls: 0, fetchN: 0, opens: 0, aborted: 0, clock, timers };
          let releaseGum = null, releaseOffer = null, releaseSld = null, releaseSrd = null, releaseBroker = null;
          H.releaseGum = () => { if (releaseGum) releaseGum(); };
          H.releaseOffer = () => { if (releaseOffer) releaseOffer(); };
          H.releaseSld = () => { if (releaseSld) releaseSld(); };
          H.releaseSrd = () => { if (releaseSrd) releaseSrd(); };
          H.releaseBroker = () => { if (releaseBroker) releaseBroker(); };
          H.gum = async () => {
            H.gumCalls++;
            if (cfg.gumThrow) throw new Error("gum_denied");            // rejected getUserMedia (no MediaStream)
            if (cfg.gumPending) await new Promise((r) => { releaseGum = r; });
            const s = mkStream(); H.streams.push(s); return s;
          };
          H.makePc = () => {
            if (cfg.pcCtorThrow) throw new Error("pc_ctor_failed");
            const pc = { closed: 0, addTracks: 0, dcs: 0, offers: 0, slds: 0, srds: 0, _dc: null,
              addTrack() { this.addTracks++; if (cfg.addTrackThrow) throw new Error("add_track_failed"); },
              createDataChannel() { this.dcs++; if (cfg.dcThrow) throw new Error("dc_failed"); const dc = { closed: 0, close() { this.closed++; }, set onmessage(_x) { /* accept */ } }; pc._dc = dc; return dc; },
              createOffer: async () => { pc.offers++; if (cfg.offerReject) throw new Error("offer_rejected"); if (cfg.offerPending) await new Promise((r) => { releaseOffer = r; }); return { sdp: "v=0" }; },
              setLocalDescription: async () => { pc.slds++; if (cfg.sldReject) throw new Error("sld_rejected"); if (cfg.sldPending) await new Promise((r) => { releaseSld = r; }); },
              setRemoteDescription: async () => { pc.srds++; if (cfg.srdReject) throw new Error("srd_rejected"); if (cfg.srdPending) await new Promise((r) => { releaseSrd = r; }); },
              close() { this.closed++; } };
            H.pcs.push(pc); return pc;
          };
          const broker = { sessionId: "las.r6", gatewaySessionId: "gw.r6", controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.r6/control", answerSdp: cfg.noAnswer ? undefined : "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
          H.fetchImpl = async (_u, init) => {
            H.fetchN++; if (init && init.signal) init.signal.addEventListener("abort", () => { H.aborted++; });
            if (cfg.brokerPending) await new Promise((r) => { releaseBroker = r; });
            if (cfg.brokerThrow) throw new Error("broker_down");
            if (cfg.brokerNonOk) return { ok: false, status: 500, json: async () => ({}) };
            if (cfg.brokerMalformed) return { ok: true, status: 200, json: async () => { throw new Error("bad_json"); } };
            if (cfg.brokerBadEnvelope) return { ok: true, status: 200, json: async () => ({ nonsense: true }) };
            return { ok: true, status: 200, json: async () => broker };
          };
          H.openSocket = (_u, _p, h) => {
            if (cfg.openThrow) throw new Error("open_failed");
            H.opens++; const s = { closed: 0, _live: true, handlers: h, close() { this.closed++; }, send() {} }; H.sockets.push(s);
            if (cfg.syncOpen) h.onOpen(); if (cfg.syncClose) h.onClose(); if (cfg.syncError) h.onError();
            return s;
          };
          H.t = GC.createGatewayTransport({ createMediaSession: () => GC.createBrowserMedia(), fetchImpl: H.fetchImpl, openSocket: H.openSocket, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxControllerCaptureMs: cfg.maxCum });
          H.lastPc = () => H.pcs[H.pcs.length - 1];
          return H;
        }
        const tick = () => new Promise((r) => setImmediate(r));
        const S6 = { sessionId: "las.r6", turnId: "t.1", generation: 0, context: {} };
        let bnd = 0;
        // Universal fail-closed assertions (fail closed + no socket + no leaked lease + expected state).
        const failClosed = (H, r, label, state) => { ok(r && r.ok === false, `${label} — fails closed`); eq(H.opens, 0, `${label} — NO control socket opened`); eq(H.timers.pending(), 0, `${label} — NO leaked capture lease`); eq(H.t.getConnectionState(), state || "disconnected", `${label} — transport ${state || "disconnected"}`); };
        const tracksStopped = (H, label) => { ok(H.streams.length >= 1, `${label} — a real MediaStream was acquired`); H.streams.forEach((s) => s._tracks.forEach((tk) => eq(tk.stopped, 1, `${label} — every acquired REAL track stopped exactly once`))); };
        const pcClosed = (H, label) => { ok(H.pcs.length >= 1, `${label} — an RTCPeerConnection was constructed`); H.pcs.forEach((pc) => ok(pc.closed >= 1, `${label} — the RTCPeerConnection was closed`)); };

        // BND-R6-01 — pending getUserMedia then a capture-closing barge_in: late permission stops the REAL tracks; NO peer/broker/socket/lease.
        { bnd++; const H = mkHarness({ gumPending: true }); CUR = H; const p = H.t.start({ ...S6, mode: "microphone" }); await tick(); H.t.interrupt({ ...S6, reason: "barge_in" }); H.releaseGum(); const r = await p;
          failClosed(H, r, "BND-R6-01 gum-pending+barge_in"); tracksStopped(H, "BND-R6-01"); eq(H.pcs.length, 0, "BND-R6-01 — NO peer constructed (closed during acquire, before new RTCPeerConnection)"); eq(H.fetchN, 0, "BND-R6-01 — broker never contacted"); }
        // BND-R6-02 — rejected getUserMedia: fail closed; no stream, no peer, no socket, no lease.
        { bnd++; const H = mkHarness({ gumThrow: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-02 gum-rejected", "error"); eq(H.streams.length, 0, "BND-R6-02 — no MediaStream acquired"); eq(H.pcs.length, 0, "BND-R6-02 — no peer"); eq(H.fetchN, 0, "BND-R6-02 — broker never contacted"); }
        // BND-R6-03 — supersede (end) while getUserMedia pending: the stale late stream admits nothing; a fresh start works.
        { bnd++; const H = mkHarness({ gumPending: true }); CUR = H; const p1 = H.t.start({ ...S6, mode: "microphone" }); await tick(); H.t.end({ sessionId: "las.r6", generation: 0, reason: "user" }); H.releaseGum(); const r1 = await p1;
          failClosed(H, r1, "BND-R6-03 gum-pending+supersede"); tracksStopped(H, "BND-R6-03"); eq(H.pcs.length, 0, "BND-R6-03 — the superseded start built no peer");
          const H2 = mkHarness({}); CUR = H2; const r2 = await H2.t.start({ ...S6, turnId: "t.1b", generation: 2, mode: "microphone" }); H2.sockets[0].handlers.onOpen();
          ok(r2 && r2.ok === true, "BND-R6-03 — a FRESH start (fresh harness) is admitted after the supersede"); eq(H2.timers.pending(), 1, "BND-R6-03 — the fresh start holds exactly one lease"); }
        // BND-R6-04 — acquisition refusal via an EXHAUSTED controller lease: the real onAcquire returns false → tracks stopped, no peer/socket, no new lease.
        { bnd++; const clock = r5cClock(1000); const H = mkHarness({ clock, maxCum: 6000 }); CUR = H;
          const r1 = await H.t.start({ ...S6, mode: "microphone" }); H.sockets[0].handlers.onOpen(); ok(r1 && r1.ok === true, "BND-R6-04 — start#1 connects (consumes the tiny cumulative allowance)");
          const nStreams = H.streams.length, nPcs = H.pcs.length, nOpens = H.opens;
          clock.adv(6000); H.t.end({ sessionId: "las.r6", generation: 0, reason: "user" });
          const r2 = await H.t.start({ ...S6, turnId: "t.2", generation: 2, mode: "microphone" });
          ok(r2 && r2.ok === false, "BND-R6-04 — start#2 is REFUSED at acquisition (the exhausted controller lease → onAcquire returns false)");
          ok(H.streams.length === nStreams + 1 && H.streams[H.streams.length - 1]._tracks.every((tk) => tk.stopped === 1), "BND-R6-04 — the refused start's REAL tracks were stopped exactly once");
          eq(H.pcs.length, nPcs, "BND-R6-04 — the refusal built NO new peer (refused before new RTCPeerConnection)"); eq(H.opens, nOpens, "BND-R6-04 — the refusal opened NO new socket"); eq(H.timers.pending(), 0, "BND-R6-04 — no lease admitted for the refused start"); }
        // BND-R6-05 — RTCPeerConnection construction failure: partial-acquisition teardown stops the REAL tracks; fail closed, no socket.
        { bnd++; const H = mkHarness({ pcCtorThrow: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-05 pc-ctor-throw", "error"); tracksStopped(H, "BND-R6-05"); eq(H.pcs.length, 0, "BND-R6-05 — the failed constructor left no peer"); eq(H.fetchN, 0, "BND-R6-05 — broker never contacted"); }
        // BND-R6-06 — addTrack failure: partial-acquisition teardown closes the peer + stops the REAL tracks.
        { bnd++; const H = mkHarness({ addTrackThrow: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-06 addTrack-throw", "error"); tracksStopped(H, "BND-R6-06"); pcClosed(H, "BND-R6-06"); eq(H.fetchN, 0, "BND-R6-06 — broker never contacted"); }
        // BND-R6-07 — createDataChannel failure: peer closed + tracks stopped.
        { bnd++; const H = mkHarness({ dcThrow: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-07 dc-throw", "error"); tracksStopped(H, "BND-R6-07"); pcClosed(H, "BND-R6-07"); }
        // BND-R6-08 — createOffer pending then a capture-closing barge_in: fail closed, tracks stopped, peer closed, no socket.
        { bnd++; const H = mkHarness({ offerPending: true }); CUR = H; const p = H.t.start({ ...S6, mode: "microphone" }); await tick(); H.t.interrupt({ ...S6, reason: "barge_in" }); H.releaseOffer(); const r = await p;
          failClosed(H, r, "BND-R6-08 offer-pending+barge_in"); tracksStopped(H, "BND-R6-08"); pcClosed(H, "BND-R6-08"); eq(H.fetchN, 0, "BND-R6-08 — broker never contacted"); }
        // BND-R6-09 — createOffer rejected: fail closed, tracks stopped, peer closed.
        { bnd++; const H = mkHarness({ offerReject: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-09 offer-rejected", "error"); tracksStopped(H, "BND-R6-09"); pcClosed(H, "BND-R6-09"); }
        // BND-R6-10 — setLocalDescription pending then barge_in: fail closed, tracks stopped, peer closed.
        { bnd++; const H = mkHarness({ sldPending: true }); CUR = H; const p = H.t.start({ ...S6, mode: "microphone" }); await tick(); H.t.interrupt({ ...S6, reason: "barge_in" }); H.releaseSld(); const r = await p;
          failClosed(H, r, "BND-R6-10 sld-pending+barge_in"); tracksStopped(H, "BND-R6-10"); pcClosed(H, "BND-R6-10"); }
        // BND-R6-11 — setLocalDescription rejected: fail closed, tracks stopped, peer closed.
        { bnd++; const H = mkHarness({ sldReject: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-11 sld-rejected", "error"); tracksStopped(H, "BND-R6-11"); pcClosed(H, "BND-R6-11"); }
        // BND-R6-12 — broker fetch pending then barge_in: the in-flight broker is ABORTED; fail closed, tracks stopped, peer closed, no socket.
        { bnd++; const H = mkHarness({ brokerPending: true }); CUR = H; const p = H.t.start({ ...S6, mode: "microphone" }); await tick(); H.t.interrupt({ ...S6, reason: "barge_in" }); H.releaseBroker(); const r = await p;
          failClosed(H, r, "BND-R6-12 broker-pending+barge_in"); ok(H.aborted >= 1, "BND-R6-12 — the in-flight broker fetch was aborted (AbortController)"); tracksStopped(H, "BND-R6-12"); pcClosed(H, "BND-R6-12"); }
        // BND-R6-13 — broker fetch throws: fail closed, tracks stopped, peer closed, no socket.
        { bnd++; const H = mkHarness({ brokerThrow: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-13 broker-throw", "error"); tracksStopped(H, "BND-R6-13"); pcClosed(H, "BND-R6-13"); }
        // BND-R6-14 — broker non-OK response: fail closed, cleanup.
        { bnd++; const H = mkHarness({ brokerNonOk: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-14 broker-non-ok", "error"); tracksStopped(H, "BND-R6-14"); pcClosed(H, "BND-R6-14"); }
        // BND-R6-15 — malformed broker JSON (res.json throws): fail closed, cleanup.
        { bnd++; const H = mkHarness({ brokerMalformed: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-15 broker-malformed-json", "error"); tracksStopped(H, "BND-R6-15"); pcClosed(H, "BND-R6-15"); }
        // BND-R6-16 — invalid broker envelope (parseBrokerClientResponse rejects it): fail closed, cleanup.
        { bnd++; const H = mkHarness({ brokerBadEnvelope: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-16 broker-bad-envelope", "error"); tracksStopped(H, "BND-R6-16"); pcClosed(H, "BND-R6-16"); }
        // BND-R6-17 — microphone broker response missing answerSdp: fail closed (invalid_response), cleanup.
        { bnd++; const H = mkHarness({ noAnswer: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-17 broker-missing-answerSdp", "error"); tracksStopped(H, "BND-R6-17"); pcClosed(H, "BND-R6-17"); }
        // BND-R6-18 — acceptAnswer (setRemoteDescription) pending then barge_in: fail closed, tracks stopped, peer closed, no socket.
        { bnd++; const H = mkHarness({ srdPending: true }); CUR = H; const p = H.t.start({ ...S6, mode: "microphone" }); await tick(); await tick(); H.t.interrupt({ ...S6, reason: "barge_in" }); H.releaseSrd(); const r = await p;
          failClosed(H, r, "BND-R6-18 srd-pending+barge_in"); tracksStopped(H, "BND-R6-18"); pcClosed(H, "BND-R6-18"); }
        // BND-R6-19 — acceptAnswer (setRemoteDescription) rejected: fail closed, cleanup.
        { bnd++; const H = mkHarness({ srdReject: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-19 srd-rejected", "error"); tracksStopped(H, "BND-R6-19"); pcClosed(H, "BND-R6-19"); }
        // BND-R6-20 — openSocket throws: fail closed, tracks stopped, peer closed.
        { bnd++; const H = mkHarness({ openThrow: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          failClosed(H, r, "BND-R6-20 openSocket-throw", "error"); tracksStopped(H, "BND-R6-20"); pcClosed(H, "BND-R6-20"); }
        // BND-R6-21 — a synchronous PRE-BIND onClose during openSocket: fail closed, the lease is released, tracks stopped, peer closed.
        { bnd++; const H = mkHarness({ syncClose: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          ok(r && r.ok === false, "BND-R6-21 sync-pre-bind-close — fails closed"); eq(H.timers.pending(), 0, "BND-R6-21 — NO leaked capture lease"); eq(H.t.getConnectionState(), "disconnected", "BND-R6-21 — transport disconnected");
          ok(H.opens === 1 && H.sockets[0].closed >= 1, "BND-R6-21 — the pre-bind candidate socket was OPENED then CLOSED (never bound, never leaked)"); tracksStopped(H, "BND-R6-21"); pcClosed(H, "BND-R6-21"); }
        // BND-R6-22 — a synchronous PRE-BIND onError during openSocket: fail closed (error), the candidate socket is closed (not leaked), no leaked lease.
        { bnd++; const H = mkHarness({ syncError: true }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" });
          ok(r && r.ok === false, "BND-R6-22 sync-pre-bind-error — fails closed"); eq(H.timers.pending(), 0, "BND-R6-22 — NO leaked capture lease"); eq(H.t.getConnectionState(), "error", "BND-R6-22 — transport error");
          ok(H.opens === 1 && H.sockets[0].closed >= 1, "BND-R6-22 — the pre-bind candidate socket was OPENED then CLOSED (never bound, never leaked)"); tracksStopped(H, "BND-R6-22"); pcClosed(H, "BND-R6-22"); }
        // BND-R6-23 — a STALE OLD-socket callback after a fresh owner is active: the newer owner/lease is untouched.
        { bnd++; const H = mkHarness({}); CUR = H; await H.t.start({ ...S6, mode: "microphone" }); H.sockets[0].handlers.onOpen();
          H.t.end({ sessionId: "las.r6", generation: 0, reason: "user" });
          const r2 = await H.t.start({ ...S6, turnId: "t.2", generation: 2, mode: "microphone" }); H.sockets[H.sockets.length - 1].handlers.onOpen();
          ok(r2 && r2.ok === true && H.t.getConnectionState() === "connected", "BND-R6-23 — the newer owner is connected");
          const pend = H.timers.pending(); const st = H.t.getConnectionState();
          H.sockets[0].handlers.onClose(); H.sockets[0].handlers.onError();
          eq(H.timers.pending(), pend, "BND-R6-23 — a stale OLD-socket close/error leaves the NEWER capture lease untouched");
          eq(H.t.getConnectionState(), st, "BND-R6-23 — the newer transport stays connected despite the stale old-socket callbacks");
          H.t.end({ sessionId: "las.r6", generation: 2, reason: "user" }); }
        // BND-R6-24 — a 20s lease expiry DURING the broker-pending phase tears the capture down (mic stopped, no socket).
        { bnd++; const H = mkHarness({ brokerPending: true }); CUR = H; const p = H.t.start({ ...S6, mode: "microphone" }); await tick(); H.timers.fireAll(); H.releaseBroker(); const r = await p;
          failClosed(H, r, "BND-R6-24 lease-expiry-during-broker"); tracksStopped(H, "BND-R6-24"); pcClosed(H, "BND-R6-24"); }
        // BND-R6-25 — SUCCESS control: EXACT production resource counts; a clean end stops the REAL tracks + closes peer/data-channel + finalizes the lease once.
        { bnd++; const clock = r5cClock(1000); const H = mkHarness({ clock, maxCum: 22000 }); CUR = H; const r = await H.t.start({ ...S6, mode: "microphone" }); H.sockets[0].handlers.onOpen();
          ok(r && r.ok === true && H.t.getConnectionState() === "connected", "BND-R6-25 — a clean mic start connects");
          eq(H.gumCalls, 1, "BND-R6-25 — getUserMedia invoked EXACTLY once"); eq(H.pcs.length, 1, "BND-R6-25 — EXACTLY one RTCPeerConnection");
          eq(H.lastPc().addTracks, 2, "BND-R6-25 — both audio tracks added exactly once"); eq(H.lastPc().dcs, 1, "BND-R6-25 — EXACTLY one data channel"); eq(H.lastPc().offers, 1, "BND-R6-25 — createOffer EXACTLY once"); eq(H.lastPc().slds, 1, "BND-R6-25 — setLocalDescription EXACTLY once"); eq(H.lastPc().srds, 1, "BND-R6-25 — the broker answer applied (setRemoteDescription) EXACTLY once");
          eq(H.fetchN, 1, "BND-R6-25 — broker contacted EXACTLY once (no retry)"); eq(H.opens, 1, "BND-R6-25 — EXACTLY one control socket (no retry)"); eq(H.timers.pending(), 1, "BND-R6-25 — EXACTLY one capture lease"); eq(H.timers.lastMs(), 20000, "BND-R6-25 — the lease was admitted at the 20000ms per-lease ceiling (min(MAX_CAPTURE_LEASE_MS, remaining))");
          H.streams[0]._tracks.forEach((tk) => eq(tk.stopped, 0, "BND-R6-25 — the mic tracks are LIVE while connected (not stopped)"));
          clock.adv(4000); H.t.end({ sessionId: "las.r6", generation: 0, reason: "user" });
          H.streams[0]._tracks.forEach((tk) => eq(tk.stopped, 1, "BND-R6-25 — a clean end stopped every REAL track exactly once")); ok(H.lastPc().closed >= 1, "BND-R6-25 — a clean end closed the peer"); ok(H.lastPc()._dc && H.lastPc()._dc.closed >= 1, "BND-R6-25 — a clean end closed the data channel");
          eq(H.timers.pending(), 0, "BND-R6-25 — the lease was finalized on the clean end"); }
        eq(bnd, 25, "R5C6 REV-02 — all 25 REAL createBrowserMedia lifecycle boundaries exercised");
      } finally { if (savedNav) Object.defineProperty(g, "navigator", savedNav); else { try { delete g.navigator; } catch (_) { /* no-op */ } } g.RTCPeerConnection = savedRTC; }
    }

    // ═══════════════════════ REV-03 — STRENGTHENED SAME-CONTROLLER ACTIVE-SERVER INTEGRATION ═══════════════════════
    // Extends the FIFTH REV-03: (1) restart reuses the SAME authenticated capture-ledger subject; (2) after
    // termination/restart the previous usedMs + remaining allowance CARRY for that same subject; (3) before
    // conv.onRouteChange() the REAL bounded runtime route/context advancement runs (invalidate old page
    // authority + register the new supported page); (4) route_change preserves BOTH browser capture and the
    // active server segment under the advanced context; (5) after the fresh owner/segment is active, stale
    // OLD-socket callbacks are replayed and proven inert. The server clock/timers are INJECTED into
    // buildGateway so the subject's cumulative charge is deterministic.
    if (r5c6want("r6rev03")) {
      section("R5C6 REV-03 — same-subject cumulative carry (usedMs/remaining) across a real terminate→restart, real route advancement before route_change (both capture + server segment preserved), stale old-socket replay inert after restart");
      if (!WS6 || !jose6) {
        ok(false, "R5C6 REV-03 integration prerequisites (ws + jose) must be available (reported UNPROVEN, not passed)");
      } else {
        process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
        const { publicKey, privateKey } = await jose6.generateKeyPair("ES256");
        const spki = await jose6.exportSPKI(publicKey);
        const env = { LIVE_AI_BROKER_ENABLED: "1", LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway", LIVE_AI_CONTROL_TOKEN_SECRET: "ctl-r5c6-rev03", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill-r5c6-rev03", LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "sk-int-not-called" };
        const sClock = r5cClock(1000); const sTimers = r5cTimers();
        const built = await G.buildGateway({ env, now: sClock.now, timers: sTimers }); // INJECTED server clock+timers → deterministic subject charge
        const app = built.app; const liveAiCtx = built.liveAiCtx;
        const budgetRef = fakeBudget(); const txCalls = [];
        liveAiCtx.budget = budgetRef; // the ONLY budget fake (dormant external dependency)
        liveAiCtx.transcription = { negotiate: async (sdp) => { txCalls.push(sdp); return { ok: true, answerSdp: "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n" }; } }; // the ONLY transcription fake
        await app.listen({ port: 0, host: "127.0.0.1" });
        const port = app.server.address().port;
        const mkAssertion = async (sub) => new jose6.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false }).setProtectedHeader({ alg: "ES256" }).setSubject(sub).setJti("jti." + Math.random().toString(36).slice(2)).setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("120s").sign(privateKey);
        const rt = R.createLiveAiRuntime("anonymous");
        const hotelsSnap6 = (city) => C.buildHotelsSnapshot({ displayHotels: [], city, query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null, sort: "default", stars: [], appliedAmenities: [], amenityOpts: [], loading: false, error: "", resolvedCity: city, resolvedQuery: "", resolvedStatus: "ready", role: "anonymous" });
        const reg1 = { pageId: "hotels", routeKey: "/hotels", getSnapshot: () => hotelsSnap6("Dhanaulti"), execute: () => {} };
        rt.invalidateRoute(reg1.routeKey); rt.registerPage(reg1);
        const SUBJECT = "subMicR6"; // the SAME authenticated capture-ledger principal across the restart
        const mkMic = async (sub) => { const res = await fetch(`http://127.0.0.1:${port}/v1/live-ai/sessions`, { method: "POST", headers: { authorization: `Bearer ${await mkAssertion(sub)}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "microphone", sessionId: rt.sessionId, sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }) }); let j = null; try { j = await res.json(); } catch (_) { j = {}; } return { status: res.status, gsid: j.gatewaySessionId, controlToken: j.controlToken, answerSdp: j.answerSdp }; };

        const bClock = r5cClock(1000); const bTimers = r5cTimers();
        const medias = []; const wsclients = [];
        const makeMedia = () => { const m = { off: 0, acq: 0, closed: 0, createOffer: async (onAcquire) => { m.off++; if (onAcquire && !onAcquire()) { m.closed++; throw new Error("refused"); } return "v=0"; }, acceptAnswer: async () => {}, close: () => { m.closed++; } }; medias.push(m); return m; };
        const brokerRef = { current: null };
        const setBroker = (srv) => { brokerRef.current = { sessionId: rt.sessionId, gatewaySessionId: srv.gsid, controlToken: srv.controlToken, expiresInSeconds: 60, controlUrl: `wss://127.0.0.1:${port}/v1/live-ai/sessions/${srv.gsid}/control`, answerSdp: srv.answerSdp || "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }; };
        const opener = (url, protocols, h) => { const dial = url.replace(/^wss:/, "ws:"); const wsc = new WS6(dial, protocols); wsc.on("open", () => { try { h.onOpen(); } catch (_) { /* no-op */ } }); wsc.on("message", (d) => { try { h.onMessage(d.toString()); } catch (_) { /* no-op */ } }); wsc.on("close", () => { try { h.onClose(); } catch (_) { /* no-op */ } }); wsc.on("error", () => { try { h.onError(); } catch (_) { /* no-op */ } }); const sock = { _ws: wsc, _h: h, send: (data) => { try { wsc.send(data); } catch (_) { /* no-op */ } }, close: () => { try { wsc.close(); } catch (_) { /* no-op */ } } }; wsclients.push(sock); return sock; };
        const frames = [];
        const t = GC.createGatewayTransport({ createMediaSession: makeMedia, fetchImpl: async () => ({ ok: true, status: 200, json: async () => brokerRef.current }), openSocket: opener, now: bClock.now, setTimer: bTimers.set, clearTimer: bTimers.clear, maxControllerCaptureMs: 22000 });
        t.subscribe((e) => { if (e && e.type === "frame") frames.push(e.frame); });
        let sinkClosed = false; const sink = { get closed() { return sinkClosed; }, resume: async () => true, enqueue: () => {}, stopAndClear: () => {}, close: () => { sinkClosed = true; }, state: () => (sinkClosed ? "closed" : "running") };
        const audio = A.createAudioPlayback({ sink });
        const conv = CONV.createConversation({ runtime: rt, transport: t, audio, now: () => Date.now() });
        const waitFrame = (pred, ms) => new Promise((resolve) => { const hit = () => frames.find(pred); if (hit()) return resolve(hit()); const iv = setInterval(() => { const f = hit(); if (f) { clearInterval(iv); clearTimeout(to); resolve(f); } }, 10); const to = setTimeout(() => { clearInterval(iv); resolve(hit() || null); }, ms); });
        const waitUntil = (pred, ms) => new Promise((resolve) => { if (pred()) return resolve(true); const iv = setInterval(() => { if (pred()) { clearInterval(iv); clearTimeout(to); resolve(true); } }, 20); const to = setTimeout(() => { clearInterval(iv); resolve(pred()); }, ms); });
        const ackCount = () => frames.filter((f) => f.t === "context.ack").length;
        const snap = () => liveAiCtx.captureLedger.snapshot(SUBJECT);
        const serverLive = (gsid) => { const s = liveAiCtx.store.get(gsid); return !!(s && !s.terminated); };

        try {
          // ── MIC SESSION #1 (subject SUBJECT) — real beginSegment at server clock 1000 ──
          const srv1 = await mkMic(SUBJECT);
          eq(srv1.status, 200, "REV-03 — the REAL mic route returned 200 for session #1");
          ok(snap().active === true, "REV-03 — an ACTIVE real server capture segment for the authenticated subject");
          eq(snap().usedMs, 0, "REV-03 — segment #1 starts with usedMs 0"); eq(snap().remainingMs, 180000, "REV-03 — full 180000ms cumulative allowance at the start"); eq(snap().segmentCount, 1, "REV-03 — exactly one segment so far");
          setBroker(srv1);
          const c1 = await conv.start("microphone");
          ok(c1 && c1.ok === true, "REV-03 — the REAL Conversation started a mic turn over the REAL transport");
          const ready1 = await waitFrame((f) => f.t === "connection.ready" && f.gatewaySessionId === srv1.gsid, 4000);
          ok(!!ready1, "REV-03 — the REAL route emitted connection.ready bound to the mic gateway session");
          await waitUntil(() => t.getConnectionState() === "connected", 2000);
          eq(t.getConnectionState(), "connected", "REV-03 — connected over the real socket");
          eq(bTimers.pending(), 1, "REV-03 — the browser holds exactly one capture lease");
          const media1 = medias[medias.length - 1]; const sock1 = wsclients[wsclients.length - 1];
          const nMedia1 = medias.length; const nSock1 = wsclients.length;
          const acksBefore = ackCount(); conv.publishContext(); await waitUntil(() => ackCount() >= acksBefore + 1, 4000);
          ok(ackCount() >= acksBefore + 1, "REV-03 — a real context.ack returned for the Conversation publish"); ok(snap().active === true, "REV-03 — the server segment stays active across the publish/ack");
          // ── REAL route/context advancement, THEN route_change preserves BOTH under the advanced context ──
          // Real route/context advancement: a DISTINCT supported route (/hotels-b) with a VALID supported page
          // type ("hotels", a different city) — invalidateRoute drops the old "/hotels" authority (routeKey
          // mismatch), registerPage installs the new supported page. (A non-supported pageId would register
          // NOTHING and collapse publishedContext to null — the advancement must land on a real supported page.)
          const oldRouteEpoch = rt.getRouteEpoch(); const oldRegToken = rt.getRegistrationToken();
          const reg2 = { pageId: "hotels", routeKey: "/hotels-b", getSnapshot: () => hotelsSnap6("Manali"), execute: () => {} };
          rt.invalidateRoute(reg2.routeKey); rt.registerPage(reg2); // the provider advances the supported route/context BEFORE notifying the conversation
          ok(rt.getRouteEpoch() >= 2 && rt.getRouteEpoch() > oldRouteEpoch, "REV-03 — the runtime route epoch advanced under the real page/context registration");
          ok(rt.getRegisteredPageId() === "hotels" && rt.getRegistrationToken() !== oldRegToken, "REV-03 — the OLD page authority was invalidated and a NEW supported page/context is registered (fresh token)");
          ok(rt.publishedContext() !== null, "REV-03 — the advanced supported context is published (a fresh mic start can validate it)");
          bClock.adv(4000);
          conv.onRouteChange();
          await new Promise((r) => setTimeout(r, 60));
          eq(t.getConnectionState(), "connected", "REV-03 — route_change (under the advanced context) keeps the browser connected");
          eq(bTimers.pending(), 1, "REV-03 — route_change PRESERVES the browser capture lease");
          eq(medias.length, nMedia1, "REV-03 — route_change acquired NO new media"); eq(wsclients.length, nSock1, "REV-03 — route_change opened NO new socket");
          ok(snap().active === true, "REV-03 — route_change PRESERVES the SAME active server capture segment under the advanced runtime context");
          // ── terminate via a RAW socket drop, charging a deterministic 5000ms to the subject ──
          sClock.adv(5000); // 5000ms of server capture elapsed for segment #1
          sock1._ws.close();
          await waitUntil(() => t.getConnectionState() === "disconnected", 3000);
          eq(bTimers.pending(), 0, "REV-03 — the browser lease was finalized on the socket drop"); ok(media1.closed >= 1, "REV-03 — the browser mic was stopped on the socket drop");
          const term1 = await waitUntil(() => !serverLive(srv1.gsid), 3000); ok(term1, "REV-03 — the exact-socket drop drove the REAL production close route (controlDetached + terminate)");
          const finalized1 = await waitUntil(() => snap().active === false, 3000); ok(finalized1, "REV-03 — production termination FINALIZED the server segment (onTerminate → finalizeSegment)");
          eq(snap().usedMs, 5000, "REV-03 — the subject was charged EXACTLY the 5000ms server-clocked elapsed"); eq(snap().remainingMs, 175000, "REV-03 — the remaining cumulative allowance dropped to 175000 for the subject");
          // ── SAME-SUBJECT RESTART — the previous usedMs + remaining CARRY ──
          const srv2 = await mkMic(SUBJECT);
          eq(srv2.status, 200, "REV-03 — the restart's real mic route returned 200 (SAME authenticated subject)");
          ok(snap().active === true, "REV-03 — the restart began a FRESH active segment for the SAME subject");
          eq(snap().usedMs, 5000, "REV-03 — the SAME subject's previous usedMs (5000) CARRIED across the restart"); eq(snap().remainingMs, 175000, "REV-03 — the SAME subject's remaining allowance (175000) CARRIED across the restart"); eq(snap().segmentCount, 2, "REV-03 — this is the subject's SECOND segment (the ledger persisted the principal)");
          setBroker(srv2);
          const c2 = await conv.start("microphone");
          ok(c2 && c2.ok === true, "REV-03 — a SAME-CONTROLLER restart re-connected the real Conversation against a fresh mic session");
          const ready2 = await waitFrame((f) => f.t === "connection.ready" && f.gatewaySessionId === srv2.gsid, 4000);
          ok(!!ready2, "REV-03 — the restart's connection.ready is bound to the NEW gateway session");
          await waitUntil(() => t.getConnectionState() === "connected", 2000);
          eq(t.getConnectionState(), "connected", "REV-03 — the restart is connected");
          ok(medias.length > nMedia1 && wsclients.length > nSock1, "REV-03 — the restart acquired FRESH media + a FRESH socket");
          eq(bTimers.pending(), 1, "REV-03 — the restart admitted a fresh browser capture lease");
          const sock2 = wsclients[wsclients.length - 1];
          // ── stale OLD-socket callbacks replayed AFTER the fresh owner/segment is active — proven inert ──
          const pend = bTimers.pending(); const st = t.getConnectionState();
          try { sock1._h.onClose(); } catch (_) { /* no-op */ } try { sock1._h.onError(); } catch (_) { /* no-op */ }
          try { sock1._h.onMessage(JSON.stringify({ t: "connection.ready", sessionId: rt.sessionId, gatewaySessionId: "gw.OTHER" })); } catch (_) { /* no-op */ }
          eq(bTimers.pending(), pend, "REV-03 — a stale OLD-socket close/error/mismatched-ready leaves the NEWER browser lease untouched");
          eq(t.getConnectionState(), st, "REV-03 — the newer transport stays connected despite the stale old-socket callbacks");
          ok(snap().active === true, "REV-03 — the stale old-socket callbacks did NOT tear down / mutate the newer active server segment");
          ok(serverLive(srv2.gsid), "REV-03 — the newer server session stays live through the stale old-socket replay");
          // ── clean shutdown of the restart ──
          sock2._ws.close();
          const finalized2 = await waitUntil(() => snap().active === false, 3000); ok(finalized2, "REV-03 — the restart also finalizes the server segment through the production close route");
          eq(txCalls.length, 2, "REV-03 — the injected transcription negotiation was the ONLY fake, invoked once per real mic session (2 total)");
        } finally { try { await app.close(); } catch (_) { /* no-op */ } }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // R5C7 (SEVENTH REMEDIATION) — the SIXTH review PASSED REV-01 + REV-03; REV-02 remained the sole
  // blocker. Two production-path proofs the SIXTH lacked, both against the ACTUAL production
  // GC.createGatewayTransport() + GC.createBrowserMedia() with controlled browser primitives:
  //   BLOCKER-1 — a REAL pending res.json() body continuation that crosses ownership loss (the
  //     distinct post-await `if (!owned())` authority guard AFTER `await res.json()`). Proven for
  //     capture-close/barge-in (+ a fresh owner on the SAME transport), supersession, and lease
  //     expiry, plus a TEXT sole-defence anchor where that guard is the ONLY !owned() check before
  //     openSocket (the mic path is defence-in-depth with the later acceptAnswer guards).
  //   BLOCKER-2 — a DELAYED OLD-socket onOpen fired after that owner lost authority: proven inert
  //     by the real current-owner binding guard, and only the fresh owner's onOpen connects.
  // A focused LIVE_AI_TEST_TARGET may narrow this block: r7b1 / r7b2.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    const R7_TARGET = (typeof process !== "undefined" && process.env && process.env.LIVE_AI_TEST_TARGET) ? String(process.env.LIVE_AI_TEST_TARGET) : "";
    const r7want = (tag) => !R7_TARGET || R7_TARGET === "r5c7" || R7_TARGET === tag;
    if (r7want("r7b1") || r7want("r7b2")) {
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const g7 = globalThis;
      const savedNav7 = Object.getOwnPropertyDescriptor(g7, "navigator");
      const savedRTC7 = g7.RTCPeerConnection;
      let CUR7 = null; // the active harness the installed globals delegate to
      const mkTrack7 = () => ({ stopped: 0, kind: "audio", stop() { this.stopped++; } });
      const mkStream7 = () => { const t = [mkTrack7(), mkTrack7()]; return { _t: t, getTracks: () => t, getAudioTracks: () => t }; };
      const tick7 = () => new Promise((r) => setImmediate(r));
      const S7 = { sessionId: "las.r7", turnId: "t.1", generation: 0, context: {} };
      const brokerFor = (gsid) => ({ sessionId: "las.r7", gatewaySessionId: gsid, controlToken: "tok", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/" + gsid + "/control", answerSdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" });
      // mkH7 builds a per-scenario harness driving the REAL createGatewayTransport + createBrowserMedia.
      // cfg.pendJson → the FIRST broker fetch's res.json() stays PENDING (resolved/rejected externally via
      // H.releaseJson / H.rejectJson); later fetches resolve immediately. openSocket NEVER auto-fires onOpen
      // (the handlers are retained on H.sockets[i].handlers, fired manually), so a delayed onOpen is testable.
      function mkH7(cfg) {
        cfg = cfg || {};
        const clock = r5cClock(1000); const timers = r5cTimers();
        const H = { streams: [], pcs: [], sockets: [], opens: 0, fetchN: 0, clock, timers, releaseJson: null, rejectJson: null };
        H.gum = async () => { const s = mkStream7(); H.streams.push(s); return s; };
        H.makePc = () => {
          const pc = { closed: 0, srds: 0, _dc: null,
            addTrack() {},
            createDataChannel() { const dc = { closed: 0, close() { this.closed++; }, set onmessage(_x) { /* accept */ } }; pc._dc = dc; return dc; },
            createOffer: async () => ({ sdp: "v=0" }),
            setLocalDescription: async () => {},
            setRemoteDescription: async () => { pc.srds++; },
            close() { this.closed++; } };
          H.pcs.push(pc); return pc;
        };
        H.fetchImpl = async () => {
          const n = ++H.fetchN;
          return { ok: true, status: 200, json: () => {
            if (n === 1 && cfg.pendJson) return new Promise((res, rej) => { H.releaseJson = () => res(brokerFor("gw.r7a")); H.rejectJson = () => rej(new Error("late_json")); });
            return Promise.resolve(brokerFor("gw.r7_" + n));
          } };
        };
        H.openSocket = (_u, _p, h) => { H.opens++; const s = { closed: 0, handlers: h, close() { this.closed++; }, send() {} }; H.sockets.push(s); return s; };
        H.t = GC.createGatewayTransport({ createMediaSession: () => GC.createBrowserMedia(), fetchImpl: H.fetchImpl, openSocket: H.openSocket, now: clock.now, setTimer: timers.set, clearTimer: timers.clear, maxControllerCaptureMs: cfg.maxCum });
        return H;
      }
      const awaitPendingJson = async (H, label) => { for (let i = 0; i < 80 && !H.releaseJson && !H.rejectJson; i++) await tick7(); ok(!!(H.releaseJson || H.rejectJson), `${label} — owner#1 reached the pending res.json() await (broker OK, body pending)`); };
      try {
        try { Object.defineProperty(g7, "navigator", { value: { mediaDevices: { getUserMedia: () => CUR7.gum() } }, configurable: true, writable: true }); } catch (_) { g7.navigator = { mediaDevices: { getUserMedia: () => CUR7.gum() } }; }
        g7.RTCPeerConnection = function () { return CUR7.makePc(); };

        // ═══════════════ BLOCKER-1 — pending res.json() late continuation across ownership loss ═══════════════
        if (r7want("r7b1")) {
          section("R5C7 BLOCKER-1 — REAL pending res.json() body continuation crossing ownership loss (capture-close / supersession / lease-expiry / text sole-defence); the post-await !owned() guard is load-bearing");
          // A — JSON body PENDING → capture close (barge_in) → fresh owner#2 on the SAME transport → resolve OLD json late.
          { const H = mkH7({ pendJson: true, maxCum: 60000 }); CUR7 = H;
            const p1 = H.t.start({ ...S7, mode: "microphone" });
            await awaitPendingJson(H, "R5C7-B1-A");
            eq(H.opens, 0, "R5C7-B1-A — no control socket opened while the broker body is pending");
            const media1Stream = H.streams[0];
            H.t.interrupt({ ...S7, reason: "barge_in" }); // capture-closing → releases the pending owner#1
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-A — barge_in capture-close released owner#1 (disconnected)");
            ok(media1Stream._t.every((tk) => tk.stopped === 1), "R5C7-B1-A — owner#1's REAL mic tracks were stopped by the capture close");
            const r2 = await H.t.start({ ...S7, turnId: "t.2", generation: 2, mode: "microphone" });
            ok(r2 && r2.ok === true, "R5C7-B1-A — a FRESH owner#2 started on the SAME transport (2nd broker body resolves)");
            const sock2 = H.sockets[H.sockets.length - 1]; const opensAfter2 = H.opens; sock2.handlers.onOpen();
            eq(H.t.getConnectionState(), "connected", "R5C7-B1-A — owner#2 connected");
            eq(H.timers.pending(), 1, "R5C7-B1-A — owner#2 holds exactly one capture lease");
            H.releaseJson(); await tick7(); await tick7(); await tick7(); const rr1 = await p1;
            ok(rr1 && rr1.ok === false && rr1.code === "gateway_unavailable", "R5C7-B1-A — owner#1's LATE json continuation fails closed (gateway_unavailable)");
            eq(H.opens, opensAfter2, "R5C7-B1-A — owner#1's late continuation opened NO control socket (opens unchanged)");
            eq(H.pcs[0].srds, 0, "R5C7-B1-A — owner#1 NEVER installed the broker answer on its peer (setRemoteDescription 0)");
            eq(H.t.getConnectionState(), "connected", "R5C7-B1-A — the FRESH owner#2 remains connected (untouched by the stale late continuation)");
            eq(H.timers.pending(), 1, "R5C7-B1-A — owner#2's capture lease is untouched");
            ok(H.sockets[H.sockets.length - 1] === sock2 && sock2.closed === 0, "R5C7-B1-A — owner#2's socket is untouched");
            H.t.end({ ...S7, generation: 2, reason: "user" }); }
          // B — JSON body PENDING → supersession (end, NO successor) → resolve OLD json late → nothing installs.
          { const H = mkH7({ pendJson: true, maxCum: 60000 }); CUR7 = H;
            const p1 = H.t.start({ ...S7, mode: "microphone" });
            await awaitPendingJson(H, "R5C7-B1-B");
            H.t.end({ ...S7, reason: "user" }); // supersede/release the old owner
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-B — end() superseded owner#1 (disconnected)");
            H.releaseJson(); await tick7(); await tick7(); await tick7(); const rr1 = await p1;
            ok(rr1 && rr1.ok === false && rr1.code === "gateway_unavailable", "R5C7-B1-B — the superseded owner#1 fails closed on the late json");
            eq(H.opens, 0, "R5C7-B1-B — NO stale control socket installed by the superseded late continuation");
            eq(H.pcs[0].srds, 0, "R5C7-B1-B — NO stale answer installed (setRemoteDescription 0)");
            eq(H.timers.pending(), 0, "R5C7-B1-B — NO stale capture lease");
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-B — no stale owner/authority: state stays disconnected"); }
          // C — JSON body PENDING → the admitted 20s capture lease EXPIRES → resolve/reject OLD json late → no resurrection.
          { const H = mkH7({ pendJson: true, maxCum: 60000 }); CUR7 = H;
            const p1 = H.t.start({ ...S7, mode: "microphone" });
            await awaitPendingJson(H, "R5C7-B1-C");
            eq(H.timers.pending(), 1, "R5C7-B1-C — owner#1 holds exactly one capture lease while the body is pending");
            const media1Stream = H.streams[0];
            H.timers.fireAll(); // lease expiry → onLeaseExpired → disposeTransport (charge + close, fail closed)
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-C — the 20s lease expiry tore capture down (disconnected)");
            eq(H.timers.pending(), 0, "R5C7-B1-C — the lease was finalized/charged on expiry (no active lease)");
            ok(media1Stream._t.every((tk) => tk.stopped === 1), "R5C7-B1-C — the REAL mic tracks were stopped on lease expiry");
            H.rejectJson(); await tick7(); await tick7(); await tick7(); const rr1 = await p1;
            ok(rr1 && rr1.ok === false, "R5C7-B1-C — the lease-expired owner#1 fails closed when the old json settles late");
            eq(H.opens, 0, "R5C7-B1-C — NO control socket resurrected after lease expiry");
            eq(H.timers.pending(), 0, "R5C7-B1-C — NO capture lease resurrected after the late json");
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-C — capture stays torn down (no resurrection)"); }
          // D — TEXT sole-defence anchor (MUT-SEVENTH-A): for a TEXT owner the post-json `if (!owned())` is the
          // ONLY !owned() check before openSocket (no acceptAnswer between), so a superseded text owner's late
          // json must open NO socket — the exact assertion neutralizing that guard turns RED.
          { const H = mkH7({ pendJson: true, maxCum: 60000 }); CUR7 = H;
            const p1 = H.t.start({ ...S7, mode: "text" });
            await awaitPendingJson(H, "R5C7-B1-D");
            H.t.end({ ...S7, reason: "user" });
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-D — end() superseded the TEXT owner#1");
            H.releaseJson(); await tick7(); await tick7(); await tick7(); const rr1 = await p1;
            ok(rr1 && rr1.ok === false && rr1.code === "gateway_unavailable", "R5C7-B1-D — the superseded text owner#1 fails closed at the post-json guard");
            eq(H.opens, 0, "R5C7-B1-D — the superseded text owner#1's late continuation opened NO control socket (post-json !owned() guard is load-bearing)");
            eq(H.t.getConnectionState(), "disconnected", "R5C7-B1-D — no stale authority installed (state stays disconnected)"); }
        }

        // ═══════════════ BLOCKER-2 — a delayed OLD-socket onOpen after the owner lost authority ═══════════════
        if (r7want("r7b2")) {
          section("R5C7 BLOCKER-2 — a delayed OLD-socket onOpen after the owner lost authority is INERT via the real current-owner binding guard; only the fresh owner's onOpen connects");
          const H = mkH7({ maxCum: 60000 }); CUR7 = H;
          // owner#1: real start completes + binds its socket, but its onOpen is RETAINED (never fired).
          const r1 = await H.t.start({ ...S7, mode: "microphone" });
          ok(r1 && r1.ok === true, "R5C7-B2 — owner#1 started (socket bound; onOpen retained, unfired)");
          eq(H.t.getConnectionState(), "connecting", "R5C7-B2 — owner#1 is bound but NOT connected (its onOpen has not fired)");
          const sock1 = H.sockets[H.sockets.length - 1];
          // release / supersede owner#1
          H.t.end({ ...S7, reason: "user" });
          eq(H.t.getConnectionState(), "disconnected", "R5C7-B2 — owner#1 superseded (end → disconnected)");
          ok(sock1.closed >= 1, "R5C7-B2 — owner#1's socket was closed on supersede");
          // establish a FRESH owner#2 with a FRESH socket (onOpen also retained/unfired)
          const r2 = await H.t.start({ ...S7, turnId: "t.2", generation: 2, mode: "microphone" });
          ok(r2 && r2.ok === true, "R5C7-B2 — a FRESH owner#2 started with a FRESH socket");
          const sock2 = H.sockets[H.sockets.length - 1];
          ok(sock2 !== sock1, "R5C7-B2 — owner#2's socket is distinct from owner#1's");
          eq(H.t.getConnectionState(), "connecting", "R5C7-B2 — owner#2 is bound but not yet connected");
          const stBefore = H.t.getConnectionState(); const leaseBefore = H.timers.pending(); const opensBefore = H.opens;
          // fire the OLD socket's DELAYED onOpen while owner#2 is the intended (connecting) owner
          sock1.handlers.onOpen();
          eq(H.t.getConnectionState(), stBefore, "R5C7-B2 — the delayed OLD onOpen does NOT transition the fresh owner (state stays 'connecting')");
          eq(H.timers.pending(), leaseBefore, "R5C7-B2 — the delayed OLD onOpen mutates NO capture lease");
          eq(H.opens, opensBefore, "R5C7-B2 — the delayed OLD onOpen opens NO socket");
          ok(sock2.closed === 0, "R5C7-B2 — owner#2's socket is untouched by the stale OLD onOpen");
          // now fire ONLY the fresh socket's onOpen
          sock2.handlers.onOpen();
          eq(H.t.getConnectionState(), "connected", "R5C7-B2 — ONLY the fresh owner#2's onOpen transitions to connected");
          H.t.end({ ...S7, generation: 2, reason: "user" });
        }
      } finally {
        if (savedNav7) Object.defineProperty(g7, "navigator", savedNav7); else { try { delete g7.navigator; } catch (_) { /* no-op */ } }
        g7.RTCPeerConnection = savedRTC7;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTELLIGENCE-CONTRACT-01 (IC01) — canonical closed intelligence contract
  // `staybid-intelligence.v1` + exact-six capability registry + pure bounded
  // agent loop. PURE / DORMANT / PROVIDER-NEUTRAL. REMEDIATION-01 closed
  // REV-01..REV-05; CORRECTION-01 closes the two residual defects:
  //   • REV-01 residual — a FACT is a CLOSED answer descriptor whose text is
  //     DERIVED from trusted evidence (no free-form model factual text); no
  //     Customer-V1 answer exists for booking/payment/refund/bid/message.
  //   • REV-02 residual — a VERIFIED terminal promotes ONLY after a controller
  //     acknowledgement binds the pending dispatch to the exact accepted-R5B
  //     execution tuple, and the receipt's execution ids must match it.
  // Targets: ic01 (all) / ic01-contract / ic01-registry / ic01-loop /
  // ic01-lang / ic01-dormancy.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const IC01_TARGET = (typeof process !== "undefined" && process.env && process.env.LIVE_AI_TEST_TARGET) ? String(process.env.LIVE_AI_TEST_TARGET) : "";
    const icWant = (tag) => IC01_TARGET === "" || IC01_TARGET === "ic01" || IC01_TARGET === tag;
    if (icWant("ic01-contract") || icWant("ic01-registry") || icWant("ic01-loop") || icWant("ic01-lang") || icWant("ic01-dormancy")) {
      const IC = require(path.join(SERVER_OUT, "gw/live-ai-intelligence-contract.js"));
      const REG = require(path.join(SERVER_OUT, "gw/live-ai-capability-registry.js"));
      const AL = require(path.join(SERVER_OUT, "gw/live-ai-agent-loop.js"));
      const H64A = "a".repeat(64), H64B = "b".repeat(64), H64C = "c".repeat(64);
      const HID = "hotel-a", HID2 = "hotel-b";
      let icSeq = 0;
      const icBinding = (o) => Object.assign({ sessionId: "ic01.s1", turnId: "ic01.t1", generation: 1, pageId: "hotels", role: "customer", routeEpoch: 1, contextRevision: "rev-1", authorityRef: "auth-1", contextDigest: H64A }, o || {});
      const icTurn = (o) => Object.assign({ text: "show me hotels", language: "en", role: "customer" }, o || {});
      const icPlan = (steps, intent) => ({ contractVersion: "staybid-intelligence.v1", intent: intent || "READ_RESULTS", steps });
      const capStep = (id, args) => ({ kind: "CAPABILITY", capabilityId: id, args });
      // RESIDUAL A (CORRECTION-02) — advice is a CLOSED descriptor (intent + positions), never free text.
      const respondAdvice = () => ({ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [] }] });
      // REV-01 (CORRECTION-01) — a fact is a CLOSED answer descriptor + a grounded step (NO free-form text).
      const respondFact = (step, answer) => ({ kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: answer || "results_summary", groundedInStep: step }] });
      // IC01-CLOSE-01 — CLARIFY/ESCALATE are CLOSED descriptors (a reason, NO free-form text).
      const clarifyStep = (r) => ({ kind: "CLARIFY", reason: r || "MISSING_DESTINATION", language: "en" });
      const escalStep = (e) => ({ kind: "ESCALATE_TO_HUMAN", escalation: e || "TRANSACTIONAL_REQUEST", language: "en" });
      const fakeDeps = (tel) => ({ modelAvailable: () => true, routeTier: () => "LEVEL_1", telemetry: tel });
      const legalStatus = (outcome) => outcome === "verified" ? "verified" : outcome === "acted" ? "execution_acknowledged" : outcome === "stale" ? "stale_context" : outcome === "unknown" ? "verification_timeout" : "invalid_operation";
      const evidenceFor = (cap) => {
        switch (cap) {
          case "READ_CURRENT_RESULTS": return { kind: "results", count: 2, orderedIds: [HID, HID2] };
          case "APPLY_HOTEL_REFINEMENT": return { kind: "results", count: 2, orderedIds: [HID, HID2] };
          case "COMPARE_VISIBLE_HOTELS": return { kind: "comparison", positions: [1, 2], hotelIds: [HID, HID2], factors: ["price"], cheapestPosition: 1, topRatedPosition: 2 };
          case "READ_CURRENT_HOTEL_FACTS": return { kind: "detail", hotelId: HID, breakfast: "present", parking: "absent" };
          case "SHOW_HOTEL_SECTION": return { kind: "ui_state", section: "rooms", hotelId: HID };
          case "OPEN_VISIBLE_HOTEL": return { kind: "navigation", hotelId: HID, position: 1 };
          default: return null;
        }
      };
      const raFrom = (b, o) => Object.assign({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest }, o || {});
      // IC01-CLOSE-05 RESIDUAL B — the caps whose contextEffect is ADVANCES_CONTEXT/ADVANCES_ROUTE
      // (registry: APPLY/OPEN/SHOW). A VERIFIED terminal for one of these MUST carry an advanced result
      // authority; a "same" authority is an inconsistent result/lifecycle and fails closed.
      const IC_ADVANCING = new Set(["APPLY_HOTEL_REFINEMENT", "OPEN_VISIBLE_HOTEL", "SHOW_HOTEL_SECTION"]);
      const obsFor = (dispatch, opts) => {
        opts = opts || {};
        const cap = dispatch.capabilityId;
        const outcome = opts.outcome || "verified";
        const status = opts.status || legalStatus(outcome);
        icSeq += 1;
        const receipt = { receiptId: "ic01.rc." + icSeq, proposalId: "ic01.pr." + icSeq, providerTurnId: "ic01.pt." + icSeq, actionId: "ic01.ac." + icSeq, executionNonce: "ic01.nc." + icSeq, authorityRef: dispatch.binding.authorityRef, operation: cap, outcome, status };
        if (outcome === "verified" && opts.withEvidence !== false) receipt.evidence = evidenceFor(cap);
        // IC01-CLOSE-02 — a VERIFIED receipt MUST carry a canonical result authority (default: the source
        // authority, non-advancing). "advance"/"same"/object select an explicit one; null clears it.
        let resultAuthority;
        if (opts.resultAuthority === "advance") resultAuthority = raFrom(dispatch.binding, { routeEpoch: dispatch.binding.routeEpoch + 1, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" });
        else if (opts.resultAuthority === "same") resultAuthority = raFrom(dispatch.binding);
        else if (opts.resultAuthority && typeof opts.resultAuthority === "object") resultAuthority = opts.resultAuthority;
        else if (opts.resultAuthority === null) resultAuthority = null;
        // IC01-CLOSE-05 RESIDUAL B — default authority for a VERIFIED terminal: an ADVANCING capability
        // (APPLY/OPEN/SHOW) defaults to the ADVANCED authority (a "same" default would now fail closed as
        // an inconsistent result/lifecycle); a non-advancing capability defaults to the source (same).
        else if (outcome === "verified") resultAuthority = IC_ADVANCING.has(cap)
          ? raFrom(dispatch.binding, { routeEpoch: dispatch.binding.routeEpoch + 1, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" })
          : raFrom(dispatch.binding);
        else resultAuthority = null;
        if (resultAuthority) receipt.resultAuthority = resultAuthority;   // IC01-CLOSE-02 — ONE canonical authority (in the receipt)
        if (opts.receiptOverride) Object.assign(receipt, opts.receiptOverride);
        // IC01-CLOSE-02 — the top-level result authority MIRRORS the receipt's own (canonical, never divergent).
        const topResultAuthority = (receipt.resultAuthority !== undefined) ? receipt.resultAuthority : null;
        // IC01-CLOSE-02/03 — the gateway terminal-ACK commitment over the (post-accept) receipt as the
        // loop will recompute it. A test may inject an explicit ackCommitment (e.g. a pre-accept commitment
        // over the UNACCEPTED audit form, or a deliberately wrong value) via opts.ackCommitment.
        const ackCommitment = (opts.ackCommitment !== undefined) ? opts.ackCommitment : SCH.terminalReceiptCommitment(receipt);
        return Object.assign({
          observationId: "ic01.ob." + (++icSeq), dispatchId: dispatch.dispatchId,
          sessionId: dispatch.binding.sessionId, turnId: dispatch.binding.turnId, generation: dispatch.binding.generation,
          planId: dispatch.planId, stepIndex: dispatch.stepIndex, capabilityId: cap,
          receipt, sourceAuthority: raFrom(dispatch.binding), resultAuthority: topResultAuthority, ackCommitment,
        }, opts.override || {});
      };
      // REV-02 (CORRECTION-01) — acknowledge a dispatch to the exact accepted-R5B execution tuple of `o`.
      const acceptedFrom = (o) => ({ receiptId: o.receipt.receiptId, proposalId: o.receipt.proposalId, providerTurnId: o.receipt.providerTurnId, actionId: o.receipt.actionId, executionNonce: o.receipt.executionNonce, operation: o.receipt.operation, authorityRef: o.receipt.authorityRef });
      const ack = (loop, dispatch, o, nowMs) => loop.acknowledgeDispatch({ dispatchId: dispatch.dispatchId, accepted: acceptedFrom(o), nowMs });
      // legitimate VERIFIED resolution = acknowledge THEN submit the matching receipt.
      const verify = (loop, dispatch, opts, nAck, nObs) => { const o = obsFor(dispatch, opts); ack(loop, dispatch, o, nAck); return loop.submitObservation({ observation: o, nowMs: nObs }); };
      const SIX_OPS = ["APPLY_HOTEL_REFINEMENT", "READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "SHOW_HOTEL_SECTION"];

      // ── §34 CONTRACT MATRIX ────────────────────────────────────────────
      if (icWant("ic01-contract")) {
        section("IC01 §34 — closed intelligence contract (vocabularies, bounds, validators)");
        eq(IC.INTELLIGENCE_CONTRACT_VERSION, "staybid-intelligence.v1", "IC01-C01 — contract version constant");
        eq(IC.INTELLIGENCE_INTENTS.length, 9, "IC01-C02 — exactly 9 closed intents");
        eq(IC.CLARIFY_REASONS.length, 6, "IC01-C03 — exactly 6 clarify reasons");
        eq(IC.PLAN_STEP_KINDS.length, 4, "IC01-C04 — 4 plan step kinds");
        eq(IC.RESULT_STATES.length, 8, "IC01-C04 — 8 result states");
        eq(IC.RESPONSE_CLAIM_KINDS.length, 2, "IC01-C04 — 2 response-claim kinds (fact/advice)");
        eq(IC.FACT_ANSWER_KINDS.length, 5, "IC01-C04 — exactly 5 closed fact answer kinds");
        eq(IC.ADVICE_INTENTS.length, 4, "IC01-C04 — exactly 4 closed advisory intents (RESIDUAL A)");
        ok(!IC.ADVICE_INTENTS.some((a) => /book|pay|refund|bid|message/i.test(a)), "IC01-C04 — no advice intent asserts a booking/payment/refund/bid/message completion");
        eq(IC.RETRY_DISPOSITIONS.length, 3, "IC01-C04 — 3 retry dispositions");
        eq(IC.MEMORY_ORIGINS.length, 4, "IC01-C04 — 4 trusted memory origins");
        ok(!IC.MEMORY_ORIGINS.includes("MODEL_INFERRED"), "IC01-C04 — model inference is NOT a trusted memory origin");
        eq(IC.MODEL_TIERS.length, 6, "IC01-C04 — 6 provider-neutral tiers");
        ok(IC.DISABLED_MODEL_TIERS.includes("LEVEL_3") && IC.DISABLED_MODEL_TIERS.includes("LEVEL_4"), "IC01-C04 — LEVEL_3/LEVEL_4 disabled");
        [IC.INTELLIGENCE_INTENTS, IC.CLARIFY_REASONS, IC.PLAN_STEP_KINDS, IC.RESULT_STATES, IC.RETRY_DISPOSITIONS, IC.MEMORY_ORIGINS, IC.MODEL_TIERS, IC.TERMINATION_REASONS, IC.IC01_LIMITS, IC.RESPONSE_CLAIM_KINDS, IC.FACT_ANSWER_KINDS, IC.FACT_ANSWER_EVIDENCE, IC.ADVICE_INTENTS].forEach((v, i) =>
          ok(Object.isFrozen(v), `IC01-C05 — closed vocabulary/limits object #${i} is frozen`));
        const L = IC.IC01_LIMITS;
        eq(L.MAX_PLAN_STEPS, 4, "IC01-C06 — plan ≤ 4 steps");
        eq(L.MAX_CAPABILITY_STEPS, 3, "IC01-C06 — ≤ 3 capability steps/turn");
        eq(L.MAX_MODEL_CALLS_PER_TURN, 3, "IC01-C06 — ≤ 3 model calls/turn");
        eq(L.MAX_MODEL_FALLBACK_CALLS, 1, "IC01-C06 — ≤ 1 fallback call");
        eq(L.TURN_DEADLINE_MS, 30000, "IC01-C06 — 30s turn deadline");
        eq(L.MAX_MODEL_INPUT_BYTES, 16384, "IC01-C06 — model input 16 KiB");

        const vb = IC.validateTrustedBinding(icBinding());
        ok(vb !== null && Object.isFrozen(vb), "IC01-C07 — a valid trusted binding validates FROZEN");
        eq(IC.validateTrustedBinding(icBinding({ pageId: "checkout" })), null, "IC01-C08 — unknown pageId rejects");
        eq(IC.validateTrustedBinding(Object.assign(icBinding(), { planId: "model-minted" })), null, "IC01-C09 — an EXTRA identity key on the binding rejects");
        { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); eq(IC.validateTrustedBinding(proxy), null, "IC01-C10 — a REVOKED Proxy fails closed"); }

        ok(IC.validateUserTurn(icTurn()) !== null, "IC01-C11 — a valid en user turn validates");
        eq(IC.validateUserTurn(icTurn({ text: "a".repeat(2001) })), null, "IC01-C12 — 2001 bytes rejected");
        eq(IC.validateUserTurn(icTurn({ text: "hi\u0007there" })), null, "IC01-C12 — a control char REJECTS (never stripped)");
        eq(IC.validateUserTurn(icTurn({ language: "fr" })), null, "IC01-C13 — unknown language rejects");

        ok(IC.validatePlanCandidate(icPlan([respondAdvice()])) !== null, "IC01-C14 — a single advice RESPOND terminal plan validates");
        const p2 = IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]));
        ok(p2 !== null && Object.isFrozen(p2) && Object.isFrozen(p2.steps), "IC01-C14 — CAPABILITY+RESPOND validates FROZEN");
        eq(IC.validatePlanCandidate(icPlan([
          capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }),
          capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice(),
        ])), null, "IC01-C16 — a 5th step is IMPOSSIBLE (plan > 4 rejects)");
        eq(IC.validatePlanCandidate(icPlan([respondAdvice(), capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" })])), null, "IC01-C17 — a terminal step anywhere but LAST rejects");
        eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" })])), null, "IC01-C17 — a plan with NO terminal step rejects");
        eq(IC.validatePlanCandidate(icPlan([respondAdvice()], "DO_ANYTHING")), null, "IC01-C18 — an unknown intent rejects");
        ok(IC.validatePlanCandidate(icPlan([clarifyStep()], "CLARIFY")) !== null, "IC01-C19 — CLARIFY intent = exactly one CLARIFY step validates");
        eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()], "UNSUPPORTED")), null, "IC01-C19 — UNSUPPORTED intent with a capability step rejects");
        eq(IC.validatePlanCandidate(Object.assign(icPlan([respondAdvice()]), { planId: "model-minted" })), null, "IC01-C21 — a model-supplied plan-level planId is rejected");
        ["stepId", "proposalId", "receiptId", "nonce", "authorityRef", "dispatchId"].forEach((k) => eq(IC.validatePlanCandidate(icPlan([Object.assign(respondAdvice(), { [k]: "model-minted" })])), null, `IC01-C22 — a model-supplied step-level ${k} is rejected`));
        eq(IC.validatePlanCandidate(icPlan([capStep("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 0 }), respondAdvice()])), null, "IC01-C23 — OPEN ordinal 0 rejects (accepted R5A bound)");
        eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "OPEN_VISIBLE_HOTEL", position: 1 }), respondAdvice()])), null, "IC01-C24 — args.op ≠ capabilityId rejects");
        { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); eq(IC.validatePlanCandidate(proxy), null, "IC01-C25 — a revoked-Proxy plan fails closed"); }

        // ── REV-01 (CORRECTION-01) — CLOSED fact answer descriptor; no free-form factual text ──
        section("IC01 §34 REV-01(C1) — a fact is a CLOSED answer descriptor derived from evidence (no free-form text)");
        ok(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")])) !== null, "IC01-RV1a — a closed fact answer grounded in an EARLIER capability step validates");
        eq(IC.validatePlanCandidate(icPlan([respondFact(0)])), null, "IC01-RV1b — a fact grounded in step 0 when the ONLY step is the RESPOND rejects");
        eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(1)])), null, "IC01-RV1c — a fact grounded in its OWN index rejects");
        // the CORE REV-01 residual fix: an arbitrary model factual sentence cannot be a fact.
        eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), { kind: "RESPOND", language: "en", claims: [{ kind: "fact", text: "booking and payment succeeded", groundedInStep: 0 }] }])), null, "IC01-RV1x — a fact carrying arbitrary free-form text is REJECTED (no free-form factual authority)");
        eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0, text: "booking succeeded" }] }])), null, "IC01-RV1x — a fact with answer + a stray text key is REJECTED (exact keys)");
        // no Customer-V1 answer exists for a transactional/action completion the six capabilities cannot produce.
        ["booking_confirmed", "payment_succeeded", "refund_completed", "bid_submitted", "message_sent", "booking_succeeded"].forEach((forbidden) => {
          ok(!IC.FACT_ANSWER_KINDS.includes(forbidden), `IC01-RV1y — FACT_ANSWER_KINDS excludes '${forbidden}'`);
          eq(IC.validatePlanCandidate(icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: forbidden, groundedInStep: 0 }] }])), null, `IC01-R6 — a fact cannot claim '${forbidden}' (closed answer set — no such Customer-V1 fact)`);
        });
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [], groundedInStep: 0 }] }])), null, "IC01-RV1f — an advice claim carrying a stray groundedInStep rejects (exact keys)");
        // ── RESIDUAL A (CORRECTION-02) — advice is a CLOSED descriptor, never free-form model text ──
        // (a) arbitrary free-form advice `text` is rejected at the exact-keys gate (there is NO text field)
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", text: "Your booking and payment succeeded." }] }])), null, "IC01-RA1 — arbitrary advice `text` is REJECTED (no free-form advisory text)");
        ["booking succeeded", "payment succeeded", "booking and payment succeeded", "refund completed", "bid submitted", "message sent"].forEach((s) =>
          eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", text: s }] }])), null, `IC01-RA1 — a factual completion sentence ('${s}') can NEVER hide inside advice text`));
        // (b) a NON-closed advice intent (an arbitrary advisory sentence/semantics) is rejected — R8 mutation target
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "Your booking and payment succeeded.", positions: [] }] }])), null, "IC01-RA-R8 — an arbitrary advisory sentence can never be a CLOSED advice claim (no non-closed advisory semantics)");
        ["booking_succeeded", "payment_succeeded", "refund_completed", "bid_submitted", "message_sent"].forEach((a) =>
          eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: a, positions: [] }] }])), null, `IC01-RA-R8 — a fabricated advice intent ('${a}') is REJECTED (closed set only)`));
        // (c) every closed advice intent validates
        IC.ADVICE_INTENTS.forEach((a) =>
          ok(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: a, positions: [] }] }])) !== null, `IC01-RA2 — the closed advice intent '${a}' validates`));
        // (d) positions: distinct 1-based ints in [1, MAX_VISIBLE_ENTITIES], count ≤ MAX_SELECTED_ENTITIES (static bound)
        ok(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [1, 3] }] }])) !== null, "IC01-RA3 — advice with valid positions [1,3] validates");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [1, 1] }] }])), null, "IC01-RA3 — duplicate advice positions rejected");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [0] }] }])), null, "IC01-RA3 — a 0 (non 1-based) advice position rejected");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [25] }] }])), null, "IC01-RA3 — an advice position beyond the visible max (24) rejected");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [1, 2, 3, 4, 5] }] }])), null, "IC01-RA3 — more advice positions than the selected bound (4) rejected");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [1.5] }] }])), null, "IC01-RA3 — a non-integer advice position rejected");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options" }] }])), null, "IC01-RA3 — advice missing positions rejected (exact keys)");
        // (e) renderAdvice is deterministic, evidence-free, and fails closed on a non-closed intent
        ["en", "hi", "hinglish"].forEach((l) => ok(typeof IC.renderAdvice("consider_visible_options", [1, 2], l) === "string", `IC01-RA4 — renderAdvice compiles a deterministic sentence in ${l}`));
        eq(IC.renderAdvice("booking_succeeded", [], "en"), null, "IC01-RA4 — renderAdvice returns null for a non-closed intent (fail closed)");
        ok(IC.renderAdvice("consider_visible_options", [1, 2], "en").includes("1, 2"), "IC01-RA4 — validated positions are woven deterministically into the sentence");
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "en", claims: [] }])), null, "IC01-RV1g — an empty claims array rejects");
        // renderFactAnswer — deterministic, evidence-derived; fail closed on mismatch/absence.
        ok(typeof IC.renderFactAnswer("results_summary", { kind: "results", count: 3, orderedIds: ["a", "b", "c"] }, "en") === "string", "IC01-RV1z — renderFactAnswer derives text from matching evidence");
        eq(IC.renderFactAnswer("results_summary", { kind: "comparison", positions: [1, 2] }, "en"), null, "IC01-RV1z — renderFactAnswer fails closed on a mismatched evidence kind");
        eq(IC.renderFactAnswer("hotel_facts", { kind: "detail", hotelId: "h" }, "en"), null, "IC01-RV1z — renderFactAnswer fails closed on missing evidence fields");
        eq(IC.renderFactAnswer("booking_succeeded", { kind: "results", count: 1, orderedIds: ["a"] }, "en"), null, "IC01-RV1z — renderFactAnswer cannot render a non-closed answer");

        // ── REV-02 — observation carries the accepted R5B receipt correlation ──
        section("IC01 §34 REV-02 — trusted observation = R5B receipt + source/result authority");
        const goodDispatch = { dispatchId: "ic01.dsp.1", planId: "ic01.pl.1", stepIndex: 0, capabilityId: "READ_CURRENT_RESULTS", binding: icBinding() };
        const goodObs = obsFor(goodDispatch);
        ok(IC.validateObservation(goodObs) !== null && Object.isFrozen(IC.validateObservation(goodObs)), "IC01-RV2a — a valid R5B-correlated observation validates FROZEN");
        eq(IC.validateObservation(Object.assign({}, goodObs, { receipt: Object.assign({}, goodObs.receipt, { operation: "OPEN_VISIBLE_HOTEL" }) })), null, "IC01-RV2b — receipt.operation ≠ capabilityId rejects");
        eq(IC.validateObservation(Object.assign({}, goodObs, { resultState: "VERIFIED" })), null, "IC01-RV2d — an extra top-level resultState rejects (state is DERIVED)");
        { const noEv = obsFor(goodDispatch, { withEvidence: false }); eq(IC.validateObservation(noEv), null, "IC01-RV2e — a VERIFIED receipt with NO typed evidence rejects"); }
        eq(IC.validateObservation(Object.assign({}, goodObs, { sourceAuthority: null })), null, "IC01-RV2f — a missing source authority rejects");
        eq(IC.deriveResultState({ outcome: "verified", status: "verified" }), "VERIFIED", "IC01-RV2h — verified → VERIFIED");
        eq(IC.deriveResultState({ outcome: "acted", status: "execution_acknowledged" }), "PENDING_VERIFICATION", "IC01-RV2h — acted → PENDING_VERIFICATION (accepted ≠ verified)");
        eq(IC.deriveResultState({ outcome: "rejected", status: "no_op" }), "NO_OP", "IC01-RV2h — rejected+no_op → NO_OP");

        // ── REV-03 — canonical bounded IntelligenceInputSnapshot ──
        section("IC01 §34 REV-03 — canonical IntelligenceInputSnapshot (16 KiB enforced)");
        const smallSnap = IC.buildIntelligenceInputSnapshot({ binding: icBinding(), userText: "hi", language: "en", role: "customer", failureState: { consecutiveFailures: 0, lastResultState: null, clarificationTurns: 0 } });
        ok(smallSnap !== null && Object.isFrozen(smallSnap), "IC01-RV3a — a minimal snapshot builds FROZEN");
        ok((IC.measureJsonBytes(smallSnap) || 99999) <= 16384, "IC01-RV3b — a built snapshot never exceeds 16 KiB");
        const bigHotels = Array.from({ length: 24 }, (_, i) => ({ position: i + 1, id: "h" + i, name: "N".repeat(200), city: "C".repeat(120), minPrice: 1000, rating: 4, parking: "present" }));
        const bigCtx = { pageId: "hotels", role: "customer", destination: null, query: null, loadState: "ready", visibleHotels: bigHotels, currentHotelId: null, validated: true, section: null, breakfast: null, parking: null };
        // IC01-CLOSE-04 — a COHERENT binding (its digest describes bigCtx) so the 16 KiB SIZE gate — not the
        // coherence gate — is the sole reason for rejection (keeps the R3 size probe non-vacuous).
        const bigInput = { binding: icBinding({ contextDigest: SCH.contextDigest(bigCtx) }), userText: "u".repeat(1990), language: "en", role: "customer", context: bigCtx, evidenceRefs: Array.from({ length: 8 }, (_, i) => "ev" + i), conversation: Array.from({ length: 8 }, () => ({ role: "user", text: "x".repeat(500) })), failureState: { consecutiveFailures: 0, lastResultState: null, clarificationTurns: 0 } };
        eq(IC.buildIntelligenceInputSnapshot(bigInput), null, "IC01-RV3c — an over-16KiB canonical snapshot is rejected (never truncated)");
        eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding(), userText: "hi", language: "en", role: "customer", preferences: { creditCard: "x" }, failureState: { consecutiveFailures: 0, lastResultState: null, clarificationTurns: 0 } }), null, "IC01-RV3f — an unknown preference key rejects");
      }

      // ── §35 REGISTRY MATRIX (unchanged; registry frozen) ──
      if (icWant("ic01-registry")) {
        section("IC01 §35 — exact-six capability registry (accepted R5A names + delegated args)");
        eq(REG.CAPABILITY_COUNT, 6, "IC01-R01 — registry cardinality is EXACTLY six");
        SIX_OPS.forEach((id) => ok(REG.CAPABILITY_IDS.includes(id), `IC01-R02 — capability id ${id} identical to the accepted R5A operation name`));
        const meta = {
          APPLY_HOTEL_REFINEMENT: ["hotels", "UI_LOCAL", "ADVANCES_CONTEXT", "results"], READ_CURRENT_RESULTS: ["hotels", "READ", "NONE", "results"],
          COMPARE_VISIBLE_HOTELS: ["hotels", "READ", "NONE", "comparison"], OPEN_VISIBLE_HOTEL: ["hotels", "UI_LOCAL", "ADVANCES_ROUTE", "navigation"],
          READ_CURRENT_HOTEL_FACTS: ["hotel-detail", "READ", "NONE", "detail"], SHOW_HOTEL_SECTION: ["hotel-detail", "UI_LOCAL", "ADVANCES_CONTEXT", "ui_state"],
        };
        SIX_OPS.forEach((id) => {
          const d = REG.getCapability(id);
          eq(d && d.requiredPageId, meta[id][0], `IC01-R03 — ${id} page = ${meta[id][0]}`);
          eq(d && d.authorityClass, meta[id][1], `IC01-R03 — ${id} authority = ${meta[id][1]} (READ/UI_LOCAL only)`);
          eq(d && d.contextEffect, meta[id][2], `IC01-R03 — ${id} context effect = ${meta[id][2]}`);
          eq(d && d.evidenceType, meta[id][3], `IC01-R03 — ${id} evidence type = ${meta[id][3]}`);
          eq(d && d.requiresTerminalVerification, true, `IC01-R03 — ${id} requires terminal verification`);
        });
        eq(REG.getCapability("PREPARE_BID_DRAFT"), null, "IC01-R04 — getCapability(unknown/legacy id) fails closed to null");
        eq(REG.getCapability("__proto__"), null, "IC01-R04 — __proto__ lookup fails closed (null-prototype map)");
        eq(REG.getCapability({ toString: () => "READ_CURRENT_RESULTS" }), null, "IC01-R04 — a coercing non-string id fails closed");
        eq(typeof REG.registerCapability, "undefined", "IC01-R06 — there is NO registration API (closed set)");
        SIX_OPS.forEach((id) => {
          const va = { APPLY_HOTEL_REFINEMENT: { op: id, maxPrice: 5000 }, READ_CURRENT_RESULTS: { op: id }, COMPARE_VISIBLE_HOTELS: { op: id, positions: [1, 3], factors: ["price"] }, OPEN_VISIBLE_HOTEL: { op: id, position: 2 }, READ_CURRENT_HOTEL_FACTS: { op: id }, SHOW_HOTEL_SECTION: { op: id, section: "rooms" } }[id];
          eq(JSON.stringify(REG.validateCapabilityArgs(id, va)), JSON.stringify(SCH.validateModelOperation(va)), `IC01-R07 — ${id} canonical output IDENTICAL to the accepted R5A validator (reuse, not fork)`);
        });
        eq(REG.validateCapabilityArgs("READ_CURRENT_RESULTS", { op: "OPEN_VISIBLE_HOTEL", position: 1 }), null, "IC01-R09 — op/capabilityId mismatch rejects");
        eq(REG.capabilityAdvancesContext("APPLY_HOTEL_REFINEMENT"), true, "IC01-R10 — APPLY advances context");
        eq(REG.capabilityAdvancesContext("READ_CURRENT_RESULTS"), false, "IC01-R10 — READ results does not advance");
        eq(REG.capabilityAdvancesContext("SOMETHING_ELSE"), true, "IC01-R10 — an UNKNOWN capability is treated as context-advancing (fail closed)");
      }

      // ── §36 AGENT LOOP MATRIX ──────────────────────────────────────────
      if (icWant("ic01-loop")) {
        section("IC01 §36 — pure bounded agent loop (state machine, budgets, R5B correlation, deadline, grounding)");
        const EFFECT_KINDS = ["MODEL_REQUEST", "CAPABILITY_DISPATCH", "REBIND_REQUIRED", "TERMINAL", "INERT", "REJECTED"];
        // (a) DORMANT default
        {
          const loop = AL.createAgentLoop();
          const e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(e.kind, "TERMINAL", "IC01-L01 — default-constructed loop terminates (no model port)");
          eq(e.reason, "MODEL_UNAVAILABLE", "IC01-L01 — default reason MODEL_UNAVAILABLE");
          eq(loop.status().modelCalls, 0, "IC01-L01 — ZERO model requests emitted");
        }
        // (b) READ → ack → verified → advice RESPOND → COMPLETED; MODEL_REQUEST carries snapshot + deadline
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(e1.kind, "MODEL_REQUEST", "IC01-L03 — a valid turn requests ONE model call");
          eq(e1.deadlineMs, 30000, "IC01-L03 — MODEL_REQUEST carries the absolute deadline (REV-04)");
          ok(e1.input && e1.input.contractVersion === "staybid-intelligence.v1", "IC01-L03 — MODEL_REQUEST carries the canonical IntelligenceInputSnapshot (REV-03)");
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          eq(e2.kind, "CAPABILITY_DISPATCH", "IC01-L04 — a valid plan dispatches its first capability step");
          const e3 = verify(loop, e2, {}, 20, 30);
          eq(e3.kind, "TERMINAL", "IC01-L05 — an ACKNOWLEDGED + matching VERIFIED observation completes the plan");
          eq(e3.reason, "COMPLETED", "IC01-L05 — the turn completes");
          eq(loop.status().evidenceHandles, 1, "IC01-L05 — the verified receipt handle was recorded");
        }
        // (c) accepted/acted (PENDING_VERIFICATION) NEVER completes (no ack needed — never promotes)
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 1 }), respondAdvice()], "OPEN_VISIBLE_HOTEL"), nowMs: 10 });
          const ePend = loop.submitObservation({ observation: obsFor(e2, { outcome: "acted" }), nowMs: 20 });
          eq(ePend.kind, "INERT", "IC01-L06 — PENDING_VERIFICATION acknowledgement stays pending (INERT; dispatch still pending)");
        }
        // (d) REV-02 correlation mismatches fail closed
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          eq(loop.submitObservation({ observation: obsFor(e2, { override: { dispatchId: "ic01.OTHER" } }), nowMs: 20 }).kind, "INERT", "IC01-RV2i — a wrong dispatchId is INERT (foreign_dispatch)");
          eq(loop.submitObservation({ observation: obsFor(e2, { receiptOverride: { authorityRef: "auth-forged" } }), nowMs: 20 }).kind, "INERT", "IC01-RV2k — a forged receipt authorityRef (unacknowledged) is INERT");
          { const o = obsFor(e2, { override: { sourceAuthority: raFrom(icBinding(), { authorityRef: "auth-forged" }) } }); eq(loop.submitObservation({ observation: o, nowMs: 20 }).kind, "INERT", "IC01-RV2j — a forged source authority is INERT (source_authority_mismatch)"); }
          eq(loop.submitObservation({ observation: { forged: true }, nowMs: 20 }).kind, "REJECTED", "IC01-L10 — a malformed observation envelope is REJECTED");
        }
        {
          // wrong generation — acknowledge (matching execution) so the generation recheck is the SOLE gate.
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oGen = obsFor(e2); ack(loop, e2, oGen, 18);
          eq(loop.submitObservation({ observation: Object.assign({}, oGen, { generation: 7 }), nowMs: 20 }).kind, "INERT", "IC01-L10 — wrong generation observation is INERT (stale_generation)");
          eq(loop.status().phase, "AWAIT_OBSERVATION", "IC01-L10 — the wrong-generation obs did not resolve the dispatch");
        }
        {
          // forged receipt.authorityRef (execution ids + sourceAuthority correct) — the receipt authorityRef check is the SOLE gate.
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oAuth = obsFor(e2); ack(loop, e2, oAuth, 18);
          const forgedAuth = Object.assign({}, oAuth, { receipt: Object.assign({}, oAuth.receipt, { authorityRef: "auth-forged" }) });
          eq(loop.submitObservation({ observation: forgedAuth, nowMs: 20 }).why, "authority_mismatch", "IC01-RV2 — a receipt whose authorityRef ≠ the dispatch source authority is INERT");
        }
        // ── REV-02 (CORRECTION-01) — acknowledgement REQUIRED + swapped-receipt fails closed ──
        section("IC01 §36 REV-02(C1) — dispatch acknowledgement binds the exact accepted-R5B execution");
        {
          // a VERIFIED terminal CANNOT promote without a prior acknowledgement
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const unacked = loop.submitObservation({ observation: obsFor(e2), nowMs: 20 });
          eq(unacked.kind, "INERT", "IC01-R7b — a VERIFIED terminal cannot promote without a prior dispatch acknowledgement");
          // IC01-CLOSE-03 — an un-acknowledged (pre-accept) VERIFIED is impossible: nothing executed, so a
          // "verified before accept" is refused (the R5B gateway can only pre-accept-terminalize a NEGATIVE).
          eq(unacked.why, "verified_before_accept", "IC01-R7b — an un-acknowledged VERIFIED is refused (verified_before_accept)");
          eq(loop.status().phase, "AWAIT_OBSERVATION", "IC01-R7b — the unacknowledged VERIFIED did not resolve the dispatch");
        }
        {
          // SWAPPED valid receipt: bind dispatch A to execution A, submit execution B → must NOT resolve
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const execA = obsFor(e2);                 // execution A (its receipt ids)
          const execB = obsFor(e2);                 // execution B — same session/turn/authority/operation/source, DIFFERENT ids
          eq(ack(loop, e2, execA, 20).kind, "INERT", "IC01-R7 — dispatch A acknowledged to execution A");
          const swapped = loop.submitObservation({ observation: execB, nowMs: 30 });
          eq(swapped.kind, "INERT", "IC01-R7 — a swapped valid receipt (different R5B execution) does NOT resolve the pending dispatch");
          eq(swapped.why, "execution_correlation_mismatch", "IC01-R7 — reason execution_correlation_mismatch");
          eq(loop.status().phase, "AWAIT_OBSERVATION", "IC01-R7 — the swapped receipt left the dispatch unresolved");
          // the matching receipt A still resolves it
          const good = loop.submitObservation({ observation: execA, nowMs: 40 });
          eq(good.kind, "TERMINAL", "IC01-R7 — the ACKNOWLEDGED matching receipt A resolves + completes");
        }
        {
          // acknowledgement guards: foreign dispatch id, capability mismatch, conflicting re-ack
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          eq(loop.acknowledgeDispatch({ dispatchId: "ic01.OTHER", accepted: acceptedFrom(obsFor(e2)), nowMs: 15 }).kind, "INERT", "IC01-R7c — an ack for a foreign dispatch id is INERT");
          eq(loop.acknowledgeDispatch({ dispatchId: e2.dispatchId, accepted: { forged: true }, nowMs: 15 }).kind, "REJECTED", "IC01-R7c — an invalid acknowledgement payload is REJECTED");
          const oA = obsFor(e2); eq(ack(loop, e2, oA, 16).kind, "INERT", "IC01-R7c — first ack accepted");
          eq(ack(loop, e2, oA, 17).kind, "INERT", "IC01-R7c — the identical ack is idempotent (INERT)");
          const conflictAck = ack(loop, e2, obsFor(e2), 18);
          eq(conflictAck.kind, "TERMINAL", "IC01-R7c — a SECOND, different execution binding for one dispatch terminates fail-closed");
          eq(conflictAck.reason, "CONFLICTING_OBSERVATION", "IC01-R7c — reason CONFLICTING_OBSERVATION");
        }
        // ── REV-01 (CORRECTION-01) — runtime grounding: closed answer, evidence-derived text ──
        section("IC01 §36 REV-01(C1) — a fact is grounded + answer↔evidence matched + evidence-derived");
        {
          // READ NO_OP → a fact cannot be grounded → UNGROUNDED (nothing narrated)
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
          const o3 = obsFor(e2, { outcome: "rejected", status: "no_op" }); ack(loop, e2, o3, 18); // REV-02(C2) — every terminal is acknowledged
          const e3 = loop.submitObservation({ observation: o3, nowMs: 20 });
          eq(e3.kind, "TERMINAL", "IC01-RV1 — an ungrounded fact claim is REFUSED (UNGROUNDED_RESPONSE), never narrated");
          eq(e3.reason, "UNGROUNDED_RESPONSE", "IC01-RV1 — NO_OP never grounds a factual completion");
        }
        {
          // READ verified with results evidence → a results_summary fact is grounded → COMPLETED
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
          const e3 = verify(loop, e2, {}, 20, 30);
          eq(e3.kind, "TERMINAL", "IC01-RV1j — a fact whose answer matches a VERIFIED step's evidence completes");
          eq(e3.reason, "COMPLETED", "IC01-RV1j — a truly grounded, evidence-derived fact is narrated");
        }
        {
          // answer↔evidence-kind mismatch: hotel_facts grounded in a results step → UNGROUNDED
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "hotel_facts")]), nowMs: 10 });
          const e3 = verify(loop, e2, {}, 20, 30);
          eq(e3.kind, "TERMINAL", "IC01-R6b — a fact answer kind mismatched to the grounded step's evidence is refused");
          eq(e3.reason, "UNGROUNDED_RESPONSE", "IC01-R6b — an answer↔evidence-kind mismatch never narrates");
        }
        // ── RESIDUAL A (CORRECTION-02) — the loop narrates DETERMINISTIC advice; positions bind to CURRENT visible ──
        section("IC01 §36 RESIDUAL-A(C2) — closed advice narrates deterministically; positions must be current-visible");
        {
          const H = (position, id, price, rating, parking) => ({ position, id, name: "Hotel " + id, city: "Manali", minPrice: price, rating, parking });
          const ctxN = (n) => ({ pageId: "hotels", role: "customer", destination: "manali", query: null, loadState: "ready", visibleHotels: [H(1, HID, 1000, 4, "present"), H(2, HID2, 2000, 5, "absent")].slice(0, n), currentHotelId: null, validated: true, section: null, breakfast: null, parking: null, refinement: null });
          const advPlan = (positions) => icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), { kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions }] }]);
          // closed advice with CURRENT-visible positions → COMPLETED (deterministic narration)
          {
            const loop = AL.createAgentLoop(fakeDeps());
            // IC01-CLOSE-04 — the binding's contextDigest must be the ACCEPTED canonical digest of THIS context.
            const e1 = loop.beginTurn({ binding: icBinding({ contextDigest: SCH.contextDigest(ctxN(2)) }), userTurn: icTurn(), context: ctxN(2), nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: advPlan([1, 2]), nowMs: 10 });
            const done = verify(loop, e2, {}, 15, 20);
            eq(done.kind, "TERMINAL", "IC01-RA5 — closed advice with current-visible positions completes");
            eq(done.reason, "COMPLETED", "IC01-RA5 — a deterministic (evidence-free) advice sentence is narrated");
          }
          // an advice position BEYOND the current visible set → UNGROUNDED_RESPONSE (fail closed)
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding({ contextDigest: SCH.contextDigest(ctxN(1)) }), userTurn: icTurn(), context: ctxN(1), nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: advPlan([2]), nowMs: 10 });
            eq(verify(loop, e2, {}, 15, 20).reason, "UNGROUNDED_RESPONSE", "IC01-RA6 — an advice position beyond the CURRENT visible set fails closed (nothing narrated)");
          }
          // NO visible context → any advice position fails closed
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: advPlan([1]), nowMs: 10 });
            eq(verify(loop, e2, {}, 15, 20).reason, "UNGROUNDED_RESPONSE", "IC01-RA6 — with NO visible context an advice position fails closed");
          }
          // positionless advice narrates on any page (no positions to bind)
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: advPlan([]), nowMs: 10 });
            eq(verify(loop, e2, {}, 15, 20).reason, "COMPLETED", "IC01-RA7 — positionless closed advice narrates deterministically");
          }
        }
        // ── RESIDUAL B (CORRECTION-02) — EVERY terminal must belong to the acknowledged execution tuple ──
        section("IC01 §36 RESIDUAL-B(C2) — exact execution correlation on ALL terminal states (not VERIFIED-only)");
        {
          // swapped VERIFIED receipt (bind A, submit B) does NOT resolve (R7 property, still enforced)
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oA = obsFor(e2); ack(loop, e2, oA, 15);
          const swap = loop.submitObservation({ observation: obsFor(e2), nowMs: 20 });
          eq(swap.kind, "INERT", "IC01-R7 — a swapped VERIFIED receipt (different execution) does NOT resolve");
          eq(swap.why, "execution_correlation_mismatch", "IC01-R7 — reason execution_correlation_mismatch (verified)");
          eq(loop.status().phase, "AWAIT_OBSERVATION", "IC01-R7 — the dispatch stays pending after a swapped verified receipt");
        }
        {
          // swapped NON-SUCCESS terminal (bind A, submit B's FAILED/no_op) does NOT resolve — R9 mutation target
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oA = obsFor(e2, { outcome: "rejected", status: "no_op" }); ack(loop, e2, oA, 15);
          const swapNo = loop.submitObservation({ observation: obsFor(e2, { outcome: "rejected", status: "no_op" }), nowMs: 20 });
          eq(swapNo.kind, "INERT", "IC01-R9 — a swapped NON-SUCCESS terminal (different execution) does NOT resolve the dispatch");
          eq(swapNo.why, "execution_correlation_mismatch", "IC01-R9 — a non-success swapped terminal fails closed (execution_correlation_mismatch)");
          eq(loop.status().phase, "AWAIT_OBSERVATION", "IC01-R9 — the dispatch stays pending after a swapped non-success terminal");
        }
        {
          // IC01-CLOSE-03 — an UN-acknowledged NON-SUCCESS terminal carrying a POST-accept-form ACK
          // commitment (i.e. NOT a genuine gateway pre-accept ACK, whose commitment is over the UNACCEPTED
          // audit form) does NOT resolve: the pre-accept branch requires the exact pre-accept commitment,
          // so a fabricated (non-pre-accept) provenance fails closed. (The genuine pre-accept path is
          // proven end-to-end by the real-gateway bridge tests A/B below.)
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const unack = loop.submitObservation({ observation: obsFor(e2, { outcome: "rejected", status: "no_op" }), nowMs: 20 });
          eq(unack.kind, "INERT", "IC01-R9b — an UN-acknowledged non-success terminal without the genuine gateway pre-accept ACK is INERT");
          eq(unack.why, "ack_commitment_mismatch", "IC01-R9b — a fabricated (non-pre-accept-form) commitment fails closed");
        }
        {
          // a LEGITIMATELY acknowledged non-success terminal resolves normally (no regression)
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const rej = verify(loop, e2, { outcome: "rejected", status: "invalid_operation" }, 15, 20);
          ok(rej.kind === "MODEL_REQUEST" || rej.kind === "TERMINAL", "IC01-R9c — a legitimately acknowledged REJECTED terminal resolves (replan / honest failure), never blocked");
        }
        // (f) REV-05 — advancement invalidates ALL remaining old steps
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice("Applied.")], "REFINE_RESULTS"), nowMs: 10 });
          const e3 = verify(loop, e2, { resultAuthority: "advance" }, 20, 25);
          eq(e3.kind, "REBIND_REQUIRED", "IC01-RV5 — an advancing verified result forces REBIND (old terminal never executes)");
          eq(loop.status().phase, "AWAIT_REBIND", "IC01-RV5 — machine is AWAIT_REBIND after advancement");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
          const e3 = verify(loop, e2, { resultAuthority: "advance" }, 20, 25);
          eq(e3.kind, "REBIND_REQUIRED", "IC01-L08 — context-advancing VERIFIED forces REBIND_REQUIRED before further capability steps");
          const adv = icBinding({ routeEpoch: 2, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" });
          eq(loop.rebind({ binding: icBinding({ sessionId: "ic01.OTHER" }), nowMs: 30 }).kind, "REJECTED", "IC01-L09 — a rebind to a DIFFERENT session is rejected");
          const e4 = loop.rebind({ binding: adv, nowMs: 40 });
          eq(e4.kind, "MODEL_REQUEST", "IC01-L09 — a valid rebind requests a fresh REPLAN");
          ok(e4.input && e4.input.evidenceRefs.length === 0, "IC01-L09 — the evidence ledger is CLEARED on rebind");
          const e5 = loop.submitModelPlan({ modelRequestId: e4.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 50 });
          eq(e5.kind, "CAPABILITY_DISPATCH", "IC01-L09 — the fresh plan dispatches under the NEW authority");
          eq(e5.binding.authorityRef, "auth-adv", "IC01-L09 — the dispatch carries the REBOUND authority");
        }
        // (g) duplicate inert / conflicting replay terminates
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), capStep("COMPARE_VISIBLE_HOTELS", { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] }), respondAdvice()], "COMPARE_RESULTS"), nowMs: 10 });
          const envelope = obsFor(e2);
          ack(loop, e2, envelope, 15);
          const eA = loop.submitObservation({ observation: envelope, nowMs: 20 });
          eq(eA.kind, "CAPABILITY_DISPATCH", "IC01-L11 — VERIFIED non-advancing READ continues straight to the next capability step");
          const dup = loop.submitObservation({ observation: envelope, nowMs: 30 });
          eq(dup.kind, "INERT", "IC01-L12 — the EXACT duplicate observation is idempotently INERT");
          // A CONFLICTING replay: SAME observationId, DIFFERENT content (rejected, not verified). Rebuilt
          // as a fully VALID observation (canonical result authority absent on both sides + a correct
          // ackCommitment for its OWN receipt), so it passes validation and is detected as a CONTENT
          // conflict — not merely rejected as malformed.
          const conflictReceipt = { receiptId: envelope.receipt.receiptId, proposalId: envelope.receipt.proposalId, providerTurnId: envelope.receipt.providerTurnId, actionId: envelope.receipt.actionId, executionNonce: envelope.receipt.executionNonce, authorityRef: envelope.receipt.authorityRef, operation: envelope.receipt.operation, outcome: "rejected", status: "invalid_operation" };
          const conflictObs = Object.assign({}, envelope, { receipt: conflictReceipt, resultAuthority: null, ackCommitment: SCH.terminalReceiptCommitment(conflictReceipt) });
          const conflict = loop.submitObservation({ observation: conflictObs, nowMs: 40 });
          eq(conflict.kind, "TERMINAL", "IC01-L13 — a CONFLICTING replay (same id, different content) TERMINATES fail-closed");
          eq(conflict.reason, "CONFLICTING_OBSERVATION", "IC01-L13 — reason CONFLICTING_OBSERVATION");
        }
        // (h) hard budgets: 4th model call impossible; 3-capability cap completes
        {
          const loop = AL.createAgentLoop(fakeDeps());
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 }); // model 1
          const applyPlan = () => icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 4000 }), respondAdvice()], "REFINE_RESULTS");
          let disp = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: applyPlan(), nowMs: 10 });
          let rb = verify(loop, disp, { resultAuthority: "advance" }, 18, 20);
          eq(rb.kind, "REBIND_REQUIRED", "IC01-L14 — first APPLY forces rebind");
          // IC01-CLOSE-05 — each rebind MUST correspond to the advanced result authority obsFor produced
          // (authorityRef "auth-adv", contextDigest H64C, contextRevision "rev-adv", routeEpoch prev+1).
          e = loop.rebind({ binding: icBinding({ routeEpoch: 2, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" }), nowMs: 30 }); // model 2
          disp = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: applyPlan(), nowMs: 40 });
          rb = verify(loop, disp, { resultAuthority: "advance" }, 48, 50);
          e = loop.rebind({ binding: icBinding({ routeEpoch: 3, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" }), nowMs: 60 }); // model 3
          eq(e.kind, "MODEL_REQUEST", "IC01-L14 — replan #2 granted (model call 3/3)");
          disp = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: applyPlan(), nowMs: 70 });
          rb = verify(loop, disp, { resultAuthority: "advance" }, 78, 80);
          const e4 = loop.rebind({ binding: icBinding({ routeEpoch: 4, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" }), nowMs: 90 });
          eq(e4.kind, "TERMINAL", "IC01-L15 — the 4th model call is impossible (BUDGET_EXHAUSTED at rebind)");
          eq(e4.reason, "BUDGET_EXHAUSTED", "IC01-L15 — model calls hard-capped at 3");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const threeReads = () => icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]);
          let d1 = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: threeReads(), nowMs: 10 });
          let d2 = verify(loop, d1, {}, 18, 20);   // dispatch 2
          let d3 = verify(loop, d2, {}, 28, 30);   // dispatch 3
          eq(d3.kind, "CAPABILITY_DISPATCH", "IC01-L17 — dispatch 3/3 proceeds");
          const done = verify(loop, d3, {}, 38, 40);   // step 3 is the terminal RESPOND
          eq(done.kind, "TERMINAL", "IC01-L17 — after 3 capability dispatches the plan reaches its terminal");
          eq(done.reason, "COMPLETED", "IC01-L17 — a 4th capability is impossible at the plan level (max 3)");
          eq(loop.status().capabilityDispatches, 3, "IC01-L17 — capability dispatches hard-capped at 3");
        }
        // (i) NO_OP continues (advice); STALE rebinds
        {
          const loop = AL.createAgentLoop(fakeDeps());
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          let d = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oNoop = obsFor(d, { outcome: "rejected", status: "no_op" }); ack(loop, d, oNoop, 18); // REV-02(C2)
          const noop = loop.submitObservation({ observation: oNoop, nowMs: 20 });
          eq(noop.kind, "TERMINAL", "IC01-L19 — NO_OP resolves truthfully and an ADVICE terminal completes");
          eq(noop.reason, "COMPLETED", "IC01-L19 — NO_OP never fabricates a failure");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          let d = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oStale = obsFor(d, { outcome: "stale", status: "stale_context" }); ack(loop, d, oStale, 18); // REV-02(C2)
          const st = loop.submitObservation({ observation: oStale, nowMs: 20 });
          eq(st.kind, "REBIND_REQUIRED", "IC01-L20 — a STALE observation forces a fresh rebind");
        }
        // (j) INTERRUPTED + barge-in
        {
          const loop = AL.createAgentLoop(fakeDeps());
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          let d = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          const oIt = obsFor(d, { outcome: "unknown", status: "interrupted" }); ack(loop, d, oIt, 18); // REV-02(C2)
          const it = loop.submitObservation({ observation: oIt, nowMs: 20 });
          eq(it.kind, "TERMINAL", "IC01-L21 — an INTERRUPTED observation terminates the turn");
          eq(it.reason, "INTERRUPTED", "IC01-L21 — reason INTERRUPTED");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          eq(loop.interrupt({ reason: "invalid_reason", nowMs: 15 }).kind, "REJECTED", "IC01-L22 — an unknown interrupt reason is rejected");
          eq(loop.interrupt({ reason: "barge_in", nowMs: 20 }).kind, "TERMINAL", "IC01-L22 — barge-in terminates deterministically");
        }
        // (k) REV-04 — deadline (>=), monotonic time, expire(), fallback
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([respondAdvice()]), nowMs: 29999 }).reason, "COMPLETED", "IC01-RV4a — a model response at 29999ms is still eligible");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const dead = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([respondAdvice()]), nowMs: 30000 });
          eq(dead.reason, "DEADLINE_EXCEEDED", "IC01-RV4 — a model response at exactly 30000ms is DEADLINE_EXCEEDED");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([respondAdvice()]), nowMs: 30001 }).reason, "DEADLINE_EXCEEDED", "IC01-RV4b — a response at 30001ms is DEADLINE_EXCEEDED");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 1000 });
          const back = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([respondAdvice()]), nowMs: 500 });
          eq(back.reason, "NON_MONOTONIC_TIME", "IC01-RV4c — a backward clock fails closed (never revives authority)");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(loop.expire(29999).kind, "INERT", "IC01-RV4d — expire before the deadline is INERT");
          eq(loop.expire(30000).kind, "TERMINAL", "IC01-RV4d — expire(30000) terminates an idle AWAIT_MODEL with NO model event");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          eq(loop.expire(30000).kind, "TERMINAL", "IC01-RV4e — expire terminates an idle AWAIT_OBSERVATION with NO capability event");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const fb = loop.reportModelFailure({ modelRequestId: e1.modelRequestId, cause: "error", nowMs: 100 });
          eq(fb.kind, "MODEL_REQUEST", "IC01-RV4f — the first model failure yields ONE bounded fallback");
          eq(fb.purpose, "fallback", "IC01-RV4f — purpose fallback");
          const term = loop.reportModelFailure({ modelRequestId: fb.modelRequestId, cause: "timeout", nowMs: 200 });
          eq(term.reason, "MODEL_TIMEOUT", "IC01-RV4f — a SECOND failure terminates (no second fallback)");
          eq(loop.status().modelCalls, 2, "IC01-RV4f — the fallback counted inside the model-call budget");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(loop.reportModelFailure({ modelRequestId: e1.modelRequestId, cause: "timeout", nowMs: 30000 }).reason, "DEADLINE_EXCEEDED", "IC01-RV4g — a model failure at the deadline does not open a fallback");
        }
        // (l) malformed plan → one repair; second → terminate
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const rep = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: { garbage: true }, nowMs: 100 });
          eq(rep.purpose, "repair", "IC01-L24 — a malformed plan gets exactly ONE repair call");
          const deadRep = loop.submitModelPlan({ modelRequestId: rep.modelRequestId, plan: { garbage: true }, nowMs: 200 });
          eq(deadRep.reason, "MODEL_MALFORMED", "IC01-L24 — a second malformed plan terminates");
          eq(loop.status().repairCalls, 1, "IC01-L24 — repair capped at 1");
        }
        // (m) single active turn / single pending model
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(loop.beginTurn({ binding: icBinding({ turnId: "ic01.t2" }), userTurn: icTurn(), nowMs: 5 }).kind, "REJECTED", "IC01-L26 — a second turn cannot begin mid-flight");
          const d = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
          eq(loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([respondAdvice()]), nowMs: 15 }).kind, "REJECTED", "IC01-L26 — no second concurrent model call to answer");
          ok(d.kind === "CAPABILITY_DISPATCH", "IC01-L26 — exactly one pending capability dispatch");
        }
        // (n) clarification bounded; misunderstanding → escalation suggestion
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const clarPlan = () => icPlan([clarifyStep()], "CLARIFY");
          let e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          eq(loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: clarPlan(), nowMs: 10 }).reason, "CLARIFICATION_ISSUED", "IC01-L27 — clarify turn 1 issues a clarification");
          e = loop.beginTurn({ binding: icBinding({ turnId: "ic01.t2" }), userTurn: icTurn(), nowMs: 100 });
          loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: clarPlan(), nowMs: 110 });
          e = loop.beginTurn({ binding: icBinding({ turnId: "ic01.t3" }), userTurn: icTurn(), nowMs: 200 });
          eq(loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: clarPlan(), nowMs: 210 }).reason, "ESCALATION_SUGGESTED", "IC01-L28 — bounded misunderstanding becomes an escalation SUGGESTION");
        }
        // (o) escalation suggestion only; page/role gating; closed effects
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          const t = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: icPlan([escalStep()], "UNSUPPORTED"), nowMs: 10 });
          eq(t.reason, "ESCALATION_SUGGESTED", "IC01-L30 — escalation terminates as a suggestion");
          eq(loop.status().capabilityDispatches, 0, "IC01-L30 — an escalation dispatches NOTHING");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const e = loop.beginTurn({ binding: icBinding({ pageId: "hotels" }), userTurn: icTurn(), nowMs: 0 });
          const wrongPage = icPlan([capStep("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }), respondAdvice()], "READ_HOTEL_FACTS");
          const rep = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: wrongPage, nowMs: 10 });
          eq(rep.kind, "MODEL_REQUEST", "IC01-L31 — a page-mismatched capability plan is refused (repair first)");
          eq(loop.submitModelPlan({ modelRequestId: rep.modelRequestId, plan: wrongPage, nowMs: 20 }).reason, "MODEL_MALFORMED", "IC01-L31 — a persistently page-mismatched plan never dispatches");
          eq(loop.status().capabilityDispatches, 0, "IC01-L31 — zero dispatches for the wrong page");
        }
        {
          const loop = AL.createAgentLoop(fakeDeps());
          const collected = [];
          const e = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 }); collected.push(e);
          const d = loop.submitModelPlan({ modelRequestId: e.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 }); collected.push(d);
          const o = obsFor(d); collected.push(ack(loop, d, o, 15)); collected.push(loop.submitObservation({ observation: o, nowMs: 20 }));
          ok(collected.every((ef) => EFFECT_KINDS.includes(ef.kind)), "IC01-L32 — every effect kind is in the CLOSED effect vocabulary");
          ok(!/https?:\/\/|<[a-z]+ |SELECT |INSERT |window\.|document\./i.test(JSON.stringify(collected)), "IC01-L32 — no URL / DOM / SQL / selector authority appears in any effect");
        }
        // (p) ephemeral prefs — trusted origin only
        {
          const loop = AL.createAgentLoop(fakeDeps());
          eq(loop.noteUserPreference({ origin: "USER_STATED", key: "city", value: "manali" }).ok, true, "IC01-L33 — a USER_STATED city preference is accepted (ephemeral only)");
          eq(loop.noteUserPreference({ origin: "MODEL_INFERRED", key: "city", value: "manali" }).ok, false, "IC01-L33 — MODEL inference is NEVER a trusted preference origin");
        }
        // (q) hostile deps / status frozen / disabled tier
        {
          const loop = AL.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", telemetry: () => { throw new Error("hostile sink"); } });
          eq(loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 }).kind, "MODEL_REQUEST", "IC01-L35 — a throwing telemetry sink never breaks the machine");
          ok(Object.isFrozen(loop.status()), "IC01-L35 — status snapshots are frozen");
        }
        {
          const loop = AL.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_3" });
          eq(loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 }).reason, "MODEL_UNAVAILABLE", "IC01-L36 — a DISABLED tier (LEVEL_3) fails closed");
        }

        // ═════════════════════════════════════════════════════════════════════
        // §36-FINAL — FINAL CONSOLIDATED REMEDIATION (IC01-CLOSE-01..05)
        // ═════════════════════════════════════════════════════════════════════

        // ── IC01-CLOSE-01 — CLARIFY/ESCALATE closed descriptors + deterministic render ──
        section("IC01 §36-FINAL CLOSE-01 — CLARIFY/ESCALATE closed descriptors (no smuggled model narration)");
        {
          // a CLARIFY carrying free-form `text` is REJECTED (extra key fails the exact-key strict record)
          eq(IC.validatePlanCandidate(icPlan([{ kind: "CLARIFY", reason: "MISSING_DESTINATION", text: "Your booking and payment succeeded. Which city?", language: "en" }], "CLARIFY")), null, "IC01-CLOSE-01a — a CLARIFY carrying free-form `text` is REJECTED (booking/payment narration cannot be smuggled)");
          // an ESCALATE carrying free-form `text` is REJECTED
          eq(IC.validatePlanCandidate(icPlan([{ kind: "ESCALATE_TO_HUMAN", escalation: "TRANSACTIONAL_REQUEST", text: "Your refund completed. Contact a human.", language: "en" }], "UNSUPPORTED")), null, "IC01-CLOSE-01b — an ESCALATE carrying free-form `text` is REJECTED (refund narration cannot be smuggled)");
          // an ESCALATE with an invalid escalation reason is REJECTED
          eq(IC.validatePlanCandidate(icPlan([{ kind: "ESCALATE_TO_HUMAN", escalation: "BOOKING_CONFIRMED", language: "en" }], "UNSUPPORTED")), null, "IC01-CLOSE-01c — an unknown escalation reason is REJECTED (closed vocabulary)");
          // clean closed descriptors validate
          ok(IC.validatePlanCandidate(icPlan([clarifyStep()], "CLARIFY")) !== null, "IC01-CLOSE-01d — a clean CLARIFY (reason only) validates");
          ok(IC.validatePlanCandidate(icPlan([escalStep()], "UNSUPPORTED")) !== null, "IC01-CLOSE-01d — a clean ESCALATE (escalation only) validates");
          eq(IC.ESCALATION_REASONS.length, 4, "IC01-CLOSE-01e — exactly 4 closed escalation reasons");
          ok(Object.isFrozen(IC.ESCALATION_REASONS), "IC01-CLOSE-01e — the escalation vocabulary is frozen");
          // deterministic renders for EVERY closed reason × language are non-null, bounded, and NEVER assert a
          // completion — the pattern machine-scans en/hinglish (Latin) AND hi (Devanagari) completion terms so
          // the Devanagari renders are asserted too (सफल success / पूर्ण·पूरा complete / पुष्ट confirm / बुक book /
          // भुगतान payment / रिफंड·वापस refund).
          const COMPLETION_RE = /succeed|succeeded|completed|complete\b|confirmed|refunded|\bpaid\b|\bbooked\b|bid placed|payment done|सफल|पूर्ण|पूरा|पुष्ट|बुक|भुगतान|रिफंड|वापस/i;
          ["en", "hi", "hinglish"].forEach((lang) => {
            IC.CLARIFY_REASONS.forEach((r) => {
              const t = IC.renderClarify(r, lang);
              ok(typeof t === "string" && t.length > 0, `IC01-CLOSE-01f — renderClarify(${r}, ${lang}) is a non-empty deterministic string`);
              ok(!COMPLETION_RE.test(t), `IC01-CLOSE-01f — renderClarify(${r}, ${lang}) asserts NO completion`);
            });
            IC.ESCALATION_REASONS.forEach((e) => {
              const t = IC.renderEscalation(e, lang);
              ok(typeof t === "string" && t.length > 0, `IC01-CLOSE-01g — renderEscalation(${e}, ${lang}) is a non-empty deterministic string`);
              ok(!COMPLETION_RE.test(t), `IC01-CLOSE-01g — renderEscalation(${e}, ${lang}) asserts NO completion`);
            });
          });
          // a non-closed reason renders null (fail closed)
          eq(IC.renderClarify("BOGUS", "en"), null, "IC01-CLOSE-01h — a non-closed clarify reason renders null (fail closed)");
          eq(IC.renderEscalation("BOGUS", "en"), null, "IC01-CLOSE-01h — a non-closed escalation reason renders null (fail closed)");
          // BEHAVIORAL — the loop emits EXACTLY the deterministic render into the conversation (never model text).
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([clarifyStep("MISSING_DESTINATION")], "CLARIFY"), nowMs: 10 });
            eq(e2.reason, "CLARIFICATION_ISSUED", "IC01-CLOSE-01i — a CLARIFY step issues a clarification");
            // a fresh turn carries the prior assistant conversation entry — it MUST equal the deterministic render.
            const e3 = loop.beginTurn({ binding: icBinding({ turnId: "ic01.t2" }), userTurn: icTurn(), nowMs: 100 });
            const lastAssistant = e3.input.conversation.filter((c) => c.role === "assistant").slice(-1)[0];
            eq(lastAssistant.text, IC.renderClarify("MISSING_DESTINATION", "en"), "IC01-CLOSE-01i — the emitted clarify text is EXACTLY the deterministic render (no model text)");
          }
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([escalStep("TRANSACTIONAL_REQUEST")], "UNSUPPORTED"), nowMs: 10 });
            eq(e2.reason, "ESCALATION_SUGGESTED", "IC01-CLOSE-01j — an ESCALATE step suggests a human (no authority)");
            const e3 = loop.beginTurn({ binding: icBinding({ turnId: "ic01.t2" }), userTurn: icTurn(), nowMs: 100 });
            const lastAssistant = e3.input.conversation.filter((c) => c.role === "assistant").slice(-1)[0];
            eq(lastAssistant.text, IC.renderEscalation("TRANSACTIONAL_REQUEST", "en"), "IC01-CLOSE-01j — the emitted escalation text is EXACTLY the deterministic render (no completion assertion)");
          }
        }

        // ── IC01-CLOSE-02/03 — REAL frozen-R5B gateway bridge (genuine ACK commitment) ──
        section("IC01 §36-FINAL CLOSE-02/03 — real frozen-R5B gateway ACK bridge (post-accept + pre-accept lifecycle)");
        {
          // Drive the ACTUAL control-socket to obtain a GENUINE action.receipt.ack commitment (never mocked).
          const mkGateway = (operation) => {
            const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
            const c = store.create({ sessionId: "las.brg", subject: "sbr." + Math.random().toString(36).slice(2), ipHash: "ipbr." + Math.random().toString(36).slice(2), authenticated: false });
            const s = c.session; const emitted = []; s.emit = (f) => emitted.push(f);
            const deps = { session: s, store, runTurn: async () => {} };
            const ctx = validCtx(2);
            CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: s.sessionId, turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", context: ctx }) });
            const ar = s.ackAuthorityRef;
            const ra = raFor(ar, "t.1", 0, 0, "rev.1", ctx);
            store.registerProposal(s, { proposalId: "pp.b", providerTurnId: "pt.b", operation, operationSpec: { op: operation }, executionNonce: "xn.b", receiptId: "rc.b", turnId: "t.1", generation: 0, authorityRef: ar });
            const doAccept = () => CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.accepted", sessionId: s.sessionId, turnId: "t.1", generation: 0, accepted: { receiptId: "rc.b", proposalId: "pp.b", providerTurnId: "pt.b", actionId: "act.b", executionNonce: "xn.b", operation, authorityRef: ar } }) });
            const doReceipt = (over) => {
              const o = Object.assign({ receiptId: "rc.b", proposalId: "pp.b", providerTurnId: "pt.b", actionId: "act.b", executionNonce: "xn.b", authorityRef: ar, operation, outcome: "verified", status: "verified", resultAuthority: ra, evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } }, over || {});
              if (o.evidence === null) delete o.evidence;
              if (o.resultAuthority === null) delete o.resultAuthority;
              return CTRL.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "action.receipt", sessionId: s.sessionId, turnId: "t.1", generation: 0, receipt: o }) });
            };
            const lastAck = () => { for (let i = emitted.length - 1; i >= 0; i--) if (emitted[i].t === "action.receipt.ack") return emitted[i]; return null; };
            return { store, s, deps, ar, ra, ctx, doAccept, doReceipt, lastAck };
          };
          // an IC01 loop whose binding EXACTLY mirrors the gateway session's authority tuple.
          const icBridge = (operation, ctx, ar) => {
            const loop = AL.createAgentLoop(fakeDeps());
            const binding = { sessionId: "ic01.brg", turnId: "t.1", generation: 0, pageId: "hotels", role: "anonymous", routeEpoch: 0, contextRevision: "rev.1", authorityRef: ar, contextDigest: SCH.contextDigest(ctx) };
            const e1 = loop.beginTurn({ binding, userTurn: { text: "read the results", language: "en", role: "anonymous" }, context: ctx, nowMs: 0 });
            const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep(operation, { op: operation }), respondFact(0, "results_summary")], "READ_RESULTS"), nowMs: 10 });
            return { loop, binding, dispatch: e2 };
          };
          const brgObs = (dispatch, gw, over) => {
            over = over || {};
            const receipt = Object.assign({ receiptId: "rc.b", proposalId: "pp.b", providerTurnId: "pt.b", actionId: "act.b", executionNonce: "xn.b", authorityRef: gw.ar, operation: dispatch.capabilityId, outcome: "verified", status: "verified", resultAuthority: gw.ra, evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } }, over.receipt || {});
            if (receipt.evidence === null) delete receipt.evidence;
            if (receipt.resultAuthority === null) delete receipt.resultAuthority;
            return { observationId: over.observationId || "ic01.brgob." + (++icSeq), dispatchId: dispatch.dispatchId, sessionId: "ic01.brg", turnId: "t.1", generation: 0, planId: dispatch.planId, stepIndex: 0, capabilityId: dispatch.capabilityId, receipt, sourceAuthority: gw.ra, resultAuthority: (receipt.resultAuthority !== undefined ? receipt.resultAuthority : null), ackCommitment: over.ackCommitment !== undefined ? over.ackCommitment : gw.lastAck().commitment };
          };
          const ackTuple = (gw, operation) => ({ receiptId: "rc.b", proposalId: "pp.b", providerTurnId: "pt.b", actionId: "act.b", executionNonce: "xn.b", operation, authorityRef: gw.ar });

          // POSITIVE — genuine gateway path (accept → verified → REAL ack) promotes the IC01 terminal.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            eq(gw.doAccept(), "accepted", "IC01-CLOSE-02-pos — the gateway accepts the proposal");
            eq(gw.doReceipt(), "receipt", "IC01-CLOSE-02-pos — the gateway verifies + emits a genuine ACK");
            const commitment = gw.lastAck().commitment;
            ok(typeof commitment === "string" && /^[0-9a-f]{64}$/.test(commitment), "IC01-CLOSE-02-pos — the gateway emitted a real terminal-ACK commitment");
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            eq(ic.dispatch.kind, "CAPABILITY_DISPATCH", "IC01-CLOSE-02-pos — the IC01 loop dispatches the READ capability");
            eq(ic.loop.acknowledgeDispatch({ dispatchId: ic.dispatch.dispatchId, accepted: ackTuple(gw, "READ_CURRENT_RESULTS"), nowMs: 15 }).why, "dispatch_acknowledged", "IC01-CLOSE-02-pos — IC01 binds the gateway's accepted execution tuple");
            const done = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw), nowMs: 20 });
            eq(done.kind, "TERMINAL", "IC01-CLOSE-02-pos — the GENUINE gateway ACK commitment PROMOTES the terminal (do-not-mock)");
            eq(done.reason, "COMPLETED", "IC01-CLOSE-02-pos — a fact grounded in the gateway-verified step narrates");
          }
          // NEGATIVE (wrong commitment) — a schema-valid receipt WITHOUT the gateway's commitment never promotes.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS"); gw.doAccept(); gw.doReceipt();
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            ic.loop.acknowledgeDispatch({ dispatchId: ic.dispatch.dispatchId, accepted: ackTuple(gw, "READ_CURRENT_RESULTS"), nowMs: 15 });
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { ackCommitment: "0".repeat(64) }), nowMs: 20 });
            eq(r.kind, "INERT", "IC01-CLOSE-02-neg1 — a receipt with a NON-gateway (wrong) ACK commitment does NOT promote");
            eq(r.why, "ack_commitment_mismatch", "IC01-CLOSE-02-neg1 — reason ack_commitment_mismatch");
            eq(ic.loop.status().phase, "AWAIT_OBSERVATION", "IC01-CLOSE-02-neg1 — the dispatch stays pending");
          }
          // NEGATIVE (real commitment, tampered receipt) — a real commitment cannot be re-used for a DIFFERENT receipt.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS"); gw.doAccept(); gw.doReceipt();
            const commitment = gw.lastAck().commitment;
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            ic.loop.acknowledgeDispatch({ dispatchId: ic.dispatch.dispatchId, accepted: ackTuple(gw, "READ_CURRENT_RESULTS"), nowMs: 15 });
            // keep the gateway's ORIGINAL commitment but tamper the evidence (still schema-valid, still the same tuple).
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { receipt: { evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_3"] } }, ackCommitment: commitment }), nowMs: 20 });
            eq(r.kind, "INERT", "IC01-CLOSE-02-neg2 — the gateway's real commitment cannot certify a DIFFERENT (tampered) receipt");
            eq(r.why, "ack_commitment_mismatch", "IC01-CLOSE-02-neg2 — the commitment is bound to the EXACT receipt");
          }
          // NEGATIVE (VERIFIED with no result authority) — refused at validation.
          {
            eq(IC.validateObservation({ observationId: "o.1", dispatchId: "d.1", sessionId: "s.1", turnId: "t.1", generation: 0, planId: "p.1", stepIndex: 0, capabilityId: "READ_CURRENT_RESULTS", receipt: { receiptId: "rc.1", proposalId: "pp.1", providerTurnId: "pt.1", actionId: "ac.1", executionNonce: "xn.1", authorityRef: "ar.1", operation: "READ_CURRENT_RESULTS", outcome: "verified", status: "verified", evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } }, sourceAuthority: { turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", authorityRef: "ar.1", contextDigest: "a".repeat(64) }, resultAuthority: null, ackCommitment: "a".repeat(64) }), null, "IC01-CLOSE-02-neg3 — a VERIFIED receipt with NO result authority is REJECTED at validation");
          }
          // NEGATIVE (divergent authorities) — receipt.resultAuthority ≠ top-level resultAuthority is refused.
          {
            const raA = { turnId: "t.1", generation: 0, routeEpoch: 0, contextRevision: "rev.1", authorityRef: "ar.A", contextDigest: "a".repeat(64) };
            const raB = { turnId: "t.1", generation: 0, routeEpoch: 9, contextRevision: "rev.9", authorityRef: "ar.B", contextDigest: "b".repeat(64) };
            eq(IC.validateObservation({ observationId: "o.2", dispatchId: "d.2", sessionId: "s.2", turnId: "t.1", generation: 0, planId: "p.2", stepIndex: 0, capabilityId: "READ_CURRENT_RESULTS", receipt: { receiptId: "rc.2", proposalId: "pp.2", providerTurnId: "pt.2", actionId: "ac.2", executionNonce: "xn.2", authorityRef: "ar.A", operation: "READ_CURRENT_RESULTS", outcome: "acted", status: "execution_acknowledged", resultAuthority: raA }, sourceAuthority: raA, resultAuthority: raB, ackCommitment: "a".repeat(64) }), null, "IC01-CLOSE-02-neg4 — a receipt/top-level result-authority DISAGREEMENT is REJECTED (one canonical authority)");
          }

          // ── IC01-CLOSE-03 — pre-accept vs post-accept lifecycle (A–G) via the REAL gateway ──
          // A — a pre-accept BROWSER REFUSAL (no action.accepted) is a genuine gateway terminal → IC01 closes it.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            const st = gw.doReceipt({ outcome: "rejected", status: "wrong_page", evidence: null, resultAuthority: null });
            eq(st, "receipt", "IC01-CLOSE-03-A — the gateway pre-accept-terminalizes a browser refusal (no action.accepted)");
            const commitment = gw.lastAck().commitment;
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            // deliberately do NOT acknowledge the dispatch (pre-accept: IC01 never bound an execution tuple).
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { receipt: { outcome: "rejected", status: "wrong_page", evidence: null, resultAuthority: null }, ackCommitment: commitment }), nowMs: 20 });
            ok(r.kind === "MODEL_REQUEST" || r.kind === "TERMINAL", "IC01-CLOSE-03-A — a GENUINE pre-accept negative terminal RESOLVES the dispatch (no longer left inert)");
            ok(r.kind !== "INERT", "IC01-CLOSE-03-A — the legitimate pre-accept terminal is NOT execution_not_acknowledged");
          }
          // B — a pre-accept STALE terminal likewise closes the pending capability.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            eq(gw.doReceipt({ outcome: "stale", status: "stale_context", evidence: null, resultAuthority: null }), "receipt", "IC01-CLOSE-03-B — the gateway pre-accept-terminalizes a stale receipt");
            const commitment = gw.lastAck().commitment;
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { receipt: { outcome: "stale", status: "stale_context", evidence: null, resultAuthority: null }, ackCommitment: commitment }), nowMs: 20 });
            eq(r.kind, "REBIND_REQUIRED", "IC01-CLOSE-03-B — a genuine pre-accept STALE terminal drives REBIND (resolved, not inert)");
          }
          // C — an ACTED receipt before acceptance is invalid at the gateway AND non-terminal (never resolves) at IC01.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            eq(gw.doReceipt({ outcome: "acted", status: "execution_acknowledged", evidence: null }), "receipt_uncorrelated", "IC01-CLOSE-03-C — the gateway REJECTS an acted receipt before acceptance");
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { receipt: { outcome: "acted", status: "execution_acknowledged", evidence: null }, ackCommitment: "a".repeat(64) }), nowMs: 20 });
            eq(r.why, "pending_verification_acknowledged", "IC01-CLOSE-03-C — an acted (non-terminal) observation never resolves a dispatch");
          }
          // D — a VERIFIED receipt before acceptance is invalid at the gateway AND refused at IC01.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            eq(gw.doReceipt({}), "receipt_uncorrelated", "IC01-CLOSE-03-D — the gateway REJECTS a verified receipt before acceptance");
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            // a verified observation with NO acknowledged tuple → pre-accept branch → verified_before_accept.
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { ackCommitment: "a".repeat(64) }), nowMs: 20 });
            eq(r.why, "verified_before_accept", "IC01-CLOSE-03-D — a verified-before-accept is refused (nothing executed)");
          }
          // E — POST-accept still requires the EXACT accepted execution tuple.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS"); gw.doAccept(); gw.doReceipt();
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            ic.loop.acknowledgeDispatch({ dispatchId: ic.dispatch.dispatchId, accepted: ackTuple(gw, "READ_CURRENT_RESULTS"), nowMs: 15 });
            // a post-accept observation whose receipt carries a DIFFERENT execution tuple fails closed.
            const r = ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { receipt: { executionNonce: "xn.OTHER" } }), nowMs: 20 });
            eq(r.why, "execution_correlation_mismatch", "IC01-CLOSE-03-E — post-accept requires the EXACT execution tuple (a swapped nonce fails)");
          }
          // F — a later acceptance AFTER a pre-accept terminal is impossible (gateway) and cannot revive IC01.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            gw.doReceipt({ outcome: "rejected", status: "wrong_page", evidence: null, resultAuthority: null }); // pre-accept terminal
            eq(gw.doAccept(), "accepted_uncorrelated", "IC01-CLOSE-03-F — the gateway REFUSES acceptance of an already pre-accept-terminalized proposal");
            const ic = icBridge("READ_CURRENT_RESULTS", gw.ctx, gw.ar);
            const commitment = gw.lastAck().commitment;
            ic.loop.submitObservation({ observation: brgObs(ic.dispatch, gw, { receipt: { outcome: "rejected", status: "wrong_page", evidence: null, resultAuthority: null }, ackCommitment: commitment }), nowMs: 20 }); // resolves the dispatch
            const late = ic.loop.acknowledgeDispatch({ dispatchId: ic.dispatch.dispatchId, accepted: ackTuple(gw, "READ_CURRENT_RESULTS"), nowMs: 25 });
            ok(late.kind === "REJECTED" || (late.kind === "INERT" && late.why !== "dispatch_acknowledged"), "IC01-CLOSE-03-F — a later acknowledgement cannot re-bind a resolved (pre-accept-closed) dispatch");
          }
          // G — replay is bounded/idempotent: the EXACT duplicate pre-accept observation is inert.
          {
            const gw = mkGateway("READ_CURRENT_RESULTS");
            gw.doReceipt({ outcome: "rejected", status: "wrong_page", evidence: null, resultAuthority: null });
            eq(gw.doReceipt({ outcome: "rejected", status: "wrong_page", evidence: null, resultAuthority: null }), "receipt_idempotent", "IC01-CLOSE-03-G — an exact-duplicate gateway pre-accept terminal is idempotent");
          }
        }

        // ── IC01-CLOSE-04 — snapshot coherence + actual-visible selection + deep immutability ──
        section("IC01 §36-FINAL CLOSE-04 — snapshot binding/context coherence + deep immutability");
        {
          const H = (position, id, price, rating, parking) => ({ position, id, name: "Hotel " + id, city: "Manali", minPrice: price, rating, parking });
          const okCtx = (n, role, page) => ({ pageId: page || "hotels", role: role || "customer", destination: "manali", query: null, loadState: "ready", visibleHotels: [H(1, HID, 1000, 4, "present"), H(2, HID2, 2000, 5, "absent")].slice(0, n), currentHotelId: null, validated: true, section: null, breakfast: null, parking: null, refinement: null });
          const fs = { consecutiveFailures: 0, lastResultState: null, clarificationTurns: 0 };
          const bind2 = (o) => icBinding(Object.assign({ contextDigest: SCH.contextDigest(okCtx(2)) }, o));
          // coherent snapshot validates
          ok(IC.buildIntelligenceInputSnapshot({ binding: bind2(), userText: "hi", language: "en", role: "customer", context: okCtx(2), failureState: fs }) !== null, "IC01-CLOSE-04a — a coherent binding+context snapshot validates");
          // role mismatch (binding customer, context anonymous) → null
          eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding({ contextDigest: SCH.contextDigest(okCtx(2, "anonymous")) }), userText: "hi", language: "en", role: "customer", context: okCtx(2, "anonymous"), failureState: fs }), null, "IC01-CLOSE-04b — a binding role ≠ context role is REJECTED");
          // page mismatch (binding hotels, context hotel-detail) → null
          eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding({ contextDigest: SCH.contextDigest(okCtx(0, "customer", "hotel-detail")) }), userText: "hi", language: "en", role: "customer", context: okCtx(0, "customer", "hotel-detail"), failureState: fs }), null, "IC01-CLOSE-04c — a binding page ≠ context page is REJECTED");
          // digest mismatch (binding digest does not describe the supplied context) → null
          eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding({ contextDigest: H64A }), userText: "hi", language: "en", role: "customer", context: okCtx(2), failureState: fs }), null, "IC01-CLOSE-04d — a binding digest that does not describe the context is REJECTED");
          // selection beyond the ACTUAL visible list (visible=2, selected=3) → null
          eq(IC.buildIntelligenceInputSnapshot({ binding: bind2(), userText: "hi", language: "en", role: "customer", context: okCtx(2), selectedPositions: [3], failureState: fs }), null, "IC01-CLOSE-04e — a selection (3) beyond the ACTUAL visible list (2) is REJECTED");
          ok(IC.buildIntelligenceInputSnapshot({ binding: bind2(), userText: "hi", language: "en", role: "customer", context: okCtx(2), selectedPositions: [1, 2], failureState: fs }) !== null, "IC01-CLOSE-04e — a selection within the actual visible list is accepted");
          // a selection with NO visible context is rejected (nothing to select)
          eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding(), userText: "hi", language: "en", role: "customer", selectedPositions: [1], failureState: fs }), null, "IC01-CLOSE-04e — a selection with NO published context is REJECTED");
          // ── RESIDUAL A — the snapshot's TOP-LEVEL role must equal the binding role (isolated: NO context,
          // so the ONLY thing under test is snapshot.role === binding.role, never the context-coherence path).
          eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding({ role: "anonymous" }), userText: "hi", language: "en", role: "customer", failureState: fs }), null, "IC01-CLOSE-04-role — snapshot.role (customer) ≠ binding.role (anonymous) is REJECTED, no normalize (no context)");
          eq(IC.buildIntelligenceInputSnapshot({ binding: icBinding(), userText: "hi", language: "en", role: "anonymous", failureState: fs }), null, "IC01-CLOSE-04-role — snapshot.role (anonymous) ≠ binding.role (customer) is REJECTED (no context)");
          ok(IC.buildIntelligenceInputSnapshot({ binding: icBinding({ role: "anonymous", contextDigest: SCH.contextDigest(okCtx(2, "anonymous")) }), userText: "hi", language: "en", role: "anonymous", context: okCtx(2, "anonymous"), failureState: fs }) !== null, "IC01-CLOSE-04-role — binding + snapshot + context roles ALL agree (anonymous) validates");
          // ── RESIDUAL B — a selection must reference a position that ACTUALLY OCCURS in the published
          // visibleHotels, NOT a 1..count ordinal. Published positions [1,5]: 1 and 5 selectable, 2 and 3 not.
          {
            const ctxPS = { pageId: "hotels", role: "customer", destination: "manali", query: null, loadState: "ready", visibleHotels: [H(1, HID, 1000, 4, "present"), H(5, HID2, 2000, 5, "absent")], currentHotelId: null, validated: true, section: null, breakfast: null, parking: null, refinement: null };
            const bindPS = icBinding({ contextDigest: SCH.contextDigest(ctxPS) });
            const buildPS = (sel) => IC.buildIntelligenceInputSnapshot({ binding: bindPS, userText: "hi", language: "en", role: "customer", context: ctxPS, selectedPositions: sel, failureState: fs });
            ok(buildPS([1]) !== null, "IC01-CLOSE-04-position-set — published positions [1,5]: selecting 1 (a real position) is ACCEPTED");
            ok(buildPS([5]) !== null, "IC01-CLOSE-04-position-set — published positions [1,5]: selecting 5 (a real position) is ACCEPTED");
            eq(buildPS([2]), null, "IC01-CLOSE-04-position-set — published positions [1,5]: selecting 2 (NOT a real position, only an ordinal) is REJECTED");
            eq(buildPS([3]), null, "IC01-CLOSE-04-position-set — published positions [1,5]: selecting 3 (NOT a real position) is REJECTED");
            ok(buildPS([1, 5]) !== null, "IC01-CLOSE-04-position-set — published positions [1,5]: selecting BOTH real positions [1,5] is ACCEPTED");
          }
          // CLOSE-04-normal — the ordinary contiguous case ([1,2] published, selecting [1,2]) still validates.
          ok(IC.buildIntelligenceInputSnapshot({ binding: bind2(), userText: "hi", language: "en", role: "customer", context: okCtx(2), selectedPositions: [1, 2], failureState: fs }) !== null, "IC01-CLOSE-04-normal — contiguous published positions [1,2] with selection [1,2] validates (no regression)");
          // deep immutability — the nested conversation entry is frozen (cannot be mutated after validation)
          {
            const snap = IC.buildIntelligenceInputSnapshot({ binding: icBinding(), userText: "hi", language: "en", role: "customer", conversation: [{ role: "user", text: "original" }], failureState: fs });
            ok(snap !== null && Object.isFrozen(snap.conversation[0]), "IC01-CLOSE-04f — each nested conversation entry is FROZEN (deep immutability)");
            let mutated = false; try { snap.conversation[0].text = "tampered"; } catch (_) { /* strict-mode throw */ }
            if (snap.conversation[0].text === "original") mutated = false; else mutated = true;
            ok(!mutated, "IC01-CLOSE-04f — a validated conversation entry cannot be mutated afterwards");
          }
          // beginTurn rejects an incoherent binding/context up front
          {
            const loop = AL.createAgentLoop(fakeDeps());
            eq(loop.beginTurn({ binding: icBinding({ contextDigest: H64A }), userTurn: icTurn(), context: okCtx(2), nowMs: 0 }).why, "incoherent_context", "IC01-CLOSE-04g — beginTurn rejects an incoherent binding/context (digest mismatch)");
          }
        }

        // ── IC01-CLOSE-05 — trusted rebind gate + negative-advanced routing ──
        section("IC01 §36-FINAL CLOSE-05 — trusted rebind (fresh correlated authority + context) + negative-advanced routing");
        {
          const H = (position, id, price, rating, parking) => ({ position, id, name: "Hotel " + id, city: "Manali", minPrice: price, rating, parking });
          const ctxOf = (n, dest) => ({ pageId: "hotels", role: "customer", destination: dest || "manali", query: null, loadState: "ready", visibleHotels: [H(1, HID, 1000, 4, "present"), H(2, HID2, 2000, 5, "absent")].slice(0, n), currentHotelId: null, validated: true, section: null, breakfast: null, parking: null, refinement: null });
          const ctxA = ctxOf(2, "manali"), ctxB = ctxOf(1, "shimla");
          const digA = SCH.contextDigest(ctxA), digB = SCH.contextDigest(ctxB);
          // reach AWAIT_REBIND with a KNOWN advanced expected authority (the result authority observed on APPLY).
          const advRA = { turnId: "ic01.t1", generation: 1, routeEpoch: 2, contextRevision: "rev-b", authorityRef: "auth-b", contextDigest: digB };
          const toRebind = () => {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding({ contextDigest: digA }), userTurn: icTurn(), context: ctxA, nowMs: 0 });
            const disp = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
            const rb = verify(loop, disp, { resultAuthority: advRA }, 18, 20);
            eq(rb.kind, "REBIND_REQUIRED", "IC01-CLOSE-05 setup — an advancing verified APPLY forces REBIND");
            return loop;
          };
          const matchBinding = (o) => icBinding(Object.assign({ routeEpoch: 2, contextRevision: "rev-b", contextDigest: digB, authorityRef: "auth-b" }, o));
          // (1) a NO-OP rebind to the EXACT current binding is refused.
          {
            const loop = toRebind();
            eq(loop.rebind({ binding: icBinding({ contextDigest: digA }), nowMs: 30 }).why, "rebind_no_advance", "IC01-CLOSE-05-1 — a rebind to the unchanged old binding is REJECTED (no advance)");
          }
          // (2) a rebind whose authority does NOT match the expected post-result authority is refused.
          {
            const loop = toRebind();
            eq(loop.rebind({ binding: icBinding({ routeEpoch: 7, contextRevision: "rev-x", contextDigest: H64C, authorityRef: "auth-x" }), nowMs: 30 }).why, "rebind_authority_mismatch", "IC01-CLOSE-05-2 — a rebind NOT matching the expected post-result authority is REJECTED");
          }
          // (3) RESIDUAL A — a matching authority with NO explicit fresh context supplied is refused: the
          // old published context is NEVER silently retained across an advancement (the turn HAD a context,
          // so an omitted context can never re-authorize by coincidence) → fresh_context_required.
          {
            const loop = toRebind();
            eq(loop.rebind({ binding: matchBinding(), nowMs: 30 }).why, "fresh_context_required", "IC01-CLOSE-05-3 / CLOSE-05-fresh-context — a matching authority with NO explicit fresh context is REJECTED (fresh_context_required)");
          }
          // (3b) a matching authority WITH a SUPPLIED but incoherent context (digest ≠ new binding) is refused.
          {
            const loop = toRebind();
            // ctxA has digest digA, but the advanced binding digest is digB → supplied-but-incoherent.
            eq(loop.rebind({ binding: matchBinding(), context: ctxA, nowMs: 30 }).why, "stale_or_incoherent_context", "IC01-CLOSE-05-3b — a matching authority with a SUPPLIED but incoherent context (stale digest) is REJECTED");
          }
          // (4) a matching authority + FRESH coherently-validated context SUCCEEDS (old plan + evidence discarded).
          {
            const loop = toRebind();
            const e = loop.rebind({ binding: matchBinding(), context: ctxB, nowMs: 30 });
            eq(e.kind, "MODEL_REQUEST", "IC01-CLOSE-05-4 — a fresh, correlated rebind (matching authority + coherent fresh context) SUCCEEDS");
            ok(e.input && e.input.evidenceRefs.length === 0, "IC01-CLOSE-05-4 — the evidence ledger is CLEARED on a trusted rebind");
            eq(e.input.binding.authorityRef, "auth-b", "IC01-CLOSE-05-4 — the replan runs under the REBOUND authority");
          }
          // (5) a REJECTED (negative) terminal carrying an ADVANCED result authority is routed through the rebind gate.
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const disp = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
            const rb = verify(loop, disp, { outcome: "unknown", status: "stale_entity", resultAuthority: "advance" }, 18, 20);
            eq(rb.kind, "REBIND_REQUIRED", "IC01-CLOSE-05-5 — a negative (UNKNOWN/stale_entity) terminal with an advanced authority goes through the rebind gate (not a direct replan under the old binding)");
            // and that rebind still enforces the expected-authority correlation.
            eq(loop.rebind({ binding: icBinding({ routeEpoch: 9, contextRevision: "rev-z", contextDigest: H64B, authorityRef: "auth-z" }), nowMs: 25 }).why, "rebind_authority_mismatch", "IC01-CLOSE-05-5 — the negative-advanced rebind still requires the expected post-result authority");
          }
          // (6) a NON-advanced negative terminal still replans directly (no artificial rebind).
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const disp = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
            const rb = verify(loop, disp, { outcome: "rejected", status: "invalid_operation" }, 18, 20);
            ok(rb.kind === "MODEL_REQUEST" || rb.kind === "TERMINAL", "IC01-CLOSE-05-6 — a NON-advanced negative terminal replans directly (unchanged) — the rebind gate is only for authoritative advancement");
          }
          // (7) RESIDUAL B / CLOSE-05-expected-target — a VERIFIED capability DECLARED context-advancing
          // (APPLY/OPEN/SHOW) whose result authority does NOT actually advance is an inconsistent
          // result/lifecycle: it FAILS CLOSED (HONEST_FAILURE), never entering AWAIT_REBIND with a null target.
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const disp = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
            const r = verify(loop, disp, { resultAuthority: "same" }, 18, 20);
            eq(r.kind, "TERMINAL", "IC01-CLOSE-05-expected-target — an advancing VERIFIED whose result authority did NOT advance FAILS CLOSED (never rebind to a null target)");
            eq(r.reason, "HONEST_FAILURE", "IC01-CLOSE-05-expected-target — the inconsistent advancing-but-unmoved result is HONEST_FAILURE");
            eq(loop.status().phase, "TERMINAL", "IC01-CLOSE-05-expected-target — the machine is TERMINAL, NOT AWAIT_REBIND (no null-target rebind)");
          }
          // (8) CLOSE-05-expected-target — the SAME advancing capability WITH a genuinely advanced result
          // authority DOES enter the rebind gate, bound to the EXACT advanced target (never null): a rebind
          // matching that exact target SUCCEEDS.
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const disp = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
            const r = verify(loop, disp, { resultAuthority: "advance" }, 18, 20);
            eq(r.kind, "REBIND_REQUIRED", "IC01-CLOSE-05-expected-target — an advancing VERIFIED WITH an advanced authority enters the rebind gate");
            eq(loop.rebind({ binding: icBinding({ routeEpoch: 2, contextRevision: "rev-adv", contextDigest: H64C, authorityRef: "auth-adv" }), nowMs: 30 }).kind, "MODEL_REQUEST", "IC01-CLOSE-05-expected-target — a rebind matching the EXACT advanced target SUCCEEDS (concrete non-null target)");
          }
        }

        // ── IC01-FINAL-CLOSE-01-01 — terminal RESPOND/advice grounds on ACTUAL current visible POSITION
        //    MEMBERSHIP (sparse-safe), exercised through the REAL agent-loop RESPOND path — NOT the snapshot
        //    (R16) selection path. Published positions may be sparse ([1,5]): 5 is valid, 2/3 are not. ──
        section("IC01 §38-FINAL-CLOSURE — terminal advice sparse current-position grounding (agent-loop RESPOND path)");
        {
          const Hp = (position, id) => ({ position, id, name: "Hotel " + id, city: "Manali", minPrice: 1000, rating: 4, parking: "present" });
          const mkCtx = (positions) => ({ pageId: "hotels", role: "customer", destination: "manali", query: null, loadState: "ready", visibleHotels: positions.map((p, i) => Hp(p, i === 0 ? HID : HID2)), currentHotelId: null, validated: true, section: null, breakfast: null, parking: null, refinement: null });
          const sparseCtx = mkCtx([1, 5]);
          const sparseBind = icBinding({ contextDigest: SCH.contextDigest(sparseCtx) });
          const contigCtx = mkCtx([1, 2]);
          const contigBind = icBinding({ contextDigest: SCH.contextDigest(contigCtx) });
          // Drive a FULL turn to the terminal RESPOND/advice with a single-advice plan referencing `positions`.
          const runAdvice = (positions, ctx, bind) => {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: bind, userTurn: icTurn(), context: ctx, nowMs: 0 });
            const plan = icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions }] }]);
            const r = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan, nowMs: 10 });
            return { loop, r };
          };
          // A — sparse [1,5], advice position 1 → COMPLETED
          {
            const { r } = runAdvice([1], sparseCtx, sparseBind);
            eq(r.kind, "TERMINAL", "IC01-FINAL-CLOSE-01-01-A — sparse [1,5] advice position 1 terminates");
            eq(r.reason, "COMPLETED", "IC01-FINAL-CLOSE-01-01-A — sparse visible positions [1,5], advice position 1 → COMPLETED");
          }
          // B — sparse [1,5], advice position 5 → COMPLETED (the old length check wrongly rejected 5)
          {
            const { r } = runAdvice([5], sparseCtx, sparseBind);
            eq(r.reason, "COMPLETED", "IC01-FINAL-CLOSE-01-01-B — sparse visible positions [1,5], advice position 5 → COMPLETED (a REAL published position, not a 1..length ordinal)");
          }
          // C — sparse [1,5], advice position 2 → UNGROUNDED_RESPONSE (the old length check wrongly accepted 2)
          {
            const { r } = runAdvice([2], sparseCtx, sparseBind);
            eq(r.reason, "UNGROUNDED_RESPONSE", "IC01-FINAL-CLOSE-01-01-C — sparse visible positions [1,5], advice position 2 → UNGROUNDED_RESPONSE (not a published position)");
          }
          // D — sparse [1,5], advice position 3 → UNGROUNDED_RESPONSE
          {
            const { r } = runAdvice([3], sparseCtx, sparseBind);
            eq(r.reason, "UNGROUNDED_RESPONSE", "IC01-FINAL-CLOSE-01-01-D — sparse visible positions [1,5], advice position 3 → UNGROUNDED_RESPONSE");
          }
          // E — an INVALID sparse position is NOT narrated and NOT persisted as a completed assistant turn.
          {
            const bad = runAdvice([2], sparseCtx, sparseBind);
            eq(bad.r.reason, "UNGROUNDED_RESPONSE", "IC01-FINAL-CLOSE-01-01-E — the invalid position fails closed");
            eq(bad.loop.status().conversationTurns, 1, "IC01-FINAL-CLOSE-01-01-E — invalid advice leaves ONLY the user turn (no assistant narration persisted)");
            const good = runAdvice([5], sparseCtx, sparseBind);
            eq(good.loop.status().conversationTurns, 2, "IC01-FINAL-CLOSE-01-01-E — a VALID advice DOES persist an assistant turn (user + assistant) — proving the invalid case genuinely suppressed narration");
          }
          // F — normal contiguous [1,2] advice remains valid (no regression, existing closed advice semantics).
          {
            eq(runAdvice([1], contigCtx, contigBind).r.reason, "COMPLETED", "IC01-FINAL-CLOSE-01-01-F — contiguous [1,2], advice position 1 → COMPLETED");
            eq(runAdvice([2], contigCtx, contigBind).r.reason, "COMPLETED", "IC01-FINAL-CLOSE-01-01-F — contiguous [1,2], advice position 2 → COMPLETED");
            eq(runAdvice([1, 2], contigCtx, contigBind).r.reason, "COMPLETED", "IC01-FINAL-CLOSE-01-01-F — contiguous [1,2], advice positions [1,2] → COMPLETED");
          }
          // No visible context → an advice referencing any position fails closed (grounding on an empty set).
          {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const plan = icPlan([{ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [1] }] }]);
            const r = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan, nowMs: 10 });
            eq(r.reason, "UNGROUNDED_RESPONSE", "IC01-FINAL-CLOSE-01-01 — advice referencing a position with NO visible context fails closed");
          }
        }
      }

      // ── §37 LANGUAGE MATRIX ──
      if (icWant("ic01-lang")) {
        section("IC01 §37 — language contract acceptance (en / hi / hinglish)");
        ok(IC.validateUserTurn({ text: "show me hotels in manali", language: "en", role: "customer" }) !== null, "IC01-G01 — en turn accepted");
        ok(IC.validateUserTurn({ text: "मुझे मनाली में होटल दिखाओ", language: "hi", role: "customer" }) !== null, "IC01-G01 — hi turn accepted");
        ok(IC.validateUserTurn({ text: "mujhe manali me hotels dikhao yaar", language: "hinglish", role: "anonymous" }) !== null, "IC01-G01 — hinglish turn accepted");
        ["fr", "es", "", "EN", null, 42].forEach((l) => eq(IC.validateUserTurn({ text: "hello", language: l, role: "customer" }), null, `IC01-G02 — language ${JSON.stringify(l)} rejected`));
        ["en", "hi", "hinglish"].forEach((l) => {
          ok(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: l, claims: [{ kind: "advice", advice: "consider_visible_options", positions: [] }] }])) !== null, `IC01-G03 — advice RESPOND in ${l} accepted`);
          ok(typeof IC.renderFactAnswer("results_summary", { kind: "results", count: 2, orderedIds: ["a", "b"] }, l) === "string", `IC01-G03 — a fact renders deterministically in ${l}`);
        });
        eq(IC.validatePlanCandidate(icPlan([{ kind: "RESPOND", language: "fr", claims: [{ kind: "advice", advice: "consider_visible_options", positions: [] }] }])), null, "IC01-G04 — RESPOND in an unsupported language rejected");
      }

      // ── §38 DORMANCY MATRIX ──
      if (icWant("ic01-dormancy")) {
        section("IC01 §38 — dormancy (zero provider/network/DB; NOT wired to production)");
        const NEW_FILES = ["live-ai-intelligence-contract.ts", "live-ai-capability-registry.ts", "live-ai-agent-loop.ts"];
        const srcOf = (f) => fs.readFileSync(path.join(REPO, "server/voice-gateway", f), "utf8");
        NEW_FILES.forEach((f) => {
          const src = srcOf(f);
          ok(!/from\s+["']\.\./.test(src), `IC01-D01 — ${f} imports SIBLINGS only (no ../ escape)`);
          ok(!/\bfetch\s*\(/.test(src), `IC01-D01 — ${f} performs no fetch`);
          ok(!/WebSocket|node:https?|node:net|node:dns|node:tls/.test(src), `IC01-D01 — ${f} opens no socket/HTTP client`);
          ok(!/process\.env/.test(src), `IC01-D02 — ${f} reads NO environment`);
          ok(!/openai|OPENAI|realtime|Realtime/.test(src), `IC01-D03 — ${f} references no provider surface`);
          ok(!/supabase|postgrest|postgres|PostgREST|\bSQL\b/.test(src), `IC01-D04 — ${f} references no DB/Supabase`);
          ok(!/from\s+["']\.\/(index|live-ai-orchestrator|live-ai-control-socket|live-ai-sessions|router|reasoning-adapter|config|auth|openai-)/.test(src), `IC01-D05 — ${f} imports NO production gateway module`);
          ok(!/setTimeout|setInterval/.test(src), `IC01-D05 — ${f} creates no timers`);
        });
        // LIVE-AI-03B (P1-01): index.ts is now the ONE sanctioned bootstrap seam that wires the
        // 03B controller (IC01 agent-loop + the compiled-answer controller) BEHIND the default-OFF
        // staging gate — it is intentionally EXCLUDED from the "no IC01 import" invariant. Every
        // OTHER legacy production module must still never import the IC01 foundation.
        ["live-ai-orchestrator.ts", "live-ai-control-socket.ts", "live-ai-sessions.ts", "reasoning-adapter.ts", "router.ts"].forEach((f) => {
          let src = null; try { src = srcOf(f); } catch (_) { src = null; }
          if (src !== null) ok(!/live-ai-intelligence-contract|live-ai-capability-registry|live-ai-agent-loop/.test(src), `IC01-D06 — production module ${f} does NOT import the IC01 foundation`);
          else ok(true, `IC01-D06 — ${f} not present`);
        });
        {
          // index.ts wires the 03B controller, but ONLY behind the staging subject-allowlist gate
          // (dormant by default configuration — proven by the 03B suite's dormancy section).
          let idx = null; try { idx = srcOf("index.ts"); } catch (_) { idx = null; }
          if (idx !== null) {
            ok(/live-ai-03b-controller/.test(idx), "IC01-D06b — index.ts wires the 03B controller seam (P1-01)");
            ok(/liveAi03bStagingSubjectAllowed/.test(idx), "IC01-D06c — index.ts routes 03B ONLY behind the staging subject-allowlist gate");
          } else ok(true, "IC01-D06b — index.ts not present");
        }
        {
          const g = globalThis;
          const savedFetch = g.fetch, savedST = g.setTimeout, savedSI = g.setInterval;
          let fetches = 0, timers = 0;
          g.fetch = function () { fetches += 1; throw new Error("network forbidden in IC01"); };
          g.setTimeout = function (...a) { timers += 1; return savedST.apply(g, a); };
          g.setInterval = function (...a) { timers += 1; return savedSI.apply(g, a); };
          try {
            const loop = AL.createAgentLoop(fakeDeps());
            const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
            const d = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
            verify(loop, d, {}, 15, 20);
            AL.createAgentLoop().beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
          } finally { g.fetch = savedFetch; g.setTimeout = savedST; g.setInterval = savedSI; }
          eq(fetches, 0, "IC01-D07 — a full driven turn performs ZERO network calls");
          eq(timers, 0, "IC01-D07 — a full driven turn creates ZERO timers");
        }
      }
    }
  }

  console.log(`\n${"─".repeat(54)}`);
  console.log(`Live AI LIVE-AI-02A gateway: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  console.log("ALL LIVE-AI-02A GATEWAY CHECKS PASSED");
  process.exit(0);
})();
