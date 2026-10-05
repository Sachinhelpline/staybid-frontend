// TEST-ONLY — Step6/7 verifier end-to-end against the REAL accepted executor-attester server and the REAL accepted
// v2 clock-gated reader-attestation server (loopback, synthetic clusters, per-run TEST-ONLY keys). OFFLINE.
import { randomBytes } from "node:crypto";
import { test, eq, ok, match, run } from "./_harness.mjs";
import { makeDualEnv, signPayload, kp } from "./fixtures/dual-env.mjs";
import { runStep67Verification } from "../src/step67-verifier.mjs";
import { buildReceipt } from "../src/receipt.mjs";
import { EXECUTOR_LIFECYCLE_SQL } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { LIFECYCLE_SQL as READER_LIFECYCLE_SQL } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { DB_CLOCK_QUERY } from "../../private-reader-bootstrap-clock-peer-offline-01/db-clock-probe.mjs";
import { checkDistinctBindings } from "../../m7-v2-production-authority-provisioning-offline-01/src/role-binding.mjs";
import { createAttestationSourceChannel } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { ATTESTATION_CONTRACT } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { AUTHORITY_READER_ATTESTER_ENV as RD } from "../src/constants.mjs";

async function verify(over, mutate) {
  const E = await makeDualEnv(over);
  try {
    const d = E.deps();
    if (d.cfgFail) return { cfgFail: d.cfgFail, E };
    if (mutate) await mutate(d, E);
    const r = await runStep67Verification(d);
    return { r, E };
  } finally { await E.close(); }
}
const hold = (r, stageRe, reasonRe) => { ok(r && r.ok === false, "expected HOLD, got " + JSON.stringify(r && { ok: r.ok, reason: r.reason, stage: r.stage }));
  if (stageRe) match(r.stage, stageRe, "stage"); if (reasonRe) match(r.reason, reasonRe, "reason"); };
const clone = (x) => JSON.parse(JSON.stringify(x));
function tamperExecutor(d, E, f) {
  const o = d.executorSource.obtain;
  d.executorSource = { obtain: async (q) => { const e = await o(q); const p = clone(e.payload); f(p); return signPayload(p, E.keys.EXK.pk8); } };
}
function tamperReader(d, E, f) {
  const o = d.acquireReaderV2;
  d.acquireReaderV2 = async (x) => { const r = await o(x); if (!r.ok) return r; const p = clone(r.envelope.payload); f(p); return { ...r, envelope: signPayload(p, E.keys.RDK.pk8) }; };
}

