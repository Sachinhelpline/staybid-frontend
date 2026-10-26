/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — OFFLINE GATEWAY HARNESS (test-only; never shipped, never deployed).
//
// This is NOT a new gateway. It runs the EXISTING gateway source in-process:
//   • `buildGateway` from server/voice-gateway/index.ts (the real Fastify app, its real
//     POST /v1/live-ai/sessions handler and its real /v1/live-ai/sessions/:sid/control
//     WebSocket route) — driven with `app.inject` / `app.injectWS` (in-memory streams;
//     NO listening socket, NO network);
//   • the real staging composition `buildStagingLiveAi` (real BudgetCore, real released 03A
//     ExecutionSafety factory, real projected screen context) over an IN-MEMORY budget store;
//   • the real IC01 agent loop, 03B controller, IC02 answer compiler and control-frame router.
// ONLY TWO things are replaced, both at the existing injection seams:
//   1. the durable budget STORE (an in-memory fake, the same shape the repo's own 03B suite uses);
//   2. the provider HTTP call (`live03b.responsesFetch`): an OFFLINE KEYWORD MODEL that returns a
//      Responses-API-shaped body carrying a PlanCandidate. It is clearly a stand-in for the model —
//      every answer the browser shows is still compiled + verified by the real IC02 path.
// Session assertions are signed with a keypair generated per run (no repo/env key material).
// The provider API-key slot receives a fixed placeholder string (not a credential); the fake fetch
// never touches the network, and `assertNoNetwork()` poisons the process `fetch` as a backstop.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..", "..", "..");
const PLACEHOLDER_KEY = "offline-harness-placeholder-not-a-credential";
const SUBJECT = "sub.offline-harness-1";
/** Allowlisted staging subjects — one per test section, so the REAL per-subject start limit
 *  (config.ts authStartsPer15Min) is exercised deliberately, never tripped by accident. */
const SUBJECTS = Array.from({ length: 24 }, (_, i) => `sub.offline-harness-${i + 1}`);

function compileDir(buildRoot, name, srcDir, includeGlob, extraLib) {
  const SRC = path.join(buildRoot, name, "src");
  const OUT = path.join(buildRoot, name, "out");
  fs.mkdirSync(SRC, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith(".ts") && !f.endsWith(".d.ts")) fs.copyFileSync(path.join(srcDir, f), path.join(SRC, f));
  }
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: extraLib || ["es2020"], strict: true, noEmitOnError: false },
    include: [includeGlob],
  }));
  const TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
  const r = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  if (!fs.existsSync(OUT)) throw new Error(`compile failed (${name}):\n${r.stdout || ""}${r.stderr || ""}`);
  return OUT;
}

/** Compile the REAL gateway + browser live-ai sources (unchanged) into `buildRoot`. */
function compileSources(buildRoot) {
  fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.mkdirSync(buildRoot, { recursive: true });
  const GW = compileDir(buildRoot, "gw", path.join(REPO, "server/voice-gateway"), "*.ts", ["es2020", "dom"]);
  const LIB = compileDir(buildRoot, "lib", path.join(REPO, "lib/live-ai"), "*.ts", ["es2020", "dom"]);
  return { GW, LIB };
}

/** Backstop: any process-level fetch during a harness run is a test failure (counted, refused). */
function assertNoNetwork() {
  const attempts = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { attempts.push(String(url)); throw new Error("offline harness: network refused"); };
  return { attempts, restore() { globalThis.fetch = orig; } };
}

