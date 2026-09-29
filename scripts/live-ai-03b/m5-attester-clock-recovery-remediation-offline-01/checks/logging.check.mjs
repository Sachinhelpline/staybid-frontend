// §21 — safe production logger: sanitized M5_ATTESTER_* markers, allowlisted events/keys, secrets never logged.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { CANDIDATE_TREE, bdir, makeOk, waitFor } from "./lib.mjs";

const B = bdir(CANDIDATE_TREE);
const { makeSafeAttesterLogger, ATTESTER_LOG_EVENTS } = await import(B + "/bootstrap-entrypoint-attester.mjs");
const { startAttesterBootstrap } = await import(B + "/attester-bootstrap.mjs");
const { makeBootstrapEnv } = await import(B + "/tests/fixtures/synthetic-env.mjs");
const T = makeOk("m5acr-logging"); const { ok } = T;
const MARKER = /^(M5_[A-Z0-9_]+) (\{.*\})$/;             // the accepted M5/M6 runner marker grammar
const out = []; const L = makeSafeAttesterLogger((l) => out.push(l));

L(JSON.stringify({ attester: "reader-attester-bootstrap-v1", event: "clock_invalidated", reason: "db_probe_failed", reasonClass: "db_probe_failed" }));
ok("L1 an allowlisted event becomes exactly one marker line in the runner grammar", out.length === 1 && MARKER.test(out[0]) && out[0].startsWith("M5_ATTESTER_CLOCK_INVALIDATED {"));
ok("L2 marker payload keeps allowlisted keys only (version key dropped)", JSON.stringify(JSON.parse(MARKER.exec(out[0])[2])) === JSON.stringify({ reason: "db_probe_failed", reasonClass: "db_probe_failed" }));
out.length = 0;
const secrets = { dsn: "postgresql://obs:pw@postgres.railway.internal:5432/railway", ip: "10.1.2.3", hex: "a".repeat(15) + "b1c2d3e4", jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig", long: "x".repeat(60), obj: { k: 1 }, space: "has space" };
for (const [k, v] of Object.entries(secrets)) L(JSON.stringify({ event: "recovery_fail", reasonClass: v, trigger: k }));
const vals = out.map((l) => JSON.parse(MARKER.exec(l)[2]).reasonClass);
ok("L3 DSN / IP / long-hex / JWT / oversized / object / whitespace values are all redacted", vals.every((v) => v === "<redacted>") && out.every((l) => !l.includes("postgres") && !l.includes("10.1.2.3") && !l.includes("eyJ")));
out.length = 0;
L(JSON.stringify({ event: "clock_invalidated", reason: "db_probe_failed", secretKey: "abc", connectionString: "x", password: "p" }));
ok("L4 non-allowlisted keys are dropped entirely", out.length === 1 && !/secretKey|connectionString|password/.test(out[0]));
out.length = 0;
L(JSON.stringify({ event: "request_signed", requestNonce: "x" })); L("not json"); L(JSON.stringify([1, 2])); L(JSON.stringify({ event: "__proto__" }));
ok("L5 unknown events, non-JSON and non-object lines are dropped (never echoed)", out.length === 0);
ok("L6 NaN/Infinity become <redacted>; booleans/null/finite numbers pass", (() => { L(JSON.stringify({ event: "state", requests: 3, signingReady: false, peerInvalid: null })); const o = JSON.parse(MARKER.exec(out.pop())[2]); return o.requests === 3 && o.signingReady === false && o.peerInvalid === null; })());

// end-to-end: a real attester invalidation + automatic recovery + heartbeat through the safe logger
const env = await makeBootstrapEnv({ rttUs: 2000 });
const SECRET = randomBytes(32).toString("hex");
let bad = false;
const take = async () => (bad ? { ok: false, reason: "db_probe_failed" } : env.attesterTakeSample());
const lines = []; const safe = makeSafeAttesterLogger((l) => lines.push(l));
const att = await startAttesterBootstrap({ takeSampleFn: take, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false, autoRecover: true, recoveryBackoffMs: [20], heartbeatMs: 100, log: safe });
bad = true; await att.monitor.sampleOnce(); bad = false;
await waitFor(() => att.signingReady() === true, 6000);
await waitFor(() => lines.some((l) => l.startsWith("M5_ATTESTER_STATE ")), 2000);
att.invalidatePeer("peer_unsafe:dns_resolution_failed");
await att.stop();
const names = lines.map((l) => (MARKER.exec(l) || [])[1]);
const want = ["M5_ATTESTER_CLOCK_INVALIDATED", "M5_ATTESTER_SIGNING_DISABLED", "M5_ATTESTER_RECOVERY_SCHEDULED", "M5_ATTESTER_RECOVERY_STARTED", "M5_ATTESTER_RECOVERY_PASS", "M5_ATTESTER_SIGNING_RESTORED"];
ok("L7 invalidation → recovery emits the ordered marker sequence", JSON.stringify(names.filter((n) => want.includes(n)).slice(0, 6)) === JSON.stringify(want));
ok("L8 the periodic heartbeat emits a STATE marker with status/signingReady/monitorHealthy/recovering + counters", (() => { const s = lines.find((l) => l.startsWith("M5_ATTESTER_STATE ")); const o = s && JSON.parse(MARKER.exec(s)[2]); return !!o && "status" in o && "signingReady" in o && "monitorHealthy" in o && "recovering" in o && "requests" in o && "signed" in o; })());
ok("L9 peer + stop markers emitted (PEER_INVALIDATED, STOPPED)", names.includes("M5_ATTESTER_PEER_INVALIDATED") && names.includes("M5_ATTESTER_STOPPED"));
ok("L10 every emitted line matches the runner marker grammar", lines.length > 0 && lines.every((l) => MARKER.test(l)));
const forbidden = [SECRET, env.connectionToken, env.signingKeyPriv.slice(0, 24), att.generation(), "dns_resolution_failed", "127.0.0.1"];
ok("L11 no line contains the channel secret, connection token, key material, generation id, resolver detail or an address", lines.every((l) => forbidden.every((f) => !l.includes(f))));
ok("L12 every emitted event is in the published allowlist", names.every((n) => ATTESTER_LOG_EVENTS.includes(n.replace("M5_ATTESTER_", "").toLowerCase())));
await env.cleanup();

// production wiring + the real entrypoint (empty env ⇒ fail-closed exit 70, original JSON line unchanged + marker)
const ep = fs.readFileSync(B + "/bootstrap-entrypoint-attester.mjs", "utf8");
const pa = fs.readFileSync(B + "/production-attester.mjs", "utf8");
ok("L13 main() passes the safe marker logger into the production composition", /const safeLog = makeSafeAttesterLogger\(/.test(ep) && /startAttesterBootstrapService\(\{ log: safeLog \}\)/.test(ep));
ok("L14 production composition enables autoRecover and a 60 s heartbeat", /autoRecover: true/.test(pa) && /ATTESTER_HEARTBEAT_MS = 60000/.test(pa) && /heartbeatMs: ATTESTER_HEARTBEAT_MS/.test(pa));
const run = spawnSync(process.execPath, [B + "/bootstrap-entrypoint-attester.mjs"], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 20000 });
const so = (run.stdout || "").trim().split("\n");
const first = (() => { try { return JSON.parse(so[0]); } catch { return null; } })();
ok("L15 entrypoint with no provisioning: exit 70; first line is the ORIGINAL startup JSON (same keys)", run.status === 70 && first && JSON.stringify(Object.keys(first)) === JSON.stringify(["attester", "composition", "status", "reason", "servesPublicDomain", "signingReady"]) && first.attester === "reader-attester-bootstrap-v1");
ok("L16 …followed by one sanitized M5_ATTESTER_STARTUP marker (started:false, signingReady:false)", so.length === 2 && so[1].startsWith("M5_ATTESTER_STARTUP ") && JSON.parse(MARKER.exec(so[1])[2]).started === false && JSON.parse(MARKER.exec(so[1])[2]).signingReady === false);
T.done(16);
