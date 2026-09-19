// LIVE-AI-BUDGET-01 — inactive price-catalog seed: deterministic OFFLINE verifier.
// Structurally inspects the ACTUAL SQL artifact, reconstructs the source + catalog
// canonical payloads from the ACTUAL inserted rows, reproduces both digests, and
// proves transaction structure, precondition, postcondition, exclusions, and
// predecessor identity. Node built-ins only; no network, no DB, no clock. Exit !=0 on any failure.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  T0, T0_PLUS_7_DAYS, canonicalize, sha256hex,
  CATALOG_DOMAIN, CATALOG_VERSION_ID, SOURCE_ID, SOURCE_URL,
  sourceDigest, catalogDigest,
} from './price-catalog-digest-gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SEED = join(REPO, 'migrations', '2026-09-18-live-ai-budget-01-inactive-price-catalog-seed.sql');
const SCHEMA = join(REPO, 'migrations', '2026-09-16-live-ai-budget-01-dpbel-foundation.sql');
const DORMANT = join(REPO, 'migrations', '2026-09-16-live-ai-budget-01-dormant-control-policy-seed.sql');
const GEN = join(HERE, 'price-catalog-digest-gen.mjs');
const VERIFY = join(HERE, 'verify-price-catalog-seed.mjs');
const MANIFEST = join(HERE, 'PRICE-CATALOG-EVIDENCE-MANIFEST.json');

const SCHEMA_BLOB = '5ddd43861a51c42d62e293216b702453493cd66e';
const DORMANT_BLOB = 'e58b2e9706cfae207969817c9a856ce55e8e5cb1';
const EXPECTED_13 = ['budget_control_epochs','budget_decisions','budget_envelope_allocations','budget_envelopes','budget_execution_consumptions','budget_policy_versions','budget_price_catalog_entries','budget_price_catalog_versions','budget_provider_reservations','budget_provider_settlements','budget_reconciliations','budget_scope_counters','budget_sessions'].sort();
const NINE_ZERO = ['budget_decisions','budget_envelope_allocations','budget_envelopes','budget_execution_consumptions','budget_provider_reservations','budget_provider_settlements','budget_reconciliations','budget_scope_counters','budget_sessions'];