// ── the in-memory budget store (same contract the repo's 03B suite fakes) ──────────────────
// `opts.strict` (REAL-TEDDY batch) mirrors the durable PgBudgetStore's REFUSAL semantics that matter for
// the public route (live-ai-budget-store.ts acquireEnvelope): a replay of a reconciled/revoked envelope ⇒
// envelope_terminal / envelope_revoked; a replay from a previous boot ⇒ envelope_previous_boot; a killed /
// disabled control ⇒ control_superseded; and an optional per-subject money ceiling ⇒ ceiling_exceeded.
// It is still a FAKE — the authoritative durable proof is tests/budget/live-ai-budget-01.pg.test.js.
function memoryBudgetStore(opts) {
  const o = opts || {};
  const envelopes = new Map();
  const state = { reconciled: new Set(), revoked: new Set(), subjectMoney: new Map(), acquisitions: [], control: { killed: false, enabled: true } };
  const now = () => Date.now();
  return {
    state,
    get configured() { return true; },
    async acquireEnvelope(req) {
      state.acquisitions.push({ key: req.acquisitionKey, budgetClass: req.budgetClass, subject: req.subjectDigest, money: req.amounts && req.amounts.moneyMicros, admissions: req.amounts && req.amounts.executionAdmissions });
      if (o.strict && (state.control.killed || !state.control.enabled)) return { ok: false, reason: "control_superseded" };
      const existing = envelopes.get(req.acquisitionKey);
      if (existing && o.strict) {
        if (state.revoked.has(existing.envelopeId)) return { ok: false, reason: "envelope_revoked" };
        if (existing.bootNonce !== req.bootNonce) return { ok: false, reason: "envelope_previous_boot" };
        if (state.reconciled.has(existing.envelopeId)) return { ok: false, reason: "envelope_terminal" };
      }
      if (existing) return { ok: true, idempotentReplay: true, envelope: existing, replay: { executions: [], reservations: [] } };
      if (o.strict && typeof o.subjectDayMoneyCeilingMicros === "bigint" && req.amounts && typeof req.amounts.moneyMicros === "bigint") {
        const used = state.subjectMoney.get(req.subjectDigest) || BigInt(0);
        if (used + req.amounts.moneyMicros > o.subjectDayMoneyCeilingMicros) return { ok: false, reason: "ceiling_exceeded" };
        state.subjectMoney.set(req.subjectDigest, used + req.amounts.moneyMicros);
      }
      const env = {
        envelopeId: "env_" + (envelopes.size + 1), budgetClass: req.budgetClass, amounts: req.amounts,
        budgetSessionId: "bs", gatewaySessionDigest: req.gatewaySessionDigest, subjectDigest: req.subjectDigest, projectId: req.projectId,
        policyVersionId: "pol1", priceCatalogVersionId: o.catalogVersion || "offline.reasoning.v1",
        globalControlEpoch: BigInt(1), projectControlEpoch: BigInt(1), controlVectorDigest: "v1",
        maxControlStalenessMs: req.maxControlStalenessMs, leaseTtlMs: req.leaseTtlMs, leaseGeneration: BigInt(1), acquisitionCommitment: "acq256:offline",
        bootNonce: req.bootNonce, issuedAtMs: now(), expiresAtMs: now() + req.leaseTtlMs, leaseExpiryMs: now() + req.leaseTtlMs, acquiredAtMs: now(),
      };
      envelopes.set(req.acquisitionKey, env);
      return { ok: true, idempotentReplay: false, envelope: env };
    },
    async reconcile(r) { if (r && r.envelopeId) state.reconciled.add(r.envelopeId); return { ok: true }; },
    async recordExecutionAdmission() { return { ok: true }; },
    async recordProviderReservation() { return { ok: true }; },
    async settleProviderReservation() { return { ok: true }; },
    async revokeEnvelope(r) { if (r && r.envelopeId) state.revoked.add(r.envelopeId); return { ok: true }; },
    async reapOrphans() { return { ok: true, reaped: 0 }; },
    async readControl() { return { globalEpoch: BigInt(1), projectEpoch: BigInt(1), controlVectorDigest: "v1", enabled: state.control.enabled, killed: state.control.killed, observedAtMs: now() }; },
  };
}

