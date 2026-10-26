// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — LIVE-controller bridge (offline integration candidate).
//
// Teddy talks to the ORIGINAL Live-AI controller (lib/live-ai/conversation.ts via the
// existing LiveAiProvider context) — it never builds a second controller, transport,
// microphone owner or model session. The ONE thing the original wiring does that the
// product contract forbids for voice is: the provider's media adapter hands every final
// microphone transcript straight to `conversation.submitText(t)` (LiveAiProvider.tsx,
// createBrowserMedia → onFinalTranscript). A spoken amount / date / guest count must be
// REVIEWED before it becomes a turn.
//
// LiveAiProvider.tsx and conversation.ts are frozen (byte-unchanged vs HEAD is an accepted
// test), so the mediation lives HERE, at the controller's public `submitText` boundary of the
// exact instance the provider exposes:
//   • a call that Teddy itself pre-authorised (a typed turn, or a transcript the guest has
//     reviewed/confirmed) passes through to the ORIGINAL submitText unchanged;
//   • any other call — i.e. a raw microphone transcript arriving from the media adapter —
//     is NOT submitted; it is handed to `onTranscript` for the review card instead.
// Uninstall restores the original method (only if it is still ours). Pure: no I/O, no DOM.
// ─────────────────────────────────────────────────────────────────────────
import type { Conversation } from "../live-ai/conversation";

/** A pre-authorised text stays valid this long (covers the provider's buffered first-turn flush). */
export const ALLOW_TTL_MS = 30_000;
const MAX_ALLOWED = 4;

export interface TranscriptReviewBridge {
  /** Authorise exactly ONE upcoming submitText(text) call to reach the original controller. */
  allow(text: string): void;
  /** Restore the controller's original submitText (idempotent; never clobbers a foreign patch). */
  uninstall(): void;
  /** Number of raw transcripts diverted to review (diagnostics / tests). */
  divertedCount(): number;
  readonly conversation: Conversation;
}

const installed = new WeakMap<Conversation, TranscriptReviewBridge>();

export function installTranscriptReview(
  conversation: Conversation,
  onTranscript: (text: string) => void,
  now: () => number = () => Date.now(),
): TranscriptReviewBridge {
  const prior = installed.get(conversation);
  if (prior) prior.uninstall();
  const original = conversation.submitText;
  let allowed: Array<{ text: string; at: number }> = [];
  let diverted = 0;
  let active = true;

  const patched: Conversation["submitText"] = function (this: unknown, text, languageHint) {
    const t = now();
    allowed = allowed.filter((a) => t - a.at <= ALLOW_TTL_MS);
    const i = active ? allowed.findIndex((a) => a.text === text) : -1;
    if (!active || i >= 0) {
      if (i >= 0) allowed.splice(i, 1);
      return original.call(conversation, text, languageHint);
    }
    diverted += 1;
    try { onTranscript(String(text || "")); } catch { /* the review UI must never break the controller */ }
    return false; // NOT submitted — it waits for the guest's review
  };
  conversation.submitText = patched;

  const bridge: TranscriptReviewBridge = {
    conversation,
    allow(text: string) {
      if (typeof text !== "string" || !text) return;
      allowed.push({ text, at: now() });
      if (allowed.length > MAX_ALLOWED) allowed = allowed.slice(allowed.length - MAX_ALLOWED);
    },
    uninstall() {
      if (!active) return;
      active = false;
      allowed = [];
      if (conversation.submitText === patched) conversation.submitText = original;
      if (installed.get(conversation) === bridge) installed.delete(conversation);
    },
    divertedCount: () => diverted,
  };
  installed.set(conversation, bridge);
  return bridge;
}
