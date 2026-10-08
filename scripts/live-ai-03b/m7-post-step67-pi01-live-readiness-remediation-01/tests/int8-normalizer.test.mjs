// OFFLINE unit test — V3 RUNTIME PG BIGINT NORMALIZATION REMEDIATION 01 (no database, no network).
// Matrix: E invalid integer text · F unsafe integer · G Number input unchanged · H non-BIGINT / nullable untouched ·
// exact query/field allowlist · passthrough identity for every other SQL · wrapper surface + no-write property.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { counter } from "./_h.mjs";
import { INT8_OBSERVATION_FIELDS, normalizeInt8Value, normalizeObservationRows, makeInt8NormalizingReaderPhysicalFactory, INT8_NORMALIZER_VERSION }
  from "../src/authority-v3-int8-observation-normalizer.mjs";
import { QUERIES } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-query-registry.mjs";
import { LIFECYCLE_SQL } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { checkPreActivationState } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-contract.mjs";
import * as G from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-digest-gen.mjs";
import { reviewedV3Rows } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-catalog-contract.mjs";

globalThis.fetch = async () => { throw new Error("network forbidden in offline tests"); };
const HERE = dirname(fileURLToPath(import.meta.url));
const { ok, done } = counter("int8-normalizer");
const NOW = "2026-10-08T12:00:00Z";

// ── allowlist exactness ──
ok("U01 allowlist is exactly the 3 frozen observation queries", Object.keys(INT8_OBSERVATION_FIELDS).sort().join(",") === "catalogEntries,controls,policy");
ok("U02 catalogEntries fields exactly unit_size,rate_micros", INT8_OBSERVATION_FIELDS.catalogEntries.join(",") === "unit_size,rate_micros");
ok("U03 policy fields exactly the 7 BIGINT ceilings/counters", INT8_OBSERVATION_FIELDS.policy.join(",") === "session_money_ceiling_micros,session_provider_calls,session_execution_admissions,subject_day_money_ceiling_micros,project_day_money_ceiling_micros,project_month_money_ceiling_micros,global_day_money_ceiling_micros");
ok("U04 controls fields exactly control_epoch", INT8_OBSERVATION_FIELDS.controls.join(",") === "control_epoch");
ok("U05 allowlist is frozen (cannot be widened at runtime)", Object.isFrozen(INT8_OBSERVATION_FIELDS) && Object.values(INT8_OBSERVATION_FIELDS).every(Object.isFrozen));
ok("U06 catalogVersions and ledger queries are NOT normalized", !("catalogVersions" in INT8_OBSERVATION_FIELDS) && !("ledger" in INT8_OBSERVATION_FIELDS));

// ── value contract: accepted ──
for (const [s, n] of [["0", 0], ["1", 1], ["1000000", 1000000], ["2500000", 2500000], ["12000000", 12000000], ["9007199254740991", Number.MAX_SAFE_INTEGER]]) {
  const r = normalizeInt8Value(s); ok(`U07 canonical text ${JSON.stringify(s)} → number ${n}`, r.ok === true && r.value === n && typeof r.value === "number");
}
// ── G: Number input unchanged ──
for (const n of [0, 1, 1000000, Number.MAX_SAFE_INTEGER]) { const r = normalizeInt8Value(n); ok(`U08 safe integer Number ${n} accepted unchanged`, r.ok === true && r.value === n); }
// ── E: invalid integer text → refused (left unchanged by the row normalizer) ──
const INVALID = ["", " ", "   ", "\t", "1 ", " 1", "1.0", "1.5", "0.0", "1e6", "1E6", "-1", "-0", "+1", "01", "007", "0x10", "abc", "NaN", "Infinity", "1_000", "1,000", "١٢", "１２", "12\n"];
for (const s of INVALID) ok(`U09 invalid text ${JSON.stringify(s)} refused`, normalizeInt8Value(s).ok === false);
// ── F: unsafe integers → refused, no precision loss ──
for (const s of ["9007199254740992", "9007199254740993", "9223372036854775807", "18446744073709551616", "99999999999999999"]) ok(`U10 unsafe text ${s} refused`, normalizeInt8Value(s).ok === false);
for (const n of [Number.MAX_SAFE_INTEGER + 1, 2 ** 63, -1, -0, 1.5, NaN, Infinity, -Infinity]) ok(`U11 unsafe/negative/fractional Number ${String(n)} refused`, normalizeInt8Value(n).ok === false);
for (const v of [null, undefined, true, false, 10n, {}, [], [1], { valueOf: () => 1 }]) ok(`U12 non-string/non-number ${typeof v} ${String(v)} refused`, normalizeInt8Value(v).ok === false);

