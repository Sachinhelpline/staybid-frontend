// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — dedicated gateway configuration.
//
// Reads ONLY the planned env NAMES (values are never created here) and resolves
// a typed, FAIL-CLOSED config. The runtime gate activates ONLY on the exact
// string "1"; any other value (absent/empty/"0"/"true"/"yes"/whitespace) means
// DISABLED. Missing required security/provider config disables the relevant
// subsystem WITHOUT leaking any secret material.
//
// No secret VALUE is ever logged or returned — only booleans ("present") and the
// non-secret shape (model name, base URL host, limits).
// ─────────────────────────────────────────────────────────────────────────

export interface GatewayEnv {
  [k: string]: string | undefined;
}

export interface GatewayLimits {
  maxSessionMs: number;
  maxSpeechMsPerSession: number;
  maxUtteranceMs: number;
  idleTimeoutMs: number;
  activeSessionsPerSubject: number;
  activeSessionsPerIp: number;
  globalActiveSessions: number;
  anonStartsPer15Min: number;
  anonStartsPerDay: number;
  authStartsPer15Min: number;
  authStartsPerDay: number;
  toolCallsPerTurn: number;
  toolCallsPerSession: number;
  maxSearchResults: number;
  maxCompareHotels: number;
  providerConnectTimeoutMs: number;
  toolTimeoutMs: number;
  turnCompletionTimeoutMs: number;
  perSessionCostCeilingUsd: number;
  dailyCostCapUsd: number;
  monthlyCostCapUsd: number;
  controlTokenMaxAgeMs: number;
}

/** Conservative Strong-Beta defaults (SB-03). Overridable by env where sensible. */
export const DEFAULT_LIMITS: Readonly<GatewayLimits> = Object.freeze({
  maxSessionMs: 10 * 60_000,
  maxSpeechMsPerSession: 5 * 60_000,
  // R3 (owner control correction): the authoritative single-utterance ceiling is
  // ≤20s (matches the frozen SB-02 20s MediaRecorder bound) — NOT 30s.
  maxUtteranceMs: 20_000,
  idleTimeoutMs: 60_000,
  activeSessionsPerSubject: 1,
  activeSessionsPerIp: 2,
  globalActiveSessions: 25,
  anonStartsPer15Min: 3,
  anonStartsPerDay: 20,
  authStartsPer15Min: 5,
  authStartsPerDay: 30,
  toolCallsPerTurn: 2,
  toolCallsPerSession: 12,
  maxSearchResults: 10,
  maxCompareHotels: 3,
  providerConnectTimeoutMs: 5_000,
  toolTimeoutMs: 4_000,
  turnCompletionTimeoutMs: 12_000,
  perSessionCostCeilingUsd: 1.25,
  dailyCostCapUsd: 25,
  monthlyCostCapUsd: 250,
  controlTokenMaxAgeMs: 10 * 60_000,
});

export interface GatewayConfig {
  /** Runtime kill gate — true ONLY when VOICE_AI_RUNTIME_ENABLED === "1". */
  runtimeEnabled: boolean;
  // provider (values never exposed)
  openaiApiKeyPresent: boolean;
  openaiModel: string;
  openaiBaseUrl: string;
  // session-assertion verification
  signingPublicKey: string | null;
  issuer: string | null;
  audience: string | null;
  // control-token + kill-switch secrets (presence only in logs)
  controlTokenSecret: string | null;
  killSwitchSecret: string | null;
  // origin + privacy
  allowedOrigins: string[];
  ipHashSalt: string | null;
  // upstream StayBid read API base
  publicBaseUrl: string | null;
  limits: GatewayLimits;
}

function exactlyOne(v: string | undefined): boolean {
  return v === "1";
}

function nonEmpty(v: string | undefined): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol === "https:" || u.protocol === "http:") out.push(`${u.protocol}//${u.host}`);
    } catch {
      /* drop */
    }
  }
  return Array.from(new Set(out));
}

function num(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * R2 (SB04-R1-REREV-05B): resolve the OpenAI Realtime base URL FAIL-CLOSED.
 * An UNSET value ⇒ the safe canonical default. A SET value is accepted ONLY when
 * it is https, carries no embedded credentials, and points at the OpenAI API
 * origin (`api.openai.com` / `*.openai.com`) — never a loopback / private / cloud
 * metadata host. Anything else ⇒ "" so `providerConfigured` fails closed (an
 * attacker-set base URL can never redirect the server API key elsewhere). The
 * caller (transport) still adds `/calls` + the sideband path.
 */
const DEFAULT_OPENAI_REALTIME_BASE = "https://api.openai.com/v1/realtime";
/**
 * R4 (SB04-R3-REREV-05): the accepted env value must reduce to the EXACT reviewed
 * provider ORIGIN — never a caller-selected port/path/query/fragment. The reviewed
 * Realtime path (/v1/realtime) is constructed INTERNALLY; the env can only confirm
 * the origin (an empty path, "/", or exactly the reviewed base path are tolerated
 * as equivalent spellings of the same contract). Everything else ⇒ "" (fail closed):
 *   - non-https, userinfo, query, fragment;
 *   - any explicit port (the official API uses the default HTTPS port);
 *   - any host other than exactly api.openai.com;
 *   - any other pathname (no /evil, /v1/other, no path override).
 */
export function resolveOpenAiBaseUrl(raw: string | undefined): string {
  const v = nonEmpty(raw);
  if (!v) return DEFAULT_OPENAI_REALTIME_BASE;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "";
  }
  if (u.protocol !== "https:") return "";
  if (u.username || u.password) return "";
  if (u.search || u.hash) return "";
  if (u.port !== "") return ""; // default HTTPS port ONLY (443 explicit also rejected as non-canonical)
  if (u.hostname.toLowerCase() !== "api.openai.com") return "";
  const path = u.pathname.replace(/\/+$/, "");
  if (path !== "" && path !== "/v1/realtime") return ""; // no caller-selected API path
  // ALWAYS return the internally constructed reviewed base — never the env string.
  return DEFAULT_OPENAI_REALTIME_BASE;
}

