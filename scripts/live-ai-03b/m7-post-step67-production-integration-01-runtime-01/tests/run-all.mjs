import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createV3ProductionIntegrationCore } from '../src/v3-integration-core.mjs';
import { makeGuardedExecutorClientV3, makeGuardedReaderClientV3 } from '../src/v3-guarded-clients.mjs';
import { PINNED_RUNTIME_BINDING, PINNED_SUCCESSOR_RUNTIME_PIN_REF, localRuntimePinRef, checkPinnedRuntimeBinding } from '../src/runtime-preservation-binding.mjs';

let pass=0, fail=0;
async function test(name,fn){try{await fn();pass++;console.log('PASS '+name);}catch(e){fail++;console.error('FAIL '+name+' :: '+(e?.stack||e));}}
const clone=x=>JSON.parse(JSON.stringify(x));

const Q=Object.freeze({
  catalogEntries:'SELECT entries', catalogVersions:'SELECT versions', controls:'SELECT controls', ledger:'SELECT ledger WHERE approval_id=$1 AND execution_id=$2', policy:'SELECT policy'
});
const ACT='SELECT live_ai_03b_trusted_v3.activate_catalog_v3($1::jsonb, $2)';
const claims=Object.freeze({contract:'VerifiedApprovalClaimsV3',approval_id:'approval-v3-0001',execution_id:'execution-v3-0001',content_digest:'a'.repeat(64),catalog_version_id:'openai-gpt-5-6-terra-standard-short-v3',active_catalog_digest:'b'.repeat(64)});
const consumedAt='2026-10-07T10:00:00Z';