// ── row normalizer: exact query identity, exact fields, others untouched ──
const strEntry = { id: "e1", catalog_version_id: "v", provider: "openai", model: "m", service_tier: null, billing_dimension: "reasoning_input_token", currency_code: "USD",
  unit_size: "1000000", rate_micros: "2000000", effective_from: "2026-10-06T22:44:42Z", effective_until: null, verified_at: "2026-10-06T22:44:42Z",
  verification_expires_at: "2026-10-13T22:44:42Z", source_id: "s", source_digest: "d".repeat(64), status: "inactive", created_at: "2026-10-06T22:44:42Z" };
const [ne] = normalizeObservationRows(QUERIES.catalogEntries, [strEntry]);
ok("U13 entries: unit_size/rate_micros converted to numbers", ne.unit_size === 1000000 && ne.rate_micros === 2000000);
ok("H01 entries: every non-BIGINT column byte-identical (ids, digests, timestamps, status, nullable service_tier, null effective_until)",
  Object.keys(strEntry).filter((k) => k !== "unit_size" && k !== "rate_micros").every((k) => Object.is(ne[k], strEntry[k])) && ne.service_tier === null && ne.effective_until === null);
ok("U14 entries: input row object not mutated", strEntry.unit_size === "1000000" && strEntry.rate_micros === "2000000");
ok("U15 entries: key set and order preserved", Object.keys(ne).join(",") === Object.keys(strEntry).join(","));
const tierEntry = { ...strEntry, service_tier: "cache_write" };
ok("H02 entries: string service_tier untouched", normalizeObservationRows(QUERIES.catalogEntries, [tierEntry])[0].service_tier === "cache_write");
const ctl = { scope_type: "global", scope_key_digest: "global", control_epoch: "1", enabled: false, killed: false, record_digest: "r".repeat(64) };
const [nc] = normalizeObservationRows(QUERIES.controls, [ctl]);
ok("U16 controls: control_epoch → 1; booleans stay booleans; digests untouched", nc.control_epoch === 1 && nc.enabled === false && nc.killed === false && nc.record_digest === ctl.record_digest && nc.scope_type === "global");
const pol = { id: "p", project_id: "live-ai-03b", status: "inactive", session_money_ceiling_micros: "0", session_provider_calls: "0", session_execution_admissions: "0",
  subject_day_money_ceiling_micros: "0", project_day_money_ceiling_micros: "0", project_month_money_ceiling_micros: "0", global_day_money_ceiling_micros: "0", policy_digest: "x".repeat(64) };
const [np] = normalizeObservationRows(QUERIES.policy, [pol]);
ok("U17 policy: all 7 BIGINT fields → 0 (number); id/status/digest untouched", INT8_OBSERVATION_FIELDS.policy.every((f) => np[f] === 0) && np.id === "p" && np.status === "inactive" && np.policy_digest === pol.policy_digest);
// a column with a BIGINT-looking NAME but in a non-allowlisted query is untouched
const verRows = [{ id: "v", status: "inactive", effective_from: "x", effective_until: null, catalog_digest: "d", created_at: "x", unit_size: "1" }];
ok("U18 catalogVersions rows returned as the SAME reference (never normalized)", normalizeObservationRows(QUERIES.catalogVersions, verRows) === verRows && verRows[0].unit_size === "1");
const ledRows = [{ approval_id: "a", execution_id: "e", content_digest: "c", active_catalog_digest: "d", action: "activate", consumed_at: "2026-10-08T12:00:00Z" }];
ok("U19 ledger rows returned as the SAME reference", normalizeObservationRows(QUERIES.ledger, ledRows) === ledRows);
for (const sql of [...Object.values(LIFECYCLE_SQL), "SELECT 1", QUERIES.catalogEntries + " ", QUERIES.catalogEntries.toLowerCase(), "SELECT unit_size FROM public.budget_price_catalog_entries"]) {
  const r = [{ unit_size: "1", control_epoch: "1", v: "2000ms" }];
  ok(`U20 non-exact SQL is passthrough (same reference): ${sql.slice(0, 48)}`, normalizeObservationRows(sql, r) === r && r[0].unit_size === "1");
}
// E/F at row level: invalid values left UNCHANGED (no coercion) → frozen strict checks refuse
for (const bad of ["", " ", "1.0", "1e6", "-1", "abc", "9007199254740993", null]) {
  const [x] = normalizeObservationRows(QUERIES.catalogEntries, [{ ...strEntry, unit_size: bad }]);
  ok(`U21 invalid unit_size ${JSON.stringify(bad)} left unchanged (not coerced)`, Object.is(x.unit_size, bad) && x.rate_micros === 2000000);
}

