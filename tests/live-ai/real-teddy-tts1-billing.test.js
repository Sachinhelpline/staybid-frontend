#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// REAL TEDDY — TEMPORARY tts-1 FALLBACK: character-billing + model-binding regression (Node, deterministic,
// NO network, NO provider, NO paid call).  Run:  node tests/live-ai/real-teddy-tts1-billing.test.js
//
// What it proves OFFLINE (program proof, not provider proof):
//   C1  ONE bound TTS model ("tts-1") across adapter / BudgetCore class / config allowlist / public quote.
//   C2  the conservative billable-character upper bound of the EXACT server-sent `input`
//       (max UTF-8 bytes over the string and its NFC/NFD/NFKC/NFKD forms) dominates every plausible
//       "character" count (UTF-16 code units, code points, extended grapheme clusters, UTF-8 bytes, under
//       any of the four normalization forms) — incl. Devanagari, Hinglish, emoji/ZWJ, combining marks and
//       NFKD-expanding code points; empty / over-long / ill-formed text is refused.
//   C3  the fake provider receives EXACTLY {model:"tts-1", voice:"alloy", input:<verbatim>, response_format:"pcm"}.
//   C4  the one-component `tts_input_character` worst case is priced ONLY from a verified, active, USD,
//       in-effect catalog row for the SAME model (ceil rounding, checked BigInt); stale / inactive / wrong-model /
//       relabelled-dimension / non-USD / missing ⇒ fail closed; the owner rule must cover the admission cap.
//   C5  through the ORIGINAL gateway (public composition, strict store): every approved answer gets its OWN
//       lease + durable provider child + exactly ONE synthesis; a replayed approval never re-synthesizes;
//       signed-in-only admission is unchanged.
// Prices below are TEST-ONLY fixtures derived from the provider's published $15 / 1M characters; they are
// NOT a production catalog and are never written anywhere.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const OG = require("./offline-gateway/offline-gateway");

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
const show = (v) => { try { return JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x + "n" : x)); } catch { return String(v); } };
function eq(a, b, l) { ok(a === b, l + (a === b ? "" : ` [got ${show(a)} want ${show(b)}]`)); }
function section(n) { console.log("\n• " + n); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (pred()) return true; await sleep(5); } return !!pred(); }

const net = OG.assertNoNetwork();
const compiled = OG.compileSources(path.join(__dirname, ".build", "tts1-billing"));
process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";   // same browser-lib setting as the accepted tts-cancel / real-teddy suites
const TTS = require(path.join(compiled.GW, "openai-tts.js"));
const AUTH = require(path.join(compiled.GW, "live-ai-budget-authority.js"));
const CFG = require(path.join(compiled.GW, "config.js"));
const PRICING = require(path.join(compiled.GW, "live-ai-budget-pricing.js"));
const PUB = require(path.join(compiled.GW, "live-ai-public-main.js"));
const REPO = OG.REPO;
const bound = typeof TTS.ttsBillableCharUpperBound === "function" ? TTS.ttsBillableCharUpperBound : () => undefined;
const CAP = TTS.MAX_TTS_BILLABLE_CHARS;

// independent reference counts (the test's own implementations, not the product's)
const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("und", { granularity: "grapheme" }) : null;
function counts(s) {
  const out = [];
  for (const f of [s, s.normalize("NFC"), s.normalize("NFD"), s.normalize("NFKC"), s.normalize("NFKD")]) {
    out.push(f.length, Array.from(f).length, Buffer.byteLength(f, "utf8"));
    if (seg) out.push(Array.from(seg.segment(f)).length);
  }
  return out;
}
const maxCount = (s) => Math.max(...counts(s));

