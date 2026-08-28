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
// Fastify wiring (thin adapter over the DI handlers above).
// ═══════════════════════════════════════════════════════════════════════════
export async function buildGateway(deps: BuildContextDeps): Promise<{ app: FastifyInstance; ctx: GatewayContext }> {
  const ctx = buildContext(deps);
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

  return { app, ctx };
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
