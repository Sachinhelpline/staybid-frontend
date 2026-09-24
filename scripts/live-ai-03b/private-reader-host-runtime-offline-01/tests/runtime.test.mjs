// OFFLINE serving-runtime tests. Synthetic inputs only. Connects to NOTHING external (no Railway /
// Postgres / Supabase / CORE-PROD / provider / internet). Uses REAL local sockets for genuine transport
// integration: a Unix-domain socket, loopback TCP, and (section F) a private-network-mode TCP listener on
// this machine's own non-loopback interface reached by an INDEPENDENT child process. Node built-ins only.
// A local cross-process test proves protocol reachability + enforcement only — NOT Railway isolation.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import os from "node:os";
import process from "node:process";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { startServingRuntime, RUNTIME_STATUS, FAIL_EXIT_CODE, DEGRADED_EXIT_CODE } from "../private-reader-host-runtime.mjs";
import { RUNTIME_CONFIG_CONTRACT, targetSelfCheck, resolveListenConfigFromEnv, ENV_LISTEN_MODE, ENV_BIND_HOST, ENV_PORT, ENV_ALLOWED_PEER_CIDRS, ENV_ALLOW_WILDCARD_BIND } from "../runtime-config.mjs";
import { validateReaderOnlyAuthority, makeReaderOnlyHost, REQUIRED_READER_FIELDS, READER_PRIVILEGE_PROOF_CONTRACT, READER_ONLY_AUTHORITY_VERSION, READER_STATEMENT_TIMEOUT_MAX_MS } from "../reader-only-authority.mjs";
import { startObservationServer, createObservationClient, validateListenConfig, APPROVED_OPS, MAX_REQUEST_BYTES, OBSERVATION_DEADLINE_MS, REQUEST_TIMEOUT_MS, QUARANTINE_MAX_MS, MAX_CONCURRENT } from "../observation-transport.mjs";
import { assertOutwardMessage } from "../../private-reader-host-offline-01/private-reader-host.mjs";
import { buildReviewedStateQueries, DORMANT_POLICY_CONTROL_QUERY, ARMED_POLICY_CONTROL_QUERY, CEILINGS_QUERY, ZERO_EXPOSURE_COUNTS_QUERY } from "../../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY, CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY } from "../../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skip = 0; const fails = []; const skips = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const NOW = 1750000000000;
const SENTINEL = "postgres://sentinel_user:sentinel_pw@db.internal:5432/live";
const SECRET = "synthetic-transport-secret-0123456789"; // synthetic (>=16); NOT a DB credential
const leaked = (m) => { const s = JSON.stringify(m === undefined ? null : m); return s.includes("sentinel") || s.includes("postgres://") || s.includes("sentinel_pw"); };
const sock = (tag) => join(os.tmpdir(), `lai-rt-${process.pid}-${tag}.sock`);
const openServers = [];

function makeFakeReader(extra = {}) {
  const rowFor = (q) => (
    q === CATALOG_ACTIVE_COUNT_QUERY ? { n: 1 } :
    q === CATALOG_INACTIVE_VERSION_QUERY ? { n: 1, digest: "inactive-digest" } :
    q === CATALOG_INACTIVE_ENTRY_COUNT_QUERY ? { n: 2 } :
    q === CATALOG_ACTIVE_DIGEST_QUERY ? { catalog_digest: "active-digest" } :
    q === DORMANT_POLICY_CONTROL_QUERY ? { active_policy_count: 0, dormant_policy_present: true, global_control_epoch: 1, project_control_epoch: 1, global_control_enabled: false, project_control_enabled: false, global_control_killed: false, project_control_killed: false } :
    q === ARMED_POLICY_CONTROL_QUERY ? { one_call_policy_digest: FIXED.one_call_policy_digest, control_global_digest: "g", control_project_digest: "p", global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true, global_control_killed: false, project_control_killed: false } :
    q === CEILINGS_QUERY ? { session_money_ceiling_micros: 89536, session_provider_calls: 1, session_execution_admissions: 1, subject_day_money_ceiling_micros: 89536, project_day_money_ceiling_micros: 89536, project_month_money_ceiling_micros: 89536, global_day_money_ceiling_micros: 89536 } :
    q === ZERO_EXPOSURE_COUNTS_QUERY ? { envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 } : null);
  return Object.assign({ query: async (q) => ({ rows: rowFor(q) ? [rowFor(q)] : [] }), statementTimeoutMs: 1500 }, extra);
}
function readerAuthority(over = {}) {
  const a = {
    cfg: { ok: true, reviewer: { pinnedFingerprint: "FP" }, targets: { pgServiceId: FIXED.ai_staging_postgres } },
    trustRoot: { pinnedPublicKeyDerB64: "KEY", pinnedFingerprint: "FP" },
    readerDbClient: makeFakeReader(),
    connectionIdentityProof: { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance, issuer: "ISSUER", boundConnectionToken: "CTOK", serviceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment },
    expectedIssuer: "ISSUER", connectionToken: "CTOK",
    readerPrivilegeProof: { provenance: READER_PRIVILEGE_PROOF_CONTRACT.test_provenance, role: "live_ai_03b_reader", pgServiceId: FIXED.ai_staging_postgres, effectiveSelectOnly: true, writePrivilegeCount: 0, selectGrantCount: 12, forbiddenObjectAccessible: false, unapprovedRoleMembership: false, unapprovedRoutineAuthority: false, boundReaderToken: "CTOK", issuedAtMs: NOW },
    reviewedStateQueries: buildReviewedStateQueries(),
    sourcePin: { commit: FIXED.source_commit }, nowProvider: () => NOW,
  };
  return Object.assign(a, over);
}
const T = { testBoundary: true };

