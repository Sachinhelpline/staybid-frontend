// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — bounded in-memory session runtime.
//
// Owns everything authoritative + fail-closed, with ZERO React/DOM/network/
// next-router dependency (so tests drive it directly against production logic):
//   • one bounded in-memory session (id, explicit activation, role projection);
//   • bounded semantic memory (survives supported route changes);
//   • provider-owned ROUTE EPOCH (route change invalidates page authority);
//   • TOKEN-based single active page registration — unregister requires the
//     matching ownership token, so a stale/older bridge cleanup can NEVER remove
//     a newer registration (REV-04);
//   • CONTEXT-REVISION staleness on a SYNCHRONOUS complete-state fingerprint —
//     an envelope prepared against older facts fails before it can execute
//     against new facts (REV-05);
//   • pending-turn cancellation; BOUNDED action-id dedup (REV-13);
//   • closed typed-operation authority (READ + UI_LOCAL only);
//   • current-screen entity allowlisting by TRUE visual position (REV-07);
//   • NO authority over stale/loading results — reads/compare/open fail closed
//     until the request-bound catalogue receipt is READY (REV-06);
//   • verification is NEVER granted from a setter call — an APPLY is only
//     "acted", and reconcile() emits "verified" only after a subsequent
//     revision reflects the applied state / matching request-bound receipt
//     (REV-02/03/02B);
//   • detail authority (facts + SHOW_HOTEL_SECTION) ONLY after ready AND route
//     id == loaded id (REV-10).
//
// PURE module: no I/O, no React, no next/*, no @/lib imports except contracts.
// ─────────────────────────────────────────────────────────────────────────
import {
  LIVE_AI_SCHEMA_VERSION,
  MAX_MEMORY_TURNS,
  MAX_DEDUP_ENTRIES,
  OPERATION_AUTHORITY,
  OPERATION_PAGE,
  CONFIRMED_WRITE_ENABLED,
  DRAFT_LOCAL_ENABLED,
  validateOperation,
  strictOwnDataRecord,
  resolveParkingAmenity,
  isLiveAiPageId,
  isLiveAiRole,
  type LiveAiPageId,
  type LiveAiRole,
  type LiveAiOperation,
  type LiveAiOperationName,
  type AuthorityLevel,
  type HotelsListContext,
  type HotelDetailContext,
  type VisibleHotelSummary,
  type HotelSection,
  type HotelSort,
} from "./contracts";
import type { PublishedContext, PublishedVisibleHotel, RefinementProjection } from "./protocol";

// ---- resolved, SAFE command handed to a page bridge -------------------------
export type ResolvedCommand =
  | {
      kind: "apply_refinement";
      destination?: string | null;
      query?: string | null;
      maxPrice?: number | null;
      parking?: boolean;
      parkingAmenity?: string | null;
      sort?: HotelSort;
      stars?: number[];
    }
  | { kind: "open_hotel"; hotelId: string; position: number }
  | { kind: "show_section"; section: HotelSection };

export interface PageRegistration {
  pageId: LiveAiPageId;
  /** the route (pathname) this registration belongs to. */
  routeKey?: string;
  getSnapshot: () => HotelsListContext | HotelDetailContext;
  execute: (cmd: ResolvedCommand) => void;
}

// ---- the authority envelope stamped on every proposed action ----------------
export interface OperationEnvelope {
  schema: string;
  actionId: string;
  sessionId: string;
  turnId: string;
  expectedPage: LiveAiPageId;
  routeEpoch: number;
  /** SYNCHRONOUS complete-state fingerprint of the snapshot at proposal time. */
  contextRevision: string;
  operation: unknown;
}

const ENVELOPE_KEYS = Object.freeze([
  "schema", "actionId", "sessionId", "turnId", "expectedPage", "routeEpoch", "contextRevision", "operation",
]);

export type LiveAiStatus =
  | "ok" | "deduped" | "disabled" | "not_activated" | "no_registration"
  | "invalid_envelope" | "schema_mismatch" | "session_mismatch" | "stale_turn"
  | "invalid_operation" | "wrong_page" | "authority_disabled" | "stale_route"
  | "stale_context" | "missing_ordinal" | "unsupported_filter" | "not_ready"
  | "hotel_id_mismatch";

