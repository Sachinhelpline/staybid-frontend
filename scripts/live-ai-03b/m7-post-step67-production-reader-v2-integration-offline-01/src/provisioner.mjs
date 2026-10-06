// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — the provisioner. OFFLINE candidate.
//
// Post-Step67 reader-v2 integration changes only the trusted reader-attestation seam:
//   legacy generic reader source dependency -> readerAttestationProvider.obtain({ session })
// The exact accepted rdS.session is passed to the provider. No second reader DB connection, reconnect or v1
// fallback exists. The provider returns the v2-generated nonce + accepted reader envelope; the unchanged
// bindReaderConnection() performs the final signature/trust/target/privilege binding.
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { PROVISIONER_CONTRACT_V2, validateProvisionedAuthorityV2, REQUIRED_AUTHORITY_FIELDS_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-production-authority.mjs";
import { buildV2RegistrySupply, assertSuppliedRegistryV2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-query-registry.mjs";
import { checkActivationSourceProofV2 } from "../../m7-step2-runtime-rebinding-offline-01/identity/v2-source-identity.mjs";
import { establishReaderSession } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { establishExecutorSession, EXECUTOR_ROLE } from "./executor-session.mjs";
import { bindExecutorConnection, bindReaderConnection, checkDistinctBindings, EXECUTOR_ATTESTATION_CONTRACT } from "./role-binding.mjs";
import { makeGuardedExecutorClient, makeGuardedReaderClient } from "./guarded-clients.mjs";
import { validateClock } from "./trusted-clock.mjs";

export const PROVISIONER_DEPS_KEYS = Object.freeze(["activationSourceProof", "clock", "executorAttestationSource", "executorPhysicalFactory",
  "provisioningConfig", "readerAttestationProvider", "readerPhysicalFactory", "reviewerTrustRoot"]);
export const READER_V2_PROTOCOL = "reader-attestation-channel-v2";
const fail = (reason) => Object.freeze({ available: false, reason });
const REASON_SAFE = /[^A-Za-z0-9_.:-]/g;
const nonce = () => randomBytes(16).toString("hex");
const READER_NONCE = /^[0-9a-f]{32}$/;

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
  if (!deps.executorAttestationSource || typeof deps.executorAttestationSource.obtain !== "function") return { ok: false, reason: "executorAttestationSource_absent" };
  if (!deps.readerAttestationProvider || typeof deps.readerAttestationProvider.obtain !== "function") return { ok: false, reason: "readerAttestationProvider_absent" };
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
    let exPhys; try { exPhys = await d.executorPhysicalFactory.open(); } catch { return fail("executor_connection_failed"); }
    opened.push(exPhys);
    const exS = await establishExecutorSession(exPhys, { statementTimeoutMs: pc.executorStatementTimeoutMs });
    if (!exS.ok) return fail(exS.reason);
    const cb = d.clock.bindToDbClock(exS.session.dbNowMs); if (!cb.ok) return fail(cb.reason);

    let rdPhys; try { rdPhys = await d.readerPhysicalFactory.open(); } catch { return fail("reader_connection_failed"); }
    opened.push(rdPhys);
    if (rdPhys === exPhys) return fail("executor_and_reader_share_a_physical_connection");
    const rdS = await establishReaderSession(rdPhys, { statementTimeoutMs: pc.readerStatementTimeoutMs });
    if (!rdS.ok) return fail("reader_" + rdS.reason);

    const exNonce = nonce();
    let exEnv;
    try { exEnv = await d.executorAttestationSource.obtain({ contract: EXECUTOR_ATTESTATION_CONTRACT, connectionToken: exS.session.token, role: EXECUTOR_ROLE, requestNonce: exNonce }); }
    catch (e) { return fail("executor_attestation_unavailable" + (e && typeof e.code === "string" ? ":" + e.code.replace(REASON_SAFE, "").slice(0, 48) : "")); }

    let rdResult;
    try { rdResult = await d.readerAttestationProvider.obtain({ session: rdS.session }); }
    catch (e) { return fail("reader_attestation_unavailable" + (e && typeof e.code === "string" ? ":" + e.code.replace(REASON_SAFE, "").slice(0, 48) : "")); }
    if (!rdResult || rdResult.ok !== true) {
      const code = rdResult && typeof rdResult.reason === "string" ? rdResult.reason.replace(REASON_SAFE, "").slice(0, 48) : "reader_v2_result_invalid";
      return fail("reader_attestation_unavailable:" + (code || "reader_v2_result_invalid"));
    }
    if (rdResult.protocol !== READER_V2_PROTOCOL) return fail("reader_attestation_unavailable:reader_v2_protocol_mismatch");
    if (!rdResult.envelope || typeof rdResult.envelope !== "object" || !READER_NONCE.test(rdResult.requestNonce || ""))
      return fail("reader_attestation_unavailable:reader_v2_result_invalid");
    const rdEnv = rdResult.envelope, rdNonce = rdResult.requestNonce;

    const nowMs = d.clock.nowMs();
    const ex = bindExecutorConnection({ session: exS.session, envelope: exEnv, trustRoot: pc.executorAttester.trustRoot, requestNonce: exNonce, nowMs, testBoundary });
    if (!ex.ok) return fail(ex.reason);
    const rd = bindReaderConnection({ session: rdS.session, envelope: rdEnv, trustRoot: pc.readerAttester.trustRoot, requestNonce: rdNonce, nowMs, testBoundary });
    if (!rd.ok) return fail(rd.reason);
    const dist = checkDistinctBindings(ex.binding, rd.binding); if (!dist.ok) return fail(dist.reason);

    let executorDbClient, readerDbClient;
    try { executorDbClient = makeGuardedExecutorClient(exS.session, { testBoundary }); readerDbClient = makeGuardedReaderClient(rdS.session, { testBoundary }); }
    catch { return fail("guarded_client_construction_failed"); }
    const registry = buildV2RegistrySupply();
    const reg = assertSuppliedRegistryV2(registry); if (!reg.ok) return fail("registry_" + reg.reason);
    const authority = Object.freeze({
      cfg: pc.cfg, trustRoot: d.reviewerTrustRoot, executorDbClient, readerDbClient,
      connectionIdentityProof: ex.binding.identityProof, expectedIssuer: ex.binding.expectedIssuer, connectionToken: ex.binding.token,
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
