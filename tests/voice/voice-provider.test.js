#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — provider / WebRTC / gateway-client suite.
//
//   Run:  node tests/voice/voice-provider.test.js
//
// Compiles lib/voice/*.ts (SB-01 + SB-02 + SB-04) with the LOCAL tsc and drives:
// the provider abstraction (null provider fails closed), the native WebRTC client
// (fakes — a data-channel provider event can NEVER execute an action; transcript
// display is bounded; lifecycle teardown), the browser gateway control client
// (fake fetch + fake WebSocket — token rides the SUBPROTOCOL not a query string;
// oversized/malformed inbound frames are dropped), the browser↔gateway control
// contracts, and the gateway turn router's stale/cancel ownership. NO provider,
// NO device, NO network.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "prov");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "voice"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/voice"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/voice", f), path.join(SRC, "voice", f));
}
fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
      moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
      types: ["node"], lib: ["es2020", "dom"], noEmitOnError: true,
    },
    include: ["voice/**/*.ts"],
  }),
);
const TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) {
  console.error("COMPILE GATE FAILED:", compile.stdout, compile.stderr);
  process.exit(2);
}
console.log("• Local tsc compile (SB-01 + SB-02 + SB-04): exit 0, clean");
const V = require(path.join(OUT, "voice", "index.js"));
// The native WebRTC media client is imported directly (kept off the barrel).
const WEBRTC = require(path.join(OUT, "voice", "openai-webrtc.js"));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(label); console.error("  ✗ " + label); }
}
function section(name) { console.log("\n• " + name); }
const tick = () => new Promise((r) => setImmediate(r));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

// ── provider abstraction ─────────────────────────────────────────────────────
section("Provider abstraction (null provider fails closed)");
{
  ok(V.nullVoiceProvider.isAvailable() === false, "nullVoiceProvider is never available");
  ok(V.nullVoiceProvider.id === "null", "nullVoiceProvider has a stable id");
}

// ── session-broker pure helpers ──────────────────────────────────────────────
section("Broker helpers (origin / sdp / subject / gateway url resolution)");
{
  ok(V.isBrokerConfigured({}) === false, "unconfigured broker fails closed");
  ok(V.isBrokerConfigured({ VOICE_AI_GATEWAY_URL: "https://g", VOICE_AI_SESSION_SIGNING_PRIVATE_KEY: "k", VOICE_AI_SESSION_ISSUER: "i", VOICE_AI_SESSION_AUDIENCE: "a" }) === true, "fully configured broker ok");
  ok(V.isAllowedOrigin("https://staybids.in", ["https://staybids.in"]) === true, "exact origin allowed");
  ok(V.isAllowedOrigin("https://evil", ["https://staybids.in"]) === false, "foreign origin rejected");
  ok(V.isAllowedOrigin("https://staybids.in", []) === false, "empty allowlist rejects all");
  ok(V.validateSdpOffer("v=0\r\nm=audio 9\r\n") !== null, "valid SDP offer accepted");
  ok(V.validateSdpOffer("hello") === null, "non-SDP rejected");
  ok(V.validateSdpOffer("v=0\r\n" + "a".repeat(20000)) === null, "oversized SDP rejected");
  ok(V.resolveGatewaySessionsUrl({ VOICE_AI_GATEWAY_URL: "https://gw.example" }) === "https://gw.example/v1/voice/sessions", "sessions URL derived from fixed config");
  ok(V.resolveGatewaySessionsUrl({ VOICE_AI_GATEWAY_URL: "http://gw" }) === null, "non-https gateway URL rejected");
  ok(V.resolveGatewayWsBase({ VOICE_AI_GATEWAY_URL: "https://gw.example" }) === "wss://gw.example", "wss base derived from https gateway");
  const subj = V.derivePseudonymousSubject("nonce-1", (s) => require("node:crypto").createHash("sha256").update(s).digest("hex"));
  ok(/^vsub_[0-9a-f]{40}$/.test(subj), "pseudonymous subject is a hashed, non-PII id");
  ok(!subj.includes("nonce-1"), "subject does not embed the raw seed");
}

