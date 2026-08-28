// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — typed, allowlisted telemetry.
//
// Emits ONLY a fixed allowlist of pseudonymous, non-content fields. It NEVER
// serializes an arbitrary provider event object, a transcript, raw audio, an IP,
// a token, or a key. The default sink is a structured no-op (a real sink is a
// later, owner-approved decision — no external telemetry SaaS dependency here).
// ─────────────────────────────────────────────────────────────────────────

/** The ONLY fields any telemetry event may carry (allowlist). */
export interface TelemetryEvent {
  event: string; // a fixed event name (e.g. "session.created")
  sessionId?: string; // pseudonymous session id
  turnId?: number;
  frontendVersion?: string;
  gatewayVersion?: string;
  policyVersion?: string;
  provider?: string; // e.g. "openai" — never a key/endpoint
  model?: string;
  latencyMs?: number;
  toolName?: string;
  normalizedResult?: string; // a bounded status word, never content
  errorCode?: string;
  audioDurationMs?: number;
  tokenCount?: number;
  costCents?: number;
  cancelCount?: number;
  interruptionCount?: number;
  staleCount?: number;
  deviceClass?: string; // bounded classification, never a UA string
  networkClass?: string;
}

const ALLOWED_KEYS: ReadonlyArray<keyof TelemetryEvent> = Object.freeze([
  "event",
  "sessionId",
  "turnId",
  "frontendVersion",
  "gatewayVersion",
  "policyVersion",
  "provider",
  "model",
  "latencyMs",
  "toolName",
  "normalizedResult",
  "errorCode",
  "audioDurationMs",
  "tokenCount",
  "costCents",
  "cancelCount",
  "interruptionCount",
  "staleCount",
  "deviceClass",
  "networkClass",
]);

export type TelemetrySink = (event: Readonly<Record<string, unknown>>) => void;

/**
 * Project an event down to ONLY the allowlisted keys with primitive values.
 * Any non-primitive value (object/array/function) is dropped — a provider event
 * object can never be serialized through here.
 */
export function projectTelemetry(ev: TelemetryEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const v = (ev as unknown as Record<string, unknown>)[key as string];
    if (v == null) continue;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") {
      // Bound string length defensively (never dump long content).
      out[key as string] = t === "string" ? (v as string).slice(0, 120) : v;
    }
  }
  return out;
}

/** Default structured no-op sink (safe to swap for a real one later). */
export const noopSink: TelemetrySink = () => {};

export function createTelemetry(sink: TelemetrySink = noopSink) {
  return {
    emit(ev: TelemetryEvent) {
      try {
        sink(projectTelemetry(ev));
      } catch {
        /* telemetry must never throw into the request path */
      }
    },
  };
}

export type Telemetry = ReturnType<typeof createTelemetry>;
