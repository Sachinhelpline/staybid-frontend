// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 READER-ONLY authority + reader-only host. OFFLINE, Node built-ins only.
//
// Successor of private-reader-host-runtime-offline-01/reader-only-authority.mjs (V1, frozen: V1 registry
// + V1 read adapter + V1 outward guard). Preserves every accepted reader-only invariant — NO executor
// client or executor proof; a genuine (trusted-provenance) connection-identity proof bound to issuer +
// connection token; a genuine reader-privilege proof (role live_ai_03b_reader, SELECT-only, 12 grants,
// no budget_envelope_allocations, fresh ≤ 5 min, bound to the reader token); a declared DB-side
// statement bound ≤ 2000 ms; an AsyncLocalStorage abort gate per observation — and swaps in the V2
// registry (content-verified), the V2 read adapter, the V2 source pin and the V2 outward boundary.
// ─────────────────────────────────────────────────────────────────────────
import { AsyncLocalStorage } from "node:async_hooks";
import { verifyConnectionTargetBinding, CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { READER_ROLE, READER_EXPECTED_SELECT_GRANTS, READER_STATEMENT_TIMEOUT_MAX_MS, READER_PRIVILEGE_PROOF_CONTRACT } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { TARGETS_V2 } from "../identity/v2-identity.mjs";
import { checkSourcePinV2 } from "../identity/v2-source-identity.mjs";
import { assertSuppliedRegistryV2, V2_REGISTRY_DIGEST } from "../runtime/v2-query-registry.mjs";
import { makeTrustedReadAdapterV2 } from "../runtime/v2-trusted-read-adapter.mjs";
import { OBSERVATIONS_V2, assertOutwardMessageV2, failMsgV2, successMsgV2, emitV2, observationFromAdapterResult, adapterCallFor } from "./v2-observation-contract.mjs";

export { READER_ROLE, READER_EXPECTED_SELECT_GRANTS, READER_STATEMENT_TIMEOUT_MAX_MS, READER_PRIVILEGE_PROOF_CONTRACT };
export const READER_ONLY_AUTHORITY_VERSION_V2 = "reader-only-authority-v2";
export const REQUIRED_READER_FIELDS_V2 = Object.freeze(["cfg", "trustRoot", "readerDbClient", "connectionIdentityProof", "expectedIssuer",
  "connectionToken", "readerPrivilegeProof", "registry", "sourcePin", "nowProvider"]);
const fail = (reason) => ({ ok: false, reason });

export function validateReaderOnlyAuthorityV2(candidate, opts) {
  const a = candidate && typeof candidate === "object" ? candidate : null;
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!a) return fail("authority_absent");
  if (a.executorDbClient !== undefined && a.executorDbClient !== null) return fail("reader_only_rejects_executor_client");
  if (a.privilegeProof !== undefined && a.privilegeProof !== null) return fail("reader_only_rejects_executor_privilege_proof");
  if (a.reviewedStateQueries !== undefined) return fail("reader_only_v2_rejects_v1_query_map");
  for (const f of REQUIRED_READER_FIELDS_V2) if (a[f] === undefined || a[f] === null) return fail("authority_missing_field:" + f);
  if (typeof a.readerDbClient.query !== "function") return fail("reader_client_invalid");
  if (!testBoundary && a.readerDbClient.__testFixture === true) return fail("reader_client_is_test_fixture");
  const st = a.readerDbClient.statementTimeoutMs;
  if (!Number.isInteger(st) || st < 1 || st > READER_STATEMENT_TIMEOUT_MAX_MS) return fail("reader_client_statement_timeout_invalid");
  if (typeof a.trustRoot.pinnedPublicKeyDerB64 !== "string" || typeof a.trustRoot.pinnedFingerprint !== "string") return fail("trust_root_invalid");
  if (!a.cfg || a.cfg.ok !== true || !a.cfg.reviewer || a.trustRoot.pinnedFingerprint !== a.cfg.reviewer.pinnedFingerprint) return fail("trust_root_not_config_pinned");
  if (!a.cfg.targets || a.cfg.targets.pgServiceId !== TARGETS_V2.postgres) return fail("target_not_ai_staging");
  const p = a.connectionIdentityProof;
  const wantProv = testBoundary ? CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance : CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance;
  if (!p || typeof p !== "object" || p.provenance !== wantProv) return fail("connection_proof_untrusted");
  if (typeof a.expectedIssuer !== "string" || p.issuer !== a.expectedIssuer) return fail("connection_proof_issuer_unbound");
  if (typeof a.connectionToken !== "string" || p.boundConnectionToken !== a.connectionToken) return fail("connection_proof_client_unbound");
  if (p.serviceId === TARGETS_V2.core_excluded_postgres || p.projectId === TARGETS_V2.core_excluded_project) return fail("connection_proof_is_core");
  if (p.serviceId !== TARGETS_V2.postgres || p.projectId !== TARGETS_V2.project) return fail("connection_proof_wrong_target");
  const rp = a.readerPrivilegeProof;
  const wantRp = testBoundary ? READER_PRIVILEGE_PROOF_CONTRACT.test_provenance : READER_PRIVILEGE_PROOF_CONTRACT.trusted_provenance;
  if (!rp || typeof rp !== "object") return fail("reader_privilege_proof_absent");
  if (rp.provenance !== wantRp) return fail("reader_privilege_proof_untrusted");
  if (rp.role !== READER_ROLE) return fail("reader_privilege_proof_wrong_role");
  if (rp.pgServiceId !== TARGETS_V2.postgres) return fail("reader_privilege_proof_wrong_target");
  if (rp.effectiveSelectOnly !== true) return fail("reader_privilege_proof_not_select_only");
  if (rp.writePrivilegeCount !== 0) return fail("reader_privilege_proof_has_write");
  if (rp.selectGrantCount !== READER_EXPECTED_SELECT_GRANTS) return fail("reader_privilege_proof_grant_count");
  if (rp.forbiddenObjectAccessible !== false) return fail("reader_privilege_proof_forbidden_object");
  if (rp.unapprovedRoleMembership !== false || rp.unapprovedRoutineAuthority !== false) return fail("reader_privilege_proof_extra_authority");
  if (rp.boundReaderToken !== a.connectionToken) return fail("reader_privilege_proof_client_unbound");
  if (typeof a.nowProvider !== "function") return fail("clock_absent");
  const now = a.nowProvider();
  if (typeof rp.issuedAtMs !== "number" || !Number.isFinite(rp.issuedAtMs)) return fail("reader_privilege_proof_no_freshness");
  if (now - rp.issuedAtMs > READER_PRIVILEGE_PROOF_CONTRACT.max_age_ms) return fail("reader_privilege_proof_stale");
  if (rp.issuedAtMs - now > READER_PRIVILEGE_PROOF_CONTRACT.clock_forward_tolerance_ms) return fail("reader_privilege_proof_future_dated");
  const reg = assertSuppliedRegistryV2(a.registry);
  if (!reg.ok) return fail("query_registry_" + reg.reason);
  const sp = checkSourcePinV2(a.sourcePin, { testBoundary });
  if (!sp.ok) return fail("source_pin_" + sp.reason);
  return { ok: true, version: READER_ONLY_AUTHORITY_VERSION_V2, registryDigest: V2_REGISTRY_DIGEST };
}

