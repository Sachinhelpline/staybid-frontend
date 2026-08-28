#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — gateway SECURITY suite (adversarial).
//
//   Run:  node tests/voice/voice-gateway-security.test.js
//
// Compiles server/voice-gateway/*.ts with the LOCAL tsc and adversarially probes:
// control-token forgery / wrong-session / expiry / query-string-not-accepted,
// control-frame malformed / oversized / unknown / cross-session, provider-event
// malformed / oversized / unknown-tool / traversal, SSRF / arbitrary-URL / method
// rejection, kill-switch HMAC, and PRIVACY (no transcript/audio/secret logging;
// telemetry allowlist). NO provider, NO device, NO network, NO DB.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const crypto = require("node:crypto");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "gwsec");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "gw"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "server/voice-gateway"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "server/voice-gateway", f), path.join(SRC, "gw", f));
}
fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
      moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
      types: ["node", "ws"], lib: ["es2020"], strict: true, noEmitOnError: true, resolveJsonModule: true,
    },
    include: ["gw/**/*.ts"],
  }),
);
const TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) {
  console.error("COMPILE GATE FAILED:", compile.stdout, compile.stderr);
  process.exit(2);
}
console.log("• Local tsc compile (SB-04 gateway security): exit 0, clean");
const AUTH = require(path.join(OUT, "gw", "auth.js"));
const CS = require(path.join(OUT, "gw", "control-socket.js"));
const SCHEMAS = require(path.join(OUT, "gw", "schemas.js"));
const SESS = require(path.join(OUT, "gw", "sessions.js"));
const CONFIG = require(path.join(OUT, "gw", "config.js"));
const TEL = require(path.join(OUT, "gw", "telemetry.js"));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(label); console.error("  ✗ " + label); }
}
function section(name) { console.log("\n• " + name); }

const ENV = {
  VOICE_AI_RUNTIME_ENABLED: "1",
  OPENAI_API_KEY: "sk-x",
  VOICE_AI_SESSION_SIGNING_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----",
  VOICE_AI_SESSION_ISSUER: "https://staybids.in",
  VOICE_AI_SESSION_AUDIENCE: "staybid-voice-gateway",
  VOICE_AI_CONTROL_TOKEN_SECRET: "ctrl-secret",
  VOICE_AI_KILL_SWITCH_HMAC_SECRET: "kill-secret",
  VOICE_AI_ALLOWED_ORIGINS: "https://staybids.in",
  VOICE_AI_IP_HASH_SALT: "salt",
  STAYBID_PUBLIC_BASE_URL: "https://staybids.in",
};
const config = CONFIG.loadGatewayConfig(ENV);

// ── control token ──────────────────────────────────────────────────────────
section("Control token (bound to session+subject, ≤10min, forgery/mismatch/expiry)");
{
  let t = 5_000_000;
  const now = () => t;
  const tok = AUTH.mintControlToken("vses_1", "vsub_1", config, now);
  ok(typeof tok === "string" && tok.includes("."), "control token minted");
  ok(AUTH.verifyControlToken(tok, "vses_1", config, now).ok, "valid control token verifies for its session");
  ok(AUTH.verifyControlToken(tok, "vses_OTHER", config, now).code === "control_mismatch", "token for another session → control_mismatch");
  const forged = tok.slice(0, tok.indexOf(".") + 1) + "AAAA";
  ok(AUTH.verifyControlToken(forged, "vses_1", config, now).code === "control_invalid", "forged signature → control_invalid");
  // expiry: advance beyond the ≤10-minute lifetime
  t += config.limits.controlTokenMaxAgeMs + 1000;
  ok(AUTH.verifyControlToken(tok, "vses_1", config, now).code === "control_expired", "token past ≤10min lifetime → control_expired");
  // unconfigured secret → fail closed
  const noSecret = CONFIG.loadGatewayConfig({ ...ENV, VOICE_AI_CONTROL_TOKEN_SECRET: "" });
  ok(AUTH.mintControlToken("s", "u", noSecret) === null, "no control secret → cannot mint");
  ok(AUTH.verifyControlToken("x.y", "s", noSecret).code === "control_unconfigured", "no control secret → verify unconfigured");
}

