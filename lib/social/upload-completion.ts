// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B-P1H-2 — PURE upload-completion orchestrator (dependency-free).
//
// The dormant server-side completion path: a customer says "my upload finished",
// and the server INDEPENDENTLY observes the exact private quarantine object's
// metadata (byte size, storage-reported MIME, storage object id, ETag) and passes
// ONLY those trusted server-observed values into the already-accepted P1H-1 DB
// observation gate (public.confirm_media_upload_quarantine_observation).
//
// This module is PURE + dependency-injected: NO Supabase import, NO network, NO
// file bytes. It owns request-body authority, the fixed lifecycle/preflight rules,
// the exact-object + metadata interpretation of a listV2 result, the strict P1H-1
// outcome parsing, and the bounded public response. The privileged Supabase work
// (owner-bound DB preflight, the ONE listV2 metadata read on the server-constant
// bucket, the confirmation RPC) lives in the injected store
// (lib/social/upload-observation-store.ts), so the whole flow is hermetically
// testable with fakes.
//
// SEMANTIC BOUNDARY: reaching "accepted" proves ONLY that the server observed a
// single exact object whose metadata is self-consistent and that P1H-1 accepted
// the observation (upload_authorized -> quarantined). It proves NOTHING about the
// real file type, magic bytes, malware safety, media decodability, READY, or
// publishability — all strictly later stages. There is NO file download, NO
// magic-byte sniff, NO malware scan, NO READY here.
// ═══════════════════════════════════════════════════════════════════════════

// ── Server constants (self-contained; never chosen by the caller) ───────────
export const QUARANTINE_BUCKET = "social-media-quarantine";
export const MAX_OBSERVED_BYTES = 104857600; // 100 MiB — the P1H-1 / quarantine ceiling
const MAX_CONTENT_TYPE_LEN = 128;
const MAX_OBJECT_ID_LEN = 256;
const MAX_ETAG_LEN = 512;

// Canonical LOWERCASE UUID v4 (version nibble 4, variant nibble 8/9/a/b).
const UUID_V4_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isCanonicalUuidV4(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_LOWER.test(v);
}

// Server-derived object key + folder prefix (never client-supplied).
export function expectedObjectKeyFor(sessionId: string): string {
  return `sessions/${sessionId}/raw`;
}
export function expectedPrefixFor(sessionId: string): string {
  return `sessions/${sessionId}/`;
}

// Post-observation lifecycle states: a customer completion is already accepted
// (idempotent) for these — the server never re-reads Storage.
const POST_OBSERVATION_STATES = new Set([
  "quarantined",
  "validating",
  "file_safety",
  "media_processing",
  "ready",
]);

// ── Types (the store contract + the pure results) ───────────────────────────
export type SessionTarget = {
  id: string;
  ownerUserId: string;
  status: string;
  quarantineBucket: string;
  objectKey: string;
};

export type Observation = {
  byteSize: number;
  contentType: string;
  storageObjectId: string;
  storageEtag: string;
};

// The result of observing the exact quarantine object (from the store).
export type ObserveResult =
  | { kind: "observed"; observation: Observation }
  | { kind: "not_observed" } // missing object / prefix-only sibling — retryable
  | { kind: "ambiguous" } // >1 object under the session prefix — fail closed
  | { kind: "invalid_metadata" } // object present but metadata missing/malformed
  | { kind: "error" }; // provider error / malformed response

// The strict P1H-1 RPC outcome (already validated: applied/idempotent require
// status === "quarantined").
export type ConfirmOutcome =
  | "applied"
  | "idempotent_existing"
  | "expired"
  | "observation_mismatch"
  | "state_conflict";