// ── frozen-contract consequence on a fully realistic synthetic observation (string INT8, as node-postgres returns) ──
const strOf = (o, f) => ({ ...o, ...Object.fromEntries(f.map((k) => [k, String(o[k])])) });
const pred = [...G.entryRows(G.V1.id, G.V1_RATES, G.V1.t0, G.V1.expiry, G.V1.source_digest, "inactive"), ...G.entryRows(G.V2.id, G.V2_RATES, G.V2.t0, G.V2.expiry, G.V2.source_digest, "inactive")];
const v3 = reviewedV3Rows("inactive");
const versions = [{ id: G.V1.id, status: "inactive", effective_from: G.V1.t0, effective_until: null, catalog_digest: G.V1.inactive_catalog_digest, created_at: G.V1.t0 },
  { id: G.V2.id, status: "inactive", effective_from: G.V2.t0, effective_until: null, catalog_digest: G.V2.inactive_catalog_digest, created_at: G.V2.t0 }, v3.version];
const E = INT8_OBSERVATION_FIELDS.catalogEntries, P = INT8_OBSERVATION_FIELDS.policy, C = INT8_OBSERVATION_FIELDS.controls;
const policyN = { id: G.DORMANT.policy_id, project_id: "live-ai-03b", status: "inactive", ...Object.fromEntries(P.map((k) => [k, 0])), policy_digest: G.DORMANT.policy_digest };
const ctlN = [{ scope_type: "global", scope_key_digest: "global", control_epoch: 1, enabled: false, killed: false, record_digest: G.DORMANT.control_global_digest },
  { scope_type: "project", scope_key_digest: "live-ai-03b", control_epoch: 1, enabled: false, killed: false, record_digest: G.DORMANT.control_project_digest }];
const numObs = { versions, entries: [...pred, ...v3.entries], policyRows: [policyN], controlRows: ctlN };
const strObs = { versions, entries: numObs.entries.map((e) => strOf(e, E)), policyRows: [strOf(policyN, P)], controlRows: ctlN.map((c) => strOf(c, C)) };
ok("U22 synthetic number observation passes the frozen pre-activation contract (sanity)", checkPreActivationState(numObs, NOW).ok === true);
ok("U23 same observation with INT8-as-string (node-postgres shape) → predecessor_not_byte_exact", checkPreActivationState(strObs, NOW).reason === "predecessor_not_byte_exact");
const normObs = { versions: normalizeObservationRows(QUERIES.catalogVersions, strObs.versions), entries: normalizeObservationRows(QUERIES.catalogEntries, strObs.entries),
  policyRows: normalizeObservationRows(QUERIES.policy, strObs.policyRows), controlRows: normalizeObservationRows(QUERIES.controls, strObs.controlRows) };
ok("U24 normalized string observation passes the frozen pre-activation contract", checkPreActivationState(normObs, NOW).ok === true);
ok("U25 normalized observation is canonically identical to the number observation", G.canonicalize(normObs) === G.canonicalize(numObs));
// one invalid value in each family → refusal (fail closed, never a pass)
const withBad = (fam, val) => {
  const o = JSON.parse(JSON.stringify(strObs));
  if (fam === "pred") o.entries.find((e) => e.catalog_version_id === G.V1.id).rate_micros = val;
  if (fam === "v3") o.entries.find((e) => e.catalog_version_id === G.V3_ID).unit_size = val;
  if (fam === "policy") o.policyRows[0].session_provider_calls = val;
  if (fam === "control") o.controlRows[0].control_epoch = val;
  return checkPreActivationState({ versions: o.versions, entries: normalizeObservationRows(QUERIES.catalogEntries, o.entries), policyRows: normalizeObservationRows(QUERIES.policy, o.policyRows), controlRows: normalizeObservationRows(QUERIES.controls, o.controlRows) }, NOW);
};
for (const fam of ["pred", "v3", "policy", "control"]) for (const bad of ["", " ", "1.0", "1e6", "-1", "x", "9007199254740993", "01"]) {
  const r = withBad(fam, bad); ok(`E/F ${fam} invalid ${JSON.stringify(bad)} → frozen contract refuses (${r.reason})`, r.ok === false);
}

