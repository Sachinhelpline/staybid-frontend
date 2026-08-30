// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — provider-neutral transport contract.
//
// A CLOSED transport surface. Production default is FAIL-CLOSED / NULL /
// NO-NETWORK — no OpenAI, no WebRTC, no broker, no gateway, no SB-05 router, no
// external model/provider is connected in this packet. The runtime is handed a
// transport; the transport can propose ONLY a closed typed operation BODY (the
// same shape validateOperation() accepts). It can NEVER supply an executable
// url / href / path / method / selector / html / js / sql / rpc / command — the
// contract has no field for any of those, and the runtime re-validates anyway.
//
// Tests inject a DETERMINISTIC, no-network transport to drive the first-slice
// companion without activating any real provider. The demo /voice-demo regex
// controller is NOT reused as production intelligence.
//
// Pure module: no I/O, no React, no next/*, no fetch/WebSocket/WebRTC.
// ─────────────────────────────────────────────────────────────────────────
import { validateOperation, type LiveAiOperation } from "./contracts";

/** What the transport hands back for a user turn: a closed proposal, or none. */
export interface TransportProposal {
  /** A closed typed operation body (re-validated by the runtime). */
  operation: LiveAiOperation;
  /** Optional bounded natural-language gloss (data, never instructions). */
  say?: string;
}

export interface TransportTurnInput {
  /** The user's utterance/text for this turn (bounded upstream). */
  text: string;
  /** The page currently registered (so a deterministic script can branch). */
  pageId: "hotels" | "hotel-detail" | null;
}

export interface LiveAiTransport {
  readonly kind: string;
  /** True only when a real provider connection is live. Always false here. */
  isConnected(): boolean;
  /**
   * Propose a closed operation for a user turn. MUST NOT perform any network
   * I/O. Returns null when nothing can be proposed (or when disconnected).
   */
  propose(input: TransportTurnInput): TransportProposal | null;
}

/**
 * The PRODUCTION default transport: connected=false, proposes nothing, does no
 * network I/O. Live AI therefore stays fully dormant end-to-end in this packet.
 */
export function createNullTransport(): LiveAiTransport {
  return {
    kind: "null",
    isConnected: () => false,
    propose: () => null,
  };
}

/** A single scripted turn for the deterministic (test-only) transport. */
export interface DeterministicTurn {
  /** Matches when the utterance contains this (case-insensitive) substring. */
  match: string;
  /** Optional page constraint. */
  pageId?: "hotels" | "hotel-detail";
  /** The closed operation this utterance maps to. */
  operation: LiveAiOperation;
  say?: string;
}

/**
 * A DETERMINISTIC, no-network transport for source validation and tests only.
 * It maps a fixed script of utterances → closed operations. It performs ZERO
 * network I/O and connects to NO provider. Even so, every proposal is a closed
 * operation body that the runtime independently re-validates.
 */
export function createDeterministicTransport(script: DeterministicTurn[]): LiveAiTransport {
  const turns = Array.isArray(script) ? script.slice() : [];
  return {
    kind: "deterministic",
    // Deliberately reports NOT connected — it is a local script, not a live
    // provider; nothing here reaches a network.
    isConnected: () => false,
    propose(input) {
      const text = (input?.text || "").toLowerCase();
      for (const t of turns) {
        if (t.pageId && t.pageId !== input?.pageId) continue;
        if (!text.includes(t.match.toLowerCase())) continue;
        // Re-validate the scripted operation through the SAME closed validator
        // the runtime uses, so a malformed script entry proposes nothing.
        const op = validateOperation(t.operation);
        if (!op) return null;
        return { operation: op, say: t.say };
      }
      return null;
    },
  };
}