function offlineCatalog(PRICING, model, voice) {
  // TEST-ONLY synthetic rates (never real prices; never shipped). `voice` adds TRANSCRIPTION / TTS rows.
  const base = { currencyCode: "USD", effectiveFromMs: 0, effectiveUntilMs: null, verifiedAtMs: 0, verificationExpiresAtMs: 9_000_000_000_000, sourceId: "offline", sourceDigest: "d", status: "active" };
  const e = (dimension, serviceTier, rateMicros, m) => Object.assign({ provider: "openai", model: m || model, serviceTier, billingDimension: dimension, unitSize: BigInt(1), rateMicros: BigInt(rateMicros) }, base);
  const rows = [
    e("reasoning_input_token", null, 5), e("reasoning_input_token", "cached", 3),
    e("reasoning_input_token", "cache_write", 8), e("reasoning_output_token", null, 15),
  ];
  if (voice && voice.transcription) rows.push(e("realtime_audio_second", null, 100, "gpt-live-transcribe"));
  // CHANGED FIXTURE (TEMPORARY tts-1 FALLBACK): the bound TTS model is tts-1, char-priced (tts_input_character); TEST-ONLY 15 µ$/char = published $15/1M chars.
  if (voice && voice.tts) rows.push(e("tts_input_character", null, 15, voice.ttsModel));
  return PRICING.createPriceCatalog("offline.reasoning.v1", rows);
}

// ── the OFFLINE KEYWORD MODEL (stand-in for the provider; returns a PlanCandidate) ──────────
function findUserText(snap) {
  // the IC01 input snapshot is data; locate the guest's text without assuming one exact key path.
  let best = "";
  const walk = (v, k, depth) => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") { if (/^(text|userText|transcript|utterance)$/i.test(k || "") && v.length > best.length) best = v; return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, k, depth + 1)); return; }
    if (typeof v === "object") for (const kk of Object.keys(v)) walk(v[kk], kk, depth + 1);
  };
  walk(snap, "", 0);
  return best;
}
function findPageId(snap) {
  let page = null;
  const walk = (v, depth) => {
    if (page || depth > 6 || v == null || typeof v !== "object") return;
    if (typeof v.pageId === "string") { page = v.pageId; return; }
    for (const kk of Object.keys(v)) walk(v[kk], depth + 1);
  };
  walk(snap, 0);
  return page;
}
/** The page's CURRENTLY APPLIED max-price filter as published in the IC01 input snapshot (or null). */
function findAppliedMaxPrice(snap) {
  let found = null;
  const walk = (v, depth) => {
    if (found !== null || depth > 6 || v == null || typeof v !== "object") return;
    if (typeof v.maxPrice === "number") { found = v.maxPrice; return; }
    for (const kk of Object.keys(v)) walk(v[kk], depth + 1);
  };
  walk(snap, 0);
  return found;
}
/** Deterministic keyword planner → a PlanCandidate the REAL IC01 loop validates. `appliedMaxPrice` lets the
 *  fake behave like a real model on an IC01 REPLAN after a rebind: once the requested refinement is already
 *  applied on screen it READS the refreshed results instead of re-applying the same filter. */
