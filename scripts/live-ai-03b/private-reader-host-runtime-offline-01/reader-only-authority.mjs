// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — VERSIONED READER-ONLY production authority interface (OFFLINE). Node built-ins only.
//
// WHY THIS EXISTS (WORK v2 HOLD resolution): the accepted makePrivateReaderHost() →
// validateProvisionedAuthority() requires BOTH readerDbClient AND executorDbClient. The private-reader
// host must hold ONLY reader authority; the activation executor lives in a different trusted boundary.
// Per the Owner decision, this is a NARROWLY VERSIONED reader-only authority interface that lets the
// private host establish reader authority WITHOUT executorDbClient — reusing the accepted invariants:
//   • verifyConnectionTargetBinding  (accepted) — AI-STAGING identity proof, never CORE-PROD
//   • makeTrustedReadAdapter         (accepted) — fixed SELECT-only observations, reader client only
//   • assertOutwardMessage           (accepted) — the value-validated non-secret outward boundary
//   • assertSuppliedRegistry / CANDIDATE_REGISTRY_DIGEST (accepted) — pinned reviewed query registry
// It edits NO accepted file, adds NO executor authority, and is NOT a general-purpose replacement for
// validateProvisionedAuthority (it is reader-scoped and refuses any executor client).
//
// OBSERVATION DEADLINE SUPPORT (two-issue correction, Finding 2). The accepted adapter calls only
// dbClient.query(sql, params) and exposes NO cancellation interface, so none is invented here. Instead:
//   • the reader client must DECLARE a DB-side per-statement bound (`statementTimeoutMs`, 1..2000 ms)
//     that the deployment's authority constructor enforces on the reader connection (e.g. PostgreSQL
//     `statement_timeout`) — a deferred LIVE requirement; offline it is a validated declaration only;
//   • observe(request, { signal }) runs the adapter inside an abort gate: once the transport deadline
//     aborts the observation, every FURTHER reader query for that observation is refused before it reaches
//     the client, and a result that arrives after abort is discarded. An already-issued statement is NOT
//     cancelled by this gate — it ends only when the DB-side statement bound (or the connection) ends it.
// ─────────────────────────────────────────────────────────────────────────
import { AsyncLocalStorage } from "node:async_hooks";
import { makeTrustedReadAdapter } from "../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { verifyConnectionTargetBinding, CONNECTION_IDENTITY_PROOF_CONTRACT } from "../trusted-executor-runtime-01/db-target-binding.mjs";
import { CANDIDATE_REGISTRY_DIGEST, assertSuppliedRegistry } from "../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { OBSERVATIONS, ERROR_CODES, assertOutwardMessage } from "../private-reader-host-offline-01/private-reader-host.mjs";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

export const READER_ONLY_AUTHORITY_VERSION = "reader-only-authority-v1";
export const READER_ROLE = "live_ai_03b_reader";
export const READER_EXPECTED_SELECT_GRANTS = 12; // last verified effective SELECT grants (baseline)
export const FORBIDDEN_READER_OBJECT = "budget_envelope_allocations";
export const READER_STATEMENT_TIMEOUT_MAX_MS = 2000; // declared DB-side per-statement bound ceiling
const CODE = new Set(ERROR_CODES);

// Fields the reader-only authority MUST carry. Deliberately NO executorDbClient and NO executor
// privilegeProof — the reader host must never receive executor authority.
export const REQUIRED_READER_FIELDS = Object.freeze([
  "cfg", "trustRoot", "readerDbClient", "connectionIdentityProof", "expectedIssuer",
  "connectionToken", "readerPrivilegeProof", "reviewedStateQueries", "sourcePin", "nowProvider",
]);

