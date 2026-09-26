#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — conversation controller behavioral suite.
//
//   Run:  node tests/live-ai/live-ai-conversation.test.js
//
// Compiles lib/live-ai/*.ts with the LOCKFILE-INSTALLED local tsc and drives the
// REAL conversation controller against the REAL authority runtime + REAL PCM
// playback, through a deterministic FAKE transport + FAKE audio sink. NO network,
// NO provider, NO WebSocket, NO WebRTC. Covers: explicit-gesture start, the
// context publish → ACK contract (a proposal is inert until its ACK), provider
// proposal → browser-stamped envelope → execute → receipt, evidence-bound answer
// rendering (a plan citing an unverified receipt is downgraded, never voiced),
// prompt-injection-as-data (a smuggled url/hotelId/new-op in a proposal is refused
// by the runtime re-validation), barge-in + route-change generation suppression,
// stale-turn/stale-generation inertness, receipt replay idempotency, session/idle
// bounds, memory bounds, audio-frame playback + kill/end teardown.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "conversation");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "live-ai"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
}
fs.copyFileSync(path.join(REPO, "lib/cities.ts"), path.join(SRC, "cities.ts"));   // owner-preview imports the canonical city registry (../cities)
fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: ["es2020", "dom"], strict: true, noEmitOnError: true },
  include: ["live-ai/**/*.ts"],
}));
let TSC_BIN;
try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed."); process.exit(2); }
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (conversation): exit 0, clean (strict)");

