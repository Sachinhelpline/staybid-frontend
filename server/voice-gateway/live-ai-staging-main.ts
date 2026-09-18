// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-03B — STAGING-ONLY gateway composition + bootstrap.
//
// The default production gateway `main()` (index.ts) boots `buildGateway({ env })`
// with NO liveAi runtime → every 03B/BUDGET/03A seam is dormant/fail-closed. This
// STAGING-ONLY executable composes the ALREADY-RELEASED DI seams (BUDGET core over a
// durable Postgres store + the 03A ExecutionSafety factory + the released price catalog
// + the released execution-admission lease) and injects them through the existing
// `buildGateway({ env, liveAi })` surface — WITHOUT touching the released controller /
// 03A / IC01 / IC02 / BUDGET engines, and WITHOUT changing production.
//
// ACTIVATION-READY, STILL DORMANT: the legacy atomic `budget` stays NULL, and the 03B
// provider override is OMITTED (never forced null) so the ACCEPTED released env-derived
// provider seam (OPENAI_API_KEY + the exact reasoning-model gate + a budget core) stays
// capable of activation LATER under separate provider-activation authority. This packet
// injects NO api key and makes NO provider request. The authority ceiling stays READ +
// UI_LOCAL. No voice / STT / TTS / mic is ever wired. No DB is contacted except a real
// staging Postgres the OWNER supplies at boot; the composition + the catalog/lease seams
// are pure and hermetically testable with an injected store / SQL pool.
// NO secret VALUE appears here — env NAMES only.
// ─────────────────────────────────────────────────────────────────────────
import { randomUUID, createHash } from "node:crypto";
import { performance as nodePerformance } from "perf_hooks";
import { createBudgetCore, type BudgetCore, type BudgetCoreClock } from "./live-ai-budget-authority";
import type { ControlWatcherTimers } from "./live-ai-budget-control";
import { createPgBudgetStore, type BudgetStore, type SqlConnectionPool } from "./live-ai-budget-store";
import { createPriceCatalog, EMPTY_PRICE_CATALOG, parseInt64, type PriceCatalog } from "./live-ai-budget-pricing";
import {
  createExecutionSafety,
  type ExecutionSafety,
  type ExecutionScreenContext,
  type Ic01LoopPort,
} from "./live-ai-execution-safety";
import type { TrustedBinding } from "./live-ai-intelligence-contract";
import {
  buildGateway,
  type BuildContextDeps,
  type Live03bExecutionSessionContext,
  type Live03bPrepareExecutionContext,
  LIVE_AI_03B_PROJECT_ID,
  LIVE_AI_03B_LEASE_TTL_MS,
  LIVE_AI_03B_CONTROL_STALENESS_MS,
} from "./index";
import {
  loadBudgetConfig,
  budgetDurableConfigured,
  type BudgetBindingConfig,
  type GatewayEnv,
} from "./config";

/** The exact staging DB DSN env NAME (a value is NEVER set here; owner-supplied at boot). */
export const STAGING_DATABASE_URL_ENV = "LIVE_AI_03B_STAGING_DATABASE_URL" as const;
/** Domain separation for the gateway-owned, deterministic execution-admission acquisition key. */
const STAGING_EXEC_ADMISSION_DOMAIN = "staybid-live-ai-03b-staging-exec-admission" as const;

// The CLOSED detail-section authority (P1-06): the set of sections the accepted SHOW_HOTEL_SECTION
// capability may target on a ready hotel-detail screen — NOT the single section currently in view.
const DETAIL_SECTION_AUTHORITY: readonly ("rooms" | "about")[] = Object.freeze(["rooms", "about"]);
const EMPTY_SECTIONS: readonly ("rooms" | "about")[] = Object.freeze([]);
const EMPTY_POSITIONS: readonly number[] = Object.freeze([]);