// ── control-socket open authorization ───────────────────────────────────────
section("Control-socket open (subprotocol token only; query string never accepted)");
{
  const store = SESS.createSessionStore({ limits: config.limits });
  const sess = store.create({ subject: "vsub_open", ipHash: "h", authenticated: false }).session;
  const tok = AUTH.mintControlToken(sess.sessionId, "vsub_open", config);
  // token in subprotocol → ok
  const good = CS.authorizeControlOpen({ subprotocol: `staybid-voice.${tok}`, sessionId: sess.sessionId, config, store });
  ok(good.ok, "valid subprotocol token opens control");
  // second open on the same session → already_bound
  const second = CS.authorizeControlOpen({ subprotocol: `staybid-voice.${tok}`, sessionId: sess.sessionId, config, store });
  ok(!second.ok && second.code === "already_bound" && second.closeCode === 4409, "second control connection refused (already_bound)");
  // NO subprotocol (e.g. token smuggled in a query string) → no_token
  const noToken = CS.authorizeControlOpen({ subprotocol: undefined, sessionId: sess.sessionId, config, store });
  ok(!noToken.ok && noToken.code === "no_token" && noToken.closeCode === 4400, "missing subprotocol token (query-string cred) → refused");
  // token for another session → bad_token
  const sess2 = store.create({ subject: "vsub_open2", ipHash: "h2", authenticated: false }).session;
  const foreignTok = AUTH.mintControlToken("vses_nonexistent", "vsub_open", config);
  const bad = CS.authorizeControlOpen({ subprotocol: `staybid-voice.${foreignTok}`, sessionId: sess2.sessionId, config, store });
  ok(!bad.ok && bad.code === "bad_token", "control token for a different session → bad_token");
  // parse helper: only the staybid-voice. prefix is honored
  ok(CS.parseControlSubprotocol("staybid-voice.abc") === "abc", "subprotocol parse extracts token");
  ok(CS.parseControlSubprotocol("other.abc") === null, "non-staybid subprotocol ignored");
}

// ── control frames ──────────────────────────────────────────────────────────
section("Control frames (validate + bound; cancel/reset/close; drop unknown/oversized)");
{
  const store = SESS.createSessionStore({ limits: config.limits });
  const sess = store.create({ subject: "vsub_frame", ipHash: "h", authenticated: false }).session;
  store.beginTurn(sess);
  const sentFrames = [];
  const socket = { send: (d) => sentFrames.push(d), closed: false, close() { this.closed = true; } };
  let providerCancelled = false;
  const provider = { cancelTurn() { providerCancelled = true; }, close() {}, onEvent() {}, sendToolResult() {} };
  const emit = CS.makeSocketEmit(socket);

  ok(CS.handleControlFrame({ raw: "{not json", session: sess, store, socket, provider, emit }).reason === "malformed", "malformed JSON dropped");
  ok(CS.handleControlFrame({ raw: JSON.stringify({ t: "evil" }), session: sess, store, socket, provider, emit }).reason === "unknown", "unknown frame type dropped");
  ok(CS.handleControlFrame({ raw: "x".repeat(9000), session: sess, store, socket, provider, emit }).reason === "oversized", "oversized frame dropped");
  ok(CS.handleControlFrame({ raw: 123, session: sess, store, socket, provider, emit }).reason === "malformed", "non-string (binary) frame dropped");
  // cancel_turn
  const c = CS.handleControlFrame({ raw: JSON.stringify({ t: "cancel_turn", turnId: sess.turnId }), session: sess, store, socket, provider, emit });
  ok(c.action === "cancel" && sess.cancelled === true && providerCancelled === true, "cancel_turn → session cancelled + provider notified");
  // reset_session clears allowlist
  store.allowHotelIds(sess, ["hotelR"]);
  CS.handleControlFrame({ raw: JSON.stringify({ t: "reset_session" }), session: sess, store, socket, provider, emit });
  ok(sess.allowlist.size === 0, "reset_session clears the allowlist");
  // close_session closes
  CS.handleControlFrame({ raw: JSON.stringify({ t: "close_session" }), session: sess, store, socket, provider, emit });
  ok(socket.closed === true && store.get(sess.sessionId) === null, "close_session closes the socket + drops the session");
  // emit never sends an oversized frame
  const bigStore = SESS.createSessionStore({ limits: config.limits });
  const bigSess = bigStore.create({ subject: "b", ipHash: "b", authenticated: false }).session;
  const s2 = { sent: [], send(d) { this.sent.push(d); }, close() {} };
  const emit2 = CS.makeSocketEmit(s2);
  emit2({ t: "result", kind: "answer", text: "x".repeat(20000), turnId: bigSess.turnId });
  ok(s2.sent.length === 0, "emit refuses an oversized outbound frame");
  emit2({ t: "status", status: "listening", turnId: 1 });
  ok(s2.sent.length === 1, "emit sends a bounded frame");
}