// ── assertion claims contract ────────────────────────────────────────────────
section("Assertion claims (read-only scope, ~60s expiry, no PII)");
{
  const claims = V.buildAssertionClaims({ subject: "vsub_1", issuer: "iss", audience: "aud", nowSec: 1000, jti: "j1", authenticated: false, origin: "https://staybids.in" });
  ok(claims.scope === "voice:read", "scope is read-only");
  ok(claims.exp - claims.iat === 60, "expiry is ~60 seconds");
  ok(claims.sub === "vsub_1" && claims.jti === "j1", "subject + jti carried");
  const keys = Object.keys(claims).sort().join(",");
  ok(keys === "aud,auth,exp,iat,iss,jti,origin,scope,sub", "claims carry only bounded fields (origin included), NO email/phone/token");
}

// ── bounded gateway response shaping ─────────────────────────────────────────
section("Broker response shaping (bounded; fail closed)");
{
  const good = V.shapeBrokerResponse({ sessionId: "vses_1", answerSdp: "v=0\r\nm=audio 9\r\n", controlToken: "ctok", expiresInSeconds: 600 });
  ok(good && good.controlPath === "/v1/voice/sessions/vses_1/control", "shaped response builds the control path");
  ok(V.shapeBrokerResponse({ sessionId: "vses_1", answerSdp: "v=0\r\nm=audio 9\r\n" }) === null, "missing control token → null");
  ok(V.shapeBrokerResponse({ sessionId: "vses_1", answerSdp: "not-sdp", controlToken: "t" }) === null, "bad answer SDP → null");
}

// ── control-channel contracts ────────────────────────────────────────────────
section("Browser↔gateway control contracts");
{
  ok(V.validateClientControl({ t: "cancel_turn", turnId: 3 }).turnId === 3, "cancel_turn validated");
  ok(V.validateClientControl({ t: "reset_session" }).t === "reset_session", "reset_session validated");
  ok(V.validateClientControl({ t: "nope" }) === null, "unknown client control → null");
  ok(V.encodeClientControl({ t: "close_session" }) === '{"t":"close_session"}', "client control encodes");
  ok(V.validateServerControl({ t: "status", status: "listening", turnId: 1 }).status === "listening", "server status frame validated");
  ok(V.validateServerControl({ t: "status", status: "evil", turnId: 1 }) === null, "unknown server status → null");
  ok(V.validateServerControl({ t: "ui_action", action: { type: "OPEN_HOTEL", hotelId: "h1" }, turnId: 2 }).action.type === "OPEN_HOTEL", "server ui_action validated via SB-01 union");
  ok(V.validateServerControl({ t: "ui_action", action: { type: "PLACE_BID" }, turnId: 2 }) === null, "server ui_action with a non-union type → null");
  const bounded = V.validateServerControl({ t: "result", kind: "answer", text: "z".repeat(5000), turnId: 1 });
  ok(bounded && bounded.text.length <= 800, "server result text bounded");
  ok(V.validateServerControl({ t: "transcript", role: "assistant", text: "hi", turnId: 1 }).role === "assistant", "transcript frame validated");
  ok(V.validateServerControl({ t: "error", code: "provider_unavailable", turnId: 1 }).code === "provider_unavailable", "error frame validated");
}

