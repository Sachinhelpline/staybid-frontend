// OFFLINE RESOURCE-CONTAINMENT tests (LIVE-AI-03B v2 correction). Directly reproduces and closes the
// independent WORK v2 findings: an application-visible timeout is not underlying-work termination. Node
// built-ins only. Connects to NOTHING external. Synthetic controllable physical connections + the shared
// synthetic cluster fixture (for the healthy paths) + real local loopback sockets. Not evidence about live
// AI-STAGING. A never-settling `query`/`open`/setup Promise is the controlled analogue of a stalled `pg`
// operation on the wire that Promise.race() abandons but does not cancel.
import { createHash, generateKeyPairSync, createHmac } from "node:crypto";
import net from "node:net";
import process from "node:process";
import { createObserverCoordinator, establishObserverSession, makeRequestContext, OBSERVER_MAX_ACTIVE, OBSERVER_MAX_QUEUED } from "../observer-connection.mjs";
import { startAttestationServer, ATTESTER_SHUTDOWN_DEADLINE_MS, ATTESTER_MAX_CONCURRENT, ATTESTER_REQUEST_BUDGET_MS, ATTESTER_RESPONSE_MARGIN_MS, ATTESTER_CALLER_TOTAL_TIMEOUT_MS, ATTESTER_CALLER_CONNECT_TIMEOUT_MS } from "../attestation-server.mjs";
import { startAttesterService, EXIT as A_EXIT } from "../attester-entrypoint.mjs";
import { createSigningAdapter } from "../signing-adapter.mjs";
import { parseDeploymentAnchor } from "../target-binding.mjs";
import { READER_ROLE } from "../evidence-queries.mjs";
import { makeSyntheticCluster } from "./fixtures/synthetic-cluster.mjs";
import { createAttestationSourceChannel } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { LIFECYCLE_SQL, connectionTokenFor } from "../../private-reader-production-integration-offline-01/reader-session.mjs";

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const NOW = 1750000000000; const nowP = () => NOW;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHANNEL_SECRET = "synthetic-reader-attester-channel-secret-xyz1";
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const openThings = [];
function edKeyPair() { const { publicKey, privateKey } = generateKeyPairSync("ed25519"); return { publicKeyDerB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKeyPkcs8B64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") }; }
const rn = (seed) => createHash("sha256").update(String(seed)).digest("hex").slice(0, 32);

// A controllable synthetic observer physical connection. Setup queries answer instantly unless stallSetup;
// the FIRST evidence query behaves per the flags (stall = never settle; lateMs = settle after the deadline;
// throwQuery = error). Every instance tracks whether it was invalidated (closed/destroyed).
function makeControlledPhysical(flags) {
  let dead = false; let closes = 0;
  const isSetup = (sql) => sql.includes("set_config(") || sql.includes("current_setting(");
  const phys = {
    isDead: () => dead,
    get closes() { return closes; },
    async close() { dead = true; closes++; },
    async destroy() { dead = true; closes++; },
    async query(sql, params) {
      if (dead) throw new Error("connection terminated");
      if (isSetup(sql)) {
        if (flags.stallSetup) return new Promise(() => {});
        if (sql.includes("set_config('statement_timeout'")) return { rows: [{ v: params[0] }] };
        if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ v: "1500ms" }] };
        if (sql.includes("set_config('default_transaction_read_only'")) return { rows: [{ v: "on" }] };
        return { rows: [{ v: "on" }] };
      }
      if (flags.stallQuery) return new Promise(() => {});                    // never settles (abandoned by race)
      if (flags.lateMs) return new Promise((res) => setTimeout(() => res({ rows: [{}] }), flags.lateMs)); // late
      if (flags.throwQuery) throw new Error("evidence boom");
      return { rows: [] };
    },
  };
  return phys;
}

// A healthy observer + reader token from the shared synthetic cluster (so observeReaderEvidence completes).
async function healthyProviderFor(cl, { queryDeadlineMs = 150 } = {}) {
  return async () => { const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs }); };
}
async function readerTokenFor(cl) { const rp = await cl.readerFactory.open({}); const idr = await rp.query(LIFECYCLE_SQL.readIdentity, []); const tok = connectionTokenFor({ pid: idr.rows[0].pid, backendStart: idr.rows[0].backend_start, applicationName: idr.rows[0].application_name }); return { tok, rp }; }

