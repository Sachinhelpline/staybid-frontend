// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — PURE session-broker logic.
//
// The decision + shaping logic behind POST /api/live-ai/session, with NO I/O of
// its own (the Next route performs the fetch + the ES256 sign). This module ONLY:
//   • validates the exact SessionRequest body (own-data, plain/null prototype,
//     bounded, no client-selected host/provider/endpoint/model/scope/role);
//   • enforces the same-origin contract (canonical origin + Sec-Fetch-Site);
//   • builds the fixed assertion CLAIMS — scope is ALWAYS the exact
//     "live-ai:read-ui-local", never caller-influenced; the customer presentation
//     state never changes the assertion identity (server-generated pseudonymous
//     subject);
//   • shapes the gateway response down to a bounded allowlist — a provider key can
//     NEVER pass through.
//
// PURE: no fetch/WebSocket/crypto/secret. The route injects subject/jti/now.
// ─────────────────────────────────────────────────────────────────────────
import { strictOwnDataRecord } from "./contracts";
import { isValidId } from "./protocol";

export const LIVE_AI_SCOPE = "live-ai:read-ui-local" as const;
export const MAX_BROKER_BODY_BYTES = 24 * 1024;
export const MAX_OFFER_SDP_BYTES = 20 * 1024;
export const MAX_ANSWER_SDP_BYTES = 20 * 1024;
export const ASSERTION_TTL_SEC = 60;
/** The ONLY gateway path the broker forwards to (fixed; never caller-selected). */
export const GATEWAY_SESSIONS_PATH = "/v1/live-ai/sessions";

export type SessionRequest =
  | { mode: "text"; sessionId: string }
  | { mode: "microphone"; sessionId: string; offerSdp: string };

function bounded(v: unknown, maxBytes: number): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  // SDP is ASCII; a length cap in code units is a safe upper bound on bytes.
  if (v.length > maxBytes) return null;
  return v;
}

/** Validate the exact request body → frozen SessionRequest, or null. */
export function validateSessionRequest(body: unknown): SessionRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const modeDesc = Object.getOwnPropertyDescriptor(body, "mode");
  if (!modeDesc || !("value" in modeDesc) || typeof modeDesc.get === "function") return null;
  const mode = modeDesc.value;
  if (mode === "text") {
    const a = strictOwnDataRecord(body, ["mode", "sessionId"]);
    if (!a || !isValidId(a.sessionId)) return null;
    return Object.freeze({ mode: "text", sessionId: a.sessionId as string });
  }
  if (mode === "microphone") {
    const a = strictOwnDataRecord(body, ["mode", "sessionId", "offerSdp"]);
    if (!a || !isValidId(a.sessionId)) return null;
    const offerSdp = bounded(a.offerSdp, MAX_OFFER_SDP_BYTES);
    if (offerSdp === null) return null;
    return Object.freeze({ mode: "microphone", sessionId: a.sessionId as string, offerSdp });
  }
  return null;
}

/** True only when the request is genuinely same-origin against the canonical origin. */
export function isSameOrigin(origin: unknown, secFetchSite: unknown, canonicalOrigin: string): boolean {
  if (!canonicalOrigin) return false;
  if (typeof origin !== "string" || origin !== canonicalOrigin) return false;
  // Sec-Fetch-Site, when present, MUST be same-origin. (Absence is tolerated only
  // for user agents that omit it; the exact Origin match above is the hard gate.)
  if (secFetchSite !== undefined && secFetchSite !== null && secFetchSite !== "same-origin") return false;
  return true;
}

/** The custom assertion claims the route signs (iss/aud/exp/iat added by jose). */
export interface AssertionClaims {
  scope: typeof LIVE_AI_SCOPE;
  sub: string;
  jti: string;
  origin: string;
  auth: boolean;
}
/**
 * Build the fixed assertion claims. Scope is ALWAYS the exact Live-AI read-ui-local
 * scope. `auth` is ALWAYS false in this slice — there is no server-trusted customer
 * identity yet, so the presentation role never elevates the assertion.
 */