export function makeReaderOnlyHostV2(authority, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!validateReaderOnlyAuthorityV2(authority, { testBoundary }).ok) return { available: false, code: "authority_invalid" };
  const tb = verifyConnectionTargetBinding({ expectedServiceId: TARGETS_V2.postgres, expectedIssuer: authority.expectedIssuer,
    connectionToken: authority.connectionToken, connectionIdentityProof: authority.connectionIdentityProof, testBoundary });
  if (!tb.ok) return { available: false, code: "target_binding_invalid" };
  if (tb.verifiedServiceId === TARGETS_V2.core_excluded_postgres) return { available: false, code: "target_is_core_prod" };
  const mode = testBoundary ? "test" : "production";
  const raw = authority.readerDbClient;
  const obsCtx = new AsyncLocalStorage();
  const gated = {
    async query(sql, params) {
      const ctx = obsCtx.getStore();
      if (!ctx || ctx.signal.aborted) throw new Error("observation_aborted");
      const r = await raw.query(sql, params);
      if (ctx.signal.aborted) throw new Error("observation_aborted");
      return r;
    },
    statementTimeoutMs: raw.statementTimeoutMs,
  };
  if (raw.__testFixture === true) gated.__testFixture = true;
  let adapter;
  try { adapter = makeTrustedReadAdapterV2({ dbClient: gated, targetBinding: tb, registry: authority.registry, mode }); }
  catch { return { available: false, code: "adapter_init_failed" }; }
  const NEVER_ABORTED = Object.freeze({ aborted: false });
  async function observe(request, control) {
    const req = request && typeof request === "object" && !Array.isArray(request) ? request : {};
    for (const k of Object.keys(req)) if (k !== "observation") return emitV2(failMsgV2("request_rejected", undefined, mode), mode);
    const phase = req.observation;
    if (!OBSERVATIONS_V2.includes(phase)) return emitV2(failMsgV2("unknown_observation", undefined, mode), mode);
    const signal = control && control.signal && typeof control.signal.aborted === "boolean" ? control.signal : NEVER_ABORTED;
    if (signal.aborted) return emitV2(failMsgV2("observation_unavailable", phase, mode), mode);
    let res;
    try { res = await obsCtx.run({ signal }, () => adapterCallFor(adapter, phase)); } catch { return emitV2(failMsgV2("observation_error", phase, mode), mode); }
    if (signal.aborted || !res || res.ok !== true) return emitV2(failMsgV2("observation_unavailable", phase, mode), mode);
    return emitV2(successMsgV2(phase, observationFromAdapterResult(phase, res), mode), mode);
  }
  function toGatewayMessage(message) { return assertOutwardMessageV2(message).ok ? { ok: true, message } : { ok: false, code: "gateway_delivery_refused" }; }
  return Object.freeze({ available: true, id: "live-ai-03b-reader-only-host-v2", version: READER_ONLY_AUTHORITY_VERSION_V2, mode, observe, toGatewayMessage });
}

export const READER_UNPROVISIONED_V2 = Object.freeze({ available: false, code: "unprovisioned" });
export async function acquireReaderOnlyProductionAuthorityV2() { return READER_UNPROVISIONED_V2; }
