// ============================================================================
// StayCircle honest revenue model — server-side config resolver (v294.13)
// ----------------------------------------------------------------------------
// Reads the admin-edited `circle_revenue_config` singleton and merges it over
// the bundled DEFAULT_CIRCLE_REVENUE (mergeRevenueConfig fills every gap +
// clamps every number). Cached per-Lambda for 60s. SERVER-ONLY — uses SB_READ.
//
// The public GET (/api/circle/revenue-config) that feeds the client wizard
// panel resolves through THIS. Same pattern as lib/host/wizard-config-store.
// DISPLAY-ONLY — does NOT touch the /circle/checkout charge.
// ============================================================================

import { SB_URL, SB_READ } from "@/lib/sb";
import {
  DEFAULT_CIRCLE_REVENUE,
  mergeRevenueConfig,
  type CircleRevenueConfig,
} from "./engine";

export const CIRCLE_REVENUE_CONFIG_ID = "default";

let _cache: { at: number; cfg: CircleRevenueConfig } | null = null;
const TTL_MS = 60_000;

export async function resolveRevenueConfig(): Promise<CircleRevenueConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_revenue_config?id=eq.${CIRCLE_REVENUE_CONFIG_ID}&select=config`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      const stored = Array.isArray(rows) && rows[0]?.config ? rows[0].config : {};
      const cfg = mergeRevenueConfig(stored);
      _cache = { at: Date.now(), cfg };
      return cfg;
    }
  } catch {
    /* fall through to defaults */
  }
  // Table missing / unreachable → bundled defaults keep the panel working.
  return DEFAULT_CIRCLE_REVENUE;
}

// Call after an admin write so the next resolve reflects the change immediately
// (within this Lambda; other warm Lambdas expire on their own 60s TTL).
export function invalidateRevenueConfigCache(): void {
  _cache = null;
}
