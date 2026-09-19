// OFFLINE structural + coverage + acceptance-predicate-replay test for the LIVE-AI-03B deferred
// ledger-read grant (Artifact A) and read-only post-application verification (Artifact B). It
// evaluates the ACTUAL generated SQL bytes on disk. For the ledger CHECK/default logic it REPLAYS
// the candidate's OWN acceptance set (extracted from the SQL) under the candidate's OWN normalization
// against negative + positive examples — not a divergent test-only predicate. For privilege/CREATE/
// EXECUTE/USAGE/PUBLIC it uses static coverage + pre-grant execution-ordering analysis. It is NOT
// hosted-PostgreSQL execution: real dialect / effective-role behaviour is a FUTURE credential-backed
// gate (documented in the artifacts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "..");
const A = readFileSync(resolve(DIR, "deferred-ledger-read-grant.sql"), "utf8");
const B = readFileSync(resolve(DIR, "post-application-verification.sql"), "utf8");
const strip = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const As = strip(A), Bs = strip(B);

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const count = (re, s) => (s.match(re) || []).length;

const BUDGET13 = ["budget_policy_versions","budget_control_epochs","budget_price_catalog_versions","budget_price_catalog_entries","budget_sessions","budget_scope_counters","budget_envelopes","budget_envelope_allocations","budget_decisions","budget_provider_reservations","budget_provider_settlements","budget_execution_consumptions","budget_reconciliations"];
const READER12 = BUDGET13.filter((t) => t !== "budget_envelope_allocations");
const LEDGER_COLS = ["approval_id","execution_id","content_digest","active_catalog_digest","action","consumed_at"];

// extract a SQL `<name> text[] := ARRAY[ '..','..' ]` literal into a JS string[] (unescape '' -> ')
function extractArray(sql, name) {
  // terminate at "];" (the declaration end) so element-internal "]" (e.g. array[...]) is not truncated
  const m = sql.match(new RegExp(name + "\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];", ""));
  if (!m) return null;
  return (m[1].match(/'((?:[^']|'')*)'/g) || []).map((x) => x.slice(1, -1).replace(/''/g, "'"));
}
// the candidate's OWN comparators, mirrored exactly from the SQL.
// CHECK: the SQL now compares the RAW pg_get_constraintdef(oid) with NO lowercase and NO
// whitespace/'::text' transform (literal-exact) — so the replay comparator is the identity.
const normCheck = (s) => s;
const normDefault = (s) => s.toLowerCase().replace(/\s/g, "");

