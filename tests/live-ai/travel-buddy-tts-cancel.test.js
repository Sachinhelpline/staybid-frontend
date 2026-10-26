#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// REAL TEDDY — QUEUED-TTS CANCELLATION OWNERSHIP regression (Node, deterministic, NO network, NO provider).
// Run:  node tests/live-ai/travel-buddy-tts-cancel.test.js
//
// Recreates the race SAME WORK #2 traced: a genuine answer.approve consumes the one-use plan and schedules
// deps.runTts, which the per-session provider lane QUEUES behind the still-pending 03B finish/reconciliation;
// a legitimate turn.interrupt (barge-in / Stop) then aborts the old session.abort and installs a NEW
// AbortController; when the lane releases, the queued job must NOT begin a new paid synthesis.
// The lane is held for real: the durable store's `reconcile` (called by the 03B finish INSIDE the lane) is
// gated, and the suite asserts the approval arrived WHILE that reconcile was pending (an actual queued race,
// not an early-mute stand-in). Fakes: offline keyword model, in-memory strict budget store, TTS seam
// (counted). Drives the ORIGINAL browser controller (runtime + conversation + gateway-client) against the
// ORIGINAL gateway source in-process (public composition). NOT real-provider proof.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const crypto = require("crypto");
const OG = require("./offline-gateway/offline-gateway");

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, l + (a === b ? "" : ` [got ${JSON.stringify(a)} want ${JSON.stringify(b)}]`)); }
function section(n) { console.log("\n• " + n); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (pred()) return true; await sleep(step || 5); } return !!pred(); }

const net = OG.assertNoNetwork();
const compiled = OG.compileSources(path.join(__dirname, ".build", "tb-tts-cancel"));
process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
const C = require(path.join(compiled.LIB, "contracts.js"));
const R = require(path.join(compiled.LIB, "runtime.js"));
const CONV = require(path.join(compiled.LIB, "conversation.js"));
const GC = require(path.join(compiled.LIB, "gateway-client.js"));
const A = require(path.join(compiled.LIB, "audio-playback.js"));
const BROKER = require(path.join(compiled.LIB, "broker.js"));

