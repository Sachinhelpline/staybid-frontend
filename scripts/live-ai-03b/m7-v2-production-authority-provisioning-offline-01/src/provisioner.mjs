// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — the provisioner. OFFLINE candidate.
//
// createAuthorityProvisionerV2(deps, opts) returns { provisioner, close }:
//   provisioner — FROZEN, exactly { contract: "LiveAi03bProductionAuthorityProvisionerV2", acquire } (the preserved
//                 PROVISIONER_CONTRACT_V2), ready for the preserved composeTrustedExecutorProductionV2(provisioner);
//   close       — releases the two physical connections (the trusted entrypoint calls it after the one run).
//
// deps are TRUSTED COMPOSITION dependencies only (exact key set; never an activation request):
//   { provisioningConfig, reviewerTrustRoot, activationSourceProof, clock,
//     executorPhysicalFactory, readerPhysicalFactory, executorAttestationSource, readerAttestationSource }
// Everything is validated statically BEFORE any I/O. acquire() takes NO arguments, runs at most ONCE and:
//   1. opens the executor connection and establishes the executor session (role, timeout, token, DB clock);
//   2. binds the trusted clock to the DB clock observed on that executor connection;
//   3. opens the reader connection and establishes the accepted reader session (role, ≤2000 ms, read-only, token);
//   4. requests TWO independent attestations (executor contract / reader contract), each with its own fresh nonce;
//   5. binds EACH connection independently (role-binding.mjs) and requires the two bindings to be pairwise distinct;
//   6. seals the two role-scoped clients (guarded-clients.mjs);
//   7. assembles the EXACT frozen authority field set (the single proof slot = the EXECUTOR proof; the frozen
//      privilegeProof marker is set ONLY after the strong executor privilege attestation passed) and validates it
//      with the preserved validateProvisionedAuthorityV2 (production, or test under the explicit test boundary).
// Any failure closes both connections and returns { available:false, reason } (fixed codes; no secret, no DSN).
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { PROVISIONER_CONTRACT_V2, validateProvisionedAuthorityV2, REQUIRED_AUTHORITY_FIELDS_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-production-authority.mjs";
import { buildV2RegistrySupply, assertSuppliedRegistryV2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-query-registry.mjs";
import { checkActivationSourceProofV2 } from "../../m7-step2-runtime-rebinding-offline-01/identity/v2-source-identity.mjs";
import { establishReaderSession } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { READER_ROLE } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { establishExecutorSession, EXECUTOR_ROLE } from "./executor-session.mjs";
import { bindExecutorConnection, bindReaderConnection, checkDistinctBindings, READER_ATTESTATION_CONTRACT, EXECUTOR_ATTESTATION_CONTRACT } from "./role-binding.mjs";
import { makeGuardedExecutorClient, makeGuardedReaderClient } from "./guarded-clients.mjs";
import { validateClock } from "./trusted-clock.mjs";

export const PROVISIONER_DEPS_KEYS = Object.freeze(["activationSourceProof", "clock", "executorAttestationSource", "executorPhysicalFactory",
  "provisioningConfig", "readerAttestationSource", "readerPhysicalFactory", "reviewerTrustRoot"]);
const fail = (reason) => Object.freeze({ available: false, reason });
const REASON_SAFE = /[^A-Za-z0-9_.:-]/g;
const nonce = () => randomBytes(16).toString("hex");

/** Static (no I/O) validation of the trusted composition dependencies. */
export function validateProvisionerDeps(deps, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!deps || typeof deps !== "object" || Array.isArray(deps)) return { ok: false, reason: "provisioner_deps_absent" };
  if (Object.keys(deps).sort().join(",") !== PROVISIONER_DEPS_KEYS.join(",")) return { ok: false, reason: "provisioner_deps_shape_not_exact" };
  const pc = deps.provisioningConfig;
  if (!pc || pc.ok !== true || !pc.cfg || pc.cfg.ok !== true || !pc.executorAttester || !pc.readerAttester) return { ok: false, reason: "provisioning_config_invalid" };
  for (const tr of [pc.executorAttester.trustRoot, pc.readerAttester.trustRoot]) {
    if (!tr || typeof tr.publicKeyDerB64 !== "string") return { ok: false, reason: "attester_trust_root_absent" };
    if (!testBoundary && tr.test === true) return { ok: false, reason: "attester_trust_root_is_test_only" };
  }
  const rt = deps.reviewerTrustRoot;
  if (!rt || typeof rt.pinnedPublicKeyDerB64 !== "string" || rt.pinnedFingerprint !== pc.cfg.reviewer.pinnedFingerprint || rt.pinnedPublicKeyDerB64 !== pc.cfg.reviewer.pinnedPublicKeyDerB64) return { ok: false, reason: "reviewer_trust_root_not_config_pinned" };
  const sp = checkActivationSourceProofV2(deps.activationSourceProof, { testBoundary });
  if (!sp.ok) return { ok: false, reason: "activation_source_proof_" + sp.reason };
  const ck = validateClock(deps.clock, { testBoundary }); if (!ck.ok) return ck;
  if (deps.clock.isBound()) return { ok: false, reason: "trusted_clock_prebound" };
  for (const f of ["executorPhysicalFactory", "readerPhysicalFactory"]) if (!deps[f] || typeof deps[f].open !== "function") return { ok: false, reason: f + "_absent" };
  if (deps.executorPhysicalFactory === deps.readerPhysicalFactory) return { ok: false, reason: "executor_and_reader_share_a_physical_factory" };
  for (const f of ["executorAttestationSource", "readerAttestationSource"]) if (!deps[f] || typeof deps[f].obtain !== "function") return { ok: false, reason: f + "_absent" };
  return { ok: true };
}

export function createAuthorityProvisionerV2(deps, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  const v = validateProvisionerDeps(deps, { testBoundary });
  if (!v.ok) return { ok: false, reason: v.reason };
  const d = Object.freeze({ ...deps });
  const pc = d.provisioningConfig;
  const opened = [];
  let acquired = false;
  const closeAll = async () => { for (const p of opened.splice(0)) { try { await p.close(); } catch {} } };

  async function acquireOnce() {
    // 1–2 executor connection + session + clock binding
    let exPhys; try { exPhys = await d.executorPhysicalFactory.open(); } catch { return fail("executor_connection_failed"); }
    opened.push(exPhys);
    const exS = await establishExecutorSession(exPhys, { statementTimeoutMs: pc.executorStatementTimeoutMs });
    if (!exS.ok) return fail(exS.reason);
    const cb = d.clock.bindToDbClock(exS.session.dbNowMs); if (!cb.ok) return fail(cb.reason);
    // 3 reader connection + accepted reader session
    let rdPhys; try { rdPhys = await d.readerPhysicalFactory.open(); } catch { return fail("reader_connection_failed"); }
    opened.push(rdPhys);
    if (rdPhys === exPhys) return fail("executor_and_reader_share_a_physical_connection");
    const rdS = await establishReaderSession(rdPhys, { statementTimeoutMs: pc.readerStatementTimeoutMs });
    if (!rdS.ok) return fail("reader_" + rdS.reason);
    // 4 two independent attestations, two fresh nonces
    const exNonce = nonce(); let rdNonce = nonce(); while (rdNonce === exNonce) rdNonce = nonce();
    let exEnv, rdEnv;
    try { exEnv = await d.executorAttestationSource.obtain({ contract: EXECUTOR_ATTESTATION_CONTRACT, connectionToken: exS.session.token, role: EXECUTOR_ROLE, requestNonce: exNonce }); }
    catch (e) { return fail("executor_attestation_unavailable" + (e && typeof e.code === "string" ? ":" + e.code.replace(REASON_SAFE, "").slice(0, 48) : "")); }
    try { rdEnv = await d.readerAttestationSource.obtain({ contract: READER_ATTESTATION_CONTRACT, connectionToken: rdS.session.token, role: READER_ROLE, requestNonce: rdNonce }); }
    catch (e) { return fail("reader_attestation_unavailable" + (e && typeof e.code === "string" ? ":" + e.code.replace(REASON_SAFE, "").slice(0, 48) : "")); }
    // 5 independent per-role bindings, pairwise distinct
    const nowMs = d.clock.nowMs();
    const ex = bindExecutorConnection({ session: exS.session, envelope: exEnv, trustRoot: pc.executorAttester.trustRoot, requestNonce: exNonce, nowMs, testBoundary });
    if (!ex.ok) return fail(ex.reason);
    const rd = bindReaderConnection({ session: rdS.session, envelope: rdEnv, trustRoot: pc.readerAttester.trustRoot, requestNonce: rdNonce, nowMs, testBoundary });
    if (!rd.ok) return fail(rd.reason);
    const dist = checkDistinctBindings(ex.binding, rd.binding); if (!dist.ok) return fail(dist.reason);
    // 6 sealed role-scoped clients
    let executorDbClient, readerDbClient;
    try { executorDbClient = makeGuardedExecutorClient(exS.session, { testBoundary }); readerDbClient = makeGuardedReaderClient(rdS.session, { testBoundary }); }
    catch { return fail("guarded_client_construction_failed"); }
    // 7 exact frozen authority shape
    const registry = buildV2RegistrySupply();
    const reg = assertSuppliedRegistryV2(registry); if (!reg.ok) return fail("registry_" + reg.reason);
    const authority = Object.freeze({
      cfg: pc.cfg, trustRoot: d.reviewerTrustRoot, executorDbClient, readerDbClient,
      connectionIdentityProof: ex.binding.identityProof, expectedIssuer: ex.binding.expectedIssuer, connectionToken: ex.binding.token,
      // the frozen marker — set ONLY here, ONLY after the strong executor privilege attestation verified above
      privilegeProof: Object.freeze({ restricted_role_proof_present: true }),
      registry, activationSourceProof: d.activationSourceProof, nowProvider: () => d.clock.nowIso(),
    });
    if (Object.keys(authority).sort().join(",") !== [...REQUIRED_AUTHORITY_FIELDS_V2].sort().join(",")) return fail("authority_shape_not_frozen_exact");
    const va = validateProvisionedAuthorityV2(authority, { testBoundary });
    if (!va.ok) return fail(va.reason);
    return Object.freeze({ available: true, authority });
  }

  const provisioner = Object.freeze({
    contract: PROVISIONER_CONTRACT_V2,
    async acquire(...args) {
      if (args.length !== 0) return fail("acquire_takes_no_arguments");
      if (acquired) return fail("provisioner_acquire_is_one_shot");
      acquired = true;
      let r;
      try { r = await acquireOnce(); } catch { r = fail("provisioner_acquire_failed"); }
      if (!r || r.available !== true) await closeAll();
      return r;
    },
  });
  return { ok: true, provisioner, close: closeAll };
}
