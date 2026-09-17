// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — dedicated Fastify Voice gateway.
//
// Routes:
//   • POST   /v1/voice/sessions              — create a Voice session (assertion +
//                                              SDP → provider session + control token)
//   • GET    /v1/voice/sessions/:sid/control — control WebSocket upgrade
//   • GET    /healthz                        — non-secret health/config summary
//   • POST   /internal/voice/kill            — HMAC-protected DISABLE-only switch
//
// No generic proxy route, no arbitrary-provider-endpoint route, no user-supplied
// outbound URL. The runtime is FAIL-CLOSED (VOICE_AI_RUNTIME_ENABLED === "1"), and
// the whole session-create path additionally requires the security + provider +
// origin config to be present. The request handlers are DI functions
// (handleSessionCreate / handleKill) unit-tested directly; the Fastify wiring is a
// thin adapter. `buildGateway` returns the instance WITHOUT listening (main() at
// the bottom listens only when run directly). No secret is ever logged.
// ─────────────────────────────────────────────────────────────────────────
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyRateLimit from "@fastify/rate-limit";
import { WebSocket as WsWebSocket } from "ws";
import {
  loadGatewayConfig,
  sessionCreateConfigured,
  safeConfigSummary,
  isAllowedOrigin,
  providerConfigured,
  type GatewayConfig,
  type GatewayEnv,
} from "./config";
import { validateSessionCreateBody, MAX_BODY_BYTES } from "./schemas";
import {
  createReplayStore,
  verifyAssertion,
  mintControlToken,
  verifyKillRequest,
  type ReplayStore,
} from "./auth";
import { createSessionStore, type SessionStore, type TimerFacility } from "./sessions";
import { createRateLimiter, hashIp, type RateLimiter } from "./rate-limit";
import { createTelemetry, type Telemetry } from "./telemetry";
import { createToolExecutor } from "./tool-executor";
import { createSideband, type Sideband } from "./sideband";
import {
  createOpenAiRealtime,
  createOpenAiRealtimeTransport,
  unavailableRealtimeTransport,
  type RealtimeTransport,
  type RealtimeFetch,
  type ServerWsLike,
  type OpenAiRealtime,
} from "./openai-realtime";
import {
  authorizeControlOpen,
  handleControlFrame,
  makeSocketEmit,
  type GatewaySocket,
} from "./control-socket";
// ── LIVE-AI-02A — ISOLATED Live-AI wiring. This block imports ONLY the Live-AI
//    modules + reusable crypto/rate/telemetry primitives. It NEVER imports or
//    passes createToolExecutor / sideband / the old realtime tool authority. ──
import {
  liveAiSessionCreateConfigured,
  liveAiProviderConfigured,
  liveAi03bTextProviderConfigured,
  liveAi03bStagingTextConfigured,
  liveAi03bStagingSubjectAllowed,
  type LiveAiConfig,
} from "./config";
import {
  verifyLiveAiAssertion,
  mintControlTokenWithSecret,
  verifyKillRequestWithSecret,
} from "./auth";
import {
  createLiveAiSessionStore,
  createServerCaptureLedger,
  DEFAULT_LIVE_AI_LIMITS,
  type LiveAiSessionStore,
  type ServerCaptureLedger,
  type LiveAiLimits,
  type BudgetAuthority,
  type LiveAiSession,
} from "./live-ai-sessions";
import { createLiveAiOrchestrator } from "./live-ai-orchestrator";
import { unavailableTranscription, createTranscriptionAdapter, createDefaultTranscriptionSeam, type TranscriptionAdapter } from "./openai-transcription";
import { unavailableReasoning, createReasoningAdapter, createDefaultReasoningCall, type ReasoningAdapter, type Responses03bFetchLike } from "./openai-responses";
import { unavailableTts, createTtsAdapter, createDefaultTtsCall, type TtsAdapter } from "./openai-tts";
import {
  authorizeLiveAiControlOpen,
  handleLiveAiControlFrame,
  makeLiveAiEmit,
  type GatewaySocket as LiveAiGatewaySocket,
} from "./live-ai-control-socket";
import { validateSessionCreateBody as validateLiveAiSessionBody } from "./live-ai-schemas";
// LIVE-AI-03B (P1-01) — the staging-text controller + a fresh IC01 agent loop per turn.
import { create03bController, type CompiledAnswerFrameOut, type Budget03bPort as Live03bBudgetPort, type Controller03b, type TextTurnRequest as Text03bTurnRequest, type TurnOutcome } from "./live-ai-03b-controller";
import { createAgentLoop, type AgentLoop as AgentLoopLike } from "./live-ai-agent-loop";
import type { ExecutionSafety, Ic01LoopPort } from "./live-ai-execution-safety";
import type { TrustedBinding } from "./live-ai-intelligence-contract";
import { createHash, randomUUID } from "crypto";
import { performance as nodePerformance } from "perf_hooks";

// R3 (REREV-09): how long a created session waits for the browser control socket to
// attach before it self-terminates (and hangs up the provider call).
const CONTROL_ATTACH_DEADLINE_MS = 15_000;

// ---- gateway runtime context (DI) ------------------------------------------
export interface GatewayRuntime {
  killed: boolean;
}

export interface GatewayContext {
  config: GatewayConfig;
  store: SessionStore;
  replay: ReplayStore;
  rateLimiter: RateLimiter;
  realtime: OpenAiRealtime;
  sideband: Sideband;
  executor: ReturnType<typeof createToolExecutor>;
  telemetry: Telemetry;
  runtime: GatewayRuntime;
  now: () => number;
}

export interface BuildContextDeps {
  env: GatewayEnv;
  transport?: RealtimeTransport;
  telemetrySink?: Telemetry;
  now?: () => number;
  timers?: TimerFacility;
  fetchImpl?: typeof fetch;
  /** LIVE-AI-03B (P1-01) — OPTIONAL runtime dependencies the REAL application bootstrap forwards to
   *  buildLiveAiContext, so the 03B staging text path is reachable when SEPARATELY configured/
   *  authorized WITHOUT another source change. Default undefined ⇒ none forwarded ⇒ fail-closed
   *  dormant (budget core null, 03A execution null, staging off, provider unavailable). */
  liveAi?: LiveAiRuntimeDeps;
}
/** LIVE-AI-03B (P1-01) — the forwardable 03B/Budget/03A/monotonic runtime seam. Every field is
 *  optional and defaults to the dormant fail-closed value; nothing here activates a provider. */
export interface LiveAiRuntimeDeps {
  budget?: BudgetAuthority | null;
  budgetCore?: LiveAiBudgetCoreSeam | null;
  reasoning?: ReasoningAdapter;
  tts?: TtsAdapter;
  transcription?: TranscriptionAdapter;
  live03b?: BuildLiveAiDeps["live03b"];
  monotonicNowMs?: () => number;
}

export function buildContext(deps: BuildContextDeps): GatewayContext {
  const now = deps.now || (() => Date.now());
  const config = loadGatewayConfig(deps.env);
  const store = createSessionStore({ limits: config.limits, now, timers: deps.timers });
  const replay = createReplayStore(now);
  const rateLimiter = createRateLimiter({ limits: config.limits, now });
  const telemetry = deps.telemetrySink || createTelemetry();
  const executor = createToolExecutor({
    config,
    fetchImpl: (deps.fetchImpl || (globalThis.fetch as any)) as any,
    now,
  });
  const sideband = createSideband({ store, executor, telemetry, config, rateLimiter });
  // Build the REAL (dormant) provider transport when the server key + provider
  // config are present; otherwise fail closed. Tests always INJECT a fake
  // transport, so the real fetch/ws ctors below are never exercised here and NO
  // real, billable, authenticated provider request is ever made in this packet.
  const apiKey = deps.env.OPENAI_API_KEY;
  const realTransport: RealtimeTransport =
    apiKey && providerConfigured(config)
      ? createOpenAiRealtimeTransport({
          apiKey,
          fetchImpl: (deps.fetchImpl || (globalThis.fetch as unknown)) as unknown as RealtimeFetch,
          WebSocketCtor: (url, opts) => new WsWebSocket(url, { headers: opts.headers }) as unknown as ServerWsLike,
          now,
        })
      : unavailableRealtimeTransport;
  const realtime = createOpenAiRealtime({ config, transport: deps.transport || realTransport });
  return { config, store, replay, rateLimiter, realtime, sideband, executor, telemetry, runtime: { killed: false }, now };
}

