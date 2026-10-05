// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — Authority-side READER attestation over the ACCEPTED v2 clock-gated channel.
// OFFLINE candidate. Node built-ins only at load.
//
// The deployed accepted reader-attester architecture speaks ONLY `reader-attestation-channel-v2`
// (verifyV2RequestFrame refuses every other version) and signs only after its pre-sign clock guard. The v1
// adapter (createAttestationSourceChannel) is therefore NEVER used here. This module adds NO new security logic —
// it composes the accepted M5 reader path exactly as the accepted production reader does
// (private-reader-bootstrap-clock-peer-offline-01/production-reader.mjs):
//   1. resolve the dedicated attester's approved `*.railway.internal` name to an EXACT private address
//      (accepted resolvePeerAllowlist: loopback / public / malformed / broad results refused);
//   2. build the accepted fixed DB-clock sampler OVER THE SAME reader physical session whose connection token the
//      attester must observe (accepted makeClockSamplerOverPhysical; anchored cluster fingerprint enforced on
//      every probe; Postgres clock_timestamp(), never the Owner Mac clock);
//   3. run the accepted reader bootstrap (startReaderBootstrap): fresh process generation → five-consecutive
//      startup gate → runtime monitor → ONE acquireAuthority(): pre-sample → authenticated v2 request carrying
//      {L,U,generation} → signed response → accepted verifyReaderAttestation → post-sample → shared-DB-clock
//      bracket consistency → generation unchanged → atomic install;
//   4. return the verified envelope + its request nonce to the Step6/7 binder, which re-verifies it with the
//      accepted bindReaderConnection against the trusted DB-bound clock.
// The accepted obtainV2 socket client is wrapped ONLY to retain the envelope the accepted bootstrap already
// verified (the bootstrap keeps it private); the wrapper never alters the request, the response or the decision.
// ─────────────────────────────────────────────────────────────────────────
import { startReaderBootstrap } from "../../private-reader-bootstrap-clock-peer-offline-01/reader-bootstrap.mjs";
import { obtainV2 } from "../../private-reader-bootstrap-clock-peer-offline-01/bootstrap-state.mjs";
import { makeClockSamplerOverPhysical } from "../../private-reader-bootstrap-clock-peer-offline-01/production-db-clock.mjs";
import { resolvePeerAllowlist, RAILWAY_INTERNAL_RE } from "../../private-reader-bootstrap-clock-peer-offline-01/private-peer-resolver.mjs";
import { V2_CHANNEL_VERSION } from "../../private-reader-bootstrap-clock-peer-offline-01/attestation-channel-v2.mjs";

export const READER_V2_SOURCE_VERSION = "m7-step67-reader-v2-attestation-source-v1";
export const READER_PROTOCOL = V2_CHANNEL_VERSION;   // "reader-attestation-channel-v2" — the ONLY protocol this source speaks
const TEST_SEAMS = Object.freeze(["resolver", "makeSampler", "obtainV2Fn", "monitorStart"]);
const fail = (reason) => Object.freeze({ ok: false, reason });
const SAFE = /[^a-z0-9_:.-]/g;

/**
 * R4 REMEDIATION (reader_v2_attester_destination_not_single). The accepted resolver validates EVERY record of the ONE
 * approved `*.railway.internal` name as an exact private host and explicitly admits a single replica's dual-stack
 * pair (A + AAAA; DEFAULT_MAX_ADDRESSES "allowing dual-stack"). The single-replica contract is therefore "one
 * instance": AT MOST ONE address per IP family. Two addresses of the same family (a second replica / host) remain
 * refused as `not_single`; nothing else is widened. The dial target is deterministic — the IPv6 address when present
 * (Railway private networking's native family), else the IPv4 address — and the destination is still authenticated
 * end to end by the channel HMAC and the pinned reader-attester trust root, never by its address.
 */
export function selectSingleInstanceDestination(addresses) {
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 2) return fail("not_single");
  const v4 = addresses.filter((x) => x && x.type === "ipv4"), v6 = addresses.filter((x) => x && x.type === "ipv6");
  if (v4.length + v6.length !== addresses.length || v4.length > 1 || v6.length > 1) return fail("not_single");
  const pick = v6.length ? v6[0] : v4[0];
  if (typeof pick.address !== "string" || !pick.address) return fail("not_single");
  return Object.freeze({ ok: true, address: pick.address, type: pick.type, dualStack: v4.length === 1 && v6.length === 1 });
}

