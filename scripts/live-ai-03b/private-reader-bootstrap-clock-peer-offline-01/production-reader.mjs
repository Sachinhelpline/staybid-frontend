// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: READER production composition root (OFFLINE candidate). Node built-ins only at load.
//
// A REAL fail-closed composition root (not a permanent stub). In PRODUCTION mode it validates deployment-owned
// configuration, rejects any caller-injected authority, resolves the attester's private `.railway.internal`
// destination to an EXACT private address, establishes the reader's OWN read-only DB session (its observed
// identity + connection token), builds the fixed direct-PostgreSQL clock sampler over that same session, and
// starts the reader bootstrap. It reaches AUTHORITY_READY only through the frozen clock bracket + a verified
// attestation. It NEVER opens the gateway observation serving listener (that is a later gate).
//
// Synthetic dependency injection is accepted ONLY behind the explicit offline-test boundary
// ({ offlineTest:true, offlineTestBoundary:true, inject:{...} }). No live connection is attempted offline.
// ─────────────────────────────────────────────────────────────────────────
import { STATES } from "./bootstrap-state.mjs";
import { startReaderBootstrap } from "./reader-bootstrap.mjs";
import { loadReaderProductionConfig, rejectTestInjection } from "./production-config.mjs";
import { makeClockSamplerOverPhysical } from "./production-db-clock.mjs";
import { resolvePeerAllowlist } from "./private-peer-resolver.mjs";
import { makePgPhysicalFactory, establishReaderSession } from "../private-reader-production-integration-offline-01/reader-session.mjs";

export const READER_PRODUCTION_VERSION = "reader-bootstrap-production-v1";

/**
 * Compose + start the reader bootstrap.
 * Production: composeReaderProduction({ env, log }).
 * Offline-test: composeReaderProduction({ offlineTest:true, offlineTestBoundary:true, inject:{ takeSampleFn, connectionToken, attester, channelSecret, trustRoot, monoNowUs, obtainV2Fn?, startMonitor? } }).
 */
export async function composeReaderProduction(opts = {}) {
  if (opts && opts.offlineTest === true && opts.offlineTestBoundary === true) {
    const inj = opts.inject || {};
    return startReaderBootstrap({ ...inj, offlineTestBoundary: true });
  }
  // ── PRODUCTION MODE ──
  const bad = rejectTestInjection(opts);
  if (bad) return { started: false, status: STATES.UNPROVISIONED, reason: "production_option_not_allowed:" + bad };
  const env = opts.env;
  const log = typeof opts.log === "function" ? opts.log : () => {};

  const loaded = loadReaderProductionConfig(env || {});
  if (!loaded.ok) return { started: false, status: STATES.UNPROVISIONED, reason: loaded.reason, missing: loaded.missing };
  const cfg = loaded.config;

  // resolve the attester's private destination (real DNS) → EXACT private address, validated
  const res = await resolvePeerAllowlist({ serviceName: cfg.attesterServiceName });
  if (!res.ok) return { started: false, status: STATES.UNPROVISIONED, reason: "attester_peer_" + res.reason };
  const attesterHost = res.addresses[0].address;

  // establish the reader's OWN read-only reader-role session → connection token + physical (clock probe source)
  let session = null, physical = null;
  try {
    const factory = makePgPhysicalFactory({ env, connectionStringEnvName: cfg.readerDbUrlEnvName });
    physical = await factory.open();
    const est = await establishReaderSession(physical, { statementTimeoutMs: cfg.clockStatementTimeoutMs });
    if (!est.ok) { try { await physical.close(); } catch {} return { started: false, status: STATES.UNPROVISIONED, reason: "reader_session_" + est.reason }; }
    session = est.session;
  } catch { if (physical) { try { await physical.close(); } catch {} } return { started: false, status: STATES.UNPROVISIONED, reason: "reader_db_unavailable" }; }

  const sampler = makeClockSamplerOverPhysical(session.physical, { expectedFingerprint: cfg.expectedFingerprint });
  const channelSecret = env[cfg.channelSecretEnvName];

  let reader;
  try {
    reader = await startReaderBootstrap({
      takeSampleFn: sampler.takeSampleFn,
      connectionToken: session.token,
      attester: { host: attesterHost, port: cfg.attesterPort },
      channelSecret,
      trustRoot: cfg.trustRoot,
      monoNowUs: sampler.monoNowUs,
      offlineTestBoundary: true,   // internal composition seam; production authority still requires the full clock bracket
      log,
    });
  } catch { try { await session.physical.close(); } catch {} return { started: false, status: STATES.UNPROVISIONED, reason: "reader_bootstrap_start_failed" }; }
  if (!reader.started) { try { await session.physical.close(); } catch {} return reader; }

  // wrap stop() to also close the DB session
  const baseStop = reader.stop;
  return Object.freeze({ ...reader, version: READER_PRODUCTION_VERSION, async stop() { try { await baseStop(); } catch {} try { await session.physical.close(); } catch {} return true; } });
}
