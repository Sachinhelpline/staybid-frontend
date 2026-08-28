#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — deterministic interaction-shell suite
// (+ Remediation Round 1: REREV-01..07 race/state/dispatch/draft/allowlist).
//
//   Run:  node tests/voice/voice-ux.test.js
//
// Compiles the PURE lib/voice/*.ts (SB-01 + SB-02) with the LOCKFILE-INSTALLED
// local tsc (NO npx). Missing compiler OR non-zero compile FAILS the suite.
// Exercises: the UX state machine, provider-neutral transport contracts, the
// injectable audio capture (with fakes — no real device, controllable
// getUserMedia + fired cutoff callback), and the untrusted→SB-01 interaction
// bridge (fake transport + fake fetch). Plus a flag-off render proof. NO
// network, NO provider, NO DB.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
// Under the already-gitignored tests/voice/.build/ path (distinct sub-dir from
// the SB-01 suite so the two never collide).
const BUILD = path.join(__dirname, ".build", "ux");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

// ---- compile lib/voice/*.ts with the LOCAL compiler --------------------------
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
if (!fs.existsSync(path.join(OUT, "voice/index.js"))) {
  console.error("COMPILE GATE FAILED — voice JS not emitted despite exit 0");
  process.exit(2);
}
console.log("• Local tsc compile (SB-01 + SB-02): exit 0, clean");
const V = require(path.join(OUT, "voice/index.js"));

// ---- assert framework --------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(label); console.error("  ✗ " + label); }
}
function section(name) { console.log("\n• " + name); }
const tick = () => new Promise((r) => setImmediate(r));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

