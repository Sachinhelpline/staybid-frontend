// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B-P1B — DORMANT server upload-session contract (pure + dependency-free).
//
// Authorizes ONE bounded lifecycle step for the server-owned media ingest:
//   CREATED -> UPLOAD_AUTHORIZED
// It validates the request, derives ALL authoritative identity/destination
// fields server-side, and (via an injected server-only store) persists a
// media_upload_sessions row and mints a STANDARD Supabase signed-upload token
// for a server-chosen private-quarantine object key.
//
// HONEST SCOPE: this proves NOTHING about file safety. A minted token is NOT
// READY, NOT malware-safe, NOT publishable. Quarantine/validation/file-safety/
// media-processing/READY/promotion are later packets. There is NO production
// consumer of this route yet (dormant), and it is fail-closed behind
// MEDIA_UPLOAD_SESSION_ENABLED.
//
// PURITY: this module imports nothing (no @/lib, no node, no external deps).
// All effects (auth verification, DB/storage store, clock, id generation) are
// INJECTED, so it is hermetically testable and cannot smuggle an anon key,
// decode-only auth, or a network call of its own.
// ═══════════════════════════════════════════════════════════════════════════

export const MEDIA_CLASSES = [
  "photo",
  "reel",
  "story",
  "audio",
  "avatar",
  "circle_image",
] as const;
export type MediaClass = (typeof MEDIA_CLASSES)[number];

// Authoritative lifecycle states (mirror the P1A DB CHECK). Business PUBLISH is
// NOT a session state.
export const LIFECYCLE_STATES = [
  "created",
  "upload_authorized",
  "uploading",
  "quarantined",
  "validating",
  "file_safety",
  "media_processing",
  "ready",
  "rejected",
  "expired",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

// States that count as "occupying" an upload slot for the concurrency guard.
export const ACTIVE_STATES: LifecycleState[] = ["created", "upload_authorized"];

// Private quarantine bucket (does not exist yet — created in a separate Storage
// packet; the store fails closed until it does).
export const QUARANTINE_BUCKET = "social-media-quarantine";

// Standard Supabase signed-upload token lifetime (Owner-locked): 2 hours.
export const SIGNED_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

// Global dormant size ceiling = the designed quarantine bucket cap (100 MiB).
// NOT a final per-media-class product limit.
export const MAX_BYTE_SIZE = 104857600;

// Provisional pre-cutover abuse bounds (DB-backed). NOT final product tuning.
export const MAX_NEW_SESSIONS_PER_60S = 12;
export const MAX_ACTIVE_SESSIONS = 6;

const CONTENT_TYPE_MAX = 128;
// A bounded MIME-ish shape: type "/" subtype, conservative token chars.
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export type ValidatedInput = {
  mediaClass: MediaClass;
  contentType: string;
  byteSize: number;
  idempotencyKey: string;
};

export type ValidationError =
  | "invalid_request"
  | "invalid_media_class"
  | "invalid_content_type"
  | "invalid_byte_size"
  | "invalid_idempotency_key";

export type ValidationResult =
  | { ok: true; value: ValidatedInput }
  | { ok: false; code: ValidationError };

function isImage(ct: string): boolean {
  return ct.startsWith("image/") && ct !== "image/svg+xml";
}
function isVideo(ct: string): boolean {
  return ct.startsWith("video/");
}
function isAudio(ct: string): boolean {
  return ct.startsWith("audio/");
}

/** Content-type is ADVISORY only (never treated as real type proof). Validated
 *  for shape + per-media-class family; SVG is rejected by default. */
function contentTypeAllowedForClass(mediaClass: MediaClass, ct: string): boolean {
  switch (mediaClass) {
    case "photo":
    case "avatar":
    case "circle_image":
      return isImage(ct);
    case "reel":
      return isVideo(ct);
    case "story":
      return isImage(ct) || isVideo(ct);
    case "audio":
      return isAudio(ct);
    default:
      return false;
  }
}

/** Pure request validator. Fails closed with a static code; never echoes input. */
export function validateInput(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return { ok: false, code: "invalid_request" };
  const b = body as Record<string, unknown>;

  const mediaClass = b.mediaClass;
  if (typeof mediaClass !== "string" || !(MEDIA_CLASSES as readonly string[]).includes(mediaClass)) {
    return { ok: false, code: "invalid_media_class" };
  }

  if (typeof b.contentType !== "string") return { ok: false, code: "invalid_content_type" };
  const contentType = b.contentType.trim().toLowerCase();
  if (
    contentType.length === 0 ||
    contentType.length > CONTENT_TYPE_MAX ||
    !MIME_RE.test(contentType) ||
    contentType === "image/svg+xml" ||
    !contentTypeAllowedForClass(mediaClass as MediaClass, contentType)
  ) {
    return { ok: false, code: "invalid_content_type" };
  }

  const byteSize = b.byteSize;
  if (
    typeof byteSize !== "number" ||
    !Number.isInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > MAX_BYTE_SIZE
  ) {
    return { ok: false, code: "invalid_byte_size" };
  }

  if (typeof b.idempotencyKey !== "string") return { ok: false, code: "invalid_idempotency_key" };
  const idempotencyKey = b.idempotencyKey.trim();
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) {
    return { ok: false, code: "invalid_idempotency_key" };
  }

  return { ok: true, value: { mediaClass: mediaClass as MediaClass, contentType, byteSize, idempotencyKey } };
}