let failures = 0; const log = [];
const check = (n, c, d) => { if (c) log.push('  PASS  ' + n); else { failures++; log.push('  FAIL  ' + n + (d ? ' — ' + d : '')); } };
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const gitBlob = (p) => { const b = readFileSync(p); const h = createHash('sha1'); h.update('blob ' + b.length + '\0'); h.update(b); return h.digest('hex'); };
const strip = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
function normVal(raw) { let v = raw.trim().replace(/::timestamptz$/i, '').trim(); if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") v = v.slice(1, -1).replace(/''/g, "'"); return v; }
const toNull = (v) => (v === 'NULL' ? null : v);

// full byte-exact predecessor structural proofs over a DO-block body
const T1411 = '2026-09-18T14:11:25Z';
function fullControls(b) {
  return /scope_type\s*=\s*'global'/.test(b) && /scope_key_digest\s*=\s*'global'/.test(b)
    && /scope_type\s*=\s*'project'/.test(b) && /scope_key_digest\s*=\s*'live-ai-03b'/.test(b)
    && (b.match(/control_epoch\s*=\s*1/g) || []).length >= 2
    && (b.match(/enabled\s*=\s*false/g) || []).length >= 2
    && (b.match(/killed\s*=\s*false/g) || []).length >= 2
    && (b.match(new RegExp("updated_at\\s*=\\s*'" + T1411 + "'", 'g')) || []).length >= 2
    && b.includes('26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee')
    && b.includes('be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f');
}
function fullPolicy(b) {
  const ceils = ['session_money_ceiling_micros', 'session_provider_calls', 'session_execution_admissions', 'subject_day_money_ceiling_micros', 'project_day_money_ceiling_micros', 'project_month_money_ceiling_micros', 'global_day_money_ceiling_micros'];
  return /id\s*=\s*'live-ai-03b-policy-v1-dormant'/.test(b) && /project_id\s*=\s*'live-ai-03b'/.test(b)
    && /status\s*=\s*'inactive'/.test(b)
    && new RegExp("effective_from\\s*=\\s*'" + T1411 + "'").test(b)
    && /effective_until IS NULL/.test(b)
    && ceils.every((c) => new RegExp(c + "\\s*=\\s*0").test(b))
    && b.includes('cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4')
    && new RegExp("created_at\\s*=\\s*'" + T1411 + "'").test(b);
}

const raw = readFileSync(SEED, 'utf8');
const sql = strip(raw);

// ── parse the three INSERTs ──
const insertRe = /INSERT\s+INTO\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/g;
const inserts = []; let m;
while ((m = insertRe.exec(sql)) !== null) {
  const cols = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  const vals = m[3].split(',').map(normVal);
  const row = {}; cols.forEach((c, i) => { row[c] = vals[i]; });
  inserts.push({ table: m[1], cols, vals, row });
}
check('sql: exactly 3 INSERT statements', inserts.length === 3, 'found ' + inserts.length);
const verIns = inserts.filter((i) => i.table === 'budget_price_catalog_versions');
const entIns = inserts.filter((i) => i.table === 'budget_price_catalog_entries');
check('sql: exactly 1 version INSERT', verIns.length === 1);
check('sql: exactly 2 entry INSERTs', entIns.length === 2);
check('sql: no INSERT into any other table', inserts.every((i) => i.table === 'budget_price_catalog_versions' || i.table === 'budget_price_catalog_entries'));

// ── exact version row ──
const EXP_VER = { id: CATALOG_VERSION_ID, status: 'inactive', effective_from: T0, effective_until: 'NULL', catalog_digest: catalogDigest, created_at: T0 };
const verOk = verIns.length === 1 && Object.keys(EXP_VER).every((k) => verIns[0].row[k] === EXP_VER[k]) && Object.keys(verIns[0].row).length === Object.keys(EXP_VER).length;
check('sql: catalog version row exact (id/status/dates/digest)', verOk);

// ── exact entry rows ──
function expEntry(idSuffix, dim, rate) {
  return { id: CATALOG_VERSION_ID + idSuffix, catalog_version_id: CATALOG_VERSION_ID, provider: 'openai', model: 'gpt-5.6-terra', service_tier: 'NULL', billing_dimension: dim, currency_code: 'USD', unit_size: '1000000', rate_micros: rate, effective_from: T0, effective_until: 'NULL', verified_at: T0, verification_expires_at: T0_PLUS_7_DAYS, source_id: SOURCE_ID, source_digest: sourceDigest, status: 'inactive', created_at: T0 };
}
const EXP_IN = expEntry('-reasoning-input-token-base', 'reasoning_input_token', '2000000');
const EXP_OUT = expEntry('-reasoning-output-token-base', 'reasoning_output_token', '12000000');
const inRow = entIns.find((i) => i.row.billing_dimension === 'reasoning_input_token');
const outRow = entIns.find((i) => i.row.billing_dimension === 'reasoning_output_token');
const entryEq = (r, e) => !!r && Object.keys(e).every((k) => r.row[k] === e[k]) && Object.keys(r.row).length === Object.keys(e).length;
check('sql: INPUT entry row exact (all 17 fields)', entryEq(inRow, EXP_IN));
check('sql: OUTPUT entry row exact (all 17 fields)', entryEq(outRow, EXP_OUT));

// ── reconstruct SOURCE payload from ACTUAL entry rows → source_digest ──
if (inRow && outRow) {
  const rateObj = (r) => ({ billing_dimension: r.row.billing_dimension, rate_micros: parseInt(r.row.rate_micros, 10), service_tier: toNull(r.row.service_tier), unit_size: parseInt(r.row.unit_size, 10) });
  const rates = [inRow, outRow].map(rateObj).sort((a, b) => (a.billing_dimension < b.billing_dimension ? -1 : 1));
  const srcRe = {
    context_tier: 'short', currency: inRow.row.currency_code, model: inRow.row.model, processing_mode: 'standard',
    provider: inRow.row.provider, rates, source_id: inRow.row.source_id, source_url: SOURCE_URL, verified_at: inRow.row.verified_at,
  };
  const srcDigestRe = sha256hex(canonicalize(srcRe));
  check('reconstruct: source_digest from seed rows == generator', srcDigestRe === sourceDigest, srcDigestRe);
  check('reconstruct: source_digest == digest embedded in seed rows', srcDigestRe === inRow.row.source_digest && srcDigestRe === outRow.row.source_digest);
}

// ── reconstruct CATALOG payload from ACTUAL rows → catalog_digest ──
if (verOk && inRow && outRow) {
  const entryObj = (r) => ({ id: r.row.id, catalog_version_id: r.row.catalog_version_id, provider: r.row.provider, model: r.row.model, service_tier: toNull(r.row.service_tier), billing_dimension: r.row.billing_dimension, currency_code: r.row.currency_code, unit_size: parseInt(r.row.unit_size, 10), rate_micros: parseInt(r.row.rate_micros, 10), effective_from: r.row.effective_from, effective_until: toNull(r.row.effective_until), verified_at: r.row.verified_at, verification_expires_at: r.row.verification_expires_at, source_id: r.row.source_id, source_digest: r.row.source_digest, status: r.row.status, created_at: r.row.created_at });
  const entriesRe = [inRow, outRow].map(entryObj).sort((a, b) => (a.id < b.id ? -1 : 1));
  const catRe = {
    catalog_version: { id: verIns[0].row.id, status: verIns[0].row.status, effective_from: verIns[0].row.effective_from, effective_until: toNull(verIns[0].row.effective_until), created_at: verIns[0].row.created_at },
    domain: CATALOG_DOMAIN, entries: entriesRe,
  };
  const catDigestRe = sha256hex(canonicalize(catRe));
  check('reconstruct: catalog_digest from seed rows == generator', catDigestRe === catalogDigest, catDigestRe);
  check('reconstruct: catalog_digest == digest embedded in seed version row', catDigestRe === verIns[0].row.catalog_digest);
}

// ── frozen timestamps present ──
check('sql: frozen T0 present', raw.includes(T0));
check('sql: frozen T0+7d present', raw.includes(T0_PLUS_7_DAYS));

// ── lock set ──
const lockM = sql.match(/LOCK\s+TABLE([\s\S]*?)IN\s+SHARE\s+ROW\s+EXCLUSIVE\s+MODE\s*;/i);
check('sql: SHARE ROW EXCLUSIVE lock present', !!lockM);
if (lockM) { const locked = lockM[1].split(',').map((s) => s.trim().replace(/^public\./, '')).filter(Boolean).sort(); check('sql: lock covers exactly the 13 tables', locked.length === 13 && locked.join(',') === EXPECTED_13.join(',')); }

// ── precondition ──
const preM = raw.match(/DO \$precheck\$([\s\S]*?)\$precheck\$;/);
check('sql: precondition block present', !!preM);
if (preM) { const p = preM[1];
  check('precond: all 13 tables referenced', EXPECTED_13.every((t) => p.includes("'" + t + "'")));
  check('precond: control=2 + BOTH controls full byte-exact', /control_epochs\)\s*<>\s*2/.test(p) && fullControls(p));
  check('precond: policy=1 + policy full byte-exact', /policy_versions\)\s*<>\s*1/.test(p) && fullPolicy(p));
  check('precond: catalog versions+entries must be empty', /price_catalog_versions\)\s*<>\s*0/.test(p) && /price_catalog_entries\)\s*<>\s*0/.test(p));
  check('precond: total 3 guard', /<>\s*3/.test(p));
  check('precond: nothing active guard', /enabled=true/.test(p) && /status='active'/.test(p));
}

