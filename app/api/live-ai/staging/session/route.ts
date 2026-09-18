// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-03B — ISOLATED internal STAGING session broker.
//
// A SEPARATE, admin-only entry point that runs ALONGSIDE the normal customer
// broker (app/api/live-ai/session/route.ts) WITHOUT changing it. The customer
// broker stays server-random `px.*` + auth:false, forever. This route is the ONLY
// place a `auth:true` Live-AI assertion is minted, and it is minted ONLY for
// exactly ONE configured staging operator, proven by a VERIFIED admin identity.
//
// It:
//   • is FAIL-CLOSED behind the dedicated staging broker gate
//     (LIVE_AI_03B_STAGING_BROKER_ENABLED === "1") + a single configured operator
//     subject (LIVE_AI_03B_STAGING_OPERATOR_SUBJECT) + the dedicated derivation
//     secret (LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET) — plus the SAME session
//     signing / gateway / origin config the customer broker requires;
//   • enforces the same-origin contract (exact canonical Origin + Sec-Fetch-Site);
//   • requires a Bearer-ONLY admin transport (an `x-admin-token`-only request must
//     NOT authorize this route; a conflicting pair fails closed) BEFORE it runs the
//     ordinary requireVerifiedAdmin gate;
//   • derives a STABLE, OPAQUE staging subject from the VERIFIED admin id ONLY
//     (dedicated HMAC secret, domain-separated, `stg1.` prefix — the raw admin id
//     is never exposed) and admits ONLY when it exactly matches the single
//     configured operator subject;
//   • validates the exact request body but accepts TEXT mode ONLY (no microphone /
//     SDP / voice on this staging surface);
//   • mints a ONE-USE, ~60s ES256 assertion with the EXACT live-ai:read-ui-local
//     scope and `auth:true`, subject = the derived staging subject, and forwards
//     ONLY to the FIXED gateway path — shaping the response down to the same bounded
//     allowlist as the customer broker (a provider key can NEVER pass through).
//
// No secret VALUE appears in this file — env NAMES only.
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import {
  validateSessionRequest,
  isSameOrigin,
  shapeBrokerResponse,
  buildControlUrl,
  validateGatewayHttpsOrigin,
  GATEWAY_SESSIONS_PATH,
  MAX_BROKER_BODY_BYTES,
  ASSERTION_TTL_SEC,
  LIVE_AI_SCOPE,
} from "@/lib/live-ai/broker";
import {
  decideStagingSession,
  extractStagingAdminBearer,
  resolveStagingOperatorSubject,
  type StagingBrokerConfig,
} from "@/lib/live-ai/staging-authority";
import { requireVerifiedAdmin } from "@/lib/admin/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nonEmpty(v: string | undefined): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function firstOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.trim();
    if (!t) continue;
    try { const u = new URL(t); if (u.protocol === "https:" || u.protocol === "http:") return `${u.protocol}//${u.host}`; } catch { /* skip */ }
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const env = process.env;
  // 1) staging broker gate — fail closed. This is a SEPARATE flag from the
  //    customer LIVE_AI_BROKER_ENABLED; the two brokers are enabled independently.
  if (env.LIVE_AI_03B_STAGING_BROKER_ENABLED !== "1") {
    return NextResponse.json({ error: "staging_broker_disabled" }, { status: 503 });
  }
  // 2) dedicated staging config: exactly ONE operator subject + the derivation
  //    secret must be present (values are never created here).
  const operatorSubject = resolveStagingOperatorSubject(env.LIVE_AI_03B_STAGING_OPERATOR_SUBJECT);
  const derivationSecret = nonEmpty(env.LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET);
  const brokerConfig: StagingBrokerConfig = {
    brokerEnabled: true,
    operatorSubject,
    hmacSecretPresent: !!derivationSecret,
  };

  // 3) shared session signing / gateway / origin config presence (same contract as
  //    the customer broker — reuse, never fork).
  const signingPrivateKey = nonEmpty(env.LIVE_AI_SESSION_SIGNING_PRIVATE_KEY);
  const issuer = nonEmpty(env.LIVE_AI_SESSION_ISSUER);
  const audience = nonEmpty(env.LIVE_AI_SESSION_AUDIENCE);
  const gatewayUrl = nonEmpty(env.LIVE_AI_GATEWAY_URL);
  const canonicalOrigin = firstOrigin(env.LIVE_AI_ALLOWED_ORIGINS);
  if (!signingPrivateKey || !issuer || !audience || !gatewayUrl || !canonicalOrigin) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }
  // Canonicalize + validate the gateway target BEFORE any assertion is minted.
  const gatewayOrigin = validateGatewayHttpsOrigin(gatewayUrl);
  if (!gatewayOrigin) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }
  // 4) same-origin contract.
  if (!isSameOrigin(req.headers.get("origin"), req.headers.get("sec-fetch-site"), canonicalOrigin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  // 5) composed staging authority decision (Bearer-only transport → requireVerifiedAdmin
  //    → derive opaque subject → exact single-operator match). The FULL chain is in the
  //    pure, hermetically-tested lib helper; the route only supplies the transport (from
  //    the request headers) and the bound admin verifier.
  const transport = extractStagingAdminBearer({
    authorization: req.headers.get("authorization"),
    xAdminToken: req.headers.get("x-admin-token"),
  });
  const decision = await decideStagingSession({
    brokerConfig,
    derivationSecret,
    transport,
    verifyAdmin: () => requireVerifiedAdmin(req),
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  // 6) bounded body + exact shape — TEXT ONLY on this staging surface.
  let raw: string;
  try { raw = await req.text(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  if (!raw || raw.length > MAX_BROKER_BODY_BYTES) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const sessionReq = validateSessionRequest(parsed);
  if (!sessionReq || sessionReq.mode !== "text") {
    // microphone / voice / SDP is never accepted on the staging text surface.
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 7) one-use ~60s ES256 assertion — auth:true, subject = the derived staging subject.
  //    This is the ONLY place auth:true is minted; the subject is NEVER the raw admin id.
  const jti = randomUUID().replace(/-/g, "");
  let assertion: string;
  try {
    const key = await importPKCS8(signingPrivateKey, "ES256");
    assertion = await new SignJWT({ scope: LIVE_AI_SCOPE, origin: canonicalOrigin, auth: true })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(decision.subject)
      .setJti(jti)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${ASSERTION_TTL_SEC}s`)
      .sign(key);
  } catch {
    return NextResponse.json({ error: "assertion_config_error" }, { status: 503 });
  }

  // 8) forward to the FIXED gateway path only (no caller-selected host/model) — TEXT.
  const gwBody = { mode: "text", sessionId: sessionReq.sessionId };
  let gwRes: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      gwRes = await fetch(gatewayOrigin + GATEWAY_SESSIONS_PATH, {
        method: "POST",
        headers: { authorization: `Bearer ${assertion}`, "content-type": "application/json" },
        body: JSON.stringify(gwBody),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return NextResponse.json({ error: "gateway_unavailable" }, { status: 502 });
  }
  if (!gwRes.ok) {
    const status = gwRes.status === 429 ? 429 : gwRes.status === 503 ? 503 : 502;
    return NextResponse.json({ error: "gateway_unavailable" }, { status });
  }
  let gwJson: unknown;
  try { gwJson = await gwRes.json(); } catch { return NextResponse.json({ error: "invalid_gateway_response" }, { status: 502 }); }
  const shaped = shapeBrokerResponse(gwJson);
  if (!shaped) return NextResponse.json({ error: "invalid_gateway_response" }, { status: 502 });
  const controlUrl = buildControlUrl(gatewayOrigin, shaped.gatewaySessionId);
  if (!controlUrl) return NextResponse.json({ error: "invalid_gateway_response" }, { status: 502 });

  // 9) bounded response — no provider key, control token + URL added from config.
  const out: Record<string, unknown> = {
    sessionId: shaped.sessionId,
    gatewaySessionId: shaped.gatewaySessionId,
    controlToken: shaped.controlToken,
    expiresInSeconds: shaped.expiresInSeconds,
    controlUrl,
  };
  return NextResponse.json(out, { status: 200, headers: { "cache-control": "no-store" } });
}