console.log("1. Artifact A — exact two-grant boundary + single transaction");
ok("A: exactly 2 executable GRANT statements", count(/^GRANT\b/gm, As) === 2);
ok("A: no REVOKE", count(/^REVOKE\b/gm, As) === 0);
ok("A: grant 1 = USAGE on trusted schema to reader", /^GRANT\s+USAGE\s+ON\s+SCHEMA\s+live_ai_03b_trusted\s+TO\s+live_ai_03b_reader;/m.test(As));
ok("A: grant 2 = SELECT on approval_consumption to reader", /^GRANT\s+SELECT\s+ON\s+live_ai_03b_trusted\.approval_consumption\s+TO\s+live_ai_03b_reader;/m.test(As));
ok("A: no third positive grant / no re-grant of public allowlist", !/^GRANT[^\n]*public\.budget_/m.test(As));
ok("A: no grant to PUBLIC", !/^GRANT[^\n]*\bTO\s+PUBLIC\b/mi.test(As));
ok("A: ON_ERROR_STOP + single transaction", /\\set ON_ERROR_STOP on/.test(A) && count(/^BEGIN;/gm, As) === 1 && count(/^COMMIT;/gm, As) === 1 && count(/^ROLLBACK/gm, As) === 0);
ok("A: no DML", !/^\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE)\b/mi.test(As));
ok("A: no DDL / role-alter / creation", !/\b(CREATE\s+(ROLE|SCHEMA|FUNCTION|TABLE)|DROP\s+\w|ALTER\s+ROLE)\b/i.test(As));
ok("A: no trusted-function invocation", !/\b(PERFORM|CALL|SELECT)\s+live_ai_03b_trusted\.(activate_catalog|restore_catalog_inactive)\s*\(/i.test(As));

console.log("2. Preserved — complete executor + reader privilege matrices (13 tables + ledger × 7)");
for (const [tag, sql] of [["A", A], ["B", B]]) {
  ok(`${tag}: all 13 BUDGET tables enumerated`, BUDGET13.every((t) => sql.includes(`'${t}'`)));
  ok(`${tag}: 7 table privileges enumerated`, /all_privs\s+text\[\]\s*:=\s*ARRAY\['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/.test(sql));
  ok(`${tag}: 6 write privileges enumerated`, /write_privs\s+text\[\]\s*:=\s*ARRAY\['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/.test(sql));
  ok(`${tag}: executor swept over (budget_tables || ledger) × all_privs`, /FOREACH t IN ARRAY \(budget_tables \|\| ARRAY\[[^\]]*\]\)/.test(sql) && /has_table_privilege\('live_ai_03b_executor'/.test(sql));
  ok(`${tag}: all 12 reader allowlist tables enumerated`, READER12.every((t) => sql.includes(`'${t}'`)));
  ok(`${tag}: excluded allocation denied all 7 privileges`, /FOREACH p IN ARRAY all_privs[\s\S]{0,220}budget_envelope_allocations/.test(sql));
  ok(`${tag}: role attrs incl REPLICATION + reader NOINHERIT + zero memberships`, /rolreplication=false/.test(sql) && /rolreplication=false AND rolinherit=false/.test(sql) && /pg_auth_members WHERE member/.test(sql));
  ok(`${tag}: effective has_*_privilege + explicit PUBLIC grantee-0 inspection`, /has_table_privilege\('live_ai_03b_(reader|executor)'/.test(sql) && /aclexplode/.test(sql) && /grantee=0/.test(sql));
}

console.log("3. R1 — reader public-schema USAGE required (A pre+post, B verify)");
ok("A: pre-grant requires reader public USAGE (HOLD)", /has_schema_privilege\('live_ai_03b_reader','public','USAGE'\)/.test(A) && /lacks accepted USAGE on public schema — HOLD/.test(A));
ok("A: post-grant re-proves reader public USAGE preserved", /post — reader lost public-schema USAGE/.test(A));
ok("B: verifier requires reader public USAGE", /has_schema_privilege\('live_ai_03b_reader','public','USAGE'\)/.test(B) && /reader lacks accepted USAGE on the public schema/.test(B));
ok("both: no added USAGE grant to fix R1 (only the two accepted grants exist)", count(/^GRANT\b/gm, As) === 2 && count(/^\s*GRANT\b/gmi, Bs) === 0);

console.log("4. CHECK-LITERAL FIX — case/whitespace-EXACT canonical comparison (predicate replay)");
for (const [tag, sql] of [["A", A], ["B", B]]) {
  const forms = extractArray(sql, "accepted_check_forms");
  // forms must be case-preserving (lowercase literals, uppercase keywords) canonical renderings
  ok(`${tag}: accepted_check_forms extracted (>=2 case-preserving canonical forms)`, Array.isArray(forms) && forms.length >= 2 && forms.every((f) => f.startsWith("CHECK (") && f.includes("'activate'") && f.includes("'restore'")));
  // the SQL compares the RAW pg_get_constraintdef and NO LONGER applies the lossy lower()+strip-whitespace(+::text) transform
  ok(`${tag}: compares RAW pg_get_constraintdef(oid) INTO v_chk (no wrapper transform)`, /SELECT pg_get_constraintdef\(oid\) INTO v_chk/.test(sql) && /<> ALL \(accepted_check_forms\)/.test(sql));
  ok(`${tag}: lossy lower()/strip-whitespace/::text normalization of the constraintdef is GONE`, !/lower\(regexp_replace\(regexp_replace\(pg_get_constraintdef/.test(sql) && !/pg_get_constraintdef\(oid\),'::text'/.test(sql) && !/pg_get_constraintdef\(oid\)[^\n]*'\\s'/.test(sql));
  ok(`${tag}: no permissive ILIKE/keyword CHECK fallback`, !/pg_get_constraintdef\(oid\)\s+ILIKE/i.test(sql) && !/pg_get_constraintdef\(oid\)\s+LIKE/i.test(sql));
  // REPLAY the candidate's ACTUAL comparator (raw equality against its own extracted allowlist)
  const accept = (def) => forms.includes(normCheck(def));
  ok(`${tag}: REPLAY legitimate CHECK accepted (canonical =ANY(ARRAY[...]))`, accept("CHECK (action = ANY (ARRAY['activate'::text, 'restore'::text]))"));
  ok(`${tag}: REPLAY legitimate CHECK accepted (double-paren variant)`, accept("CHECK ((action = ANY (ARRAY['activate'::text, 'restore'::text])))"));
  // the two DEFECT cases WORK demonstrated — must now be REJECTED
  ok(`${tag}: REPLAY uppercase quoted values REJECTED ('ACTIVATE','RESTORE')`, !accept("CHECK (action = ANY (ARRAY['ACTIVATE'::text, 'RESTORE'::text]))"));
  ok(`${tag}: REPLAY embedded-whitespace value REJECTED ('act ivate')`, !accept("CHECK (action = ANY (ARRAY['act ivate'::text, 'restore'::text]))") && !accept("CHECK (action = ANY (ARRAY['activate'::text, 'res tore'::text]))"));
  // the previously-covered incompatible predicates stay rejected
  ok(`${tag}: REPLAY reversed-operator CHECK rejected`, !accept("CHECK ((action <> 'activate'::text) AND (action <> 'restore'::text))"));
  ok(`${tag}: REPLAY extra-action CHECK rejected`, !accept("CHECK (action = ANY (ARRAY['activate'::text, 'restore'::text, 'delete'::text]))"));
  ok(`${tag}: REPLAY incompatible-boolean CHECK rejected`, !accept("CHECK (((action = 'activate'::text) AND (action = 'restore'::text)))"));
  ok(`${tag}: REPLAY missing-action CHECK rejected`, !accept("CHECK (action = ANY (ARRAY['activate'::text]))"));
  ok(`${tag}: REPLAY altered-action CHECK rejected`, !accept("CHECK (action = ANY (ARRAY['activ'::text, 'restore'::text]))"));
}

console.log("5. R2 — EXACT consumed_at default (predicate replay, not prefix)");
for (const [tag, sql] of [["A", A], ["B", B]]) {
  const forms = extractArray(sql, "accepted_default_forms");
  ok(`${tag}: accepted_default_forms extracted (now())`, Array.isArray(forms) && forms.includes("now()"));
  ok(`${tag}: uses <> ALL (accepted_default_forms) exact match (no LIKE prefix)`, /<> ALL \(accepted_default_forms\)/.test(sql) && !/column_default LIKE|d NOT LIKE|d LIKE 'now\(\)%'/.test(sql));
  const accept = (dflt) => dflt != null && forms.includes(normDefault(dflt));
  ok(`${tag}: REPLAY now() default accepted`, accept("now()"));
  ok(`${tag}: REPLAY missing default rejected`, !accept(null) && !accept(""));
  ok(`${tag}: REPLAY different-function default rejected`, !accept("clock_timestamp()"));
  ok(`${tag}: REPLAY now()+expression default rejected`, !accept("now() + '00:00:05'::interval"));
  ok(`${tag}: REPLAY cast-wrapped default rejected`, !accept("(now())::timestamp with time zone"));
}

console.log("6. R2 — exact ledger shape (columns/PK/UNIQUE/constraint-count preserved)");
for (const [tag, sql] of [["A", A], ["B", B]]) {
  ok(`${tag}: all 6 columns individually checked`, LEDGER_COLS.every((c) => sql.includes(`column_name='${c}'`)));
  ok(`${tag}: consumed_at typed timestamptz; 5 text cols NOT NULL no-default`, /data_type='timestamp with time zone'/.test(sql) && /data_type='text'/.test(sql) && /is_nullable='NO'/.test(sql) && /column_default IS NULL/.test(sql));
  ok(`${tag}: PK (approval_id) + UNIQUE uniq_approval_execution + 3-constraint/no-FK`, sql.includes("PRIMARY KEY (approval_id)") && sql.includes("UNIQUE (approval_id, execution_id)") && /<>\s*3/.test(sql) && /contype='f'/.test(sql));
}

console.log("7. R3 — pre-grant execution ordering (all critical checks BEFORE the first GRANT)");
const firstGrant = As.search(/^GRANT\b/m);
ok("A: a first GRANT statement exists", firstGrant > 0);
const preGrantMarkers = [
  "lacks accepted USAGE on public schema — HOLD",                                 // R1
  "reader unexpectedly holds CREATE on the public schema (pre-grant)",            // R3.B
  "reader unexpectedly holds CREATE on the trusted schema (pre-grant)",           // R3.C
  "executor unexpectedly holds CREATE on the public schema (pre-grant)",          // R3.D
  "executor unexpectedly holds CREATE on the trusted schema (pre-grant)",         // R3.D
  "reader unexpectedly holds trusted-function EXECUTE (pre-grant)",               // R3.E
  "executor lacks required EXECUTE on an accepted trusted function (pre-grant)",  // R3.F
  "PUBLIC holds trusted-function EXECUTE (pre-grant)",                            // R3.G
  "executor unexpectedly holds",                                                  // R3.H executor table sweep (pre-grant)
  "reader unexpectedly holds % on the EXCLUDED public.budget_envelope_allocations (pre-grant)", // reader matrix (pre-grant)
  "ledger action CHECK is not the accepted canonical definition",                 // R2 shape (pre-grant)
  "ledger consumed_at default is not the accepted now()",                         // R2 default (pre-grant)
  "reader attributes are not the accepted least-privilege shape",                 // roles (pre-grant)
];
// use the comment-preserving A (RAISE messages live in code, not comments) but measure against As offsets consistently
const Araw = A; const firstGrantRaw = Araw.search(/^GRANT\b/m);
for (const m of preGrantMarkers) {
  const idx = Araw.indexOf(m);
  ok(`A: pre-grant check present AND before first GRANT — "${m.slice(0, 46)}"`, idx > 0 && idx < firstGrantRaw);
}
ok("A: post-grant block still present (end-state re-proof)", /\$post\$/.test(A) && Araw.indexOf("$post$") > firstGrantRaw);

console.log("8. Artifact B — read-only + fail-closed posture");
ok("B: ON_ERROR_STOP + READ ONLY tx + default_transaction_read_only", /\\set ON_ERROR_STOP on/.test(B) && /^BEGIN READ ONLY;/m.test(Bs) && /SET default_transaction_read_only = on;/.test(B));
ok("B: finite statement timeout", /SET statement_timeout/.test(B));
ok("B: ends with ROLLBACK, no COMMIT", count(/^ROLLBACK;/gm, Bs) === 1 && count(/^COMMIT;/gm, Bs) === 0);
ok("B: SELECT-only — no GRANT/REVOKE", count(/^\s*(GRANT|REVOKE)\b/gmi, Bs) === 0);
ok("B: SELECT-only — no DML statements", !/^\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE)\b/mi.test(Bs));
ok("B: SELECT-only — no DDL", !/\b(CREATE\s+(ROLE|SCHEMA|FUNCTION|TABLE)|DROP\s+\w|ALTER\s+(ROLE|TABLE|FUNCTION))\b/i.test(Bs));
ok("B: no trusted-function invocation", !/\b(PERFORM|CALL|SELECT)\s+live_ai_03b_trusted\.(activate_catalog|restore_catalog_inactive)\s*\(/i.test(Bs));
ok("B: no unexpected trusted-schema objects (1 table + 2 functions)", /expected exactly 1\)/.test(B) && /expected exactly 2\)/.test(B));
ok("B: SECURITY DEFINER + empty search_path checked", /prosecdef=true/.test(B) && /'search_path=' = ANY/.test(B));
ok("B: lifecycle readout informational (NOTICE not EXCEPTION)", /info \(lifecycle-dependent\)/.test(B));

console.log("9. Fail-closed density + provenance + honesty");
ok("A: fail-fast RAISE density", count(/RAISE EXCEPTION/g, As) >= 28);
ok("B: fail-closed RAISE density", count(/RAISE EXCEPTION/g, Bs) >= 24);
const coreProof = (s) => s.includes("b7362594-a01b-4623-a982-394707a6cec2") && /NEVER CORE-PROD/.test(s) && s.includes("1fbd7632");
ok("both: AI-STAGING only, never CORE-PROD (per file)", coreProof(A) && coreProof(B));
ok("both: UNAPPLIED banner", /UNAPPLIED/.test(A) && /UNAPPLIED/.test(B));
ok("both: future credential-backed / hosted-PG gate documented", /FUTURE credential-backed/i.test(A) && /FUTURE/i.test(A) && /FUTURE credential-backed/i.test(B));
ok("no live DB call / dblink / copy in either artifact", !/\b(dblink|COPY\s+|pg_read_server_files|\\c\b|\\connect)\b/i.test(As + Bs));

console.log("\n══════════════════════════════════════════════════════════");
console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exit(1); }
console.log("OFFLINE STRUCTURAL + COVERAGE + PREDICATE-REPLAY VERIFICATION: PASS");
console.log("SCOPE: static coverage + candidate-acceptance-predicate replay (CHECK/default) + pre-grant ordering over the actual SQL bytes — NOT hosted-PostgreSQL execution or effective-role proof (future credential-backed gate).");
process.exit(0);
