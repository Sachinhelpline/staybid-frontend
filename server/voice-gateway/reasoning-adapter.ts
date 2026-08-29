// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-05-01 — Full-advice adapter INTERFACE (dormant).
//
// The injected seam through which a later, separately-authorized SB-05-02 pass
// could wire a Tier-2 "advice-only" reasoning provider. In SB-05-01 there is NO
// provider: this file contains NO fetch, NO WebSocket, NO OpenAI SDK usage, NO
// provider URL, NO API-key lookup, NO Responses/Realtime call, and NO network of
// any kind.
//
// The DEFAULT implementation is UNAVAILABLE / FAIL-CLOSED. Tests inject their own
// deterministic fakes; no real provider file becomes executable in this packet.
//
// MODEL != AUTHORITY: the adapter returns inert DATA only (validated by the
// router's closed ReasoningAdvice validator). It is handed a closed, bounded
// RouterContext and can return advice or a reason — it can never gain a tool,
// an endpoint, write access, or any authority.
// ─────────────────────────────────────────────────────────────────────────
import type { RouterContext } from "./router";

/** The result of an advice request: inert advice DATA, or a static reason code. */
export type AdapterResult =
  | { ok: true; advice: unknown }
  | { ok: false; reason: string };

/**
 * The advice-provider seam. `available` MUST be false for any non-wired build so
 * the router fails closed before invoking `getAdvice`. `getAdvice` receives ONLY
 * the closed, bounded RouterContext and returns inert data — never performing a
 * side effect, a network call, or an authority-bearing action.
 */
export interface FullAdviceAdapter {
  readonly available: boolean;
  getAdvice(context: RouterContext): Promise<AdapterResult>;
}

/**
 * The default, dormant adapter: permanently UNAVAILABLE and fail-closed. It never
 * touches the network and never produces advice. This is the only adapter that
 * ships in SB-05-01; activation is a separate owner-approved SB-05-02 decision.
 */
export const unavailableAdapter: FullAdviceAdapter = Object.freeze({
  available: false,
  async getAdvice(_context: RouterContext): Promise<AdapterResult> {
    return { ok: false, reason: "adapter_unavailable" };
  },
});