/** Server-owned object key. Contains NO client filename and NO owner PII. */
export function objectKeyForSession(sessionId: string): string {
  return `sessions/${sessionId}/raw`;
}

// ── Injected dependencies (no concrete network/env/crypto in this module) ────
export type UploadSessionRow = {
  id: string;
  owner_user_id: string;
  media_class: string;
  content_type: string;
  declared_byte_size: number;
  object_key: string;
  status: string;
};

// SEC-00B-P1F-1 — the four bounded business outcomes of the atomic reservation
// RPC. `reserved` / `idempotent_existing` carry the canonical row; the two quota
// rejections carry no row.
export type ReserveOutcome =
  | "reserved"
  | "idempotent_existing"
  | "rate_limited"
  | "concurrency_limited";

// Single-literal discriminants (one per member) so the handler narrows the
// union reliably by `reservation.outcome`.
export type ReserveResult =
  | { outcome: "reserved"; row: UploadSessionRow }
  | { outcome: "idempotent_existing"; row: UploadSessionRow }
  | { outcome: "rate_limited" }
  | { outcome: "concurrency_limited" };

export interface UploadSessionStore {
  configured(): boolean;
  /** True ONLY when the private quarantine bucket exists with the exact safe
   *  metadata (id, public===false, file_size_limit===MAX_BYTE_SIZE). */
  bucketReady(): Promise<boolean>;
  findByOwnerIdem(ownerId: string, idempotencyKey: string): Promise<UploadSessionRow | null>;
  /** SEC-00B-P1F-1 — ATOMIC new-session reservation. ONE privileged RPC runs the
   *  idempotency check + the rate (12/60s) & active (6) quota counts + the
   *  CREATED insert (bounded 2h TTL) inside ONE transaction under a per-owner
   *  advisory lock, on a single authoritative DB clock. The caller passes NO
   *  limit / window / TTL / clock — they are DB-FIXED security invariants.
   *  Replaces the former NON-ATOMIC countRecentSessions → countActiveSessions →
   *  insertCreated trio, closing the per-owner quota TOCTOU race. Fails closed
   *  (throws) on any provider error, unknown outcome, or a reserved /
   *  idempotent_existing result whose row is not structurally valid; the handler
   *  maps a throw to 503 (never a new public error surface). */
  reserveNewSession(input: {
    id: string;
    owner_user_id: string;
    media_class: string;
    content_type: string;
    declared_byte_size: number;
    object_key: string;
    idempotency_key: string;
  }): Promise<ReserveResult>;
  /** Standard signed upload for the exact object key (upsert=false). */
  mintSignedUpload(objectKey: string): Promise<{ token: string; path: string } | null>;
  /** CAS: created -> upload_authorized. true ONLY when exactly one row whose
   *  status was still 'created' transitioned (proven by the update's returned
   *  row set). A later lifecycle state can never be regressed by this call. */
  authorizeCreated(id: string, expiresAtIso: string, nowIso: string): Promise<boolean>;
  /** CAS: refresh expiry while status is still 'upload_authorized' (state
   *  unchanged). true ONLY when exactly one matching row was updated. */
  refreshAuthorized(id: string, expiresAtIso: string, nowIso: string): Promise<boolean>;
  /** CAS: created -> rejected. Only a still-'created' row is ever rejected. */
  rejectCreated(id: string, reason: string, nowIso: string): Promise<boolean>;
}

