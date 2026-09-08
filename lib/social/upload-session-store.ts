// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1B — SERVER-ONLY privileged upload-session store.
//
// Holds the SERVICE-ROLE Supabase client for the media_upload_sessions table +
// the private quarantine bucket's signed-upload authorization. It deliberately
// does NOT use the generic `@/lib/sb` helpers (SB_ADMIN_KEY / SB_H / SB_READ /
// SB_KEY), whose service-role-or-anon fallback would let an upload-authorization
// decision run on the PUBLIC anon key. A privileged mint must never fall back to
// anon.
//
// SECURITY CONTRACT:
//   • Server-only (throws in a browser).
//   • Privileged key is ONLY `SUPABASE_SERVICE_ROLE_KEY`; missing/blank/
//     whitespace ⇒ configured() === false ⇒ fail closed, ZERO network.
//   • Never the anon/publishable/`SB_*`/`NEXT_PUBLIC_*`/hardcoded key.
//   • Project URL is the NON-secret project URL (env `SUPABASE_URL`, else the
//     public project URL constant). No secret URL.
//   • Session persistence/refresh/detectSessionInUrl all false.
//   • Bucket readiness requires the EXACT safe metadata (private + 100 MiB cap),
//     because the client-declared byteSize is NOT proof of the actual uploaded
//     object size — the Storage ceiling must exist too.
//   • Lifecycle transitions are CONDITIONAL (compare-and-set). SEC-00B-P1F-2:
//     they no longer run as store UPDATEs — they go through a single privileged
//     DB-time RPC that owns the clock, the 2h TTL, and the rejection reason (no
//     application timestamp / TTL / reason is ever sent). A later state can never
//     be regressed (each CAS is bound on the exact expected status in the DB).
//   • Reads/writes ONLY public.media_upload_sessions + the quarantine bucket's
//     read / signed-upload authorization, plus EXACTLY TWO privileged RPCs — the
//     atomic new-session reservation (public.reserve_media_upload_session —
//     SEC-00B-P1F-1) and the DB-time lifecycle CAS
//     (public.apply_media_upload_authorization_cas — SEC-00B-P1F-2). No other
//     table. Both RPCs are SECURITY INVOKER with EXECUTE granted to service_role
//     ONLY (this privileged store is the only caller); there is still NO SECURITY
//     DEFINER function and NO anon fallback anywhere in this module.
//   • The service-role key + signed token + signed URL are never returned to the
//     caller, never logged, never persisted. Requester Authorization is never
//     forwarded to Supabase. No file bytes pass through this module.
//   • The store is testable via an INJECTED Supabase-like client; production
//     always uses the real installed @supabase/supabase-js service-role client.
// ─────────────────────────────────────────────────────────────────────────
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  QUARANTINE_BUCKET,
  MAX_BYTE_SIZE,
  type UploadSessionRow,
  type UploadSessionStore,
  type ReserveResult,
  type AuthorizeCasResult,
  type RejectCasResult,
} from "./upload-session";

// Server-only guard — this module holds the privileged client.
if (typeof window !== "undefined") {
  throw new Error("server_only_module");
}

// Non-secret Supabase project URL (same value used across the app; NOT a secret).
// F3 — the privileged service-role destination is PINNED to this exact origin.
const EXPECTED_SUPABASE_ORIGIN = "https://uxxhbdqedazpmvbvaosh.supabase.co";

/**
 * F3 — resolve the service-role destination URL, PINNED to the expected project
 * origin. A blank/absent env value falls back to the pinned origin; ANY provided
 * value that is not EXACTLY the expected origin at the root path (different host,
 * http scheme, non-default port, embedded credentials, query, fragment, a
 * non-root path, protocol-relative, or malformed) is REJECTED (returns null so
 * configured() fails closed) — a privileged mint must never be redirected to an
 * attacker-influenced destination.
 */
