#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — PRODUCT-02 — founder-only REAL AI TEXT seam — hermetic suite.
//   Run:  node tests/live-ai/founder-text.test.js
// NO network, NO real admin token, NO provider, NO secret VALUE. Compiles the REAL
// lib/live-ai/*.ts and drives: the client build gate, the bearer transport helper, the
// eligibility probe, the server eligibility decision (reusing the unchanged staging
// authority chain), the gateway transport's new optional bearer/textOnly seam (default
// behavior unchanged), and the founder TEXT session end-to-end over a FAKE broker +
// FAKE control socket (answer path, fallback paths, no speech approval). Static checks
// pin the TravelBuddy wiring (typed turns only; voice stays scripted) and the absence
// of any write/bid/booking/payment operation on this path.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "founder-text");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "live-ai"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
}
fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: ["es2020", "dom"], strict: true, noEmitOnError: true },
  include: ["live-ai/**/*.ts"],
}));
let TSC_BIN;
try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed."); process.exit(2); }
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (founder-text): exit 0, clean (strict)");

const C = require(path.join(OUT, "live-ai/contracts.js"));
const R = require(path.join(OUT, "live-ai/runtime.js"));
const GC = require(path.join(OUT, "live-ai/gateway-client.js"));
const FT = require(path.join(OUT, "live-ai/founder-text.js"));
const FE = require(path.join(OUT, "live-ai/founder-text-eligibility.js"));
const SA = require(path.join(OUT, "live-ai/staging-authority.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) { pass += 1; console.log("  ✓ " + l); } else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l}${a === b ? "" : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`); }
function section(n) { console.log("\n• " + n); }
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 6); i++) await tick(); }

process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
// Synthetic, NON-secret test literals only.
const BEARER = "synthetic.admin-token.for-tests-only";
const HMAC = "synthetic-derivation-secret-not-real";
const FOUNDER_ID = "synthetic-founder-admin-id";
const OTHER_ADMIN_ID = "synthetic-other-admin-id";
const OPERATOR = SA.deriveStagingSubject(FOUNDER_ID, HMAC);
const ORIGIN = "https://app.example.test";

const PROD_FLAGS = { NEXT_PUBLIC_VOICE_AI_BETA: "1", NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA: "0", NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW: "1", NEXT_PUBLIC_TRAVEL_BUDDY_PREVIEW_TEXT_ONLY: "0" };

const HOTELS = [
  { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi"] },
  { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["Breakfast"] },
];
function makeRuntime() {
  const rt = R.createLiveAiRuntime("anonymous");
  const s = { opened: 0, refined: 0 };
  rt.invalidateRoute("/hotels");
  rt.registerPage({
    pageId: "hotels", routeKey: "/hotels",
    getSnapshot: () => C.buildHotelsSnapshot({
      displayHotels: HOTELS, city: "Dhanaulti", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null, sort: "default",
      stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Breakfast"], loading: false, error: "", resolvedCity: "Dhanaulti",
      resolvedQuery: "", resolvedStatus: "ready", role: "anonymous",
    }),
    execute: (cmd) => { if (cmd.kind === "open_hotel") s.opened += 1; else s.refined += 1; },
  });
  return { rt, s };
}

// A fake broker + control socket. Records every request/frame; never touches the network.
function fakeGateway(opts) {
  opts = opts || {};
  const calls = []; const sent = []; let handlers = null; let opens = 0; let closed = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body, credentials: init.credentials });
    if (opts.brokerStatus && opts.brokerStatus !== 200) return { ok: false, status: opts.brokerStatus, json: async () => ({ error: "staging_broker_unconfigured" }) };
    return { ok: true, status: 200, json: async () => ({ sessionId: body.sessionId, gatewaySessionId: "gw.f1", controlToken: "tok.synthetic", expiresInSeconds: 60, controlUrl: "wss://gw.example.test/v1/live-ai/sessions/gw.f1/control" }) };
  };
  const openSocket = (_u, _p, h) => {
    opens += 1; handlers = h;
    if (!opts.silent) setImmediate(() => { h.onOpen(); h.onMessage(JSON.stringify({ t: "connection.ready", sessionId: calls[calls.length - 1].body.sessionId, gatewaySessionId: "gw.f1" })); });
    return { send(x) { sent.push(JSON.parse(x)); }, close() { closed += 1; } };
  };
  return { calls, sent, fetchImpl, openSocket, push: (f) => handlers && handlers.onMessage(JSON.stringify(f)), opens: () => opens, closed: () => closed };
}

