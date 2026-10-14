// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — PRODUCT-02 — founder-only REAL AI TEXT seam (client side).
//
// An ISOLATED, opt-in, TEXT-ONLY path from the existing six-buddy Travel Buddy to the
// EXISTING admin-only staging broker (/api/live-ai/staging/session). It reuses the
// existing gateway transport, conversation controller, runtime and typed (read-only /
// UI-local) hotel operations. It does NOT touch the normal customer broker, the
// NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA gate, the microphone, or any write operation.
//
// FOUR independent fail-closed layers, all default OFF:
//   1. build flag NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT === "1" (absent ⇒ nothing is
//      constructed and no request is made), and only alongside the scripted Buddy gate
//      (V=1, P≠1, UX=1) — it can never coexist with the global provider path;
//   2. server-enforced eligibility (/api/live-ai/staging/eligibility): LIVE_AI_FOUNDER_TEXT_ENABLED,
//      full staging-broker config, same-origin, verified admin bearer, exact single
//      staging-operator match — mints NOTHING;
//   3. an explicit per-page-session founder opt-in toggle (never persisted, never automatic);
//   4. the unchanged staging broker + gateway, which re-check everything on every session.
//
// The browser reads the existing admin session token only to TRANSPORT it as a Bearer
// credential; it never derives identity, role or eligibility from it.
// ─────────────────────────────────────────────────────────────────────────
import type { LiveAiRuntime } from "./runtime";
import { createGatewayTransport, type SocketOpener } from "./gateway-client";
import { createConversation, type Conversation, type ConversationState } from "./conversation";
import { createAudioPlayback, type AudioSink } from "./audio-playback";

export const FOUNDER_TEXT_BROKER_PATH = "/api/live-ai/staging/session" as const;
export const FOUNDER_TEXT_ELIGIBILITY_PATH = "/api/live-ai/staging/eligibility" as const;
/** The existing admin session key (set only by the verified admin login flow). */
export const ADMIN_SESSION_KEY = "sb_admin_token" as const;
/** A founder TEXT turn that produces no answer within this window falls back to the scripted Buddy. */
export const FOUNDER_TURN_TIMEOUT_MS = 25_000;

/** Client build gate. Requires the scripted Buddy gate (V=1, P≠1, UX=1) AND the dedicated flag. */
export function resolveFounderTextClientGate(env?: Record<string, string | undefined>): boolean {
  // Direct `process.env.NEXT_PUBLIC_*` member reads so Next inlines them into the client
  // bundle (an aliased `process.env` object is NOT inlined and would read as empty).
  const e = env || {
    NEXT_PUBLIC_VOICE_AI_BETA: process.env.NEXT_PUBLIC_VOICE_AI_BETA,
    NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA: process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA,
    NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW: process.env.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW,
    NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT: process.env.NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT,
  };
  return e.NEXT_PUBLIC_VOICE_AI_BETA === "1"
    && e.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA !== "1"
    && e.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW === "1"
    && e.NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT === "1";
}

/** Bearer-token SHAPE check only (header-safe); validity is decided by the server. */
export function isWellFormedBearer(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9._~+/-]{16,4096}={0,2}$/.test(t);
}

/** Read the existing admin session token for TRANSPORT only. Never trusted for identity. */
export function readFounderBearer(storage: { getItem(k: string): string | null } | null | undefined): string | null {
  try {
    const t = storage ? storage.getItem(ADMIN_SESSION_KEY) : null;
    return isWellFormedBearer(t) ? t : null;
  } catch { return null; }
}

/** Server eligibility probe. TRUE only on HTTP 200 with exactly {eligible:true}. Everything else ⇒ false. */
export async function checkFounderEligibility(
  fetchImpl: typeof fetch | undefined,
  bearer: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!fetchImpl || !isWellFormedBearer(bearer)) return false;
  try {
    const res = await fetchImpl(FOUNDER_TEXT_ELIGIBILITY_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!res || res.status !== 200) return false;
    const json = (await res.json()) as unknown;
    return !!json && typeof json === "object" && (json as { eligible?: unknown }).eligible === true;
  } catch { return false; }
}

/** A sink that never plays anything: the founder path is TEXT ONLY (no provider audio). */
export function createSilentAudioSink(): AudioSink {
  let closed = false;
  return {
    resume: async () => !closed,
    enqueue: () => {},
    stopAndClear: () => {},
    close: () => { closed = true; },
    state: () => (closed ? "closed" : "running"),
  };
}

export type FounderTurnResult =
  | { ok: true; text: string }
  | { ok: false; code: string };