// ── native WebRTC client ─────────────────────────────────────────────────────
section("WebRTC client (data-channel event NEVER executes an action; lifecycle)");
{
  // parseDisplayTranscript: only transcript-shaped events surface (for display)
  ok(WEBRTC.parseDisplayTranscript(JSON.stringify({ type: "transcript", role: "assistant", text: "hello" })).text === "hello", "transcript event parsed for display");
  ok(WEBRTC.parseDisplayTranscript(JSON.stringify({ type: "tool_call", tool: "searchHotels" })) === null, "a tool_call on the data channel is NOT a display transcript (no action)");
  ok(WEBRTC.parseDisplayTranscript(JSON.stringify({ type: "response.function_call_arguments.done", name: "placeBid" })) === null, "a function-call event on the data channel yields nothing (cannot execute)");
  ok(WEBRTC.parseDisplayTranscript("z".repeat(20000)) === null, "oversized data-channel payload dropped");

  function makeRtcEnv(opts = {}) {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
    let dc = null;
    const pcs = [];
    function FakePC() {
      this.ontrack = null; this.onconnectionstatechange = null; this.connectionState = "new"; this._closed = false; this._remote = null;
      pcs.push(this);
      this.createDataChannel = () => { dc = { label: "oai-events", onopen: null, onmessage: null, onclose: null, close() {} }; return dc; };
      this.addTrack = () => {};
      this.createOffer = async () => ({ type: "offer", sdp: "v=0\r\nm=audio 9\r\n" });
      this.setLocalDescription = async () => {};
      this.setRemoteDescription = async (d) => { this._remote = d; };
      this.close = () => { this._closed = true; };
    }
    return {
      env: {
        getUserMedia: opts.deny ? async () => { throw new Error("denied"); } : async () => stream,
        RTCPeerConnectionCtor: opts.noPc ? undefined : FakePC,
      },
      tracks, getDc: () => dc, getPcs: () => pcs,
    };
  }

  // unsupported
  const un = WEBRTC.createWebrtcSession({ getUserMedia: undefined, RTCPeerConnectionCtor: undefined });
  un.start().then((r) => ok(r && r.ok === false && r.failure === "unsupported", "no media support → unsupported"));

  // permission denied
  const denyEnv = makeRtcEnv({ deny: true });
  const denySess = WEBRTC.createWebrtcSession(denyEnv.env);
  denySess.start().then((r) => ok(r && r.ok === false && r.failure === "permission_denied", "denied mic → permission_denied"));

  // happy path + data-channel action-cannot-execute
  const okEnv = makeRtcEnv();
  const sess = WEBRTC.createWebrtcSession(okEnv.env);
  let transcriptSeen = null;
  let actionExecuted = false;
  (async () => {
    const started = await sess.start({
      onTranscript: (line) => { transcriptSeen = line.text; },
      onRemoteAudio: () => {},
    });
    ok(started && started.ok === true && /^v=0/.test(started.offerSdp), "WebRTC start returns an SDP offer");
    const dc = okEnv.getDc();
    // a provider TRANSCRIPT event → surfaced for display
    dc.onmessage({ data: JSON.stringify({ type: "transcript", role: "assistant", text: "found 3 hotels" }) });
    ok(transcriptSeen === "found 3 hotels", "data-channel transcript surfaces for display");
    // a provider TOOL-CALL event on the data channel → NO action, NO transcript
    transcriptSeen = null;
    dc.onmessage({ data: JSON.stringify({ type: "tool_call", tool: "placeBid", input: {} }) });
    ok(transcriptSeen === null && actionExecuted === false, "data-channel tool event executes NO action");
    // acceptAnswer applies remote description
    const applied = await sess.acceptAnswer("v=0\r\nm=audio 9\r\n");
    ok(applied === true && okEnv.getPcs()[0]._remote && okEnv.getPcs()[0]._remote.type === "answer", "acceptAnswer sets remote answer");
    // dispose stops tracks + closes pc
    sess.dispose();
    ok(okEnv.tracks[0].stopped === true && okEnv.getPcs()[0]._closed === true, "dispose stops mic tracks + closes peer connection");
  })();
}

