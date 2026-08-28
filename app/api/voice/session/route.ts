// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — same-origin Voice SESSION BROKER.
//
// POST /api/voice/session — the ONLY browser-reachable Voice session entry. It:
//   • accepts POST + application/json ONLY, with a bounded body;
//   • enforces a SAME-ORIGIN check using the platform request origin (never `*`,
//     never a caller-supplied allowlist env — SB04-SRC-REV-11);
//   • validates the WebRTC SDP offer (bounded, structural);
//   • resolves a STABLE, SIGNED, pseudonymous anonymous-browser identity from an
//     HttpOnly cookie (SB04-SRC-REV-04) — the same browser gets the same subject
//     across session starts until the cookie expires;
//   • mints a SHORT-LIVED (~60s), one-use, asymmetrically-signed (jose) assertion
//     bound to the gateway audience + issuer, carrying a READ-ONLY voice scope,
//     the broker-VALIDATED canonical origin (SB04-SRC-REV-02), and NO customer
//     token / provider credential;
//   • forwards ONLY the SDP + assertion to the FIXED, server-configured gateway
//     URL (no caller URL, no method override, no generic proxy);
//   • returns ONLY the bounded gateway response the browser needs.
//
// It NEVER exposes the OpenAI key, the gateway control-token secret, the signing
// private key, a customer token, or any provider config. It fails CLOSED (503)
// when the required server env is unset. The frontend Voice UI is separately
// gated by NEXT_PUBLIC_VOICE_AI_BETA === "1"; this route does NOT read/activate it.
//
// The broker reads ONLY the four approved server-only env NAMES
// (VOICE_AI_GATEWAY_URL / _SIGNING_PRIVATE_KEY / _ISSUER / _AUDIENCE); the origin
// ALLOWLIST is a GATEWAY-owned concern (VOICE_AI_ALLOWED_ORIGINS is read only by
// the gateway, which verifies the signed origin claim).
//
// AUTH SCOPE (honest limitation): SB-04 binds a stable ANONYMOUS pseudonymous
// identity only. It does NOT modify or depend on any existing customer-auth
// primitive. Binding an authenticated principal is a later, separate step.
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import {
  MAX_BROKER_BODY_BYTES,
  sanitizeVisibleHotelIds,
  AID_COOKIE_NAME,
  AID_TTL_SECONDS,
  buildAidCookie,
  readAidCookie,
  buildAssertionClaims,
  derivePseudonymousSubject,
  isBrokerConfigured,
  isSameOrigin,
  resolveCanonicalOrigin,
  resolveGatewaySessionsUrl,
  resolveGatewayWsBase,
  shapeBrokerResponse,
  validateSdpOffer,
  type BrokerEnv,
} from "@/lib/voice/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNING_ALG = "ES256";
const GATEWAY_FETCH_TIMEOUT_MS = 6_000;
// R4 (SB04-R3-REREV-07): the small explicit ceiling for the gateway→broker JSON
// response (session id + answer SDP ≤16KB + control token ≤4KB + booleans → 64KB
// is generous). Bodies over this are never fully accumulated.
const MAX_GATEWAY_RESPONSE_BYTES = 64 * 1024;

/** R4 (REREV-07): bounded, cancellable streamed read of an upstream Response body —
 *  incremental byte count against the cap, reader cancelled the instant the cap is
 *  crossed, UTF-8 decoded from bounded bytes. Returns null when over the cap. */
async function readBoundedResponseBody(resp: Response, maxBytes: number): Promise<string | null> {
  const body = resp.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let out = "";
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* no-op */
          }
          return null;
        }
        out += decoder.decode(value, { stream: true });
      }
    }
    out += decoder.decode();
    return out;
  }
  // Fallback (no stream body — e.g. a test fake): byte-gated text().
  const text = await resp.text();
  if (typeof text !== "string") return null;
  if (new TextEncoder().encode(text).length > maxBytes) return null;
  return text;
}

function readBrokerEnv(): BrokerEnv {
  return {
    VOICE_AI_GATEWAY_URL: process.env.VOICE_AI_GATEWAY_URL,
    VOICE_AI_SESSION_SIGNING_PRIVATE_KEY: process.env.VOICE_AI_SESSION_SIGNING_PRIVATE_KEY,
    VOICE_AI_SESSION_ISSUER: process.env.VOICE_AI_SESSION_ISSUER,
    VOICE_AI_SESSION_AUDIENCE: process.env.VOICE_AI_SESSION_AUDIENCE,
  };
}

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status });
}

