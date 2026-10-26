// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — PUBLIC (signed-in customer) gateway composition + bootstrap.
//
// The SAME original gateway (`buildGateway`) and the SAME released seams the staging composition uses —
// BUDGET core over the durable Postgres store, the released price catalog loader, the released 03A
// ExecutionSafety factory — composed for the public customer route. It adds NO new AI engine, provider
// client, session ledger or backend:
//   • G-PUBLIC — boots ONLY when the dedicated public admission gate (LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED)
//     is exactly "1". The gateway then admits ONLY `auth:true` sessions whose subject is the broker-derived
//     `pub1.<hex>` HMAC of a VERIFIED customer id (config.liveAi03bPublicSessionAllowed). The staging
//     subject allowlist is untouched; anonymous `px.*` sessions never reach 03B.
//   • G-RATE — ONE bounded execution-admission lease PER TURN (gateway turn id, ≤ the IC01 capability-step
//     ceiling), never a per-session key that a durable store would refuse on the second turn.
//   • G-MIC / G-TTS — ONE TRANSCRIPTION lease per microphone session and ONE TTS lease per approved compiled
//     answer, each priced EXCLUSIVELY from the loaded authoritative catalog (TRANSCRIPTION = the released
//     fixed 180 s capture profile; TTS = the OWNER-SUPPLIED reservation rule). A missing price / rule ⇒ the
//     voice call fails closed (captions + typed text still work). No price, unit, model or key is invented.
//   • Every provider call still follows the released order: lease → reserve → durable persist → kill/deadline
//     recheck → call → settle → durable settlement. Durable caps (session / subject-day / project-day/month /
//     global-day money) are enforced by the released Postgres store under the active owner policy row.
// P7 / C04: this file adds no provider-send path of its own and does not change the frozen control/CUT
// semantics. It does NOT by itself satisfy the P7 strict "no new physical send after DB CUT" contract.
// NO secret VALUE appears here — env NAMES only.
// ─────────────────────────────────────────────────────────────────────────
import { randomUUID, createHash } from "node:crypto";
import { BUDGET_PROVIDER, TRANSCRIPTION_MODEL, TTS_MODEL } from "./live-ai-budget-authority";
import type { BudgetStore } from "./live-ai-budget-store";
import { costMicros, isUsdCurrency, type BillingDimension, type PriceCatalog } from "./live-ai-budget-pricing";
import { IC01_LIMITS } from "./live-ai-intelligence-contract";
import { MAX_TTS_BILLABLE_CHARS } from "./openai-tts";
import type { ControlWatcherTimers } from "./live-ai-budget-control";
import {
  buildStagingLiveAi,
  loadStagingPriceCatalog,
  makeStagingPgStore,
} from "./live-ai-staging-main";
import {
  buildGateway,
  type BuildContextDeps,
  type Live03bPrepareExecutionContext,
  type LiveAiProviderSpendPrepareContext,
  LIVE_AI_03B_PROJECT_ID,
  LIVE_AI_03B_LEASE_TTL_MS,
  LIVE_AI_03B_CONTROL_STALENESS_MS,
} from "./index";
import { loadBudgetConfig, budgetDurableConfigured, type BudgetBindingConfig, type GatewayEnv } from "./config";

/** The public composition's DB DSN env NAME (owner-supplied at boot; never set here). */
export const PUBLIC_DATABASE_URL_ENV = "LIVE_AI_PUBLIC_DATABASE_URL" as const;
/** The OWNER-SUPPLIED TTS reservation rule env NAMES (absent ⇒ TTS unavailable, captions only). */
export const TTS_RESERVE_DIMENSION_ENV = "LIVE_AI_TTS_RESERVE_DIMENSION" as const;
export const TTS_RESERVE_UNITS_ENV = "LIVE_AI_TTS_RESERVE_UNITS" as const;
/** Hard ceiling on an owner-supplied TTS reservation (bounds a single spoken answer's exposure). */
export const MAX_TTS_RESERVE_UNITS = 100000;
/** The fixed TRANSCRIPTION worst-case profile — the RELEASED budget-authority profile (180 s of realtime audio). */
export const TRANSCRIPTION_RESERVE_SECONDS = 180;

