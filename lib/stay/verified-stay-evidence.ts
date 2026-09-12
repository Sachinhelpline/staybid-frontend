// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B — Protected verified-stay evidence store (server-only).
// ═══════════════════════════════════════════════════════════════════════════
// The ONLY trustworthy source of "this customer really stayed at this hotel".
// Backed by public.verified_stay_evidence (migration
// 2026-09-09-v746-verified-stay-evidence.sql): RLS deny-by-default, NO client
// policy, so anon/authenticated can neither read nor write it. Reads AND writes
// go through the Supabase `service_role` (SUPABASE_SERVICE_ROLE_KEY, BYPASSRLS),
// which only the server holds.
//
// FAIL CLOSED everywhere: if the service-role key is unconfigured, or the table
// does not exist yet (migration not applied), reads return [] and writes report
// { ok:false }. Verified-Guest bid/stay proof is therefore empty (unavailable)
// until (1) the migration is applied AND (2) the service-role key is set AND
// (3) a hardened partner check-in has recorded evidence — the intended safe
// default. NEVER trust the mutable public bids/bookings/checkin_checkout_logs
// rows as authority.
import { SB_URL, SB_KEY } from "@/lib/sb-server";

const EVIDENCE_TABLE = "verified_stay_evidence";
export const EVIDENCE_WINDOW_DAYS = 90;

function serviceRoleKey(): string | null {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof k === "string" && k.length > 0 ? k : null;
}

/** True only when the server-only service-role key is configured. */
export function evidenceConfigured(): boolean {
  return serviceRoleKey() !== null;
}

// Supabase role elevation: the PUBLIC anon JWT goes in apikey, the effective
// (service-role) key in Authorization (v104.3 contract).
function svcHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = serviceRoleKey() || "";
  return { apikey: SB_KEY, Authorization: `Bearer ${key}`, ...extra };
}

export type EvidenceProofState = "checked_in" | "checked_out";
export type EvidenceSourceType = "bid" | "booking";
export type EvidenceVerifierType = "partner" | "admin";

export type VerifiedStayEvidenceRow = {
  id: string;
  customer_id: string;
  hotel_id: string;
  source_type: string;
  source_id: string;
  proof_state: string;
  check_in_at: string | null;
  check_out_at: string | null;
  verified_at: string;
  verifier_type: string;
  verifier_id: string;
};

/** Deterministic id → one evidence row per underlying reservation (idempotent). */
export function evidenceId(sourceType: EvidenceSourceType, sourceId: string): string {
  return `vse_${sourceType}_${sourceId}`;
}

/**
 * Read the protected evidence rows for a set of customer identities, verified
 * within the last 90 days. Service-role only; FAILS CLOSED ([]) when the key is
 * unconfigured, the table is missing, or the read errors.
 */
