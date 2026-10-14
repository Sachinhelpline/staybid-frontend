"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — PRODUCT-02 — Travel Buddy hook for the founder-only REAL AI TEXT seam.
//
// With NEXT_PUBLIC_LIVE_AI_FOUNDER_TEXT unset (the production default) this hook constructs
// nothing, reads nothing and makes NO request: `available` stays false and the scripted
// Buddy is unchanged. When the flag is on, it asks the server ONCE per mount whether the
// current verified admin is the staging operator; only then is an opt-in offered. The
// founder session is built lazily on the explicit opt-in and torn down on opt-out/unmount.
// ─────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveAiRuntime } from "@/lib/live-ai/runtime";
import {
  checkFounderEligibility,
  createFounderTextSession,
  readFounderBearer,
  resolveFounderTextClientGate,
  type FounderTextSession,
  type FounderTurnResult,
} from "@/lib/live-ai/founder-text";

export interface FounderTextControl {
  /** Server-verified: this browser's admin session is the single staging operator. */
  available: boolean;
  /** The founder explicitly opted in for this page session (default false, never persisted). */
  active: boolean;
  setActive: (on: boolean) => void;
  ask: (text: string) => Promise<FounderTurnResult>;
}

const browserStorage = () => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };

export function useFounderText(runtime: LiveAiRuntime | null): FounderTextControl {
  const gate = useMemo(() => resolveFounderTextClientGate(), []);
  const [available, setAvailable] = useState(false);
  const [active, setActiveState] = useState(false);
  const sessionRef = useRef<FounderTextSession | null>(null);

  useEffect(() => {
    if (!gate || typeof window === "undefined") return;
    const bearer = readFounderBearer(browserStorage());
    if (!bearer) return; // no admin session in this browser ⇒ no request at all
    const AC = typeof AbortController !== "undefined" ? new AbortController() : null;
    let live = true;
    void checkFounderEligibility(window.fetch.bind(window), bearer, AC ? AC.signal : undefined)
      .then((ok) => { if (live) setAvailable(ok); });
    return () => { live = false; try { AC?.abort(); } catch { /* no-op */ } };
  }, [gate]);

  const teardown = useCallback(() => {
    const s = sessionRef.current; sessionRef.current = null;
    if (s) { try { s.dispose(); } catch { /* no-op */ } }
  }, []);

  useEffect(() => teardown, [teardown]);

  const setActive = useCallback((on: boolean) => {
    if (!on || !available) { teardown(); setActiveState(false); return; }
    setActiveState(true);
  }, [available, teardown]);

  const ask = useCallback(async (text: string): Promise<FounderTurnResult> => {
    if (!gate || !available || !active || !runtime || typeof window === "undefined") return { ok: false, code: "not_active" };
    if (!sessionRef.current) {
      sessionRef.current = createFounderTextSession({
        runtime,
        getBearer: () => readFounderBearer(browserStorage()),
        fetchImpl: window.fetch.bind(window),
      });
    }
    return sessionRef.current.ask(text);
  }, [gate, available, active, runtime]);

  return { available: gate && available, active: gate && available && active, setActive, ask };
}
