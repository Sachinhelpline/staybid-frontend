#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// Travel Buddy — LIVE CONTROLLER OFFLINE INTEGRATION (Node, deterministic, NO network).
//   Run:  node tests/live-ai/travel-buddy-live-integration.test.js
//
// Drives the ORIGINAL browser controller stack — lib/live-ai/runtime + contracts +
// conversation + gateway-client (createGatewayTransport + createBrowserMedia +
// createInputTranscriptGate) + audio-playback — against the ORIGINAL gateway source run
// in-process (buildGateway + the staging composition; see offline-gateway/offline-gateway.js),
// through the real broker shaping (lib/live-ai/broker.ts). Fakes ONLY: the model HTTP call
// (offline keyword model), the budget store (in-memory), the WebRTC/getUserMedia browser APIs
// (fake mic + data channel carrying provider-shaped transcript events), and the audio sink.
// Also proves the Travel Buddy transcript-review bridge (lib/travel-buddy/live-bridge.ts) on the
// REAL conversation instance, and the tutorial coordination seam (lib/tutorial/buddy-coordination).
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const OG = require("./offline-gateway/offline-gateway");

const REPO = OG.REPO;
const BUILD = path.join(__dirname, ".build", "tb-live-integration");

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, l + (a === b ? "" : ` [got ${JSON.stringify(a)} want ${JSON.stringify(b)}]`)); }
function section(n) { console.log("\n• " + n); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (pred()) return true; await sleep(step || 10); } return !!pred(); }

// ── compile: the real gateway + live-ai lib (offline-gateway) and the Travel Buddy seams ──────
const net = OG.assertNoNetwork();
const compiled = OG.compileSources(path.join(BUILD, "og"));
function compileTb() {
  const SRC = path.join(BUILD, "tb", "src"), OUT = path.join(BUILD, "tb", "out");
  for (const d of ["live-ai", "travel-buddy", "tutorial"]) fs.mkdirSync(path.join(SRC, d), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
  fs.copyFileSync(path.join(REPO, "lib/travel-buddy/live-bridge.ts"), path.join(SRC, "travel-buddy", "live-bridge.ts"));
  fs.copyFileSync(path.join(REPO, "lib/tutorial/buddy-coordination.ts"), path.join(SRC, "tutorial", "buddy-coordination.ts"));
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: ["es2020", "dom"], strict: true, noEmitOnError: true },
    include: ["live-ai/**/*.ts", "travel-buddy/**/*.ts", "tutorial/**/*.ts"],
  }));
  const TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
  const r = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) { console.error("COMPILE GATE FAILED (tb):\n" + (r.stdout || "") + (r.stderr || "")); process.exit(2); }
  return OUT;
}
const TB = compileTb();
// The live-ai runtime only executes with the existing feature flag on (exactly as a V=1 build).
process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
const C = require(path.join(TB, "live-ai/contracts.js"));
const R = require(path.join(TB, "live-ai/runtime.js"));
const CONV = require(path.join(TB, "live-ai/conversation.js"));
const GC = require(path.join(TB, "live-ai/gateway-client.js"));
const A = require(path.join(TB, "live-ai/audio-playback.js"));
const BROKER = require(path.join(TB, "live-ai/broker.js"));
const BRIDGE = require(path.join(TB, "travel-buddy/live-bridge.js"));
const COORD = require(path.join(TB, "tutorial/buddy-coordination.js"));
console.log("• Local tsc compile (gateway + live-ai + travel-buddy seams): ok");

// ── fake browser media (getUserMedia + RTCPeerConnection + the provider data channel) ─────────
const MEDIA = { gum: 0, tracksStopped: 0, peers: 0, peersClosed: 0, channels: [] };
function installFakeMedia() {
  const track = () => ({ kind: "audio", stop() { MEDIA.tracksStopped++; } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => { MEDIA.gum++; const t = track(); return { getTracks: () => [t], getAudioTracks: () => [t] }; } } } });
  globalThis.RTCPeerConnection = class {
    constructor() { MEDIA.peers++; }
    addTrack() {}
    createDataChannel(label) { const dc = { label, onmessage: null, closed: false, close() { this.closed = true; } }; MEDIA.channels.push(dc); return dc; }
    async createOffer() { return { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=offline\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() { MEDIA.peersClosed++; }
  };
}
/** The provider would send these on the data channel: item created → input transcription completed. */
let itemSeq = 0;
function speak(text) {
  const dc = MEDIA.channels[MEDIA.channels.length - 1];
  if (!dc || dc.closed || typeof dc.onmessage !== "function") return false;
  const id = "item_" + (++itemSeq);
  dc.onmessage({ data: JSON.stringify({ type: "conversation.item.created", item: { id } }) });
  dc.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text }) });
  return true;
}
function runningSink() {
  const enqueued = []; let closed = false;
  return { enqueued, resume: async () => true, enqueue: (x) => enqueued.push(x.length), stopAndClear: () => { enqueued.length = 0; }, close: () => { closed = true; }, state: () => (closed ? "closed" : "running") };
}

