// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B-P1G-2 — DORMANT quarantine STORAGE janitor worker (pure + dep-free).
//
// Consumes the accepted P1G-1 DB claim/lease foundation to delete expired /
// abandoned quarantine-bucket objects, then mark them cleaned. The flow is
// LOCKED:
//   1. claim (ONE P1G-1 claim RPC invocation — DB caps the batch at 50)
//   2. validate EVERY returned claim server-side (canonical UUID v4 + exact
//      bucket + exact server-derived object key)
//   3. delete the exact quarantine object (store enforces the exact target)
//   4. require an EXPLICIT one-object deletion acknowledgement
//   5. ONLY THEN call the P1G-1 completion RPC
// A missing / ambiguous / empty / malformed delete result is RETRYABLE, never
// "completed" (the DB claim simply re-leases after 10 min). Completion is NEVER
// called before a confirmed delete and NEVER in a finally block.
//
// PURITY: this module imports nothing (no @supabase, no node, no @/lib). All
// effects (the privileged store) are INJECTED, so it is hermetically testable
// and cannot smuggle a Supabase client, a service-role key, or a network call.
// The route wires the real server-only store. The worker returns COUNTS only —
// never a session id, object key, bucket, or provider error.
// ═══════════════════════════════════════════════════════════════════════════

// Server constant — the ONLY quarantine bucket this janitor ever touches.
export const QUARANTINE_BUCKET = "social-media-quarantine";

// Production upload-session ids are node:crypto randomUUID() — a canonical,
// lowercase RFC-4122 v4 UUID. Anything else is not a real session id.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True ONLY for a canonical lowercase UUID v4 string. */
export function isCanonicalUuidV4(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_RE.test(v);
}

/** The EXACT server-owned quarantine object key for a session. No prefix, no
 *  suffix, no filename, no traversal — derived purely from the session id. */
export function quarantineObjectKeyForSession(sessionId: string): string {
  return `sessions/${sessionId}/raw`;
}

// A claim row carries ONLY these semantic fields (mirrors the P1G-1 claim RPC).
export type QuarantineClaim = {
  sessionId: string;
  quarantineBucket: string;
  objectKey: string;
};

// Delete result: "confirmed" ONLY on an explicit one-object acknowledgement;
// anything else (error / null / empty / non-array / multiple / missing /
// ambiguous) is "retryable" — the DB claim re-leases for a later run.
export type DeleteOutcome = "confirmed" | "retryable";

// Completion RPC result (P1G-1): the two bounded outcomes only.
export type CompleteOutcome = "completed" | "state_conflict";

/** Injected privileged store. The store (server-only) independently revalidates
 *  the delete target and performs the Supabase RPC / Storage effects. */
export interface QuarantineJanitorStore {
  configured(): boolean;
  /** ONE P1G-1 claim RPC invocation (DB-bounded ≤50). Throws on provider error. */
  claimCleanup(): Promise<QuarantineClaim[]>;
  /** Independently revalidate + delete the EXACT object. "confirmed" ONLY on an
   *  explicit single-object deletion acknowledgement; else "retryable". */
  deleteClaimedObject(claim: QuarantineClaim): Promise<DeleteOutcome>;
  /** P1G-1 completion RPC (p_session_id only). Throws on provider/malformed. */
  completeCleanup(sessionId: string): Promise<CompleteOutcome>;
}

export interface QuarantineJanitorDeps {
  store: QuarantineJanitorStore;
  env: Record<string, string | undefined>;
}

// Bounded COUNTS — the ONLY thing the worker ever exposes.
export type JanitorCounts = {
  claimed: number;
  invalidClaims: number;
  deleteConfirmed: number;
  deleteRetryable: number;
  completed: number;
  completionConflicts: number;
  completionErrors: number;
};

export type JanitorResult =
  | { status: "disabled" }
  | { status: "unconfigured" }
  | { status: "service_unavailable" }
  | { status: "ok"; counts: JanitorCounts };

// Feature flag: enabled ONLY when the normalized value is exactly "true"
// (case-insensitive after trim) — matches the upload-session dormant gate.
function flagEnabled(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "true";
}

/** Worker-side claim validation (defence #1; the store revalidates as #2). A
 *  claim is valid ONLY with a canonical UUID v4 session id, the exact server
 *  bucket, and the exact server-derived object key. */
function isValidClaim(claim: QuarantineClaim): boolean {
  return (
    !!claim &&
    isCanonicalUuidV4(claim.sessionId) &&
    claim.quarantineBucket === QUARANTINE_BUCKET &&
    claim.objectKey === quarantineObjectKeyForSession(claim.sessionId)
  );
}

/**
 * DORMANT quarantine storage janitor. Order (LOCKED): activation gate → store
 * configured → ONE claim → per-claim validate → delete → explicit ack → complete.
 * Returns a discriminated result the route maps to HTTP; on the ok path it
 * carries COUNTS only. Never throws for a per-object failure — it counts safely
 * and continues.
 */
export async function runQuarantineJanitor(deps: QuarantineJanitorDeps): Promise<JanitorResult> {
  // 1) Dormant activation gate — ZERO store/network work when disabled.
  if (!flagEnabled(deps.env.MEDIA_QUARANTINE_JANITOR_ENABLED)) {
    return { status: "disabled" };
  }

  // 2) Service-role store must be configured (no anon fallback anywhere).
  if (!deps.store.configured()) {
    return { status: "unconfigured" };
  }

  // 3) EXACTLY ONE claim RPC invocation (DB caps the batch at 50). No loop, no
  //    recursive drain, no second claim call in this invocation.
  let claims: QuarantineClaim[];
  try {
    claims = await deps.store.claimCleanup();
  } catch {
    return { status: "service_unavailable" };
  }
  if (!Array.isArray(claims)) {
    // A well-behaved store returns an array; anything else is a provider fault.
    return { status: "service_unavailable" };
  }

  const counts: JanitorCounts = {
    claimed: claims.length,
    invalidClaims: 0,
    deleteConfirmed: 0,
    deleteRetryable: 0,
    completed: 0,
    completionConflicts: 0,
    completionErrors: 0,
  };

  for (const claim of claims) {
    // 4) Validate BEFORE any Storage call. A malformed claim is never deleted /
    //    completed — count it and continue with the other claims.
    if (!isValidClaim(claim)) {
      counts.invalidClaims += 1;
      continue;
    }

    // 5) Delete the exact object (the store enforces the target independently).
    let del: DeleteOutcome;
    try {
      del = await deps.store.deleteClaimedObject(claim);
    } catch {
      del = "retryable";
    }
    if (del !== "confirmed") {
      // Missing / ambiguous / error → retryable; NEVER complete. The DB claim
      // re-leases after the 10-minute lease for a later run.
      counts.deleteRetryable += 1;
      continue;
    }
    counts.deleteConfirmed += 1;

    // 6) ONLY after a confirmed delete: complete (never before, never in finally).
    let comp: CompleteOutcome | "error";
    try {
      comp = await deps.store.completeCleanup(claim.sessionId);
    } catch {
      comp = "error";
    }
    if (comp === "completed") counts.completed += 1;
    else if (comp === "state_conflict") counts.completionConflicts += 1;
    else {
      // Confirmed delete + completion RPC error/malformed: DO NOT fabricate a
      // completed state; count a bounded completion error. No second delete.
      counts.completionErrors += 1;
    }
  }

  return { status: "ok", counts };
}