export interface UploadObservationStore {
  configured(): boolean;
  // Owner-BOUND DB preflight (id = sessionId AND owner_user_id = ownerId). No
  // mutation. null when no owner/session match (never reveals another owner's row).
  findOwnedSessionTarget(ownerId: string, sessionId: string): Promise<SessionTarget | null>;
  // ONE bounded Storage metadata read on the SERVER-CONSTANT bucket + the exact
  // server-derived key. Never downloads bytes. Interprets exactly one object.
  observeExactObject(target: SessionTarget): Promise<ObserveResult>;
  // The ONLY lifecycle mutation: the P1H-1 confirmation RPC. Throws on provider
  // error / malformed / wrong status (the handler maps a throw to 503).
  confirmObservation(ownerId: string, sessionId: string, observation: Observation): Promise<ConfirmOutcome>;
}

export type VerifiedRequester = { id: string } | null;

export type CompletionDeps = {
  // Strict customer-domain media authority (INJECTED). Awaited BEFORE the flag /
  // any Supabase work. Returns null (fail closed) when not a verified customer.
  verify: (req: Request) => Promise<VerifiedRequester> | VerifiedRequester;
  store: UploadObservationStore;
  env: Record<string, string | undefined>;
};

// Bounded public failure classes (NEVER leak object metadata / provider errors).
export type CompletionErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "media_upload_observation_disabled"
  | "upload_session_not_available"
  | "upload_not_observed_yet"
  | "upload_observation_mismatch"
  | "upload_observation_service_unavailable";

// ── Dormant activation flag (exact normalized "true" only) ──────────────────
function flagEnabled(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "true";
}

// ── Bounded JSON responses ──────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function accepted(): Response {
  return jsonResponse(200, { ok: true, status: "accepted" });
}
function fail(status: number, error: CompletionErrorCode): Response {
  return jsonResponse(status, { ok: false, error });
}

// ── Request body authority: ONLY { sessionId: <canonical lowercase uuid v4> } ─
// Rejects (never ignores) any unexpected authority-bearing field.
export function parseCompletionBody(body: unknown): { sessionId: string } | { error: "invalid_request" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid_request" };
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "sessionId") return { error: "invalid_request" };
  const sessionId = (body as Record<string, unknown>).sessionId;
  if (!isCanonicalUuidV4(sessionId)) return { error: "invalid_request" };
  return { sessionId };
}