// ---- POST /v1/voice/sessions handler (DI, unit-tested) ----------------------
export interface SessionCreateInput {
  origin?: string;
  ip: string;
  authorization?: string;
  body: unknown;
}
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleSessionCreate(ctx: GatewayContext, input: SessionCreateInput): Promise<HandlerResult> {
  const { config } = ctx;
  // 1) runtime gate (fail closed) + kill switch
  if (!config.runtimeEnabled || ctx.runtime.killed) return { status: 503, body: { error: "runtime_disabled" } };
  // 2) full config presence (fail closed, zero network when unconfigured)
  if (!sessionCreateConfigured(config)) return { status: 503, body: { error: "unconfigured" } };
  // 3) body validation (bounded SDP)
  const body = validateSessionCreateBody(input.body);
  if (!body) return { status: 400, body: { error: "invalid_body" } };
  // 4) circuit breaker + explicit provider-429 cooldown (REREV-03)
  if (ctx.rateLimiter.isCircuitOpen()) return { status: 503, body: { error: "circuit_open" } };
  if (ctx.rateLimiter.isRateLimitedCooldown()) return { status: 429, body: { error: "provider_rate_limited" } };
  // 5) assertion (Bearer) — the origin is a SIGNED claim, verified next (a direct
  //    caller cannot forge it, and the browser cannot substitute it).
  const bearer = /^Bearer (.+)$/i.exec(input.authorization || "");
  if (!bearer) return { status: 401, body: { error: "assertion_missing" } };
  const verified = await verifyAssertion(bearer[1], config, ctx.replay);
  if (!verified.ok) {
    const status = verified.code === "assertion_unconfigured" ? 503 : 401;
    return { status, body: { error: verified.code } };
  }
  const assertion = verified.assertion;
  // 6) origin allowlist — the GATEWAY verifies the SIGNED origin claim against its
  //    own allowlist (never a request header, never `*`).
  if (!isAllowedOrigin(assertion.origin, config.allowedOrigins)) {
    return { status: 403, body: { error: "origin_not_allowed" } };
  }
  // 7) start-limit (anon by IP hash, auth by subject) + concurrency
  const ipHash = hashIp(input.ip || "0.0.0.0", config.ipHashSalt as string);
  const startKey = assertion.authenticated ? `sub:${assertion.subject}` : `ip:${ipHash}`;
  const start = ctx.rateLimiter.checkStart(startKey, assertion.authenticated);
  if (!start.ok) return { status: 429, body: { error: start.reason } };

  const created = ctx.store.create({ subject: assertion.subject, ipHash, authenticated: assertion.authenticated });
  if (!created.ok) return { status: 429, body: { error: created.reason } };
  const session = created.session;

  // 8) provider realtime session (fixed model/endpoint; caller overrides nothing)
  const provider = await ctx.realtime.createSession(body.sdp);
  if (!provider.ok) {
    ctx.rateLimiter.recordProviderResult(false);
    // REREV-03: a provider 429 opens an explicit backoff so we stop hammering it.
    if (provider.code === "provider_rate_limited") ctx.rateLimiter.noteProviderRateLimited();
    ctx.store.close(session.sessionId);
    const status = provider.code === "provider_rate_limited" ? 429 : provider.code === "provider_unavailable" ? 503 : 502;
    return { status, body: { error: provider.code } };
  }
  ctx.rateLimiter.recordProviderResult(true);
  // ONE authoritative per-session runtime binding: the provider termination handle
  // + cancel; the sideband is attached so validated provider events flow to the
  // session's (late-bound) control emitter. Turns begin lazily (multi-turn).
  ctx.store.bindProvider(session, {
    close: () => provider.sideband.close(),
    cancelTurn: () => provider.sideband.cancelTurn(),
  });
  ctx.sideband.attach(session, provider.sideband);
  // Drive the utterance (≤20s HARD) + cumulative-speech (5m) caps from provider VAD.
  // R6 (SB04-R5-REREV-01): ITEM-ID-CORRELATED per-item VAD ownership. Every VAD event
  // carries the provider `item_id` (the SAME id spans speech_started → speech_stopped →
  // input_audio_buffer.committed for one utterance; current OpenAI Realtime docs,
  // accessed 2026-08-28). Each item has a monotonic per-item state; a commit can only
  // ever advance ITS OWN item and can never consume another (fixing the R5 session-wide
  // `awaitingCommit`, where a late commit(A) could consume B). A strictly nonempty,
  // bounded id is required — a missing/malformed/oversized id NEVER reserves cost or
  // requests a response. The item-state map is REPLAY-SAFE: a terminal id is retained
  // for the session lifetime (never evicted), so an old id can never become live again;
  // reaching the fixed capacity FAILS THE SESSION CLOSED (never a silent eviction).
  //   IDLE → STARTED(A) → STOPPED(A) → COMMITTED(A) → (scheduler) → TERMINAL(A)
  // speech_started begins the utterance (arms the 20s hard cap); speech_stopped ONLY
  // ends the utterance-duration timer + enforces the cumulative-speech cap; commit is
  // the sole trigger and delegates to the serialized response scheduler (R6-02).
  type ItemState = "STARTED" | "STOPPED" | "COMMITTED" | "TERMINAL";
  const itemStates = new Map<string, ItemState>();
  // Bounded well above a 10-minute session's plausible utterance count; a tiny per-entry
  // footprint. Reaching it fails closed rather than evicting (replay-safe).
  const MAX_UNIQUE_ITEMS = 512;
  const validItemId = (raw: string): string | null =>
    typeof raw === "string" && raw.length > 0 && raw.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(raw) ? raw : null;
  provider.sideband.onSpeech?.((phase, itemId) => {
    if (session.terminated) return;
    const id = validItemId(itemId);
    if (!id) return; // missing/malformed/oversized id → never tracked, never reserves
    if (phase === "start") {
      if (itemStates.has(id)) return; // duplicate START(A) is idempotent
      if (itemStates.size >= MAX_UNIQUE_ITEMS) {
        // Replay-safe: NEVER evict an old terminal id; fail the session closed instead.
        ctx.store.terminate(session, "closed");
        return;
      }
      itemStates.set(id, "STARTED");
      ctx.store.startUtterance(session); // arms/refreshes the 20s hard cap
      return;
    }
    // speech_stopped: only STARTED(A) may be STOPPED by A. Duplicate/unknown → ignore.
    if (itemStates.get(id) === "STARTED") {
      itemStates.set(id, "STOPPED");
      ctx.store.endUtterance(session); // stop timer + cumulative cap only (never reserve)
    }
  });
  provider.sideband.onCommit?.((itemId) => {
    if (session.terminated) return; // commit after termination is inert
    const id = validItemId(itemId);
    if (!id) return; // missing/malformed commit id → reject (no reservation)
    const st = itemStates.get(id);
    if (st === undefined) return; // unknown id → reject (never consumes another item)
    if (st === "COMMITTED" || st === "TERMINAL") return; // duplicate/late commit → idempotent
    if (st === "STARTED") return; // commit before the matching stop → reject (docs: stop→commit)
    // st === "STOPPED": the AUTHORITATIVE once-per-utterance boundary for THIS item.
    itemStates.set(id, "COMMITTED");
    // Delegate to the serialized response scheduler (R6-02): one auditable reservation +
    // one response.create for this committed utterance, serialized behind any active
    // response. The scheduler fails the session closed on a failed reservation / queue
    // overflow, so no response.create is ever sent without an owned reservation.
    ctx.sideband.requestUserResponse(session, id);
    itemStates.set(id, "TERMINAL"); // consumed — this id can never be live again
  });
  // R4 (SB04-R3-REREV-02): a POST-READY sideband death (ws error/close, provider
  // fatal error) is FATAL to the live session: record the provider failure in the
  // circuit, then terminate — which hangs up the provider call, aborts tool work,
  // clears timers, seals the session, and closes the browser control channel.
  // terminate() is idempotent, and the transport never fires fatal for an
  // intentional local close, so no recursive/double termination occurs.
  provider.sideband.onFatal?.(() => {
    ctx.rateLimiter.recordProviderResult(false);
    ctx.store.terminate(session, "closed");
  });

  // R5 (SB04-R4-REREV-04): a terminated session must NEVER yield a success envelope.
  // A sideband fatal (delivered/latched the instant onFatal binds, or during any later
  // await) can terminate this session WHILE handleSessionCreate is still doing material
  // async setup. After every such step we re-check authoritative liveness and, if the
  // session is dead, fail closed with a stable bounded code — no answer SDP, no control
  // token, no ordinal capability, no success session id. terminate()/hangup already ran
  // in the fatal handler and is idempotent, so we never double-terminate here.
  const deadSessionResult = (): HandlerResult => ({ status: 503, body: { error: "provider_unavailable" } });
  // (1) a fatal that latched immediately after readiness is delivered the moment onFatal
  //     bound above — catch it before minting any credential.
  if (session.terminated) return deadSessionResult();

  // 9) control token (bound to session+subject, ≤10 min)
  const controlToken = mintControlToken(session.sessionId, assertion.subject, config, ctx.now);
  if (!controlToken) {
    ctx.store.close(session.sessionId);
    return { status: 503, body: { error: "control_unconfigured" } };
  }
  // (2) between provider binding and arming the control deadline.
  if (session.terminated) return deadSessionResult();
  // R3 (REREV-09): arm the control-attach deadline. If the browser never opens the
  // authoritative control socket, the session terminates (hanging up the provider
  // call) instead of leaving a live provider call with no control channel.
  ctx.store.armControlDeadline(session, CONTROL_ATTACH_DEADLINE_MS);

  // R4 (SB04-R3-REREV-10): SECURE ordinal visible-context with an AUTHORITATIVE
  // INSTALL STATUS. The client's on-screen hotel ids are UNTRUSTED — the gateway
  // SERVER-VERIFIES each via the fixed getHotelDetails read, then pushes the
  // STRUCTURED ordinal→id mapping and AWAITS the provider's documented
  // `conversation.item.created` acknowledgement. Ordinal capability is READY only
  // when verification AND the acknowledged context install both succeed; on ANY
  // failure (verification error, send throw, socket close, provider error, ack
  // timeout) the session is EXPLICITLY marked ordinal-unavailable
  // (`ordinalContext:false` in the response) and the candidate ids are NOT
  // allowlisted — so the provider cannot resolve an ordinal to an actionable id
  // and OPEN_HOTEL for them fails the authoritative allowlist. Never a silent
  // ordinal-capable success. No new endpoint; no fifth tool.
  let ordinalContextReady = false;
  if (body.visibleHotelIds.length > 0) {
    try {
      const verified = await ctx.executor.verifyVisibleContext(body.visibleHotelIds, session.turnAbort?.signal, 8_000);
      // (3) a fatal DURING visible-context verification terminated the session.
      if (session.terminated) return deadSessionResult();
      if (verified.length > 0 && provider.sideband.sendContext) {
        const acked = await provider.sideband.sendContext(verified.map((v) => ({ ordinal: v.ordinal, id: v.id })));
        // (4/5) a fatal DURING the context-send / ACK wait, or immediately after it.
        if (session.terminated) return deadSessionResult();
        if (acked) {
          ctx.store.allowHotelIds(session, verified.map((v) => v.id));
          ordinalContextReady = true;
        }
      }
    } catch {
      ordinalContextReady = false; // explicit unavailability — never fail open
    }
  }
  // (6) final authoritative liveness re-check immediately before the success envelope.
  if (session.terminated) return deadSessionResult();

  ctx.telemetry.emit({
    event: "session.created",
    sessionId: session.sessionId,
    provider: ctx.realtime.id,
    model: config.openaiModel,
  });
  return {
    status: 200,
    body: {
      sessionId: session.sessionId,
      answerSdp: provider.answerSdp,
      controlToken,
      expiresInSeconds: Math.floor(config.limits.controlTokenMaxAgeMs / 1000),
      // R4 (REREV-10): AUTHORITATIVE, non-secret capability boolean — true ONLY
      // when the verified ordinal context was ACKNOWLEDGED by the provider.
      ordinalContext: ordinalContextReady,
    },
  };
}