// ── wrapper surface (fake inner physical; no DB) ──
const calls = []; let closed = 0; let deadCb = null;
const innerRows = {};
const innerPhys = Object.freeze({ applicationName: "lai03b-reader:abc",
  async query(sql, params) { calls.push([sql, params]); innerRows[sql] = innerRows[sql] || { rows: sql === QUERIES.controls ? [{ ...ctl }] : [{ v: "2000ms" }] }; return innerRows[sql]; },
  onDead(cb) { deadCb = cb; }, isDead() { return closed > 0; }, async close() { closed++; } });
const fac = makeInt8NormalizingReaderPhysicalFactory({ kind: "pg", open: async () => innerPhys });
ok("W01 factory kind preserved, factory frozen", fac.kind === "pg" && Object.isFrozen(fac));
const ph = await fac.open();
ok("W02 wrapped physical exposes exactly the accepted 5-member reader surface", Object.keys(ph).sort().join(",") === "applicationName,close,isDead,onDead,query" && Object.isFrozen(ph));
ok("W03 applicationName identical", ph.applicationName === innerPhys.applicationName);
const lr = await ph.query(LIFECYCLE_SQL.readStatementTimeout, []);
ok("W04 lifecycle SQL: SAME result object passed through, same SQL+params forwarded", lr === innerRows[LIFECYCLE_SQL.readStatementTimeout] && calls.at(-1)[0] === LIFECYCLE_SQL.readStatementTimeout && Array.isArray(calls.at(-1)[1]));
const cr = await ph.query(QUERIES.controls, []);
ok("W05 controls observation normalized; the underlying result object not mutated", cr.rows[0].control_epoch === 1 && innerRows[QUERIES.controls].rows[0].control_epoch === "1" && Object.keys(cr).join(",") === "rows");
ok("W06 exactly one underlying query per wrapped query (no extra SQL issued)", calls.length === 2);
ph.onDead(() => {}); ok("W07 onDead delegates", typeof deadCb === "function");
ok("W08 isDead delegates (false before close)", ph.isDead() === false);
await ph.close(); ok("W09 close delegates; isDead true after", closed === 1 && ph.isDead() === true);
let refused = false, innerClosed = 0;
try { await makeInt8NormalizingReaderPhysicalFactory({ open: async () => ({ applicationName: "x", query: async () => ({ rows: [] }), close: async () => { innerClosed++; }, onDead() {}, isDead() { return false; }, extra: 1 }) }).open(); } catch (e) { refused = e.message === "reader_physical_shape_unexpected"; }
ok("W10 unexpected underlying physical shape → refused at open() and the connection closed", refused && innerClosed === 1);
let threw = false; try { makeInt8NormalizingReaderPhysicalFactory({}); } catch { threw = true; }
ok("W11 invalid inner factory rejected at construction", threw);
const r0 = { rows: "not-an-array" }; const p2 = await makeInt8NormalizingReaderPhysicalFactory({ open: async () => ({ applicationName: "a", query: async () => r0, close: async () => {}, onDead() {}, isDead() { return false; } }) }).open();
ok("W12 malformed driver result passed through unchanged (core then fails closed: query_rows_invalid)", (await p2.query(QUERIES.policy)) === r0);

// ── J: no write expansion — static properties of the helper source ──
const src = readFileSync(join(HERE, "../src/authority-v3-int8-observation-normalizer.mjs"), "utf8");
const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const codeNoAssert = code.split('.startsWith("SELECT ")').join("");   // the registry self-check assertion is not SQL
ok("J01 helper contains no SQL text of its own (no SELECT/INSERT/UPDATE/DELETE/ALTER/CREATE/GRANT/DROP literals)",
  code.split('.startsWith("SELECT ")').length === 2 && !/["'`]\s*(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|GRANT|DROP|TRUNCATE|COPY)\b/i.test(codeNoAssert));
ok("J02 helper imports only the frozen query registry (no pg, no network, no fs, no child_process)", (code.match(/^import .* from "([^"]+)";$/gm) || []).length === 1 && /v3-query-registry\.mjs/.test(code) && !/from "(pg|node:net|node:http|node:https|node:fs|node:child_process)"/.test(code));
ok("J03 helper never calls the underlying query except to forward the caller's exact (sql, params)", (code.match(/p\.query\(/g) || []).length === 1 && /p\.query\(sql, params\)/.test(code));
ok("J04 helper installs no global pg type parser (setTypeParser absent)", !/setTypeParser|types\.set/.test(code));
ok("J05 helper does not throw on data values (only on construction/shape)", (code.match(/throw new Error/g) || []).length === 5);
ok("J06 version constant", INT8_NORMALIZER_VERSION === "lai03b-v3-reader-int8-observation-normalizer-01");
done();