function resolveTrustedUrl(raw: string | undefined): string | null {
  if (raw == null) return EXPECTED_SUPABASE_ORIGIN;
  const trimmed = String(raw).trim();
  if (trimmed === "") return EXPECTED_SUPABASE_ORIGIN;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null; // malformed / protocol-relative / not absolute
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null; // embedded credentials
  if (u.hostname !== "uxxhbdqedazpmvbvaosh.supabase.co") return null;
  if (u.port !== "") return null; // non-default (implicit 443 only)
  if (u.search !== "" || u.hash !== "") return null; // no query / fragment
  if (u.pathname !== "/" && u.pathname !== "") return null; // root only
  // Normalize to the exact pinned origin (drops any trailing slash).
  if (u.origin !== EXPECTED_SUPABASE_ORIGIN) return null;
  return EXPECTED_SUPABASE_ORIGIN;
}
const TABLE = "media_upload_sessions";
const ROW_SELECT = "id,owner_user_id,media_class,content_type,declared_byte_size,object_key,status";

// Minimal structural type of the Supabase surface this store uses (also the
// shape an injected test double implements).
type StorageLike = {
  getBucket(id: string): Promise<{ data: any; error: any }>;
  from(bucket: string): { createSignedUploadUrl(path: string, opts: { upsert: boolean }): Promise<{ data: any; error: any }> };
};
type SupabaseLike = {
  from(table: string): any;
  storage: StorageLike;
  // SEC-00B-P1F-1 / P1F-2 — the privileged RPC surface (the atomic reservation
  // AND the DB-time lifecycle CAS). Awaiting the call resolves to { data, error }
  // (PostgREST shape), exactly like the real @supabase/supabase-js .rpc().
  rpc(fn: string, params: Record<string, unknown>): Promise<{ data: any; error: any }>;
};

// SEC-00B-P1F-1 — structural validation of a canonical row returned by the
// reservation RPC for a reserved / idempotent_existing outcome. Fail-closed: a
// missing/blank id, owner, object_key or status is not a usable reservation.
function isValidRow(r: any): boolean {
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.id === "string" && r.id.length > 0 &&
    typeof r.owner_user_id === "string" && r.owner_user_id.length > 0 &&
    typeof r.object_key === "string" && r.object_key.length > 0 &&
    typeof r.status === "string" && r.status.length > 0
  );
}

function shapeRow(r: any): UploadSessionRow {
  return {
    id: String(r?.id ?? ""),
    owner_user_id: String(r?.owner_user_id ?? ""),
    media_class: String(r?.media_class ?? ""),
    content_type: String(r?.content_type ?? ""),
    declared_byte_size: Number(r?.declared_byte_size ?? 0),
    object_key: String(r?.object_key ?? ""),
    status: String(r?.status ?? ""),
  };
}

// SEC-00B-P1F-2 — the three fixed lifecycle actions accepted by the DB-time CAS
// RPC. The store never invents a fourth action, and passes NO other parameter.
type LifecycleAction = "authorize_created" | "refresh_authorized" | "reject_created";

// Fail-closed: a DB-generated expiry is usable ONLY if it is a non-empty,
// parseable timestamp string. The application never synthesizes an expiry — a
// missing/blank/unparseable value from an `applied` authorize/refresh is a
// fail-closed error (the store throws; the handler maps it to 503).
function isValidExpiresAt(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length === 0) return false;
  return Number.isFinite(Date.parse(s));
}

// SEC-00B-P1F-2 — the SINGLE privileged lifecycle CAS invocation. Sends ONLY the
// session id + the fixed action (never a clock / TTL / expiry / reason / expected
// status). Fails closed (throws) on any provider error, non-object data, or an
// unknown/malformed outcome. Returns the bounded business result with the RAW
// `status` value from the RPC (NO coercion / trimming / case-folding) so each
// caller can enforce the EXACT expected-status contract itself (SEC-00B-P1F-2-R2).
type CasApplied = { outcome: "applied"; status: unknown; expires_at?: unknown };
type CasResult = CasApplied | { outcome: "state_conflict" };
async function applyAuthorizationCas(
  client: SupabaseLike,
  id: string,
  action: LifecycleAction
): Promise<CasResult> {
  const { data, error } = await client.rpc("apply_media_upload_authorization_cas", {
    p_session_id: id,
    p_action: action,
  });
  if (error || !data || typeof data !== "object") {
    throw new Error("upload_session_lifecycle_cas_failed");
  }
  const outcome = (data as any).outcome;
  if (outcome === "state_conflict") return { outcome: "state_conflict" };
  if (outcome === "applied") {
    // Carry the RAW status (not String()-coerced) so the caller's exact ===
    // check catches a missing / null / non-string / blank / wrong / wrong-case
    // status as a fail-closed mismatch rather than a silently coerced string.
    return { outcome: "applied", status: (data as any).status, expires_at: (data as any).expires_at };
  }
  // Unknown / malformed outcome → fail closed.
  throw new Error("upload_session_lifecycle_cas_failed");
}

