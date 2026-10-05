// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — VERIFICATION-ONLY dual-client effective-privilege + identity binding core.
// OFFLINE candidate. Node built-ins only at load.
//
// Composes ONLY accepted lower-level primitives. It never builds an activation authority, never constructs a
// guarded executor client, never calls composeTrustedExecutorProductionV2(), never issues SQL beyond the accepted
// session lifecycle statements and the accepted fixed clock probe, and never touches Railway, a gateway or a provider.
//
//   1  executor physical connection           (accepted factory; one pg Client, no pool)
//   2  executor session                       (accepted establishExecutorSession: timeout set+read back, identity, token, DB clock)
//   3  trusted clock bound to the DB clock    (accepted makeProductionClock().bindToDbClock, |host−DB| ≤ 5 s)
//   4  reader physical connection             (accepted factory; a DIFFERENT physical object / credential)
//   5  reader session                         (accepted establishReaderSession: ≤2000 ms, read-only, identity, token)
//   6  executor attestation                   (accepted executor-attestation-channel-v1 adapter; fresh 32-hex nonce)
//   7  reader attestation                     (reader-v2-attestation-source.mjs: accepted v2 clock-gated bootstrap path)
//   8  bindExecutorConnection / bindReaderConnection (accepted verifiers incl. effective privileges + target binding)
//   9  checkDistinctBindings                  (accepted: role, token, pid, application name, nonce, bound token)
//  10  post-binding liveness                  (no reconnect underneath a bound proof: same tokens re-derived, not dead)
//  11  close both connections
// Any failure ⇒ { ok:false, reason, stage } with a fixed bounded reason. NO retry anywhere.
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { establishExecutorSession, EXECUTOR_ROLE } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { establishReaderSession, recheckReaderSession } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { bindExecutorConnection, bindReaderConnection, checkDistinctBindings, EXECUTOR_ATTESTATION_CONTRACT } from "../../m7-v2-production-authority-provisioning-offline-01/src/role-binding.mjs";
import { READER_ROLE } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { EXECUTOR_STATEMENT_TIMEOUT_MS, READER_STATEMENT_TIMEOUT_MS } from "./constants.mjs";

export const VERIFIER_VERSION = "m7-step67-verifier-v1";
export const VERIFIER_DEPS_KEYS = Object.freeze(["acquireReaderV2", "clock", "config", "executorPhysicalFactory", "executorSource", "readerChannelSecret", "readerPhysicalFactory"]);
const SAFE = /[^a-z0-9_:.-]/g;
const bounded = (s) => String(s || "unknown").replace(SAFE, "").slice(0, 96) || "unknown";

/**
 * @returns {Promise<{ok:boolean, reason?:string, stage:string, checks:object, counters:object}>}  (no secret, token,
 *   nonce, envelope or signature is ever placed in the result)
 */