// ── postcondition ──
const postM = raw.match(/DO \$postcheck\$([\s\S]*?)\$postcheck\$;/);
check('sql: postcondition block present', !!postM);
if (postM) { const p = postM[1];
  check('postcond: controls preserved (2 + BOTH full byte-exact)', /control_epochs\)\s*<>\s*2/.test(p) && fullControls(p));
  check('postcond: policy preserved (1 + full byte-exact)', /policy_versions\)\s*<>\s*1/.test(p) && fullPolicy(p));
  check('postcond: version=1 + catalog_digest', /price_catalog_versions\)\s*<>\s*1/.test(p) && p.includes(catalogDigest));
  check('postcond: entries=2 + input/output + source_digest', /price_catalog_entries\)\s*<>\s*2/.test(p) && p.includes('reasoning_input_token') && p.includes('reasoning_output_token') && p.includes(sourceDigest));
  check('postcond: no-active + wildcard + alternate + distinct-dim guards', /no active catalog/.test(p) && /wildcard/.test(p) && /alternate provider/.test(p) && /count\(DISTINCT billing_dimension\)/.test(p));
  check('postcond: nine other tables + total 6 guard', NINE_ZERO.every((t) => p.includes("'" + t + "'")) && /<>\s*6/.test(p));
}

// ── transaction order ──
const idx = (re) => raw.search(re);
const iB = idx(/\bBEGIN\s*;/), iL = idx(/LOCK\s+TABLE/i), iPre = raw.indexOf('DO $precheck$'), iIns = idx(/INSERT\s+INTO/i), iPost = raw.indexOf('DO $postcheck$'), iC = idx(/\bCOMMIT\s*;/);
check('sql: order BEGIN<LOCK<precond<INSERT<postcond<COMMIT', iB >= 0 && iL > iB && iPre > iL && iIns > iPre && iPost > iIns && iC > iPost, `[${iB},${iL},${iPre},${iIns},${iPost},${iC}]`);
check('sql: single transaction', (sql.match(/\bBEGIN\s*;/g) || []).length === 1 && (sql.match(/\bCOMMIT\s*;/g) || []).length === 1);