export type VerifiedRequester = { id: string } | null;

export interface UploadSessionDeps {
  // May be async: the strict media customer gate performs a fresh Railway
  // customer lookup. It is awaited AFTER the activation-flag gate, so a disabled
  // flag still performs ZERO authority/network work.
  verify: (req: Request) => VerifiedRequester | Promise<VerifiedRequester>;
  store: UploadSessionStore;
  env: Record<string, string | undefined>;
  now: () => Date;
  genId: () => string;
}

export type UploadSessionErrorCode =
  | ValidationError
  | "unauthorized"
  | "media_upload_sessions_disabled"
  | "upload_session_service_unavailable"
  | "quarantine_unavailable"
  | "idempotency_conflict"
  | "session_state_conflict"
  | "upload_session_rate_limited"
  | "upload_session_concurrency_limited"
  | "upload_authorization_failed";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
const err = (status: number, code: UploadSessionErrorCode): Response => json(status, { error: code });

function flagEnabled(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "true";
}

/**
 * DORMANT upload-session authorization handler (CREATED -> UPLOAD_AUTHORIZED).
 * Returns a Response; all effects go through injected deps. Fail-closed at every
 * gap. NEVER returns a token unless the row is persisted as upload_authorized.
 */
export async function handleUploadSession(req: Request, deps: UploadSessionDeps): Promise<Response> {
  // 1) Dormant activation gate — zero store/network work when disabled.
  if (!flagEnabled(deps.env.MEDIA_UPLOAD_SESSION_ENABLED)) {
    return err(503, "media_upload_sessions_disabled");
  }

  // 2) Cryptographic customer auth (HS256-only verifier injected). Firebase
  //    RS256 / forged / expired / missing all resolve to null here.
  const user = await deps.verify(req);
  if (!user || typeof user.id !== "string" || user.id.length === 0) {
    return err(401, "unauthorized");
  }
  const owner = user.id;

  // 3) Input validation.
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const v = validateInput(body);
  if (!v.ok) return err(400, v.code);

  // 4) Service-role store must be configured (no anon fallback anywhere).
  if (!deps.store.configured()) return err(503, "upload_session_service_unavailable");

  // 5) IDEMPOTENCY FIRST (R3): an idempotent retry of an existing session is NOT
  //    a new session and must NOT be blocked by the new-session rate/active
  //    guards. Resolve the canonical (owner, idempotencyKey) row before any
  //    new-session-only limit or new-session bucket/insert work.
  let existing: UploadSessionRow | null = null;
  try {
    existing = await deps.store.findByOwnerIdem(owner, v.value.idempotencyKey);
  } catch {
    return err(503, "upload_session_service_unavailable");
  }
  if (existing) return authorizeExisting(existing, v.value, deps);

  // 6) NEW session only — quarantine readiness (R1) BEFORE any reservation (no
  //    dormant garbage), regardless of the atomic quota gate below.
  let bucketOk = false;
  try {
    bucketOk = await deps.store.bucketReady();
  } catch {
    return err(503, "upload_session_service_unavailable");
  }
  if (!bucketOk) return err(503, "quarantine_unavailable");

  // 7) Server-owned id + object key (never client-supplied).
  const sessionId = deps.genId();
  const objectKey = objectKeyForSession(sessionId);

  // 8) SEC-00B-P1F-1 — ONE atomic reservation RPC does the idempotency check +
  //    rate (12/60s) & active (6) quota + CREATED insert in a single txn under a
  //    per-owner advisory lock on a single DB clock. The former non-atomic
  //    countRecent → countActive → insert trio (a TOCTOU race) is gone. The
  //    handler supplies NO limit / window / TTL / clock — they are DB-fixed.
  let reservation: ReserveResult;
  try {
    reservation = await deps.store.reserveNewSession({
      id: sessionId,
      owner_user_id: owner,
      media_class: v.value.mediaClass,
      content_type: v.value.contentType,
      declared_byte_size: v.value.byteSize,
      object_key: objectKey,
      idempotency_key: v.value.idempotencyKey,
    });
  } catch {
    return err(503, "upload_session_service_unavailable");
  }

  // 9) Handle the bounded reservation outcome.
  if (reservation.outcome === "rate_limited") return err(429, "upload_session_rate_limited");
  if (reservation.outcome === "concurrency_limited") return err(429, "upload_session_concurrency_limited");

  if (reservation.outcome === "idempotent_existing") {
    // A concurrent / prior reservation under the SAME (owner, idempotency) key
    // resolved to this canonical row — the DB is the arbiter. Apply the same
    // idempotency rules as a direct findByOwnerIdem hit.
    return authorizeExisting(reservation.row, v.value, deps);
  }

  // outcome === 'reserved' — a fresh CREATED row was atomically inserted.
  // RESERVED-ROW INVARIANT (§19): the canonical row MUST match the exact
  // reservation the server requested before any signed-upload token is minted.
  const row = reservation.row;
  if (
    row.id !== sessionId ||
    row.owner_user_id !== owner ||
    row.object_key !== objectKey ||
    row.status !== "created" ||
    !factsMatch(row, v.value)
  ) {
    return err(503, "upload_session_service_unavailable");
  }

  // Fresh CREATED row → created->upload_authorized CAS path (provider mint runs
  // only AFTER the DB reservation committed).
  return mintAndTransition(sessionId, objectKey, "created", deps);
}