export async function readVerifiedStayEvidenceForCustomers(
  customerIds: string[],
  nowMs: number = Date.now()
): Promise<VerifiedStayEvidenceRow[]> {
  if (!serviceRoleKey()) return [];
  const ids = (customerIds || []).filter(Boolean);
  if (!ids.length) return [];
  const since = new Date(nowMs - EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();
  const inList = ids.map(encodeURIComponent).join(",");
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/${EVIDENCE_TABLE}?customer_id=in.(${inList})` +
        `&verified_at=gte.${encodeURIComponent(since)}` +
        `&select=*&order=verified_at.desc&limit=200`,
      { headers: svcHeaders(), cache: "no-store" }
    );
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) ? (rows as VerifiedStayEvidenceRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Tri-state result of a single-source protected evidence read. The check-in /
 * check-out gates MUST distinguish "there is no protected row" (`not_found`)
 * from "I could not prove whether one exists" (`error`) — conflating the two
 * would let a transient read failure be read as "no evidence", after which the
 * merge-duplicates upsert could silently overwrite a real protected row. A
 * `not_found` may proceed to a legitimate NEW mint; an `error` MUST fail closed.
 */
export type EvidenceReadResult =
  | { status: "found"; row: VerifiedStayEvidenceRow }
  | { status: "not_found" }
  | { status: "error"; reason: string };

/**
 * Read the single protected evidence row for ONE underlying reservation
 * (deterministic id `vse_<sourceType>_<sourceId>`) as a TRI-STATE result.
 * Service-role only; FAILS CLOSED (`error`) when the key is unconfigured, the
 * source id is empty, the HTTP read is non-OK, the body is not a JSON array, or
 * the fetch throws. Returns `not_found` ONLY on a successful read that returned
 * zero rows, and `found` on exactly one row. Read-only; does NOT change the
 * meaning of verified_stay_evidence. Used by the hardened check-in / check-out
 * routes to enforce replay idempotency, to refuse ever minting over a
 * mismatched/malformed pre-existing row, and to fail closed on a read failure.
 */
export async function readVerifiedStayEvidenceForSource(
  sourceType: EvidenceSourceType,
  sourceId: string
): Promise<EvidenceReadResult> {
  if (!serviceRoleKey()) return { status: "error", reason: "service_role_unconfigured" };
  if (!sourceId) return { status: "error", reason: "missing_source_id" };
  const id = evidenceId(sourceType, sourceId);
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/${EVIDENCE_TABLE}?id=eq.${encodeURIComponent(id)}` +
        `&select=*&limit=1`,
      { headers: svcHeaders(), cache: "no-store" }
    );
    if (!r.ok) return { status: "error", reason: `read_failed_${r.status}` };
    const rows = await r.json().catch(() => null);
    if (!Array.isArray(rows)) return { status: "error", reason: "read_parse_error" };
    if (!rows[0]) return { status: "not_found" };
    return { status: "found", row: rows[0] as VerifiedStayEvidenceRow };
  } catch (e: any) {
    return { status: "error", reason: e?.message || "read_error" };
  }
}

/**
 * Pure check: does a protected evidence row's IMMUTABLE binding EXACTLY match the
 * expected reservation identity — deterministic id + source_type + source_id +
 * customer_id + hotel_id? `proof_state` is validated separately per transition.
 * A row that fails this check is malformed / bound to a different reservation and
 * MUST NEVER be overwritten or treated as this reservation's evidence.
 */
export function evidenceBindingMatches(
  row: VerifiedStayEvidenceRow | null | undefined,
  expected: { sourceType: EvidenceSourceType; sourceId: string; customerId: string; hotelId: string }
): boolean {
  if (!row) return false;
  return (
    String(row.id) === evidenceId(expected.sourceType, expected.sourceId) &&
    String(row.source_type) === expected.sourceType &&
    String(row.source_id) === expected.sourceId &&
    String(row.customer_id) === expected.customerId &&
    String(row.hotel_id) === expected.hotelId
  );
}

export type WriteEvidenceInput = {
  customerId: string;
  hotelId: string;
  sourceType: EvidenceSourceType;
  sourceId: string;
  proofState: EvidenceProofState;
  verifierType: EvidenceVerifierType;
  verifierId: string;
  /** The real check-in / check-out instant (defaults to now). */
  at?: string;
};

/**
 * Write (idempotent upsert) one protected evidence row. Service-role only;
 * FAILS CLOSED ({ ok:false }) when the key is unconfigured or the write errors.
 * check-in and check-out both target the same deterministic id, so re-marking is
 * idempotent and check-out merges onto the existing check-in row.
 */
export async function writeVerifiedStayEvidence(
  input: WriteEvidenceInput
): Promise<{ ok: boolean; reason?: string }> {
  if (!serviceRoleKey()) return { ok: false, reason: "service_role_unconfigured" };
  if (!input?.customerId || !input?.hotelId || !input?.sourceId) {
    return { ok: false, reason: "missing_binding" };
  }
  const id = evidenceId(input.sourceType, input.sourceId);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id,
    customer_id: input.customerId,
    hotel_id: input.hotelId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    proof_state: input.proofState,
    verified_at: now,
    verifier_type: input.verifierType,
    verifier_id: input.verifierId,
  };
  // Only set the timestamp for the transition being recorded, so a later
  // check-out never blanks the recorded check-in.
  if (input.proofState === "checked_in") row.check_in_at = input.at || now;
  if (input.proofState === "checked_out") row.check_out_at = input.at || now;

  try {
    const r = await fetch(`${SB_URL}/rest/v1/${EVIDENCE_TABLE}?on_conflict=id`, {
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
