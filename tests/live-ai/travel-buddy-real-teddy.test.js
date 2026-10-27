#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// REAL TEDDY — consolidated public-production gap closure: OFFLINE proof suite (Node, deterministic,
// NO network, NO credential, NO provider). Run:  node tests/live-ai/travel-buddy-real-teddy.test.js
//
// Drives the ORIGINAL browser controller (runtime + conversation + gateway-client + audio-playback)
// against the ORIGINAL gateway source in-process (buildGateway) composed with the NEW public composition
// (server/voice-gateway/live-ai-public-main.ts → the released BudgetCore / 03A / catalog seams). Fakes
// ONLY: the model HTTP call (offline keyword model), the budget store (in-memory, strict refusal mode),
// the TTS + realtime-transcription provider seams (fake adapters at the existing injection points), the
// WebRTC/getUserMedia browser APIs and the audio sink. NOTHING here is real-provider proof: it proves the
// wiring, gates, ordering, fail-closed behaviour and caps around the provider seams.
// Sections: P1 gates · P2 broker admission · P3 public composition · P4 public text turn · P5 admission
// negatives · P6 G-REBIND · P7 G-TTS · P8 G-MIC + G-RATE one-session · P9 rate/concurrency/caps/restart ·
// P10 kill switch + revoked CUT · P11 R3 read-only · P12 exact changed-file allowlist + frozen surfaces.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const crypto = require("crypto");
const OG = require("./offline-gateway/offline-gateway");

const REPO = OG.REPO;
const BUILD = path.join(__dirname, ".build", "tb-real-teddy");

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
// DIAGNOSTIC-ONLY FIX (TEMPORARY tts-1 FALLBACK reconciliation): JSON.stringify throws on a BigInt, which crashed the
// suite while REPORTING a failed money assertion. Render BigInts as "<n>n"; the pass/fail decision (a === b) is unchanged.
const show = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() + "n" : x));
function eq(a, b, l) { ok(a === b, l + (a === b ? "" : ` [got ${show(a)} want ${show(b)}]`)); }
function section(n) { console.log("\n• " + n); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (pred()) return true; await sleep(step || 10); } return !!pred(); }

const net = OG.assertNoNetwork();
const compiled = OG.compileSources(path.join(BUILD, "og"));
process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
const CFG = require(path.join(compiled.GW, "config.js"));
const PUB = require(path.join(compiled.GW, "live-ai-public-main.js"));
const PRICING = require(path.join(compiled.GW, "live-ai-budget-pricing.js"));
const RESP = require(path.join(compiled.GW, "openai-responses.js"));
const C = require(path.join(compiled.LIB, "contracts.js"));
const R = require(path.join(compiled.LIB, "runtime.js"));
const CONV = require(path.join(compiled.LIB, "conversation.js"));
const GC = require(path.join(compiled.LIB, "gateway-client.js"));
const A = require(path.join(compiled.LIB, "audio-playback.js"));
const BROKER = require(path.join(compiled.LIB, "broker.js"));
const ADM = require(path.join(compiled.LIB, "public-admission.js"));
console.log("• Local tsc compile (gateway + public composition + live-ai lib): ok");

// ── fake browser media + sink (same shapes the Candidate01 integration suite uses) ─────────────
const MEDIA = { gum: 0, tracksStopped: 0, peersClosed: 0, channels: [] };
function installFakeMedia() {
  const track = () => ({ kind: "audio", stop() { MEDIA.tracksStopped++; } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => { MEDIA.gum++; const t = track(); return { getTracks: () => [t], getAudioTracks: () => [t] }; } } } });
  globalThis.RTCPeerConnection = class {
    addTrack() {}
    createDataChannel(label) { const dc = { label, onmessage: null, closed: false, close() { this.closed = true; } }; MEDIA.channels.push(dc); return dc; }
    async createOffer() { return { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=offline\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() { MEDIA.peersClosed++; }
  };
}
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
      getSnapshot: () => C.buildHotelsSnapshot({ displayHotels: s.displayHotels, city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: s.maxPrice, sort: "default", stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Parking", "Breakfast"], loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready", role: "customer" }),
      execute: (cmd) => {
        if (cmd.kind === "open_hotel") s.opened = { hotelId: cmd.hotelId, position: cmd.position };
        else if (cmd.kind === "apply_refinement" && "maxPrice" in cmd) {
          s.maxPrice = cmd.maxPrice; s.displayHotels = list.filter((h) => cmd.maxPrice == null || h._minPrice <= cmd.maxPrice);
          setTimeout(() => { if (s.onRender) s.onRender(); }, 20);
        }
      },
    },
  };
}
/** Boot the ORIGINAL controller as LiveAiProvider wires it in a PUBLIC build (retain + speak options). */
function bootController(gateway, brokerOpts, o) {
  const opts = o || {};
  const runtime = R.createLiveAiRuntime("customer");
  const broker = OG.makeBrokerFetch(gateway, BROKER, Object.assign({ ip: nextIp() }, brokerOpts));
  const sock = OG.makeSocketOpener(gateway);
  const ref = { conv: null };
  const transport = GC.createGatewayTransport({
    fetchImpl: broker.fetchImpl, openSocket: sock.openSocket,
    retainSessionAfterCapture: opts.retain === true,
    createMediaSession: () => GC.createBrowserMedia({
      onFinalTranscript: (t) => { try { ref.conv && ref.conv.submitText(t); } catch { /* no-op */ } },
      currentGeneration: () => { try { return ref.conv ? ref.conv.getGeneration() : 0; } catch { return 0; } },
    }),
  });
  const sink = runningSink();
  const events = [];
  const speakRef = { on: opts.speak === true };
  const conv = CONV.createConversation({
    runtime, transport, audio: A.createAudioPlayback({ sink }), onEvent: (e) => events.push(e),
    ...(opts.speakOption === false ? {} : { speakCompiledAnswers: () => speakRef.on }),
  });
  ref.conv = conv;
  const tickTimer = setInterval(() => { try { conv.tick(); } catch { /* no-op */ } }, 5_000);
  if (tickTimer.unref) tickTimer.unref();
  const origRegister = runtime.registerPage.bind(runtime);
  runtime.registerPage = (reg) => { const tok = origRegister(reg); if (reg && reg.__state) reg.__state.onRender = () => conv.notifyContext(); return tok; };
  return { runtime, conv, transport, broker, sock, events, sink, speakRef, stop() { clearInterval(tickTimer); } };
}
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
const assistantSince = (env, t0) => env.conv.getMemory().filter((m) => m.role === "assistant" && m.at >= t0).map((m) => m.text);
let custN = 0, ipN = 0;
const nextIp = () => "10.0." + Math.floor(++ipN / 250) + "." + ((ipN % 250) + 1);   // distinct client per controller (per-IP caps)
const nextCustomer = () => "pub1." + crypto.createHash("sha256").update("offline-customer-" + (++custN)).digest("hex");