/** Defence in depth — the public composition leases ONLY for an opaque AUTHENTICATED subject shape (the broker-
 *  derived public customer `pub1.<64 hex>` or the allowlisted staging operator `stg1.<64 hex>`). The gateway's
 *  route predicate is the primary gate; an anonymous `px.*` subject is refused here too. */
const LEASABLE_SUBJECT_SHAPE = /^(?:pub1|stg1)\.[0-9a-f]{64}$/;
const PUBLIC_EXEC_DOMAIN = "staybid-live-ai-public-exec-admission-v1" as const;
const PUBLIC_SPEND_DOMAIN = "staybid-live-ai-public-provider-spend-v1" as const;

export interface TtsReservationRuleConfig { readonly dimension: "tts_input_character"; readonly units: bigint }

/** Parse the OWNER-SUPPLIED TTS reservation rule. Anything incomplete / malformed / out of bounds ⇒ null. */
export function resolveTtsReservationRule(env: GatewayEnv): TtsReservationRuleConfig | null {
  const dim = (env as Record<string, string | undefined>)[TTS_RESERVE_DIMENSION_ENV];
  const raw = (env as Record<string, string | undefined>)[TTS_RESERVE_UNITS_ENV];
  // TEMPORARY tts-1 FALLBACK — the bound model is billed per input character: ONLY that dimension is valid (never a
  // relabelled token/second dimension), and the reservation must cover the largest admissible input.
  if (dim !== "tts_input_character") return null;
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,8}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < MAX_TTS_BILLABLE_CHARS || n > MAX_TTS_RESERVE_UNITS) return null;
  return Object.freeze({ dimension: dim, units: BigInt(n) });
}

/** Worst-case USD micros for ONE provider-spend call of the given class, priced from the catalog ONLY.
 *  null ⇒ no usable USD price / rule (the caller then fails closed). */
export function quoteVoiceWorstCaseMicros(
  catalog: PriceCatalog, cls: "TRANSCRIPTION" | "TTS", ttsRule: TtsReservationRuleConfig | null, nowMs: number,
): bigint | null {
  let model: string; let dimension: BillingDimension; let units: bigint;
  if (cls === "TRANSCRIPTION") { model = TRANSCRIPTION_MODEL; dimension = "realtime_audio_second"; units = BigInt(TRANSCRIPTION_RESERVE_SECONDS); }
  else { if (!ttsRule) return null; model = TTS_MODEL; dimension = ttsRule.dimension; units = ttsRule.units; }
  const e = catalog.resolve({ provider: BUDGET_PROVIDER, model, dimension, serviceTier: null }, nowMs);
  if (!e || !isUsdCurrency(e.currencyCode)) return null;
  const c = costMicros(units, e.rateMicros, e.unitSize);
  return c.ok ? c.micros : null;
}

export interface PublicLiveAiCompositionDeps {
  readonly store: BudgetStore;
  readonly controlIntervalMs: number;
  readonly bootNonce: string;
  readonly catalog: PriceCatalog;
  readonly ttsReservationRule?: TtsReservationRuleConfig | null;
  readonly nowMs?: () => number;
  readonly monotonicNowMs?: () => number;
  readonly controlTimers?: ControlWatcherTimers;
}

