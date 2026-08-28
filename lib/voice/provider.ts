// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — provider abstraction + session-broker
// pure helpers.
//
// TWO responsibilities, both PURE (no I/O, no React, no next/*, no jose, no node
// builtins) so this module compiles inside the SB-01/SB-02 isolated test harness
// AND is reused by the same-origin Next.js session broker route (server) and the
// SB-04 provider/broker suites:
//
//   (A) VoiceProvider — a provider-NEUTRAL typed capability boundary. A realtime
//       provider is reached ONLY through this interface, so provider event objects
//       never leak into SB-01 business-policy code. SB-04 ships only the
//       fail-closed nullVoiceProvider — there is NO real provider here.
//
//   (B) Session-broker pure helpers — origin allowlist, SDP-offer validation,
//       pseudonymous-subject derivation (hash injected), the Vercel→gateway
//       assertion CLAIMS builder (read-only scope, ~60s expiry, NO PII), and the
//       bounded gateway→browser response shaper. The route supplies jose + node
//       crypto + env; this module supplies only bounded, testable data logic.
//
// There is deliberately NO url/method/provider-key/tool field on any request or
// response shape a caller can influence. Everything fails CLOSED.
// ─────────────────────────────────────────────────────────────────────────
import { type CapabilityName } from "./contracts";
import { type VoiceUiAction } from "./contracts";

// ═══════════════════════════════════════════════════════════════════════════
// (A) Provider-neutral capability boundary.
// ═══════════════════════════════════════════════════════════════════════════

/** A single normalized tool run handed back to the provider for its next step. */
export interface ProviderToolRun {
  capability: CapabilityName | string;
  ok: boolean;
  reason?: string;
  count?: number;
}

/** What a provider turn can yield — a CLOSED, provider-neutral union. */
export type ProviderTurnResult =
  | { kind: "answer" | "clarify"; text: string }
  | { kind: "capability"; capability: CapabilityName; input: Record<string, unknown> }
  | { kind: "ui_action"; action: VoiceUiAction }
  | { kind: "error"; code: string };

/**
 * The provider-neutral runtime a future packet implements (a realtime provider).
 * SB-04 defines the seam only; the concrete provider wiring lives behind it in
 * the native WebRTC media client (browser) + the gateway provider modules.
 */
export interface VoiceProvider {
  /** Stable provider id for telemetry (never a credential / endpoint). */
  readonly id: string;
  /** Whether this provider is actually usable (config present). SB-04: false. */
  isAvailable(): boolean;
}