/** A safe upstream base URL, or null (must be an absolute http(s) origin). */
function resolvePublicBase(raw: string | undefined): string | null {
  const v = nonEmpty(raw);
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname || u.username || u.password) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Exact-origin membership; a `*` allowlist is NEVER honored for auth surfaces. */
export function isAllowedOrigin(origin: unknown, allowlist: string[]): boolean {
  if (typeof origin !== "string" || !origin || allowlist.length === 0) return false;
  let normalized: string;
  try {
    const u = new URL(origin);
    normalized = `${u.protocol}//${u.host}`;
  } catch {
    return false;
  }
  return allowlist.includes(normalized);
}

export function loadGatewayConfig(env: GatewayEnv): GatewayConfig {
  const limits: GatewayLimits = {
    ...DEFAULT_LIMITS,
    globalActiveSessions: num(env.VOICE_AI_MAX_CONCURRENT_SESSIONS, DEFAULT_LIMITS.globalActiveSessions, 1, 1000),
    dailyCostCapUsd: num(env.VOICE_AI_DAILY_SPEND_LIMIT_USD, DEFAULT_LIMITS.dailyCostCapUsd, 0, 100000),
    monthlyCostCapUsd: num(env.VOICE_AI_MONTHLY_SPEND_LIMIT_USD, DEFAULT_LIMITS.monthlyCostCapUsd, 0, 1000000),
  };
  return {
    runtimeEnabled: exactlyOne(env.VOICE_AI_RUNTIME_ENABLED),
    openaiApiKeyPresent: Boolean(nonEmpty(env.OPENAI_API_KEY)),
    openaiModel: nonEmpty(env.OPENAI_REALTIME_MODEL) || "gpt-realtime-2.1",
    openaiBaseUrl: resolveOpenAiBaseUrl(env.OPENAI_REALTIME_BASE_URL),
    signingPublicKey: nonEmpty(env.VOICE_AI_SESSION_SIGNING_PUBLIC_KEY),
    issuer: nonEmpty(env.VOICE_AI_SESSION_ISSUER),
    audience: nonEmpty(env.VOICE_AI_SESSION_AUDIENCE),
    controlTokenSecret: nonEmpty(env.VOICE_AI_CONTROL_TOKEN_SECRET),
    killSwitchSecret: nonEmpty(env.VOICE_AI_KILL_SWITCH_HMAC_SECRET),
    allowedOrigins: parseOrigins(env.VOICE_AI_ALLOWED_ORIGINS),
    ipHashSalt: nonEmpty(env.VOICE_AI_IP_HASH_SALT),
    publicBaseUrl: resolvePublicBase(env.STAYBID_PUBLIC_BASE_URL),
    limits,
  };
}

/** Fail-closed: assertion verification is possible only with all three present. */
export function assertionVerifiable(c: GatewayConfig): boolean {
  return Boolean(c.signingPublicKey && c.issuer && c.audience);
}

/** Fail-closed: the control-token subsystem needs its HMAC secret. */
export function controlTokenConfigured(c: GatewayConfig): boolean {
  return Boolean(c.controlTokenSecret);
}

/** Fail-closed: the provider can be reached only with a key + a valid model/URL. */
export function providerConfigured(c: GatewayConfig): boolean {
  return Boolean(c.openaiApiKeyPresent && c.openaiModel && c.openaiBaseUrl);
}

/** Fail-closed: the whole session-create path requires ALL of these. */
export function sessionCreateConfigured(c: GatewayConfig): boolean {
  return (
    c.runtimeEnabled &&
    assertionVerifiable(c) &&
    controlTokenConfigured(c) &&
    providerConfigured(c) &&
    Boolean(c.ipHashSalt) &&
    c.allowedOrigins.length > 0 &&
    Boolean(c.publicBaseUrl)
  );
}

/** A non-secret config summary safe to log. NEVER includes any secret value. */
export function safeConfigSummary(c: GatewayConfig): Record<string, unknown> {
  return {
    runtimeEnabled: c.runtimeEnabled,
    openaiApiKeyPresent: c.openaiApiKeyPresent,
    openaiModel: c.openaiModel,
    assertionVerifiable: assertionVerifiable(c),
    controlTokenConfigured: controlTokenConfigured(c),
    providerConfigured: providerConfigured(c),
    allowedOriginCount: c.allowedOrigins.length,
    ipHashSaltPresent: Boolean(c.ipHashSalt),
    killSwitchConfigured: Boolean(c.killSwitchSecret),
    publicBaseUrlPresent: Boolean(c.publicBaseUrl),
    globalActiveSessions: c.limits.globalActiveSessions,
  };
}