const HOTELS = [
  { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi", "Parking"] },
  { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["WiFi"] },
];
function hotelsPage() {
  const s = { displayHotels: HOTELS.slice(), maxPrice: null };
  return { s, reg: { pageId: "hotels", routeKey: "/hotels", __state: s,
    getSnapshot: () => C.buildHotelsSnapshot({ displayHotels: s.displayHotels, city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: s.maxPrice, sort: "default", stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Parking"], loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready", role: "customer" }),
    execute: () => {} } };
}
function runningSink() { const enqueued = []; return { enqueued, resume: async () => true, enqueue: (x) => enqueued.push(x.length), stopAndClear: () => { enqueued.length = 0; }, close: () => {}, state: () => "running" }; }
let n = 0;
const nextSubject = () => "pub1." + crypto.createHash("sha256").update("tts-cancel-" + (++n)).digest("hex");
const nextIp = () => "10.9.0." + (n + 1);

/** One public gateway whose durable store's reconcile (+ provider-child write) can be GATED to hold the lane. */
async function harness() {
  const store = OG.memoryBudgetStore({ strict: true });
  const gate = { reconcile: null, waitingReconcile: 0, child: null, waitingChild: 0, childWrites: 0 };
  const origRec = store.reconcile.bind(store);
  store.reconcile = async (r) => { if (gate.reconcile) { gate.waitingReconcile++; await gate.reconcile.p; gate.waitingReconcile--; } return origRec(r); };
  const origChild = store.recordProviderReservation.bind(store);
  store.recordProviderReservation = async (r) => { gate.childWrites++; if (gate.child) { gate.waitingChild++; await gate.child.p; gate.waitingChild--; } return origChild(r); };
  const tts = [];
  const gw = await OG.createOfflineGateway({
    compiled, composition: "public", store,
    tts: { available: true, model: "tts-1", async synthesize(input) { tts.push({ text: input.text, aborted: !!(input.signal && input.signal.aborted) }); return { ok: true, chunks: [{ seq: 0, bytes: Buffer.alloc(480).toString("base64") }], usage: input.text.length }; } },
    // // CHANGED FIXTURE (TEMPORARY tts-1 FALLBACK): the bound TTS model is tts-1, char-priced (tts_input_character); assertion meaning unchanged.
    voiceRates: { tts: true }, ttsRule: { dimension: "tts_input_character", units: BigInt(4096) },
  });
  const hold = (k) => { let release; const p = new Promise((r) => { release = r; }); gate[k] = { p, release }; };
  const open = (k) => { const g = gate[k]; gate[k] = null; if (g) g.release(); };
  return { gw, store, gate, tts, hold, open };
}
function boot(H) {
  const runtime = R.createLiveAiRuntime("customer");
  const broker = OG.makeBrokerFetch(H.gw, BROKER, { route: "customer", subject: nextSubject(), ip: nextIp() });
  const sock = OG.makeSocketOpener(H.gw);
  const transport = GC.createGatewayTransport({ fetchImpl: broker.fetchImpl, openSocket: sock.openSocket, retainSessionAfterCapture: true });
  const approvals = [];
  const origApprove = transport.submitApproval.bind(transport);
  transport.submitApproval = (x) => { approvals.push({ x, waitingReconcile: H.gate.waitingReconcile }); return origApprove(x); };
  const sink = runningSink();
  const conv = CONV.createConversation({ runtime, transport, audio: A.createAudioPlayback({ sink }), onEvent: () => {}, speakCompiledAnswers: () => true });
  const page = hotelsPage();
  runtime.invalidateRoute("/hotels"); runtime.registerPage(page.reg);
  return { runtime, transport, conv, broker, approvals, sink };
}
const ttsLeases = (H) => H.store.state.acquisitions.filter((a) => a.budgetClass === "PROVIDER_SPEND" && /^pub-spend\./.test(a.key) && a.money === BigInt(4096 * 15)).length;   // CHANGED FIXTURE: 4,096 chars × 15 µ$ (was 500 tokens × 20 µ$)
const framesSince = (H, i) => H.gw.frames.slice(i);
async function startTurn(H, env) {
  const f0 = H.gw.frames.length;
  const started = env.conv.start("text");
  await until(() => env.conv.getState() === "IDLE", 4000);
  await started;
  env.conv.submitText("show me the stays");
  return f0;
}
/** Drive one turn so the browser APPROVES while the lane is held in the 03B finish (reconcile gated). */
async function approveWhileQueued(H, env) {
  H.hold("reconcile");
  const f0 = await startTurn(H, env);
  const approved = await until(() => env.approvals.length > 0, 8000);
  // let the approval frame cross the control socket and be consumed (plan taken, TTS queued in the lane)
  await until(() => framesSince(H, f0).some((f) => f.dir === "c2s" && f.t === "answer.approve"), 2000);
  await sleep(30);
  return { f0, approved, queuedBehindReconcile: env.approvals.length > 0 && env.approvals[0].waitingReconcile > 0 && H.gate.waitingReconcile > 0 };
}
function interrupt(env, reason) {
  const a = env.approvals[env.approvals.length - 1].x;
  return env.transport.interrupt({ sessionId: a.sessionId, turnId: a.turnId, generation: env.conv.getGeneration(), reason });
}

(async () => {
  // ── T1 — the traced race: approve → queued behind reconcile → barge-in → lane releases ⇒ NO new synthesis ──
  section("T1 approved TTS queued behind the 03B finish, then barge-in (turn.interrupt) — ZERO new paid synthesis");
  for (const reason of ["barge_in", "user_cancel", "context_change", "route_change"]) {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    ok(r.approved && r.queuedBehindReconcile, `[${reason}] the approval was sent WHILE the lane was held in the 03B finish reconcile (actual queued race)`);
    const l0 = ttsLeases(H), c0 = H.gate.childWrites, t0 = H.tts.length;
    interrupt(env, reason);
    await until(() => framesSince(H, r.f0).some((f) => f.dir === "c2s" && f.t === "turn.interrupt"), 2000);
    await sleep(30);
    H.open("reconcile");
    await sleep(400);
    eq(H.tts.length - t0, 0, `[${reason}] ZERO TTS provider synthesis after the cancellation`);
    eq(ttsLeases(H) - l0, 0, `[${reason}] ZERO new TTS provider-spend lease`);
    eq(H.gate.childWrites - c0, 0, `[${reason}] ZERO new provider child (reservation persist)`);
    ok(!framesSince(H, r.f0).some((f) => f.dir === "s2c" && /^audio\./.test(f.t)), `[${reason}] no late audio frame reached the browser`);
    env.conv.end("user"); await H.gw.close();
  }

  // ── T2 — duplicate interrupt + session.reset + session end + runtime kill while queued ──
  section("T2 other cancellations while queued (duplicate interrupt / Stop = session end / runtime kill)");
  {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    interrupt(env, "barge_in"); interrupt(env, "barge_in");
    await sleep(40); H.open("reconcile"); await sleep(400);
    ok(r.queuedBehindReconcile && H.tts.length === 0 && ttsLeases(H) === 0, "duplicate interrupt is idempotent: still ZERO synthesis / lease, no crash");
    env.conv.end("user"); await H.gw.close();
  }
  {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    env.conv.end("user");                                   // Stop: the session is terminated while the job is queued
    await sleep(60); H.open("reconcile"); await sleep(400);
    ok(r.queuedBehindReconcile && H.tts.length === 0 && ttsLeases(H) === 0, "Stop (session end) while queued ⇒ ZERO synthesis / lease");
    await H.gw.close();
  }
  {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    H.gw.liveAiCtx.runtime.killed = true;                   // runtime kill switch while the job is queued
    await sleep(20); H.open("reconcile"); await sleep(400);
    ok(r.queuedBehindReconcile && H.tts.length === 0 && ttsLeases(H) === 0, "runtime kill while queued ⇒ ZERO synthesis / lease");
    env.conv.end("user"); await H.gw.close();
  }

  // ── T3 — the persist window inside the orchestrator: interrupt AFTER the TTS lease, DURING the provider-child write ──
  section("T3 interrupt during the TTS provider-child persist (after the lease) ⇒ synthesize is never invoked");
  {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    H.hold("child");                                        // hold the NEXT provider-child write (the TTS one)
    const c0 = H.gate.childWrites;
    H.open("reconcile");
    const reached = await until(() => H.gate.waitingChild > 0 && H.gate.childWrites > c0, 3000);
    ok(r.queuedBehindReconcile && reached, "the queued job (not cancelled) took its TTS lease and is waiting in the provider-child persist");
    interrupt(env, "barge_in");
    await sleep(40); H.open("child"); await sleep(400);
    eq(H.tts.length, 0, "an interrupt during the persist await ⇒ synthesize NEVER invoked (re-check after the async wait)");
    ok(!H.gw.frames.some((f) => f.dir === "s2c" && /^audio\./.test(f.t)), "no audio frame");
    env.conv.end("user"); await H.gw.close();
  }

  // ── T4 — ordinary approved, NOT cancelled, queued speech still works exactly once ──
  section("T4 control: approved + queued + NOT cancelled ⇒ exactly ONE synthesis of the exact canonical text");
  {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    H.open("reconcile");
    await until(() => H.tts.length > 0 && env.sink.enqueued.length > 0, 3000);
    await sleep(200);
    ok(r.queuedBehindReconcile, "the approval was queued behind the reconcile");
    eq(H.tts.length, 1, "exactly ONE synthesis");
    ok(/matching stays (is|are) shown/i.test((H.tts[0] || {}).text || ""), `the voiced text is the verified canonical answer ("${(H.tts[0] || {}).text}")`);
    eq(ttsLeases(H), 1, "exactly ONE TTS lease");
    ok(H.gw.frames.some((f) => f.dir === "s2c" && f.t === "audio.end") && env.sink.enqueued.length > 0, "audio reached and played in the browser");
    env.conv.end("user"); await H.gw.close();
  }
  // ── T5 — rapid approve → interrupt → a NEW turn's approval: only the NEW plan is voiced ──
  section("T5 a cancelled queued job never resurrects under the NEXT turn's fresh AbortController / ACK");
  {
    const H = await harness(); const env = boot(H);
    const r = await approveWhileQueued(H, env);
    interrupt(env, "barge_in");
    await sleep(30); H.open("reconcile"); await sleep(300);
    const t1 = H.tts.length;
    await until(() => env.conv.getState() === "IDLE" || env.conv.getState() === "LISTENING", 3000);
    env.conv.submitText("show me the stays");
    await until(() => H.tts.length > t1, 6000);
    await sleep(200);
    ok(r.queuedBehindReconcile && t1 === 0, "the cancelled job produced ZERO synthesis");
    eq(H.tts.length, 1, "the NEXT turn's approved answer is voiced exactly once (the old job did not ride the new controller)");
    env.conv.end("user"); await H.gw.close();
  }

  section("Network backstop");
  eq(net.attempts.length, 0, "ZERO process-level network attempts");
  console.log(`\n  QUEUED-TTS cancellation regression: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("FATAL", e && e.stack ? e.stack : e); process.exit(1); });