function makeHarness(over={}){
  const state={activated:false, closed:0, readerSessionSeen:null, executorRequest:null, readerQueries:[], executorQueries:[], forcePreFail:false, forcePostFail:false, consumedBefore:false, ledgerMode:'ok', receiptMode:'ok'};
  const executorPhysical={applicationName:'lai03b-executor:abc',dead:false,isDead(){return this.dead;},async close(){this.dead=true;state.closed++;},async query(sql,params){state.executorQueries.push({sql,params});if(sql===ACT){state.activated=true;let receipt={contract:'CatalogActivationReceiptV3',action:'activate',catalog_version_id:claims.catalog_version_id,active_catalog_digest:claims.active_catalog_digest,approval_id:claims.approval_id,execution_id:claims.execution_id,content_digest:claims.content_digest,consumed_at:consumedAt};if(state.receiptMode==='bad')receipt={bad:true};return {rows:[{activate_catalog_v3:receipt}]};}return {rows:[]};}};
  const readerPhysical={applicationName:'lai03b-reader:def',dead:false,isDead(){return this.dead;},async close(){this.dead=true;state.closed++;},async query(sql,params=[]){state.readerQueries.push({sql,params});if(sql===Q.ledger){if(!state.activated)return {rows:state.consumedBefore?[{approval_id:claims.approval_id}]:[]};if(state.ledgerMode==='zero')return {rows:[]};if(state.ledgerMode==='dup')return {rows:[{},{}]};const row={approval_id:claims.approval_id,execution_id:claims.execution_id,content_digest:claims.content_digest,active_catalog_digest:claims.active_catalog_digest,action:'activate',consumed_at:consumedAt};if(state.ledgerMode==='mismatch')row.content_digest='c'.repeat(64);return {rows:[row]};}return {rows:[{dummy:true}]};}};
  const exSession={physical:executorPhysical,token:'1'.repeat(64),identity:{pid:101,applicationName:executorPhysical.applicationName,role:'live_ai_03b_executor'},dbNowMs:1791360000000,effectiveStatementTimeoutMs:10000};
  const rdSession={physical:readerPhysical,token:'2'.repeat(64),identity:{pid:202,applicationName:readerPhysical.applicationName,role:'live_ai_03b_reader'},dbNowMs:1791360000000,effectiveStatementTimeoutMs:2000};
  const runtime={
    EXECUTOR_ATTESTATION_CONTRACT_V2:'AiStagingExecutorAttestationV2', EXECUTOR_ROLE:'live_ai_03b_executor', QUERIES:Q, REGISTRY_DIGEST:'d'.repeat(64), ACTIVATE_SQL_V3:ACT,
    validateRuntimePreservationBinding:b=>checkPinnedRuntimeBinding(b), runtimePinRef:b=>localRuntimePinRef(b),
    loadRuntimeConfigV3:env=>env?.ok===false?{ok:false,reason:'runtime_config_fail'}:{ok:true,reviewer:{pinnedPublicKeyDerB64:'DER',pinnedFingerprint:'f'.repeat(64)}},
    validateV3ProductionExecutorAuthority:args=>over.executorAttestationReject?{ok:false,reason:'executor_v2_rejected'}:{ok:true,executorAttestation:{},successorRuntimePinRef:PINNED_SUCCESSOR_RUNTIME_PIN_REF},
    verifyApprovalV3:args=>{if(over.approvalReject)return {ok:false,reason:'approval_rejected'};if(args.isConsumed(claims.approval_id,claims.execution_id))return {ok:false,reason:'approval_already_consumed_replay'};return {ok:true,claims,approvalId:claims.approval_id,executionId:claims.execution_id,contentDigest:claims.content_digest};},
    checkPreActivationState:()=>state.forcePreFail?{ok:false,reason:'pre_state_fail'}:{ok:true},
    checkActivatedState:()=>state.forcePostFail?{ok:false,reason:'post_state_fail'}:{ok:true},
    makeRestrictedActivationAdapterV3:({dbClient})=>({activate:async({claims:cl,executionId})=>{if(over.activationReject)return {ok:false,reason:'activation_refused',uncertain:!!over.activationUncertain};try{return {ok:true,result:await dbClient.query(ACT,[JSON.stringify(cl),executionId])};}catch{return {ok:false,reason:'activation_db_error',uncertain:true};}}}),
  };
  const clock={bound:false,bindToDbClock(){if(over.clockReject)return {ok:false,reason:'clock_bind_fail'};this.bound=true;return {ok:true};},nowMs(){return 1791360000000;},nowIso(){return '2026-10-07T10:00:00Z';}};
  const deps={
    env:{}, clock, runtime, runtimePreservationBinding:PINNED_RUNTIME_BINDING,
    executorPhysicalFactory:{open:async()=>{if(over.executorOpenReject)throw new Error('x');return executorPhysical;}},
    readerPhysicalFactory:{open:async()=>{if(over.readerOpenReject)throw new Error('x');return over.samePhysical?executorPhysical:readerPhysical;}},
    establishExecutorSession:async()=>over.executorSessionReject?{ok:false,reason:'executor_session_fail'}:{ok:true,session:exSession},
    establishReaderSession:async p=>{if(over.readerSessionReject)return {ok:false,reason:'reader_session_fail'};return {ok:true,session:over.samePhysical?{...rdSession,physical:executorPhysical}:rdSession};},
    executorAttestationSource:{obtain:async req=>{state.executorRequest=req;if(over.executorSourceThrow)throw new Error('x');return {payload:{},signatureB64:'sig'};}},
    readerAttestationProvider:{obtain:async({session})=>{state.readerSessionSeen=session;if(over.readerProviderThrow)throw new Error('x');if(over.readerReject)return {ok:false,reason:'reader_rejected'};return {ok:true,protocol:over.readerProtocolBad?'v1':'reader-attestation-channel-v2',requestNonce:'3'.repeat(32),envelope:{payload:{},signatureB64:'sig'}};}},
    executorTrustRoot:{issuer:'staybid.live-ai-03b.executor-attester.v2'},readerTrustRoot:{issuer:'reader'},
    bindReaderConnection:()=>over.readerBindingReject?{ok:false,reason:'reader_binding_rejected'}:{ok:true,binding:{}}
  };
  return {state,deps,request:{approvalEnvelope:{payload:{approval_id:claims.approval_id}},suppliedEvidence:{},executionId:claims.execution_id},exSession,rdSession};
}

