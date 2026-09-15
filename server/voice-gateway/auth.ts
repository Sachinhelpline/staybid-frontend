// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — gateway authentication.
//
//   • Session ASSERTION verification (jose): asymmetric (ES256) signature against
//     the configured public key, with issuer + audience + expiry checks, a
//     read-only voice scope requirement, and ONE-USE jti replay rejection.
//   • Control-TOKEN mint + verify: an HMAC token bound to (sessionId, subject),
//     with a hard ≤10-minute lifetime, constant-time verification, carried in the
//     WebSocket subprotocol (never a query string).
//   • Kill-switch HMAC verify: constant-time, freshness-bounded, DISABLE-ONLY.
//
// Replay protection is single-process / in-memory (pruned) — a Strong-Beta ONE-
// replica constraint, NOT distributed. No secret/token/claim is ever logged.
// ─────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { jwtVerify, importSPKI, type JWTPayload } from "jose";
import { type GatewayConfig } from "./config";

const ASSERT_ALG = "ES256";
const CLOCK_TOLERANCE_SEC = 5;
const ASSERT_MAX_AGE_SEC = 120; // an assertion older than this is rejected outright

// The EXACT read-only scopes. voice:read is UNCHANGED; the Live-AI scope is a
// SEPARATE exact value — neither generalizes to "any scope".
export const VOICE_ASSERTION_SCOPE = "voice:read" as const;
export const LIVE_AI_ASSERTION_SCOPE = "live-ai:read-ui-local" as const;

export interface VerifiedAssertion {
  subject: string;
  jti: string;
  authenticated: boolean;
  /** The broker-validated canonical origin, carried as a signed claim. */
  origin: string;
}

export type AssertionResult =
  | { ok: true; assertion: VerifiedAssertion }
  | { ok: false; code: "assertion_unconfigured" | "assertion_invalid" | "assertion_replayed" | "assertion_scope" };

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function constantTimeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---- one-use jti replay store (in-memory, pruned) ---------------------------
export function createReplayStore(now: () => number = () => Date.now()) {
  const seen = new Map<string, number>(); // jti → exp (ms)
  function prune() {
    const t = now();
    const dead: string[] = [];
    seen.forEach((exp, jti) => {
      if (t >= exp) dead.push(jti);
    });
    dead.forEach((j) => seen.delete(j));
  }
  return {
    /** true if the jti is fresh (records it); false if already used. */
    consume(jti: string, expMs: number): boolean {
      prune();
      if (seen.has(jti)) return false;
      seen.set(jti, expMs);
      return true;
    },
    size: () => seen.size,
  };
}
export type ReplayStore = ReturnType<typeof createReplayStore>;

// ---- assertion verify -------------------------------------------------------
export interface AssertionAuthParams {
  signingPublicKey: string | null;
  issuer: string | null;
  audience: string | null;
  /** The EXACT scope required (never "any"). */
  expectedScope: string;
}

/** Core ES256 assertion verify against explicit params + an EXACT required scope. */
export async function verifyAssertionCore(
  token: string,
  params: AssertionAuthParams,
  replay: ReplayStore,
): Promise<AssertionResult> {
  if (!params.signingPublicKey || !params.issuer || !params.audience || !params.expectedScope) {
    return { ok: false, code: "assertion_unconfigured" };
  }
  if (typeof token !== "string" || !token || token.length > 8 * 1024) {
    return { ok: false, code: "assertion_invalid" };
  }
  let payload: JWTPayload;
  try {
    const key = await importSPKI(params.signingPublicKey, ASSERT_ALG);
    const res = await jwtVerify(token, key, {
      issuer: params.issuer,
      audience: params.audience,
      algorithms: [ASSERT_ALG],
      clockTolerance: CLOCK_TOLERANCE_SEC,
      maxTokenAge: ASSERT_MAX_AGE_SEC,
    });
    payload = res.payload;
  } catch {
    return { ok: false, code: "assertion_invalid" };
  }
  if (payload.scope !== params.expectedScope) return { ok: false, code: "assertion_scope" };
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  if (!sub || !jti) return { ok: false, code: "assertion_invalid" };
  const expMs = typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 60_000;
  if (!replay.consume(jti, expMs)) return { ok: false, code: "assertion_replayed" };
  const origin = typeof payload.origin === "string" ? payload.origin : "";
  return { ok: true, assertion: { subject: sub, jti, authenticated: payload.auth === true, origin } };
}

/** VOICE assertion — UNCHANGED behavior (exact "voice:read", voice config keys). */
export async function verifyAssertion(
  token: string,
  config: GatewayConfig,
  replay: ReplayStore,
): Promise<AssertionResult> {
  return verifyAssertionCore(token, {
    signingPublicKey: config.signingPublicKey,
    issuer: config.issuer,
    audience: config.audience,
    expectedScope: VOICE_ASSERTION_SCOPE,
  }, replay);
}