/** HMAC key for the anonymous-identity cookie, DERIVED from the existing signing
 *  key material — no new secret env is introduced. */
function aidHmacHex(privateKeyPem: string): (body: string) => string {
  const key = createHash("sha256").update(`voice-aid:${privateKeyPem}`).digest();
  return (body: string) => createHmac("sha256", key).update(body).digest("hex");
}
function constantTimeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * R3 (SB04-R2-REREV-08A): read the request body BOUNDED by UTF-8 bytes via the
 * ReadableStream — incremental, byte-counted, aborted the instant the cap is
 * crossed (the reader is cancelled), so an oversized/chunked body is never fully
 * accumulated. Returns null when over the cap. Falls back to a byte-gated text()
 * only when no stream body is present (never for real oversized input).
 */
async function readBoundedRequestBody(req: Request, maxBytes: number): Promise<string | null> {
  const body = (req as unknown as { body?: ReadableStream<Uint8Array> | null }).body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let out = "";
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* no-op */
          }
          return null;
        }
        out += decoder.decode(value, { stream: true });
      }
    }
    out += decoder.decode();
    return out;
  }
  // Fallback (no stream body): a byte-gated text() read.
  const text = await req.text();
  if (typeof text !== "string") return null;
  if (new TextEncoder().encode(text).length > maxBytes) return null;
  return text;
}