/** The ONLY provider SB-04 ships — never available, never fabricates output. */
export const nullVoiceProvider: VoiceProvider = Object.freeze({
  id: "null",
  isAvailable() {
    return false;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// (B) Session-broker pure helpers.
// ═══════════════════════════════════════════════════════════════════════════

/** Fixed byte ceiling for an inbound WebRTC SDP offer at the broker. */
export const MAX_SDP_OFFER_BYTES = 16 * 1024;
/** Fixed byte ceiling for the JSON request body at the broker. */
export const MAX_BROKER_BODY_BYTES = 24 * 1024;
/** Assertion lifetime — short, one-use (seconds). */
export const ASSERTION_TTL_SECONDS = 60;
/** Read-only Voice scope carried in the assertion (never a write scope). */
export const VOICE_ASSERTION_SCOPE = "voice:read" as const;

/** Env NAMES the broker reads (server-only; values are NEVER created here). */
export const BROKER_ENV = Object.freeze({
  gatewayUrl: "VOICE_AI_GATEWAY_URL",
  signingPrivateKey: "VOICE_AI_SESSION_SIGNING_PRIVATE_KEY",
  issuer: "VOICE_AI_SESSION_ISSUER",
  audience: "VOICE_AI_SESSION_AUDIENCE",
});

export interface BrokerEnv {
  VOICE_AI_GATEWAY_URL?: string;
  VOICE_AI_SESSION_SIGNING_PRIVATE_KEY?: string;
  VOICE_AI_SESSION_ISSUER?: string;
  VOICE_AI_SESSION_AUDIENCE?: string;
}

/** Fail-closed: the broker is configured only when EVERY required name is set. */
export function isBrokerConfigured(env: BrokerEnv): boolean {
  return Boolean(
    env.VOICE_AI_GATEWAY_URL &&
      env.VOICE_AI_SESSION_SIGNING_PRIVATE_KEY &&
      env.VOICE_AI_SESSION_ISSUER &&
      env.VOICE_AI_SESSION_AUDIENCE,
  );
}

/**
 * A parsed, fixed gateway sessions endpoint derived ONLY from server config.
 * Returns null unless the configured URL is an absolute https:// origin with no
 * credentials — the caller can NEVER supply or override it.
 */
export function resolveGatewaySessionsUrl(env: BrokerEnv): string | null {
  const raw = env.VOICE_AI_GATEWAY_URL;
  if (typeof raw !== "string" || !raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  // Only https (a Railway gateway), no credentials, non-empty host.
  if (u.protocol !== "https:") return null;
  if (!u.hostname || u.username || u.password) return null;
  // Fixed path — the caller never chooses it.
  const base = `${u.protocol}//${u.host}`;
  return `${base}/v1/voice/sessions`;
}

// ---- origin allowlist -------------------------------------------------------
/** Parse a comma/space separated allowed-origin list; drops malformed entries. */
export function parseAllowedOrigins(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const out: string[] = [];
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      // Store the canonical scheme+host origin (no path/query).
      out.push(`${u.protocol}//${u.host}`);
    } catch {
      /* drop malformed */
    }
  }
  return Array.from(new Set(out));
}

/** Exact-origin membership; a `*` allowlist is NEVER honored for auth surfaces. */
export function isAllowedOrigin(origin: unknown, allowlist: string[]): boolean {
  if (typeof origin !== "string" || !origin) return false;
  if (allowlist.length === 0) return false;
  let normalized: string;
  try {
    const u = new URL(origin);
    normalized = `${u.protocol}//${u.host}`;
  } catch {
    return false;
  }
  return allowlist.includes(normalized);
}

// R2 (SB04-R1-REREV-06): bound UNTRUSTED input by UTF-8 BYTES, not UTF-16 code
// units. TextEncoder is available in BOTH the browser bundle and the Node broker,
// so this stays a pure, dependency-free helper (no Node Buffer).
const SB_UTF8 = new TextEncoder();
export function utf8Bytes(s: string): number {
  return SB_UTF8.encode(s).length;
}

// R3 (SB04-R2-REREV-10): bound + validate a client-supplied ordered visible-hotel-id
// list before forwarding it to the gateway — ≤24, valid id syntax only, deduplicated,
// ORDER preserved. This is SHAPE validation only; the gateway independently
// server-verifies each id (the browser list is never trusted as authority).
export const MAX_VISIBLE_CONTEXT_IDS = 24;
export function sanitizeVisibleHotelIds(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of x) {
    if (typeof v !== "string" || !v || v.length > 64 || !/^[A-Za-z0-9_-]+$/.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_VISIBLE_CONTEXT_IDS) break;
  }
  return out;
}

// ---- SDP-offer validation ---------------------------------------------------
/** A minimal, bounded SDP-offer validator (structure + size only, never fetch). */
export function validateSdpOffer(x: unknown, maxBytes = MAX_SDP_OFFER_BYTES): string | null {
  if (typeof x !== "string") return null;
  if (!x || utf8Bytes(x) > maxBytes) return null;
  // A WebRTC offer begins with a version line; require the minimal SDP markers.
  if (!/^v=0/m.test(x)) return null;
  if (!/^m=audio /m.test(x)) return null;
  // No control chars beyond CR/LF/TAB.
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return null;
  }
  return x;
}

