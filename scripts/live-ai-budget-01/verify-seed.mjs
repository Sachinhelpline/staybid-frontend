// LIVE-AI-BUDGET-01 — dormant control/policy seed: deterministic OFFLINE verifier.
// Consolidated remediation 01 (P1-04): the verifier now STRUCTURALLY inspects the
// actual SQL artifact — extracting INSERT targets, column lists and literal values,
// the lock strategy, the complete 13-table precondition, the exact postcondition,
// and the transaction ordering — rather than relying on substring/digest presence
// or a generic INSERT count. No network, no DB, no clock. Uses only the Node
// runtime (no added parser/package). Exits non-zero on ANY failure.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EFFECTIVE_FROM,
  canonicalize,
  sha256hex,
  controlGlobalPayload,
  controlProjectPayload,
  policyPayload,
  controlGlobalDigest,
  controlProjectDigest,
  policyDigest,
} from './digest-gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SEED_SQL = join(REPO, 'migrations', '2026-09-16-live-ai-budget-01-dormant-control-policy-seed.sql');
const SCHEMA_SQL = join(REPO, 'migrations', '2026-09-16-live-ai-budget-01-dpbel-foundation.sql');
const DIGEST_GEN = join(HERE, 'digest-gen.mjs');
const VERIFY = join(HERE, 'verify-seed.mjs');
const MANIFEST = join(HERE, 'EVIDENCE-MANIFEST.json');

const ACCEPTED_COMMIT = '2b69ce28230fc9d56a035846e95d8de206d5db3b';
const ACCEPTED_TREE = '87aad22d90f84f2c3b307201c3e0d3b8658b1619';
const SCHEMA_BLOB_SHA1 = '5ddd43861a51c42d62e293216b702453493cd66e';
const TS = '2026-09-18T14:11:25Z';

// the exact 13 expected BUDGET tables
const EXPECTED_13 = [
  'budget_control_epochs', 'budget_decisions', 'budget_envelope_allocations', 'budget_envelopes',
  'budget_execution_consumptions', 'budget_policy_versions', 'budget_price_catalog_entries',
  'budget_price_catalog_versions', 'budget_provider_reservations', 'budget_provider_settlements',
  'budget_reconciliations', 'budget_scope_counters', 'budget_sessions',
].sort();
const OTHER_11 = EXPECTED_13.filter((t) => t !== 'budget_control_epochs' && t !== 'budget_policy_versions');

