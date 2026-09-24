// OFFLINE test suite for the PRIVATE trusted-reader host. Synthetic credentials, fake DB clients,
// mock rows ONLY. Connects to NOTHING (no Railway / Postgres / Supabase / CORE-PROD / AI-STAGING /
// provider). Node built-ins only. Covers the two remediated leak paths with VALUE-based negatives.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  makePrivateReaderHost, makePrivateReaderHostForTest, deliverToGateway, acquirePrivateReaderHost,
  assertOutwardMessage, assertNonSecretResult, PRIVATE_HOST_CONTRACT, OBSERVATIONS, ERROR_CODES,
} from "../private-reader-host.mjs";
import {
  CANDIDATE_REGISTRY_DIGEST, buildReviewedStateQueries,
  DORMANT_POLICY_CONTROL_QUERY, ARMED_POLICY_CONTROL_QUERY, CEILINGS_QUERY, ZERO_EXPOSURE_COUNTS_QUERY,
} from "../../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import {
  CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY,
  CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
} from "../../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const codes = new Set(ERROR_CODES);
const outwardCodes = []; // collected to assert failures use only the fixed set
const seenCode = (m) => { if (m && m.ok === false && m.code !== undefined) outwardCodes.push(m.code); return m; };

// sentinel that MUST never appear in any outward message
const SENTINEL = "postgres://sentinel_user:sentinel_pw@db.internal:5432/live";
const leaked = (m) => JSON.stringify(m === undefined ? null : m).includes("sentinel") || JSON.stringify(m === undefined ? null : m).includes("postgres://");

function makeFakeReader(extra = {}) {
  const seen = [];
  const rowFor = (sql) => {
    if (sql === CATALOG_ACTIVE_COUNT_QUERY) return { n: 1 };
    if (sql === CATALOG_INACTIVE_VERSION_QUERY) return { n: 1, digest: "inactive-digest" };
    if (sql === CATALOG_INACTIVE_ENTRY_COUNT_QUERY) return { n: 2 };
    if (sql === CATALOG_ACTIVE_DIGEST_QUERY) return { catalog_digest: "active-digest" };
    if (sql === DORMANT_POLICY_CONTROL_QUERY) return { active_policy_count: 0, dormant_policy_present: true, global_control_epoch: 1, project_control_epoch: 1, global_control_enabled: false, project_control_enabled: false, global_control_killed: false, project_control_killed: false };
    if (sql === ARMED_POLICY_CONTROL_QUERY) return { one_call_policy_digest: FIXED.one_call_policy_digest, control_global_digest: "g", control_project_digest: "p", global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true, global_control_killed: false, project_control_killed: false };
    if (sql === CEILINGS_QUERY) return { session_money_ceiling_micros: 89536, session_provider_calls: 1, session_execution_admissions: 1, subject_day_money_ceiling_micros: 89536, project_day_money_ceiling_micros: 89536, project_month_money_ceiling_micros: 89536, global_day_money_ceiling_micros: 89536 };
    if (sql === ZERO_EXPOSURE_COUNTS_QUERY) return { envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 };
    return null;
  };
  return Object.assign({ seen, query: async (sql) => { seen.push(sql); const r = rowFor(sql); return { rows: r ? [r] : [] }; } }, extra);
}
// a reader whose driver throws an exception whose message embeds the sentinel connection URL
function makeThrowingReader() { return { seen: [], query: async () => { throw new Error("ECONNREFUSED " + SENTINEL); } }; }

function shapedAuthority(over = {}) {
  const a = {
    cfg: { ok: true, reviewer: { pinnedFingerprint: "FP" }, targets: { pgServiceId: FIXED.ai_staging_postgres } },
    trustRoot: { pinnedPublicKeyDerB64: "KEY", pinnedFingerprint: "FP" },
    executorDbClient: { query: async () => ({ rows: [] }) },
    readerDbClient: makeFakeReader(),
    connectionIdentityProof: { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance, issuer: "ISSUER", boundConnectionToken: "CTOK", serviceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment },
    expectedIssuer: "ISSUER", connectionToken: "CTOK",
    privilegeProof: { restricted_role_proof_present: true },
    reviewedStateQueries: buildReviewedStateQueries(),
    sourcePin: { commit: FIXED.source_commit }, nowProvider: () => 0,
  };
  return Object.assign(a, over);
}