test("E01", "positive: dual effective-privilege + identity binding PASS over both REAL accepted attesters", async () => {
  const { r, E } = await verify({});
  eq(r.ok, true, "ok"); eq(r.stage, "S12_complete");
  eq(r.counters.realConnectionsOpened, 2); eq(r.counters.attestationRequestsIssued, 2);
  const b = buildReceipt({ runId: "e2e-positive-01", startedUtc: "2026-10-05T00:00:00.000Z", finishedUtc: "2026-10-05T00:00:01.000Z", result: r,
    pins: E.pins });
  eq(b.ok, true, "receipt safe");
  ok(Object.values(b.receipt.checks).every((v) => v === "PASS"), "every receipt check PASS");
  eq(b.receipt.outcome, "PASS"); eq(b.receipt.sql03, "not_executed"); eq(b.receipt.dbMutations, 0);
  ok(E.opened.executor[0].isDead() && E.opened.reader[0].isDead(), "both connections closed");
});
test("E02", "SQL confinement: executor issues only accepted lifecycle SQL; reader only accepted session SQL + the fixed clock probe", async () => {
  const { r, E } = await verify({});
  eq(r.ok, true);
  const exAllowed = new Set(Object.values(EXECUTOR_LIFECYCLE_SQL));
  const rdAllowed = new Set([...Object.values(READER_LIFECYCLE_SQL), DB_CLOCK_QUERY]);
  ok(E.opened.executor[0].log.every((s) => exAllowed.has(s)), "executor SQL outside lifecycle");
  ok(E.opened.reader[0].log.every((s) => rdAllowed.has(s)), "reader SQL outside lifecycle");
  eq(r.counters.dbStatementsOutsideAcceptedLifecycle, 0);
});
test("E03", "executor privilege drift observed by the REAL executor attester (CREATEROLE) ⇒ HOLD, no binding", async () => {
  const { r } = await verify({ executorState: (s) => { s.role.rolcreaterole = true; } });
  hold(r, /^S6_/, /executor_attestation_unavailable/);   // the real attester refuses to sign a drifted state
});
test("E04", "executor signed-but-drifted proof (rolsuper=true) ⇒ executor_drift_superuser", async () => {
  const { r } = await verify({}, (d, E) => tamperExecutor(d, E, (p) => { p.privileges.rolsuper = true; }));
  hold(r, /^S9_/, /executor_drift_superuser/);
});
test("E05", "executor routine widening (extra executable routine) ⇒ executor_drift_routine_execute", async () => {
  const { r } = await verify({}, (d, E) => tamperExecutor(d, E, (p) => { p.privileges.executableRoutines = [...p.privileges.executableRoutines, "public.extra(jsonb)"]; }));
  hold(r, /^S9_/, /executor_drift_routine_execute/);
});
test("E06", "reader write privilege observed by the REAL v2 reader attester ⇒ HOLD", async () => {
  const { r } = await verify({ readerScenario: "write_privilege" });
  hold(r, /^S7_/, /reader_v2_attestation_unavailable/);   // the real attester refuses to sign a write-capable reader
});
test("E07", "reader signed-but-drifted proof (writePrivilegeCount=1) ⇒ HOLD drift", async () => {
  const { r } = await verify({}, (d, E) => tamperReader(d, E, (p) => { p.privileges.writePrivilegeCount = 1; p.privileges.effectiveSelectOnly = false; }));
  hold(r, /^S9_/, /drift/);
});
test("E08", "executor and reader on the SAME physical connection ⇒ HOLD", async () => {
  const { r } = await verify({}, (d, E) => { d.readerPhysicalFactory = { open: async () => E.opened.executor[0] }; });
  hold(r, /^S4_/, /share_a_physical_connection/);
});
test("E09", "executor and reader on the SAME backend pid ⇒ HOLD (distinctness or earlier)", async () => {
  const { r } = await verify({ sharePid: true });
  hold(r, /^S10_/, /executor_and_reader_share_a_backend/);
});
test("E10", "executor and reader with the SAME application name ⇒ HOLD", async () => {
  const { r } = await verify({ shareAppName: true });
  hold(r, /^S10_/, /executor_and_reader_share_an_application_name/);
});
test("E11", "accepted checkDistinctBindings refuses shared token / pid / app name / nonce / bound token and role swaps", async () => {
  const base = (role, n) => ({ role, token: "t" + n, pid: n, applicationName: "a" + n, nonce: "n" + n, identityProof: { boundConnectionToken: "b" + n } });
  const EXR = "live_ai_03b_executor", RDR = "live_ai_03b_reader";
  eq(checkDistinctBindings(base(EXR, 1), base(RDR, 2)).ok, true);
  for (const [k, re] of [["token", /token/], ["pid", /backend/], ["applicationName", /application_name/], ["nonce", /nonce/]]) {
    const a = base(EXR, 1), b = base(RDR, 2); b[k] = a[k];
    match(checkDistinctBindings(a, b).reason, re, k);
  }
  const a = base(EXR, 1), b = base(RDR, 2); b.identityProof.boundConnectionToken = a.identityProof.boundConnectionToken;
  match(checkDistinctBindings(a, b).reason, /bound_to_one_connection/);
  match(checkDistinctBindings(base(RDR, 1), base(EXR, 2)).reason, /roles/);
});
test("E12", "proof substitution: executor proof for a DIFFERENT request nonce ⇒ nonce mismatch", async () => {
  const { r } = await verify({}, (d) => { const o = d.executorSource.obtain; d.executorSource = { obtain: (q) => o({ ...q, requestNonce: randomBytes(16).toString("hex") }) }; });
  hold(r, /^S9_/, /request_nonce_mismatch/);
});
test("E13", "proof substitution: reader proof offered in place of the executor proof (and vice versa) ⇒ HOLD", async () => {
  let readerEnv = null;
  const { r } = await verify({}, (d) => {
    const oR = d.acquireReaderV2; d.acquireReaderV2 = async (x) => { const rr = await oR(x); readerEnv = rr.envelope; return rr; };
    const oX = d.executorSource.obtain; let exEnv = null;
    d.executorSource = { obtain: async (q) => { exEnv = await oX(q); return exEnv; } };
    const oR2 = d.acquireReaderV2; d.acquireReaderV2 = async (x) => { const rr = await oR2(x); return rr.ok ? { ...rr, envelope: exEnv } : rr; };
  });
  hold(r, /^S9_/);
  ok(readerEnv, "reader proof was obtained");
});
test("E14", "connection-token substitution inside a validly signed executor proof ⇒ connection mismatch", async () => {
  const { r } = await verify({}, (d, E) => tamperExecutor(d, E, (p) => { p.connection.token = "f".repeat(64); }));
  hold(r, /^S9_/, /connection_mismatch/);
});
test("E15", "reconnect before binding (executor backend lost after attestation) ⇒ HOLD, no binding", async () => {
  const { r } = await verify({}, (d, E) => { const o = d.acquireReaderV2; d.acquireReaderV2 = async (x) => { const rr = await o(x); E.opened.executor[0].kill(); return rr; }; });
  hold(r, /^S8_/, /connection_lost_before_binding/);
});
test("E16", "reconnect underneath a bound proof (executor identity changes after binding) ⇒ HOLD", async () => {
  const { r } = await verify({}, (d, E) => { const o = d.acquireReaderV2; d.acquireReaderV2 = async (x) => { const rr = await o(x); E.ctl.identityOverride = () => ({ ...E.exSession, pid: 9999 }); return rr; }; });
  hold(r, /^S11_/, /identity_changed_after_binding/);
});
test("E17", "bad executor signature ⇒ HOLD", async () => {
  const { r } = await verify({}, (d) => { const o = d.executorSource.obtain; d.executorSource = { obtain: async (q) => { const e = await o(q); const s = Buffer.from(e.signatureB64, "base64"); s[0] ^= 1; return { ...e, signatureB64: s.toString("base64") }; } }; });
  hold(r, /^S9_/, /signature/);
});
test("E18", "untrusted reader issuer (Authority pins a different issuer than the dedicated attester signs) ⇒ HOLD", async () => {
  const { r } = await verify({ envOver: { [RD.issuer]: "TEST-ONLY-some-other-issuer" } });
  hold(r, /^S7_/, /reader_v2_proof_attestation_issuer_untrusted/);   // refused inside the accepted acquireAuthority bracket, before binding
});
test("E19", "reader proof signed by a key the Authority does NOT trust (M5-style key substitution) ⇒ HOLD", async () => {
  const other = kp();
  const { r } = await verify({ envOver: { [RD.publicKeyDerB64]: other.der, [RD.fingerprint]: other.fp }, pinsOver: { expectedReaderAttesterFingerprint: other.fp } });
  hold(r, /^S7_/, /reader_v2_proof_attestation_key_untrusted/);
});
test("E20", "stale executor proof ⇒ HOLD", async () => {
  const { r } = await verify({}, (d, E) => tamperExecutor(d, E, (p) => { const n = Date.now(); p.issuedAtMs = n - 130000; p.expiresAtMs = n - 10000; }));
  hold(r, /^S9_/, /stale|expired/);
});
test("E21", "expired executor proof ⇒ HOLD", async () => {
  const { r } = await verify({}, (d, E) => tamperExecutor(d, E, (p) => { const n = Date.now(); p.issuedAtMs = n - 60000; p.expiresAtMs = n - 1000; }));
  hold(r, /^S9_/, /expired/);
});
test("E22", "future-dated reader proof ⇒ HOLD", async () => {
  const { r } = await verify({}, (d, E) => tamperReader(d, E, (p) => { const n = Date.now(); p.issuedAtMs = n + 60000; p.expiresAtMs = n + 120000; }));
  hold(r, /^S9_/, /future_dated/);
});
test("E23", "CORE-PROD target in a validly signed executor proof AND in a reader proof ⇒ HOLD core_prod", async () => {
  const a = await verify({}, (d, E) => tamperExecutor(d, E, (p) => { p.target.projectId = FIXED.core_excluded_project; p.target.pgServiceId = FIXED.core_excluded_postgres; }));
  hold(a.r, /^S9_/, /core_prod/);
  const b = await verify({}, (d, E) => tamperReader(d, E, (p) => { p.target.projectId = FIXED.core_excluded_project; p.target.pgServiceId = FIXED.core_excluded_postgres; }));
  hold(b.r, /^S9_/, /core_prod/);
});
test("E24", "protocol: the v1 reader caller is refused by the dedicated v2 attester (unsupported_version)", async () => {
  const E = await makeDualEnv({});
  try {
    const ch = createAttestationSourceChannel({ host: "127.0.0.1", port: E.rdSrv.address.port, channelSecret: E.secrets.RD_SECRET }, { offlineTestBoundary: true });
    ok(ch.ok, "v1 channel constructed for the negative test");
    let code = null;
    try { await ch.source.obtain({ contract: ATTESTATION_CONTRACT, connectionToken: "a".repeat(64), role: "live_ai_03b_reader", requestNonce: "b".repeat(32) }); }
    catch (e) { code = e && e.attesterCode; }
    eq(code, "unsupported_version", "v1 frame refused by the v2 server");
  } finally { await E.close(); }
});
test("E25", "clock gate: dedicated attester clock interval wider than the accepted 250 ms bound ⇒ reader v2 HOLD", async () => {
  const { r } = await verify({ attesterIntervalUs: [-600000, 600000] });
  hold(r, /^S7_/, /clock_gate_failed/);
});
test("E26", "bad HMAC: reader channel secret mismatch ⇒ reader HOLD; executor channel secret mismatch ⇒ executor HOLD", async () => {
  const a = await verify({ rdServerSecret: randomBytes(24).toString("hex") });
  hold(a.r, /^S7_/, /reader_v2_attestation_unauthenticated/);
  const b = await verify({ exServerSecret: randomBytes(24).toString("hex") });
  hold(b.r, /^S6_/, /executor_attestation_unavailable/);
});
test("E27", "peer refusal: Authority address outside the dedicated attester / executor attester exact-host allowlists ⇒ HOLD", async () => {
  const a = await verify({ rdPeerCidrs: ["10.9.9.9/32"] });
  hold(a.r, /^S7_/, /reader_v2_attestation_unauthenticated/);
  const b = await verify({ exPeerCidrs: ["10.9.9.9/32"] });
  hold(b.r, /^S6_/);
});
test("E28", "trusted clock: executor DB clock skew > 5 s ⇒ HOLD at S3 before any reader connection", async () => {
  const { r, E } = await verify({}, (d, E2) => { E2.ctl.dbSkewMs = 10000; });
  hold(r, /^S3_/);
  eq(E.opened.reader.length, 0, "no reader connection opened");
});
test("E29", "wrong executor session role ⇒ HOLD at S2; wrong reader session role ⇒ HOLD at S5", async () => {
  const a = await verify({}, (d, E) => { E.ctl.identityOverride = () => ({ ...E.exSession, usename: "postgres" }); });
  hold(a.r, /^S2_/);
  const b = await verify({ readerScenario: "wrong_role" });
  hold(b.r, /^S5_/);
});

await run("verifier-e2e.test.mjs");