let failures = 0;
const log = [];
function check(name, cond, detail) {
  if (cond) log.push(`  PASS  ${name}`);
  else { failures++; log.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function sha256File(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function gitBlobSha1(buf) { const h = createHash('sha1'); h.update('blob ' + buf.length + '\0'); h.update(buf); return h.digest('hex'); }
function stripSqlComments(sql) { return sql.split('\n').map((l) => { const i = l.indexOf('--'); return i >= 0 ? l.slice(0, i) : l; }).join('\n'); }
function normVal(raw) {
  let v = raw.trim().replace(/::timestamptz$/i, '').trim();
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") v = v.slice(1, -1).replace(/''/g, "'");
  return v;
}
function mapEq(actual, expected) {
  const ak = Object.keys(actual).sort(), ek = Object.keys(expected).sort();
  if (ak.length !== ek.length || ak.join(',') !== ek.join(',')) return false;
  return ek.every((k) => actual[k] === expected[k]);
}

const seedRaw = readFileSync(SEED_SQL, 'utf8');
const seed = stripSqlComments(seedRaw);

// ── digests reproduce & self-agree ──
check('digest: control_global reproduces', sha256hex(canonicalize(controlGlobalPayload)) === controlGlobalDigest);
check('digest: control_project reproduces', sha256hex(canonicalize(controlProjectPayload)) === controlProjectDigest);
check('digest: policy reproduces', sha256hex(canonicalize(policyPayload)) === policyDigest);
check('digest: control digests independently distinct', controlGlobalDigest !== controlProjectDigest);
const pc = canonicalize(policyPayload);
check('canonical: no insignificant whitespace', !/[\n\t]/.test(pc) && !/, /.test(pc) && !/: /.test(pc));
check('canonical: keys sorted (domain first)', pc.startsWith('{"domain":'));

// ── P1-04.A: structured extraction of the actual INSERTs ──
const insertRe = /INSERT\s+INTO\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/g;
const inserts = [];
let m;
while ((m = insertRe.exec(seed)) !== null) {
  const table = m[1];
  const cols = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  const vals = m[3].split(',').map(normVal);
  const row = {};
  cols.forEach((c, i) => { row[c] = vals[i]; });
  inserts.push({ table, cols, vals, row, balanced: cols.length === vals.length });
}
check('sql: exactly 3 INSERT statements', inserts.length === 3, `found ${inserts.length}`);
check('sql: every INSERT column/value count balanced', inserts.every((i) => i.balanced));

const controlInserts = inserts.filter((i) => i.table === 'budget_control_epochs');
const policyInserts = inserts.filter((i) => i.table === 'budget_policy_versions');
check('sql: exactly 2 control-epoch INSERTs', controlInserts.length === 2);
check('sql: exactly 1 policy INSERT', policyInserts.length === 1);
check('sql: no INSERT targets any non-{control,policy} table',
  inserts.every((i) => i.table === 'budget_control_epochs' || i.table === 'budget_policy_versions'));

const EXP_GLOBAL = { scope_type: 'global', scope_key_digest: 'global', control_epoch: '1', enabled: 'false', killed: 'false', updated_at: TS, record_digest: controlGlobalDigest };
const EXP_PROJECT = { scope_type: 'project', scope_key_digest: 'live-ai-03b', control_epoch: '1', enabled: 'false', killed: 'false', updated_at: TS, record_digest: controlProjectDigest };
const EXP_POLICY = {
  id: 'live-ai-03b-policy-v1-dormant', project_id: 'live-ai-03b', status: 'inactive',
  effective_from: TS, effective_until: 'NULL',
  session_money_ceiling_micros: '0', session_provider_calls: '0', session_execution_admissions: '0',
  subject_day_money_ceiling_micros: '0', project_day_money_ceiling_micros: '0',
  project_month_money_ceiling_micros: '0', global_day_money_ceiling_micros: '0',
  policy_digest: policyDigest, created_at: TS,
};
const gRow = controlInserts.find((i) => i.row.scope_type === 'global');
const pRow = controlInserts.find((i) => i.row.scope_type === 'project');
check('sql: GLOBAL control row exact (all 7 fields)', !!gRow && mapEq(gRow.row, EXP_GLOBAL));
check('sql: PROJECT control row exact (all 7 fields)', !!pRow && mapEq(pRow.row, EXP_PROJECT));
check('sql: POLICY row exact (all 14 fields)', policyInserts.length === 1 && mapEq(policyInserts[0].row, EXP_POLICY));
check('sql: seven ceilings all literal 0', policyInserts.length === 1 &&
  ['session_money_ceiling_micros','session_provider_calls','session_execution_admissions','subject_day_money_ceiling_micros','project_day_money_ceiling_micros','project_month_money_ceiling_micros','global_day_money_ceiling_micros'].every((k) => policyInserts[0].row[k] === '0'));
check('sql: no inserted value is a wildcard "*"', inserts.every((i) => i.vals.every((v) => normVal(v) !== '*')));

// ── P1-04.D: lock strategy over exactly the 13 tables ──
const lockM = seed.match(/LOCK\s+TABLE([\s\S]*?)IN\s+SHARE\s+ROW\s+EXCLUSIVE\s+MODE\s*;/i);
check('sql: LOCK ... IN SHARE ROW EXCLUSIVE MODE present', !!lockM);
if (lockM) {
  const locked = lockM[1].split(',').map((s) => s.trim().replace(/^public\./, '')).filter(Boolean).sort();
  check('sql: lock covers exactly the 13 expected tables', locked.length === 13 && locked.join(',') === EXPECTED_13.join(','), locked.join(','));
}

// ── P1-04.B/C: complete 13-table precondition, all zero-row-checked ──
const preM = seedRaw.match(/DO \$precheck\$([\s\S]*?)\$precheck\$;/);
check('sql: precondition DO block present', !!preM);
if (preM) {
  const pre = preM[1];
  check('precond: references all 13 expected tables', EXPECTED_13.every((t) => pre.includes(`'${t}'`)));
  check('precond: existence check (to_regclass)', /to_regclass\('public\.'\s*\|\|\s*t\)\s*IS NULL/.test(pre));
  check('precond: unexpected-table guard', /unexpected/i.test(pre) && /NOT\s*\(\s*table_name\s*=\s*ANY\(expected\)\s*\)/i.test(pre));
  check('precond: exact-13 count guard', /<>\s*13/.test(pre));
  check('precond: per-table zero-row check before INSERT', /format\('SELECT count\(\*\) FROM public\.%I'/.test(pre) && /must be empty/.test(pre) && /<>\s*0/.test(pre));
}

// ── P1-04.E: exact postcondition ──
const postM = seedRaw.match(/DO \$postcheck\$([\s\S]*?)\$postcheck\$;/);
check('sql: postcondition DO block present', !!postM);
if (postM) {
  const post = postM[1];
  check('postcond: control-epoch count = 2 guard', /budget_control_epochs[\s\S]*?<>\s*2/.test(post));
  check('postcond: policy count = 1 guard', /budget_policy_versions[\s\S]*?<>\s*1/.test(post));
  check('postcond: wildcard-policy guard', /project_id\s*=\s*'\*'/.test(post));
  check('postcond: total = 3 guard', /<>\s*3/.test(post));
  check('postcond: exact global control assertion', post.includes(controlGlobalDigest) && /scope_type\s*=\s*'global'/.test(post));
  check('postcond: exact project control assertion', post.includes(controlProjectDigest) && /scope_key_digest\s*=\s*'live-ai-03b'/.test(post));
  check('postcond: exact policy assertion', post.includes(policyDigest) && /'live-ai-03b-policy-v1-dormant'/.test(post));
  check('postcond: references all 11 other tables (must remain empty)', OTHER_11.every((t) => post.includes(`'${t}'`)) && /must remain empty/.test(post));
}

// ── P1-04.H: transaction structure/order ──
const idx = (re) => seedRaw.search(re);
const iBegin = idx(/\bBEGIN\s*;/), iLock = idx(/LOCK\s+TABLE/i), iPre = seedRaw.indexOf('DO $precheck$');
const iIns = idx(/INSERT\s+INTO/i), iPost = seedRaw.indexOf('DO $postcheck$'), iCommit = idx(/\bCOMMIT\s*;/);
check('sql: transaction order BEGIN<LOCK<precond<INSERT<postcond<COMMIT',
  iBegin >= 0 && iLock > iBegin && iPre > iLock && iIns > iPre && iPost > iIns && iCommit > iPost,
  `[${iBegin},${iLock},${iPre},${iIns},${iPost},${iCommit}]`);
check('sql: single transaction (one BEGIN; one COMMIT;)',
  (seed.match(/\bBEGIN\s*;/g) || []).length === 1 && (seed.match(/\bCOMMIT\s*;/g) || []).length === 1);

// ── P1-04.G: prohibited DML / targets absent ──
const forbiddenKw = [['UPDATE', /\bupdate\b/i], ['DELETE', /\bdelete\b/i], ['TRUNCATE', /\btruncate\b/i], ['MERGE', /\bmerge\b/i], ['ON CONFLICT', /\bon\s+conflict\b/i], ['now()', /\bnow\s*\(/i], ['CURRENT_TIMESTAMP', /current_timestamp/i], ['clock_timestamp()', /\bclock_timestamp\s*\(/i]];
for (const [label, re] of forbiddenKw) check(`sql: no ${label}`, !re.test(seed));
for (const t of OTHER_11) check(`sql: no INSERT DML on ${t}`, !new RegExp('INSERT\\s+INTO\\s+public\\.' + t, 'i').test(seed));
check('sql: no test-fixture identifiers', !/\b(fixture|dummy|sample|foobar|example|demo)\b/i.test(seed) && !/\btest\b/i.test(seed));

// ── frozen schema unchanged (byte-identical to accepted baseline blob) ──
const schemaBuf = readFileSync(SCHEMA_SQL);
check('schema: git blob id == accepted baseline blob', gitBlobSha1(schemaBuf) === SCHEMA_BLOB_SHA1, gitBlobSha1(schemaBuf));

// ── manifest agreement ──
let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { manifest = null; }
check('manifest: parses', !!manifest);
if (manifest) {
  check('manifest: effective_from matches', manifest.effective_from === EFFECTIVE_FROM);
  check('manifest: accepted commit matches', manifest.accepted_baseline?.commit === ACCEPTED_COMMIT);
  check('manifest: accepted tree matches', manifest.accepted_baseline?.tree === ACCEPTED_TREE);
  check('manifest: schema blob sha matches', manifest.accepted_baseline?.schema_blob_sha1 === SCHEMA_BLOB_SHA1);
  check('manifest: control_global digest matches', manifest.digests?.control_global === controlGlobalDigest);
  check('manifest: control_project digest matches', manifest.digests?.control_project === controlProjectDigest);
  check('manifest: policy digest matches', manifest.digests?.policy === policyDigest);
  const wantHashes = {
    'migrations/2026-09-16-live-ai-budget-01-dormant-control-policy-seed.sql': sha256File(SEED_SQL),
    'scripts/live-ai-budget-01/digest-gen.mjs': sha256File(DIGEST_GEN),
    'scripts/live-ai-budget-01/verify-seed.mjs': sha256File(VERIFY),
    'migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql': sha256File(SCHEMA_SQL),
  };
  for (const [rel, h] of Object.entries(wantHashes)) {
    check(`manifest: sha256 recorded for ${rel}`, manifest.artifact_sha256?.[rel] === h, `expected ${h}`);
  }
}

process.stdout.write(log.join('\n') + '\n');
process.stdout.write(failures === 0 ? `\nRESULT: PASS (${log.length} checks)\n` : `\nRESULT: FAIL (${failures} failing of ${log.length})\n`);
process.exit(failures === 0 ? 0 : 1);