async function run() {
  console.log("1. Fail-closed unprovisioned + finite code contract");
  ok("acquirePrivateReaderHost() unprovisioned (code)", (await acquirePrivateReaderHost()).available === false && (await acquirePrivateReaderHost()).code === "unprovisioned");
  ok("makePrivateReaderHost(undefined) -> authority_invalid", makePrivateReaderHost(undefined).code === "authority_invalid");
  ok("makePrivateReaderHost({}) -> authority_invalid", makePrivateReaderHost({}).code === "authority_invalid");
  ok("production factory rejects testBoundary (code)", makePrivateReaderHost(shapedAuthority(), { testBoundary: true }).code === "production_rejects_test_boundary");
  ok("contract pins accepted registry digest", PRIVATE_HOST_CONTRACT.approved_registry_digest === CANDIDATE_REGISTRY_DIGEST);
  ok("contract publishes the finite error-code set", Array.isArray(PRIVATE_HOST_CONTRACT.outward_error_codes) && PRIVATE_HOST_CONTRACT.outward_error_codes.length === ERROR_CODES.length);

  console.log("2. Invalid/untrusted authority -> fail closed (fixed codes only)");
  ok("missing readerDbClient -> authority_invalid", makePrivateReaderHost(shapedAuthority({ readerDbClient: undefined })).code === "authority_invalid");
  ok("missing privilegeProof -> authority_invalid", makePrivateReaderHost(shapedAuthority({ privilegeProof: undefined })).code === "authority_invalid");
  ok("__testFixture reader client -> authority_invalid (fixed code, no sub-reason)", makePrivateReaderHost(shapedAuthority({ readerDbClient: makeFakeReader({ __testFixture: true }) })).code === "authority_invalid");
  ok("CORE-PROD connection proof -> authority_invalid/target (fixed)", (() => { const r = makePrivateReaderHost(shapedAuthority({ connectionIdentityProof: { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance, issuer: "ISSUER", boundConnectionToken: "CTOK", serviceId: FIXED.core_excluded_postgres, projectId: FIXED.core_excluded_project, environmentId: FIXED.ai_staging_environment } })); return codes.has(r.code) && r.available === false; })());
  ok("trust root not config-pinned -> authority_invalid", makePrivateReaderHost(shapedAuthority({ trustRoot: { pinnedPublicKeyDerB64: "KEY", pinnedFingerprint: "OTHER" } })).code === "authority_invalid");

  console.log("3. Rejected arbitrary SQL / injection (no echoed input)");
  const tampered = { __registryDigest: CANDIDATE_REGISTRY_DIGEST, dormantPolicyControl: "SELECT 1 AS x", armedPolicyControl: ARMED_POLICY_CONTROL_QUERY, ceilings: CEILINGS_QUERY, zeroExposureCounts: ZERO_EXPOSURE_COUNTS_QUERY };
  ok("substituted reviewed SQL -> authority_invalid (fixed)", makePrivateReaderHost(shapedAuthority({ reviewedStateQueries: tampered })).code === "authority_invalid");
  const th = makePrivateReaderHostForTest({ dbClient: makeFakeReader() });
  ok("test host available", th.available === true);
  const rInj = seenCode(await th.observe({ observation: "dormant", sql: "DROP TABLE x" }));
  ok("injected sql key -> request_rejected (no echo of key/value)", rInj.ok === false && rInj.code === "request_rejected" && !JSON.stringify(rInj).includes("DROP") && !JSON.stringify(rInj).includes("sql"));
  const rClient = seenCode(await th.observe({ observation: "dormant", readerDbClient: {} }));
  ok("injected dbClient key -> request_rejected (no echo)", rClient.code === "request_rejected" && !JSON.stringify(rClient).includes("readerDbClient"));
  const rUnk = seenCode(await th.observe({ observation: "'; DROP" }));
  ok("unknown observation -> unknown_observation (no echo of value)", rUnk.code === "unknown_observation" && !JSON.stringify(rUnk).includes("DROP"));

  console.log("4. Accepted SELECT-only query behavior (message API)");
  const fake = makeFakeReader();
  const host = makePrivateReaderHostForTest({ dbClient: fake });
  const d = await host.observe({ observation: "dormant" });
  const ar = await host.observe({ observation: "armed" });
  const ce = await host.observe({ observation: "ceilings" });
  ok("dormant ok + shaped message", d.ok === true && d.kind === "live-ai-03b-observation" && d.observation.counts.sessions === 0);
  ok("armed ok + digest surfaced", ar.ok === true && ar.observation.armedState.one_call_policy_digest === FIXED.one_call_policy_digest);
  ok("ceilings ok", ce.ok === true && ce.observation.oneCallPolicy.session_money_ceiling_micros === 89536);
  ok("every executed statement is SELECT-only, no DML/DDL/semicolon", fake.seen.length > 0 && fake.seen.every((s) => /^\s*SELECT\b/i.test(s) && !/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(s) && !s.includes(";")));
  ok("only accepted registry/catalog SQL executed", fake.seen.every((s) => [CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY, CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY, DORMANT_POLICY_CONTROL_QUERY, ARMED_POLICY_CONTROL_QUERY, CEILINGS_QUERY, ZERO_EXPOSURE_COUNTS_QUERY].includes(s)));
  ok("successful message passes strict outward guard", assertOutwardMessage(d).ok === true && assertNonSecretResult(ce).ok === true);

  console.log("5. LEAK 1 — DB exception message never crosses outward");
  const thost = makePrivateReaderHostForTest({ dbClient: makeThrowingReader() });
  const te = seenCode(await thost.observe({ observation: "dormant" }));
  ok("throwing driver -> observation_error (fixed code)", te.ok === false && te.code === "observation_error");
  ok("outward message carries NO sentinel / connection URL", !leaked(te));
  ok("errored message still passes the outward guard", assertOutwardMessage(te).ok === true);
  ok("errored message cannot be re-delivered with the secret", !leaked(deliverToGateway(te)) && deliverToGateway(te).ok === true);

  console.log("6. LEAK 2 — value-based boundary (URL in an allowed/reason field rejected)");
  // (a) an extra 'reason' field carrying a URL
  const reasonLeak = { kind: "live-ai-03b-observation", phase: "dormant", ok: false, code: "observation_error", reason: SENTINEL };
  ok("reason-field URL: assertOutwardMessage rejects", assertOutwardMessage(reasonLeak).ok === false);
  ok("reason-field URL: deliverToGateway refuses (no leak)", deliverToGateway(reasonLeak).ok === false && !leaked(deliverToGateway(reasonLeak)));
  ok("reason-field URL: toGatewayMessage refuses", host.toGatewayMessage(reasonLeak).ok === false);
  // (b) a URL smuggled INSIDE an otherwise-permitted observation field
  const poisoned = JSON.parse(JSON.stringify(d));
  poisoned.observation.dormantState.inactive_catalog_digest = SENTINEL;
  ok("URL inside permitted field: assertOutwardMessage rejects", assertOutwardMessage(poisoned).ok === false);
  ok("URL inside permitted field: deliverToGateway refuses (no leak)", deliverToGateway(poisoned).ok === false && !leaked(deliverToGateway(poisoned)));
  ok("URL inside permitted field: toGatewayMessage refuses", host.toGatewayMessage(poisoned).ok === false);
  // (c) a non-fixed / URL-bearing code
  ok("non-fixed code rejected", assertOutwardMessage({ kind: "live-ai-03b-observation", ok: false, code: "leak://" + "x" }).ok === false);
  // (d) malformed structures
  ok("array rejected", assertOutwardMessage([1, 2]).ok === false);
  ok("missing kind rejected", assertOutwardMessage({ ok: true, phase: "dormant" }).ok === false);
  ok("extra top-level key rejected", assertOutwardMessage({ kind: "live-ai-03b-observation", phase: "dormant", ok: false, code: "observation_error", extra: 1 }).ok === false);
  ok("NaN numeric leaf rejected", (() => { const p = JSON.parse(JSON.stringify(d)); p.observation.counts.sessions = "NaNish://x"; return assertOutwardMessage(p).ok === false; })());

  console.log("7. Gateway can NEVER receive a credential / DB client / URL");
  ok("deliverToGateway refuses a db client (.query fn)", deliverToGateway({ query: () => {} }).ok === false);
  ok("deliverToGateway refuses a readerDbClient field", deliverToGateway({ readerDbClient: { host: "x" } }).ok === false);
  ok("deliverToGateway refuses a raw DB url object", deliverToGateway({ url: SENTINEL }).ok === false && !leaked(deliverToGateway({ url: SENTINEL })));
  ok("deliverToGateway refuses a password field", deliverToGateway({ password: "x" }).ok === false);
  ok("deliverToGateway refuses a nested function", deliverToGateway({ a: { b: () => {} } }).ok === false);
  const g = host.toGatewayMessage(d);
  ok("valid observation delivered to gateway", g.ok === true && assertOutwardMessage(g.message).ok === true);
  ok("serialized gateway message carries no client/secret/url", !/query\"\s*:|postgres:\/\/|password|readerDbClient|connectionToken|__testFixture/i.test(JSON.stringify(g.message)));
  ok("host handle exposes only id/mode/available data fields", Object.keys(host).filter((k) => typeof host[k] !== "function").sort().join(",") === "available,id,mode");
  ok("host handle exposes no query/db client", typeof host.query !== "function" && host.readerDbClient === undefined && host.dbClient === undefined);

  console.log("8. Structural production wiring + no mutation / no network");
  const ph = makePrivateReaderHost(shapedAuthority());
  ok("shaped authority satisfies STRUCTURAL bar (builds)", ph.available === true && ph.mode === "production");
  const pd = await ph.observe({ observation: "dormant" });
  ok("structural production observe -> guarded message", pd.ok === true && assertOutwardMessage(pd).ok === true);
  ok("structural production gateway message leaks nothing", (() => { const m = ph.toGatewayMessage(pd); return m.ok === true && !/query\"\s*:|postgres:\/\/|password|readerDbClient|connectionToken/i.test(JSON.stringify(m.message)); })());
  ok("no mutating statement ever issued", fake.seen.every((s) => !/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(s)));
  const src = readFileSync(resolve(HERE, "..", "private-reader-host.mjs"), "utf8");
  ok("host source imports no network/db driver", !/from\s+["'](pg|net|http|https|dns|tls|node:net|node:http|node:https|node:dns|node:tls|child_process|node:child_process)["']/.test(src) && !/\bfetch\s*\(/.test(src) && !/\brequire\s*\(/.test(src));
  ok("host source opens no connection primitives", !/\.(connect|createConnection|Client|Pool)\s*\(/.test(src));
  ok("host source never forwards e.message / stack outward", !/e\s*&&\s*e\.message/.test(src) && !/\.stack\b/.test(src));

  console.log("9. All outward failures used ONLY the finite fixed code set");
  ok(`collected ${outwardCodes.length} outward failure codes, all in ERROR_CODES`, outwardCodes.length > 0 && outwardCodes.every((c) => codes.has(c)));

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exit(1); }
  console.log("OFFLINE PRIVATE-READER-HOST VERIFICATION: PASS");
  console.log("SCOPE: synthetic clients/authorities + fixed-registry wiring + strict value-based outward boundary + fail-closed — NOT live PostgreSQL, credential, or runtime-isolation proof.");
  process.exit(0);
}
run();