// ── prohibited DML + exclusions ──
for (const [lbl, re] of [['UPDATE', /\bupdate\b/i], ['DELETE', /\bdelete\b/i], ['TRUNCATE', /\btruncate\b/i], ['MERGE', /\bmerge\b/i], ['ON CONFLICT', /\bon\s+conflict\b/i], ['now()', /\bnow\s*\(/i], ['CURRENT_TIMESTAMP', /current_timestamp/i], ['clock_timestamp()', /\bclock_timestamp\s*\(/i]]) check('sql: no ' + lbl, !re.test(sql));
check('sql: no wildcard literal in inserted values', inserts.every((i) => i.vals.every((v) => normVal(v) !== '*')));
const excluded = ['cached_input', 'cache_write', 'stt', 'tts', 'audio', 'input_audio', 'output_audio', 'batch', 'flex', 'fast', 'priority'];
check('sql: excluded dimensions/tiers absent from inserted values', entIns.every((i) => !excluded.includes(i.row.billing_dimension) && !excluded.includes(String(i.row.service_tier).toLowerCase())));
check('sql: only openai / gpt-5.6-terra / USD in entries', entIns.every((i) => i.row.provider === 'openai' && i.row.model === 'gpt-5.6-terra' && i.row.currency_code === 'USD'));

// ── predecessor identity ──
check('predecessor: dpbel schema blob unchanged', gitBlob(SCHEMA) === SCHEMA_BLOB, gitBlob(SCHEMA));
check('predecessor: dormant seed blob unchanged', gitBlob(DORMANT) === DORMANT_BLOB, gitBlob(DORMANT));

// ── manifest agreement ──
let man; try { man = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { man = null; }
check('manifest: parses', !!man);
if (man) {
  check('manifest: T0 matches', man.T0 === T0);
  check('manifest: T0+7 matches', man.T0_PLUS_7_DAYS === T0_PLUS_7_DAYS);
  check('manifest: source_digest matches', man.source_digest === sourceDigest);
  check('manifest: catalog_digest matches', man.catalog_digest === catalogDigest);
  check('manifest: source anchor commit', man.source_anchor?.head === 'e023cecc2da02bd5fe5b9e19cad78cc4ab70539f');
  check('manifest: schema blob recorded', man.predecessors?.schema_git_blob === SCHEMA_BLOB);
  check('manifest: dormant seed blob recorded', man.predecessors?.dormant_seed_git_blob === DORMANT_BLOB);
  const want = { 'migrations/2026-09-18-live-ai-budget-01-inactive-price-catalog-seed.sql': sha256File(SEED), 'scripts/live-ai-budget-01/price-catalog-digest-gen.mjs': sha256File(GEN), 'scripts/live-ai-budget-01/verify-price-catalog-seed.mjs': sha256File(VERIFY) };
  for (const [rel, h] of Object.entries(want)) check('manifest: sha256 recorded for ' + rel, man.artifact_sha256?.[rel] === h, 'expected ' + h);
}

process.stdout.write(log.join('\n') + '\n');
process.stdout.write(failures === 0 ? `\nRESULT: PASS (${log.length} checks)\n` : `\nRESULT: FAIL (${failures} of ${log.length})\n`);
process.exit(failures === 0 ? 0 : 1);