// The genuine reader-privilege proof contract that a FUTURE live provisioning must satisfy. Structure
// + provenance + freshness + binding are validated here; the actual observed-privilege attestation is a
// deferred live gate produced by an independent read-only privilege source (never a caller assertion).
export const READER_PRIVILEGE_PROOF_CONTRACT = Object.freeze({
  contract: "AiStagingReaderPrivilegeProofV1",
  must_attest: [
    "effective role live_ai_03b_reader on AI-STAGING PG b7362594-… (by service identity, not name)",
    "effective SELECT-only: write-privilege count 0 across the permitted objects",
    "exactly the accepted SELECT grant count; no unapproved role membership or routine authority",
    "no effective access to the forbidden object budget_envelope_allocations",
    "observed from an independently controlled privilege source — NOT a caller assertion / static config / mock flag",
  ],
  trusted_provenance: "trusted-approved-reader-privilege-proof", // real (absent offline)
  test_provenance: "TEST-ONLY-reader-privilege-proof",           // only under an explicit test boundary
  max_age_ms: 300000,
  clock_forward_tolerance_ms: 5000,
});

function fail(reason) { return { ok: false, reason }; }

/**
 * Validate a reader-only production authority (v1). Fails closed on anything missing, executor-bearing,
 * test-tainted (in production), stale, mis-targeted, or not privilege/registry/identity bound. NEVER
 * satisfied by real trust offline (needs trusted connection + privilege proofs that do not exist here).
 * @param opts.testBoundary true ONLY inside an explicit offline test.
 */