async function obtain(port, req) {
  const c = createAttestationSourceChannel({ host: "127.0.0.1", port, channelSecret: CHANNEL_SECRET }, { offlineTestBoundary: true, nowProvider: nowP });
  if (!c.ok) return { ok: false, code: c.reason };
  try { const env = await c.source.obtain(req); return { ok: true, envelope: env }; } catch (e) { return { ok: false, code: e.attesterCode || e.code || "error" }; }
}
const baseReq = (nonce, token) => ({ contract: "AiStagingReaderAttestationV1", connectionToken: token, role: READER_ROLE, requestNonce: nonce });

// A transit relay: accepts the caller immediately, then delays request delivery to the attester by delayMs
// (so the attester's accept — and its request context — begins LATER than the caller's total-timeout timer,
// which started at the caller's connect). It forwards the attester's response (data + FIN) back to the caller
// so the caller resolves, but it NEVER forwards the caller's own close to the attester — proving the attester
// stops on its OWN caller-safe deadline, not on observing the caller's socket close.
function delayedRelay(targetPort, delayMs) {
  return new Promise((resolve) => {
    const conns = [];
    const srv = net.createServer((inbound) => {
      conns.push(inbound);
      let pre = []; let outbound = null;
      inbound.on("data", (d) => { if (outbound && outbound.writable) { try { outbound.write(d); } catch {} } else pre.push(d); });
      inbound.on("error", () => {});
      // inbound 'end'/'close' is intentionally NOT forwarded to the attester (defence-in-depth close is suppressed).
      setTimeout(() => {
        outbound = net.createConnection({ host: "127.0.0.1", port: targetPort }, () => {
          for (const d of pre) { try { outbound.write(d); } catch {} } pre = [];
          outbound.on("data", (d) => { try { if (inbound.writable) inbound.write(d); } catch {} });    // forward the attester's response
          outbound.on("end", () => { try { inbound.end(); } catch {} });                                // propagate the attester's FIN so the caller resolves
        });
        conns.push(outbound);
        outbound.on("error", () => {});
      }, delayMs);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, close: () => new Promise((r) => { for (const c of conns) { try { c.destroy(); } catch {} } srv.close(() => r()); }) }));
  });
}