/**
 * Project the session's ALREADY-VALIDATED published context (session.lastContext) + the trusted binding
 * into the 03A `ExecutionScreenContext`, with the ACCEPTED 03A screen-authority meaning (P1-06). Session-
 * derived, never caller-invented; never manufactures executable authority from inconsistent fields.
 *
 * BINDING COHERENCE (§3, defence-in-depth): if the trusted binding's pageId disagrees with the published
 * context's pageId → FAIL CLOSED (null). The binding/context digest relationship stays owned by the
 * accepted gateway + IC01 boundary; this only refuses a screen whose page identity disagrees.
 *
 * HOTELS: ready === true ONLY when loadState === "ready" (a hostile/inconsistent `validated:true` can
 *   NEVER make a loading/error page ready); visiblePositions come only from the validated visible-hotel
 *   snapshot; currentHotelId = null; sections = [].
 * HOTEL-DETAIL: ready === true ONLY when loadState === "ready" AND validated === true AND currentHotelId
 *   is a non-empty validated id. A ready detail exposes currentHotelId + the CLOSED section authority
 *   ["rooms","about"] (both legitimate SHOW_HOTEL_SECTION targets), never merely the current UI section.
 *   Any loading/error/unvalidated/incoherent detail context ⇒ FAIL CLOSED (null).
 */
export function projectScreenContext(binding: TrustedBinding, publishedContext: unknown): ExecutionScreenContext | null {
  if (!binding || typeof binding !== "object") return null;
  if (!publishedContext || typeof publishedContext !== "object" || Array.isArray(publishedContext)) return null;
  const c = publishedContext as Record<string, unknown>;
  const pageId = c.pageId;
  if (pageId !== "hotels" && pageId !== "hotel-detail") return null;
  // §3 — page identity must agree with the trusted binding, or fail closed.
  if (binding.pageId !== pageId) return null;

  if (pageId === "hotels") {
    // ready is derived FAIL-CLOSED from loadState ONLY — `validated` is a separate bounded field and
    // must never elevate a loading/error page to ready.
    const ready = c.loadState === "ready";
    const visiblePositions: number[] = [];
    if (Array.isArray(c.visibleHotels)) {
      for (const h of c.visibleHotels) {
        if (h && typeof h === "object") {
          const p = (h as Record<string, unknown>).position;
          if (typeof p === "number" && Number.isInteger(p) && p >= 1) visiblePositions.push(p);
        }
      }
    }
    return Object.freeze({ binding, ready, visiblePositions: Object.freeze(visiblePositions), currentHotelId: null, sections: EMPTY_SECTIONS });
  }

  // hotel-detail
  const currentHotelId = typeof c.currentHotelId === "string" && c.currentHotelId.length > 0 ? c.currentHotelId : null;
  const ready = c.loadState === "ready" && c.validated === true && currentHotelId !== null;
  if (!ready) {
    // Do NOT create executable authority from an inconsistent/loading/error/unvalidated detail context.
    return Object.freeze({ binding, ready: false, visiblePositions: EMPTY_POSITIONS, currentHotelId: null, sections: EMPTY_SECTIONS });
  }
  return Object.freeze({ binding, ready: true, visiblePositions: EMPTY_POSITIONS, currentHotelId, sections: DETAIL_SECTION_AUTHORITY });
}

/** A CLOSED proposal-dispatch adapter: it only PARTICIPATES in the accepted proposal/receipt lifecycle
 *  (the browser proposal frame is emitted by the gateway's onCapabilityAdmitted); it NEVER executes any
 *  browser action, route, URL, HTTP, DOM, SQL or RPC of its own. */
function makeClosedExecutionAdapter() {
  return { dispatch(): { readonly dispatched: boolean } { return { dispatched: true }; } };
}

