// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (REMEDIATION, Correction C) —
// immutable, digest-bound production QUERY REGISTRY. OFFLINE.
//
// WORK finding corrected: the production read path previously accepted arbitrary
// non-empty SQL strings from the caller as "reviewed queries", so a caller could
// substitute a constant-returning fabrication (e.g. SELECT TRUE) for a real state
// query. Production now uses ONLY this immutable registry — never caller SQL.
//
// The known-schema queries (committed ledger + catalog) are recovered from the
// accepted SQL artifact and frozen here with a digest. The exact policy / control /
// seven-ceiling / zero-exposure query columns are NOT present in the accepted 19
// artifacts, so they are NOT invented — the registry is deliberately INCOMPLETE for
// production and the genuine production entrypoint stays BLOCKED until those exact
// identities are independently established, schema-confirmed and approved (future
// live gate). The offline TEST path uses its own separate fixtures, never this gate.
// ─────────────────────────────────────────────────────────────────────────

import { sha256hex, canonicalize } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import {
  LEDGER_COMMITTED_QUERY, CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY,
  CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY, REVIEWED_STATE_QUERY_NAMES,
} from "./trusted-read-adapter.mjs";

// digest-bound, immutable known-schema queries (columns from the accepted SQL artifact).
export const KNOWN_QUERIES = Object.freeze({
  ledgerCommitted: LEDGER_COMMITTED_QUERY,
  catalogActiveCount: CATALOG_ACTIVE_COUNT_QUERY,
  catalogActiveDigest: CATALOG_ACTIVE_DIGEST_QUERY,
  catalogInactiveVersion: CATALOG_INACTIVE_VERSION_QUERY,
  catalogInactiveEntryCount: CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
});
export const KNOWN_QUERIES_DIGEST = sha256hex(canonicalize(KNOWN_QUERIES));

// the reviewed-state queries that require applied-schema confirmation before production use.
export const UNRESOLVED_SCHEMA_QUERY_NAMES = Object.freeze([...REVIEWED_STATE_QUERY_NAMES]); // dormant/armed policy+control, ceilings, zeroExposureCounts

/**
 * The production query registry. In this repository state it is INCOMPLETE: the exact
 * policy/control/ceiling/zero-exposure query identities are unconfirmed, so production must
 * stay BLOCKED. A registry carries the digest so a consumer can bind to a specific reviewed set;
 * a caller cannot substitute arbitrary SQL for it.
 */
export function getProductionQueryRegistry() {
  return {
    complete: false,
    reason: "policy_control_ceiling_schema_binding_unconfirmed",
    digest: KNOWN_QUERIES_DIGEST,
    known: KNOWN_QUERIES,
    unresolved: UNRESOLVED_SCHEMA_QUERY_NAMES,
  };
}