// ---- fake fetch (records calls; only allowlisted read paths ever appear) -----
function fakeFetch(routes) {
  const calls = [];
  const impl = async (p, init) => {
    calls.push({ path: p, init: init || {} });
    const r = routes.find((x) => x.match(p));
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  impl.calls = calls;
  return impl;
}
const HOTELS = (arr) => ({ match: (p) => p.startsWith("/api/hotels?"), status: 200, body: { hotels: arr } });
const FLASH = (deals) => ({ match: (p) => p.startsWith("/api/flash/near?"), status: 200, body: { deals } });

// ---- controllable fake audio env --------------------------------------------
function makeEnv(opts = {}) {
  const { supported = true, granted = true, tracks = 1, recorderThrows = false, failMime = false,
    deferGum = false, startThrows = false } = opts;
  const recorders = [];
  const audioTracks = Array.from({ length: tracks }, () => ({ stopped: false, stop() { this.stopped = true; } }));
  const stream = { getTracks: () => audioTracks, getAudioTracks: () => audioTracks };
  let resolveGum = null, rejectGum = null;
  function FakeRecorder(s, o) {
    if (recorderThrows) throw new Error("recorder ctor boom");
    this.stream = s; this.state = "inactive"; this.ondataavailable = null; this.onstop = null; this.onerror = null;
    recorders.push(this);
  }
  FakeRecorder.prototype.start = function () { if (startThrows) throw new Error("start boom"); this.state = "recording"; };
  FakeRecorder.prototype.stop = function () { this.state = "inactive"; if (this.onstop) this.onstop(); };
  FakeRecorder.isTypeSupported = (t) => (failMime ? false : /webm/.test(t));
  const env = {
    getUserMedia: supported
      ? (deferGum
        ? () => new Promise((res, rej) => { resolveGum = res; rejectGum = rej; })
        : async () => { if (!granted) throw new Error("denied"); return stream; })
      : undefined,
    MediaRecorderCtor: supported ? FakeRecorder : undefined,
    BlobCtor: function () { return { size: 0, type: "" }; },
    setTimeout: (fn) => { env._timeoutFn = fn; return 1; },
    clearTimeout: () => { env._timeoutFn = null; },
    _recorders: recorders,
    _tracks: audioTracks,
    _stream: stream,
    _resolveGum: (s) => resolveGum && resolveGum(s || stream),
    _rejectGum: (e) => rejectGum && rejectGum(e || new Error("denied")),
  };
  return env;
}

// production-style dispatcher config (mirrors VoiceSearchControl wiring).
function makeDispatchCtx(session) {
  const rec = { push: [], setCity: [], setSearch: [], draft: [] };
  const dispatch = V.makeVoiceActionDispatcher({
    setCity: (v) => rec.setCity.push(v),
    setSearch: (v) => rec.setSearch.push(v),
    setSearchOpen: () => {},
    setSortBy: () => {},
    setSelectedStars: () => {},
    setFilterOpen: () => {},
    router: { push: (p) => rec.push.push(p) },
    isHotelAllowlisted: (id) => session.hasHotelId(id),
    onPrepareBidDraft: (d) => rec.draft.push(d),
  });
  return { dispatch, rec };
}

(async () => {
  // ===== 1. UX STATE MACHINE ==================================================
  section("UX state machine — deterministic transitions");
  const R = V.voiceReduce;
  ok(V.INITIAL_VOICE_STATE === "IDLE", "initial state IDLE");
  ok(R("IDLE", "START").state === "REQUESTING_PERMISSION" && R("IDLE", "START").changed, "IDLE+START→REQUESTING_PERMISSION");
  ok(R("REQUESTING_PERMISSION", "RECORDER_STARTED").state === "LISTENING", "recorder started→LISTENING (REREV-02)");
  ok(R("REQUESTING_PERMISSION", "PERMISSION_GRANTED").state === "LISTENING", "compat perm-granted→LISTENING");
  ok(R("REQUESTING_PERMISSION", "PERMISSION_DENIED").state === "ERROR", "perm denied→ERROR");
  ok(R("LISTENING", "STOP").state === "TRANSCRIBING", "LISTENING+STOP→TRANSCRIBING");
  ok(R("TRANSCRIBING", "TRANSCRIPT_OK").state === "THINKING", "transcript ok→THINKING");
  ok(R("TRANSCRIBING", "TRANSCRIPT_FAIL").state === "ERROR", "transcript fail→ERROR");
  ok(R("THINKING", "ACTION_APPROVED").state === "EXECUTING_ACTION", "THINKING+approve→EXECUTING_ACTION");
  ok(R("THINKING", "RESPONSE_READY").state === "IDLE", "THINKING+response→IDLE (no TTS)");
  ok(R("EXECUTING_ACTION", "ACTION_RESULT_OK").state === "THINKING", "exec result→THINKING");
  ok(R("EXECUTING_ACTION", "ACTION_REJECTED").state === "ERROR", "exec rejected→ERROR");
  ok(R("SPEAKING", "SPEAK_COMPLETE").state === "IDLE", "speaking complete→IDLE");
  ok(R("SPEAKING", "INTERRUPT").state === "INTERRUPTED", "speaking interrupt→INTERRUPTED");
  ok(R("INTERRUPTED", "CLEANUP").state === "IDLE", "interrupted cleanup→IDLE");
  ok(R("ERROR", "RETRY").state === "REQUESTING_PERMISSION", "ERROR+RETRY→REQUESTING_PERMISSION");
  ok(R("ERROR", "SUBMIT_TEXT").state === "THINKING", "ERROR+text fallback→THINKING");
  ok(R("IDLE", "SUBMIT_TEXT").state === "THINKING", "IDLE+text fallback→THINKING");

  section("UX state machine — invalid transitions are no-ops");
  ok(R("LISTENING", "TRANSCRIPT_OK").state === "LISTENING" && !R("LISTENING", "TRANSCRIPT_OK").changed, "invalid edge → no-op");
  ok(R("IDLE", "STOP").state === "IDLE" && !R("IDLE", "STOP").changed, "IDLE+STOP → no-op");
  ok(R("IDLE", "RECORDER_STARTED").state === "IDLE" && !R("IDLE", "RECORDER_STARTED").changed, "IDLE+RECORDER_STARTED → no-op");
  ok(R("IDLE", "TOTALLY_BOGUS").state === "IDLE" && !R("IDLE", "TOTALLY_BOGUS").changed, "unknown event → no-op");
  ok(R("BOGUS_STATE", "START").state === "IDLE", "unknown state → safe IDLE");

  section("UX state machine — global CANCEL + RESET, busy");
  for (const s of ["REQUESTING_PERMISSION", "LISTENING", "TRANSCRIBING", "THINKING", "EXECUTING_ACTION", "SPEAKING"]) {
    ok(R(s, "CANCEL").state === "CANCELLED", `CANCEL from ${s}→CANCELLED`);
    ok(V.isBusy(s) === true, `isBusy(${s})=true`);
  }
  ok(R("IDLE", "CANCEL").state === "IDLE" && !R("IDLE", "CANCEL").changed, "CANCEL from IDLE → no-op");
  ok(V.isBusy("IDLE") === false && V.isBusy("ERROR") === false, "IDLE/ERROR not busy");
  for (const s of V.VOICE_STATES) ok(R(s, "RESET").state === "RESET", `RESET reachable from ${s}`);
  ok(R("CANCELLED", "CLEANUP").state === "IDLE", "cancelled cleanup→IDLE");
  ok(R("RESET", "CLEANUP").state === "IDLE", "reset cleanup→fresh IDLE");

  // ===== 2. TRANSPORT CONTRACTS ==============================================
  section("Transport contracts — request build + bounds");
  const bigIds = Array.from({ length: 30 }, (_, i) => "hotel_" + i);
  const req = V.buildTransportRequest({ transcript: "  show me hotels ", visibleHotelIds: bigIds, sessionGeneration: 1, turnId: 2 });
  ok(req && req.transcript === "show me hotels", "transcript trimmed");
  ok(req.visibleHotelIds.length === V.MAX_VISIBLE_HOTEL_IDS, "visible ids bounded to 24");
  ok(req.languageHint === "auto", "default language hint auto");
  ok(V.buildTransportRequest({ transcript: "   ", sessionGeneration: 1, turnId: 1 }) === null, "empty transcript → null");
  ok(V.buildTransportRequest({ transcript: 123, sessionGeneration: 1, turnId: 1 }) === null, "non-string transcript → null");
  ok(V.buildTransportRequest({ transcript: "x".repeat(999), sessionGeneration: 1, turnId: 1 }).transcript.length === V.MAX_TRANSCRIPT_LEN, "over-long transcript capped");
  const dupReq = V.buildTransportRequest({ transcript: "hi", visibleHotelIds: ["h_a", "h_a", "bad/id", "h_b"], sessionGeneration: 1, turnId: 1 });
  ok(dupReq.visibleHotelIds.length === 2 && dupReq.visibleHotelIds.includes("h_a") && dupReq.visibleHotelIds.includes("h_b"), "visible ids de-duplicated + malformed dropped");

  section("Transport contracts — multilingual preserved (no translation)");
  const hi = "मुझे धनौल्टी के होटल दिखाओ";
  const hinglish = "Manali ke mountain view hotels dikhao";
  ok(V.buildTransportRequest({ transcript: hi, languageHint: "hi-IN", sessionGeneration: 1, turnId: 1 }).transcript === hi, "Hindi preserved verbatim");
  ok(V.buildTransportRequest({ transcript: hinglish, languageHint: "en-IN", sessionGeneration: 1, turnId: 1 }).transcript === hinglish, "Hinglish preserved verbatim");
  ok(V.isLanguageHint("hi-IN") && V.isLanguageHint("en-IN") && V.isLanguageHint("auto"), "valid language hints");
  ok(!V.isLanguageHint("fr-FR") && !V.isLanguageHint(1), "invalid language hint rejected");

  section("Transport contracts — bounded history");
  const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "t" + i }));
  ok(V.boundHistory(many).length === V.MAX_HISTORY_TURNS, "history capped to 8 turns");
  ok(V.boundHistory([{ role: "bad", text: "x" }, { role: "user", text: "" }, 5, null]).length === 0, "bad history rows dropped");

  section("Transport contracts — response validation fails closed");
  ok(V.validateTransportResponse({ kind: "answer", text: "hi" }).kind === "answer", "answer ok");
  ok(V.validateTransportResponse({ kind: "clarify", text: "which city?" }).kind === "clarify", "clarify ok");
  ok(V.validateTransportResponse({ kind: "answer", text: "" }) === null, "empty answer text → null");
  ok(V.validateTransportResponse({ foo: 1 }) === null, "no kind → null");
  ok(V.validateTransportResponse(null) === null, "null → null");
  ok(V.validateTransportResponse({ kind: "capability", capability: "searchHotels", input: { city: "Manali" } }).kind === "capability", "capability searchHotels ok");
  ok(V.validateTransportResponse({ kind: "capability", capability: "placeBid", input: {} }).kind === "error", "unknown capability → error");
  ok(V.validateTransportResponse({ kind: "capability", capability: "searchHotels", input: { city: "Manali", method: "POST" } }) === null, "capability input with method key → null (no arbitrary method)");
  ok(V.validateTransportResponse({ kind: "capability", capability: "searchHotels", input: { url: "http://evil" } }) === null, "capability input with url key → null (no arbitrary URL)");
  ok(V.validateTransportResponse({ kind: "capability", capability: "getHotelDetails", input: { id: "../etc" } }) === null, "bad hotel id in capability → null");
  ok(V.validateTransportResponse({ kind: "ui_action", action: { type: "APPLY_SEARCH", city: "Manali", query: null } }).kind === "ui_action", "ui_action valid");
  ok(V.validateTransportResponse({ kind: "ui_action", action: { type: "NAVIGATE", url: "http://evil" } }) === null, "ui_action with url → null");
  ok(V.validateTransportResponse({ kind: "error", code: "model_timeout" }).code === "model_timeout", "transport error code passthrough");
  ok(V.validateTransportResponse({ kind: "error", code: "not_a_code" }) === null, "unknown transport error code → null (fail closed)");
  ok(V.validateTransportResponse({ kind: "answer", text: "y".repeat(9999) }).text.length === V.MAX_RESPONSE_TEXT_LEN, "answer text capped");

  // ===== 3. AUDIO CAPTURE — detection + MIME =================================
  section("Audio capture — feature detection + MIME negotiation");
  const sup = V.detectSupport(makeEnv());
  ok(sup.getUserMedia && sup.mediaRecorder && sup.isTypeSupported, "detectSupport: all present");
  const unsup = V.detectSupport(makeEnv({ supported: false }));
  ok(!unsup.getUserMedia && !unsup.mediaRecorder, "detectSupport: unsupported env");
  ok(V.negotiateMimeType(makeEnv()) === "audio/webm;codecs=opus", "MIME negotiated (not hard-coded)");
  ok(V.negotiateMimeType(makeEnv({ failMime: true })) === "", "MIME none supported → '' (never assumes webm)");
  ok(V.negotiateMimeType(makeEnv({ supported: false })) === "", "MIME unsupported env → ''");

  section("Audio capture — lifecycle + single recorder + cleanup");
  {
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    let started = false;
    const pr = cap.start({ onStarted: () => (started = true) });
    ok(pr && typeof pr.then === "function", "start() returns a promise");
    ok(cap.start() === null, "repeated start() → null (one recorder only)");
    await flush();
    ok(env._recorders.length === 1, "exactly one recorder created");
    ok(started === true, "onStarted fired after recorder.start()");
    cap.stop();
    const res = await pr;
    ok(res.ok === true, "stop → ok capture result");
    ok(env._tracks.every((t) => t.stopped), "all audio tracks stopped after capture");
  }
  {
    const env = makeEnv({ granted: false });
    const cap = V.createAudioCapture(env);
    let started = false;
    const res = await cap.start({ onStarted: () => (started = true) });
    ok(res.ok === false && res.failure === "permission_denied", "permission denied → failure");
    ok(started === false, "onStarted NOT fired on denial (no false LISTENING)");
    ok(cap.isActive() === false, "inactive after denial");
  }
  {
    const res = await V.createAudioCapture(makeEnv({ supported: false })).start();
    ok(res.ok === false && res.failure === "unsupported", "unsupported → failure unsupported");
  }
  {
    const cap = V.createAudioCapture(makeEnv({ tracks: 0 }));
    const pr = cap.start(); await flush();
    const res = await pr;
    ok(res.ok === false && res.failure === "no_audio_track", "no audio track → failure");
  }
  {
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    env._recorders[0].ondataavailable({ data: { size: 5 * 1024 * 1024, type: "audio/webm" } });
    const res = await pr;
    ok(res.ok === false && res.failure === "too_large", "over-4MB chunk → too_large (never kept)");
  }
  {
    const env = makeEnv({ recorderThrows: true });
    const res = await V.createAudioCapture(env).start();
    ok(res.ok === false && res.failure === "recorder_error", "recorder ctor throw → recorder_error");
  }
  {
    const env = makeEnv({ startThrows: true });
    let started = false;
    const res = await V.createAudioCapture(env).start({ onStarted: () => (started = true) });
    ok(res.ok === false && res.failure === "recorder_error", "recorder.start() throw → recorder_error");
    ok(started === false, "onStarted NOT fired when recorder.start() throws (no false LISTENING)");
  }

  section("Audio capture — REREV-01 cancellation race (pending getUserMedia)");
  {
    // cancel BEFORE getUserMedia resolves; late stream must be torn down.
    const env = makeEnv({ deferGum: true });
    const cap = V.createAudioCapture(env);
    let started = false;
    const pr = cap.start({ onStarted: () => (started = true) });
    await flush();
    ok(cap.isActive() === true, "active while acquiring permission");
    cap.cancel();
    env._resolveGum(); // late grant after cancel
    const res = await pr;
    await flush();
    ok(res.ok === false && res.failure === "cancelled", "cancel-before-grant → cancelled (not success)");
    ok(env._recorders.length === 0, "NO recorder created after cancel");
    ok(env._tracks.every((t) => t.stopped), "late-granted tracks stopped");
    ok(started === false, "onStarted never fired");
  }
  {
    // stop BEFORE getUserMedia resolves → cancelled, no recorder.
    const env = makeEnv({ deferGum: true });
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    cap.stop();
    env._resolveGum();
    const res = await pr;
    await flush();
    ok(res.ok === false && res.failure === "cancelled", "stop-before-grant → cancelled");
    ok(env._recorders.length === 0, "stop-before-grant creates no recorder");
    ok(env._tracks.every((t) => t.stopped), "stop-before-grant stops late tracks");
  }
  {
    // dispose BEFORE getUserMedia resolves.
    const env = makeEnv({ deferGum: true });
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    cap.dispose();
    env._resolveGum();
    const res = await pr;
    await flush();
    ok(res.ok === false && res.failure === "cancelled", "dispose-before-grant → cancelled");
    ok(env._recorders.length === 0, "dispose-before-grant creates no recorder");
    ok(env._tracks.every((t) => t.stopped), "dispose-before-grant stops late tracks");
    ok(cap.start() === null, "start after dispose → null");
  }
  {
    // synchronous onstop during cancel cannot resolve success.
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    cap.cancel(); // settles CANCELLED, then recorder.stop() fires sync onstop
    const res = await pr;
    ok(res.ok === false && res.failure === "cancelled", "sync onstop during cancel → still cancelled");
    ok(env._tracks.every((t) => t.stopped), "cancel stops all tracks");
    ok(cap.isActive() === false, "inactive after cancel");
  }
  {
    // asynchronous onstop after cancel is inert.
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    const rec = env._recorders[0];
    // Neutralize the sync stop so we can fire onstop LATE ourselves.
    rec.stop = function () { this.state = "inactive"; };
    cap.cancel();
    const res = await pr;
    rec.onstop && rec.onstop(); // late async onstop — must be inert
    ok(res.ok === false && res.failure === "cancelled", "async onstop after cancel cannot report success");
  }
  {
    // cleanup idempotent — double cancel / dispose after settle is harmless.
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    cap.cancel();
    cap.cancel();
    cap.dispose();
    await pr;
    ok(true, "double cancel + dispose did not throw (idempotent cleanup)");
  }
  {
    // auto 20s cutoff callback ACTUALLY fired (not merely recorded).
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    ok(typeof env._timeoutFn === "function", "cutoff timer scheduled");
    env._timeoutFn(); // fire the real cutoff callback → recorder.stop() → ok
    const res = await pr;
    ok(res.ok === true, "auto-cutoff completes the recording (ok result)");
    ok(env._tracks.every((t) => t.stopped), "auto-cutoff stops tracks");
  }

  // ===== 4. INTERACTION BRIDGE ==============================================
  section("Interaction bridge — provider absent fails closed, no fabrication");
  {
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const inter = V.createVoiceInteraction({ session, dispatch }); // nullTransport
    const out = await inter.submit({ transcript: "hi", visibleHotelIds: ["hotel_a"] });
    ok(out.ok === false && out.code === "provider_unavailable", "nullTransport → provider_unavailable (no fake answer)");
  }
  {
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "answer", text: "Here are some hotels." }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    const out = await inter.submit({ transcript: "show hotels" });
    ok(out.ok && out.kind === "answer" && out.text === "Here are some hotels.", "transport answer surfaced");
  }
  {
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const fetchImpl = fakeFetch([HOTELS([{ id: "hotel_x", name: "X", city: "Manali", rooms: [{ floorPrice: 1200 }] }])]);
    const transport = {
      respond: async (r, toolRuns) =>
        toolRuns.length === 0
          ? { kind: "capability", capability: "searchHotels", input: { city: "Manali" } }
          : { kind: "answer", text: "Found " + (toolRuns[0].count || 0) + " hotels." },
    };
    const inter = V.createVoiceInteraction({ session, dispatch, transport, fetchImpl });
    const out = await inter.submit({ transcript: "hotels in manali" });
    ok(out.ok && out.kind === "answer" && /Found 1/.test(out.text), "capability→answer round-trip");
    ok(out.toolRuns.length === 1 && out.toolRuns[0].ok, "one tool run recorded");
    ok(session.hasHotelId("hotel_x"), "search seeded the allowlist (only via approved adapter)");
    ok(fetchImpl.calls.length === 1 && fetchImpl.calls[0].init.method === "GET", "adapter fetch is GET only");
    ok(fetchImpl.calls.every((c) => /^\/api\/(hotels|flash\/near)/.test(c.path)), "only allowlisted read paths hit");
    ok(fetchImpl.calls.every((c) => !/(bids|booking|pay|wallet|refund|proxy|supabase|rest\/v1)/i.test(c.path)), "no mutation/backend/proxy path ever fetched");
  }

  section("Interaction bridge — UI action + REREV-04 rejected dispatch is FAILURE");
  {
    const session = V.createVoiceSession();
    const { dispatch, rec } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "ui_action", action: { type: "APPLY_SEARCH", city: "Manali", query: null } }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    const out = await inter.submit({ transcript: "search manali" });
    ok(out.ok && out.kind === "ui_action" && out.dispatch.ok, "accepted APPLY_SEARCH → overall success");
    ok(rec.setCity[0] === "manali", "setCity called via dispatcher");
  }
  {
    const session = V.createVoiceSession();
    const { dispatch, rec } = makeDispatchCtx(session);
    // OPEN_HOTEL for an id that was NEVER surfaced this session → REJECTED.
    const transport = { respond: async () => ({ kind: "ui_action", action: { type: "OPEN_HOTEL", hotelId: "hotel_secret" } }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    const out = await inter.submit({ transcript: "open it" });
    ok(out.ok === false && out.kind === "error" && out.code === "action_rejected", "REREV-04: rejected dispatch → overall FAILURE (not ok:true)");
    ok(out.detail === "hotel_id_not_allowlisted", "rejection reason retained");
    ok(rec.push.length === 0, "no navigation for non-allowlisted hotel");
  }
  {
    const session = V.createVoiceSession();
    session.allowHotelIds(["hotel_ok"]);
    const { dispatch, rec } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "ui_action", action: { type: "OPEN_HOTEL", hotelId: "hotel_ok" } }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    const out = await inter.submit({ transcript: "open", visibleHotelIds: ["hotel_ok"] });
    ok(out.ok && out.dispatch.ok && rec.push[0] === "/hotels/hotel_ok", "allowlisted OPEN_HOTEL → success + routes to /hotels/<id>");
  }

  section("Interaction bridge — REREV-05 PREPARE_BID_DRAFT local preview (production dispatcher)");
  {
    const session = V.createVoiceSession();
    session.allowHotelIds(["hotel_bid"]);
    const { dispatch, rec } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "ui_action", action: { type: "PREPARE_BID_DRAFT", hotelId: "hotel_bid", pricePerNight: 3800 } }) };
    const fetchImpl = fakeFetch([]);
    const inter = V.createVoiceInteraction({ session, dispatch, transport, fetchImpl });
    const out = await inter.submit({ transcript: "3800 ki bid laga do", visibleHotelIds: ["hotel_bid"] });
    ok(out.ok && out.dispatch.ok, "accepted bid-draft action → success");
    ok(rec.draft[0] && rec.draft[0].hotelId === "hotel_bid" && rec.draft[0].pricePerNight === 3800, "local draft preview received hotel + price");
    ok(fetchImpl.calls.length === 0, "no network for a bid draft (nothing submitted)");
    ok(rec.push.length === 0, "no navigation/submission for a bid draft");
  }
  {
    // Rejected / non-allowlisted draft → NO preview mutation.
    const session = V.createVoiceSession();
    const { dispatch, rec } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "ui_action", action: { type: "PREPARE_BID_DRAFT", hotelId: "hotel_never", pricePerNight: 999 } }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    const out = await inter.submit({ transcript: "bid" });
    ok(out.ok === false && out.code === "action_rejected", "non-allowlisted bid draft → rejected failure");
    ok(rec.draft.length === 0, "rejected draft did NOT populate preview");
  }

  section("Interaction bridge — REREV-06 visible-id prevalidation ordering");
  {
    // >24 raw ids → session receives at most 24 validated.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "answer", text: "ok" }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    await inter.submit({ transcript: "hi", visibleHotelIds: Array.from({ length: 30 }, (_, i) => "vh_" + i) });
    ok(session.allowedHotelIds().length === V.MAX_VISIBLE_HOTEL_IDS, "session allowlist bounded to 24");
  }
  {
    // duplicates + malformed do not expand authorization state.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "answer", text: "ok" }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    await inter.submit({ transcript: "hi", visibleHotelIds: ["dup", "dup", "bad/slash", "ok2"] });
    const ids = session.allowedHotelIds();
    ok(ids.length === 2 && ids.includes("dup") && ids.includes("ok2"), "dedup + malformed removed before seeding");
  }
  {
    // invalid transcript → ZERO allowlist mutation.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const transport = { respond: async () => ({ kind: "answer", text: "ok" }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport });
    const out = await inter.submit({ transcript: "   ", visibleHotelIds: ["would_be_seeded"] });
    ok(out.ok === false && out.code === "empty_transcript", "empty transcript → failure");
    ok(session.allowedHotelIds().length === 0, "empty transcript created ZERO authorized hotel ids");
  }

  section("Interaction bridge — malformed / loop fail closed");
  {
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => ({ nope: true }) } });
    const out = await inter.submit({ transcript: "x" });
    ok(out.ok === false && out.code === "malformed_response", "malformed transport → malformed_response");
  }
  {
    const session = V.createVoiceSession();
    session.allowHotelIds(["hotel_x"]);
    const { dispatch } = makeDispatchCtx(session);
    const fetchImpl = fakeFetch([HOTELS([{ id: "hotel_x", name: "X", city: "Manali", rooms: [] }])]);
    const transport = { respond: async () => ({ kind: "capability", capability: "searchHotels", input: { city: "Manali" } }) };
    const inter = V.createVoiceInteraction({ session, dispatch, transport, fetchImpl });
    const out = await inter.submit({ transcript: "loop" });
    ok(out.ok === false && out.code === "too_many_actions", "runaway capability loop → too_many_actions");
    ok(out.toolRuns.length <= V.MAX_ACTIONS_PER_TURN, "loop hard-capped");
  }

  section("Interaction bridge — REREV-03 cancel/reset invalidates in-flight turn");
  {
    // Cancel → late text answer is stale (no UI effect).
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    let release;
    const gate = new Promise((r) => (release = r));
    const inter = V.createVoiceInteraction({
      session, dispatch,
      transport: { respond: async () => { await gate; return { kind: "answer", text: "late" }; } },
    });
    const gen0 = inter.currentGeneration();
    const p = inter.submit({ transcript: "slow" });
    inter.cancel(); // invalidate the in-flight turn
    ok(inter.currentGeneration() !== gen0, "cancel bumps interaction generation");
    release();
    const out = await p;
    ok(out.ok === false && out.code === "stale_result", "answer after cancel → stale_result");
  }
  {
    // Cancel → late capability result never dispatches an action.
    const session = V.createVoiceSession();
    session.allowHotelIds(["hotel_x"]);
    const { dispatch, rec } = makeDispatchCtx(session);
    let release;
    const gate = new Promise((r) => (release = r));
    const fetchImpl = fakeFetch([HOTELS([{ id: "hotel_x", name: "X", city: "Manali", rooms: [] }])]);
    const transport = { respond: async () => { await gate; return { kind: "ui_action", action: { type: "APPLY_SEARCH", city: "Manali", query: null } }; } };
    const inter = V.createVoiceInteraction({ session, dispatch, transport, fetchImpl });
    const p = inter.submit({ transcript: "search" });
    inter.cancel();
    release();
    const out = await p;
    ok(out.ok === false && out.code === "stale_result", "ui_action after cancel → stale_result");
    ok(rec.setCity.length === 0 && rec.push.length === 0, "no dispatch side effect after cancel");
  }
  {
    // Reset makes previous interaction stale too.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    let release;
    const gate = new Promise((r) => (release = r));
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => { await gate; return { kind: "answer", text: "late" }; } } });
    const p = inter.submit({ transcript: "slow" });
    inter.reset();
    release();
    const out = await p;
    ok(out.ok === false && out.code === "stale_result", "answer after reset → stale_result");
  }
  {
    // cancel twice is harmless.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const inter = V.createVoiceInteraction({ session, dispatch });
    inter.cancel(); inter.cancel();
    ok(true, "double cancel did not throw");
  }

  // ===== R2 BLOCKER A — active recorder teardown =============================
  section("Audio capture — R2 Blocker A: active recorder teardown");
  {
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    const rec = env._recorders[0];
    let stops = 0; const orig = rec.stop.bind(rec); rec.stop = () => { stops++; orig(); };
    cap.cancel();
    const res = await pr;
    ok(res.ok === false && res.failure === "cancelled", "active cancel → cancelled");
    ok(stops === 1, "active cancel → recorder.stop called EXACTLY once");
    ok(rec.state === "inactive", "recorder no longer recording after cancel");
  }
  {
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    const rec = env._recorders[0];
    let stops = 0; const orig = rec.stop.bind(rec); rec.stop = () => { stops++; orig(); };
    cap.dispose();
    const res = await pr;
    ok(res.failure === "cancelled" && stops === 1, "active dispose → recorder.stop EXACTLY once");
  }
  {
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    const rec = env._recorders[0];
    let stops = 0; const orig = rec.stop.bind(rec); rec.stop = () => { stops++; orig(); };
    cap.cancel(); cap.cancel(); cap.dispose();
    await pr;
    ok(stops === 1, "double cancel + dispose → recorder.stop still once (idempotent)");
  }
  {
    // async onstop after cancel: recorder ref captured, stop once, onstop inert.
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    const rec = env._recorders[0];
    let stops = 0;
    rec.stop = () => { stops++; rec.state = "inactive"; }; // defer onstop
    cap.cancel();
    const res = await pr;
    if (rec.onstop) rec.onstop(); // late async onstop
    ok(res.failure === "cancelled" && stops === 1, "async onstop after cancel inert; stop once");
  }
  {
    // no overlapping old/new recorder.
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr1 = cap.start(); await flush();
    const rec1 = env._recorders[0];
    cap.cancel(); await pr1;
    ok(rec1.state === "inactive", "old recorder inactive after cancel");
    const pr2 = cap.start(); await flush();
    ok(env._recorders.length === 2, "new start creates exactly one new recorder");
    ok(env._recorders[1].state === "recording" && rec1.state === "inactive", "no overlapping active recorders");
    cap.cancel(); await pr2;
  }
  {
    // stop() during active recording remains normal completion.
    const env = makeEnv();
    const cap = V.createAudioCapture(env);
    const pr = cap.start(); await flush();
    cap.stop();
    const res = await pr;
    ok(res.ok === true, "stop during active recording → normal ok completion (not cancelled)");
  }

  // ===== R2 BLOCKER B — ERROR-state retry (not ERROR+START) ==================
  section("UX state machine — R2 Blocker B: ERROR retry, invalid start = zero mic");
  ok(R("ERROR", "START").state === "ERROR" && !R("ERROR", "START").changed, "ERROR+START is a NO-OP (never a valid mic start)");
  ok(R("ERROR", "RETRY").state === "REQUESTING_PERMISSION", "ERROR+RETRY → REQUESTING_PERMISSION");
  function wouldStartMic(s) { const ev = s === "ERROR" ? "RETRY" : "START"; return R(s, ev).state === "REQUESTING_PERMISSION"; }
  ok(wouldStartMic("IDLE") === true, "guard: IDLE would start mic (START→REQUESTING_PERMISSION)");
  ok(wouldStartMic("ERROR") === true, "guard: ERROR would start mic via RETRY");
  ok(wouldStartMic("CANCELLED") === true, "guard: CANCELLED would start mic (START edge)");
  ok(wouldStartMic("THINKING") === false, "guard: THINKING → zero capture");
  ok(wouldStartMic("LISTENING") === false, "guard: LISTENING → zero capture");
  ok(wouldStartMic("EXECUTING_ACTION") === false, "guard: EXECUTING_ACTION → zero capture");

  // ===== R2 BLOCKER C — single-flight submission ownership ===================
  section("Interaction bridge — R2 Blocker C: single-flight submission ownership");
  {
    // A in flight → B gated (busy), no second transport call.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    let release, calls = 0;
    const gate = new Promise((r) => (release = r));
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => { calls++; await gate; return { kind: "answer", text: "a" }; } } });
    const pA = inter.submit({ transcript: "A" });
    ok(inter.isBusy() === true, "A owns the active slot");
    const outB = await inter.submit({ transcript: "B" });
    ok(outB.ok === false && outB.code === "busy", "B while A active → busy (no overlap)");
    ok(calls === 1, "only ONE transport call (B never reached transport)");
    release(); await pA;
    ok(inter.isBusy() === false, "slot released after A completes");
  }
  {
    // cancel A → B starts; A late finally does NOT clear B; C gated; stale suppression.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    let releaseA, releaseB, which = 0;
    const gateA = new Promise((r) => (releaseA = r));
    const gateB = new Promise((r) => (releaseB = r));
    const inter = V.createVoiceInteraction({
      session, dispatch,
      transport: { respond: async () => { which++; if (which === 1) { await gateA; return { kind: "answer", text: "A" }; } await gateB; return { kind: "answer", text: "B" }; } },
    });
    const pA = inter.submit({ transcript: "A" });
    inter.cancel(); // frees slot + bumps generation
    ok(inter.isBusy() === false, "cancel A frees the active slot");
    const pB = inter.submit({ transcript: "B" });
    ok(inter.isBusy() === true, "B now owns the active slot");
    releaseA();
    const outA = await pA;
    ok(outA.ok === false && outA.code === "stale_result", "A's late result is stale (no UI effect)");
    ok(inter.isBusy() === true, "A's late finally did NOT clear B's slot");
    const outC = await inter.submit({ transcript: "C" });
    ok(outC.ok === false && outC.code === "busy", "C while B active → busy (no third concurrent submit)");
    releaseB();
    const outB = await pB;
    ok(outB.ok && outB.kind === "answer" && outB.text === "B", "B completes normally");
    ok(inter.isBusy() === false, "slot released after B completes");
  }
  {
    // new submission after actual completion works normally.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => ({ kind: "answer", text: "ok" }) } });
    const o1 = await inter.submit({ transcript: "1" });
    ok(o1.ok && inter.isBusy() === false, "submission completes and frees slot");
    const o2 = await inter.submit({ transcript: "2" });
    ok(o2.ok, "new submission after completion works normally");
  }
  {
    // reset invalidates owner.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    let release; const gate = new Promise((r) => (release = r));
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => { await gate; return { kind: "answer", text: "late" }; } } });
    const p = inter.submit({ transcript: "x" });
    inter.reset();
    ok(inter.isBusy() === false, "reset frees the active slot");
    release();
    const out = await p;
    ok(out.ok === false && out.code === "stale_result", "post-reset result stale");
  }
  {
    // double cancel harmless; ownership cleanup exactly once.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const inter = V.createVoiceInteraction({ session, dispatch });
    inter.cancel(); inter.cancel();
    ok(inter.isBusy() === false, "double cancel harmless, slot free");
  }

  // ===== R3 SB02-R2-NEW-01 — transport/local trust-domain separation =========
  section("Transport trust boundary — provider cannot claim a LOCAL control code");
  {
    // 1. provider-originated LOCAL control codes are REJECTED (fail closed → null).
    for (const localCode of ["busy", "stale_result", "too_many_actions", "action_rejected", "transport_invalid"]) {
      ok(V.validateTransportResponse({ kind: "error", code: localCode }) === null, `transport error code "${localCode}" → null (local-only, rejected)`);
    }
    // 2. legitimate TRANSPORT error codes still validate.
    for (const tCode of ["provider_unavailable", "empty_transcript", "stt_timeout", "stt_failed", "model_timeout", "model_failed", "tts_failed", "malformed_response", "unknown_capability"]) {
      const r = V.validateTransportResponse({ kind: "error", code: tCode });
      ok(r && r.kind === "error" && r.code === tCode, `transport error code "${tCode}" accepted`);
    }
    // 3. unknown transport error code fails closed.
    ok(V.validateTransportResponse({ kind: "error", code: "totally_made_up" }) === null, "unknown transport error code → null");
    // 4/5. a provider claiming busy cannot become a LOCAL busy or touch ownership.
    ok(typeof V.isTransportErrorCode === "function" && V.isTransportErrorCode("busy") === false, "isTransportErrorCode('busy') === false");
    ok(V.isTransportErrorCode("model_timeout") === true, "isTransportErrorCode('model_timeout') === true");
  }
  {
    // Provider returns {kind:error,code:busy} → interaction surfaces a NON-busy
    // bounded error (malformed_response), never local busy; ownership untouched.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => ({ kind: "error", code: "busy" }) } });
    const out = await inter.submit({ transcript: "x" });
    ok(out.ok === false && out.code === "malformed_response", "provider busy → malformed_response (NOT local busy)");
    ok(inter.isBusy() === false, "provider busy did not leave the slot owned");
  }
  {
    // LOCAL busy is still produced ONLY by the interaction's single-flight gate,
    // BEFORE any transport call — never from a provider response.
    const session = V.createVoiceSession();
    const { dispatch } = makeDispatchCtx(session);
    let release, calls = 0;
    const gate = new Promise((r) => (release = r));
    const inter = V.createVoiceInteraction({ session, dispatch, transport: { respond: async () => { calls++; await gate; return { kind: "answer", text: "a" }; } } });
    const pA = inter.submit({ transcript: "A" });
    const outB = await inter.submit({ transcript: "B" });
    ok(outB.ok === false && outB.code === "busy", "LOCAL busy still returned by the single-flight gate");
    ok(calls === 1, "LOCAL busy generated BEFORE transport (no second transport call)");
    ok(inter.isBusy() === true, "refused submission did not alter the active slot");
    release(); await pA;
  }

  // ===== R3 THINKING-recovery — no silent return leaves THINKING ==============
  section("THINKING recovery — deterministic exit for local busy + malformed provider");
  // The reducer provides deterministic THINKING exits the component uses:
  ok(R("THINKING", "RESPONSE_READY").state === "IDLE", "THINKING+RESPONSE_READY → IDLE (busy recovery exit)");
  ok(R("THINKING", "TRANSCRIPT_FAIL").state === "ERROR", "THINKING+TRANSCRIPT_FAIL → ERROR (error exit)");
  {
    // Source-level guard: the VoicePanel busy branch must NOT be a bare silent
    // return that leaves THINKING — it must apply a deterministic transition.
    const src = fs.readFileSync(path.join(REPO, "components/voice/VoicePanel.tsx"), "utf8");
    ok(!/code === "busy"\)\s*return;/.test(src), "no silent `code === \"busy\") return;` (would strand THINKING)");
    ok(/code === "busy"\)\s*\{[\s\S]*?apply\("RESPONSE_READY"\)/.test(src), "busy branch applies RESPONSE_READY (deterministic THINKING→IDLE)");
    // The component gates BEFORE entering THINKING when already busy.
    ok(/interaction\.isBusy\(\)\)\s*return;/.test(src), "pre-submit isBusy() gate present (prevents THINKING when busy)");
    ok(src.indexOf("interaction.isBusy()") < src.indexOf('apply("SUBMIT_TEXT")'), "isBusy() gate precedes apply(\"SUBMIT_TEXT\")");
    // A malformed provider result (incl. provider-busy) routes to TRANSCRIPT_FAIL.
    ok(/apply\("TRANSCRIPT_FAIL"\)/.test(src), "generic error path applies TRANSCRIPT_FAIL (THINKING→ERROR)");
    // aria-live region is bound to the state label, so it cannot stay "Thinking"
    // after the state leaves THINKING.
    ok(/aria-live="polite"/.test(src) && /STATE_LABEL\[state\]/.test(src), "aria-live status is derived from the current state (no stale Thinking)");
  }

  // ===== 5. FLAG-OFF RENDER PROOF (VoiceSearchControl) ========================
  section("Flag-off preservation — VoiceSearchControl render proof");
  {
    let okEnv = true, missing = "", ReactServer, ts;
    try {
      ts = require(require.resolve("typescript", { paths: [REPO] }));
      ReactServer = require(require.resolve("react-dom/server", { paths: [REPO] }));
    } catch (e) { okEnv = false; missing = String(e && e.message); }
    if (okEnv) {
      const compTs = fs.readFileSync(path.join(REPO, "components/voice/VoiceSearchControl.tsx"), "utf8");
      const emitted = ts.transpileModule(compTs, { compilerOptions: { module: "commonjs", target: "es2020", jsx: "react-jsx", esModuleInterop: true } }).outputText;
      const voiceIndexAbs = path.join(OUT, "voice/index.js");
      const compJsPath = path.join(OUT, "voice", "_ux_component_under_test.js");
      fs.writeFileSync(compJsPath, emitted.replace(/["']@\/lib\/voice["']/g, JSON.stringify(voiceIndexAbs)));
      const Comp = (require(compJsPath).default) || require(compJsPath);
      const React = require(require.resolve("react", { paths: [REPO] }));
      let calls = 0; const inc = () => (calls += 1);
      const props = { setCity: inc, setSearch: inc, setSearchOpen: inc, setSortBy: inc, setSelectedStars: inc, setFilterOpen: inc, router: { push: inc }, visibleHotelIds: ["hotel_a", "hotel_b"] };
      delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
      ok(ReactServer.renderToStaticMarkup(React.createElement(Comp, props)) === "", "flag absent → empty markup (no control)");
      ok(calls === 0, "flag absent → no /hotels setter side effect");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "0";
      ok(ReactServer.renderToStaticMarkup(React.createElement(Comp, props)) === "", "flag '0' → still nothing");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "true";
      ok(ReactServer.renderToStaticMarkup(React.createElement(Comp, props)) === "", "flag 'true' → still nothing");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const _e = console.error; console.error = () => {};
      const enabled = ReactServer.renderToStaticMarkup(React.createElement(Comp, props));
      console.error = _e;
      ok(/Voice search/.test(enabled) && calls === 0, "flag '1' → container renders, still no setter side effect");
      delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
      console.log("  (render proof via react-dom/server — installed deps only; panel is client-only via next/dynamic)");
    } else {
      fail += 1; failures.push("render proof unavailable: " + missing);
      console.error("  ✗ render proof unavailable (HOLD): " + missing);
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Voice AI SB-02: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  console.log("ALL VOICE-AI-SB-02 CHECKS PASSED");
  process.exit(0);
})();