function keywordPlan(text, pageId, appliedMaxPrice) {
  const t = String(text || "").toLowerCase();
  const plan = (intent, steps) => ({ contractVersion: "staybid-intelligence.v1", intent, steps });
  const clarify = (reason) => plan("CLARIFY", [{ kind: "CLARIFY", reason, language: "en" }]);
  if (/\b(book|booking|pay|payment|bid|reserve|checkout)\b/.test(t)) return clarify("TRANSACTIONAL_NOT_ENABLED");
  const posWord = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };
  if (pageId === "hotel-detail") {
    if (/\b(room|rooms)\b/.test(t)) return plan("SHOW_HOTEL_SECTION", [{ kind: "CAPABILITY", capabilityId: "SHOW_HOTEL_SECTION", args: { op: "SHOW_HOTEL_SECTION", section: "rooms" } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "section_shown", groundedInStep: 0 }] }]);
    if (/\b(about|overview)\b/.test(t)) return plan("SHOW_HOTEL_SECTION", [{ kind: "CAPABILITY", capabilityId: "SHOW_HOTEL_SECTION", args: { op: "SHOW_HOTEL_SECTION", section: "about" } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "section_shown", groundedInStep: 0 }] }]);
    if (/\b(breakfast|parking|facilit|amenit)/.test(t)) return plan("READ_HOTEL_FACTS", [{ kind: "CAPABILITY", capabilityId: "READ_CURRENT_HOTEL_FACTS", args: { op: "READ_CURRENT_HOTEL_FACTS" } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "hotel_facts", groundedInStep: 0 }] }]);
    return clarify("OUT_OF_SCOPE");
  }
  if (pageId === "hotels") {
    if (/\bcompare\b/.test(t)) return plan("COMPARE_RESULTS", [{ kind: "CAPABILITY", capabilityId: "COMPARE_VISIBLE_HOTELS", args: { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "comparison_summary", groundedInStep: 0 }] }]);
    const open = /\bopen\b.*?\b(first|1st|second|2nd|third|3rd)\b/.exec(t);
    if (open) return plan("OPEN_VISIBLE_HOTEL", [{ kind: "CAPABILITY", capabilityId: "OPEN_VISIBLE_HOTEL", args: { op: "OPEN_VISIBLE_HOTEL", position: posWord[open[1]] } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "hotel_opened", groundedInStep: 0 }] }]);
    const price = /(?:under|below|less than|within)\s*(?:rs\.?|₹|inr)?\s*([0-9][0-9,]{2,7})/.exec(t);
    if (price && appliedMaxPrice === Number(price[1].replace(/,/g, ""))) return plan("READ_RESULTS", [{ kind: "CAPABILITY", capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] }]);
    if (price) return plan("REFINE_RESULTS", [{ kind: "CAPABILITY", capabilityId: "APPLY_HOTEL_REFINEMENT", args: { op: "APPLY_HOTEL_REFINEMENT", maxPrice: Number(price[1].replace(/,/g, "")) } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] }]);
    if (/\b(stay|stays|hotel|hotels|show|options|results|how many|list)\b/.test(t)) return plan("READ_RESULTS", [{ kind: "CAPABILITY", capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] }]);
    return clarify("OUT_OF_SCOPE");
  }
  return clarify("NO_SUPPORTED_CONTEXT");
}
function makeOfflineModel(model) {
  const calls = [];
  const fetchLike = async (url, init) => {
    let snapshot = null;
    try { const body = JSON.parse(init.body); snapshot = JSON.parse(body.input[1].content); } catch { snapshot = null; }
    const text = findUserText(snapshot);
    const pageId = findPageId(snapshot);
    const candidate = keywordPlan(text, pageId, findAppliedMaxPrice(snapshot));
    calls.push({ url: String(url), text, pageId, intent: candidate.intent, snapshotKeys: snapshot && typeof snapshot === "object" ? Object.keys(snapshot) : [] });
    const body = { status: "completed", model, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(candidate) }] }], usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchLike, calls };
}

/**
 * Build the in-process offline gateway. Returns:
 *   createSession({ sessionId, mode, origin }) → { status, body } from the REAL session handler
 *   openControl(gatewaySessionId, protocols[], onServerFrame) → { send(text), close() } via the REAL WS route
 */