export interface FounderTextSession {
  /** Send one typed turn; resolves with the provider's validated answer text or a failure code. */
  ask(text: string): Promise<FounderTurnResult>;
  state(): ConversationState;
  end(): void;
  dispose(): void;
}

export interface FounderTextSessionDeps {
  runtime: LiveAiRuntime;
  getBearer: () => string | null;
  fetchImpl?: typeof fetch;
  openSocket?: SocketOpener;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/**
 * Build ONE founder TEXT session over the existing gateway transport + conversation
 * controller, pointed at the admin-only staging broker. Nothing connects until ask().
 * A turn resolves exactly once: with the provider's answer, an error/start failure, or a
 * timeout. A failure ends the session (the next ask starts a fresh one).
 */
export function createFounderTextSession(deps: FounderTextSessionDeps): FounderTextSession {
  const setTimer = deps.setTimer || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const timeoutMs = deps.timeoutMs ?? FOUNDER_TURN_TIMEOUT_MS;
  let pending: { resolve: (r: FounderTurnResult) => void; timer: unknown } | null = null;
  let queuedText: string | null = null;
  let disposed = false;
  // The 03B gateway ends a TEXT turn with `answer.compiled` and no trailing `turn.state idle`,
  // so the controller can remain THINKING after a COMPLETED answer. Only in that exact case
  // (our previous turn settled with an answer, nothing pending) may the next typed turn go out.
  let answeredTurnDone = false;

  const settle = (r: FounderTurnResult) => {
    const p = pending; pending = null; queuedText = null;
    if (!p) return;
    try { clearTimer(p.timer); } catch { /* no-op */ }
    if (!r.ok) { answeredTurnDone = false; try { conv.end("user"); } catch { /* no-op */ } }
    p.resolve(r);
  };

  const transport = createGatewayTransport({
    brokerPath: FOUNDER_TEXT_BROKER_PATH,
    brokerAuthorization: deps.getBearer,
    textOnly: true,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.openSocket ? { openSocket: deps.openSocket } : {}),
  });
  const conv: Conversation = createConversation({
    runtime: deps.runtime,
    transport,
    audio: createAudioPlayback({ sink: createSilentAudioSink() }),
    onEvent: (ev) => {
      if (ev.type === "answer") { if (pending) answeredTurnDone = true; settle({ ok: true, text: ev.text }); return; }
      if (ev.type === "error") { settle({ ok: false, code: ev.code || "error" }); return; }
      if (ev.type === "state") {
        if (ev.state === "IDLE" && queuedText) {
          const t = queuedText; queuedText = null;
          try { if (!conv.submitText(t)) settle({ ok: false, code: "submit_refused" }); } catch { settle({ ok: false, code: "submit_refused" }); }
        } else if ((ev.state === "ERROR" || ev.state === "OFFLINE") && pending) {
          settle({ ok: false, code: ev.state === "OFFLINE" ? "offline" : "error" });
        }
      }
    },
  });

  return {
    async ask(text: string): Promise<FounderTurnResult> {
      if (disposed) return { ok: false, code: "disposed" };
      if (pending) return { ok: false, code: "busy" };
      const t = String(text || "").trim();
      if (!t) return { ok: false, code: "empty" };
      return new Promise<FounderTurnResult>((resolve) => {
        pending = { resolve, timer: setTimer(() => settle({ ok: false, code: "timeout" }), timeoutMs) };
        const st = conv.getState();
        const resume = answeredTurnDone && st === "THINKING";
        answeredTurnDone = false;
        if (st === "IDLE" || resume) {
          try { if (!conv.submitText(t)) settle({ ok: false, code: "submit_refused" }); } catch { settle({ ok: false, code: "submit_refused" }); }
          return;
        }
        if (st === "ERROR" || st === "OFFLINE") { try { conv.end("user"); } catch { /* no-op */ } }
        if (conv.getState() !== "DISCONNECTED") { settle({ ok: false, code: "busy" }); return; }
        queuedText = t;
        Promise.resolve(conv.start("text"))
          .then((r) => { if (!r || !r.ok) settle({ ok: false, code: (r && r.code) || "start_failed" }); })
          .catch(() => settle({ ok: false, code: "start_failed" }));
      });
    },
    state: () => conv.getState(),
    end: () => { settle({ ok: false, code: "ended" }); try { conv.end("user"); } catch { /* no-op */ } },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      settle({ ok: false, code: "disposed" });
      try { conv.dispose(); } catch { /* no-op */ }
    },
  };
}
