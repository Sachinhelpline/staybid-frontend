#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — session-broker suite.
//
//   Run:  node tests/voice/voice-session-broker.test.js
//
// Compiles lib/voice/*.ts with the LOCAL tsc and exercises the PURE broker helpers
// the same-origin /api/voice/session route uses (the route itself imports
// next/server + node crypto, so its pure logic is factored into lib/voice/provider
// and tested here). Also proves the Vercel→gateway assertion CONTRACT end-to-end
// with the REAL `jose` library: the claims builder → ES256 sign → verify round
// trip carries a read-only scope, ~60s expiry, a one-use jti, the bound issuer +
// audience, and NO email/phone/token — and a tampered / wrong-audience token
// fails verification. NO next/server, NO network, NO real key material committed.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const jose = require("jose");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "broker");
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
console.log("• Local tsc compile (broker helpers): exit 0, clean");
const V = require(path.join(OUT, "voice", "index.js"));
const crypto = require("node:crypto");
const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(label); console.error("  ✗ " + label); }
}
function section(name) { console.log("\n• " + name); }

// ── configuration fail-closed ────────────────────────────────────────────────
section("Broker config (fail closed until every server env is set)");
{
  ok(V.isBrokerConfigured({}) === false, "empty env → unconfigured");
  ok(V.isBrokerConfigured({ VOICE_AI_GATEWAY_URL: "https://g", VOICE_AI_SESSION_SIGNING_PRIVATE_KEY: "k", VOICE_AI_SESSION_ISSUER: "i" }) === false, "missing audience → unconfigured");
  ok(V.isBrokerConfigured({ VOICE_AI_GATEWAY_URL: "https://g", VOICE_AI_SESSION_SIGNING_PRIVATE_KEY: "k", VOICE_AI_SESSION_ISSUER: "i", VOICE_AI_SESSION_AUDIENCE: "a" }) === true, "all four set → configured");
}

// ── origin allowlist ─────────────────────────────────────────────────────────
section("Origin allowlist (parse + membership; never '*')");
{
  const list = V.parseAllowedOrigins("https://staybids.in, https://www.staybids.in");
  ok(list.length === 2 && list.includes("https://staybids.in"), "origins parsed");
  ok(V.parseAllowedOrigins("not a url").length === 0, "malformed origins dropped");
  ok(V.isAllowedOrigin("https://staybids.in", list) === true, "member origin allowed");
  ok(V.isAllowedOrigin("https://evil.example", list) === false, "non-member origin rejected");
  ok(V.isAllowedOrigin("https://staybids.in", []) === false, "empty allowlist rejects (never '*')");
}

// ── SDP + response shaping bounds ────────────────────────────────────────────
section("SDP + response bounds");
{
  ok(V.validateSdpOffer("v=0\r\nm=audio 9 UDP\r\n") !== null, "valid offer");
  ok(V.validateSdpOffer("v=0\r\nm=video 9\r\n") === null, "no audio m-line → rejected");
  ok(V.MAX_SDP_OFFER_BYTES > 0 && V.MAX_BROKER_BODY_BYTES > 0, "bounds exported");
  const shaped = V.shapeBrokerResponse({ sessionId: "vses_9", answerSdp: "v=0\r\nm=audio 9\r\n", controlToken: "t", expiresInSeconds: 9999 });
  ok(shaped.expiresInSeconds === 600, "expiry clamped to ≤600s");
}

// ── pseudonymous subject ─────────────────────────────────────────────────────
section("Pseudonymous subject (non-reversible, no PII)");
{
  const s1 = V.derivePseudonymousSubject("seed-A", sha256hex);
  const s2 = V.derivePseudonymousSubject("seed-A", sha256hex);
  const s3 = V.derivePseudonymousSubject("seed-B", sha256hex);
  ok(s1 === s2, "same seed → same subject");
  ok(s1 !== s3, "different seed → different subject");
  ok(/^vsub_[0-9a-f]{40}$/.test(s1) && !s1.includes("seed-A"), "subject is a bounded hash, never the raw seed");
}