export function buildAssertionClaims(input: { subject: string; jti: string; origin: string }): AssertionClaims {
  return Object.freeze({
    scope: LIVE_AI_SCOPE,
    sub: input.subject,
    jti: input.jti,
    origin: input.origin,
    auth: false,
  });
}

/** The bounded broker response returned to the browser (no provider key, ever). */
export interface BrokerResponse {
  sessionId: string;
  gatewaySessionId: string;
  controlToken: string;
  expiresInSeconds: number;
  answerSdp?: string;
}
/** Shape + bound the gateway's session-create JSON to the allowlist, or null. */
export function shapeBrokerResponse(gatewayJson: unknown): BrokerResponse | null {
  if (!gatewayJson || typeof gatewayJson !== "object" || Array.isArray(gatewayJson)) return null;
  const g = gatewayJson as Record<string, unknown>;
  if (!isValidId(g.sessionId) || !isValidId(g.gatewaySessionId)) return null;
  if (typeof g.controlToken !== "string" || !g.controlToken || g.controlToken.length > 4096) return null;
  const expiresInSeconds = typeof g.expiresInSeconds === "number" && Number.isFinite(g.expiresInSeconds) && g.expiresInSeconds >= 0 && g.expiresInSeconds <= 3600
    ? Math.floor(g.expiresInSeconds) : null;
  if (expiresInSeconds === null) return null;
  const out: BrokerResponse = {
    sessionId: g.sessionId as string,
    gatewaySessionId: g.gatewaySessionId as string,
    controlToken: g.controlToken,
    expiresInSeconds,
  };
  if (g.answerSdp !== undefined) {
    const answerSdp = bounded(g.answerSdp, MAX_ANSWER_SDP_BYTES);
    if (answerSdp === null) return null;
    out.answerSdp = answerSdp;
  }
  return Object.freeze(out);
}

/**
 * REV-11 — validate the SERVER-configured gateway base to a CANONICAL HTTPS origin
 * BEFORE any assertion is minted / signed / forwarded. The base must be exactly
 * `https://host[:port]` with NO userinfo, NO path (other than "/"), NO query, and NO
 * fragment; anything else (http:, javascript:, a lookalike with userinfo, an embedded
 * path/query/fragment, a malformed URL) returns null, so the route fails closed and a
 * bearer assertion is NEVER sent to an unvalidated / attacker-shaped target.
 * Returns the bare `https://host` origin the route builds BOTH the session-create URL
 * and the control URL from.
 */
export function validateGatewayHttpsOrigin(gatewayBaseUrl: unknown): string | null {
  if (typeof gatewayBaseUrl !== "string" || !gatewayBaseUrl || gatewayBaseUrl.length > 2048) return null;
  let u: URL;
  try { u = new URL(gatewayBaseUrl); } catch { return null; }
  if (u.protocol !== "https:") return null;                 // never http:/ws:/javascript:/data:
  if (u.username || u.password) return null;                // no userinfo
  if (u.search || u.hash) return null;                      // no query / fragment
  if (u.pathname && u.pathname !== "/") return null;        // origin only — no path confusion
  if (!u.host) return null;
  return `https://${u.host}`;
}

/**
 * Build the authenticated control-socket URL from the SERVER-configured gateway
 * base (never a client value). The base must be wss:// (or https://, upgraded to
 * wss) with no credentials/query/fragment; the gatewaySessionId must be a valid id.
 * Returns null on any violation, so a misconfigured base fails closed.
 */
export function buildControlUrl(gatewayBaseUrl: string, gatewaySessionId: string): string | null {
  if (!isValidId(gatewaySessionId)) return null;
  let u: URL;
  try {
    u = new URL(gatewayBaseUrl);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  let scheme: string;
  if (u.protocol === "wss:") scheme = "wss:";
  else if (u.protocol === "https:") scheme = "wss:";
  else return null; // never ws:// / http:// for a live control channel
  const host = u.host;
  if (!host) return null;
  return `${scheme}//${host}/v1/live-ai/sessions/${encodeURIComponent(gatewaySessionId)}/control`;
}