export function validateReaderOnlyAuthority(candidate, opts) {
  const a = candidate && typeof candidate === "object" ? candidate : null;
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!a) return fail("authority_absent");

  // READER-ONLY — executor authority must be entirely absent (no field, no client, no proof).
  if (a.executorDbClient !== undefined && a.executorDbClient !== null) return fail("reader_only_rejects_executor_client");
  if (a.privilegeProof !== undefined && a.privilegeProof !== null) return fail("reader_only_rejects_executor_privilege_proof");

  for (const f of REQUIRED_READER_FIELDS) if (a[f] === undefined || a[f] === null) return fail("authority_missing_field:" + f);

  // reader DB client — real, query-capable; a __testFixture is rejected in production.
  if (typeof a.readerDbClient.query !== "function") return fail("reader_client_invalid");
  if (!testBoundary && a.readerDbClient.__testFixture === true) return fail("reader_client_is_test_fixture");
  // declared DB-side per-statement bound (enforced by the deployment on the reader connection; LIVE-deferred).
  const st = a.readerDbClient.statementTimeoutMs;
  if (!Number.isInteger(st) || st < 1 || st > READER_STATEMENT_TIMEOUT_MAX_MS) return fail("reader_client_statement_timeout_invalid");

  // trust root pinned to config (independent of the operator envelope).
  if (typeof a.trustRoot.pinnedPublicKeyDerB64 !== "string" || typeof a.trustRoot.pinnedFingerprint !== "string") return fail("trust_root_invalid");
  if (!a.cfg || a.cfg.ok !== true || !a.cfg.reviewer || a.trustRoot.pinnedFingerprint !== a.cfg.reviewer.pinnedFingerprint) return fail("trust_root_not_config_pinned");

  // target = AI-STAGING, never CORE.
  if (!a.cfg.targets || a.cfg.targets.pgServiceId !== FIXED.ai_staging_postgres) return fail("target_not_ai_staging");
  if (a.cfg.targets.pgServiceId === FIXED.core_excluded_postgres) return fail("target_is_core");

  // connection identity proof (reuses the accepted contract's provenance semantics).
  const p = a.connectionIdentityProof;
  const wantProv = testBoundary ? CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance : CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance;
  if (!p || typeof p !== "object" || p.provenance !== wantProv) return fail("connection_proof_untrusted");
  if (typeof a.expectedIssuer !== "string" || p.issuer !== a.expectedIssuer) return fail("connection_proof_issuer_unbound");
  if (typeof a.connectionToken !== "string" || p.boundConnectionToken !== a.connectionToken) return fail("connection_proof_client_unbound");
  if (p.serviceId === FIXED.core_excluded_postgres || p.projectId === FIXED.core_excluded_project) return fail("connection_proof_is_core");
  if (p.serviceId !== FIXED.ai_staging_postgres || p.projectId !== FIXED.ai_staging_project) return fail("connection_proof_wrong_target");

  // reader-privilege proof — a genuine proof object, not a bare boolean / caller assertion / static config.
  const rp = a.readerPrivilegeProof;
  const wantRp = testBoundary ? READER_PRIVILEGE_PROOF_CONTRACT.test_provenance : READER_PRIVILEGE_PROOF_CONTRACT.trusted_provenance;
  if (!rp || typeof rp !== "object") return fail("reader_privilege_proof_absent");
  if (rp.provenance !== wantRp) return fail("reader_privilege_proof_untrusted");
  if (rp.role !== READER_ROLE) return fail("reader_privilege_proof_wrong_role");
  if (rp.pgServiceId !== FIXED.ai_staging_postgres) return fail("reader_privilege_proof_wrong_target");
  if (rp.effectiveSelectOnly !== true) return fail("reader_privilege_proof_not_select_only");
  if (rp.writePrivilegeCount !== 0) return fail("reader_privilege_proof_has_write");
  if (rp.selectGrantCount !== READER_EXPECTED_SELECT_GRANTS) return fail("reader_privilege_proof_grant_count");
  if (rp.forbiddenObjectAccessible !== false) return fail("reader_privilege_proof_forbidden_object");
  if (rp.unapprovedRoleMembership !== false || rp.unapprovedRoutineAuthority !== false) return fail("reader_privilege_proof_extra_authority");
  if (rp.boundReaderToken !== a.connectionToken) return fail("reader_privilege_proof_client_unbound");

  // freshness (via the injected clock; a stale or future-dated proof fails closed).
  if (typeof a.nowProvider !== "function") return fail("clock_absent");
  const now = a.nowProvider();
  if (typeof rp.issuedAtMs !== "number" || !Number.isFinite(rp.issuedAtMs)) return fail("reader_privilege_proof_no_freshness");
  if (now - rp.issuedAtMs > READER_PRIVILEGE_PROOF_CONTRACT.max_age_ms) return fail("reader_privilege_proof_stale");
  if (rp.issuedAtMs - now > READER_PRIVILEGE_PROOF_CONTRACT.clock_forward_tolerance_ms) return fail("reader_privilege_proof_future_dated");

  // reviewed query registry (content-verified, pinned).
  const reg = assertSuppliedRegistry(a.reviewedStateQueries);
  if (!reg.ok) return fail("query_registry_" + reg.reason);
  if (reg.digest !== CANDIDATE_REGISTRY_DIGEST) return fail("query_registry_not_pinned");

  if (!a.sourcePin || typeof a.sourcePin !== "object") return fail("source_pin_absent");
  return { ok: true, version: READER_ONLY_AUTHORITY_VERSION, registryDigest: CANDIDATE_REGISTRY_DIGEST };
}

// ── reader-only host (composes the accepted read adapter + accepted outward boundary) ──
function successMsg(phase, observation, mode) {
  return { kind: "live-ai-03b-observation", phase, ok: true, registryDigest: CANDIDATE_REGISTRY_DIGEST, pgService: FIXED.ai_staging_postgres, mode, observation };
}
function failMsg(code, phase, mode) {
  const m = { kind: "live-ai-03b-observation", ok: false, code: CODE.has(code) ? code : "result_boundary_violation" };
  if (phase !== undefined) m.phase = phase;
  if (mode !== undefined) m.mode = mode;
  return m;
}

/**
 * Build a reader-only host: validate the reader-only authority → derive the AI-STAGING target binding →
 * build the accepted trusted read adapter with the READER client only → expose observe/toGatewayMessage
 * guarded by the accepted assertOutwardMessage boundary. The reader client is held in closure and never
 * returned; no executor authority is present anywhere.
 */
