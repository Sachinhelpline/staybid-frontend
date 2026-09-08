// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1H-2 — SERVER-ONLY privileged upload-observation store.
//
// Holds the SERVICE-ROLE Supabase client used by the dormant upload-completion
// path. It performs exactly three privileged operations and NOTHING else:
//   1. findOwnedSessionTarget — an owner-BOUND read of public.media_upload_sessions
//      (id = sessionId AND owner_user_id = ownerId), minimal columns, no mutation.
//   2. observeExactObject — ONE bounded Storage `listV2` metadata query on the
//      SERVER-CONSTANT quarantine bucket, delegating exact-object identity +
//      metadata validation to the pure interpretListV2Result (upload-completion).
//      It NEVER downloads bytes, mints a signed/public URL, uploads, or removes.
//   3. confirmObservation — the ONLY lifecycle mutation: the P1H-1 RPC
//      public.confirm_media_upload_quarantine_observation.
//
// It deliberately does NOT use the generic `@/lib/sb` helpers (whose
// service-role-or-anon fallback would let a privileged read run on the PUBLIC anon
// key). A privileged observation must never fall back to anon.
//
// SECURITY CONTRACT (mirrors lib/social/upload-session-store.ts):
//   • Server-only (throws in a browser).
//   • Privileged key is ONLY `SUPABASE_SERVICE_ROLE_KEY`; missing/blank/
//     whitespace ⇒ configured() === false ⇒ fail closed, ZERO network.
//   • Never the anon/publishable/`SB_*`/`NEXT_PUBLIC_*`/hardcoded key.
//   • Project URL is PINNED to the exact non-secret project origin; any provided
//     SUPABASE_URL that differs (host/scheme/port/creds/path/query/fragment) is
//     REJECTED (configured() fails closed).
//   • Session persistence/refresh/detectSessionInUrl all false.
//   • The Storage read ALWAYS targets the SERVER CONSTANT bucket
//     (QUARANTINE_BUCKET) and the SERVER-DERIVED key (never target.quarantineBucket
//     / target.objectKey — the DB row is validated by the handler but never chooses
//     the actual provider bucket/path).
//   • The service-role key is never returned to the caller, never logged, never
//     persisted. No file bytes pass through this module.
//   • Testable via an INJECTED Supabase-like client; production always uses the
//     real installed @supabase/supabase-js service-role client.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import {
  QUARANTINE_BUCKET,
  expectedObjectKeyFor,
  expectedPrefixFor,
  interpretListV2Result,
  interpretConfirmOutcome,
  type SessionTarget,
  type ObserveResult,
  type ConfirmOutcome,
  type Observation,
  type UploadObservationStore,
} from "./upload-completion";

// Server-only guard — this module holds the privileged client.
if (typeof window !== "undefined") {
  throw new Error("server_only_module");
}

// Non-secret Supabase project origin (same value used across the app; NOT a
// secret). The privileged service-role destination is PINNED to this exact origin.
const EXPECTED_SUPABASE_ORIGIN = "https://uxxhbdqedazpmvbvaosh.supabase.co";

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
  if (u.origin !== EXPECTED_SUPABASE_ORIGIN) return null;
  return EXPECTED_SUPABASE_ORIGIN;
}

const TABLE = "media_upload_sessions";
const TARGET_SELECT = "id,owner_user_id,status,quarantine_bucket,object_key";
const RPC_CONFIRM = "confirm_media_upload_quarantine_observation";

// Minimal structural type of the installed @supabase/supabase-js surface this
// store uses (also the shape an injected test double implements). The listV2
// options mirror the installed storage-js SearchV2Options (prefix / limit /
// with_delimiter); the metadata verification lives in interpretListV2Result.
type ListV2Options = { prefix?: string; limit?: number; with_delimiter?: boolean };
type StorageBucketLike = {
  listV2(options?: ListV2Options): Promise<{ data: any; error: any }>;
};
type StorageLike = { from(bucket: string): StorageBucketLike };
type SupabaseLike = {
  from(table: string): any;
  storage: StorageLike;
  rpc(fn: string, params: Record<string, unknown>): Promise<{ data: any; error: any }>;
};

