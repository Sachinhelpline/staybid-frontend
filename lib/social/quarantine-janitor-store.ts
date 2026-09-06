// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1G-2 — SERVER-ONLY privileged quarantine-janitor store.
//
// Holds the SERVICE-ROLE Supabase client used by the dormant quarantine storage
// janitor. It deliberately does NOT use the generic `@/lib/sb` helpers (whose
// service-role-or-anon fallback would let a privileged Storage delete run on the
// PUBLIC anon key). A privileged delete must never fall back to anon.
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
//   • Reads/writes ONLY the two P1G-1 privileged RPCs
//     (public.claim_media_upload_quarantine_cleanup /
//      public.complete_media_upload_quarantine_cleanup) + the quarantine
//     bucket's signed remove. NO direct media_upload_sessions table access, NO
//     storage.objects SQL, NO other RPC.
//   • DEFENCE IN DEPTH: deleteClaimedObject independently revalidates the target
//     (canonical UUID v4 + exact bucket + exact server-derived key) BEFORE any
//     Storage call, and the actual delete always targets the SERVER CONSTANT
//     bucket + server-derived key — the DB-returned values never choose the
//     bucket or the path.
//   • A delete is CONFIRMED only on an explicit single-object acknowledgement;
//     empty/missing/ambiguous ⇒ retryable (never completed).
//   • The service-role key is never returned to the caller, never logged, never
//     persisted. No file bytes pass through this module.
//   • Testable via an INJECTED Supabase-like client; production always uses the
//     real installed @supabase/supabase-js service-role client.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import {
  QUARANTINE_BUCKET,
  isCanonicalUuidV4,
  quarantineObjectKeyForSession,
  type QuarantineClaim,
  type QuarantineJanitorStore,
  type DeleteOutcome,
  type CompleteOutcome,
} from "./quarantine-janitor";

// Server-only guard — this module holds the privileged client.
if (typeof window !== "undefined") {
  throw new Error("server_only_module");
}

// Non-secret Supabase project origin (same value used across the app; NOT a
// secret). The privileged service-role destination is PINNED to this exact
// origin — a provided SUPABASE_URL that is not EXACTLY this origin at the root
// path is REJECTED (returns null ⇒ configured() fails closed).
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

// P1G-1 RPC names — the ONLY DB surfaces this store may reach.
const RPC_CLAIM = "claim_media_upload_quarantine_cleanup";
const RPC_COMPLETE = "complete_media_upload_quarantine_cleanup";

// Minimal structural type of the Supabase surface this store uses (also the
// shape an injected test double implements).
type StorageLike = {
  from(bucket: string): { remove(paths: string[]): Promise<{ data: any; error: any }> };
};
type SupabaseLike = {
  rpc(fn: string, params?: Record<string, unknown>): Promise<{ data: any; error: any }>;
  storage: StorageLike;
};

/**
 * Build the server-only janitor store. `env` is injectable for tests; the URL is
 * the pinned non-secret project origin and the privileged key is
 * SUPABASE_SERVICE_ROLE_KEY ONLY. `deps.client` injects a Supabase-like double
 * for hermetic tests; production omits it and a real service-role client is
 * built lazily.
 */
export function createQuarantineJanitorStore(
  env: NodeJS.ProcessEnv = process.env,
  deps: { client?: SupabaseLike } = {}
): QuarantineJanitorStore {
  const trustedUrl = resolveTrustedUrl(env.SUPABASE_URL);
  const rawKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceRoleKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const injected = deps.client || null;
  const ready = !!injected || !!(trustedUrl && serviceRoleKey);
  let client: SupabaseLike | null = injected;

  const getClient = (): SupabaseLike => {
    if (injected) return injected;
    if (!(trustedUrl && serviceRoleKey)) throw new Error("quarantine_janitor_store_unconfigured");
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

    // ONE P1G-1 claim RPC invocation (no caller parameters — batch/lease/clock
    // are DB-fixed). Fails closed (throws) on provider error or non-array data;
    // the handler maps a throw to 503. Rows are shaped to strings; the caller
    // (and deleteClaimedObject) validate the exact contract.
    async claimCleanup(): Promise<QuarantineClaim[]> {
      const { data, error } = await getClient().rpc(RPC_CLAIM, {});
      if (error || !Array.isArray(data)) {
        throw new Error("quarantine_janitor_store_claim_failed");
      }
      return (data as any[]).map((r) => ({
        sessionId: String(r?.session_id ?? ""),
        quarantineBucket: String(r?.quarantine_bucket ?? ""),
        objectKey: String(r?.object_key ?? ""),
      }));
    },

    // DEFENCE IN DEPTH — independently revalidate the target, then delete the
    // EXACT server-derived key on the SERVER CONSTANT bucket. The DB-returned
    // bucket/key never choose the actual Storage target. "confirmed" ONLY on an
    // explicit single-object acknowledgement; empty/missing/ambiguous/error ⇒
    // "retryable" (never completed).
    async deleteClaimedObject(claim: QuarantineClaim): Promise<DeleteOutcome> {
      if (
        !claim ||
        !isCanonicalUuidV4(claim.sessionId) ||
        claim.quarantineBucket !== QUARANTINE_BUCKET ||
        claim.objectKey !== quarantineObjectKeyForSession(claim.sessionId)
      ) {
        // Refuse — the worker should never pass an invalid claim; if it does,
        // do NOT delete and do NOT let it complete.
        return "retryable";
      }
      // Server-derived key + server-constant bucket (never claim-supplied).
      const objectKey = quarantineObjectKeyForSession(claim.sessionId);
      const { data, error } = await getClient().storage.from(QUARANTINE_BUCKET).remove([objectKey]);
      // Explicit single-object deletion acknowledgement required.
      if (error || !Array.isArray(data) || data.length !== 1) {
        return "retryable";
      }
      return "confirmed";
    },

    // P1G-1 completion RPC — sends ONLY p_session_id (no clock/status/bucket/
    // path/flag). Returns the two bounded outcomes; throws on provider error or
    // unknown/malformed result (the worker counts a completion error, never
    // fabricating a completed state).
    async completeCleanup(sessionId: string): Promise<CompleteOutcome> {
      const { data, error } = await getClient().rpc(RPC_COMPLETE, { p_session_id: sessionId });
      if (error || !data || typeof data !== "object") {
        throw new Error("quarantine_janitor_store_complete_failed");
      }
      const outcome = (data as any).outcome;
      if (outcome === "completed") return "completed";
      if (outcome === "state_conflict") return "state_conflict";
      throw new Error("quarantine_janitor_store_complete_failed");
    },
  };
}