// ── provider event validation ───────────────────────────────────────────────
section("Provider event validation (untrusted; unknown/traversal/oversized fail closed)");
{
  ok(SCHEMAS.validateProviderEvent(null) === null, "null event → null");
  ok(SCHEMAS.validateProviderEvent({ kind: "nope" }) === null, "unknown kind → null");
  ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c", tool: "searchHotels", input: { host: "169.254.169.254" } }) === null, "metadata-host input key → null");
  ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c", tool: "getHotelDetails", input: { id: "../../etc/passwd" } }) === null, "traversal id → null");
  ok(SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "c", tool: "getHotelDetails", input: { id: "http://evil/x" } }) === null, "url-shaped id → null");
  // oversized text is BOUNDED, not trusted verbatim
  const big = SCHEMAS.validateProviderEvent({ kind: "answer", text: "z".repeat(50000) });
  ok(big && big.text.length <= 800, "over-long answer text bounded to ≤800");
  // duplicate tool calls each validate deterministically (idempotent shape)
  const a = SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "dup", tool: "searchHotels", input: {} });
  const b = SCHEMAS.validateProviderEvent({ kind: "tool_call", callId: "dup", tool: "searchHotels", input: {} });
  ok(a && b && a.callId === b.callId, "duplicate tool calls validate consistently");
  // a ui_action carrying a raw url is rejected by the closed union
  ok(SCHEMAS.validateProviderEvent({ kind: "ui_action", action: { type: "OPEN_HOTEL", url: "http://x" } }) === null, "ui_action without a valid hotelId (only url) → null");
}

// ── kill switch HMAC ────────────────────────────────────────────────────────
section("Kill switch (HMAC, freshness, disable-only, fail closed)");
{
  const ts = 10_000_000;
  const now = () => ts;
  const nonce = "kn1";
  const sign = (n, t, secret) => crypto.createHmac("sha256", secret).update(`${n}.${t}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  ok(AUTH.verifyKillRequest({ nonce, ts, sig: sign(nonce, ts, "kill-secret") }, config, now).ok, "valid kill HMAC verifies");
  ok(AUTH.verifyKillRequest({ nonce, ts, sig: "wrong" }, config, now).code === "kill_invalid", "forged kill sig → kill_invalid");
  ok(AUTH.verifyKillRequest({ nonce, ts: ts - 200000, sig: sign(nonce, ts - 200000, "kill-secret") }, config, now).code === "kill_stale", "stale timestamp → kill_stale");
  const noSecret = CONFIG.loadGatewayConfig({ ...ENV, VOICE_AI_KILL_SWITCH_HMAC_SECRET: "" });
  ok(AUTH.verifyKillRequest({ nonce, ts, sig: "x" }, noSecret, now).code === "kill_unconfigured", "no kill secret → unconfigured (fail closed)");
}

// ── privacy / telemetry ─────────────────────────────────────────────────────
section("Privacy: telemetry allowlist + no secret/transcript/audio logging");
{
  const projected = TEL.projectTelemetry({
    event: "tool.run",
    sessionId: "vses_x",
    toolName: "searchHotels",
    // forbidden fields — must be dropped
    transcript: "user said something private",
    audio: "blob",
    apiKey: "sk-secret",
    ip: "1.2.3.4",
    provider: "openai",
    providerEvent: { huge: "object" },
  });
  ok(projected.transcript === undefined, "telemetry drops transcript");
  ok(projected.audio === undefined, "telemetry drops audio");
  ok(projected.apiKey === undefined, "telemetry drops apiKey");
  ok(projected.ip === undefined, "telemetry drops raw ip");
  ok(projected.providerEvent === undefined, "telemetry never serializes a provider event object");
  ok(projected.event === "tool.run" && projected.toolName === "searchHotels" && projected.provider === "openai", "telemetry keeps only allowlisted primitives");

  // safe config summary carries NO secret values
  const summary = CONFIG.safeConfigSummary(config);
  const summaryStr = JSON.stringify(summary);
  ok(!summaryStr.includes("ctrl-secret") && !summaryStr.includes("kill-secret") && !summaryStr.includes("sk-x"), "safeConfigSummary leaks no secret value");
  ok(summary.openaiApiKeyPresent === true && summary.controlTokenConfigured === true, "summary exposes presence booleans only");

  // source scan: no gateway file logs a transcript / audio / api key / token value
  const files = fs.readdirSync(path.join(REPO, "server/voice-gateway")).filter((f) => f.endsWith(".ts"));
  let leaks = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO, "server/voice-gateway", f), "utf8");
    // a console.* call that references a sensitive identifier
    const consoleCalls = src.match(/console\.(log|error|warn|info)\([^\n]*\)/g) || [];
    for (const call of consoleCalls) {
      if (/transcript|audio|apiKey|OPENAI_API_KEY|controlTokenSecret|signingPrivate|assertion\b|idToken|\.sig\b/i.test(call)) leaks++;
    }
  }
  ok(leaks === 0, "no gateway console.* logs a transcript/audio/key/token value");

  // env-name-only usage: no hardcoded provider key literal in gateway source
  let hardcoded = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO, "server/voice-gateway", f), "utf8");
    if (/sk-[A-Za-z0-9]{16,}/.test(src)) hardcoded++;
  }
  ok(hardcoded === 0, "no hardcoded provider key literal in gateway source");
}

console.log("\n──────────────────────────────────────────────────");
console.log(`Voice AI SB-04 gateway security: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("FAILURES:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("ALL VOICE-AI-SB-04 GATEWAY SECURITY CHECKS PASSED");