async function createOfflineGateway(opts) {
  const o = opts || {};
  const { GW } = o.compiled;
  const GWIDX = require(path.join(GW, "index.js"));
  const STAGING = require(path.join(GW, "live-ai-staging-main.js"));
  const PRICING = require(path.join(GW, "live-ai-budget-pricing.js"));
  const RESP = require(path.join(GW, "openai-responses.js"));
  const jose = require(require.resolve("jose", { paths: [REPO] }));
  const origin = o.origin || "http://127.0.0.1";
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
  const spki = await jose.exportSPKI(publicKey);
  const rnd = () => crypto.randomBytes(24).toString("hex");
  const env = {
    ...(o.composition === "public" ? { LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED: o.publicGate === false ? "0" : "1", LIVE_AI_BROKER_ENABLED: "1" } : {}),
    LIVE_AI_RUNTIME_ENABLED: "1",
    LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker", LIVE_AI_SESSION_AUDIENCE: "sb-gateway",
    LIVE_AI_CONTROL_TOKEN_SECRET: rnd(), LIVE_AI_KILL_SWITCH_HMAC_SECRET: rnd(), LIVE_AI_IP_HASH_SALT: rnd(),
    LIVE_AI_ALLOWED_ORIGINS: origin,
    OPENAI_API_KEY: PLACEHOLDER_KEY,
    ...(o.composition === "public" ? {} : { LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: SUBJECTS.join(",") }),
  };
  const model = makeOfflineModel(RESP.REASONING_MODEL);
  const store = o.store || memoryBudgetStore();
  const bootNonce = o.bootNonce || ("offline-" + rnd());
  const catalog = offlineCatalog(PRICING, RESP.REASONING_MODEL, o.voiceRates && Object.assign({ ttsModel: require(path.join(GW, "live-ai-budget-authority.js")).TTS_MODEL }, o.voiceRates));
  let staging;
  if (o.composition === "public") {
    const PUB = require(path.join(GW, "live-ai-public-main.js"));
    staging = PUB.buildPublicLiveAi({ store, controlIntervalMs: 5000, bootNonce, catalog, ttsReservationRule: o.ttsRule || null, controlTimers: { set: () => 0, clear: () => {} } });
  } else {
    staging = STAGING.buildStagingLiveAi({ store, controlIntervalMs: 5000, bootNonce, catalog, controlTimers: { set: () => 0, clear: () => {} } });
  }
  const { app, liveAiCtx } = await GWIDX.buildGateway({
    env,
    liveAi: {
      budget: null,
      budgetCore: staging.budgetCore,
      ...(o.tts ? { tts: o.tts } : {}),
      ...(o.transcription ? { transcription: o.transcription } : {}),
      live03b: { ...staging.live03b, responsesFetch: model.fetchLike, apiKey: PLACEHOLDER_KEY,
        ...(process.env.OG_DEBUG ? { makeExecution: (port, ctx) => { const ex0 = staging.live03b.makeExecution(port, ctx); const d = ex0.deliverTerminal.bind(ex0); const ex = Object.assign(Object.create(null), ex0); ex.deliverTerminal = (x) => { const r = d(x); console.error("OG deliverTerminal", JSON.stringify(r), JSON.stringify(x.terminal.receipt).slice(0, 300), JSON.stringify(x.terminal.sourceAuthority), JSON.stringify(x.terminal.resultAuthority)); return r; }; return ex; } } : {}) },
    },
  });
  if (process.env.OG_DEBUG) app.addHook("onError", (req, rep, err, done) => { console.error("OG onError:", err && err.stack); done(); });
  await app.ready();
  // `auth`/`subject`: "staging" = an AUTHENTICATED allowlisted subject (the only route that reaches the
  // verified 03B path); "public" mirrors the real customer broker (lib/live-ai/broker.ts
  // buildAssertionClaims: auth ALWAYS false, a random pseudonymous "px." subject).
  const assertion = async (auth, subject) => new jose.SignJWT({ scope: "live-ai:read-ui-local", origin, auth })
    .setProtectedHeader({ alg: "ES256" }).setSubject(subject).setJti("jti." + rnd())
    .setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
  const frames = [];
  // REAL-TEDDY: an assertion with explicit claims (negative tests: wrong origin / replayed jti / auth flag).
  const assertionWith = async (c) => new jose.SignJWT({ scope: c.scope || "live-ai:read-ui-local", origin: c.origin || origin, auth: c.auth })
    .setProtectedHeader({ alg: "ES256" }).setSubject(c.subject).setJti(c.jti || ("jti." + rnd()))
    .setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
  return {
    model, frames, liveAiCtx, store, bootNonce, app, env: { origin, gatewayEnv: env },
    /** POST the REAL session handler with an explicit assertion (bearer) + body. */
    async rawCreateSession(bearer, body, ip) {
      const res = await app.inject({ method: "POST", url: "/v1/live-ai/sessions", remoteAddress: ip || "127.0.0.1", headers: { "content-type": "application/json", authorization: "Bearer " + bearer, origin }, payload: JSON.stringify(body) });
      let json = null; try { json = res.json(); } catch { json = null; }
      return { status: res.statusCode, body: json };
    },
    assertionWith,
    async createSession(body, who) {
      const w = who || { route: "staging" };
      // route: "staging" = auth:true allowlisted subject · "customer" = auth:true broker-derived public subject
      // (pub1.<hex>, what the G-PUBLIC broker mints for a VERIFIED customer) · "public" = the anonymous px./auth:false broker.
      const auth = w.route === "staging" || w.route === "customer";
      const subject = w.route === "customer" ? (w.subject || ("pub1." + crypto.createHash("sha256").update("offline-customer").digest("hex")))
        : auth ? (w.subject || SUBJECT) : "px." + crypto.randomUUID().replace(/-/g, "");
      const res = await app.inject({
        method: "POST", url: "/v1/live-ai/sessions", remoteAddress: w.ip || "127.0.0.1",
        headers: { "content-type": "application/json", authorization: "Bearer " + (await assertion(auth, subject)), origin },
        payload: JSON.stringify(body),
      });
      let json = null; try { json = res.json(); } catch { json = null; }
      return { status: res.statusCode, body: json };
    },
    async openControl(gatewaySessionId, protocols, onServerFrame, onClose) {
      // listeners are attached in onInit (BEFORE open): the real route emits connection.ready
      // synchronously on attach, which would otherwise race the client-side open event.
      const attach = (ws) => {
        ws.on("message", (data) => {
          const text = typeof data === "string" ? data : data.toString("utf8");
          try { frames.push({ dir: "s2c", t: JSON.parse(text).t }); } catch { /* bounded log only */ }
          onServerFrame(text);
        });
        ws.on("close", (code, reason) => { if (process.env.OG_DEBUG) console.error("OG ws close", code, String(reason || "")); if (onClose) onClose(code); });
      };
      const wss = app.websocketServer;
      const before = new Set(wss && wss.clients ? Array.from(wss.clients) : []);
      const ws = await app.injectWS(`/v1/live-ai/sessions/${encodeURIComponent(gatewaySessionId)}/control`, {
        headers: { "sec-websocket-protocol": (protocols || []).join(", ") },
        // in-memory upgrade has no TCP socket; give the gateway's rate limiter the loopback address
        socket: { remoteAddress: "127.0.0.1" },
      }, { onInit: attach });
      const serverPeer = wss && wss.clients ? Array.from(wss.clients).find((c) => !before.has(c)) || null : null;
      return {
        send(text) { try { frames.push({ dir: "c2s", t: JSON.parse(text).t }); } catch { /* no-op */ } ws.send(text); },
        close() {
          try { ws.close(); } catch { /* no-op */ }
          // in-memory duplex: no TCP FIN ever reaches the server side, so end the SERVER-side peer of
          // THIS connection (what the network does when a browser tears its socket down).
          if (serverPeer) setTimeout(() => { try { serverPeer.terminate(); } catch { /* no-op */ } }, 0);
        },
      };
    },
    async close() { try { await app.close(); } catch { /* no-op */ } },
  };
}

