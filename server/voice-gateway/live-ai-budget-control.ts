// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-BUDGET-01 — control-epoch / emergency-kill watcher.
//
// The trusted ASYNC control layer of the DPBEL core. A durable control record
// carries a MONOTONIC epoch + enabled/kill state per global + project scope. Each
// local lease PINS the global + project epochs, a control-vector digest, a bounded
// freshness deadline (maxControlStalenessMs) and a lease expiry. A trusted async
// watcher periodically reads a fresh control snapshot and MAY ONLY:
//   • refresh the freshness timestamp on a coherent, non-regressing read;
//   • REVOKE a local lease (kill, disable, or an ADVANCED control epoch).
// It may NEVER mint or increase quota. Every SYNCHRONOUS admission/reserve then
// checks ONLY local state (lease valid / not expired / not revoked / epoch coherent
// / freshness deadline not passed). A stale control heartbeat FAILS CLOSED. This
// module performs NO synchronous DB/network I/O — the control SOURCE is injected.
// ─────────────────────────────────────────────────────────────────────────

// ═══════════════════════════ durable control record ═══════════════════════
export interface ControlEpochRecord {
  readonly scopeType: "global" | "project";
  readonly scopeKeyDigest: string;
  readonly controlEpoch: bigint;
  readonly enabled: boolean;
  readonly killed: boolean;
  readonly updatedAtMs: number;
  readonly recordDigest: string;
}

/** A coherent control observation across the two authoritative scopes. */
export interface ControlSnapshot {
  readonly globalEpoch: bigint;
  readonly projectEpoch: bigint;
  readonly controlVectorDigest: string;
  readonly enabled: boolean;
  readonly killed: boolean;
  readonly observedAtMs: number;
}

/** The control state a lease PINS at acquisition. */
export interface PinnedControl {
  readonly globalEpoch: bigint;
  readonly projectEpoch: bigint;
  readonly controlVectorDigest: string;
  readonly maxControlStalenessMs: number;
  readonly leaseExpiryMs: number;
}

/** BUDGET-01 §12 — 0 < maxControlStalenessMs <= leaseTtlMs. No production numeric
 *  value is invented here; the caller supplies both and this validates the relation. */
export function validatePinnedControl(p: unknown, leaseTtlMs: number): PinnedControl | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const r = p as Record<string, unknown>;
  if (typeof r.globalEpoch !== "bigint" || r.globalEpoch < BigInt(0)) return null;
  if (typeof r.projectEpoch !== "bigint" || r.projectEpoch < BigInt(0)) return null;
  if (typeof r.controlVectorDigest !== "string" || !r.controlVectorDigest) return null;
  const stale = r.maxControlStalenessMs; const exp = r.leaseExpiryMs;
  if (typeof stale !== "number" || !Number.isFinite(stale) || stale <= 0) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
  if (!(typeof leaseTtlMs === "number" && Number.isFinite(leaseTtlMs) && leaseTtlMs > 0)) return null;
  if (!(stale <= leaseTtlMs)) return null; // freshness window can never exceed the lease TTL
  return Object.freeze({
    globalEpoch: r.globalEpoch, projectEpoch: r.projectEpoch, controlVectorDigest: r.controlVectorDigest,
    maxControlStalenessMs: stale, leaseExpiryMs: exp,
  });
}

export function validateControlSnapshot(raw: unknown): ControlSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.globalEpoch !== "bigint" || r.globalEpoch < BigInt(0)) return null;
  if (typeof r.projectEpoch !== "bigint" || r.projectEpoch < BigInt(0)) return null;
  if (typeof r.controlVectorDigest !== "string" || !r.controlVectorDigest) return null;
  if (typeof r.enabled !== "boolean" || typeof r.killed !== "boolean") return null;
  if (typeof r.observedAtMs !== "number" || !Number.isFinite(r.observedAtMs) || r.observedAtMs < 0) return null;
  return Object.freeze({
    globalEpoch: r.globalEpoch, projectEpoch: r.projectEpoch, controlVectorDigest: r.controlVectorDigest,
    enabled: r.enabled, killed: r.killed, observedAtMs: r.observedAtMs,
  });
}

// ═══════════════════════════ control decision (pure) ══════════════════════
export type ControlDecision =
  | { readonly kind: "REFRESH"; readonly observedAtMs: number }   // coherent, current epoch → refresh freshness
  | { readonly kind: "REVOKE"; readonly reason: ControlRevokeReason }
  | { readonly kind: "IGNORE"; readonly reason: string };          // regressing / incoherent → do nothing

export type ControlRevokeReason = "killed" | "disabled" | "epoch_advanced";