export type CompanionPhase = "greeting" | "clarify" | "advise" | "acted" | "verified" | "explain" | "suggest" | "unavailable";

export interface CompanionTurn {
  phase: CompanionPhase;
  speech: string;
  accepted?: boolean;
  /** LIVE-AI-02A: when reconcile() confirms a prior UI_LOCAL action as verified,
   *  it carries the correlation of the ORIGINATING action so the conversation
   *  controller can bind a "verified" receipt to the exact proposal it executed
   *  (the runtime never learns the provider's proposalId — the controller maps
   *  actionId→proposalId). */
  correlated?: { turnId: string; actionId: string; operation: LiveAiOperationName };
}

export interface ComparisonResult {
  rows: VisibleHotelSummary[];
  cheapestPosition: number | null;
  topRatedPosition: number | null;
}

export interface HotelFacts {
  hotelId: string;
  breakfast: HotelDetailContext["breakfast"];
  parking: HotelDetailContext["parking"];
  roomTypes: HotelDetailContext["roomTypes"];
  hotel: HotelDetailContext["hotel"];
}

export interface ExecutionResult {
  ok: boolean;
  status: LiveAiStatus;
  operation?: LiveAiOperationName;
  authority?: AuthorityLevel;
  results?: VisibleHotelSummary[];
  comparison?: ComparisonResult;
  facts?: HotelFacts;
  resolvedHotelId?: string;
  pendingReconcile?: boolean;
  companion?: CompanionTurn;
}

interface MemoryTurn { turnId: string; role: "user" | "assistant"; text: string; at: number; }

interface PendingRefinement {
  turnId: string;
  /** LIVE-AI-02A: the envelope action-id + op that applied this refinement, so a
   *  later verified reconcile is correlated back to the originating action. */
  actionId: string;
  operation: LiveAiOperationName;
  kind: "catalogue" | "local";
  revisionAtApply: string;
  city: string | null;
  query: string | null;
  sawLoading: boolean;
  maxPrice?: number | null;
  parking?: boolean;
  sort?: HotelSort;
  stars?: number[];
}

interface RegistrationEntry {
  pageId: LiveAiPageId;
  routeKey?: string;
  token: string;
  getSnapshot: () => HotelsListContext | HotelDetailContext;
  execute: (cmd: ResolvedCommand) => void;
}