async function run() {
  console.log("A. Source + authority separation (accepted baseline unchanged; no executor)");
  const acc = resolve(HERE, "..", "..", "private-reader-host-offline-01");
  const H = (p) => createHash("sha256").update(readFileSync(join(acc, p))).digest("hex");
  ok("accepted private-reader-host.mjs unchanged", H("private-reader-host.mjs") === "3f25bcd3975318cca5c6619beb016e6159ba06c263eb32f11d8873e650723525");
  ok("accepted ACCESS-CONTROL-SPEC.md unchanged", H("ACCESS-CONTROL-SPEC.md") === "c9b7aabc55258690f2f2daf20c0a126497a3ef7b859996f91b70673961953748");
  ok("accepted tests unchanged", H("tests/private-reader-host.test.mjs") === "ddda185096ce08696cf90bb6fc4c83c88b3fabd0d53ceedad722c472c4ed9d44");
  ok("accepted README unchanged", H("README.md") === "86c0a08b5441b7ed47c0f1e8bd55a79c3b4e49c7abe274468156a1e0b8493e86");
  ok("accepted manifest unchanged", H("EVIDENCE-MANIFEST.json") === "11ef6eee49409941fc28c55ce34fbf475647886cfd476b83cb4e2accd7da0220");
  ok("reader-only interface requires NO executorDbClient", !REQUIRED_READER_FIELDS.includes("executorDbClient"));
  ok("validate rejects an executor client", validateReaderOnlyAuthority(readerAuthority({ executorDbClient: { query: async () => ({}) } }), T).reason === "reader_only_rejects_executor_client");
  ok("validate rejects an executor privilege proof", validateReaderOnlyAuthority(readerAuthority({ privilegeProof: { restricted_role_proof_present: true } }), T).reason === "reader_only_rejects_executor_privilege_proof");
  const authoritySrc = readFileSync(resolve(HERE, "..", "reader-only-authority.mjs"), "utf8") + readFileSync(resolve(HERE, "..", "private-reader-host-runtime.mjs"), "utf8");
  ok("runtime/authority source never constructs an executor client", !/executorDbClient\s*:/.test(authoritySrc));

  console.log("B. Reader-only authority validation matrix");
  ok("valid synthetic reader authority (test path) accepts", validateReaderOnlyAuthority(readerAuthority(), T).ok === true);
  ok("synthetic authority NOT accepted in production mode", validateReaderOnlyAuthority(readerAuthority(), { testBoundary: false }).ok === false);
  ok("missing reader privilege proof fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: undefined }), T).reason === "authority_missing_field:readerPrivilegeProof");
  ok("caller-asserted (untrusted) privilege proof fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, provenance: "i-say-so" } }), T).reason === "reader_privilege_proof_untrusted");
  ok("wrong reader role fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, role: "postgres" } }), T).reason === "reader_privilege_proof_wrong_role");
  ok("effective write privilege fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, writePrivilegeCount: 1 } }), T).reason === "reader_privilege_proof_has_write");
  ok("not-select-only fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, effectiveSelectOnly: false } }), T).reason === "reader_privilege_proof_not_select_only");
  ok("forbidden object accessible fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, forbiddenObjectAccessible: true } }), T).reason === "reader_privilege_proof_forbidden_object");
  ok("unapproved role membership fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, unapprovedRoleMembership: true } }), T).reason === "reader_privilege_proof_extra_authority");
  ok("wrong grant count fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, selectGrantCount: 13 } }), T).reason === "reader_privilege_proof_grant_count");
  ok("stale proof fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, issuedAtMs: NOW - 400000 } }), T).reason === "reader_privilege_proof_stale");
  ok("future-dated proof fails", validateReaderOnlyAuthority(readerAuthority({ readerPrivilegeProof: { ...readerAuthority().readerPrivilegeProof, issuedAtMs: NOW + 60000 } }), T).reason === "reader_privilege_proof_future_dated");
  ok("CORE-PROD target fails", validateReaderOnlyAuthority(readerAuthority({ cfg: { ok: true, reviewer: { pinnedFingerprint: "FP" }, targets: { pgServiceId: FIXED.core_excluded_postgres } } }), T).reason !== undefined && validateReaderOnlyAuthority(readerAuthority({ cfg: { ok: true, reviewer: { pinnedFingerprint: "FP" }, targets: { pgServiceId: FIXED.core_excluded_postgres } } }), T).ok === false);

  console.log("C. Authenticated loopback transport (real Unix socket integration)");
  const host = makeReaderOnlyHost(readerAuthority(), T);
  ok("reader-only host builds (synthetic)", host.available === true && host.version === READER_ONLY_AUTHORITY_VERSION);
  const sp = sock("txn");
  const server = await startObservationServer({ socketPath: sp, host, secret: SECRET, nowProvider: () => NOW, log: () => {} });
  openServers.push(server);
  ok("server bound to a Unix socket path (not a TCP port)", typeof server.address === "string" && server.address.endsWith(".sock") && server.unixSocket === true);
  const client = createObservationClient({ socketPath: sp, secret: SECRET, nowProvider: () => NOW });
  const good = await client.observe("dormant");
  ok("authenticated observe -> ok + guarded message", good.ok === true && good.message.ok === true && assertOutwardMessage(good.message).ok === true && good.message.observation.counts.sessions === 0);
  ok("transport response leaks no secret/url", !leaked(good));
  const badMac = await client.observe("dormant", { badMac: true });
  ok("forged MAC -> unauthenticated", badMac.ok === false && badMac.code === "unauthenticated");
  const noMac = await client.observe("dormant", { raw: JSON.stringify({ v: "reader-obs-transport-v1", op: "observe", args: { observation: "dormant" }, nonce: "abcdefgh12", ts: NOW }) + "\n" });
  ok("missing MAC -> unauthenticated", noMac.ok === false && noMac.code === "unauthenticated");
  const stale = await client.observe("dormant", { ts: NOW - 60000 });
  ok("stale ts -> stale", stale.ok === false && stale.code === "stale");
  const fixedNonce = "replaynonce123456";
  const r1 = await client.observe("dormant", { nonce: fixedNonce });
  const r2 = await client.observe("dormant", { nonce: fixedNonce });
  ok("replayed nonce -> first ok, second replayed", r1.ok === true && r2.ok === false && r2.code === "replayed");
  const unkOp = await client.request("query", { observation: "dormant" });
  ok("unknown op -> unknown_op", unkOp.ok === false && unkOp.code === "unknown_op");
  const badArgs = await client.request("observe", { observation: "dormant", sql: "DROP TABLE x" });
  ok("extra/arbitrary arg (SQL) -> bad_args (no echo)", badArgs.ok === false && badArgs.code === "bad_args" && !JSON.stringify(badArgs).includes("DROP"));
  const unkObs = await client.observe("'; DROP");
  ok("unknown observation -> host unknown_observation (typed, no SQL executed)", unkObs.ok === true && unkObs.message.ok === false && unkObs.message.code === "unknown_observation");
  const tooBig = await client.observe("dormant", { raw: JSON.stringify({ v: "reader-obs-transport-v1", op: "observe", args: { observation: "dormant" }, nonce: "n".repeat(20), ts: NOW, pad: "x".repeat(5000) }) + "\n" });
  ok("oversized request -> request_too_large", tooBig.ok === false && tooBig.code === "request_too_large");
  ok("transport declares only the approved 'observe' op + a request size bound", APPROVED_OPS.length === 1 && APPROVED_OPS[0] === "observe" && MAX_REQUEST_BYTES <= 8192);
  await server.close(); openServers.pop();
  let afterClose = "connected"; try { await client.observe("dormant"); } catch { afterClose = "refused"; }
  ok("no listener remains after close (client refused)", afterClose === "refused");
  // same authenticated protocol over loopback-only TCP (compatibility with a future private-network bind)
  const tcpServer = await startObservationServer({ tcp: { host: "127.0.0.1", port: 0 }, host, secret: SECRET, nowProvider: () => NOW, log: () => {} });
  openServers.push(tcpServer);
  ok("loopback TCP server bound to 127.0.0.1 (ephemeral port)", tcpServer.unixSocket === false && tcpServer.address.host === "127.0.0.1" && tcpServer.address.port > 0);
  const tcpClient = createObservationClient({ tcp: { host: "127.0.0.1", port: tcpServer.address.port }, secret: SECRET, nowProvider: () => NOW });
  const tcpGood = await tcpClient.observe("ceilings");
  ok("loopback TCP authenticated observe -> ok", tcpGood.ok === true && tcpGood.message.ok === true && tcpGood.message.observation.oneCallPolicy.session_money_ceiling_micros === 89536);
  ok("loopback TCP forged MAC -> unauthenticated", (await tcpClient.observe("dormant", { badMac: true })).code === "unauthenticated");
  await tcpServer.close(); openServers.pop();
  let refusedWild = false; try { await startObservationServer({ tcp: { host: "0.0.0.0", port: 0 }, host, secret: SECRET, log: () => {} }); } catch (e) { refusedWild = e && e.message === "transport_bind_not_loopback"; }
  ok("non-loopback bind (0.0.0.0) REFUSED — no internet-exposed listener", refusedWild === true);
  let refusedPublic = false; try { await startObservationServer({ tcp: { host: "::", port: 0 }, host, secret: SECRET, log: () => {} }); } catch (e) { refusedPublic = e && e.message === "transport_bind_not_loopback"; }
  ok("wildcard IPv6 bind (::) REFUSED", refusedPublic === true);
  let refusedWeak = false; try { await startObservationServer({ socketPath: sock("weak"), host, secret: "short", log: () => {} }); } catch (e) { refusedWeak = e && e.message === "transport_secret_invalid"; }
  ok("weak/short transport secret REFUSED", refusedWeak === true);

  console.log("D. Serving lifecycle (startServingRuntime)");
  const rUnprov = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: false }), transportSecretProvider: async () => SECRET, log: () => {} });
  ok("unprovisioned authority -> fail closed", rUnprov.started === false && rUnprov.status === "unprovisioned");
  const rDefault = await startServingRuntime({ log: () => {} });
  ok("default production path -> UNPROVISIONED (no injector, no env secret) fail closed", rDefault.started === false && rDefault.status === "unprovisioned");
  const rNoSecret = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority() }), transportSecretProvider: async () => undefined, testBoundary: true, log: () => {} });
  ok("provisioned authority but absent transport secret -> transport_secret_absent", rNoSecret.started === false && rNoSecret.status === "transport_secret_absent");
  const rBadHost = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: {} }), transportSecretProvider: async () => SECRET, testBoundary: true, log: () => {} });
  ok("invalid authority -> host_unavailable", rBadHost.started === false && rBadHost.status === "host_unavailable");
  const rProdSynthetic = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority() }), transportSecretProvider: async () => SECRET, testBoundary: false, log: () => {} });
  ok("production mode REJECTS synthetic (test-provenance) authority", rProdSynthetic.started === false && rProdSynthetic.status === "host_unavailable");
  const rWild = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority() }), transportSecretProvider: async () => SECRET, tcp: { host: "0.0.0.0", port: 0 }, testBoundary: true, log: () => {} });
  ok("runtime with non-loopback legacy tcp bind -> listen_config_invalid (fail closed, not serving)", rWild.started === false && rWild.status === "listen_config_invalid");
  const c5 = [];
  const ctrl = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority() }), transportSecretProvider: async () => SECRET, socketPath: sock("svc"), nowProvider: () => NOW, testBoundary: true, log: (s) => c5.push(s) });
  ok("synthetic provisioned -> serving + ready", ctrl.started === true && ctrl.status === "serving" && ctrl.ready() === true);
  const svcClient = createObservationClient({ socketPath: ctrl.address, secret: SECRET, nowProvider: () => NOW });
  const live = await svcClient.observe("armed");
  ok("real request/response through the running service", live.ok === true && live.message.ok === true && live.message.observation.armedState.one_call_policy_digest === FIXED.one_call_policy_digest);
  const local = await ctrl.observeLocal({ observation: "ceilings" });
  ok("in-process observeLocal works + guarded", local.ok === true && assertOutwardMessage(local).ok === true);
  ok("serving start log carries no secret", c5.every((l) => !leaked(l) && !l.includes(SECRET)));
  const stopped = await ctrl.stop();
  ok("clean shutdown; not-ready + observeLocal fail-closed after stop", stopped === true && ctrl.ready() === false && (await ctrl.observeLocal({ observation: "dormant" })).ok === false);
  ok("no serving status on any fail-closed path", ![rUnprov, rDefault, rNoSecret, rBadHost, rProdSynthetic, rWild].some((r) => r.started === true));

  console.log("E. Offline / protected boundaries");
  const files = ["reader-only-authority.mjs", "observation-transport.mjs", "private-reader-host-runtime.mjs", "runtime-config.mjs"].map((f) => readFileSync(resolve(HERE, "..", f), "utf8")).join("\n");
  ok("no HTTP/HTTPS/ws/web-framework import (raw authenticated socket protocol only)", !/from\s+["'](http|https|http2|node:http|node:https|node:http2|ws|express|fastify)["']/.test(files));
  ok("no fetch / no child_process / no dns", !/\bfetch\s*\(/.test(files) && !/child_process/.test(files) && !/\bdns\b/.test(files));
  ok("no hardcoded TCP port listen (listen target only from the validated listen config)", !/\.listen\s*\(\s*\d+/.test(files) && /server\.listen\(target\.listenArg/.test(files));
  ok("no generate-domain / public endpoint", !/generate-?domain|publicDomain\s*:\s*true/.test(files));
  ok("never forwards e.message/stack outward", !/e\s*&&\s*e\.message/.test(files) && !/\.stack\b/.test(files));
  ok("config: no public domain; transport mode explicitly selected", RUNTIME_CONFIG_CONTRACT.serves_public_domain === false && /No public domain/.test(RUNTIME_CONFIG_CONTRACT.transport) && /explicitly selected/.test(RUNTIME_CONFIG_CONTRACT.transport));
  ok("status set + fail/degraded exit codes", RUNTIME_STATUS.length === 8 && RUNTIME_STATUS.includes("listen_config_invalid") && FAIL_EXIT_CODE === 70 && DEGRADED_EXIT_CODE === 71);
  ok("target self-check AI-STAGING (never CORE)", targetSelfCheck().ok === true);

  await sectionF();
  await sectionG();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed, ${skip} skipped  (executed assertions: ${pass + fail})`);
  if (skip > 0) console.log("SKIPPED:", skips.join(" | "));
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exit(1); }
  console.log("OFFLINE SERVING-RUNTIME VERIFICATION: PASS");
  console.log("SCOPE: synthetic authority/secret + real local Unix/loopback/private-network-mode sockets (independent child caller) + observation deadline/quarantine + fail-closed lifecycle + accepted-boundary reuse — NOT live Railway isolation/DB/credential/serving-in-production proof.");
  process.exit(0);
}
// ── helpers for F/G ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlc = (cfg, o) => { try { validateListenConfig(cfg, o); return "ok"; } catch (e) { return e && e.message; } };
function localNonLoopbackIPv4() {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === "IPv4" && !i.internal) return i.address;
  return null;
}
function runChild(env) {
  return new Promise((resolveP) => {
    const c = spawn(process.execPath, [join(HERE, "independent-client.mjs")], { env: { LAI_SECRET: SECRET, LAI_NOW: String(NOW), ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.setEncoding("utf8"); c.stdout.on("data", (d) => { out += d; });
    c.on("close", (code) => { try { resolveP({ code, r: JSON.parse(out.trim()) }); } catch { resolveP({ code, r: null }); } });
  });
}
function countingHost(inner) { const h = { calls: 0, observe: (req, ctl) => { h.calls++; return inner.observe(req, ctl); } }; return h; }

async function sectionF() {
  console.log("F. Private-network serving mode (Finding 1) — config validation + REAL cross-process connectivity");
  const P = { mode: "private-network", port: 7443, allowedPeerCidrs: ["10.20.0.0/16"] };
  ok("listen config absent -> refused", vlc(undefined) === "transport_listen_config_absent");
  ok("unknown mode ('public') -> refused", vlc({ mode: "public" }) === "transport_listen_mode_invalid");
  ok("valid literal private IPv4 bind + private peer allowlist -> accepted", vlc({ ...P, bindHost: "10.20.3.4" }) === "ok");
  ok("valid ULA IPv6 bind + ULA peer allowlist -> accepted", vlc({ ...P, bindHost: "fd12:3456:789a::10", allowedPeerCidrs: ["fd12:3456::/32"] }) === "ok");
  ok("wildcard '::' WITH explicit acknowledgement + allowlist -> accepted", vlc({ ...P, bindHost: "::", allowWildcardBind: true, allowedPeerCidrs: ["fd12:3456::/32"] }) === "ok");
  ok("wildcard '0.0.0.0' without acknowledgement -> refused (never inferred)", vlc({ ...P, bindHost: "0.0.0.0" }) === "transport_wildcard_bind_not_acknowledged");
  ok("wildcard '::' without acknowledgement -> refused", vlc({ ...P, bindHost: "::" }) === "transport_wildcard_bind_not_acknowledged");
  ok("wildcard ack must be boolean true (string 'true' refused)", vlc({ ...P, bindHost: "::", allowWildcardBind: "true" }) === "transport_wildcard_bind_not_acknowledged");
  ok("public IPv4 bind (8.8.8.8) -> refused", vlc({ ...P, bindHost: "8.8.8.8" }) === "transport_bind_not_private");
  ok("public/doc IPv6 bind (2001:db8::1) -> refused", vlc({ ...P, bindHost: "2001:db8::1" }) === "transport_bind_not_private");
  ok("RFC 5737 192.0.2.2 is NOT private in production mode -> refused", vlc({ ...P, bindHost: "192.0.2.2" }) === "transport_bind_not_private");
  ok("loopback bind in private-network mode -> refused (127.0.0.1)", vlc({ ...P, bindHost: "127.0.0.1" }) === "transport_private_mode_rejects_loopback");
  ok("loopback bind in private-network mode -> refused (::1)", vlc({ ...P, bindHost: "::1" }) === "transport_private_mode_rejects_loopback");
  ok("hostname bind (no DNS resolution trusted) -> refused", vlc({ ...P, bindHost: "reader.railway.internal" }) === "transport_bind_host_not_literal_ip");
  ok("missing bind host -> refused", vlc({ ...P, bindHost: undefined }) === "transport_bind_host_required");
  ok("missing peer allowlist -> refused", vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: undefined }) === "transport_peer_allowlist_required");
  ok("empty peer allowlist -> refused", vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: [] }) === "transport_peer_allowlist_required");
  ok("any-address peer CIDR 0.0.0.0/0 -> refused", vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: ["0.0.0.0/0"] }) === "transport_peer_cidr_not_private");
  ok("any-address peer CIDR ::/0 -> refused", vlc({ ...P, bindHost: "::", allowWildcardBind: true, allowedPeerCidrs: ["::/0"] }) === "transport_peer_cidr_not_private");
  ok("over-broad peer CIDR 10.0.0.0/4 -> refused", vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: ["10.0.0.0/4"] }) === "transport_peer_cidr_not_private");
  ok("public peer CIDR 203.0.113.0/24 -> refused", vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: ["203.0.113.0/24"] }) === "transport_peer_cidr_not_private");
  ok("malformed peer CIDR -> refused", vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: ["10.0.0.0/33"] }) === "transport_peer_cidr_invalid" && vlc({ ...P, bindHost: "10.20.3.4", allowedPeerCidrs: ["garbage"] }) === "transport_peer_cidr_invalid");
  ok("ephemeral port 0 refused outside the test boundary", vlc({ ...P, bindHost: "10.20.3.4", port: 0 }) === "transport_port_invalid");
  ok("invalid port (70000 / string) refused", vlc({ ...P, bindHost: "10.20.3.4", port: 70000 }) === "transport_port_invalid" && vlc({ ...P, bindHost: "10.20.3.4", port: "7443" }) === "transport_port_invalid");
  ok("simulated private ranges REFUSED outside the test boundary", vlc({ ...P, bindHost: "192.0.2.2", simulatedPrivateRanges: [{ net: "192.0.2.0", prefix: 24, type: "ipv4" }] }) === "transport_simulated_ranges_require_test_boundary");
  ok("loopback-tcp mode still refuses 0.0.0.0", vlc({ mode: "loopback-tcp", host: "0.0.0.0", port: 1 }) === "transport_bind_not_loopback");

  // env resolution (non-secret names only; never infers wildcard / public)
  const E = (o) => resolveListenConfigFromEnv(o);
  ok("env: unset mode -> unix (conservative default)", E({}).mode === "unix");
  const envCfg = E({ [ENV_LISTEN_MODE]: "private-network", [ENV_BIND_HOST]: "::", [ENV_PORT]: "7443", [ENV_ALLOWED_PEER_CIDRS]: "fd12:3456::/32, fd99::/16", [ENV_ALLOW_WILDCARD_BIND]: "true" });
  ok("env: private-network parsed (port number, trimmed CIDR list, exact ack)", envCfg.mode === "private-network" && envCfg.port === 7443 && envCfg.allowedPeerCidrs.length === 2 && envCfg.allowWildcardBind === true && vlc(envCfg) === "ok");
  ok("env: wildcard ack is exact ('TRUE' is not acknowledgement)", vlc(E({ [ENV_LISTEN_MODE]: "private-network", [ENV_BIND_HOST]: "::", [ENV_PORT]: "7443", [ENV_ALLOWED_PEER_CIDRS]: "fd12::/16", [ENV_ALLOW_WILDCARD_BIND]: "TRUE" })) === "transport_wildcard_bind_not_acknowledged");
  ok("env: private-network without peer list -> refused", vlc(E({ [ENV_LISTEN_MODE]: "private-network", [ENV_BIND_HOST]: "10.1.1.1", [ENV_PORT]: "7443" })) === "transport_peer_allowlist_required");

  // runtime refuses invalid listen configs BEFORE binding
  const prov = { acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority() }), transportSecretProvider: async () => SECRET, testBoundary: true, log: () => {} };
  const rl1 = await startServingRuntime({ ...prov, listen: { ...P, bindHost: "0.0.0.0" } });
  const rl2 = await startServingRuntime({ ...prov, listen: { ...P, bindHost: "10.20.3.4", allowedPeerCidrs: [] } });
  const rl3 = await startServingRuntime({ ...prov, listen: { ...P, bindHost: "8.8.8.8" } });
  ok("runtime: unacknowledged wildcard / no allowlist / public bind -> listen_config_invalid, not serving", [rl1, rl2, rl3].every((r) => r.started === false && r.status === "listen_config_invalid"));

  // REAL cross-process connectivity on this machine's own non-loopback interface
  const ip = localNonLoopbackIPv4();
  if (!ip) { skip++; skips.push("F cross-process: no non-internal IPv4 interface in this sandbox"); console.log("  SKIP: no non-internal IPv4 interface"); return; }
  const parts = ip.split("."); const net24 = `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  const other = `${parts[0]}.${parts[1]}.${parts[2]}.${(Number(parts[3]) % 250) + 3}`;
  // test-only simulation: this sandbox has no RFC1918/ULA interface, so the interface's /24 is declared
  // "private" under the explicit test boundary. Production validation refuses this (asserted above).
  const SIM = [{ net: net24, prefix: 24, type: "ipv4" }];
  const ctrl = await startServingRuntime({ ...prov, nowProvider: () => NOW, listen: { mode: "private-network", bindHost: ip, port: 0, allowedPeerCidrs: [`${ip}/32`], simulatedPrivateRanges: SIM } });
  ok("private-network runtime serving on a NON-loopback interface address", ctrl.started === true && ctrl.mode === "private-network" && ctrl.address.host === ip && ctrl.address.port > 0 && ctrl.ready() === true);
  if (ctrl.started) {
    const { code, r } = await runChild({ LAI_HOST: ip, LAI_PORT: String(ctrl.address.port), LAI_SCENARIO: "full" });
    ok("independent child process ran (separate pid)", code === 0 && r && r.pid !== process.pid);
    ok("cross-process authenticated observe -> ok + accepted outward boundary", !!r && r.good.ok === true && r.good.message.ok === true && assertOutwardMessage(r.good.message).ok === true && !leaked(r.good));
    ok("cross-process invalid MAC -> unauthenticated", !!r && r.badMac.ok === false && r.badMac.code === "unauthenticated");
    ok("cross-process missing MAC -> unauthenticated", !!r && r.noMac.ok === false && r.noMac.code === "unauthenticated");
    ok("cross-process unapproved op -> unknown_op", !!r && r.unknownOp.ok === false && r.unknownOp.code === "unknown_op");
    ok("cross-process stale ts -> stale", !!r && r.stale.ok === false && r.stale.code === "stale");
    ok("cross-process replayed nonce -> replayed", !!r && r.replay1.ok === true && r.replay2.ok === false && r.replay2.code === "replayed");
    const inproc = await createObservationClient({ tcp: { host: ip, port: ctrl.address.port }, secret: SECRET, nowProvider: () => NOW }).observe("ceilings");
    ok("shipped client over the private-network listener -> ok", inproc.ok === true && inproc.message.ok === true);
    const port = ctrl.address.port;
    ok("shutdown closes the private-network listener", (await ctrl.stop()) === true && ctrl.ready() === false);
    const after = await runChild({ LAI_HOST: ip, LAI_PORT: String(port), LAI_SCENARIO: "single" });
    ok("after shutdown the independent caller is refused (no listener)", !!after.r && after.r.single.transportError === "ECONNREFUSED");
  }
  // peer allowlist enforced BEFORE any request processing (address filter is defence-in-depth, not auth)
  const ch = countingHost(makeReaderOnlyHost(readerAuthority(), T));
  const denied = await startObservationServer({ host: ch, secret: SECRET, nowProvider: () => NOW, log: () => {}, testBoundary: true, listen: { mode: "private-network", bindHost: ip, port: 0, allowedPeerCidrs: [`${other}/32`], simulatedPrivateRanges: SIM } });
  openServers.push(denied);
  const dr = await runChild({ LAI_HOST: ip, LAI_PORT: String(denied.address.port), LAI_SCENARIO: "single" });
  ok("caller outside the peer allowlist -> peer_not_allowed; host never invoked", !!dr.r && dr.r.single.ok === false && dr.r.single.code === "peer_not_allowed" && ch.calls === 0);
  await denied.close(); openServers.pop();
  // a correct address alone is NOT authentication: allowlisted peer without the secret is rejected
  const allowed = await startObservationServer({ host: ch, secret: SECRET, nowProvider: () => NOW, log: () => {}, testBoundary: true, listen: { mode: "private-network", bindHost: ip, port: 0, allowedPeerCidrs: [`${ip}/32`], simulatedPrivateRanges: SIM } });
  openServers.push(allowed);
  const wrongSecret = await runChild({ LAI_HOST: ip, LAI_PORT: String(allowed.address.port), LAI_SCENARIO: "single", LAI_SECRET: "a-different-synthetic-secret-xyz" });
  ok("allowlisted private address WITHOUT the caller secret -> unauthenticated; host never invoked", !!wrongSecret.r && wrongSecret.r.single.code === "unauthenticated" && ch.calls === 0);
  await allowed.close(); openServers.pop();
}

// controllable fake reader for deadline tests (DB-side behaviour simulated; NO real DB)
function stallReader(behaviour) {
  const base = makeFakeReader();
  const r = { calls: 0, statementTimeoutMs: 400, query: (q, p) => { r.calls++; return behaviour(r.calls, () => base.query(q, p)); } };
  return r;
}
const FAST_LIMITS = { observationDeadlineMs: 200, requestTimeoutMs: 1000, quarantineMaxMs: 800, maxConcurrent: 2 };

async function sectionG() {
  console.log("G. Observation deadline + quarantine (Finding 2) — stalled / hung observations");
  ok("defaults are bounded and ordered (deadline < request budget < quarantine)", OBSERVATION_DEADLINE_MS < REQUEST_TIMEOUT_MS && REQUEST_TIMEOUT_MS < QUARANTINE_MAX_MS && MAX_CONCURRENT === 8 && READER_STATEMENT_TIMEOUT_MAX_MS <= OBSERVATION_DEADLINE_MS);
  ok("missing DB statement bound declaration -> authority invalid", validateReaderOnlyAuthority(readerAuthority({ readerDbClient: { query: async () => ({ rows: [] }) } }), T).reason === "reader_client_statement_timeout_invalid");
  ok("oversized / zero / fractional statement bound -> authority invalid", [5000, 0, 1.5, "400"].every((v) => validateReaderOnlyAuthority(readerAuthority({ readerDbClient: makeFakeReader({ statementTimeoutMs: v }) }), T).reason === "reader_client_statement_timeout_invalid"));
  const rNoBound = await startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority({ readerDbClient: { query: async () => ({ rows: [] }) } }) }), transportSecretProvider: async () => SECRET, testBoundary: true, log: () => {} });
  ok("runtime with an unbounded reader client -> host_unavailable (fail closed)", rNoBound.started === false && rNoBound.status === "host_unavailable");
  let limitRefused = false; try { await startObservationServer({ socketPath: sock("lim"), host: makeReaderOnlyHost(readerAuthority(), T), secret: SECRET, log: () => {}, limits: { observationDeadlineMs: 60000 } }); } catch (e) { limitRefused = e && e.message === "transport_limit_invalid"; }
  ok("limits can only be TIGHTENED (loosening refused)", limitRefused === true);

  // pre-aborted signal: host issues NO query at all
  const pre = stallReader((n, go) => go());
  const preHost = makeReaderOnlyHost(readerAuthority({ readerDbClient: pre }), T);
  const acPre = new AbortController(); acPre.abort();
  const preRes = await preHost.observe({ observation: "dormant" }, { signal: acPre.signal });
  ok("aborted observation issues zero reader queries + fixed code", preRes.ok === false && preRes.code === "observation_unavailable" && pre.calls === 0);

  const start = async (reader, extra = {}) => startServingRuntime({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuthority({ readerDbClient: reader }) }), transportSecretProvider: async () => SECRET, socketPath: sock("g" + Math.random().toString(36).slice(2, 8)), nowProvider: () => NOW, testBoundary: true, limits: FAST_LIMITS, log: () => {}, ...extra });

  // G1 — DB-bounded stall: the first statement stalls then the DB-side statement bound ends it (reject)
  let stall = true;
  const r1 = stallReader((n, go) => (stall ? new Promise((_, rej) => setTimeout(() => rej(new Error("statement timeout")), 400)) : go()));
  const c1 = await start(r1);
  const cl1 = createObservationClient({ socketPath: c1.address, secret: SECRET, nowProvider: () => NOW });
  let t = performance.now(); const tr1 = await cl1.observe("dormant"); const el1 = performance.now() - t;
  ok("stalled observation -> fixed 'timeout' at the deadline (request not held open)", tr1.ok === false && tr1.code === "timeout" && el1 >= 150 && el1 < 700 && !leaked(tr1) && !JSON.stringify(tr1).includes("statement"));
  ok("while unsettled, the slot stays quarantined (not released on timeout)", c1.health().active === 1);
  await sleep(350);
  ok("after the DB-side bound ends the statement, the slot is released (no permanent occupation)", c1.health().active === 0 && c1.health().degraded === false && c1.ready() === true);
  ok("abort gate: no further reader query was issued after the deadline", r1.calls === 1);
  stall = false;
  const rec = await cl1.observe("dormant");
  ok("recovery: next observation succeeds normally", rec.ok === true && rec.message.ok === true);
  await c1.stop();

  // G2 — late RESULT after the deadline is discarded and the next sequential query is refused by the gate
  const r2 = stallReader((n, go) => (n === 1 ? sleep(400).then(go) : go()));
  const c2 = await start(r2);
  const tr2 = await createObservationClient({ socketPath: c2.address, secret: SECRET, nowProvider: () => NOW }).observe("dormant");
  await sleep(350);
  ok("late-resolving statement: caller got 'timeout'; later queries refused (exactly 1 issued); slot freed", tr2.code === "timeout" && r2.calls === 1 && c2.health().active === 0);
  await c2.stop();

  // G3 — NEVER-settling work (e.g. DB bound not honoured / network stall): bounded, then fail closed
  let degradedFired = 0;
  const r3 = stallReader(() => new Promise(() => {}));
  const c3 = await start(r3, { degradedWatchMs: 50, onDegraded: () => { degradedFired++; } });
  const cl3 = createObservationClient({ socketPath: c3.address, secret: SECRET, nowProvider: () => NOW });
  const h1 = await cl3.observe("dormant"); const h2 = await cl3.observe("armed");
  ok("repeated hung observations each answer 'timeout' at the deadline", h1.code === "timeout" && h2.code === "timeout");
  const h3 = await cl3.observe("ceilings");
  ok("capacity bounded: hung work holds at most maxConcurrent slots; further work -> 'busy'", c3.health().active === 2 && h3.ok === false && h3.code === "busy");
  ok("no unbounded detached work: reader invoked only once per admitted observation", r3.calls === 2);
  await sleep(FAST_LIMITS.quarantineMaxMs + 150);
  const h4 = await cl3.observe("dormant");
  ok("quarantine exceeded -> sticky degraded: new work refused 'unavailable' (fail closed)", h4.ok === false && h4.code === "unavailable" && r3.calls === 2);
  ok("degraded runtime reports NOT ready + health.degraded", c3.ready() === false && c3.health().degraded === true);
  ok("degraded watchdog fired exactly once (entrypoint then stops + exits DEGRADED_EXIT_CODE for restart)", degradedFired === 1);
  t = performance.now(); const st3 = await c3.stop(); const el3 = performance.now() - t;
  let refused3 = false; try { await cl3.observe("dormant"); } catch { refused3 = true; }
  ok("clean shutdown despite hung work (prompt, listener closed)", st3 === true && el3 < 1000 && refused3 === true);
}

run().catch(async (e) => { for (const s of openServers) { try { await s.close(); } catch {} } console.log("HARNESS ERROR:", e && e.message); process.exit(1); });