await test('runtime pin ref exact',()=>assert.equal(localRuntimePinRef(),PINNED_SUCCESSOR_RUNTIME_PIN_REF));
await test('runtime binding exact pass',()=>assert.equal(checkPinnedRuntimeBinding(PINNED_RUNTIME_BINDING).ok,true));
await test('runtime binding altered commit fails',()=>assert.match(checkPinnedRuntimeBinding({...PINNED_RUNTIME_BINDING,commit:'0'.repeat(40)}).reason,/pin_mismatch:commit/));
await test('runtime binding extra key fails',()=>assert.equal(checkPinnedRuntimeBinding({...PINNED_RUNTIME_BINDING,x:1}).reason,'runtime_binding_shape_not_exact'));

await test('guard executor exact V3 SQL once',async()=>{const p={isDead:()=>false,query:async()=>({rows:[]})};const g=makeGuardedExecutorClientV3({physical:p},ACT);assert.deepEqual((await g.query(ACT,['{}','execution-v3-0001'])).rows,[]);await assert.rejects(()=>g.query(ACT,['{}','execution-v3-0001']),e=>e.code==='EXECUTOR_ACTIVATION_ALREADY_ISSUED');});
await test('guard executor rejects other SQL',async()=>{const g=makeGuardedExecutorClientV3({physical:{isDead:()=>false,query:async()=>({rows:[]})}},ACT);await assert.rejects(()=>g.query('SELECT 1',['{}','execution-v3-0001']),e=>e.code==='EXECUTOR_SQL_NOT_ADMITTED');});
await test('guard executor rejects bad params',async()=>{const g=makeGuardedExecutorClientV3({physical:{isDead:()=>false,query:async()=>({rows:[]})}},ACT);await assert.rejects(()=>g.query(ACT,[]),e=>e.code==='EXECUTOR_PARAMS_NOT_ADMITTED');});
await test('guard reader exact registry',async()=>{const g=makeGuardedReaderClientV3({physical:{isDead:()=>false,query:async()=>({rows:[]})},effectiveStatementTimeoutMs:2000},Q);for(const sql of [Q.catalogEntries,Q.catalogVersions,Q.controls,Q.policy])await g.query(sql);await g.query(Q.ledger,['approval-v3-0001','execution-v3-0001']);});
await test('guard reader rejects non-registry SQL',async()=>{const g=makeGuardedReaderClientV3({physical:{isDead:()=>false,query:async()=>({rows:[]})}},Q);await assert.rejects(()=>g.query('SELECT 1'),e=>e.code==='READER_SQL_NOT_ADMITTED');});
await test('guard reader ledger params exact',async()=>{const g=makeGuardedReaderClientV3({physical:{isDead:()=>false,query:async()=>({rows:[]})}},Q);await assert.rejects(()=>g.query(Q.ledger,[]),e=>e.code==='READER_PARAMS_NOT_ADMITTED');});