/**
 * Build the server-only store. `env` is injectable for tests; the URL is the
 * non-secret project URL and the privileged key is SUPABASE_SERVICE_ROLE_KEY
 * ONLY. `deps.client` injects a Supabase-like double for hermetic tests;
 * production omits it and a real service-role client is built lazily.
 */
export function createUploadSessionStore(
  env: NodeJS.ProcessEnv = process.env,
  deps: { client?: SupabaseLike } = {}
): UploadSessionStore {
  // F3 — the destination is the PINNED trusted origin (null when a provided
  // SUPABASE_URL is not the exact expected origin ⇒ fail closed).
  const trustedUrl = resolveTrustedUrl(env.SUPABASE_URL);
  const rawKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceRoleKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const injected = deps.client || null;
  // configured() requires BOTH the service-role key AND a trusted (pinned) URL.
  const ready = !!injected || !!(trustedUrl && serviceRoleKey);
  let client: SupabaseLike | null = injected;

  const getClient = (): SupabaseLike => {
    if (injected) return injected;
    if (!(trustedUrl && serviceRoleKey)) throw new Error("upload_session_store_unconfigured");
    if (!client) {
      client = createClient(trustedUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }) as unknown as SupabaseLike;
    }
    return client;
  };

  return {
    configured(): boolean {
      return ready;
    },

    async bucketReady(): Promise<boolean> {
      const { data, error } = await getClient().storage.getBucket(QUARANTINE_BUCKET);
      if (error || !data) return false;
      // EXACT safe metadata: right bucket, private, and the 100 MiB ceiling.
      const idOk = data.id === QUARANTINE_BUCKET || data.name === QUARANTINE_BUCKET;
      const privateOk = data.public === false;
      const sizeOk = data.file_size_limit === MAX_BYTE_SIZE;
      return idOk && privateOk && sizeOk;
    },

    async findByOwnerIdem(ownerId: string, idempotencyKey: string): Promise<UploadSessionRow | null> {
      const { data, error } = await getClient()
        .from(TABLE)
        .select(ROW_SELECT)
        .eq("owner_user_id", ownerId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw new Error("upload_session_store_read_failed");
      return data ? shapeRow(data) : null;
    },

    // SEC-00B-P1F-1 — ATOMIC new-session reservation via the single privileged
    // RPC. The former non-atomic countRecentSessions → countActiveSessions →
    // insertCreated trio is REMOVED (it left a per-owner quota TOCTOU race); the
    // idempotency check + rate (12/60s) & active (6) quota + CREATED insert now
    // run in ONE transaction under a per-owner advisory lock on a single DB
    // clock. Only the trusted server-owned reservation inputs are passed — NO
    // rate / window / TTL / now (they are DB-fixed security invariants). Fails
    // closed on any provider error, unknown outcome, or a reserved /
    // idempotent_existing result whose row is not structurally valid.
    async reserveNewSession(input): Promise<ReserveResult> {
      const { data, error } = await getClient().rpc("reserve_media_upload_session", {
        p_session_id: input.id,
        p_owner_user_id: input.owner_user_id,
        p_media_class: input.media_class,
        p_content_type: input.content_type,
        p_declared_byte_size: input.declared_byte_size,
        p_object_key: input.object_key,
        p_idempotency_key: input.idempotency_key,
      });
      if (error || !data || typeof data !== "object") {
        throw new Error("upload_session_store_reserve_failed");
      }
      const outcome = (data as any).outcome;
      if (outcome === "rate_limited" || outcome === "concurrency_limited") {
        return { outcome };
      }
      if (outcome === "reserved" || outcome === "idempotent_existing") {
        const raw = (data as any).row;
        if (!isValidRow(raw)) throw new Error("upload_session_store_reserve_failed");
        return { outcome, row: shapeRow(raw) };
      }
      // Unknown / malformed outcome → fail closed.
      throw new Error("upload_session_store_reserve_failed");
    },

    // F1 — the signed-upload mint is authoritative ONLY when the provider
    // returns a non-empty token AND a path that is EXACTLY the server object key.
    // No `data.path || objectKey` fallback: a missing/blank/mismatched provider
    // path is a fail-closed null (the caller then rejects/does-not-authorize).
    async mintSignedUpload(objectKey: string): Promise<{ token: string; path: string } | null> {
      const { data, error } = await getClient()
        .storage.from(QUARANTINE_BUCKET)
        .createSignedUploadUrl(objectKey, { upsert: false });
      if (error || !data) return null;
      const token = typeof data.token === "string" ? data.token.trim() : "";
      if (token === "") return null;
      if (typeof data.path !== "string" || data.path !== objectKey) return null;
      return { token, path: data.path };
    },

    // SEC-00B-P1F-2 — DB-time CAS: created -> upload_authorized via the single
    // privileged RPC. NO application clock / TTL / expiry is sent; the DB stamps
    // upload_authorized_at/updated_at/expires_at from one post-lock instant and
    // RETURNS the authoritative expiry. `applied` requires BOTH the EXACT returned
    // status "upload_authorized" (SEC-00B-P1F-2-R2: no coercion / trim / case) AND
    // a valid non-empty parseable DB expires_at — any mismatch fails closed
    // (throw). `state_conflict` means the row was not still 'created' (later-state
    // race, zero mutation).
    async authorizeCreated(id: string): Promise<AuthorizeCasResult> {
      const r = await applyAuthorizationCas(getClient(), id, "authorize_created");
      if (r.outcome !== "applied") return { outcome: "state_conflict" };
      if (r.status !== "upload_authorized") throw new Error("upload_session_lifecycle_cas_failed");
      if (!isValidExpiresAt(r.expires_at)) throw new Error("upload_session_lifecycle_cas_failed");
      return { outcome: "applied", expiresAt: r.expires_at };
    },

    // SEC-00B-P1F-2 — DB-time CAS: refresh expiry while status is still
    // 'upload_authorized' (state + upload_authorized_at unchanged). Session id
    // only; the DB owns updated_at/expires_at and returns the fresh expiry. R2:
    // `applied` requires the EXACT returned status "upload_authorized" AND a valid
    // DB expires_at, else fail closed (throw).
    async refreshAuthorized(id: string): Promise<AuthorizeCasResult> {
      const r = await applyAuthorizationCas(getClient(), id, "refresh_authorized");
      if (r.outcome !== "applied") return { outcome: "state_conflict" };
      if (r.status !== "upload_authorized") throw new Error("upload_session_lifecycle_cas_failed");
      if (!isValidExpiresAt(r.expires_at)) throw new Error("upload_session_lifecycle_cas_failed");
      return { outcome: "applied", expiresAt: r.expires_at };
    },

    // SEC-00B-P1F-2 — DB-time CAS: created -> rejected via the same RPC. Session
    // id ONLY — the rejection reason and timestamp are DB-owned, never
    // caller-supplied. Only a still-'created' row is ever rejected. R2: `applied`
    // requires the EXACT returned status "rejected" (no coercion / trim / case),
    // else fail closed (throw). No expiry is required for reject.
    async rejectCreated(id: string): Promise<RejectCasResult> {
      const r = await applyAuthorizationCas(getClient(), id, "reject_created");
      if (r.outcome !== "applied") return { outcome: "state_conflict" };
      if (r.status !== "rejected") throw new Error("upload_session_lifecycle_cas_failed");
      return { outcome: "applied" };
    },
  };
}