function factsMatch(row: UploadSessionRow, input: ValidatedInput): boolean {
  return (
    row.media_class === input.mediaClass &&
    row.content_type === input.contentType &&
    Number(row.declared_byte_size) === input.byteSize
  );
}

async function authorizeExisting(
  row: UploadSessionRow,
  input: ValidatedInput,
  deps: UploadSessionDeps
): Promise<Response> {
  if (!factsMatch(row, input)) return err(409, "idempotency_conflict");
  // Terminal / later states need no token mint and no bucket check.
  if (row.status !== "created" && row.status !== "upload_authorized") {
    return err(409, "session_state_conflict");
  }
  // created / upload_authorized both require a fresh signed token → the bucket
  // must be suitable before minting.
  let bucketOk = false;
  try {
    bucketOk = await deps.store.bucketReady();
  } catch {
    return err(503, "upload_session_service_unavailable");
  }
  if (!bucketOk) return err(503, "quarantine_unavailable");
  return mintAndTransition(row.id, row.object_key, row.status, deps);
}

/**
 * Mint a standard signed-upload token for the EXACT server-owned object key and
 * conditionally (CAS) transition the row. currentStatus decides the CAS:
 *   'created'           -> authorizeCreated (created -> upload_authorized)
 *   'upload_authorized' -> refreshAuthorized (expiry refresh, state unchanged)
 * A minted token is returned ONLY when the provider path exactly matches the
 * server object key AND the CAS transitioned exactly one row.
 */
async function mintAndTransition(
  id: string,
  objectKey: string,
  currentStatus: "created" | "upload_authorized",
  deps: UploadSessionDeps
): Promise<Response> {
  let mint: { token: string; path: string } | null = null;
  try {
    mint = await deps.store.mintSignedUpload(objectKey);
  } catch {
    mint = null;
  }
  // R4 provider-path invariant: non-empty token AND path EXACTLY == object key.
  const mintBad =
    !mint || typeof mint.token !== "string" || mint.token.length === 0 || mint.path !== objectKey;
  if (mintBad) {
    // Only a still-CREATED session is marked rejected; an already-authorized
    // session's lifecycle state is never mutated by a refresh mint failure.
    if (currentStatus === "created") {
      try {
        await deps.store.rejectCreated(id, "upload_authorization_failed", deps.now().toISOString());
      } catch {
        // best-effort; never leak provider detail
      }
    }
    return err(503, "upload_authorization_failed");
  }
  if (!mint) return err(503, "upload_authorization_failed"); // narrow (unreachable: mintBad covered it)

  const nowIso = deps.now().toISOString();
  const expiresAtIso = new Date(deps.now().getTime() + SIGNED_UPLOAD_TTL_MS).toISOString();
  let ok = false;
  try {
    ok =
      currentStatus === "created"
        ? await deps.store.authorizeCreated(id, expiresAtIso, nowIso)
        : await deps.store.refreshAuthorized(id, expiresAtIso, nowIso);
  } catch {
    ok = false;
  }
  // Security-critical: if the CAS did not transition exactly one matching row
  // (conflict / later-state race / no match), the minted token is NEVER
  // returned — it simply expires unused.
  if (!ok) return err(503, "upload_session_service_unavailable");

  return json(200, { sessionId: id, path: objectKey, token: mint.token, expiresAt: expiresAtIso });
}