// ── same-origin + signed stable anonymous identity (SB04-SRC-REV-04) ─────────
section("Same-origin check + signed stable anonymous identity cookie");
{
  ok(V.isSameOrigin("https://staybids.in", "https://staybids.in") === true, "same origin accepted");
  ok(V.isSameOrigin("https://evil.example", "https://staybids.in") === false, "cross origin rejected");
  ok(V.isSameOrigin(null, "https://staybids.in") === false, "missing origin rejected");

  // The route derives an HMAC from existing key material; here we stand in a key.
  const key = crypto.createHash("sha256").update("voice-aid:test-private-key").digest();
  const hmacHex = (body) => crypto.createHmac("sha256", key).update(body).digest("hex");
  const eq = (a, b) => { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb); };
  const nowSec = Math.floor(Date.now() / 1000);

  const cookie = V.buildAidCookie("aid-abc", nowSec, hmacHex);
  const read1 = V.readAidCookie(cookie, nowSec, hmacHex, eq);
  ok(read1 && read1.aid === "aid-abc", "signed cookie round-trips to the same aid (stable identity)");
  // same aid ⇒ same pseudonymous subject across session starts
  const sub1 = V.derivePseudonymousSubject(read1.aid, sha256hex);
  const sub2 = V.derivePseudonymousSubject(V.readAidCookie(cookie, nowSec, hmacHex, eq).aid, sha256hex);
  ok(sub1 === sub2, "same browser cookie ⇒ same subject across session starts");
  // a different browser identity is isolated
  ok(V.derivePseudonymousSubject("aid-other", sha256hex) !== sub1, "different aid ⇒ different subject (isolated)");
  // tamper: a forged signature fails closed
  ok(V.readAidCookie(cookie.slice(0, -3) + "aaa", nowSec, hmacHex, eq) === null, "tampered cookie signature → null");
  // expiry: past the TTL fails closed
  ok(V.readAidCookie(cookie, nowSec + V.AID_TTL_SECONDS + 10, hmacHex, eq) === null, "expired cookie → null");
  // a cookie signed with a different key fails closed (no cross-deploy reuse)
  const otherHmac = (b) => crypto.createHmac("sha256", crypto.createHash("sha256").update("voice-aid:different").digest()).update(b).digest("hex");
  ok(V.readAidCookie(cookie, nowSec, otherHmac, eq) === null, "cookie signed with a different key → null");
  // no PII in the cookie payload
  ok(!/email|phone|@/.test(cookie), "cookie carries no PII");
}

// ── canonical broker origin (SB04-R1-REREV-05A) ──────────────────────────────
section("Canonical broker origin derived from the EXISTING issuer env (no new env)");
{
  // The authoritative same-origin anchor is the configured issuer origin, NOT the
  // proxy-/Host-influenced request URL — and it introduces NO new env var.
  ok(V.resolveCanonicalOrigin({ VOICE_AI_SESSION_ISSUER: "https://staybids.in" }) === "https://staybids.in", "https issuer → canonical origin");
  ok(V.resolveCanonicalOrigin({ VOICE_AI_SESSION_ISSUER: "https://staybids.in/x/y" }) === "https://staybids.in", "issuer path is stripped to the origin");
  ok(V.resolveCanonicalOrigin({ VOICE_AI_SESSION_ISSUER: "not-a-url" }) === null, "a non-URL issuer → null (broker fails closed)");
  ok(V.resolveCanonicalOrigin({ VOICE_AI_SESSION_ISSUER: "https://user:pass@staybids.in" }) === null, "issuer with embedded creds → null");
  ok(V.resolveCanonicalOrigin({}) === null, "no issuer → null");
  // an attacker Origin that differs from the canonical origin is rejected
  const canon = V.resolveCanonicalOrigin({ VOICE_AI_SESSION_ISSUER: "https://staybids.in" });
  ok(V.isSameOrigin("https://staybids.in", canon) === true, "same-origin request matches the canonical origin");
  ok(V.isSameOrigin("https://attacker.example", canon) === false, "a cross-origin request is refused against the canonical origin");
}

// ── UTF-8 byte bounds on the broker SDP offer (SB04-R1-REREV-06) ──────────────
section("Broker SDP offer is bounded by UTF-8 BYTES (multi-byte)");
{
  const head = "v=0\r\nm=audio 9 UDP\r\n";
  const big = head + "क".repeat(7000); // < MAX by .length, > MAX by bytes
  ok(big.length < V.MAX_SDP_OFFER_BYTES, "multibyte offer under the cap by .length");
  ok(V.utf8Bytes(big) > V.MAX_SDP_OFFER_BYTES, "…over the cap by UTF-8 bytes");
  ok(V.validateSdpOffer(big) === null, "multibyte offer over the BYTE cap is rejected");
}