await test('integration rejects extra dep',()=>{const {deps}=makeHarness();const c=createV3ProductionIntegrationCore({...deps,x:1});assert.equal(c.available,false);assert.equal(c.reason,'integration_deps_shape_not_exact');});
await test('integration rejects bad runtime config',()=>{const {deps}=makeHarness();deps.env={ok:false};const c=createV3ProductionIntegrationCore(deps);assert.equal(c.reason,'runtime_config_fail');});
await test('integration composes with exact deps',()=>{const {deps}=makeHarness();assert.equal(createV3ProductionIntegrationCore(deps).available,true);});
await test('request extra authority key rejected before I/O',async()=>{const {deps,request}=makeHarness();const c=createV3ProductionIntegrationCore(deps);const r=await c.run({...request,executorTrustRoot:{}});assert.equal(r.reason,'request_shape_not_exact');});
await test('one-shot boundary refuses second run',async()=>{const {deps,request}=makeHarness();const c=createV3ProductionIntegrationCore(deps);assert.equal((await c.run(request)).ok,true);assert.equal((await c.run(request)).reason,'activation_boundary_is_one_shot');});
await test('executor open failure fail-closed',async()=>{const {deps,request}=makeHarness({executorOpenReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'executor_connection_failed');});
await test('executor session failure fail-closed',async()=>{const {deps,request}=makeHarness({executorSessionReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'executor_session_fail');});
await test('clock bind failure fail-closed',async()=>{const {deps,request}=makeHarness({clockReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'clock_bind_fail');});
await test('reader open failure fail-closed',async()=>{const {deps,request}=makeHarness({readerOpenReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'reader_connection_failed');});
await test('reader session failure fail-closed',async()=>{const {deps,request}=makeHarness({readerSessionReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'reader_session_fail');});
await test('executor attestation source failure fail-closed',async()=>{const {deps,request}=makeHarness({executorSourceThrow:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'executor_attestation_unavailable');});
await test('executor attestation V2 rejection fail-closed',async()=>{const {deps,request}=makeHarness({executorAttestationReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'executor_v2_rejected');});
await test('reader provider failure fail-closed',async()=>{const {deps,request}=makeHarness({readerReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'reader_rejected');});
await test('reader v1 protocol rejected',async()=>{const {deps,request}=makeHarness({readerProtocolBad:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'reader_v2_result_invalid');});
await test('reader binding rejection fail-closed',async()=>{const {deps,request}=makeHarness({readerBindingReject:true});assert.equal((await createV3ProductionIntegrationCore(deps).run(request)).reason,'reader_binding_rejected');});
await test('same physical connection rejected',async()=>{const {deps,request}=makeHarness({samePhysical:true});const r=await createV3ProductionIntegrationCore(deps).run(request);assert.match(r.reason,/share_a_physical_connection|integration_execution_failed/);});
await test('reader provider receives exact established session',async()=>{const h=makeHarness();assert.equal((await createV3ProductionIntegrationCore(h.deps).run(h.request)).ok,true);assert.equal(h.state.readerSessionSeen,h.rdSession);});
await test('executor source receives exact V2 contract role token nonce',async()=>{const h=makeHarness();assert.equal((await createV3ProductionIntegrationCore(h.deps).run(h.request)).ok,true);assert.equal(h.state.executorRequest.contract,'AiStagingExecutorAttestationV2');assert.equal(h.state.executorRequest.role,'live_ai_03b_executor');assert.equal(h.state.executorRequest.connectionToken,'1'.repeat(64));assert.match(h.state.executorRequest.requestNonce,/^[0-9a-f]{32}$/);});
await test('preactivation failure prevents activation',async()=>{const h=makeHarness();h.state.forcePreFail=true;const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'pre_state_fail');assert.equal(h.state.executorQueries.length,0);});
await test('replay precheck rejects consumed approval',async()=>{const h=makeHarness();h.state.consumedBefore=true;const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'approval_already_consumed_replay');assert.equal(h.state.executorQueries.length,0);});
await test('approval rejection prevents activation',async()=>{const h=makeHarness({approvalReject:true});const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'approval_rejected');assert.equal(h.state.executorQueries.length,0);});
await test('activation refusal returned without retry',async()=>{const h=makeHarness({activationReject:true});const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'activation_refused');assert.equal(h.state.executorQueries.length,0);});
await test('activation uncertain flag preserved',async()=>{const h=makeHarness({activationReject:true,activationUncertain:true});const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.uncertain,true);});
await test('malformed activation receipt is uncertain hold',async()=>{const h=makeHarness();h.state.receiptMode='bad';const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'activation_receipt_shape');assert.equal(r.uncertain,true);});
await test('post ledger zero rows is uncertain hold',async()=>{const h=makeHarness();h.state.ledgerMode='zero';const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'committed_ledger_cardinality');assert.equal(r.uncertain,true);});
await test('post ledger duplicate rows is uncertain hold',async()=>{const h=makeHarness();h.state.ledgerMode='dup';const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'committed_ledger_cardinality');});
await test('post ledger mismatch is uncertain hold',async()=>{const h=makeHarness();h.state.ledgerMode='mismatch';const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'committed_ledger_binding');});
await test('post activated state mismatch is uncertain hold',async()=>{const h=makeHarness();h.state.forcePostFail=true;const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.reason,'post_state_fail');assert.equal(r.uncertain,true);});
await test('success returns V3 correlated stage and no probe ready',async()=>{const h=makeHarness();const r=await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(r.ok,true);assert.equal(r.activated,true);assert.equal(r.probeReady,false);assert.equal(r.stage,'V3_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED');assert.equal(r.successorRuntimePinRef,PINNED_SUCCESSOR_RUNTIME_PIN_REF);});
await test('connections closed after success',async()=>{const h=makeHarness();await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(h.state.closed,2);});
await test('connections closed after post-activation hold',async()=>{const h=makeHarness();h.state.forcePostFail=true;await createV3ProductionIntegrationCore(h.deps).run(h.request);assert.equal(h.state.closed,2);});