/**
 * A browser-side `fetchImpl` for gateway-client that mirrors app/api/live-ai/session/route.ts
 * steps 6–7 EXACTLY (gateway body shape → shapeBrokerResponse → buildControlUrl → bounded body),
 * using the REAL lib/live-ai/broker.ts functions. Only the assertion signing + the HTTP hop to the
 * gateway are replaced by the in-process gateway. `route` = "staging" | "public" (see createSession).
 */
function makeBrokerFetch(gateway, BROKER, opts) {
  const o = opts || {};
  const calls = [];
  const fetchImpl = async (url, init) => {
    const reqBody = JSON.parse(init.body);
    const route = typeof o.route === "function" ? o.route(reqBody) : (o.route || "staging");
    const gwBody = reqBody.mode === "microphone"
      ? { mode: "microphone", sessionId: reqBody.sessionId, sdp: reqBody.offerSdp }
      : { mode: "text", sessionId: reqBody.sessionId };
    const who = { route, subject: typeof o.subject === "function" ? o.subject() : o.subject, ip: typeof o.ip === "function" ? o.ip() : o.ip };
    let gw = await gateway.createSession(gwBody, who);
    const rec = { url: String(url), mode: reqBody.mode, route, gatewayStatus: gw.status, gatewayError: gw.body && gw.body.error, shim: null };
    calls.push(rec);
    if (gw.status !== 200 && reqBody.mode === "microphone" && o.micShim) {
      // HARNESS SHIM (disclosed): the real gateway refused the microphone session (see report).
      // Mint a REAL text session for the control socket and attach a fake answer SDP so the
      // browser's REAL createBrowserMedia + transcript gate can be exercised offline.
      gw = await gateway.createSession({ mode: "text", sessionId: reqBody.sessionId }, who);
      if (gw.status === 200 && gw.body) gw.body.answerSdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=offline-harness\r\n";
      rec.shim = "mic_answer_sdp";
    }
    const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    rec.gatewaySessionId = gw.body && gw.body.gatewaySessionId;
    if (gw.status !== 200) return respond(gw.status === 429 ? 429 : gw.status === 503 ? 503 : 502, { error: "gateway_unavailable" });
    const shaped = BROKER.shapeBrokerResponse(gw.body);
    if (!shaped) return respond(502, { error: "invalid_gateway_response" });
    const controlUrl = BROKER.buildControlUrl("https://offline-gateway.invalid", shaped.gatewaySessionId);
    if (!controlUrl) return respond(502, { error: "invalid_gateway_response" });
    const out = { sessionId: shaped.sessionId, gatewaySessionId: shaped.gatewaySessionId, controlToken: shaped.controlToken, expiresInSeconds: shaped.expiresInSeconds, controlUrl };
    if (shaped.answerSdp) out.answerSdp = shaped.answerSdp;
    return respond(200, out);
  };
  return { fetchImpl, calls };
}

