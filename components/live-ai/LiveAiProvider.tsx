"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — global session provider.
//
// Mounts ONE bounded in-memory Live-AI session ABOVE the individual pages so a
// conversation can survive ordinary route changes, while PAGE action authority
// never does. Renders the existing app children UNCHANGED, plus the minimal
// floating orb (LiveAiShell). It owns:
//   • flag-gated runtime CONSTRUCTION — when NEXT_PUBLIC_VOICE_AI_BETA !== "1"
//     NO runtime is constructed, NO session/transport starts, NO orb renders,
//     and page registration is a no-op (feature-off contract);
//   • the provider-owned ROUTE EPOCH — a pathname change invalidates old page
//     authority + any pending page work (semantic memory survives);
//   • exactly one authoritative page registration (via useLiveAiPageRegistration);
//   • anonymous/customer role PROJECTION — derived ONLY from the PRESENCE of a
//     customer session key, never its value (no token/secret ever enters state).
//
// This packet does NOT connect any provider: the runtime is handed the
// fail-closed NULL transport (transport.ts). No mic/STT/TTS/WebRTC.
// ─────────────────────────────────────────────────────────────────────────
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { isLiveAiEnabled, type LiveAiPageId, type LiveAiRole } from "@/lib/live-ai/contracts";
import {
  createLiveAiRuntime,
  type LiveAiRuntime,
  type PageRegistration,
} from "@/lib/live-ai/runtime";
import { createNullTransport, type LiveAiTransport } from "@/lib/live-ai/transport";

export type OrbState = "idle" | "listening" | "processing" | "speaking" | "error" | "sleep";

interface LiveAiContextValue {
  enabled: boolean;
  runtime: LiveAiRuntime | null;
  transport: LiveAiTransport | null;
  registeredPageId: LiveAiPageId | null;
  activated: boolean;
  orbState: OrbState;
  activate: () => void;
  deactivate: () => void;
  toggle: () => void;
  /** Register the current page. Returns a TOKEN-GATED unregister fn that removes
   *  ONLY this exact registration (a stale/older bridge cleanup can never remove
   *  a newer registration — REV-04). No-op when disabled. */
  registerPage: (reg: Omit<PageRegistration, "routeKey">) => () => void;
}

const DISABLED_VALUE: LiveAiContextValue = {
  enabled: false,
  runtime: null,
  transport: null,
  registeredPageId: null,
  activated: false,
  orbState: "sleep",
  activate: () => {},
  deactivate: () => {},
  toggle: () => {},
  registerPage: () => () => {},
};

const LiveAiContext = createContext<LiveAiContextValue>(DISABLED_VALUE);

export function useLiveAi(): LiveAiContextValue {
  return useContext(LiveAiContext);
}

/**
 * Register the current supported page's bounded snapshot + resolved-command
 * executor. Always reads the LATEST getSnapshot/execute via a ref (no churn).
 * The `routeKey` is an effect DEPENDENCY: when it changes (e.g. /hotels/id1 →
 * /hotels/id2, same pageId) the effect re-runs — token-gated unregister of the
 * old registration followed by a fresh registration for the new route, so a
 * dynamic-segment change reliably re-establishes detail authority (REV-04).
 * No-op when the feature is disabled.
 */
export function useLiveAiPageRegistration(
  pageId: LiveAiPageId,
  routeKey: string,
  getSnapshot: PageRegistration["getSnapshot"],
  execute: PageRegistration["execute"],
): void {
  const ctx = useContext(LiveAiContext);
  const register = ctx.registerPage;
  const enabled = ctx.enabled;
  const implRef = useRef({ getSnapshot, execute });
  implRef.current = { getSnapshot, execute };

  useEffect(() => {
    if (!enabled) return;
    const unregister = register({
      pageId,
      getSnapshot: () => implRef.current.getSnapshot(),
      execute: (cmd) => implRef.current.execute(cmd),
    });
    return unregister; // token-gated — removes ONLY this registration.
    // routeKey forces re-registration across a dynamic-segment change.
  }, [register, enabled, pageId, routeKey]);
}