/**
 * @param a.session   accepted reader session (establishReaderSession(...).session) — the SAME physical the attester binds
 * @param a.attester  { host, port } — host is the dedicated attester's Railway private service name (loopback only in tests)
 * @param a.channelSecret  dedicated reader-attester v2 channel secret (value used only to MAC the request)
 * @param a.trustRoot  pinned dedicated reader-attester trust root (accepted makeAttesterTrustRoot)
 * @param a.anchorClusterFingerprint  anchored AI-STAGING cluster fingerprint enforced on every clock probe
 * @param a.testBoundary  offline tests only; the only way to pass `seams`
 * @param a.seams  TEST-ONLY: { resolver, makeSampler, obtainV2Fn, monitorStart }
 */
export async function acquireReaderV2Attestation(a) {
  const args = a || {};
  const testBoundary = args.testBoundary === true;
  const seams = args.seams || {};
  const seamKeys = Object.keys(seams);
  if (seamKeys.some((k) => !TEST_SEAMS.includes(k))) return fail("reader_v2_unknown_seam");
  if (seamKeys.length && !testBoundary) return fail("reader_v2_test_seam_outside_test_boundary");
  const { session, attester, channelSecret, trustRoot, anchorClusterFingerprint } = args;
  if (!session || !session.physical || typeof session.token !== "string") return fail("reader_v2_session_absent");
  if (!attester || typeof attester.host !== "string" || !Number.isInteger(attester.port)) return fail("reader_v2_attester_absent");
  if (typeof channelSecret !== "string" || channelSecret.length < 32) return fail("reader_v2_channel_secret_invalid");
  if (!trustRoot || typeof trustRoot.publicKeyDerB64 !== "string") return fail("reader_v2_trust_root_absent");
  if (!testBoundary && trustRoot.test === true) return fail("reader_v2_test_trust_root_refused");
  if (typeof anchorClusterFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(anchorClusterFingerprint)) return fail("reader_v2_anchor_fingerprint_invalid");

  // 1. exact private destination (accepted resolver); loopback literal ONLY inside the offline test boundary
  let host;
  if (RAILWAY_INTERNAL_RE.test(attester.host)) {
    const r = await resolvePeerAllowlist({ serviceName: attester.host, ...(seams.resolver ? { resolver: seams.resolver } : {}) });
    if (!r.ok) return fail("reader_v2_attester_destination_" + r.reason);
    const d = selectSingleInstanceDestination(r.addresses);
    if (!d.ok) return fail("reader_v2_attester_destination_" + d.reason);
    host = d.address;
  } else if (testBoundary && (attester.host === "127.0.0.1" || attester.host === "::1")) {
    host = attester.host;
  } else return fail("reader_v2_attester_destination_not_private_service");

  // 2. accepted clock sampler over the SAME reader physical session
  let sampler;
  try { sampler = (seams.makeSampler || makeClockSamplerOverPhysical)(session.physical, { expectedFingerprint: anchorClusterFingerprint }); }
  catch { return fail("reader_v2_clock_sampler_unavailable"); }

  // 3. accepted reader bootstrap — exactly one acquisition; the envelope it verified is retained by a pass-through wrapper
  const base = seams.obtainV2Fn || obtainV2;
  const captured = [];
  const obtainV2Fn = async (opts) => {
    const r = await base(opts);
    if (r && r.ok === true) captured.push(Object.freeze({ requestNonce: opts.requestNonce, envelope: r.envelope, generation: opts.readerClock && opts.readerClock.generation }));
    return r;
  };
  let reader = null;
  try {
    reader = await startReaderBootstrap({
      takeSampleFn: sampler.takeSampleFn, connectionToken: session.token, attester: { host, port: attester.port }, channelSecret,
      trustRoot, monoNowUs: sampler.monoNowUs, offlineTestBoundary: true,   // the accepted internal composition seam (as production-reader.mjs)
      startMonitor: seams.monitorStart === false ? false : true, obtainV2Fn,
    });
    if (!reader || reader.started !== true) return fail("reader_v2_bootstrap_not_started");
    if (reader.startupPassed !== true) return fail("reader_v2_startup_clock_gate_failed");
    const acq = await reader.acquireAuthority();
    if (!acq || acq.ok !== true) return fail("reader_v2_" + String((acq && acq.reason) || "acquire_failed").replace(SAFE, "").slice(0, 64));
    if (!reader.authorityReady()) return fail("reader_v2_authority_not_ready");
    const nonce = reader.authorityRequestNonce();
    const hits = captured.filter((c) => c.requestNonce === nonce);
    if (captured.length !== 1 || hits.length !== 1) return fail("reader_v2_envelope_capture_ambiguous");
    if (hits[0].generation !== acq.generation) return fail("reader_v2_generation_mismatch");
    return Object.freeze({ ok: true, envelope: hits[0].envelope, requestNonce: nonce, protocol: READER_PROTOCOL });
  } catch {
    return fail("reader_v2_acquisition_failed");
  } finally {
    if (reader && typeof reader.stop === "function") { try { await reader.stop(); } catch {} }
  }
}