function envFull(over) {
  return Object.assign({
    LIVE_AI_FOUNDER_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_BROKER_ENABLED: "1",
    LIVE_AI_03B_STAGING_OPERATOR_SUBJECT: OPERATOR, LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET: HMAC,
    LIVE_AI_SESSION_SIGNING_PRIVATE_KEY: "synthetic-placeholder", LIVE_AI_SESSION_ISSUER: "iss.example.test",
    LIVE_AI_SESSION_AUDIENCE: "aud.example.test", LIVE_AI_ALLOWED_ORIGINS: ORIGIN, LIVE_AI_GATEWAY_URL: "https://gw.example.test",
  }, over || {});
}
function eligInput(over) {
  let verifyCalls = 0;
  const i = Object.assign({ env: envFull(), origin: ORIGIN, secFetchSite: "same-origin", authorization: `Bearer ${BEARER}`, xAdminToken: null, verifyAdmin: async () => ({ id: FOUNDER_ID }) }, over || {});
  const inner = i.verifyAdmin;
  i.verifyAdmin = async () => { verifyCalls += 1; return inner(); };
  return { i, verifyCalls: () => verifyCalls };
}

(async function main() {
  // ─────────────────────────────────────────────────────────────────────
  section("(a) client build gate — DEFAULT OFF; never with the global provider path");
  eq(FT.resolveFounderTextClientGate(PROD_FLAGS), false, "current production flags ⇒ founder gate OFF (normal guests stay scripted)");
  eq(FT.resolveFounderTextClientGate({}), false, "no env ⇒ OFF");
  eq(FT.resolveFounderTextClientGate({ ...PROD_FLAGS, NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT: "1" }), true, "founder build flag + scripted Buddy gate ⇒ ON (still needs server eligibility + opt-in)");
  eq(FT.resolveFounderTextClientGate({ ...PROD_FLAGS, NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT: "true" }), false, "flag must be exactly \"1\"");
  eq(FT.resolveFounderTextClientGate({ ...PROD_FLAGS, NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT: "1", NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA: "1" }), false, "P=1 ⇒ OFF (never coexists with the global provider path)");
  eq(FT.resolveFounderTextClientGate({ ...PROD_FLAGS, NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT: "1", NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW: "0" }), false, "UX≠1 ⇒ OFF");
  eq(FT.resolveFounderTextClientGate({ ...PROD_FLAGS, NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT: "1", NEXT_PUBLIC_VOICE_AI_BETA: "0" }), false, "V≠1 ⇒ OFF");
  {
    const keys = ["NEXT_PUBLIC_VOICE_AI_BETA", "NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA", "NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW", "NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT"];
    const saved = {}; for (const k of keys) saved[k] = process.env[k];
    Object.assign(process.env, PROD_FLAGS); delete process.env.NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT;
    eq(FT.resolveFounderTextClientGate(), false, "default-env read with production flags ⇒ OFF");
    process.env.NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT = "1";
    eq(FT.resolveFounderTextClientGate(), true, "default-env read honours the founder build flag");
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    const src = fs.readFileSync(path.join(REPO, "lib/live-ai/founder-text.ts"), "utf8");
    ok(keys.every((k) => src.includes(`process.env.${k}`)), "client gate uses direct process.env.NEXT_PUBLIC_* member reads (build-time inlinable)");
  }

  // ─────────────────────────────────────────────────────────────────────
  section("(b) bearer transport helper — shape only, never identity");
  const store = (v) => ({ getItem: (k) => (k === "sb_admin_token" ? v : null) });
  eq(FT.readFounderBearer(store(BEARER)), BEARER, "well-formed sb_admin_token is read for transport");
  eq(FT.readFounderBearer(store(null)), null, "no admin session ⇒ null");
  eq(FT.readFounderBearer(store("short")), null, "too-short value ⇒ null");
  eq(FT.readFounderBearer(store("has space in it 123456789")), null, "header-unsafe value ⇒ null");
  eq(FT.readFounderBearer(store("a".repeat(16) + "\r\nx: y")), null, "CRLF injection ⇒ null");
  eq(FT.readFounderBearer({ getItem: () => { throw new Error("blocked"); } }), null, "storage throws ⇒ null");
  eq(FT.readFounderBearer(null), null, "no storage ⇒ null");
  eq(FT.ADMIN_SESSION_KEY, "sb_admin_token", "reads ONLY the existing admin session key (never sb_token)");

  // ─────────────────────────────────────────────────────────────────────
  section("(c) eligibility probe — TRUE only on 200 + exactly {eligible:true}");
  {
    let n = 0; const rec = [];
    const f = (status, json, throws) => async (url, init) => { n += 1; rec.push({ url, init }); if (throws) throw new Error("x"); return { status, json: async () => json }; };
    eq(await FT.checkFounderEligibility(f(200, { eligible: true }), null), false, "no bearer ⇒ false");
    eq(n, 0, "no bearer ⇒ NO request made");
    eq(await FT.checkFounderEligibility(undefined, BEARER), false, "no fetch ⇒ false");
    eq(await FT.checkFounderEligibility(f(200, { eligible: true }), BEARER), true, "200 {eligible:true} ⇒ true");
    eq(rec[0].url, "/api/live-ai/staging/eligibility", "probe path is the eligibility route (NOT the session broker)");
    eq(rec[0].init.method, "POST", "POST");
    eq(rec[0].init.headers.authorization, `Bearer ${BEARER}`, "Authorization: Bearer transport");
    ok(!("x-admin-token" in rec[0].init.headers), "never sends x-admin-token (Bearer-only route)");
    eq(rec[0].init.credentials, "same-origin", "same-origin credentials");
    eq(await FT.checkFounderEligibility(f(200, { eligible: "true" }), BEARER), false, "eligible must be boolean true");
    eq(await FT.checkFounderEligibility(f(200, {}), BEARER), false, "missing eligible ⇒ false");
    eq(await FT.checkFounderEligibility(f(403, { eligible: true }), BEARER), false, "non-200 ⇒ false even with a forged body");
    eq(await FT.checkFounderEligibility(f(503, null), BEARER), false, "503 ⇒ false");
    eq(await FT.checkFounderEligibility(f(200, null, true), BEARER), false, "network throw ⇒ false");
  }

  // ─────────────────────────────────────────────────────────────────────
  section("(d) server eligibility decision — distinct, server-enforced, fail closed");
  {
    const run = async (over) => { const x = eligInput(over); const out = await FE.decideFounderTextEligibility(x.i); return { out, calls: x.verifyCalls() }; };
    let r = await run({ env: envFull({ LIVE_AI_FOUNDER_TEXT_ENABLED: undefined }) });
    eq(r.out.status, 503, "founder gate unset (production default) ⇒ 503"); eq(r.out.body.error, "founder_text_disabled", "…founder_text_disabled"); eq(r.calls, 0, "…admin verification NOT invoked");
    r = await run({ env: envFull({ LIVE_AI_FOUNDER_TEXT_ENABLED: "true" }) });
    eq(r.out.status, 503, "founder gate must be exactly \"1\"");
    r = await run({ env: envFull({ LIVE_AI_03B_STAGING_BROKER_ENABLED: undefined }) });
    eq(r.out.status, 503, "staging broker disabled ⇒ 503"); eq(r.calls, 0, "…admin verification NOT invoked");
    for (const k of ["LIVE_AI_SESSION_SIGNING_PRIVATE_KEY", "LIVE_AI_SESSION_ISSUER", "LIVE_AI_SESSION_AUDIENCE", "LIVE_AI_ALLOWED_ORIGINS", "LIVE_AI_GATEWAY_URL"]) {
      r = await run({ env: envFull({ [k]: undefined }) });
      ok(r.out.status === 503 && r.out.body.error === "unconfigured" && r.calls === 0, `missing ${k} ⇒ 503 unconfigured, no admin verification`);
    }
    r = await run({ env: envFull({ LIVE_AI_GATEWAY_URL: "http://gw.example.test" }) });
    eq(r.out.status, 503, "non-HTTPS gateway URL ⇒ 503");
    r = await run({ env: envFull({ LIVE_AI_03B_STAGING_OPERATOR_SUBJECT: undefined }) });
    eq(r.out.status, 503, "no operator subject ⇒ 503 (staging_broker_unconfigured)");
    r = await run({ env: envFull({ LIVE_AI_03B_STAGING_OPERATOR_SUBJECT: `${OPERATOR},${OPERATOR}` }) });
    eq(r.out.status, 503, "list-shaped operator subject ⇒ 503");
    r = await run({ env: envFull({ LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET: undefined }) });
    eq(r.out.status, 503, "no HMAC secret ⇒ 503");
    r = await run({ origin: "https://evil.example.test" });
    eq(r.out.status, 403, "cross-origin ⇒ 403"); eq(r.calls, 0, "…admin verification NOT invoked");
    r = await run({ secFetchSite: "cross-site" });
    eq(r.out.status, 403, "Sec-Fetch-Site cross-site ⇒ 403");
    r = await run({ authorization: null });
    eq(r.out.status, 401, "no Bearer ⇒ 401"); eq(r.calls, 0, "…admin verification NOT invoked");
    r = await run({ authorization: null, xAdminToken: BEARER });
    eq(r.out.status, 401, "x-admin-token only ⇒ 401 (Bearer-only)");
    r = await run({ xAdminToken: "different.token.value.0000" });
    eq(r.out.status, 401, "conflicting Bearer + x-admin-token ⇒ 401");
    r = await run({ authorization: `Basic ${BEARER}` });
    eq(r.out.status, 401, "non-Bearer scheme ⇒ 401");
    r = await run({ verifyAdmin: async () => null });
    eq(r.out.status, 403, "unverified / non-admin account ⇒ 403");
    r = await run({ verifyAdmin: async () => { throw new Error("store down"); } });
    eq(r.out.status, 403, "verification throws ⇒ 403 (fail closed)");
    r = await run({ verifyAdmin: async () => ({ id: OTHER_ADMIN_ID }) });
    eq(r.out.status, 403, "a DIFFERENT verified admin ⇒ 403"); eq(r.out.body.error, "not_staging_operator", "…not_staging_operator");
    eq(r.out.body.eligible, false, "…eligible:false");
    r = await run({});
    eq(r.out.status, 200, "the single verified founder operator ⇒ 200"); eq(r.out.body.eligible, true, "…eligible:true"); eq(r.out.body.mode, "text", "…mode:text");
    const bodyStr = JSON.stringify(r.out.body);
    ok(!bodyStr.includes("stg1.") && !bodyStr.includes(FOUNDER_ID) && !bodyStr.includes(BEARER), "the response carries NO subject, admin id or token");
    ok(Object.keys(r.out.body).sort().join(",") === "eligible,mode", "the response body is exactly {eligible, mode}");
  }

  // ─────────────────────────────────────────────────────────────────────
  section("(e) gateway transport — default (customer) behavior unchanged; new seam fails closed");
  {
    const { rt } = makeRuntime();
    const g = fakeGateway({ silent: true });
    const t = GC.createGatewayTransport({ fetchImpl: g.fetchImpl, openSocket: g.openSocket });
    const res = await t.start({ mode: "text", sessionId: rt.sessionId, turnId: "t.1", generation: 0 });
    ok(res.ok, "default transport starts");
    eq(g.calls[0].url, "/api/live-ai/session", "default broker path is the CUSTOMER broker (unchanged)");
    eq(JSON.stringify(Object.keys(g.calls[0].headers)), JSON.stringify(["content-type"]), "default request headers unchanged (no Authorization)");
  }
  for (const [label, getter] of [["null bearer", () => null], ["malformed bearer", () => "bad token"], ["throwing getter", () => { throw new Error("x"); }]]) {
    const { rt } = makeRuntime();
    const g = fakeGateway({ silent: true });
    const t = GC.createGatewayTransport({ fetchImpl: g.fetchImpl, openSocket: g.openSocket, brokerPath: FT.FOUNDER_TEXT_BROKER_PATH, brokerAuthorization: getter, textOnly: true });
    const res = await t.start({ mode: "text", sessionId: rt.sessionId, turnId: "t.1", generation: 0 });
    ok(!res.ok && res.code === "broker_unavailable" && g.calls.length === 0 && g.opens() === 0, `${label} ⇒ broker_unavailable, NO broker request, NO socket`);
  }
  {
    const { rt } = makeRuntime();
    const g = fakeGateway({ silent: true });
    const t = GC.createGatewayTransport({ fetchImpl: g.fetchImpl, openSocket: g.openSocket, brokerPath: FT.FOUNDER_TEXT_BROKER_PATH, brokerAuthorization: () => BEARER, textOnly: true });
    const mic = await t.start({ mode: "microphone", sessionId: rt.sessionId, turnId: "t.1", generation: 0 });
    ok(!mic.ok && mic.code === "unsupported" && g.calls.length === 0, "textOnly + microphone ⇒ unsupported, no broker request (no mic path)");
    const res = await t.start({ mode: "text", sessionId: rt.sessionId, turnId: "t.1", generation: 0 });
    ok(res.ok, "valid bearer ⇒ text start ok");
    eq(g.calls[0].url, "/api/live-ai/staging/session", "routes ONLY to the admin staging broker");
    eq(g.calls[0].headers.authorization, `Bearer ${BEARER}`, "Authorization: Bearer header carried");
    eq(JSON.stringify(g.calls[0].body), JSON.stringify({ mode: "text", sessionId: rt.sessionId }), "body is TEXT-only {mode, sessionId} — no subject/role/auth field");
    eq(t.submitApproval({ sessionId: rt.sessionId, turnId: "t.1", generation: 0, planId: "p.1", authorityRef: "ar.1", textHash: "h" }), false, "textOnly NEVER sends answer.approve (the sole TTS trigger)");
    ok(!g.sent.some((f) => f.t === "answer.approve"), "…no answer.approve frame on the wire");
    t.stop && t.stop();
  }

  // ─────────────────────────────────────────────────────────────────────
  section("(f) founder TEXT session — answer path + every fallback path");
  {
    // answer path
    const { rt, s } = makeRuntime();
    const g = fakeGateway();
    const sess = FT.createFounderTextSession({ runtime: rt, getBearer: () => BEARER, fetchImpl: g.fetchImpl, openSocket: g.openSocket, timeoutMs: 5000 });
    const p = sess.ask("Show me quiet hotels in Dhanaulti");
    await settle(10);
    eq(g.calls.length, 1, "one staging broker request");
    eq(g.calls[0].url, "/api/live-ai/staging/session", "…to the staging broker");
    const pub = g.sent.filter((f) => f.t === "context.publish").pop();
    ok(!!pub, "bounded context published over the control socket");
    const turn = g.sent.find((f) => f.t === "turn.text");
    ok(turn && turn.text === "Show me quiet hotels in Dhanaulti", "the typed text is sent as turn.text");
    g.push({ t: "context.ack", sessionId: rt.sessionId, turnId: rt.getCurrentTurnId(), generation: 0, routeEpoch: rt.getRouteEpoch(), contextRevision: pub.contextRevision, authorityRef: "auth.f1" });
    g.push({ t: "answer.plan", sessionId: rt.sessionId, turnId: rt.getCurrentTurnId(), generation: 0, authorityRef: "auth.f1", plan: { planId: "plan.f1", providerTurnId: "pt.f1", kind: "clarification", language: "en", evidenceReceiptIds: [], questionCode: "which_city" } });
    const r = await p;
    ok(r.ok === true && typeof r.text === "string" && r.text.length > 0, "a validated provider answer resolves ok with text");
    ok(!g.sent.some((f) => f.t === "answer.approve"), "NO answer.approve sent ⇒ no TTS (text only)");
    eq(s.opened + s.refined, 0, "no page action executed by an answer");
    // second typed turn on the SAME session after a completed answer (03B sends no trailing idle)
    const p2 = sess.ask("Which one has breakfast?");
    await settle(4);
    const turns = g.sent.filter((f) => f.t === "turn.text");
    ok(turns.length === 2 && turns[1].text === "Which one has breakfast?", "a follow-up typed turn goes out on the same session (multi-turn)");
    eq(g.calls.length, 1, "…without a second broker mint");
    const busy2 = await sess.ask("third");
    eq(busy2.code, "busy", "a concurrent ask while a turn is pending ⇒ busy");
    g.push({ t: "answer.plan", sessionId: rt.sessionId, turnId: rt.getCurrentTurnId(), generation: 0, authorityRef: "auth.f1", plan: { planId: "plan.f2", providerTurnId: "pt.f2", kind: "clarification", language: "en", evidenceReceiptIds: [], questionCode: "which_city" } });
    ok((await p2).ok === true, "the follow-up turn resolves with its answer");
    const p3 = sess.ask("one more");
    await settle(4);
    sess.dispose();
    eq((await p3).code, "disposed", "dispose settles the in-flight ask");
    ok(g.closed() >= 1, "dispose tears down the control socket");
    eq((await sess.ask("after")).code, "disposed", "ask after dispose ⇒ disposed");
  }
  {
    const { rt } = makeRuntime();
    const g = fakeGateway({ brokerStatus: 503 });
    const sess = FT.createFounderTextSession({ runtime: rt, getBearer: () => BEARER, fetchImpl: g.fetchImpl, openSocket: g.openSocket, timeoutMs: 5000 });
    const r = await sess.ask("hello");
    ok(r.ok === false, `broker 503 (disabled/unconfigured) ⇒ {ok:false} [${r.code}] → scripted fallback`);
    eq(g.opens(), 0, "…no socket opened");
    sess.dispose();
  }
  {
    const { rt } = makeRuntime();
    const g = fakeGateway({ brokerStatus: 403 });
    const sess = FT.createFounderTextSession({ runtime: rt, getBearer: () => BEARER, fetchImpl: g.fetchImpl, openSocket: g.openSocket, timeoutMs: 5000 });
    const r = await sess.ask("hello");
    ok(r.ok === false && g.opens() === 0, `broker 403 (not the operator) ⇒ {ok:false} [${r.code}], no socket`);
    sess.dispose();
  }
  {
    const { rt } = makeRuntime();
    const g = fakeGateway();
    const sess = FT.createFounderTextSession({ runtime: rt, getBearer: () => null, fetchImpl: g.fetchImpl, openSocket: g.openSocket, timeoutMs: 5000 });
    const r = await sess.ask("hello");
    ok(r.ok === false && g.calls.length === 0 && g.opens() === 0, `no admin bearer ⇒ {ok:false} [${r.code}], NO broker request`);
    sess.dispose();
  }
  {
    const { rt } = makeRuntime();
    const g = fakeGateway();
    const timers = []; const setTimer = (fn) => { timers.push(fn); return timers.length; }; const clearTimer = () => {};
    const sess = FT.createFounderTextSession({ runtime: rt, getBearer: () => BEARER, fetchImpl: g.fetchImpl, openSocket: g.openSocket, setTimer, clearTimer });
    const p = sess.ask("slow question");
    await settle(10);
    timers[0]();
    const r = await p;
    eq(r.code, "timeout", "no answer within the window ⇒ timeout → scripted fallback");
    ok(g.closed() >= 1, "…the session socket is torn down");
    sess.dispose();
  }
  {
    const { rt } = makeRuntime();
    const g = fakeGateway();
    const sess = FT.createFounderTextSession({ runtime: rt, getBearer: () => BEARER, fetchImpl: g.fetchImpl, openSocket: g.openSocket, timeoutMs: 5000 });
    const p = sess.ask("q");
    await settle(10);
    g.push({ t: "turn.error", sessionId: rt.sessionId, turnId: rt.getCurrentTurnId(), generation: 0, code: "provider_unavailable" });
    const r = await p;
    ok(r.ok === false, `gateway turn.error ⇒ {ok:false} [${r.code}] → scripted fallback`);
    sess.dispose();
  }
  eq((await FT.createFounderTextSession({ runtime: makeRuntime().rt, getBearer: () => BEARER, fetchImpl: async () => { throw new Error("no"); }, openSocket: () => ({ send() {}, close() {} }) }).ask("   ")).code, "empty", "blank text ⇒ empty, no request");

  // ─────────────────────────────────────────────────────────────────────
  section("(g) static wiring — typed turns only, voice + normal guests preserved, no writes");
  {
    const tb = fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8");
    ok(/founderNow\.active && !fromVoice/.test(tb), "TravelBuddy routes ONLY typed (non-voice) turns to founder AI");
    ok(/Buddy will answer instead/.test(tb), "a founder failure falls through to the scripted Buddy with a visible note");
    ok(!/speak\([^)]*founder/i.test(tb), "founder answers are never spoken");
    ok(/SpeechRecognition|webkitSpeechRecognition/.test(tb), "browser speech recognition code remains present");
    const hook = fs.readFileSync(path.join(REPO, "components/live-ai/useFounderText.ts"), "utf8");
    ok(/useState\(false\)[\s\S]*useState\(false\)/.test(hook), "available + active both default false");
    ok(!/localStorage\.setItem|sessionStorage\.setItem/.test(hook), "opt-in is never persisted");
    ok(/if \(!gate/.test(hook), "gate off ⇒ the hook does nothing");
    const lib = fs.readFileSync(path.join(REPO, "lib/live-ai/founder-text.ts"), "utf8");
    const route = fs.readFileSync(path.join(REPO, "app/api/live-ai/staging/eligibility/route.ts"), "utf8");
    const elig = fs.readFileSync(path.join(REPO, "lib/live-ai/founder-text-eligibility.ts"), "utf8");
    const all = [lib, route, elig, hook].join("\n");
    ok(!/\/api\/(bids|bookings|payments?|razorpay|proxy)/.test(all), "no bid/booking/payment/proxy endpoint referenced");
    ok(!/sbInsert|sbPatch|apply_migration|method:\s*"(PATCH|PUT|DELETE)"/.test(all), "no DB write / mutation verb");
    ok(!/signAssertion|SignJWT|importPKCS8/.test(route + elig), "the eligibility route mints NOTHING");
    ok(!/fetch\(/.test(route + elig), "the eligibility route contacts no gateway/provider");
    ok(!/rzp_(live|test)_|sk-[A-Za-z0-9]{8}/.test(all), "no key material in the new files");
    ok(!/NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA\s*[=:]\s*"1"/.test(all), "nothing sets the global provider flag");
    const contracts = fs.readFileSync(path.join(REPO, "lib/live-ai/contracts.ts"), "utf8");
    ok(!/PLACE_BID|CREATE_BOOKING|PAY|CHECKOUT/.test(contracts), "the typed LiveAiOperation set has no bid/booking/payment op");
    const gitDiff = cp.spawnSync("git", ["diff", "--name-only", "HEAD", "--", "app/api/live-ai/session", "app/api/live-ai/staging/session", "lib/live-ai/staging-authority.ts", "lib/live-ai/broker.ts", "lib/live-ai/conversation.ts", "components/live-ai/LiveAiProvider.tsx"], { cwd: REPO, encoding: "utf8" });
    ok(gitDiff.status === 0 && gitDiff.stdout.trim() === "", "customer broker, staging broker, staging authority, conversation + provider shell are byte-unchanged vs HEAD");
  }

  console.log(`\nfounder-text: ${pass} passed, ${fail} failed`);
  if (fail) { for (const f of failures) console.error("  FAIL: " + f); process.exit(1); }
})().catch((e) => { console.error("SUITE CRASH:", e && e.stack || e); process.exit(1); });