/** PURE decision: given the lease's pinned control and a fresh snapshot, decide.
 *  A REVOKE is the ONLY authority-reducing outcome; a regressing epoch is IGNORED
 *  (never refreshes, never revives); a kill/disable/advance REVOKES. */
export function decideControl(pinned: PinnedControl, snap: ControlSnapshot): ControlDecision {
  // A regressing (older) control epoch is a stale/replayed record — ignore it entirely.
  if (snap.globalEpoch < pinned.globalEpoch || snap.projectEpoch < pinned.projectEpoch) {
    return { kind: "IGNORE", reason: "regressing_epoch" };
  }
  if (snap.killed) return { kind: "REVOKE", reason: "killed" };
  if (!snap.enabled) return { kind: "REVOKE", reason: "disabled" };
  // An ADVANCED epoch (or a changed control vector at an advanced epoch) revokes the pinned lease.
  if (snap.globalEpoch > pinned.globalEpoch || snap.projectEpoch > pinned.projectEpoch) {
    return { kind: "REVOKE", reason: "epoch_advanced" };
  }
  // Same epoch + enabled + not killed: a changed control vector at the SAME epoch is
  // incoherent (the digest must move with the epoch) — ignore rather than trust it.
  if (snap.controlVectorDigest !== pinned.controlVectorDigest) return { kind: "IGNORE", reason: "vector_mismatch_same_epoch" };
  return { kind: "REFRESH", observedAtMs: snap.observedAtMs };
}

// ═══════════════════════════ async control source + watcher ═══════════════
export interface ControlSource {
  /** Read the current control snapshot (async, out of the sync path). Returns null
   *  on an unavailable/unreadable source — the watcher then does NOT refresh, so
   *  freshness lapses and the sync path fails closed. */
  read(): Promise<ControlSnapshot | null>;
}

export interface ControlWatcherTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ControlWatcherDeps {
  readonly source: ControlSource;
  readonly pinned: PinnedControl;
  readonly intervalMs: number;
  /** applied when a coherent read confirms the pinned epoch is still current. */
  readonly onFresh: (observedAtMs: number) => void;
  /** applied when control kills / disables / advances — reduce-only. MAY be async: a REVOKE
   *  poll is not reported complete until this settles (BUDGET-01 P0-01A — the durable revoke
   *  is AWAITED, never fire-and-forget). A thrown/rejected revoke never restores authority. */
  readonly onRevoke: (reason: ControlRevokeReason) => void | Promise<void>;
  readonly timers: ControlWatcherTimers;
}

export interface ControlWatcher {
  start(): void;
  stop(): void;
  /** run one poll immediately (used by tests + the initial post-acquire refresh). */
  pollOnce(): Promise<ControlDecision>;
}

/** A trusted async watcher. It NEVER mints/increases authority: its only outward
 *  effects are onFresh (freshness refresh) and onRevoke (authority reduction). A
 *  source outage yields no refresh, so the lease's freshness deadline lapses and the
 *  synchronous path fails closed on its own — the watcher cannot grant indefinite
 *  authority by simply not running. */
export function createControlWatcher(deps: ControlWatcherDeps): ControlWatcher {
  let handle: unknown = null;
  let running = false;
  let stopped = false;

  async function pollOnce(): Promise<ControlDecision> {
    let snap: ControlSnapshot | null = null;
    try { snap = await deps.source.read(); } catch { snap = null; }
    const valid = snap ? validateControlSnapshot(snap) : null;
    if (!valid) return { kind: "IGNORE", reason: "unavailable_or_malformed" }; // no refresh on outage
    const decision = decideControl(deps.pinned, valid);
    if (decision.kind === "REFRESH") { try { deps.onFresh(decision.observedAtMs); } catch { /* never breaks the watcher */ } }
    // P0-01A — AWAIT the durable revoke: a REVOKE poll does not complete until the durable
    // revoke has reached a terminal result. A thrown/rejected revoke is swallowed here (the
    // local lease was already marked revoked synchronously by onRevoke) and never restores authority.
    else if (decision.kind === "REVOKE") { try { await deps.onRevoke(decision.reason); } catch { /* never breaks the watcher; authority never restored */ } }
    return decision;
  }

  function schedule(): void {
    if (stopped) return;
    handle = deps.timers.set(() => { void tick(); }, Math.max(1, deps.intervalMs));
  }
  async function tick(): Promise<void> {
    if (stopped || running) return;
    running = true;
    try { await pollOnce(); } finally { running = false; if (!stopped) schedule(); }
  }
  function start(): void { if (stopped || handle !== null) return; schedule(); }
  function stop(): void { stopped = true; if (handle !== null) { try { deps.timers.clear(handle); } catch { /* no-op */ } handle = null; } }

  return Object.freeze({ start, stop, pollOnce });
}