// ---- POST /internal/voice/kill handler (DI, unit-tested) --------------------
export function handleKill(ctx: GatewayContext, body: unknown): HandlerResult {
  const res = verifyKillRequest(body, ctx.config, ctx.now);
  if (!res.ok) {
    const status = res.code === "kill_unconfigured" ? 503 : 401;
    return { status, body: { error: res.code } };
  }
  // DISABLE ONLY — cannot re-enable through this endpoint.
  ctx.runtime.killed = true;
  const drained = ctx.store.drainAll();
  ctx.telemetry.emit({ event: "runtime.killed", normalizedResult: "disabled" });
  return { status: 200, body: { ok: true, drained } };
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE-AI-02A — ISOLATED Live-AI context + DI handlers (unit-tested with fakes).
// This context shares NO old-tool executor / sideband / realtime authority.
// ═══════════════════════════════════════════════════════════════════════════
export interface LiveAiGatewayContext {
  config: LiveAiConfig;
  store: LiveAiSessionStore;
  /** R5C — the independent server-side capture-duration ledger. */
  captureLedger: ServerCaptureLedger;
  replay: ReplayStore;
  rateLimiter: RateLimiter;
  telemetry: Telemetry;
  orchestrator: ReturnType<typeof createLiveAiOrchestrator>;
  transcription: TranscriptionAdapter;
  /** R2-13/R3-13 — the atomic budget authority (null ⇒ every provider path, including
   *  the realtime transcription negotiation, fails closed). */
  budget: BudgetAuthority | null;
  /** LIVE-AI-BUDGET-01 (dormant seam) — the DPBEL budget core (null ⇒ dormant). */
  budgetCore: LiveAiBudgetCoreSeam | null;
  runtime: GatewayRuntime;
  limits: LiveAiLimits;
  controlTokenMaxAgeMs: number;
  now: () => number;
  /** LIVE-AI-03B (P1-01) — the staging-text controller entrypoint for a turn.text. It is
   *  constructed unconditionally, but the control path routes to it ONLY when the staging
   *  gate + per-subject allowlist pass (see the handleLiveAiControlFrame injection below).
   *  Default production configuration never reaches it (dormant, text-only, allowlist-only). */
  run03bTextTurn: (session: LiveAiSession, input: { turnId: string; generation: number; transcript: string; language: "hi" | "hinglish" | "en"; context: unknown }) => Promise<void>;
  /** LIVE-AI-03B (P1-06, Stage 2) — route the browser's action.accepted for a RETAINED capability
   *  lifecycle through the RELEASED 03A (`ExecutionSafety.acceptAction`), on the SAME controller. Returns
   *  false when no 03B lifecycle owns this session (the caller then uses the legacy lifecycle). */
  accept03bAction: (session: LiveAiSession, accepted: unknown) => Promise<boolean>;
  /** LIVE-AI-03B (P1-06, Stage 3) — deliver the browser's terminal action.receipt for a RETAINED
   *  lifecycle through the RELEASED 03A (`ExecutionSafety.deliverTerminal`), which performs the IC01
   *  hand-off internally, on the SAME controller. Returns false when no 03B lifecycle owns this session. */
  resume03bObservation: (session: LiveAiSession, receipt: unknown) => Promise<boolean>;
  /** LIVE-AI-03B (P1-07) — interrupt + tear down the active 03B lifecycle (abort provider, revoke
   *  authority, reconcile). Returns false when none is active. */
  interrupt03b: (session: LiveAiSession, reason: string) => Promise<boolean>;
  /** LIVE-AI-03B (P1-06) — whether a retained 03B capability lifecycle currently owns this session. */
  has03bLifecycle: (session: LiveAiSession) => boolean;
  /** LIVE-AI-03B (P1-06 FINAL TEARDOWN) — synchronously revoke EVERY active 03B lifecycle (used by runtime
   *  kill BEFORE store drain). Returns the count revoked; idempotent with the per-session onTerminate hook. */
  teardownAll03b: () => number;
}
// ── LIVE-AI-BUDGET-01 (dormant seam) — the minimal structural surface of the DPBEL
//    budget core the gateway wires. Declared INLINE (no module import) so the fixed
//    file-list gateway compiles are unaffected; the real `createBudgetCore(...)` value
//    satisfies it structurally. Default = null ⇒ dormant (every path fails closed).
export interface LiveAiBudgetPrepareRequest {
  readonly gatewaySessionId: string;
  readonly subjectDigest: string;
  readonly projectId: string;
  readonly acquisitionKey: string;
  readonly maxControlStalenessMs: number;
  readonly leaseTtlMs: number;
  readonly amounts: { readonly moneyMicros: bigint; readonly providerCalls: bigint; readonly executionAdmissions: bigint };
}
export interface LiveAiBudgetCoreSeam {
  prepareProviderLease(req: LiveAiBudgetPrepareRequest): Promise<{ readonly ok: boolean; readonly reason?: string }>;
  prepareExecutionLease(req: LiveAiBudgetPrepareRequest): Promise<{ readonly ok: boolean; readonly reason?: string }>;
  /** P1-01 5A — async persist barrier: durably persist a pending provider child BEFORE the
   *  provider invocation; false ⇒ the caller MUST NOT invoke the provider (fail closed). */
  persistProviderReservation(gatewaySessionId: string, providerTurnId: string): Promise<boolean>;
  /** P0-01B — async POST-SETTLEMENT barrier: durably flush the settlement/revocation AFTER
   *  the local settle; false ⇒ unresolved (local lease left fail-closed). */
  persistProviderSettlement(gatewaySessionId: string, providerTurnId: string): Promise<boolean>;
  reconcileSession(gatewaySessionId: string, opts?: { readonly crash?: boolean }): Promise<void>;
  revokeSession(gatewaySessionId: string, reason: string): void;
  /** P0-01 — authoritative durable revoke (local + durable envelope) so a process-loss replay is refused. */
  revokeSessionDurable(gatewaySessionId: string, reason: string): Promise<void>;
  /** LIVE-AI-03B (additive) — the reasoning-usage provider-spend trio the 03B controller uses.
   *  The real `createBudgetCore(...)` value provides these; declaring them here lets `ctx.budgetCore`
   *  satisfy the controller's narrower `Budget03bPort` without importing the whole core type. */
  quoteReasoning03bWorstCaseMicros(): bigint | null;
  reserveReasoning03b(gatewaySessionId: string, providerTurnId: string): string | null;
  settleUsage(gatewaySessionId: string, providerTurnId: string, usage: {
    readonly inputTokens: number; readonly cachedInputTokens: number; readonly cacheWriteTokens: number;
    readonly outputTokens: number; readonly reasoningTokens: number; readonly totalTokens: number;
  } | null): void;
  providerSpendAuthority(binding: { providerSpendClass: "REASONING" | "TRANSCRIPTION" | "TTS"; gatewaySessionId: string; providerTurnId: string }): BudgetAuthority;
  executionAdmissionGate(gatewaySessionId: string): { admit(input: unknown): { decision: "ADMITTED" | "REFUSED" | "UNAVAILABLE"; budgetAdmissionRef?: string } };
  stop(): void;
}

export interface BuildLiveAiDeps {
  env: GatewayEnv;
  now?: () => number;
  timers?: TimerFacility;
  telemetrySink?: Telemetry;
  transcription?: TranscriptionAdapter;
  reasoning?: ReasoningAdapter;
  tts?: TtsAdapter;
  /** R2-13 — the ATOMIC budget authority. The REAL provider adapters are constructed
   *  ONLY when a budget authority is present (see the fail-closed barrier below): no
   *  DB / distributed store is authorized in this packet, so a production build (which
   *  injects no budget) NEVER constructs a spend-capable adapter and the provider path
   *  fails closed. Tests inject a bounded in-memory authority to exercise the path. */
  budget?: BudgetAuthority | null;
  /** LIVE-AI-BUDGET-01 (dormant seam) — the DPBEL budget core. Default null ⇒ dormant.
   *  When wired, the async lease-preparation seam (prepareLiveAiProviderLease /
   *  prepareLiveAiExecutionLease) installs leases + starts the control watcher, and the
   *  orchestrator obtains call-bound PROVIDER_SPEND facades from it. No provider is
   *  enabled by this seam — a real provider still requires the existing fail-closed barrier. */
  budgetCore?: LiveAiBudgetCoreSeam | null;
  /** LIVE-AI-03B (P1-01) — an OPTIONAL injection bundle for the staging-text controller's
   *  future dependencies, so a test can drive the ACTUAL gateway control path into the 03B
   *  controller with fakes (no real provider). Default undefined ⇒ production constructs the
   *  real fresh IC01 loop + the real provider fetch (only when the 03B TEXT provider is
   *  configured AND a budget core is present — dormant otherwise). 03A execution defaults to
   *  null (capability dispatch fails closed) until it is wired; the TEXT reasoning + compiled
   *  answer path is fully reachable without it. */
  live03b?: {
    budgetCore?: Live03bBudgetPort | null;
    makeLoop?: () => AgentLoopLike;
    execution?: ExecutionSafety | null;
    /** P1-06 (ROOT CAUSE) — the RELEASED-03A factory: given the controller's same-loop capture proxy
     *  (`Ic01LoopPort`), return an `ExecutionSafety` bound to it via `createExecutionSafety`. When present
     *  the capability lifecycle runs end-to-end through 03A (admit→acceptAction→deliverTerminal) and the
     *  IC01 hand-off is performed internally by 03A against the SAME loop this turn drives. */
    makeExecution?: (loopPort: Ic01LoopPort) => ExecutionSafety;
    responsesFetch?: Responses03bFetchLike | null;
    apiKey?: string | null;
  } | null;
  /** P1-07 — an injectable NON-DECREASING monotonic clock (ms) for 03B elapsed/deadline decisions.
   *  Default = the Node performance monotonic clock (NEVER wall-clock Date.now). Tests inject a
   *  deterministic monotonic source. */
  monotonicNowMs?: () => number;
}
/** REV-13 — bounded per-provider-call deadline (ms) for reasoning/TTS. */
export const LIVE_AI_PROVIDER_DEADLINE_MS = 20_000;
// LIVE-AI-03B (P1-01) — staging-text controller wiring constants (dormant unless configured).
export const LIVE_AI_03B_PROJECT_ID = "live-ai-03b" as const;
export const LIVE_AI_03B_LEASE_TTL_MS = 60_000;
export const LIVE_AI_03B_CONTROL_STALENESS_MS = 15_000;
// R4-13 — the realtime transcription reservation is TIED TO THE HARD MAXIMUM CAPTURE-DURATION
// model, not an arbitrary figure. The client media owner enforces a hard cumulative
// capture-duration ceiling (MAX_SESSION_CAPTURE_MS = 180_000 ms in lib/live-ai/gateway-client.ts),
// so at most MAX_CAPTURE_SECONDS of audio can ever be transcribed in one session. The
// reservation is a DOCUMENTED conservative mapping = that duration × a per-second unit rate,
// a HARD upper bound on admitted transcription usage. Realtime negotiation surfaces no discrete
// per-call usage figure, so the reservation is retained (settle null) after the call.
export const MAX_CAPTURE_SECONDS = 180;
export const TRANSCRIPTION_UNITS_PER_SECOND = 50;
export const RESERVE_TRANSCRIPTION_UNITS = MAX_CAPTURE_SECONDS * TRANSCRIPTION_UNITS_PER_SECOND;

export function buildLiveAiContext(deps: BuildLiveAiDeps): LiveAiGatewayContext {
  const now = deps.now || (() => Date.now());
  const full = loadGatewayConfig(deps.env);
  const config = full.liveAi;
  const limits: LiveAiLimits = { ...DEFAULT_LIVE_AI_LIMITS };
  // R5C — the INDEPENDENT server capture ledger (process-local). The store's onTerminate
  // finalizes the session's active capture segment on EVERY termination path; the ledger's
  // onSegmentExpired (20s server cap) terminates the session. The two reference each other,
  // so `captureLedger` is a forward `let` captured by the store's onTerminate closure
  // (only invoked at terminate time, after assignment).
  let captureLedger: ServerCaptureLedger;
  const store = createLiveAiSessionStore({
    limits,
    now,
    timers: deps.timers,
    onTerminate: (s) => {
      // R5C — finalize the capture segment on EVERY termination path (unchanged, must not be dropped).
      try { captureLedger.finalizeSegment(s.subject, s.gatewaySessionId, "partial"); } catch { /* no-op */ }
      // LIVE-AI-03B (P1-06 FINAL TEARDOWN) — the SAME central teardown owner runs for EVERY termination reason
      // (idle / hard / control-attach timeout, explicit store.terminate, control-socket-close termination,
      // drainAll / runtime kill). teardown03b removes the active03b entry + aborts the turn SYNCHRONOUSLY before
      // its first await, so a suspended capability or AWAITING_TERMINAL lifecycle can NEVER outlive its authority
      // owner; the released 03A ExecutionSafety is interrupted and conservative BUDGET reconciliation runs via the
      // accepted controller finish path. Fire-and-forget (no in-flight-promise dependency) and idempotent — inert
      // when no 03B lifecycle owns the session (e.g. a normal true-terminal already cleaned it).
      try { void teardown03b(s.gatewaySessionId, "session_terminated", { reconcile: true }); } catch { /* never break store teardown */ }
    },
  });
  captureLedger = createServerCaptureLedger({
    now,
    timers: deps.timers,
    onSegmentExpired: (_subject, sessionKey) => { const s = store.get(sessionKey); if (s && !s.terminated) store.terminate(s, "timeout"); },
  });
  const replay = createReplayStore(now);
  const rateLimiter = createRateLimiter({ limits: full.limits, now });
  const telemetry = deps.telemetrySink || createTelemetry();

  // REV-02 — PROVIDER-CAPABLE adapters: when (and only when) the provider is fully
  // configured (server-only key + the EXACT allowlisted models), construct the REAL
  // fixed-endpoint adapters, so "configured" means a genuinely usable adapter, not
  // just that strings exist. Otherwise the fail-closed unavailable trio is used.
  // Injected test adapters always win (fakes; no real network). The server-only key
  // is read here and NEVER leaves the gateway. Dormant by default (no key ⇒ null).
  //
  // R2-13 — FAIL-CLOSED ACTIVATION BARRIER: a REAL, spend-capable adapter is built
  // ONLY when a BUDGET AUTHORITY is also injected. No DB / distributed store is
  // authorized in this packet, so a default production build injects no budget →
  // `apiKey` collapses to null → every real adapter stays UNAVAILABLE and the
  // provider path fails closed (no uncontrolled provider spend). Injected test
  // adapters (fakes) still win and need no key/budget. `budget` flows to the
  // orchestrator so its reserve→call→settle path is honoured for every provider call.
  const budget: BudgetAuthority | null = deps.budget || null;
  // LIVE-AI-BUDGET-01 (dormant seam) — the DPBEL core, if wired. Default null ⇒ dormant;
  // its presence NEVER activates a provider (the fail-closed key barrier below is unchanged).
  const budgetCore: LiveAiBudgetCoreSeam | null = deps.budgetCore || null;
  const rawKey = typeof deps.env.OPENAI_API_KEY === "string" && deps.env.OPENAI_API_KEY.trim() ? deps.env.OPENAI_API_KEY : null;
  const apiKey = (liveAiProviderConfigured(config) && budget) ? rawKey : null;
  const reasoningCall = apiKey ? createDefaultReasoningCall(apiKey) : null;
  const ttsCall = apiKey ? createDefaultTtsCall(apiKey) : null;
  const sttSeam = apiKey ? createDefaultTranscriptionSeam(apiKey) : null;
  const reasoning = deps.reasoning || (reasoningCall ? createReasoningAdapter({ model: config.reasoningModel, call: reasoningCall }) : unavailableReasoning);
  const tts = deps.tts || (ttsCall ? createTtsAdapter({ model: config.ttsModel, call: ttsCall }) : unavailableTts);
  const transcription = deps.transcription || (sttSeam ? createTranscriptionAdapter({ model: config.sttModel, call: sttSeam.call, negotiate: sttSeam.negotiate }) : unavailableTranscription);

  const orchestrator = createLiveAiOrchestrator({
    reasoning,
    tts,
    store,               // R2-05/R2-07/R2-08 — proposal registry + pending-plan state
    budget,              // R2-13 — atomic budget authority (null ⇒ provider fails closed)
    budgetCore,          // LIVE-AI-BUDGET-01 (dormant) — call-bound facades when wired
    now,
    deadlineMs: LIVE_AI_PROVIDER_DEADLINE_MS, // REV-13 per-provider-call deadline
    setTimer: deps.timers ? (fn, ms) => deps.timers!.set(fn, ms) : undefined,
    clearTimer: deps.timers ? (h) => deps.timers!.clear(h) : undefined,
  });

  const runtime: GatewayRuntime = { killed: false };
  // P1-07 — a NON-DECREASING monotonic clock authority for 03B (NEVER wall-clock Date.now).
  const monotonicNowMs: () => number = deps.monotonicNowMs || (() => nodePerformance.now());

  // ── LIVE-AI-03B — staging-text controller entrypoint + bounded active-turn lifecycle ─────
  // A turn.text for an ALLOWLISTED staging subject is CLASSIFIED once (P1-03) as 03B or LEGACY.
  // 03B never falls back to the legacy orchestrator / answer.plan; a 03B turn with any missing
  // mandatory authority (budget core / coherent ACK binding / provider admission) is a CLOSED 03B
  // failure. The controller is RETAINED across a capability suspension (P1-06) and its provider
  // call is causally bound to session + turn interrupt (P1-07). DORMANT by default configuration.
  const apiKey03bDefault = (liveAi03bTextProviderConfigured(config) && budgetCore) ? rawKey : null;
  const realResponsesFetch: Responses03bFetchLike = async (url, init) => {
    const r = await fetch(url, init as RequestInit);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
  interface Active03bLifecycle { controller: Controller03b; req: Text03bTurnRequest; abort: AbortController; }
  const active03b = new Map<string, Active03bLifecycle>();   // ≤1 per gatewaySessionId; cleaned on terminal/interrupt/end
  const emit03bError = (session: LiveAiSession, input: { turnId: string; generation: number }, code: string) => {
    try { session.emit?.({ t: "turn.error", sessionId: session.sessionId, turnId: input.turnId, generation: input.generation, code }); } catch { /* no-op */ }
  };
  async function teardown03b(gatewaySessionId: string, reason: string, opts: { reconcile: boolean }): Promise<void> {
    const a = active03b.get(gatewaySessionId);
    if (!a) return;
    active03b.delete(gatewaySessionId);                        // bound memory — no retained-controller leak
    try { a.abort.abort(); } catch { /* no-op */ }
    try { await a.controller.interrupt(a.req, reason); } catch { /* no-op */ }
    if (opts.reconcile) { try { await a.controller.finish(a.req, false); } catch { /* best-effort */ } }
  }
  // P1-06 — reconcile ONLY on a genuine terminal; NEVER merely because a turn suspended. If the
  // lifecycle was interrupted/superseded while the turn ran, this entry is no longer current → no-op.
  async function settle03bOutcome(session: LiveAiSession, entry: Active03bLifecycle, outcome: TurnOutcome): Promise<void> {
    if (active03b.get(session.gatewaySessionId) !== entry) return;         // interrupted/superseded meanwhile
    if (outcome.state === "AWAITING_CAPABILITY") return;                   // retain (already registered), do NOT reconcile
    active03b.delete(session.gatewaySessionId);
    try { await entry.controller.finish(entry.req, false); } catch { /* best-effort */ }
  }

  const run03bTextTurn: LiveAiGatewayContext["run03bTextTurn"] = async (session, input) => {
    // P1-03 — classify the route EXACTLY ONCE. Not an allowlisted staging subject ⇒ LEGACY.
    const is03b = liveAi03bStagingTextConfigured(config) && liveAi03bStagingSubjectAllowed(config, session.subject);
    if (!is03b) {
      await orchestrator.runTurn(session, { turnId: input.turnId, generation: input.generation, transcript: input.transcript, language: input.language, context: input.context, phase: "initial" });
      return;
    }
    // From here the turn is 03B-OWNED: every missing mandatory authority is a CLOSED 03B failure.
    // NEVER orchestrator.runTurn, NEVER answer.plan, NEVER raw provider text.
    const budgetForCtrl: Live03bBudgetPort | null = deps.live03b && deps.live03b.budgetCore !== undefined ? deps.live03b.budgetCore : budgetCore;
    if (!budgetForCtrl) { emit03bError(session, input, "unavailable"); return; }
    // P1-04 — the TrustedBinding MUST be the already-acknowledged context authority. No reconstruction.
    const bound = build03bBinding(session, input, store);
    if (!bound.ok) { emit03bError(session, input, "stale"); return; }
    // supersede any prior active 03B lifecycle for this session (a new turn replaces it).
    await teardown03b(session.gatewaySessionId, "superseded", { reconcile: true });
    const apiKey03b = deps.live03b && deps.live03b.apiKey !== undefined ? deps.live03b.apiKey : apiKey03bDefault;
    const responsesFetch = deps.live03b && deps.live03b.responsesFetch !== undefined ? deps.live03b.responsesFetch : (apiKey03b ? realResponsesFetch : null);
    const execution: ExecutionSafety | null = deps.live03b && deps.live03b.execution !== undefined ? deps.live03b.execution : null;
    const loop = deps.live03b && deps.live03b.makeLoop
      ? deps.live03b.makeLoop()
      : createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", mintId: (kind, seq) => `ic01-${kind}-${seq}-${randomUUID()}`, telemetry: () => { /* no-op */ } });
    // P1-07 — the provider AbortSignal is causally bound to BOTH the session abort AND this turn's
    // interrupt controller, so turn.interrupt / reset / end / kill abort an in-flight provider fetch.
    const turnAbort = new AbortController();
    const makeAbortSignal = (): AbortSignal => {
      if (session.abort?.signal?.aborted || turnAbort.signal.aborted) { const a = new AbortController(); a.abort(); return a.signal; }
      const linked = new AbortController();
      const onAbort = () => { try { linked.abort(); } catch { /* no-op */ } };
      try { session.abort?.signal?.addEventListener("abort", onAbort, { once: true }); } catch { /* no-op */ }
      turnAbort.signal.addEventListener("abort", onAbort, { once: true });
      return linked.signal;
    };
    const req: Text03bTurnRequest = {
      gatewaySessionId: session.gatewaySessionId, subjectDigest: session.subject, projectId: LIVE_AI_03B_PROJECT_ID,
      binding: bound.binding, userText: input.transcript, language: input.language, role: bound.binding.role, context: session.lastContext,
    };
    const makeExecution03b = deps.live03b && deps.live03b.makeExecution ? deps.live03b.makeExecution : undefined;
    const controller = create03bController({
      loop, budgetCore: budgetForCtrl, execution, makeExecution: makeExecution03b, responsesFetch, apiKey: apiKey03b,
      emit: (frame: CompiledAnswerFrameOut) => { try { session.emit?.(frame as unknown as Record<string, unknown>); } catch { /* hostile sink never breaks the turn */ } },
      now,
      monotonicNowMs,                                   // legacy fallback for turnClock
      turnClock: monotonicNowMs,                         // P1-07 (ROOT CAUSE) — THE single monotonic clock for the whole IC01+03A lifecycle (never Date.now)
      isKilled: () => runtime.killed || session.terminated || turnAbort.signal.aborted || !!session.abort?.signal?.aborted,
      stagingEnabled: true,
      leaseTtlMs: LIVE_AI_03B_LEASE_TTL_MS,
      maxControlStalenessMs: LIVE_AI_03B_CONTROL_STALENESS_MS,
      mintId: (kind: string) => `${kind}_${randomUUID()}`,
      maxProviderCalls: config.stagingFirstProbeOneCall ? 1 : undefined,
      makeAbortSignal,
      // P1-06 (a) — emit the EXACT action.proposal shape: top-level t/sessionId/turnId/generation/authorityRef
      // + the gateway commitments executionNonce/receiptId, and a NESTED proposal carrying ONLY
      // proposalId/providerTurnId/operation (never the whole ExecutionAdmission).
      onCapabilityAdmitted: (admission) => {
        try {
          const a = admission as { proposalId?: unknown; providerTurnId?: unknown; capabilityId?: unknown; executionNonce?: unknown; receiptId?: unknown; normalizedArgs?: Record<string, unknown> };
          // P1-06 (a) — `operation` is the canonical LiveAiOperation ENVELOPE `{ op, ...normalizedArgs }`
          // (the registry-normalized args carry exactly the op's allowed keys), so the emitted action.proposal
          // is a valid protocol ServerFrame the browser validates. NEVER the whole ExecutionAdmission.
          const opEnvelope = { ...(a.normalizedArgs && typeof a.normalizedArgs === "object" ? a.normalizedArgs : {}), op: a.capabilityId };
          session.emit?.({
            t: "action.proposal", sessionId: session.sessionId, turnId: bound.binding.turnId,
            generation: bound.binding.generation, authorityRef: bound.binding.authorityRef,
            executionNonce: a.executionNonce, receiptId: a.receiptId,
            proposal: { proposalId: a.proposalId, providerTurnId: a.providerTurnId, operation: opEnvelope },
          } as unknown as Record<string, unknown>);
        } catch { /* no-op */ }
      },
    });
    const entry: Active03bLifecycle = { controller, req, abort: turnAbort };
    active03b.set(session.gatewaySessionId, entry);     // register BEFORE the turn runs, so an interrupt DURING the provider fetch can abort it (P1-07)
    const outcome = await controller.beginTextTurn(req);
    await settle03bOutcome(session, entry, outcome);   // P1-06 — retain on AWAITING_CAPABILITY; reconcile only on genuine terminal
  };

  const accept03bAction: LiveAiGatewayContext["accept03bAction"] = async (session, accepted) => {
    const entry = active03b.get(session.gatewaySessionId);
    if (!entry) return false;                            // no 03B lifecycle owns this event → caller uses legacy
    const outcome = await entry.controller.acceptCapability(entry.req, accepted);
    await settle03bOutcome(session, entry, outcome);    // stays AWAITING_CAPABILITY on success (retained)
    return true;
  };
  const resume03bObservation: LiveAiGatewayContext["resume03bObservation"] = async (session, receipt) => {
    const entry = active03b.get(session.gatewaySessionId);
    if (!entry) return false;                            // no 03B lifecycle owns this event → caller uses legacy
    const outcome = await entry.controller.resumeWithObservation(entry.req, receipt);
    await settle03bOutcome(session, entry, outcome);    // may suspend again (nested capability) or terminate
    return true;
  };
  const interrupt03b: LiveAiGatewayContext["interrupt03b"] = async (session, reason) => {
    if (!active03b.has(session.gatewaySessionId)) return false;
    await teardown03b(session.gatewaySessionId, reason, { reconcile: true });
    return true;
  };
  const has03bLifecycle: LiveAiGatewayContext["has03bLifecycle"] = (session) => active03b.has(session.gatewaySessionId);
  // LIVE-AI-03B (P1-06 FINAL TEARDOWN, §5) — explicitly revoke EVERY active 03B lifecycle. The runtime kill path
  // calls this BEFORE store.drainAll(), so no 03B authority survives a kill even if drain ordering changes; the
  // per-session onTerminate hook also calls teardown03b, but teardown03b is idempotent so the double signal is
  // inert. Each teardown03b removes its active03b entry + aborts SYNCHRONOUSLY inside this forEach (before its
  // first await), so on return every entry is gone; the conservative budget reconcile is fire-and-forget.
  const teardownAll03b: LiveAiGatewayContext["teardownAll03b"] = () => {
    const ids = Array.from(active03b.keys());
    ids.forEach((id) => { try { void teardown03b(id, "runtime_killed", { reconcile: true }); } catch { /* no-op */ } });
    return ids.length;
  };

  return {
    config,
    store,
    captureLedger,
    replay,
    rateLimiter,
    telemetry,
    orchestrator,
    transcription,
    budget,                // R3-13 — reserve→settle the realtime negotiation (null ⇒ fail closed)
    budgetCore,            // LIVE-AI-BUDGET-01 (dormant) — DPBEL core (null ⇒ dormant)
    runtime,
    limits,
    controlTokenMaxAgeMs: full.limits.controlTokenMaxAgeMs,
    now,
    run03bTextTurn,
    accept03bAction,
    resume03bObservation,
    interrupt03b,
    has03bLifecycle,
    teardownAll03b,
  };
}

/** LIVE-AI-03B (P1-04) — derive the TrustedBinding for a 03B turn EXCLUSIVELY from the already
 *  acknowledged context authority (session ACK state + the store's authorityRef algorithm). NO
 *  JSON.stringify, NO invented defaults. Requires a CURRENT, coherent ACK whose tuple turnId equals
 *  the incoming turnId, whose contextDigest matches, whose pageId/role come from the SAME strictly
 *  validated acknowledged PublishedContext, and whose recomputed authorityRef (for the incoming
 *  generation) equals the stored ackAuthorityRef exactly. Any missing/malformed/stale field ⇒ fail. */
function build03bBinding(
  session: LiveAiSession,
  input: { turnId: string; generation: number },
  store: LiveAiSessionStore,
): { ok: true; binding: TrustedBinding } | { ok: false } {
  const ackRef = session.ackAuthorityRef, ackTuple = session.ackTuple, ackDigest = session.ackContextDigest;
  if (typeof ackRef !== "string" || !ackRef) return { ok: false };
  if (typeof ackTuple !== "string" || !ackTuple) return { ok: false };
  if (typeof ackDigest !== "string" || !ackDigest) return { ok: false };
  if (typeof input.turnId !== "string" || !input.turnId) return { ok: false };
  if (typeof input.generation !== "number" || !Number.isInteger(input.generation) || input.generation < 0) return { ok: false };
  // ackTuple = `${turnId}|${routeEpoch}|${contextRevision}` — split on the FIRST TWO bars only
  // (contextRevision may itself contain a bar; turnId is an id and routeEpoch is numeric, so they cannot).
  const bar1 = ackTuple.indexOf("|"); if (bar1 <= 0) return { ok: false };
  const rest = ackTuple.slice(bar1 + 1); const bar2 = rest.indexOf("|"); if (bar2 < 0) return { ok: false };
  const ackTurnId = ackTuple.slice(0, bar1);
  const routeEpochStr = rest.slice(0, bar2);
  const contextRevision = rest.slice(bar2 + 1);
  if (ackTurnId !== input.turnId) return { ok: false };                    // tuple turnId must equal incoming turnId
  const routeEpoch = Number(routeEpochStr);
  if (!Number.isInteger(routeEpoch) || routeEpoch < 0) return { ok: false };
  if (!contextRevision) return { ok: false };
  // pageId + role ONLY from the strictly-validated acknowledged PublishedContext.
  const ctx = session.lastContext;
  if (!ctx || typeof ctx !== "object") return { ok: false };
  const pageIdRaw = (ctx as Record<string, unknown>).pageId;
  const roleRaw = (ctx as Record<string, unknown>).role;
  if (pageIdRaw !== "hotels" && pageIdRaw !== "hotel-detail") return { ok: false };
  if (roleRaw !== "anonymous" && roleRaw !== "customer") return { ok: false };
  // recompute the authorityRef for the INCOMING generation via the accepted store algorithm and
  // require exact equality with the stored ackAuthorityRef (coherence of turn/generation/context).
  const expected = store.computeAuthorityRef(session, input.turnId, input.generation, routeEpoch, contextRevision, ackDigest);
  if (expected !== ackRef) return { ok: false };
  return {
    ok: true,
    binding: {
      sessionId: session.sessionId,
      turnId: input.turnId,
      generation: input.generation,
      pageId: pageIdRaw,
      role: roleRaw,
      routeEpoch,
      contextRevision,
      authorityRef: ackRef,
      contextDigest: ackDigest,
    },
  };
}

// ── LIVE-AI-BUDGET-01 (dormant) — async lease-preparation + reconciliation seam ──
// The ONLY places a durable budget envelope is acquired / reconciled / revoked. Each is
// a NO-OP when the budget core is dormant (null), so a default production build never
// touches a store, mints a lease, or enables any provider. The control watcher lifecycle
// is owned by the core (started at prepare, stopped at reconcile).
export async function prepareLiveAiProviderLease(ctx: LiveAiGatewayContext, req: LiveAiBudgetPrepareRequest): Promise<{ ok: boolean; reason?: string }> {
  if (!ctx.budgetCore) return { ok: false, reason: "dormant" };
  try { return await ctx.budgetCore.prepareProviderLease(req); } catch { return { ok: false, reason: "prepare_error" }; }
}
export async function prepareLiveAiExecutionLease(ctx: LiveAiGatewayContext, req: LiveAiBudgetPrepareRequest): Promise<{ ok: boolean; reason?: string }> {
  if (!ctx.budgetCore) return { ok: false, reason: "dormant" };
  try { return await ctx.budgetCore.prepareExecutionLease(req); } catch { return { ok: false, reason: "prepare_error" }; }
}
export async function reconcileLiveAiBudget(ctx: LiveAiGatewayContext, gatewaySessionId: string, opts?: { crash?: boolean }): Promise<void> {
  if (!ctx.budgetCore) return;
  try { await ctx.budgetCore.reconcileSession(gatewaySessionId, opts); } catch { /* best-effort; a failed reconcile leaves the envelope held (conservative) */ }
}
export async function revokeLiveAiBudget(ctx: LiveAiGatewayContext, gatewaySessionId: string, reason: string): Promise<void> {
  if (!ctx.budgetCore) return;
  // P0-01 — authoritative durable revoke (local + durable envelope) so a process-loss replay is refused.
  try { await ctx.budgetCore.revokeSessionDurable(gatewaySessionId, reason); } catch { /* local stays revoked */ }
}

export async function handleLiveAiSessionCreate(ctx: LiveAiGatewayContext, input: SessionCreateInput): Promise<HandlerResult> {
  const { config } = ctx;
  // 1) R gate (fail closed) + kill switch.
  if (!config.runtimeEnabled || ctx.runtime.killed) return { status: 503, body: { error: "runtime_disabled" } };
  // 2) P1-02 — a CHEAP fail-closed presence guard: SOMETHING must be configured for SOME mode
  //    (the broad voice provider OR the 03B text provider). The PRECISE, mode-specific provider
  //    requirement is applied AFTER the body/mode + assertion are validated (below), so a text/03B
  //    session is never blocked merely because an unrelated STT/TTS model is absent.
  if (!liveAiSessionCreateConfigured(config) && !liveAi03bStagingTextConfigured(config)) return { status: 503, body: { error: "unconfigured" } };
  // 3) body (mode + browser-owned sessionId + bounded SDP for mic) — validated BEFORE mode selection.
  const body = validateLiveAiSessionBody(input.body);
  if (!body) return { status: 400, body: { error: "invalid_body" } };
  // 4) assertion (Bearer) — the EXACT live-ai:read-ui-local scope, Live-AI signing keys.
  const bearer = /^Bearer (.+)$/i.exec(input.authorization || "");
  if (!bearer) return { status: 401, body: { error: "assertion_missing" } };
  const verified = await verifyLiveAiAssertion(bearer[1], { signingPublicKey: config.signingPublicKey, issuer: config.issuer, audience: config.audience }, ctx.replay);
  if (!verified.ok) {
    const status = verified.code === "assertion_unconfigured" ? 503 : 401;
    return { status, body: { error: verified.code } };
  }
  const assertion = verified.assertion;
  // 5) origin allowlist — the SIGNED origin claim vs the Live-AI allowlist (never `*`).
  if (!isAllowedOrigin(assertion.origin, config.allowedOrigins)) return { status: 403, body: { error: "origin_not_allowed" } };
  // 5b) P1-02 — MODE-SPECIFIC provider requirement (after the body/mode + all non-voice security
  //     prerequisites are validated). Microphone keeps the BROAD voice requirement (STT+reasoning+
  //     TTS) UNCHANGED. A text session may proceed when the 03B TEXT provider + staging gate are
  //     valid AND the authenticated subject is allowlisted, EVEN IF STT/TTS are absent/invalid;
  //     otherwise it falls back to legacy text ONLY when the complete legacy prerequisites are
  //     independently met, else fails closed.
  if (body.mode === "microphone") {
    if (!liveAiSessionCreateConfigured(config)) return { status: 503, body: { error: "unconfigured" } };
  } else {
    const is03bText = liveAi03bStagingTextConfigured(config) && liveAi03bStagingSubjectAllowed(config, assertion.subject);
    if (!is03bText && !liveAiSessionCreateConfigured(config)) return { status: 503, body: { error: "unconfigured" } };
  }
  // 6) start-limit + concurrency.
  const ipHash = hashIp(input.ip || "0.0.0.0", config.ipHashSalt as string);
  const startKey = assertion.authenticated ? `sub:${assertion.subject}` : `ip:${ipHash}`;
  const start = ctx.rateLimiter.checkStart(startKey, assertion.authenticated);
  if (!start.ok) return { status: 429, body: { error: start.reason } };
  const created = ctx.store.create({ sessionId: body.sessionId, subject: assertion.subject, ipHash, authenticated: assertion.authenticated });
  if (!created.ok) return { status: 429, body: { error: created.reason } };
  const session = created.session;
  // 7) control token bound to the gateway session id (Live-AI HMAC secret).
  const controlToken = mintControlTokenWithSecret(session.gatewaySessionId, assertion.subject, config.controlTokenSecret, ctx.controlTokenMaxAgeMs, ctx.now);
  if (!controlToken) { ctx.store.terminate(session, "closed"); return { status: 503, body: { error: "control_unconfigured" } }; }
  ctx.telemetry.emit({ event: "session.created", sessionId: session.sessionId, provider: "openai", model: config.reasoningModel });
  // REV-03 — microphone mode: exchange the bounded SDP offer for the provider's
  // bounded SDP answer via the fixed Realtime negotiation seam. Dormant by default
  // (the seam is unavailable without a key), so a mic start fails closed here; when
  // the provider is configured the browser receives the answer and the peer
  // connection completes (transcripts then flow to the browser and are submitted as
  // turn.text over the control socket).
  const out: Record<string, unknown> = {
    sessionId: session.sessionId,
    gatewaySessionId: session.gatewaySessionId,
    controlToken,
    expiresInSeconds: Math.floor(ctx.controlTokenMaxAgeMs / 1000),
  };
  if (body.mode === "microphone") {
    // R3-13 / P1-02 D — reserve budget BEFORE the realtime provider negotiation (reserve→
    // call→settle). Realtime transcription MUST NOT bypass BUDGET-01: when the DPBEL core
    // is wired, the reservation is taken through the CALL-BOUND PROVIDER_SPEND
    // (TRANSCRIPTION) facade — a GATEWAY-OWNED providerTurnId (never caller-chosen) —
    // otherwise the legacy atomic budget authority. No authority ⇒ REFUSED (fail closed):
    // the SAME activation barrier as reasoning/TTS; a billable realtime call is never
    // negotiated without a live reservation. Realtime negotiation surfaces no discrete
    // per-call usage figure, so the reservation is RETAINED (settle null), never fabricated.
    const micProviderTurnId = `${session.gatewaySessionId}:mic`;
    const budget: BudgetAuthority | null = ctx.budgetCore
      ? ctx.budgetCore.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: session.gatewaySessionId, providerTurnId: micProviderTurnId })
      : ctx.budget;
    if (!budget) { ctx.store.terminate(session, "closed"); return { status: 503, body: { error: "realtime_unavailable" } }; }
    let rres: string | null = null;
    try { rres = budget.reserve(session.gatewaySessionId, RESERVE_TRANSCRIPTION_UNITS); } catch { rres = null; }
    if (rres === null) { ctx.store.terminate(session, "closed"); return { status: 503, body: { error: "realtime_unavailable" } }; }
    // P1-01 5A — durably persist the provider child BEFORE the realtime negotiation; a
    // persistence failure/ambiguity ⇒ NO provider invocation (fail closed).
    if (ctx.budgetCore) {
      let persisted = false;
      try { persisted = await ctx.budgetCore.persistProviderReservation(session.gatewaySessionId, micProviderTurnId); } catch { persisted = false; }
      if (!persisted) { try { budget.settle(rres, null); } catch { /* conservative retention */ } ctx.store.terminate(session, "closed"); return { status: 503, body: { error: "realtime_unavailable" } }; }
    }
    const neg = await ctx.transcription.negotiate(body.sdp, { signal: session.abort.signal, deadlineMs: LIVE_AI_PROVIDER_DEADLINE_MS });
    try { budget.settle(rres, null); } catch { /* conservative retention */ }
    // P0-01B — durable POST-SETTLEMENT barrier for the realtime transcription call (fail-closed
    // inside the core: an unresolved settlement leaves the lease revoked, no fresh authority).
    if (ctx.budgetCore) { try { await ctx.budgetCore.persistProviderSettlement(session.gatewaySessionId, micProviderTurnId); } catch { /* core fails closed */ } }
    if (!neg.ok) { ctx.store.terminate(session, "closed"); return { status: 503, body: { error: "realtime_unavailable" } }; }
    // R5C — mic-negotiation SUCCESS begins the INDEPENDENT server capture segment
    // (identity = the trusted authenticated subject + this gateway session). The ledger
    // enforces the ≤20s-per-segment / ≤180s-cumulative caps with the server clock and NEVER
    // trusts any browser-reported duration. Refused (cumulative exhausted for the subject /
    // capacity / broken) ⇒ the mic session FAILS CLOSED (a second independent enforcer).
    const seg = ctx.captureLedger.beginSegment(assertion.subject, session.gatewaySessionId);
    if (!seg.ok) { ctx.store.terminate(session, "closed"); return { status: 503, body: { error: "realtime_unavailable" } }; }
    out.answerSdp = neg.answerSdp;
  }
  return { status: 200, body: out };
}