// ── R3 (SB04-R2-REREV-06): canonical origin — HTTPS required in production ────
section("R3-06: canonical origin requires HTTPS (issuer origin only; no req.url authority)");
{
  const R = V.resolveCanonicalOrigin;
  ok(R({ VOICE_AI_SESSION_ISSUER: "https://staybids.in" }) === "https://staybids.in", "https issuer → canonical origin");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://staybids.in" }) === null, "PRODUCTION http issuer → null (fail closed; no HTTP production origin)");
  // R4-12: http requires BOTH an explicit dev/test insecure opt-in AND a loopback host.
  // A bare loopback http issuer with NO opt-in is now rejected (was accepted in R3).
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://localhost:3000" }) === null, "http LOOPBACK without opt-in → null (R4-12: opt-in required)");
  // A public http host is rejected EVEN WITH the opt-in (opt-in never widens past loopback).
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://staybids.in" }, { allowInsecure: true }) === null, "http PUBLIC host + opt-in → null (R4-12: opt-in never covers a public host)");
  ok(R({ VOICE_AI_SESSION_ISSUER: "  " }) === null, "whitespace issuer → null");
  ok(R({ VOICE_AI_SESSION_ISSUER: "https://u:p@staybids.in" }) === null, "issuer with userinfo → null");
  ok(R({ VOICE_AI_SESSION_ISSUER: "https://staybids.in/path?q=1#f" }) === "https://staybids.in", "path/query/fragment stripped — URL.origin only");
  // the request URL / Host is NOT an authorization root: the canonical origin comes
  // ONLY from config, so an internal proxy URL differing from the public issuer
  // changes nothing (proven at the route level by the origin comparison being
  // config-anchored — there is no req.url-based gate left in the route source).
  const canon = R({ VOICE_AI_SESSION_ISSUER: "https://staybids.in" });
  ok(V.isSameOrigin("https://staybids.in", canon) === true, "matching Browser Origin accepted against the configured canonical origin");
  ok(V.isSameOrigin("https://internal-proxy.local", canon) === false, "a proxy-internal origin is NOT accepted (config is the authority)");
}

// ── R4-12 (SB04-R3-REREV-12): insecure HTTP only for loopback ────────────────
// HTTPS for every non-loopback host in every mode; HTTP is permitted ONLY when BOTH
// (a) the explicit dev/test insecure option is enabled AND (b) the host is loopback.
section("R4-12: HTTP is loopback-only, and only with an explicit dev/test opt-in");
{
  const R = V.resolveCanonicalOrigin;
  // https always accepted regardless of opt-in
  ok(R({ VOICE_AI_SESSION_ISSUER: "https://staybids.in" }) === "https://staybids.in", "https public host → accepted (no opt-in needed)");
  ok(R({ VOICE_AI_SESSION_ISSUER: "https://localhost:3000" }) === "https://localhost:3000", "https loopback → accepted");
  // http loopback + explicit opt-in → accept (localhost AND 127.0.0.1 AND ::1)
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://localhost:3000" }, { allowInsecure: true }) === "http://localhost:3000", "http localhost + opt-in → accept");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://127.0.0.1:3000" }, { allowInsecure: true }) === "http://127.0.0.1:3000", "http 127.0.0.1 + opt-in → accept");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://[::1]:3000" }, { allowInsecure: true }) === "http://[::1]:3000", "http ::1 + opt-in → accept");
  // http loopback WITHOUT opt-in → reject (opt-in is mandatory)
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://localhost:3000" }) === null, "http localhost WITHOUT opt-in → reject");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://127.0.0.1:3000" }) === null, "http 127.0.0.1 WITHOUT opt-in → reject");
  // http public host → reject in EVERY mode (opt-in never widens past loopback)
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://staybids.in" }) === null, "http public host WITHOUT opt-in → reject");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://staybids.in" }, { allowInsecure: true }) === null, "http public host WITH opt-in → reject");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://169.254.169.254" }, { allowInsecure: true }) === null, "http link-local metadata host + opt-in → reject (not loopback)");
  ok(R({ VOICE_AI_SESSION_ISSUER: "http://staybids.in.attacker.test" }, { allowInsecure: true }) === null, "http lookalike host + opt-in → reject");
}