let __seq = 0;
function uid(prefix: string): string {
  __seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${__seq.toString(36)}`;
}

function authorityEnabled(level: AuthorityLevel): boolean {
  if (level === "READ" || level === "UI_LOCAL") return true;
  if (level === "DRAFT_LOCAL") return DRAFT_LOCAL_ENABLED;
  if (level === "CONFIRMED_WRITE") return CONFIRMED_WRITE_ENABLED;
  return false;
}

/**
 * STRICT + IMMUTABLE envelope validation (R1-REV-NEW-01). Same fail-closed
 * inspection as the operation body: EVERY own key is inspected (via
 * strictOwnDataRecord → Reflect.ownKeys), rejecting symbol keys, accessor
 * (getter/setter) descriptors, and any undeclared own key (enumerable OR not);
 * inherited/prototype authority is never read. Returns ONE FROZEN canonical copy
 * built from own data properties — the runtime dispatches from THIS copy, never
 * the original object (no TOCTOU getter, no mutation-after-validation gap).
 */
function validateEnvelope(x: unknown): OperationEnvelope | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = strictOwnDataRecord(x, ENVELOPE_KEYS);
  if (!a) return null; // symbol/accessor/undeclared own key → fail closed
  if (typeof a.schema !== "string" || !a.schema) return null;
  if (typeof a.actionId !== "string" || !a.actionId) return null;
  if (typeof a.sessionId !== "string" || !a.sessionId) return null;
  if (typeof a.turnId !== "string" || !a.turnId) return null;
  if (!isLiveAiPageId(a.expectedPage)) return null;
  if (typeof a.routeEpoch !== "number" || !Number.isInteger(a.routeEpoch)) return null;
  if (typeof a.contextRevision !== "string" || !a.contextRevision) return null;
  if (!Object.prototype.hasOwnProperty.call(a, "operation")) return null;
  return Object.freeze({
    schema: a.schema,
    actionId: a.actionId,
    sessionId: a.sessionId,
    turnId: a.turnId,
    expectedPage: a.expectedPage,
    routeEpoch: a.routeEpoch,
    contextRevision: a.contextRevision,
    operation: a.operation,
  });
}

function norm(v: string | null): string { return (v || "").trim().toLowerCase(); }
function sameStars(a: number[], b: number[]): boolean {
  const x = a.slice().sort().join(","); const y = b.slice().sort().join(","); return x === y;
}

// ---- bounded FIFO dedup set (REV-13) ----------------------------------------
class BoundedDedup {
  private set = new Set<string>();
  constructor(private cap: number) {}
  has(id: string): boolean { return this.set.has(id); }
  add(id: string): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    while (this.set.size > this.cap) {
      const oldest = this.set.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.set.delete(oldest);
    }
  }
  get size(): number { return this.set.size; }
}

export interface LiveAiRuntime {
  readonly sessionId: string;
  isActivated(): boolean;
  getRole(): LiveAiRole;
  setRole(role: LiveAiRole): void;
  getRouteEpoch(): number;
  activate(): string;
  deactivate(): void;
  beginTurn(text?: string): string;
  getCurrentTurnId(): string | null;
  invalidateRoute(keepRouteKey?: string): number;
  /** Register the current page. Returns an opaque OWNERSHIP TOKEN. */
  registerPage(reg: PageRegistration): string;
  /** Unregister ONLY if the token matches the live registration (REV-04). */
  unregisterPage(token: string): void;
  getRegisteredPageId(): LiveAiPageId | null;
  getRegistrationToken(): string | null;
  makeEnvelope(operation: LiveAiOperation, turnId?: string): OperationEnvelope | null;
  /** LIVE-AI-02A: the current bounded, data-minimized PublishedContext derived
   *  from the live snapshot (never a raw hotel object / url / DOM / owner field),
   *  for the conversation controller to publish to the gateway. Null when there is
   *  no registered page. PURE — no network, no provider. */
  publishedContext(): PublishedContext | null;
  /** R5B-REV-06 — the canonical current-refinement projection of the live hotels-list snapshot (the
   *  ALREADY-applied destination/query/maxPrice/parking/stars/sort + ordered ids), or null when not on a
   *  hotels list. Used to prove every APPLY dimension against the trusted context. PURE. */
  currentListProjection(): RefinementProjection | null;
  execute(envelope: unknown): ExecutionResult;
  reconcile(): CompanionTurn | null;
  greet(): CompanionTurn | null;
  getMemory(): ReadonlyArray<MemoryTurn>;
  hasExecuted(actionId: string): boolean;
  dedupSize(): number;
}

export function createLiveAiRuntime(initialRole: LiveAiRole = "anonymous"): LiveAiRuntime {
  const sessionId = uid("las");
  let activated = false;
  let role: LiveAiRole = isLiveAiRole(initialRole) ? initialRole : "anonymous";
  let routeEpoch = 0;
  let registration: RegistrationEntry | null = null;
  let currentTurnId: string | null = null;
  let pendingRefinement: PendingRefinement | null = null;
  const memory: MemoryTurn[] = [];
  const dedup = new BoundedDedup(MAX_DEDUP_ENTRIES);

  function pushMemory(r: "user" | "assistant", text: string) {
    memory.push({ turnId: currentTurnId || "-", role: r, text: (text || "").slice(0, 400), at: Date.now() });
    while (memory.length > MAX_MEMORY_TURNS) memory.shift();
  }

  function currentSnapshot(): HotelsListContext | HotelDetailContext | null {
    if (!registration) return null;
    try { return registration.getSnapshot(); } catch { return null; }
  }

  function resolveComparison(snap: HotelsListContext, positions: number[]): ComparisonResult | null {
    const rows: VisibleHotelSummary[] = [];
    for (const p of positions) {
      // REV-07: resolve by TRUE position field, not array index.
      const row = snap.visibleHotels.find((h) => h.position === p);
      if (!row) return null;
      rows.push(row);
    }
    let cheapestPosition: number | null = null, cheapest = Infinity;
    let topRatedPosition: number | null = null, topRated = -Infinity;
    for (const r of rows) {
      if (r.minPrice != null && r.minPrice < cheapest) { cheapest = r.minPrice; cheapestPosition = r.position; }
      if (r.rating != null && r.rating > topRated) { topRated = r.rating; topRatedPosition = r.position; }
    }
    return { rows, cheapestPosition, topRatedPosition };
  }

  function fail(status: LiveAiStatus): ExecutionResult { return { ok: false, status }; }

  const runtime: LiveAiRuntime = {
    sessionId,
    isActivated: () => activated,
    getRole: () => role,
    setRole(next) { if (isLiveAiRole(next)) role = next; },
    getRouteEpoch: () => routeEpoch,

    activate() { activated = true; currentTurnId = uid("turn"); return currentTurnId; },
    deactivate() { activated = false; currentTurnId = null; pendingRefinement = null; },
    beginTurn(text) {
      currentTurnId = uid("turn");
      pendingRefinement = null; // a newer turn supersedes any pending explanation
      if (text) pushMemory("user", text);
      return currentTurnId;
    },
    getCurrentTurnId: () => currentTurnId,

    invalidateRoute(keepRouteKey) {
      routeEpoch += 1;
      if (!(keepRouteKey !== undefined && registration && registration.routeKey === keepRouteKey)) {
        registration = null;
      }
      pendingRefinement = null;
      currentTurnId = activated ? uid("turn") : null;
      return routeEpoch;
    },

    registerPage(reg) {
      const token = uid("reg");
      if (!reg || !isLiveAiPageId(reg.pageId)) return token; // token returned but nothing registered
      if (typeof reg.getSnapshot !== "function" || typeof reg.execute !== "function") return token;
      registration = { pageId: reg.pageId, routeKey: reg.routeKey, token, getSnapshot: reg.getSnapshot, execute: reg.execute };
      return token;
    },
    unregisterPage(token) {
      // Token-gated: an older bridge's cleanup can NEVER remove a newer reg.
      if (registration && registration.token === token) {
        registration = null;
        pendingRefinement = null;
      }
    },
    getRegisteredPageId: () => (registration ? registration.pageId : null),
    getRegistrationToken: () => (registration ? registration.token : null),

    makeEnvelope(operation, turnId) {
      if (!registration) return null;
      const snap = currentSnapshot();
      if (!snap) return null;
      const op = validateOperation(operation);
      if (!op) return null;
      return {
        schema: LIVE_AI_SCHEMA_VERSION,
        actionId: uid("act"),
        sessionId,
        turnId: turnId || currentTurnId || "-",
        expectedPage: OPERATION_PAGE[op.op],
        routeEpoch,
        contextRevision: snap.contextRevision,
        operation: op,
      };
    },

    publishedContext() {
      const snap = currentSnapshot();
      if (!snap) return null;
      return buildPublishedContext(snap, role);
    },

    currentListProjection() {
      // R5B-REV-06 — the canonical current-refinement projection of the live hotels-list snapshot (or null
      // when not on a hotels list). Derived from the SAME snapshot as publishedContext().refinement.
      const snap = currentSnapshot();
      if (!snap || snap.pageId !== "hotels") return null;
      return buildRefinementProjection(snap);
    },

    execute(envelopeRaw) {
      if (process.env.NEXT_PUBLIC_VOICE_AI_BETA !== "1") return fail("disabled");
      if (!activated) return fail("not_activated");
      if (!registration) return fail("no_registration");
      // Validate into ONE immutable canonical copy; every read below (and the
      // operation re-validation) comes from THIS copy, never the raw input.
      const env = validateEnvelope(envelopeRaw);
      if (!env) return fail("invalid_envelope");
      if (env.schema !== LIVE_AI_SCHEMA_VERSION) return fail("schema_mismatch");
      if (env.sessionId !== sessionId) return fail("session_mismatch");
      if (!currentTurnId || env.turnId !== currentTurnId) return fail("stale_turn");
      const op = validateOperation(env.operation);
      if (!op) return fail("invalid_operation");
      if (OPERATION_PAGE[op.op] !== env.expectedPage) return fail("wrong_page");
      if (registration.pageId !== env.expectedPage) return fail("wrong_page");
      const authority = OPERATION_AUTHORITY[op.op];
      if (!authorityEnabled(authority)) return fail("authority_disabled");
      if (env.routeEpoch !== routeEpoch) return fail("stale_route");
      const snap = currentSnapshot();
      if (!snap) return fail("no_registration");
      if (snap.pageId !== env.expectedPage) return fail("wrong_page");
      if (env.contextRevision !== snap.contextRevision) return fail("stale_context");
      if (dedup.has(env.actionId)) return { ok: true, status: "deduped", operation: op.op, authority };
      const res = dispatch(op, snap, authority, env.actionId);
      if (res.status !== "not_ready") dedup.add(env.actionId); // not_ready is retryable
      return res;
    },

    reconcile() {
      if (!pendingRefinement) return null;
      const snap = currentSnapshot();
      if (!snap || snap.pageId !== "hotels") return null;
      const list = snap as HotelsListContext;
      const p = pendingRefinement;
      const dimsMatch = () => {
        if (p.maxPrice !== undefined && list.maxPrice !== p.maxPrice) return false;
        if (p.parking !== undefined && list.parking !== p.parking) return false;
        if (p.sort !== undefined && list.sort !== p.sort) return false;
        if (p.stars !== undefined && !sameStars(list.stars, p.stars)) return false;
        return true;
      };
      if (p.kind === "catalogue") {
        const reqMatch = norm(list.receipt.requestedCity) === norm(p.city) && norm(list.receipt.requestedQuery) === norm(p.query);
        const resMatch = norm(list.receipt.city) === norm(p.city) && norm(list.receipt.query) === norm(p.query);
        if (list.receipt.status === "loading") { if (reqMatch) p.sawLoading = true; return null; }
        if (list.receipt.status !== "ready") return null; // error → never explain
        if (!resMatch || !p.sawLoading || !dimsMatch()) return null;
        pendingRefinement = null;
        return verified(list, { turnId: p.turnId, actionId: p.actionId, operation: p.operation });
      }
      // local: requires a NEW revision reflecting the applied dims (never the
      // pre-setter snapshot count — REV-03).
      if (list.contextRevision === p.revisionAtApply) return null;
      if (list.loadState !== "ready") return null;
      if (!dimsMatch()) return null;
      pendingRefinement = null;
      return verified(list, { turnId: p.turnId, actionId: p.actionId, operation: p.operation });
    },

    greet() {
      if (!activated || !registration) return null;
      const snap = currentSnapshot();
      if (!snap) return null;
      const speech = snap.pageId === "hotels"
        ? "Where are you planning to go? I can help by budget and needs."
        : "You're viewing this stay. I can explain the rooms, price and facilities.";
      pushMemory("assistant", speech);
      return { phase: "greeting", speech };
    },

    getMemory: () => memory.slice(),
    hasExecuted: (actionId: string) => dedup.has(actionId),
    dedupSize: () => dedup.size,
  };

  function verified(list: HotelsListContext, correlated: CompanionTurn["correlated"]): CompanionTurn {
    const n = list.visibleHotels.length;
    const turn: CompanionTurn = { phase: "verified", speech: `${n} ${n === 1 ? "stay" : "stays"} now match.`, correlated };
    pushMemory("assistant", turn.speech);
    return turn;
  }

  function dispatch(op: LiveAiOperation, snap: HotelsListContext | HotelDetailContext, authority: AuthorityLevel, actionId: string): ExecutionResult {
    switch (op.op) {
      case "READ_CURRENT_RESULTS": {
        const list = snap as HotelsListContext;
        // REV-06: no read authority over stale/loading/error results.
        if (list.receipt.status !== "ready") return { ...fail("not_ready"), operation: op.op, authority };
        const results = list.visibleHotels.slice();
        return {
          ok: true, status: "ok", operation: op.op, authority, results,
          companion: { phase: "explain", speech: `You have ${results.length} ${results.length === 1 ? "stay" : "stays"} on screen.` },
        };
      }
      case "COMPARE_VISIBLE_HOTELS": {
        const list = snap as HotelsListContext;
        if (list.receipt.status !== "ready") return { ...fail("not_ready"), operation: op.op, authority };
        const comparison = resolveComparison(list, op.positions);
        if (!comparison) return { ...fail("missing_ordinal"), operation: op.op, authority };
        return { ok: true, status: "ok", operation: op.op, authority, comparison, companion: { phase: "advise", speech: buildCompareSpeech(comparison) } };
      }
      case "OPEN_VISIBLE_HOTEL": {
        const list = snap as HotelsListContext;
        if (list.receipt.status !== "ready") return { ...fail("not_ready"), operation: op.op, authority };
        const row = list.visibleHotels.find((h) => h.position === op.position);
        if (!row) return { ...fail("missing_ordinal"), operation: op.op, authority };
        registration!.execute({ kind: "open_hotel", hotelId: row.id, position: row.position });
        const companion: CompanionTurn = { phase: "acted", accepted: true, speech: `Opening ${row.name}.` };
        pushMemory("assistant", companion.speech);
        return { ok: true, status: "ok", operation: op.op, authority, resolvedHotelId: row.id, companion };
      }
      case "APPLY_HOTEL_REFINEMENT": {
        const list = snap as HotelsListContext;
        const cmd: ResolvedCommand = { kind: "apply_refinement" };
        if ("destination" in op) cmd.destination = op.destination ?? null;
        if ("query" in op) cmd.query = op.query ?? null;
        if ("maxPrice" in op) cmd.maxPrice = op.maxPrice ?? null;
        if ("sort" in op) cmd.sort = op.sort;
        if (op.stars) cmd.stars = op.stars;
        if ("parking" in op && op.parking !== undefined) {
          cmd.parking = op.parking;
          if (op.parking === true) {
            const mapped = resolveParkingAmenity(list.availableAmenities);
            if (!mapped) return { ...fail("unsupported_filter"), operation: op.op, authority }; // atomic; no partial change
            cmd.parkingAmenity = mapped;
          } else cmd.parkingAmenity = null;
        }
        // REV-02B: compose the EFFECTIVE combined target — an unchanged
        // dimension retains its current effective value (not null).
        const effCity = "destination" in op ? (op.destination ?? null) : list.destination;
        const effQuery = "query" in op ? (op.query ?? null) : list.query;
        const changesCatalogue = "destination" in op || "query" in op;
        const pend: PendingRefinement = {
          turnId: currentTurnId || "-",
          actionId,
          operation: op.op,
          kind: changesCatalogue ? "catalogue" : "local",
          revisionAtApply: list.contextRevision,
          city: effCity,
          query: effQuery,
          sawLoading: false,
        };
        if ("maxPrice" in op) pend.maxPrice = op.maxPrice ?? null;
        if ("parking" in op) pend.parking = op.parking;
        if ("sort" in op) pend.sort = op.sort;
        if (op.stars) pend.stars = op.stars;
        pendingRefinement = pend;
        registration!.execute(cmd);
        // REV-03: verification is NEVER granted here — only "acted". reconcile()
        // emits "verified" after a subsequent revision reflects the applied state.
        const companion: CompanionTurn = { phase: "acted", accepted: true, speech: "Updating your results…" };
        pushMemory("assistant", companion.speech);
        return { ok: true, status: "ok", operation: op.op, authority, pendingReconcile: true, companion };
      }
      case "SHOW_HOTEL_SECTION": {
        const detail = snap as HotelDetailContext;
        // REV-10: no detail authority until validated (ready + id match).
        if (!detail.validated) return { ...fail("not_ready"), operation: op.op, authority };
        registration!.execute({ kind: "show_section", section: op.section });
        return {
          ok: true, status: "ok", operation: op.op, authority,
          companion: { phase: "acted", accepted: true, speech: op.section === "rooms" ? "Showing rooms & pricing." : "Showing the About section." },
        };
      }
      case "READ_CURRENT_HOTEL_FACTS": {
        const detail = snap as HotelDetailContext;
        // REV-10: facts only when validated (ready AND route id == loaded id).
        if (detail.loadState !== "ready") return { ...fail("not_ready"), operation: op.op, authority };
        // A route/current id mismatch (incl. a stale previous hotel, or no
        // loaded hotel for this route) is a distinct fail-closed signal.
        if (!detail.routeHotelId || !detail.currentHotelId || detail.routeHotelId !== detail.currentHotelId) {
          return { ...fail("hotel_id_mismatch"), operation: op.op, authority };
        }
        if (!detail.validated || !detail.hotel) {
          return { ...fail("not_ready"), operation: op.op, authority };
        }
        const facts: HotelFacts = {
          hotelId: detail.currentHotelId, breakfast: detail.breakfast, parking: detail.parking,
          roomTypes: detail.roomTypes, hotel: detail.hotel,
        };
        return { ok: true, status: "ok", operation: op.op, authority, facts, companion: { phase: "explain", speech: buildFactsSpeech(facts) } };
      }
      default:
        return fail("invalid_operation");
    }
  }

  return runtime;
}

function buildCompareSpeech(c: ComparisonResult): string {
  const parts: string[] = [];
  if (c.cheapestPosition != null) {
    const row = c.rows.find((r) => r.position === c.cheapestPosition);
    if (row) parts.push(`${row.name} is the lower price`);
  }
  if (c.topRatedPosition != null) {
    const row = c.rows.find((r) => r.position === c.topRatedPosition);
    if (row) parts.push(`${row.name} is rated higher`);
  }
  return parts.length ? parts.join("; ") + "." : "Comparing the current results.";
}

function factWord(f: HotelFacts["breakfast"]): string {
  return f === "present" ? "yes" : f === "absent" ? "no" : "not listed";
}
function buildFactsSpeech(f: HotelFacts): string {
  return `Breakfast: ${factWord(f.breakfast)}. Parking: ${factWord(f.parking)}.`;
}

/**
 * LIVE-AI-02A: project the authority snapshot down to the bounded, data-minimized
 * PublishedContext the gateway may see. Carries ONLY already-bounded fields (never
 * a raw hotel object, a URL, an owner/internal field, a token, or DOM/selectors).
 * A hotel-detail context exposes the current hotel id / facts ONLY when validated.
 */
function buildPublishedContext(snap: HotelsListContext | HotelDetailContext, role: LiveAiRole): PublishedContext {
  if (snap.pageId === "hotels") {
    const list = snap;
    const visibleHotels: PublishedVisibleHotel[] = list.visibleHotels.map((h) => ({
      position: h.position, id: h.id, name: h.name, city: h.city, minPrice: h.minPrice, rating: h.rating, parking: h.parking,
    }));
    return {
      pageId: "hotels", role, destination: list.destination, query: list.query, loadState: list.loadState,
      visibleHotels, currentHotelId: null, validated: false, section: null, breakfast: null, parking: null,
      // R5B-REV-06 — the canonical current-refinement projection (destination/query/maxPrice/parking/stars/
      // sort + ordered ids), so the gateway can prove EVERY APPLY dimension against the trusted context.
      refinement: buildRefinementProjection(list),
    };
  }
  const detail = snap;
  return {
    pageId: "hotel-detail", role, destination: null, query: null, loadState: detail.loadState,
    visibleHotels: [], currentHotelId: detail.validated ? detail.currentHotelId : null, validated: detail.validated,
    section: detail.section, breakfast: detail.validated ? detail.breakfast : null, parking: detail.validated ? detail.parking : null,
    refinement: null, // R5B-REV-06 — a detail page has no list refinement
  };
}
/**
 * R5B-REV-06 — the pure BOUNDED CANONICAL current-refinement projection of a hotels-list snapshot: the
 * ALREADY-APPLIED filter/sort state + resulting ordered ids + count. Normalizes here (in the builder, per
 * the reject-not-normalize split) to a value the wire validator accepts unchanged: maxPrice null unless a
 * finite positive ≤ ceiling; stars deduped + clamped to distinct 1..5 (≤5); sort a known token; orderedIds
 * in ascending display-position order. It represents the already-authorized APPLY contract ONLY (the same
 * six dimensions the APPLY op carries) — never any new filter authority.
 */
function buildRefinementProjection(list: HotelsListContext): RefinementProjection {
  const orderedIds = list.visibleHotels.slice().sort((a, b) => a.position - b.position).map((h) => h.id);
  const stars = Array.from(new Set(list.stars.filter((s) => Number.isInteger(s) && s >= 1 && s <= 5))).slice(0, 5);
  const maxPrice = (typeof list.maxPrice === "number" && Number.isFinite(list.maxPrice) && list.maxPrice > 0 && list.maxPrice <= 10_000_000) ? list.maxPrice : null;
  const sort = (list.sort === "price-asc" || list.sort === "price-desc" || list.sort === "rating") ? list.sort : "default";
  return { destination: list.destination, query: list.query, maxPrice, parking: !!list.parking, stars, sort, orderedIds, count: orderedIds.length };
}