/** Compose the PUBLIC liveAi runtime from the RELEASED staging seams (pure + hermetically testable). */
export function buildPublicLiveAi(deps: PublicLiveAiCompositionDeps) {
  const nowMs = deps.nowMs || (() => Date.now());
  const ttsRule = deps.ttsReservationRule || null;
  const base = buildStagingLiveAi({
    store: deps.store, controlIntervalMs: deps.controlIntervalMs, bootNonce: deps.bootNonce, catalog: deps.catalog,
    monotonicNowMs: deps.monotonicNowMs, controlTimers: deps.controlTimers,
    clock: { nowMs },
    ttsReservationRule: ttsRule,
  });
  const budgetCore = base.budgetCore;
  const keyFor = (domain: string, ...parts: string[]): string =>
    createHash("sha256").update([domain, ...parts].join("\u001f")).digest("hex");

  // G-RATE — ONE bounded execution-admission lease PER TURN (≤ the IC01 capability-step ceiling), keyed by the
  // gateway-owned (session, turn). Zero provider money / calls. A missing turn id fails closed.
  const prepareExecution = async (ctx: Live03bPrepareExecutionContext): Promise<{ ok: boolean; reason?: string }> => {
    if (!ctx || typeof ctx.subject !== "string" || !LEASABLE_SUBJECT_SHAPE.test(ctx.subject)) return { ok: false, reason: "invalid_session_authority" };
    if (!ctx || typeof ctx.gatewaySessionId !== "string" || !ctx.gatewaySessionId || typeof ctx.subject !== "string" || !ctx.subject
      || typeof ctx.turnId !== "string" || !ctx.turnId) return { ok: false, reason: "invalid_session_authority" };
    try {
      const r = await budgetCore.prepareExecutionLease({
        gatewaySessionId: ctx.gatewaySessionId, subjectDigest: ctx.subject, projectId: LIVE_AI_03B_PROJECT_ID,
        acquisitionKey: "pub-exec." + keyFor(PUBLIC_EXEC_DOMAIN, ctx.gatewaySessionId, ctx.turnId),
        maxControlStalenessMs: LIVE_AI_03B_CONTROL_STALENESS_MS, leaseTtlMs: LIVE_AI_03B_LEASE_TTL_MS,
        amounts: { moneyMicros: BigInt(0), providerCalls: BigInt(0), executionAdmissions: BigInt(IC01_LIMITS.MAX_CAPABILITY_STEPS) },
      });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    } catch { return { ok: false, reason: "prepare_error" }; }
  };

  // G-MIC / G-TTS — ONE provider-spend lease (exactly one call) priced from the catalog.
  const prepareProviderSpend = async (ctx: LiveAiProviderSpendPrepareContext): Promise<{ ok: boolean; reason?: string }> => {
    if (!ctx || typeof ctx.subject !== "string" || !LEASABLE_SUBJECT_SHAPE.test(ctx.subject)) return { ok: false, reason: "invalid_session_authority" };
    if (!ctx || typeof ctx.gatewaySessionId !== "string" || !ctx.gatewaySessionId || typeof ctx.subject !== "string" || !ctx.subject
      || (ctx.providerSpendClass !== "TRANSCRIPTION" && ctx.providerSpendClass !== "TTS") || typeof ctx.scopeKey !== "string" || !ctx.scopeKey) {
      return { ok: false, reason: "invalid_session_authority" };
    }
    const worst = quoteVoiceWorstCaseMicros(deps.catalog, ctx.providerSpendClass, ttsRule, nowMs());
    if (worst === null) return { ok: false, reason: ctx.providerSpendClass === "TTS" ? "no_tts_rate_or_rule" : "no_transcription_rate" };
    try {
      const r = await budgetCore.prepareProviderLease({
        gatewaySessionId: ctx.gatewaySessionId, subjectDigest: ctx.subject, projectId: LIVE_AI_03B_PROJECT_ID,
        acquisitionKey: "pub-spend." + keyFor(PUBLIC_SPEND_DOMAIN, ctx.providerSpendClass, ctx.gatewaySessionId, ctx.scopeKey),
        maxControlStalenessMs: LIVE_AI_03B_CONTROL_STALENESS_MS, leaseTtlMs: LIVE_AI_03B_LEASE_TTL_MS,
        amounts: { moneyMicros: worst, providerCalls: BigInt(1), executionAdmissions: BigInt(0) },
      });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    } catch { return { ok: false, reason: "prepare_error" }; }
  };

  return Object.freeze({
    budget: null,
    budgetCore,
    // apiKey / responsesFetch stay OMITTED (the gateway's env-derived provider seam is used, exactly as staging).
    live03b: Object.freeze({ makeExecution: base.live03b.makeExecution, prepareExecution, prepareProviderSpend }),
    monotonicNowMs: base.monotonicNowMs,
  });
}

