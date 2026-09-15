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
  // LIVE-AI-02A: the isolated, independently fail-closed Live-AI sub-config.
  liveAi: LiveAiConfig;
}

// ── LIVE-AI-02A nested config (SOURCE allowlists only; no value is ever created) ──
/** The SINGLETON source model allowlists. A configured value MUST equal these; any
 *  other value DISABLES the provider (fail closed). Unset ⇒ the constant. */
export const LIVE_AI_STT_MODEL = "gpt-live-transcribe" as const;
export const LIVE_AI_REASONING_MODEL = "gpt-5.6-terra" as const;
export const LIVE_AI_TTS_MODEL = "gpt-4o-mini-tts" as const;

export interface LiveAiConfig {
  /** R — LIVE_AI_RUNTIME_ENABLED === "1": the gateway may create a session. */
  runtimeEnabled: boolean;
  /** B — LIVE_AI_BROKER_ENABLED === "1": informational at the gateway (enforced at
   *  the Next broker route). */
  brokerEnabled: boolean;
  // session-assertion verification (Live-AI signing material — NOT the voice keys)
  signingPublicKey: string | null;
  issuer: string | null;
  audience: string | null;
  controlTokenSecret: string | null;
  killSwitchSecret: string | null;
  allowedOrigins: string[];
  ipHashSalt: string | null;
  openaiApiKeyPresent: boolean;
  // fixed model allowlists ("" ⇒ a mismatching configured value disabled the provider)
  sttModel: string;
  reasoningModel: string;
  ttsModel: string;
}

function resolveLiveAiModel(raw: string | undefined, allowed: string): string {
  const v = nonEmpty(raw);
  if (!v) return allowed; // unset ⇒ the reviewed constant
  return v === allowed ? allowed : ""; // any other value ⇒ disabled (fail closed)
}

export function loadLiveAiConfig(env: GatewayEnv): LiveAiConfig {
  return {
    runtimeEnabled: exactlyOne(env.LIVE_AI_RUNTIME_ENABLED),
    brokerEnabled: exactlyOne(env.LIVE_AI_BROKER_ENABLED),
    signingPublicKey: nonEmpty(env.LIVE_AI_SESSION_SIGNING_PUBLIC_KEY),
    issuer: nonEmpty(env.LIVE_AI_SESSION_ISSUER),
    audience: nonEmpty(env.LIVE_AI_SESSION_AUDIENCE),
    controlTokenSecret: nonEmpty(env.LIVE_AI_CONTROL_TOKEN_SECRET),
    killSwitchSecret: nonEmpty(env.LIVE_AI_KILL_SWITCH_HMAC_SECRET),
    allowedOrigins: parseOrigins(env.LIVE_AI_ALLOWED_ORIGINS),
    ipHashSalt: nonEmpty(env.LIVE_AI_IP_HASH_SALT),
    openaiApiKeyPresent: Boolean(nonEmpty(env.OPENAI_API_KEY)),
    sttModel: resolveLiveAiModel(env.LIVE_AI_STT_MODEL, LIVE_AI_STT_MODEL),
    reasoningModel: resolveLiveAiModel(env.LIVE_AI_REASONING_MODEL, LIVE_AI_REASONING_MODEL),
    ttsModel: resolveLiveAiModel(env.LIVE_AI_TTS_MODEL, LIVE_AI_TTS_MODEL),
  };
}

/** Fail-closed: the Live-AI provider is reachable only with a key + all three models. */
export function liveAiProviderConfigured(c: LiveAiConfig): boolean {
  return Boolean(c.openaiApiKeyPresent && c.sttModel && c.reasoningModel && c.ttsModel);
}
/** Fail-closed: the Live-AI assertion verify needs the Live-AI signing material. */
export function liveAiAssertionVerifiable(c: LiveAiConfig): boolean {
  return Boolean(c.signingPublicKey && c.issuer && c.audience);
}
/** Fail-closed: the whole Live-AI session-create path independently requires ALL
 *  four dormancy gates + config — the B gate (brokerEnabled) AND the R gate
 *  (runtimeEnabled) are BOTH enforced here at the gateway, so a still-valid signed
 *  assertion can NEVER create a gateway session while B=0 (REV-12), plus the
 *  assertion material + control-token secret + provider + origins + ip-hash salt. */
export function liveAiSessionCreateConfigured(c: LiveAiConfig): boolean {
  return (
    c.brokerEnabled &&
    c.runtimeEnabled &&
    liveAiAssertionVerifiable(c) &&
    Boolean(c.controlTokenSecret) &&
    liveAiProviderConfigured(c) &&
    Boolean(c.ipHashSalt) &&
    c.allowedOrigins.length > 0
  );
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
    liveAi: loadLiveAiConfig(env),
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
    liveAi: {
      runtimeEnabled: c.liveAi.runtimeEnabled,
      brokerEnabled: c.liveAi.brokerEnabled,
      assertionVerifiable: liveAiAssertionVerifiable(c.liveAi),
      providerConfigured: liveAiProviderConfigured(c.liveAi),
      sessionCreateConfigured: liveAiSessionCreateConfigured(c.liveAi),
      allowedOriginCount: c.liveAi.allowedOrigins.length,
      sttModel: c.liveAi.sttModel,
      reasoningModel: c.liveAi.reasoningModel,
      ttsModel: c.liveAi.ttsModel,
    },
  };
}