const here=path.dirname(fileURLToPath(import.meta.url));const src=fs.readFileSync(path.join(here,'../src/production-composition.mjs'),'utf8');
await test('composition imports exact R3 preservation path',()=>assert.match(src,/m7-post-step67-fresh-successor-r3-preservation-02\/artifact\/extracted\/src\/v3-runtime-config\.mjs/));
await test('composition consumes Executor Attestation V2',()=>assert.match(src,/EXECUTOR_ATTESTATION_CONTRACT_V2/));
await test('composition has no V1 executor verifier import',()=>assert.ok(!/executor-attestation\.mjs['"]/.test(src)));
await test('reader-only binder has no Executor V1 dependency',()=>{const b=fs.readFileSync(path.join(here,'../src/reader-v2-binding.mjs'),'utf8');assert.ok(!/m7-v2-production-authority-provisioning-offline-01\/src\/executor-attestation/.test(b));assert.match(b,/private-reader-production-integration-offline-01\/reader-attestation\.mjs/);});
await test('composition reuses frozen executor session',()=>assert.match(src,/m7-v2-production-authority-provisioning-offline-01\/src\/executor-session\.mjs/));
await test('composition reuses frozen reader session',()=>assert.match(src,/private-reader-production-integration-offline-01\/reader-session\.mjs/));
await test('composition uses reader-only V2 binder',()=>assert.match(src,/reader-v2-binding\.mjs/));
await test('composition reuses frozen DB-bound clock',()=>assert.match(src,/m7-v2-production-authority-provisioning-offline-01\/src\/trusted-clock\.mjs/));
await test('composition pins binding internally not request',()=>{assert.match(src,/PINNED_RUNTIME_BINDING/);assert.ok(!/runtimePreservationBinding['"]?\s*:\s*deps/.test(src));});
await test('core does not auto-restore',()=>{const core=fs.readFileSync(path.join(here,'../src/v3-integration-core.mjs'),'utf8');assert.ok(!/restore_catalog|\.restore\(/.test(core));});
await test('core does not call provider or gateway',()=>{const core=fs.readFileSync(path.join(here,'../src/v3-integration-core.mjs'),'utf8');assert.ok(!/OPENAI|providerCall|gatewayService|gateway_action/i.test(core));});

console.log(`RESULT: ${fail===0?'PASS':'FAIL'} (${pass} passed, ${fail} failed)`);
if(fail)process.exit(1);