// ── R3 (REREV-06 route-source scan): no req.url origin gate remains ──────────
section("R3-06: the broker route has NO new URL(req.url) origin authority");
{
  const routeSrc = fs.readFileSync(path.join(REPO, "app/api/voice/session/route.ts"), "utf8");
  ok(!/new URL\(req\.url\)/.test(routeSrc), "no `new URL(req.url)` origin reconstruction in the route");
  ok(/resolveCanonicalOrigin/.test(routeSrc), "the canonical (issuer-derived) origin is the authorization root");
  ok(/readBoundedRequestBody/.test(routeSrc) && !/await req\.text\(\)\s*;?\s*\n?\s*\}?\s*catch/.test(routeSrc.split("readBoundedRequestBody")[0]), "the body is read through the bounded streamed reader");
  ok(/content-length/i.test(routeSrc), "Content-Length is prechecked before reading");
}

// ── R4-07 (SB04-R3-REREV-07 route-source scan): the gateway→broker RESPONSE is bounded
section("R4-07: the broker route bounds the gateway RESPONSE body (no unbounded json()/text())");
{
  const routeSrc = fs.readFileSync(path.join(REPO, "app/api/voice/session/route.ts"), "utf8");
  ok(/MAX_GATEWAY_RESPONSE_BYTES\s*=\s*64\s*\*\s*1024/.test(routeSrc), "a fixed gateway-response byte cap (64KB) is defined");
  ok(/readBoundedResponseBody/.test(routeSrc), "the gateway response is read through a bounded streamed reader");
  // NO unbounded gatewayResp.json() / gatewayResp.text() anywhere in the route CODE
  // (strip comments first — the rule is documented in a comment that names the calls).
  const routeCode = routeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  ok(!/gatewayResp\.json\(\)/.test(routeCode), "no unbounded gatewayResp.json() in code");
  ok(!/gatewayResp\.text\(\)/.test(routeCode), "no unbounded gatewayResp.text() in code");
  // The Content-Length of the gateway response is prechecked against the cap.
  ok(/gatewayResp\.headers\.get\(\s*["']content-length["']\s*\)/.test(routeSrc) && /MAX_GATEWAY_RESPONSE_BYTES/.test(routeSrc), "the gateway response Content-Length is prechecked against the cap");
  // The bounded reader streams with a byte bound, cancels its reader, decodes UTF-8, and
  // the deadline stays armed through the body read (abort → settle(null)).
  const rb = /async function readBoundedResponseBody[\s\S]*?\n\}/.exec(routeSrc);
  ok(!!rb, "readBoundedResponseBody is present");
  const rbBody = rb ? rb[0] : "";
  ok(/getReader\(\)/.test(rbBody), "readBoundedResponseBody uses a streaming reader (getReader)");
  ok(/reader\.cancel\(\)/.test(rbBody), "readBoundedResponseBody cancels the reader when the cap is crossed");
  ok(/new TextDecoder/.test(rbBody), "readBoundedResponseBody UTF-8 decodes from bounded bytes");
  ok(/controller\.signal\.addEventListener\(\s*["']abort["']/.test(routeSrc) && /readBoundedResponseBody\(gatewayResp/.test(routeSrc), "the lifecycle deadline is raced against the bounded response read (abort → null)");
  // JSON is parsed AFTER the bounded read, never before.
  ok(/JSON\.parse\(gatewayText\)/.test(routeSrc), "JSON.parse runs on the bounded gatewayText (parse after bounded read)");
  ok(routeSrc.indexOf("readBoundedResponseBody(gatewayResp") < routeSrc.indexOf("JSON.parse(gatewayText)"), "the bounded read precedes the JSON parse");
}

// ── R3 (REREV-08): the bounded broker body reader (streamed, multi-byte) ─────
section("R3-08: broker body bounded via streamed read (incl. multi-byte over cap)");
{
  // the pure sanitizer used by the route for visible ids
  ok(V.sanitizeVisibleHotelIds(["a1", "a1", "bad id!", "b2"]).join(",") === "a1,b2", "visible ids deduped + invalid dropped + order kept");
  ok(V.sanitizeVisibleHotelIds(Array.from({ length: 40 }, (_, i) => `h${i}`)).length === 24, "visible ids bounded to 24");
  ok(V.sanitizeVisibleHotelIds("nope").length === 0, "non-array visible ids → []");
}

// ── assertion contract, proven end-to-end with real jose ─────────────────────
async function assertionRoundTrip() {
  section("Assertion contract (jose ES256 round trip: scope/expiry/jti/aud/iss/no-PII)");
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
  const iss = "https://staybids.in";
  const aud = "staybid-voice-gateway";
  const nowSec = Math.floor(Date.now() / 1000);
  const subject = V.derivePseudonymousSubject("nonce-xyz", sha256hex);
  const jti = "jti_unique_1";
  const origin = "https://staybids.in";
  const claims = V.buildAssertionClaims({ subject, issuer: iss, audience: aud, nowSec, jti, authenticated: false, origin });

  // Sign exactly the claims the route signs (incl. the validated origin).
  const token = await new jose.SignJWT({ scope: claims.scope, auth: claims.auth, origin: claims.origin })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setSubject(claims.sub).setIssuer(claims.iss).setAudience(claims.aud)
    .setIssuedAt(claims.iat).setExpirationTime(claims.exp).setJti(claims.jti)
    .sign(privateKey);

  // Verify with the audience + issuer bound (as the gateway does).
  const { payload } = await jose.jwtVerify(token, publicKey, { issuer: iss, audience: aud, algorithms: ["ES256"] });
  ok(payload.scope === "voice:read", "verified scope is read-only");
  ok(payload.sub === subject, "verified subject is the pseudonymous id");
  ok(payload.jti === jti, "verified one-use jti present");
  ok(payload.exp - payload.iat === 60, "verified ~60s lifetime");
  ok(payload.auth === false, "verified anonymous auth flag");
  ok(payload.origin === origin, "verified broker-validated origin claim (SB04-SRC-REV-02)");
  // NO PII in the token at all
  const tokenKeys = Object.keys(payload);
  ok(!tokenKeys.some((k) => /email|phone|name|firebase|refresh|access_token|password/i.test(k)), "token carries NO email/phone/token/PII claim");

  // wrong-audience verification fails
  let wrongAud = false;
  try {
    await jose.jwtVerify(token, publicKey, { issuer: iss, audience: "someone-else", algorithms: ["ES256"] });
  } catch { wrongAud = true; }
  ok(wrongAud, "verification with the wrong audience fails");

  // tampered token fails
  let tampered = false;
  try {
    await jose.jwtVerify(token.slice(0, -3) + "aaa", publicKey, { issuer: iss, audience: aud, algorithms: ["ES256"] });
  } catch { tampered = true; }
  ok(tampered, "tampered signature fails verification");

  // an HS256 (symmetric) token is not accepted where ES256 is required
  let algConfusion = false;
  try {
    const hs = await new jose.SignJWT({ scope: "voice:read" })
      .setProtectedHeader({ alg: "HS256" }).setSubject(subject).setIssuer(iss).setAudience(aud)
      .setIssuedAt(nowSec).setExpirationTime(nowSec + 60).setJti("j2").sign(new Uint8Array(32));
    await jose.jwtVerify(hs, publicKey, { issuer: iss, audience: aud, algorithms: ["ES256"] });
  } catch { algConfusion = true; }
  ok(algConfusion, "an HS256 token is rejected under an ES256-only policy (no alg confusion)");
}

assertionRoundTrip()
  .then(() => {
    console.log("\n──────────────────────────────────────────────────");
    console.log(`Voice AI SB-04 session broker: ${pass} passed, ${fail} failed`);
    if (fail > 0) {
      console.error("FAILURES:\n  - " + failures.join("\n  - "));
      process.exit(1);
    }
    console.log("ALL VOICE-AI-SB-04 SESSION-BROKER CHECKS PASSED");
  })
  .catch((e) => {
    console.error("SUITE CRASH:", e && e.stack ? e.stack : e);
    process.exit(1);
  });