// ---- signed stable anonymous-browser identity (SB04-SRC-REV-04) -------------
// A pseudonymous anonymous id, signed with an HMAC derived from EXISTING server
// key material (no new credential env), stored in an HttpOnly cookie with a bounded
// lifetime. The same browser gets the SAME subject across session starts until
// the cookie expires/rotates; a different browser is isolated. No PII, no raw IP,
// no account/provider credential. Crypto is INJECTED so this module stays pure.
export const AID_COOKIE_NAME = "sb_voice_aid";
export const AID_TTL_SECONDS = 30 * 60; // bounded lifetime

/** Build the signed cookie value: `<urlencoded {aid,exp} json>.<hmac hex>`. */
export function buildAidCookie(aid: string, nowSec: number, hmacHex: (body: string) => string): string {
  const body = encodeURIComponent(JSON.stringify({ aid, exp: nowSec + AID_TTL_SECONDS }));
  return `${body}.${hmacHex(body)}`;
}

/**
 * Verify + parse the signed cookie, or null. `hmacHex` recomputes the signature;
 * `eq` is an injected CONSTANT-TIME comparator (the route supplies a
 * timingSafeEqual-based one). Fails closed on a bad signature, malformed body, or
 * expiry.
 */
export function readAidCookie(
  cookieValue: unknown,
  nowSec: number,
  hmacHex: (body: string) => string,
  eq: (a: string, b: string) => boolean,
): { aid: string } | null {
  if (typeof cookieValue !== "string" || !cookieValue || cookieValue.length > 4096) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!eq(sig, hmacHex(body))) return null;
  let payload: { aid?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(decodeURIComponent(body));
  } catch {
    return null;
  }
  if (!payload || typeof payload.aid !== "string" || !payload.aid || payload.aid.length > 128) return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  return { aid: payload.aid };
}

// ---- pseudonymous subject derivation ---------------------------------------
/**
 * Derive a pseudonymous, non-reversible Voice subject. NEVER an email/phone/raw
 * id — the caller passes a stable seed (e.g. an authenticated principal id or an
 * anonymous per-request nonce) + an injected hex hash; only the hash is kept.
 */
export function derivePseudonymousSubject(
  seed: string,
  hashHex: (input: string) => string,
): string {
  const digest = hashHex(`voice-subject:${seed}`);
  return `vsub_${digest.slice(0, 40)}`;
}

// ---- assertion CLAIMS builder ----------------------------------------------
export interface AssertionInput {
  subject: string; // pseudonymous only
  issuer: string;
  audience: string;
  nowSec: number;
  jti: string;
  authenticated: boolean;
  /** The broker-VALIDATED canonical browser origin (bound so it can't be
   *  substituted between broker and gateway). */
  origin: string;
}

export interface AssertionClaims {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  scope: typeof VOICE_ASSERTION_SCOPE;
  auth: boolean;
  origin: string;
}

/**
 * Build the exact claim set the Vercel→gateway assertion carries. Read-only
 * scope, ~60s expiry, one-use jti, pseudonymous subject, and the broker-validated
 * canonical origin (SB04-SRC-REV-02) — and DELIBERATELY no email / phone /
 * Firebase / Supabase / refresh token / provider credential.
 */
export function buildAssertionClaims(input: AssertionInput): AssertionClaims {
  return {
    sub: input.subject,
    iss: input.issuer,
    aud: input.audience,
    iat: input.nowSec,
    exp: input.nowSec + ASSERTION_TTL_SECONDS,
    jti: input.jti,
    scope: VOICE_ASSERTION_SCOPE,
    auth: input.authenticated,
    origin: input.origin,
  };
}