// fake TTS + transcription provider seams (counted; NEVER a network call)
function fakeTts() {
  const calls = [];
  // CHANGED FIXTURE (TEMPORARY tts-1 FALLBACK): the fake adapter reports the bound TTS model (was gpt-4o-mini-tts).
  return { calls, adapter: { available: true, model: "tts-1", async synthesize(input) { calls.push({ text: input.text, language: input.language }); return { ok: true, chunks: [{ seq: 0, bytes: Buffer.alloc(480).toString("base64") }, { seq: 1, bytes: Buffer.alloc(480).toString("base64") }], usage: input.text.length }; } } };
}
function fakeTranscription() {
  const calls = [];
  return { calls, adapter: { available: true, model: "gpt-live-transcribe", async transcribe() { return { ok: false, reason: "unused" }; }, async negotiate(offer) { calls.push(offer.length); return { ok: true, answerSdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=offline-realtime\r\n" }; } } };
}

(async () => {
  installFakeMedia();

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  section("P1 G-GATE / G-PUBLIC — gateway admission predicates (exhaustive truth table, fail closed)");
  {
    const base = { OPENAI_API_KEY: "placeholder-not-a-credential" };
    const PUBSUB = "pub1." + "a".repeat(64);
    const STGSUB = "stg1." + "b".repeat(64);
    let rows = 0, bad = 0;
    for (const gate of [undefined, "0", "1", "true", " 1"]) for (const key of [true, false]) for (const auth of [true, false]) for (const subj of [PUBSUB, STGSUB, "px.abcdef0123456789", "pub1.short", "pub1." + "A".repeat(64), ""]) {
      const env = Object.assign({}, key ? base : {}, gate === undefined ? {} : { LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: gate });
      const c = CFG.loadLiveAiConfig(env);
      const want = gate === "1" && key && auth === true && /^pub1\.[0-9a-f]{64}$/.test(subj);
      rows++; if (CFG.liveAi03bPublicSessionAllowed(c, auth, subj) !== want) bad++;
      if (CFG.liveAi03bStagingSessionAllowed(c, auth, subj) !== false) bad++;            // staging route untouched (no allowlist configured)
      if (CFG.liveAi03bRouteAllowed(c, auth, subj) !== want) bad++;
    }
    eq(bad, 0, `public predicate === (gate exactly "1" ∧ provider key ∧ auth:true ∧ exact pub1.<64 hex>) over ${rows} combinations; staging predicate unaffected`);
    const stg = CFG.loadLiveAiConfig(Object.assign({}, base, { LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: "1", LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: STGSUB }));
    ok(CFG.liveAi03bStagingSessionAllowed(stg, true, STGSUB) && CFG.liveAi03bRouteAllowed(stg, true, STGSUB), "the staging allowlist route still admits its exact allowlisted subject (unchanged)");
    ok(!CFG.liveAi03bStagingSessionAllowed(stg, true, PUBSUB), "a public subject never satisfies the staging allowlist predicate (allowlist NOT widened)");
    ok(!CFG.liveAi03bPublicSessionAllowed(stg, false, PUBSUB), "auth:false can never enter the public route even with a pub1-shaped subject");
    eq(CFG.loadLiveAiConfig({}).publicAdmissionEnabled, false, "default production config: public admission OFF");
    const off = CFG.loadLiveAiConfig({ OPENAI_API_KEY: "x", LIVE_AI_REASONING_MODEL: "some-other-model", LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: "1" });
    ok(!CFG.liveAi03bPublicTextConfigured(off), "a mismatching reasoning model disables the public route (fail closed)");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  section("P2 G-PUBLIC — broker admission (strict verified customer → opaque pub1 subject; no anonymous fallback)");
  {
    const SECRET = "test-public-subject-secret-0123456789";
    const d1 = await ADM.decidePublicAdmission({ env: {}, verifyCustomer: async () => ({ id: "u1" }) });
    ok(!d1.ok && d1.status === 503 && d1.error === "public_admission_unconfigured", "no derivation secret ⇒ 503 (fail closed, customer never consulted for authority)");
    const d2 = await ADM.decidePublicAdmission({ env: { LIVE_AI_PUBLIC_SUBJECT_HMAC_SECRET: SECRET }, verifyCustomer: async () => null });
    ok(!d2.ok && d2.status === 401 && d2.error === "sign_in_required", "no VERIFIED customer ⇒ 401 sign_in_required (no anonymous assertion)");
    const d3 = await ADM.decidePublicAdmission({ env: { LIVE_AI_PUBLIC_SUBJECT_HMAC_SECRET: SECRET }, verifyCustomer: async () => { throw new Error("backend down"); } });
    ok(!d3.ok && d3.status === 401, "a verifier error ⇒ 401 (fail closed)");
    const d4 = await ADM.decidePublicAdmission({ env: { LIVE_AI_PUBLIC_SUBJECT_HMAC_SECRET: SECRET }, verifyCustomer: async () => ({ id: "cust_123" }) });
    ok(d4.ok && /^pub1\.[0-9a-f]{64}$/.test(d4.subject), "a verified customer ⇒ an opaque pub1.<64 hex> subject");
    ok(d4.ok && d4.subject.indexOf("cust_123") === -1, "the raw customer id never appears in the subject (no PII to gateway/provider)");
    eq(ADM.derivePublicSubject("cust_123", SECRET), d4.subject, "the subject is deterministic for (customer, secret)");
    ok(ADM.derivePublicSubject("cust_124", SECRET) !== d4.subject && ADM.derivePublicSubject("cust_123", SECRET + "x") !== d4.subject, "distinct per customer AND per secret (rotation re-keys every subject)");
    ok(ADM.derivePublicSubject("", SECRET) === null && ADM.derivePublicSubject("u", "short") === null && ADM.derivePublicSubject("a\u001fb", SECRET) === null, "malformed id / weak secret / separator-injection ⇒ null");
    ok(CFG.liveAi03bPublicSessionAllowed(CFG.loadLiveAiConfig({ OPENAI_API_KEY: "x", LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: "1" }), true, d4.subject), "the broker-derived subject satisfies the gateway's exact public shape check");
    const route = fs.readFileSync(path.join(REPO, "app/api/live-ai/session/route.ts"), "utf8");
    const iGate = route.indexOf("if (publicAdmissionEnabled(env))"), iPx = route.indexOf('subject = "px."'), iSign = route.indexOf("new SignJWT(");
    ok(iGate > 0 && iPx > iGate && iSign > iPx, "route: the public gate is decided BEFORE any assertion is signed; px. minting lives ONLY in the gate-OFF branch");
    ok(/const decision = await decidePublicAdmission\(\{ env, verifyCustomer: \(\) => resolveVerifiedMediaCustomer\(req, customerAuthority\) \}\);\s*if \(!decision\.ok\) return NextResponse\.json\(\{ error: decision\.error \}, \{ status: decision\.status \}\);/.test(route), "route: a refused public admission returns BEFORE signing (no assertion minted)");
    ok(/const customerAuthority = createMediaCustomerAuthority\(\);/.test(route) && !/verifiedCustomerFromReq|userFromReq|decodeJwt/.test(route), "route: uses the STRICT verified-customer gate only (never the decode-only helpers)");
    ok(/if \(env\.LIVE_AI_BROKER_ENABLED !== "1"\)/.test(route) && route.indexOf('env.LIVE_AI_BROKER_ENABLED !== "1"') < iGate, "route: the B gate still fails closed FIRST (unchanged order)");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  section("P3 Public composition — preflight, owner-supplied TTS rule, catalog-only voice pricing");
  {
    eq(PUB.publicBootstrapPreflight({}).reason, "public_admission_disabled", "preflight: gate absent ⇒ fail closed");
    eq(PUB.publicBootstrapPreflight({ LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: "1" }).reason, "public_db_url_absent", "preflight: no DSN ⇒ fail closed");
    eq(PUB.publicBootstrapPreflight({ LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: "1", LIVE_AI_PUBLIC_DATABASE_URL: "postgres://x" }).reason, "budget_binding_absent", "preflight: no durable budget binding ⇒ fail closed");
    const good = { LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: "1", LIVE_AI_PUBLIC_DATABASE_URL: "postgres://x", LIVE_AI_BUDGET_ENABLED: "1", LIVE_AI_BUDGET_STORE_BINDING: "ref", LIVE_AI_BUDGET_PROJECT_ID: "live-ai-03b", LIVE_AI_BUDGET_LEASE_TTL_MS: "60000", LIVE_AI_BUDGET_MAX_CONTROL_STALENESS_MS: "15000", LIVE_AI_BUDGET_CONTROL_POLL_MS: "5000" };
    const p = PUB.publicBootstrapPreflight(good);
    ok(p.ok && p.ttsRule === null, "preflight: a complete binding passes; with no owner TTS rule ⇒ TTS stays unavailable (captions only)");
    eq(PUB.publicBootstrapPreflight(Object.assign({}, good, { LIVE_AI_BUDGET_PROJECT_ID: "other" })).reason, "budget_config_mismatch", "preflight: a binding for the wrong project ⇒ fail closed");
    // CHANGED EXPECTATIONS (TEMPORARY tts-1 FALLBACK): tts-1 is billed per INPUT CHARACTER, so the ONLY valid owner rule
    // dimension is tts_input_character with units in [4096 (the max admissible input), 100000]. The obsolete
    // gpt-4o-mini-tts token/second dimensions are now REFUSED (kept below as negatives, never accepted); every original
    // refused row is kept verbatim.
    const AUTH = require(path.join(compiled.GW, "live-ai-budget-authority.js"));
    const TTSA = require(path.join(compiled.GW, "openai-tts.js"));
    ok(AUTH.TTS_MODEL === "tts-1" && TTSA.TTS_MODEL === "tts-1" && fakeTts().adapter.model === AUTH.TTS_MODEL, "the bound TTS model is tts-1 (budget authority == adapter == this suite's fake TTS fixture)");
    for (const [dim, units, want] of [
      ["tts_input_character", "4096", true], ["tts_input_character", "100000", true],
      ["tts_input_character", "4095", false], ["tts_input_character", "500", false], ["tts_input_character", "0", false], ["tts_input_character", "100001", false], ["tts_input_character", "1e3", false], ["tts_input_character", "-5", false],
      ["tts_output_token", "500", false], ["tts_output_second", "90", false], ["tts_output_token", "4096", false], ["tts_output_second", "4096", false], ["tts_chars", "4096", false],
      ["tts_chars", "500", false], ["tts_output_token", "0", false], ["tts_output_token", "100001", false], ["tts_output_token", "1e3", false], ["tts_output_token", "-5", false],
    ]) {
      const r = PUB.resolveTtsReservationRule({ LIVE_AI_TTS_RESERVE_DIMENSION: dim, LIVE_AI_TTS_RESERVE_UNITS: units });
      ok((r !== null) === want, `TTS rule ${dim}/${units} ⇒ ${want ? "accepted" : "refused"}`);
    }
    const TTS_RULE = { dimension: "tts_input_character", units: BigInt(4096) };
    const now = Date.now();
    const empty = PRICING.EMPTY_PRICE_CATALOG;
    eq(PUB.quoteVoiceWorstCaseMicros(empty, "TRANSCRIPTION", null, now), null, "no catalog price ⇒ TRANSCRIPTION worst case unavailable (no invented price)");
    eq(PUB.quoteVoiceWorstCaseMicros(empty, "TTS", TTS_RULE, now), null, "no catalog price ⇒ TTS worst case unavailable");
    const base = { currencyCode: "USD", effectiveFromMs: 0, effectiveUntilMs: null, verifiedAtMs: 0, verificationExpiresAtMs: 9e12, sourceId: "t", sourceDigest: "d", status: "active", unitSize: BigInt(1) };
    const stale = PRICING.createPriceCatalog("t.v0", [Object.assign({ provider: "openai", model: "gpt-4o-mini-tts", serviceTier: null, billingDimension: "tts_output_token", rateMicros: BigInt(20) }, base)]);
    eq(PUB.quoteVoiceWorstCaseMicros(stale, "TTS", TTS_RULE, now), null, "an OBSOLETE gpt-4o-mini-tts / tts_output_token catalog row never prices tts-1 (no relabelled dimension, no cross-model price)");
    const cat = PRICING.createPriceCatalog("t.v1", [Object.assign({ provider: "openai", model: "gpt-live-transcribe", serviceTier: null, billingDimension: "realtime_audio_second", rateMicros: BigInt(100) }, base), Object.assign({ provider: "openai", model: "tts-1", serviceTier: null, billingDimension: "tts_input_character", rateMicros: BigInt(20) }, base)]);
    eq(PUB.quoteVoiceWorstCaseMicros(cat, "TRANSCRIPTION", null, now), BigInt(18000), "TRANSCRIPTION worst case = the released 180 s profile × the catalog rate");
    eq(PUB.quoteVoiceWorstCaseMicros(cat, "TTS", null, now), null, "TTS without an owner rule ⇒ unavailable even when a TTS price exists");
    eq(PUB.quoteVoiceWorstCaseMicros(cat, "TTS", TTS_RULE, now), BigInt(4096 * 20), "TTS worst case = owner rule units × the catalog rate (4096 chars × 20 µ$ = 81920 µ$)");
    const inactive = PRICING.createPriceCatalog("t.v2", [Object.assign({}, Object.assign({ provider: "openai", model: "gpt-live-transcribe", serviceTier: null, billingDimension: "realtime_audio_second", rateMicros: BigInt(100) }, base), { status: "inactive" })]);
    eq(PUB.quoteVoiceWorstCaseMicros(inactive, "TRANSCRIPTION", null, now), null, "an INACTIVE catalog row is never activated (no spend authority)");
    eq(RESP.REASONING_03B_SERVICE_TIER, "default", "G-TIER: the 03B reasoning request is pinned to service_tier \"default\" (Standard)");
    const respSrc = fs.readFileSync(path.join(REPO, "server/voice-gateway/openai-responses.ts"), "utf8");
    ok(/service_tier: REASONING_03B_SERVICE_TIER,/.test(respSrc), "G-TIER: the pinned tier is placed on the provider request body");
    eq(crypto.createHash("sha256").update(respSrc).digest("hex"), "809c27f2bfe028a0baf78ea7fb9898cbc9f21dde0070f00e2991ee40bb79ee40", "G-TIER: openai-responses.ts is byte-identical to the DEPLOYED AI-STAGING source (4f390b74)");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const store = OG.memoryBudgetStore({ strict: true });
  const tts = fakeTts();
  const stt = fakeTranscription();
  const gw = await OG.createOfflineGateway({ compiled, composition: "public", store, tts: tts.adapter, transcription: stt.adapter, voiceRates: { transcription: true, tts: true }, ttsRule: { dimension: "tts_input_character", units: BigInt(4096) } });   // CHANGED FIXTURE: tts-1 char rule

  section("P4 G-PUBLIC — a signed-in customer's typed turn → ORIGINAL controller → public 03B route → verified answer");
  {
    const env = bootController(gw, { route: "customer", subject: nextCustomer() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const m0 = gw.model.calls.length;
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(/3 matching stays are shown/i.test(ans), `public customer route → IC02-compiled, browser-verified answer ("${ans}")`);
    eq(gw.model.calls.length - m0, 1, "exactly ONE (fake) model call");
    eq(env.broker.calls[0] && env.broker.calls[0].gatewayStatus, 200, "the REAL session handler admitted the auth:true pub1 subject (200)");
    // second turn on the SAME session — per-turn execution lease (strict store refuses a per-session key replay)
    await until(() => env.conv.getState() === "IDLE", 4000);   // the first turn fully settled (ack + reconcile) before the next
    await sleep(50);
    const t1 = Date.now();
    providerSubmit(env, "compare the first two");
    await until(() => assistantSince(env, t1).length > 0, 8000);
    const ans2 = assistantSince(env, t1)[0] || "";
    ok(/compar/i.test(ans2), `a SECOND turn on the same session gets its own bounded execution lease and a verified answer ("${ans2}")`);
    const execAcq = store.state.acquisitions.filter((a) => a.budgetClass === "EXECUTION_ADMISSION" && /^pub-exec\./.test(a.key));
    ok(execAcq.length >= 2 && new Set(execAcq.map((a) => a.key)).size === execAcq.length, "each turn acquired a DISTINCT per-turn execution-admission key (pub-exec.<sha256>)");
    ok(execAcq.every((a) => a.admissions === BigInt(3)), "each per-turn lease is bounded to the IC01 capability-step ceiling (3 admissions)");
    env.conv.end("user"); env.stop();
  }

  section("P5 Admission negatives on the REAL gateway (fail closed; zero model calls; zero provider negotiations)");
  {
    const m0 = gw.model.calls.length, n0 = stt.calls.length, acq0 = store.state.acquisitions.length;
    const sid = () => "s" + crypto.randomBytes(8).toString("hex");
    const SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=x\r\n";
    const r1 = await gw.rawCreateSession(await gw.assertionWith({ auth: false, subject: "px." + "c".repeat(32) }), { mode: "text", sessionId: sid() }, nextIp());
    ok(r1.status === 503 && r1.body.error === "unconfigured", `anonymous px./auth:false TEXT session under the public gate ⇒ 503 unconfigured (got ${r1.status} ${r1.body && r1.body.error})`);
    const r2 = await gw.rawCreateSession(await gw.assertionWith({ auth: false, subject: nextCustomer() }), { mode: "text", sessionId: sid() }, nextIp());
    eq(r2.status, 503, "a pub1-shaped subject WITHOUT auth:true ⇒ 503");
    const r3 = await gw.rawCreateSession(await gw.assertionWith({ auth: true, subject: "stg1." + "d".repeat(64) }), { mode: "text", sessionId: sid() }, nextIp());
    eq(r3.status, 503, "a staging-shaped auth:true subject that is NOT allowlisted ⇒ 503 (allowlist not bypassed)");
    const r1m = await gw.rawCreateSession(await gw.assertionWith({ auth: false, subject: "px." + "e".repeat(32) }), { mode: "microphone", sessionId: sid(), sdp: SDP }, nextIp());
    eq(r1m.status, 503, "SECURITY: an anonymous px./auth:false MICROPHONE session ⇒ 503 (no anonymous transcription spend)");
    const r2m = await gw.rawCreateSession(await gw.assertionWith({ auth: false, subject: nextCustomer() }), { mode: "microphone", sessionId: sid(), sdp: SDP }, nextIp());
    eq(r2m.status, 503, "SECURITY: a pub1-shaped auth:false MICROPHONE session ⇒ 503");
    eq(stt.calls.length - n0, 0, "ZERO realtime transcription negotiations for every refused microphone session");
    eq(store.state.acquisitions.length - acq0, 0, "ZERO budget leases acquired for every refused admission (refused before any lease)");
    const r4 = await gw.rawCreateSession(await gw.assertionWith({ auth: true, subject: nextCustomer(), origin: "https://evil.example" }), { mode: "text", sessionId: sid() }, nextIp());
    eq(r4.status, 403, "wrong signed origin ⇒ 403 origin_not_allowed");
    const reused = await gw.assertionWith({ auth: true, subject: nextCustomer(), jti: "jti.replay-1" });
    const ipR = nextIp();
    const r5a = await gw.rawCreateSession(reused, { mode: "text", sessionId: sid() }, ipR);
    const r5b = await gw.rawCreateSession(reused, { mode: "text", sessionId: sid() }, ipR);
    ok(r5a.status === 200 && r5b.status === 401, `a replayed one-use assertion ⇒ 401 (first ${r5a.status}, replay ${r5b.status})`);
    if (r5a.status === 200) { const s0 = gw.liveAiCtx.store.get(r5a.body.gatewaySessionId); if (s0) gw.liveAiCtx.store.terminate(s0, "closed"); }
    const r6 = await gw.rawCreateSession(await gw.assertionWith({ auth: true, subject: nextCustomer(), scope: "voice:read" }), { mode: "text", sessionId: sid() }, nextIp());
    eq(r6.status, 401, "a wrong-scope assertion ⇒ 401");
    const r7 = await gw.rawCreateSession("not-a-jwt", { mode: "text", sessionId: sid() }, nextIp());
    eq(r7.status, 401, "a forged/garbage bearer ⇒ 401");
    eq(gw.model.calls.length, m0, "ZERO model calls across every refused admission");
    // public gate OFF: the 03B public route is unreachable. The gateway may still create a LEGACY session (its own
    // separate prerequisites), but the legacy reasoning path has no budget authority in this composition ⇒ a typed
    // turn makes ZERO model calls and the guest gets an explicit error.
    const gwOff = await OG.createOfflineGateway({ compiled, composition: "public", publicGate: false });
    ok(!CFG.liveAi03bRouteAllowed(CFG.loadLiveAiConfig(gwOff.env.gatewayEnv), true, nextCustomer()), "public gate OFF ⇒ the 03B route predicate refuses even a valid auth:true pub1 subject");
    const envOff = bootController(gwOff, { route: "customer", subject: nextCustomer() });
    const pageOff = hotelsPage(HOTELS);
    envOff.runtime.invalidateRoute("/hotels"); envOff.runtime.registerPage(pageOff.reg);
    const tOff = Date.now();
    providerSubmit(envOff, "show me the stays");
    await until(() => gwOff.frames.some((f) => f.dir === "s2c" && f.t === "turn.error") || assistantSince(envOff, tOff).length > 0 || envOff.broker.calls.some((c) => c.gatewayStatus !== 200), 6000);
    eq(gwOff.model.calls.length, 0, "public gate OFF ⇒ ZERO model calls for a signed-in customer's typed turn");
    ok(!assistantSince(envOff, tOff).some((t) => /matching stays/i.test(t)), "public gate OFF ⇒ no provider-backed answer is produced");
    envOff.conv.end("user"); envOff.stop();
    await gwOff.close();
  }

  section("P6 G-REBIND — refinement → verified receipt → in-turn IC01 rebind → replan → verified answer under the ADVANCED authority");
  {
    const env = bootController(gw, { route: "customer", subject: nextCustomer() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const f0 = gw.frames.length, m0 = gw.model.calls.length;
    const t0 = Date.now();
    providerSubmit(env, "show me stays under 3500");
    await until(() => assistantSince(env, t0).length > 0 || gw.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "turn.error"), 15000);
    const ans = assistantSince(env, t0)[0] || "";
    eq(page.s.maxPrice, 3500, "the validated refinement was applied on screen by the ORIGINAL runtime");
    ok(gw.model.calls.slice(m0).map((c) => c.intent).join(",") === "REFINE_RESULTS,READ_RESULTS", "model calls: REFINE (plan) then READ (the IC01 REPLAN after the accepted rebind) — same turn");
    ok(/2 matching stays are shown/i.test(ans), `the post-rebind answer counts ONLY the refined on-screen results ("${ans}")`);
    ok(!gw.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "turn.error"), "no error: the advanceable operation completed with a verified answer");
    env.conv.end("user"); env.stop();
  }
  {
    // OPEN (route change): the browser itself interrupts the turn on navigation; the gateway tears the lifecycle
    // down (route_change) — the guest sees the opened page, and Teddy's own copy explains it (TravelBuddy.tsx).
    const tb = fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8");
    ok(/The page changed — ask about this stay's rooms or facilities\./.test(tb), "OPEN: Teddy reports the AI-opened page explicitly (no silent stall)");
    ok(/terr\.code === "stale"/.test(tb) && /terr\.code === "budget_exceeded"/.test(tb) && /terr\.code === "timeout"/.test(tb), "Teddy maps explicit turn errors (stale / budget_exceeded / timeout) to actionable guest copy");
    const idx = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
    ok(/case "REBIND_REQUIRED": return "stale";/.test(idx) && /default: return "unsupported";/.test(idx) && !/emit03bError\([^)]*"unavailable"\)/.test(idx), "gateway: every non-answer 03B terminal emits a BROWSER-VALID code (the dropped \"unavailable\" code is gone)");
    const PROTO = fs.readFileSync(path.join(REPO, "lib/live-ai/protocol.ts"), "utf8");
    for (const code of ["stale", "unsupported", "timeout", "budget_exceeded", "provider_unavailable"]) ok(PROTO.indexOf('"' + code + '"') !== -1, `"${code}" is in the browser's closed turn.error vocabulary`);
  }

  section("P7 G-TTS — a verified compiled answer is voiced ONLY via approval of the EXACT canonical text (muted ⇒ zero spend)");
  {
    // (a) voice ON: approval → TTS lease → fake synth gets the exact verified text → audio reaches the sink.
    const env = bootController(gw, { route: "customer", subject: nextCustomer() }, { speak: true });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const c0 = tts.calls.length, f0 = gw.frames.length;
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    await until(() => tts.calls.length > c0 && env.sink.enqueued.length > 0, 4000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(gw.frames.slice(f0).some((f) => f.dir === "c2s" && f.t === "answer.approve"), "the browser approved the verified compiled answer (answer.approve)");
    eq(tts.calls.length - c0, 1, "exactly ONE TTS synthesis for the answer");
    eq(tts.calls[tts.calls.length - 1] && tts.calls[tts.calls.length - 1].text, ans, "the voiced text is EXACTLY the browser-verified canonical answer text");
    ok(gw.frames.slice(f0).some((f) => f.dir === "s2c" && f.t === "audio.start") && env.sink.enqueued.length > 0, "audio.start/chunk/end reached the browser and the approved plan's audio was played");
    ok(store.state.acquisitions.some((a) => a.budgetClass === "PROVIDER_SPEND" && /^pub-spend\./.test(a.key) && a.money === BigInt(4096 * 15)), "a dedicated TTS lease was prepared (worst case = owner rule × catalog rate: 4096 chars × the harness's TEST-ONLY 15 µ$/char = 61440 µ$)");
    env.conv.end("user"); env.stop();
  }
  {
    // (b) MUTED: no approval, no TTS spend.
    const env = bootController(gw, { route: "customer", subject: nextCustomer() }, { speak: false });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const c0 = tts.calls.length, f0 = gw.frames.length;
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    await sleep(300);
    ok(!gw.frames.slice(f0).some((f) => f.dir === "c2s" && f.t === "answer.approve"), "muted ⇒ the browser never approves the answer");
    eq(tts.calls.length - c0, 0, "muted ⇒ ZERO TTS synthesis (zero spend)");
    env.conv.end("user"); env.stop();
  }
  {
    // (c) a forged approval (wrong text hash) is refused by the one-use pending plan (zero synthesis).
    const env = bootController(gw, { route: "customer", subject: nextCustomer() }, { speak: false });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const c0 = tts.calls.length;
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    const compiledFrame = gw.liveAiCtx && Array.from({ length: 0 });
    void compiledFrame;
    const sent = env.transport.submitApproval({ sessionId: env.runtime.sessionId, turnId: env.runtime.getCurrentTurnId() || "t", generation: env.conv.getGeneration(), planId: "plan_forged", authorityRef: "auth_forged", textHash: "0".repeat(64) });
    await sleep(300);
    ok(sent === true, "a forged approval frame reached the gateway");
    eq(tts.calls.length - c0, 0, "a forged/mismatched approval is refused by takeApprovedPlan ⇒ ZERO synthesis");
    env.conv.end("user"); env.stop();
  }
  {
    // (d) no TTS rule ⇒ captions only (no pending plan offered; zero synthesis even when the browser approves).
    const store2 = OG.memoryBudgetStore({ strict: true });
    const tts2 = fakeTts();
    const gw2 = await OG.createOfflineGateway({ compiled, composition: "public", store: store2, tts: tts2.adapter, voiceRates: { tts: true } });
    const env = bootController(gw2, { route: "customer", subject: nextCustomer() }, { speak: true });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    await until(() => gw2.frames.some((f) => f.dir === "s2c" && f.t === "turn.error"), 1500);
    eq(tts2.calls.length, 0, "no owner TTS rule ⇒ the TTS lease is refused ⇒ ZERO synthesis (captions only)");
    ok(gw2.frames.some((f) => f.dir === "s2c" && f.t === "turn.error"), "the refused TTS lease is reported explicitly (turn.error budget_exceeded), never silently");
    ok(assistantSince(env, t0).length > 0, "the verified TEXT answer is still shown (voice is additive, text never blocked)");
    env.conv.end("user"); env.stop(); await gw2.close();
  }

  section("P8 G-MIC + G-RATE — real browser mic path → gateway TRANSCRIPTION lease → review → SAME session answers (ONE start)");
  {
    const env = bootController(gw, { route: "customer", subject: nextCustomer() }, { retain: true });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const n0 = stt.calls.length, m0 = gw.model.calls.length, gum0 = MEDIA.gum;
    const reviewed = [];
    const origSubmit = env.conv.submitText.bind(env.conv);
    let allowNext = null;
    env.conv.submitText = (t) => { if (allowNext === t) { allowNext = null; return origSubmit(t); } reviewed.push(t); return false; };   // the Teddy review bridge, minimal
    const res = await env.conv.start("microphone");
    ok(res.ok === true, "the explicit microphone start resolved through the ORIGINAL transport against the REAL gateway (no shim)" + (res.ok ? "" : ` (code=${res.code})`));
    eq(stt.calls.length - n0, 1, "the gateway negotiated EXACTLY ONE realtime transcription session (fake seam)");
    eq(MEDIA.gum - gum0, 1, "getUserMedia was requested exactly once, only by the explicit start");
    ok(store.state.acquisitions.some((a) => a.budgetClass === "PROVIDER_SPEND" && a.money === BigInt(18000)), "a TRANSCRIPTION lease was prepared before negotiation (worst case = 180 s × catalog rate)");
    await until(() => env.conv.getState() === "IDLE", 3000);
    ok(speak("show me the stays"), "the provider data channel delivered an input transcription");
    await sleep(50);
    eq(reviewed[0], "show me the stays", "the transcript was diverted to REVIEW (never auto-submitted)");
    eq(gw.model.calls.length, m0, "nothing reached the model before review");
    const stopped0 = MEDIA.tracksStopped;
    env.conv.bargeIn();
    await sleep(100);
    ok(MEDIA.tracksStopped > stopped0, "confirming the review STOPPED the mic tracks (capture released)");
    eq(env.transport.getConnectionState(), "connected", "…but the authenticated control session stayed CONNECTED (G-RATE opt-in)");
    const t0 = Date.now();
    allowNext = "show me the stays";
    providerSubmit(env, "show me the stays");
    await until(() => assistantSince(env, t0).length > 0, 8000);
    const ans = assistantSince(env, t0)[0] || "";
    ok(/3 matching stays are shown/i.test(ans), `the reviewed voice text was answered on the SAME session ("${ans}")`);
    eq(env.broker.calls.length, 1, "G-RATE FIXED: ONE gateway session start for the whole reviewed voice turn (was 2)");
    const st0 = MEDIA.gum;
    const again = await env.conv.start("microphone");
    ok(again.ok === false && MEDIA.gum === st0, "re-capturing on a connected session is refused (no auto-restart; a fresh explicit start needs a new session)");
    env.conv.end("user"); env.stop();
  }
  {
    // a public mic start with NO transcription price ⇒ 503 before any negotiation
    const gw3 = await OG.createOfflineGateway({ compiled, composition: "public", store: OG.memoryBudgetStore({ strict: true }), transcription: stt.adapter });
    const n0 = stt.calls.length;
    const r = await gw3.rawCreateSession(await gw3.assertionWith({ auth: true, subject: nextCustomer() }), { mode: "microphone", sessionId: "s" + crypto.randomBytes(8).toString("hex"), sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=x\r\n" });
    ok(r.status === 503 && r.body && r.body.error === "realtime_unavailable", `no catalog transcription price ⇒ 503 realtime_unavailable (got ${r.status} ${r.body && r.body.error})`);
    eq(stt.calls.length - n0, 0, "…and ZERO realtime negotiations were attempted");
    await gw3.close();
  }

  section("P9 G-RATE — per-subject concurrency, multi-tab, start limit, durable money ceiling, restart");
  {
    const subj = nextCustomer();
    const sid = () => "s" + crypto.randomBytes(8).toString("hex");
    const a = await gw.rawCreateSession(await gw.assertionWith({ auth: true, subject: subj }), { mode: "text", sessionId: sid() }, nextIp());
    const b = await gw.rawCreateSession(await gw.assertionWith({ auth: true, subject: subj }), { mode: "text", sessionId: sid() }, nextIp());   // a different IP: the SUBJECT cap (not the IP cap) refuses
    ok(a.status === 200 && b.status === 429 && b.body.error === "subject_capacity", `a second concurrent session (multi-tab) for the SAME customer ⇒ 429 subject_capacity (got ${b.status} ${b.body && b.body.error})`);
    // release by terminating the first session, then exercise the 15-min start limit (5)
    const s0 = gw.liveAiCtx.store.get(a.body.gatewaySessionId); if (s0) gw.liveAiCtx.store.terminate(s0, "closed");
    const subj2 = nextCustomer();
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await gw.rawCreateSession(await gw.assertionWith({ auth: true, subject: subj2 }), { mode: "text", sessionId: sid() }, nextIp());
      codes.push(r.status === 200 ? 200 : r.body.error);
      if (r.status === 200) { const s = gw.liveAiCtx.store.get(r.body.gatewaySessionId); if (s) gw.liveAiCtx.store.terminate(s, "closed"); }
    }
    eq(codes.join(","), "200,200,200,200,200,start_rate_15m", "the 6th session start for one customer within 15 min ⇒ 429 start_rate_15m (per-subject burst cap)");
    // durable money ceiling (strict fake mirrors the Pg store's ceiling refusal) ⇒ explicit error, zero model calls
    const capped = OG.memoryBudgetStore({ strict: true, subjectDayMoneyCeilingMicros: BigInt(1) });
    const gw4 = await OG.createOfflineGateway({ compiled, composition: "public", store: capped });
    const env = bootController(gw4, { route: "customer", subject: nextCustomer() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => gw4.frames.some((f) => f.dir === "s2c" && f.t === "turn.error") || assistantSince(env, t0).length > 0, 8000);
    eq(gw4.model.calls.length, 0, "a store ceiling refusal ⇒ ZERO model calls (spend authority never granted)");
    ok(gw4.frames.some((f) => f.dir === "s2c" && f.t === "turn.error"), "…and the guest gets an explicit error, not a hang");
    env.conv.end("user"); env.stop(); await gw4.close();
    // restart: a new process (new bootNonce) can never replay an earlier boot's envelope (strict store)
    const st = OG.memoryBudgetStore({ strict: true });
    const r1 = await st.acquireEnvelope({ acquisitionKey: "k1", budgetClass: "PROVIDER_SPEND", subjectDigest: "s", projectId: "live-ai-03b", amounts: { moneyMicros: BigInt(1), providerCalls: BigInt(1), executionAdmissions: BigInt(0) }, maxControlStalenessMs: 15000, leaseTtlMs: 60000, bootNonce: "boot-A" });
    const r2 = await st.acquireEnvelope({ acquisitionKey: "k1", budgetClass: "PROVIDER_SPEND", subjectDigest: "s", projectId: "live-ai-03b", amounts: { moneyMicros: BigInt(1), providerCalls: BigInt(1), executionAdmissions: BigInt(0) }, maxControlStalenessMs: 15000, leaseTtlMs: 60000, bootNonce: "boot-B" });
    ok(r1.ok && !r2.ok && r2.reason === "envelope_previous_boot", "(fake mirror) a restarted process cannot replay a previous boot's envelope — the AUTHORITATIVE proof is the Pg suite");
  }

  section("P10 Kill switch + revoked CUT + legacy-process fence (what offline CAN and CANNOT prove)");
  {
    const store5 = OG.memoryBudgetStore({ strict: true });
    const gw5 = await OG.createOfflineGateway({ compiled, composition: "public", store: store5 });
    store5.state.control.killed = true;                          // operator DB CUT (control killed)
    const env = bootController(gw5, { route: "customer", subject: nextCustomer() });
    const page = hotelsPage(HOTELS);
    env.runtime.invalidateRoute("/hotels"); env.runtime.registerPage(page.reg);
    const t0 = Date.now();
    providerSubmit(env, "show me the stays");
    await until(() => gw5.frames.some((f) => f.dir === "s2c" && f.t === "turn.error") || assistantSince(env, t0).length > 0, 8000);
    eq(gw5.model.calls.length, 0, "a killed control (DB CUT) ⇒ NEW lease refused ⇒ ZERO model calls from THIS process");
    env.conv.end("user"); env.stop();
    const kill = gw5.liveAiCtx;
    kill.runtime.killed = true;
    const r = await gw5.rawCreateSession(await gw5.assertionWith({ auth: true, subject: nextCustomer() }), { mode: "text", sessionId: "s" + crypto.randomBytes(6).toString("hex") });
    ok(r.status === 503 && r.body.error === "runtime_disabled", "runtime kill ⇒ every new session refused (503 runtime_disabled)");
    console.log("    (HONEST LIMIT: an OLD credential-bearing process that is frozen between the kill/deadline re-check and the socket write CANNOT be fenced by in-process code; P7 strict proof needs platform egress evidence — see the P7 dossier. NOT claimed here.)");
    await gw5.close();
  }

  section("P11 R3 — every guest AI / pricing path is read-only (source closure)");
  {
    const REG = require(path.join(compiled.GW, "live-ai-capability-registry.js"));
    const caps = REG.listCapabilities();
    eq(caps.length, 6, "exactly six capabilities");
    ok(caps.every((c) => (c.authorityClass === "READ" || c.authorityClass === "UI_LOCAL") && c.confirmationClass === "NONE"), "all six are READ or UI_LOCAL (no transactional authority)");
    ok(!caps.some((c) => /BID|BOOK|PAY|CHECKOUT|MESSAGE|REFUND/.test(c.capabilityId)), "no bid / booking / payment / messaging capability exists");
    // import closure of POST /api/pricing/spine
    const seen = new Set(); const files = [];
    const resolve = (from, spec) => {
      let p = spec.startsWith("@/") ? path.join(REPO, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
      if (!p) return null;
      for (const c of [p + ".ts", p + ".tsx", path.join(p, "index.ts")]) if (fs.existsSync(c)) return c;
      return null;
    };
    const walk = (f) => { if (seen.has(f)) return; seen.add(f); files.push(f); const src = fs.readFileSync(f, "utf8"); const re = /from\s+["']([^"']+)["']/g; let m; while ((m = re.exec(src))) { const r = resolve(f, m[1]); if (r) walk(r); } };
    walk(path.join(REPO, "app/api/pricing/spine/route.ts"));
    let writes = 0, badImports = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (/supabase-admin\.ts$/.test(f)) continue;                 // the shared helper file defines writers; checked by import names below
      if (/method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src) || /\bsb(Insert|Update|Upsert|Delete)\s*\(/.test(src) || /\.rpc\s*\(/.test(src)) writes++;
      const imp = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/onboard\/supabase-admin["']/.exec(src);
      if (imp && imp[1].split(",").map((s) => s.trim()).filter(Boolean).some((n) => n !== "sbSelect")) badImports++;
    }
    ok(files.length >= 3, `import closure of /api/pricing/spine resolved (${files.length} files)`);
    eq(writes, 0, "R3: no non-GET fetch, sb* write helper or RPC anywhere in the pricing-spine closure");
    eq(badImports, 0, "R3: the closure imports ONLY sbSelect from the Supabase admin helper");
    const tbSrc = fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8") + fs.readFileSync(path.join(REPO, "lib/travel-buddy/conversation.ts"), "utf8");
    ok(!/\/api\/pricing\/spine|\/api\/bids|\/api\/bookings|razorpay/i.test(tbSrc), "Teddy (UI + planner) never calls pricing / bid / booking / payment endpoints");
  }

  section("P12 Exact changed-file allowlist vs HEAD + frozen surfaces + no secrets");
  {
    const changed = cp.spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const untracked = cp.spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const all = changed.concat(untracked).filter((f) => !/^node_modules/.test(f));
    const ALLOWED = new Set([
      // Candidate01 (accepted offline candidate, 20 files)
      "components/live-ai/LiveAiShell.tsx", "components/live-ai/TravelBuddy.tsx", "components/tutorial/TutorialTriggerMount.tsx", "components/tutorial/WelcomeStory.tsx",
      "lib/live-ai/gateway-client.ts", "lib/travel-buddy/conversation.ts", "lib/travel-buddy/live-bridge.ts", "lib/travel-buddy/session.ts", "lib/travel-buddy/voice-io.ts",
      "lib/tutorial/buddy-coordination.ts", "lib/tutorial/usePageTour.ts", "tests/live-ai/offline-gateway/browser-harness.js", "tests/live-ai/offline-gateway/offline-gateway.js",
      "tests/live-ai/travel-buddy-live-integration.test.js", "tests/live-ai/travel-buddy-live-preview.mjs", "tests/live-ai/travel-buddy-live-smoke.mjs", "tests/live-ai/travel-buddy-offline-preview.mjs",
      "tests/live-ai/travel-buddy-voice-smoke.mjs", "tests/live-ai/travel-buddy-voice.test.js", "tests/live-ai/travel-buddy.test.js",
      // REAL-TEDDY consolidated batch
      "app/api/live-ai/session/route.ts", "components/live-ai/LiveAiProvider.tsx", "lib/live-ai/conversation.ts", "lib/live-ai/public-admission.ts",
      "server/voice-gateway/config.ts", "server/voice-gateway/index.ts", "server/voice-gateway/live-ai-03b-controller.ts", "server/voice-gateway/live-ai-orchestrator.ts",
      "server/voice-gateway/live-ai-staging-main.ts", "server/voice-gateway/openai-responses.ts", "server/voice-gateway/live-ai-public-main.ts",
      "tests/live-ai/founder-text.test.js", "tests/live-ai/travel-buddy-real-teddy.test.js", "tests/budget/live-ai-public-teddy.pg.test.js", "tests/live-ai/travel-buddy-public-smoke.mjs",
      // QUEUED-TTS cancellation remediation (delta after WORK #2 review): its focused regression suite
      "tests/live-ai/travel-buddy-tts-cancel.test.js",
      // A3 mic-hangup (Control Room delta, previously disclosed): its product file + test adaptation + focused suite
      "server/voice-gateway/openai-transcription.ts", "tests/live-ai/live-ai-gateway.test.js", "tests/live-ai/real-teddy-a3-mic-hangup.test.js",
      // TEMPORARY tts-1 FALLBACK (TTS1): the three authorized frozen files + its fixture adaptation + focused suite
      // (config.ts / index.ts / orchestrator / public-main / staging-main / offline-gateway.js / tts-cancel are listed above)
      "server/voice-gateway/live-ai-budget-pricing.ts", "server/voice-gateway/live-ai-budget-authority.ts", "server/voice-gateway/openai-tts.ts",
      "tests/budget/live-ai-budget-01.test.js", "tests/live-ai/real-teddy-tts1-billing.test.js",
    ]);
    // Public gateway release adds only the two reviewed package.json scripts. Keep this
    // exception exact: an unrelated script, dependency or package edit remains a hard FAIL.
    if (all.includes("package.json")) {
      const basePackage = JSON.parse(cp.execFileSync("git", ["show", "HEAD:package.json"], { cwd: REPO, encoding: "utf8" }));
      const candidatePackage = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
      eq(candidatePackage.scripts["start:live-ai-public"], "node server/voice-gateway/dist/live-ai-public-main.js",
        "P12: public gateway start script has only the reviewed entrypoint");
      eq(candidatePackage.scripts["test:live-ai-public"],
        "node tests/live-ai/travel-buddy-real-teddy.test.js && node tests/live-ai/travel-buddy-tts-cancel.test.js && node tests/live-ai/travel-buddy-voice.test.js && node tests/budget/live-ai-public-teddy.pg.test.js",
        "P12: public suite script is exactly the reviewed offline test sequence");
      const normalized = JSON.parse(JSON.stringify(candidatePackage));
      delete normalized.scripts["start:live-ai-public"];
      delete normalized.scripts["test:live-ai-public"];
      eq(JSON.stringify(normalized), JSON.stringify(basePackage),
        "P12: package.json has no changes beyond those exact two scripts");
    }
    const extra = all.filter((f) => !ALLOWED.has(f) && f !== "package.json");
    eq(extra.length, 0, `every changed/new path is on the exact allowlist (${all.length} paths${extra.length ? "; extra: " + extra.join(", ") : ""})`);
    // RECONCILED (TEMPORARY tts-1 FALLBACK): exactly FOUR frozen files carry an authorized, previously reviewed change and
    // are therefore NOT byte-identical to HEAD: the three TTS1 files and (separately, already disclosed) the A3 Control
    // Room transcription file. Each is pinned to its EXACT authorized bytes below (any further edit fails). Every other
    // frozen path must still be byte-identical to HEAD (the authoritative base). No other exception.
    const FROZEN_AUTHORIZED = [
      ["server/voice-gateway/live-ai-budget-pricing.ts", "69664d0d6d1bca4a095a6c1edcd3d51e39f6c840b4ed72ff596af0b4c2348eec", "TTS1"],
      ["server/voice-gateway/live-ai-budget-authority.ts", "f4d60c05ee4bfde31f512326d779efe7217bc5629ee27e15abf6171a59a99bd5", "TTS1"],
      ["server/voice-gateway/openai-tts.ts", "282050cafb63f936fd58946cabf49204ff8b25e64a74a49272bc9dee0527848d", "TTS1"],
      ["server/voice-gateway/openai-transcription.ts", "9ccbc7c88840c2ec82d631ef37d677ccc5214b497f9fa98e9899bb8bbe42d05d", "A3"],
    ];
    for (const [f, want, who] of FROZEN_AUTHORIZED) {
      eq(crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO, f))).digest("hex"), want, `authorized ${who} frozen exception ${f} is EXACTLY the reviewed bytes`);
    }
    const frozen = cp.spawnSync("git", ["diff", "--quiet", "HEAD", "--", "server/voice-gateway/live-ai-budget-store.ts", "server/voice-gateway/live-ai-budget-control.ts", "server/voice-gateway/live-ai-agent-loop.ts", "server/voice-gateway/live-ai-execution-safety.ts", "server/voice-gateway/live-ai-answer-compiler.ts", "server/voice-gateway/live-ai-capability-registry.ts", "server/voice-gateway/live-ai-intelligence-contract.ts", "server/voice-gateway/auth.ts", "server/voice-gateway/live-ai-sessions.ts", "server/voice-gateway/live-ai-control-socket.ts", "server/voice-gateway/rate-limit.ts", "lib/live-ai/broker.ts", "lib/live-ai/staging-authority.ts", "lib/live-ai/protocol.ts", "lib/live-ai/compiled-answer-consumer.ts", "app/api/live-ai/staging", "app/api/pricing", "migrations"], { cwd: REPO });
    eq(frozen.status, 0, "BUDGET store/control (P7/C04 surface), IC01, 03A, IC02, capability registry, auth, sessions, control socket, rate limiter, broker helpers, staging routes, pricing API and migrations are byte-unchanged (all frozen paths except the 4 pinned authorized exceptions)");
    const diff = cp.spawnSync("git", ["diff", "HEAD"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout + untracked.filter((f) => !/\.build/.test(f)).map((f) => { try { return fs.readFileSync(path.join(REPO, f), "utf8"); } catch { return ""; } }).join("\n");
    ok(!/sk-[A-Za-z0-9]{20}|rzp_(live|test)_[A-Za-z0-9]|eyJhbGciOi[A-Za-z0-9_-]{20}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/.test(diff), "no key material / token / private key in the candidate delta");
    const srcDiff = cp.spawnSync("git", ["diff", "HEAD", "--", ".", ":(exclude)tests"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout + untracked.filter((f) => !/^tests\//.test(f)).map((f) => { try { return fs.readFileSync(path.join(REPO, f), "utf8"); } catch { return ""; } }).join("\n");
    ok(srcDiff.length > 0 && !/NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA\s*[=:]\s*["']1["']/.test(srcDiff) && !/NEXT_PUBLIC_LIVE_AI_PUBLIC_ADMISSION\s*[=:]\s*["']1["']/.test(srcDiff) && !/(LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED|LIVE_AI_PUBLIC_ADMISSION_ENABLED)\s*[:=]\s*["']1["']/.test(srcDiff), "no PRODUCT source sets a provider / public gate ON (test fixtures excluded; gates are env-only, default OFF)");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  section("Network backstop");
  eq(net.attempts.length, 0, "ZERO process-level network attempts during the whole run");
  ok(gw.model.calls.every((c) => c.url === "https://api.openai.com/v1/responses"), "every model call went to the injected OFFLINE fake (the real endpoint string was never fetched)");
  await gw.close();
  console.log(`\n  REAL TEDDY consolidated offline proof: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL REAL-TEDDY OFFLINE CHECKS PASSED");
  process.exit(0);
})().catch((e) => { console.error("FATAL", e && e.stack ? e.stack : e); process.exit(1); });