// ── pages: the PRODUCTION snapshot builders (0 / 1 / 2+ hotels) ─────────────────────────────
const HOTELS = [
  { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi", "Parking", "Breakfast"] },
  { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["WiFi", "Breakfast"] },
  { id: "htl_charlie", name: "Charlie Cottage", city: "Dhanaulti", _minPrice: 2600, avgRating: 4.2, starRating: 3, amenities: ["Parking"] },
];
function hotelsPage(list) {
  const s = { displayHotels: list.slice(), maxPrice: null, opened: null };
  return {
    s,
    reg: {
      pageId: "hotels", routeKey: "/hotels", __state: s,
      getSnapshot: () => C.buildHotelsSnapshot({ displayHotels: s.displayHotels, city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: s.maxPrice, sort: "default", stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Parking", "Breakfast"], loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready", role: "anonymous" }),
      execute: (cmd) => {
        if (cmd.kind === "open_hotel") s.opened = { hotelId: cmd.hotelId, position: cmd.position };
        else if (cmd.kind === "apply_refinement" && "maxPrice" in cmd) {
          s.maxPrice = cmd.maxPrice; s.displayHotels = list.filter((h) => cmd.maxPrice == null || h._minPrice <= cmd.maxPrice);
          // the real /hotels page re-renders and its context revision change calls
          // LiveAiProvider.notifyContext (useLiveAiContextRevision) — emulate that render tick.
          setTimeout(() => { if (s.onRender) s.onRender(); }, 20);
        }
      },
    },
  };
}
function detailPage(hotel) {
  const s = { tab: "rooms" };
  return { s, reg: { pageId: "hotel-detail", routeKey: "/hotels/" + hotel.id, getSnapshot: () => C.buildHotelDetailSnapshot({ routeId: hotel.id, hotel, loading: false, loadErr: false, tab: s.tab, role: "anonymous" }), execute: (cmd) => { if (cmd.kind === "show_section") s.tab = cmd.section; } } };
}

/** Boot the ORIGINAL controller exactly as LiveAiProvider.tsx wires it (P=1 path). */
function bootController(gateway, brokerOpts) {
  const runtime = R.createLiveAiRuntime("anonymous");
  const broker = OG.makeBrokerFetch(gateway, BROKER, brokerOpts);
  const origFetch = broker.fetchImpl;
  broker.fetchImpl = async (u, i) => { const r = await origFetch(u, i); ALL_CALLS.push(broker.calls[broker.calls.length - 1]); return r; };
  const sock = OG.makeSocketOpener(gateway);
  GW_REF.g = gateway;
  const ref = { conv: null };
  const transport = GC.createGatewayTransport({
    fetchImpl: broker.fetchImpl, openSocket: sock.openSocket,
    createMediaSession: () => GC.createBrowserMedia({
      onFinalTranscript: (t) => { try { ref.conv && ref.conv.submitText(t); } catch { /* no-op */ } },
      currentGeneration: () => { try { return ref.conv ? ref.conv.getGeneration() : 0; } catch { return 0; } },
    }),
  });
  const sink = runningSink();
  const events = [];
  const conv = CONV.createConversation({ runtime, transport, audio: A.createAudioPlayback({ sink }), onEvent: (e) => events.push(e) });
  ref.conv = conv;
  if (process.env.TB_DEBUG) { const orr = runtime.reconcile.bind(runtime); runtime.reconcile = () => { const r = orr(); const sn = runtime.publishedContext(); console.log("DEBUG reconcile", Date.now() % 100000, JSON.stringify(r) && JSON.stringify(r).slice(0, 60)); return r; }; }
  // LiveAiProvider.tsx:273 — the provider ticks the controller every 5 s (reconcile + sweep).
  const tickTimer = setInterval(() => { try { conv.tick(); } catch { /* no-op */ } }, 5_000);
  if (tickTimer.unref) tickTimer.unref();
  const origRegister = runtime.registerPage.bind(runtime);
  runtime.registerPage = (reg) => { const tok = origRegister(reg); if (reg && reg.__state) reg.__state.onRender = () => conv.notifyContext(); return tok; };
  return { runtime, conv, transport, broker, sock, events, sink };
}
/** Provider.submitText semantics (buffer on DISCONNECTED/ERROR/OFFLINE → start("text") → flush on IDLE). */
function providerSubmit(env, text) {
  const st = env.conv.getState();
  if (st === "DISCONNECTED" || st === "OFFLINE" || st === "ERROR") {
    if (st !== "DISCONNECTED") env.conv.end("user");
    let flushed = false;
    const off = setInterval(() => { if (!flushed && env.conv.getState() === "IDLE") { flushed = true; clearInterval(off); env.conv.submitText(text); } }, 5);
    setTimeout(() => clearInterval(off), 6000);
    void env.conv.start("text");
    return;
  }
  env.conv.submitText(text);
}
const ALL_CALLS = [];
function aliveSessions() { return ALL_CALLS.map((c) => c.gatewaySessionId).filter(Boolean).filter((id) => { const x = GW_REF.g && GW_REF.g.liveAiCtx.store.get(id); return x && !x.terminated; }); }
const GW_REF = { g: null };
let subjN = 0;
const nextSubject = () => OG.SUBJECTS[subjN++];
const assistantSince = (env, t0) => env.conv.getMemory().filter((m) => m.role === "assistant" && m.at >= t0).map((m) => m.text);

(async () => {
  installFakeMedia();
  const gateway = await OG.createOfflineGateway({ compiled });
  if (process.env.TB_DEBUG) {
    for (const k of ["accept03bAction", "resume03bObservation"]) {
      const orig = gateway.liveAiCtx[k];
      gateway.liveAiCtx[k] = async (sess, x) => { const r = await orig(sess, x); console.log("DEBUG", k, JSON.stringify(r), JSON.stringify(x).slice(0, 900)); return r; };
    }
  }

  section("G1 Typed turn → ORIGINAL controller → REAL gateway (03B staging route) → verified compiled answer");
  {
    const env = bootController(gateway, { route: "staging", subject: nextSubject() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const bridge = BRIDGE.installTranscriptReview(env.conv, () => {});
    const t0 = Date.now();
    bridge.allow("show me the stays");
    providerSubmit(env, "show me the stays");
    ok(await until(() => assistantSince(env, t0).length > 0, 8000), "an assistant answer reached the controller memory");
    if (process.env.TB_DEBUG) console.log("DEBUG", JSON.stringify({ frames: gateway.frames, state: env.conv.getState(), events: env.events.slice(-12), conn: env.transport.getConnectionState() }));
    const ans = assistantSince(env, t0)[0] || "";
    ok(/3 matching stays are shown\.?/i.test(ans), `the answer is the IC02-compiled results sentence for the 3 visible hotels (got "${ans}")`);
    eq(env.broker.calls[0] && env.broker.calls[0].gatewayStatus, 200, "the REAL gateway session handler minted the session (200)");
    ok(env.sock.opened[0] && env.sock.opened[0].protocols[0] === "live-ai.control.v1" && /^sbt\./.test(env.sock.opened[0].protocols[1]), "the control socket carried the real subprotocol pair (live-ai.control.v1 + sbt.<token>)");
    const kinds = gateway.frames.map((f) => f.dir + ":" + f.t);
    ok(kinds.includes("s2c:connection.ready") && kinds.includes("c2s:context.publish") && kinds.includes("s2c:context.ack"), "connection.ready → context.publish → context.ack handshake happened on the wire");
    ok(kinds.includes("s2c:action.proposal") && kinds.includes("c2s:action.accepted") && kinds.includes("c2s:action.receipt") && kinds.includes("s2c:answer.compiled"), "proposal → accepted → receipt → answer.compiled (the real 03A/IC02 lifecycle)");
    eq(gateway.model.calls.length, 1, "exactly ONE (fake) model call for the turn");
    eq(gateway.model.calls[0].intent, "READ_RESULTS", "the offline model planned READ_RESULTS from the guest's words");
    eq(bridge.divertedCount(), 0, "the pre-authorised typed text passed the review gate unchanged");
    bridge.uninstall();
    env.conv.end("user");
  }

  section("G2 0 / 1 / 2+ hotels — the answer counts only what is on screen (real compiler)");
  for (const [n, want] of [[1, /1 matching stay is shown|1 matching stays are shown/i], [2, /2 matching stays are shown/i]]) {
    const env = bootController(gateway, { route: "staging", subject: nextSubject() });
    const page = hotelsPage(HOTELS.slice(0, n));
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(want.test(ans), `${n} visible hotel(s) → "${ans}"`);
    env.conv.end("user");
  }
  {
    const env = bootController(gateway, { route: "staging", subject: nextSubject() });
    const page = hotelsPage([]);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0 || env.conv.getState() === "ERROR", 8000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(!/[1-9] matching stay/i.test(ans), `0 visible hotels never yields a positive count (answer="${ans}", state=${env.conv.getState()})`);
    env.conv.end("user");
  }

  section("G3 Refinement + transactional refusal (no write authority)");
  {
    const env = bootController(gateway, { route: "staging", subject: nextSubject() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const t0 = Date.now();
    providerSubmit(env, "book the first one and pay now");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(ans.length > 0 && !/booked|paid|confirmed/i.test(ans), `a booking/payment ask gets a bounded clarification, never a completion claim ("${ans}")`);
    eq(gateway.model.calls[gateway.model.calls.length - 1].intent, "CLARIFY", "the plan was a CLARIFY (TRANSACTIONAL_NOT_ENABLED)");
    eq(page.s.opened, null, "no hotel was opened by a transactional ask");
    env.conv.end("user");
  }

  section("G4 Voice: REAL createBrowserMedia + transcript gate → bridge diverts to REVIEW (never auto-submitted)");
  {
    const before = gateway.model.calls.length;
    const env = bootController(gateway, { route: "staging", subject: nextSubject(), micShim: true });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const reviewed = [];
    const bridge = BRIDGE.installTranscriptReview(env.conv, (t) => reviewed.push(t));
    const gum0 = MEDIA.gum;
    const res = await env.conv.start("microphone");
    const micCall = env.broker.calls[env.broker.calls.length - 1];
    console.log(`    (real gateway microphone session-create → ${micCall.gatewayStatus}${micCall.gatewayError ? " " + micCall.gatewayError : ""}; shim=${micCall.shim})`);
    ok(res.ok === true, "the explicit microphone start resolved through the ORIGINAL transport" + (res.ok ? "" : ` (code=${res.code}, gum=${MEDIA.gum - gum0}, broker=${JSON.stringify(env.broker.calls.slice(-1))})`));
    eq(MEDIA.gum - gum0, 1, "getUserMedia was requested exactly once — only by the explicit start");
    await until(() => env.conv.getState() === "IDLE", 3000);
    const framesBefore = gateway.frames.length;
    ok(speak("show me the stays"), "the (fake) provider data channel delivered an input transcription");
    await sleep(50);
    eq(reviewed.length, 1, "the final transcript was DIVERTED to the review card");
    eq(reviewed[0], "show me the stays", "the review card receives the verbatim transcript");
    eq(gateway.model.calls.length, before, "NOTHING reached the model before review (zero model calls)");
    ok(!gateway.frames.slice(framesBefore).some((f) => f.dir === "c2s" && f.t === "turn.text"), "no turn.text frame was sent for the raw transcript");
    // Guest confirms → Teddy barges in (closes the capture), then submits the reviewed text.
    const stopped0 = MEDIA.tracksStopped;
    env.conv.bargeIn();
    await until(() => env.conv.getState() === "DISCONNECTED", 2000);
    ok(MEDIA.tracksStopped > stopped0, "barge-in STOPPED the real mic tracks (capture closed by the original transport)");
    // the guest reads/edits the review card; meanwhile the gateway terminates the closed mic session
    ok(await until(() => aliveSessions().length === 0, 3000), "the gateway terminated the mic session once its control socket closed (before the reviewed text is sent)");
    const t0 = Date.now();
    bridge.allow("show me the stays");
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(/^3 matching stays are shown\.?$/i.test(ans), `the REVIEWED voice text took the SAME controller path and got the verified answer ("${ans}")`);
    eq(gateway.model.calls[gateway.model.calls.length - 1].text, "show me the stays", "the model saw exactly the REVIEWED text");
    eq(env.broker.calls.length, 2, "FINDING G-RATE: one reviewed voice turn costs TWO gateway session starts (mic capture session + the reviewed-text session)");
    bridge.uninstall();
    env.conv.end("user");
  }

  section("G4b Advanceable op (refinement): applied on screen → in-turn IC01 rebind → verified answer or explicit error (G-REBIND fixed)");
  {
    const env = bootController(gateway, { route: "staging", subject: nextSubject() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const f0 = gateway.frames.length;
    const m0 = gateway.model.calls.length;
    const t0 = Date.now();
    providerSubmit(env, "show me stays under 3500");
    await until(() => gateway.frames.slice(f0).filter((f) => f.dir === "c2s" && f.t === "action.receipt").length >= 2, 12000);
    await sleep(800);
    eq(gateway.model.calls[m0] && gateway.model.calls[m0].intent, "REFINE_RESULTS", "the offline model planned the max-price refinement");
    eq(page.s.maxPrice, 3500, "the validated refinement was applied to the page by the ORIGINAL runtime");
    eq(gateway.frames.slice(f0).filter((f) => f.dir === "c2s" && f.t === "action.receipt").length, 2, "the browser sent acted → (after the 5 s reconcile tick) verified receipts");
    const compiled = gateway.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "answer.compiled");
    const errored = gateway.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "turn.error");
    await until(() => assistantSince(env, t0).length > 0 || gateway.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "turn.error"), 12000);
    const compiled2 = gateway.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "answer.compiled");
    const errored2 = gateway.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "turn.error");
    const ans = assistantSince(env, t0)[0] || "";
    console.log(`    (G-REBIND: answer.compiled=${compiled2 || compiled} turn.error=${errored2 || errored} answer="${ans}" controller=${env.conv.getState()} after ${Date.now() - t0} ms)`);
    // CHANGED EXPECTATION (gap closed, disclosed): the turn is NEVER silent any more.
    ok(compiled2 || errored2, "G-REBIND FIXED: an advanceable result now yields a compiled answer OR an explicit turn.error (never a silent stall)");
    ok(!compiled2 || ans.length > 0, "a compiled post-rebind answer is ACCEPTED by the browser's full-binding verifier (rendered, not dropped as stale)");
    ok(gateway.model.calls.slice(m0).some((c) => c.intent === "READ_RESULTS"), "the accepted IC01 REBIND happened: the same turn REPLANNED against the advanced context (a READ of the refined results)");
    // NOTE (honest): under the STAGING composition the replanned capability is refused (one execution admission
    // per SESSION) ⇒ an explicit turn.error. The PUBLIC composition (one bounded admission lease PER TURN) carries
    // the same turn to a verified answer — proven in tests/live-ai/travel-buddy-real-teddy.test.js.
    env.conv.end("user");
  }

  section("G4c OPEN → route change to the hotel detail → facts on the SAME session (as LiveAiProvider wires it)");
  {
    const env = bootController(gateway, { route: "staging", subject: nextSubject() });
    const list = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(list.reg);
    const f0 = gateway.frames.length;
    providerSubmit(env, "open the first one");
    await until(() => !!list.s.opened, 8000);
    eq(list.s.opened && list.s.opened.hotelId, "htl_alpha", "OPEN executed by the original runtime (first visible hotel)");
    // the app navigates; LiveAiProvider: runtime.invalidateRoute(path) → the detail page registers → conversation.onRouteChange()
    const det = detailPage(Object.assign({}, HOTELS[0], { rooms: [{ id: "r1", name: "Deluxe", capacity: 2, floorPrice: 3200 }] }));
    env.runtime.invalidateRoute("/hotels/htl_alpha");
    env.runtime.registerPage(det.reg);
    env.conv.onRouteChange();
    await sleep(300);
    const t1 = Date.now();
    providerSubmit(env, "is breakfast included");
    await until(() => assistantSince(env, t1).length > 0 || env.conv.getState() === "ERROR", 9000);
    const ans = assistantSince(env, t1)[0] || "";
    const fr = gateway.frames.slice(f0).map((f) => f.dir + ":" + f.t);
    console.log(`    (detail facts: state=${env.conv.getState()} answer="${ans}" lastModel=${JSON.stringify(gateway.model.calls[gateway.model.calls.length - 1] && gateway.model.calls[gateway.model.calls.length - 1].text)} frames=${fr.join(",")})`);
    ok(/breakfast/i.test(ans), `facts on the detail page → a compiled hotel-facts sentence ("${ans}")`);
    env.conv.end("user");
  }

  section("G5 Stop / barge-in / stale generation + bridge restore");
  {
    const env = bootController(gateway, { route: "staging", subject: nextSubject(), micShim: true });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const reviewed = [];
    const pristine = env.conv.submitText;
    const bridge = BRIDGE.installTranscriptReview(env.conv, (t) => reviewed.push(t));
    ok(env.conv.submitText !== pristine, "install patched the controller's submitText boundary");
    await env.conv.start("microphone");
    await until(() => env.conv.getState() === "IDLE", 3000);
    const dc = MEDIA.channels[MEDIA.channels.length - 1];
    dc.onmessage({ data: JSON.stringify({ type: "conversation.item.created", item: { id: "late_1" } }) });
    env.conv.bargeIn(); // Stop before the transcript completes
    dc.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "late_1", transcript: "stale words" }) });
    await sleep(30);
    eq(reviewed.length, 0, "a transcript completing AFTER Stop is dropped (stale generation / closed media)");
    bridge.uninstall();
    ok(env.conv.submitText === pristine, "uninstall restored the controller's ORIGINAL submitText (identity)");
    const b2 = BRIDGE.installTranscriptReview(env.conv, () => {});
    const b3 = BRIDGE.installTranscriptReview(env.conv, () => {});
    const live3 = env.conv.submitText;
    b2.uninstall(); // superseded: must NOT clobber b3's live patch
    ok(env.conv.submitText === live3 && live3 !== pristine, "a second install supersedes the first; a stale uninstall never clobbers the live patch");
    b3.uninstall();
    ok(env.conv.submitText === pristine, "the final uninstall restores the original method");
    env.conv.end("user");
  }

  section("G6 PUBLIC broker mirror (auth:false, pseudonymous subject) — the verified 03B route is NOT reachable");
  {
    const env = bootController(gateway, { route: "public" });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const before = gateway.model.calls.length;
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => env.conv.getState() === "ERROR" || assistantSince(env, t0).length > 0 || (env.broker.calls[0] && env.broker.calls[0].gatewayStatus !== 200), 6000);
    const call = env.broker.calls[0] || {};
    console.log(`    (public session-create → ${call.gatewayStatus}${call.gatewayError ? " " + call.gatewayError : ""}; controller state=${env.conv.getState()})`);
    eq(assistantSince(env, t0).length, 0, "a public (auth:false) session produces NO answer — fails closed, never a guess");
    eq(gateway.model.calls.length, before, "and makes ZERO model calls");
    env.conv.end("user");
  }

  section("G6b REAL per-subject start limit (config.ts authStartsPer15Min=5 / anonStartsPer15Min=3)");
  {
    const subject = nextSubject();
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await gateway.createSession({ mode: "text", sessionId: "las.rate" + i }, { route: "staging", subject, ip: "10.20.30.40" });
      statuses.push(r.status + (r.body && r.body.error ? ":" + r.body.error : ""));
      const s = r.body && r.body.gatewaySessionId ? gateway.liveAiCtx.store.get(r.body.gatewaySessionId) : null;
      if (s) gateway.liveAiCtx.store.terminate(s, "closed");
    }
    console.log("    (6 starts for one authenticated subject → " + statuses.join(", ") + ")");
    eq(statuses.filter((x) => x === "200").length, 5, "5 starts are admitted within 15 minutes for one authenticated subject");
    ok(/^429:start_rate_15m$/.test(statuses[5]), "the 6th start is refused (429 start_rate_15m) — with 2 starts per voice turn a signed-in guest gets ~2 voice turns per 15 min");
  }

  section("G7 Tutorial coordination seam (R2)");
  {
    const seen = [];
    const off = COORD.subscribeTour((k) => seen.push(k));
    COORD.setTourActive("explore");
    eq(COORD.getActiveTour(), "explore", "a running tour is visible to Buddy");
    COORD.setTourActive("explore");
    COORD.setTourActive(null);
    off();
    COORD.setTourActive("other");
    ok(seen.length === 2 && seen[0] === "explore" && seen[1] === null, "listeners hear start + end once each; an unsubscribed listener hears nothing");
    COORD.setTourActive(null);
    COORD.setBuddyEngaged(true);
    eq(COORD.isBuddyEngaged(), true, "Buddy engagement is visible to the tour hooks");
    COORD.setBuddyEngaged(false);
    const src = fs.readFileSync(path.join(REPO, "lib/tutorial/usePageTour.ts"), "utf8");
    ok(/if \(!options\.force && isBuddyEngaged\(\)\) return;/.test(src) && /setTourActive\(key\)/.test(src) && /endTour\(key\)/.test(src), "usePageTour skips auto-fire while Buddy is engaged and reports tour start/end");
    const ws = fs.readFileSync(path.join(REPO, "components/tutorial/WelcomeStory.tsx"), "utf8");
    ok(/if \(isBuddyEngaged\(\)\) return;/.test(ws) && /setTourActive\("welcome"\)/.test(ws) && /endTour\("welcome"\)/.test(ws), "the first-visit WelcomeStory defers while Buddy is engaged and makes Buddy step aside while open");
    COORD.setTourActive("explore"); COORD.endTour("welcome");
    eq(COORD.getActiveTour(), "explore", "a stale end of another overlay never clears the running tour");
    COORD.endTour("explore");
    eq(COORD.getActiveTour(), null, "ending the named tour clears it");
    const mount = fs.readFileSync(path.join(REPO, "components/tutorial/TutorialTriggerMount.tsx"), "utf8");
    ok(/setTourActive\(/.test(mount), "TutorialTriggerMount reports its tours too");
    ok(!/sb_tutorial_disabled/.test(fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8")), "Travel Buddy never sets the QA tour opt-out");
  }

  section("G9 R3 — hotel-detail POST /api/pricing/spine: SOURCE-ONLY characterization (never executed here)");
  {
    const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const route = strip(fs.readFileSync(path.join(REPO, "app/api/pricing/spine/route.ts"), "utf8"));
    const reader = strip(fs.readFileSync(path.join(REPO, "lib/pricing/read-spine.ts"), "utf8"));
    const cfg = strip(fs.readFileSync(path.join(REPO, "lib/pricing/engine-config-store.ts"), "utf8"));
    const page = fs.readFileSync(path.join(REPO, "app/hotels/[id]/page.tsx"), "utf8");
    ok(/export async function POST\(/.test(route) && !/export async function (GET|PUT|PATCH|DELETE)\(/.test(route), "the route exports ONLY POST");
    ok(!/userFromReq|socialUserFromReq|requireVerifiedAdmin|authorization|x-partner-token/i.test(route), "no auth gate: any caller may POST (it is a public read, by design)");
    ok(/resolveSpinePrices\(/.test(route) && /resolveSpinePricesRange\(/.test(route) && !/sbInsert|sbUpsert|sbPatch|sbDelete|method:\s*"(POST|PATCH|PUT|DELETE)"/.test(route), "the route only calls the two spine READERS; it issues no write");
    ok(/import \{ sbSelect \} from "@\/lib\/onboard\/supabase-admin"/.test(reader) && !/sbInsert|sbUpsert|sbPatch|sbDelete|method:/.test(reader), "the reader imports ONLY sbSelect (a GET) — no insert/upsert/patch/delete");
    ok(!/method:/.test(cfg.slice(cfg.indexOf("export async function resolveEngineConfig"), cfg.indexOf("export async function resolveEngineConfig") + 1500)), "the engine-config read is a plain GET (no method override)");
    ok(/Always 200/.test(fs.readFileSync(path.join(REPO, "app/api/pricing/spine/route.ts"), "utf8")) && /catch \(e: any\) \{\s*return NextResponse\.json\(\{ prices: \{\}/.test(route), "failure → 200 with an empty map (callers fall back to local compute)");
    ok(/fetch\("\/api\/pricing\/spine", \{\s*method: "POST"/.test(page) && /If\s+\/\/ the spine is unreachable the local price stands|the spine is unreachable the local price stands/.test(page.replace(/\n\s*\/\/\s*/g, " ")), "hotel detail POSTs it for display prices and keeps its local price if it fails (fail-open read)");
    ok(!/pricing\/spine/.test(fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8")) && !/pricing\/spine/.test(fs.readFileSync(path.join(REPO, "lib/travel-buddy/live-bridge.ts"), "utf8")), "Travel Buddy never calls it; the preview/smoke DENY it (403) and the detail page still renders");
  }

  section("G8 Network + frozen-source guards");
  {
    eq(net.attempts.length, 0, "ZERO process-level network attempts during the whole run");
    ok(gateway.model.calls.every((c) => c.url === "https://api.openai.com/v1/responses"), "every model call went to the injected OFFLINE fake (the real fixed endpoint string was never fetched)");
    // CHANGED EXPECTATION (REAL-TEDDY consolidated batch, disclosed): conversation, LiveAiProvider, the customer
    // broker route and the declared gateway files are now INTENTIONALLY changed (G-PUBLIC/REBIND/MIC/RATE/TTS/TIER);
    // their exact changed-file allowlist is enforced by tests/live-ai/travel-buddy-real-teddy.test.js. Everything
    // below MUST still be byte-unchanged vs HEAD (frozen core + the whole BUDGET / IC01 / 03A / IC02 / P7 surface).
    const diff = cp.spawnSync("git", ["diff", "--quiet", "HEAD", "--", "lib/live-ai/broker.ts", "lib/live-ai/runtime.ts", "lib/live-ai/contracts.ts", "lib/live-ai/protocol.ts", "lib/live-ai/transport.ts", "lib/live-ai/audio-playback.ts", "lib/live-ai/compiled-answer-consumer.ts", "app/api/live-ai/staging", "server/voice-gateway/live-ai-budget-authority.ts", "server/voice-gateway/live-ai-budget-store.ts", "server/voice-gateway/live-ai-budget-control.ts", "server/voice-gateway/live-ai-budget-pricing.ts", "server/voice-gateway/live-ai-agent-loop.ts", "server/voice-gateway/live-ai-execution-safety.ts", "server/voice-gateway/live-ai-answer-compiler.ts", "server/voice-gateway/live-ai-capability-registry.ts", "server/voice-gateway/live-ai-intelligence-contract.ts", "server/voice-gateway/live-ai-schemas.ts", "server/voice-gateway/live-ai-sessions.ts", "server/voice-gateway/live-ai-control-socket.ts", "server/voice-gateway/auth.ts", "server/voice-gateway/openai-transcription.ts", "server/voice-gateway/openai-tts.ts", "server/voice-gateway/openai-realtime.ts", "server/voice-gateway/rate-limit.ts"], { cwd: REPO });
    eq(diff.status, 0, "broker helpers, runtime, contracts, protocol, transport, audio, consumer, staging routes and the BUDGET / IC01 / 03A / IC02 / sessions / control-socket / auth / provider-adapter / rate-limit gateway files are byte-unchanged vs HEAD");
    // G-GATE (Candidate01) + G-RATE opt-in + G-PUBLIC helpers — the gateway-client changes, structurally pinned.
    const gsrc0 = fs.readFileSync(path.join(REPO, "lib/live-ai/gateway-client.ts"), "utf8");
    ok(/if \(deps\.retainSessionAfterCapture === true && installedOwner && installedOwner\.mode === "microphone"\)/.test(gsrc0)
      && /const holder = \(installedOwner && installedOwner\.mode === "microphone"\) \? installedOwner\s*:\s*\(pendingOwner && pendingOwner\.mode === "microphone"\) \? pendingOwner\s*:\s*null;\s*if \(holder\) disposeTransport\("disconnected"\);/.test(gsrc0),
      "gateway-client.ts: the accepted R5C full-teardown path is intact; the one-session capture release is OPT-IN only (G-RATE)");
    ok(/export function resolvePublicAdmissionClientGate\(\): boolean \{\s*return process\.env\.NEXT_PUBLIC_LIVE_AI_PUBLIC_ADMISSION === "1";/.test(gsrc0), "gateway-client.ts: the public-admission client gate is a LITERAL process.env member read (G-GATE / G-PUBLIC)");
    const gsrc = fs.readFileSync(path.join(REPO, "lib/live-ai/gateway-client.ts"), "utf8");
    ok(/NEXT_PUBLIC_VOICE_AI_BETA: process\.env\.NEXT_PUBLIC_VOICE_AI_BETA/.test(gsrc) && /NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA: process\.env\.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA/.test(gsrc), "the flags are LITERAL process.env member reads (inlined by Next into client bundles)");
    const saved = { v: process.env.NEXT_PUBLIC_VOICE_AI_BETA, p: process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA };
    delete process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA;
    eq(GC.resolveClientGates().provider, false, "fail-closed: P unset ⇒ provider gate OFF");
    process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA = "true";
    eq(GC.resolveClientGates().provider, false, "non-exact P ⇒ OFF");
    process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA = "1"; delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
    eq(GC.resolveClientGates().provider, false, "P without V ⇒ OFF");
    process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
    eq(GC.resolveClientGates().provider, true, "V=1 and P=1 ⇒ ON (as designed)");
    if (saved.v === undefined) delete process.env.NEXT_PUBLIC_VOICE_AI_BETA; else process.env.NEXT_PUBLIC_VOICE_AI_BETA = saved.v;
    if (saved.p === undefined) delete process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA; else process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA = saved.p;
  }

  await gateway.close();
  net.restore();
  console.log(`\nTravel Buddy LIVE controller offline integration: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("HARNESS EXCEPTION:", e && e.stack || e); process.exit(1); });