(async () => {
  section("C1 ONE bound TTS model everywhere");
  eq(TTS.TTS_MODEL, "tts-1", "adapter model constant is tts-1");
  eq(AUTH.TTS_MODEL, "tts-1", "BudgetCore TTS class model is tts-1 (catalog resolve uses it)");
  eq(CFG.LIVE_AI_TTS_MODEL, "tts-1", "config allowlist is tts-1");
  ok(CFG.loadLiveAiConfig({ LIVE_AI_TTS_MODEL: "gpt-4o-mini-tts", OPENAI_API_KEY: "x" }).ttsModel === "", "configuring the previous model now DISABLES TTS (no silent fallback / no browser-chosen model)");
  ok(TTS.createTtsAdapter({ model: "gpt-4o-mini-tts", call: async () => ({ ok: true, chunks: [] }) }).available === false, "an adapter for any other model is unavailable");
  ok(PRICING.BILLING_DIMENSIONS.includes("tts_input_character"), "the additive `tts_input_character` billing dimension exists");
  ok(["reasoning_input_token", "reasoning_output_token", "realtime_audio_second", "tts_output_token", "tts_output_second"].every((d) => PRICING.BILLING_DIMENSIONS.includes(d)), "every pre-existing billing dimension is preserved (additive only)");

  section("C2 conservative billable-character upper bound of the exact provider `input` (Unicode)");
  eq(typeof TTS.ttsBillableCharUpperBound, "function", "the bound function exists");
  eq(CAP, 4096, "admission cap = the provider-documented 4,096-character input maximum");
  eq(bound(""), null, "empty text ⇒ refused");
  eq(bound(42), null, "non-string ⇒ refused");
  eq(bound("a".repeat(2001)), null, "more than 2,000 JS code units ⇒ refused (existing text ceiling kept)");
  eq(bound("ab\uD800cd"), null, "ill-formed UTF-16 (lone high surrogate) ⇒ refused");
  eq(bound("ab\uDC00cd"), null, "ill-formed UTF-16 (lone low surrogate) ⇒ refused");
  eq(bound("3 matching stays are shown."), 27, "ASCII: bound = character count");
  const hi = "नमस्ते, 3 होटल दिख रहे हैं।";
  ok(bound(hi) >= maxCount(hi) && bound(hi) === Buffer.byteLength(hi, "utf8"), `Devanagari: bound (${bound(hi)}) = UTF-8 bytes ≥ every count (${maxCount(hi)})`);
  const hing = "Aapke liye 3 stays hain — Dehradun में ₹3,200 से";
  ok(bound(hing) >= maxCount(hing), `Hinglish mixed: bound ${bound(hing)} ≥ ${maxCount(hing)}`);
  for (const [label, s] of [["emoji + skin tone", "👍🏽 great"], ["ZWJ family", "👨‍👩‍👧 trip"], ["combining acute (NFD)", "café"], ["precomposed (NFC)", "café"],
    ["NFKD-expanding U+FDFA", "ﷺ"], ["ligature ﬁ", "ﬁne"], ["Hangul NFD expansion", "한국"], ["Devanagari nukta + virama", "क़्ष"], ["regional flags", "🇮🇳🇮🇳"]]) {
    ok(bound(s) !== null && bound(s) >= maxCount(s), `${label}: bound ${bound(s)} ≥ max(UTF-16 / code points / graphemes / UTF-8 bytes over 5 forms) = ${maxCount(s)}`);
  }
  ok(bound("ﷺ") === Buffer.byteLength("ﷺ".normalize("NFKD"), "utf8") && bound("ﷺ") > Buffer.byteLength("ﷺ", "utf8"), "normalization expansion is covered (bound uses the NFKD form when it is larger)");
  // seeded property check
  let seed = 0x5eed; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const pools = ["abcXYZ 0123.,!?", "नमस्तेहोटलदिखरहेहैंक़्ष।", "़्́̈", "👍🏽👨‍👩‍👧🇮🇳😀", "한국語日本", "ﷺﬁﬂ㎏"];
  let propBad = 0, propN = 0, maxSeen = 0;
  for (let i = 0; i < 600; i++) {
    let s = ""; const n = 1 + Math.floor(rnd() * 60);
    for (let k = 0; k < n; k++) { const p = Array.from(pools[Math.floor(rnd() * pools.length)]); s += p[Math.floor(rnd() * p.length)]; }
    const b = bound(s); propN++;
    if (b === null || b < maxCount(s)) propBad++;
    if (b !== null && b > maxSeen) maxSeen = b;
  }
  eq(propBad, 0, `property: bound ≥ every reference count for ${propN} seeded mixed-script strings (max bound seen ${maxSeen})`);
  const longHi = "होटल ".repeat(340).trim();                   // 1,699 code units (≤ 2,000), ≈4,420 UTF-8 bytes (> 4,096)
  ok(longHi.length <= 2000 && bound(longHi) > CAP, `a ${longHi.length}-code-unit Devanagari text has bound ${bound(longHi)} > ${CAP} ⇒ must NOT be voiced (captions only)`);

  section("C3 exact fake-provider request + adapter fail-closed (zero calls)");
  const reqs = [];
  const fakeFetch = async (url, init) => { reqs.push({ url, init }); return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(4800).buffer }; };
  const call = TTS.createDefaultTtsCall("offline-placeholder-not-a-credential", fakeFetch);
  const adapter = TTS.createTtsAdapter({ model: TTS.TTS_MODEL, call });
  const r1 = await adapter.synthesize({ text: hi, language: "hi" });
  ok(r1 && r1.ok === true && reqs.length === 1, "one synthesis ⇒ exactly ONE provider POST");
  const body = reqs[0] ? JSON.parse(reqs[0].init.body) : {};
  eq(reqs[0] && reqs[0].url, "https://api.openai.com/v1/audio/speech", "fixed speech endpoint");
  eq(reqs[0] && reqs[0].init.method, "POST", "POST");
  eq(JSON.stringify(Object.keys(body).sort()), JSON.stringify(["input", "model", "response_format", "voice"]), "body has EXACTLY model/voice/input/response_format (no instructions / stream_format / speed)");
  ok(body.model === "tts-1" && body.voice === "alloy" && body.response_format === "pcm", "model tts-1, voice alloy, response_format pcm (PCM16 24 kHz mono contract)");
  eq(body.input, hi, "`input` is the exact server text, verbatim");
  const before = reqs.length;
  for (const [label, t] of [["empty", ""], ["2,001 code units", "a".repeat(2001)], ["bound > cap", longHi], ["ill-formed", "x\uD800"]]) {
    const r = await adapter.synthesize({ text: t, language: "en" });
    ok(r && r.ok === false, `adapter refuses ${label}`);
  }
  eq(reqs.length, before, "ZERO provider requests for every refused input");
  const orch = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-orchestrator.ts"), "utf8");
  const iBound = orch.indexOf("ttsBillableCharUpperBound(plan.ttsText)"), iRes = orch.indexOf("reserve(session, RESERVE_TTS_UNITS, \"TTS\"");
  ok(iBound > 0 && iRes > iBound, "orchestrator checks the bound BEFORE any TTS reservation (cap inputs before quote/reserve)");
  const idx = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
  ok(/ttsBillableCharUpperBound\(env\.canonicalText\)/.test(idx), "the gateway never offers a speech plan whose bound exceeds the cap (no lease, no approval)");

  section("C4 one-component character pricing from the verified catalog ONLY (fail closed)");
  const now = Date.now();
  const row = (o) => Object.assign({ provider: "openai", model: "tts-1", serviceTier: null, billingDimension: "tts_input_character", unitSize: BigInt(1000000), rateMicros: BigInt(15000000),
    currencyCode: "USD", effectiveFromMs: 0, effectiveUntilMs: null, verifiedAtMs: 0, verificationExpiresAtMs: now + 86400000, sourceId: "test-only", sourceDigest: "d", status: "active" }, o || {});
  const rule = PUB.resolveTtsReservationRule({ LIVE_AI_TTS_RESERVE_DIMENSION: "tts_input_character", LIVE_AI_TTS_RESERVE_UNITS: "4096" });
  ok(rule && rule.dimension === "tts_input_character" && rule.units === BigInt(4096), "owner rule tts_input_character / 4096 accepted");
  eq(PUB.resolveTtsReservationRule({ LIVE_AI_TTS_RESERVE_DIMENSION: "tts_input_character", LIVE_AI_TTS_RESERVE_UNITS: "4095" }), null, "a rule below the admission cap ⇒ refused (reservation must cover every admissible input)");
  for (const d of ["tts_output_token", "tts_output_second", "reasoning_input_token"]) eq(PUB.resolveTtsReservationRule({ LIVE_AI_TTS_RESERVE_DIMENSION: d, LIVE_AI_TTS_RESERVE_UNITS: "4096" }), null, `rule dimension ${d} ⇒ refused (no relabelling of char-priced tts-1)`);
  eq(PUB.resolveTtsReservationRule({ LIVE_AI_TTS_RESERVE_DIMENSION: "tts_input_character", LIVE_AI_TTS_RESERVE_UNITS: "100001" }), null, "over the hard units ceiling ⇒ refused");
  const q = (rows, r) => PUB.quoteVoiceWorstCaseMicros(PRICING.createPriceCatalog("t", rows), "TTS", r === undefined ? rule : r, now);
  eq(q([row()]), BigInt(61440), "worst case = 4,096 chars × $15/1M = 61,440 µ$ ($0.06144 per call) — TEST-ONLY fixture rate");
  eq(q([row({ rateMicros: BigInt(15000001) })]), BigInt(61441), "ceil rounding to a positive integer µ$ (61,440.004096 ⇒ 61,441)");
  eq(q([]), null, "missing catalog row ⇒ fail closed");
  eq(q([row({ model: "gpt-4o-mini-tts" })]), null, "wrong-model row ⇒ fail closed");
  eq(q([row({ billingDimension: "tts_output_token" })]), null, "relabelled-dimension row ⇒ fail closed");
  eq(q([row({ status: "inactive" })]), null, "inactive row ⇒ fail closed");
  eq(q([row({ verificationExpiresAtMs: now - 1 })]), null, "stale (verification expired) row ⇒ fail closed");
  eq(q([row({ currencyCode: "INR" })]), null, "non-USD row ⇒ fail closed");
  eq(q([row({ effectiveFromMs: now + 60000 })]), null, "not-yet-effective row ⇒ fail closed");
  eq(q([row()], null), null, "no owner rule ⇒ fail closed");
  eq(PUB.quoteVoiceWorstCaseMicros(PRICING.EMPTY_PRICE_CATALOG, "TTS", rule, now), null, "the production default (empty) catalog ⇒ fail closed");

  section("C5 ORIGINAL gateway, public composition: per-call lease + provider child + exactly-once");
  const store = OG.memoryBudgetStore({ strict: true });
  let childWrites = 0; const oc = store.recordProviderReservation.bind(store); store.recordProviderReservation = async (x) => { childWrites++; return oc(x); };
  const synth = [];
  const gw = await OG.createOfflineGateway({ compiled, composition: "public", store,
    tts: { available: true, model: TTS.TTS_MODEL, async synthesize(input) { synth.push(input.text); return { ok: true, chunks: [{ seq: 0, bytes: Buffer.alloc(480).toString("base64") }] }; } },
    voiceRates: { tts: true }, ttsRule: { dimension: "tts_input_character", units: BigInt(4096) } });
  const C = require(path.join(compiled.LIB, "contracts.js")); const R = require(path.join(compiled.LIB, "runtime.js"));
  const CONV = require(path.join(compiled.LIB, "conversation.js")); const GC = require(path.join(compiled.LIB, "gateway-client.js"));
  const A = require(path.join(compiled.LIB, "audio-playback.js")); const BROKER = require(path.join(compiled.LIB, "broker.js"));
  const runtime = R.createLiveAiRuntime("customer");
  const broker = OG.makeBrokerFetch(gw, BROKER, { route: "customer", subject: "pub1." + crypto.createHash("sha256").update("tts1-c5").digest("hex"), ip: "10.7.0.1" });
  const sock = OG.makeSocketOpener(gw);
  const transport = GC.createGatewayTransport({ fetchImpl: broker.fetchImpl, openSocket: sock.openSocket, retainSessionAfterCapture: true });
  const approvals = []; const oa = transport.submitApproval.bind(transport); transport.submitApproval = (x) => { approvals.push(x); return oa(x); };
  const conv = CONV.createConversation({ runtime, transport, audio: A.createAudioPlayback({ sink: { resume: async () => true, enqueue: () => {}, stopAndClear: () => {}, close: () => {}, state: () => "running" } }), onEvent: () => {}, speakCompiledAnswers: () => true });
  // the SAME page fixture as the accepted tests/live-ai/travel-buddy-tts-cancel.test.js
  const HOTELS = [
    { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi", "Parking"] },
    { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["WiFi"] },
  ];
  const s = { displayHotels: HOTELS.slice(), maxPrice: null };
  runtime.invalidateRoute("/hotels"); runtime.registerPage({ pageId: "hotels", routeKey: "/hotels", __state: s,
    getSnapshot: () => C.buildHotelsSnapshot({ displayHotels: s.displayHotels, city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: s.maxPrice, sort: "default", stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Parking"], loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready", role: "customer" }),
    execute: () => {} });
  const ttsLeases = () => store.state.acquisitions.filter((a) => a.budgetClass === "PROVIDER_SPEND" && /^pub-spend\./.test(a.key) && a.money === BigInt(4096 * 15)).length;
  await conv.start("text"); await until(() => conv.getState() === "IDLE", 4000);
  conv.submitText("show me the stays");
  await until(() => synth.length >= 1, 8000); await sleep(150);
  eq(synth.length, 1, "first approved answer ⇒ exactly ONE synthesis");
  ok(/matching stays (is|are) shown/i.test(synth[0] || ""), `voiced the verified canonical text ("${synth[0]}")`);
  eq(ttsLeases(), 1, "its OWN TTS lease, priced from the catalog = 4,096 × 15 µ$ (harness fixture, unitSize 1)");
  const c1 = childWrites;
  // replay the SAME approval frame: the one-use plan is gone ⇒ no second synthesis / lease
  const last = approvals[approvals.length - 1];
  if (last) transport.submitApproval(last);
  await sleep(300);
  eq(synth.length, 1, "a replayed approval NEVER re-synthesizes (one-use plan)");
  eq(ttsLeases(), 1, "…and acquires no second lease");
  await until(() => conv.getState() === "IDLE", 4000);
  conv.submitText("show me the stays");
  await until(() => synth.length >= 2, 8000); await sleep(150);
  eq(synth.length, 2, "a second approved answer ⇒ its own synthesis");
  eq(ttsLeases(), 2, "…with its OWN separate lease (budget never silently re-used)");
  ok(childWrites > c1, "…and its OWN durable provider-child write");
  const anon = await gw.rawCreateSession(await gw.assertionWith({ auth: false, subject: "px." + "a".repeat(32) }), { mode: "microphone", sessionId: "s" + crypto.randomBytes(6).toString("hex"), sdp: "v=0\r\n" }, "10.7.0.2");
  eq(anon.status, 503, "signed-in-only admission unchanged: an anonymous microphone session ⇒ 503");
  conv.end("user"); await gw.close();

  section("Network backstop");
  eq(net.attempts.length, 0, "ZERO process-level network attempts");
  console.log(`\n  TTS-1 character-billing regression: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("FATAL", e && e.stack ? e.stack : e); console.log(`\n  TTS-1 character-billing regression: ${passed} passed, ${failed + 1} failed`); process.exit(1); });