/**
 * Build the server-only observation store. `env` is injectable for tests; the URL
 * is the pinned non-secret project origin and the privileged key is
 * SUPABASE_SERVICE_ROLE_KEY ONLY. `deps.client` injects a Supabase-like double for
 * hermetic tests; production omits it and a real service-role client is built lazily.
 */
export function createUploadObservationStore(
  env: NodeJS.ProcessEnv = process.env,
  deps: { client?: SupabaseLike } = {}
): UploadObservationStore {
  const trustedUrl = resolveTrustedUrl(env.SUPABASE_URL);
  const rawKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceRoleKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const injected = deps.client || null;
  const ready = !!injected || !!(trustedUrl && serviceRoleKey);
  let client: SupabaseLike | null = injected;

  const getClient = (): SupabaseLike => {
    if (injected) return injected;
    if (!(trustedUrl && serviceRoleKey)) throw new Error("upload_observation_store_unconfigured");
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

    // Owner-BOUND preflight read. Binds the lookup to BOTH id and owner_user_id so
    // a valid UUID for another owner's session never resolves. Minimal columns, no
    // mutation. Throws on provider error (the handler maps to 503).
    async findOwnedSessionTarget(ownerId: string, sessionId: string): Promise<SessionTarget | null> {
      const { data, error } = await getClient()
        .from(TABLE)
        .select(TARGET_SELECT)
        .eq("id", sessionId)
        .eq("owner_user_id", ownerId)
        .maybeSingle();
      if (error) throw new Error("upload_observation_store_read_failed");
      if (!data) return null;
      return {
        id: String((data as any).id ?? ""),
        ownerUserId: String((data as any).owner_user_id ?? ""),
        status: String((data as any).status ?? ""),
        quarantineBucket: String((data as any).quarantine_bucket ?? ""),
        objectKey: String((data as any).object_key ?? ""),
      };
    },

    // ONE bounded Storage metadata read. ALWAYS the SERVER CONSTANT bucket +
    // SERVER-DERIVED prefix (from the DB row id, never the DB-supplied bucket/key).
    // Flat listing (with_delimiter false), tiny fixed limit (2). Exact-object
    // identity + structural metadata validation are delegated to the pure
    // interpretListV2Result. No download / signed URL / upload / remove.
    async observeExactObject(target: SessionTarget): Promise<ObserveResult> {
      const prefix = expectedPrefixFor(target.id);
      let res: { data: any; error: any };
      try {
        res = await getClient().storage.from(QUARANTINE_BUCKET).listV2({
          prefix,
          limit: 2,
          with_delimiter: false,
        });
      } catch {
        return { kind: "error" };
      }
      if (!res || res.error || !res.data) return { kind: "error" };
      return interpretListV2Result(res.data, { sessionId: target.id });
    },

    // The ONLY lifecycle mutation — the P1H-1 confirmation RPC. Sends exactly the
    // six P1H-1 params (server-observed values only). Throws on provider error or a
    // malformed / wrong-status outcome (interpretConfirmOutcome enforces the exact
    // "quarantined" status for applied/idempotent).
    async confirmObservation(ownerId: string, sessionId: string, observation: Observation): Promise<ConfirmOutcome> {
      const { data, error } = await getClient().rpc(RPC_CONFIRM, {
        p_session_id: sessionId,
        p_owner_user_id: ownerId,
        p_observed_byte_size: observation.byteSize,
        p_observed_content_type: observation.contentType,
        p_storage_object_id: observation.storageObjectId,
        p_storage_etag: observation.storageEtag,
      });
      if (error) throw new Error("upload_observation_store_confirm_failed");
      const parsed = interpretConfirmOutcome(data);
      if (parsed === "malformed") throw new Error("upload_observation_store_confirm_failed");
      return parsed;
    },
  };
}