// ═══════════════════════ P1-02 — authoritative price-catalog loading ═══════════════════════
/** TIMESTAMPTZ → epoch ms (pg returns a Date; a stub may return an ISO string or a number). */
function tsToMs(v: unknown): number | null {
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

export type StagingCatalogLoadResult =
  | { readonly ok: true; readonly catalog: PriceCatalog }
  | { readonly ok: false; readonly reason: "no_active_catalog_version" | "ambiguous_active_catalog" | "catalog_load_error" };

/**
 * P1-02 — load the AUTHORITATIVE ACTIVE price catalog snapshot from the dedicated staging Postgres
 * BUDGET tables, READ-ONLY (SELECT only; no INSERT/UPDATE/DELETE), and build it with the RELEASED
 * `createPriceCatalog(...)`. The selected version EXACTLY mirrors the store's durable-envelope selection
 * (`budget_price_catalog_versions` active + effective now, latest effective_from), so `catalog.version`
 * equals the envelope's `priceCatalogVersionId` — a provider lease's catalog-version check then passes.
 *
 * Fail-closed: zero usable active version → no_active_catalog_version; a NON-deterministic active state
 * (two active-effective versions sharing the latest effective_from — the store's `LIMIT 1` would be
 * arbitrary) → ambiguous_active_catalog; any SQL error → catalog_load_error. No provider credential is
 * needed to load the catalog. BIGINT/text/time columns are converted into the exact createPriceCatalog
 * input types (invalid rows are dropped by the released validator).
 */
export async function loadStagingPriceCatalog(pool: SqlConnectionPool, nowMs?: () => number): Promise<StagingCatalogLoadResult> {
  let conn;
  try {
    conn = await pool.connect();
  } catch {
    return { ok: false, reason: "catalog_load_error" };
  }
  try {
    // Same predicate the durable store uses (status='active', effective now) — but WITHOUT LIMIT so the
    // ambiguity of equal-latest effective_from is detectable and fails closed rather than picked arbitrarily.
    const vres = await conn.query(
      `SELECT id, effective_from FROM budget_price_catalog_versions
         WHERE status='active' AND effective_from <= now() AND (effective_until IS NULL OR now() < effective_until)
         ORDER BY effective_from DESC`,
    );
    const vrows = vres && Array.isArray(vres.rows) ? vres.rows : [];
    if (vrows.length === 0) return { ok: false, reason: "no_active_catalog_version" };
    if (vrows.length >= 2) {
      const a = tsToMs(vrows[0].effective_from);
      const b = tsToMs(vrows[1].effective_from);
      if (a === null || b === null || a === b) return { ok: false, reason: "ambiguous_active_catalog" };
    }
    const versionId = typeof vrows[0].id === "string" && vrows[0].id ? vrows[0].id : String(vrows[0].id);
    if (!versionId) return { ok: false, reason: "no_active_catalog_version" };

    const eres = await conn.query(
      `SELECT provider, model, service_tier, billing_dimension, currency_code, unit_size, rate_micros,
              effective_from, effective_until, verified_at, verification_expires_at, source_id, source_digest, status
         FROM budget_price_catalog_entries WHERE catalog_version_id = $1`,
      [versionId],
    );
    const erows = eres && Array.isArray(eres.rows) ? eres.rows : [];
    const rawEntries = erows.map((row) => ({
      provider: typeof row.provider === "string" ? row.provider : String(row.provider),
      model: typeof row.model === "string" ? row.model : String(row.model),
      serviceTier: row.service_tier === null || row.service_tier === undefined ? null : String(row.service_tier),
      billingDimension: row.billing_dimension,
      currencyCode: typeof row.currency_code === "string" ? row.currency_code : String(row.currency_code),
      unitSize: parseInt64(row.unit_size),                                     // BIGINT → bigint (null ⇒ dropped by validator)
      rateMicros: parseInt64(row.rate_micros),
      effectiveFromMs: tsToMs(row.effective_from),
      effectiveUntilMs: row.effective_until === null || row.effective_until === undefined ? null : tsToMs(row.effective_until),
      verifiedAtMs: tsToMs(row.verified_at),
      verificationExpiresAtMs: tsToMs(row.verification_expires_at),
      sourceId: typeof row.source_id === "string" ? row.source_id : String(row.source_id),
      sourceDigest: typeof row.source_digest === "string" ? row.source_digest : String(row.source_digest),
      status: row.status,
    }));
    // version === the durable envelope's selected priceCatalogVersionId; the released validator drops
    // any malformed row (a stale/mistyped rate never becomes spend authority). nowMs is unused here (the
    // released catalog resolves usability per-call at spend time); the param documents that no clock is
    // baked into the snapshot.
    void nowMs;
    return { ok: true, catalog: createPriceCatalog(versionId, rawEntries) };
  } catch {
    return { ok: false, reason: "catalog_load_error" };
  } finally {
    try { conn.release(); } catch { /* no-op */ }
  }
}

export interface StagingLiveAiCompositionDeps {
  /** the durable BUDGET store (real PgBudgetStore at boot; a hermetic fake in tests). */
  readonly store: BudgetStore;
  /** the required control poll interval (> 0, ≤ the accepted staleness bound — validated in preflight). */
  readonly controlIntervalMs: number;
  /** a FRESH per-boot nonce (BUDGET P0-01 requires it when a store is wired). */
  readonly bootNonce: string;
  /** BUDGET wall-clock (default Date.now). */
  readonly clock?: BudgetCoreClock;
  /** the ONE monotonic clock for the 03B/03A lifecycle (default Node performance clock). */
  readonly monotonicNowMs?: () => number;
  /** the AUTHORITATIVE loaded price catalog (default the EMPTY/inactive catalog — provider spend fails
   *  closed until a real active catalog is loaded from the staging DB via loadStagingPriceCatalog). */
  readonly catalog?: PriceCatalog;
  /** BUDGET control-watcher timers (default real setTimeout/clearTimeout). Tests inject inert timers so
   *  the hermetic composition never leaves a dangling interval; production omits it. */
  readonly controlTimers?: ControlWatcherTimers;
}

/** The `liveAi` runtime bundle the staging composition injects into `buildGateway`. NOTE (P1-01): the
 *  03B provider override (apiKey / responsesFetch) is deliberately OMITTED — never forced null — so the
 *  gateway's accepted env-derived provider seam stays capable of later activation. */
export interface StagingLiveAiRuntime {
  readonly budget: null;                 // legacy atomic authority stays NULL for the 03B text path
  readonly budgetCore: BudgetCore;       // the ONLY authority the 03B controller needs
  readonly live03b: {
    readonly makeExecution: (loopPort: Ic01LoopPort, sessionCtx?: Live03bExecutionSessionContext) => ExecutionSafety;
    /** P1-03 — prepare EXACTLY ONE execution admission for an authenticated 03B staging session BEFORE
     *  it can exercise a 03A capability. apiKey / responsesFetch are intentionally NOT present. */
    readonly prepareExecution: (ctx: Live03bPrepareExecutionContext) => Promise<{ ok: boolean; reason?: string }>;
  };
  readonly monotonicNowMs: () => number;
}

/**
 * Compose the STAGING liveAi runtime from the RELEASED seams. Pure + hermetically testable (inject a
 * fake store). Wires: BudgetCore over the durable store + the authoritative catalog; a session-scoped
 * 03A ExecutionSafety factory bound to `budgetCore.executionAdmissionGate` + the projected screen context
 * + the ONE monotonic clock + a closed adapter; and the P1-03 execution-admission preparation seam. The
 * project id + lease TTL + control staleness are the ACCEPTED 03B constants (never free arguments). `budget`
 * stays NULL; the 03B provider override is OMITTED (env seam preserved). Never wires voice/STT/TTS/mic.
 */
export function buildStagingLiveAi(deps: StagingLiveAiCompositionDeps): StagingLiveAiRuntime {
  const clock: BudgetCoreClock = deps.clock || { nowMs: () => Date.now() };
  const monotonicNowMs = deps.monotonicNowMs || (() => nodePerformance.now());
  const catalog = deps.catalog || EMPTY_PRICE_CATALOG;
  const hashSession = (raw: string): string => createHash("sha256").update(String(raw)).digest("hex");
  const mintRef = (kind: string, seq: number): string => `${kind}-${seq}-${randomUUID()}`;

  const budgetCore = createBudgetCore({
    store: deps.store,
    catalog,
    clock,
    hashSession,
    mintRef,
    bootNonce: deps.bootNonce,
    controlIntervalMs: deps.controlIntervalMs,
    controlTimers: deps.controlTimers,
  });

  const makeExecution = (loopPort: Ic01LoopPort, sessionCtx?: Live03bExecutionSessionContext): ExecutionSafety => {
    // sessionCtx is supplied per-turn by the gateway wrapper; when absent (defensive) bind a fail-closed
    // context so a capability can never be admitted without the real session authority.
    const gatewaySessionId = sessionCtx ? sessionCtx.gatewaySessionId : "";
    const binding = sessionCtx ? sessionCtx.binding : null;
    const published = sessionCtx ? sessionCtx.publishedContext : null;
    const clockMono = sessionCtx ? sessionCtx.monotonicNowMs : monotonicNowMs;
    return createExecutionSafety({
      clock: { nowMonotonicMs: () => clockMono() },
      mintId: { mint: (kind: string, seq: number) => `exec-${kind}-${seq}-${randomUUID()}` },
      budgetGate: budgetCore.executionAdmissionGate(gatewaySessionId),
      adapter: makeClosedExecutionAdapter(),
      contexts: { current: () => (binding ? projectScreenContext(binding, published) : null) },
      loop: loopPort,
      audit: { emit: () => { /* bounded, no secret/PII logging */ } },
    });
  };

  // P1-03 — prepare EXACTLY ONE execution admission for this authenticated staging session, bound to the
  // gateway-owned session id + the signed subject + the exact project `live-ai-03b`, with ZERO provider
  // money and ZERO provider calls, under the accepted lease TTL + control staleness. The acquisition key
  // is gateway-owned, deterministic and idempotent for the session (never browser/model/provider chosen),
  // so a re-preparation is an idempotent replay, never a second admission. Fail-closed on any refusal/error.
  const prepareExecution = async (ctx: Live03bPrepareExecutionContext): Promise<{ ok: boolean; reason?: string }> => {
    if (!ctx || typeof ctx.gatewaySessionId !== "string" || !ctx.gatewaySessionId
      || typeof ctx.subject !== "string" || !ctx.subject) {
      return { ok: false, reason: "invalid_session_authority" };
    }
    const acquisitionKey = "stg-exec-adm." + createHash("sha256")
      .update(STAGING_EXEC_ADMISSION_DOMAIN + " " + ctx.gatewaySessionId).digest("hex");
    try {
      const r = await budgetCore.prepareExecutionLease({
        gatewaySessionId: ctx.gatewaySessionId,
        subjectDigest: ctx.subject,
        projectId: LIVE_AI_03B_PROJECT_ID,
        acquisitionKey,
        maxControlStalenessMs: LIVE_AI_03B_CONTROL_STALENESS_MS,
        leaseTtlMs: LIVE_AI_03B_LEASE_TTL_MS,
        // EXACTLY ONE admission; zero provider money + zero provider calls (BigInt(...) — no `1n` literal
        // so the es2017 main-app typecheck accepts this shared gateway file).
        amounts: { moneyMicros: BigInt(0), providerCalls: BigInt(0), executionAdmissions: BigInt(1) },
      });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    } catch {
      return { ok: false, reason: "prepare_error" };
    }
  };

  return Object.freeze({
    budget: null,
    budgetCore,
    // P1-01 — OMIT apiKey / responsesFetch: leaving them undefined means the gateway's `!== undefined`
    // override checks fall through to the ACCEPTED env-derived provider default, so a later
    // OPENAI_API_KEY + exact reasoning-model gate can enable the real 03B text provider under separate
    // provider-activation authority. Forcing null here would permanently suppress that seam.
    live03b: Object.freeze({ makeExecution, prepareExecution }),
    monotonicNowMs,
  });
}

/** Fail-closed preflight for the staging bootstrap (testable, no side effects). */
export type StagingBootstrapPreflight =
  | { readonly ok: true; readonly dsn: string; readonly budgetConfig: BudgetBindingConfig }
  | { readonly ok: false; readonly reason: "staging_db_url_absent" | "budget_binding_absent" | "budget_config_mismatch" };
export function stagingBootstrapPreflight(env: GatewayEnv): StagingBootstrapPreflight {
  const dsnRaw = (env as Record<string, string | undefined>)[STAGING_DATABASE_URL_ENV];
  const dsn = typeof dsnRaw === "string" && dsnRaw.trim().length > 0 ? dsnRaw.trim() : null;
  if (!dsn) return { ok: false, reason: "staging_db_url_absent" };
  const budgetConfig = loadBudgetConfig(env);
  if (!budgetDurableConfigured(budgetConfig)) return { ok: false, reason: "budget_binding_absent" };
  // P1-04 — the BUDGET binding MUST match the accepted 03B runtime authority constants EXACTLY, or the
  // activation configuration is misleading (a session would be authorized under the wrong project / TTL /
  // staleness). Fail closed unless project + lease TTL + control staleness are the accepted constants and
  // the poll interval is positive and within the staleness bound.
  if (budgetConfig.projectId !== LIVE_AI_03B_PROJECT_ID
    || budgetConfig.leaseTtlMs !== LIVE_AI_03B_LEASE_TTL_MS
    || budgetConfig.maxControlStalenessMs !== LIVE_AI_03B_CONTROL_STALENESS_MS
    || !(budgetConfig.controlPollIntervalMs > 0 && budgetConfig.controlPollIntervalMs <= budgetConfig.maxControlStalenessMs)) {
    return { ok: false, reason: "budget_config_mismatch" };
  }
  return { ok: true, dsn, budgetConfig };
}

/** Build a durable PgBudgetStore + expose the read-only pool (for catalog loading) from the staging DSN.
 *  `pg` is required at RUNTIME only (never imported at typecheck), so this file compiles without
 *  `@types/pg`; the structural `SqlConnectionPool` is honored. */
export function makeStagingPgStore(dsn: string): { store: BudgetStore; pool: SqlConnectionPool; close: () => Promise<void> } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pg = require("pg") as { Pool: new (config: { connectionString: string; max?: number }) => { connect: () => Promise<{ query: (t: string, p?: readonly unknown[]) => Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>; release: () => void }>; end: () => Promise<void> } };
  const pgPool = new pg.Pool({ connectionString: dsn, max: 8 });
  const pool: SqlConnectionPool = { connect: () => pgPool.connect() };
  const store = createPgBudgetStore({ pool, nowMs: () => Date.now() });
  return { store, pool, close: () => pgPool.end() };
}