// ── Pure interpreter of a listV2 result into the exact single observation ────
// `raw` is the Supabase Storage listV2 `data` (SearchV2Result: { objects, folders,
// hasNext, nextCursor }). We require EXACTLY ONE object under the session prefix
// whose reconstructed full key equals the server-derived expected key, then pull
// the structurally-valid metadata (no normalization). The installed
// @supabase/storage-js 2.106.2 SearchV2Object shape is { name, key?, id, metadata:
// FileMetadata|null } with FileMetadata { eTag, size, mimetype, contentLength, ... }.
export function interpretListV2Result(raw: unknown, ctx: { sessionId: string }): ObserveResult {
  // ── SEC-00B-P1H-2-R1: strict SearchV2Result shape (fail closed) ──────────
  // The provider result must PROVE it is complete + unambiguous BEFORE any
  // observation is accepted. NO coercion (Boolean/String/Number), NO defaulting a
  // missing hasNext to false or a missing folders to [].
  if (!raw || typeof raw !== "object") return { kind: "error" };
  const r = raw as { objects?: unknown; folders?: unknown; hasNext?: unknown };
  if (!Array.isArray(r.objects)) return { kind: "error" };
  if (!Array.isArray(r.folders)) return { kind: "error" }; // missing/null/non-array folders
  if (typeof r.hasNext !== "boolean") return { kind: "error" }; // exact boolean only
  const objects = r.objects;
  // Pagination fail-closed: hasNext===true means undisclosed additional results
  // may remain, so exact-single-object certainty is NOT proven. This is bounded to
  // ONE metadata query — NO second listV2, NO cursor/nextCursor follow-up.
  if (r.hasNext === true) return { kind: "ambiguous" };
  // A non-empty folders result is not exact-single-object proof (never traversed).
  if (r.folders.length > 0) return { kind: "ambiguous" };
  // Object-count rule (only AFTER provider-shape / pagination / folder validation).
  if (objects.length === 0) return { kind: "not_observed" }; // upload may still be finishing
  if (objects.length > 1) return { kind: "ambiguous" }; // more than the one expected object

  const expectedKey = expectedObjectKeyFor(ctx.sessionId);
  const expectedPrefix = expectedPrefixFor(ctx.sessionId);
  const obj = objects[0] as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return { kind: "not_observed" };

  // Reconstruct the exact full key from the verified installed contract: `key`
  // (full path) when present, else the relative `name` rebuilt onto the exact
  // server prefix (or accepted as-is only when it already equals the exact key).
  const fullKey = deriveFullKey(obj, expectedPrefix, expectedKey);
  if (fullKey !== expectedKey) return { kind: "not_observed" }; // prefix-only sibling / wrong path

  // Storage object id — non-empty string, bounded.
  const objectId = obj.id;
  if (typeof objectId !== "string" || objectId.trim().length === 0 || objectId.length > MAX_OBJECT_ID_LEN) {
    return { kind: "invalid_metadata" };
  }
  const md = obj.metadata;
  if (!md || typeof md !== "object") return { kind: "invalid_metadata" };
  const meta = md as Record<string, unknown>;

  // Actual byte size — the authoritative `size` field; if `contentLength` is also
  // present it MUST be the same integer (no silent choice between disagreeing
  // fields). Integer, > 0, <= 100 MiB.
  const size = meta.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_OBSERVED_BYTES) {
    return { kind: "invalid_metadata" };
  }
  const contentLength = meta.contentLength;
  if (contentLength !== undefined && contentLength !== null) {
    if (typeof contentLength !== "number" || !Number.isInteger(contentLength) || contentLength !== size) {
      return { kind: "invalid_metadata" }; // provider size/contentLength disagreement
    }
  }

  // Storage-reported MIME — non-empty, bounded. NO normalization (P1H-1 owns the
  // exact declared-vs-observed comparison); only a structural blank/bounds check.
  const mimetype = meta.mimetype;
  if (typeof mimetype !== "string" || mimetype.trim().length === 0 || mimetype.length > MAX_CONTENT_TYPE_LEN) {
    return { kind: "invalid_metadata" };
  }

  // ETag — non-empty string, bounded. Exact provider value; no semantic parsing.
  const etag = meta.eTag;
  if (typeof etag !== "string" || etag.trim().length === 0 || etag.length > MAX_ETAG_LEN) {
    return { kind: "invalid_metadata" };
  }

  return {
    kind: "observed",
    observation: { byteSize: size, contentType: mimetype, storageObjectId: objectId, storageEtag: etag },
  };
}

// Reconstruct an object's full storage key from the verified installed contract.
function deriveFullKey(obj: Record<string, unknown>, expectedPrefix: string, expectedKey: string): string | null {
  const key = obj.key;
  if (typeof key === "string" && key.length > 0) return key; // full object key/path
  const name = obj.name;
  if (typeof name === "string" && name.length > 0) {
    if (name === expectedKey) return name; // server returned the full key as `name`
    return expectedPrefix + name; // server returned a relative name — rebuild on the exact prefix
  }
  return null; // no usable identity
}

// ── Pure strict parser of the P1H-1 RPC jsonb outcome ───────────────────────
// applied / idempotent_existing REQUIRE status === "quarantined" (exact string);
// anything unknown / wrong / non-string returns "malformed" (the store throws →
// the handler maps to 503).
export function interpretConfirmOutcome(raw: unknown): ConfirmOutcome | "malformed" {
  if (!raw || typeof raw !== "object") return "malformed";
  const r = raw as Record<string, unknown>;
  const outcome = r.outcome;
  if (outcome === "applied" || outcome === "idempotent_existing") {
    return r.status === "quarantined" ? (outcome as ConfirmOutcome) : "malformed";
  }
  if (outcome === "expired" || outcome === "observation_mismatch" || outcome === "state_conflict") {
    return outcome;
  }
  return "malformed";
}

