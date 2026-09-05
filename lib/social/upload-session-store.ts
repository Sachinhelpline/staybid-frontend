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
//   • Lifecycle transitions are CONDITIONAL (compare-and-set) and proven by the
//     update's returned row set (exactly one matching row). A later state can
//     never be regressed.
//   • Reads/writes ONLY public.media_upload_sessions + the quarantine bucket's
//     read/ signed-upload authorization. No other table, no RPC, no SECURITY DEFINER.
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
  ACTIVE_STATES,
  type UploadSessionRow,
  type UploadSessionStore,
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
type SupabaseLike = { from(table: string): any; storage: StorageLike };

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

    async countRecentSessions(ownerId: string, sinceIso: string): Promise<number> {
      const { count, error } = await getClient()
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", ownerId)
        .gte("created_at", sinceIso);
      if (error) throw new Error("upload_session_store_count_failed");
      return count ?? 0;
    },

    // F2 — active = an ACTIVE lifecycle status AND not yet expired at nowIso.
    // `expires_at IS NULL` counts as active (fail-closed — a row with no bound
    // still consumes the quota), and any row expired at/before nowIso is excluded
    // so a handful of orphaned created/authorized rows can never permanently
    // block a legitimate owner.
    async countActiveSessions(ownerId: string, nowIso: string): Promise<number> {
      const { count, error } = await getClient()
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", ownerId)
        .in("status", ACTIVE_STATES)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (error) throw new Error("upload_session_store_count_failed");
      return count ?? 0;
    },

    async insertCreated(input): Promise<"ok" | "conflict"> {
      const { error } = await getClient().from(TABLE).insert({
        id: input.id,
        owner_user_id: input.owner_user_id,
        media_class: input.media_class,
        content_type: input.content_type,
        declared_byte_size: input.declared_byte_size,
        quarantine_bucket: QUARANTINE_BUCKET,
        object_key: input.object_key,
        idempotency_key: input.idempotency_key,
        status: "created",
        // F2 — bounded server-owned expiry so an orphaned CREATED row cannot
        // permanently consume the owner's active quota.
        expires_at: input.expiresAtIso,
        created_at: input.nowIso,
        updated_at: input.nowIso,
      });
      if (error) {
        if ((error as any).code === "23505") return "conflict";
        throw new Error("upload_session_store_insert_failed");
      }
      return "ok";
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

    // CAS: created -> upload_authorized. The status guard is bound INTO the
    // update; success is proven by exactly one returned row id.
    async authorizeCreated(id: string, expiresAtIso: string, nowIso: string): Promise<boolean> {
      const { data, error } = await getClient()
        .from(TABLE)
        .update({
          status: "upload_authorized",
          upload_authorized_at: nowIso,
          expires_at: expiresAtIso,
          updated_at: nowIso,
        })
        .eq("id", id)
        .eq("status", "created")
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },

    // CAS: refresh expiry while status is still upload_authorized (state
    // unchanged). Never mints a state change.
    async refreshAuthorized(id: string, expiresAtIso: string, nowIso: string): Promise<boolean> {
      const { data, error } = await getClient()
        .from(TABLE)
        .update({ expires_at: expiresAtIso, updated_at: nowIso })
        .eq("id", id)
        .eq("status", "upload_authorized")
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },

    // CAS: created -> rejected. Only a still-created row is ever rejected.
    async rejectCreated(id: string, reason: string, nowIso: string): Promise<boolean> {
      const { data, error } = await getClient()
        .from(TABLE)
        .update({ status: "rejected", rejected_reason: reason, updated_at: nowIso })
        .eq("id", id)
        .eq("status", "created")
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },
  };
}
