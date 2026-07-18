// v348 — Circle Model 2: per-investor city-access helpers (server-only).
//
// An investor unlocks a city once (₹999 lifetime) to trade Model-2 inventory
// there. Access rows live in `circle_city_access` keyed on the investor's
// primary id; reads resolve the caller's cross-pool id set so a twin-id grant
// is never missed. City strings are normalized (lowercase, trimmed) everywhere
// so "Manali " and "manali" match.

import { SB_URL, SB_H } from "@/lib/sb-server";

export function normalizeCity(city: any): string {
  return String(city || "").trim().toLowerCase();
}

// Deterministic access-row id → checkout re-tries upsert the same row.
export function cityAccessId(primaryUserId: string, city: string): string {
  const slug = normalizeCity(city).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "city";
  return `cca_${String(primaryUserId)}_${slug}`;
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

/** The set of normalized cities the investor (any cross-pool id) has ACTIVE. */
export async function resolveActiveCities(ownerIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ownerIds.length) return out;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_city_access?user_id=in.(${idList(ownerIds)})&status=eq.active&select=city`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (Array.isArray(rows)) for (const row of rows) out.add(normalizeCity(row.city));
  } catch { /* fail closed on read error → caller treats as no access */ }
  return out;
}

/** True if the investor has active access to `city`. Empty city → treated as
 *  unrestricted (a listing with no city can't be gated). */
export async function hasCityAccess(ownerIds: string[], city: string): Promise<boolean> {
  const c = normalizeCity(city);
  if (!c) return true;
  const active = await resolveActiveCities(ownerIds);
  return active.has(c);
}
