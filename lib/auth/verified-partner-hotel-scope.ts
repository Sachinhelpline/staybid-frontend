// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B — Protected PARTNER↔HOTEL scope store (server-only).
// ═══════════════════════════════════════════════════════════════════════════
// The ONLY trustworthy source of "this partner subject is authorized for this
// exact hotel" for the verified-stay evidence writer. Backed by
// public.verified_partner_hotel_scope (migration
// 2026-09-09-v747-verified-partner-hotel-scope.sql): RLS deny-by-default, NO
// client policy, grants revoked from anon/authenticated. Reads AND writes go
// through the Supabase `service_role` (SUPABASE_SERVICE_ROLE_KEY, BYPASSRLS),
// which only the server holds.
//
// This deliberately REPLACES the client-writable hotels.ownerId /
// hotel_room_units.owner_user_id mappings as the evidence-writer authority: a
// normal customer editing one of those public tables to their own subject can
// NO LONGER cause the server to mint verified_stay_evidence, because the scope
// is read only from this protected table. Those public mappings remain DISPLAY
// / inventory data for the dashboard, never the evidence-writer authority.
//
// FAIL CLOSED everywhere: if the service-role key is unconfigured, or the table
// does not exist yet (migration not applied), reads return [] and writes report
// { ok:false }. With no active binding the caller resolves to an EMPTY hotel
// scope, so the hardened check-in/out routes 403 — the intended safe default
// until an ops/admin path has created ACTIVE bindings for real partners.
import { SB_URL, SB_KEY } from "@/lib/sb-server";

const SCOPE_TABLE = "verified_partner_hotel_scope";

function serviceRoleKey(): string | null {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof k === "string" && k.length > 0 ? k : null;
}

/** True only when the server-only service-role key is configured. */
export function partnerScopeConfigured(): boolean {
  return serviceRoleKey() !== null;
}

// Supabase role elevation: the PUBLIC anon JWT goes in apikey, the effective
// (service-role) key in Authorization (v104.3 contract).
function svcHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = serviceRoleKey() || "";
  return { apikey: SB_KEY, Authorization: `Bearer ${key}`, ...extra };
}

export type PartnerHotelScopeStatus = "active" | "revoked";

export type VerifiedPartnerHotelScopeRow = {
  id: string;
  partner_subject: string;
  hotel_id: string;
  role: string;
  status: string;
  granted_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/** Deterministic id → one binding per (partner subject, hotel). Idempotent. */
export function partnerScopeId(subject: string, hotelId: string): string {
  return `vphs_${subject}_${hotelId}`;
}

/**
 * The hotel ids a set of verified partner subjects are ACTIVELY authorized for.
 * Reads ONLY the protected table (service-role); status must be 'active'
 * (a 'revoked' binding grants nothing). FAILS CLOSED ([]) when the key is
 * unconfigured, the table is missing, or the read errors. The client-writable
 * hotels.ownerId / hotel_room_units.owner_user_id are NEVER consulted here.
 */
export async function readActivePartnerHotelIds(
  subjects: string[]
): Promise<string[]> {
  if (!serviceRoleKey()) return [];
  const subs = (subjects || []).filter(Boolean);
  if (!subs.length) return [];
  const inList = subs.map(encodeURIComponent).join(",");
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/${SCOPE_TABLE}?partner_subject=in.(${inList})` +
        `&status=eq.active&select=hotel_id&limit=500`,
      { headers: svcHeaders(), cache: "no-store" }
    );
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows)) return [];
    const set = new Set<string>();
    rows.forEach((row: any) => {
      if (row?.hotel_id) set.add(String(row.hotel_id));
    });
    return Array.from(set);
  } catch {
    return [];
  }
}

/**
 * The ACTIVE protected binding rows (hotel_id + role) for a verified partner
 * subject. Reads ONLY the protected table (status=active). FAILS CLOSED ([])
 * when the key is unconfigured, the table is missing, or the read errors. Used
 * by partner ADMISSION to decide "is this verified identity a partner, and for
 * which hotels" without ever consulting a client-writable ownership mapping.
 */
export async function readActivePartnerScopeRows(
  subject: string
): Promise<Array<{ hotel_id: string; role: string }>> {
  if (!serviceRoleKey() || !subject) return [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/${SCOPE_TABLE}?partner_subject=eq.${encodeURIComponent(subject)}` +
        `&status=eq.active&select=hotel_id,role&limit=500`,
      { headers: svcHeaders(), cache: "no-store" }
    );
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row: any) => row && row.hotel_id)
      .map((row: any) => ({ hotel_id: String(row.hotel_id), role: String(row.role || "hotel_partner") }));
  } catch {
    return [];
  }
}

/**
 * Is a verified partner subject ACTIVELY authorized for one exact hotel?
 * Protected-table read (service-role); FAILS CLOSED (false) on any config /
 * network / data ambiguity.
 */
export async function isPartnerActiveForHotel(
  subject: string,
  hotelId: string
): Promise<boolean> {
  if (!serviceRoleKey() || !subject || !hotelId) return false;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/${SCOPE_TABLE}` +
        `?partner_subject=eq.${encodeURIComponent(subject)}` +
        `&hotel_id=eq.${encodeURIComponent(hotelId)}` +
        `&status=eq.active&select=id&limit=1`,
      { headers: svcHeaders(), cache: "no-store" }
    );
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export type WritePartnerScopeInput = {
  subject: string;
  hotelId: string;
  role?: string;
  status?: PartnerHotelScopeStatus;
  grantedBy?: string;
};

/**
 * Idempotent upsert of one protected partner↔hotel binding. Service-role only;
 * intended for a future ops/admin management path (NOT reachable by clients —
 * anon/authenticated grants are revoked). FAILS CLOSED ({ ok:false }) when the
 * key is unconfigured or the write errors. Deterministic id → replay-safe.
 */
export async function writePartnerHotelScope(
  input: WritePartnerScopeInput
): Promise<{ ok: boolean; reason?: string }> {
  if (!serviceRoleKey()) return { ok: false, reason: "service_role_unconfigured" };
  if (!input?.subject || !input?.hotelId) return { ok: false, reason: "missing_binding" };
  const id = partnerScopeId(input.subject, input.hotelId);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id,
    partner_subject: input.subject,
    hotel_id: input.hotelId,
    role: input.role || "hotel_partner",
    status: input.status || "active",
    granted_by: input.grantedBy || null,
    updated_at: now,
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${SCOPE_TABLE}?on_conflict=id`, {
      method: "POST",
      headers: svcHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(row),
    });
    if (!r.ok) return { ok: false, reason: `write_failed_${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "write_error" };
  }
}