export function makeReaderOnlyHost(authority, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!validateReaderOnlyAuthority(authority, { testBoundary }).ok) return { available: false, code: "authority_invalid" };
  const tb = verifyConnectionTargetBinding({
    expectedServiceId: FIXED.ai_staging_postgres,
    expectedIssuer: authority.expectedIssuer,
    connectionToken: authority.connectionToken,
    connectionIdentityProof: authority.connectionIdentityProof,
    testBoundary,
  });
  if (!tb.ok) return { available: false, code: "target_binding_invalid" };
  if (tb.verifiedServiceId === FIXED.core_excluded_postgres) return { available: false, code: "target_is_core_prod" };
  const mode = testBoundary ? "test" : "production";
  // abort-gated view of the reader client: the adapter captures it once; each query consults the CURRENT
  // observation's context (AsyncLocalStorage) and is refused once that observation has been aborted.
  const raw = authority.readerDbClient;
  const obsCtx = new AsyncLocalStorage();
  const gated = {
    async query(sql, params) {
      const ctx = obsCtx.getStore();
      if (!ctx || ctx.signal.aborted) throw new Error("observation_aborted");      // no query issued
      const r = await raw.query(sql, params);
      if (ctx.signal.aborted) throw new Error("observation_aborted");             // late result discarded
      return r;
    },
    statementTimeoutMs: raw.statementTimeoutMs,
  };
  if (raw.__testFixture === true) gated.__testFixture = true; // preserve the accepted production refusal
  let adapter;
  try {
    adapter = makeTrustedReadAdapter({ dbClient: gated, targetBinding: tb, reviewedStateQueries: authority.reviewedStateQueries, mode });
  } catch { return { available: false, code: "adapter_init_failed" }; }

  const emit = (msg) => (assertOutwardMessage(msg).ok ? msg : failMsg("result_boundary_violation", (msg && OBSERVATIONS.includes(msg.phase)) ? msg.phase : undefined, mode));

  const NEVER_ABORTED = Object.freeze({ aborted: false });
  async function observe(request, control) {
    const req = request && typeof request === "object" ? request : {};
    for (const k of Object.keys(req)) if (k !== "observation") return emit(failMsg("request_rejected", undefined, mode));
    const obs = req.observation;
    if (!OBSERVATIONS.includes(obs)) return emit(failMsg("unknown_observation", undefined, mode));
    const signal = control && control.signal && typeof control.signal.aborted === "boolean" ? control.signal : NEVER_ABORTED;
    if (signal.aborted) return emit(failMsg("observation_unavailable", obs, mode));
    let res;
    try {
      res = await obsCtx.run({ signal }, () => (obs === "dormant" ? adapter.observeDormant() : obs === "armed" ? adapter.observeArmed() : adapter.observeCeilings()));
    } catch { return emit(failMsg("observation_error", obs, mode)); }
    if (signal.aborted) return emit(failMsg("observation_unavailable", obs, mode));
    if (!res || res.ok !== true) return emit(failMsg("observation_unavailable", obs, mode));
    const observation = obs === "dormant" ? { dormantState: res.dormantState, counts: res.counts } : obs === "armed" ? { armedState: res.armedState } : { oneCallPolicy: res.oneCallPolicy };
    return emit(successMsg(obs, observation, mode));
  }
  function toGatewayMessage(message) {
    return assertOutwardMessage(message).ok ? { ok: true, message } : { ok: false, code: "gateway_delivery_refused" };
  }
  return Object.freeze({ available: true, id: "live-ai-03b-reader-only-host", version: READER_ONLY_AUTHORITY_VERSION, mode, observe, toGatewayMessage });
}

// Production acquire — UNPROVISIONED offline (no injector). A future deployment replaces this module
// with one that constructs a reader-only authority passing validateReaderOnlyAuthority() from its
// credential-isolated store. NEVER returns a synthetic/mock authority.
export const READER_UNPROVISIONED = Object.freeze({ available: false, code: "unprovisioned" });
export async function acquireReaderOnlyProductionAuthority() { return READER_UNPROVISIONED; }