async function serverWith(provider, over = {}) {
  const cl = makeSyntheticCluster({ scenario: "base" });
  const key = edKeyPair();
  const sig = createSigningAdapter({ issuer: "owner-attester-ct", privateKeyPkcs8B64: key.privateKeyPkcs8B64, proofLifetimeMs: 120000, nowProvider: nowP });
  const anchor = parseDeploymentAnchor(cl.goodAnchorJson()).anchor;
  const server = await startAttestationServer({ channelSecret: CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port: await freePort(), allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: provider, signer: sig.signer, anchor, nowProvider: nowP, log: () => {}, offlineTestBoundary: true, ...over });
  openThings.push(server);
  return { server, cl };
}
// Build a byte-valid authenticated wire line for a raw socket (bypasses the accepted client's own nonce logic).
function wireLine(token, nonceSeed, ts = NOW) {
  const args = { contract: "AiStagingReaderAttestationV1", connectionToken: token, role: READER_ROLE, requestNonce: rn(nonceSeed) };
  const nonce = "n" + createHash("sha256").update(String(nonceSeed)).digest("hex").slice(0, 24);
  const mac = createHmac("sha256", CHANNEL_SECRET).update(["reader-attestation-channel-v1", "attest", JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex");
  return JSON.stringify({ v: "reader-attestation-channel-v1", op: "attest", args, nonce, ts, mac }) + "\n";
}
// Send one raw line and read the whole response (the attester ends the socket after responding).
function rawExchange(port, line) {
  return new Promise((res) => {
    const sk = net.createConnection({ host: "127.0.0.1", port }, () => { try { sk.write(line); } catch { res(null); } });
    let b = ""; sk.setEncoding("utf8");
    sk.on("data", (d) => { b += d; });
    sk.on("end", () => { try { res(JSON.parse(b.trim())); } catch { res(null); } });
    sk.on("error", () => res(null));
  });
}

async function run() {
  console.log("T. Resource containment (WORK v2 findings — application-visible timeout != underlying-work termination)");

  // ── A. NEVER-SETTLING PROVIDER: observe() must not hang; the open is bounded and capacity is not stuck ──
  {
    const coord = createObserverCoordinator({ provider: () => new Promise(() => {}), nowProvider: nowP, openDeadlineMs: 200, observationDeadlineMs: 300, cleanupDeadlineMs: 150 });
    const t0 = Date.now(); const r = await coord.observe("a".repeat(64)); const dt = Date.now() - t0;
    ok("T-A. a never-settling observer provider is bounded (observe resolves, not hangs)", dt < 1500 && r.ok === false && r.reason === "observer_open_deadline");
    const r2 = await coord.observe("a".repeat(64));
    ok("T-A. capacity is reusable after a bounded open failure (no stuck slot)", r2.ok === false && coord.stats().activeEvidence === 0 && coord.stats().queuedEvidence === 0);
  }

  // ── B. NEVER-SETTLING PHYSICAL QUERY: the physical connection is INVALIDATED and never reused ──
  {
    const physicals = [];
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); physicals.push(p); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 120 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 1000, observationDeadlineMs: 400, cleanupDeadlineMs: 200 });
    const t0 = Date.now(); const r = await coord.observe("b".repeat(64)); const dt = Date.now() - t0;
    ok("T-B. a never-settling physical query is contained (observe resolves within its deadline)", dt < 1200 && r.ok === false);
    ok("T-B. the stalled physical connection is INVALIDATED (destroyed), not left usable", physicals.length === 1 && physicals[0].isDead() === true && physicals[0].closes >= 1);
    // a fresh observe opens a NEW physical — the invalidated one is never reused
    const before = physicals.length; await coord.observe("b".repeat(64));
    ok("T-B. the invalidated connection is NOT reused (a fresh physical is opened)", physicals.length === before + 1 && physicals[0] !== physicals[physicals.length - 1]);
    ok("T-B. after containment no slot leaks (active/terminating settle to 0)", coord.stats().activeEvidence === 0 && coord.stats().terminating === 0);
  }

  // ── C. REPEATED POST-TIMEOUT WAVES: unresolved underlying work does NOT accumulate (no 4 -> 8 -> 12) ──
  {
    const physicals = [];
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); physicals.push(p); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 100 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 1000, observationDeadlineMs: 300, cleanupDeadlineMs: 150 });
    let peakAlive = 0; let peakActive = 0;
    const sampler = setInterval(() => { const alive = physicals.filter((p) => p.closes === 0).length; peakAlive = Math.max(peakAlive, alive); peakActive = Math.max(peakActive, coord.stats().activeEvidence); }, 15);
    for (let wave = 0; wave < 3; wave++) { await Promise.all([0, 1, 2, 3].map(() => coord.observe("c".repeat(64)))); }
    clearInterval(sampler);
    const aliveNow = physicals.filter((p) => p.closes === 0).length;
    ok("T-C. concurrently-alive stalled connections stay bounded across repeated waves (never 4 -> 8 -> 12)", peakAlive <= OBSERVER_MAX_ACTIVE + 1 && peakActive <= OBSERVER_MAX_ACTIVE);
    ok("T-C. every stalled connection was terminated (no orphaned underlying work remains)", aliveNow === 0 && coord.stats().terminating === 0 && coord.stats().activeEvidence === 0);
  }

  // ── D. CLIENT-SIDE QUEUE BOUND: work queued behind one blocked open cannot grow without bound ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    let held = 0, peak = 0, release; const gate = new Promise((r) => { release = r; });
    const provider = async () => { held++; peak = Math.max(peak, held); await gate; held--; const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP });
    const { tok, rp } = await readerTokenFor(cl);
    const runs = []; for (let i = 0; i < OBSERVER_MAX_ACTIVE + OBSERVER_MAX_QUEUED; i++) runs.push(coord.observe(tok));
    await sleep(80);
    const over = await coord.observe(tok);                     // one beyond active+queue
    ok("T-D. the coordinator queue is bounded (one beyond active+queue is fail-busy, not enqueued)", over.ok === false && over.reason === "observer_busy");
    ok("T-D. only ONE evidence collection is active at a time (serialized behind one physical connection)", peak === OBSERVER_MAX_ACTIVE && coord.stats().activeEvidence <= OBSERVER_MAX_ACTIVE && coord.stats().queuedEvidence <= OBSERVER_MAX_QUEUED);
    release();
    const done = await Promise.all(runs);
    ok("T-D. all admitted requests complete once the block clears (serialized, none dropped)", done.every((r) => r.ok === true));
    await rp.close();
  }

  // ── E. SETUP OPERATION STALL: a never-settling session setup must not hang startup/recovery ──
  {
    const physicals = [];
    const provider = async () => { const p = makeControlledPhysical({ stallSetup: true }); physicals.push(p); const es = await establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 120 }); if (!es.ok) { try { await p.close(); } catch {} } return es; };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 1000, observationDeadlineMs: 300, cleanupDeadlineMs: 150 });
    const t0 = Date.now(); const r = await coord.observe("e".repeat(64)); const dt = Date.now() - t0;
    ok("T-E. a stalled session setup is bounded (establish fails, observe resolves, no hang)", dt < 1200 && r.ok === false && r.reason === "observer_session_setup_failed");
    ok("T-E. the physical connection from a failed setup is closed (not leaked)", physicals[0].isDead() === true);
  }

  // ── F. STALE RESULT: a late completion from a timed-out/invalidated connection is never accepted/signed ──
  {
    const provider = async () => { const p = makeControlledPhysical({ lateMs: 500 }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 100 }); };
    const { server } = await serverWith(provider);
    const r = await obtain(server.address.port, baseReq(rn("stale-f"), "f".repeat(64)));
    ok("T-F. a late (post-deadline) evidence result yields a fixed failure, never a signed envelope", r.ok === false && r.code === "unavailable");
    await sleep(600);                                          // allow the late result to arrive AFTER the response
    ok("T-F. no signature was ever produced from the stale result", server.stats().signed === 0);
    await server.close();
  }

  // ── G. CONNECTION RECOVERY: after invalidation, a fresh connection is re-validated before evidence resumes ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    let call = 0;
    const provider = async () => { call++; if (call === 1) { const p = makeControlledPhysical({ stallQuery: true }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 100 }); } const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 1000, observationDeadlineMs: 400, cleanupDeadlineMs: 150 });
    const { tok, rp } = await readerTokenFor(cl);
    const r1 = await coord.observe(tok);
    ok("T-G. first observation on a stalled connection is contained (unavailable)", r1.ok === false);
    const r2 = await coord.observe(tok);
    ok("T-G. a fresh, re-validated connection resumes evidence and yields a real observation", r2.ok === true && r2.evidence && r2.evidence.privileges.currentUser === READER_ROLE && coord.stats().providerCalls >= 2);
    await rp.close();
  }

  // ── H. RECOVERY FAILURE: bounded retries then fail closed via the lifecycle contract (exit 73) ──
  {
    ok("T-H. observer-lost exit code is the accepted 73", A_EXIT.observer_lost === 73);
    let allowOpen = true; let firstPhys = null;
    const factory = { async open() { if (!allowOpen) throw new Error("open refused"); const p = makeControlledPhysical({}); if (!firstPhys) firstPhys = p; return p; } };
    const goodAnchor = makeSyntheticCluster().goodAnchorJson();
    const key = edKeyPair();
    const env = { LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL: "postgres://obs:pw@127.0.0.1:9/railway", LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64: key.privateKeyPkcs8B64, LIVE_AI_03B_ATTESTER_ISSUER: "TEST-ONLY-recovery", LIVE_AI_03B_ATTESTER_BIND_HOST: "0.0.0.0", LIVE_AI_03B_ATTESTER_ALLOW_WILDCARD_BIND: "true", LIVE_AI_03B_ATTESTER_PORT: String(await freePort()), LIVE_AI_03B_ATTESTER_ALLOWED_PEER_CIDRS: "10.20.0.0/16", LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET: CHANNEL_SECRET, LIVE_AI_03B_ATTESTER_DEPLOYMENT_ANCHOR: goodAnchor };
    let fatal = false;
    const ctrl = await startAttesterService({ mode: "offline-test", offlineTestBoundary: true, env, observerFactory: factory, nowProvider: nowP, watchMs: 60, log: () => {}, onFatal: () => { fatal = true; } });
    ok("T-H. service starts serving on the first (healthy) observer", ctrl.started === true && ctrl.ready() === true);
    allowOpen = false;                                         // no further connection can be opened
    await firstPhys.close();                                   // the live observer drops
    const t0 = Date.now(); while (!fatal && Date.now() - t0 < 3000) await sleep(30);
    ok("T-H. when recovery cannot re-establish the observer, the service fails closed (onFatal → exit 73)", fatal === true);
    if (ctrl.started) await ctrl.stop();
  }

  // ── I. SHUTDOWN DURING STALLED WORK: bounded, contained, no leftover ──
  {
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 700 }); };
    const { server } = await serverWith(provider);
    const pending = obtain(server.address.port, baseReq(rn("shut-i"), "9".repeat(64)));  // will stall inside the observer
    await sleep(120);                                          // shutdown WHILE the observation is in flight
    const t0 = Date.now(); await server.close(); const dt = Date.now() - t0;
    ok("T-I. shutdown during stalled observer work completes within the bounded deadline", dt < ATTESTER_SHUTDOWN_DEADLINE_MS + 1500);
    const pr = await pending;
    ok("T-I. the in-flight request never yields a signature during shutdown", pr.ok === false && server.stats().signed === 0);
  }

  console.log("U. Request-lifecycle cancellation matrix (WORK v3 — request authority == computation lifetime)");

  // ── caller-4s compatibility invariant (load-time) ──
  ok("U. attester budget + response margin + connect allowance <= accepted caller 4000 ms total (accounts for the different timer origins; work ends before the caller lifetime)",
    ATTESTER_CALLER_TOTAL_TIMEOUT_MS === 4000 && ATTESTER_CALLER_CONNECT_TIMEOUT_MS === 1500 && ATTESTER_REQUEST_BUDGET_MS > 0 &&
    ATTESTER_REQUEST_BUDGET_MS + ATTESTER_RESPONSE_MARGIN_MS + ATTESTER_CALLER_CONNECT_TIMEOUT_MS <= ATTESTER_CALLER_TOTAL_TIMEOUT_MS);

  // ── U-C. expired BEFORE enqueue → never acquires / never opens ──
  {
    let providerCalls = 0;
    const provider = async () => { providerCalls++; const cl = makeSyntheticCluster(); const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP });
    const dead = makeRequestContext(-10);   // already past its deadline
    const r = await coord.observe("a".repeat(64), { context: dead });
    ok("U-C. an already-expired request is rejected before enqueue (no provider open, no evidence)", r.ok === false && r.reason === "request_expired" && providerCalls === 0 && coord.stats().activeEvidence === 0);
  }

  // ── Probe C. expiry WHILE QUEUED → observer/evidence never starts for it ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    let providerCalls = 0, release; const gate = new Promise((r) => { release = r; });
    const provider = async () => { providerCalls++; await gate; const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP });
    const { tok, rp } = await readerTokenFor(cl);
    const first = coord.observe(tok);                                   // acquires the slot, blocks in provider on the gate
    await sleep(30);
    const queued = coord.observe(tok, { context: makeRequestContext(60) }); // queues, then its 60 ms budget expires
    await sleep(140);
    release();
    const [r1, r2] = await Promise.all([first, queued]);
    ok("Probe-C. a request that expires while queued NEVER opens an observer or runs evidence (request_expired)", r2.ok === false && r2.reason === "request_expired" && providerCalls === 1 && r1.ok === true);
    await rp.close();
  }

  // ── U-D. active cancellation → observation aborted, observer invalidated, nothing signed ──
  {
    const physicals = [];
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); physicals.push(p); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 5000 }); };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, observationDeadlineMs: 5000, openDeadlineMs: 1000 });
    const ctx = makeRequestContext(5000);
    const p = coord.observe("d".repeat(64), { context: ctx });
    await sleep(80);
    ctx.cancel("test_cancel");                                          // authority revoked mid-observation
    const r = await p;
    ok("U-D. cancelling authority during active evidence aborts it and invalidates the observer (no result)", r.ok === false && r.reason === "request_cancelled" && physicals[0].isDead() === true && coord.stats().activeEvidence === 0);
  }

  // ── Probe E. LATE provider success after abandonment → the connection is destroyed, never admitted ──
  {
    let lateObserverClosed = 0; let lateSettled = false;
    const cl = makeSyntheticCluster({ scenario: "base" });
    const provider = () => new Promise((res) => setTimeout(async () => {
      const p = await cl.observerFactory.open();
      const es = await establishObserverSession(p, { statementTimeoutMs: 1500 });
      const wrapped = { ...es, observer: Object.freeze({ ...es.observer, close: async () => { lateObserverClosed++; await es.observer.close(); } }) };
      lateSettled = true; res(wrapped);
    }, 300));
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 120 });
    const { tok, rp } = await readerTokenFor(cl);
    const r1 = await coord.observe(tok);                                // open abandoned at 120 ms
    ok("Probe-E. an open abandoned by its deadline yields a fixed failure", r1.ok === false && r1.reason === "observer_open_deadline");
    // while the abandoned open is still outstanding, a second request does NOT start another open
    const r2 = await coord.observe(tok);
    ok("Probe-E. at most ONE outstanding open (a second is refused, not started)", r2.ok === false && coord.stats().providerCalls === 1);
    await sleep(400);                                                   // allow the late provider to settle
    ok("Probe-E. the late-returned connection is destroyed and never becomes the current observer", lateSettled === true && lateObserverClosed >= 1 && coord.stats().pendingOpen === false);
    await rp.close();
  }

  // ── Probe D. NEVER-SETTLING provider → outstanding opens bounded (providerCalls does not grow) ──
  {
    const coord = createObserverCoordinator({ provider: () => new Promise(() => {}), nowProvider: nowP, openDeadlineMs: 80 });
    for (let i = 0; i < 5; i++) await coord.observe("d".repeat(64));
    ok("Probe-D. repeated requests against a never-settling provider do NOT accumulate opens (bounded to one)", coord.stats().providerCalls === 1 && coord.stats().pendingOpen === true);
  }

  // ── Probe G / A / B. a request that crosses the internal deadline NEVER later signs; signed stays frozen ──
  {
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 5000 }); };
    const { server } = await serverWith(provider, { requestBudgetMs: 350 });
    const signedBefore = server.stats().signed;
    const r = await obtain(server.address.port, baseReq(rn("freeze"), "a".repeat(64)));
    ok("Probe-G. a request whose evidence crosses the internal deadline gets a fixed failure (no proof)", r.ok === false && r.code === "unavailable");
    await sleep(800);                                                   // well beyond any late completion
    ok("Probe-G. the signed counter is FROZEN — handle() continuing after expiry never increments it", server.stats().signed === signedBefore && server.stats().signed === 0);
    const st = server.stats();
    ok("Probe-G. the request is accounted as a non-signing outcome (refused/deadlined/cancelled), never signed", (st.refused + st.deadlined + st.cancelled) >= 1 && st.signed === 0);
    await server.close();
  }

  // ── Probe F. the accepted 4-second caller: a stalled attester answers a fixed failure well before 4000 ms; no signature ──
  {
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 5000 }); };
    const { server } = await serverWith(provider, { requestBudgetMs: 500 });
    const t0 = Date.now();
    const r = await obtain(server.address.port, baseReq(rn("caller4s"), "a".repeat(64)));
    const dt = Date.now() - t0;
    ok("Probe-F. against the accepted caller, a stalled attester responds a fixed failure well before the 4000 ms caller cap", r.ok === false && dt < ATTESTER_CALLER_TOTAL_TIMEOUT_MS);
    await sleep(700);
    ok("Probe-F. no signature is ever produced for that request", server.stats().signed === 0);
    await server.close();
  }

  // ── U-E. CALLER DISCONNECT before the response → request cancelled, nothing signed ──
  {
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 5000 }); };
    const { server } = await serverWith(provider, { requestBudgetMs: 3000 });
    const port = server.address.port;
    const cancelledBefore = server.stats().cancelled;
    await new Promise((res) => {
      const sk = net.createConnection({ host: "127.0.0.1", port }, () => { sk.write(wireLine("a".repeat(64), "disc")); setTimeout(() => { sk.destroy(); res(); }, 150); });
      sk.on("error", () => res());
    });
    await sleep(500);
    ok("U-E. a caller that disconnects before the response cancels the request (accounted as cancelled)", server.stats().cancelled > cancelledBefore);
    ok("U-E. a caller-abandoned request never produces a signature", server.stats().signed === 0);
    await server.close();
  }

  // ── J/K control. a NORMAL live request still signs (the lifecycle gate does not break the happy path) ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    const key = edKeyPair();
    const sig = createSigningAdapter({ issuer: "owner-attester-ok", privateKeyPkcs8B64: key.privateKeyPkcs8B64, proofLifetimeMs: 120000, nowProvider: nowP });
    const anchor = parseDeploymentAnchor(cl.goodAnchorJson()).anchor;
    const provider = async () => { const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const server = await startAttestationServer({ channelSecret: CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port: await freePort(), allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: provider, signer: sig.signer, anchor, nowProvider: nowP, log: () => {}, offlineTestBoundary: true });
    openThings.push(server);
    const { tok, rp } = await readerTokenFor(cl);
    const r = await obtain(server.address.port, baseReq(rn("happy"), tok));
    ok("U/J-K. a normal live request still produces a signed envelope (happy path intact)", r.ok === true && r.envelope && server.stats().signed === 1);
    await server.close(); await rp.close();
  }

  console.log("V. Caller-timeline + observer-open cancellation (WORK final findings — different timer origins; cancel during open)");

  // ── V-A / V-B. TIMER-ORIGIN MISMATCH: the caller's total timer starts at connect; a transit delay makes the
  // attester's context start later. The attester must lose authority before the caller can expire, WITHOUT
  // relying on socket-close propagation. Under the old (accept-relative, connect-unaware) budget this signed
  // after the caller expired; under the caller-safe budget it never does. ──
  {
    const provider = async () => { const p = makeControlledPhysical({ stallQuery: true }); return establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 5000 }); };
    const { server } = await serverWith(provider);                    // production caller-safe budget (1900 ms from accept)
    const D = 1200;                                                   // transit delay (within the caller's connect phase)
    const relay = await delayedRelay(server.address.port, D);
    const signedBefore = server.stats().signed;
    const t0 = Date.now();
    const r = await obtain(relay.port, baseReq(rn("relay"), "a".repeat(64)));  // the accepted caller connects to the relay
    const dt = Date.now() - t0;
    ok("V-A. with a transit delay before accept, the accepted caller gets a fixed failure (no signature)", r.ok === false);
    ok("V-B. the attester's own caller-safe deadline stopped it before the 4000 ms caller cap (not dependent on close propagation)", dt < ATTESTER_CALLER_TOTAL_TIMEOUT_MS);
    await sleep(1500);                                                // past caller expiry (4000) and any late attester completion
    ok("V-A. signed stays FROZEN at 0 — a caller whose timer started before the attester's context can never yield a signature", server.stats().signed === signedBefore && server.stats().signed === 0);
    await relay.close(); await server.close();
  }

  // ── V-C / V-D. CANCEL DURING OBSERVER OPEN: cancellation while provider() is unresolved abandons the open;
  // the late-returned connection is destroyed and never admitted as current; the next request opens fresh. ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    const { tok, rp } = await readerTokenFor(cl);
    const physicals = [];
    let call = 0;
    const provider = () => {
      call++;
      if (call === 1) return new Promise((res) => setTimeout(async () => { const p = makeControlledPhysical({}); physicals.push(p); res(await establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 1500 })); }, 150));
      return (async () => { const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); })();
    };
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 2000, observationDeadlineMs: 2000 });
    const ctx = makeRequestContext(5000);
    const pr = coord.observe(tok, { context: ctx });
    await sleep(30); ctx.cancel("mid_open");                          // cancel ~30 ms into an open that resolves at ~150 ms
    const r = await pr;
    ok("V-C. cancellation during observer open -> request_cancelled (no evidence)", r.ok === false && r.reason === "request_cancelled");
    await sleep(300);                                                 // allow the late provider to settle + disposal
    ok("V-C. the connection opened under the cancelled request is DESTROYED and never admitted as current", physicals.length === 1 && physicals[0].isDead() === true && physicals[0].closes >= 1 && coord.stats().pendingOpen === false);
    const r2 = await coord.observe(tok, { context: makeRequestContext(5000) });
    ok("V-D. the next request opens a FRESH validated observer (fresh provider call), not the abandoned one", r2.ok === true && r2.evidence && coord.stats().providerCalls === 2);
    await rp.close();
  }

  // ── V-E. CALLER EXPIRY (time) DURING OPEN: same containment via the caller-safe deadline, no explicit cancel. ──
  {
    const physicals = [];
    const provider = () => new Promise((res) => setTimeout(async () => { const p = makeControlledPhysical({}); physicals.push(p); res(await establishObserverSession(p, { statementTimeoutMs: 1500, queryDeadlineMs: 1500 })); }, 300));
    const coord = createObserverCoordinator({ provider, nowProvider: nowP, openDeadlineMs: 2000, observationDeadlineMs: 2000 });
    const r = await coord.observe("e".repeat(64), { context: makeRequestContext(120) });  // 120 ms budget < 300 ms open
    ok("V-E. caller-safe expiry during open -> fixed failure (no evidence, no crash)", r.ok === false && (r.reason === "observer_open_deadline" || r.reason === "request_expired"));
    await sleep(400);
    ok("V-E. the late-returned connection is disposed and never becomes current", physicals.length === 1 && physicals[0].isDead() === true && coord.stats().pendingOpen === false);
  }

  // ── V-F. CALLER-TIMELINE via the authenticated ts (closes the accept-backlog gap the accept-anchored budget
  // alone missed): a request whose authenticated ts shows the caller has already been alive past its safe
  // window is refused with NO observer work and NO signature, EVEN with a prompt accept. The tightening only
  // shortens — a fresh-ts request from the same caller still signs. ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    const { tok, rp } = await readerTokenFor(cl);
    const provider = async () => { const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const { server } = await serverWith(provider);
    const signedBefore = server.stats().signed;
    // ts 3500 ms in the past (within the ±30 s freshness window) -> callerRemaining = 4000 - 3500 - 600 = -100 ms
    const r = await rawExchange(server.address.port, wireLine(tok, "oldts", NOW - 3500));
    ok("V-F. a request whose authenticated ts shows the caller is past its safe window is refused, even with a prompt accept", r && r.ok === false && r.code === "unavailable");
    ok("V-F. no signature is minted for a caller already past its own timeline", server.stats().signed === signedBefore);
    const r2 = await obtain(server.address.port, baseReq(rn("freshts"), tok));   // same caller, current ts
    ok("V-F. a fresh-ts request from the same caller still signs (tightening only shortens, never blocks a live caller)", r2.ok === true && server.stats().signed === signedBefore + 1);
    await server.close(); await rp.close();
  }

  // ── V-G. DELIVERY-BOUNDARY guard: a caller whose socket is gone before the attester signs mints no proof.
  // (Supplementary defence-in-depth on top of the caller-safe deadline: caught synchronously via peerAlive and,
  // for the macrotask path, via the 'close' → ctx.cancel handler.) ──
  {
    const cl = makeSyntheticCluster({ scenario: "base" });
    const { tok, rp } = await readerTokenFor(cl);
    let release; const gate = new Promise((r) => { release = r; });
    const provider = async () => { await gate; const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
    const { server } = await serverWith(provider, { requestBudgetMs: 6000 });
    const signedBefore = server.stats().signed;
    const sk = net.createConnection({ host: "127.0.0.1", port: server.address.port }, () => { try { sk.write(wireLine(tok, "sockguard")); } catch {} });
    sk.on("error", () => {});
    await sleep(120);   // the attester is now blocked in provider() (observer not yet opened)
    sk.destroy();       // caller abandons before any response
    await sleep(80);    // let the server observe the close
    release();          // attester proceeds; the request is no longer authorised
    await sleep(250);
    ok("V-G. a caller whose socket is gone before signing mints no proof (delivery-boundary defence-in-depth)", server.stats().signed === signedBefore);
    await server.close(); await rp.close();
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed, 0 skipped  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE RESOURCE-CONTAINMENT VERIFICATION: PASS");
  console.log("SCOPE: synthetic controllable physical connections + shared synthetic cluster + real loopback sockets. NOT live AI-STAGING, NOT a real pg driver.");
  process.exitCode = 0;
}

run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; }).finally(async () => { for (const s of openThings) { try { await s.close(); } catch {} } });
