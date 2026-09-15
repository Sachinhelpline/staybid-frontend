// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — same-origin session broker (Next API route).
//
// The ONLY browser entry point. It:
//   • is FAIL-CLOSED behind the server B gate (LIVE_AI_BROKER_ENABLED === "1") and
//     the presence of ALL required server config (no secret is ever created here);
//   • validates the exact request body (mode + browser sessionId + bounded SDP);
//   • enforces the same-origin contract (exact canonical Origin + Sec-Fetch-Site);
//   • mints a ONE-USE, ~60s ES256 assertion with the EXACT live-ai:read-ui-local
//     scope and a SERVER-generated pseudonymous subject (the customer presentation
//     state never influences identity);
//   • forwards ONLY to the FIXED gateway path (no caller-selected host/provider/
//     endpoint/model/scope/role) and shapes the response down to a bounded allowlist
//     — a provider key can NEVER pass through, and the control token/URL are added
//     from server config.
//
// No secret VALUE appears in this file — env NAMES only.
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import {
  validateSessionRequest,
  isSameOrigin,
  buildAssertionClaims,
  shapeBrokerResponse,
  buildControlUrl,
  validateGatewayHttpsOrigin,
  GATEWAY_SESSIONS_PATH,
  MAX_BROKER_BODY_BYTES,
  ASSERTION_TTL_SEC,
  LIVE_AI_SCOPE,
} from "@/lib/live-ai/broker";

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
  // 1) B gate — fail closed.
  if (env.LIVE_AI_BROKER_ENABLED !== "1") return NextResponse.json({ error: "broker_disabled" }, { status: 503 });
  // 2) required config presence (zero work when unconfigured).
  const signingPrivateKey = nonEmpty(env.LIVE_AI_SESSION_SIGNING_PRIVATE_KEY);
  const issuer = nonEmpty(env.LIVE_AI_SESSION_ISSUER);
  const audience = nonEmpty(env.LIVE_AI_SESSION_AUDIENCE);
  const gatewayUrl = nonEmpty(env.LIVE_AI_GATEWAY_URL);
  const canonicalOrigin = firstOrigin(env.LIVE_AI_ALLOWED_ORIGINS);
  if (!signingPrivateKey || !issuer || !audience || !gatewayUrl || !canonicalOrigin) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }
  // REV-11 — canonicalize + validate the gateway target BEFORE any assertion is
  // minted/signed/forwarded. A malformed / unsafe LIVE_AI_GATEWAY_URL (http:, a
  // userinfo/path/query/fragment, a lookalike) fails closed here, so a signed bearer
  // assertion can never be sent to an unvalidated endpoint. Both the session-create
  // URL and the control URL are built from THIS validated origin.
  const gatewayOrigin = validateGatewayHttpsOrigin(gatewayUrl);
  if (!gatewayOrigin) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }
  // 3) same-origin contract.
  if (!isSameOrigin(req.headers.get("origin"), req.headers.get("sec-fetch-site"), canonicalOrigin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  // 4) bounded body + exact shape.
  let raw: string;
  try { raw = await req.text(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  if (!raw || raw.length > MAX_BROKER_BODY_BYTES) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const sessionReq = validateSessionRequest(parsed);
  if (!sessionReq) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // 5) one-use ~60s ES256 assertion (server-generated pseudonymous subject).
  const subject = "px." + randomUUID().replace(/-/g, "");
  const jti = randomUUID().replace(/-/g, "");
  const claims = buildAssertionClaims({ subject, jti, origin: canonicalOrigin });
  let assertion: string;
  try {
    const key = await importPKCS8(signingPrivateKey, "ES256");
    assertion = await new SignJWT({ scope: LIVE_AI_SCOPE, origin: claims.origin, auth: claims.auth })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(subject)
      .setJti(jti)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${ASSERTION_TTL_SEC}s`)
      .sign(key);
  } catch {
    return NextResponse.json({ error: "assertion_config_error" }, { status: 503 });
  }

  // 6) forward to the FIXED gateway path only (no caller-selected host/model).
  const gwBody = sessionReq.mode === "microphone"
    ? { mode: "microphone", sessionId: sessionReq.sessionId, sdp: sessionReq.offerSdp }
    : { mode: "text", sessionId: sessionReq.sessionId };
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

  // 7) bounded response — no provider key, control token + URL added from config.
  const out: Record<string, unknown> = {
    sessionId: shaped.sessionId,
    gatewaySessionId: shaped.gatewaySessionId,
    controlToken: shaped.controlToken,
    expiresInSeconds: shaped.expiresInSeconds,
    controlUrl,
  };
  if (shaped.answerSdp) out.answerSdp = shaped.answerSdp;
  return NextResponse.json(out, { status: 200, headers: { "cache-control": "no-store" } });
}
