// ============================================================================
// StayBid for Hosts — Portfolio Configurator: server-side config resolver (v280)
// ----------------------------------------------------------------------------
// Reads the admin-edited `host_wizard_config` row and merges it over the
// bundled DEFAULT_WIZARD_CONFIG (mergeWizardConfig fills every gap + clamps
// every number). Cached per-Lambda for 60s. SERVER-ONLY — uses SB_READ.
//
// Both the public GET (/api/host/portfolio/config) that feeds the client
// wizard AND the /checkout route resolve through THIS, so the amount the
// partner sees and the amount the server charges come from one source.
// ============================================================================

import { SB_URL, SB_READ } from "@/lib/sb";
import { DEFAULT_WIZARD_CONFIG, mergeWizardConfig, type WizardConfig } from "./wizard-rules";

export const WIZARD_CONFIG_ID = "default";

let _cache: { at: number; cfg: WizardConfig } | null = null;
const TTL_MS = 60_000;

export async function resolveWizardConfig(): Promise<WizardConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/host_wizard_config?id=eq.${WIZARD_CONFIG_ID}&select=config`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      const stored = Array.isArray(rows) && rows[0]?.config ? rows[0].config : {};
      const cfg = mergeWizardConfig(stored);
      _cache = { at: Date.now(), cfg };
      return cfg;
    }
  } catch {
    /* fall through to defaults */
  }
  // Table missing / unreachable → bundled defaults keep the wizard working.
  return DEFAULT_WIZARD_CONFIG;
}

// Call after an admin write so the next resolve reflects the change immediately
// (within this Lambda; other warm Lambdas expire on their own 60s TTL).
export function invalidateWizardConfigCache(): void {
  _cache = null;
}
