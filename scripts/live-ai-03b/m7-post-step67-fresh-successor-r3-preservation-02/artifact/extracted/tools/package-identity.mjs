import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as G from '../src/v3-digest-gen.mjs';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
function walk(d){let a=[];for(const n of fs.readdirSync(d).sort()){const p=path.join(d,n),st=fs.statSync(p);if(st.isDirectory())a=a.concat(walk(p));else a.push(p);}return a;}
const excluded=new Set(['MANIFEST.json','IDENTITY-RECEIPT.json']);
const files=walk(root)
  .filter(p=>!excluded.has(path.relative(root,p).replaceAll('\\','/')))
  .map(p=>{const b=fs.readFileSync(p);return {path:path.relative(root,p).replaceAll('\\','/'),size:b.length,sha256:sha(b)};})
  .sort((a,b)=>a.path.localeCompare(b.path));

const manifest={
  contract:'M7FreshSuccessorRemediationR3PackageManifestV1',
  parent_commit:G.SUCCESSOR_PARENT_COMMIT,
  superseded_r2_zip_sha256:'de3ee5c2f2a8e987e4fbd674450e339b8186060148687ea5a03d144a12b3df1c',
  superseded_r1_harness_fix_zip_sha256:'83b2a81a07f6eca05a593d183c2eed8583dfefa8690ab9851054dfb492d64e75',
  rejected_predecessor_zip_sha256:'21e11bbb300b1b3150cca7d78415e539e16a3b22276047b9c20da80ce6674466',
  payload_count:files.length,
  files
};
const manifestText=JSON.stringify(manifest,null,2)+'\n';
const read=p=>{try{return fs.readFileSync(path.join(root,p),'utf8')}catch{return ''}};
const checks={
  digest:read('tests/out/digest.log').includes('"predecessor_self_check_ok": true'),
  sql_check:read('tests/out/sql-check.log').includes('SQL_CHECK_PASS 4/4'),
  core:read('tests/out/core.log').includes('core: 17 passed, 0 failed'),
  predecessor:read('tests/out/predecessor.log').includes('predecessor-compat: 9 passed, 0 failed'),
  sql_static:read('tests/out/sql-static.log').includes('sql-static: 15 passed, 0 failed'),
  runtime_static:read('tests/out/runtime-static.log').includes('runtime-static: 9 passed, 0 failed'),
  evidence_static:read('tests/out/evidence-static.log').includes('evidence-static: 8 passed, 0 failed'),
  executor_attestation_v2:read('tests/out/executor-attestation-v2.log').includes('executor-attestation-v2: 23 passed, 0 failed'),
  historical_rejected_identity:read('tests/out/historical-rejected-identity.log').includes('historical-rejected-identity: 2 passed, 0 failed'),
  secret_scan:read('tests/out/secret-scan.log').includes('SECRET_SCAN_PASS'),
  interleaving_proof_gate_r3:read('tests/out/interleaving-proof-gate.log').includes('interleaving-proof-gate-r3: 18 passed, 0 failed'),
  localpg_r3_single_observation:read('tests/out/localpg-expiry-lock.log').includes('A1_R3_LOCALPG_SINGLE_OBSERVATION_INTERLEAVING_PASS')
};
const nonPgOk=Object.entries(checks).filter(([k])=>k!=='localpg_r3_single_observation').every(([,v])=>v===true);
const allOk=Object.values(checks).every(v=>v===true);
const status=allOk?'R3_REMEDIATION_CANDIDATE_READY_FOR_ONE_INDEPENDENT_CLOSURE_REVIEW':'HOLD_PENDING_REAL_PG16_OR_PG18_R3_SINGLE_OBSERVATION_RUN';
const receipt={
  contract:'M7FreshSuccessorRemediationR3IdentityReceiptV1',
  status,
  parent_commit:G.SUCCESSOR_PARENT_COMMIT,
  t0:G.T0,
  verification_expiry:G.T0_PLUS_7_DAYS,
  catalog_version_id:G.V3_ID,
  source_digest:G.SOURCE_DIGEST_V3,
  inactive_catalog_digest:G.v3Inactive.digest,
  active_catalog_digest:G.v3Active.digest,
  activation_bundle_digest:G.v3Bundle.digest,
  one_call_policy_id:G.ONECALL_POLICY_ID,
  one_call_policy_digest:G.ONECALL_POLICY_ACTIVE_DIGEST,
  worst_case_micros:G.V3_WORST_CASE_MICROS,
  superseded_r2:{size:133362,sha256:'de3ee5c2f2a8e987e4fbd674450e339b8186060148687ea5a03d144a12b3df1c'},
  superseded_r1_harness_fix:{size:129570,sha256:'83b2a81a07f6eca05a593d183c2eed8583dfefa8690ab9851054dfb492d64e75'},
  rejected_predecessor:{size:57208,sha256:'21e11bbb300b1b3150cca7d78415e539e16a3b22276047b9c20da80ce6674466'},
  r3_scope:'HARNESS_AND_EVIDENCE_ONLY',
  r3_pre_observation_requirements:[
    'one single MATERIALIZED PostgreSQL observation row only',
    'exact activation PID B and blocker PID A',
    'observer PID distinct from A and B',
    'activation state active and wait_event_type Lock',
    'pg_blocking_pids(B) contains exact A with cardinality exactly one',
    'single sampled clock_timestamp strictly before expiry'
  ],
  r3_post_observation_requirements:[
    'one separate MATERIALIZED PostgreSQL observation row only',
    'same activation PID B and same exact blocker PID A',
    'observer PID distinct from A and B',
    'activation remains active in Lock wait on sole A',
    'single sampled clock_timestamp at or after same expiry',
    'blocker release forbidden until POST gate succeeds'
  ],
  negative_gate_regressions:[
    'r2-split-pre-valid-not-blocked-plus-post-expiry-blocked-cannot-compose',
    'already-expired-cannot-pass','never-blocked-cannot-pass','wrong-blocker-cannot-pass',
    'multiple-blockers-cannot-pass','same-backend-cannot-pass','observer-collision-cannot-pass',
    'early-release-cannot-pass','wrong-activation-post-cannot-pass','unrelated-error-cannot-pass','dirty-rollback-cannot-pass'
  ],
  executor_attestation_successor:{contract:'AiStagingExecutorAttestationV2',issuer:'staybid.live-ai-03b.executor-attester.v2',trusted_schema_usage_count:3,executable_routine_count:6},
  runtime_pin_status:'UNRESOLVED_BY_DESIGN_UNTIL_SEPARATE_PRESERVATION',
  tests:checks,
  deterministic_non_pg_checks_ok:nonPgOk,
  mandatory_localpg_r3_single_observation_ok:checks.localpg_r3_single_observation,
  manifest_sha256:sha(Buffer.from(manifestText)),
  payload_count:files.length,
  live_actions:{railway_write:0,github_write:0,live_db_connections:0,live_sql_executions:0,sql03:0,composition_runs:0,provider_calls:0,approval_signatures:0,restarts:0,redeploys:0,g4:0,g5:0,gateway_actions:0,core_prod_actions:0}
};
const mp=path.join(root,'MANIFEST.json'),rp=path.join(root,'IDENTITY-RECEIPT.json');
if(process.argv.includes('--check')){
  if(!fs.existsSync(mp)||!fs.existsSync(rp)){console.error('identity files absent');process.exit(2);}
  const m=fs.readFileSync(mp,'utf8'),r=JSON.parse(fs.readFileSync(rp,'utf8'));
  if(m!==manifestText||r.manifest_sha256!==receipt.manifest_sha256||r.status!==receipt.status||r.payload_count!==receipt.payload_count){console.error('PACKAGE_IDENTITY_MISMATCH');process.exit(2);}
  console.log(`PACKAGE_IDENTITY_PASS status=${status} payload=${files.length} manifest_sha256=${receipt.manifest_sha256}`);
  process.exit(0);
}
fs.writeFileSync(mp,manifestText);
fs.writeFileSync(rp,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