export function handleLiveAiKill(ctx: LiveAiGatewayContext, body: unknown): HandlerResult {
  const res = verifyKillRequestWithSecret(body, ctx.config.killSwitchSecret, ctx.now);
  if (!res.ok) {
    const status = res.code === "kill_unconfigured" ? 503 : 401;
    return { status, body: { error: res.code } };
  }
  ctx.runtime.killed = true; // DISABLE ONLY — no enable path.
  // LIVE-AI-03B (P1-06 FINAL TEARDOWN, §5) — revoke every active 03B lifecycle BEFORE the store drain, so no
  // suspended/AWAITING_TERMINAL 03B authority can survive the runtime kill (belt-and-suspenders with onTerminate).
  const revoked03b = ctx.teardownAll03b();
  const drained = ctx.store.drainAll();
  ctx.telemetry.emit({ event: "runtime.killed", normalizedResult: "disabled" });
  return { status: 200, body: { ok: true, drained, revoked03b } };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fastify wiring (thin adapter over the DI handlers above).
// ═══════════════════════════════════════════════════════════════════════════
export async function buildGateway(deps: BuildContextDeps): Promise<{ app: FastifyInstance; ctx: GatewayContext; liveAiCtx: LiveAiGatewayContext }> {
  const ctx = buildContext(deps);
  // ISOLATED Live-AI context (dormant adapters by default — no old-tool authority).
  // P1-01 — forward every 03B/Budget/03A/monotonic runtime dependency the caller supplied, so a
  // separately-authorized staging activation needs NO further source change. Default: none ⇒ dormant.
  const liveAiCtx = buildLiveAiContext({
    env: deps.env, now: deps.now, timers: deps.timers,
    budget: deps.liveAi?.budget ?? null,
    budgetCore: deps.liveAi?.budgetCore ?? null,
    reasoning: deps.liveAi?.reasoning,
    tts: deps.liveAi?.tts,
    transcription: deps.liveAi?.transcription,
    live03b: deps.liveAi?.live03b ?? null,
    monotonicNowMs: deps.liveAi?.monotonicNowMs,
  });
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY_BYTES });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
  });
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 8 * 1024 },
  });

  app.get("/healthz", async () => ({ ok: true, config: safeConfigSummary(ctx.config) }));

  app.post("/v1/voice/sessions", async (req, reply) => {
    const result = await handleSessionCreate(ctx, {
      origin: req.headers.origin,
      ip: req.ip,
      authorization: req.headers.authorization,
      body: req.body,
    });
    reply.status(result.status).send(result.body);
  });

  app.post("/internal/voice/kill", async (req, reply) => {
    const result = handleKill(ctx, req.body);
    reply.status(result.status).send(result.body);
  });

  app.get("/v1/voice/sessions/:sid/control", { websocket: true }, (socket: any, req) => {
    const sid = (req.params as { sid: string }).sid;
    const gwSocket: GatewaySocket = {
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
    };
    const opened = authorizeControlOpen({
      subprotocol: req.headers["sec-websocket-protocol"],
      sessionId: sid,
      config: ctx.config,
      store: ctx.store,
      now: ctx.now,
    });
    if (!opened.ok) {
      gwSocket.close(opened.closeCode, opened.code);
      return;
    }
    const session = opened.session;
    const emit = makeSocketEmit(gwSocket);
    // Bind the runtime emitter + control-close handle so sideband events reach the
    // browser and terminate() can close this socket.
    ctx.store.bindRuntime(session, emit, () => {
      try {
        socket.close(1000);
      } catch {
        /* no-op */
      }
    });
    socket.on("message", (raw: unknown) => {
      const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
      handleControlFrame({ raw: text, session, store: ctx.store, socket: gwSocket, emit });
    });
    // A control-socket disconnect releases the session's resources.
    socket.on("close", () => {
      ctx.store.close(session.sessionId);
    });
  });

  // ── ISOLATED Live-AI routes (never wired to the old tool executor/sideband) ──
  app.post("/v1/live-ai/sessions", async (req, reply) => {
    const result = await handleLiveAiSessionCreate(liveAiCtx, {
      origin: req.headers.origin,
      ip: req.ip,
      authorization: req.headers.authorization,
      body: req.body,
    });
    reply.status(result.status).send(result.body);
  });

  app.post("/internal/live-ai/kill", async (req, reply) => {
    const result = handleLiveAiKill(liveAiCtx, req.body);
    reply.status(result.status).send(result.body);
  });

  app.get("/v1/live-ai/sessions/:sid/control", { websocket: true }, (socket: any, req) => {
    const sid = (req.params as { sid: string }).sid;
    const gwSocket: LiveAiGatewaySocket = {
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
    };
    const opened = authorizeLiveAiControlOpen({
      subprotocol: req.headers["sec-websocket-protocol"],
      gatewaySessionId: sid,
      controlTokenSecret: liveAiCtx.config.controlTokenSecret,
      controlTokenMaxAgeMs: liveAiCtx.controlTokenMaxAgeMs,
      store: liveAiCtx.store,
      now: liveAiCtx.now,
    });
    if (!opened.ok) {
      gwSocket.close(opened.closeCode, opened.code);
      return;
    }
    const session = opened.session;
    const emit = makeLiveAiEmit(gwSocket);
    // R2-01 — EXACTLY ONE control attachment. bindRuntime atomically CLAIMS the
    // session's single, one-use control attachment. A second concurrent attach (or a
    // control-token replay after the first socket closed) returns false: we close THIS
    // socket WITHOUT touching the live session — no connection.ready, no message
    // handler, and crucially no close→terminate handler that would kill the legitimate
    // socket's session. The prior socket's callbacks stay authoritative.
    const claimed = liveAiCtx.store.bindRuntime(session, emit, () => {
      try { socket.close(1000); } catch { /* no-op */ }
    });
    if (!claimed) {
      try { gwSocket.close(4409, "control_conflict"); } catch { /* no-op */ }
      return;
    }
    // REV-01 — the authenticated control socket is bound: emit connection.ready so the
    // browser proceeds to publish context (it waits for this real frame — no injected
    // test frame). A late/duplicate ready is harmless (the browser ignores a mismatch).
    emit({ t: "connection.ready", sessionId: session.sessionId, gatewaySessionId: session.gatewaySessionId });
    socket.on("message", (raw: unknown) => {
      const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
      // R2-08 — runTts is the ONLY entry point into TTS; the control socket invokes it
      // solely when a fully-matching answer.approve consumed the pending plan.
      // LIVE-AI-03B (P1-01) — route turn.text through the 03B controller ONLY when the staging
      // gate AND this session's subject allowlist both pass (per-frame, subject-aware). Default
      // production configuration leaves this undefined ⇒ the legacy runTurn path is byte-identical.
      const run03b = liveAi03bStagingSubjectAllowed(liveAiCtx.config, session.subject) ? liveAiCtx.run03bTextTurn : undefined;
      handleLiveAiControlFrame({
        raw: text, session, store: liveAiCtx.store, captureLedger: liveAiCtx.captureLedger,
        runTurn: liveAiCtx.orchestrator.runTurn, runTts: liveAiCtx.orchestrator.runTts, now: liveAiCtx.now,
        run03bTextTurn: run03b,
        // P1-06/P1-07 — the retained-lifecycle router + interrupt are always available; they are no-ops
        // unless a 03B lifecycle is actually active for this session (dormant by default).
        has03bLifecycle: liveAiCtx.has03bLifecycle, accept03bAction: liveAiCtx.accept03bAction, resume03bObservation: liveAiCtx.resume03bObservation, interrupt03b: liveAiCtx.interrupt03b,
      });
    });
    socket.on("close", () => {
      // R2-01 — the single control socket disconnected: mark control not-live (drops
      // the emitter) then terminate (the one-use claim is never reset, so no reattach
      // is possible; free the session slot rather than orphan-hold it to idle timeout).
      liveAiCtx.store.controlDetached(session);
      liveAiCtx.store.terminate(session, "closed");
    });
  });

  return { app, ctx, liveAiCtx };
}

// ---- main (only when run directly) ------------------------------------------
async function main() {
  const { app, ctx } = await buildGateway({ env: process.env as GatewayEnv });
  // eslint-disable-next-line no-console
  console.log("voice-gateway config:", safeConfigSummary(ctx.config));
  const port = Number(process.env.PORT) || 8080;
  await app.listen({ port, host: "0.0.0.0" });
}

// Run directly (CJS) guard — under @types/node, require/module are declared.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("voice-gateway failed to start:", err && err.message ? err.message : "error");
    process.exit(1);
  });
}