export type PublicBootstrapPreflight =
  | { readonly ok: true; readonly dsn: string; readonly budgetConfig: BudgetBindingConfig; readonly ttsRule: TtsReservationRuleConfig | null }
  | { readonly ok: false; readonly reason: "public_admission_disabled" | "public_db_url_absent" | "budget_binding_absent" | "budget_config_mismatch" };
/** Fail-closed preflight for the public bootstrap (pure, no side effects). */
export function publicBootstrapPreflight(env: GatewayEnv): PublicBootstrapPreflight {
  const e = env as Record<string, string | undefined>;
  if (e.LIVE_AI_03B_PUBLIC_ADMISSION_ENABLED !== "1") return { ok: false, reason: "public_admission_disabled" };
  const dsnRaw = e[PUBLIC_DATABASE_URL_ENV];
  const dsn = typeof dsnRaw === "string" && dsnRaw.trim().length > 0 ? dsnRaw.trim() : null;
  if (!dsn) return { ok: false, reason: "public_db_url_absent" };
  const budgetConfig = loadBudgetConfig(env);
  if (!budgetDurableConfigured(budgetConfig)) return { ok: false, reason: "budget_binding_absent" };
  if (budgetConfig.projectId !== LIVE_AI_03B_PROJECT_ID
    || budgetConfig.leaseTtlMs !== LIVE_AI_03B_LEASE_TTL_MS
    || budgetConfig.maxControlStalenessMs !== LIVE_AI_03B_CONTROL_STALENESS_MS
    || !(budgetConfig.controlPollIntervalMs > 0 && budgetConfig.controlPollIntervalMs <= budgetConfig.maxControlStalenessMs)) {
    return { ok: false, reason: "budget_config_mismatch" };
  }
  return { ok: true, dsn, budgetConfig, ttsRule: resolveTtsReservationRule(env) };
}

/** The public executable. NEVER run by tests. Fail closed on any missing prerequisite. */
export async function publicMain(): Promise<void> {
  const env = process.env as GatewayEnv;
  const pre = publicBootstrapPreflight(env);
  if (!pre.ok) {
    // eslint-disable-next-line no-console
    console.error("live-ai public gateway: fail closed —", pre.reason);
    process.exit(1);
    return;
  }
  const { store, pool, close } = makeStagingPgStore(pre.dsn);
  const cat = await loadStagingPriceCatalog(pool);
  if (!cat.ok) {
    // eslint-disable-next-line no-console
    console.error("live-ai public gateway: fail closed — catalog:", cat.reason);
    try { await close(); } catch { /* no-op */ }
    process.exit(1);
    return;
  }
  const liveAi = buildPublicLiveAi({
    store, controlIntervalMs: pre.budgetConfig.controlPollIntervalMs, bootNonce: randomUUID(), catalog: cat.catalog, ttsReservationRule: pre.ttsRule,
  });
  const deps: BuildContextDeps = { env, liveAi: { budget: liveAi.budget, budgetCore: liveAi.budgetCore, live03b: liveAi.live03b, monotonicNowMs: liveAi.monotonicNowMs } };
  const { app } = await buildGateway(deps);
  const port = Number(env.PORT) || 8080;
  await app.listen({ port, host: "0.0.0.0" });
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  publicMain().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("live-ai public gateway failed to start:", err && err.message ? err.message : "error");
    process.exit(1);
  });
}