export async function runStep67Verification(deps) {
  const checks = {};
  const counters = { realConnectionsOpened: 0, attestationRequestsIssued: 0, dbStatementsOutsideAcceptedLifecycle: 0 };
  let stage = "S0_inputs";
  const out = (ok, reason) => ({ ok, ...(ok ? {} : { reason: bounded(reason) }), stage });
  const freeze = (r) => Object.freeze({ ...r, checks: Object.freeze({ ...checks }), counters: Object.freeze({ ...counters }) });
  if (!deps || typeof deps !== "object" || Object.keys(deps).sort().join(",") !== VERIFIER_DEPS_KEYS.join(",")) return freeze(out(false, "verifier_deps_shape_not_exact"));
  const { config: cfg, executorPhysicalFactory, readerPhysicalFactory, executorSource, readerChannelSecret, clock, acquireReaderV2 } = deps;
  if (!cfg || cfg.ok !== true) return freeze(out(false, "config_invalid"));
  if (!executorPhysicalFactory || !readerPhysicalFactory || executorPhysicalFactory === readerPhysicalFactory) return freeze(out(false, "physical_factories_not_distinct"));
  if (!executorSource || typeof executorSource.obtain !== "function" || typeof acquireReaderV2 !== "function") return freeze(out(false, "attestation_sources_absent"));
  if (!clock || typeof clock.bindToDbClock !== "function" || clock.isBound()) return freeze(out(false, "trusted_clock_invalid_or_prebound"));
  const testBoundary = cfg.testBoundary === true;
  const opened = [];
  let res;
  try { res = await body(); } catch { res = out(false, "verifier_unexpected_failure"); }
  let closedAll = true;
  for (const p of opened.splice(0)) { try { await p.close(); } catch { closedAll = false; } }
  checks.connectionsClosed = closedAll;
  return freeze(res);

  async function body() {
    // 1–3 executor
    stage = "S1_executor_connection";
    let exPhys; try { exPhys = await executorPhysicalFactory.open(); } catch { return out(false, "executor_connection_failed"); }
    opened.push(exPhys); counters.realConnectionsOpened++;
    checks.executorConnectionEstablished = true;
    stage = "S2_executor_session";
    const exS = await establishExecutorSession(exPhys, { statementTimeoutMs: EXECUTOR_STATEMENT_TIMEOUT_MS });
    if (!exS.ok) return out(false, exS.reason);
    checks.executorSessionRole = exS.session.identity.role === EXECUTOR_ROLE;
    stage = "S3_trusted_clock";
    const cb = clock.bindToDbClock(exS.session.dbNowMs); if (!cb.ok) return out(false, cb.reason);
    checks.trustedClockBoundToDb = true;
    // 4–5 reader
    stage = "S4_reader_connection";
    let rdPhys; try { rdPhys = await readerPhysicalFactory.open(); } catch { return out(false, "reader_connection_failed"); }
    opened.push(rdPhys); counters.realConnectionsOpened++;
    if (rdPhys === exPhys) return out(false, "executor_and_reader_share_a_physical_connection");
    checks.readerConnectionEstablished = true;
    stage = "S5_reader_session";
    const rdS = await establishReaderSession(rdPhys, { statementTimeoutMs: READER_STATEMENT_TIMEOUT_MS });
    if (!rdS.ok) return out(false, "reader_" + rdS.reason);
    checks.readerSessionRole = true;   // establishReaderSession refuses unless current_user = session_user = live_ai_03b_reader
    checks.readerReadOnlySession = true;
    checks.readerStatementTimeoutBounded = rdS.session.effectiveStatementTimeoutMs === READER_STATEMENT_TIMEOUT_MS;
    // 6 executor attestation (fresh nonce)
    stage = "S6_executor_attestation";
    const exNonce = randomBytes(16).toString("hex");
    let exEnv;
    counters.attestationRequestsIssued++;
    try { exEnv = await executorSource.obtain({ contract: EXECUTOR_ATTESTATION_CONTRACT, connectionToken: exS.session.token, role: EXECUTOR_ROLE, requestNonce: exNonce }); }
    catch (e) { return out(false, "executor_attestation_unavailable" + (e && typeof e.attesterCode === "string" ? ":" + e.attesterCode : (e && typeof e.code === "string" ? ":" + e.code : ""))); }
    // 7 reader attestation (accepted v2 clock-gated path; fresh nonce + fresh generation inside)
    stage = "S7_reader_v2_attestation";
    counters.attestationRequestsIssued++;
    const rdAtt = await acquireReaderV2({ session: rdS.session, attester: { host: cfg.readerAttester.host, port: cfg.readerAttester.port },
      channelSecret: readerChannelSecret, trustRoot: cfg.readerAttester.trustRoot, anchorClusterFingerprint: cfg.anchorClusterFingerprint, testBoundary });
    if (!rdAtt || rdAtt.ok !== true) return out(false, (rdAtt && rdAtt.reason) || "reader_v2_failed");
    checks.readerProtocolV2ClockGated = rdAtt.protocol === "reader-attestation-channel-v2";
    // pre-binding liveness: neither physical may have been replaced/terminated since its session was established
    stage = "S8_pre_binding_liveness";
    if (exPhys.isDead() || (typeof rdPhys.isDead === "function" && rdPhys.isDead())) return out(false, "connection_lost_before_binding");
    // 8 independent per-role bindings (accepted verifiers: signature/issuer/fingerprint/freshness/token/nonce/target/privileges)
    stage = "S9_binding";
    const nowMs = clock.nowMs();
    const ex = bindExecutorConnection({ session: exS.session, envelope: exEnv, trustRoot: cfg.executorAttester.trustRoot, requestNonce: exNonce, nowMs, testBoundary });
    if (!ex.ok) return out(false, ex.reason);
    checks.executorAttestationSignatureTrustFreshness = true;
    checks.executorPrivilegeContract = true;      // verifyExecutorAttestation refused every widening (role flags, memberships, schemas, routines, budget/ledger, PUBLIC/default)
    checks.executorTargetBinding = true;
    const rd = bindReaderConnection({ session: rdS.session, envelope: rdAtt.envelope, trustRoot: cfg.readerAttester.trustRoot, requestNonce: rdAtt.requestNonce, nowMs, testBoundary });
    if (!rd.ok) return out(false, rd.reason);
    if (rd.binding.role !== READER_ROLE) return out(false, "reader_binding_role_mismatch");
    checks.readerAttestationSignatureTrustFreshness = true;
    checks.readerPrivilegeContract = true;        // verifyReaderAttestation: select-only, 0 writes, exact grant count, no forbidden object/membership/routine/owner authority
    checks.readerTargetBinding = true;
    // 9 pairwise distinctness (accepted)
    stage = "S10_distinctness";
    const dist = checkDistinctBindings(ex.binding, rd.binding);
    if (!dist.ok) return out(false, dist.reason);
    Object.assign(checks, { distinctRoles: true, distinctPhysicalSessions: true, distinctConnectionTokens: true, distinctBackendPids: true,
      distinctApplicationNames: true, distinctRequestNonces: true, distinctBoundConnectionTokens: true });
    // 10 post-binding liveness: the bound backends must still be the SAME backends (no reconnect underneath a proof)
    stage = "S11_post_binding_liveness";
    if (exPhys.isDead() || (typeof rdPhys.isDead === "function" && rdPhys.isDead())) return out(false, "connection_lost_after_binding");
    const rr = await recheckReaderSession(rdS.session);
    if (!rr.ok) return out(false, "reader_" + rr.reason);
    const exAgain = await establishExecutorSession(exPhys, { statementTimeoutMs: EXECUTOR_STATEMENT_TIMEOUT_MS });
    if (!exAgain.ok || exAgain.session.token !== exS.session.token) return out(false, "executor_connection_identity_changed_after_binding");
    checks.noReconnectUnderBoundProof = true;
    stage = "S12_complete";
    return out(true);
  }
}
