// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Authority V3 deployable START COMMAND (standby). OFFLINE.
// Future start command (FUTURE boundary 4, separately authorized):
//   node scripts/live-ai-03b/m7-post-step67-pi01-live-readiness-remediation-01/src/authority-v3-standby-entrypoint.mjs
//
// Successor of the accepted Step6/7 standby (same keep-alive contract: ONE stable private network identity for the
// attesters' peer bindings; no listener; no DB connection; no attester request; no activation). It ADDITIONALLY
// proves — statically, with zero I/O — that the accepted PI01 V3 boundary COMPOSES under the deployed configuration
// (frozen R3 V3 config + runtime preservation binding + V2-only executor trust root + reader V2 provider), and
// reports it in one bounded, non-secret line:
//   PI01_V3_AUTHORITY_STANDBY {"composed":true|false,"reason":…,"successorRuntimePinRef":…,"catalogWindow":…,
//     "dbConnections":0,"attesterRequests":0,"listener":false,"activationInvoked":false,…}
// It NEVER calls boundary.run(). It does NOT import the one-shot activation runner. A composition failure is a
// fail-closed standby (composed=false + bounded reason), never a fallback. `catalogWindow` is an ADVISORY host-clock
// view of the frozen R3 catalog verification expiry; the authoritative check is the DB-clock-bound check inside
// the accepted PI01 run() — at/after 2026-10-13T22:44:42Z the V3 path HOLDs (no T0 regeneration, ever).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXED_V3 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs";
import { composeAuthorityV3 } from "./authority-v3-composition.mjs";
import { REQUIRED_AUTHORITY_V3_NAMES } from "./authority-v3-config.mjs";

export const AUTHORITY_V3_STANDBY_VERSION = "pi01-authority-v3-standby-lrr01";
export const CATALOG_VERIFICATION_EXPIRY = FIXED_V3.catalog_verification_expiry;   // "2026-10-13T22:44:42Z"

export function catalogWindow(nowMs = Date.now()) {
  const exp = Date.parse(CATALOG_VERIFICATION_EXPIRY), t0 = Date.parse(FIXED_V3.catalog_t0);
  if (!Number.isFinite(nowMs) || !Number.isFinite(exp) || !Number.isFinite(t0)) return "unknown_hold";
  if (nowMs < t0) return "before_t0_hold";
  return nowMs >= exp ? "expired_hold" : "open_advisory";
}

/** Pure status computation (no I/O). Exported for tests; the boundary object never leaves this function. */
export function standbyStatusV3(env, { nowMs = Date.now() } = {}) {
  const present = (n) => typeof env?.[n] === "string" && env[n].trim() !== "";
  const missingNameCount = REQUIRED_AUTHORITY_V3_NAMES.filter((n) => !present(n)).length;
  const c = composeAuthorityV3({ env });
  const window = catalogWindow(nowMs);
  return Object.freeze({
    standby: AUTHORITY_V3_STANDBY_VERSION,
    composed: c.available === true,
    reason: c.available === true ? null : c.reason,
    successorRuntimePinRef: c.available === true ? c.successorRuntimePinRef : null,
    executorAttestationContract: "AiStagingExecutorAttestationV2", v1Fallback: false,
    requiredNamesPresent: missingNameCount === 0, missingNameCount,
    catalogVerificationExpiry: CATALOG_VERIFICATION_EXPIRY, catalogWindow: window,
    activationReadyAdvisory: c.available === true && window === "open_advisory",
    dbConnections: 0, attesterRequests: 0, listener: false, activationInvoked: false,
  });
}

function main() {
  let line;
  try { line = "PI01_V3_AUTHORITY_STANDBY " + JSON.stringify(standbyStatusV3(process.env)); }
  catch { line = "PI01_V3_AUTHORITY_STANDBY " + JSON.stringify({ standby: AUTHORITY_V3_STANDBY_VERSION, composed: false, reason: "status_computation_failed", dbConnections: 0, attesterRequests: 0, listener: false, activationInvoked: false }); }
  process.stdout.write(line + "\n");
  const keep = setInterval(() => {}, 60 * 60 * 1000);   // idle keep-alive; no I/O
  const stop = () => { clearInterval(keep); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) main();