export function LiveAiProvider({ children }: { children: React.ReactNode }) {
  // FEATURE-OFF CONTRACT: construct NOTHING when the flag isn't exactly "1".
  const enabled = isLiveAiEnabled();

  // The runtime + transport are constructed once, and ONLY when enabled.
  const runtimeRef = useRef<LiveAiRuntime | null>(null);
  const transportRef = useRef<LiveAiTransport | null>(null);
  if (enabled && !runtimeRef.current) {
    runtimeRef.current = createLiveAiRuntime("anonymous");
    transportRef.current = createNullTransport(); // fail-closed, no network.
  }
  const runtime = runtimeRef.current;

  const pathname = usePathname();
  const pathRef = useRef<string>(pathname || "");
  pathRef.current = pathname || "";

  const [registeredPageId, setRegisteredPageId] = useState<LiveAiPageId | null>(null);
  const [activated, setActivated] = useState(false);

  // Role projection — presence of a customer session key ONLY (never its value).
  useEffect(() => {
    if (!enabled || !runtime) return;
    const applyRole = () => {
      let role: LiveAiRole = "anonymous";
      try {
        if (typeof window !== "undefined" && window.localStorage.getItem("sb_token")) {
          role = "customer";
        }
      } catch {
        role = "anonymous";
      }
      runtime.setRole(role);
    };
    applyRole();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sb_token") applyRole();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, runtime]);

  // ROUTE EPOCH — a pathname change invalidates old page authority + pending
  // work; the registration is KEPT only when it already belongs to the new
  // route (race-safe with the incoming bridge's registration). Semantic memory
  // is preserved by the runtime.
  useEffect(() => {
    if (!enabled || !runtime) return;
    runtime.invalidateRoute(pathRef.current);
    setRegisteredPageId(runtime.getRegisteredPageId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, runtime, pathname]);

  const registerPage = useCallback<LiveAiContextValue["registerPage"]>(
    (reg) => {
      if (!enabled || !runtime) return () => {};
      // routeKey = the ACTUAL current pathname, so the provider's route-epoch
      // effect keeps this registration when the route it belongs to is current.
      const token = runtime.registerPage({ ...reg, routeKey: pathRef.current });
      setRegisteredPageId(runtime.getRegisteredPageId());
      return () => {
        runtime.unregisterPage(token); // token-gated — cannot remove a newer reg
        setRegisteredPageId(runtime.getRegisteredPageId());
      };
    },
    [enabled, runtime],
  );

  const activate = useCallback(() => {
    if (!enabled || !runtime) return;
    runtime.activate();
    setActivated(true);
    // Page-aware greeting is produced in-memory (the orb renders no text). The
    // dormant transport means no provider/mic is engaged.
    runtime.greet();
  }, [enabled, runtime]);

  const deactivate = useCallback(() => {
    if (!enabled || !runtime) return;
    runtime.deactivate();
    setActivated(false);
  }, [enabled, runtime]);

  const toggle = useCallback(() => {
    if (!enabled || !runtime) return;
    if (runtime.isActivated()) {
      runtime.deactivate();
      setActivated(false);
    } else {
      runtime.activate();
      setActivated(true);
      runtime.greet();
    }
  }, [enabled, runtime]);

  const orbState: OrbState = activated ? "idle" : "sleep";

  const value = useMemo<LiveAiContextValue>(
    () => ({
      enabled,
      runtime,
      transport: transportRef.current,
      registeredPageId,
      activated,
      orbState,
      activate,
      deactivate,
      toggle,
      registerPage,
    }),
    [enabled, runtime, registeredPageId, activated, orbState, activate, deactivate, toggle, registerPage],
  );

  // When disabled, the provider is fully transparent — it renders ONLY the
  // existing app, constructs no runtime, and the context stays the disabled
  // default so any bridge/shell is a no-op.
  return <LiveAiContext.Provider value={enabled ? value : DISABLED_VALUE}>{children}</LiveAiContext.Provider>;
}

export { LiveAiContext };
