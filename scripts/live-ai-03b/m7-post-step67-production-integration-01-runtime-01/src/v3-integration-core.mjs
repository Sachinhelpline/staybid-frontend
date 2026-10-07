import { randomBytes } from 'node:crypto';
import { checkPinnedRuntimeBinding, PINNED_SUCCESSOR_RUNTIME_PIN_REF } from './runtime-preservation-binding.mjs';
import { makeGuardedExecutorClientV3, makeGuardedReaderClientV3 } from './v3-guarded-clients.mjs';

const REQUEST_KEYS = Object.freeze(['approvalEnvelope','executionId','suppliedEvidence']);
const HEX32 = /^[0-9a-f]{32}$/;
const IDRE = /^[A-Za-z0-9._:-]{8,128}$/;
const RFC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const fail = (stage, reason, extra) => Object.freeze({ ok:false, activated:false, probeReady:false, stage, reason, ...(extra||{}) });
const unavailable = reason => Object.freeze({ available:false, reason, run:async()=>fail('production_integration',reason) });
const exactKeys = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === [...keys].sort().join(',');

async function rows(client, sql, params) {
  const r = await client.query(sql, params);
  if (!r || !Array.isArray(r.rows)) throw new Error('query_rows_invalid');
  return r.rows;
}
async function observeState(reader, q) {
  const [versions, entries, policyRows, controlRows] = await Promise.all([
    rows(reader,q.catalogVersions), rows(reader,q.catalogEntries), rows(reader,q.policy), rows(reader,q.controls)
  ]);
  return { versions, entries, policyRows, controlRows };
}
function parseActivationReceipt(result) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) return null;
  const row = result.rows[0];
  if (!row || typeof row !== 'object') return null;
  const value = row.activate_catalog_v3;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const p=JSON.parse(value); return p && typeof p==='object' && !Array.isArray(p) ? p : null; } catch { return null; } }
  return null;
}
function checkPostCorrelation(receipt, ledgerRows, claims) {
  if (!receipt || !claims) return {ok:false,reason:'activation_receipt_absent'};
  const rkeys=['action','active_catalog_digest','approval_id','catalog_version_id','consumed_at','content_digest','contract','execution_id'];
  if (!exactKeys(receipt,rkeys)) return {ok:false,reason:'activation_receipt_shape'};
  if (receipt.contract!=='CatalogActivationReceiptV3'||receipt.action!=='activate'||receipt.catalog_version_id!==claims.catalog_version_id||receipt.active_catalog_digest!==claims.active_catalog_digest||receipt.approval_id!==claims.approval_id||receipt.execution_id!==claims.execution_id||receipt.content_digest!==claims.content_digest||!RFC.test(String(receipt.consumed_at))) return {ok:false,reason:'activation_receipt_binding'};
  if (!Array.isArray(ledgerRows) || ledgerRows.length!==1) return {ok:false,reason:'committed_ledger_cardinality'};
  const l=ledgerRows[0]; const lkeys=['action','active_catalog_digest','approval_id','consumed_at','content_digest','execution_id'];
  if (!exactKeys(l,lkeys)) return {ok:false,reason:'committed_ledger_shape'};
  if (l.approval_id!==claims.approval_id||l.execution_id!==claims.execution_id||l.content_digest!==claims.content_digest||l.active_catalog_digest!==claims.active_catalog_digest||l.action!=='activate'||l.consumed_at!==receipt.consumed_at) return {ok:false,reason:'committed_ledger_binding'};
  return {ok:true,consumedAt:l.consumed_at};
}
function distinct(exS, rdS, exNonce, rdNonce) {
  if (exS.physical===rdS.physical) return {ok:false,reason:'executor_and_reader_share_a_physical_connection'};
  if (exS.token===rdS.token) return {ok:false,reason:'executor_and_reader_share_a_connection_token'};
  if (exS.identity?.pid===rdS.identity?.pid) return {ok:false,reason:'executor_and_reader_share_a_backend'};
  if (exS.identity?.applicationName===rdS.identity?.applicationName) return {ok:false,reason:'executor_and_reader_share_an_application_name'};
  if (exNonce===rdNonce) return {ok:false,reason:'executor_and_reader_share_a_request_nonce'};
  return {ok:true};
}