const C = require(path.join(OUT, "live-ai/contracts.js"));
const R = require(path.join(OUT, "live-ai/runtime.js"));
const P = require(path.join(OUT, "live-ai/protocol.js"));
const A = require(path.join(OUT, "live-ai/audio-playback.js"));
const CONV = require(path.join(OUT, "live-ai/conversation.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
const titleCase = (s) => String(s).replace(/\b([a-z])/g, (m) => m.toUpperCase());

const HOTELS = [
  { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi", "Parking", "Breakfast"] },
  { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["WiFi", "Breakfast"] },
  { id: "htl_charlie", name: "Charlie Cottage", city: "Dhanaulti", _minPrice: 2600, avgRating: 4.2, starRating: 3, amenities: ["Parking"] },
];

// A /hotels page registration whose getSnapshot IS the production builder.
function makeHotelsPage(init) {
  init = init || {};
  const s = {
    base: (init.displayHotels || HOTELS).slice(), displayHotels: (init.displayHotels || HOTELS).slice(),
    city: init.city || "Dhanaulti", query: init.query || "", checkIn: "", checkOut: "", guests: 2,
    maxPrice: init.maxPrice == null ? null : init.maxPrice, sort: "default", stars: [],
    appliedAmenities: [], amenityOpts: ["WiFi", "Parking", "Breakfast", "Pool", "AC"],
    loading: !!init.loading, error: "", resolvedCity: init.city || "Dhanaulti", resolvedQuery: "",
    resolvedStatus: init.resolvedStatus || "ready", opened: null, openCalls: 0, sectionCalls: 0,
  };
  const reg = {
    pageId: "hotels", routeKey: "/hotels",
    getSnapshot: () => C.buildHotelsSnapshot({
      displayHotels: s.displayHotels, city: s.city, query: s.query, checkIn: s.checkIn, checkOut: s.checkOut,
      guests: s.guests, maxPrice: s.maxPrice, sort: s.sort, stars: s.stars, appliedAmenities: s.appliedAmenities,
      amenityOpts: s.amenityOpts, loading: s.loading, error: s.error, resolvedCity: s.resolvedCity,
      resolvedQuery: s.resolvedQuery, resolvedStatus: s.resolvedStatus, role: "anonymous",
    }),
    execute: (cmd) => {
      if (cmd.kind === "open_hotel") { s.opened = { hotelId: cmd.hotelId, position: cmd.position }; s.openCalls += 1; }
      else if (cmd.kind === "apply_refinement") { if ("maxPrice" in cmd) s.maxPrice = cmd.maxPrice == null ? null : cmd.maxPrice; }
    },
  };
  return { s, reg };
}

// deterministic running audio sink
function runningSink() {
  const enqueued = []; let st = "running"; let closed = false;
  return { enqueued, get closed() { return closed; }, resume: async () => true, enqueue: (x) => enqueued.push(x.length), stopAndClear: () => { enqueued.length = 0; }, close: () => { closed = true; st = "closed"; }, state: () => (closed ? "closed" : st) };
}

// fake transport: records outbound frames, lets the test push server frames/conn.
function fakeTransport() {
  const sent = []; let listener = null; let conn = "disconnected"; let autoAckOff = false;
  return {
    kind: "gateway",
    _noAutoAck() { autoAckOff = true; },
    _autoAck() { autoAckOff = false; },
    async start(input) { sent.push({ m: "start", input }); return { ok: true }; },
    submitText(input) { sent.push({ m: "submitText", input }); return true; },
    publishContext(frame) { sent.push({ m: "publishContext", frame }); return true; },
    submitActionAccepted(frame) { sent.push({ m: "accepted", frame }); return true; }, // R3-05
    submitActionReceipt(frame) {
      sent.push({ m: "receipt", frame });
      // R5B — mirror the gateway: ACK the lifecycle update so the browser promotes a terminal
      // verified receipt into its trusted evidence map. `_noAutoAck()` suppresses it for tests
      // that assert the browser withholds trust until the ACK arrives.
      const r = frame.receipt;
      if (!autoAckOff && r && listener) {
        const closed = r.outcome !== "acted";
        // R5B-REV-06 — mirror the gateway EXACTLY: the ACK carries the canonical terminal-receipt
        // commitment recomputed from the receipt received (over the SAME fields the browser committed to).
        const commitment = P.terminalReceiptCommitment(r);
        listener({ type: "frame", frame: { t: "action.receipt.ack", sessionId: frame.sessionId, turnId: frame.turnId, generation: frame.generation, receiptId: r.receiptId, proposalId: r.proposalId, outcome: r.outcome, closed, commitment } });
      }
      return true;
    },
    submitApproval(input) { sent.push({ m: "approve", input }); return true; }, // R2-08
    interrupt(input) { sent.push({ m: "interrupt", input }); },
    reset(input) { sent.push({ m: "reset", input }); },
    end(input) { sent.push({ m: "end", input }); },
    subscribe(l) { listener = l; return () => { listener = null; }; },
    getConnectionState() { return conn; },
    _push(frame) { if (listener) listener({ type: "frame", frame }); },
    _conn(state) { conn = state; if (listener) listener({ type: "connection", state }); },
    _sent: sent,
    _lastPublish() { for (let i = sent.length - 1; i >= 0; i--) if (sent[i].m === "publishContext") return sent[i].frame; return null; },
    _receipts() { return sent.filter((x) => x.m === "receipt").map((x) => x.frame.receipt); },
    _accepted() { return sent.filter((x) => x.m === "accepted").map((x) => x.frame.accepted); }, // R3-05
    _approvals() { return sent.filter((x) => x.m === "approve").map((x) => x.input); }, // R2-08
  };
}

function boot(pageInit, now) {
  const rt = R.createLiveAiRuntime("anonymous");
  const page = makeHotelsPage(pageInit);
  rt.invalidateRoute("/hotels");
  rt.registerPage(page.reg);
  const transport = fakeTransport();
  const audio = A.createAudioPlayback({ sink: runningSink() });
  const events = [];
  const conv = CONV.createConversation({ runtime: rt, transport, audio, now: now || (() => Date.now()), onEvent: (e) => events.push(e) });
  return { rt, page, transport, audio, conv, events };
}
// Bring a session to the ACKed IDLE state and return the published frame.
// REV-06 — the context.ack now carries the generation (part of the executable tuple).
async function bringToAck(env, authorityRef) {
  await env.conv.start("text");
  env.transport._push({ t: "connection.ready", sessionId: env.rt.sessionId, gatewaySessionId: "gw.session.1" });
  const pub = env.transport._lastPublish();
  env.transport._push({ t: "context.ack", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), routeEpoch: env.rt.getRouteEpoch(), contextRevision: pub.contextRevision, authorityRef });
  return pub;
}
function proposalFrame(env, authorityRef, proposalId, operation) {
  // R5B — the gateway supplies the executionNonce + the authoritative receiptId as frame metadata.
  return { t: "action.proposal", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef, executionNonce: "xn." + proposalId, receiptId: "rc." + proposalId, proposal: { proposalId, providerTurnId: "pturn." + proposalId, operation } };
}

(async function main() {
  section("state machine (transition table)");
  {
    ok(CONV.canTransition("DISCONNECTED", "CONNECTING") === true, "DISCONNECTED→CONNECTING legal");
    ok(CONV.canTransition("IDLE", "SPEAKING") === false, "IDLE→SPEAKING illegal (must pass THINKING/ACTING)");
    ok(CONV.canTransition("SPEAKING", "IDLE") === true, "SPEAKING→IDLE legal");
    ok(CONV.canTransition("OFFLINE", "SPEAKING") === false, "OFFLINE→SPEAKING illegal");
    ok(CONV.canTransition("IDLE", "IDLE") === true, "same-state is a no-op (true)");
  }

  section("explicit-gesture start publishes the bounded context, then IDLE on ready");
  {
    const env = boot();
    eq(env.conv.getState(), "DISCONNECTED", "starts DISCONNECTED");
    const res = await env.conv.start("text");
    ok(res.ok === true, "start('text') resolves ok through the transport");
    ok(env.transport._sent.some((x) => x.m === "start"), "transport.start was called");
    env.transport._push({ t: "connection.ready", sessionId: env.rt.sessionId, gatewaySessionId: "gw.1" });
    eq(env.conv.getState(), "IDLE", "connection.ready → IDLE");
    const pub = env.transport._lastPublish();
    ok(pub && pub.t === "context.publish", "a context.publish frame was sent on ready");
    ok(pub.context && pub.context.pageId === "hotels", "published context is the bounded PublishedContext");
    ok(!("ownerId" in pub.context) && pub.context.visibleHotels.every((h) => !("_minPrice" in h)), "published context carries no raw/internal fields");
    // a connection.ready for a DIFFERENT session id is ignored
    const before = env.conv.getState();
    env.transport._push({ t: "connection.ready", sessionId: "las_other", gatewaySessionId: "gw.z" });
    eq(env.conv.getState(), before, "connection.ready for another session id is inert");
  }

  section("a proposal is INERT until its context is ACKed (authority handshake)");
  {
    const env = boot();
    await env.conv.start("text");
    env.transport._push({ t: "connection.ready", sessionId: env.rt.sessionId, gatewaySessionId: "gw.1" });
    // BEFORE any ack — push a proposal → rejected as stale_context, NO execution
    env.transport._push(proposalFrame(env, "auth.premature", "prop.0", { op: "OPEN_VISIBLE_HOTEL", position: 1 }));
    const r0 = env.transport._receipts();
    ok(r0.length === 1 && r0[0].outcome === "stale" && r0[0].status === "stale_context", "pre-ACK proposal → stale receipt (no execution)");
    eq(env.page.s.openCalls, 0, "pre-ACK proposal executed NO UI action");
  }

  section("ACKed proposal → envelope → execute → verified receipt (immediate-verify op)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.read", { op: "READ_CURRENT_RESULTS" }));
    const rc = env.transport._receipts();
    ok(rc.length === 1, "one receipt emitted");
    eq(rc[0].outcome, "verified", "READ_CURRENT_RESULTS is verified inline");
    eq(rc[0].operation, "READ_CURRENT_RESULTS", "receipt names the executed operation");
    ok(rc[0].evidence && rc[0].evidence.kind === "results" && rc[0].evidence.count === 3, "receipt carries bounded results evidence");
    ok(P.isValidId(rc[0].authorityRef) && rc[0].authorityRef === "auth.1", "receipt binds the acked authorityRef");
    // R3-05 — the browser ANNOUNCES acceptance (binds the minted actionId) BEFORE the receipt.
    const acc = env.transport._accepted();
    ok(acc.length === 1 && acc[0].proposalId === "prop.read" && acc[0].operation === "READ_CURRENT_RESULTS" && acc[0].authorityRef === "auth.1", "R3-05 — an action.accepted announcement binds the action under the acked authority");
    ok(acc[0].actionId === rc[0].actionId, "R3-05 — the accepted actionId is the SAME id the receipt carries (server can correlate)");
    const idxAcc = env.transport._sent.findIndex((x) => x.m === "accepted");
    const idxRec = env.transport._sent.findIndex((x) => x.m === "receipt");
    ok(idxAcc >= 0 && idxRec >= 0 && idxAcc < idxRec, "R3-05 — action.accepted is sent BEFORE action.receipt");
  }

  section("a proposal with a NON-acked authorityRef is refused");
  {
    const env = boot();
    await bringToAck(env, "auth.good");
    env.transport._push(proposalFrame(env, "auth.forged", "prop.x", { op: "READ_CURRENT_RESULTS" }));
    const rc = env.transport._receipts();
    ok(rc.length === 1 && rc[0].outcome === "stale" && rc[0].status === "stale_context", "wrong authorityRef → stale receipt, never executed");
  }

  section("prompt-injection-as-data: a smuggled field / bad op is refused by re-validation");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    // (a) a url smuggled into an otherwise-valid OPEN op → runtime validateOperation rejects
    env.transport._push(proposalFrame(env, "auth.1", "prop.smug", { op: "OPEN_VISIBLE_HOTEL", position: 1, url: "javascript:alert(1)" }));
    let rc = env.transport._receipts();
    ok(rc.length === 1 && rc[0].outcome === "rejected" && rc[0].status === "invalid_operation", "smuggled url → invalid_operation (whole op refused)");
    eq(env.page.s.openCalls, 0, "smuggled-url proposal executed nothing");
    // (b) a valid-but-absent ordinal (5, only 3 hotels on screen) → missing_ordinal,
    //     still no navigation. (An out-of-range ordinal like 99 is refused earlier as
    //     invalid_operation; 5 is a valid ordinal that simply isn't present.)
    env.transport._push(proposalFrame(env, "auth.1", "prop.miss", { op: "OPEN_VISIBLE_HOTEL", position: 5 }));
    rc = env.transport._receipts();
    ok(rc.some((r) => r.status === "missing_ordinal" && r.outcome === "rejected"), "a valid-but-absent ordinal → missing_ordinal");
    eq(env.page.s.openCalls, 0, "still no navigation");
  }

  section("answer plan is EVIDENCE-BOUND (unverified citation is downgraded, never voiced)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.read", { op: "READ_CURRENT_RESULTS" }));
    const verifiedId = env.transport._receipts()[0].receiptId;
    // (a) a plan citing a receipt WE never verified → downgraded
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "plan.1", providerTurnId: "pt.1", kind: "page_facts", language: "en", evidenceReceiptIds: ["rcpt.does.not.exist"], selectedHotelIds: ["htl_alpha"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "plan citing an unknown receipt is downgraded to 'no verified answer'");
    // (b) R5B-REV-05 (option B) — `no_verified_match` is REFUSED as an evidence-backed signal in R5B: it
    //     must NOT be accepted merely because a generic READ receipt exists, so an advice plan claiming it
    //     downgrades (never voiced) — no signal is manufacturable from generic read evidence alone.
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "plan.2", providerTurnId: "pt.2", kind: "advice", language: "en", evidenceReceiptIds: [verifiedId], selectedHotelIds: ["htl_alpha"], signals: ["no_verified_match"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "R5B-REV-05 — an advice plan claiming no_verified_match is REFUSED (downgraded), not accepted from generic READ evidence");
    // (b2) R5B-REV-05 — the SAME results receipt cannot back a `lower_price` signal (no comparison winner) → downgraded.
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "plan.2b", providerTurnId: "pt.2b", kind: "advice", language: "en", evidenceReceiptIds: [verifiedId], selectedHotelIds: ["htl_alpha"], signals: ["lower_price"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "R5B-REV-05 — an advice signal without its exact verified underlying value (lower_price ← comparison winner) is downgraded, never manufactured");
    // (c) R4-08 — that SAME results receipt CANNOT author per-hotel page_facts (a results-count
    //     receipt names no hotel): the page_facts plan is downgraded, never voiced.
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "plan.3", providerTurnId: "pt.3", kind: "page_facts", language: "en", evidenceReceiptIds: [verifiedId], selectedHotelIds: ["htl_alpha"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "R4-08 — a results-count receipt cannot author per-hotel page_facts (downgraded)");
  }

  section("deterministic renderer never emits raw provider prose");
  {
    const clar = CONV.renderAnswerPlan({ planId: "p", providerTurnId: "pt", kind: "clarification", language: "en", evidenceReceiptIds: [], questionCode: "which_city" }, false);
    ok(/which city/i.test(clar), "clarification renders from the closed code set (no evidence needed)");
    const unknown = CONV.renderAnswerPlan({ planId: "p", providerTurnId: "pt", kind: "unknown", language: "en", evidenceReceiptIds: [], reason: "off_topic" }, false);
    ok(/don't have that information/i.test(unknown), "unknown renders the closed line");
    const hi = CONV.renderAnswerPlan({ planId: "p", providerTurnId: "pt", kind: "clarification", language: "hi", evidenceReceiptIds: [], questionCode: "what_budget" }, false);
    ok(hi.length > 0 && /[०-९ऀ-ॿ]/.test(hi), "hi renders Devanagari from the same closed code");
  }

  section("audio frames drive playback; kill/end tear down");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const g = env.conv.getGeneration();
    const b64 = Buffer.from(new Int16Array(4).fill(1).buffer).toString("base64");
    // R2-08 — audio is now gated on an APPROVED plan. Push an (evidence-free)
    // clarification answer.plan so the browser APPROVES planId "plan.a"; only then is
    // its audio accepted (a plan the browser never approved can never be voiced).
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, authorityRef: "auth.1", plan: { planId: "plan.a", providerTurnId: "pt.a", kind: "clarification", language: "en", evidenceReceiptIds: [], questionCode: "which_city" } });
    ok(env.transport._approvals().some((a) => a.planId === "plan.a"), "R2-08 — the browser APPROVED plan.a (answer.approve sent) before any TTS");
    // A real turn moves through THINKING before audio arrives (the flow guard forbids
    // a direct IDLE→SPEAKING jump); mirror that with a turn.state before audio.start.
    env.transport._push({ t: "turn.state", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, state: "thinking" });
    eq(env.conv.getState(), "THINKING", "turn.state thinking → THINKING");
    env.transport._push({ t: "audio.start", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, planId: "plan.a", audioId: "au.1", format: { encoding: "pcm16", sampleRate: 24000, channels: 1 } });
    eq(env.conv.getState(), "SPEAKING", "audio.start (approved plan) → SPEAKING");
    env.transport._push({ t: "audio.chunk", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, audioId: "au.1", seq: 0, bytes: b64 });
    ok(env.audio.isActive() === true, "chunk enqueued into the real playback");
    env.transport._push({ t: "audio.end", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, audioId: "au.1", finalSeq: 1 });
    eq(env.conv.getState(), "IDLE", "audio.end → IDLE");
    // session.killed → OFFLINE + teardown
    const endsBeforeKill = env.transport._sent.filter((x) => x.m === "end").length;
    env.transport._push({ t: "session.killed", sessionId: env.rt.sessionId, code: "runtime_killed" });
    eq(env.conv.getState(), "OFFLINE", "session.killed → OFFLINE");
    ok(env.audio.state() === "closed", "kill tore down the audio sink");
    // R3-04 — a server kill ALSO releases the transport's owned resources (socket + mic
    // media + any in-flight broker fetch), never leaves a killed session's mic open.
    ok(env.transport._sent.filter((x) => x.m === "end").length === endsBeforeKill + 1, "R3-04 — session.killed calls transport.end (complete teardown, not just audio)");
  }

  section("R3-04 — a server-initiated session.ended also releases the transport");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const endsBefore = env.transport._sent.filter((x) => x.m === "end").length;
    env.transport._push({ t: "session.ended", sessionId: env.rt.sessionId, reason: "timeout" });
    eq(env.conv.getState(), "DISCONNECTED", "session.ended → DISCONNECTED");
    ok(env.transport._sent.filter((x) => x.m === "end").length === endsBefore + 1, "R3-04 — session.ended calls transport.end (releases owned resources)");
  }

  section("barge-in bumps generation; stale-generation frames are inert");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const g0 = env.conv.getGeneration();
    env.conv.bargeIn();
    ok(env.conv.getGeneration() === g0 + 1, "barge-in increments the generation");
    ok(env.transport._sent.some((x) => x.m === "interrupt" && x.input.reason === "barge_in"), "barge-in sends an interrupt(barge_in)");
    eq(env.conv.getState(), "INTERRUPTING", "barge-in → INTERRUPTING");
    // a proposal at the OLD generation is stale → inert (no receipt)
    const before = env.transport._receipts().length;
    env.transport._push({ t: "action.proposal", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g0, authorityRef: "auth.1", proposal: { proposalId: "prop.stale", providerTurnId: "pt", operation: { op: "READ_CURRENT_RESULTS" } } });
    eq(env.transport._receipts().length, before, "a stale-generation proposal is dropped (no receipt)");
  }

  section("route change invalidates the ACK (a prior authorityRef no longer executes)");
  {
    const env = boot();
    await bringToAck(env, "auth.route");
    // mirror the provider: it bumped the route epoch + re-registered before notifying us.
    env.rt.invalidateRoute("/hotels"); // keeps the same-route registration, new turn
    env.rt.registerPage(env.page.reg);
    env.conv.onRouteChange();
    ok(env.transport._sent.some((x) => x.m === "interrupt" && x.input.reason === "route_change"), "route change sends interrupt(route_change)");
    // the OLD authorityRef is cleared → a proposal on it is refused
    const before = env.transport._receipts().length;
    env.transport._push(proposalFrame(env, "auth.route", "prop.afterroute", { op: "READ_CURRENT_RESULTS" }));
    const after = env.transport._receipts();
    ok(after.length === before + 1 && after[after.length - 1].outcome === "stale", "post-route proposal on the old ack → stale (never executed)");
  }

  section("stale turn id frames are inert");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const before = env.transport._receipts().length;
    env.transport._push({ t: "action.proposal", sessionId: env.rt.sessionId, turnId: "turn_not_current", generation: env.conv.getGeneration(), authorityRef: "auth.1", proposal: { proposalId: "prop.wrongturn", providerTurnId: "pt", operation: { op: "READ_CURRENT_RESULTS" } } });
    eq(env.transport._receipts().length, before, "a wrong-turn proposal is dropped");
  }

  section("REV-07 — a duplicate proposal NEVER executes the UI action twice (replay)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    // OPEN executes a real UI side effect; a duplicate must replay, NOT re-open.
    const f = proposalFrame(env, "auth.1", "prop.dup", { op: "OPEN_VISIBLE_HOTEL", position: 1 });
    env.transport._push(f);
    eq(env.page.s.openCalls, 1, "the OPEN executed once");
    env.transport._push(f); // identical proposalId + operation
    eq(env.page.s.openCalls, 1, "an identical retry did NOT execute the OPEN a second time (dedup before execute)");
    // a same-id DIFFERENT operation is a conflict → still no second execution.
    env.transport._push(proposalFrame(env, "auth.1", "prop.dup", { op: "OPEN_VISIBLE_HOTEL", position: 3 }));
    eq(env.page.s.openCalls, 1, "a same-id different-content proposal is a conflict — no execution");
    ok(env.transport._receipts().some((r) => r.status === "invalid_operation" && r.outcome === "rejected"), "the conflicting retry emits a rejected receipt");
  }

  section("transcript.final records memory + moves to THINKING");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push({ t: "transcript.final", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), providerTurnId: "pt.f", text: "hotels with parking under 3000", language: "en" });
    eq(env.conv.getState(), "THINKING", "transcript.final → THINKING");
    ok(env.conv.getMemory().some((m) => m.role === "user" && /parking/.test(m.text)), "final transcript is remembered as a user turn");
  }

  section("memory is bounded (never grows without limit)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    for (let i = 0; i < 30; i++) env.conv.submitText("message number " + i);
    ok(env.conv.getMemory().length <= 8, "memory turns bounded to the limit (≤8)");
  }

  section("session + idle bounds fail closed (teardown on timeout)");
  {
    let clock = 1_000_000;
    const env = boot({}, () => clock);
    await bringToAck(env, "auth.1");
    env.conv.submitText("hi");
    clock += 61_000; // > idleMs (60s) with no activity
    env.conv.tick();
    eq(env.conv.getState(), "DISCONNECTED", "idle timeout → end() → DISCONNECTED");
    ok(env.transport._sent.some((x) => x.m === "end" && x.input.reason === "timeout"), "idle timeout ends with reason 'timeout'");
  }
  {
    let clock = 5_000_000;
    const env = boot({}, () => clock);
    await bringToAck(env, "auth.1");
    for (let i = 0; i < 20; i++) { env.conv.submitText("keepalive " + i); clock += 30_000; env.conv.tick(); }
    clock += 1; env.conv.tick();
    eq(env.conv.getState(), "DISCONNECTED", "session ceiling (10min) eventually ends the session even with activity");
  }

  section("REV-06 — a stale-generation ACK never grants authority");
  {
    const env = boot();
    await env.conv.start("text");
    env.transport._push({ t: "connection.ready", sessionId: env.rt.sessionId, gatewaySessionId: "gw.1" });
    const pub = env.transport._lastPublish();
    // an ACK for a DIFFERENT (future) generation must be ignored.
    env.transport._push({ t: "context.ack", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration() + 1, routeEpoch: env.rt.getRouteEpoch(), contextRevision: pub.contextRevision, authorityRef: "auth.badgen" });
    env.transport._push(proposalFrame(env, "auth.badgen", "prop.g", { op: "READ_CURRENT_RESULTS" }));
    const rc = env.transport._receipts();
    ok(rc.length === 1 && rc[0].outcome === "stale", "a proposal on a stale-generation ACK is refused");
  }

  section("REV-06 — barge-in REVOKES the prior ACK (a racing proposal cannot execute)");
  {
    const env = boot();
    await bringToAck(env, "auth.live");
    env.conv.bargeIn();
    // the pre-barge authorityRef is now revoked → a late proposal on it is stale.
    env.transport._push({ t: "action.proposal", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.live", proposal: { proposalId: "prop.late", providerTurnId: "pt", operation: { op: "OPEN_VISIBLE_HOTEL", position: 1 } } });
    eq(env.page.s.openCalls, 0, "a proposal racing a barge-in does not execute");
  }

  section("REV-08 — an answer with EMPTY evidence for a fact kind is downgraded, never voiced");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "pl.e", providerTurnId: "pt", kind: "advice", language: "en", evidenceReceiptIds: [], selectedHotelIds: ["htl_alpha"], signals: ["lower_price"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "advice with empty evidence → downgraded");
  }

  section("REV-08 — an answer whose authorityRef ≠ the live ACK is downgraded");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.r", { op: "READ_CURRENT_RESULTS" }));
    const verifiedId = env.transport._receipts()[0].receiptId;
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.WRONG", plan: { planId: "pl.w", providerTurnId: "pt", kind: "page_facts", language: "en", evidenceReceiptIds: [verifiedId], selectedHotelIds: ["htl_alpha"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "a plan citing a non-live authorityRef is downgraded even with real evidence");
  }

  section("REV-08 — an unrelated verified receipt (no read evidence) cannot unlock a fact answer");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    // OPEN produces an 'acted' receipt (no read evidence); it verifies cross-route but
    // here we cite its ACTED receipt id — which carries no evidence — for an advice plan.
    env.transport._push(proposalFrame(env, "auth.1", "prop.o", { op: "OPEN_VISIBLE_HOTEL", position: 1 }));
    const actedReceipt = env.transport._receipts().find((r) => r.operation === "OPEN_VISIBLE_HOTEL");
    ok(actedReceipt && actedReceipt.outcome === "acted" && !actedReceipt.evidence, "the OPEN receipt is 'acted' with no read evidence");
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "pl.u", providerTurnId: "pt", kind: "advice", language: "en", evidenceReceiptIds: [actedReceipt.receiptId], selectedHotelIds: ["htl_alpha"], signals: ["lower_price"] } });
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "citing a no-evidence acted receipt does NOT unlock advice");
  }

  section("REV-09 — a cross-route OPEN verifies against the DESTINATION detail context");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.open", { op: "OPEN_VISIBLE_HOTEL", position: 1 }));
    eq(env.page.s.openCalls, 1, "OPEN executed");
    const beforeVerified = env.transport._receipts().filter((r) => r.outcome === "verified").length;
    // simulate the route change to the destination detail page (new generation + reg).
    env.rt.invalidateRoute("/hotels/htl_alpha");
    env.rt.registerPage({
      pageId: "hotel-detail", routeKey: "/hotels/htl_alpha",
      getSnapshot: () => C.buildHotelDetailSnapshot({ routeId: "htl_alpha", hotel: { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", starRating: 4, amenities: ["Breakfast", "Parking"], images: [], description: "x", rooms: [{ id: "r1", name: "Std", price: 3200 }] }, loading: false, loadErr: false, tab: "rooms", role: "anonymous" }),
      execute: () => {},
    });
    env.conv.onRouteChange();
    // R5B-REV-01/03 — the OPEN pending survives the route change but verifies only once the DESTINATION
    // detail context is ACKED (so the verified receipt carries a valid FULL result authority). Deliver
    // that ack; its handler reconciles the pending OPEN against the stored source resolution → verified.
    const detailPub = env.transport._lastPublish();
    env.transport._push({ t: "context.ack", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), routeEpoch: env.rt.getRouteEpoch(), contextRevision: detailPub.contextRevision, authorityRef: "auth.detail" });
    const afterVerified = env.transport._receipts().filter((r) => r.outcome === "verified" && r.operation === "OPEN_VISIBLE_HOTEL").length;
    ok(afterVerified > beforeVerified, "the OPEN is verified once the destination detail context is acknowledged (result authority present)");
    const openV = env.transport._receipts().find((r) => r.operation === "OPEN_VISIBLE_HOTEL" && r.outcome === "verified");
    ok(openV && openV.resultAuthority && openV.resultAuthority.authorityRef === "auth.detail" && openV.authorityRef === "auth.1", "R5B-REV-01/03 — the verified OPEN binds the RESULT authority (destination) distinct from the immutable SOURCE authority");
  }

  section("R3-09 — a pending OPEN is NOT verified by a manual visit WITHOUT a route transition");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.open9", { op: "OPEN_VISIBLE_HOTEL", position: 1 }));
    eq(env.page.s.openCalls, 1, "OPEN executed");
    const beforeVerified = env.transport._receipts().filter((r) => r.outcome === "verified" && r.operation === "OPEN_VISIBLE_HOTEL").length;
    // NO route transition (routeEpoch UNCHANGED): register the expected detail page in
    // place and notify. The OPEN was issued under the CURRENT epoch, so until the FIRST
    // authoritative route transition AFTER it, a manual visit must NOT verify it.
    env.rt.registerPage({
      pageId: "hotel-detail", routeKey: "/hotels/htl_alpha",
      getSnapshot: () => C.buildHotelDetailSnapshot({ routeId: "htl_alpha", hotel: { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", starRating: 4, amenities: ["Breakfast", "Parking"], images: [], description: "x", rooms: [{ id: "r1", name: "Std", price: 3200 }] }, loading: false, loadErr: false, tab: "rooms", role: "anonymous" }),
      execute: () => {},
    });
    env.conv.notifyContext();
    const afterVerified = env.transport._receipts().filter((r) => r.outcome === "verified" && r.operation === "OPEN_VISIBLE_HOTEL").length;
    eq(afterVerified, beforeVerified, "R3-09 — with NO route transition the pending OPEN stays unverified (a manual visit cannot verify it)");
  }

  section("dispose unsubscribes + tears down (a later frame is inert)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.conv.dispose();
    const stateAfter = env.conv.getState();
    const before = env.transport._receipts().length;
    env.transport._push(proposalFrame(env, "auth.1", "prop.afterdispose", { op: "READ_CURRENT_RESULTS" }));
    eq(env.transport._receipts().length, before, "no frame is handled after dispose (unsubscribed)");
    ok(env.audio.state() === "closed", "dispose tore down the audio sink");
    void stateAfter;
  }

  section("R2-08 — audio for an UN-APPROVED plan is DROPPED (browser approval gates TTS)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const g = env.conv.getGeneration();
    // No answer.plan was approved this turn. A buggy/hostile gateway pushes audio.start
    // for a plan the browser never approved → it must be dropped (no SPEAKING, no sink).
    env.transport._push({ t: "turn.state", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, state: "thinking" });
    env.transport._push({ t: "audio.start", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g, planId: "plan.unapproved", audioId: "au.x", format: { encoding: "pcm16", sampleRate: 24000, channels: 1 } });
    ok(env.conv.getState() !== "SPEAKING", "audio.start for an un-approved plan does NOT enter SPEAKING");
    ok(env.audio.isActive() === false, "no playback stream was opened for the un-approved plan");
  }

  section("R2-08 — a NEW turn SUPERSEDES: the prior approved plan's audio is dropped");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const g0 = env.conv.getGeneration();
    // approve plan.old (evidence-free clarification)
    env.transport._push({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: g0, authorityRef: "auth.1", plan: { planId: "plan.old", providerTurnId: "pt.old", kind: "clarification", language: "en", evidenceReceiptIds: [], questionCode: "which_city" } });
    ok(env.transport._approvals().some((a) => a.planId === "plan.old"), "plan.old was approved");
    // a NEW user text turn supersedes → drops the approved plan (and flushes audio)
    env.conv.submitText("show me cheaper ones");
    const newTurn = env.rt.getCurrentTurnId();
    // a LATE audio.start for plan.old (even on the CURRENT turn) is dropped — the
    // approval gate was cleared by the supersede, so no stale speech can be voiced.
    env.transport._push({ t: "audio.start", sessionId: env.rt.sessionId, turnId: newTurn, generation: env.conv.getGeneration(), planId: "plan.old", audioId: "au.old", format: { encoding: "pcm16", sampleRate: 24000, channels: 1 } });
    ok(env.conv.getState() !== "SPEAKING", "a superseded plan's audio does not enter SPEAKING");
    ok(env.audio.isActive() === false, "no stale stream opened after the supersede");
  }

  section("R2-09 — a pending OPEN that never confirms EXPIRES to ONE unknown receipt (one-transition)");
  {
    let clock = 2_000_000;
    const env = boot({}, () => clock);
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.openx", { op: "OPEN_VISIBLE_HOTEL", position: 1 }));
    eq(env.page.s.openCalls, 1, "OPEN executed (pending cross-route verification)");
    const beforeUnknown = env.transport._receipts().filter((r) => r.outcome === "unknown" && r.operation === "OPEN_VISIBLE_HOTEL").length;
    clock += 31_000; // > OPEN_VERIFY_DEADLINE_MS (30s), no destination context arrived
    env.conv.tick();
    const unknowns = env.transport._receipts().filter((r) => r.outcome === "unknown" && r.operation === "OPEN_VISIBLE_HOTEL");
    ok(unknowns.length === beforeUnknown + 1, "the un-confirmed OPEN expired to EXACTLY ONE unknown receipt");
    ok(unknowns[unknowns.length - 1].status === "verification_timeout", "R5B — the expiry receipt is outcome=unknown, status=verification_timeout (closed vocabulary)");
    // one-transition: a further tick (still within idle) emits NO second unknown.
    clock += 200; env.conv.tick();
    ok(env.transport._receipts().filter((r) => r.outcome === "unknown" && r.operation === "OPEN_VISIBLE_HOTEL").length === unknowns.length, "expiry is one-transition (no duplicate unknown receipt)");
  }

  section("R2-04 — dispose CLOSES the transport (end frame) + tears down audio");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const endsBefore = env.transport._sent.filter((x) => x.m === "end").length;
    env.conv.dispose();
    ok(env.transport._sent.filter((x) => x.m === "end").length === endsBefore + 1, "dispose sent a transport.end (closes socket + owned media + broker fetch)");
    ok(env.audio.state() === "closed", "dispose tore down the audio sink");
  }

  // ══════════════════════════ R4 AGGREGATED REMEDIATION ══════════════════════════
  section("R4-05 — the browser echoes the GATEWAY-issued executionNonce on accept + receipt");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const turnId = env.rt.getCurrentTurnId();
    // an action.proposal frame carries a gateway executionNonce as FRAME metadata.
    env.transport._push({ t: "action.proposal", sessionId: env.rt.sessionId, turnId, generation: env.conv.getGeneration(), authorityRef: "auth.1", executionNonce: "xn.gw.7", proposal: { proposalId: "prop.n", providerTurnId: "pturn.n", operation: { op: "READ_CURRENT_RESULTS" } } });
    const acc = env.transport._accepted().find((a) => a.proposalId === "prop.n");
    ok(acc && acc.executionNonce === "xn.gw.7", "R4-05 — action.accepted binds the browser actionId to the EXACT gateway executionNonce");
    const rec = env.transport._receipts().find((r) => r.proposalId === "prop.n");
    ok(rec && rec.executionNonce === "xn.gw.7", "R4-05 — the receipt echoes the EXACT gateway executionNonce");
    ok(rec && rec.actionId === acc.actionId, "R4-05 — the receipt carries the SAME actionId bound at accept time");
  }

  section("R4-04 — conversation reset() is a FULL teardown (transport.end + audio teardown → DISCONNECTED)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    const endsBefore = env.transport._sent.filter((x) => x.m === "end").length;
    env.conv.reset();
    ok(env.transport._sent.filter((x) => x.m === "end").length === endsBefore + 1, "R4-04 — reset() ENDS the transport (aborts broker + closes socket + owned media), not a soft session.reset");
    ok(env.audio.state() === "closed", "R4-04 — reset() tears down the audio sink (not just a flush)");
    eq(env.conv.getState(), "DISCONNECTED", "R4-04 — reset() lands in DISCONNECTED (a hot mic can never survive a reset)");
  }

  section("R4-04 — a terminal (non-stale) turn.error tears down transport/media BEFORE ERROR; a stale one does not");
  {
    // (a) non-stale terminal error → transport.end + ERROR.
    const env = boot();
    await bringToAck(env, "auth.1");
    const g = env.conv.getGeneration(), turnId = env.rt.getCurrentTurnId();
    const endsBefore = env.transport._sent.filter((x) => x.m === "end").length;
    env.transport._push({ t: "turn.error", sessionId: env.rt.sessionId, turnId, generation: g, code: "provider_error" });
    ok(env.transport._sent.filter((x) => x.m === "end").length === endsBefore + 1, "R4-04 — a terminal turn.error TEARS DOWN the transport/media (transport.end) before ERROR");
    eq(env.conv.getState(), "ERROR", "R4-04 — the terminal turn.error reflects ERROR after cleanup");
    // (b) a STALE turn.error keeps the session live (no teardown, IDLE).
    const env2 = boot();
    await bringToAck(env2, "auth.1");
    const g2 = env2.conv.getGeneration(), t2 = env2.rt.getCurrentTurnId();
    const ends2 = env2.transport._sent.filter((x) => x.m === "end").length;
    env2.transport._push({ t: "turn.error", sessionId: env2.rt.sessionId, turnId: t2, generation: g2, code: "stale" });
    eq(env2.transport._sent.filter((x) => x.m === "end").length, ends2, "R4-04 — a STALE turn.error does NOT tear down the transport (session stays live)");
    eq(env2.conv.getState(), "IDLE", "R4-04 — a stale turn.error idles (a superseded turn, not a session failure)");
  }

  section("R4-09 — onRouteChange reconciles a pending OPEN SYNCHRONOUSLY (wrong first destination → unknown)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    // an OPEN executes the navigation + registers a pending OPEN verification (expects the destination detail).
    env.transport._push(proposalFrame(env, "auth.1", "prop.open9", { op: "OPEN_VISIBLE_HOTEL", position: 1 }));
    eq(env.page.s.openCalls, 1, "the OPEN executed the navigation");
    const before = env.transport._receipts().length;
    // the provider bumps the route epoch + re-registers the destination (still /hotels — the WRONG page), then notifies us.
    env.rt.invalidateRoute("/hotels");
    env.rt.registerPage(env.page.reg);
    env.conv.onRouteChange();
    const openReceipt = env.transport._receipts().slice(before).find((r) => r.operation === "OPEN_VISIBLE_HOTEL");
    ok(openReceipt && openReceipt.outcome === "unknown", "R4-09 — onRouteChange consumes the pending OPEN SYNCHRONOUSLY as UNKNOWN (the first authoritative transition landed on a non-expected destination; never left pending for a later false verify)");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // R5B — browser echoes the gateway receiptId; trusts verified evidence only after the ACK
  // ══════════════════════════════════════════════════════════════════════════
  section("R5B — the browser ECHOES the gateway receiptId (never mints its own)");
  {
    const env = boot();
    await bringToAck(env, "auth.1");
    env.transport._push(proposalFrame(env, "auth.1", "prop.echo", { op: "READ_CURRENT_RESULTS" }));
    const rc = env.transport._receipts();
    ok(rc.length === 1 && rc[0].receiptId === "rc.prop.echo", "R5B — the receipt echoes the GATEWAY-minted receiptId (rc.prop.echo), never a self-minted id");
    const acc = env.transport._accepted();
    ok(acc.length === 1 && acc[0].receiptId === "rc.prop.echo", "R5B — action.accepted also echoes the gateway receiptId");
    // R5B — the READ evidence proves the EXACT ordered on-screen ids (not count only).
    ok(rc[0].evidence && rc[0].evidence.kind === "results" && Array.isArray(rc[0].evidence.orderedIds) && rc[0].evidence.orderedIds.length === rc[0].evidence.count, "R5B — results evidence carries orderedIds == count (ordered rows, not count only)");
    ok(rc[0].status === "verified", "R5B — a verified receipt uses the closed 'verified' status token");
  }
  section("R5B/R5B-REV-06 — a verified receipt is NOT trusted for an answer plan until the correlated ACK with a MATCHING commitment");
  {
    const HEX64 = /^[0-9a-f]{64}$/;
    const env = boot();
    env.transport._noAutoAck();                       // suppress the gateway ACK
    await bringToAck(env, "auth.1");
    // R5B-REV-05 — a COMPARE receipt (its cheapest winner is htl_alpha: minPrice 3200 < htl_bravo 4100)
    // backs a `lower_price` advice signal for htl_alpha. Using a signal with an EXACT verified underlying
    // value isolates the ACK-gating (the receipt must be PROMOTED before it can back the signal).
    env.transport._push(proposalFrame(env, "auth.1", "prop.na", { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] }));
    const sentReceipt = env.transport._receipts()[0];
    const rid = sentReceipt.receiptId;
    const advicePlan = (id) => ({ t: "answer.plan", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: id, providerTurnId: id, kind: "advice", language: "en", evidenceReceiptIds: [rid], selectedHotelIds: ["htl_alpha"], signals: ["lower_price"] } });
    // (a) before any ACK → downgraded (trust withheld).
    env.transport._push(advicePlan("plan.na"));
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "R5B — without the ACK the verified receipt does NOT support a plan (trust withheld)");
    // (b) R5B-REV-06 — an ACK carrying a WRONG (fabricated) commitment does NOT promote.
    ok(HEX64.test(P.terminalReceiptCommitment(sentReceipt)), "R5B-REV-06 — the commitment is a 64-hex SHA-256");
    env.transport._push({ t: "action.receipt.ack", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), receiptId: rid, proposalId: "prop.na", outcome: "verified", closed: true, commitment: "0".repeat(64) });
    env.transport._push(advicePlan("plan.na.wrong"));
    ok(/don't have a verified answer/i.test(env.conv.getLastAnswer()), "R5B-REV-06 — an ACK with a WRONG/fabricated commitment never promotes the held terminal-verified evidence");
    // (c) the correlated ACK with the EXACT commitment promotes; the SAME plan now renders.
    env.transport._push({ t: "action.receipt.ack", sessionId: env.rt.sessionId, turnId: env.rt.getCurrentTurnId(), generation: env.conv.getGeneration(), receiptId: rid, proposalId: "prop.na", outcome: "verified", closed: true, commitment: P.terminalReceiptCommitment(sentReceipt) });
    env.transport._push(advicePlan("plan.na2"));
    ok(/current results/i.test(env.conv.getLastAnswer()), "R5B-REV-06 — after the correlated ACK with the MATCHING commitment the verified receipt supports the plan");
    // (d) an ACK with a MISMATCHED proposalId does NOT promote (uncorrelated), even with a valid commitment.
    const env2 = boot();
    env2.transport._noAutoAck();
    await bringToAck(env2, "auth.1");
    env2.transport._push(proposalFrame(env2, "auth.1", "prop.mm", { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] }));
    const sent2 = env2.transport._receipts()[0];
    env2.transport._push({ t: "action.receipt.ack", sessionId: env2.rt.sessionId, turnId: env2.rt.getCurrentTurnId(), generation: env2.conv.getGeneration(), receiptId: sent2.receiptId, proposalId: "prop.WRONG", outcome: "verified", closed: true, commitment: P.terminalReceiptCommitment(sent2) });
    env2.transport._push({ t: "answer.plan", sessionId: env2.rt.sessionId, turnId: env2.rt.getCurrentTurnId(), generation: env2.conv.getGeneration(), authorityRef: "auth.1", plan: { planId: "plan.mm", providerTurnId: "pt.mm", kind: "advice", language: "en", evidenceReceiptIds: [sent2.receiptId], selectedHotelIds: ["htl_alpha"], signals: ["lower_price"] } });
    ok(/don't have a verified answer/i.test(env2.conv.getLastAnswer()), "R5B — an ACK whose proposalId does not correlate never promotes the receipt");
  }

  console.log(`\n${"─".repeat(54)}`);
  console.log(`Live AI LIVE-AI-02A conversation: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  console.log("ALL LIVE-AI-02A CONVERSATION CHECKS PASSED");
  process.exit(0);
})();