/** Same-origin check for the broker (platform request origin vs browser Origin). */
export function isSameOrigin(origin: unknown, selfOrigin: string): boolean {
  if (typeof origin !== "string" || !origin || !selfOrigin) return false;
  try {
    const a = new URL(origin);
    const b = new URL(selfOrigin);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

/**
 * R2 (SB04-R1-REREV-05A): the CANONICAL broker origin — derived from the EXISTING,
 * server-configured `VOICE_AI_SESSION_ISSUER` (which by design IS the site origin,
 * e.g. https://staybids.in). This gives the same-origin check a TRUSTED, configured
 * anchor instead of the proxy-/Host-influenced `req.url` origin, WITHOUT introducing
 * a new env var (no scope expansion). Returns the `protocol//host` origin when the
 * issuer parses as an absolute http(s) URL, else null (⇒ broker fails closed 503).
 */
export function resolveCanonicalOrigin(env: BrokerEnv, opts?: { allowInsecure?: boolean }): string | null {
  const raw = env.VOICE_AI_SESSION_ISSUER;
  if (typeof raw !== "string" || !raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  // R3 (SB04-R2-REREV-06): reject credentials/userinfo and non-http(s) schemes; use
  // ONLY URL.origin as the browser-origin authority (never path/query/fragment).
  if (!u.host || u.username || u.password) return null;
  const isLoopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1" || u.hostname === "[::1]";
  if (u.protocol === "https:") return u.origin;
  // R4 (SB04-R3-REREV-12): HTTPS for every non-loopback host in EVERY mode. HTTP is
  // permitted ONLY when BOTH the explicit dev/test insecure option is enabled AND
  // the hostname is loopback — an arbitrary dev/staging hostname is never safe HTTP,
  // and loopback without the explicit opt-in is also rejected.
  if (u.protocol === "http:" && opts?.allowInsecure === true && isLoopback) return u.origin;
  return null;
}

// ---- bounded gateway→browser response shaping ------------------------------
export interface BrokerClientResponse {
  sessionId: string;
  answerSdp: string;
  controlToken: string;
  controlPath: string; // relative gateway path — the browser never sees the key
  /** Absolute wss:// gateway origin for the control socket (a public host). */
  controlWsBase?: string;
  expiresInSeconds: number;
}

/** Derive the wss:// control-socket base from the configured https gateway URL. */
export function resolveGatewayWsBase(env: BrokerEnv): string | null {
  const raw = env.VOICE_AI_GATEWAY_URL;
  if (typeof raw !== "string" || !raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!u.hostname || u.username || u.password) return null;
  return `wss://${u.host}`;
}

/** A hotel id / session id shape the broker will echo to the browser. */
function isBoundedToken(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/**
 * Shape the gateway's session-create response into the bounded envelope the
 * browser receives. Returns null (fail closed) if the gateway response is
 * missing/oversized/malformed — the broker then returns a generic error and
 * NEVER leaks provider internals.
 */
export function shapeBrokerResponse(gatewayResp: unknown): BrokerClientResponse | null {
  if (!gatewayResp || typeof gatewayResp !== "object") return null;
  const g = gatewayResp as Record<string, unknown>;
  if (!isBoundedToken(g.sessionId, 128)) return null;
  // R2 (REREV-06): the untrusted gateway answer SDP is bounded by UTF-8 BYTES.
  if (typeof g.answerSdp !== "string" || !g.answerSdp || utf8Bytes(g.answerSdp) > MAX_SDP_OFFER_BYTES) return null;
  if (!/^v=0/m.test(g.answerSdp)) return null;
  if (!isBoundedToken(g.controlToken, 4096)) return null;
  const expiresInSeconds =
    Number.isFinite(g.expiresInSeconds) && (g.expiresInSeconds as number) > 0
      ? Math.min(Math.floor(g.expiresInSeconds as number), 600)
      : 600;
  return {
    sessionId: g.sessionId,
    answerSdp: g.answerSdp,
    controlToken: g.controlToken,
    controlPath: `/v1/voice/sessions/${encodeURIComponent(g.sessionId)}/control`,
    expiresInSeconds,
  };
}