// ── The handler: strict order (auth → flag → validate → configured →
//    owner preflight → Storage observe → P1H-1 confirm → bounded response) ────
export async function runUploadCompletion(req: Request, deps: CompletionDeps): Promise<Response> {
  // 1) STRICT customer authentication (no Supabase work yet).
  let who: VerifiedRequester;
  try {
    who = await deps.verify(req);
  } catch {
    who = null;
  }
  if (!who || typeof who.id !== "string" || who.id.length === 0) {
    return fail(401, "unauthorized");
  }

  // 2) Dormant observation feature flag — ZERO Supabase Storage/DB work when off.
  if (!flagEnabled(deps.env.MEDIA_UPLOAD_OBSERVATION_ENABLED)) {
    return fail(404, "media_upload_observation_disabled");
  }

  // 3) Bounded request validation (sessionId-only, canonical lowercase UUID v4).
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = parseCompletionBody(body);
  if ("error" in parsed) return fail(400, "invalid_request");
  const sessionId = parsed.sessionId;

  // 4) Privileged store configured check (fail closed; no network when unconfigured).
  if (!deps.store.configured()) return fail(503, "upload_observation_service_unavailable");

  // 5) Owner-BOUND session preflight (service-role SELECT bound by id + owner).
  let target: SessionTarget | null;
  try {
    target = await deps.store.findOwnedSessionTarget(who.id, sessionId);
  } catch {
    return fail(503, "upload_observation_service_unavailable");
  }
  // Wrong owner / unknown session → the SAME bounded response (no cross-owner reveal).
  if (!target || !isValidTarget(target)) return fail(409, "upload_session_not_available");

  // 5a) Post-observation lifecycle → already accepted (idempotent), NO Storage read.
  if (POST_OBSERVATION_STATES.has(target.status)) return accepted();

  // 5b) Only a still-authorized session can accept a first observation.
  if (target.status !== "upload_authorized") return fail(409, "upload_session_not_available");

  // 5c) Server-owned destination invariants — the DB row must not pick another
  //     bucket/path. Wrong bucket/key → fail closed, NO Storage read.
  if (target.quarantineBucket !== QUARANTINE_BUCKET) return fail(409, "upload_session_not_available");
  if (target.objectKey !== expectedObjectKeyFor(sessionId)) return fail(409, "upload_session_not_available");

  // 6) ONE bounded Storage metadata observation on the server-constant bucket.
  let observed: ObserveResult;
  try {
    observed = await deps.store.observeExactObject(target);
  } catch {
    return fail(503, "upload_observation_service_unavailable");
  }
  if (observed.kind === "not_observed") return fail(409, "upload_not_observed_yet");
  if (observed.kind !== "observed") {
    // ambiguous / invalid_metadata / error → fail closed. ZERO confirmation RPC.
    return fail(503, "upload_observation_service_unavailable");
  }

  // 7) The ONLY lifecycle mutation — the P1H-1 confirmation RPC. Strict outcomes.
  let outcome: ConfirmOutcome;
  try {
    outcome = await deps.store.confirmObservation(who.id, sessionId, observed.observation);
  } catch {
    return fail(503, "upload_observation_service_unavailable");
  }
  switch (outcome) {
    case "applied":
    case "idempotent_existing":
      return accepted();
    case "observation_mismatch":
      return fail(409, "upload_observation_mismatch");
    case "expired":
    case "state_conflict":
    default:
      return fail(409, "upload_session_not_available");
  }
}

function isValidTarget(t: SessionTarget): boolean {
  return (
    typeof t.id === "string" && t.id.length > 0 &&
    typeof t.ownerUserId === "string" && t.ownerUserId.length > 0 &&
    typeof t.status === "string" && t.status.length > 0 &&
    typeof t.quarantineBucket === "string" &&
    typeof t.objectKey === "string"
  );
}
