// ─────────────────────────────────────────────────────────────────────────
// Dedicated SERVER-ONLY privileged Supabase admin store (v622 Pass 9C).
//
// The admin gate re-checks the caller's role + blocked-state against the
// canonical Supabase `public.users` row on EVERY request. That check must use a
// PRIVILEGED, service-role Supabase client — NOT the generic `@/lib/sb` helpers,
// whose `SB_READ`/`SB_H`/`SB_ADMIN_KEY` silently fall back to the public anon key
// when `SUPABASE_SERVICE_ROLE_KEY` is unset. An admin authorization decision must
// never depend on an anon-key read.
//
// SECURITY CONTRACT:
//   • Server-only. Reads a NON-public env (`SUPABASE_SERVICE_ROLE_KEY`) that Next
//     never exposes to the client bundle; the key is never returned or logged.
//   • The privileged key is ONLY `SUPABASE_SERVICE_ROLE_KEY`. Never the anon /
//     publishable key, `SB_KEY`, `SB_READ`, `SB_H`, `SB_ADMIN_KEY`, a
//     `NEXT_PUBLIC_*` key, or a hardcoded secret.
//   • The Supabase project URL is NON-secret: it reuses the already-proven
//     `SB_URL` contract (or an explicit `SUPABASE_URL` env override for tests);
//     no secret URL fallback is invented.
//   • Missing URL or service-role key ⇒ `configured() === false` ⇒ the store
//     throws a static unavailable error and admin auth FAILS CLOSED, with ZERO
//     network calls.
//   • The client disables all session behavior (persistSession / autoRefreshToken
//     / detectSessionInUrl = false) and NEVER calls sign-in / session / refresh /
//     user-management / mutation / RPC / storage methods.
//   • Reads ONLY `public.users`, by the verified JWT subject, selecting a narrow
//     allowlist (id, phone, name, role, isBlocked) — never `select("*")`, always
//     `no-store` (no CDN/Next fetch cache), no in-memory authorization cache.
//   • Supabase errors map to a STATIC internal error — the raw response, filters,
//     ids, url, headers, or key are never returned or logged.
// ─────────────────────────────────────────────────────────────────────────
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SB_URL } from "@/lib/sb";

// Narrow allowlisted admin row — nothing else is read off the DB row.
export type AdminRow = {
  id: string;
  phone: string | null;
  name: string | null;
  role: string;
  isBlocked: boolean | null;
};

const USERS_TABLE = "users";
const USER_SELECT = "id,phone,name,role,isBlocked";

// A static, side-effect-free failure. Callers treat it as "deny / fail closed";
// it never carries raw Supabase/network detail.
export class AdminStoreUnavailableError extends Error {
  code = "admin_store_unavailable";
  constructor() {
    super("admin_store_unavailable");
  }
}

export interface AdminStore {
  /** True only when the privileged URL + service-role key are both present. */
  configured(): boolean;
  /** Fresh Supabase `public.users` lookup by verified subject. Throws AdminStoreUnavailableError on infra/config. */
  findAdminById(id: string): Promise<AdminRow | null>;
}

function shapeRow(r: any): AdminRow {
  return {
    id: String(r?.id ?? ""),
    phone: r?.phone ?? null,
    name: r?.name ?? null,
    role: String(r?.role ?? ""),
    isBlocked: typeof r?.isBlocked === "boolean" ? r.isBlocked : (r?.isBlocked ?? null),
  };
}

// Build the privileged store. `env` is injectable for tests; it defaults to
// process.env. The URL is the non-secret proven contract (SB_URL) or an explicit
// SUPABASE_URL override; the privileged key is SUPABASE_SERVICE_ROLE_KEY ONLY.
export function createAdminStore(env: NodeJS.ProcessEnv = process.env): AdminStore {
  const url = env.SUPABASE_URL || SB_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const ready = !!(url && serviceRoleKey);
  let client: SupabaseClient | null = null;

  const getClient = (): SupabaseClient => {
    if (!ready) throw new AdminStoreUnavailableError();
    if (!client) {
      client = createClient(url as string, serviceRoleKey as string, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        // Fresh reads only — never a CDN/Next data cache for an authz decision.
        global: { fetch: (input: any, init?: any) => fetch(input, { ...(init || {}), cache: "no-store" }) },
      });
    }
    return client;
  };

  return {
    configured: () => ready,

    async findAdminById(id: string): Promise<AdminRow | null> {
      const c = getClient();
      const { data, error } = await c
        .from(USERS_TABLE)
        .select(USER_SELECT)
        .eq("id", id)
        .limit(1)
        .maybeSingle();
      if (error) throw new AdminStoreUnavailableError();
      return data ? shapeRow(data) : null;
    },
  };
}

// Default process-wide privileged store.
export const adminStore: AdminStore = createAdminStore();