/** The staging-only executable. NEVER run by tests (tests drive buildStagingLiveAi + loadStagingPriceCatalog
 *  with a fake store / SQL pool). Fail-closed on any missing prerequisite; it deploys nothing and connects to
 *  no DB unless the owner has supplied the staging DSN + durable BUDGET binding out of band. */
export async function stagingMain(): Promise<void> {
  const env = process.env as GatewayEnv;
  const pre = stagingBootstrapPreflight(env);
  if (!pre.ok) {
    // eslint-disable-next-line no-console
    console.error("live-ai staging gateway: fail closed —", pre.reason);
    process.exit(1);
    return;
  }
  const { store, pool, close } = makeStagingPgStore(pre.dsn);
  // P1-02 — load the authoritative active catalog snapshot BEFORE composing (fail closed if absent/ambiguous).
  const cat = await loadStagingPriceCatalog(pool);
  if (!cat.ok) {
    // eslint-disable-next-line no-console
    console.error("live-ai staging gateway: fail closed — catalog:", cat.reason);
    try { await close(); } catch { /* no-op */ }
    process.exit(1);
    return;
  }
  const liveAi = buildStagingLiveAi({
    store,
    controlIntervalMs: pre.budgetConfig.controlPollIntervalMs,
    bootNonce: randomUUID(),
    catalog: cat.catalog,
  });
  const deps: BuildContextDeps = { env, liveAi: { budget: liveAi.budget, budgetCore: liveAi.budgetCore, live03b: liveAi.live03b, monotonicNowMs: liveAi.monotonicNowMs } };
  const { app } = await buildGateway(deps);
  const port = Number(env.PORT) || 8080;
  await app.listen({ port, host: "0.0.0.0" });
}

// Run directly (CJS) guard — only when this staging executable is the entrypoint.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  stagingMain().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("live-ai staging gateway failed to start:", err && err.message ? err.message : "error");
    process.exit(1);
  });
}