export async function POST(req: Request): Promise<NextResponse> {
  // ---- content-type ----
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json\b/i.test(contentType)) {
    return json(415, { error: "unsupported_media_type" });
  }

  // ---- config (fail closed) ----
  const env = readBrokerEnv();
  if (!isBrokerConfigured(env)) return json(503, { error: "voice_unconfigured" });
  const gatewayUrl = resolveGatewaySessionsUrl(env);
  if (!gatewayUrl) return json(503, { error: "voice_unconfigured" });

  // ---- AUTHORITATIVE same-origin (R3 SB04-R2-REREV-06) — the ONLY origin gate.
  // The independent request-URL-origin / Host-reconstruction gate is REMOVED:
  // it could reject before the configured check and is proxy-/Host-influenced. The
  // browser Origin header is compared ONLY against the CANONICAL origin derived from
  // the EXISTING VOICE_AI_SESSION_ISSUER (URL.origin), which requires https in
  // production. A missing/unparseable/non-https issuer ⇒ fail closed 503. ----
  const origin = req.headers.get("origin");
  const canonicalOrigin = resolveCanonicalOrigin(env, { allowInsecure: process.env.NODE_ENV !== "production" });
  if (!canonicalOrigin) return json(503, { error: "voice_unconfigured" });
  if (!isSameOrigin(origin, canonicalOrigin)) {
    return json(403, { error: "origin_not_allowed" });
  }

  // ---- body — R3 (REREV-08A): BOUNDED STREAMED read, never req.text(). A
  // Content-Length over the cap is rejected before reading; the stream is read
  // incrementally with a running byte count and aborted the moment the cap is
  // crossed, so an oversized body is never fully accumulated. ----
  const clHeader = req.headers.get("content-length");
  if (clHeader && Number(clHeader) > MAX_BROKER_BODY_BYTES) return json(413, { error: "payload_too_large" });
  let raw: string | null;
  try {
    raw = await readBoundedRequestBody(req, MAX_BROKER_BODY_BYTES);
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (raw === null) return json(413, { error: "payload_too_large" });
  if (!raw) return json(400, { error: "bad_request" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_request" });
  }
  const sdp = validateSdpOffer((parsed as { sdp?: unknown } | null)?.sdp ?? null);
  if (!sdp) return json(400, { error: "invalid_sdp" });
  // R3 (REREV-10): sanitize the client's ordered visible-hotel-id list (shape only;
  // the gateway server-verifies each id). Never a URL/path/instruction.
  const visibleHotelIds = sanitizeVisibleHotelIds((parsed as { visibleHotelIds?: unknown } | null)?.visibleHotelIds);

  // ---- stable, signed anonymous identity (cookie) ----
  const privateKeyPem = env.VOICE_AI_SESSION_SIGNING_PRIVATE_KEY as string;
  const hmacHex = aidHmacHex(privateKeyPem);
  const nowSec = Math.floor(Date.now() / 1000);
  const cookieAid = readAidCookie(req.headers.get("cookie")?.match(new RegExp(`${AID_COOKIE_NAME}=([^;]+)`))?.[1] ?? null, nowSec, hmacHex, constantTimeEq);
  const aid = cookieAid?.aid || randomUUID();
  const mintedCookie = !cookieAid;
  const subject = derivePseudonymousSubject(aid, (input) => createHash("sha256").update(input).digest("hex"));

  // ---- mint the assertion (asymmetric; carries the validated origin; no PII) ----
  const claims = buildAssertionClaims({
    subject,
    issuer: env.VOICE_AI_SESSION_ISSUER as string,
    audience: env.VOICE_AI_SESSION_AUDIENCE as string,
    nowSec,
    jti: randomUUID(),
    authenticated: false,
    origin: canonicalOrigin,
  });
  let assertion: string;
  try {
    const key = await importPKCS8(privateKeyPem, SIGNING_ALG);
    assertion = await new SignJWT({ scope: claims.scope, auth: claims.auth, origin: claims.origin })
      .setProtectedHeader({ alg: SIGNING_ALG, typ: "JWT" })
      .setSubject(claims.sub)
      .setIssuer(claims.iss)
      .setAudience(claims.aud)
      .setIssuedAt(claims.iat)
      .setExpirationTime(claims.exp)
      .setJti(claims.jti)
      .sign(key);
  } catch {
    return json(503, { error: "voice_unconfigured" });
  }

  // ---- forward to the FIXED gateway URL (no caller URL/method/proxy) ----
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_FETCH_TIMEOUT_MS);
  let gatewayResp: Response;
  try {
    gatewayResp = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` },
      body: JSON.stringify({ sdp, authenticated: false, visibleHotelIds }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    clearTimeout(timer);
    return json(502, { error: "voice_gateway_unreachable" });
  }
  // R4 (SB04-R3-REREV-07): the gateway→broker response body is BOUNDED — never an
  // unbounded gatewayResp.json()/text(). The lifecycle deadline stays armed THROUGH
  // the body read (the abort controller cancels a stalled body reader); the body is
  // Content-Length prechecked, incrementally byte-counted against a small explicit
  // maximum, UTF-8 decoded from bounded bytes, and JSON-parsed only afterwards.
  if (!gatewayResp.ok) {
    clearTimeout(timer);
    const status = gatewayResp.status === 429 ? 429 : 502;
    return json(status, { error: "voice_gateway_error" });
  }
  const gwCl = gatewayResp.headers.get("content-length");
  if (gwCl && Number(gwCl) > MAX_GATEWAY_RESPONSE_BYTES) {
    clearTimeout(timer);
    return json(502, { error: "voice_gateway_error" });
  }
  let gatewayText: string | null;
  try {
    gatewayText = await new Promise<string | null>((resolve) => {
      let settled = false;
      const settle = (v: string | null) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      controller.signal.addEventListener("abort", () => settle(null), { once: true });
      readBoundedResponseBody(gatewayResp, MAX_GATEWAY_RESPONSE_BYTES)
        .then((v) => settle(v))
        .catch(() => settle(null));
    });
  } catch {
    gatewayText = null;
  } finally {
    clearTimeout(timer);
  }
  if (gatewayText === null || !gatewayText) return json(502, { error: "voice_gateway_error" });
  let gatewayBody: unknown;
  try {
    gatewayBody = JSON.parse(gatewayText);
  } catch {
    return json(502, { error: "voice_gateway_error" });
  }
  const shaped = shapeBrokerResponse(gatewayBody);
  if (!shaped) return json(502, { error: "voice_gateway_error" });

  const res = json(200, {
    sessionId: shaped.sessionId,
    answerSdp: shaped.answerSdp,
    controlToken: shaped.controlToken,
    controlPath: shaped.controlPath,
    controlWsBase: resolveGatewayWsBase(env),
    expiresInSeconds: shaped.expiresInSeconds,
    // R4 (REREV-10): the AUTHORITATIVE non-secret ordinal-capability boolean from
    // the gateway (true only after the acknowledged context install).
    ordinalContext: (gatewayBody as { ordinalContext?: unknown } | null)?.ordinalContext === true,
  });
  // Persist the stable anonymous identity (HttpOnly; Secure in production).
  if (mintedCookie) {
    res.cookies.set({
      name: AID_COOKIE_NAME,
      value: buildAidCookie(aid, nowSec, hmacHex),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/voice",
      maxAge: AID_TTL_SECONDS,
    });
  }
  return res;
}