// ── gateway control client ───────────────────────────────────────────────────
section("Gateway control client (token in subprotocol, not query; frame guards)");
{
  function makeWs() {
    const sent = [];
    let closed = false;
    let ctorArgs = null;
    const ws = { send: (d) => sent.push(d), close: () => { closed = true; }, onopen: null, onclose: null, onerror: null, onmessage: null };
    return { ws, sent, isClosed: () => closed, setArgs: (a) => (ctorArgs = a), getArgs: () => ctorArgs };
  }
  function makeClientEnv(brokerResp, wsWrap, gatewayControlBase) {
    return {
      fetchImpl: async () => ({ ok: brokerResp.ok !== false, status: brokerResp.status || 200, json: async () => brokerResp.body }),
      WebSocketCtor: (url, protocols) => { wsWrap.setArgs({ url, protocols }); return wsWrap.ws; },
      gatewayControlBase: gatewayControlBase || "",
    };
  }
  const brokerOk = {
    body: { sessionId: "vses_1", answerSdp: "v=0\r\nm=audio 9\r\n", controlToken: "CTOK", controlPath: "/v1/voice/sessions/vses_1/control", controlWsBase: "wss://gw.example" },
  };

  (async () => {
    const wsWrap = makeWs();
    const frames = [];
    const client = V.createGatewayClient(makeClientEnv(brokerOk, wsWrap), { onServerControl: (m) => frames.push(m) });
    // R3 (REREV-09): start() now AWAITS the socket OPEN — drive the handshake.
    const startP = client.start("v=0\r\nm=audio 9\r\n");
    await new Promise((r) => setTimeout(r, 5));
    if (wsWrap.ws.onopen) wsWrap.ws.onopen();
    const res = await startP;
    ok(res.ok === true && res.broker.controlToken === "CTOK", "broker exchange returns the bounded response");
    const args = wsWrap.getArgs();
    ok(args.url === "wss://gw.example/v1/voice/sessions/vses_1/control", "control socket opens on the wss control URL");
    ok(!args.url.includes("CTOK"), "the control token is NOT in the socket URL/query");
    ok(String(args.protocols).includes("CTOK"), "the control token rides the WebSocket subprotocol");
    // inbound frame handling
    wsWrap.ws.onmessage({ data: JSON.stringify({ t: "status", status: "listening", turnId: 1 }) });
    ok(frames.length === 1 && frames[0].t === "status", "valid inbound frame surfaced");
    wsWrap.ws.onmessage({ data: "x".repeat(9000) });
    ok(frames.length === 1, "oversized inbound frame dropped");
    wsWrap.ws.onmessage({ data: "{not json" });
    ok(frames.length === 1, "malformed inbound frame dropped");
    wsWrap.ws.onmessage({ data: 123 });
    ok(frames.length === 1, "non-string (binary) inbound frame dropped");
    wsWrap.ws.onmessage({ data: JSON.stringify({ t: "evil" }) });
    ok(frames.length === 1, "unknown inbound frame dropped");
    // outbound control
    ok(client.cancelTurn(2) === true && wsWrap.sent.some((s) => s.includes("cancel_turn")), "cancelTurn sends an encoded frame");
    client.closeSession();
    ok(wsWrap.isClosed() === true, "closeSession tears down the socket");
  })();

  // broker failure → fail closed
  (async () => {
    const wsWrap = makeWs();
    const client = V.createGatewayClient(makeClientEnv({ ok: false, status: 503, body: {} }, wsWrap), { onServerControl: () => {} });
    const res = await client.start("v=0\r\nm=audio 9\r\n");
    ok(res.ok === false && res.code === "broker_failed", "broker 503 → broker_failed (no socket opened)");
    ok(wsWrap.getArgs() === null, "no control socket opened on broker failure");
  })();

  // malformed broker response
  (async () => {
    const wsWrap = makeWs();
    const client = V.createGatewayClient(makeClientEnv({ body: { sessionId: "x" } }, wsWrap), { onServerControl: () => {} });
    const res = await client.start("v=0\r\nm=audio 9\r\n");
    ok(res.ok === false && res.code === "malformed_broker_response", "missing controlToken → malformed_broker_response");
  })();

  // no wss base anywhere → config error
  (async () => {
    const wsWrap = makeWs();
    const noBase = { body: { ...brokerOk.body, controlWsBase: undefined } };
    const client = V.createGatewayClient(makeClientEnv(noBase, wsWrap, ""), { onServerControl: () => {} });
    const res = await client.start("v=0\r\nm=audio 9\r\n");
    ok(res.ok === false && res.code === "config_error", "no wss base → config_error");
  })();

  // R2 (SB04-R1-REREV-07): dispose() during the in-flight broker exchange ABORTS
  // the fetch (an AbortSignal is passed) and opens no late control socket.
  (async () => {
    const wsWrap = makeWs();
    let sawSignal = false, aborted = false;
    const env = {
      fetchImpl: (_path, init) =>
        new Promise((_res, reject) => {
          sawSignal = !!(init && init.signal);
          if (init && init.signal) {
            init.signal.addEventListener("abort", () => {
              aborted = true;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }
        }),
      WebSocketCtor: (url, protocols) => { wsWrap.setArgs({ url, protocols }); return wsWrap.ws; },
      gatewayControlBase: "wss://gw.example",
    };
    const client = V.createGatewayClient(env, { onServerControl: () => {} });
    const p = client.start("v=0\r\nm=audio 9\r\n");
    client.dispose(); // abort mid-flight
    const res = await p;
    ok(sawSignal === true, "the broker fetch receives an AbortSignal");
    ok(aborted === true, "dispose() aborts the in-flight broker fetch");
    ok(res.ok === false && res.code === "broker_failed", "an aborted start → broker_failed");
    ok(wsWrap.getArgs() === null, "no control socket opened after an aborted start");
  })();

  // R3 (SB04-R2-REREV-09): control-socket READINESS — start() succeeds only after
  // the socket actually OPENS with the negotiated subprotocol, bounded by timeout.
  (async () => {
    // error before open → failure + disposal
    const w1 = makeWs();
    const c1 = V.createGatewayClient(makeClientEnv(brokerOk, w1), { onServerControl: () => {} });
    const p1 = c1.start("v=0\r\nm=audio 9\r\n");
    await new Promise((r) => setTimeout(r, 5));
    if (w1.ws.onerror) w1.ws.onerror();
    const r1 = await p1;
    ok(r1.ok === false, "socket ERROR before open → start fails (no LISTENING-ready result)");
    ok(w1.isClosed() === true, "the failed socket is disposed");

    // close before open → failure
    const w2 = makeWs();
    const c2 = V.createGatewayClient(makeClientEnv(brokerOk, w2), { onServerControl: () => {} });
    const p2 = c2.start("v=0\r\nm=audio 9\r\n");
    await new Promise((r) => setTimeout(r, 5));
    if (w2.ws.onclose) w2.ws.onclose({ code: 1006 });
    const r2 = await p2;
    ok(r2.ok === false, "socket CLOSE before open → start fails");

    // wrong negotiated subprotocol → failure
    const w3 = makeWs();
    const c3 = V.createGatewayClient(makeClientEnv(brokerOk, w3), { onServerControl: () => {} });
    const p3 = c3.start("v=0\r\nm=audio 9\r\n");
    await new Promise((r) => setTimeout(r, 5));
    w3.ws.protocol = "wrong-protocol";
    if (w3.ws.onopen) w3.ws.onopen();
    const r3 = await p3;
    ok(r3.ok === false, "WRONG negotiated subprotocol → start fails");

    // a successful open with the RIGHT protocol → success + onOpen surfaced
    const w4 = makeWs();
    let opened = false;
    const c4 = V.createGatewayClient(makeClientEnv(brokerOk, w4), { onServerControl: () => {}, onOpen: () => { opened = true; } });
    const p4 = c4.start("v=0\r\nm=audio 9\r\n");
    await new Promise((r) => setTimeout(r, 5));
    w4.ws.protocol = "staybid-voice.CTOK";
    if (w4.ws.onopen) w4.ws.onopen();
    const r4 = await p4;
    ok(r4.ok === true && opened === true, "open + correct subprotocol → ready (onOpen surfaced)");

    // a STALE (older) socket closing after a NEWER attempt must not affect the new one
    // (generation ownership is component-level; here we assert the client re-binds
    // durable handlers only after readiness — the pre-open onclose path never calls hooks.onClose)
    let closedHookCalls = 0;
    const w5 = makeWs();
    const c5 = V.createGatewayClient(makeClientEnv(brokerOk, w5), { onServerControl: () => {}, onClose: () => { closedHookCalls += 1; } });
    const p5 = c5.start("v=0\r\nm=audio 9\r\n");
    await new Promise((r) => setTimeout(r, 5));
    if (w5.ws.onclose) w5.ws.onclose({ code: 1006 }); // pre-open close → readiness failure path
    await p5;
    ok(closedHookCalls === 0, "a pre-open close resolves the readiness gate — it does NOT fire the live onClose hook");
  })();
}

// ── gateway turn router (stale / cancel ownership) ───────────────────────────
section("Gateway turn router (SB-01 dispatch; stale rejection)");
{
  function makeSession() {
    const allow = new Set();
    let turnId = 0;
    let active = 0;
    return {
      allowHotelIds: (ids) => (Array.isArray(ids) ? ids.forEach((i) => allow.add(i)) : null),
      hasHotelId: (id) => allow.has(id),
      allowedHotelIds: () => Array.from(allow),
      trustHotel: () => {},
      getTrustedHotel: () => null,
      beginTurn: () => { turnId += 1; active = turnId; const my = turnId; return { turnId: my, signal: { aborted: false }, isStale: () => my !== active, cancel: () => { if (active === my) active = 0; } }; },
      reset: () => { allow.clear(); active = 0; },
    };
  }
  const session = makeSession();
  session.allowHotelIds(["hotelR1"]);
  let dispatched = null;
  const dispatch = (candidate) => {
    if (candidate && candidate.type === "OPEN_HOTEL" && session.hasHotelId(candidate.hotelId)) { dispatched = candidate.hotelId; return { ok: true, action: "OPEN_HOTEL" }; }
    return { ok: false, reason: "hotel_id_not_allowlisted" };
  };
  const router = V.createGatewayTurnRouter({ session, dispatch });
  router.beginTurn(); // arm (the GATEWAY numbers turns)
  const T1 = 1; // authoritative gateway turn id
  // ui_action on the current turn → dispatched
  const o1 = router.handleServerControl({ t: "ui_action", action: { type: "OPEN_HOTEL", hotelId: "hotelR1" }, turnId: T1 });
  ok(o1.handled === true && dispatched === "hotelR1", "ui_action on the current turn is dispatched via SB-01");
  // every turn-scoped frame surfaces on the current turn
  ok(router.handleServerControl({ t: "status", status: "thinking", turnId: T1 }).handled === true, "status frame handled on current turn");
  ok(router.handleServerControl({ t: "transcript", role: "assistant", text: "hi", turnId: T1 }).handled === true, "transcript handled on current turn");
  // cancel → EVERY later frame for that turn is STALE (no UI mutation)
  dispatched = null;
  let staleStatus = false, staleTranscript = false;
  router.cancel();
  const o2 = router.handleServerControl({ t: "ui_action", action: { type: "OPEN_HOTEL", hotelId: "hotelR1" }, turnId: T1 });
  ok(o2.handled === false && dispatched === null, "ui_action after cancel is rejected (no UI mutation)");
  staleStatus = router.handleServerControl({ t: "status", status: "thinking", turnId: T1 }).handled === false;
  staleTranscript = router.handleServerControl({ t: "transcript", role: "assistant", text: "late", turnId: T1 }).handled === false;
  ok(staleStatus, "R1-08: stale status dropped (no state mutation)");
  ok(staleTranscript, "R1-08: stale transcript dropped (no display)");
  ok(router.handleServerControl({ t: "result", kind: "answer", text: "late", turnId: T1 }).handled === false, "result on a stale turn dropped");
  // a NEW (higher) gateway turn is fresh again → multi-turn
  router.beginTurn();
  dispatched = null;
  const T2 = 2;
  const o4 = router.handleServerControl({ t: "ui_action", action: { type: "OPEN_HOTEL", hotelId: "hotelR1" }, turnId: T2 });
  ok(o4.handled === true && dispatched === "hotelR1", "a NEW gateway turn is fresh again (multi-turn)");

  // ── R3 (SB04-R2-REREV-05): STALE turn_complete + turn-scoped error are DROPPED ──
  let tcCalls = 0, errCalls = 0, sessionEndedCalls = 0;
  const router2 = V.createGatewayTurnRouter({
    session: makeSession(),
    dispatch: () => ({ ok: false, reason: "hotel_id_not_allowlisted" }),
    hooks: {
      onTurnComplete: () => { tcCalls += 1; },
      onError: (code) => { if (code === "session_ended") sessionEndedCalls += 1; else errCalls += 1; },
    },
  });
  router2.beginTurn(); // gateway turn 1
  ok(router2.handleServerControl({ t: "turn_complete", turnId: 1 }).handled === true && tcCalls === 1, "fresh turn_complete surfaces + seals");
  // the SAME turn's late turn_complete is now stale (sealed) → hook NOT invoked
  const lateTc = router2.handleServerControl({ t: "turn_complete", turnId: 1 });
  ok(lateTc.handled === false && tcCalls === 1, "R3-05: a STALE turn_complete does NOT invoke the hook (sealed)");
  // a turn-scoped error for the sealed turn is dropped
  const lateErr = router2.handleServerControl({ t: "error", code: "turn_timeout", turnId: 1 });
  ok(lateErr.handled === false && errCalls === 0, "R3-05: a STALE turn-scoped error does NOT invoke the hook");
  // cancel → error for the cancelled turn also dropped (advance to turn 2 first so
  // the router knows turn 2 is the current gateway turn, then cancel it)
  router2.beginTurn(); // arm for gateway turn 2
  ok(router2.handleServerControl({ t: "status", status: "listening", turnId: 2 }).handled === true, "turn 2 status advances the router to turn 2");
  router2.cancel();
  ok(router2.handleServerControl({ t: "error", code: "cost_limit", turnId: 2 }).handled === false && errCalls === 0, "an error for a CANCELLED turn is dropped");
  // session_ended ALWAYS surfaces (session-terminal, not turn-scoped)
  ok(router2.handleServerControl({ t: "error", code: "session_ended", turnId: 2 }).handled === true && sessionEndedCalls === 1, "session_ended always surfaces (session-terminal)");
  // and AFTER session_ended, everything is sealed — a new frame for old turns drops
  ok(router2.handleServerControl({ t: "turn_complete", turnId: 2 }).handled === false, "after session_ended the old turn stays sealed");
}

// ── R3: the frozen SB-02 20-second audio ceiling ─────────────────────────────
section("R3: 20-second single-audio ceiling (frozen SB-02 bound preserved)");
{
  ok(V.MAX_RECORDING_MS === 20_000, "SB-02 MAX_RECORDING_MS is exactly 20s (frozen; not raised)");
}

// ── R3 (REREV-09/11): the component attempt-ownership state machine ──────────
section("R3-09/11: createAttemptOwner — the exact ownership logic VoicePanel runs");
{
  const owner = V.createAttemptOwner();
  const a1 = owner.begin();
  ok(a1.isCurrent() === true && a1.superseded() === false, "a new attempt is current");
  const a2 = owner.begin();
  ok(a1.superseded() === true && a1.isCurrent() === false, "a NEWER attempt supersedes the older one");
  ok(a2.isCurrent() === true, "the newer attempt is current");
  owner.invalidate(); // Stop / teardown / unmount
  ok(a2.superseded() === true, "invalidate() (Stop/teardown) supersedes the current attempt");
  const a3 = owner.begin();
  ok(a3.isCurrent() === true && a1.superseded() && a2.superseded(), "a restart begins a fresh current attempt; ALL older attempts stay stale");
  // the component race: attempt A pends on an await; Stop + restart happen; A's
  // continuation must see itself superseded and abort silently.
  const raceA = owner.begin();
  owner.invalidate();
  const raceB = owner.begin();
  ok(raceA.superseded() === true && raceB.isCurrent() === true, "an in-flight older attempt resolves as superseded — it can never enter LISTENING or tear down the newer attempt");
}

// ── R4-09 (SB04-R3-REREV-09): control frames are ATTEMPT-BOUND, not routerRef.current
// A delayed control frame from an OLD attempt's GatewayClient must route ONLY to the
// router captured when that client was created, and be dropped once superseded — never
// to a newer attempt's router via routerRef.current. This is a VoicePanel wiring
// invariant, asserted at the source (the exact closure the component runs).
section("R4-09: VoicePanel control frames route to the CAPTURED attempt router (never routerRef.current)");
{
  const src = fs.readFileSync(path.join(REPO, "components/voice/VoicePanel.tsx"), "utf8");
  // Isolate the onServerControl handler body.
  const m = /onServerControl:\s*\(msg\)\s*=>\s*\{([\s\S]*?)\},/.exec(src);
  ok(!!m, "onServerControl is an inline handler in VoicePanel");
  const bodyOsc = m ? m[1] : "";
  ok(/if\s*\(\s*superseded\(\)\s*\)\s*return;/.test(bodyOsc), "onServerControl drops every frame once the attempt is superseded");
  ok(/router\.handleServerControl\(\s*msg\s*\)/.test(bodyOsc), "onServerControl routes to the CAPTURED `router` closure (attempt-bound)");
  ok(!/routerRef\.current/.test(bodyOsc), "onServerControl NEVER reaches routerRef.current (a newer attempt's router)");
  // onClose / onError are attempt-bound too (a stale socket never tears down a newer attempt).
  const mc = /onClose:\s*\(\)\s*=>\s*\{([\s\S]*?)\},/.exec(src);
  const me = /onError:\s*\(\)\s*=>\s*\{([\s\S]*?)\},/.exec(src);
  ok(mc && /if\s*\(\s*superseded\(\)\s*\)\s*return;/.test(mc[1]), "onClose is guarded by superseded() (a stale close never tears down a newer attempt)");
  ok(me && /if\s*\(\s*superseded\(\)\s*\)\s*return;/.test(me[1]), "onError is guarded by superseded() (a stale error never tears down a newer attempt)");
}

// ── WebRTC async ownership (race) ───────────────────────────────────────────
section("WebRTC async ownership (cancel during stages; acceptAnswer ownership)");
{
  function deferredEnv() {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
    let resolveGum = null;
    const pcs = [];
    function FakePC() {
      this.ontrack = null; this.onconnectionstatechange = null; this.connectionState = "new"; this._closed = false; this._remote = null;
      pcs.push(this);
      this.createDataChannel = () => ({ label: "oai-events", onopen: null, onmessage: null, onclose: null, close() {} });
      this.addTrack = () => {};
      this.createOffer = async () => ({ type: "offer", sdp: "v=0\r\nm=audio 9\r\n" });
      this.setLocalDescription = async () => {};
      this.setRemoteDescription = async () => {};
      this.close = () => { this._closed = true; };
    }
    return {
      env: {
        getUserMedia: () => new Promise((res) => { resolveGum = () => res(stream); }),
        RTCPeerConnectionCtor: FakePC,
      },
      fireGum: () => resolveGum && resolveGum(),
      tracks, getPcs: () => pcs,
    };
  }
  // cancel during getUserMedia → late resolution stops tracks, no peer connection
  (async () => {
    const d = deferredEnv();
    const sess = WEBRTC.createWebrtcSession(d.env);
    const startP = sess.start();
    sess.cancel(); // cancel while gUM pending
    d.fireGum();
    const r = await startP;
    ok(r && r.ok === false && r.failure === "cancelled", "cancel during getUserMedia → cancelled");
    ok(d.tracks[0].stopped === true, "late-granted tracks are stopped after cancel");
    ok(d.getPcs().length === 0, "no peer connection created after cancel");
  })();
  // acceptAnswer after cancel returns false (no stale mutation)
  (async () => {
    const okEnv = (() => {
      const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
      const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
      const pcs = [];
      function FakePC() { this.ontrack = null; this.onconnectionstatechange = null; this.connectionState = "new"; pcs.push(this); this.createDataChannel = () => ({ label: "x", onopen: null, onmessage: null, onclose: null, close() {} }); this.addTrack = () => {}; this.createOffer = async () => ({ type: "offer", sdp: "v=0\r\nm=audio 9\r\n" }); this.setLocalDescription = async () => {}; this.setRemoteDescription = async () => {}; this.close = () => {}; }
      return { getUserMedia: async () => stream, RTCPeerConnectionCtor: FakePC };
    })();
    const sess = WEBRTC.createWebrtcSession(okEnv);
    const started = await sess.start();
    ok(started.ok === true, "webrtc started for acceptAnswer race");
    sess.cancel();
    const applied = await sess.acceptAnswer("v=0\r\nm=audio 9\r\n");
    ok(applied === false, "acceptAnswer after cancel returns false (no stale mutation)");
  })();
}

(async () => {
  // Real-time settle: the async assertion blocks use real setTimeout waits (the
  // R3-09 readiness chain totals ~40ms) — flush() is setImmediate-based and would
  // outrun them, silently dropping their assertions from the count.
  await new Promise((r) => setTimeout(r, 500));
  await flush(20);
  console.log("\n──────────────────────────────────────────────────");
  console.log(`Voice AI SB-04 provider/client: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error("FAILURES:\n  - " + failures.join("\n  - "));
    process.exit(1);
  }
  console.log("ALL VOICE-AI-SB-04 PROVIDER/CLIENT CHECKS PASSED");
})();