/** LIVE-AI assertion — the EXACT "live-ai:read-ui-local" scope + the Live-AI signing
 *  config. It can NEVER accept a voice:read token, and never an arbitrary scope. */
export async function verifyLiveAiAssertion(
  token: string,
  liveAiAuth: { signingPublicKey: string | null; issuer: string | null; audience: string | null },
  replay: ReplayStore,
): Promise<AssertionResult> {
  return verifyAssertionCore(token, {
    signingPublicKey: liveAiAuth.signingPublicKey,
    issuer: liveAiAuth.issuer,
    audience: liveAiAuth.audience,
    expectedScope: LIVE_AI_ASSERTION_SCOPE,
  }, replay);
}

// ---- control token (HMAC, bound to session+subject, ≤10min) -----------------
interface ControlTokenPayload {
  sid: string;
  sub: string;
  iat: number;
  exp: number;
  n: string;
}

export function mintControlTokenWithSecret(
  sessionId: string,
  subject: string,
  secret: string | null,
  maxAgeMs: number,
  now: () => number = () => Date.now(),
): string | null {
  if (!secret) return null;
  const t = now();
  const payload: ControlTokenPayload = {
    sid: sessionId,
    sub: subject,
    iat: t,
    exp: t + maxAgeMs,
    n: randomBytes(9).toString("hex"),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function mintControlToken(
  sessionId: string,
  subject: string,
  config: GatewayConfig,
  now: () => number = () => Date.now(),
): string | null {
  return mintControlTokenWithSecret(sessionId, subject, config.controlTokenSecret, config.limits.controlTokenMaxAgeMs, now);
}

export type ControlTokenResult =
  | { ok: true; sessionId: string; subject: string }
  | { ok: false; code: "control_unconfigured" | "control_invalid" | "control_expired" | "control_mismatch" };

export function verifyControlTokenWithSecret(
  token: unknown,
  expectSessionId: string,
  secret: string | null,
  maxAgeMs: number,
  now: () => number = () => Date.now(),
): ControlTokenResult {
  if (!secret) return { ok: false, code: "control_unconfigured" };
  if (typeof token !== "string" || !token || token.length > 4096) return { ok: false, code: "control_invalid" };
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, code: "control_invalid" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  if (!constantTimeEqualStr(sig, expected)) return { ok: false, code: "control_invalid" };
  let payload: ControlTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return { ok: false, code: "control_invalid" };
  }
  if (!payload || typeof payload.sid !== "string" || typeof payload.sub !== "string") {
    return { ok: false, code: "control_invalid" };
  }
  const t = now();
  // Hard lifetime cap, regardless of a forged longer exp.
  if (t - payload.iat > maxAgeMs || t >= payload.exp) {
    return { ok: false, code: "control_expired" };
  }
  if (payload.sid !== expectSessionId) return { ok: false, code: "control_mismatch" };
  return { ok: true, sessionId: payload.sid, subject: payload.sub };
}

export function verifyControlToken(
  token: unknown,
  expectSessionId: string,
  config: GatewayConfig,
  now: () => number = () => Date.now(),
): ControlTokenResult {
  return verifyControlTokenWithSecret(token, expectSessionId, config.controlTokenSecret, config.limits.controlTokenMaxAgeMs, now);
}

// ---- kill switch (HMAC, disable-only) ---------------------------------------
export type KillVerifyResult = { ok: true } | { ok: false; code: "kill_unconfigured" | "kill_invalid" | "kill_stale" };

const KILL_MAX_SKEW_MS = 60_000;

export function verifyKillRequestWithSecret(
  body: unknown,
  secret: string | null,
  now: () => number = () => Date.now(),
): KillVerifyResult {
  if (!secret) return { ok: false, code: "kill_unconfigured" };
  if (!body || typeof body !== "object") return { ok: false, code: "kill_invalid" };
  const b = body as Record<string, unknown>;
  const nonce = typeof b.nonce === "string" ? b.nonce : "";
  const ts = typeof b.ts === "number" ? b.ts : NaN;
  const sig = typeof b.sig === "string" ? b.sig : "";
  if (!nonce || !Number.isFinite(ts) || !sig) return { ok: false, code: "kill_invalid" };
  if (Math.abs(now() - ts) > KILL_MAX_SKEW_MS) return { ok: false, code: "kill_stale" };
  const expected = b64url(createHmac("sha256", secret).update(`${nonce}.${ts}`).digest());
  if (!constantTimeEqualStr(sig, expected)) return { ok: false, code: "kill_invalid" };
  return { ok: true };
}

export function verifyKillRequest(
  body: unknown,
  config: GatewayConfig,
  now: () => number = () => Date.now(),
): KillVerifyResult {
  return verifyKillRequestWithSecret(body, config.killSwitchSecret, now);
}