/** A gateway-client `openSocket` bridged to the REAL control route via app.injectWS (in-memory). */
function makeSocketOpener(gateway) {
  const opened = [];
  const openSocket = (url, protocols, handlers) => {
    const m = /\/v1\/live-ai\/sessions\/([^/]+)\/control$/.exec(new URL(url).pathname);
    const gwId = m ? decodeURIComponent(m[1]) : "";
    let conn = null; let closed = false; const pending = [];
    opened.push({ url, protocols: protocols.slice() });
    gateway.openControl(gwId, protocols, (text) => { if (!closed) handlers.onMessage(text); }, () => { if (!closed) { closed = true; handlers.onClose(); } })
      .then((c) => { if (closed) { c.close(); return; } conn = c; handlers.onOpen(); while (pending.length) conn.send(pending.shift()); })
      .catch(() => { if (!closed) { closed = true; handlers.onError(); } });
    return {
      send(d) { if (closed) return; if (conn) conn.send(d); else pending.push(d); },
      close() { if (closed) return; closed = true; if (conn) conn.close(); },
    };
  };
  return { openSocket, opened };
}

module.exports = {
  SUBJECTS, makeBrokerFetch, makeSocketOpener, compileSources, createOfflineGateway, assertNoNetwork, keywordPlan, PLACEHOLDER_KEY, SUBJECT, REPO, memoryBudgetStore };