export function createV3ProductionIntegrationCore(d, { testBoundary=false }={}) {
  const required=['clock','env','establishExecutorSession','establishReaderSession','executorAttestationSource','executorPhysicalFactory','executorTrustRoot','readerAttestationProvider','readerPhysicalFactory','readerTrustRoot','runtime','runtimePreservationBinding','bindReaderConnection'];
  if (!exactKeys(d,required)) return unavailable('integration_deps_shape_not_exact');
  const pinLocal=checkPinnedRuntimeBinding(d.runtimePreservationBinding); if(!pinLocal.ok)return unavailable(pinLocal.reason);
  const pinR3=d.runtime.validateRuntimePreservationBinding(d.runtimePreservationBinding); if(!pinR3?.ok)return unavailable(pinR3?.reason||'r3_runtime_binding_rejected');
  const pinRef=d.runtime.runtimePinRef(d.runtimePreservationBinding); if(pinRef!==PINNED_SUCCESSOR_RUNTIME_PIN_REF||pinR3.pinRef!==PINNED_SUCCESSOR_RUNTIME_PIN_REF)return unavailable('successor_runtime_pin_ref_mismatch');
  const cfg=d.runtime.loadRuntimeConfigV3(d.env); if(!cfg?.ok)return unavailable(cfg?.reason||'runtime_config_v3_rejected');
  if (!d.executorPhysicalFactory||typeof d.executorPhysicalFactory.open!=='function'||!d.readerPhysicalFactory||typeof d.readerPhysicalFactory.open!=='function') return unavailable('physical_factory_invalid');
  if (!d.executorAttestationSource||typeof d.executorAttestationSource.obtain!=='function') return unavailable('executor_attestation_source_invalid');
  if (!d.readerAttestationProvider||typeof d.readerAttestationProvider.obtain!=='function') return unavailable('reader_attestation_provider_invalid');
  if (!d.clock||typeof d.clock.bindToDbClock!=='function'||typeof d.clock.nowMs!=='function'||typeof d.clock.nowIso!=='function') return unavailable('trusted_clock_invalid');
  if (!d.executorTrustRoot||typeof d.executorTrustRoot!=='object'||!d.readerTrustRoot||typeof d.readerTrustRoot!=='object') return unavailable('attester_trust_root_absent');
  let used=false;
  return Object.freeze({
    available:true, mode:testBoundary?'test':'production', successorRuntimePinRef:pinRef,
    async run(request){
      if(used)return fail('guard','activation_boundary_is_one_shot'); used=true;
      if(!exactKeys(request,REQUEST_KEYS))return fail('production_boundary','request_shape_not_exact');
      const opened=[]; const closeAll=async()=>{for(const p of opened.splice(0).reverse()){try{await p.close();}catch{}}};
      try{
        let exPhys; try{exPhys=await d.executorPhysicalFactory.open();}catch{return fail('executor_connection','executor_connection_failed');} opened.push(exPhys);
        const exS=await d.establishExecutorSession(exPhys,{statementTimeoutMs:10000}); if(!exS?.ok)return fail('executor_session',exS?.reason||'executor_session_failed');
        const cb=d.clock.bindToDbClock(exS.session.dbNowMs); if(!cb?.ok)return fail('clock',cb?.reason||'clock_bind_failed');
        let rdPhys; try{rdPhys=await d.readerPhysicalFactory.open();}catch{return fail('reader_connection','reader_connection_failed');} opened.push(rdPhys);
        const rdS=await d.establishReaderSession(rdPhys,{statementTimeoutMs:2000}); if(!rdS?.ok)return fail('reader_session',rdS?.reason||'reader_session_failed');
        const exNonce=randomBytes(16).toString('hex');
        let exEnv; try{exEnv=await d.executorAttestationSource.obtain({contract:d.runtime.EXECUTOR_ATTESTATION_CONTRACT_V2,connectionToken:exS.session.token,role:d.runtime.EXECUTOR_ROLE,requestNonce:exNonce});}catch{return fail('executor_attestation','executor_attestation_unavailable');}
        const ex=d.runtime.validateV3ProductionExecutorAuthority({executorAttestation:exEnv,executorTrustRoot:d.executorTrustRoot,expectedConnectionToken:exS.session.token,expectedRequestNonce:exNonce,now:d.clock.nowMs(),runtimePreservationBinding:d.runtimePreservationBinding});
        if(!ex?.ok)return fail('executor_attestation',ex?.reason||'executor_attestation_rejected');
        let rr; try{rr=await d.readerAttestationProvider.obtain({session:rdS.session});}catch{return fail('reader_attestation','reader_attestation_unavailable');}
        if(!rr?.ok||rr.protocol!=='reader-attestation-channel-v2'||!rr.envelope||!HEX32.test(rr.requestNonce||''))return fail('reader_attestation',rr?.reason||'reader_v2_result_invalid');
        const rd=d.bindReaderConnection({session:rdS.session,envelope:rr.envelope,trustRoot:d.readerTrustRoot,requestNonce:rr.requestNonce,nowMs:d.clock.nowMs(),testBoundary});
        if(!rd?.ok)return fail('reader_binding',rd?.reason||'reader_binding_failed');
        const sep=distinct(exS.session,rdS.session,exNonce,rr.requestNonce); if(!sep.ok)return fail('connection_separation',sep.reason);
        let executor,reader,activator; try{
          executor=makeGuardedExecutorClientV3(exS.session,d.runtime.ACTIVATE_SQL_V3,{testBoundary});
          reader=makeGuardedReaderClientV3(rdS.session,d.runtime.QUERIES,{testBoundary});
          activator=d.runtime.makeRestrictedActivationAdapterV3({dbClient:executor});
        }catch{return fail('guarded_clients','guarded_client_construction_failed');}
        const preObs=await observeState(reader,d.runtime.QUERIES); const pre=d.runtime.checkPreActivationState(preObs,d.clock.nowIso()); if(!pre?.ok)return fail('pre_activation_observation',pre?.reason||'pre_activation_rejected');
        const claimed=request.approvalEnvelope?.payload?.approval_id; let consumedBefore=false;
        if(typeof claimed==='string'&&IDRE.test(claimed)&&typeof request.executionId==='string'&&IDRE.test(request.executionId)){
          const before=await rows(reader,d.runtime.QUERIES.ledger,[claimed,request.executionId]); consumedBefore=before.length>0;
        }
        const approval=d.runtime.verifyApprovalV3({envelope:request.approvalEnvelope,trustRoot:cfg.reviewer,suppliedEvidence:request.suppliedEvidence,nowIso:d.clock.nowIso(),executionId:request.executionId,isConsumed:(a,e)=>consumedBefore&&a===claimed&&e===request.executionId,successorRuntimePinRef:pinRef});
        if(!approval?.ok)return fail('approval',approval?.reason||'approval_rejected');
        const act=await activator.activate({claims:approval.claims,executionId:request.executionId}); if(!act?.ok)return fail('activation',act?.reason||'activation_failed',act?.uncertain?{uncertain:true}:undefined);
        const receipt=parseActivationReceipt(act.result); if(!receipt)return fail('activation_receipt','activation_receipt_absent',{uncertain:true});
        const committed=await rows(reader,d.runtime.QUERIES.ledger,[approval.approvalId,approval.executionId]);
        const corr=checkPostCorrelation(receipt,committed,approval.claims); if(!corr.ok)return fail('phase_b_correlation',corr.reason,{uncertain:true});
        const postObs=await observeState(reader,d.runtime.QUERIES); const post=d.runtime.checkActivatedState(postObs,d.clock.nowIso()); if(!post?.ok)return fail('activated_observation',post?.reason||'activated_state_rejected',{uncertain:true});
        return Object.freeze({ok:true,activated:true,probeReady:false,stage:'V3_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED',approvalId:approval.approvalId,executionId:approval.executionId,consumedAt:corr.consumedAt,successorRuntimePinRef:pinRef,note:'V3 catalog activation only; policy/control arm, provider probe and gateway remain separate and unauthorized.'});
      }catch{return fail('integration','integration_execution_failed',{uncertain:true});}
      finally{await closeAll();}
    }
  });
}
